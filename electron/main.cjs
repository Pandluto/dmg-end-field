const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const maa = require('@maaxyz/maa-node');
const {
  app,
  BrowserWindow,
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

let mainWindow = null;
let shellWindow = null;
let bridgeServer = null;
let shellStartedAt = null;
let isAppQuitting = false;
let isForceClosingMain = false;
let appTray = null;
let savedDesktopScaleKey = '1x';
let activeDesktopScaleKey = '1x';
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

function getDesktopSettingsPayload() {
  return {
    currentScale: activeDesktopScaleKey,
    savedScale: savedDesktopScaleKey,
    availableScales: Object.keys(DESKTOP_SCALE_PRESETS),
    restartRequired: activeDesktopScaleKey !== savedDesktopScaleKey,
  };
}

loadDesktopSettings();
activeDesktopScaleKey = savedDesktopScaleKey;
app.commandLine.appendSwitch(
  'force-device-scale-factor',
  DESKTOP_SCALE_PRESETS[activeDesktopScaleKey] ?? DESKTOP_SCALE_PRESETS['1x']
);

function buildWindowOptions(role, extra = {}) {
  return {
    autoHideMenuBar: true,
    useContentSize: true,
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

  appTray = new Tray(createTrayIconImage());
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
  Menu.setApplicationMenu(null);
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
