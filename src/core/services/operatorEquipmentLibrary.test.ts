import assert from 'node:assert/strict';
import { buildConfigSnapshot } from '../calculators/operatorPanelCalculator';
import type { EquipmentPieceInput, OperatorPanelInput } from '../calculators/operatorPanelCalculator';
import { persistentLocalStorage } from '../../platform/storage/persistentStorage';
import { applyOperatorEquipmentSelectionsToSnapshot } from './operatorConfigSnapshotRefreshService';
import {
  buildOperatorEquipmentSetBuffs,
  getOperatorEquipmentEffectLevelValue,
  normalizeOperatorEquipmentLibrary,
  type EquipmentItem,
} from './operatorEquipmentLibrary';

const rawLibrary = {
  gearSets: {
    'gear-set-contract': {
      gearSetId: 'gear-set-contract',
      name: '合同套装',
      threePieceBuffs: {
        effect1: {
          effectId: 'effect1',
          name: '三件套物伤',
          category: 'passive',
          typeKey: 'physicalDmgBonus',
          value: 0.2,
          unit: 'percent',
          effectKind: 'modifier',
        },
      },
      equipments: {
        'equipment-armor': {
          equipmentId: 'equipment-armor',
          name: '合同护甲',
          part: '护甲',
          fixedStat: {
            label: '防御力',
            typeKey: 'defense',
            value: 56,
            unit: 'flat',
            raw: '防御力：+56',
          },
          effects: {
            effect1: {
              effectId: 'effect1',
              label: '主能力',
              typeKey: 'mainStatBoost',
              category: 'ability',
              levels: { '3': 18 },
              unit: 'percent',
            },
            effect3: {
              effectId: 'effect3',
              label: '副能力',
              typeKey: 'subStatBoost',
              category: 'ability',
              levels: { '3': 0.25 },
              unit: 'percent',
            },
          },
        },
        'equipment-glove': {
          equipmentId: 'equipment-glove',
          name: '合同护手',
          part: '护手',
          fixedStat: { label: '防御力', typeKey: 'defense', value: 42, unit: 'flat' },
          effects: {},
        },
        'equipment-accessory': {
          equipmentId: 'equipment-accessory',
          name: '合同配件',
          part: '配件',
          fixedStat: { label: '防御力', typeKey: 'defense', value: 21, unit: 'flat' },
          effects: {},
        },
      },
    },
  },
};

const library = normalizeOperatorEquipmentLibrary(rawLibrary);
const armor = library.gearSets['gear-set-contract'].equipments['equipment-armor'];

assert.deepEqual(
  armor.fixedStat,
  rawLibrary.gearSets['gear-set-contract'].equipments['equipment-armor'].fixedStat,
  'operator equipment normalization must preserve fixedStat',
);
assert.equal(armor.effects.effect1?.typeKey, 'mainStat');
assert.equal(armor.effects.effect1?.unit, 'flat');
assert.equal(armor.effects.effect3?.typeKey, 'subStatBoost');
assert.equal(armor.effects.effect3?.unit, 'percent');
assert.equal(getOperatorEquipmentEffectLevelValue(armor.effects.effect1, 3), 18);
assert.equal(getOperatorEquipmentEffectLevelValue(armor.effects.effect3, 3), 0.25);

const selectedEquipmentIds = ['equipment-armor', 'equipment-glove', 'equipment-accessory'];
const setBuffs = buildOperatorEquipmentSetBuffs(selectedEquipmentIds, library);
assert.deepEqual(setBuffs, [
  {
    effectId: 'effect1',
    label: '三件套物伤',
    typeKey: 'physicalDmgBonus',
    level: '三件套',
    value: 0.2,
    unit: 'percent',
    raw: undefined,
    gearSetId: 'gear-set-contract',
    gearSetName: '合同套装',
    category: 'passive',
    valueMode: undefined,
    derivedValue: undefined,
    maxStacks: undefined,
    multiplier: undefined,
    effectKind: 'modifier',
    extraHitConfig: undefined,
  },
]);

function buildPiece(slotKey: string, item: EquipmentItem): EquipmentPieceInput {
  return {
    slotKey,
    equipmentId: item.equipmentId,
    name: item.name,
    part: item.part,
    imgUrl: item.imgUrl,
    fixedStat: item.fixedStat,
    effects: Object.values(item.effects).flatMap((effect) => effect ? [{
      effectId: effect.effectId,
      label: effect.label,
      typeKey: effect.typeKey,
      level: 3,
      value: getOperatorEquipmentEffectLevelValue(effect, 3),
      unit: effect.unit,
      raw: effect.raw,
    }] : []),
  };
}

const baseInput: OperatorPanelInput = {
  operator: {
    id: 'operator-contract',
    name: '合同干员',
    level: 90,
    potential: '0潜',
    mainStat: '力量',
    subStat: '敏捷',
    mainStatFlatBonus: 0,
    subStatFlatBonus: 0,
    attributes: {
      level90: {
        atk: 0,
        hp: 0,
        strength: 10,
        agility: 20,
        intelligence: 0,
        will: 0,
      },
    },
  },
  equipment: {
    pieces: [
      buildPiece('armor', armor),
      buildPiece('glove', library.gearSets['gear-set-contract'].equipments['equipment-glove']),
      buildPiece('accessory1', library.gearSets['gear-set-contract'].equipments['equipment-accessory']),
    ],
    setBuffs,
  },
};

const snapshot = buildConfigSnapshot(baseInput);
assert.deepEqual(snapshot.equipment.pieces[0].fixedStat, armor.fixedStat);
assert.equal(snapshot.equipment.totals.mainStat, 18);
assert.equal(snapshot.equipment.totals.subStatBoost, 0.25);
assert.equal(snapshot.equipment.totals.physicalDmgBonus, 0.2);
assert.deepEqual(snapshot.equipment.setBuffs, setBuffs);

const equipmentStorageKey = 'def.equipment-sheet.library.v1';
const previousEquipmentLibrary = persistentLocalStorage.getItem(equipmentStorageKey);
const originalWindow = globalThis.window;
try {
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
    writable: true,
  });
  persistentLocalStorage.setItem(equipmentStorageKey, JSON.stringify(rawLibrary));
  const emptySnapshot = buildConfigSnapshot({
    ...baseInput,
    equipment: { pieces: [], setBuffs: [] },
  });
  const serviceProjection = applyOperatorEquipmentSelectionsToSnapshot(emptySnapshot, [{
    gearSetId: 'gear-set-contract',
    fillSlots: true,
    entryLevel: 3,
  }]).snapshot;
  const projectedArmor = serviceProjection.equipment.pieces.find((piece) => piece.equipmentId === 'equipment-armor');
  assert.deepEqual(projectedArmor?.fixedStat, armor.fixedStat, 'snapshot refresh must preserve the same fixedStat as the page model');
  assert.deepEqual(projectedArmor?.effects, snapshot.equipment.pieces[0].effects, 'snapshot refresh and page model must project the same effects');
  assert.deepEqual(serviceProjection.equipment.setBuffs, setBuffs, 'snapshot refresh and page model must project the same set buffs');
} finally {
  if (previousEquipmentLibrary === null) {
    persistentLocalStorage.removeItem(equipmentStorageKey);
  } else {
    persistentLocalStorage.setItem(equipmentStorageKey, previousEquipmentLibrary);
  }
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window');
  } else {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  }
}

console.log('Operator equipment shared normalization and snapshot projection contract: PASS');
