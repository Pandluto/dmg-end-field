import assert from 'node:assert/strict';
import { diffTimelinePayloads } from './diff';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

const makeOperatorConfig = () => ({
  operator: {
    id: 'operator-a',
    name: '测试员',
    level: 90,
    potential: '0潜',
    mainStat: '敏捷',
    subStat: '智识',
    mainStatFlatBonus: 60,
    subStatFlatBonus: 0,
    skillConfig: { A: 'L9', B: 'M3', E: 'L9', Q: 'L9', Dot: 'L9' },
  },
  weapon: {
    id: 'weapon-a',
    name: '测试武器',
    config: {
      level: 90,
      potential: '0潜',
      skillLevels: { skill1: 9, skill2: 9, skill3: 4 },
    },
    // Derived calculator output is deliberately not part of the comparable input projection.
    attack: 999,
    skills: { skill1: { value: 123 } },
    totals: { attack: 999 },
  },
  equipment: {
    pieces: [
      {
        slotKey: 'accessory1',
        equipmentId: 'equipment-a1',
        name: '一号装备',
        part: '饰品',
        effects: [
          { effectId: 'effect2', label: '副词条', typeKey: 'agility', level: 2, value: 2, unit: 'flat' },
          { effectId: 'effect1', label: '主词条', typeKey: 'strength', level: 1, value: 1, unit: 'flat' },
        ],
      },
      {
        slotKey: 'accessory2',
        equipmentId: 'equipment-a2',
        name: '二号装备',
        part: '饰品',
        effects: [{ effectId: 'effect1', label: '主词条', typeKey: 'will', level: 1, value: 3, unit: 'flat' }],
      },
      {
        slotKey: 'armor',
        equipmentId: 'equipment-armor',
        name: '护甲',
        part: '护甲',
        effects: [],
      },
      {
        slotKey: 'glove',
        equipmentId: 'equipment-glove',
        name: '手套',
        part: '手套',
        effects: [],
      },
    ],
    // Set buffs and totals are derived from the selected equipment and are ignored here.
    setBuffs: [{ gearSetId: 'set-a', effectId: 'set-effect', value: 1 }],
    totals: { agility: 123 },
  },
  panel: { calc: { atk: 1 }, display: { atk: 1 } },
  buff: { operator: [], weapon: [], equipment: [] },
  detailMarkdown: 'derived markdown',
});

const payload = (
  characterInputMap: TimelineSnapshotPayload['characterInputMap'],
  operatorConfigPageCache: TimelineSnapshotPayload['operatorConfigPageCache'] = {},
) => ({
  selectedCharacters: ['mifu'],
  timelineData: { version: '1.0.0', createdAt: 1, updatedAt: 1, staffLines: [] },
  skillButtonTable: {},
  allBuffList: [],
  anomalyStateSnapshots: [],
  characterInputMap,
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache,
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

const baseConfig = makeOperatorConfig();
const configWithDifferentInsertionOrder = structuredClone(baseConfig) as any;
configWithDifferentInsertionOrder.operator.skillConfig = {
  Dot: 'L9', Q: 'L9', E: 'L9', B: 'M3', A: 'L9',
};
configWithDifferentInsertionOrder.weapon.config.skillLevels = {
  skill3: 4, skill1: 9, skill2: 9,
};
configWithDifferentInsertionOrder.equipment.pieces.reverse();
configWithDifferentInsertionOrder.equipment.pieces[0].effects.reverse();
configWithDifferentInsertionOrder.equipment.setBuffs = [{ gearSetId: 'set-b', effectId: 'other', value: 999 }];
configWithDifferentInsertionOrder.weapon.attack = 1;
configWithDifferentInsertionOrder.weapon.totals = { attack: 1 };
configWithDifferentInsertionOrder.detailMarkdown = 'another derived value';

const orderOnlyDiff = diffTimelinePayloads(
  payload({}, { 'mifu': baseConfig } as never),
  payload({}, { 'mifu': configWithDifferentInsertionOrder } as never),
);
assert.deepEqual(orderOnlyDiff.changedOperatorConfigs, []);
assert.equal(orderOnlyDiff.summary.changedOperatorConfigFieldCount, 0);

const emptyValueDiff = diffTimelinePayloads(
  payload({}, {
    'empty': {
      operator: { skillConfig: { A: '' } },
      weapon: { config: { level: '', skillLevels: { skill1: '' } } },
      equipment: { pieces: [{ slotKey: 'accessory1', equipmentId: '', effects: [{ effectId: '', value: '' }] }] },
    },
  } as never),
  payload({}, {
    'empty': {
      operator: { skillConfig: {} },
      weapon: { config: { skillLevels: {} } },
      equipment: { pieces: [] },
    },
  } as never),
);
assert.deepEqual(emptyValueDiff.changedOperatorConfigs, []);

const changedConfig = structuredClone(baseConfig) as any;
changedConfig.operator.level = '91';
changedConfig.operator.potential = '满潜';
changedConfig.operator.skillConfig.A = 'M3';
changedConfig.weapon.id = 'weapon-b';
changedConfig.weapon.name = '新武器';
changedConfig.weapon.config.level = '80';
changedConfig.weapon.config.potential = '满潜';
changedConfig.weapon.config.skillLevels.skill2 = 10;
changedConfig.equipment.pieces[1].equipmentId = 'equipment-a2-upgraded';
changedConfig.equipment.pieces[0].effects.find((effect: any) => effect.effectId === 'effect1').value = '7';

const configDiff = diffTimelinePayloads(
  payload({}, { 'mifu': baseConfig } as never),
  payload({}, { 'mifu': changedConfig } as never),
);
assert.equal(configDiff.summary.changedOperatorConfigCount, 1);
assert.equal(configDiff.summary.addedOperatorConfigCount, 0);
assert.equal(configDiff.summary.removedOperatorConfigCount, 0);
assert.deepEqual(
  configDiff.changedOperatorConfigs[0]?.changes.map((change) => change.path),
  [
    'equipment.pieces[1].equipmentId',
    'equipment.pieces[0].effects[0].value',
    'operator.level',
    'operator.potential',
    'operator.skillConfig.A',
    'weapon.config.level',
    'weapon.config.potential',
    'weapon.config.skillLevels.skill2',
    'weapon.id',
    'weapon.name',
  ].sort(),
);
assert.equal(
  configDiff.changedOperatorConfigs[0]?.changes.find((change) => change.path === 'weapon.config.level')?.before,
  90,
);
assert.equal(
  configDiff.changedOperatorConfigs[0]?.changes.find((change) => change.path === 'equipment.pieces[1].equipmentId')?.after,
  'equipment-a2-upgraded',
);

const addedConfigDiff = diffTimelinePayloads(
  payload({}, {} as never),
  payload({}, { 'mifu': baseConfig } as never),
);
assert.equal(addedConfigDiff.summary.addedOperatorConfigCount, 1);
assert.equal(addedConfigDiff.changedOperatorConfigs[0]?.change, 'added');
assert(addedConfigDiff.changedOperatorConfigs[0]?.changes.some((change) => change.path === 'operator.level'));

const removedConfigDiff = diffTimelinePayloads(
  payload({}, { 'mifu': baseConfig } as never),
  payload({}, {} as never),
);
assert.equal(removedConfigDiff.summary.removedOperatorConfigCount, 1);
assert.equal(removedConfigDiff.changedOperatorConfigs[0]?.change, 'removed');
