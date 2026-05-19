const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const maa = require('@maaxyz/maa-node');
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
const ARK_RESPONSE_TIMEOUT_MS = 120000;
const MAIN_CONTENT_WIDTH = 1700;
const MAIN_CONTENT_HEIGHT = 900;
const SHELL_WIDTH = 540;
const SHELL_HEIGHT = 680;
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
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
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
      minWidth: 420,
      minHeight: 560,
      title: 'DEF Desktop Shell',
      show: !startHidden,
      backgroundColor: '#edf5ee',
    })
  );
  shellStartedAt = Date.now();

  if (isDev) {
    shellWindow.loadURL(DEV_SHELL_URL);
  } else {
    shellWindow.loadFile(path.join(__dirname, 'shell', 'index.html'));
  }

  shellWindow.webContents.on('did-finish-load', () => {
    lockWindowZoom(shellWindow);
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

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, buildJsonHeaders());
  response.end(JSON.stringify(payload));
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
    mode: isDev ? 'vite' : 'electron',
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

  bridgeServer = http.createServer((request, response) => {
    const method = request.method || 'GET';
    const requestUrl = new URL(request.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);

    if (method === 'OPTIONS') {
      response.writeHead(204, buildJsonHeaders());
      response.end();
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(response, 200, getBridgeHealth());
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

    // ── User-image serving (read-only, no path rules in bridge) ──
    if (method === 'GET' && requestUrl.pathname.startsWith('/user-images/')) {
      const userDir = getUserImagesDir();
      const relPath = decodeURIComponent(requestUrl.pathname.replace(/^\/user-images\//, ''));
      // Reject path traversal
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

    writeJson(response, 404, {
      ok: false,
      error: 'not-found',
      path: requestUrl.pathname,
    });
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
  return path.join(__dirname, '..', 'dist', 'assets');
}

/** Builtin (read-only) asset root: public/assets (dev) or dist/assets (prod). */
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
  const dir = path.join(app.getPath('userData'), 'user-images');
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
  if (fs.existsSync(builtinAssetsRoot)) {
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

ipcMain.handle('desktop:list-image-assets', () => {
  return scanAllImageAssets();
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

ipcMain.handle('desktop:rename-image-directory', (_event, payload) => {
  const { dirPath, newName } = payload || {};
  if (!dirPath || typeof dirPath !== 'string' || !newName || typeof newName !== 'string') {
    return { ok: false, error: '缺少参数' };
  }

  const cleanName = newName.trim();
  if (/[<>:"|?*\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
    return { ok: false, error: `非法文件夹名: "${cleanName}"` };
  }

  // dirPath is relative to managed dir, e.g. "sub1" or "sub1/nested"
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
});

ipcMain.handle('desktop:reveal-in-explorer', async (_event, payload) => {
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

    // Try user dir first, then builtin
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
});

ipcMain.handle('desktop:rename-image-asset', (_event, payload) => {
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
});

ipcMain.handle('desktop:delete-image-asset', (_event, payload) => {
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
});

ipcMain.handle('desktop:import-image-assets-from-browser', (_event, payload) => {
  const { items, targetDir } = payload || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, results: [], error: '缺少文件数据' };
  }

  const IMG_EXT_RE = /\.(png|jpg|jpeg|webp|gif|svg)$/i;
  const managedDir = getManagedDir();

  // Resolve target directory
  let destDir = managedDir;
  if (targetDir && typeof targetDir === 'string' && targetDir.trim().length > 0) {
    const normalized = targetDir.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    // Prevent path traversal
    if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
      return { ok: false, results: [], error: '非法目录路径' };
    }
    destDir = path.join(managedDir, normalized);
    // Ensure destDir is still within managedDir
    const resolvedDest = path.resolve(destDir);
    const resolvedManaged = path.resolve(managedDir);
    if (!resolvedDest.startsWith(resolvedManaged + path.sep) && resolvedDest !== resolvedManaged) {
      return { ok: false, results: [], error: '越权目录访问' };
    }
  }

  // Ensure target directory exists
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

    // Validate file name: no path separators, no traversal
    const cleanName = path.basename(fileName);
    if (cleanName !== fileName || fileName.includes('..') || fileName.startsWith('/') || fileName.startsWith('\\')) {
      results.push({ fileName, ok: false, error: '非法文件名' });
      continue;
    }

    // Validate extension
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
});

ipcMain.handle('desktop:create-image-directory', (_event, payload) => {
  const { dirName, parentDir } = payload || {};
  if (!dirName || typeof dirName !== 'string' || dirName.trim().length === 0) {
    return { ok: false, error: '请输入文件夹名' };
  }

  const cleanName = dirName.trim();
  // Reject illegal directory names
  if (/[<>:"|?*\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
    return { ok: false, error: `非法文件夹名: "${cleanName}"` };
  }

  const managedDir = getManagedDir();

  // Resolve parent directory
  let parentPath = managedDir;
  if (parentDir && typeof parentDir === 'string' && parentDir.trim().length > 0) {
    const normalized = parentDir.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    // Prevent path traversal
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

  // Return the path relative to managed dir
  const createdRel = path.relative(managedDir, newDirPath).replace(/\\/g, '/');

  return { ok: true, createdPath: createdRel };
});

ipcMain.handle('desktop:delete-image-directory', (_event, payload) => {
  const { relativePath } = payload || {};
  if (!relativePath || typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    return { ok: false, error: '缺少目录路径' };
  }

  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

  // Reject root managed dir deletion
  if (normalized === '' || normalized === '.') {
    return { ok: false, error: '禁止删除根目录' };
  }

  // Prevent path traversal
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) {
    return { ok: false, error: '非法目录路径' };
  }

  const managedDir = getManagedDir();
  const targetPath = path.join(managedDir, normalized);
  const resolvedTarget = path.resolve(targetPath);
  const resolvedManaged = path.resolve(managedDir);

  // Ensure target is within managed dir
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

  // Recursively scan for non-writable / locked files
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
        // Real writability check: try W_OK access
        let writable = true;
        try {
          fs.accessSync(fullPath, fs.constants.W_OK);
        } catch {
          writable = false;
        }
        // Also check read-only attribute on Windows
        if (writable && process.platform === 'win32') {
          try {
            const fileStat = fs.statSync(fullPath);
            // Windows: readonly attribute = 0o444 or check mode bits
            // fs.statSync doesn't expose Windows attributes directly,
            // but if the file is read-only, W_OK access would have failed above.
            // Double-check via mode: if user-write bit is missing, it's locked.
            // eslint-disable-next-line no-bitwise
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

  // Delete recursively
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `删除目录失败: ${err.message}` };
  }

  syncImageManifest();

  return { ok: true };
});

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
