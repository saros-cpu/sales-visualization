# Sales Wallpaper Engine

Dedicated Windows desktop wallpaper engine for the Sales Visualization operating map.

This project replaces the retired `SalesWallpaperNative` line. It has its own version, package, update feed, config files, and release notes. Do not bump `SalesDesktop` only for wallpaper-engine changes.

## Runtime

- Host process: tray app, loopback HTTP server, update check, WorkerW/Progman desktop attachment, player watchdog.
- Player process: the same executable in `--player` mode, running WebView2 with the built `SalesDesktop` wallpaper page.
- Data path: `wallpaper.html` -> `http://127.0.0.1:<port>/api/wallpaper/map` -> configured public API host.
- Token path: the engine reads `wallpaper-key.protected.json`, `wallpaper-key.json`, or `app-config.json`; the web page never needs to request the remote API directly.
- Sales summary: when the wallpaper token is authorized, `/api/wallpaper/map` can include year/month retail volume, tons, Som sales amount, CNY amount converted with period-average CNY/KGS, and latest USD/KGS + CNY/KGS exchange rates for the bottom-right HUD.

## Config

Install-time or runtime config can be placed in:

- `%APPDATA%\sales-wallpaper-engine\wallpaper-key.protected.json`
- `%APPDATA%\sales-wallpaper-engine\wallpaper-key.json`
- `%APPDATA%\sales-wallpaper-engine\app-config.json`
- next to `SalesWallpaperEngine.exe`

`wallpaper-key.json` format:

```json
{
  "apiHost": "https://sales.example.com",
  "wallpaperToken": "replace-with-server-token"
}
```

Without a token the wallpaper stays in public map mode. With a matching server token it shows full inventory and price hover data.

Optional `app-config.json` fields:

```json
{
  "language": "auto",
  "refreshAtLocalTime": "09:00",
  "refreshSeconds": 86400,
  "showSalesSummary": true,
  "showExchangeRates": true,
  "showYearVolume": true,
  "showYearTons": true,
  "showYearAmount": true,
  "showMonthVolume": true,
  "showMonthTons": true,
  "showMonthAmount": true,
  "showUsdKgs": true,
  "showCnyKgs": true,
  "showInventoryAlerts": true,
  "showActiveStations": true,
  "showClosedStations": true,
  "showDepotMarkers": true,
  "showInventoryAlertOnly": false,
  "mapCenterX": -1.16,
  "mapCenterY": -0.45,
  "mapCenterZ": 2.48,
  "hudTopScale": 1.0,
  "hudTopOffsetX": 0,
  "hudTopOffsetY": 0,
  "hudSalesScale": 1.0,
  "hudSalesOffsetX": 0,
  "hudSalesOffsetY": 0
}
```

`refreshAtLocalTime` controls the daily wallpaper data refresh time. The default is 09:00 local time, after the 07:30 exchange-rate task, 08:30 retail snapshot task, and 08:45 accounting handover task. The wallpaper still refreshes immediately when it starts. If the computer sleeps, locks, or is offline around the scheduled time, the player checks for a missed daily refresh after resume/unlock and retries failed refreshes with a 5-minute throttle. If `refreshAtLocalTime` is blank or invalid, `refreshSeconds` is used as the fallback interval.

The bottom-right HUD is controlled per block and per KPI cell. All keys default to ON; a missing field is treated as ON, so old machines are unaffected.

- `showSalesSummary`: whole sales summary block (year + month volume/tons/amount).
- `showExchangeRates`: whole exchange rate block (USD/KGS + CNY/KGS).
- `showYearVolume`: year retail volume cell.
- `showYearTons`: year retail tons cell.
- `showYearAmount`: year retail amount cell.
- `showMonthVolume`: month retail volume cell.
- `showMonthTons`: month retail tons cell.
- `showMonthAmount`: month retail amount cell.
- `showUsdKgs`: USD/KGS exchange rate cell.
- `showCnyKgs`: CNY/KGS exchange rate cell.
- `showInventoryAlerts`: top HUD low-inventory warning/critical counter.
- `showActiveStations`: show operating station markers.
- `showClosedStations`: show closed/renovating station markers.
- `showDepotMarkers`: show depot markers.
- `showInventoryAlertOnly`: in authorized mode, show only stations with low-inventory warnings.
- `language`: `auto`, `zh`, or `ru`.
- `mapCenterX/Y/Z`: wallpaper map camera center offsets.
- `hudTopScale`, `hudTopOffsetX/Y`: top HUD size and pixel offset.
- `hudSalesScale`, `hudSalesOffsetX/Y`: bottom-right HUD size and pixel offset.

The tray menu includes `设置...`, which opens a local WebView2 settings window backed by loopback-only settings APIs. It can change the fields above and request an immediate wallpaper refresh. Manual update checks are available directly from the tray as `检查更新`; when an update is found, `安装更新 {version}` appears. The settings window also has `拖拽调整`, `保存拖拽布局`, and `取消拖拽` controls; while edit mode is on, the top HUD and bottom-right HUD can be dragged or resized directly on the wallpaper for preview. The tray also provides `HUD 编辑模式` for direct drag editing without opening the settings window; use `保存 HUD 布局` to persist the preview.

## Build

```powershell
cd D:\SalesVisualization
powershell -ExecutionPolicy Bypass -File .\SalesWallpaperEngine\build.ps1 -Version 0.2.4 -IncludeKeyPath .\SalesWallpaperEngine\publish\wallpaper-key.json
```

Output:

- `SalesWallpaperEngine\publish\SalesWallpaperEngine-{version}.zip`
- `SalesWallpaperEngine\publish\SalesWallpaperEngine-Setup-{version}.exe`
- `SalesWallpaperEngine\publish\app\`
- `SalesDesktop\download\wallpaper-engine\SalesWallpaperEngine-{version}.zip`
- `SalesDesktop\download\wallpaper-engine\SalesWallpaperEngine-Setup-{version}.exe`
- `SalesDesktop\download\wallpaper-engine\latest.json`

The package is framework-dependent to keep it light. The target computer needs WebView2 Runtime and .NET 8 Desktop Runtime.

The zip is the self-update package used by the running engine. The setup exe is for first install or manual overwrite install. If `-IncludeKeyPath` is supplied, the setup exe now embeds a protected `wallpaper-key.protected.json` by default and deploys it to `%APPDATA%\sales-wallpaper-engine\wallpaper-key.protected.json` during install. Use `-PlainBundledKey` only for local troubleshooting. The real key file, protected key file, and generated setup exe are local release artifacts and must not be committed.

## Install

For normal users, run:

```powershell
.\SalesWallpaperEngine-Setup-0.2.4.exe
```

For manual folder install, extract the zip, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-user.ps1
```

The script installs to `%LOCALAPPDATA%\SalesWallpaperEngine`, adds a Startup shortcut, starts the tray engine, and shows an install summary window with the program, config, key, and Startup shortcut paths.

## Releases

### 0.2.23

- **Transparent expanded inventory panel**: the expanded panel body now has a transparent background and no visible scrollbar, so the desktop wallpaper shows through while the list scrolls; scrolling itself is unchanged (`overflow-y` stays scrollable).
- **Inventory panel typography**: wider panel (360px max width) with larger text (13px rows / 11px headers) and rebalanced grid columns keep all four column headers fully visible in both Chinese (站点/油品/液位/预计天数) and Russian (АЗС/Топливо/Уровень/Дней).
- **One-decimal fill percentage**: fuel level percentages show one decimal place instead of integers.

### 0.2.9 – 0.2.21

- **Runtime pre-check fix (0.2.9)**: the environment pre-check no longer false-reports "missing runtime"; detection uses registry plus multi-path disk probing and moves to host-process startup so a player exit cannot white-screen the wallpaper.
- **WebView2 system-runtime convergence (0.2.10–0.2.14)**: drops the false-negative .NET check, supports side-by-side Fixed Version runtimes, surfaces WebView2 init errors with fallback to the system runtime, then converges on the system WebView2 Runtime only and ignores incomplete local `WebView2Runtime` folders.
- **Inventory panel fixes (0.2.15–0.2.16)**: inventory list filter fix with a scrollable list, then hardened scrolling behavior.
- **Inventory sellable-days caliber**: fuel rows above 60% level stay hidden, below 10% count as tank-bottom oil shown as 0 days, and 10–60% show sellable days computed by the backend from per-fuel daily sales in `ocw.selling` (`daysRemaining` per tank).
- **WH_MOUSE_LL global wheel hook**: map wheel zoom keeps working even though the wallpaper sits beneath the desktop icon layer.
- **Localized station names**: map marker names follow the wallpaper runtime language (Chinese/Russian).
- **Bundled-key persistence**: setup packages bake in the wallpaper key and redeploy it to `%APPDATA%\sales-wallpaper-engine` on install and on every auto-update, fixing 授权未通过 after updates.
- **Backend performance fix**: per-shop daily-sales indexes plus a 30-minute TTL cache bring the authorized wallpaper endpoint back under the client timeout (previously 40s+ responses).
- **Uninstall script**: complete uninstall covering the install dir, appdata folder, Startup shortcut, and HKCU Run residue.

### 0.2.4

- **Map labels localization**: the wallpaper page now uses the shared `map-labels` module for depot type and station business-status labels; Chinese maps use 在营/停用/在建 for depot type and 在营/停业/装修 for station status, while Russian maps use Работает/Остановлен/Строится; station/depot marker names also follow the runtime language.
- **Language auto-switch**: the wallpaper map markers, depot type, and status labels switch with `SALES_RUNTIME_CONFIG.wallpaper.language` (auto/zh/ru), matching the desktop client Kyrgyzstan map and keeping Web maps on Chinese labels.
- **Independent release**: ships separately from the main SalesDesktop 4.2.0 client; the wallpaper update feed `latest.json` points to 0.2.4 and does not require a main client update.

### 0.2.3

- **Release packaging**: bumps the independent wallpaper engine update line to 0.2.3 so the catch-up refresh build can be shipped separately from the main SalesDesktop installer.
- **Daily refresh catch-up**: keeps the missed 09:00 refresh detection and 5-minute retry throttle for sleeping, locked, offline, or VPN-delayed computers.
- **Resume/unlock refresh signal**: keeps refresh checks on power resume, session unlock, console reconnect, or remote reconnect.

### 0.2.2

- **Daily refresh catch-up**: if a computer sleeps, locks, or loses network around the 09:00 refresh window, the wallpaper now checks for a missed same-day refresh and retries failed refreshes with a 5-minute throttle.
- **Resume/unlock refresh signal**: the player dispatches a data refresh event after power resume, session unlock, console reconnect, or remote reconnect, so the wallpaper can update without a manual restart.
- **Terminology cleanup**: Chinese UI and docs use 库存液位 / 液位百分比 terminology.

### 0.2.0

- **HTTPS defaults**: new builds use `https://sales.example.com` for the API host and wallpaper update manifest. The manual compatibility endpoint remains available through local configuration.
- **Protected setup key**: setup builds created with `-IncludeKeyPath` embed `wallpaper-key.protected.json` by default, so first installs can authorize the wallpaper proxy without shipping a plaintext token file.
- **Legacy config migration**: 0.2.0 upgrades public HTTP values found in config files or update manifests to the HTTPS domain, while explicit environment overrides stay unchanged for operations fallback.
- **Tray update check**: manual update checking is now a first-level tray action, while Settings keeps only automatic update options.
- **HUD edit exit**: leaving HUD edit mode now applies the saved layout without a full page reload, reducing wallpaper flicker.
- **Update integrity**: automatic and manifest-based updates verify package size and SHA256 before applying.
- **Player self-recovery**: the host restarts the wallpaper player after a WebView2 process failure or unexpected player exit.
- **Settings status**: Settings now shows current version, API host, token state, refresh/update state, and live data reachability.
- **Tray simplification**: config and log folder shortcuts moved under `高级`, keeping first-level tray actions focused on daily use.

### 0.1.18

- **Stacked sales HUD**: year volume and year tons share one KPI cell, and month volume and month tons share one KPI cell.
- **CNY sales amount**: year/month sales amount cells show Som and CNY values; CNY uses the same period-average CNY/KGS method as the monthly analysis report.
- **Compact top HUD**: station inventory is already displayed in ten-thousand-liter units, so the inventory KPI no longer spans two columns and the top HUD is narrower.

### 0.1.17

- **Manual HUD editing**: the player now forwards synthetic mouse down/up events in addition to movement, so HUD drag/resize works even when the wallpaper runs behind desktop icons. The tray and Settings window can both enter edit mode, save the preview, or cancel it.
- **Sales HUD tons**: authorized year/month sales HUD can show true retail tons, without adding density display.
- **Inventory alert HUD**: the top HUD can show critical/warning low-inventory counts.
- **Map marker filters**: settings can show/hide active stations, closed/renovating stations, depot markers, or show only low-inventory stations in authorized mode.
- **Tray cleanup and logs**: update checking stays in Settings; the tray only shows install when an update is available, and `高级` can write a runtime snapshot to logs.

### 0.1.16

- **Tray settings window**: adds a dedicated WebView2 settings window from the tray for language, refresh time, auto-update behavior, HUD visibility, map center, and HUD layout.
- **HUD layout edit mode**: while the settings window is open, the top KPI HUD and bottom-right sales HUD can be moved and resized on the wallpaper, previewed live, then saved to `%APPDATA%\sales-wallpaper-engine\app-config.json`.
- **HUD title update**: renames the top title to `Example Petroleum零售版图` / `Карта розничной торговли example` and removes the subtitle.
- **Tooltip avoidance**: the shared map library gains an opt-in `tooltipAvoidSelectors` option; the wallpaper uses it so station/depot hover tooltips avoid the top and bottom-right HUD blocks. Desktop client and Web maps do not pass the option, so their behavior is unchanged.

### 0.1.15

- **Per-KPI HUD toggles**: each of the 6 bottom-right HUD KPI cells (year volume, year amount, month volume, month amount, USD/KGS, CNY/KGS) can be individually enabled/disabled via `app-config.json` (all default ON; missing fields treated as ON, old machines unaffected).

### 0.1.14

- **Map horizontal centering fix**: adjusts the wallpaper map camera horizontal offset (`fitCenterX`). The map screen bounding-box center now sits at the viewport center: measured offset -0.1px at 1920x1080 (was ~-31px) and <4px at 1536x864 / 1366x768, so the map no longer looks shifted left.

### 0.1.13

- **HUD block toggles**: the bottom-right sales summary and exchange rate blocks can now be enabled/disabled per machine via `showSalesSummary` / `showExchangeRates` in `app-config.json` (both default ON; missing fields are treated as ON, so old machines are unaffected).
- **Auto-update restart fix**: the apply-update script now logs every phase, aborts safely when the parent process still lives past the timeout (no overwriting a running exe), and retries restarting the engine up to 3 times — fixing the missing engine restart after an auto-update.
- **Adaptive metrics grid**: the top KPI metric cards use a 6-track adaptive grid and the inventory card spans two columns, twice the width of the other cards.

### 0.1.12

- **Fixed-width adaptive camera**: the wallpaper map now uses a constant horizontal visible width of ~72.7 world units at every resolution, matching the accepted 0.1.9 fixed-camera field of view at 1920x1080. The camera distance is derived from the viewport aspect (`fitWorldWidth` option), so 16:9 screens keep the exact 0.1.9 framing while narrow-aspect screens pull back instead of overflowing. `fitCenterX/Y/Z` offsets keep the country centered. This corrects the 0.1.11 regression where auto-fit could overflow small or narrow screens.
- **Settings panel removed**: removes the in-page settings button/panel, config persistence, and update-check diagnostics from the wallpaper page. The update banner and automatic update check remain, driven by the engine's tray menu and config files.
- **Client/web zero impact**: `fitWorldWidth` defaults OFF; the desktop client and web map never enable it, so their behavior stays identical.

### 0.1.11

- **Screen-adaptive map**: removes the fixed camera and auto-fits the Kyrgyzstan map to any screen resolution via `fitCamera` on init and on resize (`fitOnResize` option), fixing map overflow on small or narrow-aspect screens.
- **Tooltip occlusion fix**: the station hover tooltip flips left/up when it reaches the right/bottom screen edge (`flipTooltip` option) and renders above the bottom-right sales summary HUD (wallpaper tooltip z-index 60).
- **Client/web zero impact**: the shared `Kgz3DMap.js` gains `fitOnResize` and `flipTooltip` options, both default OFF; the desktop client and web map never enable them, so their behavior stays identical.

### 0.1.10

- **Language auto-detection**: resolves the system language from `CultureInfo.CurrentUICulture`, passes it via `SALES_RUNTIME_CONFIG.wallpaper.language`, and switches the wallpaper UI between Chinese and Russian text without manual configuration.
- **High-DPI display adaptation**: fixes oversized canvas and broken station hover on HiDPI screens (Huawei touchscreen laptops). `PlayerForm` initializes with `Screen.PrimaryScreen.Bounds` so WebView2 captures the correct DPI context. The synthetic pointer script divides CSS coordinates by `devicePixelRatio` to restore accurate mouse hover.
- **Touch and zoom prevention**: sets `touch-action: none` on the map container and locks viewport to `user-scalable=no`, preventing accidental zoom on touchscreen devices.
- **DPI change resilience**: the map re-resizes on resolution/DPI changes via a `matchMedia('resolution: 1dppx')` listener and multiple deferred resize calls during boot.

### 0.1.9

- Changes wallpaper data refresh to the business rhythm: refresh immediately on startup, then once daily at 09:00 by default after the morning automation tasks finish; missed or failed daily refreshes are retried automatically after resume/unlock.
- Adds `refreshAtLocalTime` config and keeps `refreshSeconds` as a fallback interval.
- Keeps the update independent from the main SalesDesktop client version.

### 0.1.8

- Removes the bottom-left data timestamp, refresh timestamp, and error text from the wallpaper view.
- Keeps the top operating summary and bottom-right sales/exchange HUD unchanged.
- Keeps the package and update feed independent from the main SalesDesktop client version.

### 0.1.7

- Adds authorized USD/KGS and CNY/KGS exchange rates to the bottom-right sales HUD.
- Reuses the project's existing `exchange_rates` table and latest effective exchange-rate snapshot.
- Keeps exchange-rate display behind the wallpaper token, matching the rest of the full-data wallpaper mode.

### 0.1.6

- Shows an install summary after setup finishes so users can see the actual program path, config path, key path, and Startup shortcut.
- Normalizes station and depot status labels for map hover, keeping internal states such as `normal` out of the UI and displaying `在营` / `停业` / `装修` / `关注`.
- Keeps the package and update feed independent from the main SalesDesktop client version.

### 0.1.5

- Adds taskbar safe-area injection so the bottom-right sales HUD avoids the Windows taskbar.
- Enables true automatic update by default: the engine checks the independent wallpaper manifest, downloads the zip, verifies package size and SHA256, applies it after the host exits, and restarts itself.
- Keeps the tray `检查并安装更新` command for immediate manual checks or for machines that set `autoInstallUpdates` to `false`.
- Adds authorized inventory fill data from `/api/wallpaper/map`; map hover keeps station dots as operating status, while each fuel inventory row is colored by fill level.

### 0.1.4

- Kept the accepted `0.1.2` visual quality and skipped the withdrawn low-resolution `0.1.3` package.
- Added the authorized bottom-right sales summary HUD for year/month retail volume and sales amount.
- Kept build output fixed at `publish\app` and maintained the independent `/download/wallpaper-engine/latest.json` update feed.

### 0.1.2

- Shortened the tray status label to `Sales Wallpaper v{version}` and removed long informational-version metadata.
- Moved diagnostics and reattach actions under `高级`, leaving the first-level tray menu focused on normal use.
- Hid the disabled download item until an update is actually available.

### 0.1.1

- Added synthetic pointer forwarding inside the player process so station/depot hover works when Windows desktop icons intercept normal mouse events.
- Hidden the in-page wallpaper settings button while running under `SalesWallpaperEngine`; use the tray menu and config files for this engine.
- Build output uses fixed `publish\app`.

### 0.1.0

- First dedicated host/player WebView2 wallpaper engine.
- Added WorkerW/Progman desktop attachment, local API proxy, token config, tray controls, diagnostics, and independent update feed.
