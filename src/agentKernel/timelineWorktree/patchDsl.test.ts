import assert from 'node:assert/strict';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { diffTimelinePayloads } from './diff';
import { applyTimelineWorkNodePatch } from './patchDsl';
import { validateTimelinePayload } from './validator';

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
        occupiedNodes: [],
        buttons: [],
      }],
    },
    skillButtonTable: {},
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

const added = applyTimelineWorkNodePatch(fixture(), [{
  op: 'addButton',
  buttonId: 'button-test',
  characterName: '测试干员',
  skillType: 'A',
  nodeIndex: 2,
}]);
assert.equal(added.ok, true);
if (!added.ok) throw new Error('addButton fixture failed');
assert.equal(added.workingPayload.skillButtonTable['button-test']?.characterId, 'operator-test');
assert.equal(added.workingPayload.skillButtonTable['button-test']?.lineIndex, 0);
assert.equal(validateTimelinePayload(added.workingPayload).ok, true);

const buffed = applyTimelineWorkNodePatch(added.workingPayload, [{
  op: 'attachBuff',
  target: { buttonId: 'button-test' },
  buffId: 'buff-test',
  stackCount: 2,
  buff: {
    id: 'buff-test',
    name: 'test-buff',
    displayName: '测试 Buff',
    sourceName: '测试来源',
    category: 'countable',
    maxStacks: 5,
    type: 'atkPct',
    value: 0.1,
  },
}]);
assert.equal(buffed.ok, true);
if (!buffed.ok) throw new Error('attachBuff fixture failed');
assert.deepEqual(buffed.workingPayload.skillButtonTable['button-test']?.selectedBuff, ['buff-test']);
assert.equal(buffed.workingPayload.skillButtonTable['button-test']?.buffStackCounts?.['buff-test'], 2);
assert.equal(buffed.workingPayload.allBuffList[0]?.refCount, 1);
assert.equal(validateTimelinePayload(buffed.workingPayload).ok, true);

const adjusted = applyTimelineWorkNodePatch(buffed.workingPayload, [
  {
    op: 'setBuffStack',
    target: { buttonId: 'button-test' },
    buffId: 'buff-test',
    stackCount: 4,
  },
  {
    op: 'setTargetResistance',
    target: { buttonId: 'button-test' },
    targetResistance: { physicalResistance: 20, fireResistance: -10 },
  },
]);
assert.equal(adjusted.ok, true);
if (!adjusted.ok) throw new Error('stack/resistance fixture failed');
const adjustedButton = adjusted.workingPayload.skillButtonTable['button-test'];
assert.equal(adjustedButton?.buffStackCounts?.['buff-test'], 4);
assert.deepEqual(adjustedButton?.resistanceConfig?.targetResistance, {
  physicalResistance: 20,
  fireResistance: -10,
});
const semanticDiff = diffTimelinePayloads(buffed.workingPayload, adjusted.workingPayload);
assert.deepEqual(
  semanticDiff.changedButtons[0]?.changes.map((change) => change.field),
  ['buffStackCounts', 'targetResistance'],
);

const segmented = applyTimelineWorkNodePatch(adjusted.workingPayload, [{
  op: 'setBuffStack',
  target: { buttonId: 'button-test' },
  buffId: 'buff-test',
  stackCount: 2,
  segmentKey: 'normal-hit-1',
}]);
assert.equal(segmented.ok, true);
if (!segmented.ok) throw new Error('segment stack fixture failed');
assert.equal(segmented.workingPayload.skillButtonTable['button-test']?.buffStackCounts?.['buff-test'], 4);
assert.equal(
  segmented.workingPayload.skillButtonTable['button-test']?.panelConfig
    ?.manualBuffStackCountsBySegmentKey?.['normal-hit-1']?.['buff-test'],
  2,
);

for (const illegalStack of [0, 6]) {
  const before = structuredClone(segmented.workingPayload);
  const invalidStack = applyTimelineWorkNodePatch(segmented.workingPayload, [{
    op: 'setBuffStack',
    target: { buttonId: 'button-test' },
    buffId: 'buff-test',
    stackCount: illegalStack,
  }]);
  assert.equal(invalidStack.ok, false);
  assert.deepEqual(segmented.workingPayload, before, 'a rejected stack must not mutate its input');
}

const invalidAttachBase = fixture();
const invalidAttach = applyTimelineWorkNodePatch(invalidAttachBase, [
  {
    op: 'addButton',
    buttonId: 'invalid-attach-button',
    characterName: '测试干员',
    skillType: 'A',
    nodeIndex: 0,
  },
  {
    op: 'attachBuff',
    target: { buttonId: 'invalid-attach-button' },
    stackCount: 6,
    buff: {
      id: 'invalid-attach-buff',
      name: 'invalid-attach-buff',
      displayName: '非法层数 Buff',
      sourceName: '测试来源',
      category: 'countable',
      maxStacks: 5,
    },
  },
]);
assert.equal(invalidAttach.ok, false);
assert.deepEqual(invalidAttachBase, fixture(), 'a failed batch must leave the original payload untouched');

const replaceBase = JSON.parse(JSON.stringify(segmented.workingPayload)) as TimelineSnapshotPayload;
const replaceButton = replaceBase.skillButtonTable['button-test'];
if (!replaceButton) throw new Error('replace Buff source button is missing');
replaceButton.panelConfig = {
  ...(replaceButton.panelConfig ?? { selectedBuff: ['buff-test'] }),
  selectedBuff: ['buff-test'],
  globallyDisabledBuffIds: ['buff-test'],
  manualDisabledBuffIdsBySegmentKey: {
    'normal-hit-1': ['buff-test'],
    'normal-hit-2': ['keep-other'],
  },
  manualBuffStackCountsBySegmentKey: {
    'normal-hit-1': { 'buff-test': 2 },
    'normal-hit-2': { 'keep-other': 1 },
  },
  manualDisabledHitKeys: ['hit-keep'],
};
const replacedBuff = applyTimelineWorkNodePatch(replaceBase, [{
  op: 'replaceBuff',
  target: { buttonId: 'button-test' },
  buffId: 'buff-test',
  buff: {
    id: 'buff-replacement',
    name: 'replacement-buff',
    displayName: '替换 Buff',
    sourceName: '替换来源',
    category: 'countable',
    maxStacks: 3,
  },
}]);
assert.equal(replacedBuff.ok, true);
if (!replacedBuff.ok) throw new Error('replace Buff fixture failed');
const replacementButton = replacedBuff.workingPayload.skillButtonTable['button-test'];
assert.deepEqual(replacementButton?.selectedBuff, ['buff-replacement']);
assert.equal(replacementButton?.buffStackCounts?.['buff-replacement'], 3, 'global stack is preserved and bounded by the new max');
assert.equal(replacementButton?.buffStackCounts?.['buff-test'], undefined);
assert.deepEqual(replacementButton?.panelConfig?.globallyDisabledBuffIds, ['buff-replacement']);
assert.deepEqual(replacementButton?.panelConfig?.manualDisabledBuffIdsBySegmentKey, {
  'normal-hit-1': ['buff-replacement'],
  'normal-hit-2': ['keep-other'],
});
assert.deepEqual(replacementButton?.panelConfig?.manualBuffStackCountsBySegmentKey, {
  'normal-hit-2': { 'keep-other': 1 },
  'normal-hit-1': { 'buff-replacement': 2 },
});
assert.deepEqual(replacementButton?.panelConfig?.manualDisabledHitKeys, ['hit-keep']);
assert.deepEqual(replacementButton?.resistanceConfig, replaceButton.resistanceConfig);
assert.equal(replacedBuff.workingPayload.allBuffList.some((buff) => buff.id === 'buff-test'), false);
assert.equal(replacedBuff.workingPayload.allBuffList.find((buff) => buff.id === 'buff-replacement')?.refCount, 1);

const detachedReplacement = applyTimelineWorkNodePatch(replacedBuff.workingPayload, [{
  op: 'removeBuff',
  target: { buttonId: 'button-test' },
  buffId: 'buff-replacement',
}]);
assert.equal(detachedReplacement.ok, true);
if (!detachedReplacement.ok) throw new Error('replacement detach fixture failed');
const detachedReplacementButton = detachedReplacement.workingPayload.skillButtonTable['button-test'];
assert.deepEqual(detachedReplacementButton?.selectedBuff, []);
assert.deepEqual(detachedReplacementButton?.panelConfig?.globallyDisabledBuffIds, []);
assert.deepEqual(detachedReplacementButton?.panelConfig?.manualDisabledBuffIdsBySegmentKey, {
  'normal-hit-2': ['keep-other'],
});
assert.deepEqual(detachedReplacementButton?.panelConfig?.manualBuffStackCountsBySegmentKey, {
  'normal-hit-2': { 'keep-other': 1 },
});
assert.equal(detachedReplacement.workingPayload.allBuffList.some((buff) => buff.id === 'buff-replacement'), false);

const sourceButton = adjusted.workingPayload.skillButtonTable['button-test'];
if (!sourceButton) throw new Error('copyButton source fixture is missing');
sourceButton.runtimeSkillId = 'operator-test-skill-a';
sourceButton.skillDisplayName = '测试普攻';
sourceButton.skillIconUrl = '/skills/test-a.svg';
sourceButton.customHits = [{
  key: 'hit-1',
  displayName: '测试命中',
  multiplier: 1.25,
  levels: { L9: 1.25 },
  element: 'physical',
  skillType: 'A',
}];
sourceButton.anomalyConfig = {
  selectedStatuses: [{
    id: 'abnormal-status',
    key: 'conductive',
    label: '导电',
    kind: 'state',
    category: 'magic',
    level: 2,
    primaryText: '异常状态',
    secondaryText: '源按钮异常状态',
    selectedBuffIds: ['buff-test'],
  }],
  selectedDamages: [],
  selectedStateSnapshotIds: [7],
};
sourceButton.panelConfig = {
  selectedBuff: ['buff-test'],
  globallyDisabledBuffIds: ['buff-test'],
  manualDisabledBuffIdsBySegmentKey: { 'normal-hit-1': ['buff-test'] },
  manualBuffStackCountsBySegmentKey: { 'normal-hit-1': { 'buff-test': 1 } },
  manualDisabledHitKeys: ['hit-1'],
};
sourceButton.runtimeSnapshot = {
  atk: 123,
  critRate: 0.2,
  critDmg: 1.5,
  characterComputed: null,
};
const sourceBeforeCopy = JSON.parse(JSON.stringify(sourceButton));
const buffsBeforeCopy = JSON.parse(JSON.stringify(adjusted.workingPayload.allBuffList));

const copied = applyTimelineWorkNodePatch(adjusted.workingPayload, [{
  op: 'copyButton',
  target: { buttonId: 'button-test' },
  buttonId: 'button-copy',
  nodeIndex: 3,
}]);
assert.equal(copied.ok, true);
if (!copied.ok) throw new Error('copyButton fixture failed');
const copiedButton = copied.workingPayload.skillButtonTable['button-copy'];
if (!copiedButton) throw new Error('copyButton target fixture is missing');
assert.notDeepEqual(copiedButton, sourceButton);
assert.equal(copiedButton.id, 'button-copy');
assert.equal(copiedButton.characterId, sourceButton.characterId);
assert.equal(copiedButton.characterName, sourceButton.characterName);
assert.equal(copiedButton.skillType, sourceButton.skillType);
assert.equal(copiedButton.runtimeSkillId, sourceButton.runtimeSkillId);
assert.equal(copiedButton.skillDisplayName, sourceButton.skillDisplayName);
assert.equal(copiedButton.skillIconUrl, sourceButton.skillIconUrl);
assert.deepEqual(copiedButton.customHits, sourceButton.customHits);
assert.equal(copiedButton.staffIndex, 0);
assert.equal(copiedButton.lineIndex, 0);
assert.equal(copiedButton?.nodeIndex, 3);
assert.deepEqual(copiedButton.position, { x: 146, y: 60 });
assert.deepEqual(copiedButton.selectedBuff, []);
assert.deepEqual(copiedButton.buffStackCounts ?? {}, {});
assert.equal(copiedButton.anomalyConfig, undefined);
assert.equal(copiedButton.resistanceConfig, undefined);
assert.equal(copiedButton.panelConfig, undefined);
assert.equal(copiedButton.runtimeSnapshot, undefined);
assert.deepEqual(adjusted.workingPayload.skillButtonTable['button-test'], sourceBeforeCopy);
assert.deepEqual(adjusted.workingPayload.allBuffList, buffsBeforeCopy);
assert.deepEqual(copied.workingPayload.skillButtonTable['button-test'], sourceButton);
assert.deepEqual(copied.workingPayload.skillButtonTable['button-test'], sourceBeforeCopy);
assert.deepEqual(copied.workingPayload.allBuffList, buffsBeforeCopy);
assert.equal(copied.workingPayload.allBuffList[0]?.refCount, 1);

const replaced = applyTimelineWorkNodePatch(copied.workingPayload, [{
  op: 'replaceButton',
  target: { buttonId: 'button-copy' },
  skillType: 'E',
  runtimeSkillId: 'operator-test-skill-e',
  skillDisplayName: '测试战技',
}]);
assert.equal(replaced.ok, true);
if (!replaced.ok) throw new Error('replaceButton fixture failed');
const replacedButton = replaced.workingPayload.skillButtonTable['button-copy'];
assert.equal(replacedButton?.skillType, 'E');
assert.equal(replacedButton?.runtimeSkillId, 'operator-test-skill-e');
assert.equal(replacedButton?.nodeIndex, 3);
assert.deepEqual(replacedButton?.selectedBuff, []);
assert.equal(replacedButton?.resistanceConfig, undefined);

const decremented = applyTimelineWorkNodePatch(replaced.workingPayload, [{
  op: 'removeBuff',
  target: { buttonId: 'button-test' },
  buffId: 'buff-test',
  count: 1,
}]);
assert.equal(decremented.ok, true);
if (!decremented.ok) throw new Error('removeBuff decrement fixture failed');
assert.equal(decremented.workingPayload.skillButtonTable['button-test']?.buffStackCounts?.['buff-test'], 3);
assert.equal(decremented.workingPayload.allBuffList.length, 1);
assert.equal(decremented.workingPayload.allBuffList[0]?.refCount, 1);

const removed = applyTimelineWorkNodePatch(decremented.workingPayload, [{
  op: 'removeButton',
  target: { buttonId: 'button-test' },
}]);
assert.equal(removed.ok, true);
if (!removed.ok) throw new Error('removeButton fixture failed');
assert.deepEqual(Object.keys(removed.workingPayload.skillButtonTable), ['button-copy']);
assert.equal(removed.workingPayload.allBuffList.length, 0);
assert.equal(validateTimelinePayload(removed.workingPayload).ok, true);
