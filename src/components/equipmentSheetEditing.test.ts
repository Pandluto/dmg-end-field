import assert from 'node:assert/strict';
import {
  addEquipmentFixedStat,
  applyCellValueToLibrary,
  applyEquipmentEffectValueMapping,
  createEquipmentEffect,
  createEquipmentGearSet,
  createEquipmentItem,
  createEquipmentThreePieceEffect,
  deleteEquipmentNode,
  duplicateEquipmentEffect,
  duplicateEquipmentItem,
  duplicateEquipmentThreePieceEffect,
  makeNextId,
  normalizeEquipmentLibraryOrder,
  updateLibraryEquipment,
  updateLibrarySet,
} from './equipmentSheetEditing';
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

const createdSet = createEquipmentGearSet(baseLibrary);
assert.equal(createdSet.changed, true);
assert.equal(createdSet.gearSetId, 'gear-set-002');
assert.equal(createdSet.selectedRowKey, 'set-gear-set-002');
assert.equal(createdSet.library.gearSets['gear-set-002'].name, '新建套装');

const createdEquipment = createEquipmentItem(baseLibrary, 'gear-set-demo');
assert.equal(createdEquipment.changed, true);
assert.equal(createdEquipment.equipmentId, 'equipment-002');
assert.equal(createdEquipment.selectedRowKey, 'equipment-gear-set-demo-equipment-002');
assert.deepEqual(createdEquipment.library.gearSets['gear-set-demo'].equipments['equipment-002'].fixedStat, {
  label: '防御力',
  typeKey: 'defense',
  value: 56,
  unit: 'flat',
  raw: '防御力：+56',
});
assert.deepEqual(createEquipmentItem(baseLibrary, 'missing'), { library: baseLibrary, changed: false });
const createdEquipmentAgain = createEquipmentItem(createdEquipment.library, 'gear-set-demo');
assert.equal(createdEquipmentAgain.equipmentId, 'equipment-003');
assert.ok(createdEquipmentAgain.library.gearSets['gear-set-demo'].equipments['equipment-002']);
assert.ok(createdEquipmentAgain.library.gearSets['gear-set-demo'].equipments['equipment-003']);

const libraryWithEffectGap = makeLibrary({
  equipments: {
    'equipment-main': makeEquipment({
      effects: {
        effect1: makeEffect('effect1'),
        effect3: makeEffect('effect3'),
      },
    }),
  },
});
const createdEffect = createEquipmentEffect(libraryWithEffectGap, 'gear-set-demo', 'equipment-main');
assert.equal(createdEffect.changed, true);
assert.equal(createdEffect.effectId, 'effect2');
assert.equal(createdEffect.selectedRowKey, 'effect-gear-set-demo-equipment-main-effect2');
assert.equal(createdEffect.library.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect2?.label, '新建增益');
const fullEffectResult = createEquipmentEffect(baseLibrary, 'gear-set-demo', 'equipment-main');
assert.deepEqual(fullEffectResult, { library: baseLibrary, changed: false });

const createdThreePiece = createEquipmentThreePieceEffect(baseLibrary, 'gear-set-demo');
assert.equal(createdThreePiece.changed, true);
assert.equal(createdThreePiece.effectId, 'effect2');
assert.equal(createdThreePiece.selectedRowKey, 'three-piece-buff-gear-set-demo-effect2');
assert.equal(createdThreePiece.library.gearSets['gear-set-demo'].threePieceBuffs?.effect2.name, '新建效果');

const duplicatedThreePiece = duplicateEquipmentThreePieceEffect(baseLibrary, 'gear-set-demo', 'effect1');
assert.equal(duplicatedThreePiece.changed, true);
assert.equal(duplicatedThreePiece.effectId, 'effect2');
assert.equal(duplicatedThreePiece.library.gearSets['gear-set-demo'].threePieceBuffs?.effect2.name, '三件套增益 副本');
assert.notStrictEqual(
  duplicatedThreePiece.library.gearSets['gear-set-demo'].threePieceBuffs?.effect2,
  baseLibrary.gearSets['gear-set-demo'].threePieceBuffs?.effect1,
);

const duplicatedEquipment = duplicateEquipmentItem(baseLibrary, 'gear-set-demo', 'equipment-main');
assert.equal(duplicatedEquipment.changed, true);
assert.equal(duplicatedEquipment.equipmentId, 'equipment-main-copy-002');
assert.equal(duplicatedEquipment.library.gearSets['gear-set-demo'].equipments['equipment-main-copy-002'].name, '主装备 副本');
assert.notStrictEqual(
  duplicatedEquipment.library.gearSets['gear-set-demo'].equipments['equipment-main-copy-002'].effects,
  baseLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects,
);

const duplicatedEffect = duplicateEquipmentEffect(libraryWithEffectGap, 'gear-set-demo', 'equipment-main', 'effect1');
assert.equal(duplicatedEffect.changed, true);
assert.equal(duplicatedEffect.effectId, 'effect2');
assert.equal(duplicatedEffect.library.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect2?.label, '效果 effect1 副本');
assert.notStrictEqual(
  duplicatedEffect.library.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect2?.levels,
  libraryWithEffectGap.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect1?.levels,
);

const libraryWithoutFixed = makeLibrary({
  equipments: {
    'equipment-main': makeEquipment({ fixedStat: undefined }),
  },
});
const addedFixed = addEquipmentFixedStat(libraryWithoutFixed, 'gear-set-demo', 'equipment-main');
assert.equal(addedFixed.changed, true);
assert.equal(addedFixed.selectedRowKey, 'fixed-gear-set-demo-equipment-main');
assert.equal(addedFixed.library.gearSets['gear-set-demo'].equipments['equipment-main'].fixedStat?.value, 56);
assert.deepEqual(addEquipmentFixedStat(baseLibrary, 'gear-set-demo', 'equipment-main'), { library: baseLibrary, changed: false });

const deletedEffect = deleteEquipmentNode(baseLibrary, {
  kind: 'effect',
  gearSetId: 'gear-set-demo',
  equipmentId: 'equipment-main',
  effectId: 'effect2',
});
assert.equal(deletedEffect.changed, true);
assert.equal(deletedEffect.library.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect2, undefined);
const deletedFixed = deleteEquipmentNode(baseLibrary, {
  kind: 'fixedStat',
  gearSetId: 'gear-set-demo',
  equipmentId: 'equipment-main',
});
assert.equal(deletedFixed.library.gearSets['gear-set-demo'].equipments['equipment-main'].fixedStat, undefined);
const deletedThreePiece = deleteEquipmentNode(baseLibrary, {
  kind: 'threePieceBuff',
  gearSetId: 'gear-set-demo',
  effectId: 'effect1',
});
assert.equal(deletedThreePiece.selectedRowKey, 'three-piece-buff-header-gear-set-demo');
assert.equal(deletedThreePiece.library.gearSets['gear-set-demo'].threePieceBuffs?.effect1, undefined);
const deletedEquipment = deleteEquipmentNode(baseLibrary, {
  kind: 'equipment',
  gearSetId: 'gear-set-demo',
  equipmentId: 'equipment-main',
});
assert.equal(deletedEquipment.library.gearSets['gear-set-demo'].equipments['equipment-main'], undefined);
const deletedSet = deleteEquipmentNode(baseLibrary, { kind: 'set', gearSetId: 'gear-set-demo' });
assert.equal(deletedSet.library.gearSets['gear-set-demo'], undefined);
assert.deepEqual(deleteEquipmentNode(baseLibrary, { kind: 'set', gearSetId: 'missing' }), { library: baseLibrary, changed: false });

const unorderedLibrary: EquipmentLibrary = {
  gearSets: {
    z: {
      gearSetId: 'z',
      name: '乙套装',
      equipments: {
        c: makeEquipment({ equipmentId: 'c', name: 'C', part: '配件', effects: { effect3: makeEffect('effect3'), effect1: makeEffect('effect1') } }),
        a: makeEquipment({ equipmentId: 'a', name: 'A', part: '护甲', effects: {} }),
      },
    },
    a: { gearSetId: 'a', name: '甲套装', equipments: {} },
  },
};
const normalizedOrder = normalizeEquipmentLibraryOrder(unorderedLibrary);
assert.deepEqual(Object.keys(normalizedOrder.library.gearSets), ['a', 'z']);
assert.deepEqual(Object.keys(normalizedOrder.library.gearSets.z.equipments), ['a', 'c']);
assert.deepEqual(Object.keys(normalizedOrder.library.gearSets.z.equipments.c.effects), ['effect1', 'effect3']);

const mappingLibrary = makeLibrary({
  equipments: {
    'equipment-main': makeEquipment({
      part: '配件',
      effects: {
        effect1: makeEffect('effect1', {
          label: '保留自定义标签',
          typeKey: 'strengthBoost',
          category: 'buff',
          unit: 'flat',
          raw: '',
          levels: { '0': 901, '1': 902, '2': 903, '3': 904 },
        }),
        effect2: makeEffect('effect2', { label: '其他词条' }),
      },
    }),
  },
});
const mappedEffect = applyEquipmentEffectValueMapping(mappingLibrary, 'gear-set-demo', 'equipment-main', 'effect1');
assert.equal(mappedEffect.changed, true);
assert.equal(mappedEffect.library.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect1?.label, '保留自定义标签');
assert.notDeepEqual(mappedEffect.library.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect1?.levels, { '0': 901, '1': 902, '2': 903, '3': 904 });
assert.deepEqual(
  mappedEffect.library.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect2,
  mappingLibrary.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect2,
);
assert.deepEqual(
  applyEquipmentEffectValueMapping(mappingLibrary, 'gear-set-demo', 'equipment-main', 'effect3'),
  { library: mappingLibrary, changed: false },
);

assert.deepEqual(baseLibrary, baseSnapshot, 'CRUD transactions must not mutate the source library');
assert.deepEqual(libraryWithEffectGap.gearSets['gear-set-demo'].equipments['equipment-main'].effects.effect2, undefined);

console.log('Equipment sheet editing characterization contract: PASS');
