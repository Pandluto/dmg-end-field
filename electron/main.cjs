'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
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
const DEV_ORIGIN = 'http://127.0.0.1:3030';
const DESKTOP_WEB_MARKER = '__desktop_shell';
const APPLICATION_ROOT = path.resolve(__dirname, '..');
const SHELL_DOCUMENT_PATH = path.join(__dirname, 'shell', 'index.html');
const applicationMetadata = JSON.parse(
  fs.readFileSync(path.join(APPLICATION_ROOT, 'package.json'), 'utf8'),
);
const APPLICATION_NAME = applicationMetadata.build?.productName || '终末地伤害工作台';
const APPLICATION_VERSION = String(applicationMetadata.version || app.getVersion());
const isDevelopment = process.argv.includes('--dev');
const SCALE_OPTIONS = ['0.8', '0.85', '1', '1.25', '1.5'];
const DEFAULT_SCALE = process.platform === 'darwin' ? '0.85' : '1';
const diagnosticsEnabled = process.env.DMG_DESKTOP_DIAGNOSTICS === '1';

function diagnostic(message) {
  if (diagnosticsEnabled) console.log(`[desktop] ${message}`);
}

function resolveDevelopmentOrigin(value) {
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
  return url.origin;
}

const browserOrigin = isDevelopment
  ? resolveDevelopmentOrigin(process.env.DMG_DESKTOP_DEV_URL || DEV_ORIGIN)
  : DESKTOP_ORIGIN;

function buildBrowserUrl() {
  const url = new URL('/', browserOrigin);
  url.searchParams.set(DESKTOP_WEB_MARKER, '1');
  return url.href;
}

let shellWindow = null;
let tray = null;
let staticHost = null;
let allowQuit = false;
let quitInProgress = false;
let shellScale = DEFAULT_SCALE;
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
app.setAppUserModelId('com.dmg.def');

diagnostic(`profile ${app.getPath('userData')}`);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (SCALE_OPTIONS.includes(String(value.scale))) shellScale = String(value.scale);
  } catch {
    shellScale = DEFAULT_SCALE;
  }
}

function saveSettings() {
  const targetPath = settingsPath();
  const temporaryPath = `${targetPath}.next`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ scale: shellScale }, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, targetPath);
}

function applyScale() {
  if (!shellWindow || shellWindow.isDestroyed()) return;
  shellWindow.webContents.setZoomFactor(Number(shellScale));
  void shellWindow.webContents.setVisualZoomLevelLimits(1, 1);
}

function isShellDocumentUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') return false;
    return path.resolve(fileURLToPath(url)) === path.resolve(SHELL_DOCUMENT_PATH);
  } catch {
    return false;
  }
}

function isTrustedSender(event) {
  return Boolean(
    shellWindow
    && !shellWindow.isDestroyed()
    && event.sender === shellWindow.webContents
    && isShellDocumentUrl(event.senderFrame.url),
  );
}

function requireTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error('拒绝非桌面 Shell 的宿主调用。');
}

function restoreShellWindow() {
  if (!shellWindow || shellWindow.isDestroyed()) {
    createShellWindow();
    return;
  }
  if (shellWindow.isMinimized()) shellWindow.restore();
  shellWindow.show();
  shellWindow.focus();
}

function hideShellWindow() {
  if (shellWindow && !shellWindow.isDestroyed()) shellWindow.hide();
}

async function openBrowserWorkspace() {
  const url = buildBrowserUrl();
  await shell.openExternal(url);
  return url;
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '打开浏览器工作台',
      click: () => void openBrowserWorkspace().catch((error) => {
        dialog.showErrorBox('无法打开浏览器工作台', error instanceof Error ? error.message : String(error));
      }),
    },
    {
      label: shellWindow?.isVisible() ? '隐藏 Shell' : '打开 Shell',
      click: () => (shellWindow?.isVisible() ? hideShellWindow() : restoreShellWindow()),
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
  tray.setToolTip(`${APPLICATION_NAME} Shell`);
  tray.on('click', restoreShellWindow);
  tray.on('double-click', restoreShellWindow);
  updateTrayMenu();
}

function createShellWindow() {
  if (shellWindow && !shellWindow.isDestroyed()) return shellWindow;

  shellWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 600,
    show: false,
    title: `${APPLICATION_NAME} Shell`,
    backgroundColor: '#f1f3f2',
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

  shellWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const destination = new URL(url);
      if (/^https?:$/i.test(destination.protocol)) void shell.openExternal(destination.href);
    } catch {
      // Invalid destinations are denied below.
    }
    return { action: 'deny' };
  });
  shellWindow.webContents.on('will-navigate', (event, url) => {
    if (!isShellDocumentUrl(url)) event.preventDefault();
  });
  shellWindow.webContents.on('did-finish-load', applyScale);
  shellWindow.once('ready-to-show', () => shellWindow?.show());
  shellWindow.on('show', updateTrayMenu);
  shellWindow.on('hide', updateTrayMenu);
  shellWindow.on('close', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    hideShellWindow();
  });
  shellWindow.on('closed', () => {
    shellWindow = null;
    updateTrayMenu();
  });

  void shellWindow.loadFile(SHELL_DOCUMENT_PATH).catch((error) => {
    dialog.showErrorBox('桌面 Shell 启动失败', error instanceof Error ? error.message : String(error));
  });
  return shellWindow;
}

async function pickPath(event, options, selectionKey) {
  requireTrustedSender(event);
  const result = await dialog.showOpenDialog(shellWindow, options);
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
      host: 'desktop-shell',
      browserWorkspace: true,
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
      webUrl: buildBrowserUrl(),
      webOrigin: browserOrigin,
      development: isDevelopment,
    };
  });
  ipcMain.handle('desktop:get-settings', (event) => {
    requireTrustedSender(event);
    return { scale: shellScale, availableScales: SCALE_OPTIONS };
  });
  ipcMain.handle('desktop:set-scale', (event, payload) => {
    requireTrustedSender(event);
    const scale = String(payload?.scale || '');
    if (!SCALE_OPTIONS.includes(scale)) throw new Error('不支持的 Shell 缩放比例。');
    shellScale = scale;
    saveSettings();
    applyScale();
    return { ok: true, scale: shellScale };
  });
  ipcMain.handle('desktop:open-browser', async (event) => {
    requireTrustedSender(event);
    try {
      return { ok: true, url: await openBrowserWorkspace() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('desktop:quit', (event) => {
    requireTrustedSender(event);
    app.quit();
    return { ok: true };
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
        throw new Error('请先选择图片源目录和输出目录。');
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
        throw new Error('请先选择数据源目录和输出目录。');
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
      return { ok: false, error: '只能打开本次 Shell 会话生成的发布目录。' };
    }
    const revealTarget = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
    const error = await shell.openPath(revealTarget);
    return error ? { ok: false, error } : { ok: true, path: revealTarget };
  });
}

async function startApplication() {
  diagnostic('Electron ready; starting independent shell');
  if (!fs.existsSync(SHELL_DOCUMENT_PATH)) {
    throw new Error(`缺少 Shell 页面：${SHELL_DOCUMENT_PATH}`);
  }
  loadSettings();
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (!isDevelopment) {
    const distDirectory = path.join(APPLICATION_ROOT, 'dist');
    diagnostic(`starting browser workspace host from ${distDirectory}`);
    staticHost = await createDesktopStaticServer({
      rootDir: distDirectory,
      host: DESKTOP_HOST,
      port: DESKTOP_PORT,
    });
    diagnostic(`browser workspace listening at ${staticHost.origin}`);
  }

  Menu.setApplicationMenu(null);
  createTray();
  createShellWindow();
}

app.whenReady().then(startApplication).catch((error) => {
  dialog.showErrorBox(
    '桌面 Shell 启动失败',
    error instanceof Error ? error.message : String(error),
  );
  allowQuit = true;
  app.quit();
});

app.on('activate', restoreShellWindow);
app.on('second-instance', restoreShellWindow);
app.on('before-quit', (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (quitInProgress) return;
  quitInProgress = true;
  if (!staticHost) {
    allowQuit = true;
    app.quit();
    return;
  }
  void staticHost.close().catch(() => undefined).finally(() => {
    allowQuit = true;
    app.quit();
  });
});
app.on('window-all-closed', () => {
  // The tray owns the Shell lifecycle; closing the window only hides it.
});
