#!/usr/bin/env node
import path from 'node:path';
import { createLegacyFillService } from '../src/legacyFillService/server.mjs';

let parentWatch = null;

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
  strategyPath: process.env.LEGACY_FILL_STRATEGY_PATH || path.resolve('src', 'legacyFillService', 'resources', 'strategy-v1.json'),
  goldenPath: process.env.LEGACY_FILL_GOLDEN_PATH || path.resolve('src', 'legacyFillService', 'resources', 'golden-v1.json'),
  onShutdown: () => {
    if (parentWatch) clearInterval(parentWatch);
    process.exit(0);
  },
});

await service.listen();
const parentPid = Number(process.env.LEGACY_FILL_PARENT_PID || 0);
if (Number.isInteger(parentPid) && parentPid > 1) {
  parentWatch = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(parentWatch);
      void service.close().finally(() => process.exit(0));
    }
  }, 1_000);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void service.close().finally(() => process.exit(0)));
}
