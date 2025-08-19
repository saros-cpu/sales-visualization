# nginx-ctl.ps1 - Control Nginx service
# Usage: powershell -File nginx-ctl.ps1 [start|stop|restart|reload|status]

. "$PSScriptRoot\nginx\config.ps1"
$projectConf = "$PSScriptRoot\nginx.conf"
$action = if ($args[0]) { $args[0] } else { "status" }

# Sync project nginx.conf to nginx home before any action
if ($action -ne "status" -and (Test-Path $projectConf)) {
    (Get-Content $projectConf -Raw) -replace "__PROJECT_ROOT__", $PSScriptRoot.Replace("\", "/") | Set-Content "$nginxHome\conf\nginx.conf" -Force
    if (Test-Path "$PSScriptRoot\mime.types") {
        Copy-Item "$PSScriptRoot\mime.types" "$nginxHome\conf\mime.types" -Force
    }
}

Push-Location $nginxHome

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
        .\nginx.exe -s stop
        Write-Host "Nginx stopped"
    }
    "restart" {
        .\nginx.exe -s stop
        Start-Sleep -Seconds 1
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
