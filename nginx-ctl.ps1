# nginx-ctl.ps1 - Control Nginx service
# Usage: powershell -File nginx-ctl.ps1 [start|stop|restart|reload|status]

. "$PSScriptRoot\nginx\config.ps1"
$projectConf = "$PSScriptRoot\nginx.conf"
$action = if ($args[0]) { $args[0] } else { "status" }

# Sync project nginx.conf to nginx home before any action
if ($action -ne "status" -and (Test-Path $projectConf)) {
    $nginxConfig = (Get-Content $projectConf -Raw) -replace "__PROJECT_ROOT__", $PSScriptRoot.Replace("\", "/")
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path $nginxHome "conf\nginx.conf"), $nginxConfig, $utf8NoBom)
    if (Test-Path "$PSScriptRoot\mime.types") {
        Copy-Item "$PSScriptRoot\mime.types" "$nginxHome\conf\mime.types" -Force
    }
}

Push-Location $nginxHome
$nginxExe = (Resolve-Path ".\nginx.exe").Path

function Stop-SalesNginx {
    .\nginx.exe -s stop 2>$null
    Start-Sleep -Seconds 1
    $remaining = Get-Process -Name "nginx" -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -eq $nginxExe
    }
    if ($remaining) {
        $remaining | Stop-Process -Force
    }
}

switch ($action) {
    "start" {
        $proc = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Nginx already running (PID: $($proc[0].Id))"
        } else {
            Start-Process -FilePath ".\nginx.exe" -WindowStyle Hidden
            Start-Sleep -Seconds 1
            $proc = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
            if ($proc) { Write-Host "Nginx started (PID: $($proc[0].Id))" }
            else { Write-Host "ERROR: Failed to start. Check logs\error.log" }
        }
    }
    "stop" {
        Stop-SalesNginx
        Write-Host "Nginx stopped"
    }
    "restart" {
        Stop-SalesNginx
        Start-Process -FilePath ".\nginx.exe" -WindowStyle Hidden
        Start-Sleep -Seconds 1
        $proc = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
        if ($proc) { Write-Host "Nginx restarted (PID: $($proc[0].Id))" }
        else { Write-Host "ERROR: Failed to restart. Check logs\error.log" }
    }
    "reload" {
        .\nginx.exe -s reload
        Write-Host "Nginx config reloaded"
    }
    "status" {
        $proc = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Nginx is running"
            $proc | Format-Table Id, ProcessName, CPU, WorkingSet64 -AutoSize
        } else {
            Write-Host "Nginx is not running"
        }
    }
    default {
        Write-Host "Usage: nginx-ctl.ps1 [start|stop|restart|reload|status]"
    }
}

Pop-Location
