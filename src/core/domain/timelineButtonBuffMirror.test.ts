import assert from 'node:assert/strict';
import type { TimelineData } from '../../types';
import type { SkillButtonTable } from '../../types/storage';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { synchronizeTimelineButtonBuffMirrors } from './timelineButtonBuffMirror';

const timelineData: TimelineData = {
  version: '1.1.0',
  createdAt: 100,
  updatedAt: 100,
  staffLines: [{
    staffIndex: 0,
    characterName: '测试干员',
    occupiedNodes: [3],
    buttons: [{
      id: 'button-1',
      characterId: 'operator-1',
      characterName: '测试干员',
      skillType: 'B',
      staffIndex: 0,
      lineIndex: 0,
      nodeIndex: 3,
      nodeNumber: 4,
      position: { x: 120, y: 80 },
      buffIds: ['stale-buff'],
    }],
  }],
};
const skillButtonTable: SkillButtonTable = {
  'button-1': {
    id: 'button-1',
    characterId: 'operator-1',
    characterName: '测试干员',
    skillType: 'B',
    staffIndex: 0,
    lineIndex: 0,
    nodeIndex: 3,
    nodeNumber: 4,
    position: { x: 120, y: 80 },
    selectedBuff: ['fresh-buff'],
  },
};

const repaired = synchronizeTimelineButtonBuffMirrors(timelineData, skillButtonTable, 200);
assert.equal(repaired.changed, true);
assert.deepEqual(repaired.repairedButtonIds, ['button-1']);
assert.deepEqual(repaired.timelineData.staffLines[0].buttons[0].buffIds, ['fresh-buff']);
assert.deepEqual(repaired.timelineData.staffLines[0].buttons[0].position, { x: 120, y: 80 });
assert.equal(repaired.timelineData.updatedAt, 200);
assert.deepEqual(timelineData.staffLines[0].buttons[0].buffIds, ['stale-buff'], 'repair must not mutate the live React object');

const stalePayload: TimelineSnapshotPayload = {
  selectedCharacters: ['operator-1'],
  timelineData,
  skillButtonTable,
  allBuffList: [{ id: 'fresh-buff' } as TimelineSnapshotPayload['allBuffList'][number]],
  anomalyStateSnapshots: [],
  characterInputMap: {},
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache: {},
};
assert(
  validateTimelinePayload(stalePayload).issues.some((issue) => issue.code === 'timeline-button-table-buff-mismatch'),
  'the regression fixture must reproduce the production save rejection',
);
assert.deepEqual(
  validateTimelinePayload({ ...stalePayload, timelineData: repaired.timelineData }),
  { ok: true, issues: [] },
  'the repaired payload must pass the same strict Work Node validator used by save',
);

const stable = synchronizeTimelineButtonBuffMirrors(repaired.timelineData, skillButtonTable, 300);
assert.equal(stable.changed, false);
assert.equal(stable.timelineData, repaired.timelineData);

const missingTableEntry = synchronizeTimelineButtonBuffMirrors(timelineData, {}, 400);
assert.equal(missingTableEntry.changed, false, 'missing table entries remain visible to the strict validator');

console.log('Timeline button Buff mirror repair contract: PASS');
