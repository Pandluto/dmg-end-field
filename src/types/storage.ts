import { EquipmentConfig } from '../utils/equipmentParser';
import type { BuffCategory, BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../core/domain/buff';
import type { ConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import { SandboxSkillHit, HitSkillType, ElementType } from './index';

export type SkillPanelKey = 'A' | 'B' | 'E' | 'Q';
export type SkillLevelMode = 'L9' | 'M3';
export type WeaponPotentialMode = 'P0' | 'PMAX';

export interface OperatorConfigPageEntryConfig {
  level: number | string;
}

export interface OperatorConfigPageEntryState {
  id: string;
  config: OperatorConfigPageEntryConfig;
  data: Record<string, unknown>;
}

export interface OperatorConfigPageEquipmentPieceState {
  id: string;
  entryCount: number;
  entries: OperatorConfigPageEntryState[];
  config: Record<string, never>;
  data: Record<string, unknown>;
}

export interface OperatorConfigPageCharacterState {
  id: string;
  config: {
    level: number | string;
    potential: string;
    favorValue?: number;
    mainStatFlatBonus?: number;
    subStatFlatBonus?: number;
  };
  data: Record<string, unknown>;
}

export interface OperatorConfigPageWeaponState {
  id: string;
  config: {
    level: number | string;
    potential: string;
    skillLevels: {
      skill1: number;
      skill2: number;
      skill3: number;
    };
  };
  data: Record<string, unknown>;
}

export interface OperatorConfigPageSkillsState {
  id: string;
  config: Record<SkillPanelKey, string>;
  data: Record<string, unknown>;
}

export interface OperatorConfigPageCharacterConfig {
  character: OperatorConfigPageCharacterState;
  weapon: OperatorConfigPageWeaponState;
  equipment: {
    accessory1: OperatorConfigPageEquipmentPieceState;
    accessory2: OperatorConfigPageEquipmentPieceState;
    armor: OperatorConfigPageEquipmentPieceState;
    glove: OperatorConfigPageEquipmentPieceState;
  };
  skills: OperatorConfigPageSkillsState;
  sourceSnapshot?: ConfigSnapshot;
}

export type OperatorConfigPageCache = Record<string, ConfigSnapshot>;

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
    hp: number;
    strength: number;
    agility: number;
    intelligence: number;
    will: number;
    abilityBonus: number;
    mainStatFinal: number;
    subStatFinal: number;
    mainStatRaw?: number;
    subStatRaw?: number;
    characterAtk: number;
    weaponAtk: number;
    weaponAtkPercent: number;
    critRate: number;
    critDmg: number;
    sourceSkill: number;
    healingBonus: number;
    ultimateChargeEfficiency: number;
    weaponAllSkillDmgBonus: number;
    mainStatField?: 'strength' | 'agility' | 'intelligence' | 'will';
    subStatField?: 'strength' | 'agility' | 'intelligence' | 'will';
    mainStatScale?: number;
    subStatScale?: number;
    allStatScale?: number;
  };
  damageBonus: {
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
  hp: number;
  strength: number;
  agility: number;
  intelligence: number;
  will: number;
  atk: number;
  baseAtk: number;
  abilityBonus: number;
  mainStatFinal: number;
  subStatFinal: number;
  mainStatRaw?: number;
  subStatRaw?: number;
  characterAtk: number;
  weaponAtk: number;
  weaponAtkPercent: number;
  critRate: number;
  critDmg: number;
  sourceSkill: number;
  healingBonus: number;
  ultimateChargeEfficiency: number;
  weaponAllSkillDmgBonus: number;
  mainStatField?: 'strength' | 'agility' | 'intelligence' | 'will';
  subStatField?: 'strength' | 'agility' | 'intelligence' | 'will';
  mainStatScale?: number;
  subStatScale?: number;
  allStatScale?: number;
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

/**
 * Buff 作用目标类型
 * 用于表达 Buff 作用于哪个 hit、哪种 skillType、哪种 element
 */
export type SkillButtonBuffTarget =
  | { mode: 'all' }                                    // 作用于所有 hit
  | { mode: 'damageKey'; key: string }                 // 作用于特定 hit，如 'hit2'
  | { mode: 'skillType'; skillType: HitSkillType }     // 作用于特定 hit 伤害类型
  | { mode: 'element'; element: ElementType };         // 作用于特定元素

/**
 * Buff 完整类型（v2 扩展）
 * 所有字段必须包含，确保 Buff 内容完整
 */
export interface SkillButtonBuff {
  schemaVersion?: 2;     // Buff 计算定义 schema
  id: string;              // 稳定独立 ID
  name: string;            // 内部名称
  displayName: string;     // 展示名称
  sourceName: string;      // 来源名称
  level?: string;          // 等级
  type?: string;           // 类型
  value?: number;          // 数值
  description?: string;    // 描述
  source?: string;         // 来源
  condition?: string;      // 触发条件
  category?: BuffCategory; // Buff 业务类别，缺省按 condition
  maxStacks?: number;      // countable 最大层数
  multiplier?: BuffMultiplier; // 五类乘区的独立直接倍率
  refCount: number;        // 被引用次数，selectedBuff 解绑时 -1，0 时删除实体
  target?: SkillButtonBuffTarget;  // 作用目标（可选，默认 'all'）
  effectKind?: BuffEffectKind;     // Buff 效果类型（普通 modifier / 额外 hit）
  extraHitConfig?: BuffExtraHitConfig; // 额外 hit 配置
  valueMode?: 'fixed' | 'derived';
  derivedValue?: {
    source: 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';
    perPointValue: number;
  };
}

export type SkillButtonBuffMap = Record<string, SkillButtonBuff[]>;

export interface SkillButtonPanelConfig {
  selectedBuff: string[];
  globallyDisabledBuffIds?: string[];
  manualDisabledBuffIdsBySegmentKey?: Record<string, string[]>;
  manualBuffStackCountsBySegmentKey?: Record<string, Record<string, number>>;
  manualDisabledHitKeys?: string[];
}

export type SkillButtonBuffStackCounts = Record<string, number>;

export interface SkillButtonRuntimeSnapshot {
  atk: number;
  critRate: number;
  critDmg: number;
  characterComputed?: CharacterComputedCache | null;
}

export interface PersistedAnomalyCard {
  id: string;
  key: string;
  label: string;
  kind: 'state' | 'damage';
  category: 'magic' | 'physical';
  level: number;
  sourceName?: string;
  includeDotInTotal?: boolean;
  burnDamageMode?: 'dotOnly' | 'initialOnly' | 'splitDot';
  durationSeconds?: number;
  primaryText: string;
  secondaryText: string;
  tertiaryText?: string;
  selectedBuffIds: string[];
}

export interface AnomalyStateSnapshot {
  id: number;
  key: 'conductive' | 'corrosion' | 'armor-break';
  label: string;
  level: number;
  sourceButtonId: string;
  sourceCharacterId: string;
  sourceCharacterName: string;
  sourceSkillStrengthSnapshot: number;
  effectValue: number;
  initialCorrosion?: number;
  tickCorrosionPerSecond?: number;
  maxCorrosion?: number;
  currentCorrosion?: number;
  durationSeconds?: number;
  primaryText: string;
  secondaryText: string;
  tertiaryText?: string;
  createdAt: number;
}

export interface SkillButtonAnomalyConfig {
  selectedStatuses: PersistedAnomalyCard[];
  selectedDamages: PersistedAnomalyCard[];
  selectedStateSnapshotIds: number[];
}

export interface HitResistanceInput {
  physicalResistance?: number;
  fireResistance?: number;
  electricResistance?: number;
  iceResistance?: number;
  natureResistance?: number;
}

export interface SkillButtonResistanceConfig {
  targetResistance: HitResistanceInput;
}

// ==================== v2 新缓存模型类型 ====================

/**
 * 持久化 SkillButton 类型
 * 存储在 skill-button 总表中
 */
export interface PersistedSkillButton {
  id: string;                           // 按钮唯一 ID
  characterId?: string;                 // 干员 ID（兼容旧缓存可缺省）
  characterName: string;                // 干员名称
  skillType: string;                    // 技能类型 A/B/E/Q
  staffIndex: number;                   // 干员索引
  nodeIndex: number;                    // 节点索引
  nodeNumber: number;                   // 节点编号
  position: { x: number; y: number };   // 位置坐标
  runtimeSkillId?: string;              // 自定义技能稳定标识
  skillDisplayName?: string;            // 技能显示名
  skillIconUrl?: string;                // 技能图标
  customHits?: SandboxSkillHit[];       // 自定义技能 hit 明细
  selectedBuff: string[];               // 选中的 Buff ID 列表（只存引用）
  buffStackCounts?: SkillButtonBuffStackCounts; // 按钮实例上的 Buff 层数，key 为 buffId
  anomalyConfig?: SkillButtonAnomalyConfig; // 按钮专属异常选择配置
  resistanceConfig?: SkillButtonResistanceConfig; // 按钮专属目标抗性配置
  panelConfig?: SkillButtonPanelConfig; // 按钮专属面板配置
  runtimeSnapshot?: SkillButtonRuntimeSnapshot | null; // 按钮运行时最终面板
  createdAt?: number;                   // 创建时间
  updatedAt?: number;                   // 更新时间
}

/**
 * skill-button 总表类型
 */
export type SkillButtonTable = Record<string, PersistedSkillButton>;

/**
 * buff-list 总表类型
 */
export type BuffList = SkillButtonBuff[];
