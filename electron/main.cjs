const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { tryServeDesktopApp } = require('./web-host.cjs');
const { createAiTimelineWorkNodeStore } = require('./ai-timeline-work-node-store.cjs');
const { createTimelineRepository } = require('./timeline-repository.cjs');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Tray,
  net,
  nativeImage,
  shell,
} = require('electron');

const DEV_SHELL_URL = 'http://127.0.0.1:3030/shell/index.html';
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 31457;
const PROD_SHELL_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}/shell/index.html`;
const SHELL_WIDTH = 1120;
const SHELL_HEIGHT = 760;
const SHELL_MIN_WIDTH = 900;
const SHELL_MIN_HEIGHT = 640;
const isDev = process.argv.includes('--dev');
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const DEFAULT_DESKTOP_SCALE_KEY = process.platform === 'darwin' ? '0.85x' : '1x';
const DESKTOP_SCALE_PRESETS = {
  '0.8x': '0.8',
  '0.85x': '0.85',
  '1x': '1',
  '1.25x': '1.25',
  '1.5x': '1.5',
};
app.commandLine.appendSwitch('high-dpi-support', '1');
const APP_ICON_PNG_PATH = path.join(__dirname, 'assets', 'icon.png');
const APP_ICON_ICO_PATH = path.join(__dirname, 'assets', 'icon.ico');

let shellWindow = null;
let webPrewarmWindow = null;
let bridgeServer = null;
let shellStartedAt = null;
let aiCliRestProcess = null;
let aiCliRestStartedAt = null;
let defAgentProcess = null;
let defAgentStartedAt = null;
let isAppQuitting = false;
let appTray = null;
const workbenchTestUiClients = new Set();
const workbenchTestUiEventHistory = [];
let savedDesktopScaleKey = DEFAULT_DESKTOP_SCALE_KEY;
let activeDesktopScaleKey = DEFAULT_DESKTOP_SCALE_KEY;
let startupWarmupScheduled = false;
const imageUpdateState = {
  status: 'idle',
  currentVersion: null,
  latestVersion: null,
  latestSummary: null,
  lastCheckedAt: null,
  lastUpdatedAt: null,
  lastError: '',
  configuredManifestUrl: '',
  progress: null,
};
let imageAssetCache = null;

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

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

function getDesktopSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadDesktopSettings() {
  try {
    const filePath = getDesktopSettingsPath();
    if (!fs.existsSync(filePath)) {
      savedDesktopScaleKey = DEFAULT_DESKTOP_SCALE_KEY;
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    savedDesktopScaleKey =
      typeof parsed.desktopScale === 'string' && DESKTOP_SCALE_PRESETS[parsed.desktopScale]
        ? parsed.desktopScale
        : DEFAULT_DESKTOP_SCALE_KEY;
  } catch {
    savedDesktopScaleKey = DEFAULT_DESKTOP_SCALE_KEY;
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
    scaleMode: 'webContents',
    restartRequired: false,
    defaultScale: DEFAULT_DESKTOP_SCALE_KEY,
  };
}

loadDesktopSettings();
activeDesktopScaleKey = savedDesktopScaleKey;

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

  const shellVisible = getShellVisibilityState() === 'visible';
  appTray.setToolTip(shellVisible ? 'DEF Shell 已打开' : 'DEF Shell 后台运行中');
  appTray.setContextMenu(
    Menu.buildFromTemplate([
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
    restoreShellWindow();
  });
  updateTrayMenu();
}

function getScaleFactor(scaleKey) {
  const rawScale = DESKTOP_SCALE_PRESETS[scaleKey] ?? DESKTOP_SCALE_PRESETS[DEFAULT_DESKTOP_SCALE_KEY];
  const parsed = Number.parseFloat(rawScale);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function getScaledShellContentSize(scaleKey) {
  const scale = getScaleFactor(scaleKey);
  return {
    width: Math.round(SHELL_WIDTH * scale),
    height: Math.round(SHELL_HEIGHT * scale),
  };
}

function applyShellWindowContentSize(windowInstance, scaleKey) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return;
  }

  const { width, height } = getScaledShellContentSize(scaleKey);
  windowInstance.setMinimumSize(width, height);
  windowInstance.setContentSize(width, height);
}

function applyWebContentsScale(windowInstance, scaleKey) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return;
  }

  const { webContents } = windowInstance;
  webContents.setZoomFactor(getScaleFactor(scaleKey));
  webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
}

function applyDesktopScaleToOpenWindows() {
  applyShellWindowContentSize(shellWindow, activeDesktopScaleKey);
  applyWebContentsScale(shellWindow, activeDesktopScaleKey);
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

  const shellContentSize = getScaledShellContentSize(activeDesktopScaleKey);
  shellWindow = new BrowserWindow(
    buildWindowOptions('shell', {
      width: shellContentSize.width,
      height: shellContentSize.height,
      minWidth: Math.min(shellContentSize.width, SHELL_MIN_WIDTH),
      minHeight: Math.min(shellContentSize.height, SHELL_MIN_HEIGHT),
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
    applyShellWindowContentSize(shellWindow, activeDesktopScaleKey);
    applyWebContentsScale(shellWindow, activeDesktopScaleKey);
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

function getBrowserWebUrl() {
  return isDev ? 'http://127.0.0.1:3030/' : `http://${BRIDGE_HOST}:${BRIDGE_PORT}/`;
}

function destroyWebPrewarmWindow() {
  if (!webPrewarmWindow || webPrewarmWindow.isDestroyed()) {
    webPrewarmWindow = null;
    return;
  }
  webPrewarmWindow.destroy();
  webPrewarmWindow = null;
}

function warmWebAppInHiddenWindow() {
  if (webPrewarmWindow && !webPrewarmWindow.isDestroyed()) {
    return;
  }

  const url = getBrowserWebUrl();
  const startedAt = Date.now();
  webPrewarmWindow = new BrowserWindow(
    buildWindowOptions('web-prewarm', {
      width: 420,
      height: 320,
      show: false,
      skipTaskbar: true,
      title: 'DEF Web Prewarm',
      backgroundColor: '#ffffff',
    })
  );
  webPrewarmWindow.webContents.setAudioMuted(true);
  webPrewarmWindow.on('closed', () => {
    webPrewarmWindow = null;
  });
  webPrewarmWindow.webContents.once('did-finish-load', () => {
    appendRuntimeLog('web-prewarm', `did-finish-load elapsedMs=${Date.now() - startedAt} url=${url}`);
    setTimeout(destroyWebPrewarmWindow, 1500);
  });
  webPrewarmWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendRuntimeLog('web-prewarm', `did-fail-load ${errorCode} ${errorDescription || '-'} ${validatedURL || url}`);
    destroyWebPrewarmWindow();
  });
  webPrewarmWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    appendRuntimeLog('web-prewarm-console', `${level} ${sourceId || '-'}:${line || 0} ${message}`);
  });
  setTimeout(() => {
    if (webPrewarmWindow && !webPrewarmWindow.isDestroyed()) {
      appendRuntimeLog('web-prewarm', `timeout elapsedMs=${Date.now() - startedAt} url=${url}`);
      destroyWebPrewarmWindow();
    }
  }, 30000);
  appendRuntimeLog('web-prewarm', `loadURL ${url}`);
  webPrewarmWindow.loadURL(url).catch((error) => {
    appendRuntimeLog('web-prewarm', `loadURL failed ${error instanceof Error ? error.message : String(error)}`);
    destroyWebPrewarmWindow();
  });
}

function warmImageAssetCache(reason = 'startup') {
  const startedAt = Date.now();
  try {
    const cache = getImageAssetCache();
    appendRuntimeLog('assets-prewarm', `${reason} ready count=${cache.list.length} elapsedMs=${Date.now() - startedAt}`);
  } catch (error) {
    appendRuntimeLog('assets-prewarm', `${reason} failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

function scheduleStartupWarmups() {
  if (startupWarmupScheduled) {
    return;
  }
  startupWarmupScheduled = true;
  setTimeout(warmWebAppInHiddenWindow, 300);
  setTimeout(() => warmImageAssetCache('startup'), 1200);
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

function writeSseHeaders(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function writeSse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastWorkbenchTestUiEvent(eventName, payload) {
  workbenchTestUiEventHistory.push({ eventName, payload });
  if (workbenchTestUiEventHistory.length > 20) {
    workbenchTestUiEventHistory.splice(0, workbenchTestUiEventHistory.length - 20);
  }
  for (const client of workbenchTestUiClients) {
    try {
      writeSse(client, eventName, payload);
    } catch {
      workbenchTestUiClients.delete(client);
    }
  }
}

function tryServeUserImageByRequestPath({ method, requestPath, response }) {
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }
  let relPath = '';
  try {
    relPath = decodeURIComponent(requestPath || '').replace(/^\/+/, '');
  } catch {
    response.writeHead(400);
    response.end(method === 'HEAD' ? '' : 'Bad Request');
    return true;
  }
  if (/(^|\/)\.\.(\/|$)/.test(relPath) || relPath.includes('\\')) {
    response.writeHead(403);
    response.end(method === 'HEAD' ? '' : 'Forbidden');
    return true;
  }
  const absPath = resolveUserImageFileByRequestPath(relPath);
  if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return false;
  }
  const ext = path.extname(absPath).toLowerCase();
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
    response.end(method === 'HEAD' ? '' : data);
  } catch {
    response.writeHead(500);
    response.end(method === 'HEAD' ? '' : 'Internal Server Error');
  }
  return true;
}

function tryServeAssetUserImageFallback({ method, requestUrl, response }) {
  const assetPath = String(requestUrl.pathname || '').replace(/^\/assets\/?/, '');
  if (!assetPath || /(^|\/)\.\.(\/|$)/.test(assetPath) || assetPath.includes('\\')) {
    return false;
  }
  const fallbackPaths = [];
  if (assetPath.startsWith('images/')) {
    fallbackPaths.push(assetPath.slice('images/'.length));
  }
  fallbackPaths.push(assetPath);
  fallbackPaths.push(path.posix.basename(assetPath));

  for (const fallbackPath of Array.from(new Set(fallbackPaths.filter(Boolean)))) {
    if (tryServeUserImageByRequestPath({ method, requestPath: fallbackPath, response })) {
      return true;
    }
  }
  return false;
}

function tryServeGenericUserImageFallback({ method, requestUrl, response }) {
  if (!/\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(requestUrl.pathname || '')) {
    return false;
  }
  const imagePath = String(requestUrl.pathname || '').replace(/^\/+/, '');
  if (!imagePath || /(^|\/)\.\.(\/|$)/.test(imagePath) || imagePath.includes('\\')) {
    return false;
  }
  const fallbackPaths = [imagePath];
  if (imagePath.startsWith('public/')) {
    fallbackPaths.push(imagePath.slice('public/'.length));
  }
  if (imagePath.startsWith('assets/images/')) {
    fallbackPaths.push(imagePath.slice('assets/images/'.length));
  }
  if (imagePath.startsWith('images/')) {
    fallbackPaths.push(imagePath.slice('images/'.length));
  }
  fallbackPaths.push(path.posix.basename(imagePath));

  for (const fallbackPath of Array.from(new Set(fallbackPaths.filter(Boolean)))) {
    if (tryServeUserImageByRequestPath({ method, requestPath: fallbackPath, response })) {
      return true;
    }
  }
  return false;
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
  const shellContentSize = getScaledShellContentSize(activeDesktopScaleKey);
  return {
    running: Boolean(shellWindow && !shellWindow.isDestroyed()),
    pid: process.pid,
    startedAt: shellWindow && !shellWindow.isDestroyed() ? shellStartedAt : null,
    minimized: Boolean(shellWindow && !shellWindow.isDestroyed() && shellWindow.isMinimized()),
    visible: Boolean(shellWindow && !shellWindow.isDestroyed() && shellWindow.isVisible()),
    width: shellContentSize.width,
    height: shellContentSize.height,
    baseWidth: SHELL_WIDTH,
    baseHeight: SHELL_HEIGHT,
    state: getShellVisibilityState(),
  };
}

function isAiCliRestRunning() {
  return Boolean(aiCliRestProcess && aiCliRestProcess.exitCode === null && !aiCliRestProcess.killed);
}

function isDefAgentRunning() {
  return Boolean(defAgentProcess && defAgentProcess.exitCode === null && !defAgentProcess.killed);
}

function getAiCliRestRuntimeInfo() {
  return {
    running: isAiCliRestRunning(),
    pid: aiCliRestProcess?.pid ?? null,
    startedAt: aiCliRestStartedAt,
    url: 'http://127.0.0.1:17321',
  };
}

function getDefAgentRuntimeInfo() {
  return {
    running: isDefAgentRunning(),
    pid: defAgentProcess?.pid ?? null,
    startedAt: defAgentStartedAt,
    url: 'http://127.0.0.1:17322',
  };
}

function getBridgeHealth() {
  return {
    ok: true,
    service: 'def-local-bridge',
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    shell: getShellRuntimeInfo(),
    aiCliRest: getAiCliRestRuntimeInfo(),
    defAgent: getDefAgentRuntimeInfo(),
    desktopSettings: getDesktopSettingsPayload(),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAiCliRestHealth(expectedPid, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await fetchJsonUrl('http://127.0.0.1:17321/health');
      if (health.status === 200 && health.body?.ok === true && health.body?.pid === expectedPid) {
        return health.body;
      }
    } catch {
      // Keep polling until the process has finished Vite SSR startup.
    }
    await delay(250);
  }
  throw new Error(`AI CLI REST health check timed out for pid ${expectedPid}`);
}

function waitForProcessExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve({ exited: true });
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve({ exited: false, reason: 'timeout' });
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    const onExit = (code, signal) => {
      cleanup();
      resolve({ exited: true, code, signal });
    };
    child.once('exit', onExit);
  });
}

function killProcessTree(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return result.status === 0;
    }
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
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

      if (method === 'GET' && requestUrl.pathname === '/image-assets/roots') {
        writeJson(response, 200, listImageRoots());
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

      if (method === 'POST' && requestUrl.pathname === '/local-data/active') {
        const payload = await readJsonRequest(request);
        const filePath = resolveLocalDataPath({
          fileName: payload?.fileName,
          id: payload?.id,
          storageScope: payload?.storageScope,
        });
        const archive = readLocalDataArchiveFile(filePath);
        const state = writeLocalDataState(path.basename(filePath), payload?.storageScope === 'share' ? 'share' : 'local');
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

      if (method === 'GET' && requestUrl.pathname === '/local-data/ai-timeline-worknodes') {
        writeJson(response, 200, buildAiTimelineWorkNodeListResult());
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/timeline-documents') {
        writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), documents: getTimelineRepository().listDocuments() });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/timeline-documents') {
        const payload = await readJsonRequest(request);
        writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), document: getTimelineRepository().ensureDocument(payload) });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/timeline-bundles/import') {
        const payload = await readJsonRequest(request);
        try {
          writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), ...getTimelineRepository().importDocumentBundle(payload) });
        } catch (error) {
          writeJson(response, error?.status || (error?.code?.includes('timeline-bundle') ? 400 : 500), {
            ok: false,
            error: { code: error?.code || 'timeline-bundle-import-failed', message: error instanceof Error ? error.message : String(error) },
          });
        }
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/timeline-bundles/export') {
        const timelineId = requestUrl.searchParams.get('timelineId') || '';
        if (!timelineId) {
          writeJson(response, 400, { ok: false, error: { code: 'missing-timeline-id', message: 'Timeline bundle export requires timelineId.' } });
          return;
        }
        try {
          writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), ...getTimelineRepository().exportDocumentBundle(timelineId) });
        } catch (error) {
          writeJson(response, error?.status || 500, { ok: false, error: { code: error?.code || 'timeline-bundle-export-failed', message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/timeline-snapshots') {
        const timelineId = requestUrl.searchParams.get('timelineId') || '';
        if (!timelineId) {
          writeJson(response, 400, { ok: false, error: { code: 'missing-timeline-id', message: 'Timeline snapshot list requires timelineId.' } });
          return;
        }
        writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), snapshots: getTimelineRepository().listSnapshots(timelineId) });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/local-data/timeline-work-nodes') {
        const timelineId = requestUrl.searchParams.get('timelineId') || '';
        if (!timelineId) {
          writeJson(response, 400, { ok: false, error: { code: 'missing-timeline-id', message: 'Timeline work node list requires timelineId.' } });
          return;
        }
        writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), nodes: getTimelineRepository().listWorkNodes(timelineId) });
        return;
      }

      const timelineWorkNodePatchMatch = /^\/local-data\/timeline-work-nodes\/([^/]+)\/patches$/.exec(requestUrl.pathname);
      if (method === 'GET' && timelineWorkNodePatchMatch) {
        writeJson(response, 200, {
          ok: true,
          path: getTimelineRepositoryPath(),
          patches: getTimelineRepository().listWorkNodePatches(
            decodeURIComponent(timelineWorkNodePatchMatch[1]),
            requestUrl.searchParams.get('limit'),
          ),
        });
        return;
      }

      const timelineWorkNodeDeleteMatch = /^\/local-data\/timeline-work-nodes\/([^/]+)\/delete$/.exec(requestUrl.pathname);
      if (method === 'POST' && timelineWorkNodeDeleteMatch) {
        try {
          writeJson(response, 200, { ok: true, result: getTimelineRepository().deleteWorkNodeSubtree(decodeURIComponent(timelineWorkNodeDeleteMatch[1])) });
        } catch (error) {
          writeJson(response, error?.status || 500, { ok: false, error: { code: error?.code || 'timeline-work-node-delete-failed', message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/timeline-snapshots') {
        const payload = await readJsonRequest(request);
        writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), ...getTimelineRepository().createOrReuseSnapshot(payload) });
        return;
      }

      const timelineSnapshotArchiveMatch = /^\/local-data\/timeline-snapshots\/([^/]+)\/archive$/.exec(requestUrl.pathname);
      if (method === 'POST' && timelineSnapshotArchiveMatch) {
        try {
          writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), result: getTimelineRepository().archiveSnapshot(decodeURIComponent(timelineSnapshotArchiveMatch[1])) });
        } catch (error) {
          writeJson(response, error?.status || 500, { ok: false, error: { code: error?.code || 'timeline-snapshot-archive-failed', message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/timeline-checkout-ref') {
        const payload = await readJsonRequest(request);
        writeJson(response, 200, { ok: true, path: getTimelineRepositoryPath(), checkoutRef: getTimelineRepository().setCheckoutRef(payload) });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/ai-timeline-worknodes/create') {
        const payload = await readJsonRequest(request);
        writeJson(response, 200, createAiTimelineWorkNode(payload));
        return;
      }

      const aiTimelineWorkNodeMatch = /^\/local-data\/ai-timeline-worknodes\/([^/]+)(?:\/([^/]+))?$/.exec(requestUrl.pathname);
      if (aiTimelineWorkNodeMatch) {
        let nodeId = '';
        try {
          nodeId = decodeURIComponent(aiTimelineWorkNodeMatch[1]);
        } catch {
          writeJson(response, 400, { ok: false, error: 'AI work node URL contains malformed percent-encoding.' });
          return;
        }
        const action = aiTimelineWorkNodeMatch[2] || '';
        if (method === 'GET' && !action) {
          writeJson(response, 200, readAiTimelineWorkNode(nodeId));
          return;
        }
        if (method === 'GET' && action === 'diff') {
          writeJson(response, 200, buildAiTimelineWorkNodeDiff(readAiTimelineWorkNode(nodeId).node));
          return;
        }
        if (method === 'POST' && action === 'update') {
          const payload = await readJsonRequest(request);
          writeJson(response, 200, updateAiTimelineWorkNode(nodeId, payload));
          return;
        }
        if (method === 'POST' && action === 'delete') {
          try {
            writeJson(response, 200, deleteAiTimelineWorkNode(nodeId));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            writeJson(response, error?.status === 409 ? 409 : 500, {
              ok: false,
              error: {
                code: error?.code || 'ai-worknode-delete-failed',
                message,
              },
            });
          }
          return;
        }
        if (method === 'POST' && action === 'commit') {
          const payload = await readJsonRequest(request);
          writeJson(response, 200, commitAiTimelineWorkNode(nodeId, payload));
          return;
        }
        if (method === 'POST' && action === 'checkout-applied') {
          const payload = await readJsonRequest(request);
          writeJson(response, 200, markAiTimelineWorkNodeCheckoutApplied(nodeId, payload));
          return;
        }
        if (method === 'POST' && action === 'rollback-applied') {
          const payload = await readJsonRequest(request);
          writeJson(response, 200, markAiTimelineWorkNodeRollbackApplied(nodeId, payload));
          return;
        }
      }

      if (method === 'POST' && requestUrl.pathname === '/local-data/save') {
        const payload = await readJsonRequest(request);
        if (!payload || payload.type !== 'def.localdata.archive.v1') {
          writeJson(response, 400, { ok: false, error: '存档 payload 无效' });
          return;
        }
        const { storageScope: requestedStorageScope, source, scope, ...archivePayload } = payload;
        const storageScope = requestedStorageScope === 'local' || source === 'local' || scope === 'local' ? 'local' : 'share';
        const archive = {
          ...archivePayload,
          id: sanitizeArchiveId(payload.id || payload.name),
          name: typeof payload.name === 'string' && payload.name.trim()
            ? payload.name.trim()
            : sanitizeArchiveId(payload.id),
          storageScope,
        };
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

      if (method === 'POST' && requestUrl.pathname === '/open-browser-web') {
        const url = getBrowserWebUrl();
        await shell.openExternal(url);
        writeJson(response, 200, { ok: true, url });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/open-ai-cli-rest') {
        writeJson(response, 200, {
          ok: true,
          aiCliRest: await startAiCliRest(),
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/close-ai-cli-rest') {
        writeJson(response, 200, {
          ok: true,
          aiCliRest: await stopAiCliRest(),
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/open-def-agent') {
        writeJson(response, 200, {
          ok: true,
          defAgent: await startDefAgent(),
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/close-def-agent') {
        writeJson(response, 200, {
          ok: true,
          defAgent: await stopDefAgent(),
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/def-agent/deepseek-config') {
        const defAgent = await startDefAgent();
        const body = await readJsonRequest(request);
        const upstream = await postJsonUrl('http://127.0.0.1:17322/api/config/deepseek', body);
        writeJson(response, upstream.status || 500, {
          ok: upstream.status >= 200 && upstream.status < 300,
          defAgent,
          ...upstream.body,
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/def-agent/chat') {
        const defAgent = await startDefAgent();
        const body = await readJsonRequest(request);
        const upstream = await postJsonUrl('http://127.0.0.1:17322/api/chat', body);
        writeJson(response, upstream.status || 500, {
          ok: upstream.status >= 200 && upstream.status < 300,
          defAgent,
          ...upstream.body,
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/def-agent/chat/stream') {
        const defAgent = await startDefAgent();
        const body = await readJsonRequest(request);
        const upstream = await postJsonUrl('http://127.0.0.1:17322/api/chat/stream', body);
        writeJson(response, upstream.status || 500, {
          ok: upstream.status >= 200 && upstream.status < 300,
          defAgent,
          ...upstream.body,
        });
        return;
      }

      // Test-only ingress for agent ability checks: behave like the main workbench AI textbox,
      // then broadcast ui.prompt so the frontend panel can prove the turn is user-visible.
      if (method === 'POST' && requestUrl.pathname === '/def-agent/workbench-test/prompt') {
        const defAgent = await startDefAgent();
        const body = await readJsonRequest(request);
        const userText = typeof body.message === 'string' && body.message.trim()
          ? body.message.trim()
          : typeof body.prompt === 'string' && body.prompt.trim()
            ? body.prompt.trim()
            : '';
        if (!userText) {
          writeJson(response, 400, {
            ok: false,
            error: {
              code: 'missing-workbench-test-prompt',
              message: 'Body must include message or prompt.',
            },
          });
          return;
        }
        const clientTurnId = typeof body.clientTurnId === 'string' && body.clientTurnId.trim()
          ? body.clientTurnId.trim()
          : `workbench-test-${Date.now()}`;
        const thinkingEffort = chooseWorkbenchTestThinkingEffort(userText, body.thinkingEffort);
        const builtPrompt = await buildWorkbenchTestPrompt(userText);
        const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : '';
        const upstream = sessionId
          ? await postJsonUrl(`http://127.0.0.1:17322/api/chat/${encodeURIComponent(sessionId)}/message`, {
            message: builtPrompt.agentText,
            clientTurnId,
            thinkingEffort,
            skillId: 'workbench',
          })
          : await postJsonUrl('http://127.0.0.1:17322/api/chat/stream', {
            message: builtPrompt.agentText,
            clientTurnId,
            thinkingEffort,
            skillId: 'workbench',
          });
        const nextSessionId = sessionId || upstream.body?.sessionId || upstream.body?.sessionID || '';
        writeJson(response, upstream.status || 500, {
          ok: upstream.status >= 200 && upstream.status < 300,
          defAgent,
          workbenchTest: {
            prompt: userText,
            clientTurnId,
            thinkingEffort,
            snapshotAvailable: builtPrompt.snapshotAvailable,
            evidenceAvailable: builtPrompt.evidenceAvailable,
            sessionId: nextSessionId || null,
            eventsUrl: nextSessionId ? `http://${BRIDGE_HOST}:${BRIDGE_PORT}/def-agent/chat/${encodeURIComponent(nextSessionId)}/events` : null,
            transcriptUrl: nextSessionId ? `http://${BRIDGE_HOST}:${BRIDGE_PORT}/def-agent/chat/${encodeURIComponent(nextSessionId)}/transcript` : null,
            mode: sessionId ? 'continue' : 'stream',
          },
          ...upstream.body,
        });
        if (nextSessionId) {
          broadcastWorkbenchTestUiEvent('ui.prompt', {
            at: Date.now(),
            prompt: userText,
            clientTurnId,
            thinkingEffort,
            sessionId: nextSessionId,
            sessionID: nextSessionId,
            mode: sessionId ? 'continue' : 'stream',
            snapshotAvailable: builtPrompt.snapshotAvailable,
            evidenceAvailable: builtPrompt.evidenceAvailable,
          });
        }
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/def-agent/workbench-test/ui-events') {
        writeSseHeaders(response);
        workbenchTestUiClients.add(response);
        response.write(': connected\n\n');
        writeSse(response, 'ready', {
          ok: true,
          at: Date.now(),
          clients: workbenchTestUiClients.size,
        });
        for (const event of workbenchTestUiEventHistory) {
          writeSse(response, event.eventName, {
            ...event.payload,
            replay: true,
          });
        }
        request.on('close', () => {
          workbenchTestUiClients.delete(response);
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/def-agent/chat/sessions') {
        await startDefAgent();
        const upstream = await fetchJsonUrl('http://127.0.0.1:17322/api/chat/sessions');
        writeJson(response, upstream.status || 500, upstream.body);
        return;
      }

      if (method === 'GET' && requestUrl.pathname === '/def-agent/chat/persisted-sessions') {
        await startDefAgent();
        const limit = requestUrl.searchParams.get('limit');
        const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : '';
        const upstream = await fetchJsonUrl(`http://127.0.0.1:17322/api/chat/persisted-sessions${suffix}`);
        writeJson(response, upstream.status || 500, upstream.body);
        return;
      }

      const defAgentEventsMatch = /^\/def-agent\/chat\/([^/]+)\/events$/.exec(requestUrl.pathname);
      if (method === 'GET' && defAgentEventsMatch) {
        await startDefAgent();
        const sessionID = encodeURIComponent(decodeURIComponent(defAgentEventsMatch[1]));
        const from = requestUrl.searchParams.get('from');
        const suffix = from ? `?from=${encodeURIComponent(from)}` : '';
        proxySseUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/events${suffix}`, request, response);
        return;
      }

      const defAgentPersistedMatch = /^\/def-agent\/chat\/([^/]+)\/persisted$/.exec(requestUrl.pathname);
      if (method === 'GET' && defAgentPersistedMatch) {
        await startDefAgent();
        const sessionID = encodeURIComponent(decodeURIComponent(defAgentPersistedMatch[1]));
        const upstream = await fetchJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/persisted`);
        writeJson(response, upstream.status || 500, upstream.body);
        return;
      }

      const defAgentTranscriptMatch = /^\/def-agent\/chat\/([^/]+)\/transcript$/.exec(requestUrl.pathname);
      if (method === 'GET' && defAgentTranscriptMatch) {
        await startDefAgent();
        const sessionID = encodeURIComponent(decodeURIComponent(defAgentTranscriptMatch[1]));
        const upstream = await fetchJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/transcript`, {
          timeoutMs: 60000,
          retries: 0,
        });
        writeJson(response, upstream.status || 500, upstream.body);
        return;
      }

      const defAgentMessageMatch = /^\/def-agent\/chat\/([^/]+)\/message$/.exec(requestUrl.pathname);
      if (method === 'POST' && defAgentMessageMatch) {
        const defAgent = await startDefAgent();
        const body = await readJsonRequest(request);
        const sessionID = encodeURIComponent(decodeURIComponent(defAgentMessageMatch[1]));
        const upstream = await postJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/message`, body);
        writeJson(response, upstream.status || 500, {
          ok: upstream.status >= 200 && upstream.status < 300,
          defAgent,
          ...upstream.body,
        });
        return;
      }

      const defAgentStopMatch = /^\/def-agent\/chat\/([^/]+)\/stop$/.exec(requestUrl.pathname);
      if (method === 'POST' && defAgentStopMatch) {
        const defAgent = await startDefAgent();
        const sessionID = encodeURIComponent(decodeURIComponent(defAgentStopMatch[1]));
        const upstream = await postJsonUrl(`http://127.0.0.1:17322/api/chat/${sessionID}/stop`, {});
        writeJson(response, upstream.status || 500, {
          ok: upstream.status >= 200 && upstream.status < 300,
          defAgent,
          ...upstream.body,
        });
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/def-agent/chat/stop') {
        const defAgent = await startDefAgent();
        const upstream = await postJsonUrl('http://127.0.0.1:17322/api/chat/stop', {});
        writeJson(response, upstream.status || 500, {
          ok: upstream.status >= 200 && upstream.status < 300,
          defAgent,
          ...upstream.body,
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

      if (method === 'POST' && requestUrl.pathname === '/image-assets/add-root') {
        writeJson(response, 200, await handleAddImageRoot());
        return;
      }

      if (method === 'POST' && requestUrl.pathname === '/image-assets/remove-root') {
        writeJson(response, 200, handleRemoveImageRoot(await readJsonRequest(request)));
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
        const relPath = requestUrl.pathname.replace(/^\/user-images\//, '');
        if (!tryServeUserImageByRequestPath({ method, requestPath: relPath, response })) {
          response.writeHead(404);
          response.end('Not Found');
        }
        return;
      }

      if (requestUrl.pathname.startsWith('/assets/') &&
        /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(requestUrl.pathname)) {
        const activeReleaseRoot = getActiveImageReleaseRoot();
        if (activeReleaseRoot && tryServeStaticFromRoot({
          method,
          requestUrl,
          response,
          rootDir: activeReleaseRoot,
          urlPrefix: '/assets/',
          cacheControl: 'no-store, max-age=0',
        })) {
          return;
        }
        if (tryServeAssetUserImageFallback({ method, requestUrl, response })) {
          return;
        }
      }

      if (tryServeGenericUserImageFallback({ method, requestUrl, response })) {
        return;
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
  stopAiCliRest();
  stopDefAgent();
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
  desktopSettings: getDesktopSettingsPayload(),
  imageUpdate: getImageUpdateStatePayload(),
}));
ipcMain.handle('desktop:get-settings', () => getDesktopSettingsPayload());
ipcMain.handle('desktop:set-scale', (_event, scaleKey) => {
  if (typeof scaleKey !== 'string' || !DESKTOP_SCALE_PRESETS[scaleKey]) {
    throw new Error(`Unsupported desktop scale: ${scaleKey}`);
  }

  savedDesktopScaleKey = scaleKey;
  activeDesktopScaleKey = scaleKey;
  saveDesktopSettings();
  applyDesktopScaleToOpenWindows();
  return getDesktopSettingsPayload();
});
ipcMain.handle('desktop:quit-app', () => {
  app.quit();
  return { ok: true };
});
ipcMain.handle('desktop:get-image-update-state', () => getImageUpdateStatePayload());
ipcMain.handle('desktop:set-image-update-config', (_event, payload) => {
  const config = writeImageReleaseConfig(payload);
  return {
    ok: true,
    config,
    state: getImageUpdateStatePayload(),
  };
});
ipcMain.handle('desktop:check-image-update', async () => {
  const state = await checkForImageReleaseUpdates();
  return { ok: true, state };
});
ipcMain.handle('desktop:apply-image-update', async () => {
  const state = await applyImageReleaseUpdate();
  return { ok: true, state };
});
ipcMain.handle('desktop:force-clear-image-update', async () => {
  const state = await forceClearImageUpdate();
  return { ok: true, state };
});
ipcMain.handle('desktop:pick-image-release-source-dir', async () => {
  const win = BrowserWindow.getFocusedWindow() || shellWindow;
  if (!win) return { ok: false, error: '无活动窗口' };
  const result = await dialog.showOpenDialog(win, {
    title: '选择图片资源源目录',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true, error: '已取消' };
  }
  return { ok: true, path: result.filePaths[0] };
});
ipcMain.handle('desktop:pick-image-release-output-dir', async () => {
  const win = BrowserWindow.getFocusedWindow() || shellWindow;
  if (!win) return { ok: false, error: '无活动窗口' };
  const result = await dialog.showOpenDialog(win, {
    title: '选择发布包输出目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true, error: '已取消' };
  }
  return { ok: true, path: result.filePaths[0] };
});
ipcMain.handle('desktop:build-image-release-package', async (_event, payload) => {
  try {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'build-image-release-manifest.mjs');
    const mod = await import(pathToFileURL(scriptPath).href);
    const result = mod.buildImageReleasePackage({
      source: payload?.source,
      output: payload?.output,
      assetVersion: payload?.assetVersion,
      releaseTag: payload?.releaseTag,
      minShellVersion: payload?.minShellVersion,
    });
    appendRuntimeLog('assets-release-builder', `built ${result.mode} ${result.assetVersion} -> ${result.outputDir}`);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendRuntimeLog('assets-release-builder', `failed ${message}`);
    return { ok: false, error: message };
  }
});
ipcMain.handle('desktop:reveal-path', async (_event, payload) => {
  const targetPath = typeof payload?.path === 'string' ? payload.path.trim() : '';
  if (!targetPath) {
    return { ok: false, error: '缺少路径' };
  }
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, error: '路径不存在' };
  }
  const openPath = fs.statSync(resolvedPath).isDirectory() ? resolvedPath : path.dirname(resolvedPath);
  const err = await shell.openPath(openPath);
  if (err) {
    return { ok: false, error: err };
  }
  return { ok: true, path: openPath };
});

// ── Image asset management ──

const MANAGED_SUBDIR = 'assets/images';
const IMAGE_RELEASE_MANIFEST_NAME = 'assets-release-manifest.json';
const IMAGE_RELEASE_CONFIG_NAME = 'image-release-config.json';
const IMAGE_RELEASE_CURRENT_NAME = 'current.json';
const IMAGE_RELEASE_ROOT_DIRNAME = 'asset-releases';
const IMAGE_RELEASE_FILES_DIRNAME = 'versions';
const IMAGE_RELEASE_STAGING_DIRNAME = 'staging';
const IMAGE_RELEASE_MANIFEST_TIMEOUT_MS = 45000;
const IMAGE_RELEASE_PACKAGE_TIMEOUT_MS = 180000;
const IMAGE_RELEASE_DOWNLOAD_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_IMAGE_RELEASE_MANIFEST_URL =
  `https://github.com/Pandluto/dmg-end-field/releases/latest/download/${IMAGE_RELEASE_MANIFEST_NAME}`;
const DEFAULT_IMAGE_RELEASE_DOWNLOAD_ROOT = 'https://github.com/Pandluto/dmg-end-field/releases/download';

function getImageReleaseRoot() {
  return path.join(app.getPath('userData'), IMAGE_RELEASE_ROOT_DIRNAME);
}

function getImageReleaseVersionsDir() {
  return path.join(getImageReleaseRoot(), IMAGE_RELEASE_FILES_DIRNAME);
}

function getImageReleaseStagingDir() {
  return path.join(getImageReleaseRoot(), IMAGE_RELEASE_STAGING_DIRNAME);
}

function getImageReleaseCurrentPath() {
  return path.join(getImageReleaseRoot(), IMAGE_RELEASE_CURRENT_NAME);
}

function getImageReleaseConfigPath() {
  return path.join(app.getPath('userData'), IMAGE_RELEASE_CONFIG_NAME);
}

function ensureImageReleaseDirectories() {
  fs.mkdirSync(getImageReleaseVersionsDir(), { recursive: true });
  fs.mkdirSync(getImageReleaseStagingDir(), { recursive: true });
}

function sanitizeImageReleaseVersion(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-').slice(0, 120);
}

function getImageReleaseVersionDir(assetVersion) {
  const safeVersion = sanitizeImageReleaseVersion(assetVersion);
  if (!safeVersion) {
    throw new Error('图片资源版本无效');
  }
  return path.join(getImageReleaseVersionsDir(), safeVersion);
}

async function waitForDefAgentHealth(expectedPid, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await fetchJsonUrl('http://127.0.0.1:17322/health');
      if (health.status === 200 && health.body?.ok === true && health.body?.pid === expectedPid) {
        return health.body;
      }
    } catch {
      // Keep polling until the sidecar starts listening.
    }
    await delay(250);
  }
  throw new Error(`DEF agent health check timed out for pid ${expectedPid}`);
}

function postJsonUrl(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const requestUrl = new URL(url);
    const request = http.request({
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error('request timeout'));
    });
    request.write(body);
    request.end();
  });
}

function formatWorkbenchTestButtonLabel(button) {
  return `${button?.characterName || '未知'}-${button?.skillDisplayName || button?.skillType || '技能'}@${(button?.staffIndex || 0) + 1}-${(button?.nodeIndex ?? 0) + 1}`;
}

function chooseWorkbenchTestThinkingEffort(prompt, fallback = '') {
  if (['low', 'medium', 'high'].includes(fallback)) return fallback;
  const text = String(prompt || '');
  const complexity = [
    /每个|全部|所有|批量|队伍|重排|each|every|all|batch|team/i.test(text),
    /装备|武器|配装|gear|equipment|weapon/i.test(text),
    /Buff|buff|增益|长息/i.test(text),
    /删除|移除|回退|恢复|delete|remove|rollback|restore/i.test(text),
  ].filter(Boolean).length;
  if (complexity >= 2 || text.length > 90) return 'high';
  if (/加|删|改|换|添加|移除|计算|add|remove|set|calculate/i.test(text)) return 'medium';
  return 'low';
}

function buildWorkbenchTestAgentMessage(userText, snapshot, evidencePayload) {
  const selectedCharacters = Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters : [];
  const skillButtons = Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons : [];
  const selectedSummary = selectedCharacters.length
    ? selectedCharacters.map((character) => `${character.name || character.id}(${character.id || character.name})`).join(', ')
    : 'none';
  const buttonSummary = skillButtons.length
    ? `${skillButtons.slice(0, 40).map(formatWorkbenchTestButtonLabel).join(', ')}${skillButtons.length > 40 ? `，另有 ${skillButtons.length - 40} 个` : ''}`
    : 'none';
  const fullEvidence = evidencePayload?.evidence || {
    source: 'current-checkout-snapshot',
    readonly: true,
    snapshotAvailable: Boolean(snapshot),
  };
  const evidence = {
    ...fullEvidence,
    buttons: Array.isArray(fullEvidence.buttons) ? fullEvidence.buttons.slice(0, 40) : [],
    mentionedCharacterButtons: Array.isArray(fullEvidence.mentionedCharacterButtons)
      ? fullEvidence.mentionedCharacterButtons.slice(0, 40)
      : [],
    damageReport: fullEvidence.damageReport ? {
      ...fullEvidence.damageReport,
      buttons: Array.isArray(fullEvidence.damageReport.buttons) ? fullEvidence.damageReport.buttons.slice(0, 20) : [],
    } : null,
  };

  return [
    'For “先不要应用” / “do not apply yet”, create a persisted Work Node draft with checkout:false and dryRun:false so diff evidence remains reviewable. Use dryRun:true only when the user explicitly asks for a preview or simulation.',
    '你正在 dmg-end-field 主界面右侧 AI 模式中。当前请求来自 workbench-test REST 投喂入口，语义等同用户在主界面 AI 输入框发送一句话。',
    '回复中文，简短，直接说明你做了什么或为什么需要反问。',
    '优先使用 DEF typed tools，不要优先手写 /api/main-workbench/commands/enqueue。',
    '工具入口：',
    '- GET http://127.0.0.1:17321/api/def-tools',
    '- GET http://127.0.0.1:17321/api/def-tools/describe?name=<toolName>',
    '- POST http://127.0.0.1:17321/api/def-tools/call with {"tool":"def.workbench.find_buttons","input":{...}}',
    '读状态优先用 def.workbench.list_buttons / def.workbench.evidence / def.workbench.damage_report。',
    '指代解析优先用 def.workbench.find_buttons、def.character.resolve、def.skill.resolve、def.buff.resolve。',
    '用户问装备套装/长息是什么/有哪些/该选哪个时，优先用 def.gear.resolve 或 def.equipment.resolve 的短摘要；不要直接拉完整 /api/equipment/library。',
    '低风险明确加技能优先使用 def.workbench.add_skill_button_and_verify；给单个按钮加 Buff 优先使用 def.buff.add_to_button_and_verify，批量 Buff 使用 def.buff.add_to_buttons；用户要算伤害时优先用 def.damage.calculate_and_verify。',
    '高风险/批量/重排轴优先直接使用 def.worknode.patch_and_validate；没有 nodeId 时省略 nodeId，工具会先从可用的当前 payload 镜像创建 work node；用户明确要应用/回退时优先用 def.worknode.checkout_and_verify / def.worknode.restore_base_and_verify，默认 reload:false。',
    'def.worknode.patch 是类代码 Patch DSL / CRUD 工具，只修改 appdata work node workingPayload；checkout/rollback 阶段才写当前迁出态。',
    'def.worknode.patch input: {"nodeId":"...","patch":[{"op":"moveButton","target":{"buttonId":"..."},"nodeIndex":1}],"dryRun":false}。常用 op: addButton/removeButton/moveButton/attachBuff/removeBuff/setTargetResistance/clearTimeline；target 可用 buttonId/characterName/skillType/nodeIndex/latest。',
    'queued 不等于完成。入队后必须用 def.verify.command_result、def.verify.snapshot_delta、def.verify.buttons_have_buff 或 def.verify.damage_recalculated 验证。',
    '如果目标不明确，例如“加一个技能按钮”没有说明 A/E/Q/技能名，必须反问；不要默认硬加。',
    '如果 Buff 候选不唯一，例如“长息”解析出多个对象，必须说明候选并反问；不要硬编码选择。',
    '不要使用角色名、装备 ID、Buff 名称的录制回放脚本；只硬编码工具边界、schema、policy、verifier。',
    `当前已选干员: ${selectedSummary}`,
    `当前技能按钮: ${buttonSummary}`,
    `MAIN_WORKBENCH_READONLY_EVIDENCE:\n${JSON.stringify(evidence, null, 2)}`,
    `用户请求: ${userText}`,
  ].join('\n');
}

async function buildWorkbenchTestPrompt(userText) {
  await startAiCliRest();
  const encodedPrompt = encodeURIComponent(userText);
  const [snapshotResponse, evidenceResponse] = await Promise.allSettled([
    fetchJsonUrl('http://127.0.0.1:17321/api/main-workbench/snapshot'),
    fetchJsonUrl(`http://127.0.0.1:17321/api/main-workbench/evidence?prompt=${encodedPrompt}`),
  ]);
  const snapshot = snapshotResponse.status === 'fulfilled' && snapshotResponse.value.status === 200
    ? snapshotResponse.value.body?.snapshot
    : null;
  const evidence = evidenceResponse.status === 'fulfilled' && evidenceResponse.value.status === 200
    ? evidenceResponse.value.body
    : null;
  return {
    agentText: buildWorkbenchTestAgentMessage(userText, snapshot, evidence),
    snapshotAvailable: Boolean(snapshot),
    evidenceAvailable: Boolean(evidence?.evidence),
  };
}

function proxySseUrl(url, clientRequest, clientResponse) {
  const requestUrl = new URL(url);
  const upstream = http.request({
    hostname: requestUrl.hostname,
    port: requestUrl.port,
    path: `${requestUrl.pathname}${requestUrl.search}`,
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }, (upstreamResponse) => {
    clientResponse.writeHead(upstreamResponse.statusCode || 502, {
      'Content-Type': upstreamResponse.headers['content-type'] || 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    upstreamResponse.pipe(clientResponse);
  });
  upstream.on('error', (error) => {
    if (!clientResponse.headersSent) {
      writeJson(clientResponse, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    } else {
      clientResponse.end();
    }
  });
  clientRequest.on('close', () => upstream.destroy());
  upstream.end();
}

function parseStrictImageReleaseVersion(value) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  return {
    name: match[0],
    parts: match.slice(1).map((part) => Number(part)),
  };
}

function getLatestInstalledImageRelease() {
  const versionsDir = getImageReleaseVersionsDir();
  let entries = [];
  try {
    entries = fs.readdirSync(versionsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const versions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseStrictImageReleaseVersion(entry.name))
    .filter(Boolean)
    .sort((left, right) => {
      for (let index = 0; index < 3; index += 1) {
        if (left.parts[index] !== right.parts[index]) {
          return right.parts[index] - left.parts[index];
        }
      }
      return 0;
    });

  if (versions.length === 0) {
    return null;
  }
  return {
    assetVersion: versions[0].name,
    directory: path.join(versionsDir, versions[0].name),
  };
}

function getImageReleaseManifestPath(assetVersion) {
  return path.join(getImageReleaseVersionDir(assetVersion), IMAGE_RELEASE_MANIFEST_NAME);
}

function readJsonFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readImageReleaseConfig() {
  return { manifestUrl: DEFAULT_IMAGE_RELEASE_MANIFEST_URL };
}

function getImageReleaseSourceUrl() {
  return DEFAULT_IMAGE_RELEASE_MANIFEST_URL;
}

function writeImageReleaseConfig() {
  const manifestUrl = DEFAULT_IMAGE_RELEASE_MANIFEST_URL;
  fs.mkdirSync(path.dirname(getImageReleaseConfigPath()), { recursive: true });
  fs.writeFileSync(
    getImageReleaseConfigPath(),
    `${JSON.stringify({ manifestUrl }, null, 2)}\n`,
    'utf-8'
  );
  imageUpdateState.configuredManifestUrl = manifestUrl;
  imageUpdateState.status = 'idle';
  imageUpdateState.lastError = '';
  imageUpdateState.latestVersion = null;
  imageUpdateState.latestSummary = null;
  imageUpdateState.lastCheckedAt = null;
  clearImageUpdateProgress();
  return { manifestUrl };
}

function readImageReleaseCurrent() {
  try {
    return readJsonFileIfExists(getImageReleaseCurrentPath()) || {
      assetVersion: null,
      activatedAt: null,
      manifestUrl: '',
    };
  } catch {
    return {
      assetVersion: null,
      activatedAt: null,
      manifestUrl: '',
    };
  }
}

function writeImageReleaseCurrent(record) {
  ensureImageReleaseDirectories();
  fs.writeFileSync(getImageReleaseCurrentPath(), `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  return record;
}

function readImageReleaseManifest(assetVersion) {
  if (!assetVersion) {
    return null;
  }
  try {
    return readJsonFileIfExists(getImageReleaseManifestPath(assetVersion));
  } catch {
    return null;
  }
}

function normalizeReleaseRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    return null;
  }
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('\0') || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }
  if (!normalized.startsWith('assets/')) {
    return null;
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    return null;
  }
  return parts.join('/');
}

function relativePathToReleaseFilePath(relativePath) {
  const normalized = normalizeReleaseRelativePath(relativePath);
  if (!normalized) {
    throw new Error(`非法图片路径: ${relativePath || '-'}`);
  }
  return normalized.replace(/^assets\/?/, '');
}

function compareVersionNumberish(left, right) {
  const parse = (value) => String(value || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10));
  const leftParts = parse(left);
  const rightParts = parse(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

function isShellVersionCompatible(minShellVersion) {
  if (!minShellVersion) {
    return true;
  }
  return compareVersionNumberish(app.getVersion(), minShellVersion) >= 0;
}

function hashFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function hashBufferSha256(buffer) {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}

function encodeUrlPathPreservingSegments(value) {
  return String(value || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function getHttpModuleForUrl(targetUrl) {
  const parsed = new URL(targetUrl);
  return parsed.protocol === 'https:' ? https : http;
}

async function fetchUrlRawWithChromium(targetUrl, options = {}) {
  if (!net || typeof net.fetch !== 'function' || !app.isReady()) {
    throw new Error('Electron net.fetch unavailable');
  }
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 10000;
  const timer = setTimeout(() => {
    controller.abort(new Error(`request timeout after ${timeoutMs}ms: ${targetUrl}`));
  }, timeoutMs);
  try {
    const response = await net.fetch(targetUrl, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/octet-stream, application/json;q=0.9, */*;q=0.8',
        ...(options.headers || {}),
      },
      body: options.body,
      redirect: 'follow',
      signal: controller.signal,
    });
    const chunks = [];
    const totalBytes = Number(response.headers.get('content-length') || 0);
    let receivedBytes = 0;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        receivedBytes += chunk.length;
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            receivedBytes,
            totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0,
            url: response.url || targetUrl,
          });
        }
      }
    } else {
      const arrayBuffer = await response.arrayBuffer();
      const chunk = Buffer.from(arrayBuffer);
      chunks.push(chunk);
      receivedBytes = chunk.length;
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          receivedBytes,
          totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : receivedBytes,
          url: response.url || targetUrl,
        });
      }
    }
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.concat(chunks),
      url: response.url || targetUrl,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`request timeout after ${timeoutMs}ms: ${targetUrl}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function fetchUrlRawWithNode(targetUrl, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('请求重定向次数过多'));
      return;
    }
    const parsedUrl = new URL(targetUrl);
    const transport = getHttpModuleForUrl(parsedUrl.toString());
    const request = transport.request(parsedUrl, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'dmg-end-field-shell',
        Accept: 'application/octet-stream, application/json;q=0.9, */*;q=0.8',
        ...(options.headers || {}),
      },
    }, (response) => {
      const chunks = [];
      const totalBytes = Number(response.headers['content-length'] || 0);
      let receivedBytes = 0;
      response.on('data', (chunk) => {
        chunks.push(chunk);
        receivedBytes += chunk.length;
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            receivedBytes,
            totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0,
            url: parsedUrl.toString(),
          });
        }
      });
      response.on('end', async () => {
        const body = Buffer.concat(chunks);
        const statusCode = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
          try {
            const redirectedUrl = new URL(response.headers.location, parsedUrl).toString();
            const redirected = await fetchUrlRawWithNode(redirectedUrl, options, redirectCount + 1);
            resolve(redirected);
          } catch (error) {
            reject(error);
          }
          return;
        }
        resolve({
          statusCode,
          headers: response.headers,
          body,
          url: parsedUrl.toString(),
        });
      });
    });
    request.on('error', reject);
    const timeoutMs = options.timeoutMs || 10000;
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`request timeout after ${timeoutMs}ms: ${targetUrl}`));
    });
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

async function fetchUrlRaw(targetUrl, options = {}) {
  try {
    return await fetchUrlRawWithChromium(targetUrl, options);
  } catch (error) {
    appendRuntimeLog('network', `chromium fetch fallback ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`);
    return fetchUrlRawWithNode(targetUrl, options);
  }
}

async function fetchUrlRawWithRetry(targetUrl, options = {}) {
  const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : 2;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchUrlRaw(targetUrl, options);
      if (response.statusCode < 500 || attempt === retries) {
        return response;
      }
      lastError = new Error(`HTTP ${response.statusCode}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        throw error;
      }
    }
    await delay(500 * (attempt + 1));
  }
  throw lastError || new Error(`请求失败: ${targetUrl}`);
}

async function fetchJsonUrl(url, options = {}) {
  const response = await fetchUrlRawWithRetry(url, {
    timeoutMs: options.timeoutMs ?? 1000,
    retries: options.retries ?? 1,
  });
  return {
    status: response.statusCode,
    body: JSON.parse(response.body.toString('utf-8') || '{}'),
  };
}

async function fetchBufferUrl(url, options = {}) {
  const response = await fetchUrlRawWithRetry(url, {
    timeoutMs: IMAGE_RELEASE_PACKAGE_TIMEOUT_MS,
    retries: 2,
    onProgress: options.onProgress,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`资源下载失败: HTTP ${response.statusCode} ${url}`);
  }
  return response.body;
}

function setImageUpdateProgress(partial = {}) {
  const receivedBytes = Number(partial.receivedBytes || 0);
  const totalBytes = Number(partial.totalBytes || 0);
  const percent = totalBytes > 0
    ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100)))
    : null;
  imageUpdateState.progress = {
    phase: partial.phase || imageUpdateState.status || 'idle',
    label: partial.label || '',
    receivedBytes,
    totalBytes,
    percent,
    updatedAt: Date.now(),
  };
}

function clearImageUpdateProgress() {
  imageUpdateState.progress = null;
}

function resolveImageReleaseManifestUrl(configuredUrl) {
  const rawUrl = typeof configuredUrl === 'string' ? configuredUrl.trim() : '';
  if (!rawUrl) {
    return '';
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (parsedUrl.hostname !== 'github.com') {
    return rawUrl;
  }

  if (
    parsedUrl.pathname === '/Pandluto/dmg-end-field/releases/latest'
    || parsedUrl.pathname === '/Pandluto/dmg-end-field/releases/latest/'
  ) {
    return DEFAULT_IMAGE_RELEASE_MANIFEST_URL;
  }

  if (parsedUrl.pathname === `/Pandluto/dmg-end-field/releases/latest/download/${IMAGE_RELEASE_MANIFEST_NAME}`) {
    return rawUrl;
  }

  const releaseTagMatch = parsedUrl.pathname.match(/^\/Pandluto\/dmg-end-field\/releases\/tag\/([^/]+)\/?$/);
  if (releaseTagMatch) {
    return `${DEFAULT_IMAGE_RELEASE_DOWNLOAD_ROOT}/${releaseTagMatch[1]}/${IMAGE_RELEASE_MANIFEST_NAME}`;
  }

  const releaseDownloadMatch = parsedUrl.pathname.match(/^\/Pandluto\/dmg-end-field\/releases\/download\/([^/]+)\/([^/]+)$/);
  if (releaseDownloadMatch) {
    const [, releaseTag, fileName] = releaseDownloadMatch;
    if (fileName === IMAGE_RELEASE_MANIFEST_NAME) {
      return rawUrl;
    }
    return `${DEFAULT_IMAGE_RELEASE_DOWNLOAD_ROOT}/${releaseTag}/${IMAGE_RELEASE_MANIFEST_NAME}`;
  }

  return rawUrl;
}

function resolveReleasePackageDownloadUrl(manifestSourceUrl, releasePackage) {
  if (!releasePackage || typeof releasePackage !== 'object') {
    return null;
  }
  if (releasePackage.downloadUrl) {
    return new URL(releasePackage.downloadUrl, manifestSourceUrl).toString();
  }
  if (releasePackage.packagePath) {
    return new URL(encodeUrlPathPreservingSegments(releasePackage.packagePath), manifestSourceUrl).toString();
  }
  if (releasePackage.fileName) {
    return new URL(encodeUrlPathPreservingSegments(releasePackage.fileName), manifestSourceUrl).toString();
  }
  return null;
}

function resolveReleasePackageDownloadUrls(manifestSourceUrl, releasePackage) {
  const urls = [];
  const primaryUrl = resolveReleasePackageDownloadUrl(manifestSourceUrl, releasePackage);
  if (primaryUrl) {
    urls.push(primaryUrl);
  }
  const alternatives = Array.isArray(releasePackage?.downloadUrls) ? releasePackage.downloadUrls : [];
  for (const alternative of alternatives) {
    if (typeof alternative !== 'string' || !alternative.trim()) {
      continue;
    }
    const resolved = new URL(alternative.trim(), manifestSourceUrl).toString();
    if (!urls.includes(resolved)) {
      urls.push(resolved);
    }
  }
  return urls;
}

function validateReleasePackageDescriptor(releasePackage, manifestSourceUrl, label) {
  if (!releasePackage || typeof releasePackage !== 'object') {
    throw new Error(`发布清单 ${label} 字段无效`);
  }
  if ((releasePackage.format || 'zip') !== 'zip') {
    throw new Error(`不支持的图片整包格式: ${releasePackage.format}`);
  }
  if (typeof releasePackage.sha256 !== 'string' || releasePackage.sha256.length < 32) {
    throw new Error(`发布清单 ${label} 缺少 sha256`);
  }
  if (!Number.isFinite(Number(releasePackage.sizeBytes)) || Number(releasePackage.sizeBytes) < 0) {
    throw new Error(`发布清单 ${label} sizeBytes 无效`);
  }
  if (!resolveReleasePackageDownloadUrl(manifestSourceUrl, releasePackage)) {
    throw new Error(`发布清单 ${label} 缺少下载路径`);
  }
}

function resolveReleaseFileDownloadUrl(manifestSourceUrl, fileEntry) {
  if (fileEntry?.downloadUrl) {
    return new URL(fileEntry.downloadUrl, manifestSourceUrl).toString();
  }
  if (fileEntry?.packagePath) {
    return new URL(encodeUrlPathPreservingSegments(fileEntry.packagePath), manifestSourceUrl).toString();
  }
  const normalized = normalizeReleaseRelativePath(fileEntry?.relativePath);
  if (!normalized) {
    throw new Error('发布清单缺少可下载文件路径');
  }
  return new URL(`files/${encodeUrlPathPreservingSegments(normalized)}`, manifestSourceUrl).toString();
}

function validateImageReleaseManifest(manifest, manifestSourceUrl = '') {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('发布清单为空');
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('发布清单 files 字段无效');
  }
  if (!Array.isArray(manifest.deletedFiles)) {
    throw new Error('发布清单 deletedFiles 字段无效');
  }
  if (!manifest.assetVersion || typeof manifest.assetVersion !== 'string') {
    throw new Error('发布清单缺少 assetVersion');
  }
  if (manifest.package !== undefined) {
    validateReleasePackageDescriptor(manifest.package, manifestSourceUrl, 'package');
  }
  manifest.files.forEach((entry) => {
    const normalized = normalizeReleaseRelativePath(entry?.relativePath);
    if (!normalized) {
      throw new Error(`发布清单存在非法路径: ${entry?.relativePath || '-'}`);
    }
    if (typeof entry.sha256 !== 'string' || entry.sha256.length < 32) {
      throw new Error(`发布清单缺少 sha256: ${normalized}`);
    }
    if (!Number.isFinite(Number(entry.sizeBytes)) || Number(entry.sizeBytes) < 0) {
      throw new Error(`发布清单 sizeBytes 无效: ${normalized}`);
    }
    if (entry.downloadUrl) {
      // eslint-disable-next-line no-new
      new URL(entry.downloadUrl, manifestSourceUrl || undefined);
    }
    if (entry.packagePath && typeof entry.packagePath !== 'string') {
      throw new Error(`发布清单 packagePath 无效: ${normalized}`);
    }
  });
  manifest.deletedFiles.forEach((relativePath) => {
    if (!normalizeReleaseRelativePath(relativePath)) {
      throw new Error(`发布清单 deletedFiles 存在非法路径: ${relativePath || '-'}`);
    }
  });
  return {
    ...manifest,
    files: manifest.files.map((entry) => ({
      ...entry,
      relativePath: normalizeReleaseRelativePath(entry.relativePath),
    })),
    deletedFiles: manifest.deletedFiles.map((entry) => normalizeReleaseRelativePath(entry)),
  };
}

function computeManifestDelta(nextManifest, currentManifest) {
  const currentFiles = new Map((currentManifest?.files || []).map((entry) => [entry.relativePath, entry]));
  const changedFiles = [];
  nextManifest.files.forEach((entry) => {
    const previous = currentFiles.get(entry.relativePath);
    if (!previous || previous.sha256 !== entry.sha256) {
      changedFiles.push(entry);
    }
  });
  return {
    changedFiles,
    deletedFiles: nextManifest.deletedFiles || [],
  };
}

function runSyncChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf-8',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} 失败${detail ? `: ${detail}` : ''}`);
  }
}

function extractZipArchive(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    const escapedZip = zipPath.replace(/'/g, "''");
    const escapedDest = destDir.replace(/'/g, "''");
    runSyncChecked('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force`,
    ]);
    return;
  }
  if (process.platform === 'darwin') {
    const candidates = [
      { command: 'ditto', args: ['-x', '-k', zipPath, destDir] },
      { command: 'bsdtar', args: ['-xf', zipPath, '-C', destDir] },
      { command: 'unzip', args: ['-q', zipPath, '-d', destDir] },
    ];
    let lastError = null;
    for (const candidate of candidates) {
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
        fs.mkdirSync(destDir, { recursive: true });
        runSyncChecked(candidate.command, candidate.args);
        return;
      } catch (error) {
        lastError = error;
        appendRuntimeLog(
          'assets-update',
          `extract fallback failed ${candidate.command}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    throw lastError || new Error('图片资源包解压失败');
  }
  runSyncChecked('unzip', ['-q', zipPath, '-d', destDir]);
}

function normalizeExtractedReleaseLayout(releaseDir) {
  const nestedAssetsDir = path.join(releaseDir, 'assets');
  if (!fs.existsSync(nestedAssetsDir) || !fs.statSync(nestedAssetsDir).isDirectory()) {
    return;
  }

  for (const entry of fs.readdirSync(nestedAssetsDir, { withFileTypes: true })) {
    const source = path.join(nestedAssetsDir, entry.name);
    const target = path.join(releaseDir, entry.name);
    if (fs.existsSync(target)) {
      if (entry.isDirectory()) {
        fs.cpSync(source, target, {
          recursive: true,
          force: true,
          errorOnExist: false,
        });
        fs.rmSync(source, { recursive: true, force: true });
      } else {
        fs.copyFileSync(source, target);
        fs.rmSync(source, { force: true });
      }
    } else {
      fs.renameSync(source, target);
    }
  }
  fs.rmSync(nestedAssetsDir, { recursive: true, force: true });
}

function verifyExtractedReleaseFiles(manifest, releaseDir) {
  for (const entry of manifest.files) {
    const targetFile = path.join(releaseDir, relativePathToReleaseFilePath(entry.relativePath));
    const resolvedTarget = path.resolve(targetFile);
    const resolvedReleaseDir = path.resolve(releaseDir);
    if (!resolvedTarget.startsWith(resolvedReleaseDir + path.sep)) {
      throw new Error(`图片整包包含越权路径: ${entry.relativePath}`);
    }
    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      throw new Error(`图片整包缺少文件: ${entry.relativePath}`);
    }
    const actualHash = hashFileSha256(targetFile);
    if (actualHash !== entry.sha256) {
      throw new Error(`图片整包文件校验失败: ${entry.relativePath}`);
    }
  }
}

function removeReleaseDeletedFiles(manifest, releaseDir) {
  for (const relativePath of manifest.deletedFiles || []) {
    const targetFile = path.join(releaseDir, relativePathToReleaseFilePath(relativePath));
    const resolvedTarget = path.resolve(targetFile);
    const resolvedReleaseDir = path.resolve(releaseDir);
    if (!resolvedTarget.startsWith(resolvedReleaseDir + path.sep)) {
      throw new Error(`删除清单包含越权路径: ${relativePath}`);
    }
    fs.rmSync(targetFile, { recursive: true, force: true });
  }
}

function listReleaseImageFiles(releaseDir) {
  const files = [];
  function walk(dirPath, relDir = '') {
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
        walk(fullPath, relPath);
      } else if (entry.name !== IMAGE_RELEASE_MANIFEST_NAME && /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(entry.name)) {
        files.push(relPath.replace(/\\/g, '/'));
      }
    }
  }
  walk(releaseDir);
  return files;
}

function isReleaseMaterialized(manifest, releaseDir) {
  if (!manifest) {
    return true;
  }
  if (!releaseDir || !fs.existsSync(releaseDir)) {
    return false;
  }
  try {
    verifyExtractedReleaseFiles(manifest, releaseDir);
  } catch {
    return false;
  }
  for (const relativePath of manifest.deletedFiles || []) {
    const deletedFile = path.join(releaseDir, relativePathToReleaseFilePath(relativePath));
    if (fs.existsSync(deletedFile)) {
      return false;
    }
  }
  return true;
}

async function stageImageReleasePackage({ manifestUrl, releasePackage, stagingDir, label, skipPackageIntegrityCheck = false }) {
  const packageUrls = resolveReleasePackageDownloadUrls(manifestUrl, releasePackage);
  if (packageUrls.length === 0) {
    throw new Error('发布清单 package 缺少下载地址');
  }
  const progressLabel = label || releasePackage.fileName || releasePackage.packagePath || '图片资源包';
  let archiveBuffer = null;
  let lastDownloadError = null;
  for (const packageUrl of packageUrls) {
    try {
      archiveBuffer = await fetchBufferUrl(packageUrl, {
        onProgress: ({ receivedBytes, totalBytes }) => setImageUpdateProgress({
          phase: 'downloading',
          label: progressLabel,
          receivedBytes,
          totalBytes,
        }),
      });
      break;
    } catch (error) {
      lastDownloadError = error;
      appendRuntimeLog('assets-update', `package candidate failed ${packageUrl}: ${error instanceof Error ? error.message : String(error)}`);
      if (!String(error instanceof Error ? error.message : error).includes('HTTP 404')) {
        throw error;
      }
    }
  }
  if (!archiveBuffer) {
    throw lastDownloadError || new Error('图片资源包下载失败');
  }
  setImageUpdateProgress({
    phase: 'verifying',
    label: progressLabel,
    receivedBytes: archiveBuffer.length,
    totalBytes: archiveBuffer.length,
  });
  if (!skipPackageIntegrityCheck) {
    const actualHash = hashBufferSha256(archiveBuffer);
    if (actualHash !== releasePackage.sha256) {
      const head = archiveBuffer.slice(0, 32).toString('utf-8').replace(/\s+/g, ' ').slice(0, 80);
      throw new Error(
        `图片整包校验失败: expected ${releasePackage.sha256}, got ${actualHash}, bytes ${archiveBuffer.length}, head ${head || '-'}`
      );
    }
    if (Number(releasePackage.sizeBytes) !== archiveBuffer.length) {
      throw new Error('图片整包大小校验失败');
    }
  }
  const archivePath = `${stagingDir}.zip`;
  fs.writeFileSync(archivePath, archiveBuffer);
  try {
    setImageUpdateProgress({
      phase: 'extracting',
      label: progressLabel,
      receivedBytes: archiveBuffer.length,
      totalBytes: archiveBuffer.length,
    });
    extractZipArchive(archivePath, stagingDir);
    normalizeExtractedReleaseLayout(stagingDir);
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
}

async function loadRemoteImageReleaseManifest(configuredUrl) {
  const requestedManifestUrl = resolveImageReleaseManifestUrl(configuredUrl);
  const response = await fetchUrlRawWithRetry(requestedManifestUrl, {
    timeoutMs: IMAGE_RELEASE_MANIFEST_TIMEOUT_MS,
    retries: 2,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Manifest 请求失败: HTTP ${response.statusCode}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(response.body.toString('utf-8') || '{}');
  } catch (error) {
    throw new Error(`Manifest 不是有效 JSON: ${requestedManifestUrl}`);
  }
  return {
    manifest: validateImageReleaseManifest(parsed, requestedManifestUrl),
    manifestUrl: requestedManifestUrl,
    assetBaseUrl: requestedManifestUrl,
    requestedManifestUrl,
  };
}

function resolveDefaultReleaseManifestAssetBaseUrl(manifest, fallbackManifestUrl) {
  const tag = typeof manifest?.assetVersion === 'string' && manifest.assetVersion.trim()
    ? manifest.assetVersion.trim()
    : (typeof manifest?.releaseTag === 'string' ? manifest.releaseTag.trim() : '');
  if (!tag || fallbackManifestUrl !== DEFAULT_IMAGE_RELEASE_MANIFEST_URL) {
    return fallbackManifestUrl;
  }
  return `${DEFAULT_IMAGE_RELEASE_DOWNLOAD_ROOT}/${encodeURIComponent(tag)}/${IMAGE_RELEASE_MANIFEST_NAME}`;
}

function getActiveImageReleaseRoot() {
  return getLatestInstalledImageRelease()?.directory || null;
}

async function clearAssetRuntimeCache() {
  try {
    const win = shellWindow && !shellWindow.isDestroyed() ? shellWindow : null;
    if (win?.webContents?.session) {
      await win.webContents.session.clearCache();
    }
  } catch (error) {
    appendRuntimeLog('assets-update', `clear cache failed ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getImageUpdateStatePayload() {
  const config = readImageReleaseConfig();
  const sourceUrl = getImageReleaseSourceUrl(config);
  const currentRecord = readImageReleaseCurrent();
  const installed = getLatestInstalledImageRelease();
  const currentVersion = installed?.assetVersion || null;
  const activeManifest = readImageReleaseManifest(currentVersion);
  imageUpdateState.configuredManifestUrl = sourceUrl;
  imageUpdateState.currentVersion = currentVersion;
  return {
    configuredManifestUrl: sourceUrl,
    currentVersion,
    currentActivatedAt: currentRecord.assetVersion === currentVersion
      ? currentRecord.activatedAt || null
      : null,
    currentManifestSummary: activeManifest
      ? {
      assetVersion: activeManifest.assetVersion,
      delivery: activeManifest.package ? 'archive' : 'files',
      packageSizeBytes: activeManifest.package ? Number(activeManifest.package.sizeBytes) || 0 : 0,
      fileCount: Array.isArray(activeManifest.files) ? activeManifest.files.length : 0,
          deletedFileCount: Array.isArray(activeManifest.deletedFiles) ? activeManifest.deletedFiles.length : 0,
        }
      : null,
    latestVersion: imageUpdateState.latestVersion || null,
    latestSummary: imageUpdateState.latestSummary || null,
    lastCheckedAt: imageUpdateState.lastCheckedAt || null,
    lastUpdatedAt: imageUpdateState.lastUpdatedAt || null,
    lastError: imageUpdateState.lastError || '',
    status: imageUpdateState.status || 'idle',
    progress: imageUpdateState.progress || null,
    storageRoot: getImageReleaseRoot(),
    releaseManifestPath: currentVersion ? getImageReleaseManifestPath(currentVersion) : null,
  };
}

async function checkForImageReleaseUpdates() {
  const config = readImageReleaseConfig();
  const sourceUrl = getImageReleaseSourceUrl(config);
  imageUpdateState.status = 'checking';
  imageUpdateState.lastError = '';
  clearImageUpdateProgress();
  const current = getLatestInstalledImageRelease() || { assetVersion: null };
  try {
    const {
      manifest: remoteManifest,
      manifestUrl: effectiveManifestUrl,
      requestedManifestUrl,
    } = await loadRemoteImageReleaseManifest(sourceUrl);
    if (remoteManifest.delivery && remoteManifest.delivery !== 'archive') {
      throw new Error('当前 Shell 仅支持全量图片包，请重新生成 archive 发布包。');
    }
    if (!remoteManifest.package) {
      throw new Error('发布清单缺少全量 package，无法执行一键更新。');
    }
    const currentManifest = readImageReleaseManifest(current.assetVersion);
    const delta = computeManifestDelta(remoteManifest, currentManifest);
    const currentVersionDir = current.assetVersion ? getImageReleaseVersionDir(current.assetVersion) : null;
    const currentTargetIncomplete = current.assetVersion === remoteManifest.assetVersion
      && !isReleaseMaterialized(remoteManifest, currentVersionDir);
    const hasUpdate = remoteManifest.assetVersion !== current.assetVersion || currentTargetIncomplete;
    const action = currentTargetIncomplete ? 'repair-current' : 'update';
    imageUpdateState.status = 'idle';
    imageUpdateState.latestVersion = remoteManifest.assetVersion;
    imageUpdateState.lastCheckedAt = Date.now();
    imageUpdateState.latestSummary = {
      releaseTag: remoteManifest.releaseTag || '',
      assetVersion: remoteManifest.assetVersion,
      minShellVersion: remoteManifest.minShellVersion || '',
      compatible: isShellVersionCompatible(remoteManifest.minShellVersion),
      delivery: remoteManifest.delivery || (remoteManifest.package ? 'archive' : 'files'),
      packageSizeBytes: remoteManifest.package ? Number(remoteManifest.package.sizeBytes) || 0 : 0,
      changedFileCount: delta.changedFiles.length,
      deletedFileCount: delta.deletedFiles.length,
      totalFileCount: remoteManifest.files.length,
      hasUpdate,
      manifestUrl: effectiveManifestUrl,
      requestedManifestUrl,
      action,
      baselineVersion: '',
      updateUnavailable: false,
      updateMessage: currentTargetIncomplete
        ? '当前素材目录不完整，将自动重建当前版本。'
        : (hasUpdate ? '发现新版本，可一键下载并切换。' : ''),
    };
    return getImageUpdateStatePayload();
  } catch (error) {
    imageUpdateState.status = 'failed';
    imageUpdateState.lastCheckedAt = Date.now();
    imageUpdateState.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

async function applyImageReleaseUpdate() {
  const config = readImageReleaseConfig();
  const sourceUrl = getImageReleaseSourceUrl(config);
  ensureImageReleaseDirectories();
  imageUpdateState.status = 'checking';
  imageUpdateState.lastError = '';
  clearImageUpdateProgress();
  const current = getLatestInstalledImageRelease() || { assetVersion: null };
  const previousManifest = readImageReleaseManifest(current.assetVersion);
  try {
    const {
      manifest: remoteManifest,
      manifestUrl: effectiveManifestUrl,
      assetBaseUrl,
    } = await loadRemoteImageReleaseManifest(sourceUrl);
    if (remoteManifest.delivery && remoteManifest.delivery !== 'archive') {
      throw new Error('当前 Shell 仅支持全量图片包，请重新生成 archive 发布包。');
    }
    if (!remoteManifest.package) {
      throw new Error('发布清单缺少全量 package，无法执行一键更新。');
    }
    if (!isShellVersionCompatible(remoteManifest.minShellVersion)) {
      throw new Error(`当前 Shell 版本 ${app.getVersion()} 不满足最低要求 ${remoteManifest.minShellVersion}`);
    }
    const targetVersion = remoteManifest.assetVersion;
    const packageBaseUrl = resolveDefaultReleaseManifestAssetBaseUrl(remoteManifest, assetBaseUrl);
    const targetDir = getImageReleaseVersionDir(targetVersion);
    const stagingDir = path.join(getImageReleaseStagingDir(), sanitizeImageReleaseVersion(targetVersion));
    const delta = computeManifestDelta(remoteManifest, previousManifest);
    const currentTargetIncomplete = current.assetVersion === targetVersion
      && !isReleaseMaterialized(remoteManifest, targetDir);

    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    imageUpdateState.status = 'downloading';
    setImageUpdateProgress({
      phase: 'preparing',
      label: '准备下载图片资源',
      receivedBytes: 0,
      totalBytes: 0,
    });
    await stageImageReleasePackage({
      manifestUrl: packageBaseUrl,
      releasePackage: remoteManifest.package,
      stagingDir,
      label: '图片整包',
    });
    verifyExtractedReleaseFiles(remoteManifest, stagingDir);

    imageUpdateState.status = 'activating';
    setImageUpdateProgress({
      phase: 'activating',
      label: '切换图片资源',
      receivedBytes: 1,
      totalBytes: 1,
    });

    fs.writeFileSync(
      path.join(stagingDir, IMAGE_RELEASE_MANIFEST_NAME),
      `${JSON.stringify(remoteManifest, null, 2)}\n`,
      'utf-8'
    );

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(stagingDir, targetDir);
    writeImageReleaseCurrent({
      assetVersion: targetVersion,
      activatedAt: new Date().toISOString(),
      manifestUrl: effectiveManifestUrl,
    });

    imageUpdateState.status = 'idle';
    imageUpdateState.lastCheckedAt = Date.now();
    imageUpdateState.lastUpdatedAt = imageUpdateState.lastCheckedAt;
    imageUpdateState.currentVersion = targetVersion;
    imageUpdateState.latestVersion = targetVersion;
    imageUpdateState.latestSummary = {
      releaseTag: remoteManifest.releaseTag || '',
      assetVersion: targetVersion,
      minShellVersion: remoteManifest.minShellVersion || '',
      compatible: true,
      delivery: remoteManifest.package ? 'archive' : 'files',
      packageSizeBytes: remoteManifest.package ? Number(remoteManifest.package.sizeBytes) || 0 : 0,
      changedFileCount: delta.changedFiles.length,
      deletedFileCount: delta.deletedFiles.length,
      totalFileCount: remoteManifest.files.length,
      hasUpdate: false,
      manifestUrl: effectiveManifestUrl,
      action: currentTargetIncomplete ? 'repair-current' : 'update',
      updateMessage: currentTargetIncomplete ? '当前素材目录已重建完成。' : '',
    };
    setImageUpdateProgress({
      phase: 'done',
      label: '图片资源已切换',
      receivedBytes: 1,
      totalBytes: 1,
    });
    syncImageManifest();
    await clearAssetRuntimeCache();
    appendRuntimeLog('assets-update', `activated image release ${targetVersion} from ${effectiveManifestUrl}`);
    return getImageUpdateStatePayload();
  } catch (error) {
    imageUpdateState.status = 'failed';
    imageUpdateState.lastError = error instanceof Error ? error.message : String(error);
    setImageUpdateProgress({
      phase: 'failed',
      label: imageUpdateState.lastError,
      receivedBytes: 0,
      totalBytes: 0,
    });
    appendRuntimeLog('assets-update', `update failed ${imageUpdateState.lastError}`);
    throw error;
  }
}

async function forceClearImageUpdate() {
  const versionsDir = getImageReleaseVersionsDir();
  const stagingDir = getImageReleaseStagingDir();
  const currentPath = getImageReleaseCurrentPath();

  fs.rmSync(versionsDir, { recursive: true, force: true });
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(currentPath, { force: true });

  ensureImageReleaseDirectories();

  imageUpdateState.status = 'idle';
  imageUpdateState.currentVersion = null;
  imageUpdateState.latestVersion = null;
  imageUpdateState.latestSummary = null;
  imageUpdateState.lastCheckedAt = null;
  imageUpdateState.lastUpdatedAt = null;
  imageUpdateState.lastError = '';
  clearImageUpdateProgress();

  syncImageManifest();
  await clearAssetRuntimeCache();
  appendRuntimeLog('assets-update', 'force cleared local image update state');
  return getImageUpdateStatePayload();
}

function getAssetsRoot() {
  if (isDev) {
    return path.join(__dirname, '..', 'public', 'assets');
  }
  return ensureProductionAssetsRoot();
}

function buildNodeSidecarEnv(extra = {}) {
  const defOpenCodeHome = path.join(app.getPath('userData'), 'def-opencode');
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DEF_OPENCODE_HOME: defOpenCodeHome,
    ...extra,
  };
}

function getNodeSidecarCwd() {
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..');
}

async function startAiCliRest() {
  if (isAiCliRestRunning()) {
    return {
      started: false,
      reason: 'already-running',
      ...getAiCliRestRuntimeInfo(),
    };
  }

  const scriptPath = path.join(__dirname, '..', 'scripts', 'ai-cli-rest-server.mjs');
  aiCliRestProcess = spawn(process.execPath, [scriptPath], {
    cwd: getNodeSidecarCwd(),
    env: buildNodeSidecarEnv({
      AI_CLI_REST_PORT: '17321',
    }),
    stdio: 'ignore',
    detached: false,
    windowsHide: true,
  });
  aiCliRestStartedAt = Date.now();

  aiCliRestProcess.once('exit', () => {
    aiCliRestProcess = null;
    aiCliRestStartedAt = null;
  });

  let health = null;
  try {
    health = await waitForAiCliRestHealth(aiCliRestProcess.pid);
  } catch (error) {
    return {
      started: true,
      ready: false,
      reason: 'launched-health-timeout',
      error: error instanceof Error ? error.message : String(error),
      ...getAiCliRestRuntimeInfo(),
    };
  }

  return {
    started: true,
    ready: true,
    reason: 'launched',
    health,
    ...getAiCliRestRuntimeInfo(),
  };
}

async function stopAiCliRest() {
  if (!isAiCliRestRunning()) {
    return {
      stopped: false,
      reason: 'not-running',
      ...getAiCliRestRuntimeInfo(),
    };
  }

  const stoppingProcess = aiCliRestProcess;
  killProcessTree(stoppingProcess.pid);
  const exit = await waitForProcessExit(stoppingProcess);
  if (!exit.exited) {
    return {
      stopped: false,
      reason: 'exit-timeout',
      running: Boolean(stoppingProcess.exitCode === null),
      pid: stoppingProcess.pid ?? null,
      startedAt: aiCliRestStartedAt,
      url: 'http://127.0.0.1:17321',
    };
  }
  return {
    stopped: true,
    reason: 'terminated',
    running: false,
    pid: null,
    startedAt: null,
    url: 'http://127.0.0.1:17321',
  };
}

async function startDefAgent() {
  if (isDefAgentRunning()) {
    return {
      started: false,
      reason: 'already-running',
      ...getDefAgentRuntimeInfo(),
    };
  }

  const scriptPath = path.join(__dirname, '..', 'agent', 'server', 'def-agent-server.cjs');
  defAgentProcess = spawn(process.execPath, [scriptPath], {
    cwd: getNodeSidecarCwd(),
    env: buildNodeSidecarEnv({
      DEF_AGENT_PORT: '17322',
    }),
    stdio: 'ignore',
    detached: false,
    windowsHide: true,
  });
  defAgentStartedAt = Date.now();

  defAgentProcess.once('exit', () => {
    defAgentProcess = null;
    defAgentStartedAt = null;
  });

  let health = null;
  try {
    health = await waitForDefAgentHealth(defAgentProcess.pid);
  } catch (error) {
    return {
      started: true,
      ready: false,
      reason: 'launched-health-timeout',
      error: error instanceof Error ? error.message : String(error),
      ...getDefAgentRuntimeInfo(),
    };
  }

  return {
    started: true,
    ready: true,
    reason: 'launched',
    health,
    ...getDefAgentRuntimeInfo(),
  };
}

async function stopDefAgent() {
  if (!isDefAgentRunning()) {
    return {
      stopped: false,
      reason: 'not-running',
      ...getDefAgentRuntimeInfo(),
    };
  }

  const stoppingProcess = defAgentProcess;
  killProcessTree(stoppingProcess.pid);
  const exit = await waitForProcessExit(stoppingProcess);
  if (!exit.exited) {
    return {
      stopped: false,
      reason: 'exit-timeout',
      running: Boolean(stoppingProcess.exitCode === null),
      pid: stoppingProcess.pid ?? null,
      startedAt: defAgentStartedAt,
      url: 'http://127.0.0.1:17322',
    };
  }
  return {
    stopped: true,
    reason: 'terminated',
    running: false,
    pid: null,
    startedAt: null,
    url: 'http://127.0.0.1:17322',
  };
}

function getPackagedAssetsRoot() {
  return path.join(__dirname, '..', 'dist', 'assets');
}

function getProductionAssetsRoot() {
  return path.join(getRuntimeDataRoot(), 'images');
}

function getDevImageRoot() {
  return path.join(__dirname, '..', 'data', 'images');
}

function getPrimaryImageRoot() {
  const activeReleaseRoot = getActiveImageReleaseRoot();
  return activeReleaseRoot
    ? path.join(activeReleaseRoot, 'images')
    : getImageReleaseVersionsDir();
}

function getImageRootsConfigPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'data', 'image-roots.json');
  }
  return path.join(getRuntimeDataRoot(), 'image-roots.json');
}

function getLegacyUserImagesDir() {
  return path.join(app.getPath('userData'), 'user-images');
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

/** Primary writable image root. Extra roots are configured separately. */
function getUserImagesDir() {
  const dir = getPrimaryImageRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Legacy: returns the user writable dir for operations that haven't been migrated. */
function getManagedDir() {
  return getUserImagesDir();
}

function normalizeImageRootPath(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  return path.resolve(value.trim());
}

function readImageRootsConfig() {
  try {
    const filePath = getImageRootsConfigPath();
    if (!fs.existsSync(filePath)) {
      return { version: 1, roots: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const roots = Array.isArray(parsed?.roots)
      ? parsed.roots
        .map((item) => {
          const directory = normalizeImageRootPath(typeof item === 'string' ? item : item?.directory);
          if (!directory) return null;
          return {
            directory,
            label: typeof item?.label === 'string' && item.label.trim()
              ? item.label.trim()
              : path.basename(directory),
          };
        })
        .filter(Boolean)
      : [];
    return { version: 1, roots };
  } catch {
    return { version: 1, roots: [] };
  }
}

function writeImageRootsConfig(roots) {
  const filePath = getImageRootsConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalizedRoots = [];
  const seen = new Set();
  roots.forEach((item) => {
    const directory = normalizeImageRootPath(typeof item === 'string' ? item : item?.directory);
    if (!directory) return;
    const key = directory.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalizedRoots.push({
      directory,
      label: typeof item?.label === 'string' && item.label.trim()
        ? item.label.trim()
        : path.basename(directory),
    });
  });
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, roots: normalizedRoots }, null, 2)}\n`, 'utf-8');
  return { version: 1, roots: normalizedRoots };
}

function getImageRootEntries() {
  const primaryDir = getUserImagesDir();
  const entries = [{
    id: 'primary',
    label: '主图片目录',
    directory: primaryDir,
    writable: true,
    priority: 0,
    configured: false,
    exists: fs.existsSync(primaryDir),
  }];
  const seen = new Set([path.resolve(primaryDir).toLowerCase()]);
  const configured = readImageRootsConfig().roots;
  configured.forEach((root, index) => {
    const directory = normalizeImageRootPath(root.directory);
    if (!directory) return;
    const key = directory.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      id: `root-${index + 1}`,
      label: root.label || path.basename(directory),
      directory,
      writable: false,
      priority: entries.length,
      configured: true,
      exists: fs.existsSync(directory),
    });
  });

  const legacyDir = getLegacyUserImagesDir();
  const legacyKey = path.resolve(legacyDir).toLowerCase();
  if (fs.existsSync(legacyDir) && !seen.has(legacyKey)) {
    entries.push({
      id: 'legacy-appdata',
      label: '旧 AppData 图片',
      directory: legacyDir,
      writable: false,
      priority: entries.length,
      configured: false,
      legacy: true,
      exists: true,
    });
  }
  return entries;
}

function listImageRoots() {
  return {
    ok: true,
    configPath: getImageRootsConfigPath(),
    primaryRoot: getUserImagesDir(),
    roots: getImageRootEntries(),
  };
}

async function handleAddImageRoot() {
  const win = BrowserWindow.getFocusedWindow() || shellWindow;
  if (!win) {
    return { ok: false, error: '无活动窗口' };
  }
  const result = await dialog.showOpenDialog(win, {
    title: '选择图片根目录',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true, error: '已取消' };
  }
  const directory = normalizeImageRootPath(result.filePaths[0]);
  const config = readImageRootsConfig();
  writeImageRootsConfig([...config.roots, { directory, label: path.basename(directory) || directory }]);
  syncImageManifest();
  return listImageRoots();
}

function handleRemoveImageRoot(payload) {
  const directory = normalizeImageRootPath(payload?.directory);
  if (!directory) {
    return { ok: false, error: '缺少目录' };
  }
  const config = readImageRootsConfig();
  const targetKey = directory.toLowerCase();
  const nextRoots = config.roots.filter((root) => normalizeImageRootPath(root.directory)?.toLowerCase() !== targetKey);
  writeImageRootsConfig(nextRoots);
  syncImageManifest();
  return listImageRoots();
}

function syncImageManifest() {
  refreshImageAssetCache();
}

function getImageEntryRequestRelativePath(entry) {
  const relativePath = String(entry.relativePath || '').replace(/\\/g, '/');
  if (entry.source === 'release' || entry.source === 'user' || entry.source === 'legacy') {
    return relativePath.replace(/^assets\/images\/?/, '');
  }
  return relativePath.replace(/^assets\/?/, '');
}

function addImageAssetCacheBucket(map, key, entry) {
  const normalizedKey = String(key || '').toLowerCase();
  if (!normalizedKey) return;
  const bucket = map.get(normalizedKey) || [];
  bucket.push(entry);
  map.set(normalizedKey, bucket);
}

function sortImageAssetCacheBuckets(map) {
  for (const bucket of map.values()) {
    bucket.sort((left, right) => (left.rootPriority ?? 999) - (right.rootPriority ?? 999));
  }
}

function buildImageAssetCache() {
  const activeReleaseRoot = getActiveImageReleaseRoot();
  const list = scanAllImageAssets();
  const byRequestPath = new Map();
  const byFileName = new Map();

  for (const entry of list) {
    if (entry.kind === 'dir') continue;
    if (entry.source !== 'release' && entry.source !== 'user' && entry.source !== 'legacy') continue;

    addImageAssetCacheBucket(byRequestPath, getImageEntryRequestRelativePath(entry), entry);
    addImageAssetCacheBucket(byFileName, entry.fileName, entry);
  }

  sortImageAssetCacheBuckets(byRequestPath);
  sortImageAssetCacheBuckets(byFileName);

  return {
    list,
    byRequestPath,
    byFileName,
    activeReleaseRoot,
    refreshedAt: Date.now(),
  };
}

function refreshImageAssetCache() {
  imageAssetCache = buildImageAssetCache();
  return imageAssetCache;
}

function getImageAssetCache() {
  const activeReleaseRoot = getActiveImageReleaseRoot();
  if (!imageAssetCache || imageAssetCache.activeReleaseRoot !== activeReleaseRoot) {
    imageAssetCache = buildImageAssetCache();
  }
  return imageAssetCache;
}

function addFileEntry(results, dirsWithFiles, fullPath, relPath, source, writable, rootInfo = null) {
  let stats;
  try {
    stats = fs.statSync(fullPath);
  } catch {
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const baseName = path.basename(fullPath, ext);
  const normalizedRel = `assets/${relPath.replace(/\\/g, '/')}`;
  const fileName = path.basename(fullPath);
  const canonicalRel = normalizedRel.replace(/^assets\/images\/?/, '').replace(/^assets\/?/, '');
  const canonicalPath = source === 'user' || source === 'legacy'
    ? `user-images/${canonicalRel}`
    : undefined;
  const publicUrl = canonicalPath
    ? `http://127.0.0.1:${BRIDGE_PORT}/user-images/${canonicalRel.split('/').map(encodeURIComponent).join('/')}`
    : undefined;
  const entry = {
    fileName,
    baseName,
    ext,
    relativePath: normalizedRel,
    canonicalPath,
    publicUrl,
    source,
    writable,
    rootId: rootInfo?.id,
    rootLabel: rootInfo?.label,
    rootDirectory: rootInfo?.directory,
    rootPriority: rootInfo?.priority ?? 999,
    sizeBytes: stats.size,
    updatedAt: stats.mtimeMs,
  };
  Object.defineProperty(entry, 'absolutePath', {
    value: fullPath,
    enumerable: false,
  });
  results.push(entry);
  // Mark ancestor dirs
  const parts = relPath.split('/');
  for (let i = 0; i < parts.length; i++) {
    dirsWithFiles.add(parts.slice(0, i + 1).join('/'));
  }
}

function scanAllImageAssets() {
  const activeReleaseRoot = getActiveImageReleaseRoot();
  const results = [];
  const dirsWithFiles = new Set();

  // ── Walk helper ──
  function walk(dirPath, relDir, source, writable, rootInfo = null) {
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
        walk(fullPath, relPath, source, writable, rootInfo);
      } else if (entry.name === '_manifest.json') {
        continue;
      } else if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(entry.name)) {
        addFileEntry(results, dirsWithFiles, fullPath, relPath, source, writable, rootInfo);
      }
    }
  }

  if (activeReleaseRoot && fs.existsSync(activeReleaseRoot)) {
    walk(activeReleaseRoot, '', 'release', false, {
      id: 'release',
      label: `发布更新资源 · ${path.basename(activeReleaseRoot)}`,
      directory: activeReleaseRoot,
      priority: 0,
    });
  }
  const list = results;
  const byFileName = new Map();
  for (const item of list) {
    if (item.kind === 'dir') continue;
    const key = String(item.fileName || '').toLowerCase();
    if (!key) continue;
    const bucket = byFileName.get(key) || [];
    bucket.push(item);
    byFileName.set(key, bucket);
  }
  for (const bucket of byFileName.values()) {
    bucket.sort((left, right) => (left.rootPriority ?? 999) - (right.rootPriority ?? 999));
    bucket.forEach((item, index) => {
      item.conflictCount = bucket.length;
      item.mappingWinner = index === 0;
      item.mappingKey = item.fileName;
    });
  }
  return list;
}

function resolveUserImageFileByRequestPath(requestPath) {
  const decoded = decodeURIComponent(requestPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!decoded || /(^|\/)\.\.(\/|$)/.test(decoded)) {
    return null;
  }
  const requestedFileName = path.basename(decoded);
  if (!requestedFileName || !/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(requestedFileName)) {
    return null;
  }
  const cache = getImageAssetCache();
  const requestedExt = path.extname(requestedFileName).toLowerCase();
  const extensionOrder = [
    requestedExt,
    '.png',
    '.webp',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
  ].filter((ext, index, list) => list.indexOf(ext) === index);
  const requestedPathBase = decoded.slice(0, decoded.length - requestedExt.length);
  const requestedFileBase = requestedFileName.slice(0, requestedFileName.length - requestedExt.length);

  for (const ext of extensionOrder) {
    const exactPath = `${requestedPathBase}${ext}`.toLowerCase();
    const exactCandidates = decoded.includes('/')
      ? cache.byRequestPath.get(exactPath) || []
      : [];
    const fileNameCandidates = cache.byFileName.get(`${requestedFileBase}${ext}`.toLowerCase()) || [];
    const candidates = exactCandidates.length > 0 ? exactCandidates : fileNameCandidates;
    for (const item of candidates) {
      const fullPath = item.absolutePath;
      if (!fullPath) continue;
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    }
  }
  return null;
}

function sanitizeImageFileBaseName(value) {
  const cleanName = typeof value === 'string' ? value.trim() : '';
  if (!cleanName || cleanName === '.' || cleanName === '..') {
    return null;
  }
  if (/[<>:"|?*\\/]/.test(cleanName) || /(^|\/)\.\.(\/|$)/.test(cleanName)) {
    return null;
  }
  return cleanName;
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
    canManageRoots: true,
    primaryRoot: getUserImagesDir(),
    rootsConfigPath: getImageRootsConfigPath(),
    backendLabel: '网页端 · 可管理',
    transportKind: 'web-bridge',
  };
}

function handleListImageAssets() {
  return getImageAssetCache().list;
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
  const cleanName = sanitizeImageFileBaseName(userExt ? path.basename(newName.trim(), userExt) : newName.trim());
  if (!cleanName) {
    return { ok: false, error: '非法文件名' };
  }
  const finalName = `${cleanName}${originalExt}`;
  const newPath = path.join(path.dirname(oldPath), finalName);
  const resolvedNewPath = path.resolve(newPath);
  const resolvedCurrentDir = path.resolve(path.dirname(oldPath));
  if (!resolvedNewPath.startsWith(resolvedCurrentDir + path.sep) || path.dirname(resolvedNewPath) !== resolvedCurrentDir) {
    return { ok: false, error: '越权文件访问' };
  }

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
    return handleListImageAssets();
  }

  const result = await dialog.showOpenDialog(win, {
    title: '选择要导入的图片',
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return handleListImageAssets();
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
  return handleListImageAssets();
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

function getAiTimelineWorkNodesPath() {
  return path.join(getLocalDataDirectory(), 'ai-timeline-worknodes.sqlite3');
}

function getTimelineRepositoryPath() {
  return path.join(getLocalDataDirectory(), 'timeline-repository.sqlite3');
}

function getLegacyAiTimelineWorkNodesPath() {
  return path.join(getLocalDataDirectory(), 'ai-timeline-worknodes.json');
}

let aiTimelineWorkNodeStore = null;
let timelineRepository = null;

function getAiTimelineWorkNodeStore() {
  if (!aiTimelineWorkNodeStore) {
    ensureLocalDataDirectory();
    aiTimelineWorkNodeStore = createAiTimelineWorkNodeStore({
      databasePath: getAiTimelineWorkNodesPath(),
      legacyJsonPath: getLegacyAiTimelineWorkNodesPath(),
    });
  }
  return aiTimelineWorkNodeStore;
}

function getTimelineRepository() {
  if (!timelineRepository) {
    ensureLocalDataDirectory();
    timelineRepository = createTimelineRepository({ databasePath: getTimelineRepositoryPath() });
  }
  return timelineRepository;
}

function mirrorAiTimelineWorkNodeToRepository(node) {
  if (!node || node.saveId?.startsWith('timeline-snapshot-') || /^\[snapshot\]/i.test(node.label || '')) return;
  const timelineId = node.saveId || 'current-main-workbench';
  const repository = getTimelineRepository();
  repository.ensureDocument({ id: timelineId, label: '主排轴' });
  const visiting = new Set();
  const mirrorOne = (candidate) => {
    if (!candidate || visiting.has(candidate.id) || repository.getWorkNode(candidate.id)) return;
    visiting.add(candidate.id);
    if (candidate.parentNodeId) mirrorOne(getAiTimelineWorkNodeStore().getNode(candidate.parentNodeId));
    repository.importWorkNode({ ...candidate, timelineId });
    visiting.delete(candidate.id);
  };
  mirrorOne(node);
}

function sanitizeArchiveId(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : `archive-${Date.now()}`;
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `archive-${Date.now()}`;
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

function makeAiTimelineWorkNodeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeAiTimelineWorkNodeId(value, fallbackPrefix) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : makeAiTimelineWorkNodeId(fallbackPrefix);
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || makeAiTimelineWorkNodeId(fallbackPrefix);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function summarizeAiTimelinePayload(payload) {
  const selectedCharacters = Array.isArray(payload?.selectedCharacters) ? payload.selectedCharacters : [];
  const skillButtonTable = isPlainObject(payload?.skillButtonTable) ? payload.skillButtonTable : {};
  const allBuffList = Array.isArray(payload?.allBuffList) ? payload.allBuffList : [];
  return {
    characterCount: selectedCharacters.length,
    buttonCount: Object.keys(skillButtonTable).length,
    buffCount: allBuffList.length,
  };
}

function diffAiTimelinePayloadSummary(basePayload, workingPayload) {
  const baseButtons = new Set(Object.keys(isPlainObject(basePayload?.skillButtonTable) ? basePayload.skillButtonTable : {}));
  const workingButtons = new Set(Object.keys(isPlainObject(workingPayload?.skillButtonTable) ? workingPayload.skillButtonTable : {}));
  const baseBuffs = new Set((Array.isArray(basePayload?.allBuffList) ? basePayload.allBuffList : []).map((buff) => buff?.id).filter(Boolean));
  const workingBuffs = new Set((Array.isArray(workingPayload?.allBuffList) ? workingPayload.allBuffList : []).map((buff) => buff?.id).filter(Boolean));
  let addedButtonCount = 0;
  let removedButtonCount = 0;
  let addedBuffCount = 0;
  let removedBuffCount = 0;
  for (const id of workingButtons) {
    if (!baseButtons.has(id)) addedButtonCount += 1;
  }
  for (const id of baseButtons) {
    if (!workingButtons.has(id)) removedButtonCount += 1;
  }
  for (const id of workingBuffs) {
    if (!baseBuffs.has(id)) addedBuffCount += 1;
  }
  for (const id of baseBuffs) {
    if (!workingBuffs.has(id)) removedBuffCount += 1;
  }
  return {
    addedButtonCount,
    removedButtonCount,
    changedButtonCount: 0,
    addedBuffCount,
    removedBuffCount,
    beforeButtonCount: baseButtons.size,
    afterButtonCount: workingButtons.size,
    beforeBuffCount: baseBuffs.size,
    afterBuffCount: workingBuffs.size,
  };
}

function normalizeAiTimelineWorkNodeButton(button) {
  const item = {
    id: button.id,
    characterName: button.characterName,
    skillType: button.skillType,
    skillDisplayName: button.skillDisplayName,
    staffIndex: button.staffIndex,
    nodeIndex: button.nodeIndex,
    selectedBuffIds: Array.isArray(button.selectedBuff) ? [...button.selectedBuff].sort() : [],
  };
  return {
    ...item,
    label: `${item.characterName}-${item.skillDisplayName || item.skillType}@${item.staffIndex + 1}-${(item.nodeIndex ?? 0) + 1}`,
  };
}

function normalizeAiTimelineWorkNodeBuff(buff) {
  return {
    id: buff.id,
    displayName: buff.displayName || buff.name || buff.id,
    sourceName: buff.sourceName,
  };
}

function diffAiTimelineField(changes, field, before, after) {
  const beforeValue = Array.isArray(before) ? JSON.stringify(before) : before;
  const afterValue = Array.isArray(after) ? JSON.stringify(after) : after;
  if (beforeValue !== afterValue) {
    changes.push({ field, before, after });
  }
}

function diffAiTimelinePayloads(basePayload, workingPayload) {
  const baseButtons = new Map(Object.values(isPlainObject(basePayload?.skillButtonTable) ? basePayload.skillButtonTable : {})
    .map((button) => [button.id, normalizeAiTimelineWorkNodeButton(button)]));
  const workingButtons = new Map(Object.values(isPlainObject(workingPayload?.skillButtonTable) ? workingPayload.skillButtonTable : {})
    .map((button) => [button.id, normalizeAiTimelineWorkNodeButton(button)]));
  const baseBuffs = new Map((Array.isArray(basePayload?.allBuffList) ? basePayload.allBuffList : [])
    .map((buff) => [buff.id, normalizeAiTimelineWorkNodeBuff(buff)]));
  const workingBuffs = new Map((Array.isArray(workingPayload?.allBuffList) ? workingPayload.allBuffList : [])
    .map((buff) => [buff.id, normalizeAiTimelineWorkNodeBuff(buff)]));
  const addedButtons = [];
  const removedButtons = [];
  const changedButtons = [];
  const addedBuffs = [];
  const removedBuffs = [];

  for (const [id, after] of workingButtons) {
    const before = baseButtons.get(id);
    if (!before) {
      addedButtons.push(after);
      continue;
    }
    const changes = [];
    diffAiTimelineField(changes, 'characterName', before.characterName, after.characterName);
    diffAiTimelineField(changes, 'skillType', before.skillType, after.skillType);
    diffAiTimelineField(changes, 'skillDisplayName', before.skillDisplayName, after.skillDisplayName);
    diffAiTimelineField(changes, 'staffIndex', before.staffIndex, after.staffIndex);
    diffAiTimelineField(changes, 'nodeIndex', before.nodeIndex, after.nodeIndex);
    diffAiTimelineField(changes, 'selectedBuffIds', before.selectedBuffIds, after.selectedBuffIds);
    if (changes.length) changedButtons.push({ id, before, after, changes });
  }
  for (const [id, before] of baseButtons) {
    if (!workingButtons.has(id)) removedButtons.push(before);
  }
  for (const [id, buff] of workingBuffs) {
    if (!baseBuffs.has(id)) addedBuffs.push(buff);
  }
  for (const [id, buff] of baseBuffs) {
    if (!workingBuffs.has(id)) removedBuffs.push(buff);
  }

  return {
    summary: {
      addedButtonCount: addedButtons.length,
      removedButtonCount: removedButtons.length,
      changedButtonCount: changedButtons.length,
      addedBuffCount: addedBuffs.length,
      removedBuffCount: removedBuffs.length,
      beforeButtonCount: baseButtons.size,
      afterButtonCount: workingButtons.size,
      beforeBuffCount: baseBuffs.size,
      afterBuffCount: workingBuffs.size,
    },
    selectedCharactersChanged: JSON.stringify(basePayload?.selectedCharacters || []) !== JSON.stringify(workingPayload?.selectedCharacters || []),
    beforeSelectedCharacters: Array.isArray(basePayload?.selectedCharacters) ? basePayload.selectedCharacters : [],
    afterSelectedCharacters: Array.isArray(workingPayload?.selectedCharacters) ? workingPayload.selectedCharacters : [],
    addedButtons: addedButtons.sort((left, right) => left.label.localeCompare(right.label)),
    removedButtons: removedButtons.sort((left, right) => left.label.localeCompare(right.label)),
    changedButtons: changedButtons.sort((left, right) => left.after.label.localeCompare(right.after.label)),
    addedBuffs: addedBuffs.sort((left, right) => left.displayName.localeCompare(right.displayName)),
    removedBuffs: removedBuffs.sort((left, right) => left.displayName.localeCompare(right.displayName)),
  };
}

function countAiTimelineRiskFlags(riskFlags, severity) {
  return (Array.isArray(riskFlags) ? riskFlags : []).filter((risk) => risk?.severity === severity).length;
}

function countAiTimelineDiffChanges(diff) {
  const summary = diff?.summary || {};
  return [
    summary.addedButtonCount,
    summary.removedButtonCount,
    summary.changedButtonCount,
    summary.addedBuffCount,
    summary.removedBuffCount,
    diff?.selectedCharactersChanged ? 1 : 0,
  ].reduce((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0);
}

function formatAiTimelineChangeReason(diff) {
  const summary = diff?.summary || {};
  const parts = [];
  if (summary.addedButtonCount) parts.push(`新增技能按钮 ${summary.addedButtonCount} 个`);
  if (summary.removedButtonCount) parts.push(`删除技能按钮 ${summary.removedButtonCount} 个`);
  if (summary.changedButtonCount) parts.push(`修改技能按钮 ${summary.changedButtonCount} 个`);
  if (summary.addedBuffCount) parts.push(`新增 Buff ${summary.addedBuffCount} 个`);
  if (summary.removedBuffCount) parts.push(`删除 Buff ${summary.removedBuffCount} 个`);
  if (diff?.selectedCharactersChanged) parts.push('出战干员变化');
  return parts.length ? parts.join('，') : 'base 与 working 没有结构化差异';
}

function buildAiTimelineCheckoutDecisionForElectron({ approvalPolicy, riskFlags, diff } = {}) {
  const policy = ['auto-low-risk', 'ask-on-risk', 'manual'].includes(approvalPolicy) ? approvalPolicy : 'auto-low-risk';
  const blockerCount = countAiTimelineRiskFlags(riskFlags, 'blocker');
  const warningCount = countAiTimelineRiskFlags(riskFlags, 'warning');
  const infoCount = countAiTimelineRiskFlags(riskFlags, 'info');
  const changeCount = countAiTimelineDiffChanges(diff);
  const reasons = [
    `approvalPolicy=${policy}`,
    `riskFlags: blocker=${blockerCount}, warning=${warningCount}, info=${infoCount}`,
    formatAiTimelineChangeReason(diff),
  ];
  if (blockerCount > 0) {
    return {
      status: 'blocked',
      approvalMode: 'manual',
      canAutoApprove: false,
      requiresManualApproval: true,
      blockerCount,
      warningCount,
      rationale: `存在 ${blockerCount} 个 blocker 风险，AI 不应自动 checkout；需要明确 manual approval 后才能继续。`,
      reasons,
    };
  }
  if (policy === 'manual') {
    return {
      status: 'needs-manual-approval',
      approvalMode: 'manual',
      canAutoApprove: false,
      requiresManualApproval: true,
      blockerCount,
      warningCount,
      rationale: '该 work node 的 approvalPolicy=manual，需要用户或受信任入口显式批准后 checkout。',
      reasons,
    };
  }
  if (policy === 'ask-on-risk' && warningCount > 0) {
    return {
      status: 'needs-manual-approval',
      approvalMode: 'manual',
      canAutoApprove: false,
      requiresManualApproval: true,
      blockerCount,
      warningCount,
      rationale: `approvalPolicy=ask-on-risk 且存在 ${warningCount} 个 warning，建议人工确认后 checkout。`,
      reasons,
    };
  }
  return {
    status: 'auto',
    approvalMode: 'auto',
    canAutoApprove: true,
    requiresManualApproval: false,
    blockerCount,
    warningCount,
    rationale: changeCount > 0
      ? `未发现 blocker，策略允许自动通过；本次 working 相比 base 有 ${changeCount} 项结构化变化。`
      : '未发现 blocker，策略允许自动通过；working 与 base 暂无结构化变化。',
    reasons,
  };
}

function buildAiTimelineWorkNodeDiff(node) {
  const riskFlags = Array.isArray(node.riskFlags) ? node.riskFlags : [];
  const diff = diffAiTimelinePayloads(node.basePayload, node.workingPayload);
  const checkoutDecision = buildAiTimelineCheckoutDecisionForElectron({
    approvalPolicy: node.approvalPolicy,
    riskFlags,
    diff,
  });
  return {
    ok: true,
    path: getAiTimelineWorkNodesPath(),
    nodeId: node.id,
    saveId: node.saveId,
    branchId: node.branchId,
    status: node.status,
    diff,
    riskFlags,
    readyToCheckout: checkoutDecision.canAutoApprove || !checkoutDecision.requiresManualApproval,
    checkoutDecision,
  };
}

function normalizeAiTimelineRiskFlags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isPlainObject(item))
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : makeAiTimelineWorkNodeId('ai-timeline-risk'),
      severity: ['info', 'warning', 'blocker'].includes(item.severity) ? item.severity : 'warning',
      code: typeof item.code === 'string' && item.code.trim() ? item.code.trim() : 'unspecified-risk',
      message: typeof item.message === 'string' && item.message.trim() ? item.message.trim() : 'Unspecified AI timeline risk.',
      ...(typeof item.path === 'string' && item.path.trim() ? { path: item.path.trim() } : {}),
    }));
}

function normalizeAiTimelineApproval(value, fallbackMode = 'auto') {
  const approvedAt = Date.now();
  if (!isPlainObject(value)) {
    return {
      mode: fallbackMode,
      approvedAt,
      approvedBy: fallbackMode === 'manual' ? 'user' : 'ai',
      rationale: fallbackMode === 'manual' ? 'Manual approval required.' : 'Auto-approved by low-risk work node policy.',
    };
  }
  const mode = value.mode === 'manual' ? 'manual' : 'auto';
  return {
    mode,
    approvedAt: typeof value.approvedAt === 'number' ? value.approvedAt : approvedAt,
    approvedBy: ['ai', 'user', 'system'].includes(value.approvedBy) ? value.approvedBy : (mode === 'manual' ? 'user' : 'ai'),
    rationale: typeof value.rationale === 'string' && value.rationale.trim()
      ? value.rationale.trim()
      : (mode === 'manual' ? 'Manual approval recorded.' : 'Auto-approved by work node policy.'),
  };
}

function makeAiTimelineWorkNodeLog(level, message, details = undefined) {
  return {
    id: makeAiTimelineWorkNodeId('ai-timeline-log'),
    at: Date.now(),
    level,
    message,
    ...(details ? { details } : {}),
  };
}

function validateAiTimelineWorkNodePayload(payload, fieldName) {
  if (!isPlainObject(payload)) {
    return `${fieldName} must be an object.`;
  }
  if (!Array.isArray(payload.selectedCharacters)) {
    return `${fieldName}.selectedCharacters must be an array.`;
  }
  if (!isPlainObject(payload.timelineData)) {
    return `${fieldName}.timelineData must be an object.`;
  }
  if (!Array.isArray(payload.timelineData.staffLines)) {
    return `${fieldName}.timelineData.staffLines must be an array.`;
  }
  if (!isPlainObject(payload.skillButtonTable)) {
    return `${fieldName}.skillButtonTable must be an object.`;
  }
  if (!Array.isArray(payload.allBuffList)) {
    return `${fieldName}.allBuffList must be an array.`;
  }
  return null;
}

function toAiTimelineWorkNodeListItem(node) {
  if (!isPlainObject(node)) return node;
  const { basePayload, workingPayload, ...item } = node;
  return item;
}

function toAiTimelineWorkNodeCommitListItem(commit) {
  if (!isPlainObject(commit)) return commit;
  const { basePayload, appliedPayload, ...item } = commit;
  return item;
}

function buildAiTimelineWorkNodeListResult() {
  const archive = getAiTimelineWorkNodeStore().list();
  return {
    ok: true,
    path: getAiTimelineWorkNodesPath(),
    archive: {
      ...archive,
      nodes: [...archive.nodes]
        .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
        .map(toAiTimelineWorkNodeListItem),
      commits: [...archive.commits]
        .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
        .map(toAiTimelineWorkNodeCommitListItem),
    },
  };
}

function readAiTimelineWorkNode(id) {
  const nodeId = sanitizeAiTimelineWorkNodeId(id, 'ai-timeline-node');
  const node = getAiTimelineWorkNodeStore().getNode(nodeId);
  if (!node) {
    throw new Error(`AI timeline work node not found: ${nodeId}`);
  }
  return { ok: true, path: getAiTimelineWorkNodesPath(), node };
}

function createAiTimelineWorkNode(payload) {
  if (!payload?.saveId || typeof payload.saveId !== 'string') {
    throw new Error('AI work node create requires saveId.');
  }
  const saveId = sanitizeAiTimelineWorkNodeId(payload.saveId, 'save');
  const basePayload = payload.basePayload;
  const payloadError = validateAiTimelineWorkNodePayload(basePayload, 'basePayload');
  if (payloadError) {
    throw new Error(payloadError);
  }
  const requestedWorkingPayload = payload?.workingPayload && isPlainObject(payload.workingPayload) ? payload.workingPayload : basePayload;
  const workingPayloadError = validateAiTimelineWorkNodePayload(requestedWorkingPayload, 'workingPayload');
  if (workingPayloadError) {
    throw new Error(workingPayloadError);
  }
  const now = Date.now();
  const store = getAiTimelineWorkNodeStore();
  const hasParentNodeInput = Object.prototype.hasOwnProperty.call(payload || {}, 'parentNodeId');
  const requestedParentNodeId = typeof payload.parentNodeId === 'string' && payload.parentNodeId.trim()
    ? sanitizeAiTimelineWorkNodeId(payload.parentNodeId, 'ai-timeline-node')
    : undefined;
  const parentNodeId = hasParentNodeInput ? requestedParentNodeId : store.getHead(saveId)?.nodeId;
  const node = {
    id: sanitizeAiTimelineWorkNodeId(payload.id, 'ai-timeline-node'),
    ...(parentNodeId ? { parentNodeId } : {}),
    saveId,
    branchId: sanitizeAiTimelineWorkNodeId(payload.branchId, 'branch'),
    createdAt: now,
    updatedAt: now,
    label: typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : 'AI Timeline Work Node',
    status: 'open',
    basePayload: cloneJsonValue(basePayload),
    workingPayload: cloneJsonValue(requestedWorkingPayload),
    baseSummary: summarizeAiTimelinePayload(basePayload),
    workingSummary: summarizeAiTimelinePayload(requestedWorkingPayload),
    approvalPolicy: ['auto-low-risk', 'ask-on-risk', 'manual'].includes(payload.approvalPolicy) ? payload.approvalPolicy : 'auto-low-risk',
    riskFlags: normalizeAiTimelineRiskFlags(payload.riskFlags),
    logs: [makeAiTimelineWorkNodeLog('info', 'Created AI timeline work node from checkout payload.')],
  };
  store.saveNode(node);
  mirrorAiTimelineWorkNodeToRepository(node);
  return { ok: true, path: getAiTimelineWorkNodesPath(), node };
}

function updateAiTimelineWorkNode(id, payload = {}) {
  const nodeId = sanitizeAiTimelineWorkNodeId(id, 'ai-timeline-node');
  const node = getAiTimelineWorkNodeStore().getNode(nodeId);
  if (!node) {
    throw new Error(`AI timeline work node not found: ${nodeId}`);
  }
  const workingPayload = Object.prototype.hasOwnProperty.call(payload || {}, 'workingPayload')
    ? payload.workingPayload
    : node.workingPayload;
  const payloadError = validateAiTimelineWorkNodePayload(workingPayload, 'workingPayload');
  if (payloadError) {
    throw new Error(payloadError);
  }
  const allowedStatuses = new Set(['open', 'ready', 'committed', 'applied', 'abandoned']);
  const riskFlags = Object.prototype.hasOwnProperty.call(payload || {}, 'riskFlags')
    ? normalizeAiTimelineRiskFlags(payload.riskFlags)
    : (Array.isArray(node.riskFlags) ? node.riskFlags : []);
  const hasParentNodePatch = Object.prototype.hasOwnProperty.call(payload || {}, 'parentNodeId');
  const hasLabelPatch = Object.prototype.hasOwnProperty.call(payload || {}, 'label');
  const label = hasLabelPatch && typeof payload.label === 'string' && payload.label.trim()
    ? payload.label.trim().slice(0, 120)
    : node.label;
  const parentNodeId = hasParentNodePatch && typeof payload.parentNodeId === 'string' && payload.parentNodeId.trim()
    ? sanitizeAiTimelineWorkNodeId(payload.parentNodeId, 'ai-timeline-node')
    : undefined;
  const nextNode = {
    ...node,
    ...(hasParentNodePatch ? (parentNodeId ? { parentNodeId } : { parentNodeId: undefined }) : {}),
    label,
    updatedAt: Date.now(),
    status: allowedStatuses.has(payload.status) ? payload.status : node.status,
    workingPayload: cloneJsonValue(workingPayload),
    workingSummary: summarizeAiTimelinePayload(workingPayload),
    riskFlags,
    logs: [
      makeAiTimelineWorkNodeLog('info', 'Updated AI timeline work node.', {
        riskFlagCount: riskFlags.length,
        status: allowedStatuses.has(payload.status) ? payload.status : node.status,
        ...(hasLabelPatch ? { label } : {}),
      }),
      ...(Array.isArray(node.logs) ? node.logs : []),
    ],
  };
  getAiTimelineWorkNodeStore().saveNode(nextNode);
  mirrorAiTimelineWorkNodeToRepository(nextNode);
  return { ok: true, path: getAiTimelineWorkNodesPath(), node: nextNode };
}

function deleteAiTimelineWorkNode(id) {
  const nodeId = sanitizeAiTimelineWorkNodeId(id, 'ai-timeline-node');
  getAiTimelineWorkNodeStore().deleteSubtree(nodeId);
  if (getTimelineRepository().getWorkNode(nodeId)) {
    getTimelineRepository().deleteWorkNodeSubtree(nodeId);
  }
  return buildAiTimelineWorkNodeListResult();
}

function commitAiTimelineWorkNode(id, payload = {}) {
  const nodeId = sanitizeAiTimelineWorkNodeId(id, 'ai-timeline-node');
  const node = getAiTimelineWorkNodeStore().getNode(nodeId);
  if (!node) {
    throw new Error(`AI timeline work node not found: ${nodeId}`);
  }
  const riskFlags = Object.prototype.hasOwnProperty.call(payload || {}, 'riskFlags')
    ? normalizeAiTimelineRiskFlags(payload.riskFlags)
    : (Array.isArray(node.riskFlags) ? node.riskFlags : []);
  const explicitApproval = isPlainObject(payload.approval);
  if (node.approvalPolicy === 'manual' && !explicitApproval) {
    throw new Error('Manual approval policy requires explicit approval before commit.');
  }
  if (riskFlags.some((risk) => risk.severity === 'blocker') && !explicitApproval) {
    throw new Error('Blocker risk flags require explicit approval before commit.');
  }
  const now = Date.now();
  const approval = normalizeAiTimelineApproval(payload.approval, explicitApproval ? 'manual' : 'auto');
  const commit = {
    id: sanitizeAiTimelineWorkNodeId(payload.commitId, 'ai-timeline-commit'),
    nodeId: node.id,
    saveId: node.saveId,
    branchId: node.branchId,
    createdAt: now,
    label: typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : node.label,
    summary: diffAiTimelinePayloadSummary(node.basePayload, node.workingPayload),
    basePayload: cloneJsonValue(node.basePayload),
    appliedPayload: cloneJsonValue(node.workingPayload),
    riskFlags,
    approval,
    checkoutApplied: false,
  };
  const nextNode = {
    ...node,
    status: 'committed',
    updatedAt: now,
    riskFlags,
    logs: [
      makeAiTimelineWorkNodeLog('info', `Committed AI timeline work node as ${commit.id}.`, { approval }),
      ...(Array.isArray(node.logs) ? node.logs : []),
    ],
  };
  getAiTimelineWorkNodeStore().saveNodeAndCommit(nextNode, commit);
  mirrorAiTimelineWorkNodeToRepository(nextNode);
  return { ok: true, path: getAiTimelineWorkNodesPath(), node: nextNode, commit };
}

function markAiTimelineWorkNodeCheckoutApplied(id, payload = {}) {
  const nodeId = sanitizeAiTimelineWorkNodeId(id, 'ai-timeline-node');
  const store = getAiTimelineWorkNodeStore();
  const node = store.getNode(nodeId);
  if (!node) {
    throw new Error(`AI timeline work node not found: ${nodeId}`);
  }
  const commitId = typeof payload.commitId === 'string' && payload.commitId.trim() ? payload.commitId.trim() : '';
  const targetCommit = commitId ? store.getCommit(commitId) : store.getLatestCommitForNode(node.id);
  if (targetCommit?.nodeId !== node.id) {
    throw new Error(`AI timeline work node commit not found for node: ${node.id}`);
  }
  if (!targetCommit) {
    throw new Error(`AI timeline work node commit not found for node: ${node.id}`);
  }
  const appliedAt = typeof payload.appliedAt === 'number' ? payload.appliedAt : Date.now();
  const appliedBy = ['ai', 'user', 'system'].includes(payload.appliedBy) ? payload.appliedBy : 'system';
  const checkout = {
    appliedAt,
    appliedBy,
    rationale: typeof payload.rationale === 'string' && payload.rationale.trim()
      ? payload.rationale.trim()
      : 'Renderer checkout applied to current timeline payload.',
  };
  const nextCommit = {
    ...targetCommit,
    checkoutApplied: true,
    checkout,
  };
  const nextNode = {
    ...node,
    status: 'applied',
    updatedAt: appliedAt,
    logs: [
      makeAiTimelineWorkNodeLog('info', `Applied AI timeline work node checkout from ${nextCommit.id}.`, { checkout }),
      ...(Array.isArray(node.logs) ? node.logs : []),
    ],
  };
  store.saveNodeAndCommit(nextNode, nextCommit, { setHead: true });
  mirrorAiTimelineWorkNodeToRepository(nextNode);
  getTimelineRepository().setCheckoutRef({
    timelineId: nextNode.saveId || 'current-main-workbench',
    targetType: 'work-node',
    targetId: nextNode.id,
    updatedAt: appliedAt,
  });
  return { ok: true, path: getAiTimelineWorkNodesPath(), node: nextNode, commit: nextCommit };
}

function markAiTimelineWorkNodeRollbackApplied(id, payload = {}) {
  const nodeId = sanitizeAiTimelineWorkNodeId(id, 'ai-timeline-node');
  const store = getAiTimelineWorkNodeStore();
  const node = store.getNode(nodeId);
  if (!node) {
    throw new Error(`AI timeline work node not found: ${nodeId}`);
  }
  const appliedAt = typeof payload.appliedAt === 'number' ? payload.appliedAt : Date.now();
  const appliedBy = ['ai', 'user', 'system'].includes(payload.appliedBy) ? payload.appliedBy : 'system';
  const rollback = {
    appliedAt,
    appliedBy,
    rationale: typeof payload.rationale === 'string' && payload.rationale.trim()
      ? payload.rationale.trim()
      : 'Renderer rollback applied from AI timeline work node basePayload.',
  };
  const nextNode = {
    ...node,
    status: 'ready',
    updatedAt: appliedAt,
    logs: [makeAiTimelineWorkNodeLog('info', 'Restored current checkout from work node basePayload.', {
      ...rollback,
      sourceNodeId: node.id,
    }), ...(Array.isArray(node.logs) ? node.logs : [])],
  };
  store.saveNode(nextNode);
  mirrorAiTimelineWorkNodeToRepository(nextNode);
  getTimelineRepository().appendAuditEvent({
    id: `work-node-base-restored-${node.id}-${appliedAt}`,
    timelineId: nextNode.saveId || 'current-main-workbench',
    eventType: 'work-node.base-restored',
    subjectType: 'work-node',
    subjectId: node.id,
    details: rollback,
    createdAt: appliedAt,
  });
  return { ok: true, path: getAiTimelineWorkNodesPath(), node: nextNode, rollback };
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
        lowerName !== 'now-storage-state.json' &&
        lowerName !== 'ai-timeline-worknodes.json';
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
    const storageScope = requestedStorageScope === 'local' || source === 'local' || scope === 'local' ? 'local' : 'share';
    const archive = {
      ...archivePayload,
      id: sanitizeArchiveId(payload.id || payload.name),
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : sanitizeArchiveId(payload.id),
      storageScope,
    };
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

ipcMain.handle('desktop:list-ai-timeline-worknodes', () => {
  try {
    return buildAiTimelineWorkNodeListResult();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:create-ai-timeline-worknode', (_event, payload) => {
  try {
    return createAiTimelineWorkNode(payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:read-ai-timeline-worknode', (_event, payload) => {
  try {
    return readAiTimelineWorkNode(payload?.id || payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:diff-ai-timeline-worknode', (_event, payload) => {
  try {
    return buildAiTimelineWorkNodeDiff(readAiTimelineWorkNode(payload?.id || payload).node);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:update-ai-timeline-worknode', (_event, payload) => {
  try {
    return updateAiTimelineWorkNode(payload?.id, payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:commit-ai-timeline-worknode', (_event, payload) => {
  try {
    return commitAiTimelineWorkNode(payload?.id, payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:mark-ai-timeline-worknode-checkout-applied', (_event, payload) => {
  try {
    return markAiTimelineWorkNodeCheckoutApplied(payload?.id, payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:mark-ai-timeline-worknode-rollback-applied', (_event, payload) => {
  try {
    return markAiTimelineWorkNodeRollbackApplied(payload?.id, payload);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('desktop:delete-ai-timeline-worknode', (_event, payload) => {
  try {
    return deleteAiTimelineWorkNode(payload?.id || payload);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || 'ai-worknode-delete-failed',
      status: error?.status || 500,
    };
  }
});

app.whenReady().then(() => {
  if (process.platform === 'win32' && fs.existsSync(APP_ICON_ICO_PATH)) {
    app.setAppUserModelId('com.dmg.def');
  }
  Menu.setApplicationMenu(null);
  createTray();
  startBridgeServer();

  createShellWindow();
  scheduleStartupWarmups();

  app.on('activate', () => {
    restoreShellWindow();
  });
});

app.on('second-instance', () => {
  restoreShellWindow();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
  destroyWebPrewarmWindow();
  stopServers();
  if (aiTimelineWorkNodeStore) {
    aiTimelineWorkNodeStore.close();
    aiTimelineWorkNodeStore = null;
  }
  if (timelineRepository) {
    timelineRepository.close();
    timelineRepository = null;
  }
});

app.on('window-all-closed', (event) => {
  if (!isAppQuitting) {
    event.preventDefault();
  }
});
