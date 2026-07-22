import assert from 'node:assert/strict';
import { compareDefTimelineInvariants } from '../agent/runtime/def-node-workspace/timeline-invariant.mjs';

function payload() {
  const button = {
    id: 'bieli-b-1',
    characterId: 'bieli',
    characterName: '别礼',
    skillType: 'B',
    runtimeSkillId: 'bieli-heavy',
    skillDisplayName: '重击',
    staffIndex: 0,
    lineIndex: 0,
    nodeIndex: 3,
    nodeNumber: 4,
    position: { x: 123, y: 456 },
    selectedBuff: ['buff-a'],
    customHits: [{ key: 'hit-1', multiplier: 1.2 }],
    panelConfig: {
      selectedBuff: ['buff-a'],
      globallyDisabledBuffIds: [],
      manualDisabledBuffIdsBySegmentKey: { 'hit-1': ['buff-b'] },
    },
    runtimeSnapshot: { hydration: 'ignored', updatedAt: 1 },
    createdAt: 1,
    updatedAt: 2,
  };
  return {
    selectedCharacters: ['bieli'],
    timelineData: {
      createdAt: 1,
      updatedAt: 2,
      staffLines: [{
        staffIndex: 0,
        characterName: '别礼',
        occupiedNodes: [3],
        buttons: [{
          id: button.id,
          characterId: button.characterId,
          characterName: button.characterName,
          skillType: button.skillType,
          runtimeSkillId: button.runtimeSkillId,
          skillDisplayName: button.skillDisplayName,
          staffIndex: 0,
          lineIndex: 0,
          nodeIndex: 3,
          nodeNumber: 4,
          position: { x: 12, y: 34 },
          buffIds: ['buff-a'],
        }],
      }],
    },
    skillButtonTable: { [button.id]: button },
    allBuffList: [{ id: 'buff-a', name: '测试 Buff', createdAt: 1, updatedAt: 2 }],
    anomalyStateSnapshots: [{ id: 'state-a', effect: { value: 1 }, updatedAt: 2 }],
  };
}

const before = payload();
const hydrationOnly = structuredClone(before);
hydrationOnly.timelineData.updatedAt = 999;
hydrationOnly.timelineData.staffLines[0].buttons[0].position = { x: 999, y: 0 };
hydrationOnly.skillButtonTable['bieli-b-1'].updatedAt = 999;
hydrationOnly.skillButtonTable['bieli-b-1'].position = { x: 999, y: 0 };
hydrationOnly.skillButtonTable['bieli-b-1'].runtimeSnapshot = { hydration: 'new', updatedAt: 999 };
hydrationOnly.allBuffList[0] = { updatedAt: 999, name: '测试 Buff', id: 'buff-a', createdAt: 999 };
assert.equal(compareDefTimelineInvariants(before, hydrationOnly).pass, true, 'hydration, layout, timestamps and object key order are not timeline mutations');

const sparseSelectedRoster = payload();
sparseSelectedRoster.selectedCharacters = ['bieli', 'operator-2', 'operator-3', 'operator-4'];
const hydratedSelectedRoster = structuredClone(sparseSelectedRoster);
hydratedSelectedRoster.timelineData.staffLines.push(
  { staffIndex: 1, characterName: 'Operator 2', occupiedNodes: [], buttons: [] },
  { staffIndex: 2, characterName: 'Operator 3', occupiedNodes: [], buttons: [] },
  { staffIndex: 3, characterName: 'Operator 4', occupiedNodes: [], buttons: [] },
);
assert.equal(
  compareDefTimelineInvariants(sparseSelectedRoster, hydratedSelectedRoster).pass,
  true,
  'renderer-created empty tracks for already-selected operators are hydration, not a timeline mutation',
);

const changedRuntimeSkill = structuredClone(before);
changedRuntimeSkill.skillButtonTable['bieli-b-1'].runtimeSkillId = 'bieli-heavy-v2';
const runtimeResult = compareDefTimelineInvariants(before, changedRuntimeSkill);
assert.equal(runtimeResult.pass, false);
assert.ok(runtimeResult.changedPaths.includes('buttons.bieli-b-1.runtimeSkillId'));

const changedCombatInput = structuredClone(before);
changedCombatInput.skillButtonTable['bieli-b-1'].panelConfig.manualDisabledBuffIdsBySegmentKey['hit-1'] = [];
const combatResult = compareDefTimelineInvariants(before, changedCombatInput);
assert.equal(combatResult.pass, false);
assert.ok(combatResult.changedPaths.some((path) => path.startsWith('buttons.bieli-b-1.panelConfig')));

const changedSlot = structuredClone(before);
changedSlot.skillButtonTable['bieli-b-1'].nodeIndex = 4;
const slotResult = compareDefTimelineInvariants(before, changedSlot);
assert.equal(slotResult.pass, false);
assert.ok(slotResult.changedPaths.includes('buttons.bieli-b-1.nodeIndex'));

console.log('DEF operator-config canonical timeline invariant contract: PASS');
