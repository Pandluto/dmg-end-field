#!/usr/bin/env node
import path from 'node:path';
import { createLegacyFillService } from '../src/legacyFillService/server.mjs';

function parseMcpClients(value) {
  if (!value) return {};
  const parsed = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new TypeError('LEGACY_FILL_MCP_CLIENTS_JSON must be a token-to-owner object');
  return parsed;
}

const service = createLegacyFillService({
  host: '127.0.0.1',
  port: Number(process.env.LEGACY_FILL_SERVICE_PORT || 17323),
  hostToken: process.env.LEGACY_FILL_HOST_TOKEN,
  mcpClients: parseMcpClients(process.env.LEGACY_FILL_MCP_CLIENTS_JSON),
  databasePath: process.env.LEGACY_FILL_DATABASE_PATH || path.resolve('.runtime', 'legacy-fill-service', 'legacy-fill.sqlite3'),
  registryPath: process.env.LEGACY_FILL_REGISTRY_PATH || path.resolve('.runtime', 'legacy-fill-service', 'registry.json'),
  domainRuntimePath: process.env.LEGACY_FILL_DOMAIN_RUNTIME_PATH || path.resolve('dist', 'legacy-fill', 'domain-runtime.mjs'),
  fixturePath: process.env.LEGACY_FILL_FIXTURE_PATH || path.resolve('docs', 'specs', 'legacy-ai-cli-mcp-extraction', 'fixtures', 'legacy-fill-wire-v1.json'),
});

await service.listen();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void service.close().finally(() => process.exit(0)));
}
