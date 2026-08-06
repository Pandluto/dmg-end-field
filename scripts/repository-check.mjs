import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

function inspectTypeScriptDependencies(content, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = new Set(sourceFile.referencedFiles.map((reference) => reference.fileName));
  const uninspectable = [];

  function addLiteral(node, label) {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.add(node.text);
      return;
    }
    uninspectable.push(label);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) addLiteral(node.moduleSpecifier, 'module declaration');
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        addLiteral(node.moduleReference.expression, 'import equals');
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) addLiteral(argument.literal, 'import type');
      else uninspectable.push('import type');
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        if (node.arguments.length === 1) {
          addLiteral(node.arguments[0], isDynamicImport ? 'dynamic import' : 'require call');
        } else {
          uninspectable.push(isDynamicImport ? 'dynamic import' : 'require call');
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { specifiers: [...specifiers], uninspectable };
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
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
  'public/shell/',
  '.agents/skills/harness-audit-assistant/',
  'src/aiCli/',
  'src/components/def-opencode/',
];
const allowedLegacyFillFiles = new Set([
  'src/legacyFillCore/domains/buff/catalog.ts',
  'src/legacyFillCore/domains/buff/schema.ts',
  'src/legacyFillCore/domains/buff/validator.ts',
  'src/legacyFillCore/domains/equipment.ts',
  'src/legacyFillCore/domains/operator.ts',
  'src/legacyFillCore/domains/weapon.ts',
  'src/legacyFillCore/index.ts',
  'src/legacyFillCore/preserveAssets.ts',
  'src/legacyFillHost/browserGateway.ts',
  'src/legacyFillHost/runtime.ts',
  'src/legacyFillService/canonical-json.mjs',
  'src/legacyFillService/domain-runtime-entry.ts',
  'src/legacyFillService/mcp-operations.mjs',
  'src/legacyFillService/mcp-server.mjs',
  'src/legacyFillService/proposal-repository.mjs',
  'src/legacyFillService/resources/golden-v1.json',
  'src/legacyFillService/resources/strategy-v1.json',
  'src/legacyFillService/server.mjs',
]);
const allowedAgentFiles = new Set([
  'agent/core/contracts/browser-protocol.ts',
  'agent/core/contracts/engine.ts',
  'agent/core/contracts/events.ts',
  'agent/core/contracts/ids.ts',
  'agent/core/contracts/index.ts',
  'agent/core/contracts/interaction.ts',
  'agent/core/contracts/json.ts',
  'agent/core/contracts/product.ts',
  'agent/core/contracts/session.ts',
  'agent/core/testing/fake-engine.contract.test.ts',
  'agent/core/testing/fake-engine.ts',
  'agent/host/browser-consumer-registry.ts',
  'agent/host/def-agent-host.ts',
  'agent/host/errors.ts',
  'agent/host/host.contract.test.ts',
  'agent/host/http-server.ts',
  'agent/host/remote-browser-product-gateway.ts',
  'agent/host/token-authority.ts',
  'agent/runtime/host-entry.ts',
  'agent/runtime/pending-agent-engine.ts',
]);
const removedRuntimeFiles = new Set([
  'src/utils/localBridge.ts',
  'src/utils/localDataBridge.ts',
  'src/utils/workbenchRendererCapability.ts',
]);
const thinShellElectronFiles = new Set([
  'electron/assets/icon.ico',
  'electron/assets/icon.png',
  'electron/agent-runtime.cjs',
  'electron/agent-runtime.test.cjs',
  'electron/entitlements.mac.plist',
  'electron/legacy-fill-runtime.cjs',
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/shell/index.html',
  'electron/shell/shell.css',
  'electron/shell/shell.js',
  'electron/static-host.cjs',
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
  if (file.startsWith('agent/') && !allowedAgentFiles.has(file)) {
    fail(`Agent runtime contains an unreviewed file: ${file}`);
  }
  if (/^src\/legacyFill(?:Core|Host|Service)\//.test(file) && !allowedLegacyFillFiles.has(file)) {
    fail(`Legacy Fill runtime contains an unreviewed file: ${file}`);
  }
  if (file.startsWith('electron/') && !thinShellElectronFiles.has(file)) {
    fail(`thin Electron Shell contains an unapproved runtime file: ${file}`);
  }
}

const agentRoot = path.join(root, 'agent');
const agentCoreRoot = path.join(agentRoot, 'core');
for (const file of files.filter((candidate) => allowedAgentFiles.has(candidate))) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  const dependencyInspection = inspectTypeScriptDependencies(content, file);
  for (const label of dependencyInspection.uninspectable) {
    fail(`Agent core contains an uninspectable ${label}: ${file}`);
  }
  for (const specifier of dependencyInspection.specifiers) {
    const canUseNodeBuiltins = file.endsWith('.test.ts')
      || file.startsWith('agent/host/')
      || file.startsWith('agent/runtime/');
    if (canUseNodeBuiltins && specifier.startsWith('node:')) continue;
    if (!specifier.startsWith('.')) {
      fail(`Agent runtime imports an external package (${specifier}): ${file}`);
      continue;
    }
    const resolvedImport = path.resolve(path.dirname(path.join(root, file)), specifier);
    if (!isPathInside(agentRoot, resolvedImport)) {
      fail(`Agent runtime import escapes its boundary (${specifier}): ${file}`);
    }
    if (file.startsWith('agent/core/') && !isPathInside(agentCoreRoot, resolvedImport)) {
      fail(`Agent core import escapes its engine-neutral boundary (${specifier}): ${file}`);
    }
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
if (packageJson.main !== 'electron/main.cjs') fail('thin desktop entry point must be electron/main.cjs');
if (!packageJson.build || packageJson.build.appId !== 'com.dmg.def') {
  fail('thin desktop packager config is missing or invalid');
}

const forbiddenDependencies = [
  'better-sqlite3',
  'electron-updater',
  'sqlite3',
];
for (const dependency of forbiddenDependencies) {
  if (packageJson.dependencies?.[dependency] || packageJson.devDependencies?.[dependency]) {
    fail(`removed runtime dependency returned: ${dependency}`);
  }
}
for (const dependency of ['@modelcontextprotocol/sdk', 'esbuild', 'zod']) {
  if (!packageJson.devDependencies?.[dependency]) {
    fail(`Legacy Fill MCP development dependency is missing: ${dependency}`);
  }
  if (packageJson.dependencies?.[dependency]) {
    fail(`bundled Legacy Fill dependency must not ship through node_modules: ${dependency}`);
  }
}
for (const dependency of ['concurrently', 'electron', 'electron-builder', 'wait-on']) {
  if (packageJson.dependencies?.[dependency]) {
    fail(`desktop build-only dependency must not be a runtime dependency: ${dependency}`);
  }
  if (!packageJson.devDependencies?.[dependency]) {
    fail(`thin desktop development dependency is missing: ${dependency}`);
  }
}
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (/public\/shell|ai-cli-rest-server|17321|17322/.test(String(command))) {
    fail(`desktop command references a retired runtime in script ${name}`);
  }
}
if (packageJson.scripts?.['typecheck:agent'] !== 'tsc -p tsconfig.agent.json') {
  fail('Agent core typecheck script is missing or invalid');
}
if (!String(packageJson.scripts?.['test:agent-core'] || '').includes('fake-engine.contract.test.ts')) {
  fail('Agent core contract test script is missing or invalid');
}

const dataManifest = readJson('public/web-data-manifest.json');
if (
  dataManifest.schemaVersion !== 1
  || dataManifest.packageId !== 'dmg-end-field-core-data'
  || !Array.isArray(dataManifest.files)
) {
  fail('public web data manifest is invalid');
} else {
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
  `REPOSITORY_CHECK_OK profile=desktop-thin-shell-legacy-fill-mcp tracked=${files.length} syntax=${syntaxFiles.length} `
  + `data=${dataManifest.files.length} images=${imageManifest.files.length} docs=${stableDocs.length}`,
);
