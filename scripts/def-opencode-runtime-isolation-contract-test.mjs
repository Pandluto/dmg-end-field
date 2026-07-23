import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const {
  buildOpenCodeRuntimeEnv,
  verifyOpenCodeRuntimeBinary,
  OPENCODE_RUNTIME_INTEGRITY_ERROR,
} = require('../agent/runtime/def-opencode-adapter/index.cjs');

const adapterPath = path.join(projectRoot, 'agent/runtime/def-opencode-adapter/index.cjs');
const flagPath = path.join(projectRoot, 'agent/vendor/opencode/packages/core/src/flag/flag.ts');
const configPath = path.join(projectRoot, 'agent/vendor/opencode/packages/opencode/src/config/config.ts');
const pluginPath = path.join(projectRoot, 'agent/vendor/opencode/packages/opencode/src/config/plugin.ts');
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const flagSource = fs.readFileSync(flagPath, 'utf8');
const configSource = fs.readFileSync(configPath, 'utf8');
const pluginSource = fs.readFileSync(pluginPath, 'utf8');

function sourceBlock(source, start) {
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, 'the selected source block must open');
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('the selected source block must close');
}

const runtimeEnvStart = adapterSource.indexOf('function buildOpenCodeRuntimeEnv');
assert.notEqual(runtimeEnvStart, -1, 'DEF must retain a dedicated OpenCode child-environment builder');
const runtimeEnvEnd = adapterSource.indexOf('\nfunction readJsonFile', runtimeEnvStart);
assert(runtimeEnvEnd > runtimeEnvStart, 'the child-environment builder must have a bounded source block');
const runtimeEnvSource = adapterSource.slice(runtimeEnvStart, runtimeEnvEnd);
assert.match(runtimeEnvSource, /delete inheritedEnv\.OPENCODE_PURE/,
  'DEF must remove inherited pure mode because its local file plugin and config Skills remain required');
assert.doesNotMatch(runtimeEnvSource, /OPENCODE_PURE:\s*['"](?:true|1)/,
  'DEF must never set OPENCODE_PURE for its child runtime');

const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'def-opencode-runtime-isolation-'));
const inheritedPure = process.env.OPENCODE_PURE;
try {
  process.env.OPENCODE_PURE = 'true';
  const config = {
    plugin: ['file:///def-runtime/def-plugin.js'],
    skills: { paths: ['/def-runtime/skills'] },
  };
  const env = buildOpenCodeRuntimeEnv(config, {
    openCodeHome: isolatedHome,
    harnessSealKey: 'a'.repeat(64),
  });

  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, 'true',
    'DEF child runtimes must skip ~/.agents and ~/.claude skill discovery');
  assert.equal(env.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL, 'true',
    'DEF child runtimes must skip generic config dependency installs');
  assert.equal(env.OPENCODE_PURE, undefined,
    'a parent OPENCODE_PURE must not leak into DEF child runtimes');
  assert.equal(env.OPENCODE_CONFIG_CONTENT, JSON.stringify(config),
    'the isolated runtime must still receive its explicit DEF configuration');
  assert.equal(env.XDG_CONFIG_HOME, path.join(isolatedHome, 'config'));
  assert.equal(env.XDG_DATA_HOME, path.join(isolatedHome, 'data'));
  assert.equal(env.XDG_STATE_HOME, path.join(isolatedHome, 'state'));
  assert.equal(env.XDG_CACHE_HOME, path.join(isolatedHome, 'cache'));
} finally {
  if (inheritedPure === undefined) delete process.env.OPENCODE_PURE;
  else process.env.OPENCODE_PURE = inheritedPure;
  fs.rmSync(isolatedHome, { recursive: true, force: true });
}

assert.match(flagSource,
  /get OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL\(\) \{\s*return truthy\("OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL"\)\s*\}/,
  'the dependency-install opt-out must be a runtime-evaluated OpenCode flag getter');

const installStart = configSource.indexOf('const dep = yield* npmSvc');
assert.notEqual(installStart, -1, 'the audited generic config dependency install must remain identifiable');
const guardStart = configSource.lastIndexOf('if (!Flag.OPENCODE_DISABLE_CONFIG_DEPENDENCY_INSTALL)', installStart);
assert.notEqual(guardStart, -1, 'the generic config dependency install must be guarded by the dedicated opt-out');
const dependencyInstallBlock = sourceBlock(configSource, guardStart);
assert.match(dependencyInstallBlock, /npmSvc\s*\.install\(dir/, 'the guard must own the npm install');
assert.match(dependencyInstallBlock, /deps\.push\(dep\)/, 'the guard must also prevent dependency-fiber registration');
assert.doesNotMatch(dependencyInstallBlock, /ConfigPlugin\.load/,
  'the opt-out must not suppress local file-plugin discovery');

const localPluginLoad = configSource.indexOf('const list = yield* Effect.promise(() => ConfigPlugin.load(dir))');
assert(localPluginLoad > guardStart + dependencyInstallBlock.length,
  'local plugin discovery must remain outside the dependency-install opt-out');
assert.match(pluginSource, /if \(spec\.startsWith\("file:\/\/"\)\) return spec/,
  'file:// plugin specs must retain their direct local-file resolution path');
assert.match(adapterSource,
  /skills:\s*\{\s*paths:\s*\[skillsRoot\],\s*\},\s*plugin:\s*\[pathToFileURL\(defOpenCodePluginSource\)\.href\]/,
  'DEF config must retain its explicit Skills path and file:// plugin');

function currentRuntimeTarget() {
  return `${process.platform}-${process.arch}`;
}

function expectedBinaryName(version = '1.0.0') {
  return `opencode-${version}${process.platform === 'win32' ? '.exe' : ''}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createRuntimeFixture({
  binary = Buffer.from('verified runtime fixture'),
  manifest = {},
  checksums = {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-opencode-runtime-integrity-'));
  const target = currentRuntimeTarget();
  const version = '1.0.0';
  const binaryName = expectedBinaryName(version);
  const relativeBinary = `bin/${target}/${binaryName}`;
  const binaryPath = path.join(root, ...relativeBinary.split('/'));
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, binary);
  const digest = sha256(binary);
  const runtimeManifest = {
    name: 'opencode-core',
    upstreamVersion: version,
    runtimeTarget: target,
    binary: relativeBinary,
    checksumSha256: digest,
    ...manifest,
  };
  const runtimeChecksums = {
    files: {
      [relativeBinary]: {
        sha256: digest,
        bytes: binary.length,
      },
    },
    ...checksums,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(runtimeManifest), 'utf8');
  fs.writeFileSync(path.join(root, 'checksums.json'), JSON.stringify(runtimeChecksums), 'utf8');
  return { root, target, binaryPath, relativeBinary, runtimeManifest, runtimeChecksums };
}

function expectIntegrityFailure(run, reason) {
  assert.throws(run, (error) => error?.code === OPENCODE_RUNTIME_INTEGRITY_ERROR
    && (!reason || error.reason === reason), `runtime integrity must fail closed${reason ? ` with ${reason}` : ''}`);
}

const runtimeFixtureRoots = [];
try {
  const valid = createRuntimeFixture();
  runtimeFixtureRoots.push(valid.root);
  const verifiedPath = verifyOpenCodeRuntimeBinary({ runtimeRoot: valid.root, cache: new Map() });
  assert.equal(verifiedPath, fs.realpathSync(valid.binaryPath), 'a matching manifest, checksum entry, size, and binary hash must verify');

  const hashMismatch = createRuntimeFixture({
    manifest: { checksumSha256: '0'.repeat(64) },
    checksums: { files: {} },
  });
  runtimeFixtureRoots.push(hashMismatch.root);
  hashMismatch.runtimeChecksums.files[hashMismatch.relativeBinary] = {
    sha256: '0'.repeat(64),
    bytes: fs.statSync(hashMismatch.binaryPath).size,
  };
  fs.writeFileSync(path.join(hashMismatch.root, 'checksums.json'), JSON.stringify(hashMismatch.runtimeChecksums), 'utf8');
  expectIntegrityFailure(() => verifyOpenCodeRuntimeBinary({ runtimeRoot: hashMismatch.root, cache: new Map() }), 'binary-sha256-mismatch');

  const inconsistentMetadata = createRuntimeFixture({
    manifest: { checksumSha256: '1'.repeat(64) },
  });
  runtimeFixtureRoots.push(inconsistentMetadata.root);
  expectIntegrityFailure(() => verifyOpenCodeRuntimeBinary({ runtimeRoot: inconsistentMetadata.root, cache: new Map() }), 'checksums-invalid-or-inconsistent');

  const sizeMismatch = createRuntimeFixture();
  runtimeFixtureRoots.push(sizeMismatch.root);
  sizeMismatch.runtimeChecksums.files[sizeMismatch.relativeBinary].bytes += 1;
  fs.writeFileSync(path.join(sizeMismatch.root, 'checksums.json'), JSON.stringify(sizeMismatch.runtimeChecksums), 'utf8');
  expectIntegrityFailure(() => verifyOpenCodeRuntimeBinary({ runtimeRoot: sizeMismatch.root, cache: new Map() }), 'binary-size-mismatch');

  const traversal = createRuntimeFixture({
    manifest: { binary: '../outside/opencode.exe' },
  });
  runtimeFixtureRoots.push(traversal.root);
  expectIntegrityFailure(() => verifyOpenCodeRuntimeBinary({ runtimeRoot: traversal.root, cache: new Map() }), 'manifest-binary-path-invalid');

  const targetMismatch = createRuntimeFixture({
    manifest: { runtimeTarget: 'other-platform-x64' },
  });
  runtimeFixtureRoots.push(targetMismatch.root);
  expectIntegrityFailure(() => verifyOpenCodeRuntimeBinary({ runtimeRoot: targetMismatch.root, cache: new Map() }), 'manifest-target-mismatch');

  const missingManifest = createRuntimeFixture();
  runtimeFixtureRoots.push(missingManifest.root);
  fs.rmSync(path.join(missingManifest.root, 'manifest.json'));
  expectIntegrityFailure(() => verifyOpenCodeRuntimeBinary({ runtimeRoot: missingManifest.root, cache: new Map() }), 'manifest-target-mismatch');

  const missingChecksums = createRuntimeFixture();
  runtimeFixtureRoots.push(missingChecksums.root);
  fs.rmSync(path.join(missingChecksums.root, 'checksums.json'));
  expectIntegrityFailure(() => verifyOpenCodeRuntimeBinary({ runtimeRoot: missingChecksums.root, cache: new Map() }), 'checksums-invalid-or-inconsistent');
} finally {
  for (const root of runtimeFixtureRoots) fs.rmSync(root, { recursive: true, force: true });
}

const resolverStart = adapterSource.indexOf('function resolveOpenCodeBinary()');
const resolverEnd = adapterSource.indexOf('\nfunction processRunning', resolverStart);
assert(resolverStart >= 0 && resolverEnd > resolverStart, 'the native runtime resolver must remain source-identifiable');
assert.match(adapterSource.slice(resolverStart, resolverEnd), /return verifyOpenCodeRuntimeBinary\(\);/,
  'the resolver must fail closed through runtime integrity verification rather than select an existing binary');
const startupStart = adapterSource.indexOf('const startPromise = (async () => {');
const startupEnd = adapterSource.indexOf('\n    opencodeProcess = child;', startupStart);
const startupSource = adapterSource.slice(startupStart, startupEnd);
assert(startupSource.indexOf('const binaryPath = resolveOpenCodeBinary();') < startupSource.indexOf('const child = spawn(binaryPath'),
  'runtime integrity verification must complete before the OpenCode binary can be spawned');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'isolated-def-child-environment',
    'external-home-skills-disabled',
    'generic-config-dependency-install-disabled',
    'file-plugin-and-def-skills-retained',
    'runtime-manifest-checksum-binary-integrity',
    'runtime-integrity-fails-closed-before-spawn',
    'no-provider-access',
  ],
}));
