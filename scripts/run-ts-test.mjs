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

const baseExtensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];
const desktopExtensions = [
  '.desktop.mjs', '.desktop.js', '.desktop.mts', '.desktop.ts',
  '.desktop.jsx', '.desktop.tsx', '.desktop.json',
  ...baseExtensions,
];

async function createTestServer(extensions) {
  return createServer({
    configFile: false,
    resolve: { extensions },
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'error',
  });
}

const baseServer = await createTestServer(baseExtensions);
let desktopServer = null;

try {
  for (const testModule of testModules) {
    console.log(`[run-ts-test] ${testModule}`);
    if (testModule.includes('.desktop.test.')) {
      desktopServer ||= await createTestServer(desktopExtensions);
      await desktopServer.ssrLoadModule(testModule);
    } else {
      await baseServer.ssrLoadModule(testModule);
    }
  }
} finally {
  await Promise.all([
    baseServer.close(),
    desktopServer?.close(),
  ]);
}
