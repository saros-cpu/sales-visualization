# ============================================================================
# SalesWallpaperEngine - complete uninstall script
# Run as the logged-in user:  powershell -ExecutionPolicy Bypass -File uninstall.ps1
# The wallpaper engine is a "no-registration" install (file copy + Startup
# shortcut). It never writes the registry, so removing these 4 locations is
# the complete uninstall.
# ============================================================================
$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "=============================================="
Write-Host " SalesWallpaperEngine complete uninstall"
Write-Host "=============================================="

# ---- 1. Stop all running processes --------------------------------
Write-Host ""
Write-Host "[1/5] Stopping SalesWallpaperEngine processes ..."
Get-Process SalesWallpaperEngine -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$still = Get-Process SalesWallpaperEngine -ErrorAction SilentlyContinue
if ($still) {
    Write-Host "WARNING: some processes could not be stopped:"
    $still | Select-Object Id, ProcessName | Format-Table
    Write-Host "Close the wallpaper manually (tray icon -> Exit), then re-run this script."
    Read-Host "Press Enter to continue anyway"
} else {
    Write-Host "All processes stopped."
}

# ---- 2. Install directory ------------------------------------------
$installDir = Join-Path $env:LOCALAPPDATA "SalesWallpaperEngine"
Write-Host ""
Write-Host "[2/5] Removing install directory: $installDir"
if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  removed."
} else {
    Write-Host "  not present (skipped)."
}

# ---- 3. User data (config / key / logs / WebView2 cache) -----------
$dataDir = Join-Path $env:APPDATA "sales-wallpaper-engine"
Write-Host ""
Write-Host "[3/5] Removing user data directory: $dataDir"
if (Test-Path -LiteralPath $dataDir) {
    Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  removed."
} else {
    Write-Host "  not present (skipped)."
}

# ---- 4. Startup shortcut -------------------------------------------
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$shortcut = Join-Path $startupDir "Sales Wallpaper Engine.lnk"
Write-Host ""
Write-Host "[4/5] Removing startup shortcut: $shortcut"
if (Test-Path -LiteralPath $shortcut) {
    Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
    Write-Host "  removed."
} else {
    Write-Host "  not present (skipped)."
}

# ---- 5. Registry residue check (should be nothing) -----------------
Write-Host ""
Write-Host "[5/5] Checking registry residue (HKCU Run) ..."
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$value = (Get-ItemProperty -Path $runKey -Name "SalesWallpaperEngine" -ErrorAction SilentlyContinue)."SalesWallpaperEngine"
if ($value) {
    Remove-ItemProperty -Path $runKey -Name "SalesWallpaperEngine" -ErrorAction SilentlyContinue
    Write-Host "  removed HKCU Run value (was: $value)"
} else {
    Write-Host "  no registry residue found."
}

# ---- Optional: leftover temp update folders ------------------------
$tempBase = Join-Path $env:TEMP "SalesWallpaperEngineUpdate-*"
Get-ChildItem -Path $env:TEMP -Directory -Filter "SalesWallpaperEngineUpdate-*" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=============================================="
Write-Host " Uninstall finished. The wallpaper engine is"
Write-Host " fully removed from this Windows user account."
Write-Host "=============================================="
Write-Host ""
Write-Host "NOTE: SalesDesktop (销售管理系统) is a SEPARATE program"
Write-Host "installed by its own NSIS installer. To remove it, use"
Write-Host "Windows Settings -> Apps -> 销售管理系统 -> Uninstall."
Write-Host ""
