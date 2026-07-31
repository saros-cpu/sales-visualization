param(
    [string]$Version = "",
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$downloadRoot = Join-Path $repoRoot "SalesDesktop\download"
$packagePath = Join-Path $repoRoot "SalesDesktop\package.json"

function Get-InstallerVersion {
    param([string]$Name)
    if ($Name -match "^SalesDesktop Setup (?<version>\d+(?:\.\d+){1,3})\.exe$") {
        return [version]$Matches.version
    }
    return $null
}

function Get-Sha512Base64 {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA512]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            return [Convert]::ToBase64String($sha.ComputeHash($stream))
        } finally {
            $stream.Dispose()
        }
    } finally {
        $sha.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $downloadRoot -PathType Container)) {
    throw "download root not found: $downloadRoot"
}

$installers = Get-ChildItem -LiteralPath $downloadRoot -Filter "SalesDesktop Setup *.exe" -File | ForEach-Object {
    $parsed = Get-InstallerVersion $_.Name
    if ($parsed) {
        [PSCustomObject]@{ File = $_; Version = $parsed }
    }
} | Sort-Object Version -Descending

if (-not $installers) {
    throw "no retained desktop installers found in $downloadRoot"
}

if ($Version) {
    $targetVersion = [version]$Version
    $target = $installers | Where-Object { $_.Version -eq $targetVersion } | Select-Object -First 1
} else {
    $package = Get-Content $packagePath -Encoding utf8 | ConvertFrom-Json
    $currentVersion = [version]([string]$package.version)
    $target = $installers | Where-Object { $_.Version -lt $currentVersion } | Select-Object -First 1
}

if (-not $target) {
    throw "no rollback target found"
}

$installerPath = $target.File.FullName
$blockmapPath = "$installerPath.blockmap"
if (-not (Test-Path -LiteralPath $blockmapPath -PathType Leaf)) {
    throw "blockmap not found for rollback target: $blockmapPath"
}

$installerName = $target.File.Name
$size = $target.File.Length
$sha512 = Get-Sha512Base64 $installerPath
$releaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$yaml = @"
version: $($target.Version.ToString())
files:
  - url: $installerName
    sha512: $sha512
    size: $size
    path: $installerName
    releaseDate: '$releaseDate'
"@

$latestPath = Join-Path $downloadRoot "latest.yml"
if ($Apply) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($latestPath, $yaml, $utf8NoBom)
}

[PSCustomObject]@{
    Status = if ($Apply) { "applied" } else { "dry_run" }
    TargetVersion = $target.Version.ToString()
    Installer = $installerPath
    Blockmap = $blockmapPath
    LatestYml = $latestPath
    LatestYmlPreview = $yaml
} | ConvertTo-Json -Depth 4
