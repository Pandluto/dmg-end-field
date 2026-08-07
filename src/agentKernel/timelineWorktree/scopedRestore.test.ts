import assert from 'node:assert/strict';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  restoreBuffScope,
  restoreResistanceScope,
  restoreTimelineScope,
  type ScopedRestoreResult,
} from './scopedRestore';

type AnyRecord = Record<string, any>;

function buff(id: string, name = id, extra: AnyRecord = {}): AnyRecord {
  return {
    id,
    name,
    displayName: name,
    sourceName: '测试来源',
    refCount: 99,
    category: 'countable',
    maxStacks: 5,
    value: 10,
    futureBuffField: { id, nested: true },
    ...extra,
  };
}

function button(
  id: string,
  characterId: string,
  staffIndex: number,
  nodeIndex: number,
  selectedBuff: string[] = [],
  extra: AnyRecord = {},
): AnyRecord {
  return {
    id,
    characterId,
    characterName: characterId === 'operator-a' ? '测试员 A' : '测试员 B',
    skillType: 'A',
    staffIndex,
    lineIndex: staffIndex,
    nodeIndex,
    nodeNumber: nodeIndex + 1,
    position: { x: nodeIndex * 10, y: staffIndex * 100 },
    runtimeSkillId: `${id}-skill`,
    skillDisplayName: `${id} 技能`,
    skillIconUrl: `${id}.svg`,
    customHits: [{ key: 'hit-1', displayName: '一段', multiplier: 1, element: 'physical', skillType: 'A' }],
    selectedBuff: [...selectedBuff],
    buffStackCounts: Object.fromEntries(selectedBuff.map((buffId) => [buffId, 1])),
    panelConfig: {
      selectedBuff: [...selectedBuff],
      globallyDisabledBuffIds: [],
      manualDisabledBuffIdsBySegmentKey: {},
      manualBuffStackCountsBySegmentKey: {},
      manualDisabledHitKeys: [],
    },
    runtimeSnapshot: { atk: 100, critRate: 0.1, critDmg: 0.5 },
    ...extra,
  };
}

function timelineButton(source: AnyRecord): AnyRecord {
  return {
    id: source.id,
    characterId: source.characterId,
    characterName: source.characterName,
    skillType: source.skillType,
    staffIndex: source.staffIndex,
    lineIndex: source.lineIndex,
    nodeIndex: source.nodeIndex,
    nodeNumber: source.nodeNumber,
    position: { ...source.position },
    runtimeSkillId: source.runtimeSkillId,
    skillDisplayName: source.skillDisplayName,
    skillIconUrl: source.skillIconUrl,
    customHits: structuredClone(source.customHits),
    buffIds: [...source.selectedBuff],
    timelineOnlyUnknown: { source: source.id },
  };
}

function makePayload(options: {
  buttons: AnyRecord[];
  buffs: AnyRecord[];
  selectedCharacters?: string[];
  inputTag?: string;
  configTag?: string;
  payloadTag?: string;
}): TimelineSnapshotPayload {
  const selectedCharacters = options.selectedCharacters ?? ['operator-a', 'operator-b'];
  const byStaff = new Map<number, AnyRecord[]>();
  for (const item of options.buttons) {
    const list = byStaff.get(item.staffIndex) ?? [];
    list.push(timelineButton(item));
    byStaff.set(item.staffIndex, list);
  }

  const staffLines = selectedCharacters.map((characterId, staffIndex) => {
    const buttons = byStaff.get(staffIndex) ?? [];
    return {
      staffIndex,
      characterName: characterId === 'operator-a' ? '测试员 A' : '测试员 B',
      occupiedNodes: buttons.map((item) => item.nodeIndex),
      buttons,
      lineUnknown: `line-${characterId}`,
    };
  });

  return {
    selectedCharacters: [...selectedCharacters],
    timelineData: {
      version: 'test',
      createdAt: 1,
      updatedAt: 2,
      staffLines,
      timelineUnknown: options.payloadTag ?? 'payload',
    },
    skillButtonTable: Object.fromEntries(options.buttons.map((item) => [item.id, structuredClone(item)])),
    allBuffList: options.buffs.map((item) => structuredClone(item)),
    anomalyStateSnapshots: [],
    characterInputMap: {
      'operator-a': { inputTag: options.inputTag ?? 'input' },
    } as never,
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {
      'operator-a': { configTag: options.configTag ?? 'config' },
    } as never,
    unknownPayloadField: options.payloadTag ?? 'payload',
  } as unknown as TimelineSnapshotPayload;
}

function mustSucceed(result: ScopedRestoreResult): Extract<ScopedRestoreResult, { ok: true }>['payload'] {
  assert.equal(result.ok, true, result.ok ? '' : result.message);
  return result.payload;
}

const currentShared = buff('shared', '当前共享 Buff');
const currentRemoved = buff('removed', '被删除按钮的 Buff');
const currentOrphan = buff('orphan', '孤儿 Buff');
const baselineOnlyBuff = buff('baseline-only', '基线新按钮 Buff');

const currentTimelineButton = button('button-a', 'operator-a', 0, 8, ['shared'], {
  buffStackCounts: { shared: 4, stale: 88 },
  panelConfig: {
    selectedBuff: ['shared'],
    globallyDisabledBuffIds: ['shared', 'stale'],
    manualDisabledBuffIdsBySegmentKey: { 'hit-1': ['shared', 'stale'] },
    manualBuffStackCountsBySegmentKey: { 'hit-1': { shared: 4, stale: 88 } },
    manualDisabledHitKeys: ['hit-2'],
    currentPanelUnknown: 'keep-current',
  },
  resistanceConfig: { targetResistance: { physicalResistance: 77 } },
  runtimeSnapshot: { atk: 777, critRate: 0.77, critDmg: 0.77 },
  currentButtonUnknown: 'keep-current',
});
const currentDeletedButton = button('button-deleted', 'operator-b', 1, 6, ['removed']);
const baselineCommonButton = button('button-a', 'operator-a', 0, 1, ['baseline-only'], {
  baselineButtonUnknown: 'keep-baseline',
  resistanceConfig: { targetResistance: { physicalResistance: 11 } },
});
const baselineRestoredButton = button('button-restored', 'operator-b', 1, 3, ['baseline-only'], {
  baselineOnlyUnknown: 'keep-baseline',
});

const currentTimeline = makePayload({
  buttons: [currentTimelineButton, currentDeletedButton],
  buffs: [currentShared, currentRemoved, currentOrphan],
  inputTag: 'current-input',
  configTag: 'current-config',
  payloadTag: 'current-payload',
});
const baselineTimeline = makePayload({
  buttons: [baselineCommonButton, baselineRestoredButton],
  buffs: [baselineOnlyBuff],
  inputTag: 'baseline-input',
  configTag: 'baseline-config',
  payloadTag: 'baseline-payload',
});

const currentBeforeTimeline = structuredClone(currentTimeline);
const baselineBeforeTimeline = structuredClone(baselineTimeline);
const timelineRestored = mustSucceed(restoreTimelineScope(currentTimeline, baselineTimeline));

assert.deepEqual(currentTimeline, currentBeforeTimeline, 'timeline restore must not mutate current input');
assert.deepEqual(baselineTimeline, baselineBeforeTimeline, 'timeline restore must not mutate baseline input');
assert.deepEqual(timelineRestored.selectedCharacters, currentTimeline.selectedCharacters);
assert.deepEqual(timelineRestored.characterInputMap, currentTimeline.characterInputMap);
assert.deepEqual(timelineRestored.operatorConfigPageCache, currentTimeline.operatorConfigPageCache);
assert.equal((timelineRestored as AnyRecord).unknownPayloadField, 'current-payload');
assert.equal((timelineRestored.timelineData as AnyRecord).timelineUnknown, 'current-payload');
assert.deepEqual(
  Object.values(timelineRestored.skillButtonTable).map((item) => item.id),
  ['button-a', 'button-restored'],
);
assert.deepEqual(
  timelineRestored.timelineData.staffLines.flatMap((line) => line.buttons.map((item) => item.id)),
  ['button-a', 'button-restored'],
);
assert.equal(timelineRestored.skillButtonTable['button-a']?.nodeIndex, 1);
assert.equal(timelineRestored.skillButtonTable['button-a']?.position.x, 10);
assert.deepEqual(timelineRestored.skillButtonTable['button-a']?.selectedBuff, ['shared']);
assert.deepEqual(timelineRestored.skillButtonTable['button-a']?.buffStackCounts, { shared: 4 });
assert.deepEqual(timelineRestored.skillButtonTable['button-a']?.panelConfig?.globallyDisabledBuffIds, ['shared']);
assert.deepEqual(
  timelineRestored.skillButtonTable['button-a']?.panelConfig?.manualDisabledBuffIdsBySegmentKey,
  { 'hit-1': ['shared'] },
);
assert.deepEqual(timelineRestored.skillButtonTable['button-a']?.resistanceConfig, {
  targetResistance: { physicalResistance: 77 },
});
assert.equal(timelineRestored.skillButtonTable['button-a']?.currentButtonUnknown, 'keep-current');
assert.equal(timelineRestored.skillButtonTable['button-a']?.baselineButtonUnknown, 'keep-baseline');
assert.deepEqual(timelineRestored.skillButtonTable['button-restored']?.selectedBuff, []);
assert.equal(timelineRestored.skillButtonTable['button-restored']?.resistanceConfig, undefined);
assert.deepEqual(
  timelineRestored.allBuffList.map((item) => [item.id, item.refCount]),
  [['shared', 1]],
);
assert.equal(timelineRestored.allBuffList.some((item) => item.id === 'removed'), false);
assert.equal(timelineRestored.allBuffList.some((item) => item.id === 'orphan'), false);
assert.equal(timelineRestored.allBuffList.some((item) => item.id === 'baseline-only'), false);

const currentBuffButton = button('button-a', 'operator-a', 0, 9, ['current-only'], {
  runtimeSkillId: 'current-skill',
  skillDisplayName: '当前技能身份',
  resistanceConfig: { targetResistance: { physicalResistance: 99 } },
  panelConfig: {
    selectedBuff: ['current-only'],
    globallyDisabledBuffIds: ['current-only'],
    manualDisabledBuffIdsBySegmentKey: { 'normal-hit': ['current-only'] },
    manualBuffStackCountsBySegmentKey: { 'normal-hit': { 'current-only': 9 } },
    manualDisabledHitKeys: ['current-hit'],
    currentPanelUnknown: 'preserve-current-panel',
  },
  buffStackCounts: { 'current-only': 9 },
  runtimeSnapshot: { atk: 999, critRate: 0.99, critDmg: 0.99 },
});
const currentUnmatchedButton = button('button-current-only', 'operator-b', 1, 5, ['current-unmatched'], {
  resistanceConfig: { targetResistance: { physicalResistance: 55 } },
});
const baselineBuffButton = button('button-a', 'operator-a', 0, 1, ['baseline-shared', 'baseline-stack'], {
  runtimeSkillId: 'baseline-skill',
  skillDisplayName: '基线技能身份',
  resistanceConfig: { targetResistance: { physicalResistance: 1 } },
  buffStackCounts: { 'baseline-shared': 2, 'baseline-stack': 5 },
  panelConfig: {
    selectedBuff: ['baseline-shared', 'baseline-stack'],
    globallyDisabledBuffIds: ['baseline-stack'],
    manualDisabledBuffIdsBySegmentKey: { 'normal-hit': ['baseline-shared'] },
    manualBuffStackCountsBySegmentKey: { 'normal-hit': { 'baseline-stack': 5 } },
    manualDisabledHitKeys: ['baseline-hit'],
    baselinePanelUnknown: 'baseline-panel',
  },
  runtimeSnapshot: { atk: 222, critRate: 0.22, critDmg: 0.22 },
});
const baselineUnmatchedButton = button('button-baseline-only', 'operator-b', 1, 2, ['baseline-ignored']);

const currentBuff = makePayload({
  buttons: [currentBuffButton, currentUnmatchedButton],
  buffs: [buff('current-only'), buff('current-unmatched'), buff('orphan-buff')],
  inputTag: 'current-buff-input',
  configTag: 'current-buff-config',
});
const baselineBuff = makePayload({
  buttons: [baselineBuffButton, baselineUnmatchedButton],
  buffs: [buff('baseline-shared'), buff('baseline-stack'), buff('baseline-ignored')],
  inputTag: 'baseline-buff-input',
  configTag: 'baseline-buff-config',
});

const currentBeforeBuff = structuredClone(currentBuff);
const baselineBeforeBuff = structuredClone(baselineBuff);
const buffRestored = mustSucceed(restoreBuffScope(currentBuff, baselineBuff));

assert.deepEqual(currentBuff, currentBeforeBuff, 'Buff restore must not mutate current input');
assert.deepEqual(baselineBuff, baselineBeforeBuff, 'Buff restore must not mutate baseline input');
assert.deepEqual(buffRestored.selectedCharacters, currentBuff.selectedCharacters);
assert.deepEqual(buffRestored.characterInputMap, currentBuff.characterInputMap);
assert.deepEqual(buffRestored.operatorConfigPageCache, currentBuff.operatorConfigPageCache);
assert.deepEqual(Object.keys(buffRestored.skillButtonTable), ['button-a', 'button-current-only']);
assert.equal(buffRestored.skillButtonTable['button-a']?.nodeIndex, 9, 'Buff restore keeps current placement');
assert.equal(buffRestored.skillButtonTable['button-a']?.runtimeSkillId, 'current-skill');
assert.deepEqual(
  buffRestored.skillButtonTable['button-a']?.runtimeSnapshot,
  null,
  'Buff restore must invalidate the old loadout-derived runtime snapshot',
);
assert.equal(
  buffRestored.skillButtonTable['button-current-only']?.runtimeSnapshot,
  null,
  'a current-only button must not retain a snapshot calculated before the Buff restore',
);
assert.deepEqual(buffRestored.skillButtonTable['button-a']?.selectedBuff, ['baseline-shared', 'baseline-stack']);
assert.deepEqual(buffRestored.skillButtonTable['button-a']?.buffStackCounts, {
  'baseline-shared': 2,
  'baseline-stack': 5,
});
assert.deepEqual(buffRestored.skillButtonTable['button-a']?.panelConfig?.globallyDisabledBuffIds, ['baseline-stack']);
assert.deepEqual(
  buffRestored.skillButtonTable['button-a']?.panelConfig?.manualDisabledBuffIdsBySegmentKey,
  { 'normal-hit': ['baseline-shared'] },
);
assert.deepEqual(buffRestored.skillButtonTable['button-a']?.panelConfig?.manualBuffStackCountsBySegmentKey, {
  'normal-hit': { 'baseline-stack': 5 },
});
assert.deepEqual(buffRestored.skillButtonTable['button-a']?.panelConfig?.manualDisabledHitKeys, ['current-hit']);
assert.equal(buffRestored.skillButtonTable['button-a']?.panelConfig?.currentPanelUnknown, 'preserve-current-panel');
assert.deepEqual(buffRestored.skillButtonTable['button-a']?.resistanceConfig, {
  targetResistance: { physicalResistance: 99 },
});
assert.deepEqual(
  buffRestored.timelineData.staffLines.flatMap((line) => line.buttons.map((item) => item.buffIds)),
  [['baseline-shared', 'baseline-stack'], ['current-unmatched']],
);
assert.deepEqual(
  buffRestored.allBuffList.map((item) => [item.id, item.refCount]),
  [['baseline-shared', 1], ['baseline-stack', 1], ['current-unmatched', 1]],
);
assert.equal(buffRestored.allBuffList.some((item) => item.id === 'baseline-ignored'), false);
assert.equal(buffRestored.allBuffList.some((item) => item.id === 'orphan-buff'), false);

const resistanceCurrentBefore = structuredClone(currentBuff);
const resistanceBaselineBefore = structuredClone(baselineBuff);
const resistanceRestored = mustSucceed(restoreResistanceScope(currentBuff, baselineBuff));
assert.deepEqual(currentBuff, resistanceCurrentBefore, 'resistance restore must not mutate current input');
assert.deepEqual(baselineBuff, resistanceBaselineBefore, 'resistance restore must not mutate baseline input');
assert.deepEqual(resistanceRestored.selectedCharacters, currentBuff.selectedCharacters);
assert.deepEqual(resistanceRestored.timelineData, currentBuff.timelineData, 'resistance restore must preserve timeline');
assert.deepEqual(resistanceRestored.allBuffList, currentBuff.allBuffList, 'resistance restore must preserve attachments');
assert.deepEqual(resistanceRestored.anomalyStateSnapshots, currentBuff.anomalyStateSnapshots);
assert.deepEqual(resistanceRestored.characterInputMap, currentBuff.characterInputMap);
assert.deepEqual(resistanceRestored.characterComputedMap, currentBuff.characterComputedMap);
assert.deepEqual(resistanceRestored.characterDisplayCacheMap, currentBuff.characterDisplayCacheMap);
assert.deepEqual(resistanceRestored.operatorConfigPageCache, currentBuff.operatorConfigPageCache);
assert.deepEqual(resistanceRestored.skillButtonTable['button-a']?.resistanceConfig, {
  targetResistance: { physicalResistance: 1 },
});
assert.deepEqual(
  resistanceRestored.skillButtonTable['button-current-only']?.resistanceConfig,
  { targetResistance: { physicalResistance: 55 } },
  'a current-only button keeps its current resistance',
);
assert.deepEqual(resistanceRestored.skillButtonTable['button-a']?.selectedBuff, ['current-only']);
assert.equal(
  resistanceRestored.skillButtonTable['button-a']?.runtimeSnapshot,
  null,
  'resistance restore must invalidate the old loadout-derived runtime snapshot',
);
assert.equal(
  resistanceRestored.skillButtonTable['button-current-only']?.runtimeSnapshot,
  null,
  'a current-only button must not retain a snapshot after resistance changes',
);

const baselineWithoutResistance = structuredClone(baselineBuff);
delete (baselineWithoutResistance.skillButtonTable['button-a'] as AnyRecord).resistanceConfig;
const resistanceRemoved = mustSucceed(restoreResistanceScope(currentBuff, baselineWithoutResistance));
assert.equal(
  resistanceRemoved.skillButtonTable['button-a']?.resistanceConfig,
  undefined,
  'baseline absence removes resistance only for the matching current button',
);
assert.deepEqual(resistanceRemoved.skillButtonTable['button-a']?.selectedBuff, ['current-only']);
assert.equal(resistanceRemoved.skillButtonTable['button-a']?.runtimeSnapshot, null);

const sharedCurrentA = button('shared-a', 'operator-a', 0, 1, ['same-buff']);
const sharedCurrentB = button('shared-b', 'operator-a', 0, 2, ['same-buff']);
const sharedCurrentOnly = button('shared-current-only', 'operator-a', 0, 3, ['same-buff']);
const sharedBaselineA = button('shared-a', 'operator-a', 0, 1, ['same-buff'], {
  buffStackCounts: { 'same-buff': 3 },
  panelConfig: {
    selectedBuff: ['same-buff'],
    globallyDisabledBuffIds: ['same-buff'],
    manualDisabledBuffIdsBySegmentKey: { segment: ['same-buff'] },
    manualBuffStackCountsBySegmentKey: { segment: { 'same-buff': 3 } },
  },
});
const sharedBaselineB = button('shared-b', 'operator-a', 0, 2, ['same-buff'], {
  buffStackCounts: { 'same-buff': 4 },
});
const sharedCurrent = makePayload({
  buttons: [sharedCurrentA, sharedCurrentB, sharedCurrentOnly],
  buffs: [buff('same-buff', '当前同 ID Buff', { value: 100 })],
});
const sharedBaseline = makePayload({
  buttons: [sharedBaselineA, sharedBaselineB],
  buffs: [buff('same-buff', '基线同 ID Buff', { value: 200 })],
});
const sharedResult = mustSucceed(restoreBuffScope(sharedCurrent, sharedBaseline));
const sharedBaselineId = sharedResult.skillButtonTable['shared-a']?.selectedBuff[0];
assert.equal(typeof sharedBaselineId, 'string');
assert.notEqual(sharedBaselineId, 'same-buff', 'the conflicting baseline Buff must receive a distinct ID');
assert.equal(sharedResult.skillButtonTable['shared-b']?.selectedBuff[0], sharedBaselineId);
assert.equal(sharedResult.skillButtonTable['shared-current-only']?.selectedBuff[0], 'same-buff');
assert.equal(sharedResult.allBuffList.find((item) => item.id === sharedBaselineId)?.value, 200);
assert.equal(sharedResult.allBuffList.find((item) => item.id === 'same-buff')?.value, 100);
assert.equal(sharedResult.allBuffList.find((item) => item.id === sharedBaselineId)?.refCount, 2);
assert.equal(sharedResult.allBuffList.find((item) => item.id === 'same-buff')?.refCount, 1);
assert.deepEqual(sharedResult.skillButtonTable['shared-a']?.buffStackCounts, { [sharedBaselineId as string]: 3 });
assert.deepEqual(sharedResult.skillButtonTable['shared-b']?.buffStackCounts, { [sharedBaselineId as string]: 4 });
assert.deepEqual(sharedResult.skillButtonTable['shared-a']?.panelConfig?.selectedBuff, [sharedBaselineId]);
assert.deepEqual(sharedResult.skillButtonTable['shared-a']?.panelConfig?.globallyDisabledBuffIds, [sharedBaselineId]);
assert.deepEqual(
  sharedResult.skillButtonTable['shared-a']?.panelConfig?.manualDisabledBuffIdsBySegmentKey,
  { segment: [sharedBaselineId] },
);
assert.deepEqual(
  sharedResult.skillButtonTable['shared-a']?.panelConfig?.manualBuffStackCountsBySegmentKey,
  { segment: { [sharedBaselineId as string]: 3 } },
);
assert.deepEqual(sharedResult.skillButtonTable['shared-current-only']?.panelConfig?.selectedBuff, ['same-buff']);

const sharedReversedResult = mustSucceed(restoreBuffScope(
  makePayload({
    buttons: [sharedCurrentOnly, sharedCurrentB, sharedCurrentA],
    buffs: [buff('same-buff', '当前同 ID Buff', { value: 100 })],
  }),
  makePayload({
    buttons: [sharedBaselineB, sharedBaselineA],
    buffs: [buff('same-buff', '基线同 ID Buff', { value: 200 })],
  }),
));
const sharedReversedBaselineId = sharedReversedResult.skillButtonTable['shared-a']?.selectedBuff[0];
assert.equal(sharedReversedBaselineId, sharedBaselineId, 'baseline remap must not depend on button order');
assert.equal(sharedReversedResult.allBuffList.find((item) => item.id === sharedReversedBaselineId)?.value, 200);
assert.equal(sharedReversedResult.allBuffList.find((item) => item.id === 'same-buff')?.value, 100);
assert.equal(sharedReversedResult.skillButtonTable['shared-current-only']?.selectedBuff[0], 'same-buff');

const currentAnomalyCommon = button('anomaly-common', 'operator-a', 0, 1, [], {
  anomalyConfig: { selectedStatuses: [], selectedDamages: [], selectedStateSnapshotIds: [7] },
});
const currentAnomalyOnly = button('anomaly-current-only', 'operator-b', 1, 2, [], {
  anomalyConfig: { selectedStatuses: [], selectedDamages: [], selectedStateSnapshotIds: [7] },
});
const baselineAnomalyCommon = button('anomaly-common', 'operator-a', 0, 1, [], {
  anomalyConfig: { selectedStatuses: [], selectedDamages: [], selectedStateSnapshotIds: [7] },
});
const currentAnomalyPayload = makePayload({
  buttons: [currentAnomalyCommon, currentAnomalyOnly],
  buffs: [],
});
currentAnomalyPayload.anomalyStateSnapshots = [{
  id: 7,
  key: 'conductive',
  label: '当前导电',
  level: 1,
  sourceButtonId: 'anomaly-current-only',
  sourceCharacterId: 'operator-b',
  sourceCharacterName: '测试员 B',
  sourceSkillStrengthSnapshot: 10,
  effectValue: 10,
  primaryText: 'current',
  secondaryText: 'current',
  createdAt: 10,
}];
const baselineAnomalyPayload = makePayload({ buttons: [baselineAnomalyCommon], buffs: [] });
baselineAnomalyPayload.anomalyStateSnapshots = [{
  id: 7,
  key: 'corrosion',
  label: '基线腐蚀',
  level: 2,
  sourceButtonId: 'anomaly-common',
  sourceCharacterId: 'operator-a',
  sourceCharacterName: '测试员 A',
  sourceSkillStrengthSnapshot: 20,
  effectValue: 20,
  primaryText: 'baseline',
  secondaryText: 'baseline',
  createdAt: 20,
}];
const anomalyRestored = mustSucceed(restoreBuffScope(currentAnomalyPayload, baselineAnomalyPayload));
assert.deepEqual(
  anomalyRestored.skillButtonTable['anomaly-common']?.anomalyConfig?.selectedStateSnapshotIds,
  [7],
);
const remappedCurrentOnlyId = anomalyRestored.skillButtonTable['anomaly-current-only']
  ?.anomalyConfig?.selectedStateSnapshotIds[0];
assert.equal(remappedCurrentOnlyId, 8, 'a conflicting current-only anomaly snapshot must receive a stable new id');
assert.equal(anomalyRestored.anomalyStateSnapshots.find((item) => item.id === 7)?.label, '基线腐蚀');
assert.equal(anomalyRestored.anomalyStateSnapshots.find((item) => item.id === 8)?.label, '当前导电');

const invalidBaseline = structuredClone(baselineTimeline);
delete (invalidBaseline.skillButtonTable as AnyRecord)['button-restored'];
const invalidResult = restoreTimelineScope(currentTimeline, invalidBaseline);
assert.equal(invalidResult.ok, false);
if (!invalidResult.ok) {
  assert.equal(invalidResult.code, 'invalid-baseline-payload');
  assert(invalidResult.issues.some((issue) => issue.code === 'timeline-button-missing-table-entry'));
}

const incompatibleCurrent = makePayload({
  selectedCharacters: ['operator-b', 'operator-a'],
  buttons: [
    button('button-a', 'operator-b', 0, 8, ['shared']),
    button('button-deleted', 'operator-a', 1, 6, ['removed']),
  ],
  buffs: [currentShared, currentRemoved],
});
const incompatibleResult = restoreTimelineScope(incompatibleCurrent, baselineTimeline);
assert.equal(incompatibleResult.ok, false);
if (!incompatibleResult.ok) {
  assert.equal(incompatibleResult.code, 'restored-payload-invalid');
  assert(incompatibleResult.issues.length > 0);
}
