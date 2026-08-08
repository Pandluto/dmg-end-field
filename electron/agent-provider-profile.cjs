'use strict';

const crypto = require('node:crypto');
const fsModule = require('node:fs');
const path = require('node:path');

const PROFILE_SCHEMA_VERSION = 1;
const DEFAULT_PROFILE_REF = 'default';
const DEFAULT_DEEPSEEK_MODEL_ID = 'deepseek-v4-flash';
const LEGACY_DEEPSEEK_MODEL_ID = 'deepseek-v4-pro';

function readAgentProviderProfile(filePath, options = {}) {
  const fs = options.fs || fsModule;
  let document;
  try {
    const info = fs.lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Provider 配置必须是普通文件。');
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const profile = parseProfileDocument(document);
  return {
    configured: true,
    ref: profile.ref,
    providerId: profile.providerId,
    displayName: profile.displayName,
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    apiKeyConfigured: Boolean(profile.apiKey),
    ...(options.includeSecret ? { apiKey: profile.apiKey } : {}),
  };
}

function writeAgentProviderProfile(filePath, input, options = {}) {
  const fs = options.fs || fsModule;
  const existing = readAgentProviderProfile(filePath, { fs, includeSecret: true });
  const apiKeyInput = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
  const apiKey = apiKeyInput || existing?.apiKey || '';
  if (!apiKey) throw new Error('请填写 Provider API Key。');
  const profile = normalizeProfile({
    ref: input?.ref || existing?.ref || DEFAULT_PROFILE_REF,
    providerId: input?.providerId || existing?.providerId || 'deepseek',
    displayName: input?.displayName || existing?.displayName || 'DeepSeek',
    baseUrl: input?.baseUrl || existing?.baseUrl || 'https://api.deepseek.com',
    modelId: input?.modelId || existing?.modelId || DEFAULT_DEEPSEEK_MODEL_ID,
    apiKey,
  });
  const document = { schemaVersion: PROFILE_SCHEMA_VERSION, profiles: [profile] };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
    if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600);
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
  }
  return readAgentProviderProfile(filePath, { fs });
}

/**
 * Replace one already-staged profile with the target profile atomically.
 * The previous file is kept until finalizeAgentProviderProfileSwap is called,
 * so a failed Host restart can restore the exact previous bytes.
 */
function swapAgentProviderProfile(candidatePath, targetPath, options = {}) {
  const fs = options.fs || fsModule;
  assertRegularProfileFile(fs, candidatePath, '候选 Provider 配置');
  const targetExists = existsAsRegularProfileFile(fs, targetPath);
  const backupPath = `${targetPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.bak`;
  let previousMoved = false;
  try {
    if (targetExists) {
      fs.renameSync(targetPath, backupPath);
      previousMoved = true;
    }
    fs.renameSync(candidatePath, targetPath);
    if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o600);
    return Object.freeze({
      candidatePath,
      targetPath,
      backupPath: previousMoved ? backupPath : null,
      hadPrevious: previousMoved,
    });
  } catch (error) {
    try {
      if (previousMoved && !fs.existsSync(targetPath)) fs.renameSync(backupPath, targetPath);
    } catch {
      // Preserve the original commit error. The caller will surface the
      // rollback failure separately if it cannot restore the old profile.
    }
    throw error;
  }
}

function finalizeAgentProviderProfileSwap(transaction, options = {}) {
  const fs = options.fs || fsModule;
  if (!transaction?.backupPath) return;
  fs.rmSync(transaction.backupPath, { force: true });
}

function rollbackAgentProviderProfileSwap(transaction, options = {}) {
  const fs = options.fs || fsModule;
  if (!transaction || typeof transaction.targetPath !== 'string') {
    throw new TypeError('Provider 配置回滚事务无效。');
  }
  if (fs.existsSync(transaction.targetPath)) fs.rmSync(transaction.targetPath, { force: true });
  if (transaction.backupPath && fs.existsSync(transaction.backupPath)) {
    fs.renameSync(transaction.backupPath, transaction.targetPath);
    if (process.platform !== 'win32') fs.chmodSync(transaction.targetPath, 0o600);
  } else if (transaction.hadPrevious) {
    throw new Error('旧 Provider 配置备份不存在。');
  }
}

/**
 * Verify credentials and the selected model without creating a billable
 * conversation. The /models endpoint is part of the OpenAI-compatible
 * provider contract used by the DEF OpenCode adapter.
 */
async function probeAgentProviderProfile(filePath, options = {}) {
  const profile = readAgentProviderProfile(filePath, {
    fs: options.fs || fsModule,
    includeSecret: true,
  });
  if (!profile?.apiKey) throw providerProbeError('AGENT_PROVIDER_AUTH_FAILED', 'Provider API Key 不可用。');
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw providerProbeError('AGENT_PROVIDER_PROBE_UNAVAILABLE', '当前环境没有可用的 Provider 检查能力。');
  }
  const timeoutMs = positiveInteger(options.timeoutMs, 8_000);
  const endpoint = `${profile.baseUrl.replace(/\/+$/u, '')}/models`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${profile.apiKey}`,
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw providerProbeError('AGENT_PROVIDER_PROBE_TIMEOUT', 'Provider 检查超时，配置未提交。');
    }
    throw providerProbeError('AGENT_PROVIDER_PROBE_FAILED', 'Provider 检查失败，配置未提交。');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    throw providerProbeError('AGENT_PROVIDER_AUTH_FAILED', 'Provider API Key 验证失败，旧配置仍在使用。');
  }
  if (!response.ok) {
    throw providerProbeError('AGENT_PROVIDER_PROBE_FAILED', 'Provider 模型目录不可用，配置未提交。');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw providerProbeError('AGENT_PROVIDER_PROBE_FAILED', 'Provider 模型目录响应无效，配置未提交。');
  }
  const models = Array.isArray(body?.data)
    ? body.data
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item) => item.id)
    : [];
  if (!models.includes(profile.modelId)) {
    throw providerProbeError('AGENT_PROVIDER_MODEL_UNAVAILABLE', '所选模型不在 Provider 当前可用目录中，配置未提交。');
  }
  return {
    configured: true,
    ref: profile.ref,
    providerId: profile.providerId,
    displayName: profile.displayName,
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    apiKeyConfigured: true,
    verified: true,
  };
}

function migrateLegacyAgentProviderProfile(filePath, legacyPaths, options = {}) {
  const fs = options.fs || fsModule;
  const current = readAgentProviderProfile(filePath, { fs });
  if (current) {
    if (current.providerId === 'deepseek' && current.modelId === LEGACY_DEEPSEEK_MODEL_ID) {
      const currentWithSecret = readAgentProviderProfile(filePath, { fs, includeSecret: true });
      const profile = writeAgentProviderProfile(filePath, {
        modelId: DEFAULT_DEEPSEEK_MODEL_ID,
        apiKey: currentWithSecret.apiKey,
      }, { fs });
      return { migrated: true, profile, sourcePath: filePath };
    }
    return { migrated: false, profile: current };
  }
  for (const legacyPath of legacyPaths || []) {
    let legacy;
    try {
      const info = fs.lstatSync(legacyPath);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
    const deepseek = legacy?.deepseek;
    if (!deepseek || typeof deepseek !== 'object' || !String(deepseek.apiKey || '').trim()) continue;
    const profile = writeAgentProviderProfile(filePath, {
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: deepseek.baseUrl || 'https://api.deepseek.com',
      modelId: deepseek.model === LEGACY_DEEPSEEK_MODEL_ID
        ? DEFAULT_DEEPSEEK_MODEL_ID
        : deepseek.model || DEFAULT_DEEPSEEK_MODEL_ID,
      apiKey: deepseek.apiKey,
    }, { fs });
    return { migrated: true, profile, sourcePath: legacyPath };
  }
  return { migrated: false, profile: null };
}

function parseProfileDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Provider 配置不是有效对象。');
  }
  if (document.schemaVersion !== PROFILE_SCHEMA_VERSION || !Array.isArray(document.profiles)) {
    throw new Error(`Provider 配置 schemaVersion 必须为 ${PROFILE_SCHEMA_VERSION}。`);
  }
  const profile = document.profiles.find((item) => item?.ref === DEFAULT_PROFILE_REF) || document.profiles[0];
  if (!profile) throw new Error('Provider 配置中没有可用 Profile。');
  return normalizeProfile(profile);
}

function normalizeProfile(input) {
  const ref = portableIdentifier(input.ref, 'Profile ref');
  const providerId = portableIdentifier(input.providerId, 'Provider ID');
  const displayName = boundedString(input.displayName, 'Provider 名称');
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const modelId = boundedString(input.modelId, '模型 ID', 256);
  const apiKey = boundedString(input.apiKey, 'Provider API Key');
  return { ref, providerId, displayName, baseUrl, modelId, apiKey };
}

function normalizeBaseUrl(value) {
  const raw = boundedString(value, 'Base URL').replace(/\/+$/u, '');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Base URL 不是有效 URL。'); }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Base URL 必须是没有内嵌凭据的 HTTP(S) URL。');
  }
  if (parsed.protocol !== 'https:' && !loopback) throw new Error('非本机 Provider 必须使用 HTTPS。');
  return raw;
}

function boundedString(value, label, maxLength = 4_096) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空。`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label}过长。`);
  return normalized;
}

function assertRegularProfileFile(fs, filePath, label) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label}不可读取。`);
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label}必须是普通文件。`);
}

function existsAsRegularProfileFile(fs, filePath) {
  try {
    assertRegularProfileFile(fs, filePath, 'Provider 配置');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    try {
      const info = fs.lstatSync(filePath);
      if (info.isSymbolicLink()) throw new Error('Provider 配置不能是符号链接。');
      if (!info.isFile()) throw new Error('Provider 配置必须是普通文件。');
      return true;
    } catch (nestedError) {
      if (nestedError?.code === 'ENOENT') return false;
      throw nestedError;
    }
  }
}

function providerProbeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 502;
  return error;
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Provider 检查超时时间无效。');
  return value;
}

function portableIdentifier(value, label) {
  const normalized = boundedString(value, label);
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(normalized)) throw new Error(`${label}格式无效。`);
  return normalized;
}

module.exports = {
  DEFAULT_DEEPSEEK_MODEL_ID,
  migrateLegacyAgentProviderProfile,
  finalizeAgentProviderProfileSwap,
  probeAgentProviderProfile,
  readAgentProviderProfile,
  rollbackAgentProviderProfileSwap,
  swapAgentProviderProfile,
  writeAgentProviderProfile,
};
