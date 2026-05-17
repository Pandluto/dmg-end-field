import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { pinyin } from 'pinyin-pro';
import './BuffDraftPage.css';
import './OperatorDraftPage.css';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  buildDraftLibraryShareFile,
  buildDraftLibraryShareFileName,
  parseDraftLibraryShareFile,
  type DraftLibraryShareFile,
} from '../utils/draftShare';

const WEAPON_SHEET_PAGE_PATH = APP_ROUTE_PATHS.weaponSheet;
const WEAPON_DRAFT_STORAGE_KEY = 'def.weapon-sheet.draft.v1';
const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
const WEAPON_LIBRARY_SHARE_TYPE = 'weapon-library-share.v1';

type WeaponSkillKey = 'skill1' | 'skill2' | 'skill3';
type WeaponEffectBucket = 'value' | 'passive' | 'effects';

interface RawWeaponLevelData {
  value?: number;
  description?: string;
  passive?: Record<string, number>;
  effects?: Record<string, number>;
}

interface RawWeaponSkillData {
  name?: string;
  statType?: string;
  effectTypes?: Record<string, string>;
  levels?: Record<string, RawWeaponLevelData>;
}

interface RawWeaponDraft {
  id?: string;
  name?: string;
  rarity?: number;
  type?: string;
  description?: string;
  attackGrowth?: Record<string, number>;
  skills?: Record<string, RawWeaponSkillData>;
}

interface WeaponLevelData {
  value?: number;
  description: string;
  passive: Record<string, number>;
  effects: Record<string, number>;
}

interface WeaponSkillData {
  name: string;
  statType: string;
  effectTypes: Record<string, string>;
  levels: Record<string, WeaponLevelData>;
}

interface WeaponDraft {
  id: string;
  name: string;
  rarity: number;
  type: string;
  description: string;
  attackGrowth: Record<string, number>;
  skills: Record<WeaponSkillKey, WeaponSkillData>;
}

type WeaponSheetRow =
  | {
      kind: 'weapon';
      key: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'growth';
      key: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'skill';
      key: string;
      skillKey: WeaponSkillKey;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'effect';
      key: string;
      skillKey: WeaponSkillKey;
      bucket: WeaponEffectBucket;
      sourceEffectKey: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    }
  | {
      kind: 'effectLevels';
      key: string;
      skillKey: WeaponSkillKey;
      bucket: WeaponEffectBucket;
      sourceEffectKey: string;
      title: string;
      idText: string;
      slot: string;
      level: string;
      effectKey: string;
      valueText: string;
      description: string;
      searchText: string;
    };

interface WeaponSheetColumn {
  key: 'name' | 'idText' | 'slot' | 'level' | 'effectKey' | 'valueText' | 'description';
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

interface WeaponWorkbookCell {
  key: string;
  address: string;
  value: string;
  columnKey: WeaponSheetColumn['key'];
  width: number;
  align: 'left' | 'center' | 'right';
  sourceRowKey: string;
}

interface WeaponWorkbookRow {
  key: string;
  rowNumber: number;
  kind: WeaponSheetRow['kind'];
  sourceRow: WeaponSheetRow;
  cells: WeaponWorkbookCell[];
}

interface WeaponWorkbookSelection {
  address: string;
  sourceRowKey: string;
  columnKey: WeaponSheetColumn['key'];
}

interface FormulaBinding {
  key: string;
  focusId: string;
  inputMode: 'text' | 'number';
  value: string;
  placeholder: string;
  control?: 'input' | 'select' | 'search-select';
  readOnly?: boolean;
  options?: Array<{ value: string; label: string }>;
  onValueChange?: (value: string) => void;
  apply: (draft: WeaponDraft, rawInput: string) => WeaponDraft;
}

type WeaponExplorerDragNode =
  | {
      kind: 'draft';
      draftId: string;
    }
  | {
      kind: 'skill';
      draftId: string;
      skillKey: WeaponSkillKey;
    }
  | {
      kind: 'effect';
      draftId: string;
      skillKey: WeaponSkillKey;
      bucket: WeaponEffectBucket;
      effectKey: string;
    };

type WeaponExplorerDragState = {
  source: WeaponExplorerDragNode;
  over: WeaponExplorerDragNode | null;
  x: number;
  y: number;
};

type WeaponSheetContextMenuState = {
  x: number;
  y: number;
  target: 'blank' | 'draft' | 'skill' | 'effect';
  draftId?: string;
  skillKey?: WeaponSkillKey;
  effectKey?: string;
  bucket?: WeaponEffectBucket;
};

type WeaponSheetContextMenuAction = {
  key: string;
  label: string;
  icon: 'new' | 'delete' | 'collapse' | 'expand' | 'open';
  onClick: () => void;
};

const SKILL_KEYS: WeaponSkillKey[] = ['skill1', 'skill2', 'skill3'];
const LEVEL_KEYS = Array.from({ length: 9 }, (_, index) => String(index + 1));
const ATTACK_GROWTH_MILESTONE_KEYS = ['1', '10', '20', '30', '40', '50', '60', '70', '80', '90'] as const;
const SKILL1_OPTIONS = ['敏捷提升', '力量提升', '意志提升', '智识提升', '主能力提升', '副能力提升'] as const;
const SKILL2_OPTIONS = ['攻击提升', '生命提升', '物理伤害提升', '灼热伤害提升', '电磁伤害提升', '寒冷伤害提升', '自然伤害提升', '暴击率提升', '源石技艺提升', '终结技充能效率提升', '法术伤害提升', '治疗效率提升'] as const;
const WEAPON_BUFF_TYPE_OPTIONS = [
  'atkPercentBoost',
  'flatAtk',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'magicDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'allElementDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'allSkillDmgBonus',
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
  'magicTakenDmgBonus',
  'physicalAmplify',
  'magicAmplify',
  'fireAmplify',
  'electricAmplify',
  'iceAmplify',
  'natureAmplify',
  'comboDamageBonus',
  'multiplierBonus',
  'multiplierMultiplier',
  'sourceSkillBoost',
] as const;
const WEAPON_BUFF_TYPE_LABELS: Record<string, string> = {
  atkPercentBoost: '攻击力百分比',
  flatAtk: '固定攻击力',
  mainStatBoost: '主能力提升',
  subStatBoost: '副能力提升',
  allStatBoost: '全属性提升',
  strengthBoost: '力量提升',
  agilityBoost: '敏捷提升',
  intelligenceBoost: '智识提升',
  willBoost: '意志提升',
  critRateBoost: '暴击率',
  critDmgBonusBoost: '暴击伤害',
  physicalDmgBonus: '物理伤害加成',
  magicDmgBonus: '法术伤害加成',
  fireDmgBonus: '灼热伤害加成',
  electricDmgBonus: '电磁伤害加成',
  iceDmgBonus: '寒冷伤害加成',
  natureDmgBonus: '自然伤害加成',
  allElementDmgBonus: '全元素伤害加成',
  skillDmgBonus: '战技伤害加成',
  chainSkillDmgBonus: '连携技伤害加成',
  ultimateDmgBonus: '终结技伤害加成',
  normalAttackDmgBonus: '普攻伤害加成',
  allSkillDmgBonus: '全技能伤害加成',
  physicalFragile: '物伤易伤',
  fireFragile: '灼热脆弱',
  electricFragile: '电磁脆弱',
  iceFragile: '寒冷脆弱',
  natureFragile: '自然脆弱',
  magicFragile: '法术脆弱',
  physicalVulnerability: '物理脆弱',
  fireVulnerability: '灼热易伤',
  electricVulnerability: '电磁易伤',
  iceVulnerability: '寒冷易伤',
  natureVulnerability: '自然易伤',
  magicTakenDmgBonus: '法术易伤',
  physicalAmplify: '物理增幅',
  magicAmplify: '法术增幅',
  fireAmplify: '灼热增幅',
  electricAmplify: '电磁增幅',
  iceAmplify: '寒冷增幅',
  natureAmplify: '自然增幅',
  comboDamageBonus: '连击伤害加成',
  multiplierBonus: '倍率加算',
  multiplierMultiplier: '倍率乘算',
  sourceSkillBoost: '源石技艺强度',
  hp: '生命',
  healingBonus: '治疗效率',
  ultimateChargeEfficiency: '终结技充能效率',
};
const SKILL1_BUFF_TYPE_MAP: Record<string, string> = {
  敏捷提升: 'agilityBoost',
  力量提升: 'strengthBoost',
  意志提升: 'willBoost',
  智识提升: 'intelligenceBoost',
  主能力提升: 'mainStatBoost',
  副能力提升: 'subStatBoost',
};
const SKILL2_BUFF_TYPE_MAP: Record<string, string> = {
  攻击提升: 'atkPercentBoost',
  生命提升: 'hp',
  物理伤害提升: 'physicalDmgBonus',
  灼热伤害提升: 'fireDmgBonus',
  电磁伤害提升: 'electricDmgBonus',
  寒冷伤害提升: 'iceDmgBonus',
  自然伤害提升: 'natureDmgBonus',
  暴击率提升: 'critRateBoost',
  源石技艺提升: 'sourceSkillBoost',
  终结技充能效率提升: 'ultimateChargeEfficiency',
  法术伤害提升: 'magicDmgBonus',
  治疗效率提升: 'healingBonus',
};

function isWeaponSheetPath(pathname: string) {
  return pathname === WEAPON_SHEET_PAGE_PATH;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildWeaponIdFromName(name: string) {
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

function createEmptyWeaponLevelData(): WeaponLevelData {
  return {
    value: undefined,
    description: '',
    passive: {},
    effects: {},
  };
}

function createEmptyWeaponSkillData(skillKey: WeaponSkillKey): WeaponSkillData {
  return {
    name: formatSkillDefaultName(skillKey),
    statType: '',
    effectTypes: {},
    levels: Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => {
        const levelKey = String(index + 1);
        return [levelKey, createEmptyWeaponLevelData()];
      }),
    ) as Record<string, WeaponLevelData>,
  };
}

function createEmptyWeaponDraft(nextId = 'custom-weapon-001'): WeaponDraft {
  return {
    id: nextId,
    name: '新建武器',
    rarity: 6,
    type: '',
    description: '',
    attackGrowth: {},
    skills: {
      skill1: createEmptyWeaponSkillData('skill1'),
      skill2: createEmptyWeaponSkillData('skill2'),
      skill3: createEmptyWeaponSkillData('skill3'),
    },
  };
}

function normalizeWeaponDraft(raw: RawWeaponDraft | WeaponDraft | null | undefined): WeaponDraft {
  const fallbackId = buildWeaponIdFromName(raw?.name?.trim() || '') || 'custom-weapon-001';
  const nextDraft: WeaponDraft = {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId,
    name: raw?.name?.trim() || '未命名武器',
    rarity: Number(raw?.rarity ?? 6) || 6,
    type: raw?.type?.trim() || '',
    description: raw?.description?.trim() || '',
    attackGrowth: Object.fromEntries(
      Object.entries(raw?.attackGrowth ?? {}).filter(([, value]) => typeof value === 'number')
    ),
    skills: {
      skill1: createEmptyWeaponSkillData('skill1'),
      skill2: createEmptyWeaponSkillData('skill2'),
      skill3: createEmptyWeaponSkillData('skill3'),
    },
  };

  SKILL_KEYS.forEach((skillKey) => {
    const sourceSkill = raw?.skills?.[skillKey];
    const nextSkill = createEmptyWeaponSkillData(skillKey);
    nextSkill.name = sourceSkill?.name?.trim() || formatSkillDefaultName(skillKey);
    nextSkill.statType = sourceSkill?.statType?.trim() || '';
    nextSkill.effectTypes = Object.fromEntries(
      Object.entries(sourceSkill?.effectTypes ?? {}).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, value.trim()])
    );

    Array.from({ length: 9 }, (_, index) => String(index + 1)).forEach((levelKey) => {
      const level = sourceSkill?.levels?.[levelKey];
      nextSkill.levels[levelKey] = {
        value: typeof level?.value === 'number' ? level.value : undefined,
        description: level?.description?.trim() || '',
        passive: Object.fromEntries(Object.entries(level?.passive ?? {}).filter(([, value]) => typeof value === 'number')),
        effects: Object.fromEntries(Object.entries(level?.effects ?? {}).filter(([, value]) => typeof value === 'number')),
      };
    });

    nextDraft.skills[skillKey] = nextSkill;
  });

  return nextDraft;
}

function buildNextCustomWeaponId(existingIds: string[]) {
  let index = 1;
  while (existingIds.includes(`custom-weapon-${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `custom-weapon-${String(index).padStart(3, '0')}`;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function loadLocalWeaponLibrary() {
  const raw = readLocalStorageJson<Record<string, RawWeaponDraft>>(WEAPON_LIBRARY_STORAGE_KEY, {});
  return Object.fromEntries(
    Object.entries(raw).map(([draftId, draftValue]) => [draftId, normalizeWeaponDraft({ ...draftValue, id: draftId })]),
  ) as Record<string, WeaponDraft>;
}

function loadDraftFromStorage() {
  const raw = readLocalStorageJson<RawWeaponDraft | null>(WEAPON_DRAFT_STORAGE_KEY, null);
  if (!raw) {
    return createEmptyWeaponDraft();
  }
  return normalizeWeaponDraft(raw);
}

function buildWeaponSheetColumns(): WeaponSheetColumn[] {
  return [
    { key: 'name', title: '名称', width: 220 },
    { key: 'idText', title: 'ID', width: 120 },
    { key: 'slot', title: '字段', width: 220, align: 'center' },
    { key: 'level', title: '等级', width: 72, align: 'center' },
    { key: 'effectKey', title: '效果键', width: 180 },
    { key: 'valueText', title: '数值', width: 110, align: 'right' },
    { key: 'description', title: '描述', width: 420 },
  ];
}

function formatSkillDefaultName(skillKey: WeaponSkillKey) {
  if (skillKey === 'skill1') return '能力值';
  if (skillKey === 'skill2') return '属性';
  return '特效';
}

function getSkillAutoBuffType(skillKey: WeaponSkillKey, statType: string) {
  const trimmed = statType.trim();
  if (!trimmed) {
    return '';
  }
  if (skillKey === 'skill1') {
    return SKILL1_BUFF_TYPE_MAP[trimmed] ?? '';
  }
  if (skillKey === 'skill2') {
    return SKILL2_BUFF_TYPE_MAP[trimmed] ?? '';
  }
  return '';
}

function getBuffTypeLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) {
    return '-';
  }
  return WEAPON_BUFF_TYPE_LABELS[trimmed] ?? trimmed;
}

function getBuffTypeDisplayLabel(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) {
    return '-';
  }
  return `${getBuffTypeLabel(trimmed)} · ${trimmed}`;
}

function buildSearchIndex(values: Array<string | undefined | null>) {
  const tokens = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  const joined = tokens.join(' ');
  if (!joined) {
    return '';
  }
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

function buildBuffTypeSearchText(buffType: string) {
  const trimmed = buffType.trim();
  if (!trimmed) {
    return '';
  }
  return buildSearchIndex([trimmed, getBuffTypeLabel(trimmed), getBuffTypeDisplayLabel(trimmed)]);
}

function getEffectBuffType(skillKey: WeaponSkillKey, skill: WeaponSkillData, effectKey: string) {
  if (skillKey === 'skill1' || skillKey === 'skill2') {
    return getSkillAutoBuffType(skillKey, skill.statType);
  }
  return skill.effectTypes[effectKey]?.trim() || '';
}

function autoFillAttackGrowthMilestones(attackGrowth: Record<string, number>) {
  const nextGrowth = { ...attackGrowth };
  const start = nextGrowth['1'];
  const end = nextGrowth['90'];
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return nextGrowth;
  }
  ATTACK_GROWTH_MILESTONE_KEYS.forEach((levelKey) => {
    if (levelKey === '1' || levelKey === '90') {
      return;
    }
    const ratio = (Number(levelKey) - 1) / 89;
    nextGrowth[levelKey] = Math.round(start + (end - start) * ratio);
  });
  return nextGrowth;
}

function applyAttackGrowthInterpolation(draft: WeaponDraft) {
  return {
    ...draft,
    attackGrowth: autoFillAttackGrowthMilestones(draft.attackGrowth),
  };
}

function applyEffectLevelsInterpolation(
  draft: WeaponDraft,
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  const nextLevels = { ...draft.skills[skillKey].levels };
  const startLevel = nextLevels['1'];
  const endLevel = nextLevels['9'];
  const startValue = bucket === 'value' ? startLevel.value : startLevel[bucket][effectKey];
  const endValue = bucket === 'value' ? endLevel.value : endLevel[bucket][effectKey];
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
    return draft;
  }
  LEVEL_KEYS.forEach((levelKey, index) => {
    const ratio = index / (LEVEL_KEYS.length - 1);
    const interpolated = Number(startValue) + (Number(endValue) - Number(startValue)) * ratio;
    const rounded = Math.round(interpolated * 10000) / 10000;
    const nextLevel = { ...nextLevels[levelKey] };
    if (bucket === 'value') {
      nextLevel.value = rounded;
    } else {
      nextLevel[bucket] = {
        ...nextLevel[bucket],
        [effectKey]: rounded,
      };
    }
    nextLevels[levelKey] = nextLevel;
  });
  return {
    ...draft,
    skills: {
      ...draft.skills,
      [skillKey]: {
        ...draft.skills[skillKey],
        levels: nextLevels,
      },
    },
  };
}

function buildWeaponEffectRowKey(
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  return bucket === 'value'
    ? `effect-${skillKey}-value`
    : `effect-${skillKey}-${bucket}-${effectKey}`;
}

function buildWeaponEffectLevelsRowKey(
  skillKey: WeaponSkillKey,
  bucket: WeaponEffectBucket,
  effectKey: string,
) {
  return bucket === 'value'
    ? `effect-levels-${skillKey}-value`
    : `effect-levels-${skillKey}-${bucket}-${effectKey}`;
}

function parseInlineLevelAddress(address?: string | null) {
  if (!address) {
    return '';
  }
  const match = /^Lv([1-9])$/i.exec(address.trim());
  return match?.[1] ?? '';
}

function buildWeaponSheetRows(draft: WeaponDraft): WeaponSheetRow[] {
  const rows: WeaponSheetRow[] = [
    {
      kind: 'weapon',
      key: `weapon-${draft.id}`,
      title: draft.name,
      idText: draft.id,
      slot: draft.type || '-',
      level: '-',
      effectKey: '-',
      valueText: `${draft.rarity}★`,
      description: draft.description || '-',
      searchText: buildSearchIndex([draft.name, draft.id, draft.type, draft.description, String(draft.attackGrowth['1'] ?? ''), String(draft.attackGrowth['90'] ?? '')]),
    },
    {
      kind: 'growth',
      key: `growth-${draft.id}`,
      title: '攻击成长',
      idText: '',
      slot: '',
      level: '',
      effectKey: '',
      valueText: '',
      description: '',
      searchText: buildSearchIndex(['攻击成长', ...ATTACK_GROWTH_MILESTONE_KEYS.map((levelKey) => `Lv${levelKey} ${draft.attackGrowth[levelKey] ?? ''}`)]),
    },
  ];

  SKILL_KEYS.forEach((skillKey) => {
    const skill = draft.skills[skillKey];
    const effectCount = skillKey === 'skill3'
      ? (() => {
          const effectKeys = new Set<string>();
          LEVEL_KEYS.forEach((levelKey) => {
            const levelData = skill.levels[levelKey];
            if (typeof levelData.value === 'number') {
              effectKeys.add('__value__');
            }
            Object.keys(levelData.passive).forEach((key) => effectKeys.add(`passive:${key}`));
            Object.keys(levelData.effects).forEach((key) => effectKeys.add(`effects:${key}`));
          });
          return effectKeys.size;
        })()
      : 1;
    rows.push({
      kind: 'skill',
      key: `skill-${skillKey}`,
      skillKey,
      title: skill.name || formatSkillDefaultName(skillKey),
      idText: skillKey,
      slot: skillKey === 'skill3' ? '-' : getBuffTypeDisplayLabel(getSkillAutoBuffType(skillKey, skill.statType)),
      level: '-',
      effectKey: `${effectCount} 个效果`,
      valueText: '-',
      description: '',
      searchText: buildSearchIndex([skillKey, skill.name, skill.statType, getSkillAutoBuffType(skillKey, skill.statType)]),
    });

    if (skillKey !== 'skill3') {
      rows.push({
        kind: 'effect',
        key: buildWeaponEffectRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: skill.statType || '未设置',
        idText: `${skillKey}-series`,
        slot: getBuffTypeDisplayLabel(getSkillAutoBuffType(skillKey, skill.statType)),
        level: 'Lv1~Lv9',
        effectKey: skill.statType || '-',
        valueText: `${LEVEL_KEYS.filter((levelKey) => typeof skill.levels[levelKey].value === 'number').length} 个等级`,
        description: skillKey === 'skill1' ? '能力值曲线' : '属性曲线',
        searchText: buildSearchIndex([skill.name, skillKey, skill.statType, getSkillAutoBuffType(skillKey, skill.statType)]),
      });
      rows.push({
        kind: 'effectLevels',
        key: buildWeaponEffectLevelsRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: 'Lv',
        idText: '',
        slot: '',
        level: '',
        effectKey: '',
        valueText: '',
        description: '',
        searchText: buildSearchIndex([skill.name, skillKey, skill.statType, getSkillAutoBuffType(skillKey, skill.statType), 'levels']),
      });
      return;
    }

    const effectKeys = new Set<string>();
    LEVEL_KEYS.forEach((levelKey) => {
      const levelData = skill.levels[levelKey];
      if (typeof levelData.value === 'number') {
        effectKeys.add('__value__');
      }
      Object.keys(levelData.passive).forEach((key) => effectKeys.add(`passive:${key}`));
      Object.keys(levelData.effects).forEach((key) => effectKeys.add(`effects:${key}`));
    });

    let skill3EffectIndex = 1;

    if (effectKeys.has('__value__')) {
      rows.push({
        kind: 'effect',
        key: buildWeaponEffectRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: 'value',
        idText: `${skillKey}-value`,
        slot: 'value',
        level: 'Lv1~Lv9',
        effectKey: 'value',
        valueText: `${LEVEL_KEYS.filter((levelKey) => typeof skill.levels[levelKey].value === 'number').length} 个等级`,
        description: '技能主数值',
        searchText: buildSearchIndex([skill.name, skillKey, 'value']),
      });
      rows.push({
        kind: 'effectLevels',
        key: buildWeaponEffectLevelsRowKey(skillKey, 'value', 'value'),
        skillKey,
        bucket: 'value',
        sourceEffectKey: 'value',
        title: 'Lv',
        idText: '',
        slot: '',
        level: '',
        effectKey: '',
        valueText: '',
        description: '',
        searchText: buildSearchIndex([skill.name, skillKey, 'value', 'levels']),
      });
    }

    (['passive', 'effects'] as const).forEach((bucket) => {
      const bucketKeys = new Set<string>();
      LEVEL_KEYS.forEach((levelKey) => {
        Object.keys(skill.levels[levelKey][bucket]).forEach((key) => bucketKeys.add(key));
      });
      bucketKeys.forEach((effectKey) => {
        const effectIdText = `${skillKey}-effect${skill3EffectIndex}`;
        skill3EffectIndex += 1;
        rows.push({
          kind: 'effect',
          key: buildWeaponEffectRowKey(skillKey, bucket, effectKey),
          skillKey,
          bucket,
          sourceEffectKey: effectKey,
          title: effectKey,
          idText: effectIdText,
          slot: getBuffTypeDisplayLabel(getEffectBuffType(skillKey, skill, effectKey)),
          level: 'Lv1~Lv9',
          effectKey,
          valueText: `${LEVEL_KEYS.filter((levelKey) => typeof skill.levels[levelKey][bucket][effectKey] === 'number').length} 个等级`,
          description: '',
          searchText: buildSearchIndex([skill.name, skillKey, bucket, effectKey, getEffectBuffType(skillKey, skill, effectKey), getBuffTypeLabel(getEffectBuffType(skillKey, skill, effectKey))]),
        });
        rows.push({
          kind: 'effectLevels',
          key: buildWeaponEffectLevelsRowKey(skillKey, bucket, effectKey),
          skillKey,
          bucket,
          sourceEffectKey: effectKey,
          title: 'Lv',
          idText: '',
          slot: '',
          level: '',
          effectKey: '',
          valueText: '',
          description: '',
          searchText: buildSearchIndex([skill.name, skillKey, bucket, effectKey, getEffectBuffType(skillKey, skill, effectKey), getBuffTypeLabel(getEffectBuffType(skillKey, skill, effectKey)), 'levels']),
        });
      });
    });
  });

  return rows;
}

function columnIndexToLabel(index: number) {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function buildWeaponWorkbookRows(rows: WeaponSheetRow[], columns: WeaponSheetColumn[]): WeaponWorkbookRow[] {
  return rows.map((row, rowIndex) => ({
    key: row.key,
    rowNumber: rowIndex + 1,
    kind: row.kind,
    sourceRow: row,
    cells: columns.map((column, columnIndex) => {
      const cellValue = (() => {
        switch (column.key) {
          case 'name':
            return row.title;
          case 'idText':
            return row.idText;
          case 'slot':
            return row.slot;
          case 'level':
            return row.level;
          case 'effectKey':
            return row.effectKey;
          case 'valueText':
            return row.valueText;
          case 'description':
            return row.description;
          default:
            return '';
        }
      })();
      return {
        key: `${row.key}-${column.key}`,
        address: `${columnIndexToLabel(columnIndex)}${rowIndex + 1}`,
        value: cellValue,
        columnKey: column.key,
        width: column.width,
        align: column.align ?? 'left',
        sourceRowKey: row.key,
      };
    }),
  }));
}

function filterRows(rows: WeaponSheetRow[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return rows;
  }
  return rows.filter((row) => row.searchText.includes(normalizedKeyword));
}

function updateRecordKey<T>(record: Record<string, T>, sourceKey: string, nextKey: string) {
  if (sourceKey === nextKey || !Object.prototype.hasOwnProperty.call(record, sourceKey)) {
    return record;
  }
  const nextRecord: Record<string, T> = {};
  Object.entries(record).forEach(([key, value]) => {
    nextRecord[key === sourceKey ? nextKey : key] = value;
  });
  return nextRecord;
}

function moveRecordEntry<T>(record: Record<string, T>, fromKey: string, toKey: string) {
  const entries = Object.entries(record);
  const fromIndex = entries.findIndex(([key]) => key === fromKey);
  const toIndex = entries.findIndex(([key]) => key === toKey);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return record;
  }
  const nextEntries = [...entries];
  const [movedEntry] = nextEntries.splice(fromIndex, 1);
  nextEntries.splice(toIndex, 0, movedEntry);
  return Object.fromEntries(nextEntries) as Record<string, T>;
}

function reorderWeaponDraft(draft: WeaponDraft): WeaponDraft {
  const nextSkills: Record<string, WeaponSkillData> = {};
  SKILL_KEYS.forEach((skillKey) => {
    const skill = draft.skills[skillKey];
    const nextSkill: WeaponSkillData = {
      ...skill,
      effectTypes: { ...skill.effectTypes },
      levels: { ...skill.levels },
    };
    // Reorder effectTypes within each skill
    const effectEntries = Object.entries(skill.effectTypes);
    const reorderedEffectTypes: Record<string, string> = {};
    effectEntries.forEach(([effectKey, effectType], effectIndex) => {
      const nextEffectKey = `effect-${effectIndex + 1}`;
      reorderedEffectTypes[nextEffectKey] = effectType;
      // Update effects in all levels
      LEVEL_KEYS.forEach((levelKey) => {
        const level = nextSkill.levels[levelKey];
        if (level.effects[effectKey] !== undefined) {
          level.effects[nextEffectKey] = level.effects[effectKey];
          delete level.effects[effectKey];
        }
      });
    });
    nextSkill.effectTypes = reorderedEffectTypes;
    nextSkills[skillKey] = nextSkill;
  });

  return {
    ...draft,
    skills: nextSkills as Record<WeaponSkillKey, WeaponSkillData>,
  };
}

function getWeaponWorkbookRowClassName(row: WeaponWorkbookRow) {
  if (row.kind === 'weapon') {
    return 'damage-sheet-excel-row is-button weapon-sheet-row-weapon';
  }
  if (row.kind === 'growth') {
    return 'damage-sheet-excel-row is-data weapon-sheet-row-growth';
  }
  if (row.kind === 'skill') {
    return 'damage-sheet-excel-row is-character weapon-sheet-row-skill';
  }
  if (row.kind === 'effectLevels') {
    return 'damage-sheet-excel-row is-data weapon-sheet-row-level';
  }
  return 'damage-sheet-excel-row is-data weapon-sheet-row-effect';
}

export { isWeaponSheetPath };

export function WeaponDraftSheetPage() {
  const [draft, setDraft] = useState<WeaponDraft>(() => loadDraftFromStorage());
  const [localLibrary, setLocalLibrary] = useState<Record<string, WeaponDraft>>(() => loadLocalWeaponLibrary());
  const [selectedLocalDraftId, setSelectedLocalDraftId] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [buffTypeQuery, setBuffTypeQuery] = useState('');
  const [formulaInput, setFormulaInput] = useState('');
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<WeaponWorkbookSelection | null>(null);
  const [pendingFocusRowKey, setPendingFocusRowKey] = useState<string | null>(null);
  const [inlineEditingCellKey, setInlineEditingCellKey] = useState<string | null>(null);
  const [inlineEditingValue, setInlineEditingValue] = useState('');
  const [collapsedDraftIds, setCollapsedDraftIds] = useState<Record<string, boolean>>({});
  const [collapsedSkills, setCollapsedSkills] = useState<Record<string, boolean>>({});
  const [collapsedLevels, setCollapsedLevels] = useState<Record<string, boolean>>({});
  const [isOverwriteProtectionEnabled, setIsOverwriteProtectionEnabled] = useState(true);
  const [isOverwriteDraftModalOpen, setIsOverwriteDraftModalOpen] = useState(false);
  const [shareImportError, setShareImportError] = useState('');
  const [shareDraftName] = useState('');
  const [pendingImportShare, setPendingImportShare] = useState<DraftLibraryShareFile<WeaponDraft> | null>(null);
  const [contextMenu, setContextMenu] = useState<WeaponSheetContextMenuState | null>(null);
  const [dragState, setDragState] = useState<WeaponExplorerDragState | null>(null);
  const shareImportInputRef = useRef<HTMLInputElement>(null);
  const pendingDragSourceRef = useRef<{ source: WeaponExplorerDragNode; x: number; y: number } | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const suppressExplorerClickRef = useRef(false);

  useEffect(() => {
    if (!selectedLocalDraftId && draft.id && localLibrary[draft.id]) {
      setSelectedLocalDraftId(draft.id);
    }
  }, [draft.id, localLibrary, selectedLocalDraftId]);

  const columns = useMemo(() => buildWeaponSheetColumns(), []);
  const activeDraftId = selectedLocalDraftId || draft.id;
  const rows = useMemo(() => buildWeaponSheetRows(draft), [draft]);
  const visibleRows = useMemo(() => {
    const structuralRows = rows.filter((row) => {
      if ((row.kind === 'effect' || row.kind === 'effectLevels') && collapsedSkills[`${activeDraftId}:${row.skillKey}`]) {
        return false;
      }
      if (row.kind === 'effectLevels' && collapsedLevels[`${activeDraftId}:${row.skillKey}:${row.bucket}:${row.sourceEffectKey}`]) {
        return false;
      }
      return true;
    });
    return filterRows(structuralRows, filterKeyword);
  }, [activeDraftId, collapsedLevels, collapsedSkills, filterKeyword, rows]);
  const workbookRows = useMemo(() => buildWeaponWorkbookRows(visibleRows, columns), [columns, visibleRows]);
  const filteredBuffTypeOptions = useMemo(() => {
    const keyword = buffTypeQuery.trim().toLowerCase();
    if (!keyword) {
      return WEAPON_BUFF_TYPE_OPTIONS;
    }
    return WEAPON_BUFF_TYPE_OPTIONS.filter((option) => buildBuffTypeSearchText(option).toLowerCase().includes(keyword));
  }, [buffTypeQuery]);
  const selectedWorkbookSummary = selectedWorkbookCell?.sourceRowKey
    ? visibleRows.find((row) => row.key === selectedWorkbookCell.sourceRowKey) ?? null
    : null;
  const selectedSummaryKey = selectedWorkbookSummary?.key ?? '';

  const formulaBinding = useMemo<FormulaBinding | null>(() => {
    if (!selectedWorkbookSummary) {
      return null;
    }

    if (selectedWorkbookSummary.kind === 'weapon') {
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: 'weapon:type',
          focusId: 'weapon-type',
          inputMode: 'text',
          value: draft.type,
          placeholder: '武器类型',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, type: rawInput }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'idText') {
        return {
          key: 'weapon:id',
          focusId: 'weapon-id',
          inputMode: 'text',
          value: draft.id,
          placeholder: '武器 ID',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, id: rawInput.trim() || baseDraft.id }),
        };
      }
      if (selectedWorkbookCell?.columnKey === 'valueText') {
        return {
          key: 'weapon:rarity',
          focusId: 'weapon-rarity',
          inputMode: 'number',
          value: String(draft.rarity),
          placeholder: '稀有度',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            return { ...baseDraft, rarity: Number.isFinite(parsed) ? parsed : baseDraft.rarity };
          },
        };
      }
      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: 'weapon:description',
          focusId: 'weapon-description',
          inputMode: 'text',
          value: draft.description,
          placeholder: '武器描述',
          apply: (baseDraft, rawInput) => ({ ...baseDraft, description: rawInput }),
        };
      }
      return {
        key: 'weapon:name',
        focusId: 'weapon-name',
        inputMode: 'text',
        value: draft.name,
        placeholder: '武器名称',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          name: rawInput,
          id: buildWeaponIdFromName(rawInput) || baseDraft.id,
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'growth') {
      return null;
    }

    if (selectedWorkbookSummary.kind === 'skill') {
      const targetSkill = draft.skills[selectedWorkbookSummary.skillKey];
      const skillKey = selectedWorkbookSummary.skillKey;
      const statOptions = skillKey === 'skill1'
        ? SKILL1_OPTIONS.map((value) => ({ value, label: value }))
        : skillKey === 'skill2'
          ? SKILL2_OPTIONS.map((value) => ({ value, label: value }))
          : null;
      if (selectedWorkbookCell?.columnKey === 'slot') {
        return {
          key: `${skillKey}:statType`,
          focusId: 'skill-stat-type',
          inputMode: 'text',
          control: statOptions ? 'select' : 'input',
          value: targetSkill.statType,
          placeholder: 'skill statType',
          options: statOptions ?? undefined,
          apply: (baseDraft, rawInput) => ({
            ...baseDraft,
            skills: {
              ...baseDraft.skills,
              [skillKey]: {
                ...baseDraft.skills[skillKey],
                statType: rawInput,
              },
            },
          }),
        };
      }
      return {
        key: `${skillKey}:name`,
        focusId: 'skill-name',
        inputMode: 'text',
        value: targetSkill.name,
        placeholder: 'skill 名称',
        readOnly: skillKey !== 'skill3',
        apply: (baseDraft, rawInput) => ({
          ...baseDraft,
          skills: {
            ...baseDraft.skills,
            [skillKey]: {
              ...baseDraft.skills[skillKey],
              name: rawInput,
            },
          },
        }),
      };
    }

    if (selectedWorkbookSummary.kind === 'effect') {
      const { skillKey, bucket, sourceEffectKey } = selectedWorkbookSummary;
      const fixedStatOptions = skillKey === 'skill1'
        ? SKILL1_OPTIONS.map((value) => ({ value, label: value }))
        : skillKey === 'skill2'
          ? SKILL2_OPTIONS.map((value) => ({ value, label: value }))
          : null;
      const buffTypeOptions = [
        { value: '', label: '未设置类型' },
        ...WEAPON_BUFF_TYPE_OPTIONS.map((value) => ({ value, label: WEAPON_BUFF_TYPE_LABELS[value] ?? value })),
      ];

      if (
        selectedWorkbookCell?.columnKey === 'name'
        || selectedWorkbookCell?.columnKey === 'idText'
        || selectedWorkbookCell?.columnKey === 'slot'
      ) {
        if (selectedWorkbookCell?.columnKey === 'name') {
          if (fixedStatOptions && bucket === 'value') {
            return {
              key: `${skillKey}:fixed-effect-name`,
              focusId: 'fixed-effect-name',
              inputMode: 'text',
              control: 'select',
              value: draft.skills[skillKey].statType,
              placeholder: '',
              options: fixedStatOptions,
              apply: (baseDraft, rawInput) => ({
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    statType: rawInput,
                  },
                },
              }),
            };
          }
          return {
            key: `${skillKey}:effect-name`,
            focusId: 'effect-name',
            inputMode: 'text',
            value: sourceEffectKey,
            placeholder: '效果名称',
            readOnly: bucket === 'value',
            apply: (baseDraft, rawInput) => {
              if (bucket === 'value') {
                return baseDraft;
              }
              const trimmed = rawInput.trim();
              if (!trimmed || trimmed === sourceEffectKey) {
                return baseDraft;
              }
              const nextLevels = { ...baseDraft.skills[skillKey].levels };
              LEVEL_KEYS.forEach((levelKey) => {
                nextLevels[levelKey] = {
                  ...nextLevels[levelKey],
                  [bucket]: updateRecordKey(nextLevels[levelKey][bucket], sourceEffectKey, trimmed),
                };
              });
              const nextEffectTypes = updateRecordKey(baseDraft.skills[skillKey].effectTypes, sourceEffectKey, trimmed);
              return {
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    effectTypes: nextEffectTypes,
                    levels: nextLevels,
                  },
                },
              };
            },
          };
        }
        if (selectedWorkbookCell?.columnKey === 'slot' && skillKey === 'skill3' && bucket !== 'value') {
          return {
            key: `${skillKey}:${bucket}:${sourceEffectKey}:buff-type`,
            focusId: 'effect-buff-type',
            inputMode: 'text',
            control: 'search-select',
            value: draft.skills[skillKey].effectTypes[sourceEffectKey] ?? '',
            placeholder: '',
            options: buffTypeOptions,
            apply: (baseDraft, rawInput) => {
              const nextEffectTypes = { ...baseDraft.skills[skillKey].effectTypes };
              if (rawInput.trim()) {
                nextEffectTypes[sourceEffectKey] = rawInput.trim();
              } else {
                delete nextEffectTypes[sourceEffectKey];
              }
              return {
                ...baseDraft,
                skills: {
                  ...baseDraft.skills,
                  [skillKey]: {
                    ...baseDraft.skills[skillKey],
                    effectTypes: nextEffectTypes,
                  },
                },
              };
            },
          };
        }
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:${selectedWorkbookCell?.columnKey}`,
          focusId: `effect-${selectedWorkbookCell?.columnKey}`,
          inputMode: 'text',
          readOnly: true,
          value:
            selectedWorkbookCell?.columnKey === 'idText'
                ? selectedWorkbookSummary.idText
                : selectedWorkbookCell?.columnKey === 'slot'
                  ? selectedWorkbookSummary.slot
                  : '',
          placeholder: '',
          apply: (baseDraft) => baseDraft,
        };
      }

      if (selectedWorkbookCell?.columnKey === 'effectKey') {
        if (bucket === 'value') {
          return {
            key: `${skillKey}:value:key`,
            focusId: 'effect-key',
            inputMode: 'text',
            readOnly: true,
            value: 'value',
            placeholder: '',
            apply: (baseDraft) => baseDraft,
          };
        }
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:key`,
          focusId: 'effect-key',
          inputMode: 'text',
          value: sourceEffectKey,
          placeholder: '效果键',
          apply: (baseDraft, rawInput) => {
            const trimmed = rawInput.trim();
            if (!trimmed || trimmed === sourceEffectKey) {
              return baseDraft;
            }
            const nextLevels = { ...baseDraft.skills[skillKey].levels };
            LEVEL_KEYS.forEach((levelKey) => {
              nextLevels[levelKey] = {
                ...nextLevels[levelKey],
                [bucket]: updateRecordKey(nextLevels[levelKey][bucket], sourceEffectKey, trimmed),
              };
            });
            const nextEffectTypes = updateRecordKey(baseDraft.skills[skillKey].effectTypes, sourceEffectKey, trimmed);
            return {
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [skillKey]: {
                  ...baseDraft.skills[skillKey],
                  effectTypes: nextEffectTypes,
                  levels: nextLevels,
                },
              },
            };
          },
        };
      }

      if (selectedWorkbookCell?.columnKey === 'description') {
        return {
          key: `${skillKey}:${bucket}:${sourceEffectKey}:description`,
          focusId: 'effect-description',
          inputMode: 'text',
          value: '',
          placeholder: '效果描述',
          readOnly: true,
          apply: (baseDraft) => baseDraft,
        };
      }

      return null;
    }

    if (selectedWorkbookSummary.kind === 'effectLevels') {
      const inlineLevelKey = parseInlineLevelAddress(selectedWorkbookCell?.address);
      if (inlineLevelKey) {
        const levelData = draft.skills[selectedWorkbookSummary.skillKey].levels[inlineLevelKey];
        const rawValue = selectedWorkbookSummary.bucket === 'value'
          ? levelData.value
          : levelData[selectedWorkbookSummary.bucket][selectedWorkbookSummary.sourceEffectKey];
        return {
          key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.bucket}:${selectedWorkbookSummary.sourceEffectKey}:level:${inlineLevelKey}`,
          focusId: 'effect-level-value',
          inputMode: 'number',
          value: rawValue == null ? '' : String(rawValue),
          placeholder: '',
          apply: (baseDraft, rawInput) => {
            const parsed = Number(rawInput);
            const nextLevels = { ...baseDraft.skills[selectedWorkbookSummary.skillKey].levels };
            const nextLevel = { ...nextLevels[inlineLevelKey] };
            if (selectedWorkbookSummary.bucket === 'value') {
              nextLevel.value = rawInput.trim() && Number.isFinite(parsed) ? parsed : undefined;
            } else {
              const nextBucket = { ...nextLevel[selectedWorkbookSummary.bucket] };
              if (rawInput.trim() && Number.isFinite(parsed)) {
                nextBucket[selectedWorkbookSummary.sourceEffectKey] = parsed;
              } else {
                delete nextBucket[selectedWorkbookSummary.sourceEffectKey];
              }
              nextLevel[selectedWorkbookSummary.bucket] = nextBucket;
            }
            nextLevels[inlineLevelKey] = nextLevel;
            return {
              ...baseDraft,
              skills: {
                ...baseDraft.skills,
                [selectedWorkbookSummary.skillKey]: {
                  ...baseDraft.skills[selectedWorkbookSummary.skillKey],
                  levels: nextLevels,
                },
              },
            };
          },
        };
      }
      return {
        key: `${selectedWorkbookSummary.skillKey}:${selectedWorkbookSummary.bucket}:${selectedWorkbookSummary.sourceEffectKey}:levels`,
        focusId: 'effect-levels',
        inputMode: 'text',
        readOnly: true,
        value: 'Lv1~Lv9',
        placeholder: '',
        apply: (baseDraft) => baseDraft,
      };
    }

    return null;
  }, [draft, selectedWorkbookCell?.columnKey, selectedWorkbookSummary]);

  useEffect(() => {
    setFormulaInput(formulaBinding?.value ?? '');
  }, [formulaBinding?.key, formulaBinding?.value]);

  useEffect(() => {
    setBuffTypeQuery('');
  }, [formulaBinding?.key]);

  useEffect(() => {
    const firstDataRow = workbookRows[0];
    if (!firstDataRow) {
      setSelectedWorkbookCell(null);
      return;
    }
    if (pendingFocusRowKey) {
      const targetRow = workbookRows.find((row) => row.sourceRow.key === pendingFocusRowKey);
      if (targetRow) {
        const targetCell = targetRow.cells[0];
        setSelectedWorkbookCell({
          address: targetCell.address,
          sourceRowKey: targetCell.sourceRowKey,
          columnKey: targetCell.columnKey,
        });
        setPendingFocusRowKey(null);
        return;
      }
    }
    if (!selectedWorkbookCell) {
      const firstCell = firstDataRow.cells[0];
      setSelectedWorkbookCell({
        address: firstCell.address,
        sourceRowKey: firstCell.sourceRowKey,
        columnKey: firstCell.columnKey,
      });
    }
  }, [pendingFocusRowKey, selectedWorkbookCell, workbookRows]);

  const commitFormulaInput = useCallback((baseDraft: WeaponDraft) => {
    if (!formulaBinding || formulaInput === formulaBinding.value) {
      return baseDraft;
    }
    return normalizeWeaponDraft(formulaBinding.apply(baseDraft, formulaInput));
  }, [formulaBinding, formulaInput]);

  const persistLibraryState = useCallback((nextLibrary: Record<string, WeaponDraft>, nextDraft: WeaponDraft, nextSelectedId: string) => {
    writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
    writeLocalStorageJson(WEAPON_DRAFT_STORAGE_KEY, nextDraft);
    setLocalLibrary(nextLibrary);
    setDraft(nextDraft);
    setSelectedLocalDraftId(nextSelectedId);
  }, []);

  const persistDraftToLibrary = useCallback((allowOverwrite: boolean) => {
    const nextDraft = commitFormulaInput(draft);
    const library = loadLocalWeaponLibrary();
    const nextDraftId = nextDraft.id.trim() || buildNextCustomWeaponId(Object.keys(library));

    if (library[nextDraftId] && !allowOverwrite) {
      setIsOverwriteDraftModalOpen(true);
      return false;
    }

    const finalDraft = { ...nextDraft, id: nextDraftId };
    const nextLibrary = {
      ...library,
      [nextDraftId]: finalDraft,
    };

    persistLibraryState(nextLibrary, finalDraft, nextDraftId);
    setPendingFocusRowKey(`weapon-${nextDraftId}`);
    setIsOverwriteDraftModalOpen(false);
    return true;
  }, [commitFormulaInput, draft, persistLibraryState, selectedLocalDraftId]);

  const handleSaveDraft = useCallback(() => {
    persistDraftToLibrary(!isOverwriteProtectionEnabled);
  }, [isOverwriteProtectionEnabled, persistDraftToLibrary]);

  const handleNormalizeDraft = useCallback(() => {
    const nextDraft = reorderWeaponDraft(draft);
    const nextLibrary = { ...localLibrary, [nextDraft.id]: nextDraft };
    persistLibraryState(nextLibrary, nextDraft, nextDraft.id);
  }, [draft, localLibrary, persistLibraryState]);

  const handleConfirmOverwriteDraft = useCallback(() => {
    persistDraftToLibrary(true);
  }, [persistDraftToLibrary]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveDraft();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveDraft]);

  const handleCreateNewDraft = useCallback(() => {
    const nextDraftId = buildNextCustomWeaponId(Object.keys(localLibrary));
    const nextDraft = createEmptyWeaponDraft(nextDraftId);
    persistLibraryState({
      ...localLibrary,
      [nextDraftId]: nextDraft,
    }, nextDraft, nextDraftId);
    setPendingFocusRowKey(`weapon-${nextDraft.id}`);
  }, [localLibrary, persistLibraryState]);

  const handleLoadLocalDraft = useCallback((draftId: string) => {
    const nextDraft = localLibrary[draftId];
    if (!nextDraft) {
      return;
    }
    setDraft(cloneValue(nextDraft));
    setSelectedLocalDraftId(draftId);
    setPendingFocusRowKey(`weapon-${draftId}`);
  }, [localLibrary]);

  const setDraftCollapsed = useCallback((draftId: string, nextCollapsed: boolean) => {
    setCollapsedDraftIds((prev) => ({ ...prev, [draftId]: nextCollapsed }));
  }, []);

  const toggleSkillCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey) => {
    const collapseKey = `${draftId}:${skillKey}`;
    setCollapsedSkills((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }));
  }, []);

  const setSkillCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey, nextCollapsed: boolean) => {
    const collapseKey = `${draftId}:${skillKey}`;
    setCollapsedSkills((prev) => ({ ...prev, [collapseKey]: nextCollapsed }));
  }, []);

  const toggleLevelCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    const collapseKey = `${draftId}:${skillKey}:${bucket}:${effectKey}`;
    setCollapsedLevels((prev) => ({ ...prev, [collapseKey]: !prev[collapseKey] }));
  }, []);

  const setLevelCollapsed = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string, nextCollapsed: boolean) => {
    const collapseKey = `${draftId}:${skillKey}:${bucket}:${effectKey}`;
    setCollapsedLevels((prev) => ({ ...prev, [collapseKey]: nextCollapsed }));
  }, []);

  const handleAttackGrowthChange = useCallback((levelKey: string, rawValue: string) => {
    setDraft((prev) => {
      const nextAttackGrowth = { ...prev.attackGrowth };
      const parsed = Number(rawValue);
      if (rawValue.trim() && Number.isFinite(parsed)) {
        nextAttackGrowth[levelKey] = parsed;
      } else {
        delete nextAttackGrowth[levelKey];
      }
      return {
        ...prev,
        attackGrowth: nextAttackGrowth,
      };
    });
  }, []);

  const updateLibraryDraft = useCallback((
    draftId: string,
    updater: (baseDraft: WeaponDraft) => WeaponDraft,
    options?: { focusRowKey?: string; selectAfter?: boolean },
  ) => {
    const baseDraft = draftId === selectedLocalDraftId ? commitFormulaInput(draft) : cloneValue(localLibrary[draftId]);
    if (!baseDraft) {
      return;
    }
    const nextDraft = normalizeWeaponDraft(updater(cloneValue(baseDraft)));
    const nextLibrary = {
      ...localLibrary,
      [draftId]: nextDraft,
    };
    if (draftId === selectedLocalDraftId || options?.selectAfter) {
      persistLibraryState(nextLibrary, nextDraft, draftId);
    } else {
      writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
      setLocalLibrary(nextLibrary);
    }
    if (options?.focusRowKey) {
      setPendingFocusRowKey(options.focusRowKey);
    }
  }, [commitFormulaInput, draft, localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleAutoFillAttackGrowth = useCallback((draftId: string) => {
    updateLibraryDraft(draftId, (baseDraft) => applyAttackGrowthInterpolation(baseDraft), {
      selectAfter: true,
      focusRowKey: `growth-${draftId}`,
    });
  }, [updateLibraryDraft]);

  const handleAutoFillEffectLevels = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    updateLibraryDraft(draftId, (baseDraft) => applyEffectLevelsInterpolation(baseDraft, skillKey, bucket, effectKey), {
      selectAfter: true,
      focusRowKey: buildWeaponEffectLevelsRowKey(skillKey, bucket, effectKey),
    });
  }, [updateLibraryDraft]);

  const handleCreateDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey) => {
    updateLibraryDraft(draftId, (baseDraft) => {
      let effectIndex = 1;
      while (LEVEL_KEYS.some((levelKey) => baseDraft.skills[skillKey].levels[levelKey].effects[`effect${effectIndex}`] != null)) {
        effectIndex += 1;
      }
      const effectKey = `effect${effectIndex}`;
      const nextLevels = { ...baseDraft.skills[skillKey].levels };
      LEVEL_KEYS.forEach((levelKey) => {
        nextLevels[levelKey] = {
          ...nextLevels[levelKey],
          effects: {
            ...nextLevels[levelKey].effects,
            [effectKey]: 0,
          },
        };
      });
      return {
        ...baseDraft,
        skills: {
          ...baseDraft.skills,
          [skillKey]: {
            ...baseDraft.skills[skillKey],
            effectTypes: {
              ...baseDraft.skills[skillKey].effectTypes,
              [effectKey]: '',
            },
            levels: nextLevels,
          },
        },
      };
    }, {
      selectAfter: true,
      focusRowKey: buildWeaponEffectRowKey(skillKey, 'effects', `effect${Object.keys((localLibrary[draftId] ?? draft).skills[skillKey].levels['1'].effects).length + 1}`),
    });
  }, [draft, localLibrary, updateLibraryDraft]);

  const handleDeleteDraftGroup = useCallback((draftId: string) => {
    if (!localLibrary[draftId]) {
      return;
    }
    const nextLibrary = { ...localLibrary };
    delete nextLibrary[draftId];
    const remainingIds = Object.keys(nextLibrary).sort();
    if (selectedLocalDraftId === draftId) {
      const nextSelectedId = remainingIds[0] ?? '';
      const nextDraft = nextSelectedId ? cloneValue(nextLibrary[nextSelectedId]) : createEmptyWeaponDraft(buildNextCustomWeaponId(remainingIds));
      persistLibraryState(nextLibrary, nextDraft, nextSelectedId);
      setPendingFocusRowKey(`weapon-${nextDraft.id}`);
      return;
    }
    writeLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, nextLibrary);
    setLocalLibrary(nextLibrary);
  }, [localLibrary, persistLibraryState, selectedLocalDraftId]);

  const handleDeleteDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    updateLibraryDraft(draftId, (baseDraft) => {
      const nextLevels = { ...baseDraft.skills[skillKey].levels };
      LEVEL_KEYS.forEach((levelKey) => {
        const nextLevel = nextLevels[levelKey];
        if (bucket === 'value') {
          nextLevels[levelKey] = {
            ...nextLevel,
            value: undefined,
          };
          return;
        }
        const nextBucket = { ...nextLevel[bucket] };
        delete nextBucket[effectKey];
        nextLevels[levelKey] = {
          ...nextLevel,
          [bucket]: nextBucket,
        };
      });
      return {
        ...baseDraft,
        skills: {
          ...baseDraft.skills,
          [skillKey]: {
            ...baseDraft.skills[skillKey],
            effectTypes: bucket === 'value'
              ? baseDraft.skills[skillKey].effectTypes
              : (() => {
                  const nextEffectTypes = { ...baseDraft.skills[skillKey].effectTypes };
                  delete nextEffectTypes[effectKey];
                  return nextEffectTypes;
                })(),
            levels: nextLevels,
          },
        },
      };
    }, {
      selectAfter: true,
      focusRowKey: `skill-${skillKey}`,
    });
  }, [updateLibraryDraft]);

  const handleDuplicateDraftEffect = useCallback((draftId: string, skillKey: WeaponSkillKey, bucket: WeaponEffectBucket, effectKey: string) => {
    const currentSkill = draft.skills[skillKey];
    let effectIndex = 1;
    while (currentSkill.effectTypes[`effect${effectIndex}`]) {
      effectIndex += 1;
    }
    const newEffectKey = `effect${effectIndex}`;
    const effectType = currentSkill.effectTypes[effectKey];

    updateLibraryDraft(draftId, (baseDraft) => {
      const skill = baseDraft.skills[skillKey];
      const nextLevels = { ...skill.levels };
      LEVEL_KEYS.forEach((levelKey) => {
        const level = nextLevels[levelKey];
        const sourceValue = bucket === 'value' ? level.value : level[bucket][effectKey];
        if (bucket === 'value') {
          nextLevels[levelKey] = { ...level, value: sourceValue };
        } else {
          nextLevels[levelKey] = {
            ...level,
            [bucket]: {
              ...level[bucket],
              [newEffectKey]: sourceValue ?? 0,
            },
          };
        }
      });

      return {
        ...baseDraft,
        skills: {
          ...baseDraft.skills,
          [skillKey]: {
            ...skill,
            effectTypes: {
              ...skill.effectTypes,
              [newEffectKey]: effectType || 'atkPercentBoost',
            },
            levels: nextLevels,
          },
        },
      };
    }, {
      selectAfter: true,
      focusRowKey: buildWeaponEffectRowKey(skillKey, bucket, newEffectKey),
    });
  }, [draft, updateLibraryDraft]);

  const currentShareFile = useMemo(() => buildDraftLibraryShareFile(
    WEAPON_LIBRARY_SHARE_TYPE,
    localLibrary,
    shareDraftName || draft.name || 'weapon-library',
  ), [draft.name, localLibrary, shareDraftName]);

  const handleExportLocalLibrary = useCallback(() => {
    const blob = new Blob([JSON.stringify(currentShareFile, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildDraftLibraryShareFileName(currentShareFile.label, currentShareFile.exportedAt);
    link.click();
    window.URL.revokeObjectURL(url);
  }, [currentShareFile]);

  const handleOpenShareImportPicker = useCallback(() => {
    shareImportInputRef.current?.click();
  }, []);

  const handleShareFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const rawText = await file.text();
    const parsed = parseDraftLibraryShareFile(rawText, WEAPON_LIBRARY_SHARE_TYPE);
    if (!parsed) {
      setShareImportError('导入失败：文件不是有效的武器库分享 JSON。');
      event.target.value = '';
      return;
    }

    const normalizedPayload = Object.fromEntries(
      Object.entries(parsed.payload).map(([draftId, draftValue]) => [draftId, normalizeWeaponDraft({ ...(draftValue as RawWeaponDraft), id: draftId })]),
    ) as Record<string, WeaponDraft>;

    setPendingImportShare({
      ...parsed,
      payload: normalizedPayload,
    } as DraftLibraryShareFile<WeaponDraft>);
    setShareImportError('');
    event.target.value = '';
  }, []);

  const handleConfirmImportShare = useCallback(() => {
    if (!pendingImportShare) {
      return;
    }
    const nextLibrary = {
      ...localLibrary,
      ...pendingImportShare.payload,
    };
    const nextDraftId = Object.keys(pendingImportShare.payload)[0] ?? '';
    const nextDraft = nextDraftId && nextLibrary[nextDraftId]
      ? nextLibrary[nextDraftId]
      : draft;
    persistLibraryState(nextLibrary, nextDraft, nextDraftId || selectedLocalDraftId || draft.id);
    setPendingImportShare(null);
  }, [draft, localLibrary, pendingImportShare, persistLibraryState, selectedLocalDraftId]);

  const openContextMenu = useCallback((event: ReactMouseEvent, nextMenu: WeaponSheetContextMenuState) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(nextMenu);
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const handlePointerDown = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handlePointerDown, true);
    };
  }, [contextMenu]);

  const openWorkbookContextMenu = useCallback((
    event: ReactMouseEvent,
    sourceRow?: WeaponSheetRow,
    selectedCell?: WeaponWorkbookSelection,
  ) => {
    if (selectedCell) {
      setSelectedWorkbookCell(selectedCell);
    }
    if (!sourceRow) {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'blank',
      });
      return;
    }
    if (sourceRow.kind === 'weapon' || sourceRow.kind === 'growth') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'draft',
        draftId: activeDraftId,
      });
      return;
    }
    if (sourceRow.kind === 'skill') {
      openContextMenu(event, {
        x: event.clientX,
        y: event.clientY,
        target: 'skill',
        draftId: activeDraftId,
        skillKey: sourceRow.skillKey,
      });
      return;
    }
    openContextMenu(event, {
      x: event.clientX,
      y: event.clientY,
      target: 'effect',
      draftId: activeDraftId,
      skillKey: sourceRow.skillKey,
      effectKey: sourceRow.sourceEffectKey,
      bucket: sourceRow.bucket,
    });
  }, [activeDraftId, openContextMenu]);

  const currentContextMenuActions = useMemo<WeaponSheetContextMenuAction[]>(() => {
    if (!contextMenu) {
      return [];
    }
    if (contextMenu.target === 'blank') {
      return [
        { key: 'new-weapon', label: '新建武器', icon: 'new', onClick: () => handleCreateNewDraft() },
      ];
    }
    if (contextMenu.target === 'draft' && contextMenu.draftId) {
      const isCollapsed = Boolean(collapsedDraftIds[contextMenu.draftId]);
      return [
        { key: 'open-draft', label: '打开武器', icon: 'open', onClick: () => handleLoadLocalDraft(contextMenu.draftId!) },
        { key: 'fill-attack-growth', label: '按 1/90 补全攻击成长', icon: 'new', onClick: () => handleAutoFillAttackGrowth(contextMenu.draftId!) },
        {
          key: 'toggle-draft-collapse',
          label: isCollapsed ? '展开此武器' : '折叠此武器',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setDraftCollapsed(contextMenu.draftId!, !isCollapsed),
        },
        { key: 'delete-draft', label: '删除武器', icon: 'delete', onClick: () => handleDeleteDraftGroup(contextMenu.draftId!) },
      ];
    }
    if (contextMenu.target === 'skill' && contextMenu.draftId && contextMenu.skillKey) {
      const isCollapsed = Boolean(collapsedSkills[`${contextMenu.draftId}:${contextMenu.skillKey}`]);
      return [
        ...(contextMenu.skillKey === 'skill3'
          ? [{ key: 'create-effect', label: '新建效果', icon: 'new' as const, onClick: () => handleCreateDraftEffect(contextMenu.draftId!, contextMenu.skillKey!) }]
          : []),
        {
          key: 'toggle-skill-collapse',
          label: isCollapsed ? '展开此技能' : '折叠此技能',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setSkillCollapsed(contextMenu.draftId!, contextMenu.skillKey!, !isCollapsed),
        },
      ];
    }
    if (contextMenu.target === 'effect' && contextMenu.draftId && contextMenu.skillKey && contextMenu.effectKey && contextMenu.bucket) {
      const isCollapsed = Boolean(collapsedLevels[`${contextMenu.draftId}:${contextMenu.skillKey}:${contextMenu.bucket}:${contextMenu.effectKey}`]);
      return [
        {
          key: 'fill-effect-levels',
          label: '按 Lv1/Lv9 补全等级',
          icon: 'new',
          onClick: () => handleAutoFillEffectLevels(
            contextMenu.draftId!,
            contextMenu.skillKey!,
            contextMenu.bucket!,
            contextMenu.effectKey!,
          ),
        },
        {
          key: 'toggle-effect-levels',
          label: isCollapsed ? '展开等级' : '折叠等级',
          icon: isCollapsed ? 'expand' : 'collapse',
          onClick: () => setLevelCollapsed(contextMenu.draftId!, contextMenu.skillKey!, contextMenu.bucket!, contextMenu.effectKey!, !isCollapsed),
        },
        ...(contextMenu.skillKey === 'skill3'
          ? [
              { key: 'copy-effect', label: '复制效果', icon: 'new' as const, onClick: () => handleDuplicateDraftEffect(contextMenu.draftId!, contextMenu.skillKey!, contextMenu.bucket!, contextMenu.effectKey!) },
              { key: 'delete-effect', label: '删除效果', icon: 'delete' as const, onClick: () => handleDeleteDraftEffect(contextMenu.draftId!, contextMenu.skillKey!, contextMenu.bucket!, contextMenu.effectKey!) },
            ]
          : []),
      ];
    }
    return [];
  }, [
    collapsedDraftIds,
    collapsedLevels,
    collapsedSkills,
    contextMenu,
    handleCreateDraftEffect,
    handleCreateNewDraft,
    handleAutoFillAttackGrowth,
    handleAutoFillEffectLevels,
    handleDeleteDraftEffect,
    handleDeleteDraftGroup,
    handleDuplicateDraftEffect,
    handleLoadLocalDraft,
    setDraftCollapsed,
    setSkillCollapsed,
    setLevelCollapsed,
  ]);

  const explorerEntries = useMemo(() => {
    const entries = { ...localLibrary };
    if (draft.id && !entries[draft.id]) {
      entries[draft.id] = cloneValue(draft);
    }
    return Object.values(entries).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
  }, [draft, localLibrary]);

  // Explorer drag helpers
  const getExplorerDragNodeKey = useCallback((node: WeaponExplorerDragNode) => {
    if (node.kind === 'draft') {
      return `draft:${node.draftId}`;
    }
    if (node.kind === 'skill') {
      return `skill:${node.draftId}:${node.skillKey}`;
    }
    return `effect:${node.draftId}:${node.skillKey}:${node.bucket}:${node.effectKey}`;
  }, []);

  const getExplorerDragNodeLabel = useCallback((node: WeaponExplorerDragNode) => {
    const targetDraft = localLibrary[node.draftId];
    if (!targetDraft) {
      return node.draftId;
    }
    if (node.kind === 'draft') {
      return targetDraft.name || node.draftId;
    }
    if (node.kind === 'skill') {
      return targetDraft.skills[node.skillKey]?.name || node.skillKey;
    }
    const skill = targetDraft.skills[node.skillKey];
    if (!skill) {
      return node.effectKey;
    }
    return skill.effectTypes[node.effectKey] || node.effectKey;
  }, [localLibrary]);

  const clearPendingExplorerDrag = useCallback(() => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    pendingDragSourceRef.current = null;
  }, []);

  const canStartExplorerDrag = useCallback((node: WeaponExplorerDragNode) => {
    if (filterKeyword.trim()) {
      return false;
    }
    // 只允许 skill3 的 effect 拖拽
    if (node.kind === 'effect') {
      return node.skillKey === 'skill3';
    }
    // draft 和 skill 不允许拖拽
    return false;
  }, [filterKeyword]);

  const isValidExplorerDropTarget = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode | null) => {
    if (!target || source.kind !== target.kind) {
      return false;
    }
    if (getExplorerDragNodeKey(source) === getExplorerDragNodeKey(target)) {
      return false;
    }
    if (target.kind === 'draft') {
      return canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (target.kind === 'skill') {
      return source.draftId === target.draftId && canStartExplorerDrag(source) && canStartExplorerDrag(target);
    }
    if (source.kind !== 'effect') {
      return false;
    }
    return source.draftId === target.draftId && source.skillKey === target.skillKey;
  }, [canStartExplorerDrag, getExplorerDragNodeKey]);

  const resolveExplorerDragNodeFromElement = useCallback((element: Element | null): WeaponExplorerDragNode | null => {
    const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-weapon-drag-kind]') : null;
    if (!row) {
      return null;
    }
    const kind = row.dataset.weaponDragKind as WeaponExplorerDragNode['kind'] | undefined;
    const draftId = row.dataset.weaponDraftId;
    if (!kind || !draftId) {
      return null;
    }
    if (kind === 'draft') {
      return { kind, draftId };
    }
    const skillKey = row.dataset.weaponSkillKey as WeaponSkillKey | undefined;
    if (!skillKey) {
      return null;
    }
    if (kind === 'skill') {
      return { kind, draftId, skillKey };
    }
    const bucket = row.dataset.weaponBucket as WeaponEffectBucket | undefined;
    const effectKey = row.dataset.weaponEffectKey;
    if (!bucket || !effectKey) {
      return null;
    }
    return { kind: 'effect', draftId, skillKey, bucket, effectKey };
  }, []);

  const applyExplorerReorder = useCallback((source: WeaponExplorerDragNode, target: WeaponExplorerDragNode) => {
    if (!isValidExplorerDropTarget(source, target)) {
      return;
    }

    if (source.kind === 'draft' && target.kind === 'draft') {
      // Reorder drafts in library
      const nextLibrary = moveRecordEntry(localLibrary, source.draftId, target.draftId);
      setLocalLibrary(nextLibrary);
      window.localStorage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    } else if (source.kind === 'skill' && target.kind === 'skill' && source.draftId === target.draftId) {
      // Reorder skills within a draft (SKILL_KEYS is fixed order, so we need to reorder effectTypes instead)
      const targetDraft = localLibrary[source.draftId] || draft;
      const nextDraft = { ...targetDraft };
      // Skills are fixed (skill1, skill2, skill3), so we reorder their effectTypes
      // This is a simplified implementation
      setDraft(nextDraft);
      window.localStorage.setItem(WEAPON_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    } else if (source.kind === 'effect' && target.kind === 'effect' && source.draftId === target.draftId && source.skillKey === target.skillKey) {
      // Reorder effects within a skill
      const targetDraft = localLibrary[source.draftId] || draft;
      const skill = targetDraft.skills[source.skillKey];
      const nextEffectTypes = moveRecordEntry(skill.effectTypes, source.effectKey, target.effectKey);
      // Also need to reorder effects in all levels
      const nextLevels: Record<string, WeaponLevelData> = {};
      Object.entries(skill.levels).forEach(([levelKey, level]) => {
        nextLevels[levelKey] = {
          ...level,
          effects: moveRecordEntry(level.effects, source.effectKey, target.effectKey),
        };
      });
      const nextSkill: WeaponSkillData = {
        ...skill,
        effectTypes: nextEffectTypes,
        levels: nextLevels,
      };
      const nextDraft: WeaponDraft = {
        ...targetDraft,
        skills: {
          ...targetDraft.skills,
          [source.skillKey]: nextSkill,
        },
      };
      const nextLibrary = { ...localLibrary, [source.draftId]: nextDraft };
      setDraft(nextDraft);
      setLocalLibrary(nextLibrary);
      window.localStorage.setItem(WEAPON_DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
      window.localStorage.setItem(WEAPON_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary));
    }
  }, [draft, isValidExplorerDropTarget, localLibrary]);

  const handleExplorerPointerDown = useCallback((event: React.PointerEvent, source: WeaponExplorerDragNode) => {
    if (event.button !== 0 || !canStartExplorerDrag(source)) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.buff-sheet-explorer-toggle')) {
      return;
    }
    clearPendingExplorerDrag();
    pendingDragSourceRef.current = {
      source,
      x: event.clientX,
      y: event.clientY,
    };
    dragHoldTimerRef.current = window.setTimeout(() => {
      suppressExplorerClickRef.current = true;
      setContextMenu(null);
      setDragState({ source, over: null, x: event.clientX, y: event.clientY });
      pendingDragSourceRef.current = null;
      dragHoldTimerRef.current = null;
    }, 220);
  }, [canStartExplorerDrag, clearPendingExplorerDrag]);

  const formatWeaponExplorerDragKindLabel = (kind: WeaponExplorerDragNode['kind']): string => {
    if (kind === 'draft') {
      return '武器';
    }
    if (kind === 'skill') {
      return '技能';
    }
    return '效果';
  };

  // Explorer drag global event listeners
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pending = pendingDragSourceRef.current;
      if (pending) {
        const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
        if (distance > 6) {
          clearPendingExplorerDrag();
        }
      }
      if (!dragState) {
        return;
      }
      event.preventDefault();
      const hoveredNode = resolveExplorerDragNodeFromElement(document.elementFromPoint(event.clientX, event.clientY));
      setDragState((prev) => {
        if (!prev) {
          return prev;
        }
        const nextOver = isValidExplorerDropTarget(prev.source, hoveredNode) ? hoveredNode : null;
        const previousOverKey = prev.over ? getExplorerDragNodeKey(prev.over) : '';
        const nextOverKey = nextOver ? getExplorerDragNodeKey(nextOver) : '';
        if (previousOverKey === nextOverKey && prev.x === event.clientX && prev.y === event.clientY) {
          return prev;
        }
        return {
          ...prev,
          over: nextOver,
          x: event.clientX,
          y: event.clientY,
        };
      });
    };

    const finalizeDrag = () => {
      clearPendingExplorerDrag();
      setDragState((prev) => {
        if (prev?.over) {
          applyExplorerReorder(prev.source, prev.over);
        }
        return null;
      });
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finalizeDrag, true);
    window.addEventListener('pointercancel', finalizeDrag, true);
    window.addEventListener('blur', finalizeDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finalizeDrag, true);
      window.removeEventListener('pointercancel', finalizeDrag, true);
      window.removeEventListener('blur', finalizeDrag);
    };
  }, [applyExplorerReorder, clearPendingExplorerDrag, dragState, getExplorerDragNodeKey, isValidExplorerDropTarget, resolveExplorerDragNodeFromElement]);

  const renderFormulaEditor = () => {
    if (!formulaBinding) {
      return <div className="damage-sheet-formula-value">{draft.description || 'Sheet-Weapon workbook'}</div>;
    }

    if (formulaBinding.control === 'select') {
      return (
        <select
          data-formula-focus-id={formulaBinding.focusId}
          className="buff-sheet-formula-input is-select"
          value={formulaBinding.value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setFormulaInput(nextValue);
            formulaBinding.onValueChange?.(nextValue);
            const nextDraft = normalizeWeaponDraft(formulaBinding.apply(draft, nextValue));
            if (nextDraft !== draft) {
              setDraft(nextDraft);
            }
          }}
        >
          {(formulaBinding.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      );
    }

    if (formulaBinding.control === 'search-select') {
      return (
        <div className="buff-sheet-formula-type-editor">
          <input
            data-formula-focus-id={`${formulaBinding.focusId}-search`}
            className="buff-sheet-formula-input buff-sheet-formula-type-search"
            value={buffTypeQuery}
            onChange={(event) => setBuffTypeQuery(event.target.value)}
            placeholder="搜索类型：法术 / 异伤 / 倍率 / 源石技艺"
          />
          <select
            data-formula-focus-id={`${formulaBinding.focusId}-select`}
            className="buff-sheet-formula-input is-select buff-sheet-formula-type-select"
            value={formulaBinding.value}
            onChange={(event) => {
              const nextValue = event.target.value;
              setFormulaInput(nextValue);
              const nextDraft = normalizeWeaponDraft(formulaBinding.apply(draft, nextValue));
              if (nextDraft !== draft) {
                setDraft(nextDraft);
              }
            }}
          >
            {(formulaBinding.options ?? []).slice(0, 1).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            {filteredBuffTypeOptions.map((option) => (
              <option key={option} value={option}>{getBuffTypeDisplayLabel(option)}</option>
            ))}
          </select>
        </div>
      );
    }

    if (formulaBinding.readOnly) {
      return (
        <input
          data-formula-focus-id={formulaBinding.focusId}
          className="buff-sheet-formula-input"
          type="text"
          value={formulaBinding.value}
          readOnly
        />
      );
    }

    return (
      <input
        data-formula-focus-id={formulaBinding.focusId}
        className="buff-sheet-formula-input"
        type={formulaBinding.inputMode === 'number' ? 'number' : 'text'}
        value={formulaInput}
        onChange={(event) => setFormulaInput(event.target.value)}
        onBlur={() => {
          const nextDraft = commitFormulaInput(draft);
          if (nextDraft !== draft) {
            setDraft(nextDraft);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            const nextDraft = commitFormulaInput(draft);
            if (nextDraft !== draft) {
              setDraft(nextDraft);
            }
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setFormulaInput(formulaBinding.value);
            event.currentTarget.blur();
          }
        }}
        placeholder={formulaBinding.placeholder}
      />
    );
  };

  const renderRowNumberContent = (row: WeaponWorkbookRow) => {
    const sourceRow = row.sourceRow;
    if (sourceRow.kind === 'skill') {
      return (
        <button
          type="button"
          className="damage-sheet-row-toggle"
          onClick={() => toggleSkillCollapsed(activeDraftId, sourceRow.skillKey)}
        >
          {collapsedSkills[`${activeDraftId}:${sourceRow.skillKey}`] ? '[+]' : '[-]'}
        </button>
      );
    }

    if (sourceRow.kind === 'effect') {
      return (
        <button
          type="button"
          className="damage-sheet-row-toggle"
          onClick={() => toggleLevelCollapsed(activeDraftId, sourceRow.skillKey, sourceRow.bucket, sourceRow.sourceEffectKey)}
        >
          {collapsedLevels[`${activeDraftId}:${sourceRow.skillKey}:${sourceRow.bucket}:${sourceRow.sourceEffectKey}`] ? '[+]' : '[-]'}
        </button>
      );
    }

    return row.rowNumber;
  };

  return (
    <main className="damage-sheet-page buff-sheet-page weapon-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
            返回
          </button>
          <div className="damage-sheet-title-block">
            <h1>Sheet-Weapon</h1>
            <p>武器档案工作表 · 按 weapon → skill → level → effect 编辑</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <button type="button" className="damage-sheet-action-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.buffSheet)}>
            打开 Sheet-Buff
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon buff-sheet-ribbon">
        <div className="buff-sheet-ribbon-actions">
          <button type="button" className="buff-sheet-tool-button" onClick={handleCreateNewDraft} title="新建武器">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3.25v9.5M3.25 8h9.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">新建</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleSaveDraft} title="保存当前武器">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" />
                <path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">保存</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleNormalizeDraft} title="整理技能与效果顺序">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M4 4.5h7.5M4 8h5.5M4 11.5h7.5" />
                <path d="M11 3.25l1.75 1.25L11 5.75" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">整理</span>
          </button>
          <button
            type="button"
            className={`buff-sheet-tool-button${isOverwriteProtectionEnabled ? ' is-active' : ''}`}
            onClick={() => setIsOverwriteProtectionEnabled((prev) => !prev)}
            title="切换覆盖保护"
          >
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 2.5l4 1.5v3.25c0 2.5-1.5 4.75-4 6.25-2.5-1.5-4-3.75-4-6.25V4z" />
                <path d="M6.25 8.25L7.4 9.4l2.35-2.55" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">{isOverwriteProtectionEnabled ? '保护开' : '保护关'}</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleExportLocalLibrary} title="导出本地武器库">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 3v6.5" />
                <path d="M5.75 7.25L8 9.5l2.25-2.25" />
                <path d="M3.5 11.75h9" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导出</span>
          </button>
          <button type="button" className="buff-sheet-tool-button" onClick={handleOpenShareImportPicker} title="导入武器分享">
            <span className="buff-sheet-tool-icon" aria-hidden="true">
              <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">
                <path d="M8 13V6.5" />
                <path d="M5.75 8.75L8 6.5l2.25 2.25" />
                <path d="M3.5 3.25h9" />
              </svg>
            </span>
            <span className="buff-sheet-tool-text">导入</span>
          </button>
        </div>
        
        <div className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedWorkbookCell?.address ?? '-'}</span>
          <span className="damage-sheet-formula-label">fx</span>
          {renderFormulaEditor()}
        </div>
      </section>

      <main className="damage-sheet-workspace">
        <aside
          className="damage-sheet-sidebar buff-sheet-explorer"
          onContextMenu={(event) => openContextMenu(event, {
            x: event.clientX,
            y: event.clientY,
            target: 'blank',
          })}
        >
          <div className="damage-sheet-sidebar-title">资源管理器</div>
          <input
            className="buff-sheet-search-input"
            value={filterKeyword}
            onChange={(event) => setFilterKeyword(event.target.value)}
            placeholder="搜索武器 / skill / effect"
          />
          <input
            ref={shareImportInputRef}
            type="file"
            accept=".json,application/json"
            className="operator-draft-file-input"
            onChange={handleShareFileSelected}
          />
          <div className="buff-sheet-explorer-tree">
            {explorerEntries.length === 0 ? (
              <div className="damage-sheet-detail-empty">当前还没有本地保存的武器。</div>
            ) : explorerEntries.map((entry) => {
              const explorerDraft = entry.id === selectedLocalDraftId ? draft : entry;
              const isDraftCollapsed = Boolean(collapsedDraftIds[entry.id]);
              const draftDragNode: WeaponExplorerDragNode = { kind: 'draft', draftId: entry.id };
              const draftDragKey = getExplorerDragNodeKey(draftDragNode);
              return (
                <div key={entry.id} className="buff-sheet-explorer-node">
                  <button
                    type="button"
                    className={`buff-sheet-explorer-row${selectedLocalDraftId === entry.id ? ' is-active' : ''}${dragState?.source && getExplorerDragNodeKey(dragState.source) === draftDragKey ? ' is-drag-source' : ''}${dragState?.over && getExplorerDragNodeKey(dragState.over) === draftDragKey ? ' is-drag-target' : ''}${canStartExplorerDrag(draftDragNode) ? ' is-draggable' : ''}`}
                    data-weapon-drag-kind="draft"
                    data-weapon-draft-id={entry.id}
                    onPointerDown={(event) => handleExplorerPointerDown(event, draftDragNode)}
                    onClick={() => {
                      if (suppressExplorerClickRef.current) {
                        suppressExplorerClickRef.current = false;
                        return;
                      }
                      handleLoadLocalDraft(entry.id);
                    }}
                    onContextMenu={(event) => openContextMenu(event, {
                      x: event.clientX,
                      y: event.clientY,
                      target: 'draft',
                      draftId: entry.id,
                    })}
                  >
                    <span
                      className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDraftCollapsed(entry.id, !isDraftCollapsed);
                      }}
                    >
                      {isDraftCollapsed ? '[+]' : '[-]'}
                    </span>
                    <span className="buff-sheet-explorer-label">{explorerDraft.name}</span>
                  </button>
                  {!isDraftCollapsed ? (
                    <div className="buff-sheet-explorer-children">
                      {SKILL_KEYS.map((skillKey) => {
                        const skillCollapsedKey = `${entry.id}:${skillKey}`;
                        const isSkillCollapsed = Boolean(collapsedSkills[skillCollapsedKey]);
                        const effectRows = buildWeaponSheetRows(explorerDraft)
                          .filter((row): row is Extract<WeaponSheetRow, { kind: 'effect' }> => row.kind === 'effect')
                          .filter((row) => row.skillKey === skillKey);
                        const skillDragNode: WeaponExplorerDragNode = { kind: 'skill', draftId: entry.id, skillKey };
                        const skillDragKey = getExplorerDragNodeKey(skillDragNode);
                        return (
                          <div key={`${entry.id}-${skillKey}`} className="buff-sheet-explorer-node">
                            <button
                              type="button"
                              className={`buff-sheet-explorer-child${selectedLocalDraftId === entry.id && selectedSummaryKey === `skill-${skillKey}` ? ' is-active' : ''}${dragState?.source && getExplorerDragNodeKey(dragState.source) === skillDragKey ? ' is-drag-source' : ''}${dragState?.over && getExplorerDragNodeKey(dragState.over) === skillDragKey ? ' is-drag-target' : ''}${canStartExplorerDrag(skillDragNode) ? ' is-draggable' : ''}`}
                              data-weapon-drag-kind="skill"
                              data-weapon-draft-id={entry.id}
                              data-weapon-skill-key={skillKey}
                              onPointerDown={(event) => handleExplorerPointerDown(event, skillDragNode)}
                              onClick={() => {
                                if (suppressExplorerClickRef.current) {
                                  suppressExplorerClickRef.current = false;
                                  return;
                                }
                                handleLoadLocalDraft(entry.id);
                                setPendingFocusRowKey(`skill-${skillKey}`);
                              }}
                              onContextMenu={(event) => openContextMenu(event, {
                                x: event.clientX,
                                y: event.clientY,
                                target: 'skill',
                                draftId: entry.id,
                                skillKey,
                              })}
                            >
                              <span
                                className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSkillCollapsed(entry.id, skillKey, !isSkillCollapsed);
                                }}
                              >
                                {isSkillCollapsed ? '[+]' : '[-]'}
                              </span>
                              <span className="buff-sheet-explorer-label">{explorerDraft.skills[skillKey].name || skillKey}</span>
                            </button>
                            {!isSkillCollapsed ? (
                              <div className="buff-sheet-explorer-children">
                                {effectRows.map((row) => {
                                  const effectCollapsedKey = `${entry.id}:${skillKey}:${row.bucket}:${row.sourceEffectKey}`;
                                  const isEffectCollapsed = Boolean(collapsedLevels[effectCollapsedKey]);
                                  const effectDragNode: WeaponExplorerDragNode = { kind: 'effect', draftId: entry.id, skillKey, bucket: row.bucket, effectKey: row.sourceEffectKey };
                                  const effectDragKey = getExplorerDragNodeKey(effectDragNode);
                                  return (
                                    <div key={`${entry.id}-${row.key}`} className="buff-sheet-explorer-node">
                                      <button
                                        type="button"
                                        className={`buff-sheet-explorer-effect${selectedLocalDraftId === entry.id && selectedSummaryKey === row.key ? ' is-active' : ''}${dragState?.source && getExplorerDragNodeKey(dragState.source) === effectDragKey ? ' is-drag-source' : ''}${dragState?.over && getExplorerDragNodeKey(dragState.over) === effectDragKey ? ' is-drag-target' : ''}${canStartExplorerDrag(effectDragNode) ? ' is-draggable' : ''}`}
                                        data-weapon-drag-kind="effect"
                                        data-weapon-draft-id={entry.id}
                                        data-weapon-skill-key={skillKey}
                                        data-weapon-bucket={row.bucket}
                                        data-weapon-effect-key={row.sourceEffectKey}
                                        onPointerDown={(event) => handleExplorerPointerDown(event, effectDragNode)}
                                        onClick={() => {
                                          if (suppressExplorerClickRef.current) {
                                            suppressExplorerClickRef.current = false;
                                            return;
                                          }
                                          handleLoadLocalDraft(entry.id);
                                          setPendingFocusRowKey(row.key);
                                        }}
                                        onContextMenu={(event) => openContextMenu(event, {
                                          x: event.clientX,
                                          y: event.clientY,
                                          target: 'effect',
                                          draftId: entry.id,
                                          skillKey,
                                          effectKey: row.sourceEffectKey,
                                          bucket: row.bucket,
                                        })}
                                      >
                                        <span
                                          className="damage-sheet-row-toggle buff-sheet-explorer-toggle"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setLevelCollapsed(entry.id, skillKey, row.bucket, row.sourceEffectKey, !isEffectCollapsed);
                                          }}
                                        >
                                          {isEffectCollapsed ? '[+]' : '[-]'}
                                        </span>
                                        <span className="buff-sheet-explorer-label">{row.effectKey}</span>
                                        <span className="buff-sheet-explorer-count">Lv1~Lv9</span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {shareImportError ? <div className="buff-sheet-share-feedback is-error">{shareImportError}</div> : null}
        </aside>

        <section className="damage-sheet-excel-shell">
          <div
            className="damage-sheet-excel-scroll"
            onContextMenu={(event) => openWorkbookContextMenu(event)}
          >
            <div className="damage-sheet-excel-row is-header">
              <div className="damage-sheet-excel-row-number">#</div>
              <div className="damage-sheet-excel-row-cells">
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className={`damage-sheet-excel-cell is-header is-${column.align ?? 'left'}`}
                    style={{ width: `${column.width}px` }}
                  >
                    {column.title}
                  </div>
                ))}
              </div>
            </div>
            {workbookRows.map((row) => (
              <div
                key={row.key}
                className={getWeaponWorkbookRowClassName(row)}
                onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
              >
                <div
                  className="damage-sheet-excel-row-number"
                  onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow)}
                >
                  {renderRowNumberContent(row)}
                </div>
                <div className="damage-sheet-excel-row-cells">
                  {row.sourceRow.kind === 'growth' ? (
                    <div
                      className="damage-sheet-excel-cell is-growth is-left weapon-sheet-growth-merged-cell"
                      style={{ width: `${columns.reduce((sum, column) => sum + column.width, 0)}px` }}
                      onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                        address: `${columnIndexToLabel(0)}${row.rowNumber}`,
                        sourceRowKey: row.sourceRow.key,
                        columnKey: 'name',
                      })}
                    >
                      <div className="weapon-sheet-growth-inline-grid">
                        {ATTACK_GROWTH_MILESTONE_KEYS.map((levelKey) => (
                          <div key={levelKey} className="weapon-sheet-growth-inline-item">
                            <span className="weapon-sheet-growth-inline-label">{`Lv${levelKey}`}</span>
                            <input
                              className="weapon-sheet-inline-input"
                              type="number"
                              value={draft.attackGrowth[levelKey] == null ? '' : String(draft.attackGrowth[levelKey])}
                              placeholder="ATK"
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => handleAttackGrowthChange(levelKey, event.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : row.sourceRow.kind === 'effectLevels' ? (
                    <div
                      className="damage-sheet-excel-cell is-effectLevels is-left weapon-sheet-growth-merged-cell"
                      style={{ width: `${columns.reduce((sum, column) => sum + column.width, 0)}px` }}
                    >
                      <div className="weapon-sheet-growth-inline-grid weapon-sheet-levels-inline-grid">
                        {LEVEL_KEYS.map((levelKey) => {
                          const sourceRow = row.sourceRow as Extract<WeaponSheetRow, { kind: 'effectLevels' }>;
                          const levelData = draft.skills[sourceRow.skillKey].levels[levelKey];
                          const value = sourceRow.bucket === 'value'
                            ? levelData.value
                            : levelData[sourceRow.bucket][sourceRow.sourceEffectKey];
                          const inlineAddress = `Lv${levelKey}`;
                          const isInlineActive = selectedWorkbookCell?.sourceRowKey === sourceRow.key && selectedWorkbookCell.address === inlineAddress;
                          return (
                            <div key={levelKey} className={`weapon-sheet-growth-inline-item${isInlineActive ? ' is-active' : ''}`}>
                              <span className="weapon-sheet-growth-inline-label">{`Lv${levelKey}`}</span>
                              <input
                                className="weapon-sheet-inline-input"
                                type="number"
                                step="any"
                                inputMode="decimal"
                                value={value == null ? '' : String(value)}
                                placeholder=""
                                onFocus={() => {
                                  setSelectedWorkbookCell({
                                    address: inlineAddress,
                                    sourceRowKey: sourceRow.key,
                                    columnKey: 'valueText',
                                  });
                                }}
                                onChange={(event) => {
                                  const rawValue = event.target.value;
                                  setDraft((prev) => {
                                    const parsed = Number(rawValue);
                                    const nextLevels = { ...prev.skills[sourceRow.skillKey].levels };
                                    const nextLevel = { ...nextLevels[levelKey] };
                                    if (sourceRow.bucket === 'value') {
                                      nextLevel.value = rawValue.trim() && Number.isFinite(parsed) ? parsed : undefined;
                                    } else {
                                      const nextBucket = { ...nextLevel[sourceRow.bucket] };
                                      if (rawValue.trim() && Number.isFinite(parsed)) {
                                        nextBucket[sourceRow.sourceEffectKey] = parsed;
                                      } else {
                                        delete nextBucket[sourceRow.sourceEffectKey];
                                      }
                                      nextLevel[sourceRow.bucket] = nextBucket;
                                    }
                                    nextLevels[levelKey] = nextLevel;
                                    return {
                                      ...prev,
                                      skills: {
                                        ...prev.skills,
                                        [sourceRow.skillKey]: {
                                          ...prev.skills[sourceRow.skillKey],
                                          levels: nextLevels,
                                        },
                                      },
                                    };
                                  });
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : row.cells.map((cell) => {
                    const isSkillNameCell = row.sourceRow.kind === 'skill' && cell.columnKey === 'name';
                    if (isSkillNameCell) {
                      return (
                        <div
                          key={cell.key}
                          className={`damage-sheet-excel-cell is-${row.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                          style={{ width: `${cell.width}px` }}
                          onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                            address: cell.address,
                            sourceRowKey: cell.sourceRowKey,
                            columnKey: cell.columnKey,
                          })}
                        >
                          <input
                            className="weapon-sheet-inline-input"
                            type="text"
                            value={inlineEditingCellKey === cell.key ? inlineEditingValue : cell.value}
                            onFocus={() => {
                              setInlineEditingCellKey(cell.key);
                              setInlineEditingValue(cell.value);
                              setSelectedWorkbookCell({
                                address: cell.address,
                                sourceRowKey: cell.sourceRowKey,
                                columnKey: cell.columnKey,
                              });
                            }}
                            onChange={(event) => setInlineEditingValue(event.target.value)}
                            onBlur={() => {
                              if (inlineEditingCellKey === cell.key) {
                                const newName = inlineEditingValue.trim();
                                if (newName && row.sourceRow.kind === 'skill') {
                                  const skillKey = row.sourceRow.skillKey;
                                  setDraft((prev) => normalizeWeaponDraft({
                                    ...prev,
                                    skills: {
                                      ...prev.skills,
                                      [skillKey]: {
                                        ...prev.skills[skillKey],
                                        name: newName,
                                      },
                                    },
                                  }));
                                }
                                setInlineEditingCellKey(null);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.currentTarget.blur();
                              }
                              if (event.key === 'Escape') {
                                setInlineEditingCellKey(null);
                              }
                            }}
                          />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={cell.key}
                        className={`damage-sheet-excel-cell is-${row.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                        style={{ width: `${cell.width}px` }}
                        onClick={() => setSelectedWorkbookCell({
                          address: cell.address,
                          sourceRowKey: cell.sourceRowKey,
                          columnKey: cell.columnKey,
                        })}
                        onContextMenu={(event) => openWorkbookContextMenu(event, row.sourceRow, {
                          address: cell.address,
                          sourceRowKey: cell.sourceRowKey,
                          columnKey: cell.columnKey,
                        })}
                      >
                        {cell.value}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {isOverwriteDraftModalOpen ? (
        <div className="operator-draft-modal-overlay" onClick={() => setIsOverwriteDraftModalOpen(false)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认覆盖本地武器</h3>
                <p>当前 ID 已存在于本地武器库中。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <strong>{draft.name || draft.id || '未命名武器'}</strong>
              <p>保护开启时，确认后会用当前 Sheet-Weapon 编辑内容覆盖同 ID 武器。</p>
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

      {pendingImportShare ? (
        <div className="operator-draft-modal-overlay" onClick={() => setPendingImportShare(null)}>
          <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-draft-section-header">
              <div>
                <h3>确认导入武器库</h3>
                <p>会把分享文件中的武器合并进当前本地库。</p>
              </div>
            </div>
            <div className="operator-draft-confirm-body">
              <strong>{pendingImportShare.label}</strong>
              <p>{`将导入 ${Object.keys(pendingImportShare.payload).length} 把武器。`}</p>
            </div>
            <div className="operator-draft-modal-actions">
              <button type="button" className="operator-draft-ghost-button" onClick={() => setPendingImportShare(null)}>
                取消
              </button>
              <button type="button" className="operator-draft-copy-button" onClick={handleConfirmImportShare}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="buff-sheet-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {currentContextMenuActions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="buff-sheet-context-menu-item"
              onClick={() => {
                action.onClick();
                setContextMenu(null);
              }}
            >
              <span className="buff-sheet-context-menu-icon" aria-hidden="true">
                <svg className="buff-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">
                  {action.icon === 'new' && <path d="M8 3.25v9.5M3.25 8h9.5" />}
                  {action.icon === 'delete' && (
                    <>
                      <path d="M4.25 5.25h7.5" />
                      <path d="M6.25 2.75h3.5" />
                      <path d="M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5" />
                      <path d="M4.75 5.25l.5 7h5.5l.5-7" />
                    </>
                  )}
                  {action.icon === 'collapse' && (
                    <>
                      <path d="M3.25 5.25h9.5" />
                      <path d="M5.75 8h6.5" />
                      <path d="M8.25 10.75h4" />
                    </>
                  )}
                  {action.icon === 'expand' && (
                    <>
                      <path d="M3.25 5.25h9.5" />
                      <path d="M3.25 8h9.5" />
                      <path d="M3.25 10.75h9.5" />
                    </>
                  )}
                  {action.icon === 'open' && (
                    <>
                      <path d="M3.25 4.25h3l1.25 1.5h5.25v6.5H3.25z" />
                      <path d="M7.5 5.75h5.25" />
                    </>
                  )}
                </svg>
              </span>
              <span className="buff-sheet-context-menu-label">{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {dragState ? (
        <div
          className="buff-sheet-drag-preview"
          style={{ left: `${dragState.x + 8}px`, top: `${dragState.y + 10}px` }}
        >
          <div className="buff-sheet-drag-preview-title">{getExplorerDragNodeLabel(dragState.source)}</div>
          <div className={`buff-sheet-drag-preview-drop${dragState.over ? ' is-active' : ''}`}>
            {dragState.over
              ? `将放到该${formatWeaponExplorerDragKindLabel(dragState.over.kind)}位置：${getExplorerDragNodeLabel(dragState.over)}`
              : '移动到同层级目标上方后松开'}
          </div>
        </div>
      ) : null}
    </main>
  );
}
