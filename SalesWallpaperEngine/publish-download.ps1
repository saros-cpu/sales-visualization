param(
    [string]$Version = "0.2.3",
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
