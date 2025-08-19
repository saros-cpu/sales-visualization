# Restart nginx with new config (requires admin)
# Run: powershell -ExecutionPolicy Bypass -File restart-nginx-admin.ps1

$nginxHome = "D:\nginx\nginx-1.26.3"

# Kill all old nginx processes
Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force

Start-Sleep -Seconds 2

# Verify port 80 is free
$port80 = netstat -ano | Select-String ":80 " | Select-String "LISTENING"
if ($port80) {
    Write-Host "Port 80 still in use. Force killing..."
    Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Sync config first
(Get-Content "$PSScriptRoot\nginx.conf" -Raw) -replace "__PROJECT_ROOT__", $PSScriptRoot.Replace("\", "/") | Set-Content "$nginxHome\conf\nginx.conf" -Force

# Start nginx
Push-Location $nginxHome
Start-Process -FilePath ".\nginx.exe" -WindowStyle Hidden
Start-Sleep -Seconds 2

# Test
.\nginx.exe -t
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nginx started with new config" -ForegroundColor Green
} else {
    Write-Host "Nginx config test failed" -ForegroundColor Red
}
Pop-Location
