import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

const files = trackedFiles();
const packageJson = readJson('package.json');

for (const required of ['package-lock.json', '.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  if (!fs.existsSync(path.join(root, required))) fail(`missing required repository file: ${required}`);
}

for (const forbidden of ['pnpm-lock.yaml', 'yarn.lock']) {
  if (fs.existsSync(path.join(root, forbidden))) fail(`multiple lockfiles are not allowed: ${forbidden}`);
}

for (const file of files) {
  const segments = file.split('/');
  if (segments.includes('.DS_Store')) fail(`tracked OS artifact: ${file}`);
  if (segments.some((segment) => ['.claude', '.trae', '.zcode'].includes(segment))) {
    fail(`tracked obsolete agent configuration: ${file}`);
  }
}

if (packageJson.packageManager !== 'npm@11.13.0') fail('packageManager must pin npm@11.13.0');
if (!packageJson.engines?.node?.includes('>=24')) fail('Node.js 24 must be declared in engines');
if (!packageJson.dependencies?.vite) fail('vite must be a runtime dependency for the packaged REST sidecar');
if (!packageJson.build?.files?.includes('src/**')) fail('electron-builder files must include src/** for sidecar SSR modules');
if (!packageJson.build?.asarUnpack?.includes('node_modules/@esbuild/**')) {
  fail('electron-builder must unpack the esbuild child-process binary');
}

const manifest = readJson('public/assets/images/_manifest.json');
if (!Array.isArray(manifest)) fail('public image manifest must be an array');
for (const [index, entry] of (Array.isArray(manifest) ? manifest : []).entries()) {
  if ('rootDirectory' in entry) fail(`public image manifest entry ${index} leaks a machine-local rootDirectory`);
  if (typeof entry.relativePath !== 'string' || path.isAbsolute(entry.relativePath) || /^[A-Za-z]:[\\/]/.test(entry.relativePath)) {
    fail(`public image manifest entry ${index} does not use a portable relativePath`);
  }
}

const syntaxRoots = ['scripts/', 'electron/', 'agent/server/', 'agent/runtime/', 'agent/harness/'];
const syntaxFiles = files.filter(
  (file) =>
    syntaxRoots.some((prefix) => file.startsWith(prefix)) &&
    !file.startsWith('agent/vendor/') &&
    /\.(?:cjs|mjs)$/.test(file),
);
for (const file of syntaxFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) fail(`syntax check failed: ${file}\n${result.stderr.trim()}`);
}

const stableDocs = files.filter(
  (file) =>
    ['CONTRIBUTING.md', 'SECURITY.md', 'docs/README.md'].includes(file) ||
    (file.startsWith('docs/architecture/') && !file.startsWith('docs/architecture/audits/')),
);
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
for (const file of stableDocs) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of content.matchAll(markdownLink)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (!rawTarget || /^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
    const localTarget = decodeURIComponent(rawTarget.split('#')[0]);
    const resolved = path.resolve(root, path.dirname(file), localTarget);
    if (!fs.existsSync(resolved)) fail(`broken local Markdown link in ${file}: ${rawTarget}`);
  }
}

for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  const content = fs.readFileSync(path.join(root, workflow), 'utf8');
  if (/pull_request_target\s*:/.test(content)) fail(`${workflow} must not execute untrusted PR code via pull_request_target`);
  for (const match of content.matchAll(/uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)) {
    const action = match[1];
    if (action.startsWith('./')) continue;
    const reference = action.split('@').at(-1) || '';
    if (!/^[0-9a-f]{40}$/.test(reference)) fail(`${workflow} action is not pinned to a full commit SHA: ${action}`);
  }
}

if (failures.length > 0) {
  console.error(`REPOSITORY_CHECK_FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `REPOSITORY_CHECK_OK tracked=${files.length} syntax=${syntaxFiles.length} docs=${stableDocs.length} images=${Array.isArray(manifest) ? manifest.length : 0}`,
);
