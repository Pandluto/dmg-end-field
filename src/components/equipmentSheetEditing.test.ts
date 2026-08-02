import assert from 'node:assert/strict';
import {
  applyCellValueToLibrary,
  makeNextId,
  updateLibraryEquipment,
  updateLibrarySet,
} from './EquipmentSheetPage';
import {
  type EquipmentEffect,
  type EquipmentEffectId,
  type EquipmentGearSet,
  type EquipmentItem,
  type EquipmentLibrary,
} from './equipmentSheetModel';
import { buildRows, type EquipmentRow } from './equipmentSheetWorkbook';

function makeEffect(effectId: EquipmentEffectId, overrides: Partial<EquipmentEffect> = {}): EquipmentEffect {
  return {
    effectId,
    label: `效果 ${effectId}`,
    typeKey: 'physicalDmgBonus',
    category: 'buff',
    levels: { '0': 0.1234, '1': 0.2345, '2': 0.3456, '3': 0.4567 },
    unit: 'percent',
    raw: '伤害：+12.34%/+23.45%/+34.56%/+45.67%',
    ...overrides,
  };
}

function makeEquipment(overrides: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    equipmentId: 'equipment-main',
    name: '主装备',
    part: '护甲',
    imgUrl: '/equipment-original.png',
    fixedStat: {
      label: '防御力',
      typeKey: 'defense',
      value: 999,
      unit: 'flat',
      raw: '自定义防御：+999',
    },
    effects: {
      effect1: makeEffect('effect1', {
        label: '力量',
        typeKey: 'strengthBoost',
        category: 'ability',
        levels: { '0': 10, '1': 20, '2': 30, '3': 40 },
        unit: 'flat',
        raw: '力量：+10/+20/+30/+40',
      }),
      effect2: makeEffect('effect2', {
        label: '智识',
        typeKey: 'intelligenceBoost',
        category: 'ability',
        levels: { '0': 11, '1': 21, '2': 31, '3': 41 },
        unit: 'flat',
        raw: '智识：+11/+21/+31/+41',
      }),
      effect3: makeEffect('effect3', {
        label: '自定义伤害',
        typeKey: 'ultimateDmgBonus',
      }),
    },
    ...overrides,
  };
}

function makeLibrary(overrides: Partial<EquipmentGearSet> = {}): EquipmentLibrary {
  return {
    updatedAt: '2026-08-03T00:00:00.000Z',
    gearSets: {
      'gear-set-demo': {
        gearSetId: 'gear-set-demo',
        name: '测试套装',
        buffId: 'buff-demo',
        imgUrl: '/set-original.png',
        threePieceBuffs: {
          effect1: {
            effectId: 'effect1',
            name: '三件套增益',
            category: 'passive',
            typeKey: 'physicalDmgBonus',
            value: 0.12,
            unit: 'percent',
            raw: '物理伤害：+12%',
          },
        },
        equipments: {
          'equipment-main': makeEquipment(),
        },
        ...overrides,
      },
    },
  };
}

function findRow<K extends EquipmentRow['kind']>(
  rows: EquipmentRow[],
  kind: K,
): Extract<EquipmentRow, { kind: K }> {
  const row = rows.find((candidate) => candidate.kind === kind);
  assert.ok(row, `expected ${kind} row`);
  return row as Extract<EquipmentRow, { kind: K }>;
}

function findEffectRow(
  rows: EquipmentRow[],
  kind: 'effect' | 'effectLevels',
  effectId: EquipmentEffectId,
) {
  const row = rows.find((candidate) => candidate.kind === kind && candidate.effectId === effectId);
  assert.ok(row, `expected ${kind} ${effectId} row`);
  return row as Extract<EquipmentRow, { kind: typeof kind }>;
}

const libraryForUpdates = makeLibrary();
const updateSourceSnapshot = structuredClone(libraryForUpdates);
assert.strictEqual(
  updateLibrarySet(libraryForUpdates, 'missing', (set) => ({ ...set, name: 'no-op' })),
  libraryForUpdates,
);
const renamedSetLibrary = updateLibrarySet(
  libraryForUpdates,
  'gear-set-demo',
  (set) => ({ ...set, name: '已改名' }),
);
assert.equal(renamedSetLibrary.gearSets['gear-set-demo'].name, '已改名');
assert.notStrictEqual(renamedSetLibrary, libraryForUpdates);
assert.notStrictEqual(renamedSetLibrary.gearSets['gear-set-demo'], libraryForUpdates.gearSets['gear-set-demo']);
assert.strictEqual(
  updateLibraryEquipment(libraryForUpdates, 'missing', 'equipment-main', (equipment) => equipment),
  libraryForUpdates,
);
const missingEquipmentResult = updateLibraryEquipment(
  libraryForUpdates,
  'gear-set-demo',
  'missing',
  (equipment) => equipment,
);
assert.deepEqual(missingEquipmentResult, libraryForUpdates, 'missing equipment keeps the current data unchanged');
assert.notStrictEqual(missingEquipmentResult, libraryForUpdates, 'current helper rebuilds the outer library for a missing equipment');
assert.strictEqual(missingEquipmentResult.gearSets['gear-set-demo'], libraryForUpdates.gearSets['gear-set-demo']);
const renamedEquipmentLibrary = updateLibraryEquipment(
  libraryForUpdates,
  'gear-set-demo',
  'equipment-main',
  (equipment) => ({ ...equipment, name: '已改装备' }),
);
assert.equal(renamedEquipmentLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].name, '已改装备');
assert.notStrictEqual(
  renamedEquipmentLibrary.gearSets['gear-set-demo'].equipments['equipment-main'],
  libraryForUpdates.gearSets['gear-set-demo'].equipments['equipment-main'],
);
assert.deepEqual(libraryForUpdates, updateSourceSnapshot, 'update helpers must not mutate the source library');

assert.equal(makeNextId('equipment', []), 'equipment-001');
assert.equal(makeNextId('equipment', ['equipment-001', 'equipment-003']), 'equipment-004');
assert.equal(makeNextId('equipment', ['equipment-001', 'equipment-002']), 'equipment-003');

const baseLibrary = makeLibrary();
const baseSnapshot = structuredClone(baseLibrary);
const baseRows = buildRows(baseLibrary);
const setRow = findRow(baseRows, 'set');
const equipmentRow = findRow(baseRows, 'equipment');
const fixedStatRow = findRow(baseRows, 'fixedStat');
const effectRow = findEffectRow(baseRows, 'effect', 'effect3');
const effectLevelsRow = findEffectRow(baseRows, 'effectLevels', 'effect3');
const threePieceBuffRow = findRow(baseRows, 'threePieceBuff');

assert.equal(applyCellValueToLibrary(baseLibrary, setRow, 'name', '新套装').gearSets['gear-set-demo'].name, '新套装');
assert.equal(applyCellValueToLibrary(baseLibrary, setRow, 'effectKey', 'buff-new').gearSets['gear-set-demo'].buffId, 'buff-new');
assert.equal(applyCellValueToLibrary(baseLibrary, setRow, 'description', '/new.png').gearSets['gear-set-demo'].imgUrl, '/new.png');

const changedPartLibrary = applyCellValueToLibrary(baseLibrary, equipmentRow, 'field', '护手');
const changedPartEquipment = changedPartLibrary.gearSets['gear-set-demo'].equipments['equipment-main'];
assert.equal(changedPartEquipment.part, '护手');
assert.equal(changedPartEquipment.fixedStat?.value, 999, 'part edits must not auto-apply fixed stat presets');
assert.deepEqual(changedPartEquipment.effects.effect3?.levels, baseLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.levels);
assert.equal(applyCellValueToLibrary(baseLibrary, equipmentRow, 'name', '新装备').gearSets['gear-set-demo'].equipments['equipment-main'].name, '新装备');
assert.equal(applyCellValueToLibrary(baseLibrary, equipmentRow, 'description', '/equipment.png').gearSets['gear-set-demo'].equipments['equipment-main'].imgUrl, '/equipment.png');

const fixedTypeLibrary = applyCellValueToLibrary(baseLibrary, fixedStatRow, 'effectKey', 'hp');
assert.equal(fixedTypeLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].fixedStat?.typeKey, 'hp');
assert.equal(fixedTypeLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].fixedStat?.value, 999);
assert.equal(applyCellValueToLibrary(baseLibrary, fixedStatRow, 'name', '生命值').gearSets['gear-set-demo'].equipments['equipment-main'].fixedStat?.label, '生命值');
assert.equal(
  applyCellValueToLibrary(baseLibrary, fixedStatRow, 'description', '固定描述').gearSets['gear-set-demo'].equipments['equipment-main'].fixedStat?.raw,
  '防御力：+56',
  'editing defense raw currently reapplies the armor preset',
);
assert.equal(
  applyCellValueToLibrary(fixedTypeLibrary, fixedStatRow, 'description', '固定描述').gearSets['gear-set-demo'].equipments['equipment-main'].fixedStat?.raw,
  '固定描述',
);

const changedEffectTypeLibrary = applyCellValueToLibrary(baseLibrary, effectRow, 'effectKey', 'physicalDmgBonus');
const changedEffect = changedEffectTypeLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3;
assert.equal(changedEffect?.typeKey, 'physicalDmgBonus');
assert.deepEqual(changedEffect?.levels, baseLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.levels, 'changing type must keep custom levels');
assert.equal(applyCellValueToLibrary(baseLibrary, effectRow, 'name', '新效果名').gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.label, '新效果名');
assert.equal(applyCellValueToLibrary(baseLibrary, effectRow, 'description', '自定义原文').gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.raw, '自定义原文');
const invalidEffectTypeLibrary = applyCellValueToLibrary(baseLibrary, effectRow, 'effectKey', 'not-a-valid-effect');
assert.equal(invalidEffectTypeLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.typeKey, '');
assert.deepEqual(invalidEffectTypeLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.levels, {});

const writtenLevelLibrary = applyCellValueToLibrary(baseLibrary, effectLevelsRow, 'valueText', '2:0.789');
assert.equal(writtenLevelLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.levels['2'], 0.789);
const clearedLevelLibrary = applyCellValueToLibrary(writtenLevelLibrary, effectLevelsRow, 'valueText', '2:');
assert.equal(clearedLevelLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect3?.levels['2'], undefined);
assert.strictEqual(applyCellValueToLibrary(baseLibrary, effectLevelsRow, 'valueText', '4:1'), baseLibrary);
assert.deepEqual(applyCellValueToLibrary(baseLibrary, effectLevelsRow, 'valueText', '2:not-a-number'), baseLibrary);

assert.equal(applyCellValueToLibrary(baseLibrary, threePieceBuffRow, 'field', 'condition').gearSets['gear-set-demo'].threePieceBuffs?.effect1.category, 'condition');
assert.equal(applyCellValueToLibrary(baseLibrary, threePieceBuffRow, 'name', '条件增益').gearSets['gear-set-demo'].threePieceBuffs?.effect1.name, '条件增益');
assert.equal(applyCellValueToLibrary(baseLibrary, threePieceBuffRow, 'effectKey', 'magicDmgBonus').gearSets['gear-set-demo'].threePieceBuffs?.effect1.typeKey, 'magicDmgBonus');
assert.equal(applyCellValueToLibrary(baseLibrary, threePieceBuffRow, 'valueText', '0.25').gearSets['gear-set-demo'].threePieceBuffs?.effect1.value, 0.25);
assert.equal(applyCellValueToLibrary(baseLibrary, threePieceBuffRow, 'description', '新的三件套描述').gearSets['gear-set-demo'].threePieceBuffs?.effect1.raw, '新的三件套描述');

assert.deepEqual(baseLibrary, baseSnapshot, 'cell editing transactions must not mutate the source library');

console.log('Equipment sheet editing characterization contract: PASS');
