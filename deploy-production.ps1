# deploy-production.ps1 - Build frontend and deploy Nginx config
# Usage: powershell -ExecutionPolicy Bypass -File deploy-production.ps1

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $projectRoot "frontend"
$nginxHome = "D:\nginx\nginx-1.26.3"
$confSource = Join-Path $projectRoot "nginx.conf"

Write-Host "====================================="
Write-Host " Production Deployment"
Write-Host "====================================="

# Step 1: Build frontend
Write-Host ""
Write-Host "[1/4] Building frontend (npm run build) ..."
Push-Location $frontendDir
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Frontend build failed!"
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Build complete: $frontendDir\dist\"

# Step 2: Copy nginx config
Write-Host "[2/4] Deploying nginx.conf ..."
if (-not (Test-Path $confSource)) {
    Write-Host "  ERROR: nginx.conf not found at $confSource"
    exit 1
}
Copy-Item $confSource "$nginxHome\conf\nginx.conf" -Force
Write-Host "  Config deployed: $nginxHome\conf\nginx.conf"

# Step 3: Test nginx config
Write-Host "[3/4] Testing nginx configuration ..."
Push-Location $nginxHome
.\nginx.exe -t
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Nginx config test failed!"
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Config test passed"

# Step 4: Start or reload nginx
Write-Host "[4/4] Starting Nginx ..."
Push-Location $nginxHome
# Check if nginx is already running
$nginxProcess = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
if ($nginxProcess) {
    Write-Host "  Nginx already running, reloading config ..."
    .\nginx.exe -s reload
    Write-Host "  Nginx reloaded"
} else {
    Start-Process -FilePath ".\nginx.exe" -WindowStyle Hidden
    Start-Sleep -Seconds 1
    $nginxProcess = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
    if ($nginxProcess) {
        Write-Host "  Nginx started successfully (PID: $($nginxProcess[0].Id))"
    } else {
        Write-Host "  WARNING: Nginx may not have started. Check $nginxHome\logs\error.log"
    }
}
Pop-Location

Write-Host ""
Write-Host "====================================="
Write-Host " Deployment complete!"
Write-Host " Access: http://localhost"
Write-Host " API:    http://localhost/api/health"
Write-Host "====================================="
