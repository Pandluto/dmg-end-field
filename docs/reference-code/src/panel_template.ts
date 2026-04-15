import * as fs from 'fs';
import * as path from 'path';

type CharacterStatKey = 'strength' | 'agility' | 'intelligence' | 'will';
type CharacterStatName = '力量' | '敏捷' | '智识' | '意志';

interface CharacterLevelAttributes {
  strength: number;
  agility: number;
  intelligence: number;
  will: number;
  atk: number;
  hp: number;
}

interface CharacterPotential {
  id: number;
  name: string;
  description: string;
  stats?: {
    agility?: number;
    strength?: number;
    intelligence?: number;
    will?: number;
    physicalDmgBonus?: number;
    fireDmgBonus?: number;
    electricDmgBonus?: number;
    iceDmgBonus?: number;
    etherDmgBonus?: number;
    ultimateDmgBonus?: number;
    critRate?: number;
    critDmg?: number;
    atkPercent?: number;
  };
}

interface CharacterData {
  name: string;
  rarity?: number;
  mainStat: CharacterStatName;
  subStat: CharacterStatName;
  attributes: Record<string, CharacterLevelAttributes>;
  potentials?: CharacterPotential[];
}

interface WeaponSkillLevelRange {
  baseLevel: number;
  maxLevel: number;
}

interface WeaponSkillLevelEffect {
  value?: number;
  memoryStrength?: number;
  description?: string;
  passive?: {
    atkPercent?: number;
    critRate?: number;
    memoryStrength?: number;
  };
  atkPercent?: number;
  critRate?: number;
}

interface WeaponSkillData {
  name: string;
  statType: string;
  phases: Record<string, WeaponSkillLevelRange>;
  levels: Record<string, WeaponSkillLevelEffect>;
}

interface WeaponData {
  name: string;
  attackGrowth: Record<string, number>;
  phases: Record<string, { requirement: number }>;
  matrix?: {
    start: string;
    max: string;
  };
  skills: Record<string, WeaponSkillData>;
}

export interface EquipmentBonus {
  flatAtk: number;
  atkPercent: number;
  mainStat: number;
  subStat: number;
  intelligence: number;
  will: number;
  critRate: number;
  critDmg: number;
  memoryStrength: number;
  skillDmgBonus: number;
  chainSkillDmgBonus: number;
  allSkillDmgBonus: number;
  mainAbilityPercent: number;
  physicalDmgBonus: number;
  fireDmgBonus: number;
  electricDmgBonus: number;
  iceDmgBonus: number;
  etherDmgBonus: number;
  ultimateDmgBonus: number;
  physicalRes: number;
  fireRes: number;
  electricRes: number;
  iceRes: number;
  etherRes: number;
  voidRes: number;
  healingBonus: number;
  incomingHealingBonus: number;
  chainSkillCdr: number;
  ultimateChargeEfficiency: number;
  imbalanceEfficiency: number;
}

export const DEFAULT_EQUIPMENT_BONUS: EquipmentBonus = {
  flatAtk: 0,
  atkPercent: 0,
  mainStat: 0,
  subStat: 0,
  intelligence: 0,
  will: 0,
  critRate: 0,
  critDmg: 0,
  memoryStrength: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  allSkillDmgBonus: 0,
  mainAbilityPercent: 0,
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  etherDmgBonus: 0,
  ultimateDmgBonus: 0,
  physicalRes: 0,
  fireRes: 0,
  electricRes: 0,
  iceRes: 0,
  etherRes: 0,
  voidRes: 0,
  healingBonus: 0,
  incomingHealingBonus: 0,
  chainSkillCdr: 0,
  ultimateChargeEfficiency: 0,
  imbalanceEfficiency: 0
};

export const DEFAULT_BASE_PANEL = {
  critRate: 0.05,
  critDmg: 0.5,
  memoryStrength: 0,
  physicalRes: 0,
  fireRes: 0,
  electricRes: 0,
  iceRes: 0,
  etherRes: 0,
  voidRes: 0,
  healingBonus: 0,
  incomingHealingBonus: 0,
  chainSkillCdr: 0,
  ultimateChargeEfficiency: 0,
  imbalanceEfficiency: 0,
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  etherDmgBonus: 0
};

export interface PanelTemplateInput {
  characterName: string;
  characterLevel: number;
  weaponName?: string;
  weaponLevel?: number;
  matrixCode?: string;
  baseLevelCode?: string;
  favorMainStatBonus?: number;
  potential?: number;
  equipment?: Partial<EquipmentBonus>;
}

export interface PanelTemplateResult {
  character: {
    name: string;
    level: number;
    mainStat: CharacterStatName;
    subStat: CharacterStatName;
  };
  weapon: {
    name?: string;
    level?: number;
    phase?: number;
    matrixCode: string;
  };
  panel: {
    hp: number;
    atk: number;
    mainStat: number;
    subStat: number;
    otherStats: {
      strength: number;
      agility: number;
      intelligence: number;
      will: number;
    };
    critRate: number;
    critDmg: number;
    memoryStrength: number;
    resistances: {
      physical: number;
      fire: number;
      electric: number;
      ice: number;
      ether: number;
      void: number;
    };
    healingBonus: number;
    incomingHealingBonus: number;
    chainSkillCdr: number;
    ultimateChargeEfficiency: number;
    imbalanceEfficiency: number;
    dmgBonus: {
      physical: number;
      fire: number;
      electric: number;
      ice: number;
      ether: number;
      skill: number;
      chain: number;
      ultimate: number;
      all: number;
    };
  };
  breakdown: {
    baseAtk: { character: number; weapon: number };
    mainStat: { character: number; favor: number; weapon: number; equipment: number; potential: number };
    subStat: { character: number; weapon: number; equipment: number; potential: number };
    atkPercent: { weapon: number; equipment: number; potential: number };
    abilityBonus: number;
    mainAbilityPercent: number;
    effectiveMainStatForAbility: number;
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

const STAT_NAME_TO_KEY: Record<CharacterStatName, CharacterStatKey> = {
  '力量': 'strength',
  '敏捷': 'agility',
  '智识': 'intelligence',
  '意志': 'will'
};

function loadJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function getCharacterFilePath(characterName: string): string {
  return path.join(PROJECT_ROOT, 'data', 'characters', `${characterName}.json`);
}

function getWeaponFilePath(weaponName: string): string {
  return path.join(PROJECT_ROOT, 'data', 'weapons', `${weaponName}.json`);
}

function getCharacterLevelKey(level: number): string {
  return `level${level}`;
}

function getWeaponPhase(weapon: WeaponData, weaponLevel: number): number {
  return Object.entries(weapon.phases)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .reduce((currentPhase, [phaseKey, phaseInfo]) => {
      return weaponLevel >= phaseInfo.requirement ? Number(phaseKey) : currentPhase;
    }, 0);
}

function normalizeMatrixCode(matrixCode: string | undefined, skillCount: number): string {
  if (!matrixCode) {
    return '0'.repeat(skillCount);
  }
  const digits = matrixCode.replace(/\D/g, '');
  if (!digits) {
    return '0'.repeat(skillCount);
  }
  if (digits.length >= skillCount) {
    return digits.slice(0, skillCount);
  }
  return digits.padEnd(skillCount, '0');
}

function getSkillValue(skill: WeaponSkillData, finalLevel: number): number | undefined {
  const levelData = skill.levels[String(finalLevel)];
  if (!levelData) return undefined;
  if (typeof levelData.value === 'number') return levelData.value;
  if (typeof levelData.memoryStrength === 'number') return levelData.memoryStrength;
  return undefined;
}

function clampLevel(level: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, level));
}

function resolveEquipmentMappedStatContribution(
  statKey: CharacterStatKey,
  genericValue: number,
  intelligenceValue: number,
  willValue: number
): number {
  // Do not stack generic main/sub stat with dedicated intelligence/will
  // when the mapped ability is intelligence or will.
  if (statKey === 'intelligence') {
    return intelligenceValue !== 0 ? intelligenceValue : genericValue;
  }
  if (statKey === 'will') {
    return willValue !== 0 ? willValue : genericValue;
  }
  return genericValue;
}

export const DEFAULT_FAVOR_MAIN_STAT_BONUS = 60;

export function calculatePanel(input: PanelTemplateInput): PanelTemplateResult {
  const characterLevel = clampLevel(input.characterLevel, 1, 90);
  const character = loadJsonFile<CharacterData>(getCharacterFilePath(input.characterName));
  const levelData = character.attributes[getCharacterLevelKey(characterLevel)];

  if (!levelData) {
    throw new Error(`未找到角色 ${input.characterName} 的 ${characterLevel} 级属性`);
  }

  const mainStatKey = STAT_NAME_TO_KEY[character.mainStat];
  const subStatKey = STAT_NAME_TO_KEY[character.subStat];

  const favorMainStatBonus = input.favorMainStatBonus ?? DEFAULT_FAVOR_MAIN_STAT_BONUS;
  const equipment: EquipmentBonus = { ...DEFAULT_EQUIPMENT_BONUS, ...input.equipment };

  let potentialAgility = 0;
  let potentialStrength = 0;
  let potentialPhysicalDmgBonus = 0;
  let potentialUltimateDmgBonus = 0;
  let potentialCritRate = 0;
  let potentialCritDmg = 0;
  let potentialAtkPercent = 0;
  let potentialIntelligence = 0;
  let potentialWill = 0;
  let activePotentialCount = 0;

  if (character.potentials && character.potentials.length > 0) {
    const rarity = character.rarity || 6;
    const defaultPotential = rarity === 5 ? 5 : 0;
    const targetPotential = input.potential ?? defaultPotential;

    for (const potential of character.potentials) {
      if (potential.id <= targetPotential && potential.stats) {
        activePotentialCount++;
        if (potential.stats.agility) potentialAgility += potential.stats.agility;
        if (potential.stats.strength) potentialStrength += potential.stats.strength;
        if (potential.stats.intelligence) potentialIntelligence += potential.stats.intelligence;
        if (potential.stats.will) potentialWill += potential.stats.will;
        if (potential.stats.physicalDmgBonus) potentialPhysicalDmgBonus += potential.stats.physicalDmgBonus;
        if (potential.stats.ultimateDmgBonus) potentialUltimateDmgBonus += potential.stats.ultimateDmgBonus;
        if (potential.stats.critRate) potentialCritRate += potential.stats.critRate;
        if (potential.stats.critDmg) potentialCritDmg += potential.stats.critDmg;
        if (potential.stats.atkPercent) potentialAtkPercent += potential.stats.atkPercent;
      }
    }
  }

  let weaponBaseAtk = 0;
  let weaponMainStatBonus = 0;
  let weaponSubStatBonus = 0;
  let weaponAtkPercent = 0;
  let weaponMemoryStrength = 0;
  let weaponCritRate = 0;
  let weaponPhase: number | undefined;
  let normalizedMatrixCode = '';

  if (input.weaponName && input.weaponLevel) {
    const weaponLevel = clampLevel(input.weaponLevel, 1, 90);
    const weapon = loadJsonFile<WeaponData>(getWeaponFilePath(input.weaponName));
    const skillEntries = Object.entries(weapon.skills);

    weaponBaseAtk = weapon.attackGrowth[String(weaponLevel)] || 0;
    weaponPhase = getWeaponPhase(weapon, weaponLevel);
    normalizedMatrixCode = normalizeMatrixCode(input.matrixCode, skillEntries.length);
    const normalizedBaseLevelCode = input.baseLevelCode
      ? normalizeMatrixCode(input.baseLevelCode, skillEntries.length)
      : null;

    for (const [index, [skillKey, skill]] of skillEntries.entries()) {
      const phaseData = skill.phases[String(weaponPhase)];
      if (!phaseData) continue;

      const matrixLevel = Number(normalizedMatrixCode[index] || '0');
      const baseLevel = normalizedBaseLevelCode
        ? Number(normalizedBaseLevelCode[index] || '0')
        : phaseData.baseLevel;
      const maxLevel = normalizedBaseLevelCode ? 9 : phaseData.maxLevel;
      const finalLevel = Math.min(baseLevel + matrixLevel, maxLevel);
      const value = getSkillValue(skill, finalLevel);

      if (typeof value === 'number') {
        if (skill.statType === mainStatKey) {
          weaponMainStatBonus += value;
        } else if (skill.statType === subStatKey) {
          weaponSubStatBonus += value;
        } else if (skill.statType === 'atkPercent') {
          weaponAtkPercent += value;
        } else if (skill.statType === 'memoryStrength') {
          weaponMemoryStrength += value;
        } else if (skill.statType === 'critRate') {
          weaponCritRate += value;
        }
      }

      if (skill.statType === 'special') {
        const levelData = skill.levels[String(finalLevel)] as WeaponSkillLevelEffect | undefined;
        if (levelData) {
          const passive = levelData.passive || levelData;
          if (typeof passive.atkPercent === 'number') {
            weaponAtkPercent += passive.atkPercent;
          }
          if (typeof passive.critRate === 'number') {
            weaponCritRate += passive.critRate;
          }
          if (typeof passive.memoryStrength === 'number') {
            weaponMemoryStrength += passive.memoryStrength;
          }
        }
      }
    }
  }

  const characterMainStat = levelData[mainStatKey];
  const characterSubStat = levelData[subStatKey];

  const potentialMainStatBonus = mainStatKey === 'agility' ? potentialAgility : 
                                  mainStatKey === 'strength' ? potentialStrength : 0;
  const potentialSubStatBonus = subStatKey === 'agility' ? potentialAgility : 
                                 subStatKey === 'strength' ? potentialStrength : 0;
  const equipmentMainStatContribution = resolveEquipmentMappedStatContribution(
    mainStatKey,
    equipment.mainStat,
    equipment.intelligence,
    equipment.will
  );
  const equipmentSubStatContribution = resolveEquipmentMappedStatContribution(
    subStatKey,
    equipment.subStat,
    equipment.intelligence,
    equipment.will
  );

  const totalMainStat =
    characterMainStat + favorMainStatBonus + weaponMainStatBonus + equipmentMainStatContribution + potentialMainStatBonus;
  const totalSubStat =
    characterSubStat + weaponSubStatBonus + equipmentSubStatContribution + potentialSubStatBonus;
  const effectiveMainStatForAbility = totalMainStat * (1 + equipment.mainAbilityPercent);
  const abilityBonus = effectiveMainStatForAbility * 0.005 + totalSubStat * 0.002;

  const totalAtkPercent = weaponAtkPercent + equipment.atkPercent + potentialAtkPercent;
  const baseAtkTotal = levelData.atk + weaponBaseAtk;
  const finalAtk = (baseAtkTotal * (1 + totalAtkPercent) + equipment.flatAtk) * (1 + abilityBonus);

  const totalMemoryStrength = DEFAULT_BASE_PANEL.memoryStrength + weaponMemoryStrength + equipment.memoryStrength;

  return {
    character: {
      name: character.name,
      level: characterLevel,
      mainStat: character.mainStat,
      subStat: character.subStat
    },
    weapon: {
      name: input.weaponName,
      level: input.weaponLevel,
      phase: weaponPhase,
      matrixCode: normalizedMatrixCode
    },
    panel: {
      hp: levelData.hp,
      atk: finalAtk,
      mainStat: totalMainStat,
      subStat: totalSubStat,
      otherStats: {
        strength: levelData.strength + potentialStrength,
        agility: levelData.agility + potentialAgility,
        intelligence:
          levelData.intelligence +
          potentialIntelligence +
          ((mainStatKey === 'intelligence' || subStatKey === 'intelligence') ? equipment.intelligence : 0),
        will:
          levelData.will +
          potentialWill +
          ((mainStatKey === 'will' || subStatKey === 'will') ? equipment.will : 0)
      },
      critRate: DEFAULT_BASE_PANEL.critRate + weaponCritRate + equipment.critRate + potentialCritRate,
      critDmg: DEFAULT_BASE_PANEL.critDmg + equipment.critDmg + potentialCritDmg,
      memoryStrength: totalMemoryStrength,
      resistances: {
        physical: DEFAULT_BASE_PANEL.physicalRes + equipment.physicalRes,
        fire: DEFAULT_BASE_PANEL.fireRes + equipment.fireRes,
        electric: DEFAULT_BASE_PANEL.electricRes + equipment.electricRes,
        ice: DEFAULT_BASE_PANEL.iceRes + equipment.iceRes,
        ether: DEFAULT_BASE_PANEL.etherRes + equipment.etherRes,
        void: DEFAULT_BASE_PANEL.voidRes + equipment.voidRes
      },
      healingBonus: DEFAULT_BASE_PANEL.healingBonus + equipment.healingBonus,
      incomingHealingBonus: DEFAULT_BASE_PANEL.incomingHealingBonus + equipment.incomingHealingBonus,
      chainSkillCdr: DEFAULT_BASE_PANEL.chainSkillCdr + equipment.chainSkillCdr,
      ultimateChargeEfficiency: DEFAULT_BASE_PANEL.ultimateChargeEfficiency + equipment.ultimateChargeEfficiency,
      imbalanceEfficiency: DEFAULT_BASE_PANEL.imbalanceEfficiency + equipment.imbalanceEfficiency,
      dmgBonus: {
        physical: DEFAULT_BASE_PANEL.physicalDmgBonus + equipment.physicalDmgBonus + potentialPhysicalDmgBonus,
        fire: DEFAULT_BASE_PANEL.fireDmgBonus + equipment.fireDmgBonus,
        electric: DEFAULT_BASE_PANEL.electricDmgBonus + equipment.electricDmgBonus,
        ice: DEFAULT_BASE_PANEL.iceDmgBonus + equipment.iceDmgBonus,
        ether: DEFAULT_BASE_PANEL.etherDmgBonus + equipment.etherDmgBonus,
        skill: equipment.skillDmgBonus,
        chain: equipment.chainSkillDmgBonus,
        ultimate: equipment.ultimateDmgBonus + potentialUltimateDmgBonus,
        all: equipment.allSkillDmgBonus
      }
    },
    breakdown: {
      baseAtk: { character: levelData.atk, weapon: weaponBaseAtk },
      mainStat: { character: characterMainStat, favor: favorMainStatBonus, weapon: weaponMainStatBonus, equipment: equipmentMainStatContribution, potential: potentialMainStatBonus },
      subStat: { character: characterSubStat, weapon: weaponSubStatBonus, equipment: equipmentSubStatContribution, potential: potentialSubStatBonus },
      atkPercent: { weapon: weaponAtkPercent, equipment: equipment.atkPercent, potential: potentialAtkPercent },
      abilityBonus,
      mainAbilityPercent: equipment.mainAbilityPercent,
      effectiveMainStatForAbility
    }
  };
}

export function formatPanelResult(result: PanelTemplateResult): string {
  const lines: string[] = [
    `=== 角色面板 ===`,
    `角色: ${result.character.name} Lv.${result.character.level}`,
    `主属性: ${result.character.mainStat} | 副属性: ${result.character.subStat}`,
    result.weapon.name
      ? `武器: ${result.weapon.name} Lv.${result.weapon.level} 阶段${result.weapon.phase} 珠子${result.weapon.matrixCode}`
      : '武器: 无',
    ``,
    `=== 基础属性 ===`,
    `生命值: ${result.panel.hp}`,
    `攻击力: ${result.panel.atk.toFixed(3)}`,
    `  基础: ${result.breakdown.baseAtk.character} (角色) + ${result.breakdown.baseAtk.weapon} (武器)`,
    `  百分比加成: ${(result.breakdown.atkPercent.weapon * 100).toFixed(1)}% (武器) + ${(result.breakdown.atkPercent.equipment * 100).toFixed(1)}% (装备)` + (result.breakdown.atkPercent.potential > 0 ? ` + ${(result.breakdown.atkPercent.potential * 100).toFixed(1)}% (潜能)` : ''),
    `  能力值加成: ${(result.breakdown.abilityBonus * 100).toFixed(1)}%`,
    `  主能力系数加成: ${(result.breakdown.mainAbilityPercent * 100).toFixed(1)}%`,
    `  主能力作用后: ${result.breakdown.effectiveMainStatForAbility.toFixed(3)}`,
    ``,
    `=== 能力值 ===`,
    `${result.character.mainStat}: ${result.panel.mainStat}`,
    `  ${result.breakdown.mainStat.character} (角色) + ${result.breakdown.mainStat.favor} (好感) + ${result.breakdown.mainStat.weapon} (武器) + ${result.breakdown.mainStat.equipment} (装备)` + (result.breakdown.mainStat.potential > 0 ? ` + ${result.breakdown.mainStat.potential} (潜能)` : ''),
    `${result.character.subStat}: ${result.panel.subStat}`,
    `  ${result.breakdown.subStat.character} (角色) + ${result.breakdown.subStat.weapon} (武器) + ${result.breakdown.subStat.equipment} (装备)` + (result.breakdown.subStat.potential > 0 ? ` + ${result.breakdown.subStat.potential} (潜能)` : ''),
    ``,
    `=== 暴击属性 ===`,
    `暴击率: ${(result.panel.critRate * 100).toFixed(1)}%`,
    `暴击伤害: ${(result.panel.critDmg * 100).toFixed(1)}%`,
    ``,
    `=== 源石技艺强度 ===`,
    `源石技艺强度: ${result.panel.memoryStrength}`,
    ``,
    `=== 抗性 ===`,
    `物理: ${(result.panel.resistances.physical * 100).toFixed(1)}%`,
    `灼热: ${(result.panel.resistances.fire * 100).toFixed(1)}%`,
    `电磁: ${(result.panel.resistances.electric * 100).toFixed(1)}%`,
    `寒冷: ${(result.panel.resistances.ice * 100).toFixed(1)}%`,
    `自然: ${(result.panel.resistances.ether * 100).toFixed(1)}%`,
    `超域: ${(result.panel.resistances.void * 100).toFixed(1)}%`,
    ``,
    `=== 效率属性 ===`,
    `治疗效率加成: ${(result.panel.healingBonus * 100).toFixed(1)}%`,
    `受治疗效率加成: ${(result.panel.incomingHealingBonus * 100).toFixed(1)}%`,
    `连携技冷却缩减: ${(result.panel.chainSkillCdr * 100).toFixed(1)}%`,
    `终结技充能效率: ${(result.panel.ultimateChargeEfficiency * 100).toFixed(1)}%`,
    `失衡效率加成: ${(result.panel.imbalanceEfficiency * 100).toFixed(1)}%`,
    ``,
    `=== 伤害加成 ===`,
    `物理: ${(result.panel.dmgBonus.physical * 100).toFixed(1)}%`,
    `灼热: ${(result.panel.dmgBonus.fire * 100).toFixed(1)}%`,
    `电磁: ${(result.panel.dmgBonus.electric * 100).toFixed(1)}%`,
    `寒冷: ${(result.panel.dmgBonus.ice * 100).toFixed(1)}%`,
    `自然: ${(result.panel.dmgBonus.ether * 100).toFixed(1)}%`,
    `终结技: ${(result.panel.dmgBonus.ultimate * 100).toFixed(1)}%`,
    `连携技: ${(result.panel.dmgBonus.chain * 100).toFixed(1)}%`,
    `战技: ${(result.panel.dmgBonus.skill * 100).toFixed(1)}%`,
    `所有伤害: ${(result.panel.dmgBonus.all * 100).toFixed(1)}%`
  ];

  return lines.join('\n');
}
