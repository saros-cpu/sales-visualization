param(
    [string]$Installer = "",
    [string]$ReferenceInstaller = "",
    [string]$Version = "",
    [string]$SevenZipPath = "",
    [switch]$KeepExtracted
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DesktopDir = Join-Path $RepoRoot "SalesDesktop"
$TempRoots = New-Object System.Collections.Generic.List[string]

function Resolve-SevenZip {
    param([string]$Requested)
    $candidates = @(
        $Requested,
        $env:SALES_7Z,
        "7z",
        "C:\Program Files\7-Zip\7z.exe",
        "C:\Program Files (x86)\7-Zip\7z.exe"
    ) | Where-Object { $_ -and $_.Trim() }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Source
        }
    }
    throw "7-Zip executable not found. Set SALES_7Z or install 7-Zip."
}

function Invoke-SevenZip {
    param([string[]]$Arguments)
    & $script:SevenZip @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "7-Zip failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
}

function Resolve-Installer {
    param([string]$Requested, [string]$ResolvedVersion)
    if ($Requested) {
        if (-not (Test-Path -LiteralPath $Requested -PathType Leaf)) {
            throw "installer not found: $Requested"
        }
        return (Resolve-Path -LiteralPath $Requested).Path
    }
    $downloadPath = Join-Path $DesktopDir "download\SalesDesktop Setup $ResolvedVersion.exe"
    if (Test-Path -LiteralPath $downloadPath -PathType Leaf) {
        return (Resolve-Path -LiteralPath $downloadPath).Path
    }
    $releasePath = Join-Path $DesktopDir "release_build\SalesDesktop Setup $ResolvedVersion.exe"
    if (Test-Path -LiteralPath $releasePath -PathType Leaf) {
        return (Resolve-Path -LiteralPath $releasePath).Path
    }
    throw "installer for version $ResolvedVersion not found in SalesDesktop/download or SalesDesktop/release_build"
}

function Resolve-ReferenceInstaller {
    param([string]$Requested)
    if ($Requested) {
        if (-not (Test-Path -LiteralPath $Requested -PathType Leaf)) {
            throw "reference installer not found: $Requested"
        }
        return (Resolve-Path -LiteralPath $Requested).Path
    }
    $candidates = @(
        (Join-Path $DesktopDir "release_build\SalesDesktop Setup 3.9.17.exe"),
        (Join-Path $DesktopDir "download\SalesDesktop Setup 3.9.17.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "reference installer SalesDesktop Setup 3.9.17.exe not found"
}

function Expand-DesktopInstaller {
    param([string]$Path, [string]$Label)
    $tempRoot = Join-Path $env:TEMP ("sales-desktop-installer-audit-{0}-{1}" -f $Label, [guid]::NewGuid().ToString("N"))
    $outer = Join-Path $tempRoot "outer"
    $app = Join-Path $tempRoot "app"
    New-Item -ItemType Directory -Force -Path $outer, $app | Out-Null
    $TempRoots.Add($tempRoot) | Out-Null

    try {
        Invoke-SevenZip @("x", $Path, "-o$app", "-y")
    } catch {
        Write-Host "  Direct installer extraction failed for ${Label}; trying legacy NSIS inner archive..."
    }
    if (Test-Path -LiteralPath (Join-Path $app "resources\app.asar") -PathType Leaf) {
        return [PSCustomObject]@{
            Label = $Label
            Installer = $Path
            Root = $tempRoot
            App = $app
        }
    }

    if (Test-Path -LiteralPath $app) {
        Remove-Item -LiteralPath $app -Recurse -Force
        New-Item -ItemType Directory -Force -Path $app | Out-Null
    }
    Invoke-SevenZip @("x", $Path, '$PLUGINSDIR\app-64.7z', "-o$outer", "-y")
    $inner = Get-ChildItem -Path $outer -Filter "app-64.7z" -Recurse -File | Select-Object -First 1
    if (-not $inner) {
        throw "$Label installer does not contain resources\app.asar or `$PLUGINSDIR\app-64.7z"
    }
    Invoke-SevenZip @("x", $inner.FullName, "-o$app", "-y")
    return [PSCustomObject]@{
        Label = $Label
        Installer = $Path
        Root = $tempRoot
        App = $app
    }
}

function Get-AsarSummary {
    param([string]$AsarPath)
    $nodeScript = @'
const path = require("path");
const desktopDir = process.env.SALES_DESKTOP_DIR;
const asarPath = process.env.SALES_AUDIT_ASAR;
const asar = require(path.join(desktopDir, "node_modules", "@electron", "asar"));

function clean(p) {
  return String(p || "").replace(/^\\/, "").replace(/\\/g, "/");
}
function exists(files, p) {
  return files.has(clean(p));
}
function statSize(p) {
  try {
    return asar.statFile(asarPath, clean(p).replace(/\//g, "\\")).size || 0;
  } catch {
    return 0;
  }
}
function textFile(p) {
  try {
    return asar.extractFile(asarPath, clean(p).replace(/\//g, "\\")).toString("utf8");
  } catch {
    return "";
  }
}

const files = asar.listPackage(asarPath).map(clean);
const fileSet = new Set(files);
const packageText = textFile("package.json");
const packageJson = packageText ? JSON.parse(packageText) : {};
const indexText = textFile("dist/index.html");
const refs = Array.from(indexText.matchAll(/(?:src|href)=["']([^"']+)["']/g))
  .map((m) => m[1])
  .filter((ref) => ref && !/^https?:/i.test(ref))
  .map((ref) => {
    const normalized = clean(ref).replace(/^\.\//, "");
    return normalized.startsWith("/") ? `dist${normalized}` : `dist/${normalized}`;
  })
  .filter((ref) => ref.startsWith("dist/"));
const uniqueRefs = Array.from(new Set(refs));
const missingRefs = uniqueRefs.filter((ref) => !exists(fileSet, ref));
const jsFiles = files.filter((file) => /^dist\/assets\/.*\.js$/.test(file));
const cssFiles = files.filter((file) => /^dist\/assets\/.*\.css$/.test(file));
const mapFiles = files.filter((file) => /^dist\/kgz-map\/data\//.test(file));
const requiredFiles = [
  "package.json",
  "electron/main.cjs",
  "electron/preload.cjs",
  "dist/index.html",
  "dist/kgz-map/data/business_points.json",
  "dist/kgz-map/data/kgz_regions.json",
  "dist/kgz-map/Kgz3DMap.js",
  "dist/kgz-map/kgz-map.css"
];
const required = {};
for (const file of requiredFiles) {
  required[file] = exists(fileSet, file);
}
const jsTotalBytes = jsFiles.reduce((sum, file) => sum + statSize(file), 0);
const cssTotalBytes = cssFiles.reduce((sum, file) => sum + statSize(file), 0);

console.log(JSON.stringify({
  packageName: packageJson.name || "",
  packageVersion: packageJson.version || "",
  packageMain: packageJson.main || "",
  fileCount: files.length,
  required,
  jsCount: jsFiles.length,
  cssCount: cssFiles.length,
  mapDataCount: mapFiles.length,
  referencedAssetCount: uniqueRefs.length,
  missingReferencedAssets: missingRefs,
  jsTotalBytes,
  cssTotalBytes,
  indexBytes: statSize("dist/index.html"),
  mainBytes: statSize("electron/main.cjs"),
  packageBytes: statSize("package.json")
}, null, 2));
'@
    $previousAsar = $env:SALES_AUDIT_ASAR
    $previousDesktop = $env:SALES_DESKTOP_DIR
    try {
        $env:SALES_AUDIT_ASAR = $AsarPath
        $env:SALES_DESKTOP_DIR = $DesktopDir
        $json = $nodeScript | node -
        if ($LASTEXITCODE -ne 0) {
            throw "node asar audit failed with exit code $LASTEXITCODE"
        }
        return $json | ConvertFrom-Json
    } finally {
        $env:SALES_AUDIT_ASAR = $previousAsar
        $env:SALES_DESKTOP_DIR = $previousDesktop
    }
}

function Get-InstallTreeSummary {
    param([object]$Expanded)
    $exe = Join-Path $Expanded.App "SalesDesktop.exe"
    $wrongExe = Join-Path $Expanded.App "electron.exe"
    $asarPath = Join-Path $Expanded.App "resources\app.asar"
    $appUpdate = Join-Path $Expanded.App "resources\app-update.yml"
    return [PSCustomObject]@{
        Label = $Expanded.Label
        Installer = $Expanded.Installer
        InstallerBytes = (Get-Item -LiteralPath $Expanded.Installer).Length
        AppRoot = $Expanded.App
        SalesDesktopExe = $exe
        SalesDesktopExeBytes = if (Test-Path -LiteralPath $exe -PathType Leaf) { (Get-Item -LiteralPath $exe).Length } else { 0 }
        HasWrongElectronExe = Test-Path -LiteralPath $wrongExe -PathType Leaf
        AppAsar = $asarPath
        AppAsarBytes = if (Test-Path -LiteralPath $asarPath -PathType Leaf) { (Get-Item -LiteralPath $asarPath).Length } else { 0 }
        AppUpdate = $appUpdate
        AppUpdateBytes = if (Test-Path -LiteralPath $appUpdate -PathType Leaf) { (Get-Item -LiteralPath $appUpdate).Length } else { 0 }
        Asar = if (Test-Path -LiteralPath $asarPath -PathType Leaf) { Get-AsarSummary $asarPath } else { $null }
    }
}

function Assert-DesktopPackage {
    param([object]$Current, [object]$Reference, [string]$ExpectedVersion)
    $errors = New-Object System.Collections.Generic.List[string]
    if ($Current.SalesDesktopExeBytes -le 0) { $errors.Add("missing SalesDesktop.exe") | Out-Null }
    if ($Current.HasWrongElectronExe) { $errors.Add("top-level electron.exe exists; installer should ship SalesDesktop.exe") | Out-Null }
    if ($Current.AppAsarBytes -le 0) { $errors.Add("missing resources\app.asar") | Out-Null }
    if ($Current.AppUpdateBytes -le 0) { $errors.Add("missing resources\app-update.yml") | Out-Null }
    if (-not $Current.Asar) {
        $errors.Add("app.asar could not be inspected") | Out-Null
    } else {
        foreach ($prop in $Current.Asar.required.PSObject.Properties) {
            if (-not [bool]$prop.Value) {
                $errors.Add("app.asar missing $($prop.Name)") | Out-Null
            }
        }
        if ($ExpectedVersion -and $Current.Asar.packageVersion -ne $ExpectedVersion) {
            $errors.Add("app.asar package.json version $($Current.Asar.packageVersion) != $ExpectedVersion") | Out-Null
        }
        if ($Current.Asar.packageMain -ne "electron/main.cjs") {
            $errors.Add("app.asar package main is $($Current.Asar.packageMain), expected electron/main.cjs") | Out-Null
        }
        if ($Current.Asar.missingReferencedAssets.Count -gt 0) {
            $errors.Add("dist/index.html references missing assets: $($Current.Asar.missingReferencedAssets -join ', ')") | Out-Null
        }
        if ($Current.Asar.jsCount -lt 20) { $errors.Add("too few dist JS chunks: $($Current.Asar.jsCount)") | Out-Null }
        if ($Current.Asar.cssCount -lt 1) { $errors.Add("no dist CSS chunks") | Out-Null }
        if ($Current.Asar.mapDataCount -lt 6) { $errors.Add("too few kgz-map data files: $($Current.Asar.mapDataCount)") | Out-Null }
        if ($Current.Asar.jsTotalBytes -lt 1000000) { $errors.Add("dist JS total is suspiciously small: $($Current.Asar.jsTotalBytes)") | Out-Null }
    }

    if ($Reference) {
        if ($Current.AppAsarBytes -lt [int64]($Reference.AppAsarBytes * 0.85)) {
            $errors.Add("app.asar is more than 15% smaller than reference 3.9.17 package") | Out-Null
        }
        if ($Current.SalesDesktopExeBytes -lt [int64]($Reference.SalesDesktopExeBytes * 0.85)) {
            $errors.Add("SalesDesktop.exe is more than 15% smaller than reference 3.9.17 package") | Out-Null
        }
        if ($Current.Asar -and $Reference.Asar) {
            if ($Current.Asar.jsCount -lt [int]([math]::Floor($Reference.Asar.jsCount * 0.80))) {
                $errors.Add("dist JS chunk count is much lower than 3.9.17 reference: $($Current.Asar.jsCount) vs $($Reference.Asar.jsCount)") | Out-Null
            }
            if ($Current.Asar.mapDataCount -lt $Reference.Asar.mapDataCount) {
                $errors.Add("kgz-map data file count is lower than 3.9.17 reference: $($Current.Asar.mapDataCount) vs $($Reference.Asar.mapDataCount)") | Out-Null
            }
        }
    }

    if ($errors.Count -gt 0) {
        throw "Desktop installer audit failed:`n - $($errors -join "`n - ")"
    }
}

try {
    $script:SevenZip = Resolve-SevenZip $SevenZipPath
    if (-not $Version) {
        $Version = [string]((Get-Content (Join-Path $DesktopDir "package.json") -Encoding utf8 | ConvertFrom-Json).version)
    }
    $installerPath = Resolve-Installer $Installer $Version
    $referencePath = Resolve-ReferenceInstaller $ReferenceInstaller
    Write-Host "Auditing desktop installer: $installerPath"
    Write-Host "Reference installer: $referencePath"

    $currentExpanded = Expand-DesktopInstaller $installerPath "current"
    $referenceExpanded = Expand-DesktopInstaller $referencePath "reference-3.9.17"
    $current = Get-InstallTreeSummary $currentExpanded
    $reference = Get-InstallTreeSummary $referenceExpanded
    Assert-DesktopPackage $current $reference $Version

    Write-Host "Desktop installer audit passed." -ForegroundColor Green
    Write-Host (" - installer bytes: {0}" -f $current.InstallerBytes)
    Write-Host (" - SalesDesktop.exe bytes: {0}" -f $current.SalesDesktopExeBytes)
    Write-Host (" - app.asar bytes: {0}" -f $current.AppAsarBytes)
    Write-Host (" - JS/CSS/map data: {0}/{1}/{2}" -f $current.Asar.jsCount, $current.Asar.cssCount, $current.Asar.mapDataCount)
    Write-Host (" - referenced assets: {0}, missing: 0" -f $current.Asar.referencedAssetCount)
} finally {
    if (-not $KeepExtracted) {
        foreach ($root in $TempRoots) {
            if (Test-Path -LiteralPath $root) {
                Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    } elseif ($TempRoots.Count -gt 0) {
        Write-Host "Kept extracted audit directories:"
        $TempRoots | ForEach-Object { Write-Host " - $_" }
    }
}
