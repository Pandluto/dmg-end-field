import assert from 'node:assert/strict';
import { formatBuffCardSummary } from './skillButton.shared';

assert.equal(
  formatBuffCardSummary({
    effectKind: 'extraHit',
    category: 'countable',
    maxStacks: 5,
    extraHitConfig: {
      key: 'typhon-extra-hit',
      damageType: 'nature',
      skillType: 'B',
      baseMultiplier: 0.8,
      imbalanceValue: 0,
      cooldownSeconds: 0,
      trigger: 'physicalAbnormal',
      formulaMode: 'sourceSkill',
      levelCurve: 'artsBurst',
    },
  }),
  '计段/5 / 源石技艺强度段 · 碎冰 / 法术爆发系数 / 倍率 80.0% / nature / B / CD 0s',
);

assert.equal(
  formatBuffCardSummary({
    effectKind: 'extraHit',
    category: 'condition',
    extraHitConfig: {
      key: 'inherited-extra-hit',
      damageType: 'physical',
      skillType: '',
      baseMultiplier: 1.3,
      imbalanceValue: 0,
      cooldownSeconds: 3,
      trigger: 'physicalAbnormal',
      formulaMode: 'inherited',
      levelCurve: 'physicalAnomaly',
    },
  }),
  '条件单段 / 普通继承段 / 倍率 130.0% / physical / 空 / CD 3s',
);
