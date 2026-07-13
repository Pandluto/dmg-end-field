import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(projectRoot, 'agent', 'vendor', 'opencode');
const upstreamPackageRoot = path.join(vendorRoot, 'packages', 'opencode');
const upstreamPackageJsonPath = path.join(upstreamPackageRoot, 'package.json');
const runtimeRoot = path.join(projectRoot, 'agent', 'runtime', 'opencode-core');
const runtimeBinRoot = path.join(runtimeRoot, 'bin');
const buildCacheDir = path.join(projectRoot, '.runtime', 'opencode-build');
const modelsSnapshotPath = path.join(buildCacheDir, 'models.dev.api.json');

const platformName = process.platform === 'win32'
  ? 'win32'
  : process.platform === 'darwin'
    ? 'darwin'
    : process.platform === 'linux'
      ? 'linux'
      : process.platform;
const archName = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : process.arch;
const runtimeTarget = `${platformName}-${archName}`;
const upstreamOsName = process.platform === 'win32' ? 'windows' : process.platform;
const upstreamDistName = `opencode-${upstreamOsName}-${archName}`;
const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';

function fail(message) {
  console.error(`[build-opencode-runtime] ${message}`);
  process.exit(1);
}

function ensureInside(parent, target) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`Refusing to operate outside ${parent}: ${target}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchModelsSnapshot() {
  if (process.env.MODELS_DEV_API_JSON) {
    const configured = path.resolve(process.env.MODELS_DEV_API_JSON);
    if (!fs.existsSync(configured)) {
      fail(`MODELS_DEV_API_JSON points to a missing file: ${configured}`);
    }
    return configured;
  }

  fs.mkdirSync(buildCacheDir, { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.log(`[build-opencode-runtime] fetching models.dev snapshot (attempt ${attempt}/3)`);
      const response = await fetch('https://models.dev/api.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      JSON.parse(text);
      fs.writeFileSync(modelsSnapshotPath, `${text.trim()}\n`);
      return modelsSnapshotPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[build-opencode-runtime] models.dev fetch failed: ${message}`);
      if (fs.existsSync(modelsSnapshotPath)) {
        console.warn(`[build-opencode-runtime] using cached models.dev snapshot: ${path.relative(projectRoot, modelsSnapshotPath)}`);
        return modelsSnapshotPath;
      }
      if (attempt < 3) await delay(1000 * attempt);
    }
  }

  fail('Unable to fetch models.dev snapshot and no cached snapshot exists.');
}

async function rmWithRetry(targetPath) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const retryable = error && ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code);
      if (!retryable || attempt === 5) throw error;
      console.warn(`[build-opencode-runtime] cleanup retry ${attempt}/5 for ${path.relative(projectRoot, targetPath)}: ${error.code}`);
      await delay(500 * attempt);
    }
  }
}

function findBun() {
  const homeBun = process.platform === 'win32' && process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, '.bun', 'bin', 'bun.exe')
    : process.env.HOME
      ? path.join(process.env.HOME, '.bun', 'bin', 'bun')
      : '';
  for (const command of ['bun', 'bun.exe', homeBun].filter(Boolean)) {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (result.status === 0) {
      return { command, version: String(result.stdout || '').trim() };
    }
  }
  return null;
}

if (!fs.existsSync(vendorRoot)) {
  fail(`Missing upstream vendor directory: ${path.relative(projectRoot, vendorRoot)}`);
}
if (!fs.existsSync(upstreamPackageJsonPath)) {
  fail(`Missing upstream package.json: ${path.relative(projectRoot, upstreamPackageJsonPath)}`);
}

const bun = findBun();
if (!bun) {
  fail('Bun is required on the build machine. Install Bun, then rerun this script.');
}

const upstreamPackage = readJson(upstreamPackageJsonPath);
const upstreamVersion = upstreamPackage.version || 'unknown';

console.log(`[build-opencode-runtime] upstream version: ${upstreamVersion}`);
console.log(`[build-opencode-runtime] bun version: ${bun.version}`);
console.log(`[build-opencode-runtime] target: ${runtimeTarget}`);

const modelsSnapshot = await fetchModelsSnapshot();
console.log(`[build-opencode-runtime] models snapshot: ${path.relative(projectRoot, modelsSnapshot)}`);

const build = spawnSync(bun.command, [
  'run',
  '--cwd',
  upstreamPackageRoot,
  'script/build.ts',
  '--single',
  '--skip-embed-web-ui',
  '--skip-install',
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    MODELS_DEV_API_JSON: modelsSnapshot,
  },
  stdio: 'inherit',
  windowsHide: true,
});

if (build.status !== 0) {
  fail(`Upstream OpenCode build failed with exit code ${build.status ?? 'unknown'}`);
}

const upstreamBinDir = path.join(upstreamPackageRoot, 'dist', upstreamDistName, 'bin');
const binaryCandidates = [
  path.join(upstreamBinDir, binaryName),
  path.join(upstreamBinDir, 'opencode.exe'),
  path.join(upstreamBinDir, 'opencode'),
];
const builtBinary = binaryCandidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
if (!builtBinary) {
  fail(`Built OpenCode binary was not found under ${path.relative(projectRoot, upstreamBinDir)}`);
}

fs.mkdirSync(runtimeRoot, { recursive: true });
ensureInside(runtimeRoot, runtimeBinRoot);
const targetDir = path.join(runtimeBinRoot, runtimeTarget);
const versionedBinaryName = process.platform === 'win32'
  ? `opencode-${upstreamVersion}.exe`
  : `opencode-${upstreamVersion}`;
const targetBinary = path.join(targetDir, versionedBinaryName);
ensureInside(runtimeRoot, targetBinary);
fs.mkdirSync(targetDir, { recursive: true });
await rmWithRetry(targetBinary);
fs.copyFileSync(builtBinary, targetBinary);
if (process.platform !== 'win32') {
  fs.chmodSync(targetBinary, 0o755);
}

// A release only needs the manifest-selected binary for its current target.
// Remove obsolete versioned binaries and the historical unversioned fallback so
// `agent/runtime/**` cannot silently ship another full OpenCode executable.
for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
  if (!entry.isFile() || entry.name === versionedBinaryName) continue;
  const isOpenCodeBinary = process.platform === 'win32'
    ? /^opencode(?:-[\w.-]+)?\.exe$/i.test(entry.name)
    : /^opencode(?:-[\w.-]+)?$/i.test(entry.name);
  if (isOpenCodeBinary) {
    await rmWithRetry(path.join(targetDir, entry.name));
  }
}

const checksum = sha256(targetBinary);
const relativeBinaryPath = path.relative(runtimeRoot, targetBinary).replace(/\\/g, '/');
const builtAt = new Date().toISOString();

const manifest = {
  name: 'opencode-core',
  upstreamName: upstreamPackage.name || 'opencode',
  upstreamVersion,
  runtimeTarget,
  binary: relativeBinaryPath,
  source: path.relative(projectRoot, upstreamPackageRoot).replace(/\\/g, '/'),
  buildCommand: 'bun run --cwd agent/vendor/opencode/packages/opencode script/build.ts --single --skip-embed-web-ui --skip-install',
  bunVersion: bun.version,
  modelsSnapshot: path.relative(projectRoot, modelsSnapshot).replace(/\\/g, '/'),
  checksumSha256: checksum,
  builtAt,
};

const checksums = {
  generatedAt: builtAt,
  files: {
    [relativeBinaryPath]: {
      sha256: checksum,
      bytes: fs.statSync(targetBinary).size,
    },
  },
};

fs.writeFileSync(path.join(runtimeRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(runtimeRoot, 'checksums.json'), `${JSON.stringify(checksums, null, 2)}\n`);

console.log(`[build-opencode-runtime] copied ${path.relative(projectRoot, builtBinary)} -> ${path.relative(projectRoot, targetBinary)}`);
console.log(`[build-opencode-runtime] sha256 ${checksum}`);
