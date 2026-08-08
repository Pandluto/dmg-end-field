'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_DEEPSEEK_MODEL_ID,
  finalizeAgentProviderProfileSwap,
  migrateLegacyAgentProviderProfile,
  probeAgentProviderProfile,
  readAgentProviderProfile,
  rollbackAgentProviderProfileSwap,
  swapAgentProviderProfile,
  writeAgentProviderProfile,
} = require('./agent-provider-profile.cjs');
const { updateAgentProviderProfile } = require('./agent-provider-transaction.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-agent-profile-'));
const target = path.join(root, 'runtime', 'profiles.json');
const defaultTarget = path.join(root, 'runtime', 'default-profiles.json');
const existingTarget = path.join(root, 'runtime', 'existing-profiles.json');
const legacy = path.join(root, 'legacy.json');

async function run() {
  try {
  assert.equal(DEFAULT_DEEPSEEK_MODEL_ID, 'deepseek-v4-flash');
  const defaultProfile = writeAgentProviderProfile(defaultTarget, { apiKey: 'default-secret' });
  assert.equal(defaultProfile.modelId, 'deepseek-v4-flash');

  writeAgentProviderProfile(existingTarget, {
    apiKey: 'existing-secret',
    modelId: 'deepseek-v4-pro',
  });
  const existingMigration = migrateLegacyAgentProviderProfile(existingTarget, []);
  assert.equal(existingMigration.migrated, true);
  assert.equal(existingMigration.profile.modelId, 'deepseek-v4-flash');
  assert.equal(
    readAgentProviderProfile(existingTarget, { includeSecret: true }).apiKey,
    'existing-secret',
  );

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

    const candidate = path.join(root, 'candidate.json');
    writeAgentProviderProfile(candidate, {
      apiKey: 'probe-secret',
      baseUrl: 'https://api.deepseek.com',
      modelId: DEFAULT_DEEPSEEK_MODEL_ID,
    });
    const goodProbe = await probeAgentProviderProfile(candidate, {
      fetch: async (_url, init) => {
        assert.equal(init.headers.authorization, 'Bearer probe-secret');
        return {
          ok: true,
          status: 200,
          async json() {
            return { object: 'list', data: [{ id: DEFAULT_DEEPSEEK_MODEL_ID }] };
          },
        };
      },
    });
    assert.equal(goodProbe.verified, true);
    assert.equal(goodProbe.apiKeyConfigured, true);
    assert.equal(JSON.stringify(goodProbe).includes('probe-secret'), false);

    await assert.rejects(
      () => probeAgentProviderProfile(candidate, {
        fetch: async () => ({
          ok: false,
          status: 401,
          async json() { return { error: { message: 'probe-secret leaked by provider' } }; },
        }),
      }),
      (error) => error?.code === 'AGENT_PROVIDER_AUTH_FAILED'
        && !String(error?.message).includes('probe-secret'),
    );
    await assert.rejects(
      () => probeAgentProviderProfile(candidate, {
        fetch: async () => ({
          ok: true,
          status: 200,
          async json() { return { object: 'list', data: [{ id: 'another-model' }] }; },
        }),
      }),
      (error) => error?.code === 'AGENT_PROVIDER_MODEL_UNAVAILABLE',
    );

    const transaction = swapAgentProviderProfile(candidate, target);
    assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'probe-secret');
    rollbackAgentProviderProfileSwap(transaction);
    assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'legacy-secret');
    writeAgentProviderProfile(candidate, {
      apiKey: 'probe-secret',
      baseUrl: 'https://api.deepseek.com',
      modelId: DEFAULT_DEEPSEEK_MODEL_ID,
    });
    const nextTransaction = swapAgentProviderProfile(candidate, target);
    finalizeAgentProviderProfileSwap(nextTransaction);
    assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'probe-secret');

    writeAgentProviderProfile(target, {
      apiKey: 'old-transaction-secret',
      baseUrl: 'https://api.deepseek.com',
      modelId: DEFAULT_DEEPSEEK_MODEL_ID,
    });
    let oldStartCount = 0;
    let oldStopCount = 0;
    let candidateStartCount = 0;
    let candidateStopCount = 0;
    const oldRuntime = {
      state: () => ({ running: true, ready: true }),
      getProviderUpdateSafety: () => ({ allowed: true }),
      async stop() { oldStopCount += 1; },
      async start() { oldStartCount += 1; return { running: true, ready: true, state: 'ready' }; },
    };
    const transactionResult = await updateAgentProviderProfile({
      profilePath: target,
      payload: { apiKey: 'new-transaction-secret', modelId: DEFAULT_DEEPSEEK_MODEL_ID },
      runtime: oldRuntime,
      probeProfile: async () => undefined,
      createCandidateRuntime: async () => ({
        async start() { candidateStartCount += 1; return { running: true, ready: true }; },
        async stop() { candidateStopCount += 1; },
      }),
    });
    assert.equal(transactionResult.changed, true);
    assert.equal(oldStopCount, 1);
    assert.equal(oldStartCount, 1);
    assert.equal(candidateStartCount, 1);
    assert.equal(candidateStopCount, 1);
    assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'new-transaction-secret');
    assert.equal(JSON.stringify(transactionResult).includes('new-transaction-secret'), false);

    writeAgentProviderProfile(target, {
      apiKey: 'stable-transaction-secret',
      baseUrl: 'https://api.deepseek.com',
      modelId: DEFAULT_DEEPSEEK_MODEL_ID,
    });
    let failedCandidateStopped = false;
    await assert.rejects(
      () => updateAgentProviderProfile({
        profilePath: target,
        payload: { apiKey: 'bad-transaction-secret', modelId: DEFAULT_DEEPSEEK_MODEL_ID },
        runtime: oldRuntime,
        probeProfile: async () => { throw new Error('provider returned bad-transaction-secret'); },
        createCandidateRuntime: async () => ({
          async start() { return { running: true, ready: true }; },
          async stop() { failedCandidateStopped = true; },
        }),
      }),
      (error) => error?.code === 'AGENT_PROVIDER_UPDATE_FAILED'
        && !String(error?.message).includes('bad-transaction-secret'),
    );
    assert.equal(failedCandidateStopped, false);
    assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'stable-transaction-secret');

    const sessionMarker = path.join(root, 'session-store', 'sessions', 'continuity', 'events.ndjson');
    fs.mkdirSync(path.dirname(sessionMarker), { recursive: true });
    fs.writeFileSync(sessionMarker, '{"type":"turn.completed"}\n');
    let restartStartCount = 0;
    let restartStopCount = 0;
    const restartRuntime = {
      state: () => ({ running: true, ready: true }),
      getProviderUpdateSafety: () => ({ allowed: true }),
      async stop() { restartStopCount += 1; },
      async start() {
        restartStartCount += 1;
        return restartStartCount === 1
          ? { running: false, ready: false, state: 'error' }
          : { running: true, ready: true, state: 'ready' };
      },
    };
    await assert.rejects(
      () => updateAgentProviderProfile({
        profilePath: target,
        payload: { apiKey: 'restart-failure-secret', modelId: DEFAULT_DEEPSEEK_MODEL_ID },
        runtime: restartRuntime,
        probeProfile: async () => undefined,
        createCandidateRuntime: async () => ({
          async start() { return { running: true, ready: true }; },
          async stop() {},
        }),
      }),
      (error) => error?.code === 'AGENT_PROVIDER_RESTART_FAILED'
        && !String(error?.message).includes('restart-failure-secret'),
    );
    assert.equal(restartStopCount, 2, 'candidate Host and failed real Host must both be stopped');
    assert.equal(restartStartCount, 2, 'the old Host must be restarted after rollback');
    assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'stable-transaction-secret');
    assert.equal(fs.readFileSync(sessionMarker, 'utf8'), '{"type":"turn.completed"}\n');

    const blockedRuntime = {
      state: () => ({ running: true, ready: true }),
      getProviderUpdateSafety: () => ({
        allowed: false,
        code: 'AGENT_PROVIDER_UPDATE_BLOCKED',
        reason: '当前 Agent 正在等待审批，请先处理或停止当前 Turn。',
      }),
      beginProviderUpdate: () => ({
        allowed: false,
        code: 'AGENT_PROVIDER_UPDATE_BLOCKED',
        reason: '当前 Agent 正在等待审批，请先处理或停止当前 Turn。',
      }),
    };
    await assert.rejects(
      () => updateAgentProviderProfile({
        profilePath: target,
        payload: { apiKey: 'blocked-secret', modelId: DEFAULT_DEEPSEEK_MODEL_ID },
        runtime: blockedRuntime,
        probeProfile: async () => undefined,
        createCandidateRuntime: async () => { throw new Error('must not boot candidate'); },
      }),
      (error) => error?.code === 'AGENT_PROVIDER_UPDATE_BLOCKED',
    );
    assert.equal(readAgentProviderProfile(target, { includeSecret: true }).apiKey, 'stable-transaction-secret');
    console.log('agent provider profile tests passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
