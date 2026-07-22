const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_HARNESS_SEAL_KIND = 'DefSessionHarnessIdentitySealV1';
const SESSION_HARNESS_SEAL_SCHEMA_VERSION = 1;
const SESSION_HARNESS_SEAL_KEY_ENV = 'DEF_SESSION_HARNESS_SEAL_KEY';
const SESSION_HARNESS_SEAL_KEY_BYTES = 32;
const SESSION_HARNESS_SEAL_KEY_FILE_MAX_BYTES = 256;
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

function samePersistentSessionHarnessSealKeyFile(left, right) {
  return Boolean(left && right
    && right.isFile()
    // Windows reports lstat().dev as 0 while fstat().dev carries the volume id.
    && (process.platform === 'win32' || left.dev === right.dev)
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs);
}

function persistentSessionHarnessSealKeySignature(stat, rawKeyFile) {
  const contentHash = crypto.createHash('sha256').update(rawKeyFile).digest('hex');
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode, contentHash].join(':');
}

function readPersistentSessionHarnessSealKeyRecord(keyFile, fileSystem = fs) {
  const target = path.resolve(keyFile);
  const linkStat = fileSystem.lstatSync(target);
  if (!linkStat.isFile()
    || linkStat.isSymbolicLink()
    || linkStat.size <= 0
    || linkStat.size > SESSION_HARNESS_SEAL_KEY_FILE_MAX_BYTES) {
    throw new Error('DEF Session Harness seal key is not a safe regular file.');
  }

  let descriptor;
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    descriptor = fileSystem.openSync(target, fs.constants.O_RDONLY | noFollow);
    const openedStat = fileSystem.fstatSync(descriptor);
    if (!samePersistentSessionHarnessSealKeyFile(linkStat, openedStat)) {
      throw new Error('DEF Session Harness seal key changed while being opened.');
    }
    const rawKeyFile = fileSystem.readFileSync(descriptor, 'utf8');
    const finalStat = fileSystem.fstatSync(descriptor);
    if (!samePersistentSessionHarnessSealKeyFile(openedStat, finalStat)) {
      throw new Error('DEF Session Harness seal key changed while being read.');
    }
    const key = normalizeSealKey(rawKeyFile);
    if (!key) throw new Error('DEF Session Harness seal key is invalid.');
    return Object.freeze({
      key,
      signature: persistentSessionHarnessSealKeySignature(finalStat, rawKeyFile),
    });
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
}

function readPersistentSessionHarnessSealKey(keyFile, fileSystem = fs) {
  return readPersistentSessionHarnessSealKeyRecord(keyFile, fileSystem).key;
}

function ensurePersistentSessionHarnessSealKeyRecord(keyFile, fileSystem = fs) {
  const target = path.resolve(keyFile);
  try {
    return readPersistentSessionHarnessSealKeyRecord(target, fileSystem);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  fileSystem.mkdirSync(path.dirname(target), { recursive: true });
  const generated = crypto.randomBytes(SESSION_HARNESS_SEAL_KEY_BYTES).toString('hex');
  let descriptor;
  try {
    descriptor = fileSystem.openSync(target, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, `${generated}\n`, 'utf8');
    fileSystem.fsyncSync(descriptor);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
  return readPersistentSessionHarnessSealKeyRecord(target, fileSystem);
}

function ensurePersistentSessionHarnessSealKey(keyFile, fileSystem = fs) {
  return ensurePersistentSessionHarnessSealKeyRecord(keyFile, fileSystem).key;
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
  const managedDirectoryIdentity = binding?.managedDirectoryIdentity;
  const normalizedManagedDirectoryIdentity = managedDirectoryIdentity === undefined
    ? null
    : managedDirectoryIdentity?.kind === 'DefManagedSessionDirectoryIdentityV1'
      && Number(managedDirectoryIdentity.schemaVersion) === 1
      && /^\d+$/.test(String(managedDirectoryIdentity.dev || ''))
      && /^\d+$/.test(String(managedDirectoryIdentity.ino || ''))
      && /^-?\d+$/.test(String(managedDirectoryIdentity.birthtimeNs || ''))
      ? {
          kind: managedDirectoryIdentity.kind,
          schemaVersion: 1,
          dev: String(managedDirectoryIdentity.dev),
          ino: String(managedDirectoryIdentity.ino),
          birthtimeNs: String(managedDirectoryIdentity.birthtimeNs),
        }
      : undefined;
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
    || normalizedManagedDirectoryIdentity === undefined
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
      ...(normalizedManagedDirectoryIdentity
        ? { managedDirectoryIdentity: normalizedManagedDirectoryIdentity }
        : {}),
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
  ensurePersistentSessionHarnessSealKeyRecord,
  normalizeSealKey,
  readPersistentSessionHarnessSealKey,
  readPersistentSessionHarnessSealKeyRecord,
  sameSessionHarnessIdentity,
  sessionHarnessIdentity,
  verifySessionHarnessSeal,
};
