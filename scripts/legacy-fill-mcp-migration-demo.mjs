import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || '' : fallback;
}

const configPath = path.resolve(argument('config', process.env.LEGACY_FILL_MCP_CLIENT_CONFIG || '.runtime/legacy-fill-service/mcp-client.json'));
const domain = argument('domain');
const draftPath = argument('draft');
const fixtureId = argument('fixture-id');
const idempotencyKey = argument('idempotency-key');
if (!domain || (!draftPath && !fixtureId) || !idempotencyKey) {
  throw new Error('Usage: node scripts/legacy-fill-mcp-migration-demo.mjs --domain <domain> (--draft <json> | --fixture-id <curated-id>) --idempotency-key <stable-key> [--config <mcp-client.json>]');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (config.contract !== 'LegacyFillMcpClientConfigV1' || config.transport !== 'streamable-http'
  || typeof config.url !== 'string' || typeof config.token !== 'string' || typeof config.ownerNamespace !== 'string') {
  throw new Error('Legacy Fill MCP client config is invalid');
}
let draft;
if (draftPath) {
  draft = JSON.parse(fs.readFileSync(path.resolve(draftPath), 'utf8'));
} else {
  const curated = JSON.parse(fs.readFileSync(path.resolve('src', 'legacyFillService', 'resources', 'golden-v1.json'), 'utf8'));
  const fixture = curated.domains?.[domain]?.fixtures?.find((candidate) => candidate.id === fixtureId);
  if (!fixture) throw new Error(`Curated fixture not found for ${domain}: ${fixtureId}`);
  draft = fixture.draft;
}
const client = new Client({ name: 'legacy-fill-external-workflow-migration-demo', version: '1.0.0' }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(config.url), {
  requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
});

function data(result, operation) {
  const payload = result.structuredContent;
  if (!payload?.ok) throw new Error(`${operation} failed: ${payload?.error?.code || 'unknown'}: ${payload?.error?.message || 'unknown error'}`);
  return payload.data;
}

try {
  await client.connect(transport);
  const current = data(await client.callTool({ name: 'fill_get_current', arguments: { domain } }), 'fill_get_current');
  const template = data(await client.callTool({ name: 'fill_get_template', arguments: { domain, schemaVersion: current.schemaVersion } }), 'fill_get_template');
  const baseSnapshot = { snapshotId: current.snapshotId, revision: current.revision, contentHash: current.contentHash };
  const validation = data(await client.callTool({
    name: 'fill_validate',
    arguments: { domain, schemaVersion: current.schemaVersion, baseSnapshot, draft },
  }), 'fill_validate');
  if (!validation.valid) throw new Error(`Draft is invalid: ${(validation.errors || []).join('; ')}`);
  const proposal = data(await client.callTool({
    name: 'proposal_create',
    arguments: {
      ownerNamespace: config.ownerNamespace,
      idempotencyKey,
      domain,
      schemaVersion: current.schemaVersion,
      baseSnapshot,
      draft,
      intent: 'Migrated external workflow: MCP read -> validate -> proposal_create -> Electron Host review',
      evidence: [{ label: 'migration-demo', text: 'Draft supplied explicitly to the direct Codex/standard MCP client workflow.' }],
    },
  }), 'proposal_create');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    boundary: 'direct Codex/standard MCP client; DEF OpenCode is not involved',
    schemaVersion: template.schemaVersion,
    validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
    proposal,
    next: 'A real user must open /legacy-fill-review in Electron Host to claim, approve/reject, and save. MCP cannot do those actions.',
  }, null, 2)}\n`);
} finally {
  await transport.close().catch(() => {});
}
