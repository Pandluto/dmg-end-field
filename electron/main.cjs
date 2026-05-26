const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const maa = require('@maaxyz/maa-node');
const { tryServeDesktopApp } = require('./web-host.cjs');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  shell,
} = require('electron');

const DEV_WEB_URL = 'http://127.0.0.1:3030/';
const DEV_SHELL_URL = 'http://127.0.0.1:3030/shell/index.html';
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 31457;
const PROD_WEB_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}/`;
const PROD_SHELL_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}/shell/index.html`;
const ARK_RESPONSE_TIMEOUT_MS = 120000;
const MAIN_CONTENT_WIDTH = 1700;
const MAIN_CONTENT_HEIGHT = 900;
const SHELL_WIDTH = 700;
const SHELL_HEIGHT = 600;
const isDev = process.argv.includes('--dev');
const shellOnly = process.argv.includes('--shell-only');
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const DESKTOP_SCALE_PRESETS = {
  '1x': '1',
  '1.25x': '1.25',
  '1.5x': '1.5',
};
const WIN32_CONTROLLER_PRESETS = {
  'Win32-Window': {
    name: 'Win32-Window',
    label: '电脑端-默认',
    description: 'Background + SendMessageWithCursorPos + PostMessage',
    screencapMethod: maa.Win32ScreencapMethod.Background,
    mouseMethod: maa.Win32InputMethod.SendMessageWithCursorPos,
    keyboardMethod: maa.Win32InputMethod.PostMessage,
  },
  'Win32-Window-Background': {
    name: 'Win32-Window-Background',
    label: '电脑端-后台',
    description: 'Background + SendMessageWithWindowPos + PostMessage',
    screencapMethod: maa.Win32ScreencapMethod.Background,
    mouseMethod: maa.Win32InputMethod.SendMessageWithWindowPos,
    keyboardMethod: maa.Win32InputMethod.PostMessage,
  },
  'Win32-Front': {
    name: 'Win32-Front',
    label: '电脑端-前台',
    description: 'ScreenDC + Seize + Seize',
    screencapMethod: maa.Win32ScreencapMethod.ScreenDC,
    mouseMethod: maa.Win32InputMethod.Seize,
    keyboardMethod: maa.Win32InputMethod.Seize,
  },
};
app.commandLine.appendSwitch('high-dpi-support', '1');
const APP_ICON_PNG_PATH = path.join(__dirname, 'assets', 'icon.png');
const APP_ICON_ICO_PATH = path.join(__dirname, 'assets', 'icon.ico');

let mainWindow = null;
let shellWindow = null;
let bridgeServer = null;
let shellStartedAt = null;
let isAppQuitting = false;
let isForceClosingMain = false;
let appTray = null;
let savedDesktopScaleKey = '1x';
let activeDesktopScaleKey = '1x';
let sharedLlmApiKey = '';
let sharedLlmModel = 'doubao-seed-2-0-mini-260428';
let localDataRequestSeq = 1;
const pendingLocalDataExports = new Map();
const pendingLocalDataImports = new Map();
let captureSessionTimer = null;
let captureSession = {
  boundSourceId: null,
  presetName: 'Win32-Window',
  running: false,
  intervalMs: 200,
  latestFrame: null,
  lastCapturedAt: null,
  lastError: null,
  lastSourceMeta: null,
  controller: null,
};

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

function getDesktopSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function getLlmSettingsPath() {
  return path.join(app.getPath('userData'), 'llm-settings.json');
}

function loadDesktopSettings() {
  try {
    const filePath = getDesktopSettingsPath();
    if (!fs.existsSync(filePath)) {
      savedDesktopScaleKey = '1x';
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    savedDesktopScaleKey =
      typeof parsed.desktopScale === 'string' && DESKTOP_SCALE_PRESETS[parsed.desktopScale]
        ? parsed.desktopScale
        : '1x';
  } catch {
    savedDesktopScaleKey = '1x';
  }
}

function loadLlmSettings() {
  try {
    const filePath = getLlmSettingsPath();
    if (!fs.existsSync(filePath)) {
      sharedLlmApiKey = '';
      sharedLlmModel = 'doubao-seed-2-0-mini-260428';
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    sharedLlmApiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
    sharedLlmModel = typeof parsed.model === 'string' && parsed.model.trim()
      ? parsed.model.trim()
      : 'doubao-seed-2-0-mini-260428';
  } catch {
    sharedLlmApiKey = '';
    sharedLlmModel = 'doubao-seed-2-0-mini-260428';
  }
}

function saveDesktopSettings() {
  try {
    const filePath = getDesktopSettingsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ desktopScale: savedDesktopScaleKey }, null, 2),
      'utf-8'
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Failed to save desktop settings: ${detail}`);
  }
}

function saveLlmSettings() {
  try {
    const filePath = getLlmSettingsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        apiKey: sharedLlmApiKey,
        model: sharedLlmModel,
      }, null, 2),
      'utf-8'
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Failed to save llm settings: ${detail}`);
  }
}

function getDesktopSettingsPayload() {
  return {
    currentScale: activeDesktopScaleKey,
    savedScale: savedDesktopScaleKey,
    availableScales: Object.keys(DESKTOP_SCALE_PRESETS),
    restartRequired: activeDesktopScaleKey !== savedDesktopScaleKey,
  };
}

function getLlmSettingsPayload() {
  return {
    apiKey: sharedLlmApiKey,
    model: sharedLlmModel,
    hasApiKey: Boolean(sharedLlmApiKey),
  };
}

loadDesktopSettings();
loadLlmSettings();
activeDesktopScaleKey = savedDesktopScaleKey;
app.commandLine.appendSwitch(
  'force-device-scale-factor',
  DESKTOP_SCALE_PRESETS[activeDesktopScaleKey] ?? DESKTOP_SCALE_PRESETS['1x']
);

function buildWindowOptions(role, extra = {}) {
  return {
    autoHideMenuBar: true,
    useContentSize: true,
    icon: fs.existsSync(APP_ICON_PNG_PATH) ? APP_ICON_PNG_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--desktop-role=${role}`],
    },
    ...extra,
  };
}

function createTrayIconImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#107c41"/>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="#f4fff7"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

function getMainWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return 'missing';
  }

  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    return 'visible';
  }

  return 'hidden';
}

function getShellVisibilityState() {
  if (!shellWindow || shellWindow.isDestroyed()) {
    return 'missing';
  }

  if (shellWindow.isVisible() && !shellWindow.isMinimized()) {
    return 'visible';
  }

  return 'hidden';
}

function updateTrayMenu() {
  if (!appTray) {
    return;
  }

  const mainVisible = getMainWindowState() === 'visible';
  const shellVisible = getShellVisibilityState() === 'visible';
  appTray.setToolTip(mainVisible ? 'DEF 主界面已打开' : 'DEF 桌面端后台运行中');
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: mainVisible ? '收起主界面' : '打开主界面',
        click: () => {
          if (mainVisible) {
            hideMainWindow();
          } else {
            restoreMainWindow();
          }
        },
      },
      {
        label: shellVisible ? '收起 Shell' : '打开 Shell',
        click: () => {
          if (shellVisible) {
            hideShellWindow();
          } else {
            restoreShellWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: '完全关闭',
        click: () => {
          app.quit();
        },
      },
    ])
  );
}

function createTray() {
  if (appTray) {
    return;
  }

  const trayIcon = fs.existsSync(APP_ICON_PNG_PATH)
    ? nativeImage.createFromPath(APP_ICON_PNG_PATH)
    : createTrayIconImage();
  appTray = new Tray(trayIcon);
  appTray.on('double-click', () => {
    restoreMainWindow();
  });
  updateTrayMenu();
}

function lockWindowZoom(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return;
  }

  const { webContents } = windowInstance;
  webContents.setZoomFactor(1);
  webContents.setZoomLevel(0);
  webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
}

function applyWindowLifecycle(windowInstance, hideHandler, shouldAllowClose) {
  windowInstance.on('close', (event) => {
    if (shouldAllowClose()) {
      return;
    }

    event.preventDefault();
    hideHandler();
  });

  windowInstance.on('show', updateTrayMenu);
  windowInstance.on('hide', updateTrayMenu);
  windowInstance.on('restore', updateTrayMenu);
  windowInstance.on('minimize', updateTrayMenu);
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    restoreMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow(
    buildWindowOptions('main', {
      width: MAIN_CONTENT_WIDTH,
      height: MAIN_CONTENT_HEIGHT,
      minWidth: MAIN_CONTENT_WIDTH,
      minHeight: MAIN_CONTENT_HEIGHT,
      maxWidth: MAIN_CONTENT_WIDTH,
      maxHeight: MAIN_CONTENT_HEIGHT,
      resizable: false,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      title: 'DEF战斗模拟器',
      show: !shellOnly,
      backgroundColor: '#f3f5f7',
    })
  );

  if (isDev) {
    mainWindow.loadURL(DEV_WEB_URL);
  } else {
    mainWindow.loadURL(PROD_WEB_URL);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    lockWindowZoom(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  applyWindowLifecycle(mainWindow, hideMainWindow, () => isAppQuitting || isForceClosingMain);

  mainWindow.on('closed', () => {
    mainWindow = null;
    isForceClosingMain = false;
    updateTrayMenu();
  });

  updateTrayMenu();
  return mainWindow;
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return createMainWindow();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
  updateTrayMenu();
  return mainWindow;
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    updateTrayMenu();
    return false;
  }

  mainWindow.hide();
  updateTrayMenu();
  return true;
}

function createShellWindow(options = {}) {
  const { startHidden = false } = options;

  if (shellWindow && !shellWindow.isDestroyed()) {
    if (startHidden) {
      hideShellWindow();
    } else {
      restoreShellWindow();
    }
    return shellWindow;
  }

  shellWindow = new BrowserWindow(
    buildWindowOptions('shell', {
      width: SHELL_WIDTH,
      height: SHELL_HEIGHT,
      minWidth: 640,
      minHeight: 520,
      title: 'DEF Desktop Shell',
      show: !startHidden,
      backgroundColor: '#edf5ee',
    })
  );
  shellStartedAt = Date.now();

  if (isDev) {
    shellWindow.loadURL(DEV_SHELL_URL);
  } else {
    shellWindow.loadURL(PROD_SHELL_URL);
  }

  appendRuntimeLog('shell', `loadURL ${isDev ? DEV_SHELL_URL : PROD_SHELL_URL}`);

  shellWindow.webContents.on('did-finish-load', () => {
    appendRuntimeLog('shell', `did-finish-load ${shellWindow.webContents.getURL()}`);
    lockWindowZoom(shellWindow);
  });

  shellWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendRuntimeLog('shell', `did-fail-load ${errorCode} ${errorDescription || '-'} ${validatedURL || '-'}`);
  });

  shellWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    appendRuntimeLog('shell-console', `${level} ${sourceId || '-'}:${line || 0} ${message}`);
  });

  shellWindow.webContents.on('render-process-gone', (_event, details) => {
    appendRuntimeLog('shell', `render-process-gone ${JSON.stringify(details)}`);
  });

  if (startHidden) {
    shellWindow.once('ready-to-show', () => {
      if (shellWindow && !shellWindow.isDestroyed()) {
        shellWindow.hide();
        updateTrayMenu();
      }
    });
  }

  applyWindowLifecycle(shellWindow, hideShellWindow, () => isAppQuitting);

  shellWindow.on('closed', () => {
    shellWindow = null;
    shellStartedAt = null;
    updateTrayMenu();
  });

  updateTrayMenu();
  return shellWindow;
}

function restoreShellWindow() {
  if (!shellWindow || shellWindow.isDestroyed()) {
    return createShellWindow();
  }

  if (shellWindow.isMinimized()) {
    shellWindow.restore();
  }

  if (!shellWindow.isVisible()) {
    shellWindow.show();
  }

  shellWindow.focus();
  updateTrayMenu();
  return shellWindow;
}

function hideShellWindow() {
  if (!shellWindow || shellWindow.isDestroyed()) {
    shellWindow = null;
    shellStartedAt = null;
    updateTrayMenu();
    return false;
  }

  shellWindow.hide();
  updateTrayMenu();
  return true;
}

function getSenderRole(event) {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    return 'unknown';
  }
  if (senderWindow === mainWindow) {
    return 'main';
  }
  if (senderWindow === shellWindow) {
    return 'shell';
  }
  return 'unknown';
}

function buildJsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const STATIC_MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function tryServeStaticFromRoot({ method, requestUrl, response, rootDir, urlPrefix, cacheControl = 'no-cache' }) {
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  const pathname = decodeURIComponent(requestUrl.pathname || '/');
  if (!pathname.startsWith(urlPrefix)) {
    return false;
  }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes('..')) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(method === 'HEAD' ? '' : 'Forbidden');
    return true;
  }

  const relPath = pathname.slice(urlPrefix.length).replace(/^\/+/, '');
  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, relPath);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(method === 'HEAD' ? '' : 'Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const body = fs.readFileSync(filePath);
  const contentType = STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cacheControl,
    'Content-Length': body.length,
    'Content-Type': contentType,
  });
  response.end(method === 'HEAD' ? '' : body);
  return true;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, buildJsonHeaders());
  response.end(JSON.stringify(payload));
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (error) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    request.on('error', reject);
  });
}

function getShellRuntimeInfo() {
  return {
    running: Boolean(shellWindow && !shellWindow.isDestroyed()),
    pid: process.pid,
    startedAt: shellWindow && !shellWindow.isDestroyed() ? shellStartedAt : null,
    minimized: Boolean(shellWindow && !shellWindow.isDestroyed() && shellWindow.isMinimized()),
    visible: Boolean(shellWindow && !shellWindow.isDestroyed() && shellWindow.isVisible()),
    state: getShellVisibilityState(),
  };
}

function getBridgeHealth() {
  return {
    ok: true,
    service: 'def-local-bridge',
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    shell: getShellRuntimeInfo(),
    main: {
      running: Boolean(mainWindow && !mainWindow.isDestroyed()),
      visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
      state: getMainWindowState(),
      width: MAIN_CONTENT_WIDTH,
      height: MAIN_CONTENT_HEIGHT,
      ...getDesktopSettingsPayload(),
    },
  };
}

function openWeb() {
  restoreMainWindow();
  return {
    opened: true,
    mode: isDev ? 'vite' : 'localhost',
    url: isDev ? DEV_WEB_URL : PROD_WEB_URL,
    width: MAIN_CONTENT_WIDTH,
    height: MAIN_CONTENT_HEIGHT,
    ...getDesktopSettingsPayload(),
  };
}

function normalizeCaptureSource(source) {
  const handle = source.handle ?? source.Handle ?? source[0];
  const className = source.className ?? source.class_name ?? source.ClassName ?? source[1];
  const title = source.title ?? source.Title ?? source.windowName ?? source.window_name ?? source[2];
  return {
    id: String(handle),
    handle: Number(handle),
    name: title,
    className: className || '',
    displayId: '',
    kind: 'window',
    appIconDataUrl: null,
    thumbnailDataUrl: null,
    width: 0,
    height: 0,
    backend: 'maa-win32-controller',
  };
}

function isEndFieldCaptureSource(source) {
  if (!source || typeof source.name !== 'string' || typeof source.className !== 'string') {
    return false;
  }

  return /endfield/i.test(source.name) && /UnityWndClass/i.test(source.className);
}

function getCapturePreset(presetName = 'Win32-Window') {
  const preset = WIN32_CONTROLLER_PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unsupported Win32 controller preset: ${presetName}`);
  }

  return preset;
}

function listCapturePresets() {
  return Object.values(WIN32_CONTROLLER_PRESETS).map((preset) => ({
    name: preset.name,
    label: preset.label,
    description: preset.description,
  }));
}

async function listWin32CaptureSources() {
  const windows = await maa.Win32Controller.find();
  return Array.isArray(windows) ? windows : [];
}

async function getCaptureSources() {
  const sources = await listWin32CaptureSources();
  return sources.map(normalizeCaptureSource).filter((source) => isEndFieldCaptureSource(source));
}

function destroyCaptureController() {
  if (!captureSession.controller) {
    return;
  }

  try {
    captureSession.controller.destroy();
  } catch {}
  captureSession.controller = null;
}

async function ensureCaptureController() {
  if (!captureSession.boundSourceId) {
    throw new Error('No capture source is bound.');
  }

  if (captureSession.controller) {
    return captureSession.controller;
  }

  const preset = getCapturePreset(captureSession.presetName);
  const controller = new maa.Win32Controller(
    captureSession.boundSourceId,
    preset.screencapMethod,
    preset.mouseMethod,
    preset.keyboardMethod
  );
  controller.screenshot_use_raw_size = true;

  try {
    await controller.post_connection().wait();
  } catch (error) {
    try {
      controller.destroy();
    } catch {}
    throw error;
  }

  if (!controller.connected) {
    try {
      controller.destroy();
    } catch {}
    throw new Error('Maa Win32 controller failed to connect.');
  }

  captureSession.controller = controller;
  return controller;
}

async function captureSourceFrame(sourceId) {
  const sourceHandle = String(sourceId || '');
  if (!sourceHandle) {
    throw new Error('captureSourceFrame requires a valid window handle');
  }

  if (captureSession.boundSourceId !== sourceHandle) {
    throw new Error(`Capture source is not bound: ${sourceHandle}`);
  }

  const controller = await ensureCaptureController();
  await controller.post_screencap().wait();
  const imageBuffer = controller.cached_image;
  const resolution = controller.resolution;
  if (!imageBuffer || !resolution) {
    throw new Error('Target window is not capturable right now.');
  }

  const buffer = Buffer.from(imageBuffer);
  if (!buffer.length) {
    throw new Error('Maa screencap returned empty image.');
  }

  const [width, height] = resolution;
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
  const sources = await getCaptureSources();
  const matchedSource =
    sources.find((source) => source.id === sourceHandle) ||
    captureSession.lastSourceMeta || {
      id: sourceHandle,
      handle: Number(sourceHandle),
      name: `Window ${sourceHandle}`,
      className: '',
      kind: 'window',
      displayId: '',
      appIconDataUrl: null,
      thumbnailDataUrl: null,
      width,
      height,
      backend: 'maa-win32-controller',
    };

  return {
    source: matchedSource,
    capturedAt: Date.now(),
    width,
    height,
    imageDataUrl: dataUrl,
  };
}

function getCaptureSessionState() {
  const preset = getCapturePreset(captureSession.presetName);
  return {
    boundSourceId: captureSession.boundSourceId,
    presetName: captureSession.presetName,
    presetLabel: preset.label,
    running: captureSession.running,
    intervalMs: captureSession.intervalMs,
    lastCapturedAt: captureSession.lastCapturedAt,
    lastError: captureSession.lastError,
    latestFrame: captureSession.latestFrame
      ? {
          capturedAt: captureSession.latestFrame.capturedAt,
          width: captureSession.latestFrame.width,
          height: captureSession.latestFrame.height,
          sourceId: captureSession.latestFrame.source?.id ?? null,
        }
      : null,
    source: captureSession.lastSourceMeta,
  };
}

function resetCaptureSessionFrame() {
  captureSession.latestFrame = null;
  captureSession.lastCapturedAt = null;
  captureSession.lastError = null;
}

async function bindCaptureSource(sourceId, presetName = 'Win32-Window') {
  const sourceHandle = String(sourceId || '');
  if (!sourceHandle) {
    throw new Error('bindCaptureSource requires a valid window handle');
  }

  const sources = await getCaptureSources();
  const matchedSource = sources.find((source) => source.id === sourceHandle);
  if (!matchedSource) {
    throw new Error(`Target window not found: ${sourceId}`);
  }

  getCapturePreset(presetName);
  stopCaptureSession();
  destroyCaptureController();
  captureSession.boundSourceId = sourceHandle;
  captureSession.presetName = presetName;
  captureSession.lastSourceMeta = matchedSource;
  resetCaptureSessionFrame();
  return getCaptureSessionState();
}

async function runCaptureSessionTick() {
  if (!captureSession.boundSourceId) {
    captureSession.lastError = 'No capture source is bound.';
    return;
  }

  try {
    const frame = await captureSourceFrame(captureSession.boundSourceId);
    captureSession.latestFrame = frame;
    captureSession.lastCapturedAt = frame.capturedAt;
    captureSession.lastSourceMeta = frame.source;
    captureSession.lastError = null;
  } catch (error) {
    captureSession.lastError = error instanceof Error ? error.message : String(error);
  }
}

function stopCaptureSession() {
  if (captureSessionTimer) {
    clearInterval(captureSessionTimer);
    captureSessionTimer = null;
  }

  captureSession.running = false;
  destroyCaptureController();
  return getCaptureSessionState();
}

async function startCaptureSession(intervalMs = 200) {
  const normalizedInterval = Number.isFinite(intervalMs)
    ? Math.max(80, Math.min(2000, Math.round(intervalMs)))
    : 200;

  if (!captureSession.boundSourceId) {
    throw new Error('No capture source is bound.');
  }

  stopCaptureSession();
  captureSession.intervalMs = normalizedInterval;
  captureSession.running = true;
  await runCaptureSessionTick();
  captureSessionTimer = setInterval(() => {
    runCaptureSessionTick().catch((error) => {
      captureSession.lastError = error instanceof Error ? error.message : String(error);
    });
  }, normalizedInterval);

  return getCaptureSessionState();
}

function startBridgeServer() {
  if (bridgeServer) {
    return;
  }

  bridgeServer = http.createServer(async (request, response) => {
    const method = request.method || 'GET';
    const requestUrl = new URL(request.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);

    try {
      if (method === 'OPTIONS') {
        response.writeHead(204, buildJsonHeaders());
        response.end();
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/health') {
        writeJson(response, 200, getBridgeHealth());
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/image-assets/capabilities') {
        writeJson(response, 200, {
          ok: true,
          capabilities: getWebImageAssetCapabilities(),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/image-assets/list') {
        writeJson(response, 200, {
          ok: true,
          items: handleListImageAssets(),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/list') {
        writeJson(response, 200, {
          ok: true,
          path: getLocalDataDirectory(),
          sharePath: getShareDataDirectory(),
          state: readLocalDataState(),
          archives: listLocalDataArchives(),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/active') {
        const state = readLocalDataState();
        if (!state.activeFileName) {
          writeJson(response, 200, {
            ok: true,
            path: getLocalDataDirectory(),
            state,
            archive: null,
            meta: null,
          });
          return;
        }
        const filePath = resolveLocalDataPath({
          fileName: state.activeFileName,
          storageScope: state.activeStorageScope,
        });
        const archive = readLocalDataArchiveFile(filePath);
        writeJson(response, 200, {
          ok: true,
          path: filePath,
          state,
          archive,
          meta: buildLocalDataMeta(filePath, archive),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/read') {
        const fileName = requestUrl.searchParams.get('fileName') || undefined;
        const id = requestUrl.searchParams.get('id') || undefined;
        const storageScope = requestUrl.searchParams.get('storageScope') || requestUrl.searchParams.get('source') || undefined;
        const filePath = resolveLocalDataPath({ fileName, id, storageScope });
        const archive = readLocalDataArchiveFile(filePath);
        writeJson(response, 200, {
          ok: true,
          path: filePath,
          archive,
          meta: buildLocalDataMeta(filePath, archive),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/now-storage') {
        const archive = readNowStorageArchive();
        writeJson(response, 200, {
          ok: true,
          path: getNowStoragePath(),
          state: readNowStorageState(),
          archive,
          meta: archive ? buildLocalDataMeta(getNowStoragePath(), archive) : null,
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/now-storage') {
        const archive = await readJsonRequest(request);
        const result = writeNowStorageArchive(archive);
        writeJson(response, 200, {
          ok: true,
          ...result,
          state: readNowStorageState(),
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/now-storage-state') {
        writeJson(response, 200, {
          ok: true,
          state: readNowStorageState(),
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/now-storage-state') {
        const payload = await readJsonRequest(request);
        writeJson(response, 200, {
          ok: true,
          state: writeNowStorageState(Boolean(payload?.forceApply)),
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/save') {
        const payload = await readJsonRequest(request);
        if (!payload || payload.type !== 'def.localdata.archive.v1') {
          writeJson(response, 400, { ok: false, error: '存档 payload 无效' });
          return;
        }
        const { storageScope: requestedStorageScope, source, scope, ...archivePayload } = payload;
        const archive = {
          ...archivePayload,
          id: sanitizeArchiveId(payload.id || payload.name),
          name: typeof payload.name === 'string' && payload.name.trim()
            ? payload.name.trim()
            : sanitizeArchiveId(payload.id),
        };
        const storageScope = requestedStorageScope === 'local' || source === 'local' || scope === 'local' ? 'local' : 'share';
        const filePath = resolveLocalDataPath({ id: archive.id, storageScope });
        fs.writeFileSync(filePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf-8');
        const state = writeLocalDataState(path.basename(filePath), storageScope);
        writeJson(response, 200, {
          ok: true,
          path: filePath,
          meta: buildLocalDataMeta(filePath, archive),
          state,
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/open-shell') {
        restoreShellWindow();
        writeJson(response, 200, {
          ok: true,
          shell: {
            started: true,
            reason: 'opened',
            ...getShellRuntimeInfo(),
          },
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/close-shell') {
        const stopped = hideShellWindow();
        writeJson(response, 200, {
          ok: true,
          shell: {
            stopped,
            reason: stopped ? 'hidden' : 'not-running',
            ...getShellRuntimeInfo(),
          },
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/open-web') {
        writeJson(response, 200, {
          ok: true,
          web: openWeb(),
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/create-directory') {
        writeJson(response, 200, handleCreateImageDirectory(await readJsonRequest(request)));
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/delete-directory') {
        writeJson(response, 200, handleDeleteImageDirectory(await readJsonRequest(request)));
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/rename-directory') {
        writeJson(response, 200, handleRenameImageDirectory(await readJsonRequest(request)));
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/rename-file') {
        writeJson(response, 200, handleRenameImageAsset(await readJsonRequest(request)));
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/delete-file') {
        writeJson(response, 200, handleDeleteImageAsset(await readJsonRequest(request)));
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/import-from-browser') {
        writeJson(response, 200, handleImportImageAssetsFromBrowser(await readJsonRequest(request)));
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/reveal-file') {
        writeJson(response, 200, await handleRevealInExplorer({
          kind: 'file',
          ...(await readJsonRequest(request)),
        }));
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/reveal-directory') {
        writeJson(response, 200, await handleRevealInExplorer({
          kind: 'dir',
          ...(await readJsonRequest(request)),
        }));
        return;
      }

      // ── User-image serving (read-only, no path rules in bridge) ──
      if (method === 'GET' && requestUrl.pathname.startsWith('/user-images/')) {
        const userDir = getUserImagesDir();
        const relPath = decodeURIComponent(requestUrl.pathname.replace(/^\/user-images\//, ''));
        if (/(^|\/)\.\.(\/|$)/.test(relPath) || relPath.includes('\\')) {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }
        const absPath = path.resolve(userDir, relPath);
        if (!absPath.startsWith(path.resolve(userDir) + path.sep)) {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        const ext = path.extname(relPath).toLowerCase();
        const mimeMap = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';
        try {
          const data = fs.readFileSync(absPath);
          response.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': data.length,
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          response.end(data);
        } catch {
          response.writeHead(500);
          response.end('Internal Server Error');
        }
        return;
      }

      if (!isDev &&
        requestUrl.pathname.startsWith('/assets/') &&
        /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(requestUrl.pathname)) {
        if (tryServeStaticFromRoot({
          method,
          requestUrl,
          response,
          rootDir: getAssetsRoot(),
          urlPrefix: '/assets/',
          cacheControl: 'no-cache',
        })) {
          return;
        }
      }

      if (!isDev && tryServeDesktopApp({
        method,
        requestUrl,
        response,
        distDir: path.join(__dirname, '..', 'dist'),
      })) {
        return;
      }

      writeJson(response, 404, {
        ok: false,
        error: 'not-found',
        path: requestUrl.pathname,
      });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        path: requestUrl.pathname,
      });
    }
  });

  bridgeServer.on('error', (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Bridge server failed on ${BRIDGE_HOST}:${BRIDGE_PORT}: ${detail}`);
    restoreShellWindow();
  });

  bridgeServer.listen(BRIDGE_PORT, BRIDGE_HOST);
}

function stopServers() {
  stopCaptureSession();
  if (bridgeServer) {
    bridgeServer.close();
    bridgeServer = null;
  }
}

async function invokeArkResponses(payload) {
  const apiKey = typeof payload?.apiKey === 'string' && payload.apiKey.trim()
    ? payload.apiKey.trim()
    : sharedLlmApiKey;
  const model = typeof payload?.model === 'string' && payload.model.trim()
    ? payload.model.trim()
    : sharedLlmModel;
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';

  if (!apiKey) {
    throw new Error('API Key 不能为空');
  }
  if (!model) {
    throw new Error('模型名不能为空');
  }
  if (!prompt) {
    throw new Error('提示词不能为空');
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  const timeoutId = setTimeout(() => controller.abort(), ARK_RESPONSE_TIMEOUT_MS);

  try {
    const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        thinking: {
          type: 'disabled',
        },
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const detail = data?.error?.message || data?.message || rawText || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    return {
      ok: true,
      status: response.status,
      durationMs: Date.now() - startedAt,
      timeoutMs: ARK_RESPONSE_TIMEOUT_MS,
      data: data ?? rawText,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`模型请求超时（${Math.round(ARK_RESPONSE_TIMEOUT_MS / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

ipcMain.handle('desktop:get-role', (event) => getSenderRole(event));
ipcMain.handle('desktop:get-shell-state', () => ({
  appName: app.getName(),
  appVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  hostname: os.hostname(),
  shellWindowLoaded: Boolean(shellWindow && !shellWindow.isDestroyed()),
  shellVisible: Boolean(shellWindow && !shellWindow.isDestroyed() && shellWindow.isVisible()),
  webWindowManaged: Boolean(mainWindow && !mainWindow.isDestroyed()),
  webWindowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
  desktopSettings: getDesktopSettingsPayload(),
}));
ipcMain.handle('desktop:get-llm-settings', () => getLlmSettingsPayload());
ipcMain.handle('desktop:set-llm-settings', (_event, payload) => {
  sharedLlmApiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
  sharedLlmModel = typeof payload?.model === 'string' && payload.model.trim()
    ? payload.model.trim()
    : 'doubao-seed-2-0-mini-260428';
  saveLlmSettings();
  return getLlmSettingsPayload();
});
ipcMain.handle('desktop:get-settings', () => getDesktopSettingsPayload());
ipcMain.handle('desktop:set-scale', (_event, scaleKey) => {
  if (typeof scaleKey !== 'string' || !DESKTOP_SCALE_PRESETS[scaleKey]) {
    throw new Error(`Unsupported desktop scale: ${scaleKey}`);
  }

  savedDesktopScaleKey = scaleKey;
  saveDesktopSettings();
  return getDesktopSettingsPayload();
});
ipcMain.handle('desktop:open-web', () => openWeb());
ipcMain.handle('desktop:quit-app', () => {
  app.quit();
  return { ok: true };
});
ipcMain.handle('desktop:list-capture-presets', () => ({
  ok: true,
  presets: listCapturePresets(),
}));
ipcMain.handle('desktop:bind-capture-source', async (_event, sourceId, presetName) => ({
  ok: true,
  session: await bindCaptureSource(sourceId, presetName),
}));
ipcMain.handle('desktop:start-capture-session', async (_event, intervalMs) => ({
  ok: true,
  session: await startCaptureSession(intervalMs),
}));
ipcMain.handle('desktop:stop-capture-session', () => ({
  ok: true,
  session: stopCaptureSession(),
}));
ipcMain.handle('desktop:get-capture-session', () => ({
  ok: true,
  session: getCaptureSessionState(),
}));
ipcMain.handle('desktop:get-latest-capture-frame', () => ({
  ok: true,
  frame: captureSession.latestFrame,
}));
ipcMain.handle('desktop:list-capture-sources', async () => ({
  ok: true,
  sources: await getCaptureSources(),
}));
ipcMain.handle('desktop:capture-source-frame', async (_event, sourceId) => ({
  ok: true,
  frame: await captureSourceFrame(sourceId),
}));
ipcMain.handle('desktop:invoke-ark-responses', async (_event, payload) => invokeArkResponses(payload));

// ── Image asset management ──

const MANAGED_SUBDIR = 'assets/images';

function getAssetsRoot() {
  if (isDev) {
    return path.join(__dirname, '..', 'public', 'assets');
  }
  return ensureProductionAssetsRoot();
}

function getPackagedAssetsRoot() {
  return path.join(__dirname, '..', 'dist', 'assets');
}

function getProductionAssetsRoot() {
  return path.join(getRuntimeDataRoot(), 'images');
}

function ensureProductionAssetsRoot() {
  const targetRoot = getProductionAssetsRoot();
  if (isDev) {
    return targetRoot;
  }
  try {
    const needsSeed = !fs.existsSync(targetRoot) ||
      fs.readdirSync(targetRoot).length === 0 ||
      !fs.existsSync(path.join(targetRoot, 'avatars'));
    if (needsSeed) {
      fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
      fs.cpSync(getPackagedAssetsRoot(), targetRoot, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      appendRuntimeLog('assets', `seeded production assets ${targetRoot}`);
    }
  } catch (error) {
    appendRuntimeLog('assets', `seed failed ${error instanceof Error ? error.message : String(error)}`);
  }
  fs.mkdirSync(targetRoot, { recursive: true });
  return targetRoot;
}

/** Builtin asset root: public/assets (dev) or external data/assets (prod). */
function getBuiltinAssetsRoot() {
  return getAssetsRoot();
}

/**
 * Legacy browser-fallback manifest directory.
 * The file path remains assets/images/_manifest.json for compatibility,
 * but the manifest now lists every builtin image under the assets root.
 */
function getBuiltinManifestDir() {
  const root = getAssetsRoot();
  return path.join(root, 'images');
}

/** User (writable) images root: userData/user-images/. Independent from Vite watch scope. */
function getUserImagesDir() {
  const dir = isDev
    ? path.join(app.getPath('userData'), 'user-images')
    : getProductionAssetsRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Legacy: returns the user writable dir for operations that haven't been migrated. */
function getManagedDir() {
  return getUserImagesDir();
}

function syncImageManifest() {
  const list = scanAllImageAssets();
  const manifestDir = getBuiltinManifestDir();
  // Browser fallback still reads assets/images/_manifest.json.
  // Despite the legacy path, its contents represent the full builtin asset image set.
  const manifestPath = path.join(manifestDir, '_manifest.json');
  const slim = list
    .filter((entry) => entry.source !== 'user')
    .map((entry) => ({
      fileName: entry.fileName,
      baseName: entry.baseName,
      ext: entry.ext,
      relativePath: entry.relativePath,
      sizeBytes: entry.sizeBytes,
      updatedAt: entry.updatedAt,
      writable: false,
      source: 'builtin',
    }));
  try {
    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(slim, null, 2), 'utf-8');
  } catch {
    // best-effort
  }
}

function addFileEntry(results, dirsWithFiles, fullPath, relPath, source, writable) {
  let stats;
  try {
    stats = fs.statSync(fullPath);
  } catch {
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const baseName = path.basename(fullPath, ext);
  const normalizedRel = `assets/${relPath.replace(/\\/g, '/')}`;
  results.push({
    fileName: path.basename(fullPath),
    baseName,
    ext,
    relativePath: normalizedRel,
    source,
    writable,
    sizeBytes: stats.size,
    updatedAt: stats.mtimeMs,
  });
  // Mark ancestor dirs
  const parts = relPath.split('/');
  for (let i = 0; i < parts.length; i++) {
    dirsWithFiles.add(parts.slice(0, i + 1).join('/'));
  }
}

function scanAllImageAssets() {
  const builtinAssetsRoot = getBuiltinAssetsRoot();
  const userDir = getUserImagesDir();
  const builtinAndUserShareRoot = path.resolve(builtinAssetsRoot) === path.resolve(userDir);
  const results = [];
  const dirsWithFiles = new Set();

  // ── Walk helper ──
  function walk(dirPath, relDir, source, writable) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath, source, writable);
      } else if (entry.name === '_manifest.json') {
        continue;
      } else if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(entry.name)) {
        addFileEntry(results, dirsWithFiles, fullPath, relPath, source, writable);
      }
    }
  }

  // ── Scan builtin (read-only) ──
  if (!builtinAndUserShareRoot && fs.existsSync(builtinAssetsRoot)) {
    walk(builtinAssetsRoot, '', 'builtin', false);
  }

  // ── Scan user (writable) ──
  if (fs.existsSync(userDir)) {
    walk(userDir, 'images', 'user', true);
  }

  // ── Empty user directories (for tree visibility) ──
  function walkEmptyManagedDirs(dirPath, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    // A managed dir is "empty" when it has no direct image files
    const hasDirectImageFiles = entries.some(
      (e) => e.isFile() && /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(e.name),
    );
    if (relDir && !dirsWithFiles.has(relDir) && !hasDirectImageFiles) {
      const managedRel = `assets/${relDir.replace(/\\/g, '/')}`;
      results.push({
        kind: 'dir',
        fileName: path.basename(dirPath),
        baseName: '',
        ext: '',
        relativePath: managedRel,
        source: 'user',
        writable: true,
        sizeBytes: 0,
        updatedAt: 0,
      });
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        walkEmptyManagedDirs(fullPath, relPath);
      }
    }
  }
  walkEmptyManagedDirs(userDir, 'images');

  // Deduplicate by relativePath (user wins over builtin)
  const seen = new Map();
  for (const r of results) {
    const existing = seen.get(r.relativePath);
    if (!existing || (r.source === 'user' && existing.source === 'builtin')) {
      seen.set(r.relativePath, r);
    }
  }

  return Array.from(seen.values());
}

function findUniqueFileName(dirPath, baseName, ext) {
  let candidate = `${baseName}${ext}`;
  if (!fs.existsSync(path.join(dirPath, candidate))) {
    return candidate;
  }
  let counter = 1;
  while (true) {
    candidate = `${baseName} (${counter})${ext}`;
    if (!fs.existsSync(path.join(dirPath, candidate))) {
      return candidate;
    }
    counter += 1;
  }
  return candidate;
}

function normalizeManagedAssetRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return null;
  }

  let normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = normalized.split('/');
  const resolved = [];
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(seg);
  }
  normalized = resolved.join('/');

  if (!normalized.startsWith(`${MANAGED_SUBDIR}/`)) {
    return null;
  }

  return normalized;
}

function resolveManagedAssetPaths(relativePath) {
  const normalized = normalizeManagedAssetRelativePath(relativePath);
  if (!normalized) {
    return null;
  }

  const relToImages = normalized.replace(/^assets\//, '');
  const userRel = relToImages.replace(/^images\/?/, '');

  return {
    normalized,
    relToImages,
    userPath: path.resolve(getUserImagesDir(), userRel),
    builtinPath: path.resolve(getAssetsRoot(), relToImages),
  };
}

function getWebImageAssetCapabilities() {
  return {
    canList: true,
    canImport: true,
    canRename: true,
    canRenameDir: true,
    canDeleteFile: true,
    canCreateDir: true,
    canDeleteDir: true,
    canReveal: true,
    backendLabel: '网页端 · 可管理',
    transportKind: 'web-bridge',
  };
}

function handleListImageAssets() {
  return scanAllImageAssets();
}

function handleRenameImageDirectory(payload) {
  const { dirPath, newName } = payload || {};
  if (!dirPath || typeof dirPath !== 'string' || !newName || typeof newName !== 'string') {
    return { ok: false, error: '缺少参数' };
  }

  const cleanName = newName.trim();
  if (/[<>:"|?*\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
    return { ok: false, error: `非法文件夹名: "${cleanName}"` };
  }

  const managedDir = getManagedDir();
  const normalized = dirPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

  if (normalized === '' || normalized === '.') {
    return { ok: false, error: '禁止重命名根目录' };
  }
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
    return { ok: false, error: '非法目录路径' };
  }

  const oldPath = path.join(managedDir, normalized);
  const resolvedOld = path.resolve(oldPath);
  const resolvedManaged = path.resolve(managedDir);
  if (!resolvedOld.startsWith(resolvedManaged + path.sep)) {
    return { ok: false, error: '越权目录访问' };
  }
  if (!fs.existsSync(oldPath)) {
    return { ok: false, error: '目录不存在' };
  }

  const parentPath = path.dirname(oldPath);
  const newPath = path.join(parentPath, cleanName);

  if (oldPath === newPath) {
    return { ok: true };
  }
  if (fs.existsSync(newPath)) {
    return { ok: false, error: '目标目录已存在' };
  }

  try {
    fs.renameSync(oldPath, newPath);
    syncImageManifest();
    const newRel = path.relative(managedDir, newPath).replace(/\\/g, '/');
    return { ok: true, newPath: newRel };
  } catch (err) {
    return { ok: false, error: `重命名失败: ${err.message}` };
  }
}

async function handleRevealInExplorer(payload) {
  const { kind } = payload || {};

  if (kind === 'file') {
    const { relativePath } = payload;
    if (!relativePath || typeof relativePath !== 'string') {
      return { ok: false, error: '缺少文件路径' };
    }

    const resolvedPaths = resolveManagedAssetPaths(relativePath);
    if (!resolvedPaths) {
      return { ok: false, error: '非管理目录文件' };
    }
    const { userPath, builtinPath } = resolvedPaths;

    let absFile = null;
    if (fs.existsSync(userPath) && fs.statSync(userPath).isFile()) {
      absFile = userPath;
    } else if (fs.existsSync(builtinPath) && fs.statSync(builtinPath).isFile()) {
      absFile = builtinPath;
    }

    if (!absFile) {
      console.error('[reveal] file not found', { kind, relativePath, userPath, builtinPath });
      return { ok: false, error: '文件不存在' };
    }

    try {
      shell.showItemInFolder(absFile);
    } catch (err) {
      console.error('[reveal] showItemInFolder failed', { kind, relativePath, absFile, error: err.message });
      return { ok: false, error: `显示文件失败: ${err.message}` };
    }

    return { ok: true };
  }

  if (kind === 'dir') {
    const { dirPath } = payload;
    if (!dirPath || typeof dirPath !== 'string') {
      return { ok: false, error: '缺少目录路径' };
    }

    let normalized = dirPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (normalized === '' || normalized === '.') {
      return { ok: false, error: '无效目录路径' };
    }
    const segments = normalized.split('/');
    const resolved = [];
    for (const seg of segments) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { resolved.pop(); continue; }
      resolved.push(seg);
    }
    normalized = resolved.join('/');

    if (normalized !== 'images' && !normalized.startsWith('images/')) {
      return { ok: false, error: '目录不在管理范围内' };
    }

    const userDir = getUserImagesDir();
    const userRel = normalized.replace(/^images\/?/, '');
    const userPath = userRel ? path.resolve(userDir, userRel) : userDir;
    const builtinPath = path.resolve(getAssetsRoot(), normalized);

    let absDir = null;
    if (fs.existsSync(userPath) && fs.statSync(userPath).isDirectory()) {
      absDir = userPath;
    } else if (fs.existsSync(builtinPath) && fs.statSync(builtinPath).isDirectory()) {
      absDir = builtinPath;
    }

    if (!absDir) {
      console.error('[reveal] dir not found', { kind, dirPath, userPath, builtinPath });
      return { ok: false, error: '目录不存在' };
    }

    const err = await shell.openPath(absDir);
    if (err && typeof err === 'string' && err.length > 0) {
      console.error('[reveal] openPath failed', { kind, dirPath, absDir, error: err });
      return { ok: false, error: `打开目录失败: ${err}` };
    }

    return { ok: true };
  }

  return { ok: false, error: `未知的 reveal kind: ${kind || '(缺失)'}` };
}

function handleRenameImageAsset(payload) {
  const { relativePath, newName } = payload || {};
  if (!relativePath || typeof newName !== 'string' || newName.trim().length === 0) {
    return { ok: false, error: '缺少参数' };
  }

  const resolvedPaths = resolveManagedAssetPaths(relativePath);
  if (!resolvedPaths) {
    return { ok: false, error: '此文件为只读，不可重命名' };
  }
  const { userPath: oldPath, builtinPath } = resolvedPaths;

  if (fs.existsSync(oldPath) && fs.statSync(oldPath).isFile()) {
    // user file: writable
  } else if (fs.existsSync(builtinPath) && fs.statSync(builtinPath).isFile()) {
    return { ok: false, error: '此文件为只读素材，不可重命名' };
  } else {
    return { ok: false, error: '文件不存在' };
  }

  const originalExt = path.extname(oldPath).toLowerCase();
  const userExt = path.extname(newName.trim()).toLowerCase();
  const cleanName = userExt ? path.basename(newName.trim(), userExt) : newName.trim();
  const finalName = `${cleanName}${originalExt}`;
  const newPath = path.join(path.dirname(oldPath), finalName);

  if (oldPath === newPath) {
    return { ok: true };
  }

  if (fs.existsSync(newPath)) {
    return { ok: false, error: '目标文件名已存在' };
  }

  try {
    fs.renameSync(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `重命名失败: ${err.message}` };
  }
}

function handleDeleteImageAsset(payload) {
  const { relativePath } = payload || {};
  if (!relativePath) {
    return { ok: false, error: '缺少路径参数' };
  }

  const resolvedPaths = resolveManagedAssetPaths(relativePath);
  if (!resolvedPaths) {
    return { ok: false, error: '此文件为只读，不可删除' };
  }
  const { userPath: targetPath, builtinPath } = resolvedPaths;

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    // user file: writable
  } else if (fs.existsSync(builtinPath) && fs.statSync(builtinPath).isFile()) {
    return { ok: false, error: '此文件为只读素材，不可删除' };
  } else {
    return { ok: false, error: '文件不存在' };
  }

  try {
    fs.unlinkSync(targetPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `删除失败: ${err.message}` };
  }
}

function handleImportImageAssetsFromBrowser(payload) {
  const { items, targetDir } = payload || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, results: [], error: '缺少文件数据' };
  }

  const IMG_EXT_RE = /\.(png|jpg|jpeg|webp|gif|svg)$/i;
  const managedDir = getManagedDir();

  let destDir = managedDir;
  if (targetDir && typeof targetDir === 'string' && targetDir.trim().length > 0) {
    const normalized = targetDir.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
      return { ok: false, results: [], error: '非法目录路径' };
    }
    destDir = path.join(managedDir, normalized);
    const resolvedDest = path.resolve(destDir);
    const resolvedManaged = path.resolve(managedDir);
    if (!resolvedDest.startsWith(resolvedManaged + path.sep) && resolvedDest !== resolvedManaged) {
      return { ok: false, results: [], error: '越权目录访问' };
    }
  }

  if (!fs.existsSync(destDir)) {
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (err) {
      return { ok: false, results: [], error: `创建目录失败: ${err.message}` };
    }
  }

  const results = [];
  for (const item of items) {
    const fileName = item.fileName;
    const data = item.data;

    if (!fileName || typeof fileName !== 'string' || !data || typeof data !== 'string') {
      results.push({ fileName: fileName || '(unknown)', ok: false, error: '缺少文件名或数据' });
      continue;
    }

    const cleanName = path.basename(fileName);
    if (cleanName !== fileName || fileName.includes('..') || fileName.startsWith('/') || fileName.startsWith('\\')) {
      results.push({ fileName, ok: false, error: '非法文件名' });
      continue;
    }

    if (!IMG_EXT_RE.test(fileName)) {
      results.push({ fileName, ok: false, error: '不支持的文件类型' });
      continue;
    }

    const ext = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, ext);
    const uniqueName = findUniqueFileName(destDir, baseName, ext);
    const destPath = path.join(destDir, uniqueName);

    try {
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(destPath, buffer);
      results.push({ fileName: uniqueName, ok: true });
    } catch (err) {
      results.push({ fileName, ok: false, error: `写入失败: ${err.message}` });
    }
  }

  syncImageManifest();

  const allOk = results.every((r) => r.ok);
  return {
    ok: allOk,
    results,
    ...(allOk ? {} : { error: '部分文件导入失败' }),
  };
}

function handleCreateImageDirectory(payload) {
  const { dirName, parentDir } = payload || {};
  if (!dirName || typeof dirName !== 'string' || dirName.trim().length === 0) {
    return { ok: false, error: '请输入文件夹名' };
  }

  const cleanName = dirName.trim();
  if (/[<>:"|?*\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
    return { ok: false, error: `非法文件夹名: "${cleanName}"` };
  }

  const managedDir = getManagedDir();

  let parentPath = managedDir;
  if (parentDir && typeof parentDir === 'string' && parentDir.trim().length > 0) {
    const normalized = parentDir.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
      return { ok: false, error: '非法目录路径' };
    }
    parentPath = path.join(managedDir, normalized);
    const resolvedParent = path.resolve(parentPath);
    const resolvedManaged = path.resolve(managedDir);
    if (!resolvedParent.startsWith(resolvedManaged + path.sep) && resolvedParent !== resolvedManaged) {
      return { ok: false, error: '越权目录访问' };
    }
    if (!fs.existsSync(parentPath)) {
      return { ok: false, error: `父目录不存在: ${normalized}` };
    }
    const parentStat = fs.statSync(parentPath);
    if (!parentStat.isDirectory()) {
      return { ok: false, error: `路径不是目录: ${normalized}` };
    }
  }

  const newDirPath = path.join(parentPath, cleanName);
  if (fs.existsSync(newDirPath)) {
    return { ok: false, error: `文件夹已存在: "${cleanName}"` };
  }

  try {
    fs.mkdirSync(newDirPath, { recursive: true });
  } catch (err) {
    return { ok: false, error: `创建文件夹失败: ${err.message}` };
  }

  syncImageManifest();

  const createdRel = path.relative(managedDir, newDirPath).replace(/\\/g, '/');

  return { ok: true, createdPath: createdRel };
}

function handleDeleteImageDirectory(payload) {
  const { relativePath } = payload || {};
  if (!relativePath || typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    return { ok: false, error: '缺少目录路径' };
  }

  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

  if (normalized === '' || normalized === '.') {
    return { ok: false, error: '禁止删除根目录' };
  }

  if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
    return { ok: false, error: '非法目录路径' };
  }

  const managedDir = getManagedDir();
  const targetPath = path.join(managedDir, normalized);
  const resolvedTarget = path.resolve(targetPath);
  const resolvedManaged = path.resolve(managedDir);

  if (!resolvedTarget.startsWith(resolvedManaged + path.sep)) {
    return { ok: false, error: '越权目录访问' };
  }

  if (!fs.existsSync(targetPath)) {
    return { ok: false, error: '目录不存在' };
  }

  const targetStat = fs.statSync(targetPath);
  if (!targetStat.isDirectory()) {
    return { ok: false, error: '路径不是目录' };
  }

  const lockedFiles = [];
  function scanLocked(dirPath) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanLocked(fullPath);
      } else if (entry.isFile() && /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(entry.name)) {
        let writable = true;
        try {
          fs.accessSync(fullPath, fs.constants.W_OK);
        } catch {
          writable = false;
        }
        if (writable && process.platform === 'win32') {
          try {
            const fileStat = fs.statSync(fullPath);
            if ((fileStat.mode & 0o200) === 0) {
              writable = false;
            }
          } catch {
            writable = false;
          }
        }
        if (!writable) {
          lockedFiles.push(path.relative(managedDir, fullPath).replace(/\\/g, '/'));
        }
      }
    }
  }
  scanLocked(targetPath);

  if (lockedFiles.length > 0) {
    return {
      ok: false,
      error: `目录包含锁定文件/只读资源，无法删除。受影响的文件: ${lockedFiles.slice(0, 5).join(', ')}${lockedFiles.length > 5 ? ` 等 ${lockedFiles.length} 个文件` : ''}`,
      lockedFiles,
    };
  }

  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `删除目录失败: ${err.message}` };
  }

  syncImageManifest();

  return { ok: true };
}

ipcMain.handle('desktop:list-image-assets', () => {
  return handleListImageAssets();
});

ipcMain.handle('desktop:import-image-assets', async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) {
    return scanAllImageAssets();
  }

  const result = await dialog.showOpenDialog(win, {
    title: '选择要导入的图片',
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return scanAllImageAssets();
  }

  const targetDir = getManagedDir();

  for (const sourcePath of result.filePaths) {
    const sourceExt = path.extname(sourcePath).toLowerCase();
    const sourceBaseName = path.basename(sourcePath, sourceExt);
    const uniqueName = findUniqueFileName(targetDir, sourceBaseName, sourceExt);
    const destPath = path.join(targetDir, uniqueName);
    try {
      fs.copyFileSync(sourcePath, destPath);
    } catch {
      // skip files that can't be copied
    }
  }

  syncImageManifest();
  return scanAllImageAssets();
});

ipcMain.handle('desktop:import-image-assets-to-dir', async (_event, payload) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) {
    return { ok: false, error: '无活动窗口' };
  }

  const result = await dialog.showOpenDialog(win, {
    title: '选择要导入的图片',
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, error: '已取消' };
  }

  const managedDir = getManagedDir();

  // Resolve target directory
  let targetDir = managedDir;
  const targetDirParam = payload?.targetDir;
  if (targetDirParam && typeof targetDirParam === 'string' && targetDirParam.trim().length > 0) {
    const normalized = targetDirParam.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
      return { ok: false, error: '非法目录路径' };
    }
    targetDir = path.join(managedDir, normalized);
    const resolvedDest = path.resolve(targetDir);
    const resolvedManaged = path.resolve(managedDir);
    if (!resolvedDest.startsWith(resolvedManaged + path.sep) && resolvedDest !== resolvedManaged) {
      return { ok: false, error: '越权目录访问' };
    }
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }

  const importedFiles = [];
  for (const sourcePath of result.filePaths) {
    const sourceExt = path.extname(sourcePath).toLowerCase();
    const sourceBaseName = path.basename(sourcePath, sourceExt);
    const uniqueName = findUniqueFileName(targetDir, sourceBaseName, sourceExt);
    const destPath = path.join(targetDir, uniqueName);
    try {
      fs.copyFileSync(sourcePath, destPath);
      importedFiles.push(uniqueName);
    } catch {
      // skip files that can't be copied
    }
  }

  syncImageManifest();
  return { ok: true, imported: importedFiles };
});

ipcMain.handle('desktop:rename-image-directory', (_event, payload) => handleRenameImageDirectory(payload));

ipcMain.handle('desktop:reveal-in-explorer', async (_event, payload) => handleRevealInExplorer(payload));

ipcMain.handle('desktop:rename-image-asset', (_event, payload) => handleRenameImageAsset(payload));

ipcMain.handle('desktop:delete-image-asset', (_event, payload) => handleDeleteImageAsset(payload));

ipcMain.handle('desktop:import-image-assets-from-browser', (_event, payload) => handleImportImageAssetsFromBrowser(payload));

ipcMain.handle('desktop:create-image-directory', (_event, payload) => handleCreateImageDirectory(payload));

ipcMain.handle('desktop:delete-image-directory', (_event, payload) => handleDeleteImageDirectory(payload));

function getEquipmentLibraryPath() {
  const devPath = path.join(__dirname, '..', 'public', 'data', 'equipments', 'equipments.json');
  const prodPath = path.join(__dirname, '..', 'dist', 'data', 'equipments', 'equipments.json');
  if (fs.existsSync(devPath) || !fs.existsSync(prodPath)) {
    return devPath;
  }
  return prodPath;
}

ipcMain.handle('desktop:read-equipment-library', () => {
  try {
    const filePath = getEquipmentLibraryPath();
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `装备库文件不存在：${filePath}`, path: filePath };
    }
    return {
      ok: true,
      path: filePath,
      data: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:write-equipment-library', (_event, payload) => {
  try {
    const filePath = getEquipmentLibraryPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

function getLocalDataDirectory() {
  if (isDev) {
    return path.join(__dirname, '..', 'data', 'localdata');
  }
  return path.join(getRuntimeDataRoot(), 'localdata');
}

function getShareDataDirectory() {
  if (isDev) {
    return path.join(__dirname, '..', 'data', 'sharedata');
  }
  return path.join(getRuntimeDataRoot(), 'sharedata');
}

function getRuntimeDataRoot() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const executableDir = portableDir && portableDir.trim()
    ? portableDir
    : path.dirname(process.execPath);
  return path.join(executableDir, 'data');
}

function getRuntimeLogDirectory() {
  if (isDev) {
    return path.join(__dirname, '..', 'data', 'logs');
  }
  return path.join(getRuntimeDataRoot(), 'logs');
}

function appendRuntimeLog(scope, message) {
  try {
    const dir = getRuntimeLogDirectory();
    fs.mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()} [${scope}] ${message}\n`;
    fs.appendFileSync(path.join(dir, 'desktop.log'), line, 'utf-8');
  } catch {
    // Logging must never break app startup.
  }
}

function getLegacyLocalDataDirectory() {
  return path.join(__dirname, '..', 'data', 'localdata');
}

function getLegacyShareDataDirectory() {
  return path.join(__dirname, '..', 'data', 'sharedata');
}

function seedRuntimeDataDirectory(targetDir, legacyDir) {
  if (isDev || fs.existsSync(targetDir) || !fs.existsSync(legacyDir)) {
    return;
  }
  try {
    fs.cpSync(legacyDir, targetDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  } catch {
    // Packaged apps may not ship legacy data; runtime directories are created empty.
  }
}

function getLocalDataStatePath() {
  return path.join(getLocalDataDirectory(), 'active-localdata.json');
}

function getNowStoragePath() {
  return path.join(getLocalDataDirectory(), 'now-storage.json');
}

function getNowStorageStatePath() {
  return path.join(getLocalDataDirectory(), 'now-storage-state.json');
}

function sanitizeArchiveId(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : `localdata-${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `localdata-${Date.now()}`;
}

function ensureLocalDataDirectory() {
  const dir = getLocalDataDirectory();
  seedRuntimeDataDirectory(dir, getLegacyLocalDataDirectory());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureShareDataDirectory() {
  const dir = getShareDataDirectory();
  seedRuntimeDataDirectory(dir, getLegacyShareDataDirectory());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getArchiveDirectory(storageScope = 'local') {
  return storageScope === 'share' ? ensureShareDataDirectory() : ensureLocalDataDirectory();
}

function readLocalDataState() {
  try {
    const filePath = getLocalDataStatePath();
    if (!fs.existsSync(filePath)) {
      return { activeFileName: null, activeStorageScope: 'local', updatedAt: null };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      activeFileName: typeof parsed.activeFileName === 'string' ? parsed.activeFileName : null,
      activeStorageScope: parsed.activeStorageScope === 'share' ? 'share' : 'local',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return { activeFileName: null, activeStorageScope: 'local', updatedAt: null };
  }
}

function writeLocalDataState(activeFileName, activeStorageScope = 'local') {
  ensureLocalDataDirectory();
  const state = {
    activeFileName,
    activeStorageScope: activeStorageScope === 'share' ? 'share' : 'local',
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getLocalDataStatePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  return state;
}

function readNowStorageState() {
  try {
    const filePath = getNowStorageStatePath();
    if (!fs.existsSync(filePath)) {
      return { forceApply: false, updatedAt: null };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      forceApply: Boolean(parsed.forceApply),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return { forceApply: false, updatedAt: null };
  }
}

function writeNowStorageState(forceApply) {
  ensureLocalDataDirectory();
  const state = {
    forceApply: Boolean(forceApply),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getNowStorageStatePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  return state;
}

function readNowStorageArchive() {
  const filePath = getNowStoragePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readLocalDataArchiveFile(filePath);
}

function writeNowStorageArchive(archive) {
  ensureLocalDataDirectory();
  if (!archive || archive.type !== 'def.localdata.archive.v1' || !archive.storage) {
    throw new Error('now-storage payload 无效');
  }
  fs.writeFileSync(getNowStoragePath(), `${JSON.stringify(archive, null, 2)}\n`, 'utf-8');
  return {
    path: getNowStoragePath(),
    meta: buildLocalDataMeta(getNowStoragePath(), archive),
  };
}

function resolveLocalDataPath(payload = {}) {
  const dir = getArchiveDirectory(payload.storageScope || payload.source || payload.scope || 'local');
  const fileName = sanitizeArchiveId(payload.fileName || payload.id || '');
  const normalizedFileName = fileName.toLowerCase().endsWith('.json') ? fileName : `${fileName}.json`;
  const resolved = path.resolve(dir, normalizedFileName);
  const root = path.resolve(dir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`非法存档路径：${normalizedFileName}`);
  }
  return resolved;
}

function buildLocalDataMeta(filePath, archive) {
  const stat = fs.statSync(filePath);
  const localRoot = path.resolve(getLocalDataDirectory());
  const shareRoot = path.resolve(getShareDataDirectory());
  const resolved = path.resolve(filePath);
  const storageScope = resolved.startsWith(shareRoot + path.sep) ? 'share' : 'local';
  const directory = storageScope === 'share' ? shareRoot : localRoot;
  return {
    id: archive?.id || path.basename(filePath, '.json'),
    name: archive?.name || path.basename(filePath, '.json'),
    description: archive?.description,
    fileName: path.basename(filePath),
    storageScope,
    archiveKey: `${storageScope}:${path.basename(filePath)}`,
    directory,
    path: filePath,
    createdAt: archive?.createdAt,
    exportedAt: archive?.exportedAt,
    sections: Array.isArray(archive?.sections) ? archive.sections : [],
    localKeys: archive?.storage?.local ? Object.keys(archive.storage.local).length : 0,
    sessionKeys: archive?.storage?.session ? Object.keys(archive.storage.session).length : 0,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

function readLocalDataArchiveFile(filePath) {
  const archive = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!archive || archive.type !== 'def.localdata.archive.v1' || !archive.storage) {
    throw new Error('不是有效的 localdata 存档');
  }
  return archive;
}

function listLocalDataArchives() {
  const listFromDirectory = (dir, storageScope) => fs.readdirSync(dir)
    .filter((fileName) => {
      const lowerName = fileName.toLowerCase();
      return lowerName.endsWith('.json') &&
        lowerName !== 'active-localdata.json' &&
        lowerName !== 'now-storage.json' &&
        lowerName !== 'now-storage-state.json';
    })
    .map((fileName) => {
      const filePath = path.join(dir, fileName);
      try {
        return buildLocalDataMeta(filePath, readLocalDataArchiveFile(filePath));
      } catch {
        return buildLocalDataMeta(filePath, {
          id: path.basename(fileName, '.json'),
          name: path.basename(fileName, '.json'),
          sections: [],
          storage: { local: {}, session: {} },
        });
      }
    });
  return [
    ...listFromDirectory(ensureShareDataDirectory(), 'share'),
    ...listFromDirectory(ensureLocalDataDirectory(), 'local'),
  ]
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function openDirectoryInExplorer(directory) {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true });

  if (process.platform === 'win32') {
    try {
      const child = spawn('explorer.exe', [resolved], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return { ok: true, path: resolved };
    } catch (error) {
      const spawnMessage = error instanceof Error ? error.message : String(error);
      const shellError = await shell.openPath(resolved);
      if (shellError) {
        return { ok: false, error: `${spawnMessage}; ${shellError}`, path: resolved };
      }
      return { ok: true, path: resolved };
    }
  }

  const shellError = await shell.openPath(resolved);
  return shellError
    ? { ok: false, error: shellError, path: resolved }
    : { ok: true, path: resolved };
}

function getMainWebContents() {
  const win = restoreMainWindow();
  if (!win || win.isDestroyed()) {
    throw new Error('主界面不可用');
  }
  return win.webContents;
}

function waitForWebContentsReady(webContents, timeoutMs = 10000) {
  if (!webContents.isLoading()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('主界面加载超时'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      webContents.off('did-finish-load', handleReady);
      webContents.off('did-fail-load', handleFail);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleFail = (_event, _errorCode, errorDescription) => {
      cleanup();
      reject(new Error(`主界面加载失败：${errorDescription || 'unknown'}`));
    };
    webContents.once('did-finish-load', handleReady);
    webContents.once('did-fail-load', handleFail);
  });
}

async function requestMainRenderer(channel, pendingMap, payload, timeoutMs = 30000) {
  const requestId = `localdata-${localDataRequestSeq++}`;
  const webContents = getMainWebContents();
  await waitForWebContentsReady(webContents);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingMap.delete(requestId);
      resolve({ ok: false, error: '主界面响应超时' });
    }, timeoutMs);
    pendingMap.set(requestId, { resolve, timer });
    webContents.send(channel, { requestId, ...payload });
  });
}

function reloadMainWindowAfterLocalDataImport() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  }, 180);
}

const LOCAL_DATA_LOCAL_PREFIXES = {
  operators: ['def.operator-editor.'],
  weapons: ['def.weapon-sheet.'],
  equipments: ['def.equipment-sheet.'],
  buffs: ['def.buff-editor.', 'def.buff-sheet.'],
  timeline: ['def.timeline.snapshot-archive.v1'],
  runtime: [],
};

const LOCAL_DATA_SESSION_KEYS = {
  operators: [
    'def.operator-config.active-character.v1',
    'def.operator-config.character-input-map.v3',
    'def.selected-characters.v1',
    'def.operator-config.page-cache.v1',
    'def.operator-runtime.template-map.v1',
    'def.operator-runtime.character-computed-map.v3',
    'def.operator-ui.character-display-cache.v3',
  ],
  weapons: [],
  equipments: [],
  buffs: [
    'def.all-buff-list.v1',
    'def.candidate-buff-list.v1',
    'def.anomaly-state-snapshot-archive.v1',
  ],
  timeline: [
    'def.selected-characters.v1',
    'def.selected-skill-button',
    'def.timeline.data.v1',
    'def.skill-button.v1',
    'def.all-buff-list.v1',
    'def.anomaly-state-snapshot-archive.v1',
  ],
  runtime: [
    'def.operator-config.page-cache.v1',
    'def.operator-runtime.template-map.v1',
    'def.operator-runtime.character-computed-map.v3',
    'def.operator-ui.character-display-cache.v3',
  ],
};

const LOCAL_DATA_REQUIRED_CURRENT_SESSION_KEYS = {
  timeline: [
    'def.selected-characters.v1',
    'def.timeline.data.v1',
    'def.skill-button.v1',
    'def.all-buff-list.v1',
  ],
};
const LOCAL_DATA_EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.draft.v1';

function uniqueLocalDataSections(sections) {
  const source = Array.isArray(sections) && sections.length > 0 ? sections : ['all'];
  return Array.from(new Set(source));
}

function shouldSyncEquipmentLibraryFile(sections) {
  const normalizedSections = uniqueLocalDataSections(sections);
  return normalizedSections.includes('all') || normalizedSections.includes('equipments');
}

function parseArchiveStorageValue(value) {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function syncEquipmentLibraryFileFromArchive(archive, sections) {
  if (!shouldSyncEquipmentLibraryFile(sections)) {
    return null;
  }
  const rawLibrary = archive?.storage?.local?.[LOCAL_DATA_EQUIPMENT_LIBRARY_STORAGE_KEY];
  if (!rawLibrary) {
    return null;
  }
  const library = parseArchiveStorageValue(rawLibrary);
  if (!library || typeof library !== 'object' || !library.gearSets || typeof library.gearSets !== 'object') {
    throw new Error('存档中的装备库数据无效，无法写入装备 JSON');
  }
  const filePath = getEquipmentLibraryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    ...library,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf-8');
  return filePath;
}

async function applyLocalDataArchiveInMainWindow(archive, options = {}) {
  const webContents = getMainWebContents();
  await waitForWebContentsReady(webContents);
  const requestedSections = uniqueLocalDataSections(options.sections || archive?.sections);
  const payload = {
    archive,
    options: {
      ...options,
      sections: requestedSections,
    },
    localPrefixes: LOCAL_DATA_LOCAL_PREFIXES,
    sessionKeys: LOCAL_DATA_SESSION_KEYS,
    requiredSessionKeys: LOCAL_DATA_REQUIRED_CURRENT_SESSION_KEYS,
  };
  const script = `
(() => {
  const payload = ${JSON.stringify(payload)};
  const knownSections = ['operators', 'weapons', 'equipments', 'buffs', 'timeline', 'runtime'];
  const uniqueSections = (sections) => {
    const source = Array.isArray(sections) && sections.length > 0 ? sections : ['all'];
    return Array.from(new Set(source));
  };
  const sections = uniqueSections(payload.options?.sections || payload.archive?.sections);
  const shouldIncludeLocalKey = (key) => {
    if (sections.includes('all')) return key.startsWith('def.');
    return sections.some((section) => {
      const prefixes = payload.localPrefixes[section] || [];
      return prefixes.some((prefix) => key === prefix || key.startsWith(prefix));
    });
  };
  const shouldIncludeSessionKey = (key) => {
    if (sections.includes('all')) return key.startsWith('def.');
    return sections.some((section) => (payload.sessionKeys[section] || []).includes(key));
  };
  const listKeys = (storage) => {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    return keys.sort();
  };
  const stringifyValue = (value) => typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const filterValues = (values, shouldInclude) => Object.fromEntries(
    Object.entries(values || {}).filter(([key]) => shouldInclude(key))
  );
  const localValues = filterValues(payload.archive?.storage?.local, shouldIncludeLocalKey);
  const sessionValues = filterValues(payload.archive?.storage?.session, shouldIncludeSessionKey);
  const targetSections = sections.includes('all') ? knownSections : sections.filter((section) => section !== 'all');
  const missingSections = targetSections.filter((section) => {
    const requiredKeys = payload.requiredSessionKeys[section];
    return Array.isArray(requiredKeys) && requiredKeys.length > 0 && !requiredKeys.some((key) => key in sessionValues);
  });
  if (missingSections.length > 0) {
    const archiveSessionKeys = Object.keys(payload.archive?.storage?.session || {});
    throw new Error(
      '存档缺少当前态 sessionStorage，不能完成桌面端同步替换：' +
      missingSections.join(' / ') +
      '。当前存档 session key：' +
      (archiveSessionKeys.join(', ') || '无')
    );
  }
  const removeManaged = (storage, shouldInclude) => {
    const keys = listKeys(storage).filter(shouldInclude);
    keys.forEach((key) => storage.removeItem(key));
    return keys.length;
  };
  const applyValues = (storage, values) => {
    const failedKeys = [];
    Object.entries(values).forEach(([key, value]) => {
      const serialized = stringifyValue(value);
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) {
        failedKeys.push(key);
      }
    });
    return { writtenKeys: Object.keys(values).length, failedKeys };
  };
  const removedLocalKeys = removeManaged(window.localStorage, shouldIncludeLocalKey);
  const removedSessionKeys = removeManaged(window.sessionStorage, shouldIncludeSessionKey);
  const localResult = applyValues(window.localStorage, localValues);
  const sessionResult = applyValues(window.sessionStorage, sessionValues);
  const failedKeys = [...localResult.failedKeys, ...sessionResult.failedKeys];
  if (failedKeys.length > 0) {
    throw new Error('桌面端 Web storage 写入校验失败：' + failedKeys.join(', '));
  }
  const touchedKeys = removedLocalKeys + removedSessionKeys + localResult.writtenKeys + sessionResult.writtenKeys;
  if (touchedKeys === 0) {
    throw new Error('存档和所选分组没有可替换的桌面端 Web storage key');
  }
  return {
    ok: true,
    sections,
    localKeys: localResult.writtenKeys,
    sessionKeys: sessionResult.writtenKeys,
    removedLocalKeys,
    removedSessionKeys,
    origin: window.location.origin,
    href: window.location.href,
    localKeyNames: Object.keys(localValues),
    sessionKeyNames: Object.keys(sessionValues),
  };
})()
`;
  return webContents.executeJavaScript(script, true).then((result) => {
    const equipmentLibraryPath = syncEquipmentLibraryFileFromArchive(archive, requestedSections);
    return equipmentLibraryPath ? { ...result, equipmentLibraryPath } : result;
  });
}

function completeLocalDataRequest(pendingMap, payload) {
  const requestId = payload?.requestId;
  if (!requestId || !pendingMap.has(requestId)) {
    return { ok: false, error: `未知请求：${requestId || '-'}` };
  }
  const pending = pendingMap.get(requestId);
  pendingMap.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(payload);
  return { ok: true };
}

ipcMain.handle('desktop:list-local-data-archives', () => {
  try {
    return {
      ok: true,
      path: getLocalDataDirectory(),
      sharePath: getShareDataDirectory(),
      state: readLocalDataState(),
      archives: listLocalDataArchives(),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:save-local-data-archive', (_event, payload) => {
  try {
    if (!payload || payload.type !== 'def.localdata.archive.v1') {
      return { ok: false, error: '存档 payload 无效' };
    }
    const { storageScope: requestedStorageScope, source, scope, ...archivePayload } = payload;
    const archive = {
      ...archivePayload,
      id: sanitizeArchiveId(payload.id || payload.name),
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : sanitizeArchiveId(payload.id),
    };
    const storageScope = requestedStorageScope === 'local' || source === 'local' || scope === 'local' ? 'local' : 'share';
    const filePath = resolveLocalDataPath({ id: archive.id, storageScope });
    fs.writeFileSync(filePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf-8');
    const state = writeLocalDataState(path.basename(filePath), storageScope);
    return { ok: true, path: filePath, meta: buildLocalDataMeta(filePath, archive), state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:read-local-data-archive', (_event, payload) => {
  try {
    const filePath = resolveLocalDataPath(payload);
    const archive = readLocalDataArchiveFile(filePath);
    return { ok: true, path: filePath, archive, meta: buildLocalDataMeta(filePath, archive) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:delete-local-data-archive', (_event, payload) => {
  try {
    const filePath = resolveLocalDataPath(payload);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:reveal-local-data-archive', async (_event, payload) => {
  try {
    if (payload?.id || payload?.fileName) {
      const filePath = resolveLocalDataPath(payload);
      if (!fs.existsSync(filePath)) {
        return { ok: false, error: '存档文件不存在', path: filePath };
      }
      shell.showItemInFolder(filePath);
      return { ok: true, path: filePath };
    } else {
      const directory = payload?.storageScope === 'share'
        ? ensureShareDataDirectory()
        : ensureLocalDataDirectory();
      return openDirectoryInExplorer(directory);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:request-local-data-export', async (_event, options) => {
  try {
    return await requestMainRenderer('desktop:local-data-export-request', pendingLocalDataExports, { options });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:request-local-data-import', async (_event, payload) => {
  try {
    if (!payload?.archive) {
      return { ok: false, error: '缺少导入存档' };
    }
    const result = await applyLocalDataArchiveInMainWindow(payload.archive, payload.options || {});
    if (result?.ok) {
      const archiveId = payload.archive.id || payload.fileName;
      const fileName = payload.fileName || (archiveId ? `${sanitizeArchiveId(archiveId)}.json` : null);
      if (fileName) {
        const storageScope = payload.storageScope === 'share' || payload.source === 'share' || payload.scope === 'share' ? 'share' : 'local';
        result.state = writeLocalDataState(fileName, storageScope);
      }
      reloadMainWindowAfterLocalDataImport();
    }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:complete-local-data-export', (_event, payload) => (
  completeLocalDataRequest(pendingLocalDataExports, payload)
));

ipcMain.handle('desktop:complete-local-data-import', (_event, payload) => (
  completeLocalDataRequest(pendingLocalDataImports, payload)
));

ipcMain.handle('desktop:run-action', (_event, action) => {
  switch (action) {
    case 'capture-probe':
      return {
        ok: true,
        title: 'Capture',
        detail: 'Maa Win32 controller capture pipeline is ready. Use the shell capture panel to select a MaaEnd preset and grab frames.',
      };
    case 'vision-probe':
      return {
        ok: true,
        title: 'Vision',
        detail: 'Vision pipeline placeholder is wired. MaaEnd recognition can be mounted here next.',
      };
    case 'pointer-probe':
      return {
        ok: true,
        title: 'Pointer',
        detail: 'Pointer control placeholder is wired. Native mouse backend is not attached yet.',
      };
    case 'runtime-probe':
      return {
        ok: true,
        title: 'Runtime',
        detail: `Electron desktop host is alive on ${process.platform}/${process.arch}.`,
      };
    default:
      return {
        ok: false,
        title: 'Unknown',
        detail: `Unknown shell action: ${action}`,
      };
  }
});

app.whenReady().then(() => {
  if (process.platform === 'win32' && fs.existsSync(APP_ICON_ICO_PATH)) {
    app.setAppUserModelId('com.dmg.def');
  }
  Menu.setApplicationMenu(null);
  syncImageManifest();
  createTray();
  startBridgeServer();

  if (shellOnly) {
    createMainWindow();
    hideMainWindow();
    createShellWindow();
  } else {
    createMainWindow();
    createShellWindow({ startHidden: true });
  }

  app.on('activate', () => {
    if (shellOnly) {
      restoreShellWindow();
      return;
    }
    restoreMainWindow();
  });
});

app.on('second-instance', () => {
  restoreMainWindow();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
  stopServers();
});

app.on('window-all-closed', (event) => {
  if (!isAppQuitting) {
    event.preventDefault();
  }
});
