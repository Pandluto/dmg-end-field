'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_DEEPSEEK_MODEL_ID,
  migrateLegacyAgentProviderProfile,
  readAgentProviderProfile,
  writeAgentProviderProfile,
} = require('./agent-provider-profile.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-agent-profile-'));
const target = path.join(root, 'runtime', 'profiles.json');
const defaultTarget = path.join(root, 'runtime', 'default-profiles.json');
const legacy = path.join(root, 'legacy.json');

try {
  assert.equal(DEFAULT_DEEPSEEK_MODEL_ID, 'deepseek-v4-flash');
  const defaultProfile = writeAgentProviderProfile(defaultTarget, { apiKey: 'default-secret' });
  assert.equal(defaultProfile.modelId, 'deepseek-v4-flash');

  assert.equal(readAgentProviderProfile(target), null);
  fs.writeFileSync(legacy, JSON.stringify({
    deepseek: {
      apiKey: 'legacy-secret',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    },
  }));
  const migration = migrateLegacyAgentProviderProfile(target, [legacy]);
  assert.equal(migration.migrated, true);
  assert.deepEqual(migration.profile, {
    configured: true,
    ref: 'default',
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
    apiKeyConfigured: true,
  });
  assert.equal(readAgentProviderProfile(target).apiKey, undefined);
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);

  const updated = writeAgentProviderProfile(target, {
    baseUrl: 'https://example.com/v1/',
    modelId: 'example-model',
  });
  assert.equal(updated.baseUrl, 'https://example.com/v1');
  assert.equal(updated.modelId, 'example-model');
  assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'legacy-secret');

  assert.throws(() => writeAgentProviderProfile(target, {
    baseUrl: 'http://example.com/v1',
    modelId: 'bad-model',
  }), /HTTPS/);
  console.log('agent provider profile tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
