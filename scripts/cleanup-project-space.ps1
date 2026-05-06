param(
    [switch]$Apply,
    [int]$MinSizeMB = 50,
    [int]$KeepDesktopVersions = 3
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$minBytes = [int64]$MinSizeMB * 1MB

function Assert-InRepo {
    param([string]$Path)
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if (-not $resolved.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "refuse to clean outside repo: $resolved"
    }
    return $resolved
}

function Get-DirectorySize {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $sum = 0L
    Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
        $sum += $_.Length
    }
    return $sum
}

$candidates = New-Object System.Collections.Generic.List[object]

foreach ($dirName in @(".pytest_cache", ".ruff_cache", ".mypy_cache", ".playwright-mcp", ".omo")) {
    $path = Join-Path $repoRoot $dirName
    if (Test-Path -LiteralPath $path -PathType Container) {
        $size = Get-DirectorySize $path
        if ($size -ge $minBytes) {
            $candidates.Add([PSCustomObject]@{
                Type = "cacheDirectory"
                Path = $path
                SizeMB = [math]::Round($size / 1MB, 2)
                Reason = "local cache, safe to recreate"
            }) | Out-Null
        }
    }
}

$releaseBuild = Join-Path $repoRoot "SalesDesktop\release_build"
if (Test-Path -LiteralPath $releaseBuild -PathType Container) {
    $installers = Get-ChildItem -LiteralPath $releaseBuild -Filter "SalesDesktop Setup *.exe" -File | ForEach-Object {
        if ($_.BaseName -match "^SalesDesktop Setup (?<version>\d+(?:\.\d+){1,3})$") {
            [PSCustomObject]@{ File = $_; Version = [version]$Matches.version }
        }
    } | Sort-Object Version -Descending
    $keep = @($installers | Select-Object -First $KeepDesktopVersions | ForEach-Object { $_.File.Name })
    foreach ($item in @($installers | Select-Object -Skip $KeepDesktopVersions)) {
        foreach ($path in @($item.File.FullName, "$($item.File.FullName).blockmap")) {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $file = Get-Item -LiteralPath $path
                if ($file.Length -ge $minBytes) {
                    $candidates.Add([PSCustomObject]@{
                        Type = "oldDesktopArtifact"
                        Path = $file.FullName
                        SizeMB = [math]::Round($file.Length / 1MB, 2)
                        Reason = "older than retained desktop versions: $($keep -join ', ')"
                    }) | Out-Null
                }
            }
        }
    }
}

$download = Join-Path $repoRoot "SalesDesktop\download"
if (Test-Path -LiteralPath $download -PathType Container) {
    $downloadInstallers = Get-ChildItem -LiteralPath $download -Filter "SalesDesktop Setup *.exe" -File | ForEach-Object {
        if ($_.BaseName -match "^SalesDesktop Setup (?<version>\d+(?:\.\d+){1,3})$") {
            [PSCustomObject]@{ File = $_; Version = [version]$Matches.version }
        }
    } | Sort-Object Version -Descending
    foreach ($item in @($downloadInstallers | Select-Object -Skip $KeepDesktopVersions)) {
        foreach ($path in @($item.File.FullName, "$($item.File.FullName).blockmap")) {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                $file = Get-Item -LiteralPath $path
                if ($file.Length -ge $minBytes) {
                    $candidates.Add([PSCustomObject]@{
                        Type = "oldDownloadArtifact"
                        Path = $file.FullName
                        SizeMB = [math]::Round($file.Length / 1MB, 2)
                        Reason = "older than retained public updater versions"
                    }) | Out-Null
                }
            }
        }
    }
}

$removed = New-Object System.Collections.Generic.List[object]
if ($Apply) {
    foreach ($candidate in $candidates) {
        $target = Assert-InRepo $candidate.Path
        if (Test-Path -LiteralPath $target -PathType Container) {
            Remove-Item -LiteralPath $target -Recurse -Force
        } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
            Remove-Item -LiteralPath $target -Force
        }
        $removed.Add($candidate) | Out-Null
    }
}

[PSCustomObject]@{
    Status = if ($Apply) { "applied" } else { "dry_run" }
    RepoRoot = $repoRoot
    MinSizeMB = $MinSizeMB
    KeepDesktopVersions = $KeepDesktopVersions
    CandidateCount = $candidates.Count
    CandidateSizeMB = [math]::Round((($candidates | Measure-Object -Property SizeMB -Sum).Sum), 2)
    RemovedCount = $removed.Count
    Candidates = $candidates
} | ConvertTo-Json -Depth 5
