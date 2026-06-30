param(
    [string]$InstallDir = "$env:LOCALAPPDATA\SalesWallpaperEngine",
    [string]$ManifestUrl = "",
    [string]$PackageZip = "",
    [string]$KeyFile = "",
    [string]$ProtectedKeyFile = "",
    [switch]$DeployBundledKey,
    [switch]$NoStart,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Stop-Engine {
    Get-Process SalesWallpaperEngine -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Deploy-KeyFile {
    param(
        [string]$SourceDir
    )

    if (-not $DeployBundledKey -and -not $KeyFile -and -not $ProtectedKeyFile) {
        return
    }

    $protectedCandidates = @()
    if ($ProtectedKeyFile) {
        $protectedCandidates += $ProtectedKeyFile
    }
    if ($DeployBundledKey) {
        $protectedCandidates += (Join-Path $SourceDir "wallpaper-key.protected.json")
        $protectedCandidates += (Join-Path $PSScriptRoot "wallpaper-key.protected.json")
    }

    $sourceProtectedKey = $protectedCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($sourceProtectedKey) {
        $configDir = Join-Path $env:APPDATA "sales-wallpaper-engine"
        New-Item -ItemType Directory -Force -Path $configDir | Out-Null
        Copy-Item -LiteralPath $sourceProtectedKey -Destination (Join-Path $configDir "wallpaper-key.protected.json") -Force
        Write-Host "Deployed protected wallpaper key to $configDir"
        return
    }

    $candidates = @()
    if ($KeyFile) {
        $candidates += $KeyFile
    }
    if ($DeployBundledKey) {
        $candidates += (Join-Path $SourceDir "wallpaper-key.json")
        $candidates += (Join-Path $PSScriptRoot "wallpaper-key.json")
    }

    $sourceKey = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $sourceKey) {
        Write-Warning "Bundled wallpaper key was requested but not found."
        return
    }

    $configDir = Join-Path $env:APPDATA "sales-wallpaper-engine"
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    Copy-Item -LiteralPath $sourceKey -Destination (Join-Path $configDir "wallpaper-key.json") -Force
    Write-Host "Deployed wallpaper key to $configDir"
}

function Assert-PackageIntegrity {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [long]$ExpectedSize = 0,
        [string]$ExpectedSha256 = ""
    )

    if ($ExpectedSize -gt 0) {
        $actualSize = (Get-Item -LiteralPath $Path).Length
        if ($actualSize -ne $ExpectedSize) {
            throw "Package size mismatch. Expected $ExpectedSize, got $actualSize"
        }
    }

    if ($ExpectedSha256) {
        $actualHash = (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
        $expectedHash = $ExpectedSha256.Trim().ToLowerInvariant()
        if ($actualHash -ne $expectedHash) {
            throw "Package SHA256 mismatch. Expected $expectedHash, got $actualHash"
        }
    }
}

function Show-InstallSummary {
    param(
        [Parameter(Mandatory = $true)][string]$TargetDir,
        [Parameter(Mandatory = $true)][string]$ShortcutPath
    )

    $configDir = Join-Path $env:APPDATA "sales-wallpaper-engine"
    $keyPath = Join-Path $configDir "wallpaper-key.json"
    $protectedKeyPath = Join-Path $configDir "wallpaper-key.protected.json"
    $message = @"
Sales Wallpaper Engine installed.

Program directory:
$TargetDir

Config directory:
$configDir

Key file:
$keyPath

Protected key file:
$protectedKeyPath

Startup shortcut:
$ShortcutPath

Wallpaper has started. Use the tray icon to open config, restart wallpaper, or check updates.
"@
    Write-Host $message
    if ($Quiet) {
        return
    }

    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $message,
            "Sales Wallpaper Engine",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    } catch {
        Write-Warning "Could not show install summary window: $($_.Exception.Message)"
    }
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
    $target = (Resolve-Path $TargetDir).Path
    Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
    Deploy-KeyFile -SourceDir $source

    $shell = New-Object -ComObject WScript.Shell
    $startup = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startup "Sales Wallpaper Engine.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $target "SalesWallpaperEngine.exe"
    $shortcut.WorkingDirectory = $target
    $shortcut.IconLocation = Join-Path $target "SalesWallpaperEngine.exe"
    $shortcut.Save()

    if (-not $NoStart) {
        Start-Process -FilePath (Join-Path $target "SalesWallpaperEngine.exe") -WorkingDirectory $target -WindowStyle Hidden
    }

    Show-InstallSummary -TargetDir $target -ShortcutPath $shortcutPath
}

if ($PackageZip) {
    $zip = (Resolve-Path $PackageZip).Path
    $tempRoot = Join-Path $env:TEMP ("SalesWallpaperEngine-" + [Guid]::NewGuid().ToString("N"))
    $extractDir = Join-Path $tempRoot "extract"
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $extractDir -Force
    Install-FromFolder -SourceDir $extractDir -TargetDir $InstallDir
    return
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
    $expectedSize = 0
    if ($data.size) {
        $expectedSize = [long]$data.size
    }
    $expectedSha256 = ""
    if ($data.sha256) {
        $expectedSha256 = [string]$data.sha256
    }
    Assert-PackageIntegrity -Path $zipPath -ExpectedSize $expectedSize -ExpectedSha256 $expectedSha256
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    Install-FromFolder -SourceDir $extractDir -TargetDir $InstallDir
    return
}

Install-FromFolder -SourceDir $PSScriptRoot -TargetDir $InstallDir
