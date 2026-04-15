import * as fs from 'fs';
import * as path from 'path';
import { PanelTemplateResult } from './panel_template';

export type SkillType = 'normalAttack' | 'skill' | 'chainSkill' | 'ultimate';
export type SkillLevel = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'M1' | 'M2' | 'M3';
export type DamageCategory = 'normalAttack' | 'skill' | 'chainSkill' | 'ultimate';
export type ElementType = 'physical' | 'fire' | 'electric' | 'ice' | 'ether';

interface CharacterData {
  name: string;
  element: ElementType;
  skills: Record<SkillType, CharacterSkillData>;
}

interface CharacterSkillData {
  name: string;
  type: string;
  multipliers: Record<string, Record<string, number>>;
}

export interface DamagePanelInput {
  atk: number;
  critRate: number;
  critDmg: number;
  physicalDmgBonus: number;
  fireDmgBonus: number;
  electricDmgBonus: number;
  iceDmgBonus: number;
  etherDmgBonus: number;
  skillDmgBonus: number;
  chainSkillDmgBonus: number;
  ultimateDmgBonus: number;
  allSkillDmgBonus: number;
}

export interface DamageBonusInput {
  bonusUnconditional: number;
  bonusConditional: Record<string, number>;
  bonusFromOthers: number;
}

export interface EnemySideInput {
  fragile: number;
  vulnerability: number;
  defenseZone: number;
  imbalanceVulnerability: number;
  resistanceZone: number;
}

export interface DamageCalculationInput {
  characterName: string;
  skillType: SkillType;
  skillLevel?: SkillLevel;
  panel: DamagePanelInput;
  hitKeyWhitelist?: string[];
  damageBonus?: Partial<DamageBonusInput>;
  triggerConditions?: Record<string, boolean>;
  enemy?: Partial<EnemySideInput>;
}

export interface HitDamageDetail {
  hitIndex: number;
  hitKey: string;
  multiplier: number;
  nonCrit: number;
  crit: number;
  expected: number;
}

export interface DamageCalculationResult {
  characterName: string;
  skillType: SkillType;
  skillLevel: SkillLevel;
  skillName: string;
  hitDetails: HitDamageDetail[];
  totalNonCrit: number;
  totalCrit: number;
  totalExpected: number;
  zoneBreakdown: {
    roleSide: {
      zoneDamageBonus: number;
      zoneDamageReduction: number;
      zoneAmplify: number;
      zoneComboBonus: number;
      zoneSpecial: number;
      bonusUnconditional: number;
      bonusConditional: number;
      bonusFromOthers: number;
      conditionalStates: Array<{ key: string; value: number; triggered: boolean }>;
    };
    enemySide: {
      zoneFragile: number;
      zoneVulnerability: number;
      zoneDefense: number;
      zoneImbalanceVulnerability: number;
      zoneResistance: number;
    };
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PANEL: DamagePanelInput = {
  atk: 0,
  critRate: 0.05,
  critDmg: 0.5,
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  etherDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0
};

const DEFAULT_DAMAGE_BONUS: DamageBonusInput = {
  bonusUnconditional: 0,
  bonusConditional: {},
  bonusFromOthers: 0
};

const DEFAULT_ENEMY_SIDE: EnemySideInput = {
  fragile: 0,
  vulnerability: 0,
  defenseZone: 0.5,
  imbalanceVulnerability: 0,
  resistanceZone: 1
};

const SKILL_LABEL_TO_KEY: Record<string, SkillType> = {
  普通攻击: 'normalAttack',
  战技: 'skill',
  连携技: 'chainSkill',
  终结技: 'ultimate',
  normalAttack: 'normalAttack',
  skill: 'skill',
  chainSkill: 'chainSkill',
  ultimate: 'ultimate'
};

function loadCharacterData(characterName: string): CharacterData {
  const filePath = path.join(PROJECT_ROOT, 'data', 'characters', `${characterName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`未找到角色数据: ${characterName}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as CharacterData;
}

function normalizeSkillLevel(skillLevel?: SkillLevel): SkillLevel {
  return skillLevel ?? '9';
}

function getElementDamageBonus(panel: DamagePanelInput, element: ElementType): number {
  if (element === 'physical') return panel.physicalDmgBonus;
  if (element === 'fire') return panel.fireDmgBonus;
  if (element === 'electric') return panel.electricDmgBonus;
  if (element === 'ice') return panel.iceDmgBonus;
  return panel.etherDmgBonus;
}

function getDamageCategoryBonus(panel: DamagePanelInput, skillType: SkillType): number {
  if (skillType === 'skill') return panel.skillDmgBonus;
  if (skillType === 'chainSkill') return panel.chainSkillDmgBonus;
  if (skillType === 'ultimate') return panel.ultimateDmgBonus;
  return 0;
}

function shouldTreatAsDamageMultiplier(key: string): boolean {
  const lowerKey = key.toLowerCase();
  const denyKeywords = ['cooldown', 'duration', 'energy', 'imbalance', 'radius', 'refund', 'slow', 'speed'];
  if (denyKeywords.some((word) => lowerKey.includes(word))) return false;
  if (lowerKey.includes('damage')) return true;
  if (/^hit\d+$/.test(lowerKey)) return true;
  if (['execute', 'plunge', 'slashdamage', 'finaldamage', 'dottotal'].includes(lowerKey)) return true;
  return false;
}

function sortHitEntries(entries: Array<[string, number]>): Array<[string, number]> {
  const parseHitNumber = (key: string): number | null => {
    const matched = key.toLowerCase().match(/^hit(\d+)$/);
    return matched ? Number(matched[1]) : null;
  };

  return entries.sort((a, b) => {
    const aNum = parseHitNumber(a[0]);
    const bNum = parseHitNumber(b[0]);
    if (aNum !== null && bNum !== null) return aNum - bNum;
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    return 0;
  });
}

function pickHitMultipliers(
  skillData: CharacterSkillData,
  skillLevel: SkillLevel,
  hitKeyWhitelist?: string[]
): Array<[string, number]> {
  const levelMultipliers = skillData.multipliers[skillLevel];
  if (!levelMultipliers) {
    throw new Error(`技能 ${skillData.name} 未找到等级 ${skillLevel} 的倍率数据`);
  }

  const sourceEntries = Object.entries(levelMultipliers).filter(([, value]) => typeof value === 'number');
  let entries = sourceEntries.filter(([key]) => shouldTreatAsDamageMultiplier(key));

  if (hitKeyWhitelist && hitKeyWhitelist.length > 0) {
    const orderMap = new Map<string, number>(hitKeyWhitelist.map((key, idx) => [key, idx]));
    entries = entries
      .filter(([key]) => orderMap.has(key))
      .sort((a, b) => (orderMap.get(a[0]) ?? 999) - (orderMap.get(b[0]) ?? 999));
  } else {
    entries = sortHitEntries(entries);
  }

  if (entries.length === 0) {
    throw new Error(`技能 ${skillData.name} 在等级 ${skillLevel} 未识别到可计算的伤害倍率键`);
  }

  return entries;
}

export function resolveSkillType(input: string): SkillType {
  const resolved = SKILL_LABEL_TO_KEY[input];
  if (!resolved) {
    throw new Error(`不支持的技能类型: ${input}`);
  }
  return resolved;
}

export function buildDamagePanelFromPanelResult(panelResult: PanelTemplateResult): DamagePanelInput {
  return {
    atk: panelResult.panel.atk,
    critRate: panelResult.panel.critRate,
    critDmg: panelResult.panel.critDmg,
    physicalDmgBonus: panelResult.panel.dmgBonus.physical,
    fireDmgBonus: panelResult.panel.dmgBonus.fire,
    electricDmgBonus: panelResult.panel.dmgBonus.electric,
    iceDmgBonus: panelResult.panel.dmgBonus.ice,
    etherDmgBonus: panelResult.panel.dmgBonus.ether,
    skillDmgBonus: panelResult.panel.dmgBonus.skill,
    chainSkillDmgBonus: panelResult.panel.dmgBonus.chain,
    ultimateDmgBonus: panelResult.panel.dmgBonus.ultimate,
    allSkillDmgBonus: panelResult.panel.dmgBonus.all
  };
}

export function calculateSkillDamage(input: DamageCalculationInput): DamageCalculationResult {
  const character = loadCharacterData(input.characterName);
  const panel: DamagePanelInput = { ...DEFAULT_PANEL, ...input.panel };
  const skillLevel = normalizeSkillLevel(input.skillLevel);
  const skillData = character.skills[input.skillType];
  if (!skillData) {
    throw new Error(`角色 ${input.characterName} 不存在技能类型 ${input.skillType}`);
  }

  const hitMultipliers = pickHitMultipliers(skillData, skillLevel, input.hitKeyWhitelist);
  const enemySide: EnemySideInput = { ...DEFAULT_ENEMY_SIDE, ...input.enemy };
  const damageBonus: DamageBonusInput = { ...DEFAULT_DAMAGE_BONUS, ...input.damageBonus };
  const triggerConditions = input.triggerConditions ?? {};

  const conditionalStates = Object.entries(damageBonus.bonusConditional).map(([key, value]) => ({
    key,
    value,
    triggered: Boolean(triggerConditions[key])
  }));

  const bonusConditional = conditionalStates.reduce((sum, item) => sum + (item.triggered ? item.value : 0), 0);
  const elementBonus = getElementDamageBonus(panel, character.element);
  const skillCategoryBonus = getDamageCategoryBonus(panel, input.skillType);

  // 角色侧
  const zoneDamageBonus =
    1 +
    elementBonus +
    skillCategoryBonus +
    panel.allSkillDmgBonus +
    damageBonus.bonusUnconditional +
    bonusConditional +
    damageBonus.bonusFromOthers;
  const zoneDamageReduction = 1;
  const zoneAmplify = 1;
  const zoneComboBonus = 1;
  const zoneSpecial = 1;

  // 敌方侧
  const zoneFragile = 1 + enemySide.fragile;
  const zoneVulnerability = 1 + enemySide.vulnerability;
  const zoneDefense = enemySide.defenseZone;
  const zoneImbalanceVulnerability = 1 + enemySide.imbalanceVulnerability;
  const zoneResistance = enemySide.resistanceZone;

  const roleSideProduct = zoneDamageBonus * zoneDamageReduction * zoneAmplify * zoneComboBonus * zoneSpecial;
  const enemySideProduct = zoneFragile * zoneVulnerability * zoneDefense * zoneImbalanceVulnerability * zoneResistance;

  const hitDetails: HitDamageDetail[] = hitMultipliers.map(([hitKey, multiplier], idx) => {
    const zoneBase = panel.atk * multiplier;
    const zoneCritNonCrit = 1;
    const zoneCritCrit = 1 + panel.critDmg;
    const zoneCritExpected = 1 + Math.max(0, Math.min(1, panel.critRate)) * panel.critDmg;
    const nonCrit = zoneBase * zoneCritNonCrit * roleSideProduct * enemySideProduct;
    const crit = zoneBase * zoneCritCrit * roleSideProduct * enemySideProduct;
    const expected = zoneBase * zoneCritExpected * roleSideProduct * enemySideProduct;
    return {
      hitIndex: idx + 1,
      hitKey,
      multiplier,
      nonCrit,
      crit,
      expected
    };
  });

  const totalNonCrit = hitDetails.reduce((sum, hit) => sum + hit.nonCrit, 0);
  const totalCrit = hitDetails.reduce((sum, hit) => sum + hit.crit, 0);
  const totalExpected = hitDetails.reduce((sum, hit) => sum + hit.expected, 0);

  return {
    characterName: input.characterName,
    skillType: input.skillType,
    skillLevel,
    skillName: skillData.name,
    hitDetails,
    totalNonCrit,
    totalCrit,
    totalExpected,
    zoneBreakdown: {
      roleSide: {
        zoneDamageBonus,
        zoneDamageReduction,
        zoneAmplify,
        zoneComboBonus,
        zoneSpecial,
        bonusUnconditional: damageBonus.bonusUnconditional,
        bonusConditional,
        bonusFromOthers: damageBonus.bonusFromOthers,
        conditionalStates
      },
      enemySide: {
        zoneFragile,
        zoneVulnerability,
        zoneDefense,
        zoneImbalanceVulnerability,
        zoneResistance
      }
    }
  };
}

function formatHitSeries(
  totalLabel: string,
  total: number,
  hitDetails: HitDamageDetail[],
  key: 'expected' | 'crit' | 'nonCrit'
): string {
  const hitParts = hitDetails.map((item) => `${item.hitIndex}hit：${item[key].toFixed(3)}`);
  return `总伤(${totalLabel})：${total.toFixed(3)}；${hitParts.join('；')}`;
}

export function formatDamageResult(result: DamageCalculationResult): string {
  const expectedLine = formatHitSeries('期望', result.totalExpected, result.hitDetails, 'expected');
  const critLine = formatHitSeries('暴击', result.totalCrit, result.hitDetails, 'crit');
  const nonCritLine = formatHitSeries('不暴击', result.totalNonCrit, result.hitDetails, 'nonCrit');

  const conditionalLines =
    result.zoneBreakdown.roleSide.conditionalStates.length === 0
      ? ['[有条件-无配置]']
      : result.zoneBreakdown.roleSide.conditionalStates.map((item) =>
          item.triggered
            ? `[有条件-已触发] ${item.key}: ${(item.value * 100).toFixed(1)}%`
            : `[有条件-未触发] ${item.key}: ${(item.value * 100).toFixed(1)}%`
        );

  const roleSideLine =
    `角色侧: 伤害加成区=${result.zoneBreakdown.roleSide.zoneDamageBonus.toFixed(3)} ` +
    `([无条件] ${(result.zoneBreakdown.roleSide.bonusUnconditional * 100).toFixed(1)}% ` +
    `+ [有条件已触发] ${(result.zoneBreakdown.roleSide.bonusConditional * 100).toFixed(1)}% ` +
    `+ [他人加成] ${(result.zoneBreakdown.roleSide.bonusFromOthers * 100).toFixed(1)}%)`;
  const enemySideLine =
    `敌方侧: 脆弱区=${result.zoneBreakdown.enemySide.zoneFragile.toFixed(3)} ` +
    `易伤区=${result.zoneBreakdown.enemySide.zoneVulnerability.toFixed(3)} ` +
    `防御区=${result.zoneBreakdown.enemySide.zoneDefense.toFixed(3)} ` +
    `失衡易伤区=${result.zoneBreakdown.enemySide.zoneImbalanceVulnerability.toFixed(3)} ` +
    `抗性区=${result.zoneBreakdown.enemySide.zoneResistance.toFixed(3)}`;

  return [
    `=== 技能伤害 ===`,
    `角色: ${result.characterName} | 技能: ${result.skillName} (${result.skillType}) | 等级: ${result.skillLevel}`,
    expectedLine,
    `| ${critLine}`,
    `| ${nonCritLine}`,
    '',
    roleSideLine,
    enemySideLine,
    ...conditionalLines
  ].join('\n');
}
