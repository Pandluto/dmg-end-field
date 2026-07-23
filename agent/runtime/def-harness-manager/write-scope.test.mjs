import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MutationCommitCoordinator } = require('./commit-coordinator.cjs');
const { applyDownstreamEffects } = require('./downstream.cjs');
const { analyzeBusinessMutation } = require('./semantic-write-scope.cjs');
const { BusinessTransactionStore } = require('./transactions.cjs');

function button(id, characterId, nodeIndex, selectedBuff = []) {
  return {
    id,
    characterId,
    characterName: characterId,
    skillType: 'B',
    runtimeSkillId: `skill-${id}`,
    skillDisplayName: `Skill ${id}`,
    staffIndex: characterId === 'a' ? 0 : 1,
    lineIndex: characterId === 'a' ? 0 : 1,
    nodeIndex,
    nodeNumber: nodeIndex + 1,
    selectedBuff,
  };
}

function payload() {
  const a = button('button-a', 'a', 0, ['buff-a']);
  const b = button('button-b', 'b', 1);
  return {
    selectedCharacters: ['a', 'b'],
    characterInputMap: { a: { level: 90 }, b: { level: 90 } },
    operatorConfigPageCache: { a: { weapon: 'wa' }, b: { weapon: 'wb' } },
    timelineData: {
      staffLines: [
        { staffIndex: 0, characterName: 'a', occupiedNodes: [0], buttons: [{ id: 'button-a' }] },
        { staffIndex: 1, characterName: 'b', occupiedNodes: [1], buttons: [{ id: 'button-b' }] },
      ],
    },
    skillButtonTable: { 'button-a': a, 'button-b': b },
    allBuffList: [{ id: 'buff-a' }],
    characterComputedMap: { total: 1 },
    marker: 'unchanged',
  };
}

test('keeps timeline and BUFF writes adjacent but non-overlapping', () => {
  const before = payload();
  const timelineAfter = structuredClone(before);
  timelineAfter.skillButtonTable['button-a'].nodeIndex = 3;
  timelineAfter.skillButtonTable['button-a'].nodeNumber = 4;
  timelineAfter.timelineData.staffLines[0].occupiedNodes = [3];
  assert.equal(analyzeBusinessMutation({ businessId: 'timeline', beforePayload: before, afterPayload: timelineAfter }).pass, true);
  assert.equal(analyzeBusinessMutation({ businessId: 'buff', beforePayload: before, afterPayload: timelineAfter }).pass, false);

  const buffAfter = structuredClone(before);
  buffAfter.skillButtonTable['button-a'].selectedBuff = [];
  assert.equal(analyzeBusinessMutation({ businessId: 'buff', beforePayload: before, afterPayload: buffAfter }).pass, true);
  const timelineResult = analyzeBusinessMutation({ businessId: 'timeline', beforePayload: before, afterPayload: buffAfter });
  assert.equal(timelineResult.pass, false);
  assert.match(timelineResult.unexplainedChanges.join(','), /changed-surviving-button-buff/);

  const removalAfter = structuredClone(before);
  delete removalAfter.skillButtonTable['button-a'];
  removalAfter.timelineData.staffLines[0].buttons = [];
  removalAfter.timelineData.staffLines[0].occupiedNodes = [];
  removalAfter.allBuffList = [];
  const removal = analyzeBusinessMutation({
    businessId: 'timeline',
    beforePayload: before,
    afterPayload: removalAfter,
  });
  assert.equal(removal.pass, true);
  assert.deepEqual(removal.productCascades, ['buff']);
  assert.deepEqual(removal.cascadeDetails.removedButtonIds, ['button-a']);
});

test('accepts deterministic selection cleanup but rejects unrelated additions', () => {
  const before = payload();
  const after = structuredClone(before);
  after.selectedCharacters = ['a'];
  delete after.skillButtonTable['button-b'];
  after.timelineData.staffLines = [after.timelineData.staffLines[0]];
  delete after.characterInputMap.b;
  delete after.operatorConfigPageCache.b;
  const valid = analyzeBusinessMutation({ businessId: 'selection', beforePayload: before, afterPayload: after });
  assert.equal(valid.pass, true);
  assert.deepEqual(valid.cascadeDetails.removedCharacterIds, ['b']);
  assert.deepEqual(valid.cascadeDetails.removedButtonIds, ['button-b']);

  const malicious = structuredClone(after);
  malicious.skillButtonTable['button-extra'] = button('button-extra', 'a', 5);
  const invalid = analyzeBusinessMutation({ businessId: 'selection', beforePayload: before, afterPayload: malicious });
  assert.equal(invalid.pass, false);
  assert.match(invalid.unexplainedChanges.join(','), /selection-cascade-added-buttons/);

  const changedRetainedBuff = structuredClone(after);
  changedRetainedBuff.skillButtonTable['button-a'].selectedBuff = [];
  const invalidBuff = analyzeBusinessMutation({
    businessId: 'selection',
    beforePayload: before,
    afterPayload: changedRetainedBuff,
  });
  assert.equal(invalidBuff.pass, false);
  assert.match(invalidBuff.unexplainedChanges.join(','), /changed-surviving-button-buff/);

  const changedRetainedLoadout = structuredClone(after);
  changedRetainedLoadout.characterInputMap.a.level = 80;
  const invalidLoadout = analyzeBusinessMutation({
    businessId: 'selection',
    beforePayload: before,
    afterPayload: changedRetainedLoadout,
  });
  assert.equal(invalidLoadout.pass, false);
  assert.match(invalidLoadout.unexplainedChanges.join(','), /changed-character-input/);
});

test('allows calculation recomputation only without source-state writes', () => {
  const before = payload();
  const after = structuredClone(before);
  after.characterComputedMap.total = 2;
  const calculation = analyzeBusinessMutation({ businessId: 'calculation', beforePayload: before, afterPayload: after });
  assert.equal(calculation.pass, true);
  assert.deepEqual(calculation.recalculations, ['characterComputedMap']);
  after.marker = 'changed';
  const invalid = analyzeBusinessMutation({ businessId: 'calculation', beforePayload: before, afterPayload: after });
  assert.equal(invalid.pass, false);
  assert.deepEqual(invalid.unexplainedChanges, ['unknown:marker']);
});

test('serializes commits, checks scheme CAS, scope and postcondition before completion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-mutation-commit-'));
  const coordinator = new MutationCommitCoordinator({ lockDirectory: path.join(root, 'locks'), lockTimeoutMs: 75 });
  const transaction = {
    transactionId: 'tx-a',
    timelineId: 'timeline-a',
    checkoutId: 'node-a',
    currentSchemeVersion: 'scheme-a',
    businessId: 'buff',
  };
  let committed = 0;
  const before = payload();
  const after = structuredClone(before);
  after.skillButtonTable['button-a'].selectedBuff = [];
  const success = await coordinator.withCommit({
    transaction,
    readSchemeVersion: async () => 'scheme-a',
    prepare: async () => ({ beforePayload: before, afterPayload: after }),
    commit: async () => {
      committed += 1;
      return { postcondition: { pass: true } };
    },
  });
  assert.equal(success.semantic.pass, true);
  assert.equal(committed, 1);

  await assert.rejects(() => coordinator.withCommit({
    transaction,
    readSchemeVersion: async () => 'scheme-new',
    prepare: async () => ({ beforePayload: before, afterPayload: after }),
    commit: async () => ({ postcondition: { pass: true } }),
  }), { code: 'HARNESS_MUTATION_SCHEME_CONFLICT' });

  const outOfScope = structuredClone(before);
  outOfScope.skillButtonTable['button-a'].nodeIndex = 4;
  await assert.rejects(() => coordinator.withCommit({
    transaction,
    readSchemeVersion: async () => 'scheme-a',
    prepare: async () => ({ beforePayload: before, afterPayload: outOfScope }),
    commit: async () => {
      committed += 1;
      return { postcondition: { pass: true } };
    },
  }), { code: 'HARNESS_MUTATION_WRITE_SCOPE_VIOLATION' });
  assert.equal(committed, 1);
});

test('marks downstream transactions continue, stale, hard-invalid or recompute', () => {
  const sessionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-downstream-'));
  const store = new BusinessTransactionStore({ sessionDirectory });
  const context = {
    sessionId: 'session-a',
    timelineId: 'timeline-a',
    checkoutId: 'node-a',
    schemeVersion: 'scheme-a',
  };
  const make = (businessId) => store.create({
    context,
    businessId,
    operation: 'inspect',
    harnessRevision: { version: 'v1', contentHash: `hash-${businessId}` },
  });
  const source = make('selection');
  const loadout = make('loadout');
  const timeline = make('timeline');
  const buff = make('buff');
  const calculation = make('calculation');
  const outcomes = applyDownstreamEffects({
    transactionStore: store,
    sourceTransactionId: source.transactionId,
    sourceBusiness: 'selection',
    effects: { removedCharacterIds: ['b'] },
    newSchemeVersion: 'scheme-b',
  });
  assert.equal(outcomes.find((entry) => entry.transactionId === loadout.transactionId).disposition, 'stale');
  assert.equal(outcomes.find((entry) => entry.transactionId === timeline.transactionId).disposition, 'hard-invalid');
  assert.equal(outcomes.find((entry) => entry.transactionId === buff.transactionId).disposition, 'hard-invalid');
  assert.equal(outcomes.find((entry) => entry.transactionId === calculation.transactionId).disposition, 'recompute');
  assert.equal(store.get(calculation.transactionId).recomputeRequired, true);
  assert.equal(store.get(calculation.transactionId).currentSchemeVersion, 'scheme-b');
});
