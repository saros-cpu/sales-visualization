# Sales Wallpaper Engine

Dedicated Windows desktop wallpaper engine for the Sales Visualization operating map.

This project replaces the retired `SalesWallpaperNative` line. It has its own version, package, update feed, config files, and release notes. Do not bump `SalesDesktop` only for wallpaper-engine changes.

## Runtime

- Host process: tray app, loopback HTTP server, update check, WorkerW/Progman desktop attachment, player watchdog.
- Player process: the same executable in `--player` mode, running WebView2 with the built `SalesDesktop` wallpaper page.
- Data path: `wallpaper.html` -> `http://127.0.0.1:<port>/api/wallpaper/map` -> configured public API host.
- Token path: the engine reads `wallpaper-key.json` or `app-config.json`; the web page never needs to request the remote API directly.
- Sales summary: when the wallpaper token is authorized, `/api/wallpaper/map` can include year/month retail volume and sales amount for the bottom-right HUD.

## Config

Install-time or runtime config can be placed in:

- `%APPDATA%\sales-wallpaper-engine\wallpaper-key.json`
- `%APPDATA%\sales-wallpaper-engine\app-config.json`
- next to `SalesWallpaperEngine.exe`

`wallpaper-key.json` format:

```json
{
  "apiHost": "http://198.51.100.10",
  "wallpaperToken": "replace-with-server-token"
}
```

Without a token the wallpaper stays in public map mode. With a matching server token it shows full inventory and price hover data.

## Build

```powershell
cd D:\SalesVisualization
powershell -ExecutionPolicy Bypass -File .\SalesWallpaperEngine\build.ps1 -Version 0.1.5 -IncludeKeyPath .\SalesWallpaperEngine\publish\wallpaper-key.json
```

Output:

- `SalesWallpaperEngine\publish\SalesWallpaperEngine-{version}.zip`
- `SalesWallpaperEngine\publish\SalesWallpaperEngine-Setup-{version}.exe`
- `SalesWallpaperEngine\publish\app\`
- `SalesDesktop\download\wallpaper-engine\SalesWallpaperEngine-{version}.zip`
- `SalesDesktop\download\wallpaper-engine\SalesWallpaperEngine-Setup-{version}.exe`
- `SalesDesktop\download\wallpaper-engine\latest.json`

The package is framework-dependent to keep it light. The target computer needs WebView2 Runtime and .NET 8 Desktop Runtime.

The zip is the self-update package used by the running engine. The setup exe is for first install or manual overwrite install. If `-IncludeKeyPath` is supplied, the setup exe embeds that local key file and deploys it to `%APPDATA%\sales-wallpaper-engine\wallpaper-key.json` during install. The real key file and generated setup exe are local release artifacts and must not be committed.

## Install

For normal users, run:

```powershell
.\SalesWallpaperEngine-Setup-0.1.5.exe
```

For manual folder install, extract the zip, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-user.ps1
```

The script installs to `%LOCALAPPDATA%\SalesWallpaperEngine`, adds a Startup shortcut, and starts the tray engine.

## Releases

### 0.1.5

- Adds taskbar safe-area injection so the bottom-right sales HUD avoids the Windows taskbar.
- Enables true automatic update by default: the engine checks the independent wallpaper manifest, downloads the zip, verifies SHA256 when present, applies it after the host exits, and restarts itself.
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
