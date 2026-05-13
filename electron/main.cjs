const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
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
const MAIN_CONTENT_WIDTH = 1440;
const MAIN_CONTENT_HEIGHT = 900;
const SHELL_WIDTH = 540;
const SHELL_HEIGHT = 680;
const isDev = process.argv.includes('--dev');
const shellOnly = process.argv.includes('--shell-only');
const gotSingleInstanceLock = app.requestSingleInstanceLock();
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

let mainWindow = null;
let shellWindow = null;
let bridgeServer = null;
let shellStartedAt = null;
let isAppQuitting = false;
let isForceClosingMain = false;
let appTray = null;

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

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
  };
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
