import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pinyin } from 'pinyin-pro';
import './OperatorDraftPage.css';
import assetPathsRaw from '../../asset-paths.txt?raw';
import { loadReferenceOperatorDraft, loadReferenceOperatorNames } from './operatorDraftReference';
import { buildWeaponSearchIndex, searchWeapons } from '../utils/weaponFuzzySearch';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';
import { normalizeAssetUrl } from '../utils/assetResolver';
import { imageBridge } from '../utils/imageBridge';
import { toUserImageRelPath } from '../utils/imageFileService';
import type { BuffEffectKind, BuffExtraHitConfig } from '../core/domain/buff';
import { EXTRA_HIT_DAMAGE_TYPES, normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import DeferredNumberInput, { parseIntegerInput } from './DeferredNumberInput';

const DRAFT_PAGE_PATH = APP_ROUTE_PATHS.draft;
const DRAFT_STORAGE_KEY = 'def.operator-editor.draft.v1';
const LIBRARY_STORAGE_KEY = 'def.operator-editor.library.v1';
const OPERATOR_LIBRARY_SHARE_TYPE = 'operator-library-share.v1';
const OPERATOR_DRAFT_NAV_LINKS = [
  { label: '主界面', path: APP_ROUTE_PATHS.home },
  { label: '配置页', path: APP_ROUTE_PATHS.operatorConfig },
  { label: '武器', path: APP_ROUTE_PATHS.weaponSheet },
  { label: '装备', path: APP_ROUTE_PATHS.equipmentSheet },
  { label: 'Buff', path: APP_ROUTE_PATHS.buffSheet },
] as const;
const RARITY_OPTIONS = [4, 5, 6] as const;
const PROFESSION_OPTIONS = ['突击', '重装', '近卫', '辅助', '先锋', '术师'] as const;
const WEAPON_OPTIONS = ['手铳', '双手剑', '长柄武器', '法术单元', '单手剑'] as const;
const ABILITY_OPTIONS = ['力量', '敏捷', '智识', '意志'] as const;
const ELEMENT_OPTIONS = ['physical', 'fire', 'ice', 'electric', 'nature'] as const;
const ASSET_PATH_OPTIONS = assetPathsRaw
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const AVATAR_ASSET_OPTIONS = ASSET_PATH_OPTIONS.filter((path) => /\/assets\/avatars\/[^/]+\/[^/]+\.png$/i.test(path) && !/连携技|战技|终结技|icon_/i.test(path));
const SKILL_LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'M1', 'M2', 'M3'] as const;
const ATTRIBUTE_LEVEL_KEYS = ['level1', 'level20', 'level40', 'level60', 'level80', 'level90'] as const;
const ATTRIBUTE_ROWS = [
  ['strength', '力量'],
  ['agility', '敏捷'],
  ['intelligence', '智识'],
  ['will', '意志'],
  ['atk', '攻击'],
  ['hp', '生命'],
] as const;
const ATTRIBUTE_LEVEL_LABELS: Record<AttributeLevelKey, string> = {
  level1: '1',
  level20: '20',
  level40: '40',
  level60: '60',
  level80: '80',
  level90: '90',
};
const OPERATOR_BUFF_GROUPS = [
  { key: 'talent', label: '天赋' },
  { key: 'potential', label: '潜能' },
  { key: 'skill', label: '技能' },
] as const;
const SKILL_BUTTON_TYPES = ['A', 'B', 'E', 'Q'] as const;
const SKILL_TYPE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'A', label: 'A' },
  { key: 'B', label: 'B' },
  { key: 'E', label: 'E' },
  { key: 'Q', label: 'Q' },
  { key: 'other', label: '其他' },
] as const;
const OPERATOR_BUFF_CATEGORIES = ['passive', 'condition', 'countable'] as const;
const OPERATOR_BUFF_TYPE_OPTIONS = [
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
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'allCorrosion',
  'physicalCorrosion',
  'magicCorrosion',
  'fireCorrosion',
  'electricCorrosion',
  'iceCorrosion',
  'natureCorrosion',
  'allResistanceIgnore',
  'physicalResistanceIgnore',
  'magicResistanceIgnore',
  'fireResistanceIgnore',
  'electricResistanceIgnore',
  'iceResistanceIgnore',
  'natureResistanceIgnore',
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
] as const;
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
  multiplierMultiplier: '倍率乘算',
  sourceSkillBoost: '源石技艺强度',
  ultimateChargeEfficiency: '终结技充能效率',
  healingBonus: '治疗效率',
  receivedHealingBonus: '受治疗效率',
  chainCooldownReduction: '连携技冷却缩减',
  imbalanceEfficiency: '失衡效率',
  damageReduction: '伤害减免',
};
const OPERATOR_PERCENTLIKE_BUFF_TYPES = new Set([
  'atkPercentBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
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
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'comboDamageBonus',
  'multiplierBonus',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
]);
const OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS = [
  { value: 'hp', label: '生命值' },
  { value: 'atk', label: '攻击力' },
  { value: 'strength', label: '力量' },
  { value: 'agility', label: '敏捷' },
  { value: 'intelligence', label: '智识' },
  { value: 'will', label: '意志' },
  { value: 'sourceSkill', label: '源石技艺强度' },
] as const;
const OPERATOR_BUFF_DERIVED_SOURCE_LABELS = Object.fromEntries(
  OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS.map((option) => [option.value, option.label])
) as Record<OperatorBuffDerivedSource, string>;

type SkillButtonType = 'A' | 'B' | 'E' | 'Q';
type HitSkillType = SkillButtonType | 'Dot';
type SkillTypeFilter = (typeof SKILL_TYPE_FILTERS)[number]['key'];
type HitElement = 'physical' | 'fire' | 'ice' | 'electric' | 'nature';
type SkillLevelKey = (typeof SKILL_LEVEL_KEYS)[number];
type AttributeLevelKey = (typeof ATTRIBUTE_LEVEL_KEYS)[number];
type AttributeKey = (typeof ATTRIBUTE_ROWS)[number][0];
type AttributeLevels = Record<AttributeKey, Record<AttributeLevelKey, number>>;
type OperatorBuffGroupKey = (typeof OPERATOR_BUFF_GROUPS)[number]['key'];
type OperatorBuffCategory = (typeof OPERATOR_BUFF_CATEGORIES)[number];
type OperatorBuffValueMode = 'fixed' | 'derived';
type OperatorBuffDerivedSource = 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';
type OperatorBuffs = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffect> }>;

interface OperatorBuffDerivedValue {
  source: OperatorBuffDerivedSource;
  perPointValue: number;
}

interface OperatorBuffEffect {
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
}

interface HitMetaDraft {
  multiplier?: number;
  displayName: string;
  element: HitElement;
  skillType: HitSkillType;
  levels: Record<SkillLevelKey, number>;
}

interface SkillDraft {
  displayName: string;
  buttonType: SkillButtonType;
  iconUrl: string;
  hitCount: number;
  hitMeta: Record<string, HitMetaDraft>;
}

interface OperatorDraft {
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

function getSkillFilterKey(skill: SkillDraft): SkillTypeFilter {
  return isSkillButtonType(skill.buttonType) ? skill.buttonType : 'other';
}

function getHitIndexFromKey(hitKey: string) {
  const matched = hitKey.match(/(\d+)$/);
  return matched ? Number(matched[1]) : 1;
}

function createDefaultHit(hitKey = 'hit1'): HitMetaDraft {
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
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

function createDefaultBuffEffect(effectKey = 'effect1'): OperatorBuffEffect {
  return {
    effectId: effectKey,
    name: '新 Buff',
    type: '',
    category: 'passive',
    unit: '',
    valueMode: 'fixed',
    description: '',
    raw: '',
    effectKind: 'modifier',
  };
}

function createDefaultSkill(buttonType: SkillButtonType = 'A', skillKey = 'skill-A-1'): SkillDraft {
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

function createEmptyDraft(nextId = 'custom-operator-001'): OperatorDraft {
  return {
    ...createDefaultDraft(),
    id: nextId,
    name: '新建干员',
    skills: {},
  };
}

function buildOperatorIdFromName(name: string) {
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

function buildSearchIndex(values: Array<string | undefined | null>) {
  const tokens = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  const joined = tokens.join(' ');
  if (!joined) return '';
  const fullPinyin = pinyin(joined, { toneType: 'none', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join(' ');
  const initials = pinyin(joined, { toneType: 'none', pattern: 'first', type: 'array' })
    .map((item) => String(item).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');
  return [joined, joined.toLowerCase(), fullPinyin, initials].filter(Boolean).join(' | ');
}

function getOperatorBuffTypeLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '-';
  return OPERATOR_BUFF_TYPE_LABELS[trimmed] ?? trimmed;
}

function getOperatorBuffTypeDisplayLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '-';
  return `${getOperatorBuffTypeLabel(trimmed)} · ${trimmed}`;
}

function buildOperatorBuffTypeSearchText(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) return '';
  return buildSearchIndex([trimmed, getOperatorBuffTypeLabel(trimmed), getOperatorBuffTypeDisplayLabel(trimmed)]);
}

function inferOperatorBuffUnit(buffType: string): 'flat' | 'percent' {
  return OPERATOR_PERCENTLIKE_BUFF_TYPES.has(buffType.trim()) ? 'percent' : 'flat';
}

function formatOperatorBuffPerPointValue(value: number) {
  return Number(value.toFixed(6)).toString();
}

function isDraftPath(pathname: string) {
  return pathname === DRAFT_PAGE_PATH;
}

function cloneDraft<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function syncHitCount(skill: SkillDraft) {
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

function normalizeBuffEffect(effectKey: string, rawEffect: unknown): OperatorBuffEffect {
  const source = rawEffect && typeof rawEffect === 'object' ? rawEffect as Record<string, unknown> : {};
  const rawCategory = typeof source.category === 'string' ? source.category : '';
  const category: OperatorBuffCategory = rawCategory === 'condition'
    ? 'condition'
    : rawCategory === 'countable'
      ? 'countable'
      : 'passive';
  const rawValue = source.value;
  const valueMode: OperatorBuffValueMode = source.valueMode === 'derived' ? 'derived' : 'fixed';
  const rawDerivedValue = source.derivedValue && typeof source.derivedValue === 'object'
    ? source.derivedValue as Record<string, unknown>
    : {};
  const rawDerivedSource = typeof rawDerivedValue.source === 'string' ? rawDerivedValue.source : '';
  const derivedSource = OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS.some((option) => option.value === rawDerivedSource)
    ? rawDerivedSource as OperatorBuffDerivedSource
    : null;
  const rawPerPointValue = rawDerivedValue.perPointValue ?? rawDerivedValue.scale;
  const effectKind: BuffEffectKind = source.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  return {
    effectId: String(source.effectId || effectKey),
    name: String(source.name || effectKey),
    type: effectKind === 'extraHit' ? '' : String(source.type || ''),
    category: effectKind === 'extraHit' ? 'passive' : category,
    ...(typeof rawValue === 'number' && Number.isFinite(rawValue) ? { value: rawValue } : {}),
    ...(category === 'countable' && typeof source.maxStacks === 'number' && Number.isFinite(source.maxStacks) ? { maxStacks: Math.max(1, Math.floor(source.maxStacks)) } : {}),
    unit: typeof source.unit === 'string' ? source.unit : '',
    valueMode,
    ...(valueMode === 'derived' && derivedSource && typeof rawPerPointValue === 'number' && Number.isFinite(rawPerPointValue)
      ? { derivedValue: { source: derivedSource, perPointValue: rawPerPointValue } }
      : {}),
    description: typeof source.description === 'string' ? source.description : '',
    raw: typeof source.raw === 'string' ? source.raw : '',
    effectKind,
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig(source.extraHitConfig, `${effectKey}-extra-hit`) }
      : {}),
  };
}

function normalizeBuffs(rawBuffs: unknown): OperatorBuffs {
  const source = rawBuffs && typeof rawBuffs === 'object' ? rawBuffs as Record<string, unknown> : {};
  return Object.fromEntries(
    OPERATOR_BUFF_GROUPS.map(({ key }) => {
      const rawGroup = source[key] && typeof source[key] === 'object' ? source[key] as Record<string, unknown> : {};
      const rawEffects = rawGroup.effects && typeof rawGroup.effects === 'object' ? rawGroup.effects as Record<string, unknown> : {};
      return [
        key,
        {
          effects: Object.fromEntries(
            Object.entries(rawEffects).map(([effectKey, rawEffect]) => [effectKey, normalizeBuffEffect(effectKey, rawEffect)])
          ),
        },
      ];
    })
  ) as OperatorBuffs;
}

function normalizeDraft(value: OperatorDraft) {
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

function parseImportedDraft(rawText: string) {
  const parsed = JSON.parse(rawText) as Partial<OperatorDraft>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 根节点必须是对象');
  }
  if (!parsed.id || !parsed.name || !parsed.skills || typeof parsed.skills !== 'object') {
    throw new Error('JSON 缺少 id / name / skills');
  }
  return normalizeDraft(parsed as OperatorDraft);
}

function getNextSkillKeyByType(draft: OperatorDraft, buttonType: SkillButtonType) {
  let index = 1;
  while (draft.skills[buildTypedSkillKey(buttonType, index)]) {
    index += 1;
  }
  return buildTypedSkillKey(buttonType, index);
}

function getNextDraftId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-operator-${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `custom-operator-${String(index).padStart(3, '0')}`;
}

function getNextHitKey(skill: SkillDraft) {
  let index = 1;
  while (skill.hitMeta[`hit${index}`]) {
    index += 1;
  }
  return `hit${index}`;
}

function getNextBuffEffectKey(effects: Record<string, OperatorBuffEffect>) {
  let index = 1;
  while (effects[`effect${index}`]) {
    index += 1;
  }
  return `effect${index}`;
}

function syncSkillOrderWithDraft(skillOrder: string[], draft: OperatorDraft) {
  const keys = Object.keys(draft.skills);
  const filtered = skillOrder.filter((key) => keys.includes(key));
  const missing = keys.filter((key) => !filtered.includes(key));
  return [...filtered, ...missing];
}

function moveSkillKey(skillOrder: string[], fromKey: string, toKey: string) {
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

function buildOrderedDraft(draft: OperatorDraft, skillOrder: string[]) {
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

function reorderDraftStructure(draft: OperatorDraft) {
  const nextSkills: Record<string, SkillDraft> = {};
  const skillKeyMap: Record<string, string> = {};
  const nextTypeIndexes: Record<SkillButtonType, number> = {
    A: 0,
    B: 0,
    E: 0,
    Q: 0,
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

function loadDraftFromStorage() {
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

async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-c-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
}

function renderMiniMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split('\n');
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {items.map((item, index) => (
          <li key={`li-${index}`}>{renderInlineMarkdown(item, `list-${nodes.length}-${index}`)}</li>
        ))}
      </ul>
    );
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      return;
    }

    flushList();

    if (line.startsWith('## ')) {
      nodes.push(<h4 key={`h4-${index}`}>{renderInlineMarkdown(line.slice(3), `h4-${index}`)}</h4>);
      return;
    }

    if (line.startsWith('# ')) {
      nodes.push(<h3 key={`h3-${index}`}>{renderInlineMarkdown(line.slice(2), `h3-${index}`)}</h3>);
      return;
    }

    nodes.push(<p key={`p-${index}`}>{renderInlineMarkdown(line, `p-${index}`)}</p>);
  });

  flushList();
  return nodes;
}

interface SearchablePathSelectProps {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}

function SearchablePathSelect({ value, options, placeholder, onChange }: SearchablePathSelectProps) {
  const [keyword, setKeyword] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const searchIndex = useMemo(() => buildWeaponSearchIndex(options), [options]);
  const matchedOptions = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      return options.slice(0, 40);
    }
    const results = searchWeapons(trimmed, searchIndex);
    return results.slice(0, 40);
  }, [keyword, options, searchIndex]);

  useEffect(() => {
    setKeyword(value);
  }, [value]);

  return (
    <div className="operator-draft-searchable-select">
      <input
        value={keyword}
        onChange={(event) => {
          const nextKeyword = event.target.value;
          setKeyword(nextKeyword);
          setIsOpen(true);
          onChange(nextKeyword);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false);
            setKeyword(value);
          }, 120);
        }}
        placeholder={placeholder}
      />
      {isOpen ? (
        <div className="operator-draft-searchable-select-list">
          {matchedOptions.length ? (
            matchedOptions.map((option) => (
              <button
                type="button"
                key={option}
                className={`operator-draft-searchable-option${value === option ? ' is-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setKeyword(option);
                  onChange(option);
                  setIsOpen(false);
                }}
              >
                {option}
              </button>
            ))
          ) : (
            <div className="operator-draft-searchable-empty">无匹配结果</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { isDraftPath };

export function OperatorDraftPage() {
  const [draft, setDraft] = useState<OperatorDraft>(() => loadDraftFromStorage());
  const [referenceNames, setReferenceNames] = useState<string[]>([]);
  const [selectedReferenceName, setSelectedReferenceName] = useState('');
  const [localDraftIds, setLocalDraftIds] = useState<string[]>([]);
  const [localDraftNames, setLocalDraftNames] = useState<Record<string, string>>({});
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [selectedDeleteLocalDraftId, setSelectedDeleteLocalDraftId] = useState('');
  const [messages, setMessages] = useState<string[]>([
    '已进入干员模板编辑器',
  ]);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [activeBuffGroupKey, setActiveBuffGroupKey] = useState<OperatorBuffGroupKey>('talent');
  const [selectedBuffEffectKey, setSelectedBuffEffectKey] = useState<string | null>(null);
  const [operatorBuffTypeQuery, setOperatorBuffTypeQuery] = useState('');
  const [skillOrder, setSkillOrder] = useState<string[]>([]);
  const [activeSkillTypeFilter, setActiveSkillTypeFilter] = useState<SkillTypeFilter>('all');
  const [draggingSkillKey, setDraggingSkillKey] = useState<string | null>(null);
  const [dragOverSkillKey, setDragOverSkillKey] = useState<string | null>(null);
  const [isExportJsonModalOpen, setIsExportJsonModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isDeleteLocalDraftModalOpen, setIsDeleteLocalDraftModalOpen] = useState(false);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [loadedLocalDraftId, setLoadedLocalDraftId] = useState<string | null>(null);
  const [shareDraftName, setShareDraftName] = useState('');
  const [userAssetPathOptions, setUserAssetPathOptions] = useState<string[]>([]);
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<OperatorDraft> | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const skillKeys = Object.keys(draft.skills);
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setSelectedSkillKey(skillKeys[0] ?? null);
    }
  }, [draft, selectedSkillKey]);

  useEffect(() => {
    if (activeSkillTypeFilter === 'all') {
      return;
    }
    if (selectedSkillKey && draft.skills[selectedSkillKey] && getSkillFilterKey(draft.skills[selectedSkillKey]) === activeSkillTypeFilter) {
      return;
    }

    const nextSelectedSkillKey = skillOrder.find((skillKey) => {
      const skill = draft.skills[skillKey];
      return skill && getSkillFilterKey(skill) === activeSkillTypeFilter;
    }) ?? null;
    setSelectedSkillKey(nextSelectedSkillKey);
    setSelectedHitKey(nextSelectedSkillKey ? Object.keys(draft.skills[nextSelectedSkillKey].hitMeta)[0] ?? null : null);
  }, [activeSkillTypeFilter, draft, selectedSkillKey, skillOrder]);

  useEffect(() => {
    setSkillOrder((prev) => {
      const next = syncSkillOrderWithDraft(prev, draft);
      return next.length === prev.length && next.every((skillKey, index) => skillKey === prev[index]) ? prev : next;
    });
  }, [draft]);

  useEffect(() => {
    let isMounted = true;

    const loadReferenceOperators = async () => {
      try {
        if (!isMounted) {
          return;
        }
        const names = await loadReferenceOperatorNames();
        if (!isMounted) {
          return;
        }
        setReferenceNames(names);
        setSelectedReferenceName((prev) => prev || names[0] || '');
      } catch (error) {
        if (!isMounted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'operators-list 加载失败';
        setMessages((prev) => [`[ERR] ${message}`, ...prev].slice(0, 12));
      }
    };

    loadReferenceOperators();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadUserAssetOptions = async () => {
      try {
        const assets = await imageBridge.listAssets();
        if (!isMounted) return;
        const paths = assets
          .map((asset) => {
            const relPath = toUserImageRelPath(asset);
            return relPath ? `user-images/${relPath}` : '';
          })
          .filter((path): path is string => Boolean(path));
        setUserAssetPathOptions(Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
      } catch {
        if (isMounted) {
          setUserAssetPathOptions([]);
        }
      }
    };

    void loadUserAssetOptions();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    const localDraftIdsFromStorage: string[] = [];
    const localDraftNamesFromStorage: Record<string, string> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
        localDraftIdsFromStorage.push(...Object.keys(parsed));
        Object.entries(parsed).forEach(([draftId, localDraft]) => {
          localDraftNamesFromStorage[draftId] = typeof localDraft?.name === 'string' ? localDraft.name : '';
        });
      } catch {
        // ignore malformed local library
      }
    }
    setLocalDraftIds(localDraftIdsFromStorage);
    setLocalDraftNames(localDraftNamesFromStorage);
    setSelectedLocalDraftId((prev) => (prev && localDraftIdsFromStorage.includes(prev) ? prev : ''));
    setSelectedDeleteLocalDraftId((prev) => (prev && localDraftIdsFromStorage.includes(prev) ? prev : ''));
  }, [draft.id]);

  useEffect(() => {
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setSelectedHitKey(null);
      return;
    }

    const hitKeys = Object.keys(draft.skills[selectedSkillKey].hitMeta);
    if (!selectedHitKey || !draft.skills[selectedSkillKey].hitMeta[selectedHitKey]) {
      setSelectedHitKey(hitKeys[0] ?? null);
    }
  }, [draft, selectedSkillKey, selectedHitKey]);

  useEffect(() => {
    const effects = draft.buffs[activeBuffGroupKey]?.effects ?? {};
    const effectKeys = Object.keys(effects);
    if (!selectedBuffEffectKey || !effects[selectedBuffEffectKey]) {
      setSelectedBuffEffectKey(effectKeys[0] ?? null);
    }
  }, [activeBuffGroupKey, draft.buffs, selectedBuffEffectKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveDraft({
          allowOverwriteOnConflict: !isOverwriteProtectionEnabled,
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draft, skillOrder, isOverwriteProtectionEnabled]);

  const selectedSkill = selectedSkillKey ? draft.skills[selectedSkillKey] : null;
  const selectedHit = selectedSkill && selectedHitKey ? selectedSkill.hitMeta[selectedHitKey] : null;
  const activeBuffGroup = draft.buffs[activeBuffGroupKey];
  const buffEffectEntries = Object.entries(activeBuffGroup.effects);
  const selectedBuffEffect = selectedBuffEffectKey ? activeBuffGroup.effects[selectedBuffEffectKey] ?? null : null;
  const latestMessage = messages[0] ?? '';
  const filteredOperatorBuffTypeOptions = useMemo(() => {
    const keyword = operatorBuffTypeQuery.trim().toLowerCase();
    if (!keyword) {
      return OPERATOR_BUFF_TYPE_OPTIONS;
    }
    return OPERATOR_BUFF_TYPE_OPTIONS.filter((option) => buildOperatorBuffTypeSearchText(option).toLowerCase().includes(keyword));
  }, [operatorBuffTypeQuery]);
  const displayedOperatorBuffTypeOptions = useMemo(() => {
    const selectedType = selectedBuffEffect?.type?.trim();
    if (!selectedType || filteredOperatorBuffTypeOptions.includes(selectedType as typeof OPERATOR_BUFF_TYPE_OPTIONS[number])) {
      return filteredOperatorBuffTypeOptions;
    }
    return [selectedType, ...filteredOperatorBuffTypeOptions];
  }, [filteredOperatorBuffTypeOptions, selectedBuffEffect?.type]);

  const getLocalDraftLabel = (draftId: string) => {
    const draftName = localDraftNames[draftId]?.trim();
    return draftName && draftName !== draftId ? `${draftId} · ${draftName}` : draftId;
  };

  const assetPathOptions = useMemo(
    () => Array.from(new Set([...userAssetPathOptions, ...ASSET_PATH_OPTIONS])),
    [userAssetPathOptions],
  );
  const avatarAssetOptions = useMemo(
    () => Array.from(new Set([...userAssetPathOptions, ...AVATAR_ASSET_OPTIONS])),
    [userAssetPathOptions],
  );

  const orderedDraft = useMemo(() => buildOrderedDraft(draft, skillOrder), [draft, skillOrder]);
  const draftJson = useMemo(() => JSON.stringify(orderedDraft, null, 2), [orderedDraft]);
  const operatorMarkdown = useMemo(() => {
    const skillLines = Object.entries(orderedDraft.skills).map(([skillKey, skill]) => {
      const hitSummary = Object.entries(skill.hitMeta)
        .map(([hitKey, hit]) => `${hitKey}:${hit.displayName || '-'} / ${hit.element} / ${hit.skillType} / M3 ${hit.levels?.M3 ?? 0}`)
        .join('；');
      return `- **${skill.displayName || skillKey}**（\`${skill.buttonType}\`，${skill.hitCount} hit）：${hitSummary || '无 hit'}`;
    });

    return [
      '# 干员信息',
      `**名称**：${draft.name}`,
      `**ID**：\`${draft.id}\``,
      `**等级**：${draft.level} / **稀有度**：${draft.rarity}`,
      `**职业**：${draft.profession || '-'} / **武器**：${draft.weapon || '-'}`,
      `**元素**：${draft.element || '-'} / **主属性**：${draft.mainStat || '-'} / **副属性**：${draft.subStat || '-'}`,
      '## 基础属性',
      ...ATTRIBUTE_ROWS.map(([attributeKey, label]) => `- ${label}：1/${draft.attributes[attributeKey].level1} 20/${draft.attributes[attributeKey].level20} 40/${draft.attributes[attributeKey].level40} 60/${draft.attributes[attributeKey].level60} 80/${draft.attributes[attributeKey].level80} 90/${draft.attributes[attributeKey].level90}`),
      '## 技能概览',
      ...(skillLines.length ? skillLines : ['- 暂无技能']),
      '## 干员 Buff',
      ...OPERATOR_BUFF_GROUPS.map(({ key, label }) => `- ${label}：${Object.keys(draft.buffs[key].effects).length} 个`),
    ].join('\n');
  }, [draft, orderedDraft]);

  const updateOperatorField = <K extends keyof OperatorDraft>(field: K, value: OperatorDraft[K]) => {
    setDraft((prev) => {
      if (field === 'name') {
        const nextName = String(value);
        return {
          ...prev,
          name: nextName,
          id: buildOperatorIdFromName(nextName) || prev.id,
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const updateAttributeField = (field: AttributeKey, levelKey: AttributeLevelKey, value: number) => {
    setDraft((prev) => ({
      ...prev,
      attributes: {
        ...prev.attributes,
        [field]: {
          ...prev.attributes[field],
          [levelKey]: value,
        },
      },
    }));
  };

  const updateSelectedSkill = (updater: (skill: SkillDraft) => SkillDraft) => {
    if (!selectedSkillKey) return;
    setDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [selectedSkillKey]: updater(prev.skills[selectedSkillKey]),
      },
    }));
  };

  const updateSelectedHit = (updater: (hit: HitMetaDraft) => HitMetaDraft) => {
    if (!selectedSkillKey || !selectedHitKey) return;
    setDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [selectedSkillKey]: {
          ...prev.skills[selectedSkillKey],
          hitMeta: {
            ...prev.skills[selectedSkillKey].hitMeta,
            [selectedHitKey]: updater(prev.skills[selectedSkillKey].hitMeta[selectedHitKey]),
          },
        },
      },
    }));
  };

  const updateSelectedBuffEffect = (updater: (effect: OperatorBuffEffect) => OperatorBuffEffect) => {
    if (!selectedBuffEffectKey) return;
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: {
          effects: {
            ...prev.buffs[activeBuffGroupKey].effects,
            [selectedBuffEffectKey]: updater(prev.buffs[activeBuffGroupKey].effects[selectedBuffEffectKey]),
          },
        },
      },
    }));
  };

  const loadDraftIntoEditor = (nextDraft: OperatorDraft, message: string) => {
    const normalizedDraft = normalizeDraft(cloneDraft(nextDraft));
    const nextSkillOrder = Object.keys(normalizedDraft.skills);
    const firstSkillKey = nextSkillOrder[0] ?? null;
    const firstHitKey = firstSkillKey ? Object.keys(normalizedDraft.skills[firstSkillKey].hitMeta)[0] ?? null : null;
    setDraft(buildOrderedDraft(normalizedDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(firstSkillKey);
    setSelectedHitKey(firstHitKey);
    setMessages((prev) => [message, ...prev].slice(0, 12));
  };

  const duplicateSelectedSkill = () => {
    if (!selectedSkillKey || !selectedSkill) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 skill', ...prev].slice(0, 12));
      return;
    }

    const nextSkillKey = getNextSkillKeyByType(draft, selectedSkill.buttonType);
    const duplicatedSkill = cloneDraft(selectedSkill);
    const firstHitKey = Object.keys(duplicatedSkill.hitMeta)[0] ?? null;
    const nextDraft = {
      ...draft,
      skills: {
        ...draft.skills,
        [nextSkillKey]: duplicatedSkill,
      },
    };
    const nextSkillOrder = [...syncSkillOrderWithDraft(skillOrder, draft), nextSkillKey];
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSkillKey);
    setSelectedHitKey(firstHitKey);
    setMessages((prev) => [`[OK] 已复制 skill：${selectedSkillKey} -> ${nextSkillKey}`, ...prev].slice(0, 12));
  };

  const importReferenceOperator = async () => {
    if (!selectedReferenceName) {
      setMessages((prev) => ['[ERR] 未选择参考干员', ...prev].slice(0, 12));
      return;
    }

    try {
      const nextDraft = await loadReferenceOperatorDraft(selectedReferenceName, {
        assetPathOptions: ASSET_PATH_OPTIONS,
        avatarAssetOptions: AVATAR_ASSET_OPTIONS,
      });
      loadDraftIntoEditor(nextDraft, `[OK] 已导入参考干员：${selectedReferenceName}`);
      setLoadedLocalDraftId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '参考干员导入失败';
      setMessages((prev) => [`[ERR] ${message}`, ...prev].slice(0, 12));
    }
  };

  const persistDraftToLibrary = (allowOverwrite: boolean) => {
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    const library = raw ? (JSON.parse(raw) as Record<string, OperatorDraft>) : {};
    if (!orderedDraft.id.trim()) {
      setMessages((prev) => ['[ERR] 干员 ID 不能为空', ...prev].slice(0, 12));
      return false;
    }
    if (library[orderedDraft.id] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(orderedDraft));
    library[orderedDraft.id] = orderedDraft;
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
    setLocalDraftIds((prev) => (prev.includes(orderedDraft.id) ? prev : [...prev, orderedDraft.id]));
    setLocalDraftNames((prev) => ({ ...prev, [orderedDraft.id]: orderedDraft.name }));
    setSelectedLocalDraftId('');
    setLoadedLocalDraftId(null);
    setMessages((prev) => [`[OK] 已保存到本地：${orderedDraft.id}`, ...prev].slice(0, 12));
    return true;
  };

  const handleSaveDraft = (options?: { allowOverwriteOnConflict?: boolean }) => {
    persistDraftToLibrary(Boolean(options?.allowOverwriteOnConflict));
  };

  const handleConfirmOverwriteDraft = () => {
    const saved = persistDraftToLibrary(true);
    if (saved) {
      setMessages((prev) => [`[OK] 已覆盖本地干员：${orderedDraft.id}`, ...prev].slice(0, 12));
    }
    setIsOverwriteDraftModalOpen(false);
  };

  const handleCreateNewDraft = () => {
    const nextId = getNextDraftId(localDraftIds);
    loadDraftIntoEditor(createEmptyDraft(nextId), `[OK] 已新建空草稿：${nextId}`);
    setSelectedLocalDraftId('');
    setLoadedLocalDraftId(null);
  };

  const handleSaveAsDraft = () => {
    const nextId = getNextDraftId(localDraftIds);
    const nextDraft = {
      ...orderedDraft,
      id: nextId,
    };
    loadDraftIntoEditor(nextDraft, `[OK] 已另存为新草稿：${nextId}`);
    setSelectedLocalDraftId('');
    setLoadedLocalDraftId(null);
  };

  const handleReorderDraft = () => {
    const { draft: nextDraft, skillKeyMap } = reorderDraftStructure(orderedDraft);
    const nextSkillOrder = Object.keys(nextDraft.skills);
    const nextSelectedSkillKey = selectedSkillKey
      ? skillKeyMap[selectedSkillKey] ?? nextSkillOrder[0] ?? null
      : nextSkillOrder[0] ?? null;
    const nextSelectedHitKey = nextSelectedSkillKey
      ? (selectedHitKey && nextDraft.skills[nextSelectedSkillKey].hitMeta[selectedHitKey]
        ? selectedHitKey
        : Object.keys(nextDraft.skills[nextSelectedSkillKey].hitMeta)[0] ?? null)
      : null;
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSelectedSkillKey);
    setSelectedHitKey(nextSelectedHitKey);
    setMessages((prev) => ['[OK] 已整理技能命名与 hit 编号', ...prev].slice(0, 12));
  };

  const readLocalDraftLibrary = () => {
    if (typeof window === 'undefined') {
      return {} as Record<string, OperatorDraft>;
    }

    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, OperatorDraft>;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([draftId, value]) => {
          try {
            const normalizedDraft = parseImportedDraft(JSON.stringify(value));
            return [[draftId, normalizedDraft] as const];
          } catch {
            return [];
          }
        })
      );
    } catch {
      return {} as Record<string, OperatorDraft>;
    }
  };

  const downloadShareFile = (shareFile: DraftLibraryShareFile<OperatorDraft>) => {
    const blob = new Blob([JSON.stringify(shareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(shareFile.label, shareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleOpenExportJsonModal = () => {
    setIsExportJsonModalOpen(true);
  };

  const handleCopyExportJson = async () => {
    await copyText(JSON.stringify(orderedDraft, null, 2));
    setMessages((prev) => ['[OK] 已复制导出 JSON', ...prev].slice(0, 12));
  };

  const handleOpenShareModal = () => {
    setShareDraftName('');
    setPendingImportShare(null);
    setIsShareModalOpen(true);
  };

  const handleCloseShareModal = () => {
    setIsShareModalOpen(false);
    setPendingImportShare(null);
    setShareDraftName('');
    if (shareImportInputRef.current) {
      shareImportInputRef.current.value = '';
    }
  };

  const handleExportLocalLibraryShare = () => {
    const library = readLocalDraftLibrary();
    const draftCount = Object.keys(library).length;
    if (draftCount === 0) {
      setMessages((prev) => ['[ERR] 本地没有可分享的干员库数据', ...prev].slice(0, 12));
      return;
    }

    const shareFile = buildDraftLibraryShareFile(OPERATOR_LIBRARY_SHARE_TYPE, library, shareDraftName);
    downloadShareFile(shareFile);
    setMessages((prev) => [`[OK] 已导出干员分享：${shareFile.label}（${draftCount} 个）`, ...prev].slice(0, 12));
  };

  const handleOpenShareImportPicker = () => {
    shareImportInputRef.current?.click();
  };

  const handleShareFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const rawText = await file.text();
    const parsedShare = parseDraftLibraryShareFile(rawText, OPERATOR_LIBRARY_SHARE_TYPE);
    if (!parsedShare) {
      setMessages((prev) => ['[ERR] 导入失败：文件不是有效的干员分享 JSON', ...prev].slice(0, 12));
      event.target.value = '';
      return;
    }

    const normalizedPayload = Object.fromEntries(
      Object.entries(parsedShare.payload).flatMap(([draftId, value]) => {
        try {
          const normalizedDraft = parseImportedDraft(JSON.stringify(value));
          return [[draftId, normalizedDraft] as const];
        } catch {
          return [];
        }
      })
    ) as Record<string, OperatorDraft>;

    if (Object.keys(normalizedPayload).length === 0) {
      setMessages((prev) => ['[ERR] 导入失败：分享文件内没有有效的干员草稿', ...prev].slice(0, 12));
      event.target.value = '';
      return;
    }

    setPendingImportShare({
      ...parsedShare,
      payload: normalizedPayload,
    });
    event.target.value = '';
  };

  const handleCancelImportShare = () => {
    setPendingImportShare(null);
  };

  const handleConfirmImportShare = () => {
    if (typeof window === 'undefined' || !pendingImportShare) {
      return;
    }

    const currentLibrary = readLocalDraftLibrary();
    const nextLibrary = {
      ...currentLibrary,
      ...pendingImportShare.payload,
    };
    const nextIds = Object.keys(nextLibrary);
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    setLocalDraftIds(nextIds);
    setLocalDraftNames(Object.fromEntries(nextIds.map((draftId) => [draftId, nextLibrary[draftId]?.name || ''])));
    setSelectedLocalDraftId('');
    setSelectedDeleteLocalDraftId((prev) => (prev && nextLibrary[prev] ? prev : ''));
    setIsShareModalOpen(false);
    setShareDraftName('');
    setPendingImportShare(null);
    setMessages((prev) => [
      `[OK] 已导入干员分享：${pendingImportShare.label}（${Object.keys(pendingImportShare.payload).length} 个）`,
      ...prev,
    ].slice(0, 12));
  };

  const handleImportLocalDraft = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      setMessages((prev) => ['[ERR] 本地没有可导入数据', ...prev].slice(0, 12));
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
      const localDraft = parsed[selectedLocalDraftId];
      if (!selectedLocalDraftId || !localDraft) {
      setMessages((prev) => ['[ERR] 未找到所选本地干员', ...prev].slice(0, 12));
        return;
      }
      loadDraftIntoEditor(localDraft, `[OK] 已从本地导入：${localDraft.id}`);
      setLoadedLocalDraftId(localDraft.id);
      setSelectedLocalDraftId('');
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法导入', ...prev].slice(0, 12));
    }
  };

  const handleOpenLocalLibraryManager = () => {
    setSelectedDeleteLocalDraftId((prev) => (prev && localDraftIds.includes(prev) ? prev : (localDraftIds[0] ?? '')));
    setIsDeleteLocalDraftModalOpen(true);
  };

  const handleDeleteLocalDraft = () => {
    if (typeof window === 'undefined' || !selectedDeleteLocalDraftId) {
      setMessages((prev) => ['[ERR] 请选择要删除的本地干员', ...prev].slice(0, 12));
      return;
    }

    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) {
      setMessages((prev) => ['[ERR] 本地没有可删除数据', ...prev].slice(0, 12));
      setIsDeleteLocalDraftModalOpen(false);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, OperatorDraft>;
      const deleteId = selectedDeleteLocalDraftId;
      if (!parsed[deleteId]) {
      setMessages((prev) => ['[ERR] 未找到所选本地干员', ...prev].slice(0, 12));
        setIsDeleteLocalDraftModalOpen(false);
        return;
      }
      delete parsed[deleteId];
      window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(parsed));
      const nextIds = Object.keys(parsed);
      setLocalDraftIds(nextIds);
      setLocalDraftNames(Object.fromEntries(nextIds.map((draftId) => [draftId, parsed[draftId]?.name || ''])));
      setSelectedLocalDraftId((prev) => (prev === deleteId ? '' : prev));
      setSelectedDeleteLocalDraftId(nextIds[0] ?? '');
      if (loadedLocalDraftId === deleteId) {
        setLoadedLocalDraftId(null);
      }
      setMessages((prev) => [`[OK] 已删除本地干员：${deleteId}`, ...prev].slice(0, 12));
    } catch {
      setMessages((prev) => ['[ERR] 本地数据损坏，无法删除', ...prev].slice(0, 12));
    } finally {
      setIsDeleteLocalDraftModalOpen(false);
    }
  };

  const handleAddSkill = () => {
    const nextSkillKey = getNextSkillKeyByType(draft, 'A');
    const nextDraft = {
      ...draft,
      skills: {
        ...draft.skills,
        [nextSkillKey]: createDefaultSkill('A', nextSkillKey),
      },
    };
    const nextSkillOrder = [...syncSkillOrderWithDraft(skillOrder, draft), nextSkillKey];
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSkillKey);
    setSelectedHitKey('hit1');
    setMessages((prev) => [`[OK] 已新增 skill: ${nextSkillKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveSkill = () => {
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的 skill', ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneDraft(draft);
    delete nextDraft.skills[selectedSkillKey];
    const nextSkillOrder = skillOrder.filter((skillKey) => skillKey !== selectedSkillKey);
    const nextSelectedSkillKey = nextSkillOrder[0] ?? null;
    const nextSelectedHitKey = nextSelectedSkillKey ? Object.keys(nextDraft.skills[nextSelectedSkillKey].hitMeta)[0] ?? null : null;
    setDraft(buildOrderedDraft(nextDraft, nextSkillOrder));
    setSkillOrder(nextSkillOrder);
    setSelectedSkillKey(nextSelectedSkillKey);
    setSelectedHitKey(nextSelectedHitKey);
    setMessages((prev) => [`[OK] 已删除 skill: ${selectedSkillKey}`, ...prev].slice(0, 12));
  };

  const handleAddHit = () => {
    if (!selectedSkillKey || !draft.skills[selectedSkillKey]) {
      setMessages((prev) => ['[ERR] 当前没有可新增 hit 的 skill', ...prev].slice(0, 12));
      return;
    }
    const skill = draft.skills[selectedSkillKey];
    const nextHitKey = getNextHitKey(skill);
    const nextDraft = cloneDraft(draft);
    nextDraft.skills[selectedSkillKey].hitMeta[nextHitKey] = createDefaultHit(nextHitKey);
    syncHitCount(nextDraft.skills[selectedSkillKey]);
    setDraft(nextDraft);
    setSelectedHitKey(nextHitKey);
    setMessages((prev) => [`[OK] 已新增 ${selectedSkillKey}.${nextHitKey}`, ...prev].slice(0, 12));
  };

  const handleDuplicateHit = () => {
    if (!selectedSkillKey || !selectedHitKey || !draft.skills[selectedSkillKey]?.hitMeta[selectedHitKey]) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 hit', ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneDraft(draft);
    const nextSkill = nextDraft.skills[selectedSkillKey];
    const nextHitKey = getNextHitKey(nextSkill);
    const duplicatedHit = cloneDraft(nextSkill.hitMeta[selectedHitKey]);
    nextSkill.hitMeta[nextHitKey] = {
      ...duplicatedHit,
      displayName: `${duplicatedHit.displayName || selectedHitKey} 副本`,
    };
    syncHitCount(nextSkill);
    setDraft(nextDraft);
    setSelectedHitKey(nextHitKey);
    setMessages((prev) => [`[OK] 已复制 ${selectedSkillKey}.${selectedHitKey} -> ${nextHitKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveHit = () => {
    if (!selectedSkillKey || !selectedHitKey || !draft.skills[selectedSkillKey]?.hitMeta[selectedHitKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的 hit', ...prev].slice(0, 12));
      return;
    }
    const nextDraft = cloneDraft(draft);
    const nextSkill = nextDraft.skills[selectedSkillKey];
    delete nextSkill.hitMeta[selectedHitKey];
    if (Object.keys(nextSkill.hitMeta).length === 0) {
      nextSkill.hitMeta.hit1 = createDefaultHit('hit1');
    }
    syncHitCount(nextSkill);
    const nextSelectedHitKey = Object.keys(nextSkill.hitMeta)[0] ?? null;
    setDraft(nextDraft);
    setSelectedHitKey(nextSelectedHitKey);
    setMessages((prev) => [`[OK] 已删除 ${selectedSkillKey}.${selectedHitKey}`, ...prev].slice(0, 12));
  };

  const handleAddBuffEffect = () => {
    const nextEffectKey = getNextBuffEffectKey(activeBuffGroup.effects);
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: {
          effects: {
            ...prev.buffs[activeBuffGroupKey].effects,
            [nextEffectKey]: createDefaultBuffEffect(nextEffectKey),
          },
        },
      },
    }));
    setSelectedBuffEffectKey(nextEffectKey);
    setMessages((prev) => [`[OK] 已新增 ${activeBuffGroupKey}.${nextEffectKey}`, ...prev].slice(0, 12));
  };

  const handleDuplicateBuffEffect = () => {
    if (!selectedBuffEffectKey || !selectedBuffEffect) {
      setMessages((prev) => ['[ERR] 当前没有可复制的 Buff effect', ...prev].slice(0, 12));
      return;
    }
    const nextEffectKey = getNextBuffEffectKey(activeBuffGroup.effects);
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: {
          effects: {
            ...prev.buffs[activeBuffGroupKey].effects,
            [nextEffectKey]: {
              ...cloneDraft(selectedBuffEffect),
              effectId: nextEffectKey,
              name: `${selectedBuffEffect.name || selectedBuffEffectKey} 副本`,
            },
          },
        },
      },
    }));
    setSelectedBuffEffectKey(nextEffectKey);
    setMessages((prev) => [`[OK] 已复制 Buff effect：${selectedBuffEffectKey} -> ${nextEffectKey}`, ...prev].slice(0, 12));
  };

  const handleRemoveBuffEffect = () => {
    if (!selectedBuffEffectKey || !activeBuffGroup.effects[selectedBuffEffectKey]) {
      setMessages((prev) => ['[ERR] 当前没有可删除的 Buff effect', ...prev].slice(0, 12));
      return;
    }
    const nextEffects = { ...activeBuffGroup.effects };
    delete nextEffects[selectedBuffEffectKey];
    const nextSelectedEffectKey = Object.keys(nextEffects)[0] ?? null;
    setDraft((prev) => ({
      ...prev,
      buffs: {
        ...prev.buffs,
        [activeBuffGroupKey]: { effects: nextEffects },
      },
    }));
    setSelectedBuffEffectKey(nextSelectedEffectKey);
    setMessages((prev) => [`[OK] 已删除 ${activeBuffGroupKey}.${selectedBuffEffectKey}`, ...prev].slice(0, 12));
  };

  const handleNavigate = (path: string) => {
    navigateToAppPath(path);
  };

  const handleSkillDragStart = (skillKey: string) => {
    if (activeSkillTypeFilter !== 'all') {
      return;
    }
    setDraggingSkillKey(skillKey);
    setDragOverSkillKey(skillKey);
  };

  const handleSkillDrop = (targetSkillKey: string) => {
    if (activeSkillTypeFilter !== 'all') {
      setDraggingSkillKey(null);
      setDragOverSkillKey(null);
      return;
    }
    if (!draggingSkillKey || draggingSkillKey === targetSkillKey) {
      setDraggingSkillKey(null);
      setDragOverSkillKey(null);
      return;
    }

    const nextSkillOrder = moveSkillKey(skillOrder, draggingSkillKey, targetSkillKey);
    setSkillOrder(nextSkillOrder);
    setDraft((prev) => buildOrderedDraft(prev, nextSkillOrder));
    setDraggingSkillKey(null);
    setDragOverSkillKey(null);
  };

  const skillEntries = skillOrder
    .filter((skillKey) => draft.skills[skillKey])
    .map((skillKey) => [skillKey, draft.skills[skillKey]] as const);
  const skillFilterCounts = skillEntries.reduce<Record<SkillTypeFilter, number>>((counts, [, skill]) => {
    counts.all += 1;
    counts[getSkillFilterKey(skill)] += 1;
    return counts;
  }, {
    all: 0,
    A: 0,
    B: 0,
    E: 0,
    Q: 0,
    other: 0,
  });
  const displayedSkillEntries = activeSkillTypeFilter === 'all'
    ? skillEntries
    : skillEntries.filter(([, skill]) => getSkillFilterKey(skill) === activeSkillTypeFilter);
  const isSkillDragEnabled = activeSkillTypeFilter === 'all';

  return (
    <main className="operator-draft-page">
      <section className="operator-draft-shell">
        <section className="operator-draft-preview-panel">
          <div className="operator-draft-workbench">
            <div className="operator-draft-column operator-draft-column-cli">
              <section className="operator-draft-command-panel">
                <div className="operator-draft-panel-header">
                  <p className="operator-draft-eyebrow">Draft</p>
                  <h1>干员模板编辑器</h1>
                  <p className="operator-draft-subtitle">参考导入、工作台编辑，底部导出 JSON。</p>
                </div>

                <div className="operator-draft-command-box">
                  <div className="operator-draft-command-actions">
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenExportJsonModal}>
                      导出 JSON
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareModal}>
                      分享库
                    </button>
                  </div>
                  <div className="operator-draft-reference-box">
                    <label>
                      <span>参考数据导入</span>
                      <select value={selectedReferenceName} onChange={(event) => setSelectedReferenceName(event.target.value)}>
                        <option value="">选择已有干员</option>
                        {referenceNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="operator-draft-ghost-button" onClick={importReferenceOperator}>
                      导入参考数据
                    </button>
                  </div>
                  <div className="operator-draft-reference-box">
                    <label>
                      <span>载入本地草稿</span>
                      <select value={selectedLocalDraftId} onChange={(event) => setSelectedLocalDraftId(event.target.value)}>
                        <option value="">选择要载入的草稿</option>
                        {localDraftIds.map((draftId) => (
                          <option key={draftId} value={draftId}>
                            {getLocalDraftLabel(draftId)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="operator-draft-command-actions">
                      <button type="button" className="operator-draft-ghost-button" onClick={handleImportLocalDraft}>
                        载入为当前草稿
                      </button>
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={handleOpenLocalLibraryManager}
                        disabled={localDraftIds.length === 0}
                      >
                        管理本地库
                      </button>
                    </div>
                  </div>
                  <div className="operator-draft-reference-box">
                    <label>
                      <span>分享导入</span>
                      <input value="点击打开导入弹窗" readOnly />
                    </label>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareModal}>
                      打开分享弹窗
                    </button>
                  </div>
                  {latestMessage ? <div className="operator-draft-latest-message">{latestMessage}</div> : null}
                </div>
              </section>

              <section className="operator-draft-nav-panel">
                <div className="operator-draft-section-header">
                  <h3>页面跳转</h3>
                </div>
                <div className="operator-draft-nav-grid">
                  {OPERATOR_DRAFT_NAV_LINKS.map((link) => (
                    <button
                      key={link.path}
                      type="button"
                      className="operator-draft-ghost-button"
                      onClick={() => handleNavigate(link.path)}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="operator-draft-markdown-panel">
                <div className="operator-draft-section-header">
                  <h3>干员信息</h3>
                  <span>Markdown 预览</span>
                </div>
                <div className="operator-draft-markdown-body">{renderMiniMarkdown(operatorMarkdown)}</div>
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-left">
              <section className="operator-draft-basic-panel">
                <div className="operator-draft-section-header">
                  <h3>基础数据</h3>
                    <div className="operator-draft-section-actions">
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
                      >
                        {isOverwriteProtectionEnabled ? '保护开' : '保护关'}
                      </button>
                      <button type="button" className="operator-draft-ghost-button" onClick={handleReorderDraft}>
                        整理命名
                      </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleCreateNewDraft}>
                      新建
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleSaveAsDraft}>
                      另存为
                    </button>
                      <button
                        type="button"
                        className="operator-draft-ghost-button"
                        onClick={() => handleSaveDraft({ allowOverwriteOnConflict: !isOverwriteProtectionEnabled })}
                      >
                        保存到本地
                      </button>
                  </div>
                </div>
                <div className="operator-draft-basic-grid">
                  <div className="operator-draft-avatar-wrap operator-draft-avatar-wrap-dense">
                    {draft.avatarUrl ? (
                      <img className="operator-draft-avatar" src={normalizeAssetUrl(draft.avatarUrl)} alt={draft.name} />
                    ) : (
                      <div className="operator-draft-avatar operator-draft-avatar-fallback">{draft.name.slice(0, 1)}</div>
                    )}
                  </div>
                  <label>
                    <span>名称</span>
                    <input value={draft.name} onChange={(event) => updateOperatorField('name', event.target.value)} />
                  </label>
                  <label>
                    <span>ID</span>
                    <input value={draft.id} onChange={(event) => updateOperatorField('id', event.target.value)} />
                  </label>
                    <label>
                      <span>头像 URL</span>
                      <SearchablePathSelect
                        value={draft.avatarUrl}
                        options={avatarAssetOptions}
                        placeholder="搜索头像 URL"
                        onChange={(nextValue) => updateOperatorField('avatarUrl', nextValue)}
                      />
                    </label>
                  <label>
                    <span>职业</span>
                    <select value={draft.profession} onChange={(event) => updateOperatorField('profession', event.target.value)}>
                      <option value="">未设置</option>
                      {PROFESSION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>武器</span>
                    <select value={draft.weapon} onChange={(event) => updateOperatorField('weapon', event.target.value)}>
                      <option value="">未设置</option>
                      {WEAPON_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>元素</span>
                    <select value={draft.element} onChange={(event) => updateOperatorField('element', event.target.value)}>
                      {ELEMENT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>主属性</span>
                    <select value={draft.mainStat} onChange={(event) => updateOperatorField('mainStat', event.target.value)}>
                      <option value="">未设置</option>
                      {ABILITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>副属性</span>
                    <select value={draft.subStat} onChange={(event) => updateOperatorField('subStat', event.target.value)}>
                      <option value="">未设置</option>
                      {ABILITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>等级</span>
                    <DeferredNumberInput
                      value={draft.level}
                      parse={parseIntegerInput}
                      onCommit={(value) => updateOperatorField('level', value ?? 0)}
                    />
                  </label>
                  <label>
                    <span>稀有度</span>
                    <select value={draft.rarity} onChange={(event) => updateOperatorField('rarity', Number(event.target.value) || 0)}>
                      {RARITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="operator-draft-attribute-matrix">
                    <div className="operator-draft-attribute-cell operator-draft-attribute-cell-head">属性</div>
                    {ATTRIBUTE_LEVEL_KEYS.map((levelKey) => (
                      <div key={levelKey} className="operator-draft-attribute-cell operator-draft-attribute-cell-head">
                        {ATTRIBUTE_LEVEL_LABELS[levelKey]}
                      </div>
                    ))}
                    {ATTRIBUTE_ROWS.map(([attributeKey, label]) => (
                      <Fragment key={attributeKey}>
                        <div className="operator-draft-attribute-cell operator-draft-attribute-name">{label}</div>
                        {ATTRIBUTE_LEVEL_KEYS.map((levelKey) => (
                          <label key={`${attributeKey}-${levelKey}`} className="operator-draft-attribute-input">
                            <span>{`${label} ${ATTRIBUTE_LEVEL_LABELS[levelKey]}`}</span>
                            <DeferredNumberInput
                              value={draft.attributes[attributeKey]?.[levelKey] ?? 0}
                              onCommit={(value) => updateAttributeField(attributeKey, levelKey, value ?? 0)}
                            />
                          </label>
                        ))}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </section>

              <section className="operator-draft-skill-list">
                <div className="operator-draft-section-header">
                  <h3>技能列表</h3>
                  <div className="operator-draft-section-actions">
                    <span>{activeSkillTypeFilter === 'all' ? `${skillEntries.length} 个` : `${displayedSkillEntries.length}/${skillEntries.length} 个`}</span>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleAddSkill}>
                      新增技能
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={duplicateSelectedSkill}>
                      复制技能
                    </button>
                    <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveSkill}>
                      删除技能
                    </button>
                  </div>
                </div>
                <div className="operator-draft-skill-filters">
                  {SKILL_TYPE_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      className={`operator-draft-skill-filter${activeSkillTypeFilter === filter.key ? ' is-active' : ''}`}
                      onClick={() => setActiveSkillTypeFilter(filter.key)}
                    >
                      <span>{filter.label}</span>
                      <strong>{skillFilterCounts[filter.key]}</strong>
                    </button>
                  ))}
                </div>
                {activeSkillTypeFilter !== 'all' ? (
                  <p className="operator-draft-skill-filter-note">筛选状态下暂不支持拖拽排序。</p>
                ) : null}
                {displayedSkillEntries.length ? displayedSkillEntries.map(([skillKey, skill]) => (
                  <button
                    type="button"
                    key={skillKey}
                    draggable={isSkillDragEnabled}
                    className={`operator-draft-skill-item${selectedSkillKey === skillKey ? ' is-active' : ''}${draggingSkillKey === skillKey ? ' is-dragging' : ''}${dragOverSkillKey === skillKey && draggingSkillKey !== skillKey ? ' is-drag-over' : ''}`}
                    onClick={() => setSelectedSkillKey(skillKey)}
                    onDragStart={() => handleSkillDragStart(skillKey)}
                    onDragEnter={() => {
                      if (isSkillDragEnabled) {
                        setDragOverSkillKey(skillKey);
                      }
                    }}
                    onDragOver={(event) => {
                      if (isSkillDragEnabled) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleSkillDrop(skillKey);
                    }}
                    onDragEnd={() => {
                      setDraggingSkillKey(null);
                      setDragOverSkillKey(null);
                    }}
                  >
                    <div className="operator-draft-skill-icon-wrap">
                      {skill.iconUrl ? (
                        <img src={normalizeAssetUrl(skill.iconUrl)} alt={skill.displayName || skillKey} className="operator-draft-skill-icon" />
                      ) : (
                        <div className="operator-draft-skill-icon operator-draft-skill-icon-fallback">{skill.buttonType}</div>
                      )}
                    </div>
                    <div className="operator-draft-skill-meta">
                      <strong>{skill.displayName || skillKey}</strong>
                      <span>{`${skillKey} / ${skill.buttonType}`}</span>
                      <span>{`${skill.hitCount} hit`}</span>
                    </div>
                  </button>
                )) : (
                  <p className="operator-draft-empty">当前筛选下没有技能。</p>
                )}
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-main">
              <section className="operator-draft-skill-detail">
              <div className="operator-draft-section-header">
                <h3>技能预览</h3>
                <div className="operator-draft-section-actions">
                  <span>{selectedSkillKey ?? '-'}</span>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleAddHit}>
                    新增 Hit
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleDuplicateHit}>
                    复制 Hit
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveHit}>
                    删除 Hit
                  </button>
                </div>
              </div>
              {selectedSkill ? (
                <>
                  <div className="operator-draft-skill-hero">
                    {selectedSkill.iconUrl ? (
                      <img src={normalizeAssetUrl(selectedSkill.iconUrl)} alt={selectedSkill.displayName} className="operator-draft-skill-hero-icon" />
                    ) : (
                      <div className="operator-draft-skill-hero-icon operator-draft-skill-icon-fallback">{selectedSkill.buttonType}</div>
                    )}
                    <div className="operator-draft-skill-form">
                      <label>
                        <span>技能名</span>
                        <input
                          value={selectedSkill.displayName}
                          onChange={(event) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              displayName: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>按钮类型</span>
                        <select
                          value={selectedSkill.buttonType}
                          onChange={(event) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              buttonType: event.target.value as SkillButtonType,
                            }))
                          }
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="E">E</option>
                          <option value="Q">Q</option>
                        </select>
                      </label>
                      <label className="is-wide">
                        <span>技能图标</span>
                        <SearchablePathSelect
                          value={selectedSkill.iconUrl}
                          options={assetPathOptions}
                          placeholder="搜索技能图标 URL"
                          onChange={(nextValue) =>
                            updateSelectedSkill((skill) => ({
                              ...skill,
                              iconUrl: nextValue,
                            }))
                          }
                        />
                      </label>
                      <div className="operator-draft-inline-actions">
                        <span>{`hit 数：${selectedSkill.hitCount}`}</span>
                      </div>
                    </div>
                  </div>

                  <div className="operator-draft-hit-list">
                    {Object.entries(selectedSkill.hitMeta).map(([hitKey, hit]) => (
                      <button
                        type="button"
                        key={hitKey}
                        className={`operator-draft-hit-item${selectedHitKey === hitKey ? ' is-active' : ''}`}
                        onClick={() => setSelectedHitKey(hitKey)}
                      >
                        <span className="operator-draft-hit-badge">{hitKey}</span>
                        <strong>{hit.displayName || '未命名 hit'}</strong>
                        <span>{`M3: ${hit.levels?.M3 ?? 0}`}</span>
                        <span>{`${hit.element} / ${hit.skillType}`}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="operator-draft-empty">当前没有可预览的 skill。</p>
              )}
              </section>
              <section className="operator-draft-hit-detail">
                <div className="operator-draft-section-header">
                  <h3>Hit 细节</h3>
                  <span>{selectedHitKey ?? '-'}</span>
                </div>
                {selectedHit ? (
                  <div className="operator-draft-hit-detail-card">
                    <label>
                      <span>名称</span>
                      <input
                        value={selectedHit.displayName}
                        onChange={(event) =>
                          updateSelectedHit((hit) => ({
                            ...hit,
                            displayName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="operator-draft-hit-levels">
                      {SKILL_LEVEL_KEYS.map((levelKey) => (
                        <label key={levelKey}>
                          <span>{levelKey}</span>
                          <DeferredNumberInput
                            step="0.01"
                            value={selectedHit.levels?.[levelKey] ?? 0}
                            onCommit={(value) =>
                              updateSelectedHit((hit) => ({
                                ...hit,
                                levels: {
                                  ...hit.levels,
                                  [levelKey]: value ?? 0,
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      <span>伤害属性</span>
                      <select
                        value={selectedHit.element}
                        onChange={(event) =>
                          updateSelectedHit((hit) => ({
                            ...hit,
                            element: event.target.value as HitElement,
                          }))
                        }
                      >
                        <option value="physical">physical</option>
                        <option value="fire">fire</option>
                        <option value="ice">ice</option>
                        <option value="electric">electric</option>
                        <option value="nature">nature</option>
                      </select>
                    </label>
                    <label>
                      <span>技能乘区</span>
                      <select
                        value={selectedHit.skillType}
                        onChange={(event) =>
                          updateSelectedHit((hit) => ({
                            ...hit,
                            skillType: event.target.value as HitSkillType,
                          }))
                        }
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="E">E</option>
                        <option value="Q">Q</option>
                        <option value="Dot">Dot</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="operator-draft-empty">当前没有选中的 hit。</p>
                )}
              </section>
            </div>

            <div className="operator-draft-column operator-draft-column-right">
              <section className="operator-draft-buff-panel">
                <div className="operator-draft-section-header">
                  <h3>干员 Buff</h3>
                  <span>{buffEffectEntries.length} 个</span>
                </div>
                <div className="operator-draft-buff-tabs">
                  {OPERATOR_BUFF_GROUPS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`operator-draft-buff-tab${activeBuffGroupKey === key ? ' is-active' : ''}`}
                      onClick={() => setActiveBuffGroupKey(key)}
                    >
                      <span>{label}</span>
                      <strong>{Object.keys(draft.buffs[key].effects).length}</strong>
                    </button>
                  ))}
                </div>
                <div className="operator-draft-buff-actions">
                  <button type="button" className="operator-draft-ghost-button" onClick={handleAddBuffEffect}>
                    新增
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleDuplicateBuffEffect}>
                    复制
                  </button>
                  <button type="button" className="operator-draft-ghost-button" onClick={handleRemoveBuffEffect}>
                    删除
                  </button>
                </div>
                <div className="operator-draft-buff-body">
                  <div className="operator-draft-buff-list">
                    {buffEffectEntries.length ? (
                      buffEffectEntries.map(([effectKey, effect]) => (
                        <button
                          key={effectKey}
                          type="button"
                          className={`operator-draft-buff-item${selectedBuffEffectKey === effectKey ? ' is-active' : ''}`}
                          onClick={() => setSelectedBuffEffectKey(effectKey)}
                        >
                          <strong>{effect.name || effectKey}</strong>
                          <span>{effect.effectKind === 'extraHit' ? '额外伤害段' : effect.type ? getOperatorBuffTypeDisplayLabel(effect.type) : '未设置类型'}</span>
                          <span>
                            {effect.effectKind === 'extraHit'
                              ? `${((effect.extraHitConfig?.baseMultiplier ?? 1) * 100).toFixed(0)}% ${effect.extraHitConfig?.damageType ?? 'physical'} / ${effect.extraHitConfig?.skillType || '空'}`
                              : effect.category === 'condition' ? '条件' : effect.category === 'countable' ? `计层/${effect.maxStacks ?? 1}` : '常驻'}
                            {effect.valueMode === 'derived' && effect.derivedValue
                              ? ` · ${OPERATOR_BUFF_DERIVED_SOURCE_LABELS[effect.derivedValue.source]} 每点提升 ${formatOperatorBuffPerPointValue(effect.derivedValue.perPointValue)}`
                              : typeof effect.value === 'number'
                                ? ` · ${effect.value}${(effect.unit || inferOperatorBuffUnit(effect.type)) === 'percent' ? '%' : ''}`
                                : ''}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="operator-draft-empty">当前分组没有 Buff effect。</p>
                    )}
                  </div>
                  {selectedBuffEffect ? (
                    <div className="operator-draft-buff-form">
                      <label>
                        <span>名称</span>
                        <input
                          value={selectedBuffEffect.name}
                          onChange={(event) => updateSelectedBuffEffect((effect) => ({ ...effect, name: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Effect ID</span>
                        <input
                          value={selectedBuffEffect.effectId}
                          onChange={(event) => updateSelectedBuffEffect((effect) => ({ ...effect, effectId: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>效果形式</span>
                        <select
                          value={selectedBuffEffect.effectKind ?? 'modifier'}
                          onChange={(event) => {
                            const effectKind = event.target.value as BuffEffectKind;
                            updateSelectedBuffEffect((effect) => ({
                              ...effect,
                              effectKind,
                              ...(effectKind === 'extraHit'
                                ? {
                                  type: '',
                                  value: undefined,
                                  valueMode: 'fixed' as const,
                                  derivedValue: undefined,
                                  category: 'passive' as const,
                                  extraHitConfig: normalizeExtraHitConfig(effect.extraHitConfig, `${effect.effectId || selectedBuffEffectKey}-extra-hit`),
                                }
                                : { extraHitConfig: undefined }),
                            }));
                          }}
                        >
                          <option value="modifier">普通加成</option>
                          <option value="extraHit">额外伤害段</option>
                        </select>
                      </label>
                      <label className="operator-draft-buff-form-wide">
                        <span>类型</span>
                        <div className="operator-draft-buff-type-editor">
                          <input
                            className="operator-draft-buff-type-search"
                            value={operatorBuffTypeQuery}
                            onChange={(event) => setOperatorBuffTypeQuery(event.target.value)}
                            placeholder="搜索类型：攻击 / 主能力 / 法术 / 暴击"
                            disabled={selectedBuffEffect.effectKind === 'extraHit'}
                          />
                          <select
                            className="operator-draft-buff-type-select"
                            value={selectedBuffEffect.type}
                            disabled={selectedBuffEffect.effectKind === 'extraHit'}
                            onChange={(event) => {
                              const nextType = event.target.value;
                              updateSelectedBuffEffect((effect) => ({
                                ...effect,
                                type: nextType,
                                unit: nextType ? inferOperatorBuffUnit(nextType) : '',
                              }));
                            }}
                          >
                            <option value="">未设置类型</option>
                            {displayedOperatorBuffTypeOptions.map((option) => (
                              <option key={option} value={option}>{getOperatorBuffTypeDisplayLabel(option)}</option>
                            ))}
                          </select>
                        </div>
                      </label>
                      <label>
                        <span>分类</span>
                        <select
                          value={selectedBuffEffect.category}
                          disabled={selectedBuffEffect.effectKind === 'extraHit'}
                          onChange={(event) => {
                            const nextCategory = event.target.value as OperatorBuffCategory;
                            updateSelectedBuffEffect((effect) => ({
                              ...effect,
                              category: nextCategory,
                              ...(nextCategory === 'countable'
                                ? { valueMode: 'fixed' as const, derivedValue: undefined, maxStacks: effect.maxStacks ?? 1 }
                                : {}),
                            }));
                          }}
                        >
                          <option value="passive">passive</option>
                          <option value="condition">condition</option>
                          <option value="countable">countable</option>
                        </select>
                      </label>
                      <label>
                        <span>数值模式</span>
                        <select
                          value={selectedBuffEffect.valueMode ?? 'fixed'}
                          disabled={selectedBuffEffect.effectKind === 'extraHit'}
                          onChange={(event) => {
                            const nextMode = selectedBuffEffect.category === 'countable' ? 'fixed' : event.target.value as OperatorBuffValueMode;
                            updateSelectedBuffEffect((effect) => ({
                              ...effect,
                              valueMode: nextMode,
                              ...(nextMode === 'derived' && !effect.derivedValue
                                ? { derivedValue: { source: 'intelligence', perPointValue: 0.001 } }
                                : {}),
                            }));
                          }}
                        >
                          <option value="fixed">固定数值</option>
                          <option value="derived" disabled={selectedBuffEffect.category === 'countable'}>来源值派生</option>
                        </select>
                      </label>
                      {selectedBuffEffect.effectKind !== 'extraHit' && (selectedBuffEffect.valueMode ?? 'fixed') === 'fixed' ? (
                      <label>
                        <span>数值</span>
                        <DeferredNumberInput
                          step="0.01"
                          value={selectedBuffEffect.value}
                          onCommit={(value) => {
                            updateSelectedBuffEffect((effect) => {
                              const { value: _value, ...rest } = effect;
                              return value == null ? rest : { ...effect, value };
                            });
                          }}
                        />
                      </label>
                      ) : selectedBuffEffect.effectKind !== 'extraHit' ? (
                        <>
                          <label>
                            <span>来源值</span>
                            <select
                              value={selectedBuffEffect.derivedValue?.source ?? 'intelligence'}
                              onChange={(event) => updateSelectedBuffEffect((effect) => ({
                                ...effect,
                                valueMode: 'derived',
                                derivedValue: {
                                  source: event.target.value as OperatorBuffDerivedSource,
                                  perPointValue: effect.derivedValue?.perPointValue ?? 0.001,
                                },
                              }))}
                            >
                              {OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>每点提升</span>
                            <DeferredNumberInput
                              step="0.0001"
                              value={selectedBuffEffect.derivedValue?.perPointValue}
                              onCommit={(value) => {
                                updateSelectedBuffEffect((effect) => ({
                                  ...effect,
                                  valueMode: 'derived',
                                  derivedValue: {
                                    source: effect.derivedValue?.source ?? 'intelligence',
                                    perPointValue: value ?? 0,
                                  },
                                }));
                              }}
                            />
                          </label>
                        </>
                      ) : null}
                      {selectedBuffEffect.category === 'countable' && (
                        <label>
                          最大层数
                          <DeferredNumberInput
                            min={1}
                            value={selectedBuffEffect.maxStacks ?? 1}
                            parse={parseIntegerInput}
                            onCommit={(value) => updateSelectedBuffEffect((effect) => ({
                              ...effect,
                              maxStacks: Math.max(1, value ?? 1),
                              valueMode: 'fixed',
                              derivedValue: undefined,
                            }))}
                          />
                        </label>
                      )}
                      <label>
                        <span>单位</span>
                        <div className="operator-draft-buff-unit-lock">
                          {selectedBuffEffect.type ? ((selectedBuffEffect.unit || inferOperatorBuffUnit(selectedBuffEffect.type)) === 'percent' ? '%' : '固定值') : '-'}
                        </div>
                      </label>
                      {selectedBuffEffect.effectKind === 'extraHit' && (() => {
                        const config = normalizeExtraHitConfig(selectedBuffEffect.extraHitConfig, `${selectedBuffEffect.effectId || selectedBuffEffectKey}-extra-hit`);
                        const updateConfig = (patch: Partial<BuffExtraHitConfig>) => updateSelectedBuffEffect((effect) => ({
                          ...effect,
                          extraHitConfig: normalizeExtraHitConfig({ ...config, ...patch }, config.key),
                        }));
                        return (
                          <>
                            <label><span>伤害段 Key</span><input value={config.key} onChange={(event) => updateConfig({ key: event.target.value })} /></label>
                            <label><span>伤害属性</span><select value={config.damageType} onChange={(event) => updateConfig({ damageType: event.target.value as BuffExtraHitConfig['damageType'] })}>{EXTRA_HIT_DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                            <label><span>伤害类型</span><select value={config.skillType} onChange={(event) => updateConfig({ skillType: event.target.value as BuffExtraHitConfig['skillType'] })}><option value="">空</option>{['A', 'B', 'E', 'Q', 'Dot'].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                            <label><span>攻击力倍率</span><DeferredNumberInput min={0} step="0.01" value={config.baseMultiplier} onCommit={(value) => updateConfig({ baseMultiplier: Math.max(0, value ?? 0) })} /></label>
                          </>
                        );
                      })()}
                      <label className="operator-draft-buff-form-wide">
                        <span>描述</span>
                        <textarea
                          value={selectedBuffEffect.description ?? ''}
                          onChange={(event) => updateSelectedBuffEffect((effect) => ({ ...effect, description: event.target.value }))}
                        />
                      </label>
                      <label className="operator-draft-buff-form-wide">
                        <span>原文</span>
                        <textarea
                          value={selectedBuffEffect.raw ?? ''}
                          onChange={(event) => updateSelectedBuffEffect((effect) => ({ ...effect, raw: event.target.value }))}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </section>
      </section>
      {isExportJsonModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsExportJsonModalOpen(false)}>
          <div className="operator-draft-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>导出 JSON</h3>
              <span>预览后复制</span>
            </div>
            <pre className="operator-draft-json">{draftJson}</pre>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsExportJsonModalOpen(false)}>
                关闭
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleCopyExportJson}>
                复制
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isShareModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={handleCloseShareModal}>
          <div className="operator-draft-modal operator-draft-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>干员库分享</h3>
              <span>导出 / 导入本地库</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`当前本地干员库共有 ${localDraftIds.length} 个条目。`}</p>
              <p>导出会打包整个本地干员库；导入会把分享文件中的干员合并回本地库，并覆盖同 ID 条目。</p>
            </div>
            <label className="operator-draft-share-label">
              <span>分享文件名</span>
              <input
                value={shareDraftName}
                onChange={(event) => setShareDraftName(event.target.value)}
                placeholder="留空则默认使用未命名"
              />
            </label>
            <input
              ref={shareImportInputRef}
              type="file"
              accept=".json,application/json"
              className="operator-draft-file-input"
              onChange={handleShareFileSelected}
            />
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleOpenShareImportPicker}>
                导入分享
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleExportLocalLibraryShare}>
                一键导出 JSON
              </button>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleCloseShareModal}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isDeleteLocalDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsDeleteLocalDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>本地库管理</h3>
              <span>{localDraftIds.length} 个条目</span>
            </div>
            <div className="operator-draft-confirm-body">
              <div className="operator-draft-local-library-list" role="listbox" aria-label="本地草稿目录">
                {localDraftIds.length ? (
                  localDraftIds.map((draftId) => {
                    const draftName = localDraftNames[draftId]?.trim();
                    const isActive = selectedDeleteLocalDraftId === draftId;
                    return (
                      <button
                        key={draftId}
                        type="button"
                        className={`operator-draft-local-library-item${isActive ? ' is-active' : ''}`}
                        onClick={() => setSelectedDeleteLocalDraftId(draftId)}
                        role="option"
                        aria-selected={isActive}
                      >
                        <strong>{draftName || draftId}</strong>
                        <span>{draftId}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="operator-draft-searchable-empty">本地库为空</div>
                )}
              </div>
              <p>删除只影响本地库记录，不会自动清空当前编辑器里的草稿内容。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsDeleteLocalDraftModalOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="operator-draft-copy-button operator-draft-danger-button"
                onClick={handleDeleteLocalDraft}
                disabled={!selectedDeleteLocalDraftId}
              >
                删除所选草稿
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingImportShare ? (
        <div className="operator-draft-modal-overlay" onClick={handleCancelImportShare}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>确认导入干员分享</h3>
              <span>请确认</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`即将导入分享「${pendingImportShare.label}」。`}</p>
              <p>{`本次会写入 ${Object.keys(pendingImportShare.payload).length} 个干员条目，并覆盖本地同 ID 记录。`}</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={handleCancelImportShare}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmImportShare}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <h3>覆盖本地干员</h3>
              <span>请确认</span>
            </div>
            <div className="operator-draft-confirm-body">
              <p>{`本地库中已存在 ID 为「${orderedDraft.id}」的干员。`}</p>
              <p>保护开启时，确认后会用当前编辑器内容覆盖本地同 ID 干员。</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setIsOverwriteDraftModalOpen(false)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button operator-draft-danger-button" onClick={handleConfirmOverwriteDraft}>
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
