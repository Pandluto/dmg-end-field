import assert from 'node:assert/strict';
import { validateTimelinePayload } from './validator';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

function validPayload(): TimelineSnapshotPayload {
  const button = {
    id: 'button-1',
    characterId: 'operator-1',
    characterName: '干员一',
    skillType: 'B' as const,
    staffIndex: 0,
    lineIndex: 0,
    nodeIndex: 16,
    nodeNumber: 17,
    position: { x: 1, y: 2 },
  };
  return {
    selectedCharacters: ['operator-1'],
    timelineData: {
      version: '1', createdAt: 1, updatedAt: 1,
      staffLines: [{ staffIndex: 0, characterName: '干员一', occupiedNodes: [16], buttons: [{ ...button, buffIds: [] }] }],
    },
    skillButtonTable: { 'button-1': { ...button, selectedBuff: [] } },
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

assert.deepEqual(validateTimelinePayload(validPayload()), { ok: true, issues: [] });

const incomplete = validPayload();
incomplete.timelineData.staffLines[0].buttons[0] = { id: 'button-1', nodeIndex: 0, skillKey: 'operator-1-B' } as never;
incomplete.skillButtonTable['button-1'] = { id: 'button-1', nodeIndex: 0, skillKey: 'operator-1-B', selectedBuff: [] } as never;
const incompleteCodes = validateTimelinePayload(incomplete).issues.map((issue) => issue.code);
assert(incompleteCodes.includes('invalid-button-character-id'));
assert(incompleteCodes.includes('invalid-button-skill-type'));

const divergent = validPayload();
divergent.timelineData.staffLines[0].buttons[0].skillType = 'Q';
assert(validateTimelinePayload(divergent).issues.some((issue) => issue.code === 'timeline-button-table-identity-mismatch'));

console.log('Timeline payload validator identity contract: PASS');
