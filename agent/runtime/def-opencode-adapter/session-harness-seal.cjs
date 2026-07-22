const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_HARNESS_SEAL_KIND = 'DefSessionHarnessIdentitySealV1';
const SESSION_HARNESS_SEAL_SCHEMA_VERSION = 1;
const SESSION_HARNESS_SEAL_KEY_ENV = 'DEF_SESSION_HARNESS_SEAL_KEY';
const SESSION_HARNESS_SEAL_KEY_BYTES = 32;
const SESSION_HARNESS_SEAL_KEY = /^[a-f0-9]{64}$/;
const SESSION_HARNESS_SEAL_VALUE = /^[a-f0-9]{64}$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeSealKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  return SESSION_HARNESS_SEAL_KEY.test(key) ? key : '';
}

function readPersistentSessionHarnessSealKey(keyFile, fileSystem = fs) {
  const target = path.resolve(keyFile);
  const stat = fileSystem.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 256) {
    throw new Error('DEF Session Harness seal key is not a safe regular file.');
  }
  const key = normalizeSealKey(fileSystem.readFileSync(target, 'utf8'));
  if (!key) throw new Error('DEF Session Harness seal key is invalid.');
  return key;
}

function ensurePersistentSessionHarnessSealKey(keyFile, fileSystem = fs) {
  const target = path.resolve(keyFile);
  try {
    return readPersistentSessionHarnessSealKey(target, fileSystem);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  fileSystem.mkdirSync(path.dirname(target), { recursive: true });
  const generated = crypto.randomBytes(SESSION_HARNESS_SEAL_KEY_BYTES).toString('hex');
  let descriptor;
  try {
    descriptor = fileSystem.openSync(target, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, `${generated}\n`, 'utf8');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
  return readPersistentSessionHarnessSealKey(target, fileSystem);
}

function sessionHarnessIdentity(binding) {
  const sessionSchemaVersion = binding?.schemaVersion;
  const sessionID = typeof binding?.sessionID === 'string' ? binding.sessionID.trim() : '';
  const directory = typeof binding?.directory === 'string' && binding.directory.trim()
    ? path.resolve(binding.directory)
    : '';
  const host = typeof binding?.host === 'string' ? binding.host : '';
  const skillId = typeof binding?.skillId === 'string' ? binding.skillId : '';
  const agent = typeof binding?.agent === 'string' ? binding.agent : '';
  const axisBindingId = typeof binding?.axisBindingId === 'string' ? binding.axisBindingId : '';
  const timelineId = binding?.timelineId === undefined
    ? null
    : typeof binding.timelineId === 'string'
      ? binding.timelineId
      : undefined;
  const harnessBinding = binding?.harnessBinding;
  const releaseHarness = binding?.agentRelease?.harness;
  if (!Number.isInteger(sessionSchemaVersion)
    || !sessionID
    || !directory
    || !['workbench', 'ai-cli'].includes(host)
    || !skillId
    || skillId !== skillId.trim()
    || !agent
    || agent !== agent.trim()
    || !axisBindingId
    || axisBindingId !== axisBindingId.trim()
    || timelineId === undefined
    || typeof timelineId === 'string' && (!timelineId || timelineId !== timelineId.trim())
    || !harnessBinding
    || !releaseHarness) return null;
  if (typeof releaseHarness.selector !== 'string' || !releaseHarness.ref) return null;
  return {
    kind: 'DefSessionHarnessIdentityV1',
    schemaVersion: 1,
    session: {
      schemaVersion: sessionSchemaVersion,
      sessionID,
      directory,
      host,
      skillId,
      agent,
      axisBindingId,
      timelineId,
    },
    harnessBinding,
    agentReleaseHarness: {
      selector: releaseHarness.selector,
      ref: releaseHarness.ref,
    },
  };
}

function sessionHarnessSealValue(binding, sealKey) {
  const key = normalizeSealKey(sealKey);
  const identity = sessionHarnessIdentity(binding);
  if (!key || !identity) return '';
  return crypto.createHmac('sha256', Buffer.from(key, 'hex'))
    .update(stableJson(identity))
    .digest('hex');
}

function createSessionHarnessSeal(binding, sealKey) {
  const value = sessionHarnessSealValue(binding, sealKey);
  if (!value) throw new Error('Cannot seal an incomplete DEF Session Harness identity.');
  return Object.freeze({
    kind: SESSION_HARNESS_SEAL_KIND,
    schemaVersion: SESSION_HARNESS_SEAL_SCHEMA_VERSION,
    algorithm: 'hmac-sha256',
    value,
  });
}

function sameSessionHarnessIdentity(left, right) {
  const leftIdentity = sessionHarnessIdentity(left);
  const rightIdentity = sessionHarnessIdentity(right);
  return Boolean(leftIdentity && rightIdentity && stableJson(leftIdentity) === stableJson(rightIdentity));
}

function verifySessionHarnessSeal(binding, sealKey) {
  const seal = binding?.harnessIdentitySeal;
  if (seal?.kind !== SESSION_HARNESS_SEAL_KIND
    || Number(seal.schemaVersion) !== SESSION_HARNESS_SEAL_SCHEMA_VERSION
    || seal.algorithm !== 'hmac-sha256'
    || !SESSION_HARNESS_SEAL_VALUE.test(String(seal.value || ''))) return false;
  const expected = sessionHarnessSealValue(binding, sealKey);
  if (!expected) return false;
  const actualBuffer = Buffer.from(seal.value, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

module.exports = {
  SESSION_HARNESS_SEAL_KEY_ENV,
  SESSION_HARNESS_SEAL_KIND,
  SESSION_HARNESS_SEAL_SCHEMA_VERSION,
  createSessionHarnessSeal,
  ensurePersistentSessionHarnessSealKey,
  normalizeSealKey,
  readPersistentSessionHarnessSealKey,
  sameSessionHarnessIdentity,
  sessionHarnessIdentity,
  verifySessionHarnessSeal,
};
