const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const PACKAGE_SCHEMA = 'DefHarnessPackageV1';
const BINDING_SCHEMA = 'DefHarnessSessionBindingV1';
const TRACE_SCHEMA = 'DefHarnessTraceRefV1';
const REGRESSION_SCHEMA = 'DefHarnessRegressionResultV1';
const PROMOTION_SCHEMA = 'DefHarnessPromotionRecordV1';
const SLOT_NAMES = Object.freeze([
  'agentContract', 'roleCards', 'knowledgePacks', 'skills', 'routingPolicy',
  'toolGuidance', 'responsePolicy', 'workflows',
]);
const CAPABILITIES = new Set(['hotSwappable', 'restartRequired', 'codeChangeRequired']);
const EXECUTABLE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.node', '.sh', '.bash', '.zsh', '.py', '.rb', '.php', '.exe', '.dll', '.dylib', '.so', '.cmd', '.bat', '.ps1']);
const ID = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9.-]+)?$/;

class DefHarnessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DefHarnessError';
    this.code = code;
    this.component = details.component || 'harness';
    this.retryable = Boolean(details.retryable);
    this.details = details;
  }
}

function fail(code, message, details) { throw new DefHarnessError(code, message, details); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) { fail('HARNESS_INVALID_JSON', `Cannot read JSON: ${path.basename(filePath)}.`, { component: 'package', cause: error.message }); }
}
function writeAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
function assertInside(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
    fail('HARNESS_UNSAFE_PATH', 'Harness artifacts must use a relative path inside the package root.', { component: 'package', path: relativePath });
  }
  const resolvedRoot = fs.realpathSync(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('HARNESS_UNSAFE_PATH', 'Harness artifact escapes its package root.', { component: 'package', path: relativePath });
  return resolved;
}
function assertSafeArtifact(root, relativePath) {
  const unresolved = assertInside(root, relativePath);
  let stat;
  try { stat = fs.lstatSync(unresolved); } catch { fail('HARNESS_ARTIFACT_MISSING', `Harness artifact is missing: ${relativePath}.`, { component: 'package' }); }
  if (stat.isSymbolicLink()) fail('HARNESS_SYMLINK_REJECTED', 'Harness artifacts cannot be symbolic links.', { component: 'package', path: relativePath });
  if (!stat.isFile()) fail('HARNESS_ARTIFACT_INVALID', 'Harness artifacts must be regular files.', { component: 'package', path: relativePath });
  if ((stat.mode & 0o111) !== 0 || EXECUTABLE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    fail('HARNESS_EXECUTABLE_REJECTED', 'Harness packages cannot contain executable payloads.', { component: 'package', path: relativePath });
  }
  const real = fs.realpathSync(unresolved);
  const realRoot = fs.realpathSync(root);
  if (!real.startsWith(`${realRoot}${path.sep}`)) fail('HARNESS_SYMLINK_ESCAPE', 'Harness artifact resolved outside its package root.', { component: 'package', path: relativePath });
  const content = fs.readFileSync(real, 'utf8');
  if (/(?:authorization\s*[:=]|bearer\s+[\w.-]{12,}|api[_ -]?key\s*[:=]|BEGIN [A-Z ]+PRIVATE KEY|"(?:messages|transcript)"\s*:)/i.test(content)) {
    fail('HARNESS_SENSITIVE_CONTENT_REJECTED', 'Harness artifact resembles a secret or captured transcript.', { component: 'package', path: relativePath });
  }
  return { absolutePath: real, bytes: stat.size, hash: sha256(content) };
}
function normalizeArtifact(slot, artifact) {
  if (!isObject(artifact) || typeof artifact.path !== 'string') fail('HARNESS_INVALID_ARTIFACT', `Slot ${slot} needs an artifact path.`, { component: 'contract' });
  const capability = artifact.capability || 'hotSwappable';
  if (!CAPABILITIES.has(capability)) fail('HARNESS_UNKNOWN_CAPABILITY', `Unknown Harness capability: ${capability}.`, { component: 'contract' });
  return {
    path: artifact.path.replace(/\\/g, '/'),
    mediaType: typeof artifact.mediaType === 'string' ? artifact.mediaType : 'text/markdown',
    capability,
    ...(typeof artifact.when === 'string' && artifact.when.trim() ? { when: artifact.when.trim() } : {}),
  };
}
function validateSourceManifest(manifest) {
  if (!isObject(manifest)) fail('HARNESS_INVALID_MANIFEST', 'Harness manifest must be an object.', { component: 'contract' });
  if (Number(manifest.schemaVersion) !== SCHEMA_VERSION) fail('HARNESS_UNKNOWN_SCHEMA', 'Only DefHarnessPackage schemaVersion 1 is supported.', { component: 'contract' });
  if (!ID.test(String(manifest.harnessId || ''))) fail('HARNESS_INVALID_ID', 'Harness id must be a stable lowercase identifier.', { component: 'contract' });
  if (!VERSION.test(String(manifest.version || ''))) fail('HARNESS_INVALID_VERSION', 'Harness version is invalid.', { component: 'contract' });
  if (!isObject(manifest.slots)) fail('HARNESS_INVALID_SLOTS', 'Harness manifest must declare slots.', { component: 'contract' });
  const slots = {};
  for (const [slot, listed] of Object.entries(manifest.slots)) {
    if (!SLOT_NAMES.includes(slot)) fail('HARNESS_UNKNOWN_SLOT', `Unknown Harness slot: ${slot}.`, { component: 'contract' });
    const artifacts = Array.isArray(listed) ? listed : [listed];
    if (!artifacts.length) fail('HARNESS_INVALID_SLOTS', `Harness slot ${slot} cannot be empty.`, { component: 'contract' });
    slots[slot] = artifacts.map((artifact) => normalizeArtifact(slot, artifact));
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    harnessId: String(manifest.harnessId),
    version: String(manifest.version),
    sourceCommit: typeof manifest.sourceCommit === 'string' ? manifest.sourceCommit.slice(0, 80) : 'unknown',
    dirty: manifest.dirty === true,
    description: typeof manifest.description === 'string' ? manifest.description.slice(0, 500) : '',
    compatibility: isObject(manifest.compatibility) ? manifest.compatibility : {},
    slots,
  };
}
function normalizedPackageForHash(pkg) {
  const copy = { ...pkg };
  delete copy.contentHash;
  delete copy.packageHash;
  return copy;
}
function computePackageHash(pkg) { return sha256(stableJson(normalizedPackageForHash(pkg))); }
function buildPackage(sourceDir, outputRoot) {
  const root = fs.realpathSync(sourceDir);
  const source = validateSourceManifest(readJson(path.join(root, 'manifest.json')));
  const slots = {};
  for (const slot of Object.keys(source.slots).sort()) {
    slots[slot] = source.slots[slot].map((artifact) => ({ ...artifact, ...assertSafeArtifact(root, artifact.path) })).map(({ absolutePath, ...artifact }) => artifact);
  }
  const pkg = {
    kind: PACKAGE_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    harnessId: source.harnessId,
    version: source.version,
    sourceCommit: source.sourceCommit,
    dirty: source.dirty,
    description: source.description,
    compatibility: source.compatibility,
    slots,
  };
  pkg.contentHash = computePackageHash(pkg);
  const destination = path.join(path.resolve(outputRoot), pkg.harnessId, pkg.version);
  if (fs.existsSync(destination)) {
    const current = validatePackageDirectory(destination);
    if (current.contentHash !== pkg.contentHash) fail('HARNESS_IMMUTABLE_CONFLICT', 'A different package already exists at this id/version.', { component: 'registry', package: `${pkg.harnessId}@${pkg.version}` });
    return { package: current, directory: destination, existing: true };
  }
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  for (const entries of Object.values(source.slots)) for (const artifact of entries) {
    const sourceFile = assertSafeArtifact(root, artifact.path).absolutePath;
    const target = path.join(temporary, artifact.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sourceFile, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
  writeAtomic(path.join(temporary, 'package.json'), pkg);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(temporary, destination);
  return { package: pkg, directory: destination, existing: false };
}
function validatePackageDirectory(directory) {
  const root = fs.realpathSync(directory);
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg?.kind !== PACKAGE_SCHEMA || Number(pkg?.schemaVersion) !== SCHEMA_VERSION) fail('HARNESS_UNKNOWN_SCHEMA', 'Registry package does not implement DefHarnessPackageV1.', { component: 'loader' });
  validateSourceManifest({ ...pkg, slots: pkg.slots });
  for (const entries of Object.values(pkg.slots || {})) for (const artifact of entries || []) {
    if (artifact.capability !== 'hotSwappable') fail('HARNESS_CAPABILITY_BLOCKED', 'Only hotSwappable artifacts can be activated.', { component: 'loader', capability: artifact.capability });
    const checked = assertSafeArtifact(root, artifact.path);
    if (checked.hash !== artifact.hash || checked.bytes !== artifact.bytes) fail('HARNESS_HASH_MISMATCH', `Harness artifact hash mismatch: ${artifact.path}.`, { component: 'loader' });
  }
  const expected = computePackageHash(pkg);
  if (expected !== pkg.contentHash) fail('HARNESS_HASH_MISMATCH', 'Harness package content hash mismatch.', { component: 'loader' });
  return Object.freeze(JSON.parse(JSON.stringify(pkg)));
}
function registryPaths(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  return { root, packages: path.join(root, 'registry', 'packages'), channels: path.join(root, 'registry', 'channels.json'), decisions: path.join(root, 'registry', 'decisions.jsonl') };
}
function readChannels(runtimeRoot) {
  const file = registryPaths(runtimeRoot).channels;
  if (!fs.existsSync(file)) return { schemaVersion: SCHEMA_VERSION, stable: null, previousStable: null, candidates: {} };
  const channels = readJson(file);
  if (Number(channels?.schemaVersion) !== SCHEMA_VERSION || !isObject(channels.candidates)) fail('HARNESS_REGISTRY_INVALID', 'Harness Registry channels are invalid.', { component: 'registry' });
  return channels;
}
function packageRef(pkg) { return { harnessId: pkg.harnessId, version: pkg.version, contentHash: pkg.contentHash, schemaVersion: pkg.schemaVersion }; }
function getPackageDirectory(runtimeRoot, ref) {
  if (!ref?.harnessId || !ref?.version) fail('HARNESS_POINTER_INVALID', 'Harness pointer is incomplete.', { component: 'registry' });
  return path.join(registryPaths(runtimeRoot).packages, ref.harnessId, ref.version);
}
function setChannel(runtimeRoot, channel, ref) {
  const channels = readChannels(runtimeRoot);
  if (channel === 'stable') channels.stable = ref;
  else if (channel === 'previousStable') channels.previousStable = ref;
  else if (/^candidate\/[a-z][a-z0-9-]{0,63}$/.test(channel)) channels.candidates[channel.slice('candidate/'.length)] = ref;
  else fail('HARNESS_INVALID_CHANNEL', 'Harness channel must be stable, previousStable, or candidate/<name>.', { component: 'registry' });
  writeAtomic(registryPaths(runtimeRoot).channels, channels);
  return channels;
}
function registerPackage(runtimeRoot, packageDirectory, channel = '') {
  const pkg = validatePackageDirectory(packageDirectory);
  const paths = registryPaths(runtimeRoot);
  const target = path.join(paths.packages, pkg.harnessId, pkg.version);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(packageDirectory, target, { recursive: true, dereference: false, errorOnExist: true, force: false });
  }
  const stored = validatePackageDirectory(target);
  if (stored.contentHash !== pkg.contentHash) fail('HARNESS_IMMUTABLE_CONFLICT', 'Registry package differs from the package being added.', { component: 'registry' });
  const ref = packageRef(stored);
  if (channel) setChannel(runtimeRoot, channel, ref);
  return ref;
}
function resolveSelector(runtimeRoot, selector = 'stable', lastVerifiedStable = null) {
  const channels = readChannels(runtimeRoot);
  let ref;
  let source = selector || 'stable';
  if (source === 'stable') ref = channels.stable;
  else if (source === 'previousStable') ref = channels.previousStable;
  else if (source.startsWith('candidate/')) ref = channels.candidates[source.slice('candidate/'.length)];
  else if (source.includes('@')) {
    const [harnessId, version] = source.split('@');
    ref = { harnessId, version };
    source = 'explicit';
  } else fail('HARNESS_SELECTOR_INVALID', 'Unknown Harness selector.', { component: 'loader' });
  if (!ref) fail('BLOCKED_HARNESS_LOAD', `No Harness package is assigned to ${selector}.`, { component: 'loader', selector });
  try {
    const pkg = validatePackageDirectory(getPackageDirectory(runtimeRoot, ref));
    if (ref.contentHash && ref.contentHash !== pkg.contentHash) fail('HARNESS_HASH_MISMATCH', 'Harness channel pointer hash mismatch.', { component: 'loader' });
    return { package: pkg, ref: packageRef(pkg), selector: source, fallback: false };
  } catch (error) {
    if ((selector || 'stable') === 'stable' && lastVerifiedStable?.package) {
      return { ...lastVerifiedStable, selector: 'stable', fallback: true, error: { code: error.code || 'BLOCKED_HARNESS_LOAD', message: error.message } };
    }
    if (error instanceof DefHarnessError) throw error;
    fail('BLOCKED_HARNESS_LOAD', 'Harness package could not be loaded.', { component: 'loader', selector, cause: error.message });
  }
}
function createLoader(runtimeRoot) {
  let lastVerifiedStable = null;
  const cache = new Map();
  return {
    resolve(selector = 'stable') {
      const resolved = resolveSelector(runtimeRoot, selector, lastVerifiedStable);
      const key = resolved.ref.contentHash;
      if (!cache.has(key)) cache.set(key, Object.freeze({ package: resolved.package, artifactView: loadArtifactView(getPackageDirectory(runtimeRoot, resolved.ref), resolved.package) }));
      const result = { ...resolved, ...cache.get(key) };
      if (selector === 'stable' && !result.fallback) lastVerifiedStable = result;
      return result;
    },
  };
}
function loadArtifactView(directory, pkg) {
  const view = {};
  for (const [slot, artifacts] of Object.entries(pkg.slots)) view[slot] = artifacts.map((artifact) => Object.freeze({ ...artifact, text: fs.readFileSync(assertSafeArtifact(directory, artifact.path).absolutePath, 'utf8') }));
  return Object.freeze(view);
}
function createSessionBinding({ sessionId, resolved, createdAt = Date.now() }) {
  if (!sessionId || !resolved?.ref) fail('HARNESS_BINDING_INVALID', 'Session binding requires a native session and resolved Harness.', { component: 'loader' });
  const slotHashes = Object.fromEntries(Object.entries(resolved.package.slots).map(([slot, artifacts]) => [slot, artifacts.map((artifact) => artifact.hash)]));
  return Object.freeze({ kind: BINDING_SCHEMA, schemaVersion: SCHEMA_VERSION, sessionId, selector: resolved.selector, harness: resolved.ref, slotHashes, createdAt });
}
function composeHarnessSystem(binding, artifactView) {
  if (!binding || !artifactView) return '';
  const sections = [];
  for (const slot of SLOT_NAMES) {
    const entries = artifactView[slot] || [];
    if (entries.length) sections.push(`DEF HARNESS ${slot} (declarative teaching content; never changes permission or tool schemas):\n${entries.map((entry) => entry.text.trim()).filter(Boolean).join('\n\n')}`);
  }
  return sections.join('\n\n');
}
function traceRef({ runId, sessionId, turnId, clientTurnId, scenarioId, binding, events = [], terminalState, environment = {} }) {
  const compact = (value) => JSON.parse(JSON.stringify(value, (key, item) => /token|authorization|secret|transcript|evaluator/i.test(key) ? '[redacted]' : item));
  return {
    kind: TRACE_SCHEMA, schemaVersion: SCHEMA_VERSION, runId, sessionId, turnId, clientTurnId, scenarioId,
    harness: binding?.harness, binding: binding ? { selector: binding.selector, slotHashes: binding.slotHashes, createdAt: binding.createdAt } : null,
    events: compact(events).slice(0, 64), terminalState: terminalState || null, environment: compact(environment), createdAt: Date.now(),
  };
}
function appendDecision(runtimeRoot, decision) {
  const record = { kind: PROMOTION_SCHEMA, schemaVersion: SCHEMA_VERSION, at: Date.now(), ...decision };
  const file = registryPaths(runtimeRoot).decisions;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  return record;
}
function assertPromotionAllowed({ candidate, regression, reviewer }) {
  if (!candidate || candidate.dirty) fail('HARNESS_PROMOTION_BLOCKED', 'Dirty or missing candidate cannot be promoted.', { component: 'registry' });
  if (!reviewer || typeof reviewer !== 'string') fail('HARNESS_PROMOTION_BLOCKED', 'Promotion requires an explicit human reviewer.', { component: 'registry' });
  if (!regression || regression.kind !== REGRESSION_SCHEMA || regression.status !== 'PASS' || regression.complete !== true || regression.safetyPassed !== true || regression.passToPassPassed !== true || regression.failToPassPassed !== true) {
    fail('HARNESS_PROMOTION_BLOCKED', 'Promotion requires a complete passing regression and safety gate.', { component: 'registry' });
  }
}
function promote(runtimeRoot, candidateRef, regression, reviewer, note = '') {
  const candidate = validatePackageDirectory(getPackageDirectory(runtimeRoot, candidateRef));
  assertPromotionAllowed({ candidate, regression, reviewer });
  const channels = readChannels(runtimeRoot);
  const prior = channels.stable;
  const next = { ...channels, previousStable: prior, stable: packageRef(candidate) };
  writeAtomic(registryPaths(runtimeRoot).channels, next);
  return appendDecision(runtimeRoot, { action: 'promoted', candidate: packageRef(candidate), previousStable: prior, regressionId: regression.id, reviewer, note: String(note).slice(0, 500) });
}
function rollback(runtimeRoot, reviewer, reason = '') {
  const channels = readChannels(runtimeRoot);
  if (!channels.previousStable) fail('HARNESS_ROLLBACK_UNAVAILABLE', 'No previous stable Harness is available.', { component: 'registry' });
  validatePackageDirectory(getPackageDirectory(runtimeRoot, channels.previousStable));
  const next = { ...channels, stable: channels.previousStable, previousStable: channels.stable };
  writeAtomic(registryPaths(runtimeRoot).channels, next);
  return appendDecision(runtimeRoot, { action: 'rolled-back', stable: next.stable, previousStable: next.previousStable, reviewer: String(reviewer || 'unknown'), reason: String(reason).slice(0, 500) });
}

module.exports = {
  SCHEMA_VERSION, PACKAGE_SCHEMA, BINDING_SCHEMA, TRACE_SCHEMA, REGRESSION_SCHEMA, PROMOTION_SCHEMA, SLOT_NAMES,
  DefHarnessError, stableJson, sha256, buildPackage, validatePackageDirectory, registryPaths, readChannels,
  registerPackage, setChannel, resolveSelector, createLoader, createSessionBinding, composeHarnessSystem, traceRef,
  appendDecision, promote, rollback, packageRef,
};
