const fs = require('fs');
const path = require('path');
const defHarness = require('../../harness/def-harness.cjs');
const { AGENT_RELEASE_KIND, AGENT_RELEASE_SCHEMA_VERSION } = require('./agent-release.cjs');
const {
  matchesManagedSessionDirectoryBinding,
  readManagedSessionBindingTargetIdentity,
  readManagedSessionDirectoryIdentity,
  sameManagedPath,
  sameManagedSessionBindingFileStat,
  sameManagedSessionBindingTargetIdentity,
  sameManagedSessionDirectoryIdentity,
} = require('./managed-session-directory.cjs');
const {
  SESSION_HARNESS_SEAL_KEY_ENV,
  verifySessionHarnessSeal,
} = require('./session-harness-seal.cjs');

const DEF_EQUIPMENT_3PLUS1_HARNESS_ID = 'def-equipment-3plus1-composite';
const MAX_SESSION_BINDING_BYTES = 64 * 1024;
const CONTENT_HASH = /^[a-f0-9]{64}$/;
const HARNESS_VERSION = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-z0-9.-]+)?$/;
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_HARNESS_RUNTIME_ROOT = path.join(PROJECT_ROOT, '.runtime', 'def-harness');
const CHANNEL_SELECTOR = /^(?:stable|previousStable|candidate\/[a-z][a-z0-9-]{0,63})$/;
const registeredHarnessVerificationCache = new Map();
const activationStats = {
  bindingReads: 0,
  registryCacheHits: 0,
  registryValidations: 0,
};

function sameSessionBindingFile(left, right) {
  return Boolean(left && right
    && right.isFile()
    && (process.platform === 'win32' || left.dev === right.dev)
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs);
}

function isRegisteredHarnessBinding(harnessBinding, runtimeRoot) {
  const harness = harnessBinding.harness;
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const cacheKey = `${resolvedRuntimeRoot}\0${harness.harnessId}@${harness.version}\0${harness.contentHash}`;
  if (registeredHarnessVerificationCache.has(cacheKey)) {
    activationStats.registryCacheHits += 1;
    return true;
  }

  // A selector is creation-time provenance. Promotion and rollback must not
  // change an existing Session, so only its sealed immutable ref is resolved.
  activationStats.registryValidations += 1;
  const packageDirectory = path.join(
    defHarness.registryPaths(resolvedRuntimeRoot).packages,
    harness.harnessId,
    harness.version,
  );
  const registered = defHarness.validatePackageDirectory(packageDirectory);
  if (!defHarness.sameRef(defHarness.packageRef(registered), harness)) return false;
  registeredHarnessVerificationCache.set(cacheKey, true);
  return true;
}

function clearRegisteredHarnessVerificationCache() {
  registeredHarnessVerificationCache.clear();
  activationStats.bindingReads = 0;
  activationStats.registryCacheHits = 0;
  activationStats.registryValidations = 0;
}

function getSessionHarnessActivationStats() {
  return Object.freeze({
    ...activationStats,
    registryCacheEntries: registeredHarnessVerificationCache.size,
  });
}

function isDefEquipment3Plus1HarnessBinding(binding, options = {}) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return false;
  if (Number(binding.schemaVersion) !== 5) return false;

  const sessionID = typeof options.sessionID === 'string' && options.sessionID.trim()
    ? options.sessionID.trim()
    : String(binding.sessionID || '').trim();
  if (!sessionID || binding.sessionID !== sessionID) return false;

  if (options.directory) {
    const expectedDirectory = path.resolve(options.directory);
    if (!sameManagedPath(String(binding.directory || ''), expectedDirectory)) return false;
  }
  if (options.managedDirectoryIdentity
    && !matchesManagedSessionDirectoryBinding(
      binding.managedDirectoryIdentity,
      options.managedDirectoryIdentity,
    )) return false;

  const harnessBinding = binding.harnessBinding;
  const harness = harnessBinding?.harness;
  const selector = harnessBinding?.selector;
  const agentRelease = binding.agentRelease;
  const releaseHarness = agentRelease?.harness;
  const structurallyValid = Boolean(
    harnessBinding?.kind === defHarness.BINDING_SCHEMA
    && Number(harnessBinding.schemaVersion) === defHarness.SCHEMA_VERSION
    && harnessBinding.sessionId === sessionID
    && typeof selector === 'string'
    && selector === selector.trim()
    && (selector === 'explicit' || CHANNEL_SELECTOR.test(selector))
    && harness?.harnessId === DEF_EQUIPMENT_3PLUS1_HARNESS_ID
    && typeof harness.version === 'string'
    && HARNESS_VERSION.test(harness.version)
    && CONTENT_HASH.test(String(harness.contentHash || ''))
    && Number(harness.schemaVersion) === defHarness.SCHEMA_VERSION
    && agentRelease?.kind === AGENT_RELEASE_KIND
    && Number(agentRelease.schemaVersion) === AGENT_RELEASE_SCHEMA_VERSION
    && releaseHarness?.selector === selector
    && Number(releaseHarness?.ref?.schemaVersion) === defHarness.SCHEMA_VERSION
    && defHarness.sameRef(releaseHarness?.ref, harness)
  );
  if (!structurallyValid) return false;
  const sealKey = options.sealKey === undefined
    ? process.env[SESSION_HARNESS_SEAL_KEY_ENV]
    : options.sealKey;
  if (!verifySessionHarnessSeal(binding, sealKey)) return false;

  try {
    const runtimeRoot = path.resolve(options.runtimeRoot || DEFAULT_HARNESS_RUNTIME_ROOT);
    return isRegisteredHarnessBinding(harnessBinding, runtimeRoot);
  } catch {
    return false;
  }
}

function readDefEquipment3Plus1HarnessActivation(directory, sessionID, fileSystem = fs, options = {}) {
  if (typeof directory !== 'string' || !directory.trim()) return false;
  if (typeof sessionID !== 'string' || !sessionID.trim()) return false;
  activationStats.bindingReads += 1;
  let descriptor;
  try {
    const directoryBefore = readManagedSessionDirectoryIdentity(directory, {
      workspaceDirectory: options.agentWorkspaceDirectory,
    });
    if (!directoryBefore) return false;
    const resolvedDirectory = directoryBefore.directory;
    const targetBefore = readManagedSessionBindingTargetIdentity(directoryBefore);
    if (!targetBefore?.exists) return false;
    const target = targetBefore.target;
    const stat = fileSystem.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_SESSION_BINDING_BYTES) return false;
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    descriptor = fileSystem.openSync(target, fs.constants.O_RDONLY | noFollow);
    const openedStat = fileSystem.fstatSync(descriptor);
    if (!sameSessionBindingFile(stat, openedStat)
      || !sameManagedSessionBindingFileStat(targetBefore, openedStat)) return false;
    const binding = JSON.parse(fileSystem.readFileSync(descriptor, 'utf8'));
    if (!sameSessionBindingFile(openedStat, fileSystem.fstatSync(descriptor))) return false;
    const directoryAfter = readManagedSessionDirectoryIdentity(directory, {
      workspaceDirectory: options.agentWorkspaceDirectory,
    });
    const targetAfter = directoryAfter
      ? readManagedSessionBindingTargetIdentity(directoryAfter)
      : null;
    if (!sameManagedSessionDirectoryIdentity(directoryBefore, directoryAfter)
      || !sameManagedSessionBindingTargetIdentity(targetBefore, targetAfter)) return false;
    return isDefEquipment3Plus1HarnessBinding(binding, {
      directory: resolvedDirectory,
      sessionID,
      runtimeRoot: options.runtimeRoot,
      sealKey: options.sealKey,
      managedDirectoryIdentity: directoryAfter,
    });
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
}

module.exports = {
  DEFAULT_HARNESS_RUNTIME_ROOT,
  DEF_EQUIPMENT_3PLUS1_HARNESS_ID,
  clearRegisteredHarnessVerificationCache,
  getSessionHarnessActivationStats,
  isDefEquipment3Plus1HarnessBinding,
  readDefEquipment3Plus1HarnessActivation,
};
