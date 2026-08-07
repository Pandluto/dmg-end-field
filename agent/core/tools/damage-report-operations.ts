/**
 * Pure, JSON-safe operations over the product-generated DefDamageReportV1
 * capsule.
 *
 * This module deliberately does not import the calculator or repositories.
 * The product owns damage calculation; this layer validates and projects the
 * values that the product already returned.
 */

export const DEF_DAMAGE_REPORT_CAPSULE_CONTRACT = 'DefDamageReportV1' as const;
export const DEF_DAMAGE_REPORT_CURRENT_CONTRACT = 'DefDamageCurrentV1' as const;
export const DEF_DAMAGE_REPORT_AGGREGATE_CONTRACT = 'DefDamageAggregateV1' as const;
export const DEF_DAMAGE_REPORT_COMPARE_CONTRACT = 'DefDamageCompareV1' as const;
export const DEF_DAMAGE_REPORT_ATTRIBUTE_CONTRACT = 'DefDamageAttributeV1' as const;
export const DEF_DAMAGE_REPORT_DIAGNOSTIC_CONTRACT = 'DefDamageDiagnosticV1' as const;
export const DEF_DAMAGE_REPORT_EXPORT_CONTRACT = 'DefDamageExportV1' as const;
export const DEF_DAMAGE_REPORT_EXPLANATION_CONTRACT = 'DefDamageExplanationV1' as const;

const MAX_BUTTONS = 512;
const MAX_CHARACTERS = 128;
const MAX_HITS_PER_BUTTON = 256;
const MAX_BUFFS_PER_HIT = 128;
const MAX_ZONES_PER_HIT = 32;
const MAX_SKILLS_PER_CHARACTER = 64;
const MAX_LINES_PER_CHARACTER = 256;
const MAX_STRING_LENGTH = 1024;
const MAX_SHORT_STRING_LENGTH = 256;
const MAX_EXPORT_ROWS = 256;
const MAX_NUMERIC_MAGNITUDE = 1e15;
const FLOAT_EPSILON = 1e-9;

type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface DefDamageReportBinding {
  readonly workspaceId: string;
  readonly databaseGeneration: string;
  readonly timelineId: string;
  readonly checkoutTargetId: string | null;
  readonly checkoutUpdatedAt: number;
  readonly contentRevision: number;
  readonly snapshotDigest: string;
}

export interface DefDamageReportBuff {
  readonly id: string;
  readonly traceId: string;
  readonly name: string;
  readonly effect: string;
  readonly type?: string;
  readonly zone?: string;
  readonly rawValue?: number;
  readonly runtimeCoefficient?: number;
  readonly effectiveValue?: number;
  readonly multiplierCoefficient?: number;
  readonly multiplier?: boolean;
}

export interface DefDamageReportZone {
  readonly key: string;
  readonly additiveTotal: number;
  readonly multiplierProduct: number;
  readonly finalValue: number;
}

export interface DefDamageReportResistance {
  readonly baseResistance: number;
  readonly corrosion: number;
  readonly resistanceIgnore: number;
  readonly effectiveResistance: number;
  readonly resistanceZone: number;
  readonly formulaText: string;
}

export interface DefDamageReportHit {
  readonly id: string;
  readonly title: string;
  readonly sourceKind: 'normal' | 'anomaly' | 'extraHit';
  readonly damageSourceLabel: string;
  readonly skillTypeLabel: string;
  readonly elementLabel: string;
  readonly damage: number;
  readonly expected: number;
  readonly nonCrit: number;
  readonly resistanceZone: number;
  readonly resistance: DefDamageReportResistance;
  readonly buffs: readonly DefDamageReportBuff[];
  readonly zones?: readonly DefDamageReportZone[];
}

export interface DefDamageReportButton {
  readonly id: string;
  readonly characterId: string;
  readonly groupLabel: string;
  readonly orderLabel: string;
  readonly characterName: string;
  readonly skillName: string;
  readonly skillType: string;
  readonly damage: number;
  readonly expected: number;
  readonly nonCrit: number;
  readonly share: number;
  readonly hits: readonly DefDamageReportHit[];
}

export interface DefDamageReportCharacterSkill {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly hitLines: readonly string[];
}

export interface DefDamageReportCharacter {
  readonly characterId: string;
  readonly characterName: string;
  readonly weaponName: string;
  readonly weaponPotentialMode: string;
  readonly level: number | null;
  readonly skillLevels: readonly string[];
  readonly attributeLines: readonly string[];
  readonly equipmentLines: readonly string[];
  readonly skills: readonly DefDamageReportCharacterSkill[];
}

export interface DefDamageReportSnapshot {
  readonly generatedAt: number;
  readonly totalDamage: number;
  readonly totalExpected: number;
  readonly totalNonCrit: number;
  readonly buttonCount: number;
  readonly buttons: readonly DefDamageReportButton[];
  readonly characters: readonly DefDamageReportCharacter[];
}

/** The exact envelope returned by def.data.resource.damage. */
export interface DefDamageReportCapsule {
  readonly contract: typeof DEF_DAMAGE_REPORT_CAPSULE_CONTRACT;
  readonly binding?: DefDamageReportBinding;
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly schemeDigest: string;
  readonly report: DefDamageReportSnapshot;
}

export type DamageReportErrorCode =
  | 'INVALID_CAPSULE'
  | 'BOUND_EXCEEDED'
  | 'INCOMPATIBLE_FORMULA_VERSION'
  | 'INCOMPATIBLE_STATISTICAL_SCOPE'
  | 'INCOMPATIBLE_BUTTON_SCOPE'
  | 'TARGET_NOT_FOUND'
  | 'INVALID_OPTIONS';

export interface DamageReportOperationError {
  readonly code: DamageReportErrorCode;
  readonly message: string;
  readonly path?: string;
  readonly details?: { readonly [key: string]: JsonValue };
}

export type DamageReportOperationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: DamageReportOperationError };

export interface DefDamageCurrentProjection {
  readonly contract: typeof DEF_DAMAGE_REPORT_CURRENT_CONTRACT;
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly schemeDigest: string;
  readonly generatedAt: number;
  readonly buttonScope: readonly string[];
  readonly buttonCount: number;
  readonly totalDamage: number;
  readonly totalExpected: number;
  readonly totalNonCrit: number;
}

export interface DefDamageAggregateContribution {
  readonly id: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly skillName: string;
  readonly expected: number;
  readonly nonCrit: number;
}

export interface DefDamageCharacterContribution {
  readonly characterId: string;
  readonly characterName: string;
  readonly buttonIds: readonly string[];
  readonly expected: number;
  readonly nonCrit: number;
}

export interface DefDamageAggregateProjection {
  readonly contract: typeof DEF_DAMAGE_REPORT_AGGREGATE_CONTRACT;
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly schemeDigest: string;
  readonly generatedAt: number;
  readonly buttonScope: readonly string[];
  readonly total: {
    readonly damage: number;
    readonly expected: number;
    readonly nonCrit: number;
  };
  readonly buttons: readonly DefDamageAggregateContribution[];
  readonly characters: readonly DefDamageCharacterContribution[];
}

export interface DefDamageDelta {
  readonly current: number;
  readonly baseline: number;
  readonly delta: number;
}

export interface DefDamageCompareRow {
  readonly id: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly expected: DefDamageDelta;
  readonly nonCrit: DefDamageDelta;
}

export interface DefDamageCharacterCompareRow {
  readonly characterId: string;
  readonly characterName: string;
  readonly expected: DefDamageDelta;
  readonly nonCrit: DefDamageDelta;
}

export interface DefDamageCompareProjection {
  readonly contract: typeof DEF_DAMAGE_REPORT_COMPARE_CONTRACT;
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly buttonScope: readonly string[];
  readonly current: {
    readonly schemeDigest: string;
    readonly generatedAt: number;
  };
  readonly baseline: {
    readonly schemeDigest: string;
    readonly generatedAt: number;
  };
  readonly total: {
    readonly expected: DefDamageDelta;
    readonly nonCrit: DefDamageDelta;
  };
  readonly buttons: readonly DefDamageCompareRow[];
  readonly characters: readonly DefDamageCharacterCompareRow[];
}

export interface DefDamageAttributeOptions {
  readonly buttonId?: string;
  readonly hitId?: string;
}

export interface DefDamageHitFact {
  readonly buttonId: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly skillName: string;
  readonly hitId: string;
  readonly title: string;
  readonly sourceKind: DefDamageReportHit['sourceKind'];
  readonly damageSourceLabel: string;
  readonly skillTypeLabel: string;
  readonly elementLabel: string;
  readonly damage: number;
  readonly expected: number;
  readonly nonCrit: number;
  readonly resistanceZone: number;
  readonly resistance: DefDamageReportResistance;
  readonly buffs: readonly DefDamageReportBuff[];
  readonly zones?: readonly DefDamageReportZone[];
}

export interface DefDamageAttributeProjection {
  readonly contract: typeof DEF_DAMAGE_REPORT_ATTRIBUTE_CONTRACT;
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly schemeDigest: string;
  readonly facts: readonly DefDamageHitFact[];
}

export type DefDamageDiagnosticStatus =
  | 'ready'
  | 'missing'
  | 'stale'
  | 'malformed'
  | 'formula-error'
  | 'unknown';

export interface DefDamageDiagnosticProjection {
  readonly contract: typeof DEF_DAMAGE_REPORT_DIAGNOSTIC_CONTRACT;
  readonly status: DefDamageDiagnosticStatus;
  readonly code: string;
  readonly message: string;
}

export interface DefDamageExportOptions {
  readonly format?: 'table' | 'json';
  readonly maxRows?: number;
  readonly includeCharacters?: boolean;
}

export interface DefDamageExportTableRow {
  readonly kind: 'total' | 'button' | 'character';
  readonly id: string;
  readonly label: string;
  readonly characterId: string | null;
  readonly expected: number;
  readonly nonCrit: number;
}

export interface DefDamageTableExport {
  readonly contract: typeof DEF_DAMAGE_REPORT_EXPORT_CONTRACT;
  readonly format: 'table';
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly schemeDigest: string;
  readonly generatedAt: number;
  readonly headers: readonly ['kind', 'id', 'label', 'characterId', 'expected', 'nonCrit'];
  readonly rows: readonly (readonly [
    'total' | 'button' | 'character',
    string,
    string,
    string | null,
    number,
    number,
  ])[];
  readonly rowCount: number;
  readonly truncated: boolean;
}

export interface DefDamageJsonExport {
  readonly contract: typeof DEF_DAMAGE_REPORT_EXPORT_CONTRACT;
  readonly format: 'json';
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly schemeDigest: string;
  readonly generatedAt: number;
  readonly rows: readonly DefDamageExportTableRow[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly json: string;
}

export type DefDamageExportProjection = DefDamageTableExport | DefDamageJsonExport;

export interface DefDamageExplanationProjection {
  readonly contract: typeof DEF_DAMAGE_REPORT_EXPLANATION_CONTRACT;
  readonly formulaVersion: string;
  readonly statisticalScope: string;
  readonly schemeDigest: string;
  readonly facts: readonly DefDamageHitFact[];
}

class ValidationFault {
  readonly code: 'INVALID_CAPSULE' | 'BOUND_EXCEEDED';
  readonly message: string;
  readonly path?: string;

  constructor(
    code: 'INVALID_CAPSULE' | 'BOUND_EXCEEDED',
    message: string,
    path?: string,
  ) {
    this.code = code;
    this.message = message;
    this.path = path;
  }
}

function success<Value>(value: Value): DamageReportOperationResult<Value> {
  return { ok: true, value };
}

function failure<Value>(
  code: DamageReportErrorCode,
  message: string,
  path?: string,
  details?: { readonly [key: string]: JsonValue },
): DamageReportOperationResult<Value> {
  const error: DamageReportOperationError = path === undefined
    ? details === undefined ? { code, message } : { code, message, details }
    : details === undefined ? { code, message, path } : { code, message, path, details };
  return { ok: false, error };
}

function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: { readonly [key: string]: unknown }, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function allowedKeys(
  value: { readonly [key: string]: unknown },
  keys: readonly string[],
  path: string,
): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ValidationFault('INVALID_CAPSULE', `Unsupported field(s): ${unknown.sort().join(', ')}`, path);
  }
}

function object(value: unknown, path: string): { readonly [key: string]: unknown } {
  if (!isPlainObject(value)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Expected a JSON object', path);
  }
  return value;
}

function array(value: unknown, path: string, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Expected a JSON array', path);
  }
  if (value.length > maxLength) {
    throw new ValidationFault('BOUND_EXCEEDED', `Array length must be at most ${maxLength}`, path);
  }
  return value;
}

function requiredString(value: unknown, path: string, maxLength = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationFault('INVALID_CAPSULE', 'Expected a non-empty string', path);
  }
  if (value.length > maxLength) {
    throw new ValidationFault('BOUND_EXCEEDED', `String length must be at most ${maxLength}`, path);
  }
  return value;
}

function optionalString(
  value: { readonly [key: string]: unknown },
  key: string,
  path: string,
  maxLength = MAX_STRING_LENGTH,
): string | undefined {
  if (!hasOwn(value, key)) return undefined;
  return requiredString(value[key], `${path}.${key}`, maxLength);
}

function requiredStringOrNull(value: unknown, path: string, maxLength = MAX_STRING_LENGTH): string | null {
  if (value === null) return null;
  return requiredString(value, path, maxLength);
}

function requiredFiniteNumber(
  value: unknown,
  path: string,
  options: { readonly integer?: boolean; readonly min?: number; readonly max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_NUMERIC_MAGNITUDE) {
    throw new ValidationFault('INVALID_CAPSULE', 'Expected a finite bounded number', path);
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Expected a safe integer', path);
  }
  if (options.min !== undefined && value < options.min) {
    throw new ValidationFault('INVALID_CAPSULE', `Expected a number at least ${options.min}`, path);
  }
  if (options.max !== undefined && value > options.max) {
    throw new ValidationFault('INVALID_CAPSULE', `Expected a number at most ${options.max}`, path);
  }
  return value;
}

function optionalFiniteNumber(
  value: { readonly [key: string]: unknown },
  key: string,
  path: string,
  options: { readonly integer?: boolean; readonly min?: number; readonly max?: number } = {},
): number | undefined {
  if (!hasOwn(value, key)) return undefined;
  return requiredFiniteNumber(value[key], `${path}.${key}`, options);
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationFault('INVALID_CAPSULE', 'Expected a boolean', path);
  }
  return value;
}

function optionalBoolean(
  value: { readonly [key: string]: unknown },
  key: string,
  path: string,
): boolean | undefined {
  if (!hasOwn(value, key)) return undefined;
  return requiredBoolean(value[key], `${path}.${key}`);
}

function requiredArrayOfStrings(value: unknown, path: string, maxLength: number): readonly string[] {
  return array(value, path, maxLength).map((item, index) => requiredString(item, `${path}[${index}]`, MAX_SHORT_STRING_LENGTH));
}

function nearlyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= FLOAT_EPSILON * scale;
}

function ensureUnique(ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      throw new ValidationFault('INVALID_CAPSULE', `Duplicate id: ${id}`, `${path}[${index}]`);
    }
    seen.add(id);
  });
}

function parseBinding(value: unknown, path: string): DefDamageReportBinding {
  const record = object(value, path);
  allowedKeys(record, [
    'workspaceId',
    'databaseGeneration',
    'timelineId',
    'checkoutTargetId',
    'checkoutUpdatedAt',
    'contentRevision',
    'snapshotDigest',
  ], path);
  return {
    workspaceId: requiredString(record.workspaceId, `${path}.workspaceId`, MAX_SHORT_STRING_LENGTH),
    databaseGeneration: requiredString(record.databaseGeneration, `${path}.databaseGeneration`, MAX_SHORT_STRING_LENGTH),
    timelineId: requiredString(record.timelineId, `${path}.timelineId`, MAX_SHORT_STRING_LENGTH),
    checkoutTargetId: requiredStringOrNull(record.checkoutTargetId, `${path}.checkoutTargetId`, MAX_SHORT_STRING_LENGTH),
    checkoutUpdatedAt: requiredFiniteNumber(record.checkoutUpdatedAt, `${path}.checkoutUpdatedAt`, { integer: true, min: 0 }),
    contentRevision: requiredFiniteNumber(record.contentRevision, `${path}.contentRevision`, { integer: true, min: 0 }),
    snapshotDigest: requiredString(record.snapshotDigest, `${path}.snapshotDigest`, MAX_SHORT_STRING_LENGTH),
  };
}

function parseBuff(value: unknown, path: string): DefDamageReportBuff {
  const record = object(value, path);
  allowedKeys(record, [
    'id',
    'traceId',
    'name',
    'effect',
    'type',
    'zone',
    'rawValue',
    'runtimeCoefficient',
    'effectiveValue',
    'multiplierCoefficient',
    'multiplier',
  ], path);
  const parsed: DefDamageReportBuff = {
    id: requiredString(record.id, `${path}.id`, MAX_SHORT_STRING_LENGTH),
    traceId: requiredString(record.traceId, `${path}.traceId`),
    name: requiredString(record.name, `${path}.name`),
    effect: requiredString(record.effect, `${path}.effect`),
  };
  const type = optionalString(record, 'type', path, MAX_SHORT_STRING_LENGTH);
  const zone = optionalString(record, 'zone', path, MAX_SHORT_STRING_LENGTH);
  const rawValue = optionalFiniteNumber(record, 'rawValue', path);
  const runtimeCoefficient = optionalFiniteNumber(record, 'runtimeCoefficient', path);
  const effectiveValue = optionalFiniteNumber(record, 'effectiveValue', path);
  const multiplierCoefficient = optionalFiniteNumber(record, 'multiplierCoefficient', path);
  const multiplier = optionalBoolean(record, 'multiplier', path);
  return {
    ...parsed,
    ...(type === undefined ? {} : { type }),
    ...(zone === undefined ? {} : { zone }),
    ...(rawValue === undefined ? {} : { rawValue }),
    ...(runtimeCoefficient === undefined ? {} : { runtimeCoefficient }),
    ...(effectiveValue === undefined ? {} : { effectiveValue }),
    ...(multiplierCoefficient === undefined ? {} : { multiplierCoefficient }),
    ...(multiplier === undefined ? {} : { multiplier }),
  };
}

function parseZone(value: unknown, path: string): DefDamageReportZone {
  const record = object(value, path);
  allowedKeys(record, ['key', 'additiveTotal', 'multiplierProduct', 'finalValue'], path);
  return {
    key: requiredString(record.key, `${path}.key`, MAX_SHORT_STRING_LENGTH),
    additiveTotal: requiredFiniteNumber(record.additiveTotal, `${path}.additiveTotal`),
    multiplierProduct: requiredFiniteNumber(record.multiplierProduct, `${path}.multiplierProduct`),
    finalValue: requiredFiniteNumber(record.finalValue, `${path}.finalValue`),
  };
}

function parseResistance(value: unknown, path: string): DefDamageReportResistance {
  const record = object(value, path);
  allowedKeys(record, [
    'baseResistance',
    'corrosion',
    'resistanceIgnore',
    'effectiveResistance',
    'resistanceZone',
    'formulaText',
  ], path);
  const resistanceZone = requiredFiniteNumber(record.resistanceZone, `${path}.resistanceZone`);
  return {
    baseResistance: requiredFiniteNumber(record.baseResistance, `${path}.baseResistance`),
    corrosion: requiredFiniteNumber(record.corrosion, `${path}.corrosion`),
    resistanceIgnore: requiredFiniteNumber(record.resistanceIgnore, `${path}.resistanceIgnore`),
    effectiveResistance: requiredFiniteNumber(record.effectiveResistance, `${path}.effectiveResistance`),
    resistanceZone,
    formulaText: requiredString(record.formulaText, `${path}.formulaText`, MAX_SHORT_STRING_LENGTH),
  };
}

function parseHit(value: unknown, path: string): DefDamageReportHit {
  const record = object(value, path);
  allowedKeys(record, [
    'id',
    'title',
    'sourceKind',
    'damageSourceLabel',
    'skillTypeLabel',
    'elementLabel',
    'damage',
    'expected',
    'nonCrit',
    'resistanceZone',
    'resistance',
    'buffs',
    'zones',
  ], path);
  const sourceKind = record.sourceKind;
  if (sourceKind !== 'normal' && sourceKind !== 'anomaly' && sourceKind !== 'extraHit') {
    throw new ValidationFault('INVALID_CAPSULE', 'Unknown hit sourceKind', `${path}.sourceKind`);
  }
  const expected = requiredFiniteNumber(record.expected, `${path}.expected`);
  const damage = requiredFiniteNumber(record.damage, `${path}.damage`);
  if (!nearlyEqual(damage, expected)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Hit damage and expected subtotal disagree', path);
  }
  const resistance = parseResistance(record.resistance, `${path}.resistance`);
  const resistanceZone = requiredFiniteNumber(record.resistanceZone, `${path}.resistanceZone`);
  if (!nearlyEqual(resistanceZone, resistance.resistanceZone)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Hit resistanceZone disagrees with resistance.resistanceZone', path);
  }
  const buffValues = array(record.buffs, `${path}.buffs`, MAX_BUFFS_PER_HIT);
  const buffs = buffValues.map((buff, index) => parseBuff(buff, `${path}.buffs[${index}]`));
  ensureUnique(buffs.map((buff) => buff.id), `${path}.buffs`);
  const zones = hasOwn(record, 'zones')
    ? array(record.zones, `${path}.zones`, MAX_ZONES_PER_HIT).map((zone, index) => parseZone(zone, `${path}.zones[${index}]`))
    : undefined;
  return {
    id: requiredString(record.id, `${path}.id`, MAX_SHORT_STRING_LENGTH),
    title: requiredString(record.title, `${path}.title`),
    sourceKind,
    damageSourceLabel: requiredString(record.damageSourceLabel, `${path}.damageSourceLabel`, MAX_SHORT_STRING_LENGTH),
    skillTypeLabel: requiredString(record.skillTypeLabel, `${path}.skillTypeLabel`, MAX_SHORT_STRING_LENGTH),
    elementLabel: requiredString(record.elementLabel, `${path}.elementLabel`, MAX_SHORT_STRING_LENGTH),
    damage,
    expected,
    nonCrit: requiredFiniteNumber(record.nonCrit, `${path}.nonCrit`),
    resistanceZone,
    resistance,
    buffs,
    ...(zones === undefined ? {} : { zones }),
  };
}

function parseButton(value: unknown, path: string): DefDamageReportButton {
  const record = object(value, path);
  allowedKeys(record, [
    'id',
    'characterId',
    'groupLabel',
    'orderLabel',
    'characterName',
    'skillName',
    'skillType',
    'damage',
    'expected',
    'nonCrit',
    'share',
    'hits',
  ], path);
  const hits = array(record.hits, `${path}.hits`, MAX_HITS_PER_BUTTON).map((hit, index) => parseHit(hit, `${path}.hits[${index}]`));
  ensureUnique(hits.map((hit) => hit.id), `${path}.hits`);
  const expected = requiredFiniteNumber(record.expected, `${path}.expected`);
  const nonCrit = requiredFiniteNumber(record.nonCrit, `${path}.nonCrit`);
  const damage = requiredFiniteNumber(record.damage, `${path}.damage`);
  if (!nearlyEqual(damage, expected)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Button damage and expected subtotal disagree', path);
  }
  const hitExpected = hits.reduce((sum, hit) => sum + hit.expected, 0);
  const hitNonCrit = hits.reduce((sum, hit) => sum + hit.nonCrit, 0);
  if (!nearlyEqual(hitExpected, expected) || !nearlyEqual(hitNonCrit, nonCrit)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Button subtotal disagrees with its hit rows', path);
  }
  return {
    id: requiredString(record.id, `${path}.id`, MAX_SHORT_STRING_LENGTH),
    characterId: requiredString(record.characterId, `${path}.characterId`, MAX_SHORT_STRING_LENGTH),
    groupLabel: requiredString(record.groupLabel, `${path}.groupLabel`, MAX_SHORT_STRING_LENGTH),
    orderLabel: requiredString(record.orderLabel, `${path}.orderLabel`, MAX_SHORT_STRING_LENGTH),
    characterName: requiredString(record.characterName, `${path}.characterName`),
    skillName: requiredString(record.skillName, `${path}.skillName`),
    skillType: requiredString(record.skillType, `${path}.skillType`, MAX_SHORT_STRING_LENGTH),
    damage,
    expected,
    nonCrit,
    share: requiredFiniteNumber(record.share, `${path}.share`),
    hits,
  };
}

function parseCharacterSkill(value: unknown, path: string): DefDamageReportCharacterSkill {
  const record = object(value, path);
  allowedKeys(record, ['id', 'title', 'meta', 'hitLines'], path);
  return {
    id: requiredString(record.id, `${path}.id`, MAX_SHORT_STRING_LENGTH),
    title: requiredString(record.title, `${path}.title`),
    meta: requiredString(record.meta, `${path}.meta`),
    hitLines: requiredArrayOfStrings(record.hitLines, `${path}.hitLines`, MAX_LINES_PER_CHARACTER),
  };
}

function parseCharacter(value: unknown, path: string): DefDamageReportCharacter {
  const record = object(value, path);
  allowedKeys(record, [
    'characterId',
    'characterName',
    'weaponName',
    'weaponPotentialMode',
    'level',
    'skillLevels',
    'attributeLines',
    'equipmentLines',
    'skills',
  ], path);
  const level = record.level === null
    ? null
    : requiredFiniteNumber(record.level, `${path}.level`, { integer: true, min: 0, max: 200 });
  const skills = array(record.skills, `${path}.skills`, MAX_SKILLS_PER_CHARACTER)
    .map((skill, index) => parseCharacterSkill(skill, `${path}.skills[${index}]`));
  ensureUnique(skills.map((skill) => skill.id), `${path}.skills`);
  return {
    characterId: requiredString(record.characterId, `${path}.characterId`, MAX_SHORT_STRING_LENGTH),
    characterName: requiredString(record.characterName, `${path}.characterName`),
    weaponName: requiredString(record.weaponName, `${path}.weaponName`),
    weaponPotentialMode: requiredString(record.weaponPotentialMode, `${path}.weaponPotentialMode`, MAX_SHORT_STRING_LENGTH),
    level,
    skillLevels: requiredArrayOfStrings(record.skillLevels, `${path}.skillLevels`, MAX_LINES_PER_CHARACTER),
    attributeLines: requiredArrayOfStrings(record.attributeLines, `${path}.attributeLines`, MAX_LINES_PER_CHARACTER),
    equipmentLines: requiredArrayOfStrings(record.equipmentLines, `${path}.equipmentLines`, MAX_LINES_PER_CHARACTER),
    skills,
  };
}

function parseReport(value: unknown, path: string): DefDamageReportSnapshot {
  const record = object(value, path);
  allowedKeys(record, [
    'generatedAt',
    'totalDamage',
    'totalExpected',
    'totalNonCrit',
    'buttonCount',
    'buttons',
    'characters',
  ], path);
  const buttons = array(record.buttons, `${path}.buttons`, MAX_BUTTONS)
    .map((button, index) => parseButton(button, `${path}.buttons[${index}]`));
  const characters = array(record.characters, `${path}.characters`, MAX_CHARACTERS)
    .map((character, index) => parseCharacter(character, `${path}.characters[${index}]`));
  ensureUnique(buttons.map((button) => button.id), `${path}.buttons`);
  ensureUnique(characters.map((character) => character.characterId), `${path}.characters`);

  const buttonCount = requiredFiniteNumber(record.buttonCount, `${path}.buttonCount`, { integer: true, min: 0, max: MAX_BUTTONS });
  if (buttonCount !== buttons.length) {
    throw new ValidationFault('INVALID_CAPSULE', 'buttonCount does not match buttons.length', `${path}.buttonCount`);
  }
  const totalExpected = requiredFiniteNumber(record.totalExpected, `${path}.totalExpected`);
  const totalNonCrit = requiredFiniteNumber(record.totalNonCrit, `${path}.totalNonCrit`);
  const totalDamage = requiredFiniteNumber(record.totalDamage, `${path}.totalDamage`);
  if (!nearlyEqual(totalDamage, totalExpected)) {
    throw new ValidationFault('INVALID_CAPSULE', 'totalDamage and totalExpected disagree', path);
  }
  const buttonExpected = buttons.reduce((sum, button) => sum + button.expected, 0);
  const buttonNonCrit = buttons.reduce((sum, button) => sum + button.nonCrit, 0);
  if (!nearlyEqual(buttonExpected, totalExpected) || !nearlyEqual(buttonNonCrit, totalNonCrit)) {
    throw new ValidationFault('INVALID_CAPSULE', 'Report totals disagree with button subtotals', path);
  }
  const expectedCharacterIds = new Set(buttons.map((button) => button.characterId));
  const actualCharacterIds = new Set(characters.map((character) => character.characterId));
  if (expectedCharacterIds.size !== actualCharacterIds.size || [...expectedCharacterIds].some((id) => !actualCharacterIds.has(id))) {
    throw new ValidationFault('INVALID_CAPSULE', 'Character rows do not match button character IDs', `${path}.characters`);
  }
  buttons.forEach((button, index) => {
    const expectedShare = totalExpected === 0 ? 0 : button.expected / totalExpected;
    if (!nearlyEqual(button.share, expectedShare)) {
      throw new ValidationFault('INVALID_CAPSULE', 'Button share disagrees with report total', `${path}.buttons[${index}].share`);
    }
  });
  return {
    generatedAt: requiredFiniteNumber(record.generatedAt, `${path}.generatedAt`, { integer: true, min: 1 }),
    totalDamage,
    totalExpected,
    totalNonCrit,
    buttonCount,
    buttons,
    characters,
  };
}

function parseCapsule(value: unknown): DefDamageReportCapsule {
  const record = object(value, 'capsule');
  allowedKeys(record, ['contract', 'binding', 'formulaVersion', 'statisticalScope', 'schemeDigest', 'report'], 'capsule');
  if (record.contract !== DEF_DAMAGE_REPORT_CAPSULE_CONTRACT) {
    throw new ValidationFault('INVALID_CAPSULE', `contract must be ${DEF_DAMAGE_REPORT_CAPSULE_CONTRACT}`, 'capsule.contract');
  }
  const binding = hasOwn(record, 'binding') ? parseBinding(record.binding, 'capsule.binding') : undefined;
  const formulaVersion = requiredString(record.formulaVersion, 'capsule.formulaVersion', MAX_SHORT_STRING_LENGTH);
  const statisticalScope = requiredString(record.statisticalScope, 'capsule.statisticalScope', MAX_SHORT_STRING_LENGTH);
  const schemeDigest = requiredString(record.schemeDigest, 'capsule.schemeDigest', MAX_SHORT_STRING_LENGTH);
  const report = parseReport(record.report, 'capsule.report');
  return {
    contract: DEF_DAMAGE_REPORT_CAPSULE_CONTRACT,
    ...(binding === undefined ? {} : { binding }),
    formulaVersion,
    statisticalScope,
    schemeDigest,
    report,
  };
}

function parseCapsuleResult(input: unknown): DamageReportOperationResult<DefDamageReportCapsule> {
  try {
    return success(parseCapsule(input));
  } catch (error) {
    if (error instanceof ValidationFault) {
      return failure(error.code, error.message, error.path);
    }
    return failure('INVALID_CAPSULE', 'Capsule could not be validated');
  }
}

/** Strictly validate and normalize the product-generated report envelope. */
export function validateDamageReportCapsule(input: unknown): DamageReportOperationResult<DefDamageReportCapsule> {
  return parseCapsuleResult(input);
}

/** Alias matching the calculation Harness operation name. It only reads. */
export function currentDamageReport(input: unknown): DamageReportOperationResult<DefDamageReportCapsule> {
  return parseCapsuleResult(input);
}

/** The old calculate operation is a typed product-report read, never a formula reimplementation. */
export function calculateDamageReport(input: unknown): DamageReportOperationResult<DefDamageReportCapsule> {
  return currentDamageReport(input);
}

export function currentDamageReportProjection(input: unknown): DamageReportOperationResult<DefDamageCurrentProjection> {
  const capsule = parseCapsuleResult(input);
  if (!capsule.ok) return capsule;
  const report = capsule.value.report;
  return success({
    contract: DEF_DAMAGE_REPORT_CURRENT_CONTRACT,
    formulaVersion: capsule.value.formulaVersion,
    statisticalScope: capsule.value.statisticalScope,
    schemeDigest: capsule.value.schemeDigest,
    generatedAt: report.generatedAt,
    buttonScope: report.buttons.map((button) => button.id),
    buttonCount: report.buttonCount,
    totalDamage: report.totalDamage,
    totalExpected: report.totalExpected,
    totalNonCrit: report.totalNonCrit,
  });
}

function aggregateFromCapsule(capsule: DefDamageReportCapsule): DefDamageAggregateProjection {
  const characterNames = new Map(capsule.report.characters.map((character) => [character.characterId, character.characterName]));
  const characterTotals = new Map<string, { readonly characterName: string; readonly buttonIds: string[]; expected: number; nonCrit: number }>();
  const buttons = capsule.report.buttons.map((button) => {
    const current = characterTotals.get(button.characterId) ?? {
      characterName: characterNames.get(button.characterId) ?? button.characterName,
      buttonIds: [],
      expected: 0,
      nonCrit: 0,
    };
    current.buttonIds.push(button.id);
    current.expected += button.expected;
    current.nonCrit += button.nonCrit;
    characterTotals.set(button.characterId, current);
    return {
      id: button.id,
      characterId: button.characterId,
      characterName: button.characterName,
      skillName: button.skillName,
      expected: button.expected,
      nonCrit: button.nonCrit,
    };
  });
  const characters = [...characterTotals.entries()].map(([characterId, value]) => ({
    characterId,
    characterName: value.characterName,
    buttonIds: [...value.buttonIds],
    expected: value.expected,
    nonCrit: value.nonCrit,
  }));
  return {
    contract: DEF_DAMAGE_REPORT_AGGREGATE_CONTRACT,
    formulaVersion: capsule.formulaVersion,
    statisticalScope: capsule.statisticalScope,
    schemeDigest: capsule.schemeDigest,
    generatedAt: capsule.report.generatedAt,
    buttonScope: buttons.map((button) => button.id),
    total: {
      damage: capsule.report.totalDamage,
      expected: capsule.report.totalExpected,
      nonCrit: capsule.report.totalNonCrit,
    },
    buttons,
    characters,
  };
}

export function aggregateDamageReport(input: unknown): DamageReportOperationResult<DefDamageAggregateProjection> {
  const capsule = parseCapsuleResult(input);
  return capsule.ok ? success(aggregateFromCapsule(capsule.value)) : capsule;
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = sortedIds(left);
  const rightSorted = sortedIds(right);
  return leftSorted.length === rightSorted.length && leftSorted.every((id, index) => id === rightSorted[index]);
}

function delta(current: number, baseline: number): DefDamageDelta {
  return { current, baseline, delta: current - baseline };
}

function compareFromCapsules(
  current: DefDamageReportCapsule,
  baseline: DefDamageReportCapsule,
): DamageReportOperationResult<DefDamageCompareProjection> {
  if (current.formulaVersion !== baseline.formulaVersion) {
    return failure(
      'INCOMPATIBLE_FORMULA_VERSION',
      'Reports use different product formula versions',
      'formulaVersion',
      { current: current.formulaVersion, baseline: baseline.formulaVersion },
    );
  }
  if (current.statisticalScope !== baseline.statisticalScope) {
    return failure(
      'INCOMPATIBLE_STATISTICAL_SCOPE',
      'Reports use different statistical scopes',
      'statisticalScope',
      { current: current.statisticalScope, baseline: baseline.statisticalScope },
    );
  }
  const currentButtons = current.report.buttons;
  const baselineButtons = baseline.report.buttons;
  const currentIds = currentButtons.map((button) => button.id);
  const baselineIds = baselineButtons.map((button) => button.id);
  if (!sameIdSet(currentIds, baselineIds)) {
    return failure(
      'INCOMPATIBLE_BUTTON_SCOPE',
      'Reports do not cover the same button scope',
      'buttonScope',
      { current: currentIds, baseline: baselineIds },
    );
  }
  const baselineByButtonId = new Map(baselineButtons.map((button) => [button.id, button]));
  for (const button of currentButtons) {
    const baselineButton = baselineByButtonId.get(button.id);
    if (!baselineButton || baselineButton.characterId !== button.characterId) {
      return failure(
        'INCOMPATIBLE_BUTTON_SCOPE',
        `Button ${button.id} is bound to a different character`,
        `buttonScope.${button.id}`,
      );
    }
  }
  const currentAggregate = aggregateFromCapsule(current);
  const baselineAggregate = aggregateFromCapsule(baseline);
  const baselineByCharacterId = new Map(baselineAggregate.characters.map((character) => [character.characterId, character]));
  const buttons = currentAggregate.buttons.map((button) => {
    const baselineButton = baselineButtons.find((candidate) => candidate.id === button.id);
    if (!baselineButton) {
      return null;
    }
    return {
      id: button.id,
      characterId: button.characterId,
      characterName: button.characterName,
      expected: delta(button.expected, baselineButton.expected),
      nonCrit: delta(button.nonCrit, baselineButton.nonCrit),
    };
  }).filter((button): button is DefDamageCompareRow => button !== null);
  const characters = currentAggregate.characters.map((character) => {
    const baselineCharacter = baselineByCharacterId.get(character.characterId);
    if (!baselineCharacter) return null;
    return {
      characterId: character.characterId,
      characterName: character.characterName,
      expected: delta(character.expected, baselineCharacter.expected),
      nonCrit: delta(character.nonCrit, baselineCharacter.nonCrit),
    };
  }).filter((character): character is DefDamageCharacterCompareRow => character !== null);
  return success({
    contract: DEF_DAMAGE_REPORT_COMPARE_CONTRACT,
    formulaVersion: current.formulaVersion,
    statisticalScope: current.statisticalScope,
    buttonScope: currentIds,
    current: {
      schemeDigest: current.schemeDigest,
      generatedAt: current.report.generatedAt,
    },
    baseline: {
      schemeDigest: baseline.schemeDigest,
      generatedAt: baseline.report.generatedAt,
    },
    total: {
      expected: delta(current.report.totalExpected, baseline.report.totalExpected),
      nonCrit: delta(current.report.totalNonCrit, baseline.report.totalNonCrit),
    },
    buttons,
    characters,
  });
}

export function compareDamageReports(
  currentInput: unknown,
  baselineInput: unknown,
): DamageReportOperationResult<DefDamageCompareProjection> {
  const current = parseCapsuleResult(currentInput);
  if (!current.ok) return current;
  const baseline = parseCapsuleResult(baselineInput);
  if (!baseline.ok) return baseline;
  return compareFromCapsules(current.value, baseline.value);
}

function parseAttributeOptions(input: unknown): DamageReportOperationResult<DefDamageAttributeOptions> {
  if (input === undefined) return success({});
  if (!isPlainObject(input)) return failure('INVALID_OPTIONS', 'Attribute options must be a JSON object');
  allowedKeys(input, ['buttonId', 'hitId'], 'attributeOptions');
  const buttonId = hasOwn(input, 'buttonId')
    ? requiredOptionString(input.buttonId, 'attributeOptions.buttonId')
    : undefined;
  const hitId = hasOwn(input, 'hitId')
    ? requiredOptionString(input.hitId, 'attributeOptions.hitId')
    : undefined;
  return success({
    ...(buttonId === undefined ? {} : { buttonId }),
    ...(hitId === undefined ? {} : { hitId }),
  });
}

function requiredOptionString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SHORT_STRING_LENGTH) {
    throw new ValidationFault('INVALID_CAPSULE', `Expected a bounded non-empty string`, path);
  }
  return value;
}

function projectHitFact(button: DefDamageReportButton, hit: DefDamageReportHit): DefDamageHitFact {
  const fact: DefDamageHitFact = {
    buttonId: button.id,
    characterId: button.characterId,
    characterName: button.characterName,
    skillName: button.skillName,
    hitId: hit.id,
    title: hit.title,
    sourceKind: hit.sourceKind,
    damageSourceLabel: hit.damageSourceLabel,
    skillTypeLabel: hit.skillTypeLabel,
    elementLabel: hit.elementLabel,
    damage: hit.damage,
    expected: hit.expected,
    nonCrit: hit.nonCrit,
    resistanceZone: hit.resistanceZone,
    resistance: { ...hit.resistance },
    buffs: hit.buffs.map((buff) => ({ ...buff })),
  };
  return hit.zones === undefined ? fact : { ...fact, zones: hit.zones.map((zone) => ({ ...zone })) };
}

function selectHitFacts(
  capsule: DefDamageReportCapsule,
  options: DefDamageAttributeOptions,
): DamageReportOperationResult<readonly DefDamageHitFact[]> {
  const selected: DefDamageHitFact[] = [];
  for (const button of capsule.report.buttons) {
    if (options.buttonId !== undefined && button.id !== options.buttonId) continue;
    for (const hit of button.hits) {
      if (options.hitId !== undefined && hit.id !== options.hitId) continue;
      selected.push(projectHitFact(button, hit));
    }
  }
  if (options.buttonId !== undefined && !capsule.report.buttons.some((button) => button.id === options.buttonId)) {
    return failure('TARGET_NOT_FOUND', `Button ${options.buttonId} was not found`, 'attributeOptions.buttonId');
  }
  if (options.hitId !== undefined && selected.length === 0) {
    return failure('TARGET_NOT_FOUND', `Hit ${options.hitId} was not found`, 'attributeOptions.hitId');
  }
  if (options.hitId !== undefined && selected.length > 1) {
    return failure('TARGET_NOT_FOUND', `Hit ${options.hitId} is ambiguous; provide buttonId`, 'attributeOptions.hitId');
  }
  return success(selected);
}

export function attributeDamageReport(
  input: unknown,
  options?: unknown,
): DamageReportOperationResult<DefDamageAttributeProjection> {
  const capsule = parseCapsuleResult(input);
  if (!capsule.ok) return capsule;
  try {
    const parsedOptions = parseAttributeOptions(options);
    if (!parsedOptions.ok) return parsedOptions;
    const facts = selectHitFacts(capsule.value, parsedOptions.value);
    if (!facts.ok) return facts;
    return success({
      contract: DEF_DAMAGE_REPORT_ATTRIBUTE_CONTRACT,
      formulaVersion: capsule.value.formulaVersion,
      statisticalScope: capsule.value.statisticalScope,
      schemeDigest: capsule.value.schemeDigest,
      facts: facts.value,
    });
  } catch (error) {
    if (error instanceof ValidationFault) return failure('INVALID_OPTIONS', error.message, error.path);
    return failure('INVALID_OPTIONS', 'Attribute options could not be parsed');
  }
}

export function explainDamageReport(
  input: unknown,
  options?: unknown,
): DamageReportOperationResult<DefDamageExplanationProjection> {
  const attribute = attributeDamageReport(input, options);
  if (!attribute.ok) return attribute;
  return success({
    contract: DEF_DAMAGE_REPORT_EXPLANATION_CONTRACT,
    formulaVersion: attribute.value.formulaVersion,
    statisticalScope: attribute.value.statisticalScope,
    schemeDigest: attribute.value.schemeDigest,
    facts: attribute.value.facts,
  });
}

function parseExportOptions(input: unknown): DamageReportOperationResult<Required<DefDamageExportOptions>> {
  if (input === undefined) {
    return success({ format: 'table', maxRows: 64, includeCharacters: true });
  }
  if (!isPlainObject(input)) return failure('INVALID_OPTIONS', 'Export options must be a JSON object');
  try {
    allowedKeys(input, ['format', 'maxRows', 'includeCharacters'], 'exportOptions');
    const format = input.format === undefined ? 'table' : input.format;
    if (format !== 'table' && format !== 'json') {
      return failure('INVALID_OPTIONS', 'Export format must be table or json', 'exportOptions.format');
    }
    const maxRows = input.maxRows === undefined
      ? 64
      : requiredFiniteNumber(input.maxRows, 'exportOptions.maxRows', { integer: true, min: 1, max: MAX_EXPORT_ROWS });
    const includeCharacters = input.includeCharacters === undefined ? true : requiredBoolean(input.includeCharacters, 'exportOptions.includeCharacters');
    return success({ format, maxRows, includeCharacters });
  } catch (error) {
    if (error instanceof ValidationFault) return failure('INVALID_OPTIONS', error.message, error.path);
    return failure('INVALID_OPTIONS', 'Export options could not be parsed');
  }
}

function exportRows(
  capsule: DefDamageReportCapsule,
  options: Required<DefDamageExportOptions>,
): { readonly rows: readonly DefDamageExportTableRow[]; readonly truncated: boolean } {
  const allRows: DefDamageExportTableRow[] = [{
    kind: 'total',
    id: 'total',
    label: 'total',
    characterId: null,
    expected: capsule.report.totalExpected,
    nonCrit: capsule.report.totalNonCrit,
  }];
  allRows.push(...capsule.report.buttons.map((button) => ({
    kind: 'button' as const,
    id: button.id,
    label: button.skillName,
    characterId: button.characterId,
    expected: button.expected,
    nonCrit: button.nonCrit,
  })));
  if (options.includeCharacters) {
    const aggregate = aggregateFromCapsule(capsule);
    allRows.push(...aggregate.characters.map((character) => ({
      kind: 'character' as const,
      id: character.characterId,
      label: character.characterName,
      characterId: character.characterId,
      expected: character.expected,
      nonCrit: character.nonCrit,
    })));
  }
  return {
    rows: allRows.slice(0, options.maxRows),
    truncated: allRows.length > options.maxRows,
  };
}

export function exportDamageReport(
  input: unknown,
  options?: unknown,
): DamageReportOperationResult<DefDamageExportProjection> {
  const capsule = parseCapsuleResult(input);
  if (!capsule.ok) return capsule;
  const parsedOptions = parseExportOptions(options);
  if (!parsedOptions.ok) return parsedOptions;
  const exported = exportRows(capsule.value, parsedOptions.value);
  if (parsedOptions.value.format === 'table') {
    return success({
      contract: DEF_DAMAGE_REPORT_EXPORT_CONTRACT,
      format: 'table',
      formulaVersion: capsule.value.formulaVersion,
      statisticalScope: capsule.value.statisticalScope,
      schemeDigest: capsule.value.schemeDigest,
      generatedAt: capsule.value.report.generatedAt,
      headers: ['kind', 'id', 'label', 'characterId', 'expected', 'nonCrit'],
      rows: exported.rows.map((row) => [
        row.kind,
        row.id,
        row.label,
        row.characterId,
        row.expected,
        row.nonCrit,
      ]),
      rowCount: exported.rows.length,
      truncated: exported.truncated,
    });
  }
  const jsonPayload = {
    contract: DEF_DAMAGE_REPORT_EXPORT_CONTRACT,
    format: 'json' as const,
    formulaVersion: capsule.value.formulaVersion,
    statisticalScope: capsule.value.statisticalScope,
    schemeDigest: capsule.value.schemeDigest,
    generatedAt: capsule.value.report.generatedAt,
    rows: exported.rows,
    rowCount: exported.rows.length,
    truncated: exported.truncated,
  };
  return success({ ...jsonPayload, json: JSON.stringify(jsonPayload) });
}

type DiagnosticSource = {
  readonly status?: string;
  readonly code?: string;
  readonly message?: string;
};

function normalizedToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function diagnosticStatus(value: string): DefDamageDiagnosticStatus {
  const token = normalizedToken(value);
  if (['ready', 'ok', 'valid', 'completed'].includes(token)) return 'ready';
  if (['missing', 'unavailable', 'not-ready', 'absent', 'no-report', 'report-unavailable', 'def-damage-report-unavailable'].includes(token)) return 'missing';
  if (['stale', 'outdated', 'expired', 'dirty', 'scheme-changed', 'def-damage-report-stale'].includes(token)) return 'stale';
  if (['malformed', 'invalid', 'invalid-capsule', 'def-tool-product-snapshot-invalid', 'def-tool-input-invalid'].includes(token)) return 'malformed';
  if (['formula-error', 'calculation-error', 'calculator-error', 'def-damage-report-formula-error'].includes(token)) return 'formula-error';
  return 'unknown';
}

function diagnosticCode(status: DefDamageDiagnosticStatus): string {
  switch (status) {
    case 'ready': return 'DAMAGE_REPORT_READY';
    case 'missing': return 'DAMAGE_REPORT_MISSING';
    case 'stale': return 'DAMAGE_REPORT_STALE';
    case 'malformed': return 'DAMAGE_REPORT_MALFORMED';
    case 'formula-error': return 'DAMAGE_REPORT_FORMULA_ERROR';
    default: return 'DAMAGE_REPORT_UNKNOWN';
  }
}

function diagnosticDefaultMessage(status: DefDamageDiagnosticStatus): string {
  switch (status) {
    case 'ready': return 'A validated product damage report is available.';
    case 'missing': return 'No product-generated damage report is available.';
    case 'stale': return 'The product damage report is stale for the current scheme.';
    case 'malformed': return 'The supplied damage report is malformed.';
    case 'formula-error': return 'The product reported a formula or calculation error.';
    default: return 'The damage report status is not recognized.';
  }
}

function diagnosticSource(input: unknown): DamageReportOperationResult<DiagnosticSource | null> {
  if (input === null || input === undefined) return success(null);
  if (typeof input === 'string') {
    if (input.length === 0 || input.length > MAX_SHORT_STRING_LENGTH) return failure('INVALID_OPTIONS', 'Diagnostic status string is out of bounds');
    return success({ status: input });
  }
  if (!isPlainObject(input)) return success({ status: 'malformed' });
  if (Object.keys(input).length > 16) return failure('INVALID_OPTIONS', 'Diagnostic input has too many fields');
  const status = hasOwn(input, 'status')
    ? requiredOptionString(input.status, 'diagnostic.status')
    : undefined;
  const errorValue = input.error;
  let code: string | undefined;
  let message: string | undefined;
  if (typeof errorValue === 'string') {
    if (errorValue.length > MAX_SHORT_STRING_LENGTH) return failure('INVALID_OPTIONS', 'Diagnostic error is out of bounds');
    code = errorValue;
  } else if (isPlainObject(errorValue)) {
    if (Object.keys(errorValue).length > 4) return failure('INVALID_OPTIONS', 'Diagnostic error has too many fields');
    if (hasOwn(errorValue, 'code')) code = requiredOptionString(errorValue.code, 'diagnostic.error.code');
    if (hasOwn(errorValue, 'message')) message = requiredOptionString(errorValue.message, 'diagnostic.error.message');
  }
  if (hasOwn(input, 'code')) code = requiredOptionString(input.code, 'diagnostic.code');
  if (hasOwn(input, 'message')) message = requiredOptionString(input.message, 'diagnostic.message');
  if (hasOwn(input, 'stale') && input.stale === true) return success({ status: 'stale', code, message });
  if (hasOwn(input, 'missing') && input.missing === true) return success({ status: 'missing', code, message });
  return success({
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
  });
}

export function diagnoseDamageReport(input: unknown): DamageReportOperationResult<DefDamageDiagnosticProjection> {
  const source = diagnosticSource(input);
  if (!source.ok) return source;
  if (source.value === null) {
    return success({
      contract: DEF_DAMAGE_REPORT_DIAGNOSTIC_CONTRACT,
      status: 'missing',
      code: diagnosticCode('missing'),
      message: diagnosticDefaultMessage('missing'),
    });
  }
  const explicitToken = source.value.status ?? source.value.code;
  if (explicitToken !== undefined) {
    const status = diagnosticStatus(explicitToken);
    if (status !== 'unknown') {
      return success({
        contract: DEF_DAMAGE_REPORT_DIAGNOSTIC_CONTRACT,
        status,
        code: diagnosticCode(status),
        message: source.value.message ?? diagnosticDefaultMessage(status),
      });
    }
  }
  if (isPlainObject(input) && 'contract' in input) {
    const validated = parseCapsuleResult(input);
    if (validated.ok) {
      return success({
        contract: DEF_DAMAGE_REPORT_DIAGNOSTIC_CONTRACT,
        status: 'ready',
        code: diagnosticCode('ready'),
        message: diagnosticDefaultMessage('ready'),
      });
    }
    return success({
      contract: DEF_DAMAGE_REPORT_DIAGNOSTIC_CONTRACT,
      status: 'malformed',
      code: diagnosticCode('malformed'),
      message: validated.error.message,
    });
  }
  return success({
    contract: DEF_DAMAGE_REPORT_DIAGNOSTIC_CONTRACT,
    status: 'unknown',
    code: diagnosticCode('unknown'),
    message: source.value.message ?? diagnosticDefaultMessage('unknown'),
  });
}
