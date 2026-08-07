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

const decremented = applyTimelineWorkNodePatch(adjusted.workingPayload, [{
  op: 'removeBuff',
  target: { buttonId: 'button-test' },
  buffId: 'buff-test',
  count: 1,
}]);
assert.equal(decremented.ok, true);
if (!decremented.ok) throw new Error('removeBuff decrement fixture failed');
assert.equal(decremented.workingPayload.skillButtonTable['button-test']?.buffStackCounts?.['buff-test'], 3);
assert.equal(decremented.workingPayload.allBuffList.length, 1);

const removed = applyTimelineWorkNodePatch(decremented.workingPayload, [{
  op: 'removeButton',
  target: { buttonId: 'button-test' },
}]);
assert.equal(removed.ok, true);
if (!removed.ok) throw new Error('removeButton fixture failed');
assert.equal(Object.keys(removed.workingPayload.skillButtonTable).length, 0);
assert.equal(removed.workingPayload.allBuffList.length, 0);
assert.equal(validateTimelinePayload(removed.workingPayload).ok, true);
