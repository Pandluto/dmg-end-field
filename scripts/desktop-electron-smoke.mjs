import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from '@playwright/test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(projectRoot, 'dist', 'index.html');
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-desktop-smoke-'));
const applicationEntry = path.join(projectRoot, 'electron', 'main.cjs');
const executableArgumentIndex = process.argv.indexOf('--executable');
const packagedExecutable = executableArgumentIndex >= 0
  ? path.resolve(process.argv[executableArgumentIndex + 1] || '')
  : '';
const expectedOrigin = 'http://127.0.0.1:31457';
const retiredRuntimePorts = [17321, 17322, 17323];
const releaseFixtureRoot = path.join(profileRoot, 'release-fixture');
const dataFixtureRoot = path.join(releaseFixtureRoot, 'public', 'data');
const imageFixtureRoot = path.join(releaseFixtureRoot, 'images');
const releaseOutputRoot = path.join(releaseFixtureRoot, 'output');

if (!fs.existsSync(distIndex)) {
  throw new Error('缺少 dist/index.html；请先运行 npm run build:local。');
}
if (packagedExecutable && !fs.existsSync(packagedExecutable)) {
  throw new Error(`桌面可执行文件不存在：${packagedExecutable}`);
}
fs.mkdirSync(dataFixtureRoot, { recursive: true });
fs.mkdirSync(imageFixtureRoot, { recursive: true });
fs.mkdirSync(releaseOutputRoot, { recursive: true });
fs.writeFileSync(path.join(dataFixtureRoot, 'sample.json'), '{"desktop":true}\n', 'utf8');
fs.writeFileSync(
  path.join(imageFixtureRoot, 'sample.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n',
  'utf8',
);

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(750, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function assertRetiredPortsClosed() {
  for (const port of retiredRuntimePorts) {
    assert.equal(await canConnect(port), false, `旧运行时端口仍在监听：${port}`);
  }
}

async function launchDesktop() {
  return electron.launch({
    ...(packagedExecutable
      ? { executablePath: packagedExecutable, args: [] }
      : { args: [applicationEntry] }),
    cwd: projectRoot,
    env: {
      ...process.env,
      DMG_DESKTOP_USER_DATA: profileRoot,
      DMG_DESKTOP_DIAGNOSTICS: '1',
    },
    timeout: 30_000,
  });
}

async function forceCloseDesktop(application) {
  if (!application) return;
  const process = application.process();
  await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await Promise.race([
    new Promise((resolve) => application.once('close', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (process && process.exitCode === null) process.kill('SIGKILL');
}

async function closeDesktop(application, page) {
  const closed = new Promise((resolve) => application.once('close', resolve));
  await page.evaluate(() => window.desktopHost?.quit());
  const closedGracefully = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 12_000)),
  ]);
  assert.equal(closedGracefully, true, '桌面 Shell 没有正常退出');
}

async function inspectBrowserWorkspace(url) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('heading', { name: '先把基础资料装进浏览器' }).waitFor({
      timeout: 60_000,
    });
    const runtime = await page.evaluate(async () => ({
      desktopHost: typeof window.desktopHost,
      desktopWebHost: window.__DMG_DESKTOP_WEB_HOST__,
      workerReady: await window.__DMG_ENSURE_SERVICE_WORKER__?.(),
      controller: navigator.serviceWorker.controller?.scriptURL || '',
    }));
    assert.equal(runtime.desktopHost, 'undefined', '系统浏览器不应获得 Electron preload');
    assert.equal(runtime.desktopWebHost, true, '系统浏览器没有识别本地 Shell 宿主');
    assert.equal(runtime.workerReady, true, '本地图片/资料 Worker 未接管浏览器页面');
    assert.match(runtime.controller, /\/sw-desktop\.js$/u);
    assert.equal(await page.getByText('Electron Shell').count(), 0);
    await context.close();
  } finally {
    await browser.close();
  }
}

let firstApplication;
let secondApplication;

try {
  console.log('[desktop smoke] launching independent shell');
  firstApplication = await launchDesktop();
  const firstPage = await firstApplication.firstWindow({ timeout: 30_000 });
  await firstPage.getByRole('heading', { name: '终末地伤害工作台' }).waitFor({
    timeout: 30_000,
  });
  assert.equal(new URL(firstPage.url()).protocol, 'file:');
  assert.match(firstPage.url(), /\/electron\/shell\/index\.html$/u);
  assert.equal(await firstPage.getByText('工作台在系统浏览器中运行').count(), 1);
  assert.equal(await firstPage.getByText('先把基础资料装进浏览器').count(), 0);

  const shellRuntime = await firstPage.evaluate(async () => ({
    capabilities: await window.desktopHost?.getCapabilities(),
    appInfo: await window.desktopHost?.getAppInfo(),
  }));
  assert.equal(shellRuntime.capabilities?.host, 'desktop-shell');
  assert.equal(shellRuntime.capabilities?.browserWorkspace, true);
  assert.equal(shellRuntime.capabilities?.agent.available, false);
  assert.equal(shellRuntime.capabilities?.mcp.available, false);
  assert.equal(shellRuntime.appInfo?.webOrigin, expectedOrigin);
  assert.equal(shellRuntime.appInfo?.version, '1.8.2');
  assert.match(shellRuntime.appInfo?.webUrl || '', /[?&]__desktop_shell=1(?:&|$)/u);

  const hostResponse = await fetch(shellRuntime.appInfo.webUrl, { redirect: 'error' });
  assert.equal(hostResponse.status, 200);
  await assertRetiredPortsClosed();

  await firstApplication.evaluate(({ shell: electronShell }) => {
    globalThis.__DMG_SMOKE_OPENED_URL__ = '';
    electronShell.openExternal = async (url) => {
      globalThis.__DMG_SMOKE_OPENED_URL__ = url;
    };
  });
  await firstPage.getByRole('button', { name: '打开浏览器工作台' }).click();
  await firstPage.getByText(/浏览器工作台已打开/u).waitFor();
  const openedUrl = await firstApplication.evaluate(() => globalThis.__DMG_SMOKE_OPENED_URL__);
  assert.equal(openedUrl, shellRuntime.appInfo.webUrl);

  await inspectBrowserWorkspace(shellRuntime.appInfo.webUrl);

  const bypassedSelection = await firstPage.evaluate(async (fixture) => (
    window.desktopHost?.buildDataRelease({
      source: fixture.dataSource,
      output: fixture.output,
      dataVersion: 'must-be-denied',
    })
  ), {
    dataSource: path.dirname(dataFixtureRoot),
    output: releaseOutputRoot,
  });
  assert.equal(bypassedSelection?.ok, false);

  await firstApplication.evaluate(({ dialog: electronDialog }, fixture) => {
    const selections = [fixture.dataSource, fixture.imageSource, fixture.output];
    electronDialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selections.shift()],
    });
  }, {
    dataSource: path.dirname(dataFixtureRoot),
    imageSource: imageFixtureRoot,
    output: releaseOutputRoot,
  });

  const releaseResults = await firstPage.evaluate(async () => {
    const dataSelection = await window.desktopHost?.pickDataReleaseSource();
    const imageSelection = await window.desktopHost?.pickImageReleaseSource();
    const outputSelection = await window.desktopHost?.pickReleaseOutput();
    const data = await window.desktopHost?.buildDataRelease({ dataVersion: 'desktop-smoke' });
    const images = await window.desktopHost?.buildImageRelease({
      assetVersion: 'desktop-smoke-images',
      releaseTag: 'desktop-smoke-images',
    });
    return { dataSelection, imageSelection, outputSelection, data, images };
  });
  assert.equal(releaseResults.dataSelection?.ok, true);
  assert.equal(releaseResults.imageSelection?.ok, true);
  assert.equal(releaseResults.outputSelection?.ok, true);
  assert.equal(releaseResults.data?.ok, true, releaseResults.data?.error);
  assert.equal(releaseResults.images?.ok, true, releaseResults.images?.error);
  assert.ok(fs.existsSync(releaseResults.data?.result?.manifestPath || ''));
  assert.ok(fs.existsSync(releaseResults.images?.result?.manifestPath || ''));

  await firstPage.getByLabel('Shell 显示比例').selectOption('1.25');
  await firstPage.waitForTimeout(150);
  await closeDesktop(firstApplication, firstPage);
  firstApplication = undefined;

  console.log('[desktop smoke] relaunching persisted shell settings');
  secondApplication = await launchDesktop();
  const secondPage = await secondApplication.firstWindow({ timeout: 30_000 });
  await secondPage.getByRole('heading', { name: '终末地伤害工作台' }).waitFor({ timeout: 30_000 });
  assert.equal(await secondPage.getByLabel('Shell 显示比例').inputValue(), '1.25');
  assert.equal((await fetch(`${expectedOrigin}/`)).status, 200);
  await assertRetiredPortsClosed();
  await closeDesktop(secondApplication, secondPage);
  secondApplication = undefined;

  console.log(JSON.stringify({
    result: 'independent desktop shell smoke passed',
    shellDocument: 'electron/shell/index.html',
    browserOrigin: expectedOrigin,
    browserUsesPreload: false,
    retiredRuntimePorts,
    releaseTools: true,
    packagedExecutable: packagedExecutable || null,
  }, null, 2));
} catch (error) {
  for (const application of [firstApplication, secondApplication]) {
    if (!application) continue;
    for (const page of application.windows()) {
      const body = await page.locator('body').innerText().catch(() => '');
      console.error(`[desktop smoke] failed page ${page.url()}\n${body.slice(0, 4_000)}`);
    }
  }
  throw error;
} finally {
  await forceCloseDesktop(firstApplication);
  await forceCloseDesktop(secondApplication);
  fs.rmSync(profileRoot, { recursive: true, force: true });
}
