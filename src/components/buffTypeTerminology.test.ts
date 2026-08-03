import assert from 'node:assert/strict';
import { getBuffTypeDisplayLabel as getBuffSheetTypeLabel } from './buffDraftModel';
import { getEquipmentBuffTypeDisplayLabel } from './equipmentSheetModel';
import { getOperatorBuffTypeDisplayLabel } from './operatorDraftBuffModel';
import { getBuffTypeDisplayLabel as getWeaponTypeLabel } from './weaponDraftModel';

const labelers = [
  getBuffSheetTypeLabel,
  getWeaponTypeLabel,
  getEquipmentBuffTypeDisplayLabel,
  getOperatorBuffTypeDisplayLabel,
];

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

console.log('Shared Buff Fragile/Vulnerability terminology contract: PASS');
