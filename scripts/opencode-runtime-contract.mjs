import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const LOCK_RELATIVE_PATH = 'agent/engines/opencode/runtime-lock.json';
export const DEFAULT_CACHE_BINARY_RELATIVE_PATH = 'agent/runtime/opencode-core/bin/darwin-arm64/opencode-1.17.11';
export const DEFAULT_CACHE_LICENSE_RELATIVE_PATH = 'agent/engines/opencode/LICENSE';

export const EXIT_CODES = Object.freeze({
  ok: 0,
  usage: 2,
  contract: 3,
  source: 4,
  verify: 5,
  io: 6,
});

export class RuntimeContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuntimeContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RuntimeContractError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, code, label) {
  if (!isPlainObject(value)) fail(code, `${label} must be an object`);
}

function assertExactKeys(value, allowed, code, label) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(code, `${label} contains unsupported field ${key}`);
  }
}

function assertString(value, code, label) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail(code, `${label} must be a non-empty trimmed string`);
  }
}

function assertInteger(value, code, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code, `${label} must be a positive safe integer`);
}

function assertSha256(value, code, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail(code, `${label} must be a lowercase SHA-256 hex digest`);
  }
}

/**
 * Lock paths are intentionally POSIX-style and relative so the same lock can
 * be reused by repository, dist, and package layouts on every host.
 */
export function validatePortableRelativePath(value, label = 'path') {
  assertString(value, 'LOCK_INVALID', label);
  if (
    path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.isAbsolute(value)
    || /^[a-zA-Z]:/.test(value)
    || value.includes('\\')
    || value.includes('\0')
  ) {
    fail('PATH_NOT_PORTABLE', `${label} must be a portable relative path`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    fail('PATH_NOT_PORTABLE', `${label} must not contain empty, dot, or parent segments`);
  }
  if (path.posix.normalize(value) !== value) fail('PATH_NOT_PORTABLE', `${label} is not normalized`);
  return value;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function realExistingAncestor(candidate) {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * Resolve a lock path below root and also reject an existing symlink that
 * escapes root. This protects the prepare destination before mkdir/copy.
 */
export function resolveContainedPath(root, relativePath, label = 'path') {
  const relative = validatePortableRelativePath(relativePath, label);
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...relative.split('/'));
  if (!isWithin(resolvedRoot, candidate)) fail('PATH_OUTSIDE_ROOT', `${label} escapes its root`);

  const rootForRealpath = fs.existsSync(resolvedRoot)
    ? fs.realpathSync.native(resolvedRoot)
    : resolvedRoot;
  const ancestor = realExistingAncestor(candidate);
  const realAncestor = fs.realpathSync.native(ancestor);
  if (!isWithin(rootForRealpath, realAncestor) && realAncestor !== rootForRealpath) {
    fail('PATH_OUTSIDE_ROOT', `${label} resolves outside its root`);
  }

  if (fs.existsSync(candidate)) {
    const realCandidate = fs.realpathSync.native(candidate);
    if (!isWithin(rootForRealpath, realCandidate)) fail('PATH_OUTSIDE_ROOT', `${label} resolves outside its root`);
  }
  return candidate;
}

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function inspectRegularFile(filePath, label = 'file') {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`${label.toUpperCase()}_MISSING`, `${label} is missing`);
    fail('IO_ERROR', `${label} could not be inspected`);
  }
  if (!stat.isFile()) fail(`${label.toUpperCase()}_NOT_REGULAR`, `${label} is not a regular file`);
  return { bytes: stat.size, sha256: sha256File(filePath) };
}

export function compareArtifactMetadata(actual, expected, label = 'BINARY') {
  if (actual.bytes !== expected.bytes) fail(`${label}_BYTES_MISMATCH`, `${label} byte count does not match`);
  if (actual.sha256 !== expected.sha256) fail(`${label}_SHA256_MISMATCH`, `${label} SHA-256 does not match`);
  return true;
}

export function normalizeVersionOutput(output) {
  return String(output).replace(/\r\n/g, '\n').replace(/\n+$/g, '');
}

export function validateRuntimeLock(lock) {
  assertPlainObject(lock, 'LOCK_INVALID', 'runtime lock');
  assertExactKeys(
    lock,
    [
      'schemaVersion',
      'storeSchemaVersion',
      'name',
      'upstreamVersion',
      'runtimeVersion',
      'sourceRef',
      'target',
      'patchCapabilities',
      'binary',
      'license',
    ],
    'LOCK_INVALID',
    'runtime lock',
  );
  if (lock.schemaVersion !== 1) fail('LOCK_SCHEMA_UNSUPPORTED', 'runtime lock schemaVersion must be 1');
  if (lock.storeSchemaVersion !== 1) fail('LOCK_SCHEMA_UNSUPPORTED', 'storeSchemaVersion must be 1');
  if (lock.name !== 'opencode-core') fail('LOCK_INVALID', 'runtime lock name must be opencode-core');
  for (const [key, label] of [
    ['upstreamVersion', 'upstreamVersion'],
    ['runtimeVersion', 'runtimeVersion'],
    ['sourceRef', 'sourceRef'],
    ['target', 'target'],
  ]) assertString(lock[key], 'LOCK_INVALID', label);
  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(lock.target)) fail('LOCK_INVALID', 'target must use platform-architecture form');
  if (!Array.isArray(lock.patchCapabilities) || lock.patchCapabilities.length === 0) {
    fail('LOCK_INVALID', 'patchCapabilities must be a non-empty array');
  }
  if (
    lock.patchCapabilities.some((capability) => typeof capability !== 'string' || capability.length === 0)
    || new Set(lock.patchCapabilities).size !== lock.patchCapabilities.length
    || !lock.patchCapabilities.includes('dynamic-tool-projection')
  ) {
    fail('LOCK_INVALID', 'dynamic-tool-projection must be a unique patch capability');
  }

  assertPlainObject(lock.binary, 'LOCK_INVALID', 'binary');
  assertExactKeys(lock.binary, ['cachePath', 'runtimePath', 'version', 'bytes', 'sha256'], 'LOCK_INVALID', 'binary');
  validatePortableRelativePath(lock.binary.cachePath, 'binary.cachePath');
  validatePortableRelativePath(lock.binary.runtimePath, 'binary.runtimePath');
  assertString(lock.binary.version, 'LOCK_INVALID', 'binary.version');
  assertInteger(lock.binary.bytes, 'LOCK_INVALID', 'binary.bytes');
  assertSha256(lock.binary.sha256, 'LOCK_INVALID', 'binary.sha256');

  assertPlainObject(lock.license, 'LOCK_INVALID', 'license');
  assertExactKeys(lock.license, ['cachePath', 'runtimePath', 'bytes', 'sha256'], 'LOCK_INVALID', 'license');
  validatePortableRelativePath(lock.license.cachePath, 'license.cachePath');
  validatePortableRelativePath(lock.license.runtimePath, 'license.runtimePath');
  assertInteger(lock.license.bytes, 'LOCK_INVALID', 'license.bytes');
  assertSha256(lock.license.sha256, 'LOCK_INVALID', 'license.sha256');

  if ('builtAt' in lock) fail('LOCK_FORBIDDEN_FIELD', 'runtime lock must not contain builtAt');
  return lock;
}

function readJsonLock(lockPath) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') fail('LOCK_MISSING', 'runtime lock is missing');
    fail('IO_ERROR', 'runtime lock could not be inspected');
  }
  if (!stat.isFile()) fail('LOCK_NOT_REGULAR', 'runtime lock is not a regular file');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    fail('LOCK_INVALID_JSON', 'runtime lock is not valid JSON');
  }
  return validateRuntimeLock(parsed);
}

function buildLayout({ mode, root, lockPath, lock, binaryPath, licensePath, licenseRequired }) {
  return Object.freeze({
    mode,
    root: path.resolve(root),
    lockPath,
    lock,
    binaryPath,
    licensePath,
    licenseRequired,
  });
}

export function resolveCacheLayout(repositoryRoot = REPOSITORY_ROOT) {
  const root = path.resolve(repositoryRoot);
  const lockPath = resolveContainedPath(root, LOCK_RELATIVE_PATH, 'runtime lock');
  const lock = readJsonLock(lockPath);
  const binaryPath = resolveContainedPath(root, lock.binary.cachePath, 'binary.cachePath');
  const licensePath = resolveContainedPath(root, lock.license.cachePath, 'license.cachePath');
  return buildLayout({ mode: 'cache', root, lockPath, lock, binaryPath, licensePath, licenseRequired: true });
}

function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveRootLayout(rootPath) {
  const root = path.resolve(rootPath);
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    if (error?.code === 'ENOENT') fail('ROOT_MISSING', 'runtime root is missing');
    fail('IO_ERROR', 'runtime root could not be inspected');
  }
  if (!rootStat.isDirectory()) fail('ROOT_NOT_DIRECTORY', 'runtime root is not a directory');

  const directLockPath = path.join(root, 'runtime-lock.json');
  if (isRegularFile(directLockPath)) {
    const lock = readJsonLock(directLockPath);
    const binaryPath = resolveContainedPath(root, lock.binary.runtimePath, 'binary.runtimePath');
    const licensePath = resolveContainedPath(root, lock.license.runtimePath, 'license.runtimePath');
    return buildLayout({ mode: 'root', root, lockPath: directLockPath, lock, binaryPath, licensePath, licenseRequired: false });
  }

  const nestedLockPath = resolveContainedPath(root, LOCK_RELATIVE_PATH, 'runtime lock');
  const lock = readJsonLock(nestedLockPath);
  const binaryPath = resolveContainedPath(root, lock.binary.cachePath, 'binary.cachePath');
  const licensePath = resolveContainedPath(root, lock.license.cachePath, 'license.cachePath');
  return buildLayout({ mode: 'repository-root', root, lockPath: nestedLockPath, lock, binaryPath, licensePath, licenseRequired: true });
}

export function verifyArtifact(filePath, expected, label, { optional = false } = {}) {
  if (optional && !fs.existsSync(filePath)) return { skipped: true };
  const actual = inspectRegularFile(filePath, label);
  compareArtifactMetadata(actual, expected, label.toUpperCase());
  return { skipped: false, ...actual };
}

export function verifyDarwinCodeSignature(filePath, target) {
  if (!String(target).startsWith('darwin-') || process.platform !== 'darwin') return { skipped: true };
  const result = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', filePath], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    fail('BINARY_SIGNATURE_INVALID', 'binary macOS code signature is invalid');
  }
  return { skipped: false };
}

export function inspectRuntimeCode(filePath, target) {
  if (!String(target).startsWith('darwin-') || process.platform !== 'darwin') {
    return inspectRegularFile(filePath, 'binary code');
  }
  verifyDarwinCodeSignature(filePath, target);
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'def-opencode-code-'));
  const unsignedPath = path.join(temporaryRoot, 'opencode');
  try {
    fs.copyFileSync(filePath, unsignedPath);
    const result = spawnSync('/usr/bin/codesign', ['--remove-signature', unsignedPath], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
      fail('BINARY_SIGNATURE_INVALID', 'binary macOS signature could not be normalized');
    }
    return inspectRegularFile(unsignedPath, 'binary code');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function parseCliArguments(argv, valueOptions = []) {
  const allowed = new Set(valueOptions);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      if (index !== argv.length - 1) fail('USAGE', '--help must be used alone');
      return { help: true, values };
    }
    if (!allowed.has(argument)) fail('USAGE', `unsupported option ${argument}`);
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) fail('USAGE', `${argument} requires a value`);
    if (Object.prototype.hasOwnProperty.call(values, argument)) fail('USAGE', `${argument} may only be supplied once`);
    values[argument] = argv[index + 1];
    index += 1;
  }
  return { help: false, values };
}

export function displayRelative(root, filePath) {
  return path.relative(path.resolve(root), path.resolve(filePath)).split(path.sep).join('/');
}

export function errorExitCode(error, fallback = EXIT_CODES.io) {
  if (error?.code === 'USAGE') return EXIT_CODES.usage;
  if (error?.code?.startsWith('LOCK_') || error?.code?.startsWith('PATH_') || error?.code?.startsWith('ROOT_')) {
    return EXIT_CODES.contract;
  }
  return fallback;
}

export function isMainModule(metaUrl = import.meta.url) {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(metaUrl));
}

export function runContractFixture() {
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'opencode-runtime-contract-'));
  try {
    const fixture = Buffer.from('small runtime fixture\n', 'utf8');
    const fixturePath = path.join(temporaryRoot, 'fixture.bin');
    fs.writeFileSync(fixturePath, fixture);
    const digest = sha256Buffer(fixture);
    const observed = inspectRegularFile(fixturePath, 'fixture');
    assertContract(observed.bytes === fixture.length, 'fixture byte count');
    assertContract(observed.sha256 === digest, 'fixture checksum');
    compareArtifactMetadata(observed, { bytes: fixture.length, sha256: digest }, 'FIXTURE');
    const parsedSource = parseCliArguments(['--source', 'fixture.bin'], ['--source']);
    assertContract(parsedSource.values['--source'] === 'fixture.bin', 'source option parsing');
    assertThrowsCode(() => parseCliArguments(['--source'], ['--source']), 'USAGE');
    assertThrowsCode(() => parseCliArguments(['--unknown', 'fixture.bin'], ['--source']), 'USAGE');

    const lock = validateRuntimeLock({
      schemaVersion: 1,
      storeSchemaVersion: 1,
      name: 'opencode-core',
      upstreamVersion: '1.17.11',
      runtimeVersion: '1.17.11-def.1',
      sourceRef: 'codex/example@deadbeef',
      target: 'darwin-arm64',
      patchCapabilities: ['dynamic-tool-projection'],
      binary: {
        cachePath: 'agent/runtime/opencode-core/bin/darwin-arm64/opencode-1.17.11',
        runtimePath: 'bin/darwin-arm64/opencode-1.17.11',
        version: '0.0.0-fixture',
        bytes: fixture.length,
        sha256: digest,
      },
      license: {
        cachePath: 'agent/engines/opencode/LICENSE',
        runtimePath: 'LICENSE',
        bytes: fixture.length,
        sha256: digest,
      },
    });
    assertContract(lock.binary.cachePath.startsWith('agent/runtime/'), 'cache path parsing');
    assertThrowsCode(() => validatePortableRelativePath('../escape', 'fixture path'), 'PATH_NOT_PORTABLE');
    assertThrowsCode(() => validatePortableRelativePath('/absolute', 'fixture path'), 'PATH_NOT_PORTABLE');
    assertThrowsCode(() => resolveContainedPath(temporaryRoot, '../escape', 'fixture path'), 'PATH_NOT_PORTABLE');
    const contained = resolveContainedPath(temporaryRoot, 'fixture.bin', 'fixture path');
    assertContract(contained === fixturePath, 'contained path resolution');
    const runtimeRoot = path.join(temporaryRoot, 'runtime-root');
    const runtimeBinary = path.join(runtimeRoot, ...lock.binary.runtimePath.split('/'));
    const runtimeLicense = path.join(runtimeRoot, ...lock.license.runtimePath.split('/'));
    fs.mkdirSync(path.dirname(runtimeBinary), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, 'runtime-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    fs.writeFileSync(runtimeBinary, fixture);
    fs.writeFileSync(runtimeLicense, fixture);
    const rootLayout = resolveRootLayout(runtimeRoot);
    assertContract(rootLayout.mode === 'root', 'runtime root layout');
    assertContract(rootLayout.binaryPath === runtimeBinary, 'runtime binary path');
    assertThrowsCode(() => compareArtifactMetadata(observed, { bytes: fixture.length + 1, sha256: digest }, 'FIXTURE'), 'FIXTURE_BYTES_MISMATCH');
    assertThrowsCode(() => validateRuntimeLock({ ...lock, builtAt: 'forbidden' }), 'LOCK_INVALID');
    return 'OPENCODE_RUNTIME_CONTRACT_OK';
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function assertContract(condition, label) {
  if (!condition) throw new Error(`contract assertion failed: ${label}`);
}

function assertThrowsCode(callback, expectedCode) {
  try {
    callback();
  } catch (error) {
    assertContract(error?.code === expectedCode, `expected ${expectedCode}, got ${error?.code || 'unknown'}`);
    return;
  }
  throw new Error(`contract assertion failed: expected ${expectedCode}`);
}

if (isMainModule()) {
  try {
    console.log(runContractFixture());
  } catch (error) {
    console.error(`OPENCODE_RUNTIME_CONTRACT_ERROR code=${error?.code || 'UNEXPECTED'}`);
    process.exitCode = EXIT_CODES.io;
  }
}
