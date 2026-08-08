import assert from 'node:assert/strict';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import type { PersistedSkillButton } from '../../types/storage';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { buildTimelineButtonsFromSkillButtonTable, normalizeTimelineData } from './timelineService';

const button: PersistedSkillButton = {
  id: 'button-selection-buff',
  characterId: 'operator-1',
  characterName: '干员一',
  skillType: 'B',
  staffIndex: 0,
  lineIndex: 0,
  nodeIndex: 16,
  nodeNumber: 17,
  position: { x: 120, y: 80 },
  selectedBuff: ['buff-selection-retained'],
};
const skillButtonTable = { [button.id]: button };
const staffLines = buildTimelineButtonsFromSkillButtonTable(
  skillButtonTable,
  [{ id: 'operator-1', name: '干员一' }],
);

assert.deepEqual(staffLines[0]?.buttons[0]?.buffIds, ['buff-selection-retained']);
assert.notEqual(staffLines[0]?.buttons[0]?.buffIds, button.selectedBuff);

const payload: TimelineSnapshotPayload = {
  selectedCharacters: ['operator-1'],
  timelineData: {
    version: '1.1.0',
    createdAt: 1,
    updatedAt: 2,
    staffLines,
  },
  skillButtonTable,
  allBuffList: [{
    id: 'buff-selection-retained',
    name: 'selection-retained',
    displayName: '换人后保留 Buff',
    sourceName: '测试',
    refCount: 1,
  }],
  anomalyStateSnapshots: [],
  characterInputMap: {},
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache: {},
};

assert.deepEqual(validateTimelinePayload(payload), { ok: true, issues: [] });
assert.deepEqual(
  normalizeTimelineData(payload.timelineData, [{ name: '干员一' }]).staffLines[0]?.occupiedNodes,
  [16],
  'global node indices beyond the first 15-slot visual group must remain occupied',
);
console.log('Timeline selection projection keeps Buff mirror identity: PASS');
