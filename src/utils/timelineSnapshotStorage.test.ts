import assert from 'node:assert/strict';
import {
  toJsonSafeTimelineSnapshotPayload,
  type TimelineSnapshotPayload,
} from './timelineSnapshotStorage';

function fixture(): TimelineSnapshotPayload {
  return {
    selectedCharacters: ['operator-a'],
    timelineData: {
      version: '1.1.0',
      createdAt: 1,
      updatedAt: 1,
      staffLines: [],
    },
    skillButtonTable: {
      'button-a': {
        id: 'button-a',
        characterId: 'operator-a',
        characterName: '干员 A',
        skillType: 'A',
        staffIndex: 0,
        lineIndex: 0,
        nodeIndex: 0,
        nodeNumber: 1,
        position: { x: 0, y: 0 },
        selectedBuff: [],
        optionalRuntimeField: undefined,
      } as never,
    },
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {
      'operator-a': {
        panel: {
          atk: 1,
          optionalProjection: undefined,
        },
      } as never,
    },
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

const runtimePayload = fixture();
const persistedPayload = JSON.parse(JSON.stringify(runtimePayload)) as TimelineSnapshotPayload;

const normalized = toJsonSafeTimelineSnapshotPayload(runtimePayload);
assert.equal('optionalRuntimeField' in normalized.skillButtonTable['button-a']!, false);
assert.equal('optionalProjection' in normalized.characterComputedMap['operator-a']!.panel, false);
assert.deepEqual(normalized, persistedPayload);

const invalidNumber = fixture();
invalidNumber.timelineData.updatedAt = Number.NaN;
assert.throws(
  () => toJsonSafeTimelineSnapshotPayload(invalidNumber),
  /non-finite number at \/timelineData\/updatedAt/,
);

const invalidArray = fixture();
invalidArray.timelineData.staffLines = [undefined] as never;
assert.throws(
  () => toJsonSafeTimelineSnapshotPayload(invalidArray),
  /undefined array item at \/timelineData\/staffLines\/0/,
);

console.log('Timeline snapshot JSON boundary normalization: PASS');
