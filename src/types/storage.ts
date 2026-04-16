import { EquipmentConfig } from '../utils/equipmentParser';

export type SkillPanelKey = 'A' | 'B' | 'E' | 'Q';
export type SkillLevelMode = 'L9' | 'M3';
export type WeaponPotentialMode = 'P0' | 'PMAX';

// ==================== v3 新类型定义 ====================

/**
 * 角色输入配置（v3 主存储）
 * 只存用户输入，不存计算结果
 */
export interface CharacterInputConfig {
  potential: '0潜' | '满潜';
  skillLevels: {
    A: SkillLevelMode;
    B: SkillLevelMode;
    E: SkillLevelMode;
    Q: SkillLevelMode;
  };
  weapon: {
    name: string;
    potentialMode: WeaponPotentialMode;
  };
  equipment: Partial<EquipmentConfig>;
}

/**
 * 角色计算缓存（v3 派生层）
 * 可通过输入重新计算的数据
 */
export interface CharacterComputedCache {
  fingerprint: string;
  panel: {
    atk: number;
    baseAtk: number;
    strength: number;
    agility: number;
    intelligence: number;
    will: number;
    abilityBonus: number;
    mainStatFinal: number;
    subStatFinal: number;
    characterAtk: number;
    weaponAtk: number;
    weaponAtkPercent: number;
    weaponAllSkillDmgBonus: number;
  };
  damageBonus: {
    physicalDmgBonus: number;
    fireDmgBonus: number;
    electricDmgBonus: number;
    iceDmgBonus: number;
    natureDmgBonus: number;
    magicDmgBonus: number;
    normalAttackDmgBonus: number;
    skillDmgBonus: number;
    chainSkillDmgBonus: number;
    ultimateDmgBonus: number;
    allSkillDmgBonus: number;
    imbalanceDmgBonus: number;
    allDmgBonus: number;
  };
}

/**
 * 角色展示缓存（v3 UI 层）
 * 纯展示文本，可丢失
 */
export interface CharacterDisplayCache {
  infoLines?: string[];
  weaponBuffLines?: string[];
}

/**
 * v3 存储结构包装
 */
export interface VersionedStorageWrapper<T> {
  version: string;
  timestamp: number;
  data: Record<string, T>;
}

// ==================== v2 旧类型（兼容用） ====================

export interface PanelSummary {
  strength: number;
  agility: number;
  intelligence: number;
  will: number;
  atk: number;
  baseAtk: number;
  abilityBonus: number;
  mainStatFinal: number;
  subStatFinal: number;
  characterAtk: number;
  weaponAtk: number;
  weaponAtkPercent: number;
  weaponAllSkillDmgBonus: number;
}

export interface DamageBonusSnapshot {
  physicalDmgBonus: number;
  fireDmgBonus: number;
  electricDmgBonus: number;
  iceDmgBonus: number;
  natureDmgBonus: number;
  magicDmgBonus: number;
  normalAttackDmgBonus: number;
  skillDmgBonus: number;
  chainSkillDmgBonus: number;
  ultimateDmgBonus: number;
  allSkillDmgBonus: number;
  imbalanceDmgBonus: number;
  allDmgBonus: number;
}

/**
 * v2 旧配置结构（用于迁移）
 */
export interface CharacterConfigJson {
  characterId: string;
  characterName: string;
  characterPotential: string;
  skillLevelModeMap: Record<SkillPanelKey, SkillLevelMode>;
  weaponName: string;
  weaponPotentialMode: WeaponPotentialMode;
  equipment: EquipmentConfig;
  panelSnapshot: PanelSummary | null;
  infoSnapshot: string[];
  infoSnap: DamageBonusSnapshot;
  weaponBuffSnapshot: string[];
}

// ==================== SkillButton Buff 类型 ====================

export interface SkillButtonBuff {
  id: string;
  name: string;
  displayName: string;
  sourceName: string;
  level?: string;
  type?: string;
  value?: number;
}

export type SkillButtonBuffMap = Record<string, SkillButtonBuff[]>;
