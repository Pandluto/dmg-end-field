import assert from 'node:assert/strict';
import {
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type DefToolExecutionContext,
  type JsonObject,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../contracts/index.ts';
import { DefReadToolRegistry } from './read-only-workbench.ts';

const binding: ProductBinding = {
  workspaceId: asWorkspaceId('workspace-buff-facts'),
  databaseGeneration: asDatabaseGeneration('generation-buff-facts'),
  timelineId: asTimelineId('timeline-buff-facts'),
  checkoutTargetId: 'node-buff-facts',
  checkoutUpdatedAt: 42,
  contentRevision: 42,
  snapshotDigest: 'sha256:buff-facts',
};

const skillBuff = {
  schemaVersion: 2,
  id: 'buff-fragile-skill',
  name: 'fragile',
  displayName: '易伤',
  sourceName: '洛茜技能',
  level: 'M3',
  type: 'damageTaken',
  value: 0.2,
  description: '技能来源的易伤',
  source: 'operator-skill',
  condition: '目标处于导电状态',
  category: 'condition',
  effectKind: 'modifier',
  ownerBuffDomain: 'operator',
  ownerCharacterId: 'operator-a',
  ownerBuffGroup: 'skill',
  maxStacks: null,
  refCount: 1,
  multiplier: { coefficient: 1.2 },
  target: { mode: 'damageKey', key: 'hit-2' },
  valueMode: 'fixed',
  derivedValue: null,
  extraHitConfig: null,
};

const equipmentBuff = {
  ...skillBuff,
  id: skillBuff.id,
  sourceName: '测试护甲',
  source: 'equipment-effect',
  description: '装备来源的易伤',
  condition: null,
  ownerBuffDomain: 'equipment',
  ownerCharacterId: 'operator-a',
  ownerBuffGroup: 'threePiece',
  target: { mode: 'element', element: 'fire' },
};

const stackBuff = {
  schemaVersion: 2,
  id: 'buff-stack',
  name: 'stacking',
  displayName: '可叠层 Buff',
  sourceName: '测试天赋',
  level: null,
  type: 'attackPercent',
  value: 0.1,
  description: '最多五层',
  source: 'operator-talent',
  condition: '每次命中增加一层',
  category: 'countable',
  effectKind: 'modifier',
  ownerBuffDomain: 'operator',
  ownerCharacterId: 'operator-a',
  ownerBuffGroup: 'talent',
  maxStacks: 5,
  refCount: 2,
  multiplier: null,
  target: { mode: 'all' },
  valueMode: 'derived',
  derivedValue: { source: 'agility', perPointValue: 0.01 },
  extraHitConfig: null,
};

const sparseBuff = {
  id: 'buff-sparse',
  name: 'sparse',
  displayName: '空字段 Buff',
  sourceName: '未知来源',
  refCount: 1,
};

let currentSnapshot: ProductSnapshotEnvelope = {
  protocolVersion: 1,
  binding,
  capturedAt: '2026-08-08T00:00:00.000Z',
  payload: {
    schemaVersion: 1,
    currentView: 'canvas',
    selectedCharacters: [{
      id: 'operator-a',
      name: '洛茜',
      element: 'fire',
      profession: '近卫',
      librarySource: 'local',
    }],
    skillButtons: [{
      id: 'button-a',
      characterId: 'operator-a',
      characterName: '洛茜',
      skillType: 'E',
      runtimeSkillId: 'skill-e',
      skillDisplayName: '燃烧斩',
      staffIndex: 0,
      lineIndex: 0,
      persistenceStaffIndex: 0,
      persistenceNodeIndex: 2,
      selectedBuffIds: [skillBuff.id, stackBuff.id, sparseBuff.id],
      selectedBuffs: [skillBuff, stackBuff, sparseBuff],
      currentStackCounts: { [skillBuff.id]: 1, [stackBuff.id]: 3, [sparseBuff.id]: 1 },
      globallyDisabledBuffIds: [sparseBuff.id],
      manualDisabledBuffIdsBySegmentKey: { 'normal-hit-2': [skillBuff.id] },
      manualBuffStackCountsBySegmentKey: { 'normal-hit-2': { [stackBuff.id]: 2 } },
      manualDisabledHitKeys: ['hit-3'],
      targetResistance: {
        physicalResistance: 35,
        fireResistance: 12,
        electricResistance: null,
        iceResistance: null,
        natureResistance: null,
      },
    }],
    operatorConfigs: [{
      characterId: 'operator-a',
      characterName: '洛茜',
      weapon: null,
      equipment: [{
        slotKey: 'armor',
        equipmentId: 'equipment-a',
        name: '测试护甲',
        part: '护甲',
        effects: [{
          effectId: equipmentBuff.id,
          label: equipmentBuff.displayName,
          typeKey: equipmentBuff.type,
          value: equipmentBuff.value,
          category: equipmentBuff.category,
          effectKind: equipmentBuff.effectKind,
        }],
      }],
      setBuffs: [],
    }],
  },
};

const context: DefToolExecutionContext = {
  defSessionId: asDefSessionId('session-buff-facts'),
  defTurnId: asDefTurnId('turn-buff-facts'),
  toolCallId: asToolCallId('tool-buff-facts'),
  binding,
  product: {
    async getSnapshot(expected) {
      assert.deepEqual(expected, binding);
      return JSON.parse(JSON.stringify(currentSnapshot)) as ProductSnapshotEnvelope;
    },
  },
  abortSignal: new AbortController().signal,
};

const registry = new DefReadToolRegistry();
const timeline = await registry.execute('def.node.crud.current', {}, context) as JsonObject;
const button = (timeline.buttons as JsonObject[])[0]!;
assert.equal(button.selectedBuffCount, 3);
assert.deepEqual(button.selectedBuffIds, [
  skillBuff.id,
  stackBuff.id,
  sparseBuff.id,
]);
assert.deepEqual(button.currentStackCounts, {
  [skillBuff.id]: 1,
  [sparseBuff.id]: 1,
  [stackBuff.id]: 3,
});
assert.deepEqual(button.currentStackCountSources, {
  [skillBuff.id]: 'persisted',
  [sparseBuff.id]: 'persisted',
  [stackBuff.id]: 'persisted',
});
assert.deepEqual(button.globallyDisabledBuffIds, [sparseBuff.id]);
assert.deepEqual(button.manualDisabledBuffIdsBySegmentKey, {
  'normal-hit-2': [skillBuff.id],
});
assert.deepEqual(button.manualBuffStackCountsBySegmentKey, {
  'normal-hit-2': { [stackBuff.id]: 2 },
});
assert.deepEqual(button.manualDisabledHitKeys, ['hit-3']);
assert.deepEqual(button.targetResistance, {
  electricResistance: null,
  fireResistance: 12,
  iceResistance: null,
  natureResistance: null,
  physicalResistance: 35,
});

const facts = button.selectedBuffs as JsonObject[];
const requiredFactKeys = [
  'schemaVersion', 'id', 'name', 'displayName', 'sourceName', 'level', 'type',
  'value', 'description', 'source', 'condition', 'category', 'effectKind',
  'ownerBuffDomain', 'ownerCharacterId', 'ownerBuffGroup', 'maxStacks', 'refCount',
  'multiplier', 'target', 'valueMode', 'derivedValue', 'extraHitConfig',
];
for (const row of facts) {
  for (const key of requiredFactKeys) assert.ok(key in row, `missing Buff fact field: ${key}`);
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row);
}
const sparseFacts = facts.find((row) => row.id === sparseBuff.id)!;
assert.equal(sparseFacts.condition, null);
assert.equal(sparseFacts.target, null);
assert.equal(sparseFacts.maxStacks, null);
assert.equal(sparseFacts.multiplier, null);
assert.equal(sparseFacts.extraHitConfig, null);

const resolved = await registry.execute(
  'def.data.resource.buff',
  { query: '易伤' },
  context,
) as JsonObject;
assert.deepEqual(resolved.binding, {
  workspaceId: binding.workspaceId,
  databaseGeneration: binding.databaseGeneration,
  timelineId: binding.timelineId,
  checkoutTargetId: binding.checkoutTargetId,
  checkoutUpdatedAt: binding.checkoutUpdatedAt,
  contentRevision: binding.contentRevision,
  snapshotDigest: binding.snapshotDigest,
});
assert.equal(resolved.candidateCount, 2, 'same-name Buffs from different sources must stay distinct');
assert.equal(resolved.truncated, false);
const candidates = resolved.candidates as JsonObject[];
assert.deepEqual(
  candidates.map((candidate) => (candidate.facts as JsonObject).sourceName).sort(),
  ['洛茜技能', '测试护甲'],
);
const skillCandidate = candidates.find((candidate) => (
  (candidate.facts as JsonObject).sourceName === '洛茜技能'
))!;
const equipmentCandidate = candidates.find((candidate) => (
  (candidate.facts as JsonObject).sourceName === '测试护甲'
))!;
assert.deepEqual((skillCandidate.facts as JsonObject).multiplier, { coefficient: 1.2 });
assert.equal((equipmentCandidate.facts as JsonObject).ownerBuffGroup, null);
for (const candidate of candidates) {
  const candidateFacts = candidate.facts as JsonObject;
  const evidence = (candidate.evidence as JsonObject[])[0]!;
  assert.equal(evidence.buttonId, candidateFacts.sourceName === '洛茜技能' ? 'button-a' : null);
  assert.equal(evidence.characterId, 'operator-a');
  assert.equal(evidence.sourceName, candidateFacts.sourceName);
  assert.deepEqual(evidence.snapshotBinding, resolved.binding);
  assert.equal(candidate.evidenceTruncated, false);
  if (candidateFacts.sourceName === '洛茜技能') {
    assert.equal((candidateFacts.target as JsonObject).mode, 'damageKey');
  } else {
    assert.equal(candidateFacts.target, null);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(candidate)), candidate);
}

// The bound result remains bounded even when the snapshot contains more than
// the response limit; callers can distinguish truncation from an empty source.
const manyBuffs = Array.from({ length: 201 }, (_, index) => ({
  id: `buff-${index}`,
  name: `buff-${index}`,
  displayName: `批量 Buff ${index}`,
  sourceName: '批量来源',
  type: 'attackPercent',
  value: index / 1000,
  refCount: 1,
}));
currentSnapshot = {
  ...currentSnapshot,
  payload: {
    ...currentSnapshot.payload,
    operatorConfigs: [],
    skillButtons: [{
      ...(currentSnapshot.payload.skillButtons as JsonObject[])[0]!,
      selectedBuffIds: manyBuffs.map((buff) => buff.id),
      selectedBuffs: manyBuffs,
    }],
  },
};
const bounded = await registry.execute('def.data.resource.buff', {}, context) as JsonObject;
assert.equal(bounded.candidateCount, 201);
assert.equal(bounded.truncated, true);
assert.equal((bounded.candidates as JsonObject[]).length, 200);

console.log('DEF_READ_ONLY_WORKBENCH_BUFF_CONTRACT_OK');
