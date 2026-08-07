import assert from 'node:assert/strict';
import type { CandidateBuff } from '../../core/domain/buff';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  bindTrustedTimelineMutation,
  TrustedTimelineMutationError,
  type TrustedTimelineSkillFact,
} from '../../platform/agent/trustedTimelineMutation';

function payload(): TimelineSnapshotPayload {
  return {
    selectedCharacters: ['operator-trusted'],
    timelineData: {
      version: '1.0.0',
      createdAt: 1,
      updatedAt: 1,
      staffLines: [{
        staffIndex: 0,
        characterName: '可信干员',
        occupiedNodes: [0],
        buttons: [{
          id: 'button-trusted',
          characterId: 'operator-trusted',
          characterName: '可信干员',
          skillType: 'A',
          staffIndex: 0,
          lineIndex: 0,
          nodeIndex: 0,
          nodeNumber: 1,
          position: { x: 80, y: 60 },
          runtimeSkillId: 'skill-a',
          skillDisplayName: '可信 A',
          buffIds: [],
        }],
      }],
    },
    skillButtonTable: {
      'button-trusted': {
        id: 'button-trusted',
        characterId: 'operator-trusted',
        characterName: '可信干员',
        skillType: 'A',
        staffIndex: 0,
        lineIndex: 0,
        nodeIndex: 0,
        nodeNumber: 1,
        position: { x: 80, y: 60 },
        runtimeSkillId: 'skill-a',
        skillDisplayName: '可信 A',
        selectedBuff: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

const skillCatalog: TrustedTimelineSkillFact[] = [{
  characterId: 'operator-trusted',
  characterName: '可信干员',
  skillId: 'skill-b-trusted',
  skillType: 'B',
  skillDisplayName: '可信 B',
}];

const candidateBuff: CandidateBuff = {
  schemaVersion: 2,
  name: 'trusted-buff',
  displayName: '可信 Buff',
  source: '可信干员',
  sourceName: '可信来源',
  level: '1',
  description: '来自浏览器候选目录',
  type: 'atkPct',
  value: 0.2,
  category: 'countable',
  maxStacks: 3,
  origin: 'operatorConfigSnapshot',
  ownerBuffDomain: 'operator',
  ownerCharacterId: 'operator-trusted',
  ownerBuffGroup: 'skill',
};

const trustedPatch: Parameters<typeof bindTrustedTimelineMutation>[0]['patch'] = [
  {
    op: 'addButton',
    characterName: '可信干员',
    staffIndex: 0,
    runtimeSkillId: 'skill-b-trusted',
    nodeIndex: 1,
  },
  {
    op: 'attachBuff',
    target: { buttonId: 'button-trusted' },
    buff: {
      name: candidateBuff.name,
      displayName: candidateBuff.displayName,
      source: candidateBuff.source,
      sourceName: candidateBuff.sourceName,
      level: candidateBuff.level,
      description: candidateBuff.description,
      type: candidateBuff.type,
      value: candidateBuff.value,
      category: candidateBuff.category,
      maxStacks: candidateBuff.maxStacks,
      ownerBuffDomain: candidateBuff.ownerBuffDomain,
      ownerCharacterId: candidateBuff.ownerCharacterId,
      ownerBuffGroup: candidateBuff.ownerBuffGroup,
    },
  },
];

const bound = bindTrustedTimelineMutation({
  payload: payload(),
  patch: trustedPatch,
  skillCatalog,
  candidateBuffs: [candidateBuff],
});

assert.equal(bound[0]?.op, 'addButton');
if (bound[0]?.op !== 'addButton') throw new Error('trusted skill was not normalized');
assert.equal(bound[0].characterId, 'operator-trusted');
assert.equal(bound[0].skillType, 'B');
assert.equal(bound[0].runtimeSkillId, 'skill-b-trusted');
assert.equal(bound[0].skillDisplayName, '可信 B');
assert.equal(bound[0].staffIndex, 0);
assert.equal(bound[0].lineIndex, undefined);

assert.equal(bound[1]?.op, 'attachBuff');
if (bound[1]?.op !== 'attachBuff') throw new Error('trusted Buff was not normalized');
assert.equal(bound[1].buff?.name, 'trusted-buff');
assert.equal(bound[1].buff?.value, 0.2);
assert.equal(bound[1].buff?.maxStacks, 3);

assert.throws(
  () => bindTrustedTimelineMutation({
    payload: payload(),
    skillCatalog,
    candidateBuffs: [candidateBuff],
    patch: [{
      op: 'replaceButton',
      target: { buttonId: 'button-trusted' },
      runtimeSkillId: 'model-invented-skill',
    }],
  }),
  (error: unknown) => error instanceof TrustedTimelineMutationError && error.code === 'SKILL_FACT_UNTRUSTED',
);

assert.throws(
  () => bindTrustedTimelineMutation({
    payload: payload(),
    skillCatalog,
    candidateBuffs: [candidateBuff],
    patch: [{
      op: 'attachBuff',
      target: { buttonId: 'button-trusted' },
      buff: {
        name: candidateBuff.name,
        displayName: candidateBuff.displayName,
        source: candidateBuff.source,
        sourceName: candidateBuff.sourceName,
        level: candidateBuff.level,
        description: candidateBuff.description,
        type: candidateBuff.type,
        value: 999,
        category: candidateBuff.category,
        maxStacks: candidateBuff.maxStacks,
        ownerBuffDomain: candidateBuff.ownerBuffDomain,
        ownerCharacterId: candidateBuff.ownerCharacterId,
        ownerBuffGroup: candidateBuff.ownerBuffGroup,
      },
    }],
  }),
  (error: unknown) => error instanceof TrustedTimelineMutationError && error.code === 'BUFF_FACT_UNTRUSTED',
);

console.log('Canvas prepared Work Node trust contract: PASS');
