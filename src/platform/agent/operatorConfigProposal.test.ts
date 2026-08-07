import assert from 'node:assert/strict';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { diffTimelinePayloads } from '../../agentKernel/timelineWorktree/diff';
import {
  buildOperatorConfigFinalConfig,
  buildOperatorConfigProposalDigest,
  buildTimelinePreservation,
  digestJson,
  equalOperatorConfigFinalConfig,
  normalizeOperatorConfigFinalConfig,
} from './operatorConfigProposal';

function payload(weaponName = '旧武器'): TimelineSnapshotPayload {
  return {
    selectedCharacters: ['operator-test'],
    timelineData: {
      version: '1.0.0',
      createdAt: 1,
      updatedAt: 1,
      staffLines: [{ staffIndex: 0, characterName: '测试干员', occupiedNodes: [], buttons: [] }],
    },
    skillButtonTable: {},
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {
      'operator-test': {
        operator: {
          id: 'operator-test',
          name: '测试干员',
          level: 90,
          potential: '0潜',
          potentialCount: 0,
          element: 'physical',
          mainStat: '敏捷',
          subStat: '智识',
          mainStatFlatBonus: 0,
          subStatFlatBonus: 0,
          skillConfig: { A: 'L9', B: 'L9', E: 'L9', Q: 'L9', Dot: 'L9' },
          baseAttributes: {},
          buffs: {},
        },
        weapon: {
          id: weaponName,
          name: weaponName,
          config: { level: 90, potential: '0潜', skillLevels: { skill1: 5, skill2: 5, skill3: 5 } },
          attack: 100,
        },
        equipment: { pieces: [], setBuffs: [] },
        panel: {},
        buff: { operator: [], weapon: [], equipment: [] },
        detailMarkdown: '',
      },
    } as TimelineSnapshotPayload['operatorConfigPageCache'],
  };
}

const base = payload();
const working = structuredClone(base);
(working.operatorConfigPageCache['operator-test'] as any).weapon.name = '新武器';
(working.operatorConfigPageCache['operator-test'] as any).weapon.id = 'new-weapon';

const diff = diffTimelinePayloads(base, working);
assert.equal(diff.changedOperatorConfigs.length, 1);
const finalConfig = buildOperatorConfigFinalConfig(working, 'operator-test');
assert.ok(finalConfig);
assert.equal(finalConfig?.weapon.id, 'new-weapon');
assert.equal(
  equalOperatorConfigFinalConfig(
    finalConfig,
    normalizeOperatorConfigFinalConfig({
      ...finalConfig,
      weapon: { ...finalConfig!.weapon, skillLevels: { ...finalConfig!.weapon.skillLevels } },
    }),
  ),
  true,
);

const preservation = await buildTimelinePreservation(base, working);
assert.equal(preservation.pass, true, 'loadout-only candidate must preserve timeline fields');
assert.deepEqual(preservation.changedPaths, []);
assert.deepEqual(base.selectedCharacters, ['operator-test'], 'prepare must not mutate the parent payload');

const proposalDigest = await buildOperatorConfigProposalDigest({
  parentNodeId: 'parent-node',
  parentRevision: 10,
  nodeId: 'candidate-node',
  nodeRevision: 11,
  finalConfig: finalConfig!,
  diff,
  timelinePreservation: preservation,
  workingPayload: working,
});
assert.match(proposalDigest, /^sha256:[0-9a-f]{64}$/u);
assert.equal(
  proposalDigest,
  await buildOperatorConfigProposalDigest({
    parentNodeId: 'parent-node',
    parentRevision: 10,
    nodeId: 'candidate-node',
    nodeRevision: 11,
    finalConfig: finalConfig!,
    diff,
    timelinePreservation: preservation,
    workingPayload: working,
  }),
  'proposal digest must be stable for the same candidate',
);

// A stale parent revision or changed candidate payload cannot reuse the old
// approval digest.
const staleRevisionDigest = await buildOperatorConfigProposalDigest({
  parentNodeId: 'parent-node',
  parentRevision: 11,
  nodeId: 'candidate-node',
  nodeRevision: 11,
  finalConfig: finalConfig!,
  diff,
  timelinePreservation: preservation,
  workingPayload: working,
});
assert.notEqual(staleRevisionDigest, proposalDigest);
const changedCandidate = payload('第三把武器');
const changedDiff = diffTimelinePayloads(base, changedCandidate);
const changedPreservation = await buildTimelinePreservation(base, changedCandidate);
const changedConfig = buildOperatorConfigFinalConfig(changedCandidate, 'operator-test');
assert.ok(changedConfig);
assert.notEqual(
  await buildOperatorConfigProposalDigest({
    parentNodeId: 'parent-node',
    parentRevision: 10,
    nodeId: 'candidate-node',
    nodeRevision: 11,
    finalConfig: changedConfig!,
    diff: changedDiff,
    timelinePreservation: changedPreservation,
    workingPayload: changedCandidate,
  }),
  proposalDigest,
);

const changedTimeline = structuredClone(working);
changedTimeline.timelineData.staffLines[0].occupiedNodes = [1];
const failedPreservation = await buildTimelinePreservation(base, changedTimeline);
assert.equal(failedPreservation.pass, false, 'a candidate that changes timeline nodes must fail closed');
assert.ok(failedPreservation.changedPaths.includes('timelineData'));

assert.equal((await digestJson(base)) !== await digestJson(working), true);

console.log('Operator config proposal lifecycle contract passed');

