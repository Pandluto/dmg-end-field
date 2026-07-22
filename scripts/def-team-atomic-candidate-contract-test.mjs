import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchesAtomicTeamCandidateCapability,
  prepareAtomicTeamCandidate,
} from '../agent/runtime/def-tools/atomic-team-candidate.mjs';
import { buildGuideTeamLoadoutExactPatch } from '../agent/runtime/def-tools/guide-team-loadout-patch.mjs';
import { recheckDefTeamProductsBeforePreparedCandidate } from '../agent/runtime/def-tools/team-product-recheck.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parentPayload(count) {
  return {
    marker: 'immutable-parent-P',
    operatorConfigPageCache: Object.fromEntries(Array.from({ length: count }, (_, index) => [`char-${index + 1}`, { operator: { name: `Before ${index + 1}` } }])),
    characterInputMap: Object.fromEntries(Array.from({ length: count }, (_, index) => [`char-${index + 1}`, { skillLevels: { Q: 1 } }])),
    unrelatedWorkbenchState: { mustSurvive: true },
  };
}

function previewFor(parent, patch, parentNodeId, parentRevision) {
  const preparedPayload = structuredClone(parent);
  preparedPayload.operatorConfigPageCache[patch.characterId] = { operator: { name: patch.characterName }, exact: patch.exact };
  preparedPayload.characterInputMap[patch.characterId] = { skillLevels: { Q: patch.level } };
  return {
    ok: true,
    parentNodeId,
    parentRevision,
    preparedPayload,
    finalConfig: { characterId: patch.characterId, characterName: patch.characterName, exact: patch.exact, level: patch.level },
    evidence: { characterId: patch.characterId, previewed: true },
  };
}

async function assertTeamSize(count) {
  const parent = parentPayload(count);
  const before = structuredClone(parent);
  const patches = Array.from({ length: count }, (_, index) => ({
    characterId: `char-${index + 1}`, characterName: `After ${index + 1}`, exact: `gear-${index + 1}`, level: index + 7,
  }));
  let createCount = 0;
  let createdPayload = null;
  const prepared = await prepareAtomicTeamCandidate({
    parentPayload: parent,
    parentNodeId: 'parent-P',
    parentRevision: 41,
    patches,
    previewPatch: async (patch) => previewFor(parent, patch, 'parent-P', 41),
    createCandidate: ({ candidatePayload, finalConfigs }) => {
      createCount += 1;
      createdPayload = structuredClone(candidatePayload);
      return { ok: true, value: { id: 'candidate-C', workingPayload: candidatePayload, finalConfigs } };
    },
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(createCount, 1, `${count}-operator plan must create one C`);
  assert.equal(prepared.candidate.id, 'candidate-C');
  assert.equal(prepared.finalConfigs.length, count);
  assert.deepEqual(parent, before, 'P must remain immutable during candidate construction');
  assert.equal(createdPayload.marker, 'immutable-parent-P');
  assert.deepEqual(createdPayload.unrelatedWorkbenchState, { mustSurvive: true });
  for (const patch of patches) {
    assert.equal(createdPayload.operatorConfigPageCache[patch.characterId].exact, patch.exact);
    assert.equal(createdPayload.characterInputMap[patch.characterId].skillLevels.Q, patch.level);
  }
}

await assertTeamSize(2);
await assertTeamSize(4);

{
  let productChecks = 0;
  const drifted = recheckDefTeamProductsBeforePreparedCandidate({
    patches: [{ weapon: { id: 'stale-weapon' } }],
    preparedCandidate: { nodeId: 'existing-candidate' },
  }, () => {
    productChecks += 1;
    return { ok: false, code: 'operator-config-weapon-active-unavailable' };
  });
  assert.equal(productChecks, 1);
  assert.equal(drifted.ok, false);
  assert.equal(drifted.checkedPatches.code, 'operator-config-weapon-active-unavailable');
  assert.equal(Object.hasOwn(drifted, 'preparedCandidate'), false,
    'catalog drift must block before an existing candidate is returned for approval');
}

{
  const base = {
    selected: { characterId: 'mifu', characterName: '弭弗' },
    products: [{
      slotKey: 'armor', equipmentId: 'armor-1', name: '旧锋装甲', gearSetId: 'old-edge',
      effects: [{ effectId: 'effect1', level: 3 }],
    }],
    resolvedWeapon: {
      id: 'weapon-example', name: '典范', level: 90, potential: '0潜',
      skillLevels: { skill1: 9, skill2: 9, skill3: 4 },
    },
  };
  const exact = buildGuideTeamLoadoutExactPatch({
    ...base,
    manifestWeapon: { mode: 'exact-name', name: '典范', level: 90 },
  });
  assert.deepEqual(exact.weapon, {
    id: 'weapon-example', name: '典范', level: 90, potential: '0潜',
    skillLevels: { skill1: 9, skill2: 9, skill3: 4 },
  }, 'an exact guide weapon must be part of the atomic operator-config patch');

  const preserved = buildGuideTeamLoadoutExactPatch({
    ...base,
    manifestWeapon: { mode: 'preserve-current' },
  });
  assert.equal(Object.hasOwn(preserved, 'weapon'), false, 'preserve-current must not overwrite the current weapon');
}

{
  const parent = parentPayload(4);
  const before = structuredClone(parent);
  let createCount = 0;
  const prepared = await prepareAtomicTeamCandidate({
    parentPayload: parent,
    parentNodeId: 'parent-P',
    parentRevision: 88,
    patches: Array.from({ length: 4 }, (_, index) => ({ characterId: `char-${index + 1}`, characterName: `After ${index + 1}`, exact: `gear-${index + 1}`, level: 9 })),
    previewPatch: async (patch, index) => index === 1
      ? { ok: false, code: 'intentional-second-operator-failure' }
      : previewFor(parent, patch, 'parent-P', 88),
    createCandidate: () => {
      createCount += 1;
      return { ok: true, value: { id: 'must-not-exist' } };
    },
  });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.code, 'intentional-second-operator-failure');
  assert.equal(prepared.failedIndex, 1);
  assert.equal(createCount, 0, 'a second-role failure must not create C');
  assert.equal(Object.hasOwn(prepared, 'candidatePayload'), false, 'partial candidate payload must not escape');
  assert.deepEqual(parent, before, 'a failed team preview must not mutate P');
}

{
  const candidate = {
    nodeId: 'candidate-C', nodeRevision: 12, workingHash: 'c-hash',
    parentNodeId: 'parent-P', parentRevision: 11, parentWorkingHash: 'p-hash',
  };
  const capability = {
    candidateNodeId: 'candidate-C', candidateRevision: 12, candidateWorkingHash: 'c-hash',
    parentNodeId: 'parent-P', parentRevision: 11, parentWorkingHash: 'p-hash',
  };
  assert.equal(matchesAtomicTeamCandidateCapability(capability, candidate), true);
  for (const [key, stale] of [
    ['candidateNodeId', 'candidate-other'], ['candidateRevision', 13], ['candidateWorkingHash', 'stale-c'],
    ['parentNodeId', 'parent-other'], ['parentRevision', 10], ['parentWorkingHash', 'stale-p'],
  ]) {
    assert.equal(matchesAtomicTeamCandidateCapability({ ...capability, [key]: stale }, candidate), false, key);
  }
}

{
  const serverSource = fs.readFileSync(path.join(projectRoot, 'scripts/ai-cli-rest-server.mjs'), 'utf8');
  const teamPlanStart = serverSource.indexOf('function buildDefGuideTeamLoadoutPlan');
  const teamPlanEnd = serverSource.indexOf('function reviseDefTeamLoadoutPlan', teamPlanStart);
  const teamPlanSource = serverSource.slice(teamPlanStart, teamPlanEnd);
  assert(teamPlanSource.includes('teamProductCommands'), 'team plan must preflight exact products before it is retained');
  assert(teamPlanSource.includes('validateDefOperatorConfigProductLibrary(command, productGateContext)'), 'team plan must use one shared active/local product gate context');
  assert(teamPlanSource.includes('no plan, queue entry, or branch was created'), 'team plan product failure must document its no-side-effect boundary');

  const teamPrepareStart = serverSource.indexOf('async function prepareDefTeamLoadoutPlanApply');
  const teamPrepareEnd = serverSource.indexOf('async function applyDefTeamLoadoutPlan', teamPrepareStart);
  const teamPrepareSource = serverSource.slice(teamPrepareStart, teamPrepareEnd);
  assert(teamPrepareSource.includes('recheckDefTeamProductsBeforePreparedCandidate'), 'candidate preparation must recheck products after plan creation');
  assert(teamPrepareSource.indexOf('recheckDefTeamProductsBeforePreparedCandidate') < teamPrepareSource.indexOf('if (plan.preparedCandidate)'), 'catalog drift must block before an existing approval candidate is returned');
  assert(teamPrepareSource.indexOf('recheckDefTeamProductsBeforePreparedCandidate') < teamPrepareSource.indexOf('prepareAtomicTeamCandidate'), 'the product gate must run before any preview queue or child branch path');
  assert(teamPrepareSource.includes('before any approval or renderer command was offered'), 'candidate product failure must promise no approval or queue');

  const applyStart = serverSource.indexOf('async function applyDefTeamLoadoutPlan');
  const applyEnd = serverSource.indexOf('function discardPreparedTeamLoadoutPlan', applyStart);
  const applySource = serverSource.slice(applyStart, applyEnd);
  assert(!applySource.includes("'PARTIAL'"), 'atomic team apply must not retain the serial PARTIAL state');
  assert.equal((applySource.match(/checkout-applied/g) || []).length, 1, 'team apply must move checkout once');
  assert.equal((applySource.match(/applyPreparedOperatorConfig/g) || []).length, 1, 'team apply must send one complete payload command');
  assert(applySource.includes('consumeApprovedApplyCapability'), 'team apply must consume a server-verifiable approval capability');
  assert(applySource.includes('const teamProductGate = buildDefOperatorConfigProductCheckedCommands'), 'team apply must recheck the exact product before enqueueing the renderer command');
  assert(applySource.includes('no renderer apply command was enqueued'), 'a late team product failure must be queue-free');
  assert(applySource.includes('restoreAtomicTeamParent'), 'team apply must explicitly restore P after a post-apply failure');
  assert(applySource.indexOf("op: 'applyPreparedOperatorConfig'") < applySource.indexOf("/commit`"), 'C must not be committed before the live C apply/verification begins');
  assert(applySource.includes("state: restored ? 'ROLLED_BACK' : 'RECONCILIATION_REQUIRED'"), 'rollback failure must surface reconciliation rather than a false success');

  const nativeSource = fs.readFileSync(path.join(projectRoot, 'agent/runtime/def-tools/opencode/def.js'), 'utf8');
  const nativeStart = nativeSource.indexOf('export const team_loadout_plan_apply');
  const nativeEnd = nativeSource.indexOf('export const data_weapon', nativeStart);
  const nativeApply = nativeSource.slice(nativeStart, nativeEnd);
  for (const key of ['candidateNodeId', 'candidateRevision', 'candidateWorkingHash', 'parentNodeId', 'parentRevision', 'parentWorkingHash', 'sessionBindingId', 'timelineId', 'axisBindingId']) {
    assert(nativeApply.includes(key), `permission/apply capability must include ${key}`);
  }
  assert(nativeApply.includes('def.team.loadout.plan.apply.discard'), 'permission rejection must discard the uncommitted C');
  assert(nativeApply.includes('approvalCapability'), 'native permission continuation must pass the one-time approval capability to apply');
}

console.log('DEF atomic team candidate contract: PASS (2-person, 4-person, zero-partial, stale capability)');
