import { createServer } from 'vite';

const testModules = process.argv.slice(2);

if (!testModules.length) {
  console.error('Usage: node scripts/run-ts-test.mjs <module> [module...]');
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, port: 0 },
  appType: 'custom',
  logLevel: 'error',
});

try {
  for (const testModule of testModules) {
    console.log(`[run-ts-test] ${testModule}`);
    await server.ssrLoadModule(testModule);
  }
} finally {
  await server.close();
}
