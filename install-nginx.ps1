# install-nginx.ps1 - Download and install Nginx for Windows
# Usage: powershell -ExecutionPolicy Bypass -File install-nginx.ps1

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\nginx\config.ps1"
$nginxUrl = "https://nginx.org/download/nginx-$nginxVersion.zip"
$downloadPath = "$env:TEMP\nginx-$nginxVersion.zip"

Write-Host "====================================="
Write-Host " Nginx $nginxVersion Installer"
Write-Host "====================================="

# Check if already installed
if (Test-Path "$nginxHome\nginx.exe") {
    Write-Host "Nginx already installed at $nginxHome, skipping."
    return
}

# Download
Write-Host ""
Write-Host "[1/4] Downloading Nginx $nginxVersion ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $nginxUrl -OutFile $downloadPath -UseBasicParsing
Write-Host "  Downloaded: $downloadPath"

# Extract
Write-Host "[2/4] Extracting to $installDir ..."
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
Expand-Archive -Path $downloadPath -DestinationPath $installDir -Force
Write-Host "  Extracted: $nginxHome"

# Verify
Write-Host "[3/4] Verifying installation ..."
if (Test-Path "$nginxHome\nginx.exe") {
    Write-Host "  nginx.exe found - OK"
} else {
    Write-Host "  ERROR: nginx.exe not found!"
    exit 1
}

# Cleanup
Write-Host "[4/4] Cleaning up temp files ..."
Remove-Item $downloadPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "====================================="
Write-Host " Installation complete!"
Write-Host " Path: $nginxHome"
Write-Host " Next: run deploy-production.ps1"
Write-Host "====================================="
