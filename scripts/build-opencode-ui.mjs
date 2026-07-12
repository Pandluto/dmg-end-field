import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(projectRoot, 'agent', 'vendor', 'opencode', 'packages', 'app');
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const outputDir = path.join(projectRoot, 'agent', 'runtime', 'opencode-ui');
const markerPath = path.join(outputDir, 'def-opencode-ui.json');
function hashTree(root) {
  const hash = crypto.createHash('sha256');
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else {
        hash.update(path.relative(root, target).replaceAll('\\', '/'));
        hash.update(fs.readFileSync(target));
      }
    }
  };
  visit(root);
  return hash.digest('hex');
}
const expected = {
  source: '@opencode-ai/app',
  upstreamVersion: packageJson.version,
  base: '/',
  sourcemap: false,
  embeddedProfile: 'def',
  embeddedProfileVersion: 1,
  sourceHash: hashTree(path.join(appRoot, 'src')),
};

try {
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (fs.existsSync(path.join(outputDir, 'index.html'))
    && Object.entries(expected).every(([key, value]) => marker[key] === value)
    && !process.argv.includes('--force')) {
    console.log(`[opencode-ui] ${packageJson.version} already built`);
    process.exit(0);
  }
} catch {
  // Missing or stale output is rebuilt below.
}

const vite = path.join(appRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.exe' : 'vite');
if (!fs.existsSync(vite)) {
  throw new Error(`Vendored OpenCode Vite executable is missing: ${vite}`);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const result = spawnSync(vite, [
  'build',
  '--base=/',
  '--outDir', outputDir,
  '--emptyOutDir',
  '--sourcemap=false',
], {
  cwd: appRoot,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    VITE_DEF_EMBEDDED_PROFILE: 'def',
  },
});
if (result.status !== 0) process.exit(result.status ?? 1);

fs.writeFileSync(markerPath, `${JSON.stringify({
  ...expected,
  builtAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`[opencode-ui] built upstream ${packageJson.version} into ${path.relative(projectRoot, outputDir)}`);
