param(
    [string]$Version = "0.1.0",
    [switch]$SkipWallpaperAssets,
    [switch]$NoPublishDownload
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopDir = Join-Path $repoRoot "SalesDesktop"
$distWallpaper = Join-Path $desktopDir "dist-wallpaper"
$wwwroot = Join-Path $PSScriptRoot "wwwroot"
$publishRoot = Join-Path $PSScriptRoot "publish"
$appOut = Join-Path $publishRoot "app"
$zipPath = Join-Path $publishRoot ("SalesWallpaperEngine-{0}.zip" -f $Version)
$downloadDir = Join-Path $desktopDir "download\wallpaper-engine"
$publicBase = "http://198.51.100.10/download/wallpaper-engine"

if (-not $SkipWallpaperAssets) {
    Push-Location $desktopDir
    try {
        npm run wallpaper:assets
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $distWallpaper "wallpaper.html"))) {
    throw "Wallpaper assets not found: $distWallpaper"
}

if (Test-Path $wwwroot) {
    $resolved = (Resolve-Path $wwwroot).Path
    if (-not $resolved.StartsWith($PSScriptRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear unexpected wwwroot: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $wwwroot | Out-Null
Copy-Item -Path (Join-Path $distWallpaper "*") -Destination $wwwroot -Recurse -Force

$htmlPath = Join-Path $wwwroot "wallpaper.html"
$html = Get-Content -Raw -Path $htmlPath
if ($html -notmatch "config\.js") {
    $configTag = "    <script src=`"./config.js`"></script>`r`n"
    $moduleIndex = $html.IndexOf("<script type=`"module`"", [StringComparison]::OrdinalIgnoreCase)
    if ($moduleIndex -ge 0) {
        $html = $html.Insert($moduleIndex, $configTag)
    } else {
        $html = $html -replace "</head>", ($configTag + "  </head>")
    }
    Set-Content -Path $htmlPath -Value $html -Encoding UTF8
}

$fallbackConfig = @"
(function () {
  const origin = window.location.origin || "http://127.0.0.1";
  window.SALES_RUNTIME_CONFIG = {
    apiHost: origin,
    wallpaperToken: "",
    safeArea: { left: 0, top: 0, right: 0, bottom: 0 },
    lively: {
      packageId: "kg.example.sales.wallpaper.engine",
      packageVersion: "$Version",
      updateManifestUrl: origin + "/download/wallpaper-engine/latest.json",
      refreshSeconds: 1800
    }
  };
  Object.defineProperty(window, "__SALES_API_HOST__", {
    value: origin,
    configurable: true
  });
  window.SALES_WALLPAPER_KEY_STATUS = {
    state: "missing",
    message: "SalesWallpaperEngine runtime config is not loaded",
    source: "config.js"
  };
  window.SALES_WALLPAPER_KEY_READY = Promise.resolve();
  window.wallpaperAPI = {
    setInteractive: () => Promise.resolve(true),
    reload: () => {
      window.dispatchEvent(new Event("sales-wallpaper-refresh"));
      return Promise.resolve(true);
    },
    ready: () => Promise.resolve(true)
  };
})();
"@
Set-Content -Path (Join-Path $wwwroot "config.js") -Value $fallbackConfig -Encoding UTF8

if (Test-Path $appOut) {
    $resolvedAppOut = (Resolve-Path $appOut).Path
    if (-not $resolvedAppOut.StartsWith($publishRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear unexpected publish output: $resolvedAppOut"
    }
    Remove-Item -LiteralPath $resolvedAppOut -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $publishRoot | Out-Null

dotnet publish (Join-Path $PSScriptRoot "SalesWallpaperEngine.csproj") `
    -c Release `
    -r win-x64 `
    --self-contained false `
    -p:Version=$Version `
    -p:AssemblyVersion=$Version `
    -p:FileVersion=$Version `
    -o $appOut

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $appOut "*") -DestinationPath $zipPath -Force

$hash = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash.ToLowerInvariant()
$size = (Get-Item $zipPath).Length

if (-not $NoPublishDownload) {
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    Copy-Item -Path $zipPath -Destination (Join-Path $downloadDir (Split-Path $zipPath -Leaf)) -Force
    $manifest = [ordered]@{
        version = $Version
        url = "$publicBase/$(Split-Path $zipPath -Leaf)"
        size = $size
        sha256 = $hash
        package = "SalesWallpaperEngine"
        notes = @(
            "SalesWallpaperNative retired and replaced by a new host/player engine.",
            "Uses a local loopback proxy for wallpaper map data and a Lively-style desktop attach path.",
            "Forwards global mouse position into the WebView canvas so station hover works behind desktop icons.",
            "Hides the in-page wallpaper settings button when running in SalesWallpaperEngine.",
            "Compacts the tray menu and shortens the displayed version label.",
            "Adds authorized year/month retail volume and sales amount HUD.",
            "Colors per-fuel inventory rows by capacity fill level without changing station status colors.",
            "Adds tray-driven package update install and Windows taskbar safe-area placement.",
            "Wallpaper updates are independent from the main SalesDesktop client version."
        )
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText(
        (Join-Path $downloadDir "latest.json"),
        $manifestJson,
        [System.Text.UTF8Encoding]::new($false)
    )
}

Write-Host "Built $zipPath"
Write-Host "SHA256 $hash"
