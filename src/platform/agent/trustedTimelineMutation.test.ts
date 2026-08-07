import assert from 'node:assert/strict';
import type { CandidateBuff } from '../../core/domain/buff';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  bindTrustedTimelineMutation,
  TrustedTimelineMutationError,
  type TrustedTimelineSkillFact,
} from './trustedTimelineMutation';

function fixture(): TimelineSnapshotPayload {
  return {
    selectedCharacters: ['operator-test'],
    timelineData: {
      version: '1.0.0',
      createdAt: 1,
      updatedAt: 1,
      staffLines: [{
        staffIndex: 0,
        characterName: '测试干员',
        occupiedNodes: [0],
        buttons: [{
          id: 'button-a',
          characterId: 'operator-test',
          characterName: '测试干员',
          skillType: 'A',
          staffIndex: 0,
          lineIndex: 0,
          nodeIndex: 0,
          nodeNumber: 1,
          position: { x: 80, y: 60 },
          runtimeSkillId: 'skill-a',
          skillDisplayName: '可信 A',
          buffIds: ['buff-existing'],
        }],
      }],
    },
    skillButtonTable: {
      'button-a': {
        id: 'button-a',
        characterId: 'operator-test',
        characterName: '测试干员',
        skillType: 'A',
        staffIndex: 0,
        lineIndex: 0,
        nodeIndex: 0,
        nodeNumber: 1,
        position: { x: 80, y: 60 },
        runtimeSkillId: 'skill-a',
        skillDisplayName: '可信 A',
        selectedBuff: ['buff-existing'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    allBuffList: [{
      id: 'buff-existing',
      name: 'existing',
      displayName: '已有 Buff',
      sourceName: '可信来源',
      type: 'atkPct',
      value: 0.1,
      category: 'condition',
      refCount: 1,
    }],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

const skills: TrustedTimelineSkillFact[] = [
  {
    characterId: 'operator-test',
    characterName: '测试干员',
    skillId: 'skill-a',
    skillType: 'A',
    skillDisplayName: '可信 A',
  },
  {
    characterId: 'operator-test',
    characterName: '测试干员',
    skillId: 'skill-b-1',
    skillType: 'B',
    skillDisplayName: '可信 B 一段',
  },
  {
    characterId: 'operator-test',
    characterName: '测试干员',
    skillId: 'skill-b-2',
    skillType: 'B',
    skillDisplayName: '可信 B 二段',
  },
];

const candidates: CandidateBuff[] = [{
  schemaVersion: 2,
  name: 'candidate',
  displayName: '候选 Buff',
  sourceName: '可信来源',
  source: '测试干员',
  level: '1',
  description: '可信定义',
  type: 'atkPct',
  value: 0.2,
  category: 'countable',
  maxStacks: 3,
  origin: 'operatorConfigSnapshot',
  ownerBuffDomain: 'operator',
  ownerCharacterId: 'operator-test',
  ownerBuffGroup: 'skill',
}];

const bound = bindTrustedTimelineMutation({
  payload: fixture(),
  skillCatalog: skills,
  candidateBuffs: candidates,
  patch: [
    {
      op: 'addButton',
      characterName: '测试干员',
      runtimeSkillId: 'skill-b-2',
      nodeIndex: 1,
    },
    {
      op: 'attachBuff',
      target: { buttonId: 'button-a' },
      buff: {
        name: 'candidate',
        displayName: '候选 Buff',
        sourceName: '可信来源',
        source: '测试干员',
        level: '1',
        description: '可信定义',
        type: 'atkPct',
        value: 0.2,
        category: 'countable',
        maxStacks: 3,
        ownerBuffDomain: 'operator',
        ownerCharacterId: 'operator-test',
        ownerBuffGroup: 'skill',
        target: { mode: 'skillType', skillType: 'A' },
      },
      stackCount: 2,
    },
    {
      op: 'attachBuff',
      target: { buttonId: 'button-a' },
      buffId: 'buff-existing',
    },
  ],
});

assert.deepEqual(bound[0], {
  op: 'addButton',
  characterId: 'operator-test',
  characterName: '测试干员',
  runtimeSkillId: 'skill-b-2',
  skillDisplayName: '可信 B 二段',
  skillType: 'B',
  staffIndex: 0,
  lineIndex: undefined,
  nodeIndex: 1,
});
assert.equal(bound[1]?.op, 'attachBuff');
if (bound[1]?.op !== 'attachBuff') throw new Error('trusted candidate Buff was not bound');
assert.equal(bound[1].buff?.value, 0.2);
assert.deepEqual(bound[1].buff?.target, { mode: 'skillType', skillType: 'A' });
assert.equal(bound[1].buff?.refCount, undefined);
assert.equal(bound[2]?.op, 'attachBuff');
if (bound[2]?.op !== 'attachBuff') throw new Error('existing Buff was not bound');
assert.equal(bound[2].buffId, 'buff-existing');
assert.equal(bound[2].buff, undefined);

function expectError(code: string, patch: Parameters<typeof bindTrustedTimelineMutation>[0]['patch']) {
  assert.throws(
    () => bindTrustedTimelineMutation({ payload: fixture(), skillCatalog: skills, candidateBuffs: candidates, patch }),
    (error: unknown) => error instanceof TrustedTimelineMutationError && error.code === code,
  );
}

expectError('SKILL_IDENTITY_REQUIRED', [{
  op: 'addButton',
  characterName: '测试干员',
  skillType: 'B',
  nodeIndex: 1,
}]);
expectError('SKILL_FACT_UNTRUSTED', [{
  op: 'replaceButton',
  target: { buttonId: 'button-a' },
  runtimeSkillId: 'fabricated-skill',
}]);
expectError('BUFF_FACT_UNTRUSTED', [{
  op: 'attachBuff',
  target: { buttonId: 'button-a' },
  buff: {
    name: 'candidate',
    displayName: '候选 Buff',
    sourceName: '可信来源',
    source: '测试干员',
    level: '1',
    description: '可信定义',
    type: 'atkPct',
    value: 999,
    category: 'countable',
    maxStacks: 3,
    ownerBuffDomain: 'operator',
    ownerCharacterId: 'operator-test',
    ownerBuffGroup: 'skill',
  },
}]);
expectError('BUFF_ID_UNTRUSTED', [{
  op: 'replaceBuff',
  target: { buttonId: 'button-a' },
  buffId: 'buff-existing',
  replacementBuffId: 'fabricated-buff-id',
}]);

console.log('Trusted timeline mutation contract: PASS');
