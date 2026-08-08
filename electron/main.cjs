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
  utilityProcess,
} = require('electron');
const { createDesktopStaticServer } = require('./static-host.cjs');
const { createLegacyFillRuntime } = require('./legacy-fill-runtime.cjs');
const { createAgentRuntime } = require('./agent-runtime.cjs');
const {
  DEFAULT_DEEPSEEK_MODEL_ID,
  probeAgentProviderProfile,
  migrateLegacyAgentProviderProfile,
  readAgentProviderProfile,
} = require('./agent-provider-profile.cjs');
const { updateAgentProviderProfile } = require('./agent-provider-transaction.cjs');

const DESKTOP_HOST = '127.0.0.1';
const DESKTOP_PORT = 31457;
const DESKTOP_ORIGIN = `http://${DESKTOP_HOST}:${DESKTOP_PORT}`;
const DEV_ORIGIN = 'http://127.0.0.1:3030';
const DESKTOP_WEB_MARKER = '__desktop_shell';
const MCP_PUBLISHER_QUERY = '__mcp_fill_publisher';
const MCP_REVIEW_GRANT_QUERY = '__mcp_fill_review_grant';
const AGENT_LAUNCH_GRANT_FRAGMENT_KEY = '__agent_launch_grant';
const APPLICATION_ROOT = path.resolve(__dirname, '..');
const SHELL_DOCUMENT_PATH = path.join(__dirname, 'shell', 'index.html');
const applicationMetadata = JSON.parse(
  fs.readFileSync(path.join(APPLICATION_ROOT, 'package.json'), 'utf8'),
);
const APPLICATION_NAME = applicationMetadata.build?.productName || '终末地伤害工作台';
const APPLICATION_VERSION = String(applicationMetadata.version || app.getVersion());
const APPLICATION_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
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

function buildBrowserUrl(routePath = '', options = {}) {
  const includePublisher = options.includePublisher === true;
  const reviewLaunchGrant = typeof options.reviewLaunchGrant === 'string'
    ? options.reviewLaunchGrant
    : '';
  const agentLaunchGrant = typeof options.agentLaunchGrant === 'string'
    ? options.agentLaunchGrant
    : '';
  const url = new URL('/', browserOrigin);
  url.searchParams.set(DESKTOP_WEB_MARKER, '1');
  if (includePublisher && legacyFillRuntime?.publisherCapability) {
    url.searchParams.set(MCP_PUBLISHER_QUERY, legacyFillRuntime.publisherCapability);
  }
  if (routePath) {
    const route = routePath.startsWith('/') ? routePath : `/${routePath}`;
    const hashQuery = new URLSearchParams();
    if (reviewLaunchGrant) hashQuery.set(MCP_REVIEW_GRANT_QUERY, reviewLaunchGrant);
    if (agentLaunchGrant) hashQuery.set(AGENT_LAUNCH_GRANT_FRAGMENT_KEY, agentLaunchGrant);
    url.hash = `#${route}${hashQuery.size ? `?${hashQuery}` : ''}`;
  }
  return url.href;
}

let shellWindow = null;
let tray = null;
let staticHost = null;
let legacyFillRuntime = null;
let agentRuntime = null;
let agentRuntimeOptions = null;
let agentProviderProfilePath = '';
let openAgentModePromise = null;
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
  await shell.openExternal(buildBrowserUrl('', { includePublisher: true }));
  return buildBrowserUrl();
}

async function openMcpFillWorkspace() {
  if (!legacyFillRuntime) throw new Error('MCP 填表运行时尚未初始化。');
  const runtime = await legacyFillRuntime.start();
  if (!runtime.ready) throw new Error(runtime.reason || 'MCP 填表服务未就绪。');
  const reviewLaunchGrant = legacyFillRuntime.issueReviewLaunchGrant();
  await shell.openExternal(buildBrowserUrl('/mcp-fill', {
    includePublisher: true,
    reviewLaunchGrant,
  }));
  return { url: buildBrowserUrl('/mcp-fill'), runtime };
}

async function openAgentMode() {
  if (openAgentModePromise) return openAgentModePromise;
  openAgentModePromise = (async () => {
    if (!agentRuntime) throw new Error('DEF Agent Host 尚未初始化。');
    const launch = await agentRuntime.issueLaunchGrant({ origin: browserOrigin });
    await shell.openExternal(buildBrowserUrl('/timeline/ai', {
      agentLaunchGrant: launch.grant,
    }));
    return {
      url: buildBrowserUrl('/timeline/ai'),
      runtime: agentRuntime.state(),
    };
  })().finally(() => {
    openAgentModePromise = null;
  });
  return openAgentModePromise;
}

function createCandidateAgentRuntime({ candidateProfilePath, candidateRoot }) {
  if (!agentRuntimeOptions) throw new Error('DEF Agent Host 尚未初始化。');
  return createAgentRuntime({
    ...agentRuntimeOptions,
    runtimeRoot: path.join(candidateRoot, 'host'),
    engineStoreRoot: path.join(candidateRoot, 'engine'),
    sessionStoreRoot: path.join(candidateRoot, 'sessions'),
    productCommandStoreRoot: path.join(candidateRoot, 'product-commands'),
    engineProfilePath: candidateProfilePath,
  });
}

async function saveAgentProviderProfile(payload) {
  if (!agentRuntime || !agentRuntimeOptions) {
    throw new Error('DEF Agent Host 尚未初始化。');
  }
  return updateAgentProviderProfile({
    profilePath: agentProviderProfilePath,
    payload,
    runtime: agentRuntime,
    probeProfile: (candidatePath) => probeAgentProviderProfile(candidatePath),
    createCandidateRuntime,
  });
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
      label: '打开 MCP 填表',
      click: () => void openMcpFillWorkspace().catch((error) => {
        dialog.showErrorBox('无法打开 MCP 填表', error instanceof Error ? error.message : String(error));
      }),
    },
    {
      label: '打开 AI 模式',
      click: () => void openAgentMode().catch((error) => {
        dialog.showErrorBox('无法打开 AI 模式', error instanceof Error ? error.message : String(error));
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
  const icon = fs.existsSync(APPLICATION_ICON_PATH)
    ? nativeImage.createFromPath(APPLICATION_ICON_PATH)
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
    icon: process.platform === 'win32'
      ? path.join(__dirname, 'assets', 'icon.ico')
      : APPLICATION_ICON_PATH,
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
    const mcpState = legacyFillRuntime?.state();
    const agentState = agentRuntime?.state();
    return {
      host: 'desktop-shell',
      browserWorkspace: true,
      releaseTools: { images: true, data: true },
      agent: {
        available: true,
        framework: true,
        engine: agentState?.health?.engine?.state === 'ready',
        reason: agentState?.reason || 'DEF Agent Host 尚未初始化',
      },
      mcp: {
        available: Boolean(mcpState?.ready),
        reason: mcpState?.reason || 'MCP 填表服务尚未初始化',
      },
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
      mcpReviewUrl: buildBrowserUrl('/mcp-fill'),
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
  ipcMain.handle('desktop:get-mcp-state', (event) => {
    requireTrustedSender(event);
    return legacyFillRuntime?.state() || {
      running: false,
      ready: false,
      reason: 'MCP 填表运行时尚未初始化。',
    };
  });
  ipcMain.handle('desktop:get-agent-state', (event) => {
    requireTrustedSender(event);
    return agentRuntime?.state() || {
      running: false,
      ready: false,
      state: 'not-started',
      reason: 'DEF Agent Host 尚未初始化。',
    };
  });
  ipcMain.handle('desktop:get-agent-profile', (event) => {
    requireTrustedSender(event);
    return readAgentProviderProfile(agentProviderProfilePath) || {
      configured: false,
      ref: 'default',
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      modelId: DEFAULT_DEEPSEEK_MODEL_ID,
      apiKeyConfigured: false,
    };
  });
  ipcMain.handle('desktop:save-agent-profile', async (event, payload) => {
    requireTrustedSender(event);
    try {
      const result = await saveAgentProviderProfile(payload || {});
      return {
        ok: true,
        profile: result.profile,
        runtime: result.runtime,
        changed: result.changed,
      };
    } catch (error) {
      return {
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'AGENT_PROVIDER_UPDATE_FAILED',
        error: error instanceof Error ? error.message : 'Provider 更新失败，旧配置仍在使用。',
      };
    }
  });
  ipcMain.handle('desktop:open-agent-mode', async (event) => {
    requireTrustedSender(event);
    try {
      return { ok: true, ...await openAgentMode() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('desktop:open-mcp-fill', async (event) => {
    requireTrustedSender(event);
    try {
      const result = await openMcpFillWorkspace();
      return {
        ok: true,
        ...result,
        clientConfigPath: legacyFillRuntime.clientConfigPath,
      };
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
  if (process.platform === 'darwin' && app.dock && fs.existsSync(APPLICATION_ICON_PATH)) {
    const dockIcon = nativeImage.createFromPath(APPLICATION_ICON_PATH);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }
  loadSettings();
  const legacyFillRuntimeRoot = path.join(
    app.getPath('userData'),
    'runtime',
    'legacy-fill-service',
  );
  legacyFillRuntime = createLegacyFillRuntime({
    applicationRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked')
      : APPLICATION_ROOT,
    runtimeRoot: legacyFillRuntimeRoot,
    browserOrigin,
    diagnostic,
    launchService: ({ servicePath, cwd, env }) => utilityProcess.fork(servicePath, [], {
      cwd,
      env,
      stdio: 'pipe',
      serviceName: 'Legacy Fill MCP Service',
    }),
  });
  const runtimeApplicationRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : APPLICATION_ROOT;
  const developmentProfileOverride = !app.isPackaged
    ? String(process.env.DMG_AGENT_PROVIDER_PROFILE_PATH || '').trim()
    : '';
  agentProviderProfilePath = developmentProfileOverride
    ? path.resolve(developmentProfileOverride)
    : path.join(
      app.getPath('userData'),
      'runtime',
      'def-agent-provider-profiles.json',
    );
  if (!developmentProfileOverride) {
    const profileMigration = migrateLegacyAgentProviderProfile(agentProviderProfilePath, [
      path.join(app.getPath('appData'), 'dmg-end-field', 'runtime', 'def-agent', 'config.json'),
      path.join(APPLICATION_ROOT, '.runtime', 'def-agent', 'config.json'),
    ]);
    if (profileMigration.migrated) diagnostic(`migrated legacy Agent provider profile from ${profileMigration.sourcePath}`);
  } else {
    diagnostic('using development-only Agent provider profile override');
  }
  agentRuntimeOptions = {
    applicationRoot: runtimeApplicationRoot,
    runtimeRoot: path.join(app.getPath('userData'), 'runtime', 'def-agent-host'),
    engineStoreRoot: path.join(app.getPath('userData'), 'runtime', 'def-runtime-engine'),
    sessionStoreRoot: path.join(app.getPath('userData'), 'runtime', 'def-agent-host', 'session-store'),
    productCommandStoreRoot: path.join(app.getPath('userData'), 'runtime', 'def-agent-host', 'product-commands'),
    engineProfilePath: agentProviderProfilePath,
    browserOrigin,
    diagnostic,
    launchService: ({ servicePath, cwd, env }) => utilityProcess.fork(servicePath, [], {
      cwd,
      env,
      stdio: 'pipe',
      serviceName: 'DEF Agent Host',
    }),
  };
  agentRuntime = createAgentRuntime(agentRuntimeOptions);
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const browserHostRoot = isDevelopment
    ? path.join(APPLICATION_ROOT, 'electron', 'shell')
    : path.join(APPLICATION_ROOT, 'dist');
  diagnostic(isDevelopment
    ? 'starting MCP browser bridge without static files'
    : `starting browser workspace host from ${browserHostRoot}`);
  staticHost = await createDesktopStaticServer({
    rootDir: browserHostRoot,
    host: DESKTOP_HOST,
    port: DESKTOP_PORT,
    requestHandler: async (request, response) => (
      await agentRuntime.handleBrowserRequest(request, response)
      || await legacyFillRuntime.handleBrowserRequest(request, response)
    ),
    serveStatic: !isDevelopment,
  });
  diagnostic(`browser workspace bridge listening at ${staticHost.origin}`);
  const mcpState = await legacyFillRuntime.start();
  diagnostic(`mcp fill ${mcpState.ready ? 'ready' : 'unavailable'} ${mcpState.reason}`);

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
  void (async () => {
    // Keep the loopback bridge alive while each child receives its graceful
    // shutdown request. The Agent goes first so active turns and journals are
    // terminal before the browser endpoint disappears.
    if (agentRuntime) await agentRuntime.stop().catch((error) => diagnostic(`agent shutdown failed: ${error.message}`));
    if (legacyFillRuntime) await legacyFillRuntime.stop().catch((error) => diagnostic(`MCP shutdown failed: ${error.message}`));
    if (staticHost) await staticHost.close().catch((error) => diagnostic(`browser bridge shutdown failed: ${error.message}`));
  })().finally(() => {
    allowQuit = true;
    app.quit();
  });
});
app.on('window-all-closed', () => {
  // The tray owns the Shell lifecycle; closing the window only hides it.
});
