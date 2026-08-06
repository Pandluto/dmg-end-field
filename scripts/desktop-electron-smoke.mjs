import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LEGACY_FILL_MCP_TOOL_NAMES } from '../src/legacyFillService/mcp-operations.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(projectRoot, 'dist', 'index.html');
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-desktop-smoke-'));
const applicationEntry = path.join(projectRoot, 'electron', 'main.cjs');
const executableArgumentIndex = process.argv.indexOf('--executable');
const packagedExecutable = executableArgumentIndex >= 0
  ? path.resolve(process.argv[executableArgumentIndex + 1] || '')
  : '';
const expectedOrigin = 'http://127.0.0.1:31457';
const retiredRuntimePorts = [17321, 17322];
const mcpRuntimePort = 17323;
const fillFixture = JSON.parse(fs.readFileSync(
  path.join(projectRoot, 'docs', 'specs', 'legacy-ai-cli-mcp-extraction', 'fixtures', 'legacy-fill-wire-v1.json'),
  'utf8',
));
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

async function assertMcpPortOpen() {
  assert.equal(await canConnect(mcpRuntimePort), true, 'MCP 填表服务没有监听 17323');
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

function structured(result) {
  assert.equal(typeof result?.structuredContent, 'object');
  assert.equal(result.structuredContent.ok, true, JSON.stringify(result.structuredContent));
  return result.structuredContent.data;
}

async function inspectBrowserWorkspace({ workspaceUrl, mcpUrl, clientConfigPath }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let client;
  try {
    const context = await browser.newContext();
    const workspacePage = await context.newPage();
    const browserLogs = [];
    const captureLogs = (page, label) => {
      page.on('console', (message) => browserLogs.push(`[${label}:console:${message.type()}] ${message.text()}`));
      page.on('pageerror', (error) => browserLogs.push(`[${label}:pageerror] ${error.message}`));
    };
    captureLogs(workspacePage, 'workspace');
    await workspacePage.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await workspacePage.getByRole('heading', { name: '先把基础资料装进浏览器' }).waitFor({
      timeout: 60_000,
    });
    const runtime = await workspacePage.evaluate(async () => ({
      desktopHost: typeof window.desktopHost,
      desktopWebHost: window.__DMG_DESKTOP_WEB_HOST__,
      workerReady: await window.__DMG_ENSURE_SERVICE_WORKER__?.(),
      controller: navigator.serviceWorker.controller?.scriptURL || '',
    }));
    assert.equal(runtime.desktopHost, 'undefined', '系统浏览器不应获得 Electron preload');
    assert.equal(runtime.desktopWebHost, true, '系统浏览器没有识别本地 Shell 宿主');
    assert.equal(runtime.workerReady, true, '本地图片/资料 Worker 未接管浏览器页面');
    assert.match(runtime.controller, /\/sw-desktop\.js$/u);
    assert.equal(await workspacePage.getByText('Electron Shell').count(), 0);
    assert.equal(new URL(workspacePage.url()).searchParams.has('__mcp_fill_publisher'), false, '浏览器地址栏没有清除快照发布能力参数');
    const ordinaryAuthority = await workspacePage.evaluate(async () => {
      const publisher = window.sessionStorage.getItem('dmg.desktop.mcp-fill-publisher.v1') || '';
      const response = await fetch('http://127.0.0.1:31457/mcp-fill-host/proposals', {
        headers: { 'x-dmg-mcp-fill-capability': publisher },
      });
      return { status: response.status, payload: await response.json() };
    });
    assert.equal(ordinaryAuthority.status, 403, '普通工作页不应获得 MCP 审核权限');
    assert.equal(ordinaryAuthority.payload?.error?.code, 'mcp-fill-review-authority-required');

    await workspacePage.getByRole('button', { name: '下载完整资料并开始' }).click();
    await workspacePage.getByRole('button', { name: '打开排轴工作区' }).waitFor({ timeout: 120_000 });
    assert.equal(await workspacePage.getByText('MCP 填表', { exact: true }).count(), 0, '普通前端导航不应暴露 MCP 入口');

    const reviewPage = await context.newPage();
    captureLogs(reviewPage, 'review');
    await reviewPage.goto(mcpUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await reviewPage.getByRole('heading', { name: 'MCP 填表', exact: true }).waitFor({ timeout: 60_000 });
    await reviewPage.getByText('MCP 服务运行中').waitFor({ timeout: 30_000 });
    await workspacePage.getByRole('heading', { name: '另一个标签页正在编辑' }).waitFor({ timeout: 30_000 });
    assert.equal(new URL(reviewPage.url()).searchParams.has('__mcp_fill_publisher'), false, 'MCP 页面没有清除快照发布能力参数');
    assert.doesNotMatch(new URL(reviewPage.url()).hash, /__mcp_fill_review_grant/u, 'MCP 页面没有清除一次性审核授权');

    const config = JSON.parse(fs.readFileSync(clientConfigPath, 'utf8'));
    client = new Client({ name: 'desktop-electron-smoke', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), LEGACY_FILL_MCP_TOOL_NAMES);

    const cases = [
      {
        domain: 'buff', targetId: 'desktop-smoke-buff', displayName: 'Desktop Smoke Buff',
        draft: { ...structuredClone(fillFixture.domains.buff.draft), id: 'desktop-smoke-buff', name: 'Desktop Smoke Buff' },
      },
      {
        domain: 'weapon', targetId: 'desktop-smoke-weapon', displayName: 'Desktop Smoke Weapon',
        draft: { ...structuredClone(fillFixture.domains.weapon.draft), id: 'desktop-smoke-weapon', name: 'Desktop Smoke Weapon' },
      },
      {
        domain: 'operator', targetId: 'desktop-smoke-operator', displayName: 'Desktop Smoke Operator',
        draft: { ...structuredClone(fillFixture.domains.operator.draft), id: 'desktop-smoke-operator', name: 'Desktop Smoke Operator' },
      },
      {
        domain: 'equipment', targetId: 'desktop-smoke-set', displayName: 'Desktop Smoke Set',
        draft: {
          ...structuredClone(fillFixture.domains.equipment.draft),
          gearSets: {
            'desktop-smoke-set': {
              ...structuredClone(fillFixture.domains.equipment.draft.gearSets['fixture-set']),
              gearSetId: 'desktop-smoke-set',
              name: 'Desktop Smoke Set',
            },
          },
        },
      },
    ];

    for (const testCase of cases) {
      const current = structured(await client.callTool({
        name: 'fill_get_current',
        arguments: { domain: testCase.domain },
      }));
      const created = structured(await client.callTool({
        name: 'proposal_create',
        arguments: {
          ownerNamespace: config.ownerNamespace,
          idempotencyKey: `desktop-electron-smoke-${testCase.domain}-v1`,
          domain: testCase.domain,
          schemaVersion: 1,
          baseSnapshot: {
            snapshotId: current.snapshotId,
            revision: current.revision,
            contentHash: current.contentHash,
          },
          draft: testCase.draft,
          intent: `desktop smoke verifies ${testCase.domain} MCP-to-browser SQLite write`,
          evidence: [{ label: 'desktop smoke', text: 'synthetic integration fixture' }],
        },
      }));
      assert.equal(created.result, 'created');

      await reviewPage.getByRole('button', { name: '刷新', exact: true }).click();
      const queueItem = reviewPage.locator('.mcp-fill-proposal-list > button').filter({ hasText: testCase.displayName });
      await queueItem.waitFor({ timeout: 30_000 });
      await queueItem.click();
      await reviewPage.getByRole('button', { name: '确认并写入', exact: true }).click();
      const dialog = reviewPage.getByRole('dialog');
      await dialog.getByRole('button', { name: '确认并写入', exact: true }).click();
      try {
        await reviewPage.getByText(/写入完成：Host 已重新读取目标/u).waitFor({ timeout: 30_000 });
      } catch (error) {
        const body = await reviewPage.locator('body').innerText().catch(() => '');
        const latest = structured(await client.callTool({ name: 'fill_get_current', arguments: { domain: testCase.domain } }));
        throw new Error(`MCP ${testCase.domain} 网页确认写入没有完成：${error instanceof Error ? error.message : String(error)}\nbase=${JSON.stringify(current)}\nlatest=${JSON.stringify(latest)}\n${body.slice(0, 8_000)}\n${browserLogs.join('\n')}`);
      }

      const search = structured(await client.callTool({
        name: 'fill_search_library',
        arguments: { domain: testCase.domain, inspectId: testCase.targetId },
      }));
      assert.equal(search.items[0].id, testCase.targetId);
      const inspected = structured(await client.callTool({
        name: 'proposal_inspect',
        arguments: { ownerNamespace: config.ownerNamespace, proposalId: created.proposalId },
      }));
      assert.equal(inspected.status.lifecycleStatus, 'applied');
    }
    await context.close();
  } finally {
    await client?.close().catch(() => undefined);
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
    mcpState: await window.desktopHost?.getMcpState(),
  }));
  assert.equal(shellRuntime.capabilities?.host, 'desktop-shell');
  assert.equal(shellRuntime.capabilities?.browserWorkspace, true);
  assert.equal(shellRuntime.capabilities?.agent.available, false);
  assert.equal(shellRuntime.capabilities?.mcp.available, true);
  assert.equal(shellRuntime.mcpState?.ready, true, shellRuntime.mcpState?.reason);
  assert.equal(shellRuntime.mcpState?.mcpUrl, 'http://127.0.0.1:17323/mcp');
  assert.ok(fs.existsSync(shellRuntime.mcpState?.mcpClientConfigPath || ''));
  assert.equal(shellRuntime.appInfo?.webOrigin, expectedOrigin);
  assert.equal(shellRuntime.appInfo?.version, '1.8.2');
  assert.match(shellRuntime.appInfo?.webUrl || '', /[?&]__desktop_shell=1(?:&|$)/u);
  assert.doesNotMatch(shellRuntime.appInfo?.webUrl || '', /__mcp_fill_(?:publisher|review_grant)/u);

  const hostResponse = await fetch(shellRuntime.appInfo.webUrl, { redirect: 'error' });
  assert.equal(hostResponse.status, 200);
  await assertRetiredPortsClosed();
  await assertMcpPortOpen();

  await firstApplication.evaluate(({ shell: electronShell }) => {
    globalThis.__DMG_SMOKE_OPENED_URLS__ = [];
    electronShell.openExternal = async (url) => {
      globalThis.__DMG_SMOKE_OPENED_URLS__.push(url);
    };
  });
  await firstPage.getByRole('button', { name: '打开浏览器工作台' }).click();
  await firstPage.getByText(/浏览器工作台已打开/u).waitFor();
  await firstPage.getByRole('button', { name: '打开 MCP 填表' }).click();
  await firstPage.getByText(/MCP 填表已打开/u).waitFor();
  const openedUrls = await firstApplication.evaluate(() => globalThis.__DMG_SMOKE_OPENED_URLS__);
  assert.equal(openedUrls.length, 2);
  assert.match(openedUrls[0], /[?&]__mcp_fill_publisher=[a-zA-Z0-9_-]+/u);
  assert.doesNotMatch(openedUrls[0], /__mcp_fill_review_grant/u);
  assert.match(openedUrls[1], /[?&]__mcp_fill_publisher=[a-zA-Z0-9_-]+/u);
  assert.match(openedUrls[1], /#\/mcp-fill\?__mcp_fill_review_grant=[a-zA-Z0-9_-]+$/u);

  await inspectBrowserWorkspace({
    workspaceUrl: openedUrls[0],
    mcpUrl: openedUrls[1],
    clientConfigPath: shellRuntime.mcpState.mcpClientConfigPath,
  });

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
  await assertMcpPortOpen();
  await closeDesktop(secondApplication, secondPage);
  secondApplication = undefined;
  assert.equal(await canConnect(mcpRuntimePort), false, 'Electron 退出后 MCP 服务仍在监听');

  console.log(JSON.stringify({
    result: 'independent desktop shell smoke passed',
    shellDocument: 'electron/shell/index.html',
    browserOrigin: expectedOrigin,
    browserUsesPreload: false,
    retiredRuntimePorts,
    mcpRuntimePort,
    mcpProposalRoundTrip: ['buff', 'weapon', 'operator', 'equipment'],
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
