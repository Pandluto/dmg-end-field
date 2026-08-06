import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

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
  await page.evaluate(() => {
    void window.desktopHost?.quit();
  });
  const closedGracefully = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 12_000)),
  ]);
  if (!closedGracefully) await application.close();
  assert.equal(closedGracefully, true, '桌面进程没有在保存握手后正常退出');
}

let firstApplication;
let secondApplication;

try {
  console.log('[desktop smoke] launching fresh profile');
  const firstStartedAt = Date.now();
  firstApplication = await launchDesktop();
  const firstPage = await firstApplication.firstWindow({ timeout: 30_000 });
  await firstPage.getByRole('heading', { name: '先把基础资料装进桌面工作区' }).waitFor({
    timeout: 60_000,
  });
  const firstReadyMs = Date.now() - firstStartedAt;
  console.log(`[desktop smoke] onboarding ready in ${firstReadyMs} ms`);

  assert.equal(new URL(firstPage.url()).origin, expectedOrigin);
  await assertRetiredPortsClosed();

  await firstPage.getByRole('button', { name: '载入完整资料并开始' }).click();
  console.log('[desktop smoke] installing bundled data and images');
  await firstPage.getByRole('heading', { name: '建立第一份排轴' }).waitFor({
    timeout: 180_000,
  });
  console.log('[desktop smoke] bundled resources installed');

  await firstPage.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await firstPage.getByRole('heading', { name: 'Electron Shell' }).waitFor({ timeout: 30_000 });

  const firstRuntime = await firstPage.evaluate(async () => ({
    capabilities: await window.desktopHost?.getCapabilities(),
    appInfo: await window.desktopHost?.getAppInfo(),
    controller: navigator.serviceWorker.controller?.scriptURL || '',
    cacheNames: await caches.keys(),
  }));
  assert.equal(firstRuntime.capabilities?.shell, true);
  assert.equal(firstRuntime.capabilities?.agent.available, false);
  assert.equal(firstRuntime.capabilities?.mcp.available, false);
  assert.equal(firstRuntime.appInfo?.origin, expectedOrigin);
  assert.equal(firstRuntime.appInfo?.version, '1.8.2');
  assert.match(firstRuntime.controller, /\/sw-desktop\.js$/u);
  assert.ok(firstRuntime.cacheNames.includes('dmg-image-pack-v1'));
  assert.ok(!firstRuntime.cacheNames.some((name) => /app-shell|atomic/i.test(name)));

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

  await firstApplication.evaluate(({ dialog }, fixture) => {
    const selections = [fixture.dataSource, fixture.imageSource, fixture.output];
    dialog.showOpenDialog = async () => ({
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
    const data = await window.desktopHost?.buildDataRelease({
      dataVersion: 'desktop-smoke',
    });
    const images = await window.desktopHost?.buildImageRelease({
      assetVersion: 'desktop-smoke-images',
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

  await firstPage.waitForFunction(() => [...document.querySelectorAll('.settings-card')].some(
    (card) => card.textContent?.startsWith('图片资源包') && !card.textContent.includes('—'),
  ));
  const settingsCards = await firstPage.locator('.settings-card').allTextContents();
  assert.ok(settingsCards.some((text) => /^基础资料包/u.test(text) && !text.includes('—')));
  assert.ok(settingsCards.some((text) => /^图片资源包/u.test(text) && !text.includes('—')));
  assert.equal(await firstPage.getByText('页面缓存与版本').count(), 0);
  assert.equal(await firstPage.getByText('访问门禁').count(), 0);
  await closeDesktop(firstApplication, firstPage);
  firstApplication = undefined;

  console.log('[desktop smoke] relaunching persisted profile');
  const secondStartedAt = Date.now();
  secondApplication = await launchDesktop();
  const secondPage = await secondApplication.firstWindow({ timeout: 30_000 });
  await secondPage.getByRole('heading', { name: '建立第一份排轴' }).waitFor({ timeout: 60_000 });
  const restartReadyMs = Date.now() - secondStartedAt;
  console.log(`[desktop smoke] persisted profile ready in ${restartReadyMs} ms`);
  assert.equal(await secondPage.getByText('第一次使用').count(), 0);

  await secondPage.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await secondPage.getByRole('heading', { name: 'Electron Shell' }).waitFor({ timeout: 30_000 });
  await secondPage.waitForFunction(() => [...document.querySelectorAll('.settings-card')].some(
    (card) => card.textContent?.startsWith('图片资源包') && !card.textContent.includes('—'),
  ));
  const restartedCards = await secondPage.locator('.settings-card').allTextContents();
  assert.ok(restartedCards.some((text) => /^基础资料包/u.test(text) && !text.includes('—')));
  assert.ok(restartedCards.some((text) => /^图片资源包/u.test(text) && !text.includes('—')));
  await assertRetiredPortsClosed();
  await closeDesktop(secondApplication, secondPage);
  secondApplication = undefined;

  console.log(JSON.stringify({
    result: 'desktop electron smoke passed',
    firstReadyMs,
    restartReadyMs,
    origin: expectedOrigin,
    retiredRuntimePorts,
    persistedWorkspace: true,
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
