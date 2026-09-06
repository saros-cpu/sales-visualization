# Restart nginx with new config (requires admin)
# Run: powershell -ExecutionPolicy Bypass -File restart-nginx-admin.ps1

$nginxHome = "D:\nginx\nginx-1.26.3"
$projectRoot = $PSScriptRoot              # D:\SalesVisualization
$canonicalConf = Join-Path $projectRoot "conf\nginx.conf"
$defaultConf   = Join-Path $nginxHome "conf\nginx.conf"

# Kill ALL old nginx processes.
# As Administrator this also kills the protected SYSTEM master (session 0)
# that otherwise cannot be terminated from a normal session.
Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# Verify port 80/443 are free
$inuse = netstat -ano | Select-String ":80 |:443 " | Select-String "LISTENING"
if ($inuse) {
    Write-Host "Port 80/443 still in use. Force killing again..."
    Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Resolve template: substitute __PROJECT_ROOT__ -> D:\SalesVisualization
$resolved = (Get-Content "$PSScriptRoot\nginx.conf" -Raw) -replace "__PROJECT_ROOT__", $PSScriptRoot.Replace("\", "/")

# Sync to BOTH the canonical path (used by -p D:\SalesVisualization) and the
# default binary prefix path, so `nginx -t` / `nginx -s reload` behave the same
# regardless of which prefix is used.
$resolved | Set-Content $canonicalConf -Force
$resolved | Set-Content $defaultConf -Force

# Start a SINGLE nginx instance with the canonical project prefix.
Push-Location $nginxHome
Start-Process -FilePath ".\nginx.exe" -ArgumentList "-p", $projectRoot -WindowStyle Hidden
Start-Sleep -Seconds 2

# Test using the same canonical prefix
.\nginx.exe -p $projectRoot -t
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nginx started with new config (prefix $projectRoot)" -ForegroundColor Green
} else {
    Write-Host "Nginx config test failed" -ForegroundColor Red
}
Pop-Location
