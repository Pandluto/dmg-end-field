import assert from 'node:assert/strict';
import {
  buildEquipmentFormulaBinding,
  type EquipmentWorkbookSelection,
} from './equipmentSheetFormula';
import {
  EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS,
  EQUIPMENT_PARTS,
  type EquipmentEffect,
  type EquipmentEffectId,
  type EquipmentLibrary,
} from './equipmentSheetModel';
import { buildRows, type EquipmentRow } from './equipmentSheetWorkbook';

function makeEffect(effectId: EquipmentEffectId, overrides: Partial<EquipmentEffect> = {}): EquipmentEffect {
  return {
    effectId,
    label: `效果 ${effectId}`,
    typeKey: effectId === 'effect1' ? 'strengthBoost' : 'physicalDmgBonus',
    category: effectId === 'effect1' ? 'ability' : 'buff',
    levels: { '0': 10, '1': 20, '2': 30, '3': 40 },
    unit: effectId === 'effect1' ? 'flat' : 'percent',
    raw: '等级数值',
    ...overrides,
  };
}

const library: EquipmentLibrary = {
  updatedAt: '2026-08-03T00:00:00.000Z',
  gearSets: {
    'gear-set-formula': {
      gearSetId: 'gear-set-formula',
      name: '公式套装',
      buffId: 'buff-formula',
      imgUrl: '/sets/formula.png',
      threePieceBuffs: {
        effect1: {
          effectId: 'effect1',
          name: '三件套效果',
          category: 'passive',
          typeKey: 'physicalDmgBonus',
          value: 0.12,
          unit: 'percent',
          raw: '物理伤害：+12%',
        },
        effect2: {
          effectId: 'effect2',
          name: '额外伤害段',
          category: 'countable',
          typeKey: '',
          value: 0,
          unit: 'percent',
          effectKind: 'extraHit',
          raw: '额外伤害',
        },
      },
      equipments: {
        'equipment-formula': {
          equipmentId: 'equipment-formula',
          name: '公式装备',
          part: '护甲',
          imgUrl: '/equipment/formula.png',
          fixedStat: {
            label: '防御力',
            typeKey: 'defense',
            value: 56,
            unit: 'flat',
            raw: '防御力：+56',
          },
          effects: {
            effect1: makeEffect('effect1'),
            effect2: makeEffect('effect2'),
          },
        },
      },
    },
  },
};

const rows = buildRows(library);
const rowByKey = Object.fromEntries(rows.map((row) => [row.key, row])) as Record<string, EquipmentRow>;
const setRowKey = 'set-gear-set-formula';
const threePieceHeaderRowKey = 'three-piece-buff-header-gear-set-formula';
const threePieceRowKey = 'three-piece-buff-gear-set-formula-effect1';
const extraHitRowKey = 'three-piece-buff-gear-set-formula-effect2';
const equipmentRowKey = 'equipment-gear-set-formula-equipment-formula';
const fixedRowKey = 'fixed-gear-set-formula-equipment-formula';
const effectRowKey = 'effect-gear-set-formula-equipment-formula-effect1';
const levelsRowKey = 'levels-gear-set-formula-equipment-formula-effect1';

function rowCellValue(row: EquipmentRow, columnKey: EquipmentWorkbookSelection['columnKey']): string {
  if (columnKey === 'name') return row.title;
  return row[columnKey];
}

function cell(
  rowKey: string,
  columnKey: EquipmentWorkbookSelection['columnKey'],
  address = 'A1',
): EquipmentWorkbookSelection {
  const row = rowByKey[rowKey];
  assert.ok(row, `missing fixture row ${rowKey}`);
  return {
    address,
    sourceRowKey: rowKey,
    columnKey,
    value: rowCellValue(row, columnKey),
  };
}

function binding(
  rowKey: string,
  columnKey: EquipmentWorkbookSelection['columnKey'],
  address?: string,
) {
  const result = buildEquipmentFormulaBinding(
    library,
    cell(rowKey, columnKey, address),
    rowByKey[rowKey],
  );
  assert.ok(result, `expected formula binding for ${rowKey}:${columnKey}`);
  return result;
}

assert.equal(buildEquipmentFormulaBinding(library, null, null), null);
assert.equal(buildEquipmentFormulaBinding(library, cell(setRowKey, 'name'), null), null);

const setName = binding(setRowKey, 'name');
assert.deepEqual({
  key: setName.key,
  value: setName.value,
  inputMode: setName.inputMode,
  control: setName.control,
  readOnly: setName.readOnly,
}, {
  key: 'set-gear-set-formula:name',
  value: '公式套装',
  inputMode: 'text',
  control: undefined,
  readOnly: undefined,
});
const renamedLibrary = setName.apply(library, '新套装');
assert.equal(renamedLibrary.gearSets['gear-set-formula'].name, '新套装');
assert.equal(library.gearSets['gear-set-formula'].name, '公式套装');
assert.notEqual(renamedLibrary, library);

const setImage = binding(setRowKey, 'description');
assert.equal(setImage.control, 'image-search-select');
assert.equal(setImage.value, '/sets/formula.png');
assert.equal(setImage.placeholder, '搜索套装配图');
assert.equal(setImage.apply(library, 'assets/set-next.png').gearSets['gear-set-formula'].imgUrl, 'assets/set-next.png');

const setId = binding(setRowKey, 'idText');
assert.equal(setId.readOnly, true);
assert.equal(setId.key, 'set-gear-set-formula:idText:readonly');
assert.strictEqual(setId.apply(library, 'ignored'), library);

const equipmentField = binding(equipmentRowKey, 'field');
assert.equal(equipmentField.control, 'select');
assert.deepEqual(equipmentField.options?.map((option) => option.value), EQUIPMENT_PARTS);
assert.equal(equipmentField.value, '护甲');
assert.equal(
  equipmentField.apply(library, '配件').gearSets['gear-set-formula'].equipments['equipment-formula'].part,
  '配件',
);

const equipmentImage = binding(equipmentRowKey, 'description');
assert.equal(equipmentImage.control, 'image-search-select');
assert.equal(equipmentImage.value, '/equipment/formula.png');
assert.equal(equipmentImage.placeholder, '搜索装备配图');
assert.equal(
  equipmentImage.apply(library, 'assets/equipment-next.png').gearSets['gear-set-formula'].equipments['equipment-formula'].imgUrl,
  'assets/equipment-next.png',
);

const equipmentId = binding(equipmentRowKey, 'idText');
assert.equal(equipmentId.readOnly, true);
assert.equal(equipmentId.value, 'equipment-formula');
assert.strictEqual(equipmentId.apply(library, 'ignored'), library);

const fixedType = binding(fixedRowKey, 'effectKey');
assert.equal(fixedType.control, 'select');
assert.deepEqual(fixedType.options, [
  { value: 'defense', label: '防御力 · defense' },
  { value: 'hp', label: '生命 · hp' },
  { value: 'flatAtk', label: '固定攻击力 · flatAtk' },
]);
assert.equal(fixedType.value, 'defense');
assert.equal(
  fixedType.apply(library, 'hp').gearSets['gear-set-formula'].equipments['equipment-formula'].fixedStat?.typeKey,
  'hp',
);

const fixedValue = binding(fixedRowKey, 'valueText');
assert.equal(fixedValue.readOnly, true, 'fixedStat.valueText remains characterization-only');
assert.equal(fixedValue.value, '56');
assert.strictEqual(fixedValue.apply(library, '999'), library);

const fixedDescription = binding(fixedRowKey, 'description');
assert.equal(fixedDescription.readOnly, undefined);
assert.equal(
  fixedDescription.apply(library, '固定描述').gearSets['gear-set-formula'].equipments['equipment-formula'].fixedStat?.raw,
  '固定描述',
);

const effectCategory = binding(effectRowKey, 'field');
assert.equal(effectCategory.control, 'select');
assert.equal(effectCategory.value, 'ability');
assert.deepEqual(effectCategory.options, [
  { value: 'ability', label: '能力值' },
  { value: 'buff', label: 'Buff类型' },
]);
assert.equal(
  effectCategory.apply(library, 'buff').gearSets['gear-set-formula'].equipments['equipment-formula'].effects.effect1?.category,
  'buff',
);

const effectType = binding(effectRowKey, 'effectKey');
assert.equal(effectType.control, 'search-select');
assert.ok(effectType.options && effectType.options.length > 0);
assert.ok(effectType.options?.every((option) => option.label.includes(option.value)));
const nextEffectType = effectType.options?.find((option) => option.value !== effectType.value)?.value ?? effectType.value;
assert.equal(
  effectType.apply(library, nextEffectType).gearSets['gear-set-formula'].equipments['equipment-formula'].effects.effect1?.typeKey,
  nextEffectType,
);

const effectName = binding(effectRowKey, 'name');
assert.equal(effectName.value, '效果 effect1');
assert.equal(
  effectName.apply(library, '新效果').gearSets['gear-set-formula'].equipments['equipment-formula'].effects.effect1?.label,
  '新效果',
);

const effectValue = binding(effectRowKey, 'valueText');
assert.equal(effectValue.readOnly, true, 'effect.valueText remains characterization-only');
assert.equal(effectValue.value, '');
assert.strictEqual(effectValue.apply(library, 'ignored'), library);

const effectDescription = binding(effectRowKey, 'description');
assert.equal(effectDescription.readOnly, true, 'effect.description remains characterization-only');
assert.equal(effectDescription.value, '效果 effect1：+10 / +20 / +30 / +40');
assert.strictEqual(effectDescription.apply(library, 'ignored'), library);

const effectLevels = binding(levelsRowKey, 'valueText', 'Lv2');
assert.equal(effectLevels.key, 'levels-gear-set-formula-equipment-formula-effect1:2');
assert.equal(effectLevels.value, '30');
assert.equal(effectLevels.inputMode, 'number');
assert.equal(effectLevels.placeholder, 'Lv2');
assert.equal(effectLevels.control, undefined);
assert.equal(effectLevels.readOnly, undefined);
const updatedLevels = effectLevels.apply(library, '99.5');
assert.equal(
  updatedLevels.gearSets['gear-set-formula'].equipments['equipment-formula'].effects.effect1?.levels['2'],
  99.5,
);
assert.equal(library.gearSets['gear-set-formula'].equipments['equipment-formula'].effects.effect1.levels['2'], 30);
assert.equal(
  buildEquipmentFormulaBinding(
    library,
    cell(levelsRowKey, 'valueText', 'Lv9'),
    rowByKey[levelsRowKey],
  ),
  null,
);

const threePieceField = binding(threePieceRowKey, 'field');
assert.equal(threePieceField.control, 'select');
assert.equal(threePieceField.value, 'passive');
assert.deepEqual(threePieceField.options, EQUIPMENT_BUFF_BUSINESS_TYPE_OPTIONS);
assert.equal(
  threePieceField.apply(library, 'condition').gearSets['gear-set-formula'].threePieceBuffs?.effect1.category,
  'condition',
);

const threePieceType = binding(threePieceRowKey, 'effectKey');
assert.equal(threePieceType.control, 'search-select');
assert.ok(threePieceType.options?.some((option) => option.value === 'strengthBoost'));
assert.equal(
  threePieceType.apply(library, 'strengthBoost').gearSets['gear-set-formula'].threePieceBuffs?.effect1.typeKey,
  'strengthBoost',
);

const threePieceValue = binding(threePieceRowKey, 'valueText');
assert.equal(threePieceValue.inputMode, 'number');
assert.equal(threePieceValue.readOnly, undefined);
assert.equal(threePieceValue.value, '0.12');
assert.equal(
  threePieceValue.apply(library, '0.33').gearSets['gear-set-formula'].threePieceBuffs?.effect1.value,
  0.33,
);

const extraHitType = binding(extraHitRowKey, 'effectKey');
assert.equal(extraHitType.readOnly, true);
assert.equal(extraHitType.key, 'three-piece-buff-gear-set-formula-effect2:effectKey:extra-hit-types');
assert.strictEqual(extraHitType.apply(library, 'ignored'), library);

const header = binding(threePieceHeaderRowKey, 'name');
assert.equal(header.key, 'three-piece-buff-header-gear-set-formula:name:readonly');
assert.equal(header.value, '三件套效果：');
assert.equal(header.control, undefined);
assert.equal(header.readOnly, true);
assert.strictEqual(header.apply(library, 'ignored'), library);

const missingLibrary: EquipmentLibrary = { ...library, gearSets: {} };
const missingTargetBinding = buildEquipmentFormulaBinding(
  missingLibrary,
  cell(effectRowKey, 'effectKey'),
  rowByKey[effectRowKey],
);
assert.ok(missingTargetBinding);
assert.ok(missingTargetBinding.options && missingTargetBinding.options.length > 0);
assert.strictEqual(missingTargetBinding.apply(missingLibrary, 'strengthBoost'), missingLibrary);

const missingLevelBinding = buildEquipmentFormulaBinding(
  missingLibrary,
  cell(levelsRowKey, 'valueText', 'Lv2'),
  rowByKey[levelsRowKey],
);
assert.ok(missingLevelBinding);
assert.equal(missingLevelBinding.value, '');
assert.strictEqual(missingLevelBinding.apply(missingLibrary, '12'), missingLibrary);

console.log('Equipment formula binding immutable apply and LTS matrix contract: PASS');
