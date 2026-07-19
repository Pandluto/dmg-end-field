import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'docs', 'specs', 'legacy-ai-cli-mcp-extraction', 'fixtures', 'legacy-fill-wire-v1.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, `legacy REST exited before health (code=${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error('legacy REST health timeout');
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function assertWireRead(domain, kind, result, expectedFormat) {
  assert.equal(result.status, 200, `${domain}.${kind} status`);
  assert.equal(result.payload.ok, true, `${domain}.${kind} ok`);
  assert.equal(result.payload.protocolVersion, fixture.protocolVersion, `${domain}.${kind} protocol`);
  if (expectedFormat) assert.equal(result.payload.format, expectedFormat, `${domain}.${kind} format`);
}

const port = await getFreePort();
const servicePort = await getFreePort();
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-fill-wire-'));
const baseUrl = `http://127.0.0.1:${port}`;
const serviceUrl = `http://127.0.0.1:${servicePort}`;
const serviceToken = 'legacy-fill-wire-host-token';
const serviceChild = spawn(process.execPath, ['scripts/legacy-fill-service.mjs'], {
  cwd: root,
  env: {
    PATH: process.env.PATH,
    LEGACY_FILL_SERVICE_PORT: String(servicePort),
    LEGACY_FILL_HOST_TOKEN: serviceToken,
    LEGACY_FILL_DATABASE_PATH: path.join(runtimeRoot, 'legacy-fill.sqlite3'),
    LEGACY_FILL_REGISTRY_PATH: path.join(runtimeRoot, 'legacy-fill-registry.json'),
    LEGACY_FILL_DOMAIN_RUNTIME_PATH: path.join(root, 'dist', 'legacy-fill', 'domain-runtime.mjs'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serviceStderr = '';
serviceChild.stderr.on('data', (chunk) => { serviceStderr += chunk.toString(); });
const env = {
  ...process.env,
  AI_CLI_REST_PORT: String(port),
  AI_CLI_REST_STORAGE_MODE: 'runtime',
  AI_CLI_REST_STORAGE_DIR: path.join(runtimeRoot, 'rest'),
  AI_CLI_REST_VITE_CACHE_DIR: path.join(runtimeRoot, 'vite'),
  AI_CLI_NOW_STORAGE_PATH: path.join(runtimeRoot, 'now-storage.json'),
  AI_TIMELINE_WORK_NODE_DB_PATH: path.join(runtimeRoot, 'work-nodes.sqlite3'),
  AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(runtimeRoot, 'work-nodes.json'),
  TIMELINE_REPOSITORY_DB_PATH: path.join(runtimeRoot, 'timeline.sqlite3'),
  DATA_MANAGEMENT_RUNTIME_ROOT: path.join(runtimeRoot, 'data'),
  DEF_TOOL_GOVERNANCE_PATH: path.join(runtimeRoot, 'def-tool-governance.json'),
  DEF_AGENT_SCRIPT_DIR: path.join(runtimeRoot, 'scripts'),
  LEGACY_FILL_SERVICE_URL: serviceUrl,
  LEGACY_FILL_COMPAT_PROXY_ENABLED: '1',
};
delete env.DEF_INTERNAL_GOVERNANCE_TOKEN;

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const report = { fixtureVersion: fixture.fixtureVersion, domains: {}, forbiddenCommands: [] };

try {
  const serviceHealth = await waitForHealth(serviceUrl, serviceChild);
  assert.equal(serviceHealth.service, 'legacy-fill-service');
  const hostSnapshot = {
    contract: 'LegacyFillSnapshotV1',
    snapshotId: 'legacy-wire-host-snapshot',
    publishedAt: '2026-07-19T00:00:00.000Z',
    domains: Object.fromEntries(Object.entries(fixture.domains).map(([domain, contract]) => [domain, {
      domain,
      schemaVersion: 1,
      revision: 1,
      contentHash: `sha256:legacy-wire-${domain}`,
      current: domain === 'equipment' ? { schemaVersion: 1, updatedAt: '', gearSets: {} } : null,
      library: domain === 'equipment' ? { schemaVersion: 1, updatedAt: '', gearSets: {} } : {},
      fixtureFormat: contract.currentFormat,
    }])),
  };
  const snapshotResponse = await fetch(`${serviceUrl}/internal/snapshots/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-legacy-fill-host-token': serviceToken },
    body: JSON.stringify(hostSnapshot),
  });
  assert.equal(snapshotResponse.status, 200, await snapshotResponse.text());
  const health = await waitForHealth(baseUrl, child);
  assert.equal(health.ok, true);
  assert.equal(health.service, 'def-ai-cli-rest');

  for (const [domain, contract] of Object.entries(fixture.domains)) {
    const current = await request(baseUrl, 'GET', `/api/${domain}/current`);
    const library = await request(baseUrl, 'GET', `/api/${domain}/library`);
    const template = await request(baseUrl, 'GET', `/api/${domain}/fill/template`);
    assertWireRead(domain, 'current', current, contract.currentFormat);
    assertWireRead(domain, 'library', library, contract.libraryFormat);
    assertWireRead(domain, 'template', template, domain === 'buff' ? contract.templateFormat : undefined);

    const requestId = `wire-${domain}`;
    const check = await request(baseUrl, 'POST', `/api/${domain}/fill/check`, {
      protocolVersion: fixture.protocolVersion,
      requestId: `${requestId}-check`,
      draft: contract.draft,
    });
    assert.equal(check.status, 200, `${domain}.check status: ${JSON.stringify(check.payload)}`);
    assert.equal(check.payload.ok, true, `${domain}.check ok`);
    assert.equal(check.payload.effects?.writes, fixture.invariants.checkWrites, `${domain}.check writes`);

    const apply = await request(baseUrl, 'POST', `/api/${domain}/fill/apply?client=web-cli`, {
      protocolVersion: fixture.protocolVersion,
      requestId: `${requestId}-apply`,
      draft: contract.draft,
    });
    assert.equal(apply.status, 200, `${domain}.apply status: ${JSON.stringify(apply.payload)}`);
    assert.equal(apply.payload.ok, true, `${domain}.apply ok`);
    assert.equal(apply.payload.effects?.writes, fixture.invariants.applyWrites, `${domain}.apply writes`);
    assert.equal(apply.payload.proposal?.approval, fixture.invariants.approvalStatus, `${domain}.proposal approval`);
    assert.equal(apply.payload.proposal?.save, fixture.invariants.saveStatus, `${domain}.proposal save`);

    const retried = await request(baseUrl, 'POST', `/api/${domain}/fill/apply?client=web-cli`, {
      protocolVersion: fixture.protocolVersion,
      requestId: `${requestId}-apply`,
      draft: contract.draft,
    });
    assert.equal(retried.status, 200, `${domain}.idempotent retry status`);
    assert.equal(retried.payload.proposal?.id, apply.payload.proposal.id, `${domain}.idempotent proposal id`);

    const blocked = await request(baseUrl, 'POST', `/api/${domain}/fill/apply?client=web-cli`, {
      protocolVersion: fixture.protocolVersion,
      requestId: `${requestId}-blocked`,
      draft: contract.draft,
    });
    assert.equal(blocked.status, fixture.invariants.pendingApplyStatus, `${domain}.pending apply status`);
    assert.equal(blocked.payload.error?.code, fixture.invariants.pendingApplyErrorCode, `${domain}.pending apply code`);

    const listed = await request(baseUrl, 'POST', '/api/ai-cli/run', {
      protocolVersion: fixture.protocolVersion,
      requestId: `${requestId}-list`,
      command: 'proposal.list',
    });
    assert.equal(listed.status, 200, `${domain}.proposal.list status`);
    assert.equal(listed.payload.ok, true, `${domain}.proposal.list ok`);
    assert.ok(Array.isArray(listed.payload.data?.proposals), `${domain}.proposal.list proposals`);

    const shown = await request(baseUrl, 'POST', '/api/ai-cli/run', {
      protocolVersion: fixture.protocolVersion,
      requestId: `${requestId}-show`,
      command: `proposal.show ${apply.payload.proposal.id}`,
    });
    assert.equal(shown.status, 200, `${domain}.proposal.show status`);
    assert.equal(shown.payload.ok, true, `${domain}.proposal.show ok`);

    report.domains[domain] = {
      current: { status: current.status, format: current.payload.format },
      library: { status: library.status, format: library.payload.format, count: library.payload.count },
      template: { status: template.status, format: template.payload.format ?? template.payload.data?.tool ?? null },
      check: { status: check.status, writes: check.payload.effects?.writes, errorCount: check.payload.validation?.errors?.length ?? 0 },
      apply: {
        status: apply.status,
        writes: apply.payload.effects?.writes,
        proposal: {
          domain: apply.payload.proposal.domain,
          approval: apply.payload.proposal.approval,
          save: apply.payload.proposal.save,
        },
      },
      pendingApply: { status: blocked.status, code: blocked.payload.error?.code },
      proposalList: { status: listed.status, count: listed.payload.data.proposals.length },
      proposalShow: { status: shown.status },
    };

    const cleared = await request(baseUrl, 'POST', '/api/ai-cli/run', {
      protocolVersion: fixture.protocolVersion,
      requestId: `${requestId}-clear`,
      command: 'proposal.clear',
    });
    assert.equal(cleared.status, 200, `${domain}.proposal.clear status`);
    assert.equal(cleared.payload.ok, true, `${domain}.proposal.clear ok`);
  }

  const serviceCountBeforeDefRoute = (await request(serviceUrl, 'GET', '/health')).payload.compatibilityRequestCount;
  const defRoute = await request(baseUrl, 'GET', '/api/def-tools/route-map');
  assert.equal(defRoute.status, 200, 'DEF route remains on 17321');
  const serviceCountAfterDefRoute = (await request(serviceUrl, 'GET', '/health')).payload.compatibilityRequestCount;
  assert.equal(serviceCountAfterDefRoute, serviceCountBeforeDefRoute, 'DEF route must not reach legacy fill service');

  for (const command of fixture.invariants.restForbiddenCommands) {
    const result = await request(baseUrl, 'POST', '/api/ai-cli/run', {
      protocolVersion: fixture.protocolVersion,
      requestId: `wire-forbidden-${report.forbiddenCommands.length}`,
      command,
    });
    assert.equal(result.status, fixture.invariants.forbiddenStatus, `forbidden command ${command}`);
    assert.equal(result.payload.error?.code, 'forbidden', `forbidden code ${command}`);
    report.forbiddenCommands.push({ command, status: result.status, code: result.payload.error.code });
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write('[legacy-fill-wire-contract] passed\n');
} finally {
  child.kill('SIGTERM');
  serviceChild.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000),
  ]);
  await Promise.race([
    new Promise((resolve) => serviceChild.once('exit', resolve)),
    delay(5_000),
  ]);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  if (stderr.trim()) process.stderr.write(stderr);
  if (serviceStderr.trim()) process.stderr.write(serviceStderr);
}
