import assert from 'node:assert/strict';
import {
  buildOrderedDraft,
  buildTypedSkillKey,
  cloneDraft,
  createDefaultBuffEffect,
  createDefaultDraft,
  createDefaultHit,
  createDefaultSkill,
  createEmptyDraft,
  getNextBuffEffectKey,
  getNextDraftId,
  getNextHitKey,
  getNextSkillKeyByType,
  getSkillFilterKey,
  isSkillButtonType,
  moveSkillKey,
  normalizeAttributeLevels,
  normalizeBuffs,
  normalizeDraft,
  parseImportedDraft,
  reorderDraftStructure,
  syncHitCount,
  syncSkillOrderWithDraft,
  validateDraftBuffEffects,
  validateRawDraftBuffMultipliers,
  type HitMetaDraft,
  type OperatorBuffEffect,
  type OperatorDraft,
  type SkillDraft,
} from './OperatorDraftPage';

function makeHit(overrides: Partial<HitMetaDraft> = {}): HitMetaDraft {
  return {
    ...createDefaultHit(),
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    ...createDefaultSkill(),
    ...overrides,
    hitMeta: overrides.hitMeta ?? createDefaultSkill().hitMeta,
  };
}

function makeDraft(overrides: Partial<OperatorDraft> = {}): OperatorDraft {
  const base = createDefaultDraft();
  return {
    ...base,
    ...overrides,
    attributes: overrides.attributes ?? base.attributes,
    skills: overrides.skills ?? base.skills,
    buffs: overrides.buffs ?? base.buffs,
  };
}

const defaultDraft = createDefaultDraft();
assert.equal(defaultDraft.id, 'custom-operator-001');
assert.equal(defaultDraft.name, '新干员');
assert.equal(defaultDraft.rarity, 6);
assert.equal(defaultDraft.level, 90);
assert.deepEqual(Object.keys(defaultDraft.skills), ['skill-A-1']);
assert.equal(defaultDraft.skills['skill-A-1'].displayName, '新技能1');
assert.equal(defaultDraft.skills['skill-A-1'].hitCount, 1);
assert.deepEqual(Object.keys(defaultDraft.buffs), ['talent', 'potential', 'skill']);
assert.deepEqual(defaultDraft.buffs.talent.effects, {});
assert.equal(defaultDraft.attributes.strength.level90, 0);

const emptyDraft = createEmptyDraft('custom-operator-009');
assert.equal(emptyDraft.id, 'custom-operator-009');
assert.equal(emptyDraft.name, '新建干员');
assert.deepEqual(emptyDraft.skills, {});
assert.notStrictEqual(emptyDraft.attributes, defaultDraft.attributes);
assert.notStrictEqual(emptyDraft.buffs, defaultDraft.buffs);

assert.equal(createDefaultHit('hit12').displayName, '第12击');
assert.equal(createDefaultSkill('Q', 'skill-Q-3').displayName, '新技能3');
assert.equal(createDefaultBuffEffect('effect7').effectId, 'effect7');

const normalizedAttributes = normalizeAttributeLevels({
  strength: 12,
  agility: { level1: 1, level40: 4, level90: 'bad' },
  hp: null,
  unknown: 999,
});
assert.deepEqual(normalizedAttributes.strength, {
  level1: 12,
  level20: 12,
  level40: 12,
  level60: 12,
  level80: 12,
  level90: 12,
});
assert.deepEqual(normalizedAttributes.agility, {
  level1: 1,
  level20: 0,
  level40: 4,
  level60: 0,
  level80: 0,
  level90: 0,
});
assert.deepEqual(normalizedAttributes.hp, {
  level1: 0,
  level20: 0,
  level40: 0,
  level60: 0,
  level80: 0,
  level90: 0,
});
assert.equal(Object.prototype.hasOwnProperty.call(normalizedAttributes, 'unknown'), false);

const draftToNormalize = makeDraft({
  attributes: {
    strength: { level1: 2 },
  } as never,
  skills: {
    'skill-B-7': makeSkill({
      displayName: ' ',
      buttonType: 'B',
      hitCount: 99,
      hitMeta: {
        oldHit: makeHit({
          displayName: '',
          multiplier: 1.25,
          levels: { L1: 2 } as never,
        }),
        namedHit: makeHit({
          displayName: '保留名称',
          levels: {} as never,
        }),
      },
    }),
  },
});
const normalizedDraft = normalizeDraft(draftToNormalize);
assert.strictEqual(normalizedDraft, draftToNormalize, '当前页面的 normalizeDraft 是原地规范化');
assert.equal(normalizedDraft.skills['skill-B-7'].displayName, '新技能7');
assert.equal(normalizedDraft.skills['skill-B-7'].hitCount, 2);
assert.equal(normalizedDraft.skills['skill-B-7'].hitMeta.oldHit.displayName, '第1击');
assert.equal(normalizedDraft.skills['skill-B-7'].hitMeta.oldHit.levels.L1, 2);
assert.equal(normalizedDraft.skills['skill-B-7'].hitMeta.oldHit.levels.L2, 1.25);
assert.equal('multiplier' in normalizedDraft.skills['skill-B-7'].hitMeta.oldHit, false);
assert.equal(normalizedDraft.skills['skill-B-7'].hitMeta.namedHit.levels.M3, 0);
assert.equal(normalizedDraft.attributes.strength.level1, 2);
assert.equal(normalizedDraft.attributes.strength.level90, 0);

assert.throws(() => parseImportedDraft('{'), SyntaxError);
assert.throws(() => parseImportedDraft('null'), /JSON 根节点必须是对象/);
assert.throws(() => parseImportedDraft('{}'), /JSON 缺少 id \/ name \/ skills/);
assert.throws(
  () => parseImportedDraft(JSON.stringify({ id: 'bad', name: '坏草稿', skills: null })),
  /JSON 缺少 id \/ name \/ skills/,
);
const arraySkillsDraft = parseImportedDraft(JSON.stringify({ id: 'array-skills', name: '数组技能', skills: [] }));
assert.deepEqual(arraySkillsDraft.skills, [], '当前实现把 skills 数组按 object 放行，保持这个已存在的宽松行为');

assert.equal(buildTypedSkillKey('Dot', 2), 'skill-Dot-2');
assert.equal(isSkillButtonType('A'), true);
assert.equal(isSkillButtonType('other'), false);
assert.equal(getSkillFilterKey(makeSkill({ buttonType: 'Q' })), 'Q');
assert.equal(getSkillFilterKey(makeSkill({ buttonType: 'legacy' as never })), 'other');

const idDraft = makeDraft({
  skills: {
    'skill-A-1': createDefaultSkill('A', 'skill-A-1'),
    'skill-A-3': createDefaultSkill('A', 'skill-A-3'),
  },
});
assert.equal(getNextSkillKeyByType(idDraft, 'A'), 'skill-A-2');
assert.equal(getNextSkillKeyByType(idDraft, 'B'), 'skill-B-1');
assert.equal(getNextDraftId(['custom-operator-001', 'custom-operator-003']), 'custom-operator-002');
const sparseSkill = makeSkill({
  hitMeta: {
    hit1: makeHit(),
    hit3: makeHit(),
  },
});
assert.equal(getNextHitKey(sparseSkill), 'hit2');
assert.equal(
  getNextBuffEffectKey({
    effect1: createDefaultBuffEffect('effect1'),
    effect3: createDefaultBuffEffect('effect3'),
  }),
  'effect2',
);

const orderDraft = makeDraft({
  skills: {
    'old-b': makeSkill({ buttonType: 'B' }),
    'old-a': makeSkill({ buttonType: 'A' }),
  },
});
const orderDraftBefore = cloneDraft(orderDraft);
assert.deepEqual(syncSkillOrderWithDraft(['gone', 'old-a'], orderDraft), ['old-a', 'old-b']);
const sourceOrder = ['old-b', 'old-a'];
const movedOrder = moveSkillKey(sourceOrder, 'old-b', 'old-a');
assert.deepEqual(movedOrder, ['old-a', 'old-b']);
assert.deepEqual(sourceOrder, ['old-b', 'old-a']);
assert.strictEqual(moveSkillKey(sourceOrder, 'old-a', 'old-a'), sourceOrder);
assert.strictEqual(moveSkillKey(sourceOrder, 'gone', 'old-a'), sourceOrder);
const builtOrderedDraft = buildOrderedDraft(orderDraft, ['old-a']);
assert.deepEqual(Object.keys(builtOrderedDraft.skills), ['old-a', 'old-b']);
assert.notStrictEqual(builtOrderedDraft, orderDraft);
assert.notStrictEqual(builtOrderedDraft.skills, orderDraft.skills);
assert.strictEqual(
  builtOrderedDraft.skills['old-a'],
  orderDraft.skills['old-a'],
  '当前 buildOrderedDraft 只重建 skills 容器，保留 skill 对象引用',
);
assert.deepEqual(orderDraft, orderDraftBefore, '排序构建不能改动源 draft');

const reorderInput = makeDraft({
  skills: {
    'legacy-a': makeSkill({
      displayName: '旧 A',
      buttonType: 'A',
      hitMeta: {
        legacyFirst: makeHit({ displayName: ' ' }),
        legacySecond: makeHit({ displayName: '第二击' }),
      },
    }),
    'legacy-b': makeSkill({ buttonType: 'B' }),
    'legacy-other': makeSkill({ buttonType: 'legacy' as never }),
  },
});
const reorderInputBefore = cloneDraft(reorderInput);
const reordered = reorderDraftStructure(reorderInput);
assert.deepEqual(reordered.skillKeyMap, {
  'legacy-a': 'skill-A-1',
  'legacy-b': 'skill-B-1',
  'legacy-other': 'skill-other-3',
});
assert.deepEqual(Object.keys(reordered.draft.skills), ['skill-A-1', 'skill-B-1', 'skill-other-3']);
assert.deepEqual(Object.keys(reordered.draft.skills['skill-A-1'].hitMeta), ['hit1', 'hit2']);
assert.equal(reordered.draft.skills['skill-A-1'].hitMeta.hit1.displayName, '第1击');
assert.equal(reordered.draft.skills['skill-A-1'].hitMeta.hit2.displayName, '第二击');
assert.equal(reordered.draft.skills['skill-A-1'].hitCount, 2);
assert.notStrictEqual(reordered.draft.skills['skill-A-1'], reorderInput.skills['legacy-a']);
assert.deepEqual(reorderInput, reorderInputBefore, '重排必须深拷贝并保持源 draft 不变');
const selectedNewSkillKey = reordered.skillKeyMap['legacy-a'];
assert.equal(selectedNewSkillKey, 'skill-A-1');
assert.equal(
  reordered.draft.skills[selectedNewSkillKey].hitMeta.hit2.displayName,
  '第二击',
  'selection map 保留仍存在的 hit key',
);
const missingSelectedHitKey = 'legacyFirst';
const fallbackSelectedHitKey = reordered.draft.skills[selectedNewSkillKey].hitMeta[missingSelectedHitKey]
  ? missingSelectedHitKey
  : Object.keys(reordered.draft.skills[selectedNewSkillKey].hitMeta)[0] ?? null;
assert.equal(fallbackSelectedHitKey, 'hit1', '旧 hit key 不存在时 selection 应回退到第一个 hit');

const hitCountSkill = createDefaultSkill();
hitCountSkill.hitMeta.hit2 = createDefaultHit('hit2');
hitCountSkill.hitCount = 0;
syncHitCount(hitCountSkill);
assert.equal(hitCountSkill.hitCount, 2);

const rawBuffs = {
  talent: {
    effects: {
      multiplier: {
        schemaVersion: 2,
        effectId: 'multiplier',
        name: '乘区效果',
        type: 'physicalDmgBonus',
        category: 'passive',
        value: 0.2,
        unit: 'percent',
        multiplier: { coefficient: 1.5 },
      },
      extraHit: {
        effectId: 'extra-hit',
        name: '额外伤害段',
        type: 'ignored-by-extra-hit',
        category: 'countable',
        maxStacks: 2.8,
        value: 7,
        effectKind: 'extraHit',
        extraHitConfig: {
          key: 'dianjian',
          damageType: 'fire',
          skillType: 'E',
          baseMultiplier: 1.5,
          imbalanceValue: 12,
          cooldownSeconds: 7,
          trigger: 'physicalAbnormal',
        },
      },
      derived: {
        schemaVersion: 2,
        effectId: 'derived',
        name: '派生效果',
        type: 'sourceSkillBoost',
        category: 'passive',
        valueMode: 'derived',
        derivedValue: { source: 'atk', perPointValue: 2 },
      },
      malformed: null,
    },
  },
  potential: { effects: 'malformed-group' },
};
const rawBuffsBefore = cloneDraft(rawBuffs);
const normalizedBuffs = normalizeBuffs(rawBuffs);
assert.deepEqual(rawBuffs, rawBuffsBefore, 'Buff normalize 不能改动源对象');
assert.deepEqual(normalizedBuffs.potential.effects, {});
const normalizedMultiplier = normalizedBuffs.talent.effects.multiplier;
assert.equal(normalizedMultiplier.schemaVersion, 2);
assert.equal(normalizedMultiplier.category, 'condition');
assert.deepEqual(normalizedMultiplier.multiplier, { coefficient: 1.5 });
assert.equal(normalizedMultiplier.value, 0.2);
const normalizedExtraHit = normalizedBuffs.talent.effects.extraHit;
assert.equal(normalizedExtraHit.schemaVersion, 2);
assert.equal(normalizedExtraHit.type, '');
assert.equal(normalizedExtraHit.category, 'countable');
assert.equal(normalizedExtraHit.valueMode, 'fixed');
assert.equal(normalizedExtraHit.value, 7, '当前 normalizeBuffEffect 会保留 extraHit 输入中的 raw value');
assert.equal(normalizedExtraHit.maxStacks, 2);
assert.deepEqual(normalizedExtraHit.extraHitConfig, {
  key: 'dianjian',
  damageType: 'fire',
  skillType: 'E',
  baseMultiplier: 1.5,
  imbalanceValue: 12,
  cooldownSeconds: 7,
  trigger: 'physicalAbnormal',
});
assert.deepEqual(normalizedBuffs.talent.effects.derived.derivedValue, { source: 'atk', perPointValue: 2 });
assert.equal(normalizedBuffs.talent.effects.malformed.schemaVersion, 2);
assert.deepEqual(validateDraftBuffEffects(makeDraft({ buffs: normalizedBuffs })), []);

assert.doesNotThrow(() => validateRawDraftBuffMultipliers({
  buffs: {
    talent: {
      effects: {
        valid: {
          type: 'physicalDmgBonus',
          category: 'condition',
          multiplier: { coefficient: 1.5 },
        },
      },
    },
  },
} as never));
assert.throws(
  () => parseImportedDraft(JSON.stringify({
    id: 'bad-multiplier',
    name: '坏乘区',
    skills: {},
    buffs: {
      talent: {
        effects: {
          invalid: {
            type: 'physicalDmgBonus',
            category: 'passive',
            multiplier: { coefficient: 1.5 },
          },
        },
      },
    },
  })),
  /talent\.invalid: multiplier 必须使用 category=condition/,
);
const invalidNormalizedBuffs = normalizeBuffs(undefined);
invalidNormalizedBuffs.talent.effects.invalid = {
  ...createDefaultBuffEffect('invalid'),
  type: 'physicalDmgBonus',
  category: 'passive',
  multiplier: { coefficient: 1.5 },
} as OperatorBuffEffect;
assert.deepEqual(validateDraftBuffEffects(makeDraft({ buffs: invalidNormalizedBuffs })), [
  'talent.invalid: multiplier 必须使用 category=condition',
]);

console.log('Operator draft page characterization contract: PASS');
