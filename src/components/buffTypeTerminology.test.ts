import assert from 'node:assert/strict';
import {
  BUFF_TYPE_LABELS,
  getBuffTypeDisplayLabel as getCanonicalBuffTypeDisplayLabel,
  getBuffTypeLabel as getCanonicalBuffTypeLabel,
} from '../core/domain/buffTypeMetadata';
import { getBuffTypeDisplayLabel as getBuffSheetTypeLabel } from './buffDraftModel';
import {
  BUFF_TYPE_OPTIONS as EQUIPMENT_BUFF_TYPE_OPTIONS,
  getEquipmentBuffTypeDisplayLabel,
} from './equipmentSheetModel';
import { getOperatorBuffTypeDisplayLabel } from './operatorDraftBuffModel';
import { getOperatorBuffTypeDisplayLabel as getOperatorPageBuffTypeLabel } from './operatorDraftPageModel';
import { getBuffTypeDisplayLabel as getWeaponTypeLabel } from './weaponDraftModel';

const labelers = [
  getBuffSheetTypeLabel,
  getWeaponTypeLabel,
  getEquipmentBuffTypeDisplayLabel,
  getOperatorBuffTypeDisplayLabel,
  getOperatorPageBuffTypeLabel,
];

const canonicalLabelers = [
  getBuffSheetTypeLabel,
  getWeaponTypeLabel,
  getOperatorBuffTypeDisplayLabel,
  getOperatorPageBuffTypeLabel,
];

const equipmentLabelOverrides: Readonly<Record<string, string>> = {
  normalAttackDmgBonus: '普通攻击伤害加成',
  imbalanceDmgBonus: '对失衡目标伤害加成',
  healingBonus: '治疗效率加成',
  hpPercent: '生命值',
  damageReduction: '全伤害减免',
};

for (const [element, label] of [
  ['physical', '物理'],
  ['fire', '灼热'],
  ['electric', '电磁'],
  ['ice', '寒冷'],
  ['nature', '自然'],
  ['magic', '法术'],
] as const) {
  for (const labelType of labelers) {
    const fragile = `${element}Fragile`;
    const vulnerability = `${element}Vulnerability`;
    assert.equal(labelType(fragile), `${label}易伤 · ${fragile}`);
    assert.equal(labelType(vulnerability), `${label}脆弱 · ${vulnerability}`);
  }
}

for (const typeKey of EQUIPMENT_BUFF_TYPE_OPTIONS) {
  assert.notEqual(getCanonicalBuffTypeLabel(typeKey), typeKey, `missing canonical label: ${typeKey}`);
}

for (const [typeKey, label] of Object.entries(BUFF_TYPE_LABELS)) {
  assert.equal(getCanonicalBuffTypeLabel(typeKey), label);
  assert.equal(getCanonicalBuffTypeDisplayLabel(typeKey), `${label} · ${typeKey}`);
  for (const labelType of canonicalLabelers) {
    assert.equal(labelType(typeKey), `${label} · ${typeKey}`);
  }
  assert.equal(
    getEquipmentBuffTypeDisplayLabel(typeKey),
    `${equipmentLabelOverrides[typeKey] ?? label} · ${typeKey}`,
  );
}

assert.equal(getCanonicalBuffTypeDisplayLabel('normalAttackDmgBonus'), '普攻伤害加成 · normalAttackDmgBonus');
assert.equal(getEquipmentBuffTypeDisplayLabel('normalAttackDmgBonus'), '普通攻击伤害加成 · normalAttackDmgBonus');
assert.equal(getCanonicalBuffTypeLabel('imbalanceDmgBonus'), '失衡伤害加成');
assert.equal(getEquipmentBuffTypeDisplayLabel('imbalanceDmgBonus'), '对失衡目标伤害加成 · imbalanceDmgBonus');
assert.equal(getCanonicalBuffTypeLabel('hpPercent'), '生命百分比');
assert.equal(getEquipmentBuffTypeDisplayLabel('hpPercent'), '生命值 · hpPercent');
assert.equal(getCanonicalBuffTypeLabel('unknownCustomType'), 'unknownCustomType');
assert.equal(getCanonicalBuffTypeDisplayLabel('', { emptyLabel: '未设置类型' }), '未设置类型');
assert.equal(getBuffSheetTypeLabel(''), '暂无');
assert.equal(getWeaponTypeLabel(''), '-');
assert.equal(getOperatorBuffTypeDisplayLabel(''), '-');
assert.equal(getOperatorPageBuffTypeLabel(''), '-');
assert.equal(getEquipmentBuffTypeDisplayLabel(''), '未映射');
assert.equal(Object.isFrozen(BUFF_TYPE_LABELS), true);

console.log('Shared Buff type metadata contract: PASS');
