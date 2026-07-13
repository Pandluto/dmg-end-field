import assert from 'node:assert/strict';
import { diffTimelinePayloads } from './diff';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

const payload = (characterInputMap: TimelineSnapshotPayload['characterInputMap']) => ({
  selectedCharacters: ['mifu'],
  timelineData: { version: '1.0.0', createdAt: 1, updatedAt: 1, staffLines: [] },
  skillButtonTable: {},
  allBuffList: [],
  anomalyStateSnapshots: [],
  characterInputMap,
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache: {},
}) as TimelineSnapshotPayload;

const base = payload({});
const equipped = payload({
  mifu: {
    gearSetId: 'gear-set-jiu-feng',
    equipmentIds: ['equipment-jf-1', 'equipment-jf-2', 'equipment-jf-3'],
  } as never,
});

const diff = diffTimelinePayloads(base, equipped);
assert.equal(diff.summary.changedCharacterInputCount, 1);
assert.deepEqual(diff.changedCharacterInputs.map((change) => change.characterId), ['mifu']);
assert.equal(diffTimelinePayloads(equipped, equipped).summary.changedCharacterInputCount, 0);
