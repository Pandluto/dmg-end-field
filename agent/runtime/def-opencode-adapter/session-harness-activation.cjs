const fs = require('fs');
const path = require('path');
const defHarness = require('../../harness/def-harness.cjs');
const { AGENT_RELEASE_KIND, AGENT_RELEASE_SCHEMA_VERSION } = require('./agent-release.cjs');

const DEF_EQUIPMENT_3PLUS1_HARNESS_ID = 'def-equipment-3plus1-composite';
const MAX_SESSION_BINDING_BYTES = 64 * 1024;
const CONTENT_HASH = /^[a-f0-9]{64}$/;
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_HARNESS_RUNTIME_ROOT = path.join(PROJECT_ROOT, '.runtime', 'def-harness');
const CHANNEL_SELECTOR = /^(?:stable|previousStable|candidate\/[a-z][a-z0-9-]{0,63})$/;

function isRegisteredHarnessBinding(harnessBinding, runtimeRoot) {
  const harness = harnessBinding.harness;
  const selector = harnessBinding.selector;
  const explicitSelector = `${harness.harnessId}@${harness.version}`;

  // Resolve without a last-known-stable fallback or loading every slot into an
  // artifact view. Activation needs the verified ref, not the Harness text.
  const explicit = defHarness.resolveSelector(runtimeRoot, explicitSelector);
  if (!defHarness.sameRef(explicit.ref, harness)) return false;

  if (selector === 'explicit') return true;
  if (!CHANNEL_SELECTOR.test(selector)) return false;
  const selected = defHarness.resolveSelector(runtimeRoot, selector);
  return defHarness.sameRef(selected.ref, harness);
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
    if (path.resolve(String(binding.directory || '')) !== expectedDirectory) return false;
  }

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
    && selector
    && harness?.harnessId === DEF_EQUIPMENT_3PLUS1_HARNESS_ID
    && typeof harness.version === 'string'
    && harness.version.trim()
    && CONTENT_HASH.test(String(harness.contentHash || ''))
    && Number(harness.schemaVersion) === defHarness.SCHEMA_VERSION
    && agentRelease?.kind === AGENT_RELEASE_KIND
    && Number(agentRelease.schemaVersion) === AGENT_RELEASE_SCHEMA_VERSION
    && releaseHarness?.selector === selector
    && Number(releaseHarness?.ref?.schemaVersion) === defHarness.SCHEMA_VERSION
    && defHarness.sameRef(releaseHarness?.ref, harness)
  );
  if (!structurallyValid) return false;

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
  try {
    const resolvedDirectory = path.resolve(directory);
    const target = path.join(resolvedDirectory, '.def-session.json');
    const stat = fileSystem.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_SESSION_BINDING_BYTES) return false;
    const binding = JSON.parse(fileSystem.readFileSync(target, 'utf8'));
    return isDefEquipment3Plus1HarnessBinding(binding, {
      directory: resolvedDirectory,
      sessionID,
      runtimeRoot: options.runtimeRoot,
    });
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_HARNESS_RUNTIME_ROOT,
  DEF_EQUIPMENT_3PLUS1_HARNESS_ID,
  isDefEquipment3Plus1HarnessBinding,
  readDefEquipment3Plus1HarnessActivation,
};
