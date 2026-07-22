import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { classifyDefExecutableTurnPolicy, isDefEquipment3Plus1Correction, isDirectCurrentNodeQuestion, routeNativeTurnHarness } = require('../agent/runtime/def-opencode-adapter/harness-turn-router.cjs');
const {
  clearRegisteredHarnessVerificationCache,
  isDefEquipment3Plus1HarnessBinding,
} = require('../agent/runtime/def-opencode-adapter/session-harness-activation.cjs');
const {
  createSessionHarnessSeal,
  ensurePersistentSessionHarnessSealKey,
  verifySessionHarnessSeal,
} = require('../agent/runtime/def-opencode-adapter/session-harness-seal.cjs');
const {
  buildOpenCodeRuntimeEnv,
  createAgentSessionWorkspace,
  getNativeHarnessSystem,
  readNativeSessionBinding,
  writeSessionBinding,
} = require('../agent/runtime/def-opencode-adapter/index.cjs');
const defHarness = require('../agent/harness/def-harness.cjs');

const harnessFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'def-turn-routing-registry-'));
const harnessRuntimeRoot = path.join(harnessFixtureRoot, 'runtime');
const harnessBuildRoot = path.join(harnessFixtureRoot, 'builds');
const harnessSealKey = '7'.repeat(64);
process.once('exit', () => fs.rmSync(harnessFixtureRoot, { recursive: true, force: true }));

function buildAndRegisterHarness(relativeSource, channel) {
  const source = fileURLToPath(new URL(relativeSource, import.meta.url));
  const built = defHarness.buildPackage(source, harnessBuildRoot);
  return defHarness.registerPackage(harnessRuntimeRoot, built.directory, channel);
}

const stableHarnessRef = buildAndRegisterHarness('../agent/harness/baseline/stable-v0/', 'stable');
const compositeHarnessRef = buildAndRegisterHarness(
  '../agent/harness/examples/spec9-3plus1-composite-v1/',
  'candidate/spec9-3plus1-composite-v1',
);

function agentReleaseFor(harnessBinding) {
  return {
    kind: 'AgentReleaseV1',
    schemaVersion: 1,
    harness: {
      selector: harnessBinding.selector,
      ref: { ...harnessBinding.harness },
    },
  };
}

function sealBinding(binding) {
  binding.harnessIdentitySeal = createSessionHarnessSeal(binding, harnessSealKey);
  return binding;
}

function spawnBunEval(source, options = {}) {
  // Keep the temporary module under the repository so Bun resolves the same
  // workspace dependencies as `bun -e`, without putting the source on the
  // Windows command line.
  const probeRoot = fs.mkdtempSync(path.join(process.cwd(), '.def-turn-routing-probe-'));
  const probeFile = path.join(probeRoot, 'probe.mjs');
  fs.writeFileSync(probeFile, source, 'utf8');
  try {
    if (process.platform === 'win32') {
      return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'bun.cmd', probeFile], {
        encoding: 'utf8',
        ...options,
      });
    }
    return spawnSync('bun', [probeFile], { encoding: 'utf8', ...options });
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
}

const binding = {
  schemaVersion: 5,
  sessionID: 'session-pinned',
  directory: path.join(harnessFixtureRoot, 'sessions', 'operator'),
  harnessBinding: {
    kind: 'DefHarnessSessionBindingV1',
    schemaVersion: 1,
    sessionId: 'session-pinned',
    selector: 'candidate/operator-config-horizontal-metadata',
    harness: { harnessId: 'def-operator-config-atomic-failfast', version: '1.1.0', contentHash: 'a'.repeat(64), schemaVersion: 1 },
  },
};
const compositeBinding = {
  ...binding,
  directory: path.join(harnessFixtureRoot, 'sessions', 'composite'),
  harnessBinding: {
    ...binding.harnessBinding,
    selector: 'candidate/spec9-3plus1-composite-v1',
    harness: compositeHarnessRef,
  },
};
compositeBinding.agentRelease = agentReleaseFor(compositeBinding.harnessBinding);
sealBinding(compositeBinding);
const mismatchedCompositeBinding = {
  ...compositeBinding,
  harnessBinding: {
    ...compositeBinding.harnessBinding,
    sessionId: 'another-session',
  },
};

const harnessActivationOptions = { runtimeRoot: harnessRuntimeRoot, sealKey: harnessSealKey };
assert.equal(isDefEquipment3Plus1HarnessBinding(compositeBinding, harnessActivationOptions), true);

const explicitCompositeBinding = structuredClone(compositeBinding);
explicitCompositeBinding.harnessBinding.selector = 'explicit';
explicitCompositeBinding.agentRelease.harness.selector = 'explicit';
sealBinding(explicitCompositeBinding);
assert.equal(isDefEquipment3Plus1HarnessBinding(explicitCompositeBinding, harnessActivationOptions), true,
  'an explicit selector resolves through its immutable id@version');

const fakeVersionBinding = structuredClone(compositeBinding);
fakeVersionBinding.harnessBinding.harness.version = '9.1.0-candidate.999';
fakeVersionBinding.agentRelease.harness.ref.version = '9.1.0-candidate.999';
sealBinding(fakeVersionBinding);
assert.equal(isDefEquipment3Plus1HarnessBinding(fakeVersionBinding, harnessActivationOptions), false,
  'a synchronized fake version must not pass without an immutable Registry package');

const fakeHashBinding = structuredClone(compositeBinding);
fakeHashBinding.harnessBinding.harness.contentHash = 'f'.repeat(64);
fakeHashBinding.agentRelease.harness.ref.contentHash = 'f'.repeat(64);
sealBinding(fakeHashBinding);
assert.equal(isDefEquipment3Plus1HarnessBinding(fakeHashBinding, harnessActivationOptions), false,
  'a synchronized fake content hash must not pass Registry verification');

const spoofedStableBinding = structuredClone(compositeBinding);
spoofedStableBinding.harnessBinding.selector = 'stable';
spoofedStableBinding.agentRelease.harness.selector = 'stable';
assert.equal(isDefEquipment3Plus1HarnessBinding(spoofedStableBinding, harnessActivationOptions), false,
  'changing the creation-time selector invalidates the identity seal');

const mismatchedReleaseRefBinding = structuredClone(compositeBinding);
mismatchedReleaseRefBinding.agentRelease.harness.ref = stableHarnessRef;
sealBinding(mismatchedReleaseRefBinding);
assert.equal(isDefEquipment3Plus1HarnessBinding(mismatchedReleaseRefBinding, harnessActivationOptions), false,
  'AgentRelease and Session Harness refs must identify the same immutable package');

const mismatchedReleaseSelectorBinding = structuredClone(compositeBinding);
mismatchedReleaseSelectorBinding.agentRelease.harness.selector = 'stable';
sealBinding(mismatchedReleaseSelectorBinding);
assert.equal(isDefEquipment3Plus1HarnessBinding(mismatchedReleaseSelectorBinding, harnessActivationOptions), false,
  'AgentRelease and Session Harness selectors must agree');

const missingSealBinding = structuredClone(compositeBinding);
delete missingSealBinding.harnessIdentitySeal;
assert.equal(isDefEquipment3Plus1HarnessBinding(missingSealBinding, harnessActivationOptions), false,
  'a candidate binding without its creation-time seal must fail closed');
const badSealBinding = structuredClone(compositeBinding);
badSealBinding.harnessIdentitySeal.value = '0'.repeat(64);
assert.equal(isDefEquipment3Plus1HarnessBinding(badSealBinding, harnessActivationOptions), false,
  'a candidate binding with a bad seal must fail closed');

const copiedCandidateBinding = structuredClone(compositeBinding);
copiedCandidateBinding.sessionID = 'stable-session';
copiedCandidateBinding.directory = path.join(harnessFixtureRoot, 'sessions', 'stable');
copiedCandidateBinding.harnessBinding.sessionId = 'stable-session';
assert.equal(isDefEquipment3Plus1HarnessBinding(copiedCandidateBinding, {
  ...harnessActivationOptions,
  sessionID: copiedCandidateBinding.sessionID,
  directory: copiedCandidateBinding.directory,
}), false, 'a candidate binding and seal copied into another stable Session must not activate');

defHarness.setChannel(harnessRuntimeRoot, 'candidate/spec9-3plus1-composite-v1', stableHarnessRef);
clearRegisteredHarnessVerificationCache();
assert.equal(isDefEquipment3Plus1HarnessBinding(compositeBinding, harnessActivationOptions), true,
  'moving a channel pointer must not change an existing sealed immutable Session pin');
defHarness.setChannel(harnessRuntimeRoot, 'candidate/spec9-3plus1-composite-v1', compositeHarnessRef);
clearRegisteredHarnessVerificationCache();

const persistentSealKeyFile = path.join(harnessFixtureRoot, 'def-agent', 'session-harness-seal.key');
const persistentSealKey = ensurePersistentSessionHarnessSealKey(persistentSealKeyFile);
assert.match(persistentSealKey, /^[a-f0-9]{64}$/);
assert.equal(ensurePersistentSessionHarnessSealKey(persistentSealKeyFile), persistentSealKey,
  'the sidecar seal key must persist across reads');
assert.equal(verifySessionHarnessSeal(compositeBinding, harnessSealKey), true);

const runtimeEnv = buildOpenCodeRuntimeEnv({}, {
  openCodeHome: path.join(harnessFixtureRoot, 'opencode-home'),
  harnessRuntimeRoot,
  harnessSealKey,
});
assert.equal(runtimeEnv.DEF_SESSION_HARNESS_SEAL_KEY, harnessSealKey,
  'the production OpenCode child environment receives the sidecar seal key');
assert.equal(runtimeEnv.DEF_HARNESS_RUNTIME_ROOT, path.resolve(harnessRuntimeRoot),
  'the production OpenCode child environment receives the sidecar Registry root');

{
  const sidecarDirectories = [];
  const makeHarnessBinding = (sessionID, selector, harness, createdAt = 1) => ({
    kind: 'DefHarnessSessionBindingV1',
    schemaVersion: 1,
    sessionId: sessionID,
    selector,
    harness,
    slotHashes: {},
    createdAt,
  });
  try {
    const recoveryDirectory = createAgentSessionWorkspace('workbench');
    sidecarDirectories.push(recoveryDirectory);
    const oldSessionID = 'sealed-recovery-old';
    const oldHarnessBinding = makeHarnessBinding(oldSessionID, 'explicit', compositeHarnessRef);
    writeSessionBinding(recoveryDirectory, {
      id: oldSessionID,
      agent: 'def-workbench',
      skillId: 'workbench',
      harnessBinding: oldHarnessBinding,
      agentRelease: agentReleaseFor(oldHarnessBinding),
    }, { harnessSealKey });
    assert(readNativeSessionBinding(recoveryDirectory, oldSessionID, { includeNodeRelation: false, harnessSealKey }),
      'the sidecar must read its own valid sealed candidate binding');

    const newSessionID = 'sealed-recovery-new';
    const reboundHarnessBinding = makeHarnessBinding(newSessionID, 'explicit', compositeHarnessRef, 2);
    const reboundSession = {
      id: newSessionID,
      agent: 'def-workbench',
      skillId: 'workbench',
      harnessBinding: reboundHarnessBinding,
      agentRelease: agentReleaseFor(reboundHarnessBinding),
    };
    assert.throws(() => writeSessionBinding(recoveryDirectory, reboundSession, { harnessSealKey }),
      (caught) => caught.code === 'HARNESS_BINDING_INVALID',
      'ordinary writes cannot change the Session identity of a sealed binding');
    writeSessionBinding(recoveryDirectory, reboundSession, { harnessSealKey, allowSessionRecoveryRebind: true });
    assert(readNativeSessionBinding(recoveryDirectory, newSessionID, { includeNodeRelation: false, harnessSealKey }),
      'an explicit recovery rebind may re-seal the same immutable Harness ref for the new upstream Session id');

    const tampered = JSON.parse(fs.readFileSync(path.join(recoveryDirectory, '.def-session.json'), 'utf8'));
    tampered.harnessBinding.harness.contentHash = 'f'.repeat(64);
    tampered.agentRelease.harness.ref.contentHash = 'f'.repeat(64);
    fs.writeFileSync(path.join(recoveryDirectory, '.def-session.json'), `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    assert.equal(readNativeSessionBinding(recoveryDirectory, newSessionID, { includeNodeRelation: false, harnessSealKey }), null,
      'the sidecar reader must reject a tampered candidate binding');
    assert.throws(() => writeSessionBinding(recoveryDirectory, {
      ...reboundSession,
      harnessBinding: tampered.harnessBinding,
      agentRelease: tampered.agentRelease,
    }, { harnessSealKey, allowSessionRecoveryRebind: true }),
    (caught) => caught.code === 'HARNESS_BINDING_INVALID',
    'recovery must not turn a bad candidate seal into a signing oracle');
    assert.throws(() => getNativeHarnessSystem(tampered, '3+1 recommendation'),
      (caught) => caught.code === 'HARNESS_BINDING_INVALID',
      'the sidecar must reject a bad candidate seal before composing candidate teaching');

    const stableDirectory = createAgentSessionWorkspace('workbench');
    sidecarDirectories.push(stableDirectory);
    const stableSessionID = 'sealed-stable-session';
    const stableBinding = makeHarnessBinding(stableSessionID, 'stable', stableHarnessRef);
    writeSessionBinding(stableDirectory, {
      id: stableSessionID,
      agent: 'def-workbench',
      skillId: 'workbench',
      harnessBinding: stableBinding,
      agentRelease: agentReleaseFor(stableBinding),
    }, { harnessSealKey });
    const replacementBinding = makeHarnessBinding(stableSessionID, 'explicit', compositeHarnessRef);
    assert.throws(() => writeSessionBinding(stableDirectory, {
      id: stableSessionID,
      agent: 'def-workbench',
      skillId: 'workbench',
      harnessBinding: replacementBinding,
      agentRelease: agentReleaseFor(replacementBinding),
    }, { harnessSealKey, allowSessionRecoveryRebind: true }),
    (caught) => caught.code === 'HARNESS_BINDING_INVALID',
    'a stable binding cannot be replaced by a candidate even through the recovery-only write path');

    const legacyStableDirectory = createAgentSessionWorkspace('workbench');
    sidecarDirectories.push(legacyStableDirectory);
    const legacyStableSessionID = 'legacy-stable-session';
    const legacyStableBinding = makeHarnessBinding(legacyStableSessionID, 'stable', stableHarnessRef);
    fs.writeFileSync(path.join(legacyStableDirectory, '.def-session.json'), `${JSON.stringify({
      schemaVersion: 5,
      sessionID: legacyStableSessionID,
      directory: legacyStableDirectory,
      host: 'workbench',
      harnessBinding: legacyStableBinding,
    }, null, 2)}\n`, 'utf8');
    assert(readNativeSessionBinding(legacyStableDirectory, legacyStableSessionID, { includeNodeRelation: false, harnessSealKey }),
      'a legacy stable binding without a seal remains readable');

    const unsealedCandidateDirectory = createAgentSessionWorkspace('workbench');
    sidecarDirectories.push(unsealedCandidateDirectory);
    const unsealedCandidateSessionID = 'legacy-candidate-session';
    const unsealedCandidateBinding = makeHarnessBinding(
      unsealedCandidateSessionID,
      'candidate/legacy-copy',
      stableHarnessRef,
    );
    fs.writeFileSync(path.join(unsealedCandidateDirectory, '.def-session.json'), `${JSON.stringify({
      schemaVersion: 5,
      sessionID: unsealedCandidateSessionID,
      directory: unsealedCandidateDirectory,
      host: 'workbench',
      harnessBinding: unsealedCandidateBinding,
      agentRelease: agentReleaseFor(unsealedCandidateBinding),
    }, null, 2)}\n`, 'utf8');
    assert.equal(readNativeSessionBinding(
      unsealedCandidateDirectory,
      unsealedCandidateSessionID,
      { includeNodeRelation: false, harnessSealKey },
    ), null, 'only a strict legacy stable binding may remain readable without a seal');

    writeSessionBinding(legacyStableDirectory, {
      id: legacyStableSessionID,
      agent: 'def-workbench',
      skillId: 'workbench',
      harnessBinding: legacyStableBinding,
      agentRelease: agentReleaseFor(legacyStableBinding),
    }, { harnessSealKey });
    const migratedStable = JSON.parse(fs.readFileSync(path.join(legacyStableDirectory, '.def-session.json'), 'utf8'));
    assert.equal(verifySessionHarnessSeal(migratedStable, harnessSealKey), true,
      'the sidecar may explicitly migrate an unchanged legacy stable identity to a seal');
  } finally {
    for (const directory of sidecarDirectories) fs.rmSync(directory, { recursive: true, force: true });
  }
}

assert.throws(() => getNativeHarnessSystem(missingSealBinding, '3+1 recommendation'),
  (caught) => caught.code === 'HARNESS_BINDING_INVALID',
  'the sidecar must reject candidate teaching before compose when its seal is missing');
assert.throws(() => getNativeHarnessSystem(binding, 'candidate teaching'),
  (caught) => caught.code === 'HARNESS_BINDING_INVALID',
  'the sidecar must reject any unsealed candidate before composing its teaching');

assert.throws(() => getNativeHarnessSystem({
  ...binding,
  sessionID: 'different-session',
}), (caught) => caught.code === 'HARNESS_BINDING_INVALID', 'a Harness binding cannot be replayed under another native session id');

assert.equal(routeNativeTurnHarness(binding, '把赛希配件换成长息加固板').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '先开别礼战技，再释放赛希连携，最后放大招').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '先开别礼战技，再释放赛希连携，最后放大招').reason, 'session-harness-pinned-timeline-turn');
assert.equal(routeNativeTurnHarness(binding, '给别礼换武器，然后重新排轴').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '查一下潮涌套的力量词条').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '查一下潮涌套的力量词条').task, 'operator-config');
assert.equal(routeNativeTurnHarness(binding, '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对').task, 'operator-config');
assert.equal(routeNativeTurnHarness(binding, '给别礼换上潮涌套').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '请为刚才已校验的9按钮节点重新发出审核').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '图腾下落-2层里的水龙卷算什么伤害').task, 'exact-skill-facts');
assert.equal(classifyDefExecutableTurnPolicy('图腾下落-2层里的水龙卷算什么伤害')?.kind, 'exact-skill-facts');
assert.equal(classifyDefExecutableTurnPolicy('为别礼挑选一套装备，3 潮涌+1，需要主副属性都对。'), null);
assert.equal(classifyDefExecutableTurnPolicy(
  '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对。',
  { equipment3Plus1Enabled: true },
)?.kind, 'equipment-3plus1-composite');
assert.equal(routeNativeTurnHarness(compositeBinding, '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对', harnessActivationOptions).task, 'equipment-3plus1-composite');
assert.notEqual(
  routeNativeTurnHarness(mismatchedCompositeBinding, '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对', harnessActivationOptions).task,
  'equipment-3plus1-composite',
  'an internally inconsistent Session binding must fail closed',
);
assert.equal(classifyDefExecutableTurnPolicy('潮涌套装的二件效果是什么？'), null);
assert.equal(classifyDefExecutableTurnPolicy('这把武器的伤害倍率是多少'), null);
assert.equal(isDefEquipment3Plus1Correction('配件二为什么不用第二个悬河供氧栓？'), true);
assert.equal(isDefEquipment3Plus1Correction('这把武器为什么不用第二个方案？'), false);
assert.equal(routeNativeTurnHarness(compositeBinding, '配件二为什么不用第二个悬河供氧栓？', harnessActivationOptions).task, 'equipment-3plus1-composite');
assert.equal(routeNativeTurnHarness(binding, '配件二为什么不用第二个悬河供氧栓？').task, 'operator-config');
assert.equal(isDirectCurrentNodeQuestion('当前节点是什么？'), true);
assert.equal(isDirectCurrentNodeQuestion('请基于当前空排轴创建新节点'), false);

const serverSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
assert.match(serverSource, /getNativeHarnessSystem\(binding, rawUserText\)/);
assert.match(serverSource, /buildWorkbenchCheckoutSystemPrompt\(checkoutState/);

const workbenchPromptSource = fs.readFileSync(new URL('../agent/server/workbench-system-prompts.cjs', import.meta.url), 'utf8');
assert.match(workbenchPromptSource, /same typed-tool failure code occurs twice/);
assert.match(workbenchPromptSource, /interop pending is null/);
assert.match(workbenchPromptSource, /EXACT SKILL FACT CONTRACT/);
assert.match(workbenchPromptSource, /Call def_data_skill as the first and only tool/);

const skillSource = fs.readFileSync(new URL('../agent/runtime/def/skills/timeline-workbench/SKILL.md', import.meta.url), 'utf8');
assert.match(skillSource, /approvalPolicy=manual/);
assert.match(skillSource, /skillKey.*never a substitute/);
assert.match(skillSource, /same failure code occurs twice/);
assert.match(skillSource, /call `def_node_use` in the same turn/);
assert.doesNotMatch(skillSource, /3\+1 correction|composite recommendation/i,
  'shared Runtime Skill must stay Harness-neutral');

const candidateResponsePolicySource = fs.readFileSync(new URL('../agent/harness/examples/spec9-3plus1-composite-v1/response-policy.md', import.meta.url), 'utf8');
assert.match(candidateResponsePolicySource, /For `3\+1`, obtain a fresh composite recommendation/,
  'candidate-only teaching remains in the immutable candidate package');

const pluginSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/plugin.js', import.meta.url), 'utf8');
assert.match(pluginSource, /'chat\.message'/);
assert.match(pluginSource, /beginDefToolTurn/);
assert.match(pluginSource, /'tool\.execute\.before'/);
assert.match(pluginSource, /assertDefToolTurnNotBlocked/);
assert.match(pluginSource, /assertDefNativeArtifactToolScope/);
assert.match(pluginSource, /'experimental\.chat\.messages\.transform'/);
assert.match(pluginSource, /applyDefToolModelMessagePolicy/);
assert.match(pluginSource, /input\?\.phase/);
assert.match(pluginSource, /'experimental\.chat\.messages\.transform'[\s\S]{0,500}input\?\.sessionID/,
  'the transform hook must forward its Session identity to activation');
assert.match(pluginSource, /recordDefToolEventFailure/);
assert.match(pluginSource, /event: async/);

const retryFuseProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('contract-session', 'contract-turn');
  const failure = (callID, tool) => ({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'contract-session', callID, tool, state: { status: 'error', error: 'The user has specified a rule which prevents you from using this specific tool call. external_directory' } } } });
  mod.recordDefToolEventFailure(failure('call-1', 'glob'));
  mod.assertDefToolTurnNotBlocked('contract-session', 'def_data_skill');
  mod.recordDefToolEventFailure(failure('call-2', 'read'));
  try { mod.assertDefToolTurnNotBlocked('contract-session', 'def_node_sync_validate'); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-retry-limit-reached') process.exit(3); }
`);
assert.equal(retryFuseProbe.status, 0, retryFuseProbe.stderr || retryFuseProbe.stdout);

const mutationTargetBudgetProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  const failure = (callID, input) => ({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'target-session', callID, tool: 'operator_config_patch', input, state: { status: 'error', error: 'operator-config-preview-failed: temporary renderer response' } } } });
  mod.beginDefToolTurn('target-session', 'target-turn');
  mod.recordDefToolEventFailure(failure('bieli-1', { characterId: 'bieli', weaponName: '赫拉芬格' }));
  mod.recordDefToolEventFailure(failure('saixi-1', { characterId: 'saixi', weaponName: '骑士精神' }));
  mod.assertDefToolTurnNotBlocked('target-session', 'operator_config_patch');
  mod.recordDefToolEventFailure(failure('bieli-2', { characterId: 'bieli', weaponName: '赫拉芬格' }));
  try { mod.assertDefToolTurnNotBlocked('target-session', 'operator_config_patch'); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-retry-limit-reached') process.exit(3); }
`);
assert.equal(mutationTargetBudgetProbe.status, 0, mutationTargetBudgetProbe.stderr || mutationTargetBudgetProbe.stdout);

const explicitApplyIntentProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurnFromChatMessage('intent-session', 'comparison-turn', [{ type: 'text', text: '配件二为什么不用第二个悬河供氧栓？' }]);
  if (mod.getDefOperatorConfigTurnIdentity({ sessionID: 'intent-session' }).applyIntent) process.exit(2);
  mod.beginDefToolTurnFromChatMessage('intent-session', 'apply-turn', [{ type: 'text', text: '确认。' }]);
  const intent = mod.getDefOperatorConfigTurnIdentity({ sessionID: 'intent-session' });
  if (intent.turnID !== 'apply-turn' || !intent.applyIntent) process.exit(3);
`, { env: { ...process.env, DEF_INTERNAL_GOVERNANCE_TOKEN: 'turn-intent-contract' } });
assert.equal(explicitApplyIntentProbe.status, 0, explicitApplyIntentProbe.stderr || explicitApplyIntentProbe.stdout);

const nonRetryableMutationProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('mutation-session', 'mutation-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'mutation-session', callID: 'call-1', tool: 'operator_config_patch', state: { status: 'error', error: 'operator-config-timeline-invariant-failed: typed canonical invariant rejected the preview' } } } });
  try { mod.assertDefToolTurnNotBlocked('mutation-session', 'operator_config_patch'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-mutation-not-attempted' || error?.details?.attempted !== false) process.exit(3);
  }
`);
assert.equal(nonRetryableMutationProbe.status, 0, nonRetryableMutationProbe.stderr || nonRetryableMutationProbe.stdout);

const terminalEvidenceProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('evidence-session', 'evidence-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'evidence-session', callID: 'planner-1', tool: 'def_data_weapon_fit_plan', state: { status: 'error', error: 'weapon-fit-combat-convention-incomplete: reviewed evidence is incomplete' } } } });
  try { mod.assertDefToolTurnNotBlocked('evidence-session', 'def_data_weapon'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-evidence-not-attempted' || error?.details?.attempted !== false || error?.details?.originalTool !== 'def_data_weapon_fit_plan') process.exit(3);
  }
`);
assert.equal(terminalEvidenceProbe.status, 0, terminalEvidenceProbe.stderr || terminalEvidenceProbe.stdout);

const terminalEquipmentFactsProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('equipment-evidence-session', 'equipment-evidence-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'equipment-evidence-session', callID: 'facts-1', tool: 'def_data_equipment_3plus1_facts', state: { status: 'error', error: 'equipment-3plus1-catalog-invalid: duplicate typed identities' } } } });
  try { mod.assertDefToolTurnNotBlocked('equipment-evidence-session', 'def_data_equipment'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-evidence-not-attempted' || error?.details?.attempted !== false || error?.details?.originalTool !== 'def_data_equipment_3plus1_facts') process.exit(3);
  }
`);
assert.equal(terminalEquipmentFactsProbe.status, 0, terminalEquipmentFactsProbe.stderr || terminalEquipmentFactsProbe.stdout);

const exactSkillFactsPolicyProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurnFromChatMessage('skill-session', 'skill-turn', [{ type: 'text', text: '图腾下落-2层里的水龙卷算什么伤害' }]);
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_workbench_context', {}); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempted !== false) process.exit(3); }
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { query: '图腾下落' }); process.exit(4); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked') process.exit(5); }
  mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { characterQuery: '汤汤', query: '图腾下落-2层' });
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { characterQuery: '汤汤', query: 'skill-Q-4' }); process.exit(6); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempts !== 1) process.exit(7); }
`);
assert.equal(exactSkillFactsPolicyProbe.status, 0, exactSkillFactsPolicyProbe.stderr || exactSkillFactsPolicyProbe.stdout);

const equipmentCompositePolicyProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  const enabled = { equipment3Plus1Enabled: true };
  mod.beginDefToolTurnFromChatMessage('equipment-session', 'msg_001', [{ type: 'text', text: '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对。' }], enabled);
  try { mod.assertDefToolTurnNotBlocked('equipment-session', 'def_data_operator_catalog', {}); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempted !== false) process.exit(3); }
  mod.assertDefToolTurnNotBlocked('equipment-session', 'def_data_equipment_3plus1_recommend', {}, enabled);
  try { mod.assertDefToolTurnNotBlocked('equipment-session', 'def_data_equipment_3plus1_recommend', {}, enabled); process.exit(4); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempts !== 1) process.exit(5); }
  mod.beginDefToolTurnFromChatMessage('equipment-session', 'msg_003', [{ type: 'text', text: '配件二为什么不用第二个悬河供氧栓？' }], enabled);
  const priorTypedOutput = JSON.stringify({ protocolVersion: 1, contract: 'DefEquipmentThreePlusOneRecommendationV1', state: 'READY', result: { planDigest: 'sha256:' + 'a'.repeat(64) } });
  mod.applyDefToolModelMessagePolicy([
    { info: { role: 'user', id: 'msg_001', sessionID: 'equipment-session' }, parts: [{ type: 'text', text: '为别礼挑选一套装备，3 潮涌+1。' }] },
    { info: { role: 'assistant', id: 'msg_002', parentID: 'msg_001', sessionID: 'equipment-session' }, parts: [{ type: 'tool', tool: 'def_data_equipment_3plus1_recommend', state: { status: 'completed', output: priorTypedOutput } }, { type: 'text', text: '上一轮结论' }] },
    { info: { role: 'user', id: 'msg_003', sessionID: 'equipment-session' }, parts: [{ type: 'text', text: '配件二为什么不用第二个悬河供氧栓？' }] },
  ], 'generation', enabled);
  try { mod.assertDefToolTurnNotBlocked('equipment-session', 'def_data_game_knowledge', {}); process.exit(6); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.policy !== 'equipment-3plus1-composite') process.exit(7); }
  mod.assertDefToolTurnNotBlocked('equipment-session', 'def_data_equipment_3plus1_recommend', {}, enabled);
  mod.beginDefToolTurnFromChatMessage('equipment-session', 'msg_005', [{ type: 'text', text: '确认。' }], enabled);
  mod.assertDefToolTurnNotBlocked('equipment-session', 'def_data_game_knowledge', {});
`);
assert.equal(equipmentCompositePolicyProbe.status, 0, equipmentCompositePolicyProbe.stderr || equipmentCompositePolicyProbe.stdout);

const equipmentCompositeModelMessageProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  const enabled = { equipment3Plus1Enabled: true };
  const typedOutput = JSON.stringify({ protocolVersion: 1, contract: 'DefEquipmentThreePlusOneRecommendationV1', state: 'UNRESOLVED', missing: ['operator-build-operator-not-found'] });
  const oldOutput = typedOutput;
  const persistedMessages = [
    { info: { role: 'user', id: 'msg_001' }, parts: [{ type: 'text', text: '旧问题' }] },
    { info: { role: 'assistant', id: 'msg_002', parentID: 'msg_001' }, parts: [{ type: 'tool', tool: 'def_data_equipment_3plus1_recommend', state: { status: 'completed', output: oldOutput } }] },
    { info: { role: 'user', id: 'msg_003' }, parts: [{ type: 'text', text: '当前问题' }] },
    { info: { role: 'assistant', id: 'msg_004', parentID: 'msg_003' }, parts: [{ type: 'tool', tool: 'def_data_equipment_3plus1_recommend', state: { status: 'completed', output: typedOutput } }] },
  ];
  const persistedBefore = JSON.stringify(persistedMessages);
  const providerMessages = structuredClone(persistedMessages);
  if (!mod.applyDefToolModelMessagePolicy(providerMessages, 'generation', enabled)) process.exit(2);
  const projected = providerMessages[3].parts[0].state.output;
  if (!projected.startsWith('[DEF HARNESS TERMINAL CONTRACT')) process.exit(3);
  if (!projected.endsWith(typedOutput)) process.exit(4);
  if (providerMessages[1].parts[0].state.output !== oldOutput) process.exit(5);
  if (JSON.stringify(persistedMessages) !== persistedBefore) process.exit(6);
  if (mod.applyDefToolModelMessagePolicy(providerMessages, 'generation', enabled)) process.exit(7);
  const completedTurn = structuredClone(persistedMessages);
  completedTurn.push({ info: { role: 'assistant', id: 'msg_005', parentID: 'msg_003' }, parts: [{ type: 'text', text: '最终可见结论' }] });
  if (mod.applyDefToolModelMessagePolicy(completedTurn, 'generation', enabled)) process.exit(8);
  if (completedTurn[3].parts[0].state.output !== typedOutput) process.exit(9);
  const compactedTurn = structuredClone(persistedMessages);
  compactedTurn[3].parts[0].state.time = { compacted: true };
  if (mod.applyDefToolModelMessagePolicy(compactedTurn, 'generation', enabled)) process.exit(10);
  if (mod.applyDefToolModelMessagePolicy(structuredClone(persistedMessages), 'compaction', enabled)) process.exit(11);
  const textAfterTool = structuredClone(persistedMessages);
  textAfterTool[3].parts.push({ type: 'text', text: '工具后的最终结论' });
  if (mod.applyDefToolModelMessagePolicy(textAfterTool, 'generation', enabled)) process.exit(12);
  const wrongParent = structuredClone(persistedMessages);
  wrongParent[3].info.parentID = 'msg_wrong';
  if (mod.applyDefToolModelMessagePolicy(wrongParent, 'generation', enabled)) process.exit(13);
  const duplicateComposite = structuredClone(persistedMessages);
  duplicateComposite[3].parts.push(structuredClone(duplicateComposite[3].parts[0]));
  if (mod.applyDefToolModelMessagePolicy(duplicateComposite, 'generation', enabled)) process.exit(14);
  const malformedOutput = structuredClone(persistedMessages);
  malformedOutput[3].parts[0].state.output = '{}';
  if (mod.applyDefToolModelMessagePolicy(malformedOutput, 'generation', enabled)) process.exit(15);
  const reordered = [persistedMessages[2], persistedMessages[3], persistedMessages[0], persistedMessages[1]].map((message) => structuredClone(message));
  if (!mod.applyDefToolModelMessagePolicy(reordered, 'generation', enabled)) process.exit(16);
`);
assert.equal(equipmentCompositeModelMessageProbe.status, 0, equipmentCompositeModelMessageProbe.stderr || equipmentCompositeModelMessageProbe.stdout);

const equipmentCompositeHarnessActivationProbe = spawnBunEval(`
  import fs from 'node:fs';
  import os from 'node:os';
  import path from 'node:path';
  const harnessRuntimeRoot = ${JSON.stringify(harnessRuntimeRoot)};
  const harnessSealKey = ${JSON.stringify(harnessSealKey)};
  const candidateHarnessRef = ${JSON.stringify(compositeHarnessRef)};
  const stableHarnessRef = ${JSON.stringify(stableHarnessRef)};
  process.env.DEF_HARNESS_RUNTIME_ROOT = harnessRuntimeRoot;
  process.env.DEF_SESSION_HARNESS_SEAL_KEY = harnessSealKey;
  const activation = (await import(${JSON.stringify(new URL('../agent/runtime/def-opencode-adapter/session-harness-activation.cjs', import.meta.url).href)})).default;
  const seal = (await import(${JSON.stringify(new URL('../agent/runtime/def-opencode-adapter/session-harness-seal.cjs', import.meta.url).href)})).default;
  const pluginFactory = (await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/plugin.js', import.meta.url).href)})).default;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-3plus1-activation-'));
  const writeBinding = (directory, sessionID, selector, harnessRef) => {
    fs.mkdirSync(directory, { recursive: true });
    const binding = {
      schemaVersion: 5,
      sessionID,
      directory: path.resolve(directory),
      host: 'workbench',
      harnessBinding: {
        kind: 'DefHarnessSessionBindingV1',
        schemaVersion: 1,
        sessionId: sessionID,
        selector,
        harness: harnessRef,
      },
      agentRelease: {
        kind: 'AgentReleaseV1',
        schemaVersion: 1,
        harness: {
          selector,
          ref: harnessRef,
        },
      },
    };
    binding.harnessIdentitySeal = seal.createSessionHarnessSeal(binding, harnessSealKey);
    fs.writeFileSync(path.join(directory, '.def-session.json'), JSON.stringify(binding));
    return binding;
  };
  const user = (sessionID, id, text) => ({
    info: { role: 'user', id, sessionID },
    parts: [{ type: 'text', text }],
  });
  const composite = (sessionID, id, parentID) => ({
    info: { role: 'assistant', id, parentID, sessionID },
    parts: [{
      type: 'tool',
      tool: 'def_data_equipment_3plus1_recommend',
      state: {
        status: 'completed',
        output: JSON.stringify({
          protocolVersion: 1,
          contract: 'DefEquipmentThreePlusOneRecommendationV1',
          state: 'READY',
          result: { planDigest: 'sha256:' + 'c'.repeat(64) },
        }),
      },
    }],
  });
  try {
    const candidateDirectory = path.join(root, 'candidate');
    const candidateSession = 'candidate-session';
    const candidateBinding = writeBinding(candidateDirectory, candidateSession, 'candidate/spec9-3plus1-composite-v1', candidateHarnessRef);
    activation.clearRegisteredHarnessVerificationCache();
    const candidate = await pluginFactory({ directory: candidateDirectory });
    await candidate['experimental.chat.messages.transform'](
      { phase: 'compaction', sessionID: candidateSession },
      { messages: [] },
    );
    let stats = activation.getSessionHarnessActivationStats();
    if (stats.bindingReads !== 0 || stats.registryValidations !== 0) process.exit(18);
    const firstText = '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对。';
    await candidate['chat.message'](
      { sessionID: candidateSession },
      { message: { id: 'msg_001' }, parts: [{ type: 'text', text: firstText }] },
    );
    stats = activation.getSessionHarnessActivationStats();
    if (stats.bindingReads !== 1 || stats.registryValidations !== 1 || stats.registryCacheEntries !== 1) process.exit(19);
    try {
      await candidate['tool.execute.before'](
        { sessionID: candidateSession, tool: 'def_data_game_knowledge', callID: 'wrong-1' },
        { args: {} },
      );
      process.exit(2);
    } catch (error) {
      if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.policy !== 'equipment-3plus1-composite') process.exit(3);
    }
    stats = activation.getSessionHarnessActivationStats();
    if (stats.bindingReads !== 2 || stats.registryValidations !== 1 || stats.registryCacheHits < 1) process.exit(20);
    await candidate['tool.execute.before'](
      { sessionID: candidateSession, tool: 'def_data_equipment_3plus1_recommend', callID: 'recommend-1' },
      { args: {} },
    );

    const candidateMessages = [
      user(candidateSession, 'msg_001', firstText),
      composite(candidateSession, 'msg_002', 'msg_001'),
    ];
    await candidate['experimental.chat.messages.transform'](
      { phase: 'generation', sessionID: candidateSession },
      { messages: candidateMessages },
    );
    if (!candidateMessages[1].parts[0].state.output.startsWith('[DEF HARNESS TERMINAL CONTRACT')) process.exit(4);
    stats = activation.getSessionHarnessActivationStats();
    if (stats.registryValidations !== 1 || stats.registryCacheHits < 3) process.exit(21);

    const correctionText = '配件二为什么不用第二个悬河供氧栓？';
    await candidate['chat.message'](
      { sessionID: candidateSession },
      { message: { id: 'msg_003' }, parts: [{ type: 'text', text: correctionText }] },
    );
    const correctionHistory = [
      user(candidateSession, 'msg_001', firstText),
      composite(candidateSession, 'msg_002', 'msg_001'),
      user(candidateSession, 'msg_003', correctionText),
    ];
    await candidate['experimental.chat.messages.transform'](
      { phase: 'generation', sessionID: candidateSession },
      { messages: correctionHistory },
    );
    try {
      await candidate['tool.execute.before'](
        { sessionID: candidateSession, tool: 'def_data_game_knowledge', callID: 'wrong-2' },
        { args: {} },
      );
      process.exit(5);
    } catch (error) {
      if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.policy !== 'equipment-3plus1-composite') process.exit(6);
    }

    const stableDirectory = path.join(root, 'stable');
    const stableSession = 'stable-session';
    writeBinding(stableDirectory, stableSession, 'stable', stableHarnessRef);
    const stable = await pluginFactory({ directory: stableDirectory });
    await stable['chat.message'](
      { sessionID: stableSession },
      { message: { id: 'msg_101' }, parts: [{ type: 'text', text: firstText }] },
    );
    await stable['tool.execute.before'](
      { sessionID: stableSession, tool: 'def_data_game_knowledge', callID: 'stable-narrow' },
      { args: {} },
    );
    try {
      await stable['tool.execute.before'](
        { sessionID: stableSession, tool: 'def_data_equipment_3plus1_recommend', callID: 'stable-composite' },
        { args: {} },
      );
      process.exit(7);
    } catch (error) {
      if (error?.details?.policy !== 'equipment-3plus1-harness-activation') process.exit(8);
    }
    const stableMessages = [
      user(stableSession, 'msg_101', firstText),
      composite(stableSession, 'msg_102', 'msg_101'),
    ];
    const stableOutput = stableMessages[1].parts[0].state.output;
    await stable['experimental.chat.messages.transform'](
      { phase: 'generation', sessionID: stableSession },
      { messages: stableMessages },
    );
    if (stableMessages[1].parts[0].state.output !== stableOutput) process.exit(9);

    await stable['chat.message'](
      { sessionID: stableSession },
      { message: { id: 'msg_103' }, parts: [{ type: 'text', text: '图腾下落-2层里的水龙卷算什么伤害' }] },
    );
    try {
      await stable['tool.execute.before'](
        { sessionID: stableSession, tool: 'def_workbench_context', callID: 'stable-skill-wrong' },
        { args: {} },
      );
      process.exit(10);
    } catch (error) {
      if (error?.details?.policy !== 'exact-skill-facts') process.exit(11);
    }
    await stable['tool.execute.before'](
      { sessionID: stableSession, tool: 'def_data_skill', callID: 'stable-skill' },
      { args: { characterQuery: '汤汤', query: '图腾下落-2层' } },
    );

    await candidate['chat.message'](
      { sessionID: 'forged-session' },
      { message: { id: 'msg_201' }, parts: [{ type: 'text', text: firstText }] },
    );
    try {
      await candidate['tool.execute.before'](
        { sessionID: 'forged-session', tool: 'def_data_equipment_3plus1_recommend', callID: 'wrong-session' },
        { args: {} },
      );
      process.exit(12);
    } catch (error) {
      if (error?.details?.policy !== 'equipment-3plus1-harness-activation') process.exit(13);
    }

    const forgedDirectoryBinding = JSON.parse(fs.readFileSync(path.join(candidateDirectory, '.def-session.json'), 'utf8'));
    forgedDirectoryBinding.directory = path.join(root, 'different-directory');
    fs.writeFileSync(path.join(candidateDirectory, '.def-session.json'), JSON.stringify(forgedDirectoryBinding));
    try {
      await candidate['tool.execute.before'](
        { sessionID: candidateSession, tool: 'def_data_equipment_3plus1_recommend', callID: 'wrong-directory' },
        { args: {} },
      );
      process.exit(14);
    } catch (error) {
      if (error?.details?.policy !== 'equipment-3plus1-harness-activation') process.exit(15);
    }

    writeBinding(candidateDirectory, candidateSession, 'stable', stableHarnessRef);
    try {
      await candidate['tool.execute.before'](
        { sessionID: candidateSession, tool: 'def_data_equipment_3plus1_recommend', callID: 'downgraded' },
        { args: {} },
      );
      process.exit(16);
    } catch (error) {
      if (error?.details?.policy !== 'equipment-3plus1-harness-activation') process.exit(17);
    }

    const copiedCandidate = structuredClone(candidateBinding);
    copiedCandidate.sessionID = stableSession;
    copiedCandidate.directory = path.resolve(stableDirectory);
    copiedCandidate.harnessBinding.sessionId = stableSession;
    fs.writeFileSync(path.join(stableDirectory, '.def-session.json'), JSON.stringify(copiedCandidate));
    try {
      await stable['tool.execute.before'](
        { sessionID: stableSession, tool: 'def_data_equipment_3plus1_recommend', callID: 'stable-upgrade-copy' },
        { args: {} },
      );
      process.exit(22);
    } catch (error) {
      if (error?.details?.policy !== 'equipment-3plus1-harness-activation') process.exit(23);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
`);
assert.equal(
  equipmentCompositeHarnessActivationProbe.status,
  0,
  equipmentCompositeHarnessActivationProbe.stderr || equipmentCompositeHarnessActivationProbe.stdout,
);

const vendorPromptSource = fs.readFileSync(new URL('../agent/vendor/opencode/packages/opencode/src/session/prompt.ts', import.meta.url), 'utf8');
const vendorCompactionSource = fs.readFileSync(new URL('../agent/vendor/opencode/packages/opencode/src/session/compaction.ts', import.meta.url), 'utf8');
assert.match(vendorPromptSource, /phase: "generation"/);
assert.match(vendorPromptSource, /sessionID/);
assert.match(vendorCompactionSource, /phase: "compaction"/);
assert.match(vendorCompactionSource, /sessionID: input\.sessionID/);

const defToolSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url), 'utf8');
assert.match(defToolSource, /mutationTargetFingerprint/);
assert.match(defToolSource, /def-tool-mutation-not-attempted/);
assert.match(defToolSource, /def-tool-evidence-not-attempted/);
assert.match(defToolSource, /exact-skill-facts/);
assert.match(defToolSource, /denied-native-catalog-artifact-scope/);
assert.match(defToolSource, /hasExplicitOperatorConfigApplyIntent/);
assert.doesNotMatch(defToolSource, /catalog-readonly-/);

const nativeServerSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
assert.match(nativeServerSource, /registerNativeCatalogSession/);
assert.match(nativeServerSource, /def\.native_catalog\.register_session/);

const restServerSource = fs.readFileSync(new URL('../scripts/ai-cli-rest-server.mjs', import.meta.url), 'utf8');
assert.match(restServerSource, /restoreRegisteredDefNativeCatalogSession/);
assert.match(restServerSource, /getSessionAxisBindingBySession\('workbench', sessionId\)/);

const adapterSource = fs.readFileSync(new URL('../agent/runtime/def-opencode-adapter/index.cjs', import.meta.url), 'utf8');
assert.match(adapterSource, /EQUIPMENT EVIDENCE/);
assert.match(adapterSource, /DEF_EMPTY_ASSISTANT_RESPONSE/);
assert.match(adapterSource, /if \(!visibleContent\) throw new Error\(DEF_EMPTY_ASSISTANT_RESPONSE\)/);
assert.match(adapterSource, /defHarness\.sameRef\(resolved\.ref, pinned\.harness\)/);
assert.doesNotMatch(adapterSource, /COMPOSITE 3\+1 RECOMMENDATION/);
assert.doesNotMatch(adapterSource, /nativeHarnessLoader\.resolve\(turnRoute\.selector\)/);
assert.match(adapterSource, /harnessSealKeyHash:\s*crypto\.createHash\('sha256'\)\.update\(harnessSealKey\)/,
  'OpenCode process reuse must depend on a non-secret fingerprint of the persistent seal key');
assert.doesNotMatch(adapterSource, /CURRENT TURN — EXECUTABLE READ-ONLY CATALOG CONTRACT/);

const viewSource = fs.readFileSync(new URL('../src/components/def-opencode/DefOpenCodeView.tsx', import.meta.url), 'utf8');
assert.match(viewSource, /__defHarnessSelector/);
assert.match(viewSource, /harnessSelector: developmentHarnessSelector/);
assert.match(viewSource, /SIDECAR_BOOTSTRAP_URL = 'http:\/\/127\.0\.0\.1:31457\/open-def-agent'/,
  'the DEF host must start its local sidecar before calling the sidecar origin');
assert.match(viewSource, /await ensureNativeSidecar\(\);\s*const ensureResponse = await fetch\(`\$\{origin\}\/api\/runtime\/ensure`/,
  'the DEF host must await sidecar readiness before ensuring the OpenCode runtime');

console.log('DEF turn-level Harness routing contract: PASS');
