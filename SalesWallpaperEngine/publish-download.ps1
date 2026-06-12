param(
    [string]$Version = "0.1.0",
    [switch]$SkipWallpaperAssets
)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build.ps1") -Version $Version -SkipWallpaperAssets:$SkipWallpaperAssets
