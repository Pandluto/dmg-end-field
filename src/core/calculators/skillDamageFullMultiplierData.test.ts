import { normalizeLocalDataArchive } from '../../platform/data/localDataPackages';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import { resolveBuffInstanceValue } from './buffZoneCalculator';
import { calculateSkillButtonDamageV2 } from './skillButtonDamageCalculatorV2';
import {
  FULL_ZONE_BUFFS,
  SYNTHETIC_ALL_BUFF_LIST,
  SYNTHETIC_ANOMALY_BUFFS,
  SYNTHETIC_ANOMALY_BUTTON_IDS,
  SYNTHETIC_ANOMALY_DAMAGE_CARDS,
  SYNTHETIC_ANOMALY_EXTRA_HIT_BUFF,
  SYNTHETIC_ANOMALY_MODIFIER_BUFFS,
  SYNTHETIC_ANOMALY_STATE_SNAPSHOTS,
  SYNTHETIC_ANOMALY_STATUS_CARDS,
  SYNTHETIC_ANOMALY_TARGET_RESISTANCE,
  SYNTHETIC_ANOMALY_TEMPLATE,
  SYNTHETIC_BURN_DOT_CARD,
  SYNTHETIC_BURN_SPLIT_CARD,
  SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS,
  SYNTHETIC_BUFF_TYPE_MATRIX_BUTTON_ID,
  SYNTHETIC_BUFF_TYPE_MATRIX_STACK_COUNTS,
  SYNTHETIC_BUFF_TYPE_MATRIX_TARGET_RESISTANCE,
  SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE,
  SYNTHETIC_BUFF_TYPE_MATRIX_TYPES,
  SYNTHETIC_CHARACTER_INPUT,
  SYNTHETIC_CONFIG_SNAPSHOT,
  SYNTHETIC_DAMAGE_GOLDEN,
  SYNTHETIC_FULL_MULTIPLIER_INPUT,
  SYNTHETIC_FULL_MULTIPLIER_TEMPLATE,
  SYNTHETIC_LOCAL_DATA_ARCHIVE,
  SYNTHETIC_SKILL_TEMPLATES,
  SYNTHETIC_TARGET_CASES,
  SYNTHETIC_TARGET_BUFFS,
  SYNTHETIC_TARGET_SKILL_EXPECTATIONS,
  SYNTHETIC_TIMELINE_PAYLOAD,
} from './skillDamageFullMultiplierData.fixture';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertClose(actual: number, expected: number, message: string, tolerance = 1e-9): void {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function assertArrayEqual(actual: string[], expected: string[], message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(values: string[], value: string, message: string): void {
  if (!values.includes(value)) throw new Error(`${message}: missing ${value}`);
}

function assertExcludes(values: string[], value: string, message: string): void {
  if (values.includes(value)) throw new Error(`${message}: unexpected ${value}`);
}

function assertZone(
  actual: { additiveTotal: number; multiplierProduct: number; finalValue: number } | undefined,
  expected: { additiveTotal: number; multiplierProduct: number; finalValue: number },
  label: string,
): void {
  if (!actual) throw new Error(`${label}: calculator did not return this zone`);
  assertClose(actual.additiveTotal, expected.additiveTotal, `${label}.additiveTotal`);
  assertClose(actual.multiplierProduct, expected.multiplierProduct, `${label}.multiplierProduct`);
  assertClose(actual.finalValue, expected.finalValue, `${label}.finalValue`);
}

function assertBreakdown(
  actual: {
    base: number;
    afterCrit: number;
    afterBonus: number;
    afterDefense: number;
    afterResistance: number;
    afterAmplify: number;
    afterFragile: number;
    afterVulnerability: number;
    final: number;
  },
  expected: {
    base: number;
    afterCrit: number;
    afterBonus: number;
    afterDefense: number;
    afterResistance: number;
    afterAmplify: number;
    afterFragile: number;
    afterVulnerability: number;
    final: number;
  },
  label: string,
): void {
  (['base', 'afterCrit', 'afterBonus', 'afterDefense', 'afterResistance', 'afterAmplify', 'afterFragile', 'afterVulnerability', 'final'] as const)
    .forEach((key) => assertClose(actual[key], expected[key], `${label}.${key}`));
}

function assertContribution(
  contributions: Array<{
    buffId: string;
    rawValue: number;
    runtimeCoefficient: number;
    effectiveValue: number;
    multiplierCoefficient?: number;
  }> | undefined,
  expected: {
    id: string;
    rawValue: number;
    runtimeCoefficient: number;
    effectiveValue: number;
    multiplierCoefficient?: number;
  },
  label: string,
): void {
  const contribution = contributions?.find((item) => item.buffId === expected.id);
  if (!contribution) throw new Error(`${label}: missing contribution ${expected.id}`);
  assertClose(contribution.rawValue, expected.rawValue, `${label}.rawValue`);
  assertClose(contribution.runtimeCoefficient, expected.runtimeCoefficient, `${label}.runtimeCoefficient`);
  assertClose(contribution.effectiveValue, expected.effectiveValue, `${label}.effectiveValue`);
  if (expected.multiplierCoefficient === undefined) {
    assertEqual(contribution.multiplierCoefficient, undefined, `${label}.multiplierCoefficient`);
  } else {
    assertClose(contribution.multiplierCoefficient ?? 0, expected.multiplierCoefficient, `${label}.multiplierCoefficient`);
  }
}

const snapshot = SYNTHETIC_CONFIG_SNAPSHOT;
assertEqual(snapshot.operator.id, 'synthetic-full-multiplier-operator', 'snapshot should come from the synthetic operator');
assertEqual(snapshot.weapon.id, 'synthetic-full-multiplier-weapon', 'snapshot should come from the synthetic weapon');
assertEqual(snapshot.equipment.pieces.length, 4, 'snapshot should contain four synthetic equipment pieces');
assertEqual(snapshot.equipment.setBuffs.length, 4, 'snapshot should contain the three-piece set effects');
assertClose(snapshot.equipment.totals.atkPercentBoost, 0.12, 'three-piece set attack total');
assertClose(snapshot.equipment.totals.allDmgBonus, 0.06, 'three-piece set passive all-damage total');
assertClose(snapshot.panel.calc.damageBonus.physicalDmgBonus, 0.09, 'equipment physical damage total');
assertClose(snapshot.panel.calc.damageBonus.fireDmgBonus, 0.07, 'weapon fire damage total');
assertClose(snapshot.panel.calc.damageBonus.magicDmgBonus, 0.09, 'weapon magic damage total');
assertClose(snapshot.panel.calc.damageBonus.skillDmgBonus, 0.13, 'weapon skill damage total');
assertClose(snapshot.panel.calc.damageBonus.chainSkillDmgBonus, 0.11, 'equipment chain damage total');
assertClose(snapshot.panel.calc.damageBonus.allSkillDmgBonus, 0.05, 'equipment all-skill damage total');
assertClose(snapshot.panel.calc.damageBonus.imbalanceDmgBonus, 0.12, 'equipment imbalance damage total');
assertClose(snapshot.panel.calc.damageBonus.allDmgBonus, 0.06, 'set all-damage total in panel');

const weaponCondition = snapshot.weapon.skills.skill3.effects.find((effect) => effect.effectKey === 'condition');
if (!weaponCondition) throw new Error('snapshot should preserve the weapon skill3 condition candidate');
assertEqual(weaponCondition.category, 'condition', 'weapon skill3 condition category');
assertClose(weaponCondition.value, 0.05, 'weapon skill3 condition value');
const weaponMultiplier = snapshot.weapon.skills.skill3.effects.find((effect) => effect.effectKey === 'multiplier');
if (!weaponMultiplier) throw new Error('snapshot should preserve the weapon skill3 multiplier candidate');
assertEqual(weaponMultiplier.category, 'condition', 'weapon skill3 multiplier category');
assertClose(weaponMultiplier.multiplier?.coefficient ?? 0, 1.08, 'weapon skill3 multiplier coefficient');
const setCondition = snapshot.equipment.setBuffs.find((buff) => buff.effectId === 'set-nature-condition');
if (!setCondition) throw new Error('snapshot should preserve the three-piece condition candidate');
assertEqual(setCondition.category, 'condition', 'three-piece condition category');
assertClose(setCondition.value, 0.08, 'three-piece condition value');

const derivedOperatorBuff = snapshot.operator.buffs.skill.effects['skill-derived-attack'];
if (!derivedOperatorBuff) throw new Error('snapshot should preserve the derived operator buff');
assertEqual(derivedOperatorBuff.valueMode, 'derived', 'snapshot derived buff valueMode');
assertEqual(derivedOperatorBuff.derivedValue?.source, 'agility', 'snapshot derived buff source');
assertClose(derivedOperatorBuff.derivedValue?.perPointValue ?? 0, 0.0005, 'snapshot derived buff coefficient');
assertClose(
  derivedOperatorBuff.value ?? 0,
  snapshot.panel.display.abilityValues.agility * 0.0005,
  'buildConfigSnapshot should attach source value × perPointValue to the derived buff',
);

const archive = normalizeLocalDataArchive(SYNTHETIC_LOCAL_DATA_ARCHIVE);
assertEqual(archive.id, 'synthetic-full-multiplier-local-data', 'archive id');
assertEqual(archive.timelineArchives?.length, 1, 'archive should export one reusable timeline archive');
const operatorLibrary = archive.storage.local['def.operator-editor.library.v1'] as Record<string, {
  attributes?: Record<string, Record<string, number>>;
  skills?: Record<string, { hitCount?: number }>;
}>;
const operatorDraft = operatorLibrary[snapshot.operator.id];
if (!operatorDraft) throw new Error('archive should export the synthetic operator draft');
const archiveAttributeKeys = ['atk', 'hp', 'strength', 'agility', 'intelligence', 'will'];
const archiveLevelKeys = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'];
archiveAttributeKeys.forEach((attribute) => {
  const levels = operatorDraft.attributes?.[attribute];
  if (!levels) throw new Error(`archive operator is missing ${attribute} attribute levels`);
  archiveLevelKeys.forEach((level) => assertEqual(levels[level], snapshot.operator.baseAttributes[attribute as keyof typeof snapshot.operator.baseAttributes], `archive ${attribute}.${level}`));
});
const trustedFullSkill = operatorDraft.skills?.['skill-B-2'];
if (!trustedFullSkill) throw new Error('archive operator trusted skill directory is missing skill-B-2');
assertEqual(trustedFullSkill.hitCount, 2, 'trusted skill-B-2 should retain both comprehensive hits');
const trustedAnomalySkill = operatorDraft.skills?.[SYNTHETIC_ANOMALY_TEMPLATE.runtimeSkillId];
if (!trustedAnomalySkill) throw new Error('archive operator trusted skill directory is missing the anomaly carrier');
assertEqual(trustedAnomalySkill.hitCount, 1, 'anomaly carrier should retain its disabled placeholder hit');
const trustedTypeMatrixSkill = operatorDraft.skills?.[SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.runtimeSkillId];
if (!trustedTypeMatrixSkill) throw new Error('archive operator trusted skill directory is missing the Buff type matrix');
assertEqual(trustedTypeMatrixSkill.hitCount, 5, 'Buff type matrix should retain all five elemental hits');
assertEqual(
  Object.keys(operatorLibrary).length,
  1,
  'archive should export the synthetic operator library',
);
assertEqual(
  Object.keys(archive.storage.local['def.weapon-sheet.library.v1'] as Record<string, unknown>).length,
  1,
  'archive should export the synthetic weapon library',
);
assertEqual(
  Object.keys((archive.storage.local['def.equipment-sheet.library.v1'] as { gearSets: Record<string, unknown> }).gearSets).length,
  1,
  'archive should export the synthetic equipment set',
);
const buffLibrary = archive.storage.local['def.buff-editor.library.v1'] as Record<string, {
  items?: Record<string, { effects?: Record<string, unknown> }>;
}>;
const buffDraft = buffLibrary['synthetic-full-multiplier-buffs'];
if (!buffDraft?.items) throw new Error('archive should export the Buff library');
assertEqual(Object.keys(buffDraft.items).length, 4, 'Buff archive should keep all four test groups');
const targetBuffArchiveEffects = buffDraft.items['synthetic-target-item']?.effects;
if (!targetBuffArchiveEffects) throw new Error('Buff archive is missing target Buff group');
SYNTHETIC_TARGET_BUFFS.forEach((buff) => {
  if (!targetBuffArchiveEffects[buff.id]) throw new Error(`Buff archive is missing target Buff ${buff.id}`);
});
const anomalyBuffArchiveEffects = buffDraft.items['synthetic-anomaly-item']?.effects;
if (!anomalyBuffArchiveEffects) throw new Error('Buff archive is missing anomaly Buff group');
SYNTHETIC_ANOMALY_BUFFS.forEach((buff) => {
  if (!anomalyBuffArchiveEffects[buff.id]) throw new Error(`Buff archive is missing anomaly Buff ${buff.id}`);
});
const typeMatrixArchiveEffects = buffDraft.items['synthetic-buff-type-matrix-item']?.effects;
if (!typeMatrixArchiveEffects) throw new Error('Buff archive is missing the 75-type matrix group');
assertEqual(Object.keys(typeMatrixArchiveEffects).length, SYNTHETIC_BUFF_TYPE_MATRIX_TYPES.length, 'Buff archive should retain every public type exactly once');
SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.forEach((buff) => {
  if (!typeMatrixArchiveEffects[buff.id]) throw new Error(`Buff archive is missing type matrix Buff ${buff.id}`);
});

const timelineValidation = validateTimelinePayload(SYNTHETIC_TIMELINE_PAYLOAD);
assertEqual(timelineValidation.ok, true, 'exported timeline payload should validate');
assertEqual(SYNTHETIC_TIMELINE_PAYLOAD.selectedCharacters.length, 1, 'timeline payload should select the synthetic operator');
assertEqual(Object.keys(SYNTHETIC_TIMELINE_PAYLOAD.skillButtonTable).length, 10, 'timeline payload should include ordinary, anomaly, and Buff type matrix buttons');
assertEqual(SYNTHETIC_TIMELINE_PAYLOAD.anomalyStateSnapshots.length, 3, 'timeline payload should persist all anomaly state snapshots');
assertEqual(SYNTHETIC_TIMELINE_PAYLOAD.characterInputMap[snapshot.operator.id], SYNTHETIC_CHARACTER_INPUT, 'timeline should export explicit character input');
assertEqual(SYNTHETIC_TIMELINE_PAYLOAD.characterInputMap[snapshot.operator.id].skillLevels.A, 'M3', 'timeline character input A level');
assertEqual(SYNTHETIC_TIMELINE_PAYLOAD.characterInputMap[snapshot.operator.id].weapon.name, snapshot.weapon.name, 'timeline character input weapon');

const timelineButtons = Object.values(SYNTHETIC_TIMELINE_PAYLOAD.skillButtonTable);
const timelineButtonById = (buttonId: string) => {
  const button = SYNTHETIC_TIMELINE_PAYLOAD.skillButtonTable[buttonId];
  if (!button) throw new Error(`timeline is missing button ${buttonId}`);
  return button;
};
(['A', 'B', 'E', 'Q', 'Dot'] as const).forEach((skillType) => {
  const expectation = SYNTHETIC_TARGET_SKILL_EXPECTATIONS[skillType];
  const button = timelineButtonById(expectation.buttonId);
  assertEqual(button.runtimeSkillId, SYNTHETIC_SKILL_TEMPLATES[skillType].runtimeSkillId, `${skillType} timeline/template runtimeSkillId`);
  assertEqual(button.selectedBuff.length, 3, `${skillType} timeline should select exactly three target Buffs`);
  assertArrayEqual(button.selectedBuff, expectation.selectedBuffIds, `${skillType} timeline selected Buff ids`);
  const timelineEntry = timelineButtons.find((candidate) => candidate.id === expectation.buttonId);
  if (!timelineEntry) throw new Error(`${skillType} timeline staff entry is missing`);
  assertArrayEqual(timelineEntry.selectedBuff, expectation.selectedBuffIds, `${skillType} staff selected Buff ids`);
  const targetInput = SYNTHETIC_TARGET_CASES.find((input) => input.runtimeSkillId === button.runtimeSkillId);
  if (!targetInput) throw new Error(`${skillType} target calculator input is missing`);
  assertEqual(
    JSON.stringify(button.resistanceConfig?.targetResistance),
    JSON.stringify(targetInput.targetResistance),
    `${skillType} persisted target resistance`,
  );
});
const fullButton = timelineButtonById(`synthetic-button-${SYNTHETIC_FULL_MULTIPLIER_TEMPLATE.runtimeSkillId}`);
assertEqual(fullButton.runtimeSkillId, SYNTHETIC_FULL_MULTIPLIER_TEMPLATE.runtimeSkillId, 'full timeline/template runtimeSkillId');
assertArrayEqual(fullButton.selectedBuff, FULL_ZONE_BUFFS.map((buff) => buff.id), 'full timeline selected Buff ids');
assertEqual(fullButton.customHits?.length, 2, 'full timeline button should retain both hits');
assertEqual(
  JSON.stringify(fullButton.resistanceConfig?.targetResistance),
  JSON.stringify(SYNTHETIC_FULL_MULTIPLIER_INPUT.targetResistance),
  'full persisted target resistance',
);

const anomalyMatrixButton = timelineButtonById(SYNTHETIC_ANOMALY_BUTTON_IDS.matrix);
assertEqual(anomalyMatrixButton.runtimeSkillId, SYNTHETIC_ANOMALY_TEMPLATE.runtimeSkillId, 'anomaly matrix trusted skill id');
assertArrayEqual(anomalyMatrixButton.selectedBuff, SYNTHETIC_ANOMALY_BUFFS.map((buff) => buff.id), 'anomaly matrix selected Buff ids');
assertEqual(anomalyMatrixButton.buffStackCounts?.[SYNTHETIC_ANOMALY_EXTRA_HIT_BUFF.id], 2, 'anomaly matrix extra Hit stack count');
assertEqual(anomalyMatrixButton.anomalyConfig?.selectedDamages.length, SYNTHETIC_ANOMALY_DAMAGE_CARDS.length, 'anomaly matrix damage card count');
assertEqual(anomalyMatrixButton.anomalyConfig?.selectedStatuses.length, SYNTHETIC_ANOMALY_STATUS_CARDS.length, 'anomaly matrix status card count');
assertArrayEqual(
  anomalyMatrixButton.anomalyConfig?.selectedStateSnapshotIds.map(String) ?? [],
  SYNTHETIC_ANOMALY_STATE_SNAPSHOTS.map((snapshot) => String(snapshot.id)),
  'anomaly matrix state snapshot ids',
);
assertEqual(
  JSON.stringify(anomalyMatrixButton.resistanceConfig?.targetResistance),
  JSON.stringify(SYNTHETIC_ANOMALY_TARGET_RESISTANCE),
  'anomaly matrix five-element target resistance',
);
assertArrayEqual(anomalyMatrixButton.panelConfig?.manualDisabledHitKeys ?? [], ['anomaly-carrier-hit'], 'anomaly carrier normal hit should be disabled');

const burnDotButton = timelineButtonById(SYNTHETIC_ANOMALY_BUTTON_IDS.burnDot);
assertArrayEqual(burnDotButton.selectedBuff, SYNTHETIC_ANOMALY_MODIFIER_BUFFS.map((buff) => buff.id), 'burn dot selected Buff ids');
assertEqual(burnDotButton.anomalyConfig?.selectedDamages[0]?.id, SYNTHETIC_BURN_DOT_CARD.id, 'burn dot card identity');
assertEqual(burnDotButton.anomalyConfig?.selectedDamages[0]?.burnDamageMode, 'dotOnly', 'burn dot mode');
assertEqual(burnDotButton.anomalyConfig?.selectedDamages[0]?.durationSeconds, 4, 'burn dot duration');

const burnSplitButton = timelineButtonById(SYNTHETIC_ANOMALY_BUTTON_IDS.burnSplit);
assertArrayEqual(burnSplitButton.selectedBuff, SYNTHETIC_ANOMALY_MODIFIER_BUFFS.map((buff) => buff.id), 'burn split selected Buff ids');
assertEqual(burnSplitButton.anomalyConfig?.selectedDamages[0]?.id, SYNTHETIC_BURN_SPLIT_CARD.id, 'burn split card identity');
assertEqual(burnSplitButton.anomalyConfig?.selectedDamages[0]?.burnDamageMode, 'splitDot', 'burn split mode');
assertEqual(burnSplitButton.anomalyConfig?.selectedDamages[0]?.durationSeconds, 3, 'burn split duration');

const typeMatrixButton = timelineButtonById(SYNTHETIC_BUFF_TYPE_MATRIX_BUTTON_ID);
assertEqual(typeMatrixButton.runtimeSkillId, SYNTHETIC_BUFF_TYPE_MATRIX_TEMPLATE.runtimeSkillId, 'Buff type matrix trusted skill id');
assertArrayEqual(typeMatrixButton.selectedBuff, SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.map((buff) => buff.id), 'Buff type matrix selected ids');
assertEqual(typeMatrixButton.customHits?.length, 5, 'Buff type matrix should persist all elemental hits');
assertEqual(
  JSON.stringify(typeMatrixButton.buffStackCounts),
  JSON.stringify(SYNTHETIC_BUFF_TYPE_MATRIX_STACK_COUNTS),
  'Buff type matrix stack counts',
);
assertEqual(
  JSON.stringify(typeMatrixButton.resistanceConfig?.targetResistance),
  JSON.stringify(SYNTHETIC_BUFF_TYPE_MATRIX_TARGET_RESISTANCE),
  'Buff type matrix target resistance',
);

assertEqual(new Set(SYNTHETIC_ALL_BUFF_LIST.map((buff) => buff.id)).size, SYNTHETIC_ALL_BUFF_LIST.length, 'allBuffList ids should be unique');
assertEqual(SYNTHETIC_ALL_BUFF_LIST.length, FULL_ZONE_BUFFS.length + SYNTHETIC_TARGET_BUFFS.length + SYNTHETIC_ANOMALY_BUFFS.length + SYNTHETIC_BUFF_TYPE_MATRIX_BUFFS.length, 'allBuffList should contain all four Buff groups');
SYNTHETIC_ALL_BUFF_LIST.forEach((buff) => {
  const expectedRefCount = timelineButtons.filter((button) => button.selectedBuff.includes(buff.id)).length;
  assertEqual(buff.refCount, expectedRefCount, `${buff.id} refCount`);
  if (expectedRefCount < 1) throw new Error(`${buff.id} should be referenced by at least one timeline button`);
});

SYNTHETIC_TARGET_CASES.forEach((input) => {
  const result = calculateSkillButtonDamageV2(input);
  const skillType = input.template.buttonType as 'A' | 'B' | 'E' | 'Q' | 'Dot';
  const expectation = SYNTHETIC_TARGET_SKILL_EXPECTATIONS[skillType];
  const golden = SYNTHETIC_DAMAGE_GOLDEN.targetCaseFinals[skillType];
  assertEqual(result.hits.length, golden.expected.length, `${skillType} golden hit count`);
  result.hits.forEach((hit, index) => {
    assertClose(hit.expected.final, golden.expected[index], `${skillType}[${index}].expected.final`);
    assertClose(hit.crit.final, golden.crit[index], `${skillType}[${index}].crit.final`);
    assertClose(hit.nonCrit.final, golden.nonCrit[index], `${skillType}[${index}].nonCrit.final`);
    const appliedIds = hit.appliedBuffs.map((buff) => buff.id);
    expectation.unmatchedBuffIds.forEach((buffId) => assertExcludes(appliedIds, buffId, `${skillType}[${index}] explicit no-match`));
  });
  expectation.matchedBuffIds.forEach((buffId) => {
    if (!result.hits.some((hit) => hit.appliedBuffs.some((buff) => buff.id === buffId))) {
      throw new Error(`${skillType} matched Buff ${buffId} was never applied to a hit`);
    }
  });
  if (skillType === 'B') {
    assertContribution(result.hits[0].buffContributions, {
      id: 'target-weapon-electric-condition', rawValue: 0.05, runtimeCoefficient: 1, effectiveValue: 0.05,
    }, 'B weapon condition');
  }
  if (skillType === 'E') {
    assertContribution(result.hits[0].buffContributions, {
      id: 'target-set-nature-condition', rawValue: 0.08, runtimeCoefficient: 1, effectiveValue: 0.08,
    }, 'E three-piece condition');
  }
});

const fullResult = calculateSkillButtonDamageV2(SYNTHETIC_FULL_MULTIPLIER_INPUT);
const fullGolden = SYNTHETIC_DAMAGE_GOLDEN.full;
assertEqual(fullResult.hits.length, 2, 'full multiplier skill should keep both hit branches');
fullResult.hits.forEach((hit, index) => {
  const zones = fullGolden.zones[index];
  const breakdown = fullGolden.breakdowns[index];
  assertClose(hit.panel.atk, fullGolden.panel.atk, `full[${index}].panel.atk`);
  assertClose(hit.panel.critRate, fullGolden.panel.critRate, `full[${index}].panel.critRate`);
  assertClose(hit.panel.critDmg, fullGolden.panel.critDmg, `full[${index}].panel.critDmg`);
  assertClose(hit.multiplier.base, fullGolden.multipliers[index].base, `full[${index}].multiplier.base`);
  assertClose(hit.multiplier.afterBonus, fullGolden.multipliers[index].afterBonus, `full[${index}].multiplier.afterBonus`);
  assertClose(hit.multiplier.afterMultiply, fullGolden.multipliers[index].afterMultiply, `full[${index}].multiplier.afterMultiply`);
  assertClose(hit.zones.elementBonus, zones.elementBonus, `full[${index}].zones.elementBonus`);
  assertClose(hit.zones.skillBonus, zones.skillBonus, `full[${index}].zones.skillBonus`);
  assertClose(hit.zones.allDamageBonus, zones.allDamageBonus, `full[${index}].zones.allDamageBonus`);
  assertZone(hit.zones.damageBonus, zones.damageBonus, `full[${index}].zones.damageBonus`);
  assertZone(hit.zones.amplify, zones.amplify, `full[${index}].zones.amplify`);
  assertZone(hit.zones.fragile, zones.fragile, `full[${index}].zones.fragile`);
  assertZone(hit.zones.vulnerability, zones.vulnerability, `full[${index}].zones.vulnerability`);
  assertZone(hit.zones.skillMultiplier, zones.skillMultiplier, `full[${index}].zones.skillMultiplier`);
  assertClose(hit.zones.resistance.baseResistance, zones.resistance.baseResistance, `full[${index}].zones.resistance.baseResistance`);
  assertClose(hit.zones.resistance.corrosion, zones.resistance.corrosion, `full[${index}].zones.resistance.corrosion`);
  assertClose(hit.zones.resistance.resistanceIgnore, zones.resistance.resistanceIgnore, `full[${index}].zones.resistance.resistanceIgnore`);
  assertClose(hit.zones.resistance.effectiveResistance, zones.resistance.effectiveResistance, `full[${index}].zones.resistance.effectiveResistance`);
  assertClose(hit.zones.resistance.resistanceZone, zones.resistance.resistanceZone, `full[${index}].zones.resistance.resistanceZone`);
  assertClose(hit.zones.resistanceZone, zones.resistanceZone, `full[${index}].zones.resistanceZone`);
  assertClose(hit.zones.amplifyRate, zones.amplifyRate, `full[${index}].zones.amplifyRate`);
  assertClose(hit.zones.fragileRate, zones.fragileRate, `full[${index}].zones.fragileRate`);
  assertClose(hit.zones.vulnerabilityRate, zones.vulnerabilityRate, `full[${index}].zones.vulnerabilityRate`);
  assertClose(hit.zones.comboDamageBonus, zones.comboDamageBonus, `full[${index}].zones.comboDamageBonus`);
  assertClose(hit.zones.imbalanceDamageBonus, zones.imbalanceDamageBonus, `full[${index}].zones.imbalanceDamageBonus`);
  assertClose(hit.zones.defenseZone, zones.defenseZone, `full[${index}].zones.defenseZone`);
  assertBreakdown(hit.expected, breakdown.expected, `full[${index}].expected`);
  assertBreakdown(hit.crit, breakdown.crit, `full[${index}].crit`);
  assertBreakdown(hit.nonCrit, breakdown.nonCrit, `full[${index}].nonCrit`);
  assertClose(hit.expected.afterVulnerability * (1 + zones.comboDamageBonus), breakdown.expected.afterCombo, `full[${index}].expected.afterCombo`);
  assertClose(hit.crit.afterVulnerability * (1 + zones.comboDamageBonus), breakdown.crit.afterCombo, `full[${index}].crit.afterCombo`);
  assertClose(hit.nonCrit.afterVulnerability * (1 + zones.comboDamageBonus), breakdown.nonCrit.afterCombo, `full[${index}].nonCrit.afterCombo`);
  assertClose(breakdown.expected.afterCombo * (1 + zones.imbalanceDamageBonus), breakdown.expected.final, `full[${index}].expected.final formula`);

  const conditionId = index === 0 ? 'fire-damage' : 'physical-damage';
  const conditionValue = index === 0 ? 0.11 : 0.13;
  assertContribution(hit.buffContributions, {
    id: conditionId, rawValue: conditionValue, runtimeCoefficient: 1, effectiveValue: conditionValue,
  }, `full[${index}] condition`);
  assertContribution(hit.buffContributions, {
    id: 'all-damage', rawValue: 0.1, runtimeCoefficient: 1, effectiveValue: 0.1,
  }, `full[${index}] passive`);
  assertContribution(hit.buffContributions, {
    id: index === 0 ? 'fire-damage-multiplier' : 'physical-damage-multiplier',
    rawValue: 0,
    runtimeCoefficient: 1,
    effectiveValue: index === 0 ? 1.1 : 1.12,
    multiplierCoefficient: index === 0 ? 1.1 : 1.12,
  }, `full[${index}] multiplier`);

  const countable = FULL_ZONE_BUFFS.find((buff) => buff.id === 'combo-countable');
  if (!countable) throw new Error('full fixture countable Buff is missing');
  const countableValue = resolveBuffInstanceValue(countable, SYNTHETIC_FULL_MULTIPLIER_INPUT.buffStackCounts);
  assertClose(countableValue.rawValue, 0.06, `full[${index}] countable.rawValue`);
  assertClose(countableValue.runtimeCoefficient, 2, `full[${index}] countable.runtimeCoefficient`);
  assertClose(countableValue.effectiveValue, 0.12, `full[${index}] countable.effectiveValue`);
  assertEqual((countable as { multiplierCoefficient?: number }).multiplierCoefficient, undefined, `full[${index}] countable.multiplierCoefficient`);

  const derived = FULL_ZONE_BUFFS.find((buff) => buff.id === 'combo-derived');
  if (!derived) throw new Error('full fixture derived Buff is missing');
  assertEqual(derived.valueMode, 'derived', `full[${index}] derived.valueMode`);
  assertEqual(derived.derivedValue?.source, 'atk', `full[${index}] derived.source`);
  assertClose(derived.derivedValue?.perPointValue ?? 0, 0.000025, `full[${index}] derived.perPointValue`);
  const derivedValue = resolveBuffInstanceValue(derived, SYNTHETIC_FULL_MULTIPLIER_INPUT.buffStackCounts);
  assertClose(derivedValue.rawValue, 0.06, `full[${index}] derived.rawValue`);
  assertClose(derivedValue.runtimeCoefficient, 1, `full[${index}] derived.runtimeCoefficient`);
  assertClose(derivedValue.effectiveValue, 0.06, `full[${index}] derived.effectiveValue`);
  assertEqual((derived as { multiplierCoefficient?: number }).multiplierCoefficient, undefined, `full[${index}] derived.multiplierCoefficient`);
});

assertClose(fullResult.hits[0].expected.final, fullGolden.expected[0], 'full[0].expected.final golden');
assertClose(fullResult.hits[1].expected.final, fullGolden.expected[1], 'full[1].expected.final golden');
assertClose(fullResult.hits[0].crit.final, fullGolden.crit[0], 'full[0].crit.final golden');
assertClose(fullResult.hits[1].crit.final, fullGolden.crit[1], 'full[1].crit.final golden');
assertClose(fullResult.hits[0].nonCrit.final, fullGolden.nonCrit[0], 'full[0].nonCrit.final golden');
assertClose(fullResult.hits[1].nonCrit.final, fullGolden.nonCrit[1], 'full[1].nonCrit.final golden');
