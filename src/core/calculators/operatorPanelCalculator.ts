import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../domain/buff';

type AbilityName = '力量' | '敏捷' | '智识' | '意志';
type AbilityField = 'strength' | 'agility' | 'intelligence' | 'will';

export interface OperatorPanelAttributes {
  atk: number;
  hp: number;
  strength: number;
  agility: number;
  intelligence: number;
  will: number;
}

export interface OperatorPanelInput {
  operator: {
    id: string;
    name: string;
    level: number | string;
    potential: string;
    element?: string;
    mainStat?: string;
    subStat?: string;
    favorValue?: number;
    mainStatFlatBonus?: number;
    subStatFlatBonus?: number;
    skillConfig?: Record<string, string>;
    attributes: Partial<Record<string, OperatorPanelAttributes>>;
    buffs?: OperatorBuffInput;
  };
  weapon?: {
    id?: string;
    name?: string;
    config?: {
      level?: number | string;
      potential?: string;
      skillLevels?: {
        skill1?: number;
        skill2?: number;
        skill3?: number;
      };
    };
    data?: {
      attackGrowth?: Record<string, number>;
      skills?: {
        skill1?: WeaponSkillInput;
        skill2?: WeaponSkillInput;
        skill3?: WeaponSkillInput;
      };
    };
  };
  equipment?: {
    pieces?: EquipmentPieceInput[];
    setBuffs?: EquipmentSetBuffInput[];
  };
}

export type OperatorBuffGroupKey = 'talent' | 'potential' | 'skill';
export type OperatorBuffCategory = 'condition' | 'countable' | 'passive' | 'positive';
export type OperatorBuffValueMode = 'fixed' | 'derived';
export type OperatorBuffDerivedSource = 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';

export interface OperatorBuffDerivedValueInput {
  source: OperatorBuffDerivedSource;
  perPointValue: number;
}

export interface OperatorBuffEffectInput {
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
  derivedValue?: OperatorBuffDerivedValueInput;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
  multiplier?: BuffMultiplier;
}

export type OperatorBuffInput = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffectInput> }>;

export interface WeaponSkillInput {
  name?: string;
  statType?: string;
  levels?: Record<string, { value?: number; description?: string; passive?: Record<string, unknown> }>;
  effects?: Record<string, {
    schemaVersion?: 2;
    effectId?: string;
    name?: string;
    type?: string;
    category?: string;
    levels?: Record<string, number>;
    valueMode?: OperatorBuffValueMode;
    derivedValue?: OperatorBuffDerivedValueInput;
    maxStacks?: number;
    multiplier?: BuffMultiplier;
    effectKind?: BuffEffectKind;
    extraHitConfig?: BuffExtraHitConfig;
  }>;
}

export interface EquipmentPieceInput {
  slotKey: string;
  equipmentId: string;
  name: string;
  part?: string;
  imgUrl?: string;
  fixedStat?: unknown;
  effects: EquipmentEffectInput[];
}

export interface EquipmentEffectInput {
  effectId: string;
  label: string;
  typeKey: string;
  level: number | string;
  value: number;
  unit?: 'flat' | 'percent' | string;
  raw?: string;
  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValueInput;
  maxStacks?: number;
  multiplier?: BuffMultiplier;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

export interface EquipmentSetBuffInput extends EquipmentEffectInput {
  gearSetId: string;
  gearSetName: string;
  category?: 'positive' | 'passive' | 'condition' | string;
}

export interface ConfigSnapshot {
  panel: {
    calc: PanelCalcSnapshot;
    display: PanelDisplaySnapshot;
  };
  operator: {
    id: string;
    name: string;
    level: number | string;
    potential: string;
    potentialCount: number;
    element: string;
    mainStat: string;
    subStat: string;
    mainStatFlatBonus: number;
    subStatFlatBonus: number;
    skillConfig: Record<string, string>;
    baseAttributes: OperatorPanelAttributes;
    buffs: OperatorBuffInput;
  };
  weapon: WeaponSnapshot;
  equipment: EquipmentSnapshot;
  buff: {
    operator: string[];
    weapon: string[];
    equipment: string[];
  };
  detailMarkdown: string;
}

export interface PanelCalcSnapshot {
  strength: number;
  agility: number;
  intelligence: number;
  will: number;
  operatorAtk: number;
  weaponAtk: number;
  operatorHp: number;
  mainStatFlatBonus: number;
  subStatFlatBonus: number;
  mainStatBoost: number;
  subStatBoost: number;
  allStatBoost: number;
  atkPercentBoost: number;
  flatAtk: number;
  hpPercent: number;
  critRateBoost: number;
  critDmgBonusBoost: number;
  sourceSkillBoost: number;
  healingBonus: number;
  receivedHealingBonus: number;
  chainCooldownReduction: number;
  ultimateChargeEfficiency: number;
  imbalanceEfficiency: number;
  damageReduction: number;
  damageBonus: DamageBonusSnapshot;
}

export interface PanelDisplaySnapshot {
  atk: number;
  hp: number;
  baseAtk: number;
  abilityBonus: number;
  mainStatFinal: number;
  subStatFinal: number;
  abilityValues: Record<AbilityField, number>;
  weaponAtkPercent: number;
  critRate: number;
  critDmg: number;
  sourceSkill: number;
  attackDetail: {
    rawAtk: number;
    atkPercent: number;
    flatAtk: number;
    baseAtk: number;
    panelAtk: number;
  };
  abilityDetail: {
    rawMainStat: number;
    rawSubStat: number;
    mainStatScale: number;
    subStatScale: number;
    allStatScale: number;
    mainStatBeforeRounding: number;
    subStatBeforeRounding: number;
    mainAtkBonus: number;
    subAtkBonus: number;
  };
  groups: DisplayGroup[];
  damageBonus: DamageBonusSnapshot;
}

export interface DisplayGroup {
  title: string;
  items: Array<{ label: string; value: string }>;
}

export interface DamageBonusSnapshot {
  physicalDmgBonus: number;
  fireDmgBonus: number;
  electricDmgBonus: number;
  iceDmgBonus: number;
  natureDmgBonus: number;
  magicDmgBonus: number;
  normalAttackDmgBonus: number;
  dotDmgBonus: number;
  skillDmgBonus: number;
  chainSkillDmgBonus: number;
  ultimateDmgBonus: number;
  allSkillDmgBonus: number;
  imbalanceDmgBonus: number;
  allDmgBonus: number;
}

export interface WeaponSnapshot {
  id: string;
  name: string;
  config: {
    level: number | string;
    potential: string;
    potentialCount: number;
    skillLevels: {
      skill1: number;
      skill2: number;
      skill3: number;
    };
  };
  attack: number;
  skills: {
    skill1?: WeaponSkillDetail;
    skill2?: WeaponSkillDetail;
    skill3: {
      effects: WeaponSkillDetail[];
    };
  };
  totals: Record<string, number>;
}

export interface WeaponSkillDetail {
  skillKey: string;
  effectKey?: string;
  label: string;
  typeKey: string;
  category?: string;
  level: number;
  value: number;
  raw?: unknown;
  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValueInput;
  maxStacks?: number;
  multiplier?: BuffMultiplier;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

export interface EquipmentSnapshot {
  pieces: Array<{
    slotKey: string;
    equipmentId: string;
    name: string;
    part: string;
    imgUrl?: string;
    fixedStat?: unknown;
    effects: EquipmentEffectInput[];
  }>;
  setBuffs: EquipmentSetBuffInput[];
  totals: Record<string, number>;
}

const EMPTY_ATTRIBUTES: OperatorPanelAttributes = {
  atk: 0,
  hp: 0,
  strength: 0,
  agility: 0,
  intelligence: 0,
  will: 0,
};

const ABILITY_NAME_TO_FIELD: Record<AbilityName, AbilityField> = {
  力量: 'strength',
  敏捷: 'agility',
  智识: 'intelligence',
  意志: 'will',
};

const WEAPON_SKILL1_TYPE_MAP: Record<string, string> = {
  敏捷提升: 'agilityBoost',
  力量提升: 'strengthBoost',
  意志提升: 'willBoost',
  智识提升: 'intelligenceBoost',
  主能力提升: 'mainStat',
  副能力提升: 'subStat',
  mainStatBoost: 'mainStat',
  subStatBoost: 'subStat',
};

const WEAPON_SKILL2_TYPE_MAP: Record<string, string> = {
  攻击提升: 'atkPercentBoost',
  生命提升: 'hpPercent',
  物理伤害提升: 'physicalDmgBonus',
  灼热伤害提升: 'fireDmgBonus',
  电磁伤害提升: 'electricDmgBonus',
  寒冷伤害提升: 'iceDmgBonus',
  自然伤害提升: 'natureDmgBonus',
  暴击率提升: 'critRateBoost',
  暴击伤害提升: 'critDmgBonusBoost',
  源石技艺提升: 'sourceSkillBoost',
  终结技充能效率提升: 'ultimateChargeEfficiency',
  法术伤害提升: 'magicDmgBonus',
  治疗效率提升: 'healingBonus',
};

const WEAPON_SKILL3_TYPE_MAP: Record<string, string> = {
  主能力提升: 'mainStatBoost',
  副能力提升: 'subStatBoost',
};

const WEAPON_TOTAL_FIELDS = new Set([
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'mainStat',
  'subStat',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'atkPercentBoost',
  'atk',
  'hpPercent',
  'critRateBoost',
  'critDmgBonusBoost',
  'sourceSkillBoost',
  'ultimateChargeEfficiency',
  'healingBonus',
  'physicalDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'magicDmgBonus',
  'iceElectricDmgBonus',
  'fireNatureDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'allSkillDmgBonus',
  'imbalanceDmgBonus',
  'allDmgBonus',
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
]);

const EQUIPMENT_TOTAL_FIELDS = new Set([
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
  'mainStat',
  'subStat',
  'atkPercentBoost',
  'sourceSkillBoost',
  'ultimateChargeEfficiency',
  'chainSkillDmgBonus',
  'mainStatBoost',
  'damageReduction',
  'hpPercent',
  'healingBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'ultimateDmgBonus',
  'magicDmgBonus',
  'subStatBoost',
  'critRateBoost',
  'critDmgBonusBoost',
  'physicalDmgBonus',
  'skillDmgBonus',
  'imbalanceDmgBonus',
  'iceElectricDmgBonus',
  'allSkillDmgBonus',
  'fireNatureDmgBonus',
  'allDmgBonus',
]);

function getLastEquipmentEffectId(effects: EquipmentEffectInput[]): string | undefined {
  const effectIds = ['effect3', 'effect2', 'effect1'];
  return effectIds.find((effectId) => effects.some((effect) => effect.effectId === effectId))
    ?? effects[effects.length - 1]?.effectId;
}

function normalizeEquipmentEffectTypeKey(effect: EquipmentEffectInput, lastEffectId: string | undefined): string {
  const typeKey = normalizeTypeKey(effect.typeKey);
  // 非最后一条的主/副能力是固定值，语义与武器 skill1 相同；实际最后一个存在的词条才是百分比。
  if (effect.effectId !== lastEffectId && typeKey === 'mainStatBoost') return 'mainStat';
  if (effect.effectId !== lastEffectId && typeKey === 'subStatBoost') return 'subStat';
  return typeKey;
}

const OPERATOR_TOTAL_FIELDS = new Set([
  ...WEAPON_TOTAL_FIELDS,
  ...EQUIPMENT_TOTAL_FIELDS,
]);

const PERCENT_FIELDS = new Set([
  'atkPercentBoost',
  'hpPercent',
  'critRateBoost',
  'critDmgBonusBoost',
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'ultimateChargeEfficiency',
  'healingBonus',
  'receivedHealingBonus',
  'chainCooldownReduction',
  'imbalanceEfficiency',
  'damageReduction',
  'physicalDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'magicDmgBonus',
  'iceElectricDmgBonus',
  'fireNatureDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'allSkillDmgBonus',
  'imbalanceDmgBonus',
  'allDmgBonus',
]);

const DAMAGE_BONUS_FIELDS = [
  'physicalDmgBonus',
  'fireDmgBonus',
  'electricDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'magicDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'allSkillDmgBonus',
  'imbalanceDmgBonus',
  'allDmgBonus',
] as const satisfies ReadonlyArray<keyof DamageBonusSnapshot>;

const OPERATOR_BUFF_GROUP_LABELS: Record<OperatorBuffGroupKey, string> = {
  talent: '天赋',
  potential: '潜能',
  skill: '技能',
};

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
const OPERATOR_BUFF_DERIVED_SOURCE_LABELS: Record<OperatorBuffDerivedSource, string> = {
  hp: '生命值',
  atk: '攻击力',
  strength: '力量',
  agility: '敏捷',
  intelligence: '智识',
  will: '意志',
  sourceSkill: '源石技艺强度',
};

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function normalizeTypeKey(typeKey: string): string {
  if (typeKey === 'flatAtk') return 'atk';
  if (typeKey === 'hp') return 'hpPercent';
  if (typeKey === 'critDmgBonus') return 'critDmgBonusBoost';
  if (typeKey === 'allElementDmgBonus') return 'magicDmgBonus';
  if (typeKey === 'atkPercent') return 'atkPercentBoost';
  if (typeKey === 'memoryStrength') return 'sourceSkillBoost';
  return typeKey;
}

function normalizeValue(typeKey: string, value: number, _unit?: string): number {
  if (typeKey === 'sourceSkillBoost') {
    return value;
  }
  return value;
}

function addTotal(totals: Record<string, number>, typeKey: string, value: number, unit?: string): void {
  const normalizedTypeKey = normalizeTypeKey(typeKey);
  const normalizedValue = normalizeValue(normalizedTypeKey, value, unit);
  totals[normalizedTypeKey] = round((totals[normalizedTypeKey] ?? 0) + normalizedValue);
}

function getLevelKey(level: number | string): string {
  const numeric = typeof level === 'number' ? level : Number(level);
  if (numeric >= 90) return 'level90';
  if (numeric >= 80) return 'level80';
  if (numeric >= 60) return 'level60';
  if (numeric >= 40) return 'level40';
  if (numeric >= 20) return 'level20';
  return 'level1';
}

function resolveAttributes(input: OperatorPanelInput['operator']): OperatorPanelAttributes {
  return input.attributes[getLevelKey(input.level)] ?? input.attributes.level90 ?? input.attributes.level1 ?? EMPTY_ATTRIBUTES;
}

function resolveAbilityField(name?: string): AbilityField | null {
  return name && name in ABILITY_NAME_TO_FIELD ? ABILITY_NAME_TO_FIELD[name as AbilityName] : null;
}

function createEmptyDamageBonus(): DamageBonusSnapshot {
  return {
    physicalDmgBonus: 0,
    fireDmgBonus: 0,
    electricDmgBonus: 0,
    iceDmgBonus: 0,
    natureDmgBonus: 0,
    magicDmgBonus: 0,
    normalAttackDmgBonus: 0,
    dotDmgBonus: 0,
    skillDmgBonus: 0,
    chainSkillDmgBonus: 0,
    ultimateDmgBonus: 0,
    allSkillDmgBonus: 0,
    imbalanceDmgBonus: 0,
    allDmgBonus: 0,
  };
}

function parsePotentialToCount(potential: string): number {
  if (potential.trim() === '满潜') {
    return 6;
  }
  const numeric = Number.parseInt(potential, 10);
  if (Number.isNaN(numeric)) {
    return 1;
  }
  return Math.min(6, Math.max(1, numeric + 1));
}

const CHINESE_POTENTIAL_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

function getRequiredPotentialCount(buffName: string): number | null {
  const normalizedName = buffName.replace(/\s+/g, '');
  const suffixMatch = normalizedName.match(/潜能([1-6一二三四五六])/);
  const prefixMatch = normalizedName.match(/([1-6一二三四五六])潜/);
  const token = suffixMatch?.[1] ?? prefixMatch?.[1];
  if (!token) return null;
  return CHINESE_POTENTIAL_NUMBERS[token] ?? Number(token);
}

function filterOperatorBuffsByPotential(
  buffs: OperatorBuffInput,
  potentialCount: number
): OperatorBuffInput {
  return {
    ...buffs,
    potential: {
      effects: Object.fromEntries(
        Object.entries(buffs.potential?.effects || {}).filter(([, effect]) => {
          if (effect.category !== 'passive') return true;
          const requiredPotentialCount = getRequiredPotentialCount(effect.name || effect.effectId);
          return requiredPotentialCount === null || potentialCount > requiredPotentialCount;
        })
      ),
    },
  };
}

function createDamageBonusFromTotals(...totalsList: Array<Record<string, number>>): DamageBonusSnapshot {
  const damageBonus = createEmptyDamageBonus();
  totalsList.forEach((totals) => {
    DAMAGE_BONUS_FIELDS.forEach((field) => {
      damageBonus[field] = round(damageBonus[field] + (totals[field] ?? 0));
    });
    const iceElectricDmgBonus = totals.iceElectricDmgBonus ?? 0;
    if (iceElectricDmgBonus !== 0) {
      damageBonus.iceDmgBonus = round(damageBonus.iceDmgBonus + iceElectricDmgBonus);
      damageBonus.electricDmgBonus = round(damageBonus.electricDmgBonus + iceElectricDmgBonus);
    }
    const fireNatureDmgBonus = totals.fireNatureDmgBonus ?? 0;
    if (fireNatureDmgBonus !== 0) {
      damageBonus.fireDmgBonus = round(damageBonus.fireDmgBonus + fireNatureDmgBonus);
      damageBonus.natureDmgBonus = round(damageBonus.natureDmgBonus + fireNatureDmgBonus);
    }
  });
  return damageBonus;
}

function buildWeaponSnapshot(input: OperatorPanelInput['weapon']): WeaponSnapshot {
  const potential = input?.config?.potential ?? '0潜';
  const config = {
    level: input?.config?.level ?? 90,
    potential,
    potentialCount: parsePotentialToCount(potential),
    skillLevels: {
      skill1: input?.config?.skillLevels?.skill1 ?? 9,
      skill2: input?.config?.skillLevels?.skill2 ?? 9,
      skill3: input?.config?.skillLevels?.skill3 ?? 4,
    },
  };
  const attack = input?.data?.attackGrowth?.[String(config.level)] ?? input?.data?.attackGrowth?.['90'] ?? 0;
  const totals: Record<string, number> = {};
  const skills = input?.data?.skills ?? {};
  const skill1 = buildWeaponSkillDetail('skill1', skills.skill1, config.skillLevels.skill1, WEAPON_SKILL1_TYPE_MAP);
  if (skill1) {
    addTotal(totals, skill1.typeKey, skill1.value);
  }
  const skill2 = buildWeaponSkillDetail('skill2', skills.skill2, config.skillLevels.skill2, WEAPON_SKILL2_TYPE_MAP);
  if (skill2) {
    addTotal(totals, skill2.typeKey, skill2.value);
  }
  const skill3Effects = Object.entries(skills.skill3?.effects ?? {}).reduce<WeaponSkillDetail[]>((acc, [effectKey, effect]) => {
    const value = effect.levels?.[String(config.skillLevels.skill3)];
    if (typeof value !== 'number') return acc;
    const typeKey = normalizeTypeKey(WEAPON_SKILL3_TYPE_MAP[effect.type ?? effectKey] ?? effect.type ?? effectKey);
    const detail: WeaponSkillDetail = {
      skillKey: 'skill3',
      effectKey,
      label: effect.name ?? effectKey,
      typeKey,
      category: effect.category,
      level: config.skillLevels.skill3,
      value: normalizeValue(typeKey, value),
      raw: effect,
      valueMode: effect.valueMode,
      ...(effect.valueMode === 'derived'
        ? { derivedValue: { source: effect.derivedValue?.source ?? 'intelligence', perPointValue: value } }
        : {}),
      ...(effect.category === 'countable' && typeof effect.maxStacks === 'number'
        ? { maxStacks: Math.max(1, Math.floor(effect.maxStacks)) }
        : {}),
      ...(effect.multiplier
        ? { multiplier: { coefficient: value } }
        : {}),
      effectKind: effect.effectKind === 'extraHit' ? 'extraHit' : 'modifier',
      ...(effect.effectKind === 'extraHit' && effect.extraHitConfig
        ? { extraHitConfig: { ...effect.extraHitConfig, baseMultiplier: value } }
        : {}),
    };
    acc.push(detail);
    if (effect.effectKind !== 'extraHit' && effect.category === 'passive' && WEAPON_TOTAL_FIELDS.has(typeKey)) {
      addTotal(totals, typeKey, value);
    }
    return acc;
  }, []);

  return {
    id: input?.id ?? '',
    name: input?.name ?? input?.id ?? '',
    config,
    attack,
    skills: {
      ...(skill1 ? { skill1 } : {}),
      ...(skill2 ? { skill2 } : {}),
      skill3: {
        effects: skill3Effects,
      },
    },
    totals,
  };
}

function buildWeaponSkillDetail(
  skillKey: 'skill1' | 'skill2',
  skill: WeaponSkillInput | undefined,
  level: number,
  typeMap: Record<string, string>
): WeaponSkillDetail | undefined {
  if (!skill) return undefined;
  const levelData = skill.levels?.[String(level)];
  if (typeof levelData?.value !== 'number') return undefined;
  const rawType = skill.statType ?? '';
  const typeKey = normalizeTypeKey(typeMap[rawType] ?? rawType);
  return {
    skillKey,
    label: skill.name ?? rawType,
    typeKey,
    level,
    value: normalizeValue(typeKey, levelData.value),
    raw: skill,
  };
}

function buildEquipmentSnapshot(input: OperatorPanelInput['equipment']): EquipmentSnapshot {
  const totals: Record<string, number> = {};
  const pieces = (input?.pieces ?? []).map((piece) => {
    const lastEffectId = getLastEquipmentEffectId(piece.effects);
    piece.effects.forEach((effect) => {
      const typeKey = normalizeEquipmentEffectTypeKey(effect, lastEffectId);
      if (EQUIPMENT_TOTAL_FIELDS.has(typeKey)) {
        addTotal(totals, typeKey, effect.value, effect.unit);
      }
    });
    return {
      slotKey: piece.slotKey,
      equipmentId: piece.equipmentId,
      name: piece.name,
      part: piece.part ?? '',
      imgUrl: piece.imgUrl,
      fixedStat: piece.fixedStat,
      effects: piece.effects,
    };
  });
  const setBuffs = input?.setBuffs ?? [];
  setBuffs.forEach((buff) => {
    const typeKey = normalizeTypeKey(buff.typeKey);
    if (buff.effectKind !== 'extraHit' && (buff.category === 'positive' || buff.category === 'passive') && EQUIPMENT_TOTAL_FIELDS.has(typeKey)) {
      addTotal(totals, typeKey, buff.value, buff.unit);
    }
  });
  return { pieces, setBuffs, totals };
}

function createEmptyOperatorBuffs(): OperatorBuffInput {
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

function getOperatorBuffEntries(buffs: OperatorBuffInput | undefined): Array<{
  groupKey: OperatorBuffGroupKey;
  effectKey: string;
  effect: OperatorBuffEffectInput;
}> {
  const source = buffs ?? createEmptyOperatorBuffs();
  return (['talent', 'potential', 'skill'] as const).flatMap((groupKey) => (
    Object.entries(source[groupKey]?.effects || {}).map(([effectKey, effect]) => ({ groupKey, effectKey, effect }))
  ));
}

function buildOperatorBuffTotals(buffs: OperatorBuffInput | undefined): Record<string, number> {
  const totals: Record<string, number> = {};
  getOperatorBuffEntries(buffs).forEach(({ effect }) => {
    const typeKey = normalizeTypeKey(effect.type || '');
    if (effect.effectKind === 'extraHit' || effect.multiplier || !['positive', 'passive'].includes(effect.category) || effect.valueMode === 'derived' || !typeKey || !OPERATOR_TOTAL_FIELDS.has(typeKey)) return;
    if (typeof effect.value !== 'number' || !Number.isFinite(effect.value)) return;
    addTotal(totals, typeKey, effect.value, effect.unit);
  });
  return totals;
}

function readDerivedSourceValue(source: OperatorBuffDerivedSource, display: PanelDisplaySnapshot): number | null {
  if (source === 'hp') return display.hp;
  if (source === 'atk') return display.atk;
  if (source === 'sourceSkill') return display.sourceSkill;
  return display.abilityValues[source] ?? null;
}

function calculateDerivedBuffValue(effect: OperatorBuffEffectInput, display: PanelDisplaySnapshot): number | null {
  if (effect.multiplier || effect.valueMode !== 'derived' || !effect.derivedValue) return null;
  const { source, perPointValue } = effect.derivedValue;
  if (typeof perPointValue !== 'number' || !Number.isFinite(perPointValue)) return null;
  const sourceValue = readDerivedSourceValue(source, display);
  if (typeof sourceValue !== 'number' || !Number.isFinite(sourceValue)) return null;
  return sourceValue * perPointValue;
}

function buildDerivedOperatorBuffTotals(buffs: OperatorBuffInput | undefined, display: PanelDisplaySnapshot): Record<string, number> {
  const totals: Record<string, number> = {};
  getOperatorBuffEntries(buffs).forEach(({ effect }) => {
    const typeKey = normalizeTypeKey(effect.type || '');
    if (effect.effectKind === 'extraHit' || effect.multiplier || !['positive', 'passive'].includes(effect.category) || effect.valueMode !== 'derived' || !typeKey || !OPERATOR_TOTAL_FIELDS.has(typeKey)) return;
    const derivedValue = calculateDerivedBuffValue(effect, display);
    if (derivedValue === null) return;
    addTotal(totals, typeKey, derivedValue, effect.unit);
  });
  return totals;
}

function addTotals(left: Record<string, number>, right: Record<string, number>): Record<string, number> {
  const merged = { ...left };
  Object.entries(right).forEach(([key, value]) => {
    merged[key] = (merged[key] ?? 0) + value;
  });
  return merged;
}

function attachDerivedOperatorBuffValues(buffs: OperatorBuffInput, display: PanelDisplaySnapshot): OperatorBuffInput {
  return Object.fromEntries(
    (['talent', 'potential', 'skill'] as const).map((groupKey) => [
      groupKey,
      {
        effects: Object.fromEntries(
          Object.entries(buffs[groupKey]?.effects || {}).map(([effectKey, effect]) => {
            const derivedValue = calculateDerivedBuffValue(effect, display);
            return [
              effectKey,
              derivedValue === null
                ? effect
                : {
                  ...effect,
                  value: derivedValue,
                },
            ];
          })
        ),
      },
    ])
  ) as OperatorBuffInput;
}

function buildDisplayDamageBonus(damageBonus: DamageBonusSnapshot): DamageBonusSnapshot {
  return {
    ...damageBonus,
    physicalDmgBonus: round(damageBonus.physicalDmgBonus + damageBonus.allDmgBonus),
    fireDmgBonus: round(damageBonus.fireDmgBonus + damageBonus.magicDmgBonus + damageBonus.allDmgBonus),
    electricDmgBonus: round(damageBonus.electricDmgBonus + damageBonus.magicDmgBonus + damageBonus.allDmgBonus),
    iceDmgBonus: round(damageBonus.iceDmgBonus + damageBonus.magicDmgBonus + damageBonus.allDmgBonus),
    natureDmgBonus: round(damageBonus.natureDmgBonus + damageBonus.magicDmgBonus + damageBonus.allDmgBonus),
    skillDmgBonus: round(damageBonus.skillDmgBonus + damageBonus.allSkillDmgBonus),
    chainSkillDmgBonus: round(damageBonus.chainSkillDmgBonus + damageBonus.allSkillDmgBonus),
    ultimateDmgBonus: round(damageBonus.ultimateDmgBonus + damageBonus.allSkillDmgBonus),
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPerPointValue(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function formatPercent(value: number): string {
  return `${round(value * 100, 2)}%`;
}

function formatOperatorBuffValue(effect: OperatorBuffEffectInput): string {
  if (typeof effect.value !== 'number' || !Number.isFinite(effect.value)) {
    return '-';
  }
  const typeKey = normalizeTypeKey(effect.type || '');
  if (typeKey === 'sourceSkillBoost') {
    return formatNumber(effect.value);
  }
  if (effect.unit === 'percent' || PERCENT_FIELDS.has(typeKey)) {
    return formatPercent(normalizeValue(typeKey, effect.value, effect.unit));
  }
  return formatNumber(effect.value);
}

function formatEquipmentEffectValue(effect: EquipmentPieceInput['effects'][number]): string {
  if (effect.unit === 'percent' && effect.typeKey !== 'sourceSkillBoost') {
    return formatPercent(normalizeValue(effect.typeKey, effect.value, effect.unit));
  }
  return `${formatNumber(effect.value)}${effect.unit === 'percent' ? '%' : ''}`;
}

function formatOperatorBuffLine(groupKey: OperatorBuffGroupKey, effectKey: string, effect: OperatorBuffEffectInput): string {
  const typeKey = normalizeTypeKey(effect.type || '');
  const typeLabel = OPERATOR_BUFF_TYPE_LABELS[typeKey] ?? (typeKey || '未设置类型');
  const categoryLabel = effect.category === 'condition' ? '条件' : '已结算';
  const description = effect.description || effect.raw;
  const descriptionText = description ? ` · ${description}` : '';
  const derivedText = effect.valueMode === 'derived' && effect.derivedValue
    ? ` · ${OPERATOR_BUFF_DERIVED_SOURCE_LABELS[effect.derivedValue.source]} 每点提升 ${formatPerPointValue(effect.derivedValue.perPointValue)}`
    : '';
  return `- [${OPERATOR_BUFF_GROUP_LABELS[groupKey]}] ${effect.name || effectKey}: ${typeLabel} (${typeKey || '-'}) +${formatOperatorBuffValue(effect)}（${categoryLabel}）${derivedText}${descriptionText}`;
}

function buildDisplay(calc: PanelCalcSnapshot, mainStat: string, subStat: string): PanelDisplaySnapshot {
  const mainField = resolveAbilityField(mainStat);
  const subField = resolveAbilityField(subStat);
  const rawMainStat = mainField ? calc[mainField] : 0;
  const rawSubStat = subField ? calc[subField] : 0;
  const mainStatBeforeRounding = rawMainStat * (1 + calc.mainStatBoost) * (1 + calc.allStatBoost);
  const subStatBeforeRounding = rawSubStat * (1 + calc.subStatBoost) * (1 + calc.allStatBoost);
  const mainStatFinal = Math.round(mainStatBeforeRounding);
  const subStatFinal = Math.round(subStatBeforeRounding);
  const abilityValues: Record<AbilityField, number> = {
    strength: calc.strength,
    agility: calc.agility,
    intelligence: calc.intelligence,
    will: calc.will,
  };
  if (mainField) abilityValues[mainField] = mainStatFinal;
  if (subField) abilityValues[subField] = subStatFinal;
  const mainAtkBonus = mainStatFinal * 0.005;
  const subAtkBonus = subStatFinal * 0.002;
  const abilityBonus = mainAtkBonus + subAtkBonus;
  const rawAtk = calc.operatorAtk + calc.weaponAtk;
  const baseAtk = rawAtk * (1 + calc.atkPercentBoost) + calc.flatAtk;
  const atk = baseAtk * (1 + abilityBonus);
  const hp = calc.operatorHp * (1 + calc.hpPercent);
  const critRate = 0.05 + calc.critRateBoost;
  const critDmg = 0.5 + calc.critDmgBonusBoost;
  const sourceSkill = calc.sourceSkillBoost;
  const damageBonus = buildDisplayDamageBonus(calc.damageBonus);
  const groups: DisplayGroup[] = [
    {
      title: '基础',
      items: [
        { label: '生命值', value: formatNumber(hp) },
        { label: '攻击力', value: formatNumber(atk) },
        { label: '防御力', value: '暂无' },
      ],
    },
    {
      title: '主副能力',
      items: [
        { label: '主能力', value: `${mainStat || '-'} ${formatNumber(mainStatFinal)}` },
        { label: '副能力', value: `${subStat || '-'} ${formatNumber(subStatFinal)}` },
      ],
    },
    {
      title: '四维能力',
      items: [
        { label: '力量', value: formatNumber(abilityValues.strength) },
        { label: '敏捷', value: formatNumber(abilityValues.agility) },
        { label: '智识', value: formatNumber(abilityValues.intelligence) },
        { label: '意志', value: formatNumber(abilityValues.will) },
      ],
    },
    {
      title: '暴击与技艺',
      items: [
        { label: '暴击率', value: formatPercent(critRate) },
        { label: '暴击伤害', value: formatPercent(critDmg) },
        { label: '源石技艺强度', value: formatNumber(sourceSkill) },
      ],
    },
    {
      title: '效率',
      items: [
        { label: '治疗效率加成', value: formatPercent(calc.healingBonus) },
        { label: '受治疗效率加成', value: '暂无' },
        { label: '连携技冷却缩减', value: '暂无' },
        { label: '终结技充能效率', value: formatPercent(calc.ultimateChargeEfficiency) },
        { label: '失衡效率加成', value: '暂无' },
      ],
    },
    {
      title: '元素伤害',
      items: [
        { label: '物理伤害加成', value: formatPercent(damageBonus.physicalDmgBonus) },
        { label: '灼热伤害加成', value: formatPercent(damageBonus.fireDmgBonus) },
        { label: '电磁伤害加成', value: formatPercent(damageBonus.electricDmgBonus) },
        { label: '寒冷伤害加成', value: formatPercent(damageBonus.iceDmgBonus) },
        { label: '自然伤害加成', value: formatPercent(damageBonus.natureDmgBonus) },
      ],
    },
    {
      title: '技能伤害',
      items: [
        { label: '普通攻击伤害加成', value: formatPercent(damageBonus.normalAttackDmgBonus) },
        { label: '持续伤害加成', value: formatPercent(damageBonus.dotDmgBonus) },
        { label: '战技伤害加成', value: formatPercent(damageBonus.skillDmgBonus) },
        { label: '连携技伤害加成', value: formatPercent(damageBonus.chainSkillDmgBonus) },
        { label: '终结技伤害加成', value: formatPercent(damageBonus.ultimateDmgBonus) },
      ],
    },
    {
      title: '特殊伤害',
      items: [
        { label: '对失衡目标伤害加成', value: formatPercent(damageBonus.imbalanceDmgBonus) },
      ],
    },
  ];
  return {
    atk: round(atk),
    hp: round(hp),
    baseAtk: round(baseAtk),
    abilityBonus: round(abilityBonus),
    mainStatFinal: round(mainStatFinal),
    subStatFinal: round(subStatFinal),
    abilityValues: {
      strength: round(abilityValues.strength),
      agility: round(abilityValues.agility),
      intelligence: round(abilityValues.intelligence),
      will: round(abilityValues.will),
    },
    weaponAtkPercent: round(calc.atkPercentBoost * 100),
    critRate: round(critRate),
    critDmg: round(critDmg),
    sourceSkill: round(sourceSkill),
    attackDetail: {
      rawAtk: round(rawAtk),
      atkPercent: round(calc.atkPercentBoost),
      flatAtk: round(calc.flatAtk),
      baseAtk: round(baseAtk),
      panelAtk: round(atk),
    },
    abilityDetail: {
      rawMainStat: round(rawMainStat),
      rawSubStat: round(rawSubStat),
      mainStatScale: round(calc.mainStatBoost),
      subStatScale: round(calc.subStatBoost),
      allStatScale: round(calc.allStatBoost),
      mainStatBeforeRounding: round(mainStatBeforeRounding),
      subStatBeforeRounding: round(subStatBeforeRounding),
      mainAtkBonus: round(mainAtkBonus),
      subAtkBonus: round(subAtkBonus),
    },
    groups,
    damageBonus,
  };
}

function buildMarkdown(snapshot: Omit<ConfigSnapshot, 'detailMarkdown'>): string {
  const lines: string[] = [
    `# ${snapshot.operator.name || '未选择干员'} 面板数据`,
    '',
    `- 干员面板: ${snapshot.operator.name || '-'} Lv.${snapshot.operator.level}`,
    `- 武器: ${snapshot.weapon.name || '未选择武器'} Lv.${snapshot.weapon.config.level}`,
    '',
  ];
  snapshot.panel.display.groups.forEach((group) => {
    lines.push(`## ${group.title}`);
    group.items.forEach((item) => {
      lines.push(`- ${item.label}: ${item.value}`);
    });
    lines.push('');
  });
  lines.push('## 攻击力计算');
  lines.push(`- 基础攻击 = ${formatNumber(snapshot.panel.calc.operatorAtk)} + ${formatNumber(snapshot.panel.calc.weaponAtk)}`);
  lines.push(`- 百分比加成 = ${formatPercent(snapshot.panel.display.attackDetail.atkPercent)}`);
  lines.push(`- 最终基础 = ${formatNumber(snapshot.panel.display.baseAtk)}`);
  lines.push(`- 面板攻击 = ${formatNumber(snapshot.panel.display.atk)}`);
  lines.push('');
  lines.push('## 干员能力值');
  lines.push(`- 力量: ${formatNumber(snapshot.operator.baseAttributes.strength)}`);
  lines.push(`- 敏捷: ${formatNumber(snapshot.operator.baseAttributes.agility)}`);
  lines.push(`- 智识: ${formatNumber(snapshot.operator.baseAttributes.intelligence)}`);
  lines.push(`- 意志: ${formatNumber(snapshot.operator.baseAttributes.will)}`);
  lines.push('');
  lines.push('## 面板能力值（计算后）');
  lines.push(`- 力量: ${formatNumber(snapshot.panel.calc.strength)}`);
  lines.push(`- 敏捷: ${formatNumber(snapshot.panel.calc.agility)}`);
  lines.push(`- 智识: ${formatNumber(snapshot.panel.calc.intelligence)}`);
  lines.push(`- 意志: ${formatNumber(snapshot.panel.calc.will)}`);
  lines.push('');
  lines.push('## 主副能力换算');
  lines.push(`- 主能力: ${snapshot.operator.mainStat || '-'} ${formatNumber(snapshot.panel.display.abilityDetail.rawMainStat)} × (1 + ${formatPercent(snapshot.panel.display.abilityDetail.mainStatScale)}) × (1 + ${formatPercent(snapshot.panel.display.abilityDetail.allStatScale)}) = ${formatNumber(snapshot.panel.display.abilityDetail.mainStatBeforeRounding)}`);
  lines.push(`- 主能力取整: ${formatNumber(snapshot.panel.display.abilityDetail.mainStatBeforeRounding)} → ${formatNumber(snapshot.panel.display.mainStatFinal)}`);
  lines.push(`- 副能力: ${snapshot.operator.subStat || '-'} ${formatNumber(snapshot.panel.display.abilityDetail.rawSubStat)} × (1 + ${formatPercent(snapshot.panel.display.abilityDetail.subStatScale)}) × (1 + ${formatPercent(snapshot.panel.display.abilityDetail.allStatScale)}) = ${formatNumber(snapshot.panel.display.abilityDetail.subStatBeforeRounding)}`);
  lines.push(`- 副能力取整: ${formatNumber(snapshot.panel.display.abilityDetail.subStatBeforeRounding)} → ${formatNumber(snapshot.panel.display.subStatFinal)}`);
  lines.push(`- 主能力固定加值: ${formatNumber(snapshot.operator.mainStatFlatBonus)}`);
  lines.push(`- 副能力固定加值: ${formatNumber(snapshot.operator.subStatFlatBonus)}`);
  lines.push('');
  lines.push('## 能力值加成');
  lines.push(`- 总能力攻击加成: ${formatPercent(snapshot.panel.display.abilityBonus)}`);
  lines.push('');
  lines.push('## 抗性');
  lines.push('- 未实现');
  lines.push('');
  lines.push('## 装备');
  if (snapshot.equipment.pieces.length === 0) {
    lines.push('- 暂无');
  } else {
    snapshot.equipment.pieces.forEach((piece) => {
      lines.push(`- ${piece.name || piece.equipmentId}: ${piece.effects.map((effect) => `${effect.label} ${formatEquipmentEffectValue(effect)}`).join(' / ') || '暂无词条'}`);
    });
  }
  lines.push('');
  lines.push('## 三件套效果');
  if (snapshot.equipment.setBuffs.length === 0) {
    lines.push('- 暂无');
  } else {
    snapshot.equipment.setBuffs.forEach((buff) => {
      const valueText = buff.unit === 'percent' && buff.typeKey !== 'sourceSkillBoost'
        ? formatPercent(normalizeValue(buff.typeKey, buff.value, buff.unit))
        : `${formatNumber(buff.value)}${buff.unit === 'percent' ? '%' : ''}`;
      lines.push(`- ${buff.gearSetName || buff.gearSetId}: ${buff.label} ${buff.typeKey} +${valueText}${buff.category === 'condition' ? '（条件）' : ''}`);
    });
  }
  lines.push('');
  lines.push('## 干员自带 Buff');
  const operatorBuffEntries = (['talent', 'potential', 'skill'] as const).flatMap((groupKey) => (
    Object.entries(snapshot.operator.buffs[groupKey]?.effects || {})
      .map(([effectKey, effect]) => ({ groupKey, effectKey, effect }))
  ));
  if (operatorBuffEntries.length === 0) {
    lines.push('- 暂无');
  } else {
    operatorBuffEntries
      .filter(({ effect }) => effect.category === 'positive' || effect.category === 'passive')
      .forEach(({ groupKey, effectKey, effect }) => {
        lines.push(formatOperatorBuffLine(groupKey, effectKey, effect));
      });
    operatorBuffEntries
      .filter(({ effect }) => effect.category === 'condition')
      .forEach(({ groupKey, effectKey, effect }) => {
        lines.push(formatOperatorBuffLine(groupKey, effectKey, effect));
      });
  }
  lines.push('');
  lines.push('## 武器无条件触发');
  const passiveDetails = [
    snapshot.weapon.skills.skill1,
    snapshot.weapon.skills.skill2,
    ...snapshot.weapon.skills.skill3.effects.filter((effect) => effect.category === 'passive'),
  ].filter((detail): detail is WeaponSkillDetail => Boolean(detail));
  if (passiveDetails.length === 0) {
    lines.push('- 暂无');
  } else {
    passiveDetails.forEach((detail) => {
      lines.push(`- ${detail.label}: ${detail.typeKey} +${detail.value}`);
    });
  }
  lines.push('');
  lines.push('## 武器有条件触发');
  const conditionDetails = snapshot.weapon.skills.skill3.effects.filter((effect) => effect.category === 'condition');
  if (conditionDetails.length === 0) {
    lines.push('- 暂无');
  } else {
    conditionDetails.forEach((detail) => {
      lines.push(`- ${detail.label}: ${detail.typeKey} +${detail.value}`);
    });
  }
  return lines.join('\n');
}

export function buildConfigSnapshot(input: OperatorPanelInput): ConfigSnapshot {
  const attributes = resolveAttributes(input.operator);
  const weapon = buildWeaponSnapshot(input.weapon);
  const equipment = buildEquipmentSnapshot(input.equipment);
  const operatorPotentialCount = parsePotentialToCount(input.operator.potential);
  const operatorBuffs = filterOperatorBuffsByPotential(
    input.operator.buffs ?? createEmptyOperatorBuffs(),
    operatorPotentialCount
  );
  const fixedOperatorBuffTotals = buildOperatorBuffTotals(operatorBuffs);
  const mainField = resolveAbilityField(input.operator.mainStat);
  const subField = resolveAbilityField(input.operator.subStat);
  const mainStatFlatBonus = toNumber(input.operator.mainStatFlatBonus ?? input.operator.favorValue, 60);
  const subStatFlatBonus = toNumber(input.operator.subStatFlatBonus, 0);

  const buildPanelResult = (operatorBuffTotals: Record<string, number>) => {
    const abilityByField: Record<AbilityField, number> = {
      strength: attributes.strength + (weapon.totals.strengthBoost ?? 0) + (equipment.totals.strengthBoost ?? 0),
      agility: attributes.agility + (weapon.totals.agilityBoost ?? 0) + (equipment.totals.agilityBoost ?? 0),
      intelligence: attributes.intelligence + (weapon.totals.intelligenceBoost ?? 0) + (equipment.totals.intelligenceBoost ?? 0),
      will: attributes.will + (weapon.totals.willBoost ?? 0) + (equipment.totals.willBoost ?? 0),
    };
    abilityByField.strength += operatorBuffTotals.strengthBoost ?? 0;
    abilityByField.agility += operatorBuffTotals.agilityBoost ?? 0;
    abilityByField.intelligence += operatorBuffTotals.intelligenceBoost ?? 0;
    abilityByField.will += operatorBuffTotals.willBoost ?? 0;
    if (mainField) abilityByField[mainField] += mainStatFlatBonus + (weapon.totals.mainStat ?? 0) + (equipment.totals.mainStat ?? 0) + (operatorBuffTotals.mainStat ?? 0);
    if (subField) abilityByField[subField] += subStatFlatBonus + (weapon.totals.subStat ?? 0) + (equipment.totals.subStat ?? 0) + (operatorBuffTotals.subStat ?? 0);

    const mainStatScale = (weapon.totals.mainStatBoost ?? 0) + (equipment.totals.mainStatBoost ?? 0) + (operatorBuffTotals.mainStatBoost ?? 0);
    const subStatScale = (weapon.totals.subStatBoost ?? 0) + (equipment.totals.subStatBoost ?? 0) + (operatorBuffTotals.subStatBoost ?? 0);
    const allStatScale = (weapon.totals.allStatBoost ?? 0) + (operatorBuffTotals.allStatBoost ?? 0);
    const operatorAtk = attributes.atk;
    const weaponAtk = weapon.attack;
    const calcDamageBonus = createDamageBonusFromTotals(equipment.totals, weapon.totals, operatorBuffTotals);
    const calc: PanelCalcSnapshot = {
      strength: round(abilityByField.strength),
      agility: round(abilityByField.agility),
      intelligence: round(abilityByField.intelligence),
      will: round(abilityByField.will),
      operatorAtk,
      weaponAtk,
      operatorHp: attributes.hp,
      mainStatFlatBonus,
      subStatFlatBonus,
      mainStatBoost: round(mainStatScale),
      subStatBoost: round(subStatScale),
      allStatBoost: round(allStatScale),
      atkPercentBoost: round((weapon.totals.atkPercentBoost ?? 0) + (equipment.totals.atkPercentBoost ?? 0) + (operatorBuffTotals.atkPercentBoost ?? 0)),
      flatAtk: round((weapon.totals.atk ?? 0) + (operatorBuffTotals.atk ?? 0)),
      hpPercent: round((weapon.totals.hpPercent ?? 0) + (equipment.totals.hpPercent ?? 0) + (operatorBuffTotals.hpPercent ?? 0)),
      critRateBoost: round((weapon.totals.critRateBoost ?? 0) + (equipment.totals.critRateBoost ?? 0) + (operatorBuffTotals.critRateBoost ?? 0)),
      critDmgBonusBoost: round((weapon.totals.critDmgBonusBoost ?? 0) + (equipment.totals.critDmgBonusBoost ?? 0) + (operatorBuffTotals.critDmgBonusBoost ?? 0)),
      sourceSkillBoost: round((weapon.totals.sourceSkillBoost ?? 0) + (equipment.totals.sourceSkillBoost ?? 0) + (operatorBuffTotals.sourceSkillBoost ?? 0)),
      healingBonus: round((weapon.totals.healingBonus ?? 0) + (equipment.totals.healingBonus ?? 0) + (operatorBuffTotals.healingBonus ?? 0)),
      receivedHealingBonus: round(operatorBuffTotals.receivedHealingBonus ?? 0),
      chainCooldownReduction: round(operatorBuffTotals.chainCooldownReduction ?? 0),
      ultimateChargeEfficiency: round((weapon.totals.ultimateChargeEfficiency ?? 0) + (equipment.totals.ultimateChargeEfficiency ?? 0) + (operatorBuffTotals.ultimateChargeEfficiency ?? 0)),
      imbalanceEfficiency: round(operatorBuffTotals.imbalanceEfficiency ?? 0),
      damageReduction: round((equipment.totals.damageReduction ?? 0) + (operatorBuffTotals.damageReduction ?? 0)),
      damageBonus: calcDamageBonus,
    };
    return {
      calc,
      display: buildDisplay(calc, input.operator.mainStat ?? '', input.operator.subStat ?? ''),
    };
  };

  const preliminaryPanel = buildPanelResult(fixedOperatorBuffTotals);
  const derivedOperatorBuffTotals = buildDerivedOperatorBuffTotals(operatorBuffs, preliminaryPanel.display);
  const operatorBuffTotals = addTotals(fixedOperatorBuffTotals, derivedOperatorBuffTotals);
  const { calc, display } = buildPanelResult(operatorBuffTotals);
  const operatorBuffsWithRuntimeValues = attachDerivedOperatorBuffValues(operatorBuffs, preliminaryPanel.display);
  const snapshotWithoutMarkdown: Omit<ConfigSnapshot, 'detailMarkdown'> = {
    panel: { calc, display },
    operator: {
      id: input.operator.id,
      name: input.operator.name,
      level: input.operator.level,
      potential: input.operator.potential,
      potentialCount: operatorPotentialCount,
      element: input.operator.element ?? '',
      mainStat: input.operator.mainStat ?? '',
      subStat: input.operator.subStat ?? '',
      mainStatFlatBonus,
      subStatFlatBonus,
      skillConfig: input.operator.skillConfig ?? {},
      baseAttributes: attributes,
      buffs: operatorBuffsWithRuntimeValues,
    },
    weapon,
    equipment,
    buff: {
      operator: Object.values(operatorBuffsWithRuntimeValues).flatMap((group) => Object.keys(group.effects || {})),
      weapon: [],
      equipment: [],
    },
  };
  return {
    ...snapshotWithoutMarkdown,
    detailMarkdown: buildMarkdown(snapshotWithoutMarkdown),
  };
}
