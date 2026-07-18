import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchesAtomicTeamCandidateCapability,
  prepareAtomicTeamCandidate,
} from '../agent/runtime/def-tools/atomic-team-candidate.mjs';

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
  const applyStart = serverSource.indexOf('async function applyDefTeamLoadoutPlan');
  const applyEnd = serverSource.indexOf('function discardPreparedTeamLoadoutPlan', applyStart);
  const applySource = serverSource.slice(applyStart, applyEnd);
  assert(!applySource.includes("'PARTIAL'"), 'atomic team apply must not retain the serial PARTIAL state');
  assert.equal((applySource.match(/checkout-applied/g) || []).length, 1, 'team apply must move checkout once');
  assert.equal((applySource.match(/applyPreparedOperatorConfig/g) || []).length, 1, 'team apply must send one complete payload command');

  const nativeSource = fs.readFileSync(path.join(projectRoot, 'agent/runtime/def-tools/opencode/def.js'), 'utf8');
  const nativeStart = nativeSource.indexOf('export const team_loadout_plan_apply');
  const nativeEnd = nativeSource.indexOf('export const data_weapon', nativeStart);
  const nativeApply = nativeSource.slice(nativeStart, nativeEnd);
  for (const key of ['candidateNodeId', 'candidateRevision', 'candidateWorkingHash', 'parentNodeId', 'parentRevision', 'parentWorkingHash', 'sessionBindingId', 'timelineId', 'axisBindingId']) {
    assert(nativeApply.includes(key), `permission/apply capability must include ${key}`);
  }
  assert(nativeApply.includes('def.team.loadout.plan.apply.discard'), 'permission rejection must discard the uncommitted C');
}

console.log('DEF atomic team candidate contract: PASS (2-person, 4-person, zero-partial, stale capability)');
