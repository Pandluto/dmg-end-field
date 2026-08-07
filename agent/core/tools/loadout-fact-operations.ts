/**
 * Deterministic, pure facts over the browser-owned DefTeamLoadoutsV1 result.
 *
 * This module intentionally does not import the product catalog, calculator,
 * or any UI/runtime code.  A loadout is only compared as bounded data returned
 * by the product.  In particular, this module never turns a difference into
 * a preference, score, or ordering claim.
 */

export const DEF_TEAM_LOADOUTS_CONTRACT = 'DefTeamLoadoutsV1' as const;
export const DEF_LOADOUT_EVALUATE_FACTS_CONTRACT = 'DefLoadoutEvaluateFactsV1' as const;
export const DEF_LOADOUT_COMPARE_FACTS_CONTRACT = 'DefLoadoutCompareFactsV1' as const;

export const LOADOUT_SLOT_ORDER = [
  'armor',
  'glove',
  'accessory1',
  'accessory2',
] as const;

const OPERATOR_SKILL_LEVEL_KEYS = ['A', 'B', 'E', 'Q', 'Dot'] as const;
const WEAPON_SKILL_LEVEL_KEYS = ['skill1', 'skill2', 'skill3'] as const;
const MAX_OPERATORS = 128;
const MAX_MISSING_CHARACTER_IDS = 128;
const MAX_EQUIPMENT = LOADOUT_SLOT_ORDER.length;
const MAX_EQUIPMENT_EFFECTS = 64;
const MAX_SET_BUFFS = 64;
const MAX_STRING_LENGTH = 256;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_ARRAY_ITEMS = 256;
const MAX_JSON_OBJECT_KEYS = 256;
const MAX_NUMBER_MAGNITUDE = 1e15;

type LoadoutSlotKey = (typeof LOADOUT_SLOT_ORDER)[number];
type OperatorSkillLevelKey = (typeof OPERATOR_SKILL_LEVEL_KEYS)[number];

export type LoadoutJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly LoadoutJsonValue[]
  | { readonly [key: string]: LoadoutJsonValue };

export interface DefLoadoutBinding {
  readonly workspaceId: string;
  readonly databaseGeneration: string;
  readonly timelineId: string;
  readonly checkoutTargetId: string | null;
  readonly checkoutUpdatedAt: number;
  readonly contentRevision: number;
  readonly snapshotDigest: string;
}

export interface DefLoadoutCharacterIdentity {
  readonly id: string;
  readonly name: string;
  readonly element: string | null;
  readonly profession: string | null;
  readonly librarySource: string | null;
}

export interface DefLoadoutWeaponSkillLevels {
  readonly skill1?: number;
  readonly skill2?: number;
  readonly skill3?: number;
}

export interface DefLoadoutWeapon {
  readonly id: string;
  readonly name: string;
  readonly level: string | number;
  readonly potential: string;
  readonly skillLevels?: DefLoadoutWeaponSkillLevels;
  readonly attack: number;
}

export interface DefLoadoutEquipmentEffect {
  readonly effectId: string;
  readonly label: string;
  readonly typeKey: string;
  readonly level: string | number;
  readonly value: number;
}

export interface DefLoadoutEquipment {
  readonly slotKey: LoadoutSlotKey;
  readonly equipmentId: string;
  readonly name: string;
  readonly part: string;
  readonly effects: readonly DefLoadoutEquipmentEffect[];
}

export interface DefLoadoutSetBuff {
  readonly gearSetId: string;
  readonly gearSetName: string;
  readonly effectId: string;
  readonly label: string;
  readonly typeKey: string;
  readonly value: number;
  readonly category?: string;
  readonly effectKind?: string;
}

export type DefLoadoutOperatorSkillLevels = Readonly<Partial<Record<OperatorSkillLevelKey, 'L9' | 'M3'>>>;

export interface DefLoadoutOperator {
  readonly character: DefLoadoutCharacterIdentity;
  readonly weapon: DefLoadoutWeapon | null;
  readonly equipment: readonly DefLoadoutEquipment[];
  readonly setBuffs: readonly DefLoadoutSetBuff[];
  readonly operatorSkillLevels: DefLoadoutOperatorSkillLevels | null;
  readonly configured: boolean;
}

/** The exact bounded data shape projected by def.data.resource.team_loadouts. */
export interface DefTeamLoadoutsV1Capsule {
  readonly contract: typeof DEF_TEAM_LOADOUTS_CONTRACT;
  readonly binding?: DefLoadoutBinding;
  readonly complete: boolean;
  readonly missingCharacterIds: readonly string[];
  readonly operators: readonly DefLoadoutOperator[];
}

export interface LoadoutFactOptions {
  /** Required when a capsule contains more than one operator. */
  readonly operatorId?: string;
  /** Optional catalog/compatibility evidence. It is only presence-tested. */
  readonly directoryCompatibilityEvidence?: LoadoutJsonValue;
}

export type LoadoutFactErrorCode =
  | 'INVALID_CAPSULE'
  | 'UNKNOWN_FIELD'
  | 'BOUND_EXCEEDED'
  | 'DUPLICATE_OPERATOR'
  | 'DUPLICATE_SLOT'
  | 'DUPLICATE_SET_EFFECT'
  | 'OPERATOR_SELECTION_REQUIRED'
  | 'OPERATOR_NOT_FOUND'
  | 'OPERATOR_MISMATCH'
  | 'INVALID_OPTIONS';

export interface LoadoutFactError {
  readonly code: LoadoutFactErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly details?: { readonly [key: string]: LoadoutJsonValue };
}

export type LoadoutFactResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: LoadoutFactError };

export interface LoadoutOperatorIdentityFact {
  readonly id: string;
  readonly name: string;
}

export interface LoadoutEvaluateFacts {
  readonly contract: typeof DEF_LOADOUT_EVALUATE_FACTS_CONTRACT;
  readonly operator: LoadoutOperatorIdentityFact;
  readonly completeness: {
    readonly complete: boolean;
    readonly configured: boolean;
  };
  readonly missingFields: readonly string[];
  readonly duplicateSlots: readonly LoadoutSlotKey[];
  readonly missingSlots: readonly LoadoutSlotKey[];
  readonly compatibilityEvidence: {
    readonly inputPresent: boolean;
  };
  readonly subjectiveEvaluation: 'evidenceUnavailable';
}

export interface LoadoutFieldDiff {
  readonly field: string;
  readonly baseline: LoadoutJsonValue;
  readonly candidate: LoadoutJsonValue;
  readonly changed: boolean;
}

export interface LoadoutWeaponDiff {
  readonly changed: boolean;
  readonly fields: readonly LoadoutFieldDiff[];
}

export interface LoadoutSkillLevelsDiff {
  readonly changed: boolean;
  readonly weapon: readonly LoadoutFieldDiff[];
  readonly operator: readonly LoadoutFieldDiff[];
}

export interface LoadoutEquipmentSlotDiff {
  readonly slotKey: LoadoutSlotKey;
  readonly changed: boolean;
  readonly fields: readonly LoadoutFieldDiff[];
}

export interface LoadoutEquipmentDiff {
  readonly changed: boolean;
  readonly slots: readonly LoadoutEquipmentSlotDiff[];
}

export interface LoadoutSetEffectDiff {
  readonly key: string;
  readonly changed: boolean;
  readonly fields: readonly LoadoutFieldDiff[];
}

export interface LoadoutSetEffectsDiff {
  readonly changed: boolean;
  readonly effects: readonly LoadoutSetEffectDiff[];
}

export interface LoadoutCompareFacts {
  readonly contract: typeof DEF_LOADOUT_COMPARE_FACTS_CONTRACT;
  readonly operator: LoadoutOperatorIdentityFact;
  readonly weapon: LoadoutWeaponDiff;
  readonly skillLevels: LoadoutSkillLevelsDiff;
  readonly equipmentSlots: LoadoutEquipmentDiff;
  readonly setEffects: LoadoutSetEffectsDiff;
  readonly subjectiveEvaluation: 'evidenceUnavailable';
}

class LoadoutValidationFailure extends Error {
  readonly issue: LoadoutFactError;

  constructor(issue: LoadoutFactError) {
    super(issue.message);
    this.name = 'LoadoutValidationFailure';
    this.issue = issue;
  }
}

/** Validate and normalize the exact bounded DefTeamLoadoutsV1 result. */
export function validateLoadoutCapsule(input: unknown): LoadoutFactResult<DefTeamLoadoutsV1Capsule> {
  return capture(() => parseCapsule(input));
}

/** Evaluate only deterministic completeness and evidence-presence facts. */
export function evaluateFacts(
  input: unknown,
  options: LoadoutFactOptions = {},
): LoadoutFactResult<LoadoutEvaluateFacts> {
  return capture(() => {
    const capsule = parseCapsule(input);
    const normalizedOptions = parseOptions(options);
    const operator = selectOperator(capsule, normalizedOptions);
    const missingFields = missingFieldsFor(operator);
    const missingSlots = missingSlotsFor(operator.equipment);

    return {
      contract: DEF_LOADOUT_EVALUATE_FACTS_CONTRACT,
      operator: {
        id: operator.character.id,
        name: operator.character.name,
      },
      completeness: {
        complete: operator.configured && missingFields.length === 0 && missingSlots.length === 0,
        configured: operator.configured,
      },
      missingFields,
      duplicateSlots: [],
      missingSlots,
      compatibilityEvidence: {
        inputPresent: normalizedOptions.directoryCompatibilityEvidence !== undefined
          && normalizedOptions.directoryCompatibilityEvidence !== null,
      },
      subjectiveEvaluation: 'evidenceUnavailable',
    } satisfies LoadoutEvaluateFacts;
  });
}

/** Compare two loadout snapshots as stable field-level facts only. */
export function compareFacts(
  baselineInput: unknown,
  candidateInput: unknown,
  options: LoadoutFactOptions = {},
): LoadoutFactResult<LoadoutCompareFacts> {
  return capture(() => {
    const baseline = parseCapsule(baselineInput);
    const candidate = parseCapsule(candidateInput);
    const normalizedOptions = parseOptions(options);
    const baselineOperator = selectOperator(baseline, normalizedOptions);
    const candidateOperator = selectOperator(candidate, normalizedOptions);

    if (baselineOperator.character.id !== candidateOperator.character.id) {
      invalid(
        'OPERATOR_MISMATCH',
        'Baseline and candidate must select the same stable operator id',
        'operator.character.id',
        {
          baseline: baselineOperator.character.id,
          candidate: candidateOperator.character.id,
        },
      );
    }

    const weapon = diffWeapon(baselineOperator.weapon, candidateOperator.weapon);
    const skillLevels = diffSkillLevels(baselineOperator, candidateOperator);
    const equipmentSlots = diffEquipmentSlots(baselineOperator.equipment, candidateOperator.equipment);
    const setEffects = diffSetEffects(baselineOperator.setBuffs, candidateOperator.setBuffs);

    return {
      contract: DEF_LOADOUT_COMPARE_FACTS_CONTRACT,
      operator: {
        id: baselineOperator.character.id,
        name: candidateOperator.character.name,
      },
      weapon,
      skillLevels,
      equipmentSlots,
      setEffects,
      subjectiveEvaluation: 'evidenceUnavailable',
    } satisfies LoadoutCompareFacts;
  });
}

function capture<Value>(run: () => Value): LoadoutFactResult<Value> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof LoadoutValidationFailure) return { ok: false, error: error.issue };
    throw error;
  }
}

function parseCapsule(input: unknown): DefTeamLoadoutsV1Capsule {
  const record = asRecord(input, '$');
  ensureExactKeys(record, ['contract', 'complete', 'missingCharacterIds', 'operators'], ['binding'], '$');
  const contract = requiredString(record.contract, '$.contract');
  if (contract !== DEF_TEAM_LOADOUTS_CONTRACT) {
    invalid('INVALID_CAPSULE', `Expected ${DEF_TEAM_LOADOUTS_CONTRACT}`, '$.contract');
  }

  const binding = has(record, 'binding') ? parseBinding(record.binding, '$.binding') : undefined;
  const complete = requiredBoolean(record.complete, '$.complete');
  const missingCharacterIds = parseStringArray(
    record.missingCharacterIds,
    '$.missingCharacterIds',
    MAX_MISSING_CHARACTER_IDS,
  );
  ensureUnique(missingCharacterIds, '$.missingCharacterIds', 'DUPLICATE_OPERATOR');
  const operators = parseOperators(record.operators, '$.operators');

  const operatorIds = new Set(operators.map((operator) => operator.character.id));
  for (const missingId of missingCharacterIds) {
    if (!operatorIds.has(missingId)) {
      invalid(
        'INVALID_CAPSULE',
        'missingCharacterIds must refer to an operator in the same snapshot',
        '$.missingCharacterIds',
        { missingId },
      );
    }
  }
  for (const operator of operators) {
    const listedAsMissing = missingCharacterIds.includes(operator.character.id);
    if (listedAsMissing === operator.configured) {
      invalid(
        'INVALID_CAPSULE',
        'configured and missingCharacterIds disagree for the selected operator',
        `$.operators[${operators.indexOf(operator)}].configured`,
      );
    }
  }
  if (complete !== (missingCharacterIds.length === 0)) {
    invalid('INVALID_CAPSULE', 'complete must match whether missingCharacterIds is empty', '$.complete');
  }

  return {
    contract: DEF_TEAM_LOADOUTS_CONTRACT,
    ...(binding === undefined ? {} : { binding }),
    complete,
    missingCharacterIds,
    operators,
  };
}

function parseBinding(input: unknown, path: string): DefLoadoutBinding {
  const record = asRecord(input, path);
  ensureExactKeys(
    record,
    [
      'workspaceId',
      'databaseGeneration',
      'timelineId',
      'checkoutTargetId',
      'checkoutUpdatedAt',
      'contentRevision',
      'snapshotDigest',
    ],
    [],
    path,
  );
  return {
    workspaceId: requiredString(record.workspaceId, `${path}.workspaceId`),
    databaseGeneration: requiredString(record.databaseGeneration, `${path}.databaseGeneration`),
    timelineId: requiredString(record.timelineId, `${path}.timelineId`),
    checkoutTargetId: nullableString(record.checkoutTargetId, `${path}.checkoutTargetId`),
    checkoutUpdatedAt: finiteNumber(record.checkoutUpdatedAt, `${path}.checkoutUpdatedAt`),
    contentRevision: finiteNumber(record.contentRevision, `${path}.contentRevision`),
    snapshotDigest: requiredString(record.snapshotDigest, `${path}.snapshotDigest`),
  };
}

function parseOperators(input: unknown, path: string): readonly DefLoadoutOperator[] {
  const values = boundedArray(input, path, MAX_OPERATORS);
  const operators = values.map((value, index) => parseOperator(value, `${path}[${index}]`));
  const seen = new Set<string>();
  operators.forEach((operator, index) => {
    if (seen.has(operator.character.id)) {
      invalid('DUPLICATE_OPERATOR', 'Operator identity id must be unique in a snapshot', `${path}[${index}].character.id`, {
        id: operator.character.id,
      });
    }
    seen.add(operator.character.id);
  });
  return operators;
}

function parseOperator(input: unknown, path: string): DefLoadoutOperator {
  const record = asRecord(input, path);
  ensureExactKeys(
    record,
    ['character', 'weapon', 'equipment', 'setBuffs', 'operatorSkillLevels', 'configured'],
    [],
    path,
  );
  const character = parseCharacter(record.character, `${path}.character`);
  const weapon = record.weapon === null ? null : parseWeapon(record.weapon, `${path}.weapon`);
  const equipment = parseEquipmentArray(record.equipment, `${path}.equipment`);
  const setBuffs = parseSetBuffs(record.setBuffs, `${path}.setBuffs`);
  const operatorSkillLevels = record.operatorSkillLevels === null
    ? null
    : parseOperatorSkillLevels(record.operatorSkillLevels, `${path}.operatorSkillLevels`);
  const configured = requiredBoolean(record.configured, `${path}.configured`);

  if (!configured && (weapon !== null || equipment.length > 0 || setBuffs.length > 0 || operatorSkillLevels !== null)) {
    invalid(
      'INVALID_CAPSULE',
      'An unconfigured operator cannot contain loadout data',
      `${path}.configured`,
    );
  }

  return {
    character,
    weapon,
    equipment,
    setBuffs,
    operatorSkillLevels,
    configured,
  };
}

function parseCharacter(input: unknown, path: string): DefLoadoutCharacterIdentity {
  const record = asRecord(input, path);
  ensureExactKeys(record, ['id', 'name', 'element', 'profession', 'librarySource'], [], path);
  return {
    id: requiredString(record.id, `${path}.id`),
    name: requiredString(record.name, `${path}.name`),
    element: nullableString(record.element, `${path}.element`),
    profession: nullableString(record.profession, `${path}.profession`),
    librarySource: nullableString(record.librarySource, `${path}.librarySource`),
  };
}

function parseWeapon(input: unknown, path: string): DefLoadoutWeapon {
  const record = asRecord(input, path);
  ensureExactKeys(record, ['id', 'name', 'level', 'potential', 'attack'], ['skillLevels'], path);
  const weapon: DefLoadoutWeapon = {
    id: requiredString(record.id, `${path}.id`),
    name: requiredString(record.name, `${path}.name`),
    level: levelValue(record.level, `${path}.level`),
    potential: requiredString(record.potential, `${path}.potential`),
    attack: finiteNumber(record.attack, `${path}.attack`),
  };
  if (has(record, 'skillLevels')) {
    return { ...weapon, skillLevels: parseWeaponSkillLevels(record.skillLevels, `${path}.skillLevels`) };
  }
  return weapon;
}

function parseWeaponSkillLevels(input: unknown, path: string): DefLoadoutWeaponSkillLevels {
  const record = asRecord(input, path);
  ensureExactKeys(record, [], [...WEAPON_SKILL_LEVEL_KEYS], path);
  const result: Record<string, number> = {};
  for (const key of WEAPON_SKILL_LEVEL_KEYS) {
    if (has(record, key)) result[key] = finiteNumber(record[key], `${path}.${key}`);
  }
  return result as DefLoadoutWeaponSkillLevels;
}

function parseEquipmentArray(input: unknown, path: string): readonly DefLoadoutEquipment[] {
  const values = boundedArray(input, path, MAX_EQUIPMENT);
  const equipment = values.map((value, index) => parseEquipment(value, `${path}[${index}]`));
  const seen = new Set<LoadoutSlotKey>();
  equipment.forEach((piece, index) => {
    if (seen.has(piece.slotKey)) {
      invalid('DUPLICATE_SLOT', 'Each of the four equipment slots may appear at most once', `${path}[${index}].slotKey`, {
        slotKey: piece.slotKey,
      });
    }
    seen.add(piece.slotKey);
  });
  return [...equipment].sort((left, right) => slotIndex(left.slotKey) - slotIndex(right.slotKey));
}

function parseEquipment(input: unknown, path: string): DefLoadoutEquipment {
  const record = asRecord(input, path);
  ensureExactKeys(record, ['slotKey', 'equipmentId', 'name', 'part', 'effects'], [], path);
  const slotKey = requiredString(record.slotKey, `${path}.slotKey`);
  if (!isLoadoutSlotKey(slotKey)) {
    invalid('INVALID_CAPSULE', 'Unknown equipment slot', `${path}.slotKey`, { slotKey });
  }
  return {
    slotKey,
    equipmentId: requiredString(record.equipmentId, `${path}.equipmentId`),
    name: requiredString(record.name, `${path}.name`),
    part: requiredString(record.part, `${path}.part`),
    effects: parseEquipmentEffects(record.effects, `${path}.effects`),
  };
}

function parseEquipmentEffects(input: unknown, path: string): readonly DefLoadoutEquipmentEffect[] {
  const values = boundedArray(input, path, MAX_EQUIPMENT_EFFECTS);
  const effects = values.map((value, index) => {
    const effectPath = `${path}[${index}]`;
    const record = asRecord(value, effectPath);
    ensureExactKeys(record, ['effectId', 'label', 'typeKey', 'level', 'value'], [], effectPath);
    return {
      effectId: requiredString(record.effectId, `${effectPath}.effectId`),
      label: requiredString(record.label, `${effectPath}.label`),
      typeKey: requiredString(record.typeKey, `${effectPath}.typeKey`),
      level: levelValue(record.level, `${effectPath}.level`),
      value: finiteNumber(record.value, `${effectPath}.value`),
    } satisfies DefLoadoutEquipmentEffect;
  });
  return [...effects].sort((left, right) => (
    compareText(left.effectId, right.effectId) || compareText(left.label, right.label)
  ));
}

function parseSetBuffs(input: unknown, path: string): readonly DefLoadoutSetBuff[] {
  const values = boundedArray(input, path, MAX_SET_BUFFS);
  const buffs = values.map((value, index) => {
    const buffPath = `${path}[${index}]`;
    const record = asRecord(value, buffPath);
    ensureExactKeys(record, ['gearSetId', 'gearSetName', 'effectId', 'label', 'typeKey', 'value'], ['category', 'effectKind'], buffPath);
    const buff: DefLoadoutSetBuff = {
      gearSetId: requiredString(record.gearSetId, `${buffPath}.gearSetId`),
      gearSetName: requiredString(record.gearSetName, `${buffPath}.gearSetName`),
      effectId: requiredString(record.effectId, `${buffPath}.effectId`),
      label: requiredString(record.label, `${buffPath}.label`),
      typeKey: requiredString(record.typeKey, `${buffPath}.typeKey`),
      value: finiteNumber(record.value, `${buffPath}.value`),
    };
    return {
      ...buff,
      ...(has(record, 'category') ? { category: requiredString(record.category, `${buffPath}.category`) } : {}),
      ...(has(record, 'effectKind') ? { effectKind: requiredString(record.effectKind, `${buffPath}.effectKind`) } : {}),
    } satisfies DefLoadoutSetBuff;
  });

  const seen = new Set<string>();
  buffs.forEach((buff, index) => {
    const key = setEffectKey(buff);
    if (seen.has(key)) {
      invalid('DUPLICATE_SET_EFFECT', 'A set effect identity may appear at most once', `${path}[${index}]`, { key });
    }
    seen.add(key);
  });
  return [...buffs].sort(compareSetBuffs);
}

function parseOperatorSkillLevels(input: unknown, path: string): DefLoadoutOperatorSkillLevels {
  const record = asRecord(input, path);
  ensureExactKeys(record, [], [...OPERATOR_SKILL_LEVEL_KEYS], path);
  const result: Partial<Record<OperatorSkillLevelKey, 'L9' | 'M3'>> = {};
  for (const key of OPERATOR_SKILL_LEVEL_KEYS) {
    if (!has(record, key)) continue;
    const value = record[key];
    if (value !== 'L9' && value !== 'M3') {
      invalid('INVALID_CAPSULE', 'Operator skill level must be L9 or M3', `${path}.${key}`);
    }
    result[key] = value;
  }
  return result;
}

function parseOptions(input: LoadoutFactOptions): LoadoutFactOptions {
  const record = asRecord(input, '$.options');
  ensureExactKeys(record, [], ['operatorId', 'directoryCompatibilityEvidence'], '$.options');
  if (has(record, 'operatorId')) requiredString(record.operatorId, '$.options.operatorId');
  if (has(record, 'directoryCompatibilityEvidence') && record.directoryCompatibilityEvidence !== null) {
    assertBoundedJson(record.directoryCompatibilityEvidence, '$.options.directoryCompatibilityEvidence', 0);
  }
  return {
    ...(has(record, 'operatorId') ? { operatorId: requiredString(record.operatorId, '$.options.operatorId') } : {}),
    ...(has(record, 'directoryCompatibilityEvidence')
      ? { directoryCompatibilityEvidence: record.directoryCompatibilityEvidence as LoadoutJsonValue }
      : {}),
  };
}

function selectOperator(
  capsule: DefTeamLoadoutsV1Capsule,
  options: LoadoutFactOptions,
): DefLoadoutOperator {
  const operatorId = options.operatorId;
  if (operatorId !== undefined) {
    const selected = capsule.operators.find((operator) => operator.character.id === operatorId);
    if (!selected) invalid('OPERATOR_NOT_FOUND', 'The requested stable operator id is not in the snapshot', '$.options.operatorId', { operatorId });
    return selected;
  }
  if (capsule.operators.length === 0) {
    invalid('OPERATOR_NOT_FOUND', 'The snapshot contains no operator to select', '$.operators');
  }
  if (capsule.operators.length !== 1) {
    invalid('OPERATOR_SELECTION_REQUIRED', 'A multi-operator snapshot requires a stable operatorId', '$.options.operatorId', {
      operatorCount: capsule.operators.length,
    });
  }
  return capsule.operators[0]!;
}

function missingFieldsFor(operator: DefLoadoutOperator): readonly string[] {
  if (!operator.configured) return ['weapon', 'equipment', 'setBuffs', 'operatorSkillLevels'];
  const missing: string[] = [];
  if (operator.weapon === null) {
    missing.push('weapon');
  } else if (operator.weapon.skillLevels === undefined) {
    missing.push('weapon.skillLevels');
  } else {
    for (const key of WEAPON_SKILL_LEVEL_KEYS) {
      if (operator.weapon.skillLevels[key] === undefined) missing.push(`weapon.skillLevels.${key}`);
    }
  }
  if (operator.operatorSkillLevels === null) {
    missing.push('operatorSkillLevels');
  }
  return missing;
}

function missingSlotsFor(equipment: readonly DefLoadoutEquipment[]): readonly LoadoutSlotKey[] {
  const present = new Set(equipment.map((piece) => piece.slotKey));
  return LOADOUT_SLOT_ORDER.filter((slotKey) => !present.has(slotKey));
}

function diffWeapon(
  baseline: DefLoadoutWeapon | null,
  candidate: DefLoadoutWeapon | null,
): LoadoutWeaponDiff {
  const fields = [
    fieldDiff('id', baseline?.id ?? null, candidate?.id ?? null),
    fieldDiff('name', baseline?.name ?? null, candidate?.name ?? null),
    fieldDiff('level', baseline?.level ?? null, candidate?.level ?? null),
    fieldDiff('potential', baseline?.potential ?? null, candidate?.potential ?? null),
    fieldDiff('attack', baseline?.attack ?? null, candidate?.attack ?? null),
  ];
  return { changed: hasChanged(fields), fields };
}

function diffSkillLevels(
  baseline: DefLoadoutOperator,
  candidate: DefLoadoutOperator,
): LoadoutSkillLevelsDiff {
  const weapon = WEAPON_SKILL_LEVEL_KEYS.map((key) => fieldDiff(
    key,
    baseline.weapon?.skillLevels?.[key] ?? null,
    candidate.weapon?.skillLevels?.[key] ?? null,
  ));
  const operator = OPERATOR_SKILL_LEVEL_KEYS.map((key) => fieldDiff(
    key,
    baseline.operatorSkillLevels?.[key] ?? null,
    candidate.operatorSkillLevels?.[key] ?? null,
  ));
  return { changed: hasChanged(weapon) || hasChanged(operator), weapon, operator };
}

function diffEquipmentSlots(
  baseline: readonly DefLoadoutEquipment[],
  candidate: readonly DefLoadoutEquipment[],
): LoadoutEquipmentDiff {
  const slots = LOADOUT_SLOT_ORDER.map((slotKey) => {
    const baselinePiece = baseline.find((piece) => piece.slotKey === slotKey) ?? null;
    const candidatePiece = candidate.find((piece) => piece.slotKey === slotKey) ?? null;
    const fields = [
      fieldDiff('equipmentId', baselinePiece?.equipmentId ?? null, candidatePiece?.equipmentId ?? null),
      fieldDiff('name', baselinePiece?.name ?? null, candidatePiece?.name ?? null),
      fieldDiff('part', baselinePiece?.part ?? null, candidatePiece?.part ?? null),
      fieldDiff('effects', baselinePiece?.effects ?? null, candidatePiece?.effects ?? null),
    ];
    return { slotKey, changed: hasChanged(fields), fields } satisfies LoadoutEquipmentSlotDiff;
  });
  return { changed: slots.some((slot) => slot.changed), slots };
}

function diffSetEffects(
  baseline: readonly DefLoadoutSetBuff[],
  candidate: readonly DefLoadoutSetBuff[],
): LoadoutSetEffectsDiff {
  const byKey = new Map<string, { baseline: DefLoadoutSetBuff | null; candidate: DefLoadoutSetBuff | null }>();
  baseline.forEach((effect) => { byKey.set(setEffectKey(effect), { baseline: effect, candidate: null }); });
  candidate.forEach((effect) => {
    const key = setEffectKey(effect);
    const existing = byKey.get(key);
    byKey.set(key, { baseline: existing?.baseline ?? null, candidate: effect });
  });
  const effects = [...byKey.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, pair]) => {
      const fields = [
        fieldDiff('gearSetId', pair.baseline?.gearSetId ?? null, pair.candidate?.gearSetId ?? null),
        fieldDiff('gearSetName', pair.baseline?.gearSetName ?? null, pair.candidate?.gearSetName ?? null),
        fieldDiff('effectId', pair.baseline?.effectId ?? null, pair.candidate?.effectId ?? null),
        fieldDiff('label', pair.baseline?.label ?? null, pair.candidate?.label ?? null),
        fieldDiff('typeKey', pair.baseline?.typeKey ?? null, pair.candidate?.typeKey ?? null),
        fieldDiff('value', pair.baseline?.value ?? null, pair.candidate?.value ?? null),
        fieldDiff('category', pair.baseline?.category ?? null, pair.candidate?.category ?? null),
        fieldDiff('effectKind', pair.baseline?.effectKind ?? null, pair.candidate?.effectKind ?? null),
      ];
      return { key, changed: hasChanged(fields), fields } satisfies LoadoutSetEffectDiff;
    });
  return { changed: effects.some((effect) => effect.changed), effects };
}

function fieldDiff(field: string, baseline: unknown, candidate: unknown): LoadoutFieldDiff {
  const baselineJson = toJsonValue(baseline);
  const candidateJson = toJsonValue(candidate);
  return { field, baseline: baselineJson, candidate: candidateJson, changed: stableJson(baselineJson) !== stableJson(candidateJson) };
}

function hasChanged(fields: readonly LoadoutFieldDiff[]): boolean {
  return fields.some((field) => field.changed);
}

function setEffectKey(effect: DefLoadoutSetBuff): string {
  return `${effect.gearSetId}\u0000${effect.effectId}`;
}

function compareSetBuffs(left: DefLoadoutSetBuff, right: DefLoadoutSetBuff): number {
  return compareText(left.gearSetId, right.gearSetId)
    || compareText(left.effectId, right.effectId)
    || compareText(left.gearSetName, right.gearSetName)
    || compareText(left.label, right.label);
}

function slotIndex(slotKey: LoadoutSlotKey): number {
  return LOADOUT_SLOT_ORDER.indexOf(slotKey);
}

function isLoadoutSlotKey(value: string): value is LoadoutSlotKey {
  return (LOADOUT_SLOT_ORDER as readonly string[]).includes(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: LoadoutJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as { readonly [key: string]: LoadoutJsonValue };
  return `{${Object.keys(object).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableJson(object[key]!)}`).join(',')}}`;
}

function toJsonValue(value: unknown): LoadoutJsonValue {
  return value === undefined ? null : value as LoadoutJsonValue;
}

function assertBoundedJson(value: unknown, path: string, depth: number): asserts value is LoadoutJsonValue {
  if (depth > MAX_JSON_DEPTH) invalid('BOUND_EXCEEDED', 'JSON nesting exceeds the supported bound', path);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) invalid('BOUND_EXCEEDED', 'String exceeds the supported bound', path);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMBER_MAGNITUDE) invalid('INVALID_CAPSULE', 'JSON numbers must be finite and bounded', path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_ITEMS) invalid('BOUND_EXCEEDED', 'JSON array exceeds the supported bound', path);
    value.forEach((entry, index) => assertBoundedJson(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isPlainRecord(value)) invalid('INVALID_CAPSULE', 'Value must be JSON-safe', path);
  const keys = Object.keys(value);
  if (keys.length > MAX_JSON_OBJECT_KEYS) invalid('BOUND_EXCEEDED', 'JSON object exceeds the supported key bound', path);
  keys.forEach((key) => {
    if (key.length > MAX_STRING_LENGTH) invalid('BOUND_EXCEEDED', 'JSON object key exceeds the supported bound', `${path}.${key}`);
    assertBoundedJson(value[key], `${path}.${key}`, depth + 1);
  });
}

function asRecord(input: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(input)) invalid('INVALID_CAPSULE', 'Expected a JSON object', path);
  assertBoundedJson(input, path, 0);
  return input;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function ensureExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid('UNKNOWN_FIELD', `Unknown field: ${key}`, `${path}.${key}`, { key });
  }
  for (const key of required) {
    if (!has(record, key)) invalid('INVALID_CAPSULE', `Missing required field: ${key}`, `${path}.${key}`);
  }
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requiredString(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.length === 0) invalid('INVALID_CAPSULE', 'Expected a non-empty string', path);
  if (input.length > MAX_STRING_LENGTH) invalid('BOUND_EXCEEDED', 'String exceeds the supported bound', path);
  return input;
}

function nullableString(input: unknown, path: string): string | null {
  if (input === null) return null;
  return requiredString(input, path);
}

function requiredBoolean(input: unknown, path: string): boolean {
  if (typeof input !== 'boolean') invalid('INVALID_CAPSULE', 'Expected a boolean', path);
  return input;
}

function finiteNumber(input: unknown, path: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || Math.abs(input) > MAX_NUMBER_MAGNITUDE) {
    invalid('INVALID_CAPSULE', 'Expected a finite bounded number', path);
  }
  return input;
}

function levelValue(input: unknown, path: string): string | number {
  if (typeof input === 'string') return requiredString(input, path);
  return finiteNumber(input, path);
}

function boundedArray(input: unknown, path: string, max: number): readonly unknown[] {
  if (!Array.isArray(input)) invalid('INVALID_CAPSULE', 'Expected an array', path);
  if (input.length > max) invalid('BOUND_EXCEEDED', `Array exceeds the maximum length of ${max}`, path);
  return input;
}

function parseStringArray(input: unknown, path: string, max: number): readonly string[] {
  return boundedArray(input, path, max).map((value, index) => requiredString(value, `${path}[${index}]`));
}

function ensureUnique(values: readonly string[], path: string, code: 'DUPLICATE_OPERATOR' | 'DUPLICATE_SLOT'): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) invalid(code, 'Identity must be unique', `${path}[${index}]`, { value });
    seen.add(value);
  });
}

function invalid(
  code: LoadoutFactErrorCode,
  message: string,
  path?: string,
  details?: { readonly [key: string]: LoadoutJsonValue },
): never {
  throw new LoadoutValidationFailure({
    code,
    message,
    ...(path === undefined ? {} : { path }),
    ...(details === undefined ? {} : { details }),
  });
}
