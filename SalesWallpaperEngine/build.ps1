param(
    [string]$Version = "0.2.3",
    [string]$IncludeKeyPath = "",
    [switch]$PlainBundledKey,
    [switch]$SkipWallpaperAssets,
    [switch]$NoInstaller,
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
$setupPath = Join-Path $publishRoot ("SalesWallpaperEngine-Setup-{0}.exe" -f $Version)
$installerPayload = Join-Path $publishRoot "installer-payload"
$downloadDir = Join-Path $desktopDir "download\wallpaper-engine"
$publicBase = "https://sales.example.com/download/wallpaper-engine"

function Get-Sha256Bytes {
    param([Parameter(Mandatory = $true)][string]$Text)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))
    } finally {
        $sha.Dispose()
    }
}

function Join-Bytes {
    param([byte[][]]$Parts)

    $length = 0
    foreach ($part in $Parts) {
        $length += $part.Length
    }
    $result = New-Object byte[] $length
    $offset = 0
    foreach ($part in $Parts) {
        [System.Buffer]::BlockCopy($part, 0, $result, $offset, $part.Length)
        $offset += $part.Length
    }
    return $result
}

function New-ProtectedWallpaperKeyFile {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    $purpose = "kg.example.sales.wallpaper.engine.protected-key.2026-08"
    $plainBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $SourcePath).Path)
    $iv = New-Object byte[] 16
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($iv)
    } finally {
        $rng.Dispose()
    }

    $aes = [System.Security.Cryptography.Aes]::Create()
    try {
        $aes.Key = Get-Sha256Bytes "${purpose}:enc"
        $aes.IV = $iv
        $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
        $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
        $encryptor = $aes.CreateEncryptor()
        try {
            $cipherBytes = $encryptor.TransformFinalBlock($plainBytes, 0, $plainBytes.Length)
        } finally {
            $encryptor.Dispose()
        }
    } finally {
        $aes.Dispose()
    }

    $hmac = [System.Security.Cryptography.HMACSHA256]::new((Get-Sha256Bytes "${purpose}:mac"))
    try {
        $magic = [System.Text.Encoding]::ASCII.GetBytes("swpe1")
        $macBytes = $hmac.ComputeHash((Join-Bytes @($magic, $iv, $cipherBytes)))
    } finally {
        $hmac.Dispose()
    }

    $payload = [ordered]@{
        version = 1
        alg = "A256CBC-HS256"
        iv = [System.Convert]::ToBase64String($iv)
        ciphertext = [System.Convert]::ToBase64String($cipherBytes)
        mac = [System.Convert]::ToBase64String($macBytes)
    }
    $json = $payload | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($DestinationPath, $json, [System.Text.UTF8Encoding]::new($false))
}

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
$settingsWeb = Join-Path $PSScriptRoot "settings-web"
if (Test-Path $settingsWeb) {
    Copy-Item -Path (Join-Path $settingsWeb "*") -Destination $wwwroot -Recurse -Force
}

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
    wallpaper: {
      packageId: "kg.example.sales.wallpaper.engine",
      packageVersion: "$Version",
      updateManifestUrl: origin + "/download/wallpaper-engine/latest.json",
      language: "auto",
      refreshAtLocalTime: "09:00",
      refreshSeconds: 86400,
      map: { fitCenterX: -1.16, fitCenterY: -0.45, fitCenterZ: 2.48 },
      hud: {
        showSalesSummary: true,
        showExchangeRates: true,
        showYearVolume: true,
        showYearTons: true,
        showYearAmount: true,
        showMonthVolume: true,
        showMonthTons: true,
        showMonthAmount: true,
        showUsdKgs: true,
        showCnyKgs: true,
        showInventoryAlerts: true,
        showActiveStations: true,
        showClosedStations: true,
        showDepotMarkers: true,
        showInventoryAlertOnly: false,
        hudTopScale: 1,
        hudTopOffsetX: 0,
        hudTopOffsetY: 0,
        hudSalesScale: 1,
        hudSalesOffsetX: 0,
        hudSalesOffsetY: 0
      }
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
$setupHash = ""
$setupSize = 0

if (-not $NoInstaller) {
    $iexpress = (Get-Command iexpress.exe -ErrorAction SilentlyContinue).Source
    if (-not $iexpress) {
        Write-Warning "iexpress.exe was not found; skipping setup exe generation."
    } else {
        if (Test-Path $installerPayload) {
            $resolvedInstallerPayload = (Resolve-Path $installerPayload).Path
            if (-not $resolvedInstallerPayload.StartsWith($publishRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to clear unexpected installer payload: $resolvedInstallerPayload"
            }
            Remove-Item -LiteralPath $resolvedInstallerPayload -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path $installerPayload | Out-Null

        $installerAppZip = Join-Path $installerPayload "SalesWallpaperEngine-app.zip"
        Compress-Archive -Path (Join-Path $appOut "*") -DestinationPath $installerAppZip -Force
        Copy-Item -Path (Join-Path $PSScriptRoot "install-user.ps1") -Destination (Join-Path $installerPayload "install-user.ps1") -Force

        $keyArgs = ""
        $bundledKeyFile = ""
        if ($IncludeKeyPath) {
            $resolvedKeyPath = (Resolve-Path $IncludeKeyPath).Path
            if ($PlainBundledKey) {
                $bundledKeyFile = "wallpaper-key.json"
                Copy-Item -LiteralPath $resolvedKeyPath -Destination (Join-Path $installerPayload $bundledKeyFile) -Force
                $keyArgs = ' -KeyFile "%~dp0wallpaper-key.json" -DeployBundledKey'
            } else {
                $bundledKeyFile = "wallpaper-key.protected.json"
                New-ProtectedWallpaperKeyFile -SourcePath $resolvedKeyPath -DestinationPath (Join-Path $installerPayload $bundledKeyFile)
                $keyArgs = ' -ProtectedKeyFile "%~dp0wallpaper-key.protected.json" -DeployBundledKey'
            }
        }

        $installCmd = @"
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-user.ps1" -PackageZip "%~dp0SalesWallpaperEngine-app.zip"$keyArgs
if errorlevel 1 (
  echo.
  echo Sales Wallpaper Engine installation failed.
  pause
  exit /b %errorlevel%
)
exit /b 0
"@
        Set-Content -Path (Join-Path $installerPayload "install-wallpaper.cmd") -Value $installCmd -Encoding ASCII

        $payloadFiles = @(
            "install-wallpaper.cmd",
            "install-user.ps1",
            "SalesWallpaperEngine-app.zip"
        )
        if ($bundledKeyFile) {
            $payloadFiles += $bundledKeyFile
        }

        $sourceFileLines = for ($i = 0; $i -lt $payloadFiles.Count; $i++) {
            "%FILE$i%="
        }
        $stringFileLines = for ($i = 0; $i -lt $payloadFiles.Count; $i++) {
            "FILE$i=$($payloadFiles[$i])"
        }
        $sedPath = Join-Path $installerPayload "SalesWallpaperEngine-Setup.sed"
        $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AppLaunched%
UserQuietInstCmd=%AppLaunched%
SourceFiles=SourceFiles

[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=Sales Wallpaper Engine installed.
TargetName=$setupPath
FriendlyName=Sales Wallpaper Engine $Version
AppLaunched=install-wallpaper.cmd
PostInstallCmd=<None>
$($stringFileLines -join "`r`n")

[SourceFiles]
SourceFiles0=$installerPayload

[SourceFiles0]
$($sourceFileLines -join "`r`n")
"@
        [System.IO.File]::WriteAllText($sedPath, $sed, [System.Text.Encoding]::ASCII)

        if (Test-Path $setupPath) {
            Remove-Item -LiteralPath $setupPath -Force
        }
        & $iexpress /N /Q $sedPath
        $iexpressExitCode = $LASTEXITCODE
        $setupDeadline = (Get-Date).AddSeconds(60)
        $lastSetupSize = -1
        $stableSetupChecks = 0
        while ((Get-Date) -lt $setupDeadline) {
            if (Test-Path $setupPath) {
                $currentSetupSize = (Get-Item $setupPath).Length
                if ($currentSetupSize -gt 1048576 -and $currentSetupSize -eq $lastSetupSize) {
                    $stableSetupChecks++
                    if ($stableSetupChecks -ge 4) {
                        break
                    }
                } else {
                    $stableSetupChecks = 0
                }
                $lastSetupSize = $currentSetupSize
            }
            Start-Sleep -Milliseconds 500
        }
        if (-not (Test-Path $setupPath)) {
            throw "iexpress setup generation failed"
        }
        if ((Get-Item $setupPath).Length -le 1048576) {
            throw "iexpress setup generation did not produce a complete setup exe"
        }
        if ($iexpressExitCode -ne 0) {
            Write-Warning "iexpress.exe returned exit code $iexpressExitCode after generating the setup exe."
        }
        $setupHash = (Get-FileHash -Algorithm SHA256 -Path $setupPath).Hash.ToLowerInvariant()
        $setupSize = (Get-Item $setupPath).Length
    }
}

if (-not $NoPublishDownload) {
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    Copy-Item -Path $zipPath -Destination (Join-Path $downloadDir (Split-Path $zipPath -Leaf)) -Force
    $installerUrl = ""
    if ($setupSize -gt 0) {
        $downloadSetupPath = Join-Path $downloadDir (Split-Path $setupPath -Leaf)
        if (Test-Path $downloadSetupPath) {
            Remove-Item -LiteralPath $downloadSetupPath -Force
        }
        Copy-Item -LiteralPath $setupPath -Destination $downloadSetupPath -Force
        $installerUrl = "$publicBase/$(Split-Path $setupPath -Leaf)"
    }
    $manifest = [ordered]@{
        version = $Version
        url = "$publicBase/$(Split-Path $zipPath -Leaf)"
        size = $size
        sha256 = $hash
        installerUrl = $installerUrl
        installerSize = $setupSize
        installerSha256 = $setupHash
        package = "SalesWallpaperEngine"
        notes = @(
            "SalesWallpaperNative retired and replaced by a new host/player engine.",
            "Uses a local loopback proxy for wallpaper map data and a dedicated desktop attach path.",
            "Forwards global mouse position into the WebView canvas so station hover works behind desktop icons.",
            "Hides the in-page wallpaper settings button when running in SalesWallpaperEngine.",
            "Compacts the tray menu and shortens the displayed version label.",
            "Adds authorized year/month retail volume and sales amount HUD.",
            "Adds authorized USD/KGS and CNY/KGS exchange rates to the bottom-right HUD.",
            "Removes the bottom-left data timestamp and refresh timestamp from the wallpaper view.",
            "Refreshes wallpaper map data once every morning at 09:00 by default, after daily retail snapshot tasks, while still refreshing immediately on startup.",
            "Retries missed or failed daily wallpaper data refreshes after sleep, unlock, remote reconnect, or temporary network loss.",
            "Colors per-fuel inventory rows by capacity fill level without changing station status colors.",
            "Shows Chinese business status labels on map hover instead of internal values such as normal.",
            "Displays install, config, key, and Startup shortcut paths after setup finishes.",
            "Enables true auto-update by default: download, SHA256 verify, replace files, and restart the engine.",
            "Keeps tray-driven manual update install available for computers with autoInstallUpdates disabled.",
            "Wallpaper updates are independent from the main SalesDesktop client version.",
            "Adds a tray settings window for language, refresh, update, map center, HUD visibility, and HUD layout.",
            "Allows top and sales HUD blocks to be dragged and resized during settings edit mode with preview before save.",
            "Lets the Settings window enter HUD edit mode, save dragged HUD layout, or cancel unsaved HUD drag changes.",
            "Keeps station hover tooltips away from the configured HUD blocks.",
            "Adds authorized year/month retail tons to the sales HUD.",
            "Adds a lightweight inventory alert HUD counter using critical/warning counts.",
            "Adds map marker filters for active stations, closed stations, depot markers, and low-inventory-only view.",
            "Moves manual update checking to the first-level tray menu while Settings keeps the automatic update options.",
            "Adds a runtime snapshot log action for later troubleshooting.",
            "Merges year volume/tons and month volume/tons into compact stacked sales HUD cells.",
            "Adds CNY sales amounts converted by the period-average CNY/KGS method used by the monthly analysis report.",
            "Compacts the top inventory KPI now that inventory is shown in ten-thousand-liter units.",
            "Avoids a full page reload when leaving HUD edit mode to reduce wallpaper flicker.",
            "Requires update package size and SHA256 verification before applying an engine update.",
            "Automatically restarts the wallpaper player after a WebView2 process failure or unexpected player exit.",
            "Adds a Settings status panel for version, API host, token state, refresh/update state, and live data reachability.",
            "Moves config and log folder shortcuts under the Advanced tray menu to keep first-level tray actions focused."
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
if ($setupSize -gt 0) {
    Write-Host "Built $setupPath"
    Write-Host "Setup SHA256 $setupHash"
}
