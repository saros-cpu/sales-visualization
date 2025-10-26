const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { loadRuntimeConfig } = require('./runtime-config.cjs');

let mainWindow = null;
let adminDevToolsEnabled = false;
let updateStatus = { status: 'idle', autoCheck: true };
let updatePromptVisible = false;

const runtimeConfig = loadRuntimeConfig(app);
const allowedExternalHosts = new Set(runtimeConfig.allowedHosts);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (input.control && input.shift && key === 'i') {
      event.preventDefault();
      if (adminDevToolsEnabled) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
        mainWindow.webContents.send('devtools-opened');
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function emitUpdateStatus(nextStatus) {
  updateStatus = { ...updateStatus, ...nextStatus };
  mainWindow?.webContents.send('update-status', updateStatus);
  return updateStatus;
}

async function promptInstallUpdate(info) {
  if (!mainWindow || updatePromptVisible) return;
  updatePromptVisible = true;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已准备好',
      message: `新版本 ${info?.version || ''} 已下载完成`,
      detail: '重启客户端后将自动安装更新。',
      buttons: ['稍后', '立即重启安装'],
      defaultId: 1,
      cancelId: 0,
    });
    if (result.response === 1) {
      autoUpdater.quitAndInstall();
    }
  } finally {
    updatePromptVisible = false;
  }
}

function setupUpdater() {
  const unsupportedMessage = '更新仅支持打包安装后的客户端';

  const checkForUpdates = async () => {
    if (!app.isPackaged) {
      return emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    }
    try {
      emitUpdateStatus({ status: 'checking', message: undefined });
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      return emitUpdateStatus({ status: 'error', message: err?.message || String(err) });
    }
  };

  ipcMain.handle('get-update-status', () => updateStatus);
  ipcMain.handle('check-for-update', () => checkForUpdates());
  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged) {
      return emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    }
    try {
      return await autoUpdater.downloadUpdate();
    } catch (err) {
      return emitUpdateStatus({ status: 'error', message: err?.message || String(err) });
    }
  });
  ipcMain.handle('restart-app', () => {
    if (!app.isPackaged) return false;
    autoUpdater.quitAndInstall();
    return true;
  });

  if (!app.isPackaged) {
    emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    console.log('[Updater] skipped in dev mode');
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: runtimeConfig.updateUrl });

  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ status: 'checking', message: undefined });
  });
  autoUpdater.on('update-available', (info) => {
    emitUpdateStatus({ status: 'available', version: info.version, releaseDate: info.releaseDate, message: undefined });
  });
  autoUpdater.on('update-not-available', () => {
    emitUpdateStatus({ status: 'not-available', message: undefined });
  });
  autoUpdater.on('download-progress', (p) => {
    emitUpdateStatus({ status: 'downloading', percent: Math.round(p.percent), message: undefined });
  });
  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateStatus({ status: 'downloaded', version: info.version, message: undefined });
    promptInstallUpdate(info);
  });
  autoUpdater.on('error', (err) => {
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
  const run = (command) => {
    if (!mainWindow) return false;
    if (command === 'minimize') {
      mainWindow.minimize();
      return true;
    }
    if (command === 'maximize') {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return true;
    }
    if (command === 'close') {
      mainWindow.close();
      return true;
    }
    return false;
  };

  ipcMain.handle('window-control', (_event, command) => run(command));
  ipcMain.on('window-minimize', () => run('minimize'));
  ipcMain.on('window-maximize', () => run('maximize'));
  ipcMain.on('window-close', () => run('close'));
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
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
