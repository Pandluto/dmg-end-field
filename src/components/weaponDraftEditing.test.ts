import assert from 'node:assert/strict';
import { LEVEL_KEYS, type WeaponSkillKey } from './weaponDraftCatalog';
import {
  createEmptyWeaponDraft,
  type WeaponDraft,
  type WeaponEffectData,
} from './weaponDraftModel';
import {
  createWeaponEffect,
  deleteWeaponEffect,
  duplicateWeaponEffect,
  resolveWeaponDraftForEdit,
} from './weaponDraftEditing';

function effect(name: string, levels: Record<string, number>): WeaponEffectData {
  return {
    schemaVersion: 2,
    effectId: name,
    name,
    type: 'physicalDmgBonus',
    category: 'passive',
    levels,
    valueMode: 'fixed',
    effectKind: 'modifier',
  };
}

function createFixture(): WeaponDraft {
  const draft = createEmptyWeaponDraft('library-weapon');
  draft.name = '基础武器';
  draft.skills.skill3.levels = Object.fromEntries(
    LEVEL_KEYS.map((levelKey) => [levelKey, { value: Number(levelKey), description: `说明 ${levelKey}` }]),
  );
  draft.skills.skill3.effects = {
    effect1: effect('独特来源', { 1: 11, 9: 99 }),
    effect3: effect('第三效果', { 1: 33, 9: 333 }),
  };
  return draft;
}

const baseDraft = createFixture();
const sourceSnapshot = structuredClone(baseDraft);
const currentDraft = structuredClone(baseDraft);
currentDraft.id = 'renamed-before-save';
currentDraft.name = '当前编辑副本';
const libraryDraft = structuredClone(baseDraft);
libraryDraft.name = '库中旧副本';
const library = {
  active: libraryDraft,
  fallback: { ...structuredClone(baseDraft), name: '非当前武器' },
};

const activeResolved = resolveWeaponDraftForEdit(
  { library, currentDraft, activeDraftKey: 'active' },
  'active',
);
assert.equal(activeResolved?.id, 'renamed-before-save');
assert.equal(activeResolved?.name, '当前编辑副本');
assert.notEqual(activeResolved, currentDraft);
activeResolved!.name = '只改副本';
assert.equal(currentDraft.name, '当前编辑副本');

const fallbackResolved = resolveWeaponDraftForEdit(
  { library, currentDraft, activeDraftKey: 'active' },
  'fallback',
);
assert.equal(fallbackResolved?.name, '非当前武器');
assert.notEqual(fallbackResolved, library.fallback);
assert.equal(
  resolveWeaponDraftForEdit({ library, currentDraft: null, activeDraftKey: 'fallback' }, 'fallback')?.name,
  '非当前武器',
);
assert.equal(resolveWeaponDraftForEdit({ library, currentDraft, activeDraftKey: 'active' }, 'missing'), null);
assert.equal(resolveWeaponDraftForEdit({ library: {}, currentDraft: null, activeDraftKey: 'active' }, 'missing'), null);

const typedSkillKey: WeaponSkillKey = 'skill3';
const createResult = createWeaponEffect(baseDraft, typedSkillKey);
assert.ok(createResult);
assert.equal(createResult.effectKey, 'effect2');
assert.equal(createResult.focusRowKey, 'effect-skill3-effect-effect2');
assert.deepEqual(createResult.nextDraft.skills.skill3.effects.effect2, {
  schemaVersion: 2,
  effectId: 'effect2',
  name: 'effect2',
  type: '',
  category: 'condition',
  levels: Object.fromEntries(LEVEL_KEYS.map((levelKey) => [levelKey, 0])),
  valueMode: 'fixed',
  effectKind: 'modifier',
});
assert.deepEqual(baseDraft, sourceSnapshot, 'create must not mutate the source draft');

const duplicateResult = duplicateWeaponEffect(baseDraft, typedSkillKey, 'effect', 'effect1');
assert.ok(duplicateResult);
assert.equal(duplicateResult.effectKey, 'effect2');
assert.equal(duplicateResult.focusRowKey, 'effect-skill3-effect-effect2');
assert.equal(duplicateResult.nextDraft.skills.skill3.effects.effect2.name, '独特来源');
assert.deepEqual(duplicateResult.nextDraft.skills.skill3.effects.effect2.levels, { 1: 11, 9: 99 });
assert.notEqual(
  duplicateResult.nextDraft.skills.skill3.effects.effect2.levels,
  duplicateResult.nextDraft.skills.skill3.effects.effect1.levels,
);
duplicateResult.nextDraft.skills.skill3.effects.effect2.levels['1'] = 999;
assert.equal(baseDraft.skills.skill3.effects.effect1.levels['1'], 11);
assert.equal(duplicateWeaponEffect(baseDraft, typedSkillKey, 'value', 'value'), null);
assert.equal(duplicateWeaponEffect(baseDraft, typedSkillKey, 'effect', 'missing'), null);
assert.deepEqual(baseDraft, sourceSnapshot, 'duplicate must not mutate the source draft');

const deleteEffectResult = deleteWeaponEffect(baseDraft, typedSkillKey, 'effect', 'effect1');
assert.ok(deleteEffectResult);
assert.equal(deleteEffectResult.focusRowKey, 'skill-skill3');
assert.equal(deleteEffectResult.nextDraft.skills.skill3.effects.effect1, undefined);
assert.ok(deleteEffectResult.nextDraft.skills.skill3.effects.effect3);
assert.equal(deleteWeaponEffect(baseDraft, typedSkillKey, 'effect', 'missing'), null);
assert.deepEqual(baseDraft, sourceSnapshot, 'effect delete must not mutate the source draft');

const deleteValueResult = deleteWeaponEffect(baseDraft, typedSkillKey, 'value', 'value');
assert.ok(deleteValueResult);
assert.equal(deleteValueResult.focusRowKey, 'skill-skill3');
LEVEL_KEYS.forEach((levelKey) => {
  assert.equal(deleteValueResult.nextDraft.skills.skill3.levels[levelKey].value, undefined);
  assert.equal(deleteValueResult.nextDraft.skills.skill3.levels[levelKey].description, `说明 ${levelKey}`);
});
assert.deepEqual(baseDraft, sourceSnapshot, 'value delete must not mutate the source draft');

const malformedSkills = { ...baseDraft.skills } as Partial<WeaponDraft['skills']>;
delete malformedSkills.skill3;
const malformedDraft = {
  ...baseDraft,
  skills: malformedSkills as WeaponDraft['skills'],
};
assert.equal(createWeaponEffect(malformedDraft, typedSkillKey), null);
assert.equal(duplicateWeaponEffect(malformedDraft, typedSkillKey, 'effect', 'effect1'), null);
assert.equal(deleteWeaponEffect(malformedDraft, typedSkillKey, 'effect', 'effect1'), null);
assert.equal(deleteWeaponEffect(malformedDraft, typedSkillKey, 'value', 'value'), null);
assert.deepEqual(baseDraft, sourceSnapshot, 'fixture remains unchanged after malformed calls');

console.log('Weapon draft editing transaction contract: PASS');
