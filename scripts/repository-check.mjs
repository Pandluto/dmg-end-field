import crypto from 'node:crypto';
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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isPortableRelativePath(value) {
  return (
    typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.split(/[\\/]/).includes('..')
  );
}

const files = trackedFiles().filter((file) => fs.existsSync(path.join(root, file)));
const packageJson = readJson('package.json');

for (const required of [
  'package-lock.json',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'public/web-data-manifest.json',
  'public/web-image-manifest.json',
]) {
  if (!fs.existsSync(path.join(root, required))) fail(`missing required repository file: ${required}`);
}

for (const forbidden of ['pnpm-lock.yaml', 'yarn.lock']) {
  if (fs.existsSync(path.join(root, forbidden))) fail(`multiple lockfiles are not allowed: ${forbidden}`);
}

const removedRuntimePrefixes = [
  'agent/',
  'electron/',
  'public/shell/',
  '.agents/skills/harness-audit-assistant/',
  'src/aiCli/',
  'src/legacyFillCore/',
  'src/legacyFillHost/',
  'src/legacyFillService/',
  'src/components/def-opencode/',
];
const removedRuntimeFiles = new Set([
  'src/utils/localBridge.ts',
  'src/utils/localDataBridge.ts',
  'src/utils/workbenchRendererCapability.ts',
]);

for (const file of files) {
  const segments = file.split('/');
  if (segments.includes('.DS_Store')) fail(`tracked OS artifact: ${file}`);
  if (segments.some((segment) => ['.claude', '.trae', '.zcode'].includes(segment))) {
    fail(`tracked obsolete agent configuration: ${file}`);
  }
  if (removedRuntimePrefixes.some((prefix) => file.startsWith(prefix)) || removedRuntimeFiles.has(file)) {
    fail(`removed desktop/Agent runtime returned: ${file}`);
  }
}

const retiredSelectorFamilies = [
  {
    label: 'legacy SkillButton detail selector',
    pattern: /\.(?:skill-button-modal(?:-[A-Za-z0-9_-]+)?|skill-damage-[A-Za-z0-9_-]+|skill-info-snapshot-[A-Za-z0-9_-]+)/,
  },
  {
    label: 'retired Damage Sheet selector',
    pattern: /\.damage-sheet-(?:buff-tag|context-menu|mini-tab|ribbon-card|sheet-tab|view-group|workspace-footer)(?:\b|[\[.:#])/,
  },
];
for (const file of files.filter((candidate) => (
  candidate.startsWith('src/')
  && !candidate.includes('.test.')
  && /\.(?:css|ts|tsx)$/.test(candidate)
))) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  for (const retiredSelector of retiredSelectorFamilies) {
    if (retiredSelector.pattern.test(content)) {
      fail(`${retiredSelector.label} returned: ${file}`);
    }
  }
}

if (packageJson.packageManager !== 'npm@11.13.0') fail('packageManager must pin npm@11.13.0');
if (!packageJson.engines?.node?.includes('>=24')) fail('Node.js 24 must be declared in engines');
if (!packageJson.devDependencies?.vite || !packageJson.devDependencies?.['vite-plugin-pwa']) {
  fail('Vite and the PWA plugin must remain development dependencies');
}
if (!packageJson.dependencies?.['@sqlite.org/sqlite-wasm']) {
  fail('browser SQLite WASM must remain a runtime dependency');
}
if (packageJson.main || packageJson.build) fail('desktop entry points and packager config must not return');

const forbiddenDependencies = [
  '@modelcontextprotocol/sdk',
  'concurrently',
  'electron',
  'electron-builder',
  'wait-on',
  'zod',
];
for (const dependency of forbiddenDependencies) {
  if (packageJson.dependencies?.[dependency] || packageJson.devDependencies?.[dependency]) {
    fail(`removed runtime dependency returned: ${dependency}`);
  }
}
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (/(?:^|[/:])electron(?:$|[/:])|electron-builder|public\/shell/.test(String(command))) {
    fail(`desktop command returned in script ${name}`);
  }
}

const dataManifest = readJson('public/web-data-manifest.json');
if (
  dataManifest.schemaVersion !== 1
  || dataManifest.packageId !== 'dmg-end-field-core-data'
  || !Array.isArray(dataManifest.files)
) {
  fail('public web data manifest is invalid');
} else {
  const expectedDataFiles = ['data/default-local-data.json'];
  if (
    dataManifest.files.length !== expectedDataFiles.length
    || dataManifest.files.some((entry, index) => entry.path !== expectedDataFiles[index])
  ) {
    fail('public web data package must contain only the canonical default archive');
  }
  let totalBytes = 0;
  for (const entry of dataManifest.files) {
    if (!isPortableRelativePath(entry.path) || !entry.path.startsWith('data/')) {
      fail(`invalid web data path: ${entry.path}`);
      continue;
    }
    const absolutePath = path.join(root, 'public', entry.path);
    if (!fs.existsSync(absolutePath)) {
      fail(`missing web data file: ${entry.path}`);
      continue;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (content.includes('127.0.0.1:31457')) {
      fail(`desktop bridge URL remains in web data: ${entry.path}`);
    }
    if (/[A-Za-z]:\\\\Users\\\\/.test(content)) {
      fail(`machine-local Windows path remains in web data: ${entry.path}`);
    }
    const size = fs.statSync(absolutePath).size;
    totalBytes += size;
    if (size !== entry.size) fail(`web data size mismatch: ${entry.path}`);
    if (sha256(absolutePath) !== entry.sha256) fail(`web data hash mismatch: ${entry.path}`);
  }
  if (totalBytes !== dataManifest.totalBytes) fail('web data totalBytes mismatch');

  const defaultArchive = readJson('public/data/default-local-data.json');
  const local = defaultArchive.storage?.local;
  const expectedLibraryKeys = [
    'def.buff-editor.library.v1',
    'def.equipment-sheet.library.v1',
    'def.operator-editor.library.v1',
    'def.weapon-sheet.library.v1',
  ];
  const actualLibraryKeys = local && typeof local === 'object' && !Array.isArray(local)
    ? Object.keys(local).sort()
    : [];
  if (JSON.stringify(actualLibraryKeys) !== JSON.stringify(expectedLibraryKeys)) {
    fail('default local data must contain only canonical libraries');
  }
  const countRecord = (value) => (
    value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0
  );
  if (
    dataManifest.summary?.operators !== countRecord(local?.['def.operator-editor.library.v1'])
    || dataManifest.summary?.weapons !== countRecord(local?.['def.weapon-sheet.library.v1'])
  ) {
    fail('web data summary does not match canonical library counts');
  }
}

const imageManifest = readJson('public/web-image-manifest.json');
if (
  imageManifest.schemaVersion !== 1
  || imageManifest.packageId !== 'dmg-end-field-image-pack'
  || !Array.isArray(imageManifest.files)
  || !imageManifest.archive
) {
  fail('public web image manifest is invalid');
} else {
  if (dataManifest.summary?.images !== imageManifest.files.length) {
    fail('web data summary does not match image package count');
  }
  let totalBytes = 0;
  const imagePaths = new Set();
  for (const entry of imageManifest.files) {
    if (!isPortableRelativePath(entry.path) || !entry.path.startsWith('assets/images/')) {
      fail(`invalid web image path: ${entry.path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) fail(`invalid web image hash: ${entry.path}`);
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0) fail(`invalid web image size: ${entry.path}`);
    if (imagePaths.has(entry.path)) fail(`duplicate web image path: ${entry.path}`);
    imagePaths.add(entry.path);
    totalBytes += entry.size;
  }
  if (totalBytes !== imageManifest.totalBytes) fail('web image totalBytes mismatch');
  if (
    !isPortableRelativePath(imageManifest.archive.path)
    || !imageManifest.archive.path.startsWith('packages/')
    || !/^[a-f0-9]{64}$/.test(imageManifest.archive.sha256)
  ) {
    fail('web image archive descriptor is invalid');
  }
  if (imageManifest.archive.parts !== undefined) {
    if (!Array.isArray(imageManifest.archive.parts) || imageManifest.archive.parts.length === 0) {
      fail('web image archive parts are invalid');
    } else {
      let partBytes = 0;
      for (const part of imageManifest.archive.parts) {
        if (
          !isPortableRelativePath(part.path)
          || !part.path.startsWith('packages/')
          || !/^[a-f0-9]{64}$/.test(part.sha256)
          || !Number.isSafeInteger(part.size)
          || part.size <= 0
          || part.size > 25 * 1024 * 1024
        ) {
          fail(`invalid web image archive part: ${part.path}`);
        }
        partBytes += Number(part.size || 0);
      }
      if (partBytes !== imageManifest.archive.size) {
        fail('web image archive parts totalBytes mismatch');
      }
    }
  }

  const browserIndex = readJson('public/assets/images/_manifest.json');
  const indexedPaths = new Set(browserIndex.map((entry) => entry.relativePath));
  if (browserIndex.length !== imagePaths.size || indexedPaths.size !== imagePaths.size) {
    fail('browser image index and image package contain different file counts');
  }
  for (const imagePath of imagePaths) {
    if (!indexedPaths.has(imagePath)) fail(`browser image index is missing: ${imagePath}`);
  }
  for (const [index, entry] of browserIndex.entries()) {
    if ('rootDirectory' in entry || 'publicUrl' in entry) {
      fail(`browser image index entry ${index} leaks a desktop path or URL`);
    }
  }
}

const syntaxFiles = files.filter(
  (file) => file.startsWith('scripts/') && /\.(?:cjs|mjs|js)$/.test(file),
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
    ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/README.md'].includes(file)
    || (file.startsWith('docs/architecture/') && !file.startsWith('docs/architecture/audits/'))
    || file.startsWith('docs/guides/'),
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
  if (/pull_request_target\s*:/.test(content)) {
    fail(`${workflow} must not execute untrusted PR code via pull_request_target`);
  }
  for (const match of content.matchAll(/uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)) {
    const action = match[1];
    if (action.startsWith('./')) continue;
    const reference = action.split('@').at(-1) || '';
    if (!/^[0-9a-f]{40}$/.test(reference)) {
      fail(`${workflow} action is not pinned to a full commit SHA: ${action}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`REPOSITORY_CHECK_FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `REPOSITORY_CHECK_OK tracked=${files.length} syntax=${syntaxFiles.length} `
  + `data=${dataManifest.files.length} images=${imageManifest.files.length} docs=${stableDocs.length}`,
);
