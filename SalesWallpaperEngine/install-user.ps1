param(
    [string]$InstallDir = "$env:LOCALAPPDATA\SalesWallpaperEngine",
    [string]$ManifestUrl = "",
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

function Stop-Engine {
    Get-Process SalesWallpaperEngine -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Install-FromFolder {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$TargetDir
    )

    $source = (Resolve-Path $SourceDir).Path
    if (-not (Test-Path (Join-Path $source "SalesWallpaperEngine.exe"))) {
        throw "SalesWallpaperEngine.exe not found in $source"
    }

    Stop-Engine
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    Copy-Item -Path (Join-Path $source "*") -Destination $TargetDir -Recurse -Force

    $shell = New-Object -ComObject WScript.Shell
    $startup = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startup "Sales Wallpaper Engine.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $TargetDir "SalesWallpaperEngine.exe"
    $shortcut.WorkingDirectory = $TargetDir
    $shortcut.IconLocation = Join-Path $TargetDir "SalesWallpaperEngine.exe"
    $shortcut.Save()

    if (-not $NoStart) {
        Start-Process -FilePath (Join-Path $TargetDir "SalesWallpaperEngine.exe") -WorkingDirectory $TargetDir -WindowStyle Hidden
    }

    Write-Host "Installed SalesWallpaperEngine to $TargetDir"
}

if ($ManifestUrl) {
    $manifest = Invoke-RestMethod -UseBasicParsing -Uri ($ManifestUrl + ($(if ($ManifestUrl.Contains("?")) { "&" } else { "?" }) + "t=" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))
    $data = if ($manifest.data) { $manifest.data } else { $manifest }
    if (-not $data.url) {
        throw "Manifest does not contain url: $ManifestUrl"
    }
    $tempRoot = Join-Path $env:TEMP ("SalesWallpaperEngine-" + [Guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $tempRoot "package.zip"
    $extractDir = Join-Path $tempRoot "extract"
    New-Item -ItemType Directory -Force -Path $tempRoot, $extractDir | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $data.url -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    Install-FromFolder -SourceDir $extractDir -TargetDir $InstallDir
    return
}

Install-FromFolder -SourceDir $PSScriptRoot -TargetDir $InstallDir
