import assert from 'node:assert/strict';
import { buildWeaponFormulaBinding, type WeaponWorkbookSelection } from './weaponDraftFormula';
import {
  buildWeaponSheetRows,
  normalizeWeaponDraft,
  type WeaponDraft,
  type WeaponSheetRow,
} from './weaponDraftModel';

const draft = normalizeWeaponDraft({
  id: 'formula-weapon',
  name: '公式武器',
  rarity: 6,
  description: '公式描述',
  imgUrl: '/images/formula.png',
  skills: {
    skill1: {
      name: '能力值',
      statType: '敏捷提升',
      levels: { 1: { value: 10 } },
    },
    skill2: {
      name: '属性',
      statType: '攻击提升',
      levels: { 1: { value: 12 } },
    },
    skill3: {
      name: '武器特效',
      effects: {
        fixed: {
          name: '固定效果',
          type: 'physicalDmgBonus',
          category: 'passive',
          levels: { 1: 10, 9: 90 },
        },
        extra: {
          name: '额外伤害',
          type: '',
          category: 'countable',
          effectKind: 'extraHit',
          extraHitConfig: {
            key: 'extra-hit',
            damageType: 'fire',
            skillType: 'E',
            baseMultiplier: 2.5,
            imbalanceValue: 10,
            cooldownSeconds: 5,
            trigger: 'physicalAbnormal',
          },
          levels: { 1: 2.5, 9: 4.5 },
        },
      },
    },
  },
});

const rows = buildWeaponSheetRows(draft);
const rowByKey = Object.fromEntries(rows.map((row) => [row.key, row])) as Record<string, WeaponSheetRow>;

function cell(
  sourceRowKey: string,
  columnKey: WeaponWorkbookSelection['columnKey'],
  address = 'A1',
): WeaponWorkbookSelection {
  return { sourceRowKey, columnKey, address };
}

function binding(
  rowKey: string,
  columnKey: WeaponWorkbookSelection['columnKey'],
  address?: string,
) {
  const result = buildWeaponFormulaBinding(draft, cell(rowKey, columnKey, address), rowByKey[rowKey]);
  assert.ok(result, `expected formula binding for ${rowKey}:${columnKey}`);
  return result;
}

assert.equal(buildWeaponFormulaBinding(draft, null, null), null);
assert.equal(buildWeaponFormulaBinding(draft, cell('growth-formula-weapon', 'name'), rowByKey['growth-formula-weapon']), null);

const weaponName = binding('weapon-formula-weapon', 'name');
assert.deepEqual({
  key: weaponName.key,
  focusId: weaponName.focusId,
  inputMode: weaponName.inputMode,
  value: weaponName.value,
  placeholder: weaponName.placeholder,
}, {
  key: 'weapon:name',
  focusId: 'weapon-name',
  inputMode: 'text',
  value: '公式武器',
  placeholder: '武器名称',
});
const renamedDraft = weaponName.apply(draft, '潮涌');
assert.equal(renamedDraft.name, '潮涌');
assert.equal(renamedDraft.id, 'chaoyong');
assert.equal(draft.name, '公式武器', 'formula apply must not mutate the source draft');

const weaponId = binding('weapon-formula-weapon', 'idText');
assert.equal(weaponId.value, 'formula-weapon');
assert.equal(weaponId.apply(draft, '  manual-id  ').id, 'manual-id');
assert.equal(weaponId.apply(draft, '  ').id, 'formula-weapon');

const weaponImage = binding('weapon-formula-weapon', 'slot');
assert.equal(weaponImage.control, 'image-search-select');
assert.equal(weaponImage.value, '/images/formula.png');
assert.equal(weaponImage.apply(draft, '  /images/next.png  ').imgUrl, '/images/next.png');

const weaponRarity = binding('weapon-formula-weapon', 'valueText');
assert.equal(weaponRarity.inputMode, 'number');
assert.equal(weaponRarity.apply(draft, '5').rarity, 5);
assert.equal(weaponRarity.apply(draft, 'not-a-number').rarity, 6);

const weaponDescription = binding('weapon-formula-weapon', 'description');
assert.equal(weaponDescription.apply(draft, ' 新描述 ').description, ' 新描述 ');

const skill1Stat = binding('skill-skill1', 'slot');
assert.equal(skill1Stat.control, 'select');
assert.equal(skill1Stat.value, '敏捷提升');
assert.ok(skill1Stat.options?.some((option) => option.value === '力量提升'));
assert.equal(skill1Stat.apply(draft, '力量提升').skills.skill1.statType, '力量提升');

const skill1Name = binding('skill-skill1', 'name');
assert.equal(skill1Name.readOnly, true);
assert.equal(skill1Name.value, '能力值');

const skill3Name = binding('skill-skill3', 'name');
assert.equal(skill3Name.readOnly, false);
assert.equal(skill3Name.apply(draft, '新特效').skills.skill3.name, '新特效');

const fixedSkillEffectName = binding('effect-skill1-value', 'name');
assert.equal(fixedSkillEffectName.control, 'select');
assert.equal(fixedSkillEffectName.value, '敏捷提升');
assert.equal(fixedSkillEffectName.apply(draft, '意志提升').skills.skill1.statType, '意志提升');

const effectName = binding('effect-skill3-effect-fixed', 'name');
assert.equal(effectName.value, '固定效果');
assert.equal(effectName.apply(draft, '  新效果  ').skills.skill3.effects.fixed.name, '新效果');
assert.equal(effectName.apply(draft, '  '), draft);

const effectCategory = binding('effect-skill3-effect-fixed', 'slot');
assert.equal(effectCategory.control, 'select');
assert.equal(effectCategory.value, 'passive');
assert.ok(effectCategory.options?.some((option) => option.value === 'countable'));
assert.equal(effectCategory.apply(draft, 'condition').skills.skill3.effects.fixed.category, 'condition');

const effectType = binding('effect-skill3-effect-fixed', 'effectKey');
assert.equal(effectType.control, 'search-select');
assert.equal(effectType.value, 'physicalDmgBonus');
assert.ok(effectType.options?.some((option) => option.value === 'magicDmgBonus'));
assert.equal(effectType.apply(draft, ' magicDmgBonus ').skills.skill3.effects.fixed.type, 'magicDmgBonus');

const extraHitType = binding('effect-skill3-effect-extra', 'effectKey');
assert.equal(extraHitType.readOnly, true);
assert.equal(extraHitType.value, 'fire / E');
assert.equal(extraHitType.apply(draft, 'ignored'), draft);

const effectId = binding('effect-skill3-effect-fixed', 'idText');
assert.equal(effectId.readOnly, true);
assert.equal(effectId.value, 'skill3-effect1');
const effectDescription = binding('effect-skill3-effect-fixed', 'description');
assert.equal(effectDescription.readOnly, true);
assert.equal(effectDescription.value, '');

const valueLevel = binding('effect-levels-skill1-value', 'name', 'Lv2');
assert.equal(valueLevel.inputMode, 'number');
assert.equal(valueLevel.value, '');
const valueLevelUpdated = valueLevel.apply(draft, '12.5');
assert.equal(valueLevelUpdated.skills.skill1.levels['2'].value, 12.5);
assert.equal(draft.skills.skill1.levels['2'].value, undefined);
assert.equal(valueLevel.apply(valueLevelUpdated, ' ').skills.skill1.levels['2'].value, undefined);

const effectLevel = binding('effect-levels-skill3-effect-fixed', 'name', 'Lv1');
assert.equal(effectLevel.value, '10');
const effectLevelUpdated = effectLevel.apply(draft, '18.75');
assert.equal(effectLevelUpdated.skills.skill3.effects.fixed.levels['1'], 18.75);
assert.equal(draft.skills.skill3.effects.fixed.levels['1'], 10);
assert.equal(effectLevel.apply(effectLevelUpdated, ' ').skills.skill3.effects.fixed.levels['1'], undefined);

const levelSeries = binding('effect-levels-skill3-effect-fixed', 'name', 'A12');
assert.equal(levelSeries.readOnly, true);
assert.equal(levelSeries.value, 'Lv1~Lv9');

const missingEffectDraft: WeaponDraft = {
  ...draft,
  skills: {
    ...draft.skills,
    skill3: {
      ...draft.skills.skill3,
      effects: { extra: draft.skills.skill3.effects.extra },
    },
  },
};
assert.deepEqual(effectName.apply(missingEffectDraft, '不存在'), missingEffectDraft);
assert.equal(effectCategory.apply(missingEffectDraft, 'condition'), missingEffectDraft);

console.log('Weapon formula binding immutable apply contract: PASS');
