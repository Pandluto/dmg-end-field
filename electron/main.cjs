const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } = require('electron');

const DEV_SHELL_URL = 'http://127.0.0.1:3030/shell/index.html';
const WEB_HOST = '127.0.0.1';
const WEB_PORT = 3030;
const BRIDGE_PORT = 31457;
const isDev = process.argv.includes('--dev');
const gotSingleInstanceLock = app.requestSingleInstanceLock();

let shellWindow = null;
let bridgeServer = null;
let webServer = null;
let webOpenedAt = null;
let shellStartedAt = null;
let isAppQuitting = false;
let isForceClosingShell = false;
let shellTray = null;

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

function buildWindowOptions(role, extra = {}) {
  return {
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--desktop-role=${role}`],
    },
    ...extra,
  };
}

function getWebUrl() {
  return `http://${WEB_HOST}:${WEB_PORT}`;
}

function createTrayIconImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#107c41"/>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="#f4fff7"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
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
  if (!shellTray) {
    return;
  }

  const shellVisible = getShellVisibilityState() === 'visible';
  shellTray.setToolTip(shellVisible ? 'DEF 桌面端 Shell 已打开' : 'DEF 桌面端后台运行中');
  shellTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开主界面',
        click: () => {
          openWeb();
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
  if (isDev || shellTray) {
    return;
  }

  shellTray = new Tray(createTrayIconImage());
  shellTray.on('double-click', () => {
    restoreShellWindow();
  });
  updateTrayMenu();
}

function createShellWindow(options = {}) {
  const { startMinimized = false } = options;

  if (shellWindow && !shellWindow.isDestroyed()) {
    if (startMinimized) {
      shellWindow.minimize();
    } else {
      restoreShellWindow();
    }
    return shellWindow;
  }

  shellWindow = new BrowserWindow(
    buildWindowOptions('shell', {
      width: 540,
      height: 680,
      minWidth: 420,
      minHeight: 560,
      title: 'DEF Desktop Shell',
      show: isDev ? true : !startMinimized,
    })
  );
  shellStartedAt = Date.now();

  if (isDev) {
    shellWindow.loadURL(DEV_SHELL_URL);
  } else {
    shellWindow.loadFile(path.join(__dirname, 'shell', 'index.html'));
  }

  if (startMinimized && !isDev) {
    shellWindow.once('ready-to-show', () => {
      if (shellWindow && !shellWindow.isDestroyed()) {
        shellWindow.hide();
        updateTrayMenu();
      }
    });
  }

  shellWindow.on('close', (event) => {
    if (isDev || isAppQuitting || isForceClosingShell) {
      return;
    }

    event.preventDefault();
    hideShellWindow();
  });

  shellWindow.on('show', updateTrayMenu);
  shellWindow.on('hide', updateTrayMenu);
  shellWindow.on('restore', updateTrayMenu);
  shellWindow.on('minimize', updateTrayMenu);

  shellWindow.on('closed', () => {
    shellWindow = null;
    shellStartedAt = null;
    isForceClosingShell = false;
    updateTrayMenu();
  });

  updateTrayMenu();
  return shellWindow;
}

function restoreShellWindow() {
  if (!shellWindow || shellWindow.isDestroyed()) {
    return createShellWindow();
  }

  shellWindow.show();

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
    host: WEB_HOST,
    port: BRIDGE_PORT,
    shell: getShellRuntimeInfo(),
    web: {
      url: getWebUrl(),
      openedAt: webOpenedAt,
    },
  };
}

function openWeb() {
  const url = getWebUrl();
  shell.openExternal(url);
  webOpenedAt = Date.now();
  return {
    opened: true,
    url,
    openedAt: webOpenedAt,
  };
}

function startBridgeServer() {
  if (bridgeServer) {
    return;
  }

  bridgeServer = http.createServer((request, response) => {
    const method = request.method || 'GET';
    const requestUrl = new URL(request.url || '/', `http://${WEB_HOST}:${BRIDGE_PORT}`);

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
          reason: 'launched',
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
    console.error(`Bridge server failed on ${WEB_HOST}:${BRIDGE_PORT}: ${detail}`);
    if (!isDev) {
      restoreShellWindow();
    }
  });

  bridgeServer.listen(BRIDGE_PORT, WEB_HOST);
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function resolveDistPath(requestPathname) {
  const normalized = requestPathname === '/' ? '/index.html' : requestPathname;
  const distRoot = path.join(__dirname, '..', 'dist');
  const candidatePath = path.normalize(path.join(distRoot, normalized));

  if (!candidatePath.startsWith(distRoot)) {
    return path.join(distRoot, 'index.html');
  }

  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    return candidatePath;
  }

  return path.join(distRoot, 'index.html');
}

function startWebServer(onReady) {
  if (webServer || isDev) {
    if (typeof onReady === 'function') {
      onReady();
    }
    return;
  }

  webServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', getWebUrl());
    const filePath = resolveDistPath(requestUrl.pathname);

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Internal server error');
        return;
      }

      response.writeHead(200, {
        'Content-Type': getContentType(filePath),
      });
      response.end(data);
    });
  });

  webServer.on('error', (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Web server failed on ${WEB_HOST}:${WEB_PORT}: ${detail}`);
    openWeb();
    restoreShellWindow();
  });

  webServer.listen(WEB_PORT, WEB_HOST, () => {
    if (typeof onReady === 'function') {
      onReady();
    }
  });
}

function stopServers() {
  if (bridgeServer) {
    bridgeServer.close();
    bridgeServer = null;
  }
  if (webServer) {
    webServer.close();
    webServer = null;
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
  webWindowManaged: false,
}));
ipcMain.handle('desktop:open-web', () => openWeb());
ipcMain.handle('desktop:quit-app', () => {
  app.quit();
  return { ok: true };
});

ipcMain.handle('desktop:run-action', (_event, action) => {
  switch (action) {
    case 'capture-probe':
      return {
        ok: true,
        title: 'Capture',
        detail: 'Capture pipeline placeholder is wired. No screenshot backend has been attached yet.',
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
        detail: `Electron shell is alive on ${process.platform}/${process.arch}.`,
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
  createTray();
  startBridgeServer();

  if (isDev) {
    createShellWindow();
  } else {
    createShellWindow({ startMinimized: true });
    startWebServer(() => {
      openWeb();
    });
  }

  app.on('activate', () => {
    if (isDev && BrowserWindow.getAllWindows().length === 0) {
      createShellWindow();
      return;
    }

    if (!isDev) {
      restoreShellWindow();
    }
  });
});

app.on('second-instance', () => {
  if (isDev) {
    restoreShellWindow();
    return;
  }

  createShellWindow({ startMinimized: true });
  openWeb();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  if (shellTray) {
    shellTray.destroy();
    shellTray = null;
  }
  stopServers();
});

app.on('window-all-closed', () => {
  if (isDev && process.platform !== 'darwin') {
    app.quit();
  }
});
