import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function discoverTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverTests(absolute);
    if (!entry.isFile() || !/\.test\.tsx?$/.test(entry.name)) return [];
    return [`/${path.relative(process.cwd(), absolute).replace(/\\/g, '/')}`];
  });
}

const requestedModules = process.argv.slice(2);
const testModules = (requestedModules.length > 0 ? requestedModules : discoverTests(path.join(process.cwd(), 'src'))).sort();
if (!testModules.length) throw new Error('No TypeScript tests were discovered under src/.');

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
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
