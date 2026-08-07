'use strict';

const crypto = require('node:crypto');
const fsModule = require('node:fs');
const path = require('node:path');

const PROFILE_SCHEMA_VERSION = 1;
const DEFAULT_PROFILE_REF = 'default';

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
    modelId: input?.modelId || existing?.modelId || 'deepseek-chat',
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

function migrateLegacyAgentProviderProfile(filePath, legacyPaths, options = {}) {
  const fs = options.fs || fsModule;
  const current = readAgentProviderProfile(filePath, { fs });
  if (current) return { migrated: false, profile: current };
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
      modelId: deepseek.model || 'deepseek-chat',
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
  const modelId = boundedString(input.modelId, '模型 ID');
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

function boundedString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空。`);
  const normalized = value.trim();
  if (normalized.length > 4_096) throw new Error(`${label}过长。`);
  return normalized;
}

function portableIdentifier(value, label) {
  const normalized = boundedString(value, label);
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(normalized)) throw new Error(`${label}格式无效。`);
  return normalized;
}

module.exports = {
  migrateLegacyAgentProviderProfile,
  readAgentProviderProfile,
  writeAgentProviderProfile,
};
