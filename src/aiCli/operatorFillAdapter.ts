import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';
import { listOperatorSourceIndex } from './operatorSourceData';

export const OPERATOR_DRAFT_STORAGE_KEY = 'def.operator-editor.draft.v1';
export const OPERATOR_LIBRARY_STORAGE_KEY = 'def.operator-editor.library.v1';

const SKILL_LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'M1', 'M2', 'M3'] as const;
const ATTRIBUTE_LEVEL_KEYS = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'] as const;
const ATTRIBUTE_KEYS = ['strength', 'agility', 'intelligence', 'will', 'atk', 'hp'] as const;
const BUTTON_TYPES = ['A', 'B', 'E', 'Q'] as const;
const ELEMENT_TYPES = ['physical', 'fire', 'ice', 'electric', 'nature'] as const;
const ABILITY_TYPES = ['力量', '敏捷', '智识', '意志'] as const;
const PROFESSION_TYPES = ['突击', '重装', '近卫', '辅助', '先锋', '术师'] as const;
const WEAPON_TYPES = ['手铳', '双手剑', '长柄武器', '法术单元', '单手剑'] as const;
const BUFF_GROUPS = ['talent', 'potential', 'skill'] as const;
const BUFF_CATEGORIES = ['positive', 'condition'] as const;
const SUPPORTED_OPERATOR_EFFECT_TYPES = [
  'atkPercentBoost',
  'atk',
  'mainStat',
  'subStat',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'hpPercent',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'allSkillDmgBonus',
  'imbalanceDmgBonus',
  'sourceSkillBoost',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
];

type ButtonType = (typeof BUTTON_TYPES)[number];
type ElementType = (typeof ELEMENT_TYPES)[number];
type SkillLevelKey = (typeof SKILL_LEVEL_KEYS)[number];
type AttributeLevelKey = (typeof ATTRIBUTE_LEVEL_KEYS)[number];
type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
type OperatorBuffGroupKey = (typeof BUFF_GROUPS)[number];
type OperatorBuffCategory = (typeof BUFF_CATEGORIES)[number];

interface OperatorBuffEffect {
  effectId: string;
  name: string;
  type: string;
  category: OperatorBuffCategory;
  value?: number;
  unit?: 'flat' | 'percent' | string;
  description?: string;
  raw?: string;
}

type OperatorBuffs = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffect> }>;
type AttributeLevels = Record<AttributeKey, Record<AttributeLevelKey, number>>;

interface HitMetaDraft {
  displayName: string;
  element: ElementType;
  skillType: ButtonType;
  levels: Record<SkillLevelKey, number>;
}

interface SkillDraft {
  displayName: string;
  buttonType: ButtonType;
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, HitMetaDraft>;
}

export interface OperatorDraft {
  id: string;
  name: string;
  avatarUrl: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: string;
  mainStat: string;
  subStat: string;
  level: number;
  attributes: AttributeLevels;
  skills: Record<string, SkillDraft>;
  buffs: OperatorBuffs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function defaultAttributes(): AttributeLevels {
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((key) => [key, Object.fromEntries(ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [levelKey, 0]))]),
  ) as AttributeLevels;
}

function defaultBuffs(): OperatorBuffs {
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

function createFallbackOperatorDraft(): OperatorDraft {
  return {
    id: 'custom-operator-001',
    name: '新干员',
    avatarUrl: '',
    rarity: 6,
    profession: '',
    weapon: '',
    element: 'physical',
    mainStat: '',
    subStat: '',
    level: 90,
    attributes: defaultAttributes(),
    skills: {},
    buffs: defaultBuffs(),
  };
}

export function readCurrentOperatorDraft(): OperatorDraft {
  return readJsonStorage<OperatorDraft>(OPERATOR_DRAFT_STORAGE_KEY, createFallbackOperatorDraft());
}

export function readOperatorLibrary(): Record<string, OperatorDraft> {
  return readJsonStorage<Record<string, OperatorDraft>>(OPERATOR_LIBRARY_STORAGE_KEY, {});
}

export function formatOperatorLibrarySummary(library = readOperatorLibrary()) {
  return Object.entries(library)
    .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
    .map(([id, operator]) => ({
      id,
      name: operator.name || '',
      rarity: Number(operator.rarity || 0),
      profession: operator.profession || '',
      element: operator.element || '',
      skills: operator.skills ? Object.keys(operator.skills).length : 0,
    }));
}

function parseJsonPayload(rawPayload: unknown) {
  if (typeof rawPayload !== 'string') {
    return { value: null, errors: ['payload must be string'] };
  }
  try {
    const parsed = JSON.parse(rawPayload.trim()) as Record<string, unknown>;
    return { value: isRecord(parsed.draft) ? parsed.draft : parsed, errors: [] };
  } catch (error) {
    return { value: null, errors: [`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function validateOperatorDraftShape(raw: unknown): AgentFillValidationResult<OperatorDraft> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['root must be object'] };
  const obj = raw;
  if (typeof obj.id !== 'string' || !obj.id.trim()) errors.push('id must be non-empty string');
  if (typeof obj.name !== 'string' || !obj.name.trim()) errors.push('name must be non-empty string');
  if (typeof obj.rarity !== 'number' || !Number.isFinite(obj.rarity)) errors.push('rarity must be number');
  if (typeof obj.profession !== 'string' || !PROFESSION_TYPES.includes(obj.profession as never)) errors.push(`profession must be one of ${PROFESSION_TYPES.join('/')}`);
  if (typeof obj.weapon !== 'string' || !WEAPON_TYPES.includes(obj.weapon as never)) errors.push(`weapon must be one of ${WEAPON_TYPES.join('/')}`);
  if (typeof obj.element !== 'string' || !ELEMENT_TYPES.includes(obj.element as never)) errors.push(`element must be one of ${ELEMENT_TYPES.join('/')}`);
  if (typeof obj.mainStat !== 'string' || !ABILITY_TYPES.includes(obj.mainStat as never)) errors.push(`mainStat must be one of ${ABILITY_TYPES.join('/')}`);
  if (typeof obj.subStat !== 'string' || !ABILITY_TYPES.includes(obj.subStat as never)) errors.push(`subStat must be one of ${ABILITY_TYPES.join('/')}`);
  if (!isRecord(obj.skills) || Object.keys(obj.skills).length === 0) {
    errors.push('skills must be non-empty object');
  } else {
    for (const [skillKey, rawSkill] of Object.entries(obj.skills)) {
      if (!isRecord(rawSkill)) {
        errors.push(`skills.${skillKey} must be object`);
        continue;
      }
      if (typeof rawSkill.displayName !== 'string') errors.push(`skills.${skillKey}.displayName must be string`);
      if (typeof rawSkill.buttonType !== 'string' || !BUTTON_TYPES.includes(rawSkill.buttonType as never)) errors.push(`skills.${skillKey}.buttonType must be A/B/E/Q`);
      if (rawSkill.hitMeta !== undefined && !isRecord(rawSkill.hitMeta)) errors.push(`skills.${skillKey}.hitMeta must be object`);
      if (isRecord(rawSkill.hitMeta)) {
        for (const [hitKey, rawHit] of Object.entries(rawSkill.hitMeta)) {
          if (!isRecord(rawHit)) {
            errors.push(`skills.${skillKey}.hitMeta.${hitKey} must be object`);
            continue;
          }
          if (typeof rawHit.displayName !== 'string') errors.push(`skills.${skillKey}.hitMeta.${hitKey}.displayName must be string`);
          if (typeof rawHit.element !== 'string' || !ELEMENT_TYPES.includes(rawHit.element as never)) errors.push(`skills.${skillKey}.hitMeta.${hitKey}.element must be valid element`);
          if (typeof rawHit.skillType !== 'string' || !BUTTON_TYPES.includes(rawHit.skillType as never)) errors.push(`skills.${skillKey}.hitMeta.${hitKey}.skillType must be A/B/E/Q`);
          if (!isRecord(rawHit.levels)) errors.push(`skills.${skillKey}.hitMeta.${hitKey}.levels must be object`);
          if (isRecord(rawHit.levels)) {
            for (const [levelKey, value] of Object.entries(rawHit.levels)) {
              if (!SKILL_LEVEL_KEYS.includes(levelKey as never)) errors.push(`invalid skill level key: ${levelKey}`);
              if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`skills.${skillKey}.hitMeta.${hitKey}.levels.${levelKey} must be number`);
            }
          }
        }
      }
    }
  }
  if (obj.buffs !== undefined) {
    if (!isRecord(obj.buffs)) {
      errors.push('buffs must be object');
    } else {
      for (const [groupKey, rawGroup] of Object.entries(obj.buffs)) {
        if (!BUFF_GROUPS.includes(groupKey as never)) errors.push(`invalid buff group: ${groupKey}`);
        if (!isRecord(rawGroup) || !isRecord(rawGroup.effects)) {
          errors.push(`buffs.${groupKey}.effects must be object`);
          continue;
        }
        for (const [effectKey, rawEffect] of Object.entries(rawGroup.effects)) {
          if (!isRecord(rawEffect)) {
            errors.push(`buffs.${groupKey}.effects.${effectKey} must be object`);
            continue;
          }
          if (typeof rawEffect.type !== 'string' || !SUPPORTED_OPERATOR_EFFECT_TYPES.includes(rawEffect.type)) errors.push(`unsupported operator buff type: ${String(rawEffect.type)}`);
          if (typeof rawEffect.category !== 'string' || !BUFF_CATEGORIES.includes(rawEffect.category as never)) errors.push(`buffs.${groupKey}.effects.${effectKey}.category must be positive/condition`);
          if (rawEffect.value !== undefined && (typeof rawEffect.value !== 'number' || !Number.isFinite(rawEffect.value))) errors.push(`buffs.${groupKey}.effects.${effectKey}.value must be number`);
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], normalized: normalizeOperatorDraft(obj) };
}

function normalizeOperatorDraft(obj: Record<string, unknown>): OperatorDraft {
  const skills: Record<string, SkillDraft> = {};
  for (const [skillKey, rawSkill] of Object.entries(obj.skills as Record<string, Record<string, unknown>>)) {
    const hitMeta: Record<string, HitMetaDraft> = {};
    if (isRecord(rawSkill.hitMeta)) {
      for (const [hitKey, rawHit] of Object.entries(rawSkill.hitMeta)) {
        if (!isRecord(rawHit)) continue;
        hitMeta[hitKey] = {
          displayName: String(rawHit.displayName || hitKey),
          element: rawHit.element as ElementType,
          skillType: rawHit.skillType as ButtonType,
          levels: Object.fromEntries(SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, Number((rawHit.levels as Record<string, number> | undefined)?.[levelKey] ?? 0)])) as Record<SkillLevelKey, number>,
        };
      }
    }
    skills[skillKey] = {
      displayName: String(rawSkill.displayName || skillKey),
      buttonType: rawSkill.buttonType as ButtonType,
      iconUrl: typeof rawSkill.iconUrl === 'string' ? rawSkill.iconUrl : '',
      hitCount: Object.keys(hitMeta).length || Number(rawSkill.hitCount || 0) || 1,
      hitMeta: Object.keys(hitMeta).length ? hitMeta : {
        hit1: {
          displayName: '第1击',
          element: obj.element as ElementType,
          skillType: rawSkill.buttonType as ButtonType,
          levels: Object.fromEntries(SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, 0])) as Record<SkillLevelKey, number>,
        },
      },
    };
  }
  return {
    ...createFallbackOperatorDraft(),
    id: String(obj.id),
    name: String(obj.name),
    avatarUrl: typeof obj.avatarUrl === 'string' ? obj.avatarUrl : '',
    rarity: Number(obj.rarity),
    profession: String(obj.profession),
    weapon: String(obj.weapon),
    element: String(obj.element),
    mainStat: String(obj.mainStat),
    subStat: String(obj.subStat),
    skills,
    buffs: isRecord(obj.buffs) ? obj.buffs as unknown as OperatorBuffs : defaultBuffs(),
  };
}

export const operatorFillAdapter: AgentFillDomainAdapter<OperatorDraft> = {
  domain: 'operator',
  workflow: 'operator.fill',
  commandPrefix: 'operator.fill',
  draftStorageKey: OPERATOR_DRAFT_STORAGE_KEY,
  libraryStorageKey: OPERATOR_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: SUPPORTED_OPERATOR_EFFECT_TYPES,

  validateAiDraft(rawPayload): AgentFillValidationResult<OperatorDraft> {
    const parsed = parseJsonPayload(rawPayload);
    if (!parsed.value) return { ok: false, errors: parsed.errors };
    return validateOperatorDraftShape(parsed.value);
  },

  validateProposalPayload: validateOperatorDraftShape,

  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<OperatorDraft> {
    const draft = validation.normalized!;
    return {
      rawCommand,
      normalized: draft,
      summary: operatorFillAdapter.summarizeProposal(draft),
    };
  },

  summarizeProposal(payload): string {
    return `operator fill: name=${payload.name} skills=${Object.keys(payload.skills || {}).length}`;
  },

  getProposalTargetId(payload): string {
    return payload.id;
  },

  buildTaskPackage() {
    const draft = readCurrentOperatorDraft();
    const library = readOperatorLibrary();
    return {
      lines: [`[info] operator.fill.task ready: name=${draft.name} skills=${Object.keys(draft.skills || {}).length}`],
      data: {
        tool: 'operator.fill',
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        currentDraft: draft,
        librarySummary: formatOperatorLibrarySummary(library),
        sourceDataIndex: listOperatorSourceIndex(),
        sourceReadCommands: { list: 'operator.data.list', show: 'operator.data.show <name>' },
        sourceReadRestEndpoints: { list: 'GET /api/operator/data', show: 'GET /api/operator/data/<name>' },
        operatorFillAiDraftSchema: {
          id: 'string',
          name: 'string',
          rarity: 'number',
          profession: PROFESSION_TYPES,
          weapon: WEAPON_TYPES,
          element: ELEMENT_TYPES,
          mainStat: ABILITY_TYPES,
          subStat: ABILITY_TYPES,
          skills: 'Record<string, { displayName, buttonType, iconUrl?, hitCount?, hitMeta? }>',
          buffs: 'optional; talent/potential/skill groups only',
        },
        supportedEffectTypes: SUPPORTED_OPERATOR_EFFECT_TYPES,
        instruction: 'Return exactly one OperatorFillAiDraft JSON object. No Markdown. No explanation. Prefer GET /api/operator/data/<name> and POST /api/operator/fill/check|apply for Chinese payloads; CLI JSON args may be shell-encoding sensitive. operator.fill.apply creates a proposal only; it does NOT save to library.',
        approvalSaveWarning: 'Approval applies to def.operator-editor.draft.v1. Save writes def.operator-editor.library.v1.',
      },
    };
  },

  applyToWorkingState(payload): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(OPERATOR_DRAFT_STORAGE_KEY, payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveToLocalTruth(payload): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(OPERATOR_LIBRARY_STORAGE_KEY, { ...readOperatorLibrary(), [payload.id]: payload });
      writeJsonStorage(OPERATOR_DRAFT_STORAGE_KEY, payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
