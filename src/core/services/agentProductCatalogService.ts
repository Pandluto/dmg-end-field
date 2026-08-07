import { normalizeEquipmentLibrary, type EquipmentLibrary as BrowserEquipmentLibrary, type EquipmentPart as BrowserEquipmentPart } from '../../components/equipmentSheetModel';
import { normalizeWeaponDraft, type RawWeaponDraft, type WeaponDraft } from '../../components/weaponDraftModel';
import { persistentLocalStorage } from '../../platform/storage/persistentStorage';
import { buildRuntimeTemplatesFromDraftMap, normalizeOperatorDraft } from './operatorTemplateAdapter';
import type {
  OperatorDraft,
  RuntimeOperatorTemplate,
  RuntimeOperatorTemplateHit,
  RuntimeOperatorTemplateSkill,
} from '../templates/operatorTemplate';

/**
 * Browser facts are deliberately sourced from the current local SQLite mirror.
 * This service does not read legacy guide files, Node SQLite, REST sidecars, or
 * image payloads.  A future Canvas command can call the pure builders here
 * without taking ownership of browser storage or UI state.
 */
export const AGENT_PRODUCT_CATALOG_SOURCE = 'browser-sqlite-mirror' as const;
export type AgentProductCatalogSource = typeof AGENT_PRODUCT_CATALOG_SOURCE;

export const AGENT_PRODUCT_CATALOG_STORAGE_KEYS = Object.freeze({
  operatorLibrary: 'def.operator-editor.library.v1',
  weaponLibrary: 'def.weapon-sheet.library.v1',
  weaponDraft: 'def.weapon-sheet.draft.v1',
  equipmentLibrary: 'def.equipment-sheet.library.v1',
  equipmentDraft: 'def.equipment-sheet.draft.v1',
} as const);

export const DEFAULT_AGENT_PRODUCT_CATALOG_LIMIT = 64;
export const MAX_AGENT_PRODUCT_CATALOG_LIMIT = 256;
export const MAX_AGENT_PRODUCT_CATALOG_TEXT = 160;

export type AgentCatalogDomain = 'operators' | 'skills' | 'weapons' | 'equipment' | 'gearSets';

export interface AgentProductCatalogStorage {
  getItem(key: string): string | null;
}

export interface AgentProductCatalogInput {
  /** A draft map, a draft array, or already-built runtime templates. */
  operators?: unknown;
  /** A weapon draft map or draft array. */
  weapons?: unknown;
  /** The canonical equipment library or its raw persisted form. */
  equipment?: unknown;
}

export interface AgentProductCatalogReadOptions {
  storage?: AgentProductCatalogStorage;
  query?: string;
  limit?: number;
}

export interface AgentProductCatalogBuildOptions {
  query?: string;
  limit?: number;
}

export interface AgentCatalogQueryOptions {
  domain: AgentCatalogDomain;
  query?: string;
  limit?: number;
}

export type AgentCatalogMatchMode = 'all' | 'exact' | 'normalized' | 'ambiguous' | 'none';

export interface AgentCatalogEnvelope<T> {
  query: string;
  normalizedQuery: string;
  matchMode: AgentCatalogMatchMode;
  ambiguous: boolean;
  /** Total records in the source domain before query filtering. */
  catalogCount: number;
  /** Records matching the query before the response bound is applied. */
  queryCount: number;
  resultCount: number;
  exhaustive: boolean;
  truncated: boolean;
  source: AgentProductCatalogSource;
  results: readonly T[];
}

export interface AgentOperatorCatalogItem {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  weaponType: string;
  element: string;
  mainStat: string;
  subStat: string;
  level: number;
  skillIds: readonly string[];
}

export interface AgentSkillHitCatalogItem {
  key: string;
  name: string;
  multiplier: number;
  element: string;
  skillType: string;
}

export interface AgentSkillCatalogItem {
  id: string;
  operatorId: string;
  operatorName: string;
  skillId: string;
  name: string;
  buttonType: string;
  hitCount: number;
  hits: readonly AgentSkillHitCatalogItem[];
  hitsTruncated: boolean;
}

export interface AgentWeaponEffectCatalogItem {
  id: string;
  name: string;
  typeKey: string;
  category: string;
  unit: string;
  levels: Readonly<Record<string, number>>;
  valueMode?: string;
  effectKind?: string;
}

export interface AgentWeaponSkillCatalogItem {
  id: string;
  name: string;
  statType: string;
  effectCount: number;
  effects: readonly AgentWeaponEffectCatalogItem[];
  effectsTruncated: boolean;
}

export interface AgentWeaponCatalogItem {
  id: string;
  name: string;
  rarity: number;
  type: string;
  attackGrowth: Readonly<Record<string, number>>;
  skills: readonly AgentWeaponSkillCatalogItem[];
}

export interface AgentEquipmentEffectCatalogItem {
  id: string;
  name: string;
  typeKey: string;
  category: string;
  unit: string;
  levels: Readonly<Record<string, number>>;
}

export interface AgentEquipmentFixedStatCatalogItem {
  label: string;
  typeKey: string;
  value: number;
  unit: string;
}

export interface AgentEquipmentCatalogItem {
  id: string;
  name: string;
  gearSetId: string;
  gearSetName: string;
  part: BrowserEquipmentPart;
  fixedStat?: AgentEquipmentFixedStatCatalogItem;
  effects: readonly AgentEquipmentEffectCatalogItem[];
}

export interface AgentGearSetBuffCatalogItem {
  id: string;
  name: string;
  typeKey: string;
  category: string;
  value: number;
  unit: string;
  effectKind?: string;
  valueMode?: string;
  maxStacks?: number;
}

export interface AgentGearSetCatalogItem {
  id: string;
  name: string;
  equipmentIds: readonly string[];
  equipmentCount: number;
  partCounts: Readonly<Record<BrowserEquipmentPart, number>>;
  threePieceBuffs: readonly AgentGearSetBuffCatalogItem[];
}

export interface AgentProductCatalog {
  source: AgentProductCatalogSource;
  query: string;
  normalizedQuery: string;
  catalogCount: number;
  queryCount: number;
  exhaustive: boolean;
  truncated: boolean;
  operators: AgentCatalogEnvelope<AgentOperatorCatalogItem>;
  skills: AgentCatalogEnvelope<AgentSkillCatalogItem>;
  weapons: AgentCatalogEnvelope<AgentWeaponCatalogItem>;
  equipment: AgentCatalogEnvelope<AgentEquipmentCatalogItem>;
  gearSets: AgentCatalogEnvelope<AgentGearSetCatalogItem>;
}

export interface AgentOperatorResolution {
  query: string;
  normalizedQuery: string;
  matchMode: AgentCatalogMatchMode;
  ambiguous: boolean;
  candidates: readonly AgentOperatorCatalogItem[];
  operator: AgentOperatorCatalogItem | null;
}

export interface AgentEvidenceUnavailable {
  status: 'evidenceUnavailable';
  source: 'no-verified-1.8-build-guide-in-browser-facts';
  reason: string;
  legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact';
}

export interface AgentWeaponCompatibilityResult {
  source: AgentProductCatalogSource;
  operator: AgentOperatorResolution;
  compatibility: 'deterministic-weapon-type-match' | 'weapon-type-unavailable' | 'operator-unresolved';
  compatibleWeapons: AgentCatalogEnvelope<AgentWeaponCatalogItem>;
  recommendation: AgentEvidenceUnavailable;
}

export type AgentGearSlotKey = 'armor' | 'glove' | 'accessory1' | 'accessory2';

export const AGENT_GEAR_SLOT_ORDER: readonly AgentGearSlotKey[] = [
  'armor',
  'glove',
  'accessory1',
  'accessory2',
] as const;

export interface AgentGearPieceRef {
  slotKey: AgentGearSlotKey;
  equipmentId: string;
  equipmentName: string;
  gearSetId: string;
  gearSetName: string;
  part: BrowserEquipmentPart;
}

export interface AgentGearTopologyCombination {
  id: string;
  name: string;
  targetSetId: string;
  targetSetName: string;
  targetSetPieces: number;
  offSetPieces: number;
  offSetSlot: AgentGearSlotKey;
  pieces: Readonly<Record<AgentGearSlotKey, AgentGearPieceRef>>;
}

export type AgentGearTopologyState =
  | 'READY'
  | 'SET_QUERY_REQUIRED'
  | 'SET_NOT_FOUND'
  | 'SET_QUERY_AMBIGUOUS'
  | 'NO_VALID_3_PLUS_1';

export interface AgentGearTopologyFacts {
  source: AgentProductCatalogSource;
  state: AgentGearTopologyState;
  requestedSetQuery: string;
  normalizedSetQuery: string;
  targetSet: { id: string; name: string } | null;
  minimumTargetSetPieces: 3;
  slots: readonly AgentGearSlotKey[];
  targetSetEquipmentCount: number;
  targetSetPartCounts: Readonly<Record<BrowserEquipmentPart, number>>;
  targetSetCandidatesBySlot: Readonly<Record<AgentGearSlotKey, number>>;
  offSetCandidatesBySlot: Readonly<Record<AgentGearSlotKey, number>>;
  constructibleCombinationCount: number;
  hasValidThreePlusOne: boolean;
  combinationsExhaustive: boolean;
  recommendation: AgentEvidenceUnavailable;
}

export interface AgentGearTopologyPlan {
  source: AgentProductCatalogSource;
  state: AgentGearTopologyState;
  facts: AgentGearTopologyFacts;
  combinations: AgentCatalogEnvelope<AgentGearTopologyCombination>;
  ranking: 'unranked-facts-only';
  recommendation: AgentEvidenceUnavailable;
}

export interface AgentBuildGuideResult {
  source: AgentProductCatalogSource;
  operator: AgentOperatorResolution;
  evidence: AgentEvidenceUnavailable;
  recommendation: AgentEvidenceUnavailable;
}

interface NormalizedCatalogSources {
  operators: readonly AgentOperatorCatalogItem[];
  skills: readonly AgentSkillCatalogItem[];
  weapons: readonly AgentWeaponCatalogItem[];
  equipment: readonly AgentEquipmentCatalogItem[];
  gearSets: readonly AgentGearSetCatalogItem[];
}

interface FullEquipmentItem {
  id: string;
  name: string;
  gearSetId: string;
  gearSetName: string;
  part: BrowserEquipmentPart;
}

interface FullEquipmentSource {
  gearSetId: string;
  gearSetName: string;
  equipment: readonly FullEquipmentItem[];
}

const PARTS: readonly BrowserEquipmentPart[] = ['护甲', '护手', '配件'];
const PART_BY_SLOT: Readonly<Record<AgentGearSlotKey, BrowserEquipmentPart>> = {
  armor: '护甲',
  glove: '护手',
  accessory1: '配件',
  accessory2: '配件',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function compactText(value: unknown, fallback = ''): string {
  const text = asTrimmedString(value) || fallback;
  return Array.from(text).slice(0, MAX_AGENT_PRODUCT_CATALOG_TEXT).join('');
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback = 0): number {
  const parsed = Math.floor(finiteNumber(value, fallback));
  return parsed >= 0 ? parsed : fallback;
}

/**
 * Query normalization is intentionally conservative: it removes formatting
 * differences, but it never performs fuzzy matching or invents aliases.
 */
export function normalizeAgentProductQuery(value: unknown): string {
  return asTrimmedString(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}_]+/gu, '');
}

function exactQueryText(value: unknown): string {
  return asTrimmedString(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function stableCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function sortByIdAndName<T extends { id: string; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => stableCompare(left.name, right.name) || stableCompare(left.id, right.id));
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENT_PRODUCT_CATALOG_LIMIT;
  return Math.min(MAX_AGENT_PRODUCT_CATALOG_LIMIT, Math.max(1, Math.floor(value as number)));
}

function safeLevels(raw: unknown, max = 12): Readonly<Record<string, number>> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, value]) => Number.isFinite(typeof value === 'number' ? value : Number(value)))
      .sort(([left], [right]) => stableCompare(left, right))
      .slice(0, max)
      .map(([key, value]) => [key, finiteNumber(value)]),
  );
}

function toRecordEntries(raw: unknown): Array<[string, unknown]> {
  if (Array.isArray(raw)) {
    return raw.map((value, index) => [String(index), value]);
  }
  if (isRecord(raw)) return Object.entries(raw);
  return [];
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRuntimeOperators(raw: unknown): RuntimeOperatorTemplate[] {
  const entries = toRecordEntries(raw);
  const runtimeTemplates = entries
    .map(([, value]) => value)
    .filter((value): value is RuntimeOperatorTemplate => isRecord(value) && Array.isArray(value.skills));
  if (runtimeTemplates.length === entries.length) {
    return runtimeTemplates.map((value) => cloneRecord(value));
  }

  const draftMap: Record<string, OperatorDraft> = {};
  entries.forEach(([fallbackId, value]) => {
    if (!isRecord(value)) return;
    draftMap[fallbackId] = normalizeOperatorDraft(cloneRecord({
      ...value,
      id: asTrimmedString(value.id) || fallbackId,
    }) as OperatorDraft);
  });
  return buildRuntimeTemplatesFromDraftMap(draftMap);
}

function compactOperator(template: RuntimeOperatorTemplate): AgentOperatorCatalogItem {
  const id = compactText(template.id, 'operator');
  const name = compactText(template.name, id);
  return {
    id,
    name,
    rarity: positiveInteger(template.rarity),
    profession: compactText(template.profession),
    weaponType: compactText(template.weapon),
    element: compactText(template.element),
    mainStat: compactText(template.mainStat),
    subStat: compactText(template.subStat),
    level: positiveInteger(template.level),
    skillIds: [...template.skills]
      .sort((left, right) => stableCompare(left.id, right.id))
      .map((skill) => compactText(skill.id, 'skill')),
  };
}

function compactSkillHit(hit: RuntimeOperatorTemplateHit): AgentSkillHitCatalogItem {
  return {
    key: compactText(hit.key, 'hit'),
    name: compactText(hit.displayName, hit.key),
    multiplier: finiteNumber(hit.multiplier),
    element: compactText(hit.element),
    skillType: compactText(hit.skillType),
  };
}

function compactSkill(operator: RuntimeOperatorTemplate, skill: RuntimeOperatorTemplateSkill): AgentSkillCatalogItem {
  const hits = [...skill.hits].sort((left, right) => stableCompare(left.key, right.key));
  const boundedHits = hits.slice(0, MAX_AGENT_PRODUCT_CATALOG_LIMIT).map(compactSkillHit);
  return {
    id: `${compactText(operator.id, 'operator')}:${compactText(skill.id, 'skill')}`,
    operatorId: compactText(operator.id, 'operator'),
    operatorName: compactText(operator.name, operator.id),
    skillId: compactText(skill.id, 'skill'),
    name: compactText(skill.displayName, skill.id),
    buttonType: compactText(skill.buttonType),
    hitCount: positiveInteger(skill.hitCount, hits.length),
    hits: boundedHits,
    hitsTruncated: hits.length > boundedHits.length,
  };
}

function normalizeWeapons(raw: unknown): WeaponDraft[] {
  return toRecordEntries(raw).flatMap(([fallbackId, value]) => {
    if (!isRecord(value)) return [];
    return [normalizeWeaponDraft({
      ...cloneRecord(value),
      id: asTrimmedString(value.id) || fallbackId,
    } as RawWeaponDraft)];
  });
}

function compactWeaponEffect(id: string, raw: unknown): AgentWeaponEffectCatalogItem | null {
  if (!isRecord(raw)) return null;
  return {
    id: compactText(raw.effectId, id),
    name: compactText(raw.name, id),
    typeKey: compactText(raw.type),
    category: compactText(raw.category),
    unit: compactText(raw.unit),
    levels: safeLevels(raw.levels),
    ...(asTrimmedString(raw.valueMode) ? { valueMode: compactText(raw.valueMode) } : {}),
    ...(asTrimmedString(raw.effectKind) ? { effectKind: compactText(raw.effectKind) } : {}),
  };
}

function compactWeapon(weapon: WeaponDraft): AgentWeaponCatalogItem {
  const skills = (['skill1', 'skill2', 'skill3'] as const).map((skillId) => {
    const skill = weapon.skills[skillId];
    const effectEntries = Object.entries(skill?.effects ?? {})
      .sort(([left], [right]) => stableCompare(left, right));
    const effects = effectEntries
      .slice(0, MAX_AGENT_PRODUCT_CATALOG_LIMIT)
      .flatMap(([effectId, effect]) => {
        const compact = compactWeaponEffect(effectId, effect);
        return compact ? [compact] : [];
      });
    return {
      id: skillId,
      name: compactText(skill?.name, skillId),
      statType: compactText(skill?.statType),
      effectCount: effectEntries.length,
      effects,
      effectsTruncated: effectEntries.length > effects.length,
    } satisfies AgentWeaponSkillCatalogItem;
  });
  return {
    id: compactText(weapon.id, 'weapon'),
    name: compactText(weapon.name, weapon.id),
    rarity: positiveInteger(weapon.rarity),
    type: compactText(weapon.type),
    attackGrowth: safeLevels(weapon.attackGrowth),
    skills,
  };
}

function compactEquipmentEffect(effectId: string, raw: unknown): AgentEquipmentEffectCatalogItem | null {
  if (!isRecord(raw)) return null;
  return {
    id: compactText(raw.effectId, effectId),
    name: compactText(raw.label, effectId),
    typeKey: compactText(raw.typeKey),
    category: compactText(raw.category),
    unit: compactText(raw.unit),
    levels: safeLevels(raw.levels, 4),
  };
}

function compactEquipment(
  setId: string,
  setName: string,
  equipment: BrowserEquipmentLibrary['gearSets'][string]['equipments'][string],
): AgentEquipmentCatalogItem {
  const effects = Object.entries(equipment.effects ?? {})
    .sort(([left], [right]) => stableCompare(left, right))
    .flatMap(([effectId, effect]) => {
      const compact = compactEquipmentEffect(effectId, effect);
      return compact ? [compact] : [];
    });
  const fixedStat = equipment.fixedStat;
  return {
    id: compactText(equipment.equipmentId, 'equipment'),
    name: compactText(equipment.name, equipment.equipmentId),
    gearSetId: compactText(setId, 'gear-set'),
    gearSetName: compactText(setName, setId),
    part: equipment.part,
    ...(fixedStat ? {
      fixedStat: {
        label: compactText(fixedStat.label),
        typeKey: compactText(fixedStat.typeKey),
        value: finiteNumber(fixedStat.value),
        unit: compactText(fixedStat.unit),
      },
    } : {}),
    effects,
  };
}

function compactThreePieceBuff(id: string, raw: unknown): AgentGearSetBuffCatalogItem | null {
  if (!isRecord(raw)) return null;
  const maxStacks = raw.maxStacks === undefined ? undefined : positiveInteger(raw.maxStacks);
  return {
    id: compactText(raw.effectId, id),
    name: compactText(raw.name, id),
    typeKey: compactText(raw.typeKey),
    category: compactText(raw.category),
    value: finiteNumber(raw.value),
    unit: compactText(raw.unit),
    ...(asTrimmedString(raw.effectKind) ? { effectKind: compactText(raw.effectKind) } : {}),
    ...(asTrimmedString(raw.valueMode) ? { valueMode: compactText(raw.valueMode) } : {}),
    ...(maxStacks !== undefined ? { maxStacks } : {}),
  };
}

function normalizeEquipment(raw: unknown): BrowserEquipmentLibrary {
  return normalizeEquipmentLibrary(raw, { assumeCanonicalValues: true });
}

function compactEquipmentSources(raw: unknown): {
  equipment: AgentEquipmentCatalogItem[];
  gearSets: AgentGearSetCatalogItem[];
  fullSets: FullEquipmentSource[];
} {
  const library = normalizeEquipment(raw);
  const equipment: AgentEquipmentCatalogItem[] = [];
  const gearSets: AgentGearSetCatalogItem[] = [];
  const fullSets: FullEquipmentSource[] = [];

  Object.values(library.gearSets).forEach((gearSet) => {
    const setId = compactText(gearSet.gearSetId, 'gear-set');
    const setName = compactText(gearSet.name, setId);
    const setEquipment = Object.values(gearSet.equipments)
      .map((item) => compactEquipment(setId, setName, item))
      .sort((left, right) => stableCompare(left.name, right.name) || stableCompare(left.id, right.id));
    equipment.push(...setEquipment);
    const partCounts = Object.fromEntries(PARTS.map((part) => [
      part,
      setEquipment.filter((item) => item.part === part).length,
    ])) as Record<BrowserEquipmentPart, number>;
    const threePieceBuffs = Object.entries(gearSet.threePieceBuffs ?? {})
      .sort(([left], [right]) => stableCompare(left, right))
      .flatMap(([buffId, buff]) => {
        const compact = compactThreePieceBuff(buffId, buff);
        return compact ? [compact] : [];
      });
    gearSets.push({
      id: setId,
      name: setName,
      equipmentIds: setEquipment.map((item) => item.id),
      equipmentCount: setEquipment.length,
      partCounts,
      threePieceBuffs,
    });
    fullSets.push({
      gearSetId: setId,
      gearSetName: setName,
      equipment: setEquipment.map((item) => ({
        id: item.id,
        name: item.name,
        gearSetId: item.gearSetId,
        gearSetName: item.gearSetName,
        part: item.part,
      })),
    });
  });

  return { equipment, gearSets, fullSets };
}

function normalizeSources(input: AgentProductCatalogInput): NormalizedCatalogSources & { fullSets: readonly FullEquipmentSource[] } {
  const templates = normalizeRuntimeOperators(input.operators);
  const operators = templates.map(compactOperator);
  const skills = templates.flatMap((template) => template.skills.map((skill) => compactSkill(template, skill)));
  const weapons = normalizeWeapons(input.weapons).map(compactWeapon);
  const equipmentSources = compactEquipmentSources(input.equipment);
  return {
    operators: sortByIdAndName(operators),
    skills: sortByIdAndName(skills),
    weapons: sortByIdAndName(weapons),
    equipment: sortByIdAndName(equipmentSources.equipment),
    gearSets: sortByIdAndName(equipmentSources.gearSets),
    fullSets: equipmentSources.fullSets,
  };
}

function searchValues<T>(item: T, fields: readonly (keyof T)[]): string[] {
  return fields.flatMap((field) => {
    const value = item[field];
    return typeof value === 'string' ? [value] : [];
  });
}

function buildCatalogEnvelope<T extends { id: string; name: string }>(
  items: readonly T[],
  query: string | undefined,
  limit: number | undefined,
  fields: readonly (keyof T)[],
): AgentCatalogEnvelope<T> {
  const rawQuery = asTrimmedString(query);
  const normalizedQuery = normalizeAgentProductQuery(rawQuery);
  const sorted = sortByIdAndName(items);
  if (!normalizedQuery) {
    const bounded = sorted.slice(0, boundedLimit(limit));
    return {
      query: rawQuery,
      normalizedQuery,
      matchMode: 'all',
      ambiguous: false,
      catalogCount: sorted.length,
      queryCount: sorted.length,
      resultCount: bounded.length,
      exhaustive: bounded.length === sorted.length,
      truncated: bounded.length < sorted.length,
      source: AGENT_PRODUCT_CATALOG_SOURCE,
      results: bounded,
    };
  }

  const exact = sorted.filter((item) => searchValues(item, fields).some((value) => exactQueryText(value) === exactQueryText(rawQuery)));
  const normalized = sorted.filter((item) => searchValues(item, fields).some((value) => normalizeAgentProductQuery(value) === normalizedQuery));
  const matching = exact.length > 0 ? exact : normalized;
  const matchMode: AgentCatalogMatchMode = exact.length > 1 || (exact.length === 0 && normalized.length > 1)
    ? 'ambiguous'
    : exact.length === 1
      ? 'exact'
      : normalized.length === 1
        ? 'normalized'
        : 'none';
  const bounded = matching.slice(0, boundedLimit(limit));
  return {
    query: rawQuery,
    normalizedQuery,
    matchMode,
    ambiguous: matchMode === 'ambiguous',
    catalogCount: sorted.length,
    queryCount: matching.length,
    resultCount: bounded.length,
    exhaustive: bounded.length === matching.length,
    truncated: bounded.length < matching.length,
    source: AGENT_PRODUCT_CATALOG_SOURCE,
    results: bounded,
  };
}

function buildCatalogFromNormalized(
  sources: NormalizedCatalogSources,
  options: AgentProductCatalogBuildOptions = {},
): AgentProductCatalog {
  const query = asTrimmedString(options.query);
  const normalizedQuery = normalizeAgentProductQuery(query);
  const operators = buildCatalogEnvelope(sources.operators, query, options.limit, ['id', 'name', 'profession', 'weaponType']);
  const skills = buildCatalogEnvelope(sources.skills, query, options.limit, ['id', 'operatorId', 'operatorName', 'skillId', 'name', 'buttonType']);
  const weapons = buildCatalogEnvelope(sources.weapons, query, options.limit, ['id', 'name', 'type']);
  const equipment = buildCatalogEnvelope(sources.equipment, query, options.limit, ['id', 'name', 'gearSetId', 'gearSetName', 'part']);
  const gearSets = buildCatalogEnvelope(sources.gearSets, query, options.limit, ['id', 'name']);
  const envelopes = [operators, skills, weapons, equipment, gearSets];
  return {
    source: AGENT_PRODUCT_CATALOG_SOURCE,
    query,
    normalizedQuery,
    catalogCount: envelopes.reduce((sum, envelope) => sum + envelope.catalogCount, 0),
    queryCount: envelopes.reduce((sum, envelope) => sum + envelope.queryCount, 0),
    exhaustive: envelopes.every((envelope) => envelope.exhaustive),
    truncated: envelopes.some((envelope) => envelope.truncated),
    operators,
    skills,
    weapons,
    equipment,
    gearSets,
  };
}

export function buildAgentProductCatalog(
  input: AgentProductCatalogInput = {},
  options: AgentProductCatalogBuildOptions = {},
): AgentProductCatalog {
  return buildCatalogFromNormalized(normalizeSources(input), options);
}

export function queryAgentProductCatalog(
  input: AgentProductCatalogInput,
  request: AgentCatalogQueryOptions,
): AgentCatalogEnvelope<AgentOperatorCatalogItem | AgentSkillCatalogItem | AgentWeaponCatalogItem | AgentEquipmentCatalogItem | AgentGearSetCatalogItem> {
  const sources = normalizeSources(input);
  switch (request.domain) {
    case 'operators':
      return buildCatalogEnvelope(sources.operators, request.query, request.limit, ['id', 'name', 'profession', 'weaponType']);
    case 'skills':
      return buildCatalogEnvelope(sources.skills, request.query, request.limit, ['id', 'operatorId', 'operatorName', 'skillId', 'name', 'buttonType']);
    case 'weapons':
      return buildCatalogEnvelope(sources.weapons, request.query, request.limit, ['id', 'name', 'type']);
    case 'equipment':
      return buildCatalogEnvelope(sources.equipment, request.query, request.limit, ['id', 'name', 'gearSetId', 'gearSetName', 'part']);
    case 'gearSets':
      return buildCatalogEnvelope(sources.gearSets, request.query, request.limit, ['id', 'name']);
  }
}

function parseStorageJson(storage: AgentProductCatalogStorage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as unknown : undefined;
  } catch {
    return undefined;
  }
}

export function readAgentProductCatalogInput(
  storage: AgentProductCatalogStorage = persistentLocalStorage,
): AgentProductCatalogInput {
  const weaponLibrary = parseStorageJson(storage, AGENT_PRODUCT_CATALOG_STORAGE_KEYS.weaponLibrary);
  const equipmentLibrary = parseStorageJson(storage, AGENT_PRODUCT_CATALOG_STORAGE_KEYS.equipmentLibrary);
  return {
    operators: parseStorageJson(storage, AGENT_PRODUCT_CATALOG_STORAGE_KEYS.operatorLibrary),
    weapons: toRecordEntries(weaponLibrary).length > 0
      ? weaponLibrary
      : parseStorageJson(storage, AGENT_PRODUCT_CATALOG_STORAGE_KEYS.weaponDraft),
    equipment: isRecord(equipmentLibrary) && Object.keys(equipmentLibrary.gearSets ?? {}).length > 0
      ? equipmentLibrary
      : parseStorageJson(storage, AGENT_PRODUCT_CATALOG_STORAGE_KEYS.equipmentDraft),
  };
}

export function readAgentProductCatalog(options: AgentProductCatalogReadOptions = {}): AgentProductCatalog {
  return buildAgentProductCatalog(
    readAgentProductCatalogInput(options.storage),
    { query: options.query, limit: options.limit },
  );
}

function resolveOperator(
  operators: readonly AgentOperatorCatalogItem[],
  query: string,
): AgentOperatorResolution {
  const result = buildCatalogEnvelope(operators, query, MAX_AGENT_PRODUCT_CATALOG_LIMIT, ['id', 'name', 'profession', 'weaponType']);
  return {
    query: result.query,
    normalizedQuery: result.normalizedQuery,
    matchMode: result.matchMode,
    ambiguous: result.ambiguous,
    candidates: result.results,
    operator: result.matchMode === 'exact' || result.matchMode === 'normalized' ? result.results[0] ?? null : null,
  };
}

export function getCompatibleWeapons(
  input: AgentProductCatalogInput,
  request: { operatorQuery: string; weaponQuery?: string; limit?: number },
): AgentWeaponCompatibilityResult {
  const sources = normalizeSources(input);
  const operator = resolveOperator(sources.operators, request.operatorQuery);
  if (!operator.operator) {
    const compatibleWeapons = buildCatalogEnvelope([], request.weaponQuery, request.limit, ['id', 'name', 'type']);
    return {
      source: AGENT_PRODUCT_CATALOG_SOURCE,
      operator,
      compatibility: operator.ambiguous || operator.matchMode === 'none' ? 'operator-unresolved' : 'weapon-type-unavailable',
      compatibleWeapons,
      recommendation: createEvidenceUnavailable('subjective recommendation'),
    };
  }
  const operatorType = normalizeAgentProductQuery(operator.operator.weaponType);
  if (!operatorType) {
    const compatibleWeapons = buildCatalogEnvelope([], request.weaponQuery, request.limit, ['id', 'name', 'type']);
    return {
      source: AGENT_PRODUCT_CATALOG_SOURCE,
      operator,
      compatibility: 'weapon-type-unavailable',
      compatibleWeapons,
      recommendation: createEvidenceUnavailable('subjective recommendation'),
    };
  }
  const compatible = sources.weapons.filter((weapon) => normalizeAgentProductQuery(weapon.type) === operatorType);
  return {
    source: AGENT_PRODUCT_CATALOG_SOURCE,
    operator,
    compatibility: 'deterministic-weapon-type-match',
    compatibleWeapons: buildCatalogEnvelope(compatible, request.weaponQuery, request.limit, ['id', 'name', 'type']),
    recommendation: createEvidenceUnavailable('subjective recommendation'),
  };
}

export function createEvidenceUnavailable(kind: 'build-guide' | 'subjective recommendation' = 'build-guide'): AgentEvidenceUnavailable {
  return {
    status: 'evidenceUnavailable',
    source: 'no-verified-1.8-build-guide-in-browser-facts',
    reason: kind === 'build-guide'
      ? '浏览器 SQLite 事实源没有经过验证的 1.8 build-guide；旧 1.2 攻略不能作为 1.8 事实。'
      : '当前服务只提供可核验目录事实，不提供主观强度、优先级或最优推荐。',
    legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact',
  };
}

export function getAgentBuildGuide(
  input: AgentProductCatalogInput,
  operatorQuery: string,
): AgentBuildGuideResult {
  const sources = normalizeSources(input);
  const operator = resolveOperator(sources.operators, operatorQuery);
  const evidence = createEvidenceUnavailable('build-guide');
  return {
    source: AGENT_PRODUCT_CATALOG_SOURCE,
    operator,
    evidence,
    recommendation: createEvidenceUnavailable('subjective recommendation'),
  };
}

function emptyPartCounts(): Record<BrowserEquipmentPart, number> {
  return { '护甲': 0, '护手': 0, '配件': 0 };
}

function resolveGearSet(
  sets: readonly FullEquipmentSource[],
  query: string,
): { state: AgentGearTopologyState; targetSet: FullEquipmentSource | null; normalizedQuery: string } {
  const rawQuery = asTrimmedString(query);
  const normalizedQuery = normalizeAgentProductQuery(rawQuery);
  if (!normalizedQuery) return { state: 'SET_QUERY_REQUIRED', targetSet: null, normalizedQuery };
  const exact = sets.filter((set) => [set.gearSetId, set.gearSetName].some((value) => exactQueryText(value) === exactQueryText(rawQuery)));
  const normalized = sets.filter((set) => [set.gearSetId, set.gearSetName].some((value) => normalizeAgentProductQuery(value) === normalizedQuery));
  const matches = exact.length > 0 ? exact : normalized;
  if (matches.length === 0) return { state: 'SET_NOT_FOUND', targetSet: null, normalizedQuery };
  if (matches.length > 1) return { state: 'SET_QUERY_AMBIGUOUS', targetSet: null, normalizedQuery };
  return { state: 'READY', targetSet: matches[0], normalizedQuery };
}

function buildTopologyContext(
  input: AgentProductCatalogInput,
  requestedSetQuery: string,
): {
  state: AgentGearTopologyState;
  normalizedSetQuery: string;
  targetSet: FullEquipmentSource | null;
  allItems: readonly FullEquipmentItem[];
} {
  const sources = normalizeSources(input);
  const allItems = sources.fullSets.flatMap((set) => set.equipment);
  const resolved = resolveGearSet(sources.fullSets, requestedSetQuery);
  return {
    state: resolved.state,
    normalizedSetQuery: resolved.normalizedQuery,
    targetSet: resolved.targetSet,
    allItems,
  };
}

function targetCandidatesBySlot(
  targetSet: FullEquipmentSource | null,
): Record<AgentGearSlotKey, FullEquipmentItem[]> {
  return Object.fromEntries(AGENT_GEAR_SLOT_ORDER.map((slotKey) => [
    slotKey,
    targetSet?.equipment.filter((item) => item.part === PART_BY_SLOT[slotKey]) ?? [],
  ])) as Record<AgentGearSlotKey, FullEquipmentItem[]>;
}

function pieceRef(slotKey: AgentGearSlotKey, piece: FullEquipmentItem): AgentGearPieceRef {
  return {
    slotKey,
    equipmentId: piece.id,
    equipmentName: piece.name,
    gearSetId: piece.gearSetId,
    gearSetName: piece.gearSetName,
    part: piece.part,
  };
}

function isCombinationDistinct(
  pieces: readonly FullEquipmentItem[],
  allowDuplicateCompatibleAccessories: boolean,
): boolean {
  const seen = new Map<string, FullEquipmentItem[]>();
  pieces.forEach((piece) => {
    const existing = seen.get(piece.id) ?? [];
    seen.set(piece.id, [...existing, piece]);
  });
  return [...seen.values()].every((duplicates) => (
    duplicates.length === 1 || (
      allowDuplicateCompatibleAccessories && duplicates.every((piece) => piece.part === '配件')
    )
  ));
}

function enumerateThreePlusOneCombinations(
  targetSet: FullEquipmentSource,
  allItems: readonly FullEquipmentItem[],
  allowDuplicateCompatibleAccessories: boolean,
): AgentGearTopologyCombination[] {
  const targetBySlot = targetCandidatesBySlot(targetSet);
  const combinations: AgentGearTopologyCombination[] = [];
  AGENT_GEAR_SLOT_ORDER.forEach((offSetSlot) => {
    const offSetCandidates = allItems.filter((item) => (
      item.gearSetId !== targetSet.gearSetId && item.part === PART_BY_SLOT[offSetSlot]
    ));
    const targetSlots = AGENT_GEAR_SLOT_ORDER.filter((slotKey) => slotKey !== offSetSlot);
    const targetLists = targetSlots.map((slotKey) => targetBySlot[slotKey]);
    if (targetLists.some((items) => items.length === 0) || offSetCandidates.length === 0) return;

    const visit = (index: number, selected: FullEquipmentItem[]): void => {
      if (index === targetLists.length) {
        offSetCandidates.forEach((offSetPiece) => {
          const pieces = [...selected, offSetPiece];
          if (!isCombinationDistinct(pieces, allowDuplicateCompatibleAccessories)) return;
          const pieceBySlot: Partial<Record<AgentGearSlotKey, FullEquipmentItem>> = { [offSetSlot]: offSetPiece };
          targetSlots.forEach((slotKey, targetIndex) => {
            pieceBySlot[slotKey] = selected[targetIndex];
          });
          const completePieces = AGENT_GEAR_SLOT_ORDER.map((slotKey) => pieceBySlot[slotKey]!);
          const id = AGENT_GEAR_SLOT_ORDER.map((slotKey) => `${slotKey}:${completePieces[AGENT_GEAR_SLOT_ORDER.indexOf(slotKey)].id}`).join('|');
          combinations.push({
            id,
            name: `${targetSet.gearSetName} 3+1`,
            targetSetId: targetSet.gearSetId,
            targetSetName: targetSet.gearSetName,
            targetSetPieces: 3,
            offSetPieces: 1,
            offSetSlot,
            pieces: Object.fromEntries(AGENT_GEAR_SLOT_ORDER.map((slotKey) => [
              slotKey,
              pieceRef(slotKey, pieceBySlot[slotKey]!),
            ])) as Record<AgentGearSlotKey, AgentGearPieceRef>,
          });
        });
        return;
      }
      targetLists[index].forEach((piece) => visit(index + 1, [...selected, piece]));
    };
    visit(0, []);
  });
  const deduped = new Map<string, AgentGearTopologyCombination>();
  combinations.forEach((combination) => deduped.set(combination.id, combination));
  return [...deduped.values()].sort((left, right) => stableCompare(left.id, right.id));
}

export function getGearTopologyFacts(
  input: AgentProductCatalogInput,
  request: { setQuery: string; allowDuplicateCompatibleAccessories?: boolean },
): AgentGearTopologyFacts {
  const context = buildTopologyContext(input, request.setQuery);
  const targetSet = context.targetSet;
  const targetBySlot = targetCandidatesBySlot(targetSet);
  const targetPartCounts = emptyPartCounts();
  targetSet?.equipment.forEach((item) => { targetPartCounts[item.part] += 1; });
  const offSetCandidatesBySlot = Object.fromEntries(AGENT_GEAR_SLOT_ORDER.map((slotKey) => [
    slotKey,
    targetSet
      ? context.allItems.filter((item) => item.gearSetId !== targetSet.gearSetId && item.part === PART_BY_SLOT[slotKey]).length
      : 0,
  ])) as Record<AgentGearSlotKey, number>;
  const combinations = targetSet
    ? enumerateThreePlusOneCombinations(targetSet, context.allItems, request.allowDuplicateCompatibleAccessories === true)
    : [];
  const validState = context.state === 'READY' && combinations.length > 0 ? 'READY' : context.state === 'READY' ? 'NO_VALID_3_PLUS_1' : context.state;
  return {
    source: AGENT_PRODUCT_CATALOG_SOURCE,
    state: validState,
    requestedSetQuery: asTrimmedString(request.setQuery),
    normalizedSetQuery: context.normalizedSetQuery,
    targetSet: targetSet ? { id: targetSet.gearSetId, name: targetSet.gearSetName } : null,
    minimumTargetSetPieces: 3,
    slots: AGENT_GEAR_SLOT_ORDER,
    targetSetEquipmentCount: targetSet?.equipment.length ?? 0,
    targetSetPartCounts: targetPartCounts,
    targetSetCandidatesBySlot: Object.fromEntries(AGENT_GEAR_SLOT_ORDER.map((slotKey) => [slotKey, targetBySlot[slotKey].length])) as Record<AgentGearSlotKey, number>,
    offSetCandidatesBySlot,
    constructibleCombinationCount: combinations.length,
    hasValidThreePlusOne: combinations.length > 0,
    combinationsExhaustive: true,
    recommendation: createEvidenceUnavailable('subjective recommendation'),
  };
}

export function planGearTopology(
  input: AgentProductCatalogInput,
  request: { setQuery: string; limit?: number; allowDuplicateCompatibleAccessories?: boolean },
): AgentGearTopologyPlan {
  const context = buildTopologyContext(input, request.setQuery);
  const allCombinations = context.targetSet
    ? enumerateThreePlusOneCombinations(
      context.targetSet,
      context.allItems,
      request.allowDuplicateCompatibleAccessories === true,
    )
    : [];
  const facts = getGearTopologyFacts(input, request);
  const combinations = buildCatalogEnvelope(
    allCombinations,
    '',
    request.limit,
    ['id', 'targetSetId', 'targetSetName', 'offSetSlot'],
  );
  const state = context.state === 'READY' && allCombinations.length > 0
    ? 'READY'
    : context.state === 'READY'
      ? 'NO_VALID_3_PLUS_1'
      : context.state;
  return {
    source: AGENT_PRODUCT_CATALOG_SOURCE,
    state,
    facts: state === facts.state ? facts : { ...facts, state },
    combinations,
    ranking: 'unranked-facts-only',
    recommendation: createEvidenceUnavailable('subjective recommendation'),
  };
}

export function readAgentProductCatalogQuery(
  storage: AgentProductCatalogStorage,
  request: AgentCatalogQueryOptions,
): AgentCatalogEnvelope<AgentOperatorCatalogItem | AgentSkillCatalogItem | AgentWeaponCatalogItem | AgentEquipmentCatalogItem | AgentGearSetCatalogItem> {
  return queryAgentProductCatalog(readAgentProductCatalogInput(storage), request);
}
