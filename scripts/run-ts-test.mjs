import { createServer } from 'vite';

const testModule = process.argv[2];

if (!testModule) {
  console.error('Usage: node scripts/run-ts-test.mjs <module>');
  process.exit(1);
}

const server = await createServer({
  configFile: './vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  await server.ssrLoadModule(testModule);
} finally {
  await server.close();
}
