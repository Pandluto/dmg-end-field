import {
  AGENT_GEAR_SLOT_ORDER,
  buildAgentProductCatalog,
  normalizeAgentProductQuery,
  MAX_AGENT_PRODUCT_CATALOG_LIMIT,
  type AgentCatalogEnvelope,
  type AgentCatalogMatchMode,
  type AgentEquipmentCatalogItem,
  type AgentGearSetBuffCatalogItem,
  type AgentGearSetCatalogItem,
  type AgentGearSlotKey,
  type AgentProductCatalog,
  type AgentProductCatalogInput,
  type AgentSkillCatalogItem,
  type AgentWeaponCatalogItem,
  type AgentWeaponEffectCatalogItem,
} from './agentProductCatalogService';
import {
  BUFF_TYPE_REGISTRY,
  type BuffTypeMatchRule,
} from '../domain/buffTypeRegistry';
import { validateLoadoutCapsule } from '../../../agent/core/tools/loadout-fact-operations.ts';

/**
 * This module is deliberately a pure layer over the browser 1.8 catalog.
 *
 * It does not read storage, guide files, effect values, or legacy OpenCode
 * knowledge.  Names can be displayed or used for explicit query resolution,
 * but names, descriptions, rarity and profession never enter scoring.  A
 * recommendation is only a stable coverage score over explicit `typeKey`
 * facts and closed-map translations of typed catalog fields.  The score is
 * not a damage simulation and must not be presented as an optimal result.
 */

export type AgentLoadoutCatalogInput = AgentProductCatalog | AgentProductCatalogInput;
export type AgentLoadoutDomain = 'operators' | 'skills' | 'weapons' | 'equipment' | 'gearSets';
export type AgentLoadoutRecommendationState = 'READY' | 'TIED' | 'PARTIAL' | 'NO_PLAN';

export const AGENT_LOADOUT_RECOMMENDATION_POLICY = 'deterministic-fact-coverage-v1' as const;

/**
 * These are the only stat/element/button facts that are converted into
 * scoring dimensions.  Values are canonical 1.8 field values, not aliases
 * inferred from an operator name or description.
 */
export const AGENT_LOADOUT_PRIORITY_KEY_MAP = Object.freeze({
  roles: Object.freeze({
    main: 'mainStatBoost',
    sub: 'subStatBoost',
  }),
  abilities: Object.freeze({
    力量: 'strengthBoost',
    敏捷: 'agilityBoost',
    智识: 'intelligenceBoost',
    意志: 'willBoost',
    strength: 'strengthBoost',
    agility: 'agilityBoost',
    intelligence: 'intelligenceBoost',
    will: 'willBoost',
  }),
  elements: Object.freeze({
    物理: 'physicalDmgBonus',
    physical: 'physicalDmgBonus',
    法术: 'magicDmgBonus',
    magic: 'magicDmgBonus',
    灼热: 'fireDmgBonus',
    fire: 'fireDmgBonus',
    电磁: 'electricDmgBonus',
    electric: 'electricDmgBonus',
    寒冷: 'iceDmgBonus',
    ice: 'iceDmgBonus',
    自然: 'natureDmgBonus',
    nature: 'natureDmgBonus',
  }),
  buttons: Object.freeze({
    A: 'normalAttackDmgBonus',
    B: 'skillDmgBonus',
    E: 'chainSkillDmgBonus',
    Q: 'ultimateDmgBonus',
    Dot: 'dotDmgBonus',
  }),
} as const);

/**
 * Exact, audited translations for typed catalog fields whose stored value is
 * not already an effect typeKey.  This is deliberately a closed map: labels,
 * descriptions, weapon names, rarity and profession never participate.
 */
export const AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP = Object.freeze({
  weaponStatTypes: Object.freeze({
    atk: 'atkPercentBoost',
    atkPercent: 'atkPercentBoost',
    atkPercentBoost: 'atkPercentBoost',
    '攻击提升': 'atkPercentBoost',
    agility: 'agilityBoost',
    agilityBoost: 'agilityBoost',
    '敏捷提升': 'agilityBoost',
    strength: 'strengthBoost',
    strengthBoost: 'strengthBoost',
    '力量提升': 'strengthBoost',
    intelligence: 'intelligenceBoost',
    intelligenceBoost: 'intelligenceBoost',
    '智识提升': 'intelligenceBoost',
    will: 'willBoost',
    willBoost: 'willBoost',
    '意志提升': 'willBoost',
    mainStat: 'mainStatBoost',
    mainStatBoost: 'mainStatBoost',
    '主能力提升': 'mainStatBoost',
    subStatBoost: 'subStatBoost',
    '副能力提升': 'subStatBoost',
    hp: 'hp',
    '生命提升': 'hp',
    physicalDmgBonus: 'physicalDmgBonus',
    '物理伤害提升': 'physicalDmgBonus',
    magicDmgBonus: 'magicDmgBonus',
    '法术提升': 'magicDmgBonus',
    '法术伤害提升': 'magicDmgBonus',
    burnDmgBonus: 'fireDmgBonus',
    fireDmgBonus: 'fireDmgBonus',
    '灼热伤害提升': 'fireDmgBonus',
    electricDmgBonus: 'electricDmgBonus',
    '电磁伤害提升': 'electricDmgBonus',
    iceDmgBonus: 'iceDmgBonus',
    '寒冷伤害提升': 'iceDmgBonus',
    natureDmgBonus: 'natureDmgBonus',
    '自然伤害提升': 'natureDmgBonus',
    critRate: 'critRateBoost',
    critRateBoost: 'critRateBoost',
    '暴击率提升': 'critRateBoost',
    memoryStrength: 'sourceSkillBoost',
    sourceSkillBoost: 'sourceSkillBoost',
    '源石技艺提升': 'sourceSkillBoost',
    '源石技艺强度提升': 'sourceSkillBoost',
    ultimateChargeEfficiency: 'ultimateChargeEfficiency',
    '终结技充能效率提升': 'ultimateChargeEfficiency',
    healingBonus: 'healingBonus',
    '治疗效率提升': 'healingBonus',
    allDmgBonus: 'allDmgBonus',
    allElementDmgBonus: 'allElementDmgBonus',
    skillDmgBonus: 'skillDmgBonus',
    allSkillDmgBonus: 'allSkillDmgBonus',
    '强攻·武装整备': 'flatAtk',
  }),
  equipmentFixedStats: Object.freeze({
    defense: 'defense',
    hp: 'hp',
    flatAtk: 'flatAtk',
  }),
} as const);

/**
 * The weights describe fact coverage importance only.  They never multiply
 * or add a weapon/equipment value.  Skill weights use the explicit button
 * distribution count from the operator catalog.
 */
export const AGENT_LOADOUT_PRIORITY_WEIGHTS = Object.freeze({
  mainStat: 5,
  subStat: 3,
  mainStatRole: 4,
  subStatRole: 2,
  element: 4,
  skill: 2,
  allSkills: 1,
  genericAttack: 1,
  genericDamage: 1,
  genericElementDamage: 1,
  genericSkill: 1,
} as const);

/** A hard bound applies even when a caller omits a limit. */
export const DEFAULT_AGENT_LOADOUT_COMBINATION_LIMIT = 512;
export const MAX_AGENT_LOADOUT_COMBINATION_LIMIT = 4096;

const SCORE_CATEGORY_FACTORS: Readonly<Record<string, number>> = Object.freeze({
  passive: 100,
  positive: 100,
  ability: 100,
  buff: 100,
  condition: 60,
  countable: 75,
});

/**
 * Known 1.8 effect keys are intentionally listed here.  A key outside this
 * set is reported as unresolved; it is never treated as a guessed synonym.
 */
const KNOWN_1_8_EFFECT_TYPE_KEYS: ReadonlySet<string> = new Set([
  'atkPercentBoost',
  'atk',
  'flatAtk',
  'mainStat',
  'subStat',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'hp',
  'hpPercent',
  'defense',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allElementDmgBonus',
  'allDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'allSkillDmgBonus',
  'imbalanceDmgBonus',
  'physicalFragile',
  'fireFragile',
  'electricFragile',
  'iceFragile',
  'natureFragile',
  'magicFragile',
  'physicalVulnerability',
  'fireVulnerability',
  'electricVulnerability',
  'iceVulnerability',
  'natureVulnerability',
  'magicVulnerability',
  'physicalAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'magicAmplify',
  'allCorrosion',
  'physicalCorrosion',
  'fireCorrosion',
  'electricCorrosion',
  'iceCorrosion',
  'natureCorrosion',
  'magicCorrosion',
  'allResistanceIgnore',
  'physicalResistanceIgnore',
  'fireResistanceIgnore',
  'electricResistanceIgnore',
  'iceResistanceIgnore',
  'natureResistanceIgnore',
  'magicResistanceIgnore',
  'comboDamageBonus',
  'multiplierBonus',
  'multiplierMultiplier',
  'sourceSkillBoost',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
  'fireNatureDmgBonus',
  'iceElectricDmgBonus',
  'allCorrosion',
]);

const EXPLICITLY_NON_OFFENSIVE_TYPE_KEYS: ReadonlySet<string> = new Set([
  'hp',
  'hpPercent',
  'defense',
  'damageReduction',
  'receivedHealingBonus',
]);

const ADDITIONAL_DAMAGE_MATCH_RULES: Readonly<Record<string, BuffTypeMatchRule>> = Object.freeze({
  critRateBoost: { kind: 'all' },
  critDmgBonusBoost: { kind: 'all' },
  allCorrosion: { kind: 'all' },
  physicalCorrosion: { kind: 'physical' },
  magicCorrosion: { kind: 'magic' },
  fireCorrosion: { kind: 'element', element: 'fire' },
  electricCorrosion: { kind: 'element', element: 'electric' },
  iceCorrosion: { kind: 'element', element: 'ice' },
  natureCorrosion: { kind: 'element', element: 'nature' },
  allResistanceIgnore: { kind: 'all' },
  physicalResistanceIgnore: { kind: 'physical' },
  magicResistanceIgnore: { kind: 'magic' },
  fireResistanceIgnore: { kind: 'element', element: 'fire' },
  electricResistanceIgnore: { kind: 'element', element: 'electric' },
  iceResistanceIgnore: { kind: 'element', element: 'ice' },
  natureResistanceIgnore: { kind: 'element', element: 'nature' },
});

const EXPLICITLY_APPLICABILITY_MODELED_TYPE_KEYS: ReadonlySet<string> = new Set([
  ...BUFF_TYPE_REGISTRY.keys(),
  ...Object.keys(ADDITIONAL_DAMAGE_MATCH_RULES),
  'atk',
  'flatAtk',
  'atkPercentBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'fireNatureDmgBonus',
  'iceElectricDmgBonus',
]);

const TRUSTED_AGENT_LOADOUT_CATALOGS = new WeakSet<object>();

export interface AgentLoadoutCatalogCoverageEntry {
  exhaustive: boolean;
  catalogCount: number;
  queryCount: number;
  resultCount: number;
  truncated: boolean;
}

export interface AgentLoadoutCatalogCoverage {
  overall: boolean;
  domains: Readonly<Record<AgentLoadoutDomain, AgentLoadoutCatalogCoverageEntry>>;
}

export interface AgentLoadoutOperatorResolution {
  query: string;
  normalizedQuery: string;
  matchMode: AgentCatalogMatchMode;
  ambiguous: boolean;
  candidates: readonly AgentLoadoutOperatorFact[];
  operator: AgentLoadoutOperatorFact | null;
}

export interface AgentLoadoutOperatorFact {
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

export interface AgentLoadoutPriorityEvidence {
  path: string;
  paths: readonly string[];
  values: readonly (string | number)[];
}

export interface AgentLoadoutPriority {
  key: string;
  dimension: string;
  weight: number;
  reason: string;
  evidence: AgentLoadoutPriorityEvidence;
}

export interface AgentLoadoutProfile {
  policy: typeof AGENT_LOADOUT_RECOMMENDATION_POLICY;
  source: 'browser-sqlite-mirror';
  operatorQuery: string;
  status: 'READY' | 'PARTIAL' | 'OPERATOR_AMBIGUOUS' | 'OPERATOR_UNRESOLVED';
  resolution: AgentLoadoutOperatorResolution;
  operator: AgentLoadoutOperatorFact | null;
  priorities: readonly AgentLoadoutPriority[];
  priorityKeys: readonly string[];
  skillButtonDistribution: Readonly<Record<string, number>>;
  knownSkillCount: number;
  expectedSkillCount: number;
  catalogCoverage: AgentLoadoutCatalogCoverage;
  unresolved: readonly AgentLoadoutUnresolvedItem[];
  warnings: readonly string[];
}

export interface AgentLoadoutUnresolvedItem {
  path: string;
  reason: string;
  value?: string;
}

export interface AgentLoadoutScoreComponent {
  source: 'weapon' | 'equipment' | 'setBuff';
  sourceId: string;
  evidencePath: string;
  typeKey: string;
  priorityKey: string;
  weight: number;
  category: string;
  contribution: number;
  condition: 'always' | 'conditional';
  tradeoff: string | null;
}

export interface AgentLoadoutDimensionScore {
  key: string;
  weight: number;
  matchedEffectCount: number;
  contribution: number;
  conditionalMatchCount: number;
}

export interface AgentLoadoutScore {
  total: number;
  dimensions: readonly AgentLoadoutDimensionScore[];
  scoreComponents: readonly AgentLoadoutScoreComponent[];
  conditional: boolean;
  incomplete: boolean;
  unresolved: readonly AgentLoadoutUnresolvedItem[];
}

export interface AgentWeaponRecommendationCandidate {
  id: string;
  name: string;
  type: string;
  rank: number;
  tied: boolean;
  score: number;
  dimensions: readonly AgentLoadoutDimensionScore[];
  scoreComponents: readonly AgentLoadoutScoreComponent[];
  conditional: boolean;
  tradeoffs: readonly string[];
  unresolved: readonly AgentLoadoutUnresolvedItem[];
}

export interface AgentWeaponRecommendation {
  policy: typeof AGENT_LOADOUT_RECOMMENDATION_POLICY;
  source: 'browser-sqlite-mirror';
  status: AgentLoadoutRecommendationState;
  operator: AgentLoadoutOperatorResolution;
  profileStatus: AgentLoadoutProfile['status'];
  compatibleCount: number;
  excludedIncompatibleCount: number;
  candidates: readonly AgentWeaponRecommendationCandidate[];
  catalogCoverage: AgentLoadoutCatalogCoverage;
  warnings: readonly string[];
  limitation: 'fact-key-coverage-not-damage-simulation';
}

export interface AgentLoadoutCapsuleEntry {
  id?: string;
  effectId?: string;
  label?: string;
  typeKey?: string;
  typeKeys?: readonly string[];
  category?: string;
  valueMode?: string;
  level?: string | number | null;
  value?: number | null;
  unit?: string;
}

export interface AgentLoadoutCapsuleWeapon extends AgentLoadoutCapsuleEntry {
  name?: string;
  type?: string;
  level?: string | number | null;
  potential?: string | number | null;
  attack?: number;
  skillLevels?: {
    readonly skill1?: number;
    readonly skill2?: number;
    readonly skill3?: number;
  };
}

export interface AgentLoadoutCapsuleEquipment extends AgentLoadoutCapsuleEntry {
  equipmentId?: string;
  name?: string;
  slotKey?: string;
  part?: string;
  effects?: readonly AgentLoadoutCapsuleEntry[];
}

export interface AgentLoadoutCapsuleSetBuff extends AgentLoadoutCapsuleEntry {
  effectId?: string;
  gearSetId?: string;
  gearSetName?: string;
  label?: string;
  effectKind?: string;
}

export interface AgentLoadoutCapsuleCharacter {
  id?: string;
  name?: string;
  element?: string | null;
  profession?: string | null;
  librarySource?: string | null;
}

/**
 * Structural subset shared by projected `DefLoadoutOperator` and the browser
 * `operatorConfigs` value.  Extra runtime fields are intentionally accepted.
 */
export interface AgentLoadoutProjectedOperatorCapsule {
  character?: AgentLoadoutCapsuleCharacter;
  characterId?: string;
  characterName?: string;
  weapon?: AgentLoadoutCapsuleWeapon | null;
  equipment?: readonly AgentLoadoutCapsuleEquipment[];
  setBuffs?: readonly AgentLoadoutCapsuleSetBuff[];
  operatorSkillLevels?: {
    readonly A?: string | number | null;
    readonly B?: string | number | null;
    readonly E?: string | number | null;
    readonly Q?: string | number | null;
    readonly Dot?: string | number | null;
  } | null;
  configured?: boolean;
}

/**
 * Accepts either one projected operator or a complete DefTeamLoadoutsV1-like
 * capsule.  Selection from `operators` is performed by stable character id.
 */
export interface AgentLoadoutCapsule extends AgentLoadoutProjectedOperatorCapsule {
  contract?: string;
  complete?: boolean;
  missingCharacterIds?: readonly string[];
  operators?: readonly AgentLoadoutProjectedOperatorCapsule[];
}

export interface AgentLoadoutCandidatePatch {
  weaponId?: string;
  equipment?: readonly {
    slotKey: AgentGearSlotKey;
    equipmentId: string;
  }[];
}

export interface AgentLoadoutMatch {
  source: 'weapon' | 'equipment' | 'setBuff';
  sourceId: string;
  path: string;
  typeKey: string;
  priorityKey: string;
  weight: number;
  contribution: number;
  category: string;
  conditional: boolean;
}

export interface AgentLoadoutConflict {
  path: string;
  reason: string;
  expected?: string;
  actual?: string;
}

export interface AgentLoadoutEvaluation {
  policy: typeof AGENT_LOADOUT_RECOMMENDATION_POLICY;
  status: 'READY' | 'PARTIAL' | 'NO_PROFILE';
  operator: AgentLoadoutOperatorResolution;
  score: number;
  dimensions: readonly AgentLoadoutDimensionScore[];
  matches: readonly AgentLoadoutMatch[];
  conflicts: readonly AgentLoadoutConflict[];
  unresolved: readonly AgentLoadoutUnresolvedItem[];
  catalogCoverage: AgentLoadoutCatalogCoverage;
}

export interface AgentLoadoutCompareDimensionDelta {
  key: string;
  a: number;
  b: number;
  delta: number;
}

export interface AgentLoadoutCompareResult {
  policy: typeof AGENT_LOADOUT_RECOMMENDATION_POLICY;
  status: 'A' | 'B' | 'TIED' | 'PARTIAL';
  operator: AgentLoadoutOperatorResolution;
  a: AgentLoadoutEvaluation;
  b: AgentLoadoutEvaluation;
  delta: number;
  deltaComponents: readonly AgentLoadoutCompareDimensionDelta[];
  limitation: 'same-profile-fact-key-coverage-only';
}

export interface AgentGearPieceRecommendation {
  slotKey: AgentGearSlotKey;
  id: string;
  name: string;
  gearSetId: string;
  gearSetName: string;
  part: string;
}

export interface AgentNamedSetRecommendationCandidate {
  id: string;
  name: string;
  rank: number;
  tied: boolean;
  score: number;
  pieces: Readonly<Record<AgentGearSlotKey, AgentGearPieceRecommendation>>;
  dimensions: readonly AgentLoadoutDimensionScore[];
  scoreComponents: readonly AgentLoadoutScoreComponent[];
  conditional: boolean;
  tradeoffs: readonly string[];
  unresolved: readonly AgentLoadoutUnresolvedItem[];
}

export interface AgentNamedSetRecommendation {
  policy: typeof AGENT_LOADOUT_RECOMMENDATION_POLICY;
  source: 'browser-sqlite-mirror';
  status: AgentLoadoutRecommendationState;
  operator: AgentLoadoutOperatorResolution;
  profileStatus: AgentLoadoutProfile['status'];
  requestedSetQuery: string;
  targetSet: { id: string; name: string } | null;
  candidates: readonly AgentNamedSetRecommendationCandidate[];
  catalogCoverage: AgentLoadoutCatalogCoverage;
  enumeratedCombinationCount: number;
  inspectedLeafCount: number;
  totalCombinationCount: number | null;
  combinationLimit: number;
  combinationsExhaustive: boolean;
  warnings: readonly string[];
  limitation: 'fact-key-coverage-not-damage-simulation';
}

export interface AgentDiscoveredSetRecommendationCandidate {
  id: string;
  name: string;
  rank: number;
  tied: boolean;
  score: number;
  bestCombination: AgentNamedSetRecommendationCandidate | null;
  combinationsEvaluated: number;
  inspectedLeafCount: number;
  totalCombinationCount: number | null;
  combinationLimit: number;
  combinationsExhaustive: boolean;
  unresolved: readonly AgentLoadoutUnresolvedItem[];
}

export interface AgentDiscoveredSetRecommendation {
  policy: typeof AGENT_LOADOUT_RECOMMENDATION_POLICY;
  source: 'browser-sqlite-mirror';
  status: AgentLoadoutRecommendationState;
  operator: AgentLoadoutOperatorResolution;
  profileStatus: AgentLoadoutProfile['status'];
  candidates: readonly AgentDiscoveredSetRecommendationCandidate[];
  evaluatedSetCount: number;
  candidateSetCount: number;
  traversalExhaustive: boolean;
  catalogCoverage: AgentLoadoutCatalogCoverage;
  warnings: readonly string[];
  limitation: 'fact-key-coverage-not-damage-simulation';
}

export interface AgentLoadoutGenericRecommendation {
  policy: typeof AGENT_LOADOUT_RECOMMENDATION_POLICY;
  source: 'browser-sqlite-mirror';
  operator: AgentLoadoutOperatorResolution;
  profile: AgentLoadoutProfile;
  weapons: AgentWeaponRecommendation;
  discoveredSets: AgentDiscoveredSetRecommendation;
}

export interface AgentNamedSetRecommendationOptions {
  allowDuplicateCompatibleAccessories?: boolean;
  limit?: number;
}

export interface AgentDiscoveredSetRecommendationOptions {
  allowDuplicateCompatibleAccessories?: boolean;
  /** Number of set candidates returned after all exposed sets are visited. */
  limit?: number;
  /** Hard per-set bound for legal 3+1 combinations. */
  combinationLimit?: number;
}

type CandidateEffect = {
  source: 'weapon' | 'equipment' | 'setBuff';
  sourceId: string;
  evidencePath: string;
  typeKey: string;
  category: string;
  valueMode?: string;
};

type CandidateFactCollection = {
  effects: CandidateEffect[];
  unresolved: AgentLoadoutUnresolvedItem[];
};

type ResolvedProfile = {
  catalog: AgentProductCatalog;
  profile: AgentLoadoutProfile;
};

type InternalSetCandidate = {
  candidate: AgentNamedSetRecommendationCandidate;
  unresolved: readonly AgentLoadoutUnresolvedItem[];
};

type SetCombination = Readonly<Record<AgentGearSlotKey, AgentEquipmentCatalogItem>>;

type SetCombinationEnumeration = {
  combinations: SetCombination[];
  enumeratedCount: number;
  inspectedLeafCount: number;
  totalCount: number | null;
  limit: number;
  exhaustive: boolean;
};

const GEAR_PART_BY_SLOT: Readonly<Record<AgentGearSlotKey, string>> = Object.freeze({
  armor: '护甲',
  glove: '护手',
  accessory1: '配件',
  accessory2: '配件',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function prepareCatalog(input: AgentLoadoutCatalogInput): AgentProductCatalog {
  if (isRecord(input) && TRUSTED_AGENT_LOADOUT_CATALOGS.has(input)) {
    return input as unknown as AgentProductCatalog;
  }
  const catalog = buildAgentProductCatalog(
    input as AgentProductCatalogInput,
    { limit: MAX_AGENT_PRODUCT_CATALOG_LIMIT },
  );
  TRUSTED_AGENT_LOADOUT_CATALOGS.add(catalog);
  return catalog;
}

function stableCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function stableIdCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function boundedCombinationLimit(value: number | undefined): number {
  return Math.min(
    MAX_AGENT_LOADOUT_COMBINATION_LIMIT,
    nonNegativeInteger(value, DEFAULT_AGENT_LOADOUT_COMBINATION_LIMIT),
  );
}

function sortedByIdAndName<T extends { id: string; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => stableCompare(left.name, right.name) || stableCompare(left.id, right.id));
}

function coverageEntry<T>(envelope: AgentCatalogEnvelope<T>): AgentLoadoutCatalogCoverageEntry {
  const exhaustive = envelope.query === ''
    && envelope.exhaustive
    && !envelope.truncated
    && envelope.queryCount === envelope.catalogCount;
  return {
    exhaustive,
    catalogCount: envelope.catalogCount,
    queryCount: envelope.queryCount,
    resultCount: envelope.resultCount,
    truncated: envelope.truncated,
  };
}

function getCoverage(catalog: AgentProductCatalog): AgentLoadoutCatalogCoverage {
  const domains = {
    operators: coverageEntry(catalog.operators),
    skills: coverageEntry(catalog.skills),
    weapons: coverageEntry(catalog.weapons),
    equipment: coverageEntry(catalog.equipment),
    gearSets: coverageEntry(catalog.gearSets),
  } satisfies Record<AgentLoadoutDomain, AgentLoadoutCatalogCoverageEntry>;
  return {
    overall: Object.values(domains).every((entry) => entry.exhaustive),
    domains,
  };
}

function catalogIdentityIssues(catalog: AgentProductCatalog): AgentLoadoutUnresolvedItem[] {
  const issues: AgentLoadoutUnresolvedItem[] = [];
  const domains: Array<[AgentLoadoutDomain, readonly { id: string }[]]> = [
    ['operators', catalog.operators.results],
    ['skills', catalog.skills.results],
    ['weapons', catalog.weapons.results],
    ['equipment', catalog.equipment.results],
    ['gearSets', catalog.gearSets.results],
  ];
  domains.forEach(([domain, items]) => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item.id, (counts.get(item.id) ?? 0) + 1));
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort(([left], [right]) => stableIdCompare(left, right))
      .forEach(([id, count]) => issues.push({
        path: `${domain}[${id}]`,
        reason: 'stable catalog id is duplicated; ambiguous records are excluded from recommendation authority',
        value: String(count),
      }));
  });
  return issues;
}

function unambiguousCatalogItems<T extends { id: string }>(items: readonly T[]): T[] {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(item.id, (counts.get(item.id) ?? 0) + 1));
  return items.filter((item) => counts.get(item.id) === 1);
}

function copyOperator(operator: AgentLoadoutOperatorFact): AgentLoadoutOperatorFact {
  return {
    ...operator,
    skillIds: [...operator.skillIds],
  };
}

function resolveOperator(catalog: AgentProductCatalog, query: string): AgentLoadoutOperatorResolution {
  const rawQuery = trimmed(query);
  const normalizedQuery = normalizeAgentProductQuery(rawQuery);
  const operators = sortedByIdAndName(catalog.operators.results);
  if (!normalizedQuery) {
    return {
      query: rawQuery,
      normalizedQuery,
      matchMode: 'none',
      ambiguous: false,
      candidates: [],
      operator: null,
    };
  }
  const exact = operators.filter((operator) => [operator.id, operator.name].some((value) => exactText(value) === exactText(rawQuery)));
  const normalized = operators.filter((operator) => [operator.id, operator.name].some((value) => normalizeAgentProductQuery(value) === normalizedQuery));
  const matches = exact.length > 0 ? exact : normalized;
  const matchMode: AgentCatalogMatchMode = matches.length === 0
    ? 'none'
    : matches.length > 1
      ? 'ambiguous'
      : exact.length > 0
        ? 'exact'
        : 'normalized';
  const candidates = matches.map(copyOperator);
  return {
    query: rawQuery,
    normalizedQuery,
    matchMode,
    ambiguous: matchMode === 'ambiguous',
    candidates,
    operator: candidates.length === 1 ? candidates[0]! : null,
  };
}

function normalizeFactLabel(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function resolveMappedKey(
  value: string,
  map: Readonly<Record<string, string>>,
): string | null {
  const normalized = normalizeFactLabel(value);
  for (const [candidate, key] of Object.entries(map)) {
    if (normalizeFactLabel(candidate) === normalized) return key;
  }
  return null;
}

function addPriority(
  priorities: Map<string, AgentLoadoutPriority>,
  input: {
    key: string;
    weight: number;
    reason: string;
    path: string;
    value: string | number;
  },
): void {
  const existing = priorities.get(input.key);
  if (!existing) {
    priorities.set(input.key, {
      key: input.key,
      dimension: input.key,
      weight: input.weight,
      reason: input.reason,
      evidence: {
        path: input.path,
        paths: [input.path],
        values: [input.value],
      },
    });
    return;
  }
  const paths = existing.evidence.paths.includes(input.path)
    ? existing.evidence.paths
    : [...existing.evidence.paths, input.path];
  const values = existing.evidence.values.includes(input.value)
    ? existing.evidence.values
    : [...existing.evidence.values, input.value];
  priorities.set(input.key, {
    ...existing,
    weight: existing.weight + input.weight,
    reason: `${existing.reason}；${input.reason}`,
    evidence: {
      path: existing.evidence.path,
      paths,
      values,
    },
  });
}

type AgentLoadoutElement = 'physical' | 'fire' | 'electric' | 'ice' | 'nature';

type AgentLoadoutApplicabilityFacts = {
  elements: ReadonlySet<AgentLoadoutElement>;
  skillTypeCounts: ReadonlyMap<string, number>;
};

function canonicalElement(value: string): AgentLoadoutElement | null {
  const normalized = normalizeFactLabel(value);
  const aliases: Readonly<Record<string, AgentLoadoutElement>> = {
    physical: 'physical',
    物理: 'physical',
    fire: 'fire',
    灼热: 'fire',
    electric: 'electric',
    电磁: 'electric',
    ice: 'ice',
    寒冷: 'ice',
    nature: 'nature',
    自然: 'nature',
  };
  return aliases[normalized] ?? null;
}

function buildApplicabilityFacts(
  operator: AgentLoadoutOperatorFact,
  skills: readonly AgentSkillCatalogItem[],
  skillTypeCounts: ReadonlyMap<string, number>,
): AgentLoadoutApplicabilityFacts {
  const elements = new Set<AgentLoadoutElement>();
  const operatorElement = canonicalElement(operator.element);
  if (operatorElement) elements.add(operatorElement);
  skills.forEach((skill) => skill.hits.forEach((hit) => {
    const element = canonicalElement(hit.element);
    if (element) elements.add(element);
  }));
  return { elements, skillTypeCounts };
}

function applicabilityMatches(
  rule: BuffTypeMatchRule,
  facts: AgentLoadoutApplicabilityFacts,
): boolean {
  switch (rule.kind) {
    case 'all':
      return true;
    case 'physical':
      return facts.elements.has('physical');
    case 'magic':
      return [...facts.elements].some((element) => element !== 'physical');
    case 'element':
      return facts.elements.has(rule.element);
    case 'skillType':
      return (facts.skillTypeCounts.get(rule.skillType) ?? 0) > 0;
    case 'skillTypes':
      return rule.skillTypes.some((skillType) => (facts.skillTypeCounts.get(skillType) ?? 0) > 0);
  }
}

function applicabilityWeight(
  rule: BuffTypeMatchRule,
  facts: AgentLoadoutApplicabilityFacts,
): number {
  if (rule.kind === 'skillType') {
    return AGENT_LOADOUT_PRIORITY_WEIGHTS.skill * (facts.skillTypeCounts.get(rule.skillType) ?? 0);
  }
  if (rule.kind === 'skillTypes') {
    return AGENT_LOADOUT_PRIORITY_WEIGHTS.allSkills * rule.skillTypes.reduce(
      (total, skillType) => total + (facts.skillTypeCounts.get(skillType) ?? 0),
      0,
    );
  }
  if (rule.kind === 'all') return AGENT_LOADOUT_PRIORITY_WEIGHTS.genericDamage;
  return AGENT_LOADOUT_PRIORITY_WEIGHTS.element;
}

function addMatchedPriority(
  priorities: Map<string, AgentLoadoutPriority>,
  key: string,
  rule: BuffTypeMatchRule,
  facts: AgentLoadoutApplicabilityFacts,
  operatorPath: string,
): void {
  if (!applicabilityMatches(rule, facts)) return;
  addPriority(priorities, {
    key,
    weight: applicabilityWeight(rule, facts),
    reason: `${key} 的正式适用规则 ${rule.kind} 与当前干员的元素/技能事实匹配；这里只记录类型覆盖。`,
    path: rule.kind === 'skillType' || rule.kind === 'skillTypes'
      ? `${operatorPath}.skillIds`
      : `${operatorPath}.element`,
    value: rule.kind,
  });
}

function profileStatusFrom(
  resolution: AgentLoadoutOperatorResolution,
  coverage: AgentLoadoutCatalogCoverage,
  unresolved: readonly AgentLoadoutUnresolvedItem[],
): AgentLoadoutProfile['status'] {
  if (resolution.matchMode === 'ambiguous') return 'OPERATOR_AMBIGUOUS';
  if (!resolution.operator) return 'OPERATOR_UNRESOLVED';
  return coverage.overall && unresolved.length === 0 ? 'READY' : 'PARTIAL';
}

/** Build a profile strictly from current browser 1.8 operator and skill facts. */
export function deriveProfile(
  input: AgentLoadoutCatalogInput,
  operatorQuery: string,
): AgentLoadoutProfile {
  const catalog = prepareCatalog(input);
  const coverage = getCoverage(catalog);
  const resolution = resolveOperator(catalog, operatorQuery);
  const unresolved: AgentLoadoutUnresolvedItem[] = catalogIdentityIssues(catalog);
  const warnings: string[] = [];
  const priorities = new Map<string, AgentLoadoutPriority>();

  if (!resolution.operator) {
    unresolved.push({
      path: 'operators',
      reason: resolution.ambiguous ? 'operator query is ambiguous' : 'operator was not resolved exactly or by normalized value',
      value: trimmed(operatorQuery),
    });
    return {
      policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
      source: 'browser-sqlite-mirror',
      operatorQuery: trimmed(operatorQuery),
      status: profileStatusFrom(resolution, coverage, unresolved),
      resolution,
      operator: null,
      priorities: [],
      priorityKeys: [],
      skillButtonDistribution: {},
      knownSkillCount: 0,
      expectedSkillCount: 0,
      catalogCoverage: coverage,
      unresolved,
      warnings: ['未解析干员时不生成任何适配度优先级。'],
    };
  }

  const operator = resolution.operator;
  const operatorPath = `operators[${operator.id}]`;
  addPriority(priorities, {
    key: 'atkPercentBoost',
    weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.genericAttack,
    reason: '已精确解析战斗干员；atkPercentBoost仅作为通用攻击类型事实覆盖，不代表实际伤害收益。',
    path: `${operatorPath}.id`,
    value: operator.id,
  });
  addPriority(priorities, {
    key: 'flatAtk',
    weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.genericAttack,
    reason: '已精确解析战斗干员；flatAtk仅作为通用攻击类型事实覆盖，不与原始攻击数值相加。',
    path: `${operatorPath}.id`,
    value: operator.id,
  });
  addPriority(priorities, {
    key: 'atk',
    weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.genericAttack,
    reason: '已精确解析战斗干员；atk 仅作为通用攻击类型事实覆盖，不与原始攻击数值相加。',
    path: `${operatorPath}.id`,
    value: operator.id,
  });
  const mainStatKey = resolveMappedKey(operator.mainStat, AGENT_LOADOUT_PRIORITY_KEY_MAP.abilities);
  if (mainStatKey) {
    addPriority(priorities, {
      key: mainStatKey,
      weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.mainStat,
      reason: `主能力为${operator.mainStat}，候选的${mainStatKey}直接覆盖主能力事实。`,
      path: `${operatorPath}.mainStat`,
      value: operator.mainStat,
    });
  } else {
    unresolved.push({ path: `${operatorPath}.mainStat`, reason: 'unknown mainStat mapping; no effect key guessed', value: operator.mainStat });
  }
  if (operator.mainStat) {
    addPriority(priorities, {
      key: AGENT_LOADOUT_PRIORITY_KEY_MAP.roles.main,
      weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.mainStatRole,
      reason: '当前事实明确存在主能力栏位，候选的mainStatBoost覆盖主能力泛化维度。',
      path: `${operatorPath}.mainStat`,
      value: operator.mainStat,
    });
  }

  const subStatKey = resolveMappedKey(operator.subStat, AGENT_LOADOUT_PRIORITY_KEY_MAP.abilities);
  if (subStatKey) {
    addPriority(priorities, {
      key: subStatKey,
      weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.subStat,
      reason: `副能力为${operator.subStat}，候选的${subStatKey}直接覆盖副能力事实。`,
      path: `${operatorPath}.subStat`,
      value: operator.subStat,
    });
  } else {
    unresolved.push({ path: `${operatorPath}.subStat`, reason: 'unknown subStat mapping; no effect key guessed', value: operator.subStat });
  }
  if (operator.subStat) {
    addPriority(priorities, {
      key: AGENT_LOADOUT_PRIORITY_KEY_MAP.roles.sub,
      weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.subStatRole,
      reason: '当前事实明确存在副能力栏位，候选的subStatBoost覆盖副能力泛化维度。',
      path: `${operatorPath}.subStat`,
      value: operator.subStat,
    });
  }

  const skills = sortedByIdAndName(
    catalog.skills.results.filter((skill) => skill.operatorId === operator.id),
  );
  const skillsById = new Map(skills.map((skill) => [skill.skillId, skill]));
  const distribution = new Map<string, number>();
  const expectedSkillIds = [...operator.skillIds].sort(stableCompare);
  expectedSkillIds.forEach((skillId) => {
    if (!skillsById.has(skillId)) {
      unresolved.push({ path: `${operatorPath}.skills[${skillId}]`, reason: 'skill fact is missing from the current catalog', value: skillId });
    }
  });
  skills.forEach((skill) => {
    const buttonType = trimmed(skill.buttonType);
    distribution.set(buttonType, (distribution.get(buttonType) ?? 0) + 1);
    if (skill.hitsTruncated) {
      unresolved.push({
        path: `skills[${skill.id}].hits`,
        reason: 'skill hit facts were truncated; applicability cannot be declared exhaustive',
      });
    }
  });
  [...distribution.entries()]
    .sort(([left], [right]) => stableCompare(left, right))
    .forEach(([buttonType]) => {
      const evidencePaths = skills
        .filter((skill) => skill.buttonType === buttonType)
        .map((skill) => `skills[${skill.id}].buttonType`)
        .sort(stableCompare);
      if (!['A', 'B', 'E', 'Q', 'Dot'].includes(buttonType)) {
        unresolved.push({ path: evidencePaths[0] ?? `${operatorPath}.skills`, reason: 'unknown buttonType mapping; no skill effect key guessed', value: buttonType });
      }
    });

  const applicability = buildApplicabilityFacts(operator, skills, distribution);
  if (applicability.elements.size === 0) {
    unresolved.push({
      path: `${operatorPath}.element`,
      reason: 'unknown element mapping; no damage-zone applicability was guessed',
      value: operator.element,
    });
  }
  [...BUFF_TYPE_REGISTRY.values()]
    .sort((left, right) => stableIdCompare(left.type, right.type))
    .forEach((entry) => addMatchedPriority(
      priorities,
      entry.type,
      entry.match,
      applicability,
      operatorPath,
    ));
  Object.entries(ADDITIONAL_DAMAGE_MATCH_RULES)
    .sort(([left], [right]) => stableIdCompare(left, right))
    .forEach(([key, rule]) => addMatchedPriority(
      priorities,
      key,
      rule,
      applicability,
      operatorPath,
    ));
  addPriority(priorities, {
    key: 'allStatBoost',
    weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.mainStatRole + AGENT_LOADOUT_PRIORITY_WEIGHTS.subStatRole,
    reason: 'allStatBoost 同时覆盖当前明确的主能力和副能力类型，但不读取或累加原始数值。',
    path: `${operatorPath}.mainStat`,
    value: `${operator.mainStat}/${operator.subStat}`,
  });
  if (applicability.elements.has('fire') || applicability.elements.has('nature')) {
    addPriority(priorities, {
      key: 'fireNatureDmgBonus',
      weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.element,
      reason: '当前元素/技能事实命中灼热或自然，fireNatureDmgBonus 适用。',
      path: `${operatorPath}.element`,
      value: operator.element,
    });
  }
  if (applicability.elements.has('ice') || applicability.elements.has('electric')) {
    addPriority(priorities, {
      key: 'iceElectricDmgBonus',
      weight: AGENT_LOADOUT_PRIORITY_WEIGHTS.element,
      reason: '当前元素/技能事实命中寒冷或电磁，iceElectricDmgBonus 适用。',
      path: `${operatorPath}.element`,
      value: operator.element,
    });
  }

  if (skills.length < expectedSkillIds.length) {
    warnings.push('技能目录不完整：缺失技能不被推断，也不会从名称补齐。');
  }
  if (!coverage.domains.skills.exhaustive) warnings.push('技能目录被查询或截断，技能适配度仅对已暴露事实负责。');
  if (!coverage.overall) warnings.push('一个或多个产品目录域不是完整 1.8 目录，推荐结果会降级为 PARTIAL。');
  if (unresolved.length > 0) warnings.push('存在未知或缺失字段；服务没有为这些字段猜测映射。');

  const sortedPriorities = [...priorities.values()].sort((left, right) => (
    stableCompare(left.key, right.key)
  ));
  const skillButtonDistribution = Object.fromEntries(
    [...distribution.entries()].sort(([left], [right]) => stableCompare(left, right)),
  );
  return {
    policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
    source: 'browser-sqlite-mirror',
    operatorQuery: trimmed(operatorQuery),
    status: profileStatusFrom(resolution, coverage, unresolved),
    resolution,
    operator: copyOperator(operator),
    priorities: sortedPriorities,
    priorityKeys: sortedPriorities.map((priority) => priority.key),
    skillButtonDistribution,
    knownSkillCount: skills.length,
    expectedSkillCount: expectedSkillIds.length,
    catalogCoverage: coverage,
    unresolved,
    warnings,
  };
}

function resolveProfile(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
): ResolvedProfile {
  const catalog = prepareCatalog(input);
  const operatorQuery = typeof operatorOrProfile === 'string'
    ? operatorOrProfile
    : operatorOrProfile.operatorQuery;
  // Re-derive against the catalog supplied to this call.  A profile is a
  // convenient handle, never an authority that can carry stale facts from a
  // different catalog generation.
  return { catalog, profile: deriveProfile(catalog, operatorQuery) };
}

function categoryFactor(category: string): number | null {
  const factor = SCORE_CATEGORY_FACTORS[category];
  return factor === undefined ? null : factor;
}

function conditionFor(category: string): 'always' | 'conditional' {
  return category === 'condition' || category === 'countable' ? 'conditional' : 'always';
}

function buildTradeoff(category: string, valueMode: string | undefined): string | null {
  const tradeoffs: string[] = [];
  if (category === 'condition') tradeoffs.push('条件效果：不会被当作默认常驻效果。');
  if (category === 'countable') tradeoffs.push('计层效果：需要实际层数，服务不把层数数值带入评分。');
  if (valueMode === 'derived') tradeoffs.push('派生数值：当前 catalog 未暴露派生来源，未进行数值模拟。');
  if (valueMode === 'multiplier') tradeoffs.push('乘算语义：只记录 typeKey 命中，不与其他类别原始数值相加。');
  return tradeoffs.length > 0 ? tradeoffs.join('；') : null;
}

function scoreEffects(profile: AgentLoadoutProfile, effects: readonly CandidateEffect[]): AgentLoadoutScore {
  const priorityMap = new Map(profile.priorities.map((priority) => [priority.key, priority]));
  const matchesByPriority = new Map<string, Array<{
    effect: CandidateEffect;
    priority: AgentLoadoutPriority;
    factor: number;
  }>>();
  const scoreComponents: AgentLoadoutScoreComponent[] = [];
  const unresolved: AgentLoadoutUnresolvedItem[] = [];
  let conditional = false;

  [...effects]
    .sort((left, right) => stableIdCompare(left.evidencePath, right.evidencePath) || stableIdCompare(left.typeKey, right.typeKey))
    .forEach((effect) => {
      const typeKey = trimmed(effect.typeKey);
      if (!typeKey) {
        unresolved.push({ path: effect.evidencePath, reason: 'effect typeKey is missing' });
        return;
      }
      if (!KNOWN_1_8_EFFECT_TYPE_KEYS.has(typeKey)) {
        unresolved.push({ path: effect.evidencePath, reason: 'effect typeKey is not in the audited 1.8 mapping', value: typeKey });
        return;
      }
      const priority = priorityMap.get(typeKey);
      if (!priority) {
        if (
          !EXPLICITLY_NON_OFFENSIVE_TYPE_KEYS.has(typeKey)
          && !EXPLICITLY_APPLICABILITY_MODELED_TYPE_KEYS.has(typeKey)
        ) {
          unresolved.push({
            path: effect.evidencePath,
            reason: 'known effect applicability is not established by the current operator facts; it was not silently ignored',
            value: typeKey,
          });
        }
        return;
      }
      const factor = categoryFactor(effect.category);
      if (factor === null) {
        unresolved.push({ path: effect.evidencePath, reason: 'effect category is not a scored 1.8 category', value: effect.category });
        return;
      }
      if (effect.valueMode === 'derived' || effect.valueMode === 'multiplier') {
        unresolved.push({
          path: effect.evidencePath,
          reason: effect.valueMode === 'derived'
            ? 'derived effect source is not exposed by the current catalog'
            : 'multiplier coefficient is not exposed by the current catalog',
          value: effect.valueMode,
        });
      }
      matchesByPriority.set(priority.key, [
        ...(matchesByPriority.get(priority.key) ?? []),
        { effect, priority, factor },
      ]);
    });

  const dimensions = profile.priorities.map((priority) => {
    const matches = [...(matchesByPriority.get(priority.key) ?? [])].sort((left, right) => (
      right.factor - left.factor
      || stableIdCompare(left.effect.evidencePath, right.effect.evidencePath)
      || stableIdCompare(left.effect.sourceId, right.effect.sourceId)
    ));
    const selected = matches[0];
    const contribution = selected ? priority.weight * selected.factor : 0;
    const conditionalMatchCount = matches.filter(({ effect }) => conditionFor(effect.category) === 'conditional').length;
    if (selected) {
      const condition = conditionFor(selected.effect.category);
      if (condition === 'conditional') conditional = true;
      scoreComponents.push({
        source: selected.effect.source,
        sourceId: selected.effect.sourceId,
        evidencePath: selected.effect.evidencePath,
        typeKey: selected.effect.typeKey,
        priorityKey: priority.key,
        weight: priority.weight,
        category: selected.effect.category,
        contribution,
        condition,
        tradeoff: buildTradeoff(selected.effect.category, selected.effect.valueMode),
      });
    }
    return {
      key: priority.key,
      weight: priority.weight,
      matchedEffectCount: matches.length,
      contribution,
      conditionalMatchCount,
    } satisfies AgentLoadoutDimensionScore;
  });
  return {
    total: dimensions.reduce((total, dimension) => total + dimension.contribution, 0),
    dimensions,
    scoreComponents,
    conditional,
    incomplete: unresolved.length > 0,
    unresolved,
  };
}

function tradeoffsFromScore(score: AgentLoadoutScore): string[] {
  return [...new Set(score.scoreComponents.map((component) => component.tradeoff).filter((value): value is string => Boolean(value)))].sort(stableCompare);
}

function scoreFactCollection(profile: AgentLoadoutProfile, facts: CandidateFactCollection): AgentLoadoutScore {
  const score = scoreEffects(profile, facts.effects);
  if (facts.unresolved.length === 0) return score;
  return {
    ...score,
    incomplete: true,
    unresolved: [...facts.unresolved, ...score.unresolved].sort((left, right) => (
      stableCompare(left.path, right.path) || stableCompare(left.reason, right.reason)
    )),
  };
}

function stableCandidateOrder(left: { score: number; id: string }, right: { score: number; id: string }): number {
  return right.score - left.score || stableIdCompare(left.id, right.id);
}

function assignSharedRanks<T extends { score: number; id: string }>(
  items: readonly T[],
): Array<T & { rank: number; tied: boolean }> {
  const sorted = [...items].sort(stableCandidateOrder);
  const scoreCounts = new Map<number, number>();
  sorted.forEach((item) => scoreCounts.set(item.score, (scoreCounts.get(item.score) ?? 0) + 1));
  let rank = 0;
  let previousScore: number | null = null;
  return sorted.map((item, index) => {
    if (previousScore === null || item.score !== previousScore) rank = index + 1;
    previousScore = item.score;
    return {
      ...item,
      rank,
      tied: (scoreCounts.get(item.score) ?? 0) > 1,
    };
  });
}

function statusForCandidates(
  profile: AgentLoadoutProfile,
  candidates: readonly { score: number; unresolved: readonly AgentLoadoutUnresolvedItem[] }[],
  catalogCoverage: AgentLoadoutCatalogCoverage,
): AgentLoadoutRecommendationState {
  if (profile.status === 'OPERATOR_AMBIGUOUS' || profile.status === 'OPERATOR_UNRESOLVED') return 'NO_PLAN';
  if (candidates.length === 0 || candidates[0]!.score <= 0) {
    return profile.status === 'PARTIAL' || !catalogCoverage.overall ? 'PARTIAL' : 'NO_PLAN';
  }
  if (
    profile.status === 'PARTIAL'
    || !catalogCoverage.overall
    || candidates.some((candidate) => candidate.unresolved.length > 0)
  ) return 'PARTIAL';
  const topScore = candidates[0]!.score;
  return candidates.filter((candidate) => candidate.score === topScore).length > 1 ? 'TIED' : 'READY';
}

function buildWeaponFacts(weapon: AgentWeaponCatalogItem): CandidateFactCollection {
  const effects: CandidateEffect[] = [];
  const unresolved: AgentLoadoutUnresolvedItem[] = [];
  weapon.skills.forEach((skill) => {
    const skillPath = `weapons[${weapon.id}].skills[${skill.id}]`;
    const statType = trimmed(skill.statType);
    if (statType && normalizeFactLabel(statType) !== 'special') {
      const typeKey = resolveMappedKey(statType, AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP.weaponStatTypes);
      if (typeKey) {
        effects.push({
          source: 'weapon',
          sourceId: weapon.id,
          evidencePath: `${skillPath}.statType`,
          typeKey,
          category: 'passive',
        });
      } else {
        unresolved.push({
          path: `${skillPath}.statType`,
          reason: 'weapon statType is outside the audited canonical mapping; no label or name inference was used',
          value: statType,
        });
      }
    }
    skill.effects.forEach((effect: AgentWeaponEffectCatalogItem) => effects.push({
      source: 'weapon',
      sourceId: weapon.id,
      evidencePath: `${skillPath}.effects[${effect.id}]`,
      typeKey: effect.typeKey,
      category: effect.category,
      valueMode: effect.valueMode,
    }));
    if (skill.effectsTruncated) {
      unresolved.push({
        path: `${skillPath}.effects`,
        reason: 'weapon skill effects were truncated by the current catalog',
      });
    }
  });
  return { effects, unresolved };
}

/** Recommend only weapons whose catalog type exactly matches the operator type. */
export function recommendWeapons(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
): AgentWeaponRecommendation {
  const { catalog, profile } = resolveProfile(input, operatorOrProfile);
  const coverage = getCoverage(catalog);
  const operator = profile.resolution;
  if (!profile.operator) {
    return {
      policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
      source: 'browser-sqlite-mirror',
      status: 'NO_PLAN',
      operator,
      profileStatus: profile.status,
      compatibleCount: 0,
      excludedIncompatibleCount: 0,
      candidates: [],
      catalogCoverage: coverage,
      warnings: [...profile.warnings],
      limitation: 'fact-key-coverage-not-damage-simulation',
    };
  }
  const operatorWeaponType = normalizeAgentProductQuery(profile.operator.weaponType);
  const weapons = unambiguousCatalogItems(catalog.weapons.results)
    .sort((left, right) => stableIdCompare(left.id, right.id));
  const compatible = operatorWeaponType
    ? weapons.filter((weapon) => normalizeAgentProductQuery(weapon.type) === operatorWeaponType)
    : [];
  const scored = compatible.map((weapon) => {
    const score = scoreFactCollection(profile, buildWeaponFacts(weapon));
    return { weapon, score };
  });
  const candidates = assignSharedRanks(scored.map(({ weapon, score }) => ({
    id: weapon.id,
    name: weapon.name,
    type: weapon.type,
    rank: 0,
    tied: false,
    score: score.total,
    dimensions: score.dimensions,
    scoreComponents: score.scoreComponents,
    conditional: score.conditional,
    tradeoffs: tradeoffsFromScore(score),
    unresolved: score.unresolved,
  } satisfies AgentWeaponRecommendationCandidate)));
  const warnings = [...profile.warnings];
  if (!operatorWeaponType) warnings.push('干员 weaponType 缺失，未猜测兼容武器。');
  if (compatible.length === 0 && operatorWeaponType) warnings.push('当前完整目录中没有 typeKey/weaponType 精确兼容的武器。');
  return {
    policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
    source: 'browser-sqlite-mirror',
    status: compatible.length === 0
      ? (!coverage.overall || profile.status === 'PARTIAL' ? 'PARTIAL' : 'NO_PLAN')
      : statusForCandidates(profile, candidates, coverage),
    operator,
    profileStatus: profile.status,
    compatibleCount: compatible.length,
    excludedIncompatibleCount: weapons.length - compatible.length,
    candidates,
    catalogCoverage: coverage,
    warnings,
    limitation: 'fact-key-coverage-not-damage-simulation',
  };
}

function resolveGearSet(catalog: AgentProductCatalog, query: string): {
  state: 'READY' | 'SET_QUERY_REQUIRED' | 'SET_NOT_FOUND' | 'SET_QUERY_AMBIGUOUS';
  set: AgentGearSetCatalogItem | null;
  normalizedQuery: string;
} {
  const rawQuery = trimmed(query);
  const normalizedQuery = normalizeAgentProductQuery(rawQuery);
  if (!normalizedQuery) return { state: 'SET_QUERY_REQUIRED', set: null, normalizedQuery };
  const sets = sortedByIdAndName(catalog.gearSets.results);
  const exact = sets.filter((set) => [set.id, set.name].some((value) => exactText(value) === exactText(rawQuery)));
  const normalized = sets.filter((set) => [set.id, set.name].some((value) => normalizeAgentProductQuery(value) === normalizedQuery));
  const matches = exact.length > 0 ? exact : normalized;
  if (matches.length === 0) return { state: 'SET_NOT_FOUND', set: null, normalizedQuery };
  if (matches.length > 1) return { state: 'SET_QUERY_AMBIGUOUS', set: null, normalizedQuery };
  return { state: 'READY', set: matches[0]!, normalizedQuery };
}

function sortedEquipment(catalog: AgentProductCatalog): AgentEquipmentCatalogItem[] {
  return unambiguousCatalogItems(catalog.equipment.results)
    .sort((left, right) => stableIdCompare(left.id, right.id));
}

function distinctPieceIds(pieces: readonly AgentEquipmentCatalogItem[], allowDuplicateAccessories: boolean): boolean {
  const byId = new Map<string, AgentEquipmentCatalogItem[]>();
  pieces.forEach((piece) => byId.set(piece.id, [...(byId.get(piece.id) ?? []), piece]));
  return [...byId.values()].every((sameId) => (
    sameId.length === 1 || (allowDuplicateAccessories && sameId.every((piece) => piece.part === '配件'))
  ));
}

function enumerateSetCombinations(
  targetSet: AgentGearSetCatalogItem,
  equipment: readonly AgentEquipmentCatalogItem[],
  allowDuplicateAccessories: boolean,
  requestedLimit: number | undefined,
): SetCombinationEnumeration {
  const limit = boundedCombinationLimit(requestedLimit);
  const targetEquipmentIds = new Set(targetSet.equipmentIds);
  const targetItems = equipment
    .filter((item) => targetEquipmentIds.has(item.id) && item.gearSetId === targetSet.id)
    .sort((left, right) => stableIdCompare(left.id, right.id));
  const offItems = equipment
    .filter((item) => item.gearSetId !== targetSet.id)
    .sort((left, right) => stableIdCompare(left.id, right.id));
  const byPart = (part: string) => targetItems.filter((item) => item.part === part);
  const combinations: SetCombination[] = [];
  const seenCompositions = new Set<string>();
  let inspectedLeafCount = 0;
  let exhaustive = true;
  const inspectionLimit = Math.max(limit, Math.min(262_144, limit * 64));

  const canAppend = (
    selected: readonly AgentEquipmentCatalogItem[],
    piece: AgentEquipmentCatalogItem,
  ): boolean => {
    const duplicates = selected.filter((entry) => entry.id === piece.id);
    if (duplicates.length === 0) return true;
    return allowDuplicateAccessories
      && piece.part === '配件'
      && duplicates.every((entry) => entry.part === '配件');
  };

  for (const offSlot of AGENT_GEAR_SLOT_ORDER) {
    const targetSlots = AGENT_GEAR_SLOT_ORDER.filter((slot) => slot !== offSlot);
    const targetLists = targetSlots.map((slot) => byPart(GEAR_PART_BY_SLOT[slot]));
    const offCandidates = offItems.filter((item) => item.part === GEAR_PART_BY_SLOT[offSlot]);
    if (targetLists.some((list) => list.length === 0) || offCandidates.length === 0) continue;
    const visit = (index: number, selected: AgentEquipmentCatalogItem[]): boolean => {
      if (index === targetLists.length) {
        for (const offPiece of offCandidates) {
          if (inspectedLeafCount >= inspectionLimit) {
            exhaustive = false;
            return false;
          }
          inspectedLeafCount += 1;
          if (!canAppend(selected, offPiece)) continue;
          const pieces = [...selected, offPiece];
          if (!distinctPieceIds(pieces, allowDuplicateAccessories)) continue;
          const compositionKey = pieces
            .map((piece) => piece.id)
            .sort(stableIdCompare)
            .join('\u0000');
          if (seenCompositions.has(compositionKey)) continue;
          seenCompositions.add(compositionKey);
          if (combinations.length >= limit) {
            exhaustive = false;
            return false;
          }
          const bySlot: Partial<Record<AgentGearSlotKey, AgentEquipmentCatalogItem>> = { [offSlot]: offPiece };
          targetSlots.forEach((slot, selectedIndex) => { bySlot[slot] = selected[selectedIndex]!; });
          combinations.push(Object.fromEntries(AGENT_GEAR_SLOT_ORDER.map((slot) => [slot, bySlot[slot]!])) as Readonly<Record<AgentGearSlotKey, AgentEquipmentCatalogItem>>);
        }
        return true;
      }
      for (const piece of targetLists[index]!) {
        if (!canAppend(selected, piece)) continue;
        if (!visit(index + 1, [...selected, piece])) return false;
      }
      return true;
    };
    if (!visit(0, [])) break;
  }
  return {
    combinations,
    enumeratedCount: combinations.length,
    inspectedLeafCount,
    totalCount: exhaustive ? combinations.length : null,
    limit,
    exhaustive,
  };
}

function buildEquipmentFacts(piece: AgentEquipmentCatalogItem): CandidateFactCollection {
  const effects: CandidateEffect[] = [];
  const unresolved: AgentLoadoutUnresolvedItem[] = [];
  if (piece.fixedStat) {
    const typeKey = resolveMappedKey(
      piece.fixedStat.typeKey,
      AGENT_LOADOUT_CANONICAL_TYPE_KEY_MAP.equipmentFixedStats,
    );
    if (typeKey) {
      effects.push({
        source: 'equipment',
        sourceId: piece.id,
        evidencePath: `equipment[${piece.id}].fixedStat.typeKey`,
        typeKey,
        category: 'passive',
      });
    } else {
      unresolved.push({
        path: `equipment[${piece.id}].fixedStat.typeKey`,
        reason: 'equipment fixedStat is outside the audited canonical mapping',
        value: piece.fixedStat.typeKey,
      });
    }
  }
  piece.effects.forEach((effect) => effects.push({
    source: 'equipment',
    sourceId: piece.id,
    evidencePath: `equipment[${piece.id}].effects[${effect.id}]`,
    typeKey: effect.typeKey,
    category: effect.category,
  }));
  return { effects, unresolved };
}

function buildSetBuffEffects(targetSet: AgentGearSetCatalogItem): CandidateEffect[] {
  return targetSet.threePieceBuffs.map((buff: AgentGearSetBuffCatalogItem) => ({
    source: 'setBuff' as const,
    sourceId: targetSet.id,
    evidencePath: `gearSets[${targetSet.id}].threePieceBuffs[${buff.id}]`,
    typeKey: buff.typeKey,
    category: buff.category,
    valueMode: buff.valueMode,
  }));
}

function createSetCandidate(
  profile: AgentLoadoutProfile,
  targetSet: AgentGearSetCatalogItem,
  pieces: Readonly<Record<AgentGearSlotKey, AgentEquipmentCatalogItem>>,
): InternalSetCandidate {
  const equipmentFacts = AGENT_GEAR_SLOT_ORDER.map((slot) => buildEquipmentFacts(pieces[slot]!));
  const score = scoreFactCollection(profile, {
    effects: [
      ...buildSetBuffEffects(targetSet),
      ...equipmentFacts.flatMap((facts) => facts.effects),
    ],
    unresolved: equipmentFacts.flatMap((facts) => facts.unresolved),
  });
  const id = `${targetSet.id}:${AGENT_GEAR_SLOT_ORDER.map((slot) => `${slot}:${pieces[slot]!.id}`).join('|')}`;
  const publicPieces = Object.fromEntries(AGENT_GEAR_SLOT_ORDER.map((slot) => {
    const piece = pieces[slot]!;
    return [slot, {
      slotKey: slot,
      id: piece.id,
      name: piece.name,
      gearSetId: piece.gearSetId,
      gearSetName: piece.gearSetName,
      part: piece.part,
    } satisfies AgentGearPieceRecommendation];
  })) as Readonly<Record<AgentGearSlotKey, AgentGearPieceRecommendation>>;
  return {
    candidate: {
      id,
      name: `${targetSet.name} 3+1`,
      rank: 0,
      tied: false,
      score: score.total,
      pieces: publicPieces,
      dimensions: score.dimensions,
      scoreComponents: score.scoreComponents,
      conditional: score.conditional,
      tradeoffs: tradeoffsFromScore(score),
      unresolved: [...score.unresolved],
    },
    unresolved: score.unresolved,
  };
}

function buildNamedSetInternal(
  catalog: AgentProductCatalog,
  profile: AgentLoadoutProfile,
  setQuery: string,
  options: AgentNamedSetRecommendationOptions = {},
): {
  resolution: ReturnType<typeof resolveGearSet>;
  candidates: AgentNamedSetRecommendationCandidate[];
  enumeratedCombinationCount: number;
  inspectedLeafCount: number;
  totalCombinationCount: number | null;
  combinationLimit: number;
  combinationsExhaustive: boolean;
  factsComplete: boolean;
  warnings: string[];
} {
  const resolution = resolveGearSet(catalog, setQuery);
  if (!resolution.set) return {
    resolution,
    candidates: [],
    enumeratedCombinationCount: 0,
    inspectedLeafCount: 0,
    totalCombinationCount: null,
    combinationLimit: boundedCombinationLimit(options.limit),
    combinationsExhaustive: false,
    factsComplete: false,
    warnings: [],
  };
  const targetSet = resolution.set;
  const equipment = sortedEquipment(catalog);
  const targetEquipmentIds = new Set(targetSet.equipmentIds);
  const availableTargetIds = new Set(equipment.filter((item) => targetEquipmentIds.has(item.id) && item.gearSetId === targetSet.id).map((item) => item.id));
  const availableTargetCount = equipment.filter((item) => item.gearSetId === targetSet.id).length;
  const missingTargetIds = targetSet.equipmentIds.filter((id) => !availableTargetIds.has(id));
  const enumeration = enumerateSetCombinations(
    targetSet,
    equipment,
    options.allowDuplicateCompatibleAccessories === true,
    options.limit,
  );
  const factsIncomplete = missingTargetIds.length > 0
    || targetSet.equipmentIds.length !== targetSet.equipmentCount
    || availableTargetCount !== targetSet.equipmentCount;
  const scored = enumeration.combinations
    .map((pieces) => createSetCandidate(profile, targetSet, pieces))
    .sort((left, right) => stableCandidateOrder(
      { score: left.candidate.score, id: left.candidate.id },
      { score: right.candidate.score, id: right.candidate.id },
    ));
  const candidates = assignSharedRanks(scored.map((entry) => ({
    ...entry.candidate,
    rank: 0,
    tied: false,
  })));
  const warnings: string[] = [];
  if (missingTargetIds.length > 0) warnings.push(`套装缺少 ${missingTargetIds.length} 件当前目录装备事实，未猜测补齐。`);
  if (targetSet.equipmentIds.length !== targetSet.equipmentCount) warnings.push('套装 equipmentCount 与 equipmentIds 不一致，未猜测补齐。');
  if (!enumeration.exhaustive) warnings.push(`组合遍历在 ${enumeration.limit} 个唯一合法候选或 ${enumeration.inspectedLeafCount} 个受检叶节点后停止，组合总数未知，结果只能标记 PARTIAL。`);
  if (options.limit !== undefined && options.limit > MAX_AGENT_LOADOUT_COMBINATION_LIMIT) warnings.push(`组合 limit 已收紧到硬上限 ${MAX_AGENT_LOADOUT_COMBINATION_LIMIT}。`);
  return {
    resolution,
    candidates,
    enumeratedCombinationCount: enumeration.enumeratedCount,
    inspectedLeafCount: enumeration.inspectedLeafCount,
    totalCombinationCount: enumeration.totalCount,
    combinationLimit: enumeration.limit,
    combinationsExhaustive: !factsIncomplete && enumeration.exhaustive,
    factsComplete: !factsIncomplete,
    warnings,
  };
}

/** Recommend legal 3+1 combinations for one exactly resolved set. */
export function recommendNamedSet(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
  setQuery: string,
  options: AgentNamedSetRecommendationOptions = {},
): AgentNamedSetRecommendation {
  const { catalog, profile } = resolveProfile(input, operatorOrProfile);
  const coverage = getCoverage(catalog);
  const built = buildNamedSetInternal(catalog, profile, setQuery, options);
  const warnings = [...profile.warnings, ...built.warnings];
  if (built.resolution.state !== 'READY') {
    warnings.push(`套装解析状态：${built.resolution.state}。`);
  }
  const status = built.resolution.state !== 'READY'
    ? (!coverage.overall ? 'PARTIAL' : 'NO_PLAN')
    : !built.combinationsExhaustive
      ? 'PARTIAL'
      : statusForCandidates(profile, built.candidates, coverage);
  const combinationsExhaustive = built.combinationsExhaustive && coverage.overall;
  return {
    policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
    source: 'browser-sqlite-mirror',
    status,
    operator: profile.resolution,
    profileStatus: profile.status,
    requestedSetQuery: trimmed(setQuery),
    targetSet: built.resolution.set ? { id: built.resolution.set.id, name: built.resolution.set.name } : null,
    candidates: built.candidates,
    catalogCoverage: coverage,
    enumeratedCombinationCount: built.enumeratedCombinationCount,
    inspectedLeafCount: built.inspectedLeafCount,
    totalCombinationCount: combinationsExhaustive ? built.totalCombinationCount : null,
    combinationLimit: built.combinationLimit,
    combinationsExhaustive,
    warnings,
    limitation: 'fact-key-coverage-not-damage-simulation',
  };
}

/** Discover and rank every currently available legal set using one profile. */
export function recommendDiscoveredSets(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
  options: AgentDiscoveredSetRecommendationOptions = {},
): AgentDiscoveredSetRecommendation {
  const { catalog, profile } = resolveProfile(input, operatorOrProfile);
  const coverage = getCoverage(catalog);
  const sets = unambiguousCatalogItems(catalog.gearSets.results)
    .sort((left, right) => stableIdCompare(left.id, right.id));
  let allSetFactsComplete = true;
  let allCombinationTraversalsComplete = true;
  const allCandidates = sets.flatMap((set) => {
    const built = buildNamedSetInternal(catalog, profile, set.id, {
      allowDuplicateCompatibleAccessories: options.allowDuplicateCompatibleAccessories,
      limit: options.combinationLimit,
    });
    if (!built.factsComplete) allSetFactsComplete = false;
    if (!built.combinationsExhaustive) allCombinationTraversalsComplete = false;
    const best = built.candidates[0] ?? null;
    const combinationsExhaustive = built.combinationsExhaustive
      && coverage.domains.equipment.exhaustive
      && coverage.domains.gearSets.exhaustive;
    return best ? [{
      id: set.id,
      name: set.name,
      rank: 0,
      tied: false,
      score: best.score,
      bestCombination: best,
      combinationsEvaluated: built.enumeratedCombinationCount,
      inspectedLeafCount: built.inspectedLeafCount,
      totalCombinationCount: combinationsExhaustive ? built.totalCombinationCount : null,
      combinationLimit: built.combinationLimit,
      combinationsExhaustive,
      unresolved: best.unresolved,
    } satisfies AgentDiscoveredSetRecommendationCandidate] : [];
  });
  const rankedAll = assignSharedRanks(allCandidates);
  const limit = nonNegativeInteger(options.limit, allCandidates.length);
  const ranked = rankedAll.slice(0, limit);
  const topScore = rankedAll[0]?.score ?? 0;
  const tieCount = topScore > 0 ? rankedAll.filter((candidate) => candidate.score === topScore).length : 0;
  const truncated = limit < rankedAll.length;
  const traversalExhaustive = coverage.domains.gearSets.exhaustive
    && coverage.domains.equipment.exhaustive
    && allSetFactsComplete
    && allCombinationTraversalsComplete;
  const incompleteCandidate = ranked.some((candidate) => (
    candidate.unresolved.length > 0 || !candidate.combinationsExhaustive
  ));
  let status: AgentLoadoutRecommendationState;
  if (profile.status === 'OPERATOR_AMBIGUOUS' || profile.status === 'OPERATOR_UNRESOLVED') status = 'NO_PLAN';
  else if (ranked.length === 0 || ranked[0]!.score <= 0) status = !traversalExhaustive || profile.status === 'PARTIAL' || !coverage.overall ? 'PARTIAL' : 'NO_PLAN';
  else if (!traversalExhaustive || truncated || profile.status === 'PARTIAL' || !coverage.overall || incompleteCandidate) status = 'PARTIAL';
  else if (tieCount > 1) status = 'TIED';
  else status = 'READY';
  const warnings = [...profile.warnings];
  if (!traversalExhaustive) warnings.push('套装、装备目录或合法组合未完整遍历，未把当前 top candidate 宣称为全目录最优。');
  if (truncated) warnings.push('发现结果被 limit 截断，未把截断结果宣称为完整遍历。');
  return {
    policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
    source: 'browser-sqlite-mirror',
    status,
    operator: profile.resolution,
    profileStatus: profile.status,
    candidates: ranked,
    evaluatedSetCount: sets.length,
    candidateSetCount: allCandidates.length,
    traversalExhaustive: traversalExhaustive && !truncated,
    catalogCoverage: coverage,
    warnings,
    limitation: 'fact-key-coverage-not-damage-simulation',
  };
}

function projectedCharacterId(operator: AgentLoadoutProjectedOperatorCapsule): string {
  return trimmed(operator.character?.id) || trimmed(operator.characterId);
}

function projectedCharacterName(operator: AgentLoadoutProjectedOperatorCapsule): string {
  return trimmed(operator.character?.name) || trimmed(operator.characterName);
}

function selectProjectedOperator(
  profile: AgentLoadoutProfile,
  capsule: AgentLoadoutCapsule,
): {
  operator: AgentLoadoutProjectedOperatorCapsule | null;
  path: string;
  unresolved: AgentLoadoutUnresolvedItem[];
  conflicts: AgentLoadoutConflict[];
} {
  const unresolved: AgentLoadoutUnresolvedItem[] = [];
  const conflicts: AgentLoadoutConflict[] = [];
  if (!profile.operator) return { operator: null, path: 'capsule', unresolved, conflicts };

  if (capsule.operators !== undefined || capsule.contract !== undefined) {
    const validated = validateLoadoutCapsule(capsule);
    if (!validated.ok) {
      unresolved.push({
        path: validated.error.path ?? 'capsule',
        reason: `strict DefTeamLoadoutsV1 validation failed: ${validated.error.code}: ${validated.error.message}`,
      });
      return { operator: null, path: 'capsule', unresolved, conflicts };
    }
    const strictCapsule = validated.value as unknown as AgentLoadoutCapsule;
    if (strictCapsule.missingCharacterIds?.includes(profile.operator.id)) {
      unresolved.push({
        path: 'capsule.missingCharacterIds',
        reason: 'target operator loadout is explicitly unavailable in the bound team capsule',
        value: profile.operator.id,
      });
    }
    const matches = strictCapsule.operators!
      .map((operator, index) => ({ operator, index }))
      .filter(({ operator }) => projectedCharacterId(operator) === profile.operator!.id);
    if (matches.length !== 1) {
      unresolved.push({
        path: 'capsule.operators',
        reason: matches.length > 1
          ? 'stable character id is ambiguous in the projected team loadout'
          : 'resolved operator stable id is absent from the projected team loadout; name fallback is not used',
        value: profile.operator.id,
      });
      return { operator: null, path: 'capsule.operators', unresolved, conflicts };
    }
    const selected = matches[0]!;
    const path = `capsule.operators[${selected.index}]`;
    if (selected.operator.configured !== true) {
      unresolved.push({ path: `${path}.configured`, reason: 'projected operator is not configured', value: String(selected.operator.configured) });
    }
    const name = projectedCharacterName(selected.operator);
    if (name && exactText(name) !== exactText(profile.operator.name)) {
      conflicts.push({
        path: `${path}.character.name`,
        reason: 'projected character name conflicts with the catalog record for the stable id',
        expected: profile.operator.name,
        actual: name,
      });
    }
    return { operator: selected.operator, path, unresolved, conflicts };
  }

  const characterId = projectedCharacterId(capsule);
  if (!characterId || characterId !== profile.operator.id) {
    unresolved.push({
      path: 'capsule.character.id',
      reason: characterId
        ? 'projected operator stable id does not match the resolved profile'
        : 'projected operator has no stable character id; name fallback is not used',
      value: characterId || undefined,
    });
    return { operator: null, path: 'capsule', unresolved, conflicts };
  }
  if (capsule.configured !== true) {
    unresolved.push({ path: 'capsule.configured', reason: 'projected operator must explicitly be configured', value: String(capsule.configured) });
  }
  const name = projectedCharacterName(capsule);
  if (characterId && name && exactText(name) !== exactText(profile.operator.name)) {
    conflicts.push({
      path: 'capsule.character.name',
      reason: 'projected character name conflicts with the catalog record for the stable id',
      expected: profile.operator.name,
      actual: name,
    });
  }
  return { operator: capsule, path: 'capsule', unresolved, conflicts };
}

function resolveCatalogItemByStableId<T extends { id: string }>(
  items: readonly T[],
  rawId: unknown,
  path: string,
  domain: string,
  unresolved: AgentLoadoutUnresolvedItem[],
): T | null {
  const id = trimmed(rawId);
  if (!id) {
    unresolved.push({ path, reason: `${domain} stable id is missing; inline typeKeys are not treated as catalog authority` });
    return null;
  }
  const matches = items.filter((item) => item.id === id);
  if (matches.length !== 1) {
    unresolved.push({
      path,
      reason: matches.length > 1
        ? `${domain} stable id is ambiguous in the current catalog`
        : `${domain} stable id does not exist in the current catalog`,
      value: id,
    });
    return null;
  }
  return matches[0]!;
}

function capsuleEffects(
  catalog: AgentProductCatalog,
  profile: AgentLoadoutProfile,
  capsule: AgentLoadoutCapsule,
): {
  effects: CandidateEffect[];
  unresolved: AgentLoadoutUnresolvedItem[];
  conflicts: AgentLoadoutConflict[];
} {
  const effects: CandidateEffect[] = [];
  const selection = selectProjectedOperator(profile, capsule);
  const unresolved = [...selection.unresolved];
  const conflicts = [...selection.conflicts];
  if (!selection.operator) return { effects, unresolved, conflicts };
  const projected = selection.operator;

  if (!projected.weapon) {
    unresolved.push({ path: `${selection.path}.weapon`, reason: 'weapon is missing; no default weapon assumed' });
  } else {
    const weaponPath = `${selection.path}.weapon`;
    const weapon = resolveCatalogItemByStableId(
      catalog.weapons.results,
      projected.weapon.id,
      `${weaponPath}.id`,
      'weapon',
      unresolved,
    );
    if (weapon) {
      const facts = buildWeaponFacts(weapon);
      effects.push(...facts.effects);
      unresolved.push(...facts.unresolved);
      if (
        profile.operator?.weaponType
        && normalizeAgentProductQuery(weapon.type) !== normalizeAgentProductQuery(profile.operator.weaponType)
      ) {
        conflicts.push({
          path: `${weaponPath}.id`,
          reason: 'catalog weapon type does not match the resolved operator weaponType',
          expected: profile.operator.weaponType,
          actual: weapon.type,
        });
      }
      if (projected.weapon.type && normalizeAgentProductQuery(projected.weapon.type) !== normalizeAgentProductQuery(weapon.type)) {
        conflicts.push({
          path: `${weaponPath}.type`,
          reason: 'projected weapon type conflicts with the stable catalog weapon record',
          expected: weapon.type,
          actual: projected.weapon.type,
        });
      }
    }
  }

  const resolvedPieces: Array<{
    slotKey: AgentGearSlotKey;
    piece: AgentEquipmentCatalogItem;
    path: string;
  }> = [];
  const equipment = projected.equipment;
  if (equipment === undefined) {
    unresolved.push({ path: `${selection.path}.equipment`, reason: 'equipment list is missing; no default equipment assumed' });
  } else {
    if (equipment.length !== AGENT_GEAR_SLOT_ORDER.length) {
      unresolved.push({
        path: `${selection.path}.equipment`,
        reason: 'a comparable loadout must contain exactly four equipment slots',
        value: String(equipment.length),
      });
    }
    const seenSlots = new Set<AgentGearSlotKey>();
    const seenEquipmentIds = new Set<string>();
    equipment.forEach((entry, index) => {
      const path = `${selection.path}.equipment[${index}]`;
      const slotKey = trimmed(entry.slotKey) as AgentGearSlotKey;
      if (!AGENT_GEAR_SLOT_ORDER.includes(slotKey)) {
        unresolved.push({ path: `${path}.slotKey`, reason: 'equipment slotKey is missing or unsupported', value: trimmed(entry.slotKey) });
        return;
      }
      if (seenSlots.has(slotKey)) {
        unresolved.push({ path: `${path}.slotKey`, reason: 'equipment slot is duplicated', value: slotKey });
        return;
      }
      seenSlots.add(slotKey);
      const equipmentId = trimmed(entry.equipmentId) || trimmed(entry.id);
      if (entry.equipmentId && entry.id && entry.equipmentId !== entry.id) {
        unresolved.push({ path, reason: 'equipmentId and id disagree; no catalog item was selected' });
        return;
      }
      if (seenEquipmentIds.has(equipmentId)) {
        unresolved.push({
          path: `${path}.equipmentId`,
          reason: 'duplicate equipment stable id is not trusted as an independently stacking fact',
          value: equipmentId,
        });
        return;
      }
      seenEquipmentIds.add(equipmentId);
      const piece = resolveCatalogItemByStableId(
        catalog.equipment.results,
        equipmentId,
        `${path}.equipmentId`,
        'equipment',
        unresolved,
      );
      if (!piece) return;
      const expectedPart = GEAR_PART_BY_SLOT[slotKey];
      if (piece.part !== expectedPart) {
        conflicts.push({
          path: `${path}.slotKey`,
          reason: 'catalog equipment part is incompatible with the projected slot',
          expected: expectedPart,
          actual: piece.part,
        });
        return;
      }
      resolvedPieces.push({ slotKey, piece, path });
      const facts = buildEquipmentFacts(piece);
      effects.push(...facts.effects);
      unresolved.push(...facts.unresolved);
    });
    const missingSlots = AGENT_GEAR_SLOT_ORDER.filter((slotKey) => !seenSlots.has(slotKey));
    if (missingSlots.length > 0) {
      unresolved.push({
        path: `${selection.path}.equipment`,
        reason: 'required equipment slots are missing',
        value: missingSlots.join(','),
      });
    }
  }

  const setPieceCounts = new Map<string, number>();
  resolvedPieces.forEach(({ piece }) => {
    setPieceCounts.set(piece.gearSetId, (setPieceCounts.get(piece.gearSetId) ?? 0) + 1);
  });
  const derivedSetBuffs: Array<{
    gearSet: AgentGearSetCatalogItem;
    buff: AgentGearSetBuffCatalogItem;
  }> = [];
  [...setPieceCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort(([left], [right]) => stableIdCompare(left, right))
    .forEach(([gearSetId]) => {
      const gearSet = resolveCatalogItemByStableId(
        catalog.gearSets.results,
        gearSetId,
        `${selection.path}.equipment.gearSetId`,
        'gear set',
        unresolved,
      );
      if (!gearSet) return;
      gearSet.threePieceBuffs
        .slice()
        .sort((left, right) => stableIdCompare(left.id, right.id))
        .forEach((buff) => derivedSetBuffs.push({ gearSet, buff }));
    });
  derivedSetBuffs.forEach(({ gearSet, buff }) => effects.push({
    source: 'setBuff',
    sourceId: gearSet.id,
    evidencePath: `gearSets[${gearSet.id}].threePieceBuffs[${buff.id}]`,
    typeKey: buff.typeKey,
    category: buff.category,
    valueMode: buff.valueMode,
  }));

  const expectedSetBuffKeys = derivedSetBuffs
    .map(({ gearSet, buff }) => `${gearSet.id}\u0000${buff.id}`)
    .sort(stableIdCompare);
  if (projected.setBuffs !== undefined) {
    const projectedSetBuffKeys = projected.setBuffs.map((entry, index) => {
      const gearSetId = trimmed(entry.gearSetId);
      const effectId = trimmed(entry.effectId) || trimmed(entry.id);
      if (!gearSetId || !effectId) {
        unresolved.push({
          path: `${selection.path}.setBuffs[${index}]`,
          reason: 'projected set Buff requires stable gearSetId and effectId',
        });
      }
      return `${gearSetId}\u0000${effectId}`;
    }).sort(stableIdCompare);
    if (
      projectedSetBuffKeys.length !== expectedSetBuffKeys.length
      || projectedSetBuffKeys.some((key, index) => key !== expectedSetBuffKeys[index])
    ) {
      conflicts.push({
        path: `${selection.path}.setBuffs`,
        reason: 'projected set Buffs do not match the effects derived from the resolved equipment membership',
        expected: expectedSetBuffKeys.join(','),
        actual: projectedSetBuffKeys.join(','),
      });
    }
  }
  return { effects, unresolved, conflicts };
}

function evaluateResolvedCapsule(
  catalog: AgentProductCatalog,
  profile: AgentLoadoutProfile,
  capsule: AgentLoadoutCapsule,
): { score: AgentLoadoutScore; matches: AgentLoadoutMatch[]; conflicts: AgentLoadoutConflict[]; unresolved: AgentLoadoutUnresolvedItem[] } {
  const capsuleData = capsuleEffects(catalog, profile, capsule);
  const score = scoreFactCollection(profile, {
    effects: capsuleData.effects,
    unresolved: capsuleData.unresolved,
  });
  const matches: AgentLoadoutMatch[] = score.scoreComponents.map((component) => ({
    source: component.source,
    sourceId: component.sourceId,
    path: component.evidencePath,
    typeKey: component.typeKey,
    priorityKey: component.priorityKey,
    weight: component.weight,
    contribution: component.contribution,
    category: component.category,
    conditional: component.condition === 'conditional',
  }));
  return {
    score,
    matches,
    conflicts: capsuleData.conflicts,
    unresolved: [...score.unresolved],
  };
}

function buildEvaluation(
  catalog: AgentProductCatalog,
  profile: AgentLoadoutProfile,
  evaluated: ReturnType<typeof evaluateResolvedCapsule>,
): AgentLoadoutEvaluation {
  const noProfile = !profile.operator;
  const unresolved = [...profile.unresolved, ...evaluated.unresolved].sort((left, right) => (
    stableIdCompare(left.path, right.path) || stableIdCompare(left.reason, right.reason)
  ));
  const status = noProfile ? 'NO_PROFILE' : profile.status === 'READY' && unresolved.length === 0 && getCoverage(catalog).overall && evaluated.conflicts.length === 0 ? 'READY' : 'PARTIAL';
  return {
    policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
    status,
    operator: profile.resolution,
    score: evaluated.score.total,
    dimensions: evaluated.score.dimensions,
    matches: evaluated.matches,
    conflicts: evaluated.conflicts,
    unresolved,
    catalogCoverage: getCoverage(catalog),
  };
}

function evaluateStrictTeamCapsule(
  catalog: AgentProductCatalog,
  profile: AgentLoadoutProfile,
  capsule: AgentLoadoutCapsule,
): AgentLoadoutEvaluation {
  if (capsule.contract !== 'DefTeamLoadoutsV1' || capsule.operators === undefined) {
    const score = scoreFactCollection(profile, {
      effects: [],
      unresolved: [{
        path: 'capsule',
        reason: 'current loadout evaluation requires a strict DefTeamLoadoutsV1 capsule; projected candidates use dedicated comparison APIs',
      }],
    });
    return buildEvaluation(catalog, profile, {
      score,
      matches: [],
      conflicts: [],
      unresolved: [...score.unresolved],
    });
  }
  return buildEvaluation(catalog, profile, evaluateResolvedCapsule(catalog, profile, capsule));
}

/** Evaluate only the Host-projected strict current team capsule. */
export function evaluateCurrent(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
  capsule: AgentLoadoutCapsule,
): AgentLoadoutEvaluation {
  const { catalog, profile } = resolveProfile(input, operatorOrProfile);
  return evaluateStrictTeamCapsule(catalog, profile, capsule);
}

function compareEvaluations(
  profile: AgentLoadoutProfile,
  a: AgentLoadoutEvaluation,
  b: AgentLoadoutEvaluation,
): AgentLoadoutCompareResult {
  const dimensions = profile.priorities.map((priority) => {
    const aDimension = a.dimensions.find((dimension) => dimension.key === priority.key);
    const bDimension = b.dimensions.find((dimension) => dimension.key === priority.key);
    return {
      key: priority.key,
      a: aDimension?.contribution ?? 0,
      b: bDimension?.contribution ?? 0,
      delta: (aDimension?.contribution ?? 0) - (bDimension?.contribution ?? 0),
    } satisfies AgentLoadoutCompareDimensionDelta;
  });
  const delta = a.score - b.score;
  const complete = a.status === 'READY' && b.status === 'READY' && profile.status === 'READY';
  const status: AgentLoadoutCompareResult['status'] = !complete
    ? 'PARTIAL'
    : delta > 0
      ? 'A'
      : delta < 0
        ? 'B'
        : 'TIED';
  return {
    policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
    status,
    operator: profile.resolution,
    a,
    b,
    delta,
    deltaComponents: dimensions,
    limitation: 'same-profile-fact-key-coverage-only',
  };
}

/** Compare two capsules only along the dimensions derived from the same profile. */
export function compare(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
  capsuleA: AgentLoadoutCapsule,
  capsuleB: AgentLoadoutCapsule,
): AgentLoadoutCompareResult {
  const { catalog, profile } = resolveProfile(input, operatorOrProfile);
  return compareEvaluations(
    profile,
    evaluateStrictTeamCapsule(catalog, profile, capsuleA),
    evaluateStrictTeamCapsule(catalog, profile, capsuleB),
  );
}

function buildCandidateCapsule(
  profile: AgentLoadoutProfile,
  current: AgentLoadoutCapsule,
  patch: AgentLoadoutCandidatePatch,
): AgentLoadoutCapsule {
  const validated = validateLoadoutCapsule(current);
  const currentOperator = validated.ok && profile.operator
    ? validated.value.operators.find((entry) => entry.character.id === profile.operator!.id)
    : undefined;
  const characterId = profile.operator?.id ?? '';
  return {
    ...(currentOperator ? { character: currentOperator.character } : {}),
    characterId,
    configured: true,
    weapon: patch.weaponId === undefined
      ? currentOperator?.weapon ?? null
      : { id: patch.weaponId },
    equipment: patch.equipment === undefined
      ? currentOperator?.equipment
      : patch.equipment.map((entry) => ({
          slotKey: entry.slotKey,
          equipmentId: entry.equipmentId,
        })),
  };
}

export function compareCurrentWithCandidate(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
  current: AgentLoadoutCapsule,
  candidate: AgentLoadoutCandidatePatch,
): AgentLoadoutCompareResult {
  const { catalog, profile } = resolveProfile(input, operatorOrProfile);
  return compareEvaluations(
    profile,
    evaluateStrictTeamCapsule(catalog, profile, current),
    buildEvaluation(
      catalog,
      profile,
      evaluateResolvedCapsule(catalog, profile, buildCandidateCapsule(profile, current, candidate)),
    ),
  );
}

export function compareCandidateLoadouts(
  input: AgentLoadoutCatalogInput,
  operatorOrProfile: string | AgentLoadoutProfile,
  current: AgentLoadoutCapsule,
  candidateA: AgentLoadoutCandidatePatch,
  candidateB: AgentLoadoutCandidatePatch,
): AgentLoadoutCompareResult {
  const { catalog, profile } = resolveProfile(input, operatorOrProfile);
  const evaluateCandidate = (candidate: AgentLoadoutCandidatePatch) => buildEvaluation(
    catalog,
    profile,
    evaluateResolvedCapsule(catalog, profile, buildCandidateCapsule(profile, current, candidate)),
  );
  return compareEvaluations(profile, evaluateCandidate(candidateA), evaluateCandidate(candidateB));
}

/** Aggregate the two deterministic recommendation surfaces into one generic result. */
export function recommend(
  input: AgentLoadoutCatalogInput,
  operatorQuery: string,
  options: {
    discoveredSets?: AgentDiscoveredSetRecommendationOptions;
  } = {},
): AgentLoadoutGenericRecommendation {
  const catalog = prepareCatalog(input);
  const profile = deriveProfile(catalog, operatorQuery);
  return {
    policy: AGENT_LOADOUT_RECOMMENDATION_POLICY,
    source: 'browser-sqlite-mirror',
    operator: profile.resolution,
    profile,
    weapons: recommendWeapons(catalog, profile),
    discoveredSets: recommendDiscoveredSets(catalog, profile, options.discoveredSets),
  };
}

export const recommendLoadout = recommend;
