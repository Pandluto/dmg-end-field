const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} = require('electron');
const { createDesktopStaticServer } = require('./static-host.cjs');

const DESKTOP_HOST = '127.0.0.1';
const DESKTOP_PORT = 31457;
const DESKTOP_ORIGIN = `http://${DESKTOP_HOST}:${DESKTOP_PORT}`;
const APPLICATION_ROOT = path.resolve(__dirname, '..');
const applicationMetadata = JSON.parse(
  fs.readFileSync(path.join(APPLICATION_ROOT, 'package.json'), 'utf8'),
);
const APPLICATION_NAME = applicationMetadata.build?.productName || '终末地伤害工作台';
const APPLICATION_VERSION = String(applicationMetadata.version || app.getVersion());
const DEV_ORIGIN = 'http://127.0.0.1:3030';
const isDevelopment = process.argv.includes('--dev');

function resolveDevelopmentUrl(value) {
  const url = new URL(value || DEV_ORIGIN);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    || url.username
    || url.password
  ) {
    throw new Error('DMG_DESKTOP_DEV_URL 必须是无凭据的 loopback HTTP 地址。');
  }
  return url.href;
}

const developmentUrl = isDevelopment
  ? resolveDevelopmentUrl(process.env.DMG_DESKTOP_DEV_URL || DEV_ORIGIN)
  : DEV_ORIGIN;
const windowUrl = isDevelopment ? developmentUrl : `${DESKTOP_ORIGIN}/`;
const trustedOrigin = new URL(windowUrl).origin;
const SCALE_OPTIONS = ['0.8', '0.85', '1', '1.25', '1.5'];
const DEFAULT_SCALE = process.platform === 'darwin' ? '0.85' : '1';
const QUIT_FLUSH_TIMEOUT_MS = 5_000;
const diagnosticsEnabled = process.env.DMG_DESKTOP_DIAGNOSTICS === '1';

function diagnostic(message) {
  if (diagnosticsEnabled) console.log(`[desktop] ${message}`);
}

let mainWindow = null;
let tray = null;
let staticHost = null;
let allowQuit = false;
let quitInProgress = false;
let pendingQuitFlush = null;
let desktopScale = DEFAULT_SCALE;
const releaseSelections = {
  imageSource: '',
  dataSource: '',
  output: '',
};
const generatedReleaseDirectories = new Set();

if (process.env.DMG_DESKTOP_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DMG_DESKTOP_USER_DATA));
}
app.setName(APPLICATION_NAME);

diagnostic(`profile ${app.getPath('userData')}`);
diagnostic('requesting single-instance lock');
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
diagnostic('single-instance lock acquired');

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (SCALE_OPTIONS.includes(String(value.scale))) desktopScale = String(value.scale);
  } catch {
    desktopScale = DEFAULT_SCALE;
  }
}

function saveSettings() {
  const targetPath = settingsPath();
  const temporaryPath = `${targetPath}.next`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ scale: desktopScale }, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, targetPath);
}

function applyScale() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.setZoomFactor(Number(desktopScale));
  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
}

function restoreWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? '隐藏工作台' : '打开工作台',
      click: () => (mainWindow?.isVisible() ? hideWindow() : restoreWindow()),
    },
    { type: 'separator' },
    { label: '完全退出', click: () => app.quit() },
  ]));
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('终末地伤害工作台');
  tray.on('click', restoreWindow);
  tray.on('double-click', restoreWindow);
  updateTrayMenu();
}

function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;
  try {
    return new URL(event.senderFrame.url).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function requireTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error('拒绝非桌面工作台的宿主调用。');
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: '终末地伤害工作台',
    backgroundColor: '#e9ecea',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const destination = new URL(url);
      if (/^https?:$/i.test(destination.protocol) && destination.origin !== trustedOrigin) {
        void shell.openExternal(destination.href);
      }
    } catch {
      // Invalid destinations are denied below.
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === trustedOrigin) return;
    } catch {
      // Invalid destinations are denied below.
    }
    event.preventDefault();
  });
  mainWindow.webContents.on('did-finish-load', applyScale);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);
  mainWindow.on('close', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    hideWindow();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    updateTrayMenu();
  });

  void mainWindow.loadURL(windowUrl).catch((error) => {
    dialog.showErrorBox('桌面工作台启动失败', error instanceof Error ? error.message : String(error));
  });
  return mainWindow;
}

function requestRendererFlush() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return Promise.resolve();
  }
  if (pendingQuitFlush) return pendingQuitFlush.promise;
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  const timeout = setTimeout(() => finish(), QUIT_FLUSH_TIMEOUT_MS);
  pendingQuitFlush = {
    promise,
    finish: () => {
      clearTimeout(timeout);
      finish();
    },
  };
  mainWindow.webContents.send('desktop:before-quit');
  return promise.finally(() => {
    pendingQuitFlush = null;
  });
}

async function pickPath(event, options, selectionKey) {
  requireTrustedSender(event);
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const selectedPath = path.resolve(result.filePaths[0]);
  releaseSelections[selectionKey] = selectedPath;
  return { ok: true, path: selectedPath };
}

async function importReleaseBuilder(fileName) {
  const scriptPath = path.join(APPLICATION_ROOT, 'scripts', fileName);
  return import(pathToFileURL(scriptPath).href);
}

function registerIpc() {
  ipcMain.handle('desktop:get-capabilities', (event) => {
    requireTrustedSender(event);
    return {
      host: 'desktop',
      shell: true,
      releaseTools: { images: true, data: true },
      agent: { available: false, reason: '本轮仅保留接口占位' },
      mcp: { available: false, reason: '本轮仅保留接口占位' },
    };
  });
  ipcMain.handle('desktop:get-app-info', (event) => {
    requireTrustedSender(event);
    return {
      name: APPLICATION_NAME,
      version: APPLICATION_VERSION,
      platform: process.platform,
      arch: process.arch,
      origin: trustedOrigin,
    };
  });
  ipcMain.handle('desktop:get-settings', (event) => {
    requireTrustedSender(event);
    return { scale: desktopScale, availableScales: SCALE_OPTIONS };
  });
  ipcMain.handle('desktop:set-scale', (event, payload) => {
    requireTrustedSender(event);
    const scale = String(payload?.scale || '');
    if (!SCALE_OPTIONS.includes(scale)) throw new Error('不支持的桌面缩放比例。');
    desktopScale = scale;
    saveSettings();
    applyScale();
    return { ok: true, scale: desktopScale };
  });
  ipcMain.handle('desktop:quit', (event) => {
    requireTrustedSender(event);
    app.quit();
    return { ok: true };
  });
  ipcMain.on('desktop:ready-to-quit', (event) => {
    if (!isTrustedSender(event)) return;
    pendingQuitFlush?.finish();
  });
  ipcMain.handle('desktop:pick-image-release-source', (event) => pickPath(event, {
    title: '选择图片资源目录',
    properties: ['openDirectory'],
  }, 'imageSource'));
  ipcMain.handle('desktop:pick-data-release-source', (event) => pickPath(event, {
    title: '选择 Slim data 目录或 public 目录',
    properties: ['openDirectory'],
  }, 'dataSource'));
  ipcMain.handle('desktop:pick-release-output', (event) => pickPath(event, {
    title: '选择发包输出目录',
    properties: ['openDirectory', 'createDirectory'],
  }, 'output'));
  ipcMain.handle('desktop:build-image-release', async (event, payload) => {
    requireTrustedSender(event);
    try {
      if (!releaseSelections.imageSource || !releaseSelections.output) {
        throw new Error('请先通过桌面选择器选择图片源目录和输出目录。');
      }
      const builder = await importReleaseBuilder('build-image-release-manifest.mjs');
      const result = builder.buildImageReleasePackage({
        ...(payload || {}),
        source: releaseSelections.imageSource,
        output: releaseSelections.output,
      });
      generatedReleaseDirectories.add(path.resolve(result.outputDir));
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('desktop:build-data-release', async (event, payload) => {
    requireTrustedSender(event);
    try {
      if (!releaseSelections.dataSource || !releaseSelections.output) {
        throw new Error('请先通过桌面选择器选择数据源目录和输出目录。');
      }
      const builder = await importReleaseBuilder('build-desktop-data-release.mjs');
      const result = builder.buildDesktopDataRelease({
        ...(payload || {}),
        source: releaseSelections.dataSource,
        output: releaseSelections.output,
      });
      generatedReleaseDirectories.add(path.resolve(result.outputDir));
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('desktop:reveal-path', async (event, payload) => {
    requireTrustedSender(event);
    const targetPath = path.resolve(String(payload?.path || ''));
    if (!payload?.path || !fs.existsSync(targetPath)) return { ok: false, error: '路径不存在。' };
    if (!generatedReleaseDirectories.has(targetPath)) {
      return { ok: false, error: '只能打开本次桌面会话生成的发布目录。' };
    }
    const revealTarget = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
    const error = await shell.openPath(revealTarget);
    return error ? { ok: false, error } : { ok: true, path: revealTarget };
  });
}

async function startApplication() {
  diagnostic('Electron ready; starting shell');
  loadSettings();
  diagnostic('settings loaded');
  registerIpc();
  diagnostic('IPC registered');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  diagnostic('permission policy installed');

  if (!isDevelopment) {
    const distDirectory = path.join(APPLICATION_ROOT, 'dist');
    diagnostic(`starting static host from ${distDirectory}`);
    staticHost = await createDesktopStaticServer({
      rootDir: distDirectory,
      host: DESKTOP_HOST,
      port: DESKTOP_PORT,
    });
    diagnostic(`static host listening at ${staticHost.origin}`);
  }
  diagnostic('clearing stale service-worker registration');
  await session.defaultSession.clearStorageData({
    origin: trustedOrigin,
    storages: ['serviceworkers'],
  });
  diagnostic('creating tray and window');

  createTray();
  createMainWindow();
}

app.setAppUserModelId('com.dmg.def');

app.whenReady().then(startApplication).catch((error) => {
  dialog.showErrorBox(
    '桌面工作台启动失败',
    error instanceof Error ? error.message : String(error),
  );
  allowQuit = true;
  app.quit();
});

app.on('activate', restoreWindow);
app.on('second-instance', restoreWindow);
app.on('before-quit', (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (quitInProgress) return;
  quitInProgress = true;
  void requestRendererFlush().finally(async () => {
    allowQuit = true;
    await staticHost?.close?.().catch(() => undefined);
    app.quit();
  });
});
app.on('window-all-closed', () => {
  // The tray owns the desktop lifecycle; explicit quit goes through before-quit.
});
