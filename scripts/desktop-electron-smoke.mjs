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
const expectedApplicationVersion = String(JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
).version);
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
const screenshotRoot = process.env.DMG_DESKTOP_SMOKE_SCREENSHOT_DIR
  ? path.resolve(process.env.DMG_DESKTOP_SMOKE_SCREENSHOT_DIR)
  : '';
const fillFixture = JSON.parse(fs.readFileSync(
  path.join(projectRoot, 'docs', 'specs', 'legacy-ai-cli-mcp-extraction', 'fixtures', 'legacy-fill-wire-v1.json'),
  'utf8',
));
const releaseFixtureRoot = path.join(profileRoot, 'release-fixture');
const shareDataFixturePath = path.join(releaseFixtureRoot, 'share-data.json');
const imageFixtureRoot = path.join(releaseFixtureRoot, 'images');
const releaseOutputRoot = path.join(releaseFixtureRoot, 'output');

function resourceRecords(prefix, count) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `${prefix}-${index + 1}`,
    { id: `${prefix}-${index + 1}`, name: `${prefix} ${index + 1}` },
  ]));
}

if (!fs.existsSync(distIndex)) {
  throw new Error('缺少 dist/index.html；请先运行 npm run build:local。');
}
if (packagedExecutable && !fs.existsSync(packagedExecutable)) {
  throw new Error(`桌面可执行文件不存在：${packagedExecutable}`);
}
fs.mkdirSync(releaseFixtureRoot, { recursive: true });
fs.mkdirSync(imageFixtureRoot, { recursive: true });
fs.mkdirSync(releaseOutputRoot, { recursive: true });
fs.writeFileSync(shareDataFixturePath, `${JSON.stringify({
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'desktop-shell-smoke',
  createdAt: '2026-08-20T09:53:24.000Z',
  exportedAt: '2026-08-20T09:53:24.000Z',
  storage: {
    local: {
      'def.operator-editor.library.v1': resourceRecords('operator', 30),
      'def.weapon-sheet.library.v1': resourceRecords('weapon', 75),
      'def.equipment-sheet.library.v1': { equipment: { id: 'equipment' } },
      'def.buff-editor.library.v1': { buff: { id: 'buff' } },
    },
    session: {},
  },
  timelineArchives: [],
})}\n`, 'utf8');
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
      // Keep the release smoke isolated from a developer's legacy Provider
      // credentials. Ready-engine behavior has its own stub-backed blackbox;
      // this fresh-profile route intentionally verifies the unavailable state.
      DMG_AGENT_PROVIDER_PROFILE_PATH: path.join(profileRoot, 'smoke-agent-provider-profile.json'),
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

async function inspectBrowserWorkspace({ workspaceUrl, mcpUrl, clientConfigPath, issueAgentUrl }) {
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
    assert.equal(await workspacePage.getByText('AI 模式', { exact: true }).count(), 0, '普通前端导航不应暴露 AI 模式入口');
    await workspacePage.getByRole('button', { name: '打开排轴工作区' }).click();

    const agentUrl = await issueAgentUrl();
    assert.match(agentUrl, /#\/timeline\/ai\?__agent_launch_grant=[a-zA-Z0-9_-]+$/u);
    const agentPage = await context.newPage();
    const agentTraffic = [];
    agentPage.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/agent-host/')) {
        agentTraffic.push(`> ${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    agentPage.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/agent-host/')) {
        agentTraffic.push(`< ${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    captureLogs(agentPage, 'agent');
    await agentPage.goto(agentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
      await agentPage.getByRole('complementary', { name: 'AI 模式' }).waitFor({ timeout: 30_000 });
    } catch (error) {
      const diagnostics = await agentPage.evaluate(async () => {
        const capability = window.sessionStorage.getItem('dmg.desktop.agent-ui-session.v1') || '';
        const host = capability
          ? await fetch('/agent-host/ui/state', {
              cache: 'no-store',
              headers: { 'x-dmg-agent-ui-capability': capability },
            }).then(async (response) => ({ status: response.status, body: await response.text() }))
              .catch((requestError) => ({ status: 0, body: String(requestError) }))
          : null;
        return {
          url: window.location.href,
          capability: capability ? 'present' : 'missing',
          body: document.body.innerText.slice(0, 4_000),
          host,
        };
      }).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
      throw new Error(`AI 模式页面没有进入工作台：${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(diagnostics, null, 2)}\n${browserLogs.join('\n')}`);
    }
    assert.doesNotMatch(new URL(agentPage.url()).hash, /__agent_launch_grant/u, 'AI 页面没有立即清除一次性 launch grant');
    assert.equal(new URL(agentPage.url()).searchParams.has('__agent_launch_grant'), false, 'AI launch grant 不得进入 query string');
    const agentSession = await agentPage.evaluate(() => ({
      capability: window.sessionStorage.getItem('dmg.desktop.agent-ui-session.v1') || '',
      localCapability: window.localStorage.getItem('dmg.desktop.agent-ui-session.v1'),
    }));
    assert.match(agentSession.capability, /^[a-zA-Z0-9_-]{20,200}$/u);
    assert.equal(agentSession.localCapability, null, 'AI capability 只能保存在当前标签 sessionStorage');
    const consumerDeadline = Date.now() + 60_000;
    let registeredAgentState = null;
    while (Date.now() < consumerDeadline) {
      registeredAgentState = await agentPage.evaluate(async () => {
        const capability = window.sessionStorage.getItem('dmg.desktop.agent-ui-session.v1') || '';
        const response = await fetch('/agent-host/ui/state', {
          cache: 'no-store',
          headers: { 'x-dmg-agent-ui-capability': capability },
        });
        return response.ok ? response.json() : null;
      });
      if (registeredAgentState?.consumer?.binding?.workspaceId) break;
      await agentPage.waitForTimeout(100);
    }
    assert.equal(
      registeredAgentState?.consumer?.binding?.workspaceId?.length > 0,
      true,
      `AI 模式没有在时限内注册完整 Browser Workbench consumer：${JSON.stringify({
        registeredAgentState,
        agentTraffic,
        browserLogs,
        body: await agentPage.locator('body').innerText().catch(() => ''),
      })}`,
    );
    // The first Main Workbench render can publish more than one snapshot while
    // it settles its active timeline. Verify the post-settlement consumer, not
    // the brief close/rebind edge between those snapshots.
    await agentPage.waitForTimeout(250);
    const agentState = await agentPage.evaluate(async () => {
      const capability = window.sessionStorage.getItem('dmg.desktop.agent-ui-session.v1') || '';
      const response = await fetch('/agent-host/ui/state', {
        cache: 'no-store',
        headers: { 'x-dmg-agent-ui-capability': capability },
      });
      return response.json();
    });
    const agentPresentation = await agentPage.evaluate(async () => ({
      visibility: document.visibilityState,
      body: document.body.innerText.slice(0, 4_000),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: (() => {
        const bounds = document.querySelector('.agent-mode-overlay')?.getBoundingClientRect();
        return bounds ? { width: bounds.width, height: bounds.height, top: bounds.top, right: bounds.right } : null;
      })(),
      locks: typeof navigator.locks?.query === 'function' ? await navigator.locks.query() : null,
    }));
    assert.equal(agentState.engine?.kind, 'def-runtime');
    assert.equal(agentState.engine?.state, 'unavailable');
    assert.equal(
      agentState.consumer?.binding?.workspaceId?.length > 0,
      true,
      `Agent consumer binding is incomplete: ${JSON.stringify({ agentState, agentPresentation, agentTraffic })}`,
    );
    assert.ok(agentPresentation.panel, 'Slim AI 工作面板没有渲染');
    assert.ok(
      agentPresentation.panel.width >= Math.min(380, agentPresentation.viewport.width * 0.45)
        && agentPresentation.panel.width <= agentPresentation.viewport.width * 0.6,
      `AI 工作面板没有嵌入工作台右侧：${JSON.stringify(agentPresentation)}`,
    );
    assert.ok(
      agentPresentation.panel.height >= agentPresentation.viewport.height * 0.85,
      'AI 工作面板没有使用可用浏览器高度',
    );
    assert.match(agentPresentation.body, /AI 会话未能打开/u, 'Provider 未配置时没有显示明确的 AI 会话状态');
    assert.match(
      agentPresentation.body,
      /Provider profile is not configured/u,
      'Provider 未配置时没有显示可操作的 Shell 配置提示',
    );
    assert.doesNotMatch(agentPresentation.body, /引擎待接入/u, '真实引擎阶段仍显示旧占位文案');
    await agentPage.close();

    const reviewPage = await context.newPage();
    captureLogs(reviewPage, 'review');
    await reviewPage.goto(mcpUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await reviewPage.getByRole('heading', { name: 'MCP 填表', exact: true }).waitFor({ timeout: 60_000 });
    await reviewPage.getByText('MCP 服务运行中').waitFor({ timeout: 30_000 });
    const emptyReviewLayout = await reviewPage.evaluate(() => {
      const page = document.querySelector('.mcp-fill-page')?.getBoundingClientRect();
      const workspace = document.querySelector('.mcp-fill-workspace')?.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        pageHeight: page?.height || 0,
        workspaceHeight: workspace?.height || 0,
        workspaceBottom: workspace?.bottom || 0,
      };
    });
    assert.ok(Math.abs(emptyReviewLayout.pageHeight - emptyReviewLayout.viewportHeight) < 2, 'MCP 审核页没有铺满浏览器高度');
    assert.ok(Math.abs(emptyReviewLayout.workspaceBottom - emptyReviewLayout.viewportHeight) < 2, '空审核队列在页面下半部留下空白');
    assert.ok(emptyReviewLayout.workspaceHeight > emptyReviewLayout.viewportHeight * 0.75, '空审核队列工作区高度异常');
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
      await reviewPage.getByRole('tab', { name: /变更内容/u }).waitFor();
      await reviewPage.getByText('这是新增资料', { exact: true }).waitFor();
      const reviewLayout = await reviewPage.evaluate(() => ({
        bodyMinWidth: getComputedStyle(document.body).minWidth,
        routeClass: document.body.classList.contains('mcp-fill-route'),
      }));
      assert.equal(reviewLayout.bodyMinWidth, '0px', 'MCP 审核页仍被主应用 1440px 最小宽度裁切');
      assert.equal(reviewLayout.routeClass, true, 'MCP 审核页没有启用独立响应式页面边界');
      if (testCase.domain === 'buff') {
        if (screenshotRoot) fs.mkdirSync(screenshotRoot, { recursive: true });
        const originalViewport = reviewPage.viewportSize();
        await reviewPage.setViewportSize({ width: 1440, height: 900 });
        const compactReviewLayout = await reviewPage.evaluate(() => {
          const toolbar = document.querySelector('.mcp-fill-review-toolbar')?.getBoundingClientRect();
          const firstResultCard = document.querySelector('.mcp-fill-review-scroll .mcp-result-card')?.getBoundingClientRect();
          return {
            toolbarHeight: toolbar?.height || 0,
            legacyHeaderCount: document.querySelectorAll('.mcp-fill-review-header').length,
            firstResultTop: firstResultCard?.top || 0,
          };
        });
        assert.ok(compactReviewLayout.toolbarHeight <= 52, 'MCP 审核工具栏重新占用了过多纵向空间');
        assert.equal(compactReviewLayout.legacyHeaderCount, 0, 'MCP 审核页仍保留重复的提案标题区');
        assert.ok(compactReviewLayout.firstResultTop > 0 && compactReviewLayout.firstResultTop < 500, '首个真实结果没有进入宽屏首屏');
        assert.equal(await reviewPage.getByText(testCase.displayName, { exact: true }).count(), 1, '提案名称在队列和审核区重复显示');
        if (screenshotRoot) await reviewPage.screenshot({ path: path.join(screenshotRoot, 'mcp-fill-wide.png') });
        await reviewPage.setViewportSize({ width: 760, height: 900 });
        if (screenshotRoot) await reviewPage.screenshot({ path: path.join(screenshotRoot, 'mcp-fill-narrow.png') });
        if (originalViewport) await reviewPage.setViewportSize(originalViewport);
      }
      await reviewPage.getByRole('button', { name: '确认并写入', exact: true }).click();
      const dialog = reviewPage.getByRole('alertdialog');
      await dialog.getByRole('button', { name: '确认并写入', exact: true }).click();
      try {
        await reviewPage.getByText(/写入完成：浏览器 SQLite 已保存/u).waitFor({ timeout: 30_000 });
        if (testCase.domain === 'buff') {
          const noticeLayout = await reviewPage.evaluate(() => {
            const workspace = document.querySelector('.mcp-fill-workspace')?.getBoundingClientRect();
            return {
              hasNoticeLayout: document.querySelector('.mcp-fill-page')?.classList.contains('has-notice'),
              workspaceBottom: workspace?.bottom || 0,
              viewportHeight: window.innerHeight,
            };
          });
          assert.equal(noticeLayout.hasNoticeLayout, true, '成功提示出现时没有切换到三行页面布局');
          assert.ok(Math.abs(noticeLayout.workspaceBottom - noticeLayout.viewportHeight) < 2, '成功提示出现后工作区没有铺到页面底部');
        }
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

    const currentBuff = structured(await client.callTool({
      name: 'fill_get_current',
      arguments: { domain: 'buff' },
    }));
    const updatedBuffDraft = structuredClone(cases[0].draft);
    updatedBuffDraft.name = 'Desktop Smoke Buff Revised';
    updatedBuffDraft.description = 'Synthetic contract fixture revised for review diff.';
    updatedBuffDraft.items[0].effects[0].value = 0.2;
    const updateIntent = 'desktop smoke verifies field-level before and after review';
    const updateProposal = structured(await client.callTool({
      name: 'proposal_create',
      arguments: {
        ownerNamespace: config.ownerNamespace,
        idempotencyKey: 'desktop-electron-smoke-buff-update-v1',
        domain: 'buff',
        schemaVersion: 1,
        baseSnapshot: {
          snapshotId: currentBuff.snapshotId,
          revision: currentBuff.revision,
          contentHash: currentBuff.contentHash,
        },
        draft: updatedBuffDraft,
        intent: updateIntent,
        evidence: [{ label: 'desktop smoke diff', text: 'existing target update fixture' }],
      },
    }));
    assert.equal(updateProposal.result, 'created');

    await reviewPage.getByRole('button', { name: '刷新', exact: true }).click();
    const updateQueueItem = reviewPage.locator('.mcp-fill-proposal-list > button').filter({ hasText: updatedBuffDraft.name });
    await updateQueueItem.waitFor({ timeout: 30_000 });
    await updateQueueItem.click();
    const nameDiff = reviewPage.locator('.mcp-fill-diff-entry').filter({ hasText: '名称' });
    await nameDiff.waitFor();
    assert.equal(await reviewPage.locator('.mcp-fill-diff-entry').count(), 3, '更新提案应只显示实际发生的三个字段变化');
    const nameDiffText = await nameDiff.innerText();
    assert.match(nameDiffText, /Desktop Smoke Buff/u);
    assert.match(nameDiffText, /Desktop Smoke Buff Revised/u);
    assert.equal(await reviewPage.getByText('这是新增资料', { exact: true }).count(), 0);
    assert.equal(await reviewPage.getByRole('button', { name: '确认并写入', exact: true }).isEnabled(), true);

    await reviewPage.getByRole('tab', { name: /完整结果/u }).click();
    await reviewPage.getByRole('article', { name: `${updatedBuffDraft.name} 完整结果`, exact: true }).waitFor();
    await reviewPage.getByRole('tab', { name: /提案依据/u }).click();
    await reviewPage.getByText(updateIntent, { exact: true }).waitFor();
    await reviewPage.getByRole('tab', { name: /变更内容/u }).click();
    if (screenshotRoot) {
      const originalViewport = reviewPage.viewportSize();
      await reviewPage.setViewportSize({ width: 1440, height: 900 });
      await reviewPage.screenshot({ path: path.join(screenshotRoot, 'mcp-fill-diff-wide.png') });
      await reviewPage.setViewportSize({ width: 760, height: 900 });
      await reviewPage.screenshot({ path: path.join(screenshotRoot, 'mcp-fill-diff-narrow.png') });
      if (originalViewport) await reviewPage.setViewportSize(originalViewport);
    }

    await reviewPage.getByRole('button', { name: '拒绝', exact: true }).click();
    await reviewPage.getByRole('alertdialog').getByRole('button', { name: '确认拒绝', exact: true }).click();
    await reviewPage.getByText('已拒绝这份变更，产品资料没有发生变化。', { exact: true }).waitFor();
    const rejectedUpdate = structured(await client.callTool({
      name: 'proposal_inspect',
      arguments: { ownerNamespace: config.ownerNamespace, proposalId: updateProposal.proposalId },
    }));
    assert.equal(rejectedUpdate.status.lifecycleStatus, 'rejected');
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
    agentState: await window.desktopHost?.getAgentState(),
  }));
  assert.equal(shellRuntime.capabilities?.host, 'desktop-shell');
  assert.equal(shellRuntime.capabilities?.browserWorkspace, true);
  assert.equal(shellRuntime.capabilities?.agent.available, true);
  assert.equal(shellRuntime.capabilities?.agent.framework, true);
  assert.equal(shellRuntime.capabilities?.agent.engine, false);
  assert.equal(shellRuntime.agentState?.state, 'not-started');
  assert.equal(shellRuntime.agentState?.running, false, 'Agent Host 必须保持懒启动');
  assert.equal(shellRuntime.capabilities?.mcp.available, true);
  assert.equal(shellRuntime.mcpState?.ready, true, shellRuntime.mcpState?.reason);
  assert.equal(shellRuntime.mcpState?.mcpUrl, 'http://127.0.0.1:17323/mcp');
  assert.ok(fs.existsSync(shellRuntime.mcpState?.mcpClientConfigPath || ''));
  assert.equal(shellRuntime.appInfo?.webOrigin, expectedOrigin);
  assert.equal(shellRuntime.appInfo?.version, expectedApplicationVersion);
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
    issueAgentUrl: async () => {
      const before = await firstApplication.evaluate(() => globalThis.__DMG_SMOKE_OPENED_URLS__.length);
      await firstPage.getByRole('button', { name: '打开 AI 模式' }).click();
      await firstPage.getByText(/AI 模式已在系统浏览器中打开/u).waitFor({ timeout: 30_000 });
      const urls = await firstApplication.evaluate(() => globalThis.__DMG_SMOKE_OPENED_URLS__);
      assert.equal(urls.length, before + 1);
      return urls.at(-1);
    },
  });
  const runningAgent = await firstPage.evaluate(() => window.desktopHost?.getAgentState());
  assert.equal(runningAgent?.ready, true, runningAgent?.reason);
  assert.equal(runningAgent?.health?.engine?.kind, 'def-runtime');
  assert.equal(runningAgent?.health?.engine?.state, 'unavailable');

  const bypassedSelection = await firstPage.evaluate(async () => (
    window.desktopHost?.buildResourceRelease()
  ));
  assert.equal(bypassedSelection?.ok, false);

  await firstApplication.evaluate(({ dialog: electronDialog }, fixture) => {
    const selections = [fixture.shareDataSource, fixture.imageSource, fixture.output];
    electronDialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selections.shift()],
    });
  }, {
    shareDataSource: shareDataFixturePath,
    imageSource: imageFixtureRoot,
    output: releaseOutputRoot,
  });

  const releaseResults = await firstPage.evaluate(async () => {
    const shareDataSelection = await window.desktopHost?.pickShareDataSource();
    const imageSelection = await window.desktopHost?.pickImageReleaseSource();
    const outputSelection = await window.desktopHost?.pickReleaseOutput();
    const resource = await window.desktopHost?.buildResourceRelease();
    return { shareDataSelection, imageSelection, outputSelection, resource };
  });
  assert.equal(releaseResults.shareDataSelection?.ok, true);
  assert.equal(releaseResults.imageSelection?.ok, true);
  assert.equal(releaseResults.outputSelection?.ok, true);
  assert.equal(releaseResults.resource?.ok, true, releaseResults.resource?.error);
  assert.ok(fs.existsSync(releaseResults.resource?.result?.manifestPath || ''));
  assert.ok(fs.existsSync(releaseResults.resource?.result?.bundlePath || ''));

  await firstPage.getByLabel('Shell 显示比例').selectOption('1.25');
  await firstPage.waitForTimeout(150);
  await closeDesktop(firstApplication, firstPage);
  firstApplication = undefined;
  assert.equal(
    fs.existsSync(path.join(profileRoot, 'runtime', 'def-agent-host', 'ready.json')),
    false,
    'Electron 退出后 Agent Host ready manifest 仍然存在',
  );

  console.log('[desktop smoke] relaunching persisted shell settings');
  secondApplication = await launchDesktop();
  const secondPage = await secondApplication.firstWindow({ timeout: 30_000 });
  await secondPage.getByRole('heading', { name: '终末地伤害工作台' }).waitFor({ timeout: 30_000 });
  assert.equal(await secondPage.getByLabel('Shell 显示比例').inputValue(), '1.25');
  const secondAgentState = await secondPage.evaluate(() => window.desktopHost?.getAgentState());
  assert.equal(secondAgentState?.state, 'not-started');
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
    agentFramework: 'lazy-host-browser-product-gateway',
    mcpReviewDiff: true,
    releaseTools: 'unified-domestic-resource-release',
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
