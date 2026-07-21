import { pinyin } from 'pinyin-pro';
import assetPathsRaw from '../data/operatorAssetPaths.txt?raw';
import { APP_ROUTE_PATHS } from '../utils/appRoute';
import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../core/domain/buff';
import * as draftBuffModel from './operatorDraftBuffModel';

const DRAFT_PAGE_PATH = APP_ROUTE_PATHS.draft;
export const DRAFT_STORAGE_KEY = 'def.operator-editor.draft.v1';
export const LIBRARY_STORAGE_KEY = 'def.operator-editor.library.v1';
export const OPERATOR_LIBRARY_SHARE_TYPE = 'operator-library-share.v1';
export const OPERATOR_DRAFT_NAV_LINKS = [
  { label: '主界面', path: APP_ROUTE_PATHS.home },
  { label: '配置页', path: APP_ROUTE_PATHS.operatorConfig },
  { label: '武器', path: APP_ROUTE_PATHS.weaponSheet },
  { label: '装备', path: APP_ROUTE_PATHS.equipmentSheet },
  { label: 'Buff', path: APP_ROUTE_PATHS.buffSheet },
] as const;
export const RARITY_OPTIONS = [4, 5, 6] as const;
export const PROFESSION_OPTIONS = ['突击', '重装', '近卫', '辅助', '先锋', '术师'] as const;
export const WEAPON_OPTIONS = ['手铳', '双手剑', '长柄武器', '法术单元', '单手剑'] as const;
export const ABILITY_OPTIONS = ['力量', '敏捷', '智识', '意志'] as const;
export const ELEMENT_OPTIONS = ['physical', 'fire', 'ice', 'electric', 'nature'] as const;
export const ASSET_PATH_OPTIONS = assetPathsRaw
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
export const AVATAR_ASSET_OPTIONS = ASSET_PATH_OPTIONS.filter((path) => /\/assets\/avatars\/[^/]+\/[^/]+\.png$/i.test(path) && !/连携技|战技|终结技|icon_/i.test(path));
export const SKILL_LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'M1', 'M2', 'M3'] as const;
export const ATTRIBUTE_LEVEL_KEYS = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'] as const;
export const ATTRIBUTE_ROWS = [
  ['strength', '力量'],
  ['agility', '敏捷'],
  ['intelligence', '智识'],
  ['will', '意志'],
  ['atk', '攻击'],
  ['hp', '生命'],
] as const;
export const ATTRIBUTE_LEVEL_LABELS: Record<AttributeLevelKey, string> = {
  level1: '1',
  level20: '20',
  level40: '40',
  level60: '60',
  level80: '80',
  level90: '90',
};
export const OPERATOR_BUFF_GROUPS = [
  { key: 'talent', label: '天赋' },
  { key: 'potential', label: '潜能' },
  { key: 'skill', label: '技能' },
] as const;
const SKILL_BUTTON_TYPES = ['A', 'B', 'E', 'Q', 'Dot'] as const;
export const SKILL_TYPE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'A', label: 'A' },
  { key: 'B', label: 'B' },
  { key: 'E', label: 'E' },
  { key: 'Q', label: 'Q' },
  { key: 'Dot', label: 'Dot' },
  { key: 'other', label: '其他' },
] as const;
const OPERATOR_BUFF_CATEGORIES = ['passive', 'condition', 'countable'] as const;
const OPERATOR_BUFF_TYPE_LABELS: Record<string, string> = {
  atkPercentBoost: '攻击力百分比',
  atk: '固定攻击力',
  flatAtk: '固定攻击力',
  mainStat: '主能力固定值',
  subStat: '副能力固定值',
  mainStatBoost: '主能力提升',
  subStatBoost: '副能力提升',
  allStatBoost: '全属性提升',
  strengthBoost: '力量提升',
  agilityBoost: '敏捷提升',
  intelligenceBoost: '智识提升',
  willBoost: '意志提升',
  hpPercent: '生命百分比',
  critRateBoost: '暴击率',
  critDmgBonusBoost: '暴击伤害',
  physicalDmgBonus: '物理伤害加成',
  magicDmgBonus: '法术伤害加成',
  fireDmgBonus: '灼热伤害加成',
  electricDmgBonus: '电磁伤害加成',
  iceDmgBonus: '寒冷伤害加成',
  natureDmgBonus: '自然伤害加成',
  allDmgBonus: '全伤害加成',
  skillDmgBonus: '战技伤害加成',
  chainSkillDmgBonus: '连携技伤害加成',
  ultimateDmgBonus: '终结技伤害加成',
  normalAttackDmgBonus: '普攻伤害加成',
  dotDmgBonus: '持续伤害加成',
  allSkillDmgBonus: '全技能伤害加成',
  imbalanceDmgBonus: '失衡伤害加成',
  physicalFragile: '物理易伤',
  fireFragile: '灼热易伤',
  electricFragile: '电磁易伤',
  iceFragile: '寒冷易伤',
  natureFragile: '自然易伤',
  magicFragile: '法术易伤',
  physicalVulnerability: '物理脆弱',
  fireVulnerability: '灼热脆弱',
  electricVulnerability: '电磁脆弱',
  iceVulnerability: '寒冷脆弱',
  natureVulnerability: '自然脆弱',
  magicVulnerability: '法术脆弱',
  physicalAmplify: '物理增幅',
  magicAmplify: '法术增幅',
  fireAmplify: '灼热增幅',
  electricAmplify: '电磁增幅',
  iceAmplify: '寒冷增幅',
  natureAmplify: '自然增幅',
  allCorrosion: '全属性降抗',
  physicalCorrosion: '物理降抗',
  magicCorrosion: '法术降抗',
  fireCorrosion: '灼热降抗',
  electricCorrosion: '电磁降抗',
  iceCorrosion: '寒冷降抗',
  natureCorrosion: '自然降抗',
  allResistanceIgnore: '无视全部抗性',
  physicalResistanceIgnore: '无视物理抗性',
  magicResistanceIgnore: '无视法术抗性',
  fireResistanceIgnore: '无视灼热抗性',
  electricResistanceIgnore: '无视电磁抗性',
  iceResistanceIgnore: '无视寒冷抗性',
  natureResistanceIgnore: '无视自然抗性',
  comboDamageBonus: '连击伤害加成',
  multiplierBonus: '倍率加算',
  sourceSkillBoost: '源石技艺强度',
  ultimateChargeEfficiency: '终结技充能效率',
  healingBonus: '治疗效率',
  receivedHealingBonus: '受治疗效率',
  chainCooldownReduction: '连携技冷却缩减',
  imbalanceEfficiency: '失衡效率',
  damageReduction: '伤害减免',
};
export const OPERATOR_BUFF_BUSINESS_TYPE_LABELS: Record<draftBuffModel.OperatorBuffBusinessType, string> = {
  passive: 'passive 常驻',
  condition: 'condition 条件',
  countable: 'countable 计层',
  multiplier: 'multiplier 乘区乘算',
  extraHit: 'countable extraHit 计层额外伤害段',
};

export type SkillButtonType = 'A' | 'B' | 'E' | 'Q' | 'Dot';
export type HitSkillType = SkillButtonType;
export type SkillTypeFilter = (typeof SKILL_TYPE_FILTERS)[number]['key'];
export type HitElement = 'physical' | 'fire' | 'ice' | 'electric' | 'nature';
type SkillLevelKey = (typeof SKILL_LEVEL_KEYS)[number];
export type AttributeLevelKey = (typeof ATTRIBUTE_LEVEL_KEYS)[number];
export type AttributeKey = (typeof ATTRIBUTE_ROWS)[number][0];
type AttributeLevels = Record<AttributeKey, Record<AttributeLevelKey, number>>;
export type OperatorBuffGroupKey = (typeof OPERATOR_BUFF_GROUPS)[number]['key'];
type OperatorBuffCategory = (typeof OPERATOR_BUFF_CATEGORIES)[number];
type OperatorBuffValueMode = 'fixed' | 'derived';
type OperatorBuffDerivedSource = 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';
type OperatorBuffs = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffect> }>;

interface OperatorBuffDerivedValue {
  source: OperatorBuffDerivedSource;
  perPointValue: number;
}

export interface OperatorBuffEffect {
  schemaVersion?: 2;
  effectId: string;
  name: string;
  type: string;
  category: OperatorBuffCategory;
  value?: number;
  maxStacks?: number;
  unit?: 'flat' | 'percent' | string;
  description?: string;
  raw?: string;
  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValue;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
  multiplier?: BuffMultiplier;
}

export interface HitMetaDraft {
  multiplier?: number;
  displayName: string;
  element: HitElement;
  skillType: HitSkillType;
  levels: Record<SkillLevelKey, number>;
}

export interface SkillDraft {
  displayName: string;
  buttonType: SkillButtonType;
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

function getSkillIndexFromKey(skillKey: string) {
  const matched = skillKey.match(/(\d+)$/);
  return matched ? Number(matched[1]) : 1;
}

function isSkillButtonType(value: unknown): value is SkillButtonType {
  return typeof value === 'string' && SKILL_BUTTON_TYPES.includes(value as SkillButtonType);
}

function buildTypedSkillKey(buttonType: SkillButtonType, index: number) {
  return `skill-${buttonType}-${index}`;
}

export function getSkillFilterKey(skill: SkillDraft): SkillTypeFilter {
  return isSkillButtonType(skill.buttonType) ? skill.buttonType : 'other';
}

function getHitIndexFromKey(hitKey: string) {
  const matched = hitKey.match(/(\d+)$/);
  return matched ? Number(matched[1]) : 1;
}

export function createDefaultHit(hitKey = 'hit1'): HitMetaDraft {
  const hitIndex = getHitIndexFromKey(hitKey);
  return {
    displayName: `第${hitIndex}击`,
    element: 'physical',
    skillType: 'A',
    levels: Object.fromEntries(SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, 0])) as Record<SkillLevelKey, number>,
  };
}

function createDefaultAttributeLevels(value = 0): AttributeLevels {
  return Object.fromEntries(
    ATTRIBUTE_ROWS.map(([attributeKey]) => [
      attributeKey,
      Object.fromEntries(ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [levelKey, value])),
    ])
  ) as AttributeLevels;
}

function createDefaultBuffs(): OperatorBuffs {
  return draftBuffModel.createDefaultBuffs();
}

export function createDefaultBuffEffect(effectKey = 'effect1'): OperatorBuffEffect {
  return draftBuffModel.createDefaultBuffEffect(effectKey);
}

export function createDefaultSkill(buttonType: SkillButtonType = 'A', skillKey = 'skill-A-1'): SkillDraft {
  const skillIndex = getSkillIndexFromKey(skillKey);
  return {
    displayName: `新技能${skillIndex}`,
    buttonType,
    iconUrl: '',
    hitCount: 1,
    hitMeta: {
      hit1: createDefaultHit('hit1'),
    },
  };
}

function createDefaultDraft(): OperatorDraft {
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
    attributes: createDefaultAttributeLevels(),
    skills: {
      'skill-A-1': createDefaultSkill('A', 'skill-A-1'),
    },
    buffs: createDefaultBuffs(),
  };
}

export function createEmptyDraft(nextId = 'custom-operator-001'): OperatorDraft {
  return {
    ...createDefaultDraft(),
    id: nextId,
    name: '新建干员',
    skills: {},
  };
}

export function buildOperatorIdFromName(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return '';
  }
  const rawPinyin = pinyin(trimmedName, { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  const normalized = (rawPinyin || trimmedName.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized;
}

function getOperatorBuffTypeLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '-';
  return OPERATOR_BUFF_TYPE_LABELS[trimmed] ?? trimmed;
}

export function getOperatorBuffTypeDisplayLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '-';
  return `${getOperatorBuffTypeLabel(trimmed)} · ${trimmed}`;
}

export function isDraftPath(pathname: string) {
  return pathname === DRAFT_PAGE_PATH;
}

export function cloneDraft<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function syncHitCount(skill: SkillDraft) {
  skill.hitCount = Object.keys(skill.hitMeta).length;
}

function normalizeAttributeLevels(rawAttributes: unknown): AttributeLevels {
  const source = rawAttributes && typeof rawAttributes === 'object' ? rawAttributes as Record<string, unknown> : {};
  return Object.fromEntries(
    ATTRIBUTE_ROWS.map(([attributeKey]) => {
      const rawValue = source[attributeKey];
      const legacyValue = typeof rawValue === 'number' ? rawValue : 0;
      const levelSource = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : {};
      return [
        attributeKey,
        Object.fromEntries(
          ATTRIBUTE_LEVEL_KEYS.map((levelKey) => [
            levelKey,
            typeof levelSource[levelKey] === 'number' ? levelSource[levelKey] : legacyValue,
          ])
        ),
      ];
    })
  ) as AttributeLevels;
}

function validateRawDraftBuffMultipliers(rawDraft: Partial<OperatorDraft>) {
  draftBuffModel.validateRawDraftBuffMultipliers(rawDraft);
}

export function validateDraftBuffEffects(draft: OperatorDraft) {
  return draftBuffModel.validateDraftBuffEffects(draft);
}

function normalizeBuffs(rawBuffs: unknown): OperatorBuffs {
  return draftBuffModel.normalizeBuffs(rawBuffs);
}

export function normalizeDraft(value: OperatorDraft) {
  value.attributes = normalizeAttributeLevels(value.attributes);
  value.buffs = normalizeBuffs(value.buffs);
  Object.entries(value.skills).forEach(([skillKey, skill]) => {
    if (!skill.displayName?.trim()) {
      skill.displayName = createDefaultSkill(skill.buttonType, skillKey).displayName;
    }
    Object.entries(skill.hitMeta).forEach(([hitKey, hit]) => {
      if (!hit.displayName?.trim()) {
        hit.displayName = createDefaultHit(hitKey).displayName;
      }
      const fallbackValue = typeof hit.multiplier === 'number' ? hit.multiplier : 0;
      hit.levels = Object.fromEntries(
        SKILL_LEVEL_KEYS.map((levelKey) => [levelKey, typeof hit.levels?.[levelKey] === 'number' ? hit.levels[levelKey] : fallbackValue])
      ) as Record<SkillLevelKey, number>;
      delete hit.multiplier;
    });
    syncHitCount(skill);
  });
  return value;
}

export function parseImportedDraft(rawText: string) {
  const parsed = JSON.parse(rawText) as Partial<OperatorDraft>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象');
  }
  if (!parsed.id || !parsed.name || !parsed.skills || typeof parsed.skills !== 'object') {
    throw new Error('JSON 缺少 id / name / skills');
  }
  validateRawDraftBuffMultipliers(parsed);
  return normalizeDraft(parsed as OperatorDraft);
}

export function getNextSkillKeyByType(draft: OperatorDraft, buttonType: SkillButtonType) {
  let index = 1;
  while (draft.skills[buildTypedSkillKey(buttonType, index)]) {
    index += 1;
  }
  return buildTypedSkillKey(buttonType, index);
}

export function getNextDraftId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-operator-${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `custom-operator-${String(index).padStart(3, '0')}`;
}

export function getNextHitKey(skill: SkillDraft) {
  let index = 1;
  while (skill.hitMeta[`hit${index}`]) {
    index += 1;
  }
  return `hit${index}`;
}

export function getNextBuffEffectKey(effects: Record<string, OperatorBuffEffect>) {
  let index = 1;
  while (effects[`effect${index}`]) {
    index += 1;
  }
  return `effect${index}`;
}

export function syncSkillOrderWithDraft(skillOrder: string[], draft: OperatorDraft) {
  const keys = Object.keys(draft.skills);
  const filtered = skillOrder.filter((key) => keys.includes(key));
  const missing = keys.filter((key) => !filtered.includes(key));
  return [...filtered, ...missing];
}

export function moveSkillKey(skillOrder: string[], fromKey: string, toKey: string) {
  if (fromKey === toKey) {
    return skillOrder;
  }

  const nextOrder = [...skillOrder];
  const fromIndex = nextOrder.indexOf(fromKey);
  const toIndex = nextOrder.indexOf(toKey);
  if (fromIndex === -1 || toIndex === -1) {
    return skillOrder;
  }

  nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, fromKey);
  return nextOrder;
}

export function buildOrderedDraft(draft: OperatorDraft, skillOrder: string[]) {
  const nextSkills: Record<string, SkillDraft> = {};
  const nextOrder = syncSkillOrderWithDraft(skillOrder, draft);
  nextOrder.forEach((skillKey) => {
    nextSkills[skillKey] = draft.skills[skillKey];
  });
  return {
    ...draft,
    skills: nextSkills,
  };
}

export function reorderDraftStructure(draft: OperatorDraft) {
  const nextSkills: Record<string, SkillDraft> = {};
  const skillKeyMap: Record<string, string> = {};
  const nextTypeIndexes: Record<SkillButtonType, number> = {
    A: 0,
    B: 0,
    E: 0,
    Q: 0,
    Dot: 0,
  };
  const orderedSkillKeys = Object.keys(draft.skills);
  orderedSkillKeys.forEach((skillKey, skillIndex) => {
    const skill = cloneDraft(draft.skills[skillKey]);
    const nextSkillKey = isSkillButtonType(skill.buttonType)
      ? buildTypedSkillKey(skill.buttonType, nextTypeIndexes[skill.buttonType] += 1)
      : `skill-other-${skillIndex + 1}`;
    const nextHitMeta: Record<string, HitMetaDraft> = {};
    Object.entries(skill.hitMeta).forEach(([, hit], hitIndex) => {
      const nextHitKey = `hit${hitIndex + 1}`;
      nextHitMeta[nextHitKey] = {
        ...hit,
        displayName: hit.displayName?.trim() ? hit.displayName : createDefaultHit(nextHitKey).displayName,
      };
    });
    skill.hitMeta = nextHitMeta;
    syncHitCount(skill);
    skillKeyMap[skillKey] = nextSkillKey;
    nextSkills[nextSkillKey] = skill;
  });
  return {
    draft: {
      ...draft,
      skills: nextSkills,
    },
    skillKeyMap,
  };
}

export function loadDraftFromStorage() {
  if (typeof window === 'undefined') {
    return createDefaultDraft();
  }

  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) {
    return createDefaultDraft();
  }

  try {
    return parseImportedDraft(raw);
  } catch {
    return createDefaultDraft();
  }
}

export async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}
