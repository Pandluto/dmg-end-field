import assert from 'node:assert/strict';
import type { PersistedSkillButton } from '../../types/storage';
import { detachBuffFromSkillButton } from './skillButtonPanelConfig';

function button(overrides: Partial<PersistedSkillButton> = {}): PersistedSkillButton {
  return {
    id: 'button-a',
    characterId: 'operator-a',
    characterName: '干员甲',
    skillType: 'A',
    staffIndex: 0,
    nodeIndex: 0,
    nodeNumber: 1,
    position: { x: 10, y: 20 },
    selectedBuff: ['keep', 'remove'],
    buffStackCounts: { keep: 2, remove: 3 },
    panelConfig: {
      selectedBuff: ['keep', 'remove'],
      globallyDisabledBuffIds: ['remove', 'keep', 'remove'],
      manualDisabledBuffIdsBySegmentKey: {
        'normal-hit-a': ['remove', 'keep'],
        'normal-hit-b': ['remove'],
        empty: [],
      },
      manualBuffStackCountsBySegmentKey: {
        'normal-hit-a': { remove: 1, keep: 2 },
        'normal-hit-b': { remove: 3 },
        empty: {},
      },
      manualDisabledHitKeys: ['hit-a'],
    },
    runtimeSnapshot: { atk: 100, critRate: 0.1, critDmg: 0.5 },
    ...overrides,
  };
}

const source = button();
const sourceSnapshot = structuredClone(source);
const detached = detachBuffFromSkillButton(source, 'remove');

assert.deepEqual(source, sourceSnapshot);
assert.notEqual(detached, source);
assert.deepEqual(detached.selectedBuff, ['keep']);
assert.deepEqual(detached.buffStackCounts, { keep: 2 });
assert.deepEqual(detached.panelConfig, {
  selectedBuff: ['keep'],
  globallyDisabledBuffIds: ['keep'],
  manualDisabledBuffIdsBySegmentKey: {
    'normal-hit-a': ['keep'],
  },
  manualBuffStackCountsBySegmentKey: {
    'normal-hit-a': { keep: 2 },
  },
  manualDisabledHitKeys: ['hit-a'],
});
assert.equal(detached.runtimeSnapshot, source.runtimeSnapshot);

const withoutPanelConfig = button({
  selectedBuff: ['remove'],
  buffStackCounts: { remove: 1 },
  panelConfig: undefined,
});
assert.deepEqual(detachBuffFromSkillButton(withoutPanelConfig, 'remove'), {
  ...withoutPanelConfig,
  selectedBuff: [],
  buffStackCounts: {},
  panelConfig: { selectedBuff: [] },
});

const staleOnly = button({
  selectedBuff: ['keep'],
  buffStackCounts: { keep: 1 },
  panelConfig: {
    selectedBuff: ['keep'],
    globallyDisabledBuffIds: ['remove'],
    manualDisabledBuffIdsBySegmentKey: { hit: ['remove'] },
    manualBuffStackCountsBySegmentKey: { hit: { remove: 2 } },
    manualDisabledHitKeys: ['hit'],
  },
});
assert.deepEqual(detachBuffFromSkillButton(staleOnly, 'remove').panelConfig, {
  selectedBuff: ['keep'],
  globallyDisabledBuffIds: [],
  manualDisabledBuffIdsBySegmentKey: {},
  manualBuffStackCountsBySegmentKey: {},
  manualDisabledHitKeys: ['hit'],
});

console.log('Skill button persisted panel override cleanup contract: PASS');
