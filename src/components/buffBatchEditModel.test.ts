import assert from 'node:assert/strict';
import type { LocalBuffSearchResult } from './CanvasBoard/skillButton.shared';
import type { Character, TimelineData } from '../types';
import type { AnomalyStateSnapshot, PersistedSkillButton, SkillButtonBuff } from '../types/storage';
import {
  buffFromSearchResult,
  buffMatchesSourceFilter,
  buildButtonHitRect,
  buildButtonPosition,
  candidateBuffFromAnomalyStateSnapshot,
  compareBuffBySource,
  countTargetsByButton,
  dedupeBuffIds,
  getBuffLabel,
  getBuffSourceLabel,
  getBuffValueLine,
  getButtonLineIndex,
  getButtonSkillType,
  getButtonStaffGroupIndex,
  getMissingBuffShortId,
  getNextCandidateAdderMode,
  getStaffGroupCount,
  intersects,
  normalizeRect,
  projectVisualSkillButtons,
  sortButtons,
} from './buffBatchEditModel';

function button(overrides: Partial<PersistedSkillButton> = {}): PersistedSkillButton {
  return {
    id: 'button-a',
    characterId: 'operator-a',
    characterName: '干员甲',
    skillType: 'A',
    staffIndex: 0,
    nodeIndex: 0,
    nodeNumber: 1,
    position: { x: 100, y: 200 },
    selectedBuff: [],
    ...overrides,
  };
}

function buff(overrides: Partial<SkillButtonBuff> = {}): SkillButtonBuff {
  return {
    id: 'buff-a',
    name: '内部名',
    displayName: '展示名',
    sourceName: '来源甲',
    source: 'operator',
    type: 'atkPercentBoost',
    value: 0.2,
    refCount: 1,
    ...overrides,
  };
}

assert.deepEqual(
  ['buff-group', 'operator', 'weapon', 'equipment', 'anomaly-state']
    .map((mode) => getNextCandidateAdderMode(mode as Parameters<typeof getNextCandidateAdderMode>[0])),
  ['operator', 'weapon', 'equipment', 'anomaly-state', 'buff-group'],
);

const legacyLayoutButton = button({ staffIndex: 3, lineIndex: 2, nodeIndex: 52 });
assert.equal(getButtonLineIndex(legacyLayoutButton), 2);
assert.equal(getButtonStaffGroupIndex(legacyLayoutButton), 3);

const currentLayoutButton = button({ staffIndex: 1, lineIndex: undefined, nodeIndex: 52 });
assert.equal(getButtonLineIndex(currentLayoutButton), 1);
assert.equal(getButtonStaffGroupIndex(currentLayoutButton), 3);
assert.equal(getButtonSkillType(button({ skillType: 'Dot' })), 'Dot');
assert.equal(getButtonSkillType(button({ skillType: 'legacy-unknown' })), 'A');

const explicitPosition = { x: 321, y: 654 };
assert.equal(buildButtonPosition(button({ position: explicitPosition })), explicitPosition);
const fallbackPosition = buildButtonPosition(button({
  position: { x: Number.NaN, y: Number.NaN },
  staffIndex: 1,
  nodeIndex: 27,
}));
assert.equal(Number.isFinite(fallbackPosition.x), true);
assert.equal(Number.isFinite(fallbackPosition.y), true);

assert.deepEqual(buildButtonHitRect(button({ position: { x: 100, y: 200 } })), {
  left: 38,
  top: 163,
  right: 140,
  bottom: 215,
});
assert.deepEqual(
  [...countTargetsByButton({
    'buff-a': ['button-a', 'button-b'],
    'buff-b': ['button-a'],
    empty: [],
  })],
  [['button-a', 2], ['button-b', 1]],
);

const sortedButtons = [
  button({ id: 'third', staffIndex: 1, lineIndex: 1, nodeIndex: 2 }),
  button({ id: 'second', staffIndex: 0, lineIndex: 1, nodeIndex: 3 }),
  button({ id: 'first', staffIndex: 0, lineIndex: 0, nodeIndex: 9 }),
].sort(sortButtons);
assert.deepEqual(sortedButtons.map((item) => item.id), ['first', 'second', 'third']);
assert.equal(getStaffGroupCount([]), 1);
assert.equal(getStaffGroupCount(sortedButtons), 2);

assert.deepEqual(normalizeRect({ startX: 10, startY: 30, currentX: 2, currentY: 8 }), {
  left: 2,
  top: 8,
  right: 10,
  bottom: 30,
  width: 8,
  height: 22,
});
assert.equal(
  intersects(
    { left: 0, top: 0, right: 10, bottom: 10 },
    { left: 10, top: 10, right: 20, bottom: 20 },
  ),
  true,
);
assert.equal(
  intersects(
    { left: 0, top: 0, right: 9, bottom: 9 },
    { left: 10, top: 10, right: 20, bottom: 20 },
  ),
  false,
);

assert.equal(getBuffLabel(buff({ displayName: '  展示名  ' })), '展示名');
assert.equal(getBuffLabel(buff({ displayName: ' ', name: '  内部名  ' })), '内部名');
assert.equal(getBuffLabel(buff({ displayName: '', name: '' })), 'buff-a');
assert.equal(getBuffSourceLabel(buff({ sourceName: '  来源甲  ' })), '来源甲');
assert.equal(getBuffSourceLabel(buff({ sourceName: '', source: ' weapon ' })), 'weapon');
assert.equal(getBuffSourceLabel(buff({ sourceName: '', source: '' })), '未知来源');
assert.equal(getBuffValueLine(buff()), 'atkPercentBoost · 0.2');
assert.equal(
  getBuffValueLine(buff({
    effectKind: 'extraHit',
    extraHitConfig: {
      baseMultiplier: 1.25,
      damageType: 'fire',
      skillType: 'Q',
      cooldownSeconds: 3,
    },
  })),
  '额外伤害 · 普通继承段 · 125.0% · fire · Q · 3s CD',
);
assert.equal(getMissingBuffShortId('short-id'), 'short-id');
assert.equal(getMissingBuffShortId('1234567890123456789'), '123456789012345678...');

const buffsBySource = [
  buff({ id: 'ten', source: 'weapon', sourceName: '武器10', displayName: '乙' }),
  buff({ id: 'two-b', source: 'weapon', sourceName: '武器2', displayName: '乙' }),
  buff({ id: 'two-a', source: 'weapon', sourceName: '武器2', displayName: '甲' }),
].sort(compareBuffBySource);
assert.deepEqual(buffsBySource.map((item) => item.id), ['two-a', 'two-b', 'ten']);

const equipmentBuff = buff({
  id: 'gear-effect',
  source: 'equipment',
  sourceName: '三件套效果',
  description: '装备能力',
});
assert.equal(buffMatchesSourceFilter(equipmentBuff, null), true);
assert.equal(buffMatchesSourceFilter(equipmentBuff, { kind: 'equipment', id: 'equipment', name: '装备' }), true);
assert.equal(buffMatchesSourceFilter(equipmentBuff, { kind: 'weapon', id: 'weapon-x', name: '武器甲' }), false);
assert.equal(
  buffMatchesSourceFilter(
    buff({ ownerCharacterId: 'operator-a', sourceName: '干员甲' }),
    { kind: 'character', id: 'operator-a', name: '干员甲' },
  ),
  true,
);

const searchEntry: LocalBuffSearchResult = {
  key: 'group/item/effect',
  sourceKind: 'candidate',
  ownerBuffDomain: 'weapon',
  groupId: 'group',
  groupName: '组',
  itemId: 'item',
  itemName: '项',
  effectId: 'effect',
  displayName: '候选效果',
  name: 'candidate-effect',
  type: 'skillDamageBonus',
  value: 0.15,
  description: '描述',
  condition: '条件',
  category: 'countable',
  maxStacks: 3,
  sourceName: '候选来源',
  source: 'weapon',
  level: 'Lv3',
  effectKind: 'modifier',
};
const searchEntrySnapshot = structuredClone(searchEntry);
const convertedBuff = buffFromSearchResult(searchEntry);
assert.deepEqual(searchEntry, searchEntrySnapshot);
assert.deepEqual(convertedBuff, {
  id: 'candidate-add-group/item/effect',
  name: 'candidate-effect',
  displayName: '候选效果',
  sourceName: '候选来源',
  level: 'Lv3',
  type: 'skillDamageBonus',
  value: 0.15,
  description: '描述',
  source: 'weapon',
  condition: '条件',
  category: 'countable',
  maxStacks: 3,
  ownerBuffDomain: 'weapon',
  ownerCharacterId: undefined,
  ownerBuffGroup: undefined,
  valueMode: undefined,
  derivedValue: undefined,
  effectKind: 'modifier',
  extraHitConfig: undefined,
  multiplier: undefined,
  refCount: 1,
});

const anomalySnapshot: AnomalyStateSnapshot = {
  id: 7,
  key: 'conductive',
  label: '导电',
  level: 2,
  sourceButtonId: 'button-a',
  sourceCharacterId: 'operator-a',
  sourceCharacterName: '干员甲',
  sourceSkillStrengthSnapshot: 80,
  effectValue: 0.12,
  primaryText: '导电 Lv2',
  secondaryText: '测试条件',
  createdAt: 123,
};
const anomalyCandidate = candidateBuffFromAnomalyStateSnapshot(anomalySnapshot);
assert.ok(anomalyCandidate);
assert.equal(anomalyCandidate.id, 'candidate-add-anomaly-state-snapshot-7');
assert.equal(anomalyCandidate.sourceName, '干员甲');
assert.equal(anomalyCandidate.condition, '测试条件');

assert.deepEqual(dedupeBuffIds(['a', '', 'b', 'a', 'b', 'c']), ['a', 'b', 'c']);

const authorityTable = {
  'stale-global-button': button({ id: 'stale-global-button' }),
};
const selectedCharacter = {
  id: 'operator-a',
  name: '干员甲',
  element: 'electric',
} as Character;
const emptyTimeline: TimelineData = {
  version: '1.1.0',
  createdAt: 1,
  updatedAt: 1,
  staffLines: [],
};
assert.equal(projectVisualSkillButtons({
  timelineData: null,
  table: authorityTable,
  selectedCharacters: [selectedCharacter],
  gridContentOffsetX: null,
}), null);
assert.deepEqual(projectVisualSkillButtons({
  timelineData: emptyTimeline,
  table: authorityTable,
  selectedCharacters: [selectedCharacter],
  gridContentOffsetX: null,
}), []);

const projectedTimeline = projectVisualSkillButtons({
  timelineData: {
    ...emptyTimeline,
    staffLines: [{
      staffIndex: 0,
      characterName: '干员甲',
      occupiedNodes: [2],
      buttons: [{
        id: 'timeline-button',
        characterId: 'operator-a',
        characterName: '干员甲',
        skillType: 'A',
        staffIndex: 0,
        lineIndex: 0,
        nodeIndex: 2,
        nodeNumber: 3,
        position: { x: 10, y: 20 },
        buffIds: ['timeline-buff'],
      }],
    }],
  },
  table: {
    ...authorityTable,
    'timeline-button': button({
      id: 'timeline-button',
      characterId: 'operator-a',
      selectedBuff: ['persisted-buff'],
    }),
  },
  selectedCharacters: [selectedCharacter],
  gridContentOffsetX: null,
});
assert.ok(projectedTimeline);
assert.equal(projectedTimeline.length, 1);
assert.equal(projectedTimeline[0].id, 'timeline-button');
assert.deepEqual(projectedTimeline[0].selectedBuff, ['persisted-buff']);

console.log('Buff batch current-LTS model characterization contract: PASS');
