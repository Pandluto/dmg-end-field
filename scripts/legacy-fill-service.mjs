#!/usr/bin/env node
import path from 'node:path';
import { createLegacyFillService } from '../src/legacyFillService/server.mjs';

const service = createLegacyFillService({
  host: '127.0.0.1',
  port: Number(process.env.LEGACY_FILL_SERVICE_PORT || 17323),
  hostToken: process.env.LEGACY_FILL_HOST_TOKEN,
  databasePath: process.env.LEGACY_FILL_DATABASE_PATH || path.resolve('.runtime', 'legacy-fill-service', 'legacy-fill.sqlite3'),
  registryPath: process.env.LEGACY_FILL_REGISTRY_PATH || path.resolve('.runtime', 'legacy-fill-service', 'registry.json'),
});

await service.listen();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void service.close().finally(() => process.exit(0)));
}
