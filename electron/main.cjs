const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
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
app.commandLine.appendSwitch('high-dpi-support', '1');
const APP_ICON_PNG_PATH = path.join(__dirname, 'assets', 'icon.png');
const APP_ICON_ICO_PATH = path.join(__dirname, 'assets', 'icon.ico');

let shellWindow = null;
let bridgeServer = null;
let shellStartedAt = null;
let aiCliRestProcess = null;
let aiCliRestStartedAt = null;
let isAppQuitting = false;
let appTray = null;

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
      minWidth: SHELL_MIN_WIDTH,
      minHeight: SHELL_MIN_HEIGHT,
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

function isAiCliRestRunning() {
  return Boolean(aiCliRestProcess && aiCliRestProcess.exitCode === null && !aiCliRestProcess.killed);
}

function getAiCliRestRuntimeInfo() {
  return {
    running: isAiCliRestRunning(),
    pid: aiCliRestProcess?.pid ?? null,
    startedAt: aiCliRestStartedAt,
    url: 'http://127.0.0.1:17321',
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
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJsonUrl(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
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
    request.setTimeout(1000, () => {
      request.destroy(new Error('request timeout'));
    });
  });
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
        const url = isDev ? 'http://127.0.0.1:3030/' : `http://${BRIDGE_HOST}:${BRIDGE_PORT}/`;
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
        const relPath = decodeURIComponent(requestUrl.pathname.replace(/^\/user-images\//, ''));
        if (/(^|\/)\.\.(\/|$)/.test(relPath) || relPath.includes('\\')) {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }
        const absPath = resolveUserImageFileByRequestPath(relPath);
        if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
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
  stopAiCliRest();
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
}));
ipcMain.handle('desktop:quit-app', () => {
  app.quit();
  return { ok: true };
});

// ── Image asset management ──

const MANAGED_SUBDIR = 'assets/images';

function getAssetsRoot() {
  if (isDev) {
    return path.join(__dirname, '..', 'public', 'assets');
  }
  return ensureProductionAssetsRoot();
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
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      AI_CLI_REST_PORT: '17321',
    },
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
  stoppingProcess.kill();
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
  return isDev ? getDevImageRoot() : ensureProductionAssetsRoot();
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
  const list = scanAllImageAssets();
  const manifestDir = getBuiltinManifestDir();
  // Browser fallback still reads assets/images/_manifest.json.
  // Despite the legacy path, its contents represent the full builtin asset image set.
  const manifestPath = path.join(manifestDir, '_manifest.json');
  const slim = list
    .filter((entry) => entry.source === 'builtin')
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
  results.push({
    fileName,
    baseName,
    ext,
    relativePath: normalizedRel,
    canonicalPath: `user-images/${fileName}`,
    publicUrl: `http://127.0.0.1:${BRIDGE_PORT}/user-images/${encodeURIComponent(fileName)}`,
    source,
    writable,
    rootId: rootInfo?.id,
    rootLabel: rootInfo?.label,
    rootDirectory: rootInfo?.directory,
    rootPriority: rootInfo?.priority ?? 999,
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
  const imageRoots = getImageRootEntries();
  const userDir = getUserImagesDir();
  const builtinAndUserShareRoot = path.resolve(builtinAssetsRoot) === path.resolve(userDir);
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

  // ── Scan builtin (read-only) ──
  if (!builtinAndUserShareRoot && fs.existsSync(builtinAssetsRoot)) {
    walk(builtinAssetsRoot, '', 'builtin', false);
  }

  // ── Scan configured image roots. Root priority controls /user-images/<fileName> mapping. ──
  for (const rootInfo of imageRoots) {
    if (fs.existsSync(rootInfo.directory)) {
      walk(rootInfo.directory, 'images', rootInfo.legacy ? 'legacy' : 'user', rootInfo.writable, rootInfo);
    }
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

  const list = Array.from(seen.values());
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
  const candidates = scanAllImageAssets()
    .filter((entry) => entry.kind !== 'dir' && String(entry.fileName || '').toLowerCase() === requestedFileName.toLowerCase())
    .sort((left, right) => (left.rootPriority ?? 999) - (right.rootPriority ?? 999));
  for (const item of candidates) {
    if (!item.rootDirectory) continue;
    const fullPath = path.resolve(item.rootDirectory, item.relativePath.replace(/^assets\/images\/?/, ''));
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }
  return null;
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

app.whenReady().then(() => {
  if (process.platform === 'win32' && fs.existsSync(APP_ICON_ICO_PATH)) {
    app.setAppUserModelId('com.dmg.def');
  }
  Menu.setApplicationMenu(null);
  syncImageManifest();
  createTray();
  startBridgeServer();

  createShellWindow();

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
  stopServers();
});

app.on('window-all-closed', (event) => {
  if (!isAppQuitting) {
    event.preventDefault();
  }
});
