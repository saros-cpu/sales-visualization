const { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { loadRuntimeConfig } = require('./runtime-config.cjs');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let adminDevToolsEnabled = false;
let updateStatus = { status: 'idle', autoCheck: true };
let updatePromptVisible = false;
let closePromptVisible = false;
let closePromptRequestId = 0;
let updateProgressLastLoggedPercent = -1;
let updateCheckInFlight = false;

const runtimeConfig = loadRuntimeConfig(app);
const appIcon = path.join(__dirname, '..', 'build', 'icon.ico');
const allowedExternalHosts = new Set(runtimeConfig.allowedHosts);
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sales.desktop');
}
function urlOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

const connectSrc = Array.from(new Set([
  "'self'",
  urlOrigin(runtimeConfig.apiHost),
  urlOrigin(runtimeConfig.updateUrl),
  'http://localhost:8900',
  'http://127.0.0.1:8900',
  'ws://localhost:5173',
])).join(' ');
const allowedExternalPathPrefixes = ['/api/', '/download/'];

function isAllowedExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && allowedExternalHosts.has(parsed.hostname)
      && allowedExternalPathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

async function clearRendererAuth() {
  const logoutUrl = JSON.stringify(`${runtimeConfig.apiHost.replace(/\/+$/, '')}/api/v2/auth/logout`);
  const clearScript = `
    (() => {
      try {
        const token = localStorage.getItem('accessToken');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        sessionStorage.clear();
        if (token) {
          fetch(${logoutUrl}, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            keepalive: true,
          }).catch(() => {});
        }
      } catch (_) {}
      return true;
    })();
  `;

  await Promise.all(BrowserWindow.getAllWindows().map(async (win) => {
    if (!win || win.isDestroyed()) return;
    try {
      await Promise.race([
        win.webContents.executeJavaScript(clearScript, true),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ]);
    } catch {}
  }));
}

function showMainWindow() {
  if (isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function quitAppAfterLogout() {
  if (isQuitting) return;
  isQuitting = true;
  await clearRendererAuth();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

async function quitAndInstallAfterLogout() {
  if (isQuitting) return;
  isQuitting = true;
  await clearRendererAuth();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  autoUpdater.quitAndInstall();
}

function setupTray() {
  if (tray || !fs.existsSync(appIcon)) return;
  tray = new Tray(appIcon);
  tray.setToolTip('销售管理系统');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开', click: showMainWindow },
    { type: 'separator' },
    { label: '关闭', click: () => { quitAppAfterLogout(); } },
  ]));
  tray.on('double-click', showMainWindow);
}

function minimizeMainWindowToTray() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    mainWindow.setSkipTaskbar(true);
  }
}

function requestCloseDecisionFromRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const requestId = ++closePromptRequestId;
  closePromptVisible = true;
  mainWindow.webContents.send('app-close-requested');
  mainWindow.webContents.executeJavaScript(
    "window.dispatchEvent(new CustomEvent('sales-app-close-requested')); true;",
    true,
  ).catch(() => {});
  setTimeout(() => {
    if (requestId === closePromptRequestId) closePromptVisible = false;
  }, 8000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    autoHideMenuBar: true,
    title: '销售管理系统',
    icon: fs.existsSync(appIcon) ? appIcon : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (fs.existsSync(appIcon)) mainWindow.setIcon(appIcon);
  setupTray();

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (key === 'f11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return;
    }
    if (input.control && input.shift && key === 'i') {
      event.preventDefault();
      if (adminDevToolsEnabled) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
        mainWindow.webContents.send('devtools-opened');
      }
    }
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    requestCloseDecisionFromRenderer();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function emitUpdateStatus(nextStatus) {
  updateStatus = { ...updateStatus, ...nextStatus };
  mainWindow?.webContents.send('update-status', updateStatus);
  return updateStatus;
}

function isUpdateBusy() {
  return ['checking', 'available', 'downloading', 'downloaded'].includes(updateStatus.status) || updateCheckInFlight;
}

function isDuplicateUpdateError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  return [
    'already',
    'in progress',
    'checkforupdates',
    'check for updates',
    'downloadupdate',
    'download update',
  ].some((text) => message.includes(text));
}

function formatLogArg(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendUpdateLog(level, ...args) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatLogArg).join(' ')}\n`;
    fs.appendFile(path.join(logDir, 'updater.log'), line, () => {});
  } catch {}
}

function requestInstallUpdateFromRenderer(info) {
  if (!mainWindow || updatePromptVisible) return;
  updatePromptVisible = true;
  const payload = { version: info?.version || '' };
  appendUpdateLog('info', 'request renderer install prompt', payload);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('update-install-requested', payload);
}

async function resolveUpdateInstallPrompt(action) {
  if (action === 'restart') {
    appendUpdateLog('info', 'restart to install requested');
    updatePromptVisible = false;
    await quitAndInstallAfterLogout();
    return true;
  }
  appendUpdateLog('info', 'install prompt deferred');
  updatePromptVisible = false;
  return true;
}

function setupUpdater() {
  const unsupportedMessage = '更新仅支持打包安装后的客户端';

  const checkForUpdates = async () => {
    if (!app.isPackaged) {
      return emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    }
    if (isUpdateBusy()) {
      appendUpdateLog('info', 'skip duplicate update check', updateStatus);
      return updateStatus;
    }
    try {
      updateCheckInFlight = true;
      emitUpdateStatus({ status: 'checking', message: undefined });
      await autoUpdater.checkForUpdates();
      return updateStatus;
    } catch (err) {
      if (isDuplicateUpdateError(err)) {
        appendUpdateLog('warn', 'ignore duplicate update check error', err?.message || err);
        return updateStatus;
      }
      return emitUpdateStatus({ status: 'error', message: err?.message || String(err) });
    } finally {
      updateCheckInFlight = false;
    }
  };

  ipcMain.handle('get-update-status', () => updateStatus);
  ipcMain.handle('check-for-update', () => checkForUpdates());
  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged) {
      return emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    }
    if (['downloading', 'downloaded', 'available'].includes(updateStatus.status)) {
      appendUpdateLog('info', 'skip duplicate manual download', updateStatus);
      return updateStatus;
    }
    try {
      await autoUpdater.downloadUpdate();
      return updateStatus;
    } catch (err) {
      if (isDuplicateUpdateError(err)) {
        appendUpdateLog('warn', 'ignore duplicate manual download error', err?.message || err);
        return updateStatus;
      }
      return emitUpdateStatus({ status: 'error', message: err?.message || String(err) });
    }
  });
  ipcMain.handle('restart-app', async () => {
    if (!app.isPackaged) return false;
    await quitAndInstallAfterLogout();
    return true;
  });
  ipcMain.handle('resolve-update-install-prompt', async (event, action) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow !== mainWindow) return false;
    return resolveUpdateInstallPrompt(action);
  });

  if (!app.isPackaged) {
    emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    console.log('[Updater] skipped in dev mode');
    return;
  }
  autoUpdater.logger = {
    info: (...args) => appendUpdateLog('info', ...args),
    warn: (...args) => appendUpdateLog('warn', ...args),
    error: (...args) => appendUpdateLog('error', ...args),
    debug: (...args) => appendUpdateLog('debug', ...args),
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: runtimeConfig.updateUrl });

  autoUpdater.on('checking-for-update', () => {
    appendUpdateLog('info', 'checking for update');
    emitUpdateStatus({ status: 'checking', message: undefined });
  });
  autoUpdater.on('update-available', (info) => {
    updateProgressLastLoggedPercent = -1;
    appendUpdateLog('info', 'update available', info);
    emitUpdateStatus({ status: 'available', version: info.version, releaseDate: info.releaseDate, message: undefined });
  });
  autoUpdater.on('update-not-available', () => {
    appendUpdateLog('info', 'update not available');
    emitUpdateStatus({ status: 'not-available', message: undefined });
  });
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(p.percent || 0);
    if (percent >= updateProgressLastLoggedPercent + 10 || percent === 100) {
      updateProgressLastLoggedPercent = percent;
      appendUpdateLog('info', 'download progress', {
        percent,
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      });
    }
    emitUpdateStatus({
      status: 'downloading',
      percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
      message: undefined,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    appendUpdateLog('info', 'update downloaded', info);
    emitUpdateStatus({ status: 'downloaded', version: info.version, message: undefined });
    requestInstallUpdateFromRenderer(info);
  });
  autoUpdater.on('error', (err) => {
    appendUpdateLog('error', 'update error', err?.stack || err?.message || err);
    if (isDuplicateUpdateError(err)) {
      appendUpdateLog('warn', 'ignore duplicate updater event error', updateStatus);
      return;
    }
    emitUpdateStatus({ status: 'error', message: err.message });
  });

  setTimeout(() => {
    checkForUpdates();
  }, 8000);
}

function setupFileDownload() {
  ipcMain.handle('download-file', async (event, { url, filename, token }) => {
    if (!isAllowedExternalUrl(url)) return false;

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [
        { name: 'Documents', extensions: ['xlsx', 'docx', 'html', 'pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return false;

    try {
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(result.filePath, buffer);
      return true;
    } catch (e) {
      return false;
    }
  });
}

function setupOpenExternal() {
  ipcMain.handle('open-external', async (event, url) => {
    if (typeof url === 'string' && isAllowedExternalUrl(url)) {
      await shell.openExternal(url);
    }
  });
}

function setupWindowControl() {
  const getTargetWindow = (event) => BrowserWindow.fromWebContents(event?.sender) || mainWindow;
  const run = (command, event) => {
    const targetWindow = getTargetWindow(event);
    if (!targetWindow || targetWindow.isDestroyed()) return false;
    if (command === 'minimize') {
      targetWindow.minimize();
      return true;
    }
    if (command === 'maximize') {
      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow.maximize();
      }
      return true;
    }
    if (command === 'close') {
      targetWindow.close();
      return true;
    }
    return false;
  };

  ipcMain.handle('window-control', (event, command) => run(command, event));
  ipcMain.on('window-minimize', (event) => run('minimize', event));
  ipcMain.on('window-maximize', (event) => run('maximize', event));
  ipcMain.on('window-close', (event) => run('close', event));
  ipcMain.handle('resolve-app-close', async (event, action) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow !== mainWindow) return false;

    if (action === 'quit') {
      closePromptVisible = false;
      closePromptRequestId += 1;
      await quitAppAfterLogout();
      return true;
    }
    if (action === 'minimize') {
      closePromptVisible = false;
      closePromptRequestId += 1;
      minimizeMainWindowToTray();
      return true;
    }
    closePromptVisible = false;
    closePromptRequestId += 1;
    return true;
  });
}

function setupDevToolsAccess() {
  ipcMain.on('set-devtools-access', (event, enabled) => {
    adminDevToolsEnabled = Boolean(enabled);
    if (!adminDevToolsEnabled && mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    }
  });
}

app.whenReady().then(() => {
  const csp = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src ${connectSrc}; img-src 'self' data: blob:; font-src 'self' data:`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  createWindow();
  setupUpdater();
  setupFileDownload();
  setupOpenExternal();
  setupWindowControl();
  setupDevToolsAccess();
});
app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else showMainWindow();
});
