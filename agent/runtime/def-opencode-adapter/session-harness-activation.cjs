const fs = require('fs');
const path = require('path');

const DEF_EQUIPMENT_3PLUS1_HARNESS_ID = 'def-equipment-3plus1-composite';
const MAX_SESSION_BINDING_BYTES = 64 * 1024;
const CONTENT_HASH = /^[a-f0-9]{64}$/;

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
  return Boolean(
    harnessBinding?.kind === 'DefHarnessSessionBindingV1'
    && Number(harnessBinding.schemaVersion) === 1
    && harnessBinding.sessionId === sessionID
    && typeof harnessBinding.selector === 'string'
    && harnessBinding.selector.trim()
    && harness?.harnessId === DEF_EQUIPMENT_3PLUS1_HARNESS_ID
    && typeof harness.version === 'string'
    && harness.version.trim()
    && CONTENT_HASH.test(String(harness.contentHash || ''))
    && Number(harness.schemaVersion) === 1
  );
}

function readDefEquipment3Plus1HarnessActivation(directory, sessionID, fileSystem = fs) {
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
    });
  } catch {
    return false;
  }
}

module.exports = {
  DEF_EQUIPMENT_3PLUS1_HARNESS_ID,
  isDefEquipment3Plus1HarnessBinding,
  readDefEquipment3Plus1HarnessActivation,
};
