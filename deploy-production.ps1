# deploy-production.ps1 - Build frontend and deploy Nginx config
# Usage: powershell -ExecutionPolicy Bypass -File deploy-production.ps1

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. "$projectRoot\nginx\config.ps1"
$frontendDir = Join-Path $projectRoot "frontend"
$desktopDir = Join-Path $projectRoot "SalesDesktop"
$desktopDownloadDir = Join-Path $desktopDir "download"
$desktopReleaseBuildDir = Join-Path $desktopDir "release_build"
$desktopUpdateRetention = 5
$confSource = Join-Path $projectRoot "nginx.conf"

Write-Host "====================================="
Write-Host " Production Deployment"
Write-Host "====================================="

# Step 1: Build frontend
Write-Host ""
Write-Host "[1/5] Building frontend (npm run build) ..."
Push-Location $frontendDir
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Frontend build failed!"
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Build complete: $frontendDir\dist\"

# Step 2: Prepare desktop update files
Write-Host "[2/5] Preparing desktop update files ..."
New-Item -ItemType Directory -Force -Path $desktopDownloadDir | Out-Null
$latestCandidates = @(
    (Join-Path $desktopDir "release_build\latest.yml"),
    (Join-Path $desktopDir "latest.yml")
)
$latestSource = $latestCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($latestSource) {
    $latestText = Get-Content $latestSource -Raw
    $installerMatch = [regex]::Match($latestText, "(?m)^path:\s*(.+\.exe)\s*$")
    if (-not $installerMatch.Success) {
        Write-Host "  ERROR: latest.yml does not contain installer path"
        exit 1
    }
    $installerName = $installerMatch.Groups[1].Value.Trim().Trim("'").Trim('"')
    $artifactCandidates = @(
        (Join-Path $desktopDir $installerName),
        (Join-Path $desktopDir "release_build\$installerName")
    )
    $installerSource = $artifactCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $installerSource) {
        Write-Host "  ERROR: Installer not found: $installerName"
        exit 1
    }

    $releaseInstallers = @()
    if (Test-Path $desktopReleaseBuildDir) {
        $releaseInstallers = Get-ChildItem -Path $desktopReleaseBuildDir -Filter "SalesDesktop Setup *.exe" -File | ForEach-Object {
            if ($_.BaseName -match "^SalesDesktop Setup (?<version>\d+(?:\.\d+){1,3})$") {
                [PSCustomObject]@{
                    Name = $_.Name
                    Version = [version]$Matches.version
                    Path = $_.FullName
                }
            }
        }
    }
    $selectedInstallers = @($releaseInstallers | Sort-Object Version -Descending | Select-Object -First $desktopUpdateRetention)
    if (-not ($selectedInstallers | Where-Object { $_.Name -eq $installerName })) {
        $selectedInstallers = @([PSCustomObject]@{
            Name = $installerName
            Version = $null
            Path = $installerSource
        }) + $selectedInstallers
    }
    $selectedInstallers = @($selectedInstallers | Group-Object Name | ForEach-Object { $_.Group[0] })

    $keepNames = New-Object "System.Collections.Generic.HashSet[string]" ([System.StringComparer]::OrdinalIgnoreCase)
    [void]$keepNames.Add("latest.yml")
    foreach ($item in $selectedInstallers) {
        [void]$keepNames.Add($item.Name)
        $sourceBlockmap = "$($item.Path).blockmap"
        if (Test-Path $sourceBlockmap) {
            [void]$keepNames.Add("$($item.Name).blockmap")
        }
    }
    Get-ChildItem -Path $desktopDownloadDir -File | Where-Object {
        ($_.Name -eq "latest.yml" -or $_.Name -like "SalesDesktop Setup *.exe" -or $_.Name -like "SalesDesktop Setup *.exe.blockmap") -and -not $keepNames.Contains($_.Name)
    } | Remove-Item -Force

    Copy-Item $latestSource (Join-Path $desktopDownloadDir "latest.yml") -Force
    foreach ($item in $selectedInstallers) {
        Copy-Item $item.Path (Join-Path $desktopDownloadDir $item.Name) -Force
        $sourceBlockmap = "$($item.Path).blockmap"
        if (Test-Path $sourceBlockmap) {
            Copy-Item $sourceBlockmap (Join-Path $desktopDownloadDir "$($item.Name).blockmap") -Force
        } else {
            Write-Host "  WARNING: Blockmap not found for $($item.Name)"
        }
    }
    Write-Host "  Desktop update files ready: $desktopDownloadDir"
    Write-Host "  Retained desktop updater versions: $($selectedInstallers.Name -join ', ')"
} else {
    Write-Host "  WARNING: latest.yml not found, skipping desktop update file sync"
}

# Step 3: Copy nginx config
Write-Host "[3/5] Deploying nginx.conf ..."
if (-not (Test-Path $confSource)) {
    Write-Host "  ERROR: nginx.conf not found at $confSource"
    exit 1
}
$nginxConfig = (Get-Content $confSource -Raw) -replace "__PROJECT_ROOT__", $projectRoot.Replace("\", "/")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $nginxHome "conf\nginx.conf"), $nginxConfig, $utf8NoBom)
Write-Host "  Config deployed: $nginxHome\conf\nginx.conf (project_root=$projectRoot)"

# Step 4: Test nginx config
Write-Host "[4/5] Testing nginx configuration ..."
Push-Location $nginxHome
.\nginx.exe -t
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Nginx config test failed!"
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Config test passed"

# Step 5: Start or reload nginx
Write-Host "[5/5] Starting Nginx ..."
Push-Location $nginxHome
# Check if nginx is already running
$nginxProcess = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
if ($nginxProcess) {
    Write-Host "  Nginx already running, reloading config ..."
    .\nginx.exe -s reload
    Write-Host "  Nginx reloaded"
} else {
    Start-Process -FilePath ".\nginx.exe" -WindowStyle Hidden
    Start-Sleep -Seconds 1
    $nginxProcess = Get-Process -Name "nginx" -ErrorAction SilentlyContinue
    if ($nginxProcess) {
        Write-Host "  Nginx started successfully (PID: $($nginxProcess[0].Id))"
    } else {
        Write-Host "  WARNING: Nginx may not have started. Check $nginxHome\logs\error.log"
    }
}
Pop-Location

Write-Host ""
Write-Host "====================================="
Write-Host " Deployment complete!"
Write-Host " Access: http://localhost"
Write-Host " API:    http://localhost/api/health"
Write-Host "====================================="
