import assert from 'node:assert/strict';
import {
  LOADOUT_SLOT_ORDER,
  type DefLoadoutBinding,
  type DefLoadoutEquipment,
  type DefLoadoutOperator,
  type DefLoadoutSetBuff,
  type DefTeamLoadoutsV1Capsule,
  compareFacts,
  evaluateFacts,
  validateLoadoutCapsule,
} from './loadout-fact-operations.ts';

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function expectOk<Value>(result: { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }): Value {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function expectError(
  result: { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string } },
  code: string,
): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
}

const binding: DefLoadoutBinding = {
  workspaceId: 'workspace-loadout-facts',
  databaseGeneration: 'generation-1',
  timelineId: 'timeline-1',
  checkoutTargetId: 'node-1',
  checkoutUpdatedAt: 100,
  contentRevision: 7,
  snapshotDigest: 'sha256:loadout-facts',
};

function equipment(
  slotKey: DefLoadoutEquipment['slotKey'],
  equipmentId: string,
  name = `${equipmentId} 名称`,
): DefLoadoutEquipment {
  return {
    slotKey,
    equipmentId,
    name,
    part: slotKey === 'armor' ? '护甲' : slotKey === 'glove' ? '护手' : '配件',
    effects: [{
      effectId: `${equipmentId}-effect`,
      label: `${equipmentId} 效果`,
      typeKey: 'attackPercent',
      level: 3,
      value: 0.1,
    }],
  };
}

const setBuffs: readonly DefLoadoutSetBuff[] = [
  {
    gearSetId: 'set-a',
    gearSetName: '测试套装',
    effectId: 'set-effect-a',
    label: '三件套效果',
    typeKey: 'damagePercent',
    value: 0.12,
    category: 'damage',
    effectKind: 'modifier',
  },
];

const baseOperator: DefLoadoutOperator = {
  character: {
    id: 'operator-a',
    name: '洛茜',
    element: 'physical',
    profession: '近卫',
    librarySource: '1.8',
  },
  weapon: {
    id: 'weapon-a',
    name: '测试单手剑',
    level: 90,
    potential: 'P5',
    skillLevels: { skill1: 9, skill2: 9, skill3: 3 },
    attack: 323,
  },
  // Deliberately not in slot order: the validator must normalize it.
  equipment: [
    equipment('accessory2', 'equipment-a2'),
    equipment('armor', 'equipment-armor'),
    equipment('glove', 'equipment-glove'),
    equipment('accessory1', 'equipment-a1'),
  ],
  setBuffs,
  operatorSkillLevels: { A: 'M3', B: 'L9', E: 'M3', Q: 'L9', Dot: 'L9' },
  configured: true,
};

const baseCapsule: DefTeamLoadoutsV1Capsule = {
  contract: 'DefTeamLoadoutsV1',
  binding,
  complete: true,
  missingCharacterIds: [],
  operators: [baseOperator],
};

function withOperator(change: (operator: DefLoadoutOperator) => DefLoadoutOperator): DefTeamLoadoutsV1Capsule {
  const next = clone(baseCapsule);
  return { ...next, operators: [change(clone(baseOperator))] };
}

function withOperators(operators: readonly DefLoadoutOperator[]): DefTeamLoadoutsV1Capsule {
  return { ...clone(baseCapsule), operators: clone(operators) };
}

const validated = expectOk(validateLoadoutCapsule(baseCapsule));
assert.deepEqual(validated.operators[0]?.equipment.map((piece) => piece.slotKey), LOADOUT_SLOT_ORDER);
assert.doesNotThrow(() => JSON.stringify(validated));

const completeFacts = expectOk(evaluateFacts(baseCapsule));
assert.deepEqual(completeFacts.operator, { id: 'operator-a', name: '洛茜' });
assert.deepEqual(completeFacts.completeness, { complete: true, configured: true });
assert.deepEqual(completeFacts.missingFields, []);
assert.deepEqual(completeFacts.duplicateSlots, []);
assert.deepEqual(completeFacts.missingSlots, []);
assert.deepEqual(completeFacts.compatibilityEvidence, { inputPresent: false });
assert.equal(completeFacts.subjectiveEvaluation, 'evidenceUnavailable');

const factsWithEvidence = expectOk(evaluateFacts(baseCapsule, {
  directoryCompatibilityEvidence: { source: 'browser-1.8', operatorId: 'operator-a' },
}));
assert.deepEqual(factsWithEvidence.compatibilityEvidence, { inputPresent: true });

const incompleteCapsule = withOperator((operator) => ({
  ...operator,
  weapon: null,
  equipment: operator.equipment.filter((piece) => piece.slotKey !== 'accessory2'),
  operatorSkillLevels: null,
}));
const incompleteFacts = expectOk(evaluateFacts(incompleteCapsule));
assert.deepEqual(incompleteFacts.completeness, { complete: false, configured: true });
assert.deepEqual(incompleteFacts.missingFields, ['weapon', 'operatorSkillLevels']);
assert.deepEqual(incompleteFacts.missingSlots, ['accessory2']);

const equipmentOnlyIncompleteFacts = expectOk(evaluateFacts(withOperator((operator) => ({
  ...operator,
  equipment: operator.equipment.filter((piece) => piece.slotKey !== 'accessory2'),
}))));
assert.deepEqual(equipmentOnlyIncompleteFacts.completeness, { complete: false, configured: true });
assert.deepEqual(equipmentOnlyIncompleteFacts.missingFields, []);
assert.deepEqual(equipmentOnlyIncompleteFacts.missingSlots, ['accessory2']);

const same = expectOk(compareFacts(baseCapsule, clone(baseCapsule)));
assert.equal(same.weapon.changed, false);
assert.equal(same.skillLevels.changed, false);
assert.equal(same.equipmentSlots.changed, false);
assert.equal(same.setEffects.changed, false);
assert.ok(same.equipmentSlots.slots.every((slot) => slot.fields.every((field) => !field.changed)));
assert.equal(JSON.stringify(same), JSON.stringify(expectOk(compareFacts(baseCapsule, clone(baseCapsule)))));

const weaponChanged = withOperator((operator) => ({
  ...operator,
  weapon: {
    ...operator.weapon!,
    id: 'weapon-b',
    name: '另一把单手剑',
    level: 80,
    potential: 'P3',
    attack: 280,
  },
}));
const weaponDiff = expectOk(compareFacts(baseCapsule, weaponChanged));
assert.equal(weaponDiff.weapon.changed, true);
assert.deepEqual(
  weaponDiff.weapon.fields.filter((field) => field.changed).map((field) => field.field),
  ['id', 'name', 'level', 'potential', 'attack'],
);

const equipmentSwapped = withOperator((operator) => {
  const accessory1 = operator.equipment.find((piece) => piece.slotKey === 'accessory1')!;
  const accessory2 = operator.equipment.find((piece) => piece.slotKey === 'accessory2')!;
  return {
    ...operator,
    equipment: operator.equipment.map((piece) => (
      piece.slotKey === 'accessory1'
        ? { ...accessory2, slotKey: 'accessory1' as const }
        : piece.slotKey === 'accessory2'
          ? { ...accessory1, slotKey: 'accessory2' as const }
          : piece
    )),
  };
});
const equipmentDiff = expectOk(compareFacts(baseCapsule, equipmentSwapped));
assert.equal(equipmentDiff.equipmentSlots.changed, true);
assert.equal(equipmentDiff.equipmentSlots.slots.find((slot) => slot.slotKey === 'accessory1')?.changed, true);
assert.equal(equipmentDiff.equipmentSlots.slots.find((slot) => slot.slotKey === 'accessory2')?.changed, true);
assert.equal(equipmentDiff.equipmentSlots.slots.find((slot) => slot.slotKey === 'armor')?.changed, false);

const skillLevelsChanged = withOperator((operator) => ({
  ...operator,
  weapon: { ...operator.weapon!, skillLevels: { skill1: 9, skill2: 8, skill3: 3 } },
  operatorSkillLevels: { ...operator.operatorSkillLevels!, B: 'M3' },
}));
const skillDiff = expectOk(compareFacts(baseCapsule, skillLevelsChanged));
assert.equal(skillDiff.skillLevels.changed, true);
assert.deepEqual(skillDiff.skillLevels.weapon.filter((field) => field.changed).map((field) => field.field), ['skill2']);
assert.deepEqual(skillDiff.skillLevels.operator.filter((field) => field.changed).map((field) => field.field), ['B']);

const setEffectChanged = withOperator((operator) => ({
  ...operator,
  setBuffs: [{ ...operator.setBuffs[0]!, value: 0.2 }],
}));
const setEffectDiff = expectOk(compareFacts(baseCapsule, setEffectChanged));
assert.equal(setEffectDiff.setEffects.changed, true);
assert.deepEqual(
  setEffectDiff.setEffects.effects[0]?.fields.filter((field) => field.changed).map((field) => field.field),
  ['value'],
);

const secondOperator: DefLoadoutOperator = {
  ...clone(baseOperator),
  character: { ...baseOperator.character, id: 'operator-b', name: '测试干员' },
};
const multiOperator = withOperators([baseOperator, secondOperator]);
expectError(evaluateFacts(multiOperator), 'OPERATOR_SELECTION_REQUIRED');
const selectedFacts = expectOk(evaluateFacts(multiOperator, { operatorId: 'operator-b' }));
assert.equal(selectedFacts.operator.id, 'operator-b');
assert.equal(expectOk(compareFacts(multiOperator, multiOperator, { operatorId: 'operator-b' })).operator.id, 'operator-b');

const differentOperator = withOperator((operator) => ({
  ...operator,
  character: { ...operator.character, id: 'operator-c', name: '不同干员' },
}));
expectError(compareFacts(baseCapsule, differentOperator), 'OPERATOR_MISMATCH');

const duplicateSlot = withOperator((operator) => ({
  ...operator,
  equipment: [operator.equipment[0]!, { ...operator.equipment[1]!, slotKey: operator.equipment[0]!.slotKey }],
}));
expectError(validateLoadoutCapsule(duplicateSlot), 'DUPLICATE_SLOT');

const tooManyEquipment = withOperator((operator) => ({
  ...operator,
  equipment: [...operator.equipment, equipment('armor', 'equipment-extra')],
}));
expectError(validateLoadoutCapsule(tooManyEquipment), 'BOUND_EXCEEDED');

const nanAttack = withOperator((operator) => ({
  ...operator,
  weapon: { ...operator.weapon!, attack: Number.NaN },
}));
expectError(validateLoadoutCapsule(nanAttack), 'INVALID_CAPSULE');

const overlongName = withOperator((operator) => ({
  ...operator,
  character: { ...operator.character, name: 'x'.repeat(257) },
}));
expectError(validateLoadoutCapsule(overlongName), 'BOUND_EXCEEDED');

const unknownField = { ...baseCapsule, unexpected: true };
expectError(validateLoadoutCapsule(unknownField), 'UNKNOWN_FIELD');

function assertNoSubjectiveKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSubjectiveKeys);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'winner');
      assert.notEqual(key, 'score');
      assert.notEqual(key, 'rank');
      assertNoSubjectiveKeys(child);
    }
  }
}

assertNoSubjectiveKeys(completeFacts);
assertNoSubjectiveKeys(same);
assert.equal(same.subjectiveEvaluation, 'evidenceUnavailable');

console.log('LOADOUT_FACT_OPERATIONS_OK');
