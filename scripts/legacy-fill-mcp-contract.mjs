import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { sha256Digest } from '../src/legacyFillService/canonical-json.mjs';
import { LEGACY_FILL_MCP_RESOURCE_TEMPLATES, LEGACY_FILL_MCP_TOOL_NAMES } from '../src/legacyFillService/mcp-operations.mjs';

const root = path.resolve(import.meta.dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-fill-mcp-'));
const databasePath = path.join(tempRoot, 'legacy-fill.sqlite3');
const registryPath = path.join(tempRoot, 'registry.json');
const clientConfigPath = path.join(tempRoot, 'mcp-client.json');
const port = 18723;
const baseUrl = `http://127.0.0.1:${port}`;
const mcpUrl = `${baseUrl}/mcp`;
const hostToken = 'host-authority-contract-token';
const tokenA = 'mcp-contract-token-owner-a';
const tokenB = 'mcp-contract-token-owner-b';
const ownerA = 'codex:contract-installation-a:fixture-workspace';
const ownerB = 'standard-client:contract-installation-b:fixture-workspace';
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'docs/specs/legacy-ai-cli-mcp-extraction/fixtures/legacy-fill-wire-v1.json'), 'utf8'));
let child;
let serviceLogs = '';

function serviceEnv() {
  return {
    ...process.env,
    LEGACY_FILL_SERVICE_PORT: String(port),
    LEGACY_FILL_HOST_TOKEN: hostToken,
    LEGACY_FILL_MCP_CLIENTS_JSON: JSON.stringify({ [tokenA]: ownerA, [tokenB]: ownerB }),
    LEGACY_FILL_DATABASE_PATH: databasePath,
    LEGACY_FILL_REGISTRY_PATH: registryPath,
    LEGACY_FILL_DOMAIN_RUNTIME_PATH: path.join(root, 'dist/legacy-fill/domain-runtime.mjs'),
    LEGACY_FILL_FIXTURE_PATH: path.join(root, 'docs/specs/legacy-ai-cli-mcp-extraction/fixtures/legacy-fill-wire-v1.json'),
  };
}

function startService() {
  child = spawn(process.execPath, ['scripts/legacy-fill-service.mjs'], { cwd: root, env: serviceEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { serviceLogs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serviceLogs += chunk.toString(); });
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const health = await response.json();
      if (response.ok && health.pid === child.pid && health.mcp?.enabled) return health;
    } catch { /* service is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`service health timeout: ${serviceLogs}`);
}

async function hostPost(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-legacy-fill-host-token': hostToken },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function connectHttp(token, name) {
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

function rawPost(headers, body = '{}') {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers } }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end(body);
  });
}

function structured(result) {
  assert.equal(typeof result.structuredContent, 'object');
  return result.structuredContent;
}

async function stopService() {
  if (!child || child.exitCode !== null) return;
  await hostPost('/internal/shutdown', {});
  await new Promise((resolve) => child.once('exit', resolve));
}

try {
  startService();
  const health = await waitForHealth();
  assert.equal(health.mcp.authenticatedClients, 2);
  const snapshotDomains = {};
  for (const [domain, contract] of Object.entries(fixture.domains)) {
    const library = domain === 'equipment' ? contract.draft : domain === 'buff' ? {
      [contract.draft.id]: contract.draft,
      'fixture-buff-b': { ...contract.draft, id: 'fixture-buff-b', name: 'Fixture Buff B' },
      'fixture-buff-c': { ...contract.draft, id: 'fixture-buff-c', name: 'Fixture Buff C' },
    } : { [contract.draft.id]: contract.draft };
    const value = { current: contract.draft, library };
    snapshotDomains[domain] = { domain, schemaVersion: 1, revision: 1, contentHash: sha256Digest(value), ...value };
  }
  const publish = await hostPost('/internal/snapshots/publish', {
    contract: 'LegacyFillSnapshotV1', snapshotId: 'mcp-contract-snapshot', publishedAt: '2026-07-19T00:00:00.000Z', domains: snapshotDomains,
  });
  assert.equal(publish.status, 200);

  const httpA1 = await connectHttp(tokenA, 'http-owner-a-one');
  const httpA2 = await connectHttp(tokenA, 'http-owner-a-two');
  const httpB = await connectHttp(tokenB, 'http-owner-b');
  const tools = await httpA1.client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), LEGACY_FILL_MCP_TOOL_NAMES);
  assert.equal(tools.tools.every((tool) => tool.inputSchema && tool.outputSchema), true);
  assert.equal(tools.tools.some((tool) => /approve|reject|save|unsave|localstorage|now_storage|script|file|def/i.test(tool.name)), false);
  assert.equal(Object.hasOwn(httpA1.client.getServerCapabilities() || {}, 'tasks'), false);
  const templates = await httpA1.client.listResourceTemplates();
  assert.deepEqual(templates.resourceTemplates.map((item) => item.uriTemplate), LEGACY_FILL_MCP_RESOURCE_TEMPLATES);
  const resources = await httpA1.client.listResources();
  assert.equal(resources.resources.some((item) => item.uri.startsWith('file:')), false);
  assert.equal(resources.resources.some((item) => /\/Users\/|DEF_|ses_/i.test(item.uri)), false);

  for (const domain of ['buff', 'weapon', 'operator', 'equipment']) {
    const current = structured(await httpA1.client.callTool({ name: 'fill_get_current', arguments: { domain } }));
    assert.equal(current.ok, true);
    assert.equal(current.data.revision, 1);
    const template = structured(await httpA1.client.callTool({ name: 'fill_get_template', arguments: { domain, schemaVersion: 1 } }));
    assert.equal(template.ok, true);
    assert.equal(template.data.separation.strategyIsProtocol, false);
    const validation = structured(await httpA1.client.callTool({ name: 'fill_validate', arguments: { domain, schemaVersion: 1, draft: fixture.domains[domain].draft } }));
    assert.equal(validation.ok, true);
    assert.equal(validation.data.valid, true, `${domain} validates`);
    const search = structured(await httpA1.client.callTool({ name: 'fill_search_library', arguments: { domain, query: 'fixture', limit: 1 } }));
    assert.equal(search.ok, true);
    assert.equal(search.data.items.length, 1);
    if (domain === 'buff') {
      assert.equal(typeof search.data.nextCursor, 'string');
      const secondPage = structured(await httpA1.client.callTool({ name: 'fill_search_library', arguments: { domain, query: 'fixture', limit: 1, cursor: search.data.nextCursor } }));
      assert.equal(secondPage.data.items.length, 1);
      assert.notEqual(secondPage.data.items[0].id, search.data.items[0].id);
    }
  }

  const baseSnapshot = structured(await httpA1.client.callTool({ name: 'fill_get_current', arguments: { domain: 'weapon' } }));
  const createArguments = {
    ownerNamespace: ownerA,
    idempotencyKey: 'contract-create-weapon',
    domain: 'weapon',
    schemaVersion: 1,
    baseSnapshot: {
      snapshotId: baseSnapshot.data.snapshotId,
      revision: baseSnapshot.data.revision,
      contentHash: baseSnapshot.data.contentHash,
    },
    draft: fixture.domains.weapon.draft,
    intent: 'MCP contract proposal only',
    evidence: [{ label: 'contract', text: 'synthetic fixture' }],
  };
  const created = structured(await httpA1.client.callTool({ name: 'proposal_create', arguments: createArguments }));
  assert.equal(created.ok, true);
  assert.equal(created.data.result, 'created');
  const duplicate = structured(await httpA2.client.callTool({ name: 'proposal_create', arguments: createArguments }));
  assert.equal(duplicate.data.result, 'duplicate');
  assert.equal(duplicate.data.proposalId, created.data.proposalId);
  const shared = structured(await httpA2.client.callTool({ name: 'proposal_list', arguments: { ownerNamespace: ownerA, limit: 25 } }));
  assert.equal(shared.data.items.length, 1);
  const isolated = structured(await httpB.client.callTool({ name: 'proposal_list', arguments: { ownerNamespace: ownerB, limit: 25 } }));
  assert.equal(isolated.data.items.length, 0);
  const crossOwner = structured(await httpB.client.callTool({ name: 'proposal_inspect', arguments: { ownerNamespace: ownerA, proposalId: created.data.proposalId } }));
  assert.equal(crossOwner.ok, false);
  assert.equal(crossOwner.error.code, 'owner-isolation-violation');
  const forbiddenCall = await httpA1.client.callTool({ name: 'proposal_approve', arguments: {} });
  assert.equal(forbiddenCall.isError, true);
  assert.match(forbiddenCall.content.map((item) => item.text || '').join(' '), /not found/i);

  const review = await httpA1.client.readResource({ uri: created.data.reviewManifestUri });
  const reviewPayload = JSON.parse(review.contents[0].text);
  assert.equal(reviewPayload.proposal.proposalId, created.data.proposalId);
  assert.equal(reviewPayload.reviewManifest.evidence[0].text, 'synthetic fixture');
  assert.equal(reviewPayload.reviewManifest.intent, 'MCP contract proposal only');
  assert.equal(reviewPayload.reviewManifest.manifestVersion, 1);
  assert.equal(reviewPayload.reviewManifest.proposalId, created.data.proposalId);
  assert.equal(reviewPayload.reviewManifest.ownerNamespace, ownerA);
  assert.equal(reviewPayload.reviewManifest.review.status, 'pending');
  assert.equal(reviewPayload.reviewManifest.persistence.status, 'not-requested');
  assert.equal(reviewPayload.reviewManifest.requestedWrites[0].storageDomain, 'weapon');
  assert.equal(Array.isArray(reviewPayload.reviewManifest.diff), true);
  assert.equal(reviewPayload.reviewManifest.manifestDigest, reviewPayload.proposal.manifestDigest);
  const versionedResources = await httpA1.client.listResources();
  const resourceClasses = new Set(versionedResources.resources.map(({ uri }) => {
    const parsed = new URL(uri);
    if (parsed.hostname === 'snapshot') return `snapshot-${parsed.pathname.split('/').at(-1)}`;
    if (parsed.hostname === 'proposals') return `proposal-${parsed.pathname.split('/').at(-1)}`;
    return parsed.hostname;
  }));
  assert.deepEqual([...resourceClasses].sort(), ['examples', 'guides', 'proposal-review', 'proposal-status', 'schema', 'snapshot-current', 'snapshot-library', 'template']);
  for (const resourceClass of resourceClasses) {
    const representative = versionedResources.resources.find(({ uri }) => {
      const parsed = new URL(uri);
      if (resourceClass === 'snapshot-current') return parsed.hostname === 'snapshot' && parsed.pathname.endsWith('/current');
      if (resourceClass === 'snapshot-library') return parsed.hostname === 'snapshot' && parsed.pathname.endsWith('/library');
      if (resourceClass === 'proposal-review') return parsed.hostname === 'proposals' && parsed.pathname.endsWith('/review');
      if (resourceClass === 'proposal-status') return parsed.hostname === 'proposals' && parsed.pathname.endsWith('/status');
      return parsed.hostname === resourceClass;
    });
    const value = await httpA1.client.readResource({ uri: representative.uri });
    assert.equal(typeof value.contents[0].text, 'string', `${resourceClass} is readable`);
  }
  await assert.rejects(() => httpB.client.readResource({ uri: created.data.reviewManifestUri }), /ownerNamespace|authenticated owner|MCP error/i);

  fs.writeFileSync(clientConfigPath, `${JSON.stringify({
    contract: 'LegacyFillMcpClientConfigV1', transport: 'streamable-http', url: mcpUrl, token: tokenA, ownerNamespace: ownerA,
  })}\n`, { mode: 0o600 });
  const stdioClient = new Client({ name: 'stdio-contract-client', version: '1.0.0' }, { capabilities: {} });
  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: ['scripts/legacy-fill-mcp-stdio.mjs'],
    cwd: root,
    env: { ...process.env, LEGACY_FILL_MCP_CLIENT_CONFIG: clientConfigPath },
    stderr: 'pipe',
  });
  let stdioErrors = '';
  stdioTransport.stderr?.on('data', (chunk) => { stdioErrors += chunk.toString(); });
  await stdioClient.connect(stdioTransport);
  const stdioList = structured(await stdioClient.callTool({ name: 'proposal_list', arguments: { ownerNamespace: ownerA, limit: 25 } }));
  assert.equal(stdioList.data.items[0].proposalId, created.data.proposalId);
  assert.equal(stdioErrors, '');
  await stdioClient.close();

  assert.equal(await rawPost({}), 401);
  assert.equal(await rawPost({ authorization: `Bearer ${tokenA}`, host: 'attacker.invalid' }), 403);
  assert.equal(await rawPost({ authorization: `Bearer ${tokenA}`, origin: 'https://attacker.invalid' }), 403);
  const oversized = await fetch(mcpUrl, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` }, body: JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024 + 1) }),
  });
  assert.equal(oversized.status, 413);

  const auditBeforeRestart = await (await fetch(`${baseUrl}/internal/audit/export`, { headers: { 'x-legacy-fill-host-token': hostToken } })).json();
  assert.equal(auditBeforeRestart.audit.proposals.length, 1);
  assert.deepEqual(
    Object.fromEntries(auditBeforeRestart.audit.snapshots.map((snapshot) => [snapshot.domain, snapshot.contentHash])),
    Object.fromEntries(Object.entries(snapshotDomains).map(([domain, snapshot]) => [domain, snapshot.contentHash])),
    'all allowed MCP tools leave Host-published product snapshot hashes unchanged',
  );
  await Promise.all([httpA1.client.close(), httpA2.client.close(), httpB.client.close()]);
  await stopService();
  startService();
  await waitForHealth();
  const afterRestart = await connectHttp(tokenA, 'http-owner-a-after-restart');
  const persisted = structured(await afterRestart.client.callTool({ name: 'proposal_list', arguments: { ownerNamespace: ownerA, limit: 25 } }));
  assert.equal(persisted.data.items[0].proposalId, created.data.proposalId);
  const persistedDuplicate = structured(await afterRestart.client.callTool({ name: 'proposal_create', arguments: createArguments }));
  assert.equal(persistedDuplicate.data.result, 'duplicate');
  await afterRestart.client.close();
  assert.equal(serviceLogs.includes(tokenA), false);
  assert.equal(serviceLogs.includes(tokenB), false);
  const forbiddenSource = fs.readFileSync(path.join(root, 'src/legacyFillService/mcp-server.mjs'), 'utf8');
  assert.equal(/experimental\.tasks|sampling\/createMessage|elicitation\/create|DEF_INTERNAL_GOVERNANCE_TOKEN/.test(forbiddenSource), false);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies['@modelcontextprotocol/sdk'], '1.29.0');
  assert.equal(packageJson.build.files.includes('scripts/legacy-fill-mcp-stdio.mjs'), true);
  assert.equal(packageJson.build.files.includes('docs/specs/legacy-ai-cli-mcp-extraction/fixtures/legacy-fill-wire-v1.json'), true);
  process.stdout.write('[legacy-fill-mcp-contract] passed\n');
} finally {
  await stopService().catch(() => {});
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
