import { AI_CLI_PROTOCOL_VERSION } from './aiCliAgentTypes';
import type { AgentFillDomainAdapter, AgentFillProposalPayload, AgentFillValidationResult } from './aiCliFillDomains';

export const WEAPON_DRAFT_STORAGE_KEY = 'def.weapon-sheet.draft.v1';
export const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
export const ALL_WEAPON_STORAGE_KEYS = [WEAPON_DRAFT_STORAGE_KEY, WEAPON_LIBRARY_STORAGE_KEY];

export type WeaponSkillKey = 'skill1' | 'skill2' | 'skill3';
export type WeaponEffectBucket = 'value' | 'effect';

export interface WeaponEffectData {
  name: string;
  type: string;
  category: string;
  levels: Record<string, number>;
}

export interface WeaponLevelData {
  value?: number;
  description: string;
}

export interface WeaponSkillData {
  name: string;
  statType: string;
  effects: Record<string, WeaponEffectData>;
  levels: Record<string, WeaponLevelData>;
}

export interface WeaponDraft {
  id: string;
  name: string;
  rarity: number;
  type: string;
  description: string;
  imgUrl: string;
  attackGrowth: Record<string, number>;
  skills: Record<WeaponSkillKey, WeaponSkillData>;
}

export interface WeaponFillAiDraft {
  id: string;
  name: string;
  rarity: number;
  description: string;
  sourceName: string;
  source: string;
  skills: Record<string, {
    name: string;
    statType: string;
    effects: Record<string, {
      name: string;
      type: string;
      category: string;
      levels: Record<string, number>;
    }>;
    levels: Record<string, {
      value?: number;
      description?: string;
    }>;
  }>;
}

const VALID_SKILL_KEYS: string[] = ['skill1', 'skill2', 'skill3'];
const VALID_BUCKETS: string[] = ['value', 'effect'];
const SUPPORTED_EFFECT_TYPES: string[] = ['atkPercent', 'critRate', 'critDmg', 'skillDmgBonus', 'elementalDmgBonus'];

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateWeaponProposalPayload(payload: unknown): AgentFillValidationResult<WeaponDraft> {
  if (!isRecord(payload)) {
    return { ok: false, errors: ['proposal payload must be object'] };
  }
  const errors: string[] = [];
  for (const key of ['id', 'name', 'type', 'description', 'imgUrl']) {
    if (typeof payload[key] !== 'string') {
      errors.push(`${key} must be string`);
    }
  }
  if (typeof payload.rarity !== 'number' || !Number.isFinite(payload.rarity)) {
    errors.push('rarity must be number');
  }
  if (!isRecord(payload.attackGrowth)) {
    errors.push('attackGrowth must be object');
  }
  if (!isRecord(payload.skills)) {
    errors.push('skills must be object');
  } else {
    for (const skillKey of VALID_SKILL_KEYS) {
      const skill = payload.skills[skillKey];
      if (!isRecord(skill)) {
        errors.push(`skills.${skillKey} must be object`);
        continue;
      }
      if (typeof skill.name !== 'string') errors.push(`skills.${skillKey}.name must be string`);
      if (typeof skill.statType !== 'string') errors.push(`skills.${skillKey}.statType must be string`);
      if (!isRecord(skill.effects)) errors.push(`skills.${skillKey}.effects must be object`);
      if (!isRecord(skill.levels)) errors.push(`skills.${skillKey}.levels must be object`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], normalized: payload as unknown as WeaponDraft };
}

export function readCurrentWeaponDraft(): WeaponDraft {
  return readJsonStorage<WeaponDraft>(WEAPON_DRAFT_STORAGE_KEY, createFallbackWeaponDraft());
}

export function readWeaponLibrary(): Record<string, WeaponDraft> {
  return readJsonStorage<Record<string, WeaponDraft>>(WEAPON_LIBRARY_STORAGE_KEY, {});
}

export function createFallbackWeaponDraft(): WeaponDraft {
  return {
    id: 'custom-weapon-001',
    name: '本地 Weapon 草稿',
    rarity: 1,
    type: 'sword',
    description: '',
    imgUrl: '',
    attackGrowth: {},
    skills: {
      skill1: { name: 'Skill 1', statType: 'atk', effects: {}, levels: {} },
      skill2: { name: 'Skill 2', statType: 'atk', effects: {}, levels: {} },
      skill3: { name: 'Skill 3', statType: 'atk', effects: {}, levels: {} },
    },
  };
}

export function validateWeaponFillAiDraft(candidate: unknown): AgentFillValidationResult<WeaponFillAiDraft> {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, errors: ['根节点必须是对象'] };
  }
  const obj = candidate as Record<string, unknown>;

  if (typeof obj.id !== 'string' || !obj.id) {
    errors.push('id 必须是字符串');
  }
  if (typeof obj.name !== 'string' || !obj.name) {
    errors.push('name 必须是字符串');
  }
  if (typeof obj.rarity !== 'number' || !Number.isFinite(obj.rarity)) {
    errors.push('rarity 必须是 number');
  }
  if (typeof obj.description !== 'string') {
    errors.push('description 必须是字符串');
  }

  const skills = obj.skills;
  if (!skills || typeof skills !== 'object') {
    errors.push('skills 必须是对象');
    return { ok: false, errors };
  }

  for (const [skillKey, skillValue] of Object.entries(skills)) {
    if (!VALID_SKILL_KEYS.includes(skillKey)) {
      errors.push(`非法 skill key: ${skillKey}，只允许 skill1/skill2/skill3`);
      continue;
    }
    if (!skillValue || typeof skillValue !== 'object') {
      errors.push(`skills.${skillKey} 必须是对象`);
      continue;
    }
    const skill = skillValue as Record<string, unknown>;
    if (typeof skill.name !== 'string') {
      errors.push(`skills.${skillKey}.name 必须是字符串`);
    }
    if (typeof skill.statType !== 'string') {
      errors.push(`skills.${skillKey}.statType 必须是字符串`);
    }

    const effects = skill.effects;
    if (effects && typeof effects === 'object') {
      for (const [effectKey, effectValue] of Object.entries(effects)) {
        if (!effectValue || typeof effectValue !== 'object') {
          errors.push(`skills.${skillKey}.effects.${effectKey} 必须是对象`);
          continue;
        }
        const effect = effectValue as Record<string, unknown>;
        if (typeof effect.name !== 'string') {
          errors.push(`skills.${skillKey}.effects.${effectKey}.name 必须是字符串`);
        }
        if (typeof effect.type !== 'string') {
          errors.push(`skills.${skillKey}.effects.${effectKey}.type 必须是字符串`);
        } else if (!SUPPORTED_EFFECT_TYPES.includes(effect.type)) {
          errors.push(`skills.${skillKey}.effects.${effectKey}.type "${effect.type}" 不在支持的类型列表中: ${SUPPORTED_EFFECT_TYPES.join('/')}`);
        }
        if (typeof effect.category !== 'string' || !VALID_BUCKETS.includes(effect.category)) {
          errors.push(`skills.${skillKey}.effects.${effectKey}.category 必须是 value 或 effect`);
        }
        const levels = effect.levels;
        if (levels && typeof levels === 'object') {
          for (const [levelKey, levelValue] of Object.entries(levels)) {
            if (typeof levelValue !== 'number' || Number.isNaN(levelValue)) {
              errors.push(`skills.${skillKey}.effects.${effectKey}.levels.${levelKey} 必须是 number，不接受字符串数字`);
            }
          }
        }
      }
    }

    const levels = skill.levels;
    if (levels && typeof levels === 'object') {
      for (const [levelKey, levelValue] of Object.entries(levels)) {
        if (!levelValue || typeof levelValue !== 'object') {
          errors.push(`skills.${skillKey}.levels.${levelKey} 必须是对象`);
          continue;
        }
        const lv = levelValue as Record<string, unknown>;
        if (lv.value !== undefined && (typeof lv.value !== 'number' || Number.isNaN(lv.value))) {
          errors.push(`skills.${skillKey}.levels.${levelKey}.value 必须是 number`);
        }
        if (lv.description !== undefined && typeof lv.description !== 'string') {
          errors.push(`skills.${skillKey}.levels.${levelKey}.description 必须是字符串`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function convertWeaponFillAiDraftToWeaponDraft(candidate: WeaponFillAiDraft): WeaponDraft {
  const skills: Record<WeaponSkillKey, WeaponSkillData> = {
    skill1: { name: 'Skill 1', statType: 'atk', effects: {}, levels: {} },
    skill2: { name: 'Skill 2', statType: 'atk', effects: {}, levels: {} },
    skill3: { name: 'Skill 3', statType: 'atk', effects: {}, levels: {} },
  };
  for (const [key, skill] of Object.entries(candidate.skills)) {
    if (!VALID_SKILL_KEYS.includes(key)) continue;
    const skillData: WeaponSkillData = {
      name: skill.name || key,
      statType: skill.statType || 'atk',
      effects: {},
      levels: {},
    };
    for (const [effectKey, effect] of Object.entries(skill.effects || {})) {
      skillData.effects[effectKey] = {
        name: effect.name || effectKey,
        type: effect.type || '',
        category: effect.category || 'value',
        levels: effect.levels || {},
      };
    }
    for (const [levelKey, level] of Object.entries(skill.levels || {})) {
      skillData.levels[levelKey] = {
        value: level.value,
        description: level.description || '',
      };
    }
    skills[key as WeaponSkillKey] = skillData;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    rarity: candidate.rarity,
    type: 'sword',
    description: candidate.description || '',
    imgUrl: '',
    attackGrowth: {},
    skills,
  };
}

function extractBalancedJsonObject(rawText: string) {
  const text = rawText.trim();
  const start = text.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function parseWeaponFillResult(rawText: string): { draft: WeaponDraft | null; errors: string[] } {
  const normalizedText = rawText.trim();
  if (!normalizedText) {
    return { draft: null, errors: ['AI response is empty'] };
  }
  const candidates = [normalizedText];
  const balancedJson = extractBalancedJsonObject(normalizedText);
  if (balancedJson && balancedJson !== normalizedText) {
    candidates.push(balancedJson);
  }
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const rawDraft = parsed && typeof parsed.draft === 'object' ? parsed.draft : parsed;
      const validation = validateWeaponFillAiDraft(rawDraft);
      if (!validation.ok) {
        errors.push(...validation.errors);
        continue;
      }
      return { draft: convertWeaponFillAiDraftToWeaponDraft(rawDraft as WeaponFillAiDraft), errors: [] };
    } catch (error) {
      errors.push(`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { draft: null, errors: Array.from(new Set(errors)) };
}

export const weaponFillAdapter: AgentFillDomainAdapter<WeaponDraft> = {
  domain: 'weapon',
  workflow: 'weapon.fill',
  commandPrefix: 'weapon.fill',
  draftStorageKey: WEAPON_DRAFT_STORAGE_KEY,
  libraryStorageKey: WEAPON_LIBRARY_STORAGE_KEY,
  supportedEffectTypes: SUPPORTED_EFFECT_TYPES,

  validateAiDraft(rawPayload: unknown): AgentFillValidationResult<WeaponDraft> {
    if (typeof rawPayload !== 'string') {
      return { ok: false, errors: ['payload must be string'] };
    }
    const parsed = parseWeaponFillResult(rawPayload);
    if (!parsed.draft) {
      return { ok: false, errors: parsed.errors };
    }
    return { ok: true, errors: [], normalized: parsed.draft };
  },

  validateProposalPayload: validateWeaponProposalPayload,

  createProposalPayload(validation, rawCommand): AgentFillProposalPayload<WeaponDraft> {
    const draft = validation.normalized!;
    return {
      rawCommand,
      normalized: draft,
      summary: weaponFillAdapter.summarizeProposal(draft),
    };
  },

  summarizeProposal(payload: WeaponDraft): string {
    const skillCount = Object.keys(payload.skills).length;
    const effectCount = Object.values(payload.skills).reduce((sum, s) => sum + Object.keys(s.effects).length, 0);
    return `weapon fill: name=${payload.name} skills=${skillCount} effects=${effectCount}`;
  },

  buildTaskPackage() {
    const draft = readCurrentWeaponDraft();
    const library = readWeaponLibrary();
    return {
      lines: [`[info] weapon.fill.task ready: name=${draft.name} skills=${Object.keys(draft.skills).length}`],
      data: {
        tool: 'weapon.fill',
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        currentDraft: draft,
        librarySummary: Object.entries(library).map(([id, w]) => ({ id, name: w.name, rarity: w.rarity })),
        supportedEffectTypes: SUPPORTED_EFFECT_TYPES,
        instruction: 'Return exactly one WeaponFillAiDraft JSON object. No Markdown. No explanation. weapon.fill.apply creates a proposal only; it does NOT save to library. After apply, the user approves/saves in Web CLI with Y/Y. If multiple pending proposals block Y/Y, stop and tell the user to run proposal.clear or handle proposals explicitly before another weapon.fill.apply. Do not ask the user to re-run weapon.fill.apply.',
        approvalSaveWarning: 'IMPORTANT: After REST weapon.fill.apply, the proposal is handed off to Web CLI automatically. The user opens /ai-cli and presses Y to approve, then Y to save. If stale pending proposals block Y/Y, tell the user to run proposal.clear in Web CLI. Do NOT tell the user to re-run weapon.fill.apply in the browser.',
      },
    };
  },

  applyToWorkingState(payload: WeaponDraft): { ok: boolean; error?: string } {
    try {
      writeJsonStorage(WEAPON_DRAFT_STORAGE_KEY, payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveToLocalTruth(payload: WeaponDraft): { ok: boolean; error?: string } {
    try {
      const nextLibrary = { ...readWeaponLibrary(), [payload.id]: payload };
      writeJsonStorage(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
      writeJsonStorage(WEAPON_DRAFT_STORAGE_KEY, payload);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
