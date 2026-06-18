param(
    [string]$Version = "0.1.5",
    [string]$IncludeKeyPath = "",
    [switch]$NoInstaller,
    [switch]$SkipWallpaperAssets
)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build.ps1") `
    -Version $Version `
    -IncludeKeyPath $IncludeKeyPath `
    -NoInstaller:$NoInstaller `
    -SkipWallpaperAssets:$SkipWallpaperAssets
