param(
    [switch]$SkipFrontendBuild,
    [switch]$SkipDesktopTypecheck,
    [string]$ExternalBaseUrl = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PythonExe = if ($env:SALES_PYTHON) { $env:SALES_PYTHON } else { "python" }
$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

function Invoke-Check {
    param(
        [string]$Name,
        [scriptblock]$Body,
        [switch]$WarnOnly
    )
    Write-Host "== $Name"
    try {
        & $Body
        Write-Host "OK: $Name" -ForegroundColor Green
    } catch {
        $message = "${Name}: $($_.Exception.Message)"
        if ($WarnOnly) {
            $Warnings.Add($message) | Out-Null
            Write-Host "WARN: $message" -ForegroundColor Yellow
        } else {
            $Failures.Add($message) | Out-Null
            Write-Host "FAIL: $message" -ForegroundColor Red
        }
    }
}

function Invoke-External {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($exitCode -ne 0) {
        throw "$FilePath exited with code $exitCode"
    }
}

Invoke-Check "Sensitive docs are ignored by git" {
    $tracked = & git -C $RepoRoot ls-files -- "docs/*.md"
    if ($LASTEXITCODE -ne 0) {
        throw "git ls-files failed"
    }
    if ($tracked) {
        throw "Sensitive project docs are still tracked: $($tracked -join ', ')"
    }
}

Invoke-Check "Python syntax compile" {
    $files = @(
        "Sales/api.py",
        "Sales/api_v2/system.py",
        "Sales/api_v2/knowledge.py",
        "Sales/api_v2/permission_service.py",
        "OilStation/scripts/generate_accounting_handover_reports.py",
        "OilStation/scripts/refresh_current_snapshots.py",
        "Sales/scripts/compare_retail_snapshot_db.py",
        "scripts/late_retail_data_maintenance.py",
        "scripts/audit_retail_density_mass.py"
    )
    Invoke-External $PythonExe (@("-m", "py_compile") + $files) $RepoRoot
}

Invoke-Check "Python unit tests" {
    Invoke-External $PythonExe @("-m", "unittest", "discover", "-s", "Sales/tests") $RepoRoot
}

Invoke-Check "Assistant project coverage" {
    Invoke-External "powershell" @("-ExecutionPolicy", "Bypass", "-File", ".\scripts\assistant-coverage.ps1") $RepoRoot
}

Invoke-Check "Retail density/mass snapshots" {
    $activeMonth = (Get-Date).ToString("yyyy-MM")
    Invoke-External "powershell" @("-ExecutionPolicy", "Bypass", "-File", ".\scripts\audit-retail-density-mass.ps1", "-Start", $activeMonth, "-FailOnIssue") $RepoRoot
}

if (-not $SkipDesktopTypecheck) {
    Invoke-Check "Desktop TypeScript check" {
        Invoke-External "npm" @("run", "typecheck") (Join-Path $RepoRoot "SalesDesktop")
    }

    Invoke-Check "Desktop unit tests" {
        Invoke-External "npm" @("test") (Join-Path $RepoRoot "SalesDesktop")
    }
}

if (-not $SkipFrontendBuild) {
    Invoke-Check "Web frontend unit tests" {
        Invoke-External "npm" @("test") (Join-Path $RepoRoot "frontend")
    }

    Invoke-Check "Web frontend build" {
        Invoke-External "npm" @("run", "build") (Join-Path $RepoRoot "frontend")
    }
}

Invoke-Check "Desktop updater package files" {
    $package = Get-Content (Join-Path $RepoRoot "SalesDesktop/package.json") -Encoding utf8 | ConvertFrom-Json
    $version = [string]$package.version
    if (-not $version) {
        throw "SalesDesktop package version is empty"
    }
    $downloadRoot = Join-Path $RepoRoot "SalesDesktop/download"
    $latestPath = Join-Path $downloadRoot "latest.yml"
    $installer = Join-Path $downloadRoot "SalesDesktop Setup $version.exe"
    $blockmap = "$installer.blockmap"
    foreach ($path in @($latestPath, $installer, $blockmap)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "missing $path"
        }
    }
    $latestText = Get-Content $latestPath -Encoding utf8 -Raw
    if ($latestText -notmatch "(?m)^\s*version:\s*$([regex]::Escape($version))\s*$") {
        throw "latest.yml version does not match package.json version $version"
    }
    if ($latestText -notmatch "(?m)^\s*path:\s*SalesDesktop Setup $([regex]::Escape($version))\.exe\s*$") {
        throw "latest.yml path does not match installer name"
    }

    $releaseBuildRoot = Join-Path $RepoRoot "SalesDesktop/release_build"
    if (Test-Path -LiteralPath $releaseBuildRoot -PathType Container) {
        $currentVersion = [version]$version
        $previousInstaller = Get-ChildItem -Path $releaseBuildRoot -Filter "SalesDesktop Setup *.exe" -File | ForEach-Object {
            if ($_.BaseName -match "^SalesDesktop Setup (?<version>\d+(?:\.\d+){1,3})$") {
                [PSCustomObject]@{
                    Name = $_.Name
                    Version = [version]$Matches.version
                }
            }
        } | Where-Object { $_.Version -lt $currentVersion } | Sort-Object Version -Descending | Select-Object -First 1

        if ($previousInstaller) {
            $previousInstallerPath = Join-Path $downloadRoot $previousInstaller.Name
            $previousBlockmapPath = "$previousInstallerPath.blockmap"
            foreach ($path in @($previousInstallerPath, $previousBlockmapPath)) {
                if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                    throw "missing retained previous updater artifact $path"
                }
            }
        }
    }
}

Invoke-Check "Nginx download route shape" {
    $nginxConf = Join-Path $RepoRoot "nginx.conf"
    if (-not (Test-Path -LiteralPath $nginxConf -PathType Leaf)) {
        throw "nginx.conf is missing"
    }
    $text = Get-Content $nginxConf -Encoding utf8 -Raw
    if ($text -notmatch "location\s+/download/") {
        throw "missing /download/ location"
    }
    if ($text -match 'location\s+/download/[\s\S]*?root\s+__PROJECT_ROOT__/SalesDesktop;[\s\S]*?try_files\s+\$uri\s+=404;') {
        return
    }
    throw "/download/ should serve only SalesDesktop/download through try_files"
}

Invoke-Check "HTTP domain defaults" {
    $domain = "http://sales.example.com"
    $runtimeConfig = Get-Content (Join-Path $RepoRoot "SalesDesktop/electron/runtime-config.cjs") -Encoding utf8 -Raw
    $preload = Get-Content (Join-Path $RepoRoot "SalesDesktop/electron/preload.cjs") -Encoding utf8 -Raw
    $builder = Get-Content (Join-Path $RepoRoot "SalesDesktop/electron-builder.yml") -Encoding utf8 -Raw
    $nginxConf = Get-Content (Join-Path $RepoRoot "nginx.conf") -Encoding utf8 -Raw
    if ($runtimeConfig -notmatch [regex]::Escape("const DEFAULT_API_HOST = process.env.SALES_API_HOST || '$domain'")) {
        throw "desktop runtime default API host is not $domain"
    }
    if ($preload -notmatch [regex]::Escape("apiHost: '$domain'")) {
        throw "desktop preload fallback API host is not $domain"
    }
    if ($builder -notmatch [regex]::Escape("url: $domain/download")) {
        throw "electron updater publish URL is not $domain/download"
    }
    if ($nginxConf -match "return\s+301\s+https://") {
        throw "nginx still redirects HTTP domain traffic to HTTPS before SSL is ready"
    }
}

Invoke-Check "CodeGraph local index" -WarnOnly {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".codegraph") -PathType Container)) {
        throw ".codegraph is not initialized on this machine"
    }
    Invoke-External "codegraph" @("status") $RepoRoot
}

if ($ExternalBaseUrl.Trim()) {
    Invoke-Check "External updater endpoints" {
        $base = $ExternalBaseUrl.TrimEnd("/")
        $latest = Invoke-WebRequest -Uri "$base/download/latest.yml" -UseBasicParsing -TimeoutSec 20
        if ($latest.StatusCode -ne 200) {
            throw "latest.yml returned HTTP $($latest.StatusCode)"
        }
        try {
            Invoke-WebRequest -Uri "$base/download/package.json" -UseBasicParsing -TimeoutSec 20 | Out-Null
            throw "package.json should not be public under /download"
        } catch {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) {
                return
            }
            throw
        }
    }
}

Write-Host ""
if ($Warnings.Count -gt 0) {
    Write-Host "Warnings:" -ForegroundColor Yellow
    $Warnings | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
}
if ($Failures.Count -gt 0) {
    Write-Host "Preflight failed:" -ForegroundColor Red
    $Failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "Preflight passed." -ForegroundColor Green
