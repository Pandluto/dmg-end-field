/**
 * 全项目类型定义
 * 包含视图类型、技能类型、坐标/尺寸接口、干员数据结构、画布配置、应用状态等核心类型
 */

// 视图类型：selection = 干员选择界面，canvas = 谱线编辑界面
export type ViewType = 'selection' | 'canvas';

// 技能类型：A = 普通攻击，B = 战技，E = 连携技，Q = 终结技
export type SkillType = 'A' | 'B' | 'E' | 'Q';

// 二维坐标（画布内所有位置的统一表示）
export interface Position {
  x: number;
  y: number;
}

// 尺寸（宽高）
export interface Size {
  width: number;
  height: number;
}

// 干员属性类型：力量/敏捷/智识/意志（仅用作主副属性标签）
export type AbilityType = '力量' | '敏捷' | '智识' | '意志';

/**
 * 干员元素属性
 * physical = 物理，fire = 灼热，ice = 寒冷，electric = 电磁，nature = 自然
 */
export type ElementType = 'physical' | 'fire' | 'ice' | 'electric' | 'nature';

/**
 * 干员三维属性（力量/敏捷/智识/意志）及战斗属性（攻击力/生命值）
 * 同一干员在不同等级有不同的属性数值
 */
export interface CharacterAttribute {
  strength: number;
  agility: number;
  intelligence: number;
  will: number;
  atk: number;
  hp: number;
}

/**
 * 技能乘数（伤害计算用）
 * 描述技能各段伤害的倍率、追击、绝技、冷却、失衡值、能量等
 * [key: string] 允许任意额外乘数字段存在
 */
export interface SkillMultiplier {
  damage?: number;       // 总伤害倍率（%）
  hit1?: number;        // 第 1 段伤害
  hit2?: number;        // 第 2 段伤害
  hit3?: number;        // 第 3 段伤害
  hit4?: number;        // 第 4 段伤害
  hit5?: number;        // 第 5 段伤害
  execute?: number;     // 处刑倍率
  plunge?: number;      // 下落伤害
  crystalDamage?: number; // 水晶伤害
  sealDuration?: number;  // 封锁持续时间
  shotDamage?: number;     // 射击伤害
  tornadoDamage?: number;  // 龙卷风伤害
  dotTotal?: number;       // 持续伤害总倍率
  waveDamage?: number;     // 波动伤害
  extraDamage?: number;    // 额外伤害
  cooldown?: number;       // 冷却时间（秒）
  imbalance?: number;     // 失衡值
  energy?: number;         // 能量回复
  [key: string]: number | undefined;
}

/**
 * 技能数据结构
 * name = 技能名称，type = 技能类型（主动/被动等）
 * multipliers = 各段伤害乘数（用于战斗伤害计算）
 * imbalanceValue = 失衡值，abnormalType = 异常类型
 */
export interface Skill {
  name: string;
  type: string;
  description?: string;
  multipliers: Record<string, SkillMultiplier>;
  imbalanceValue?: number;
  abnormalType?: string;
}

export interface SandboxSkillHit {
  key: string;
  displayName: string;
  multiplier: number;
  levels?: Record<string, number>;
  element: ElementType;
  skillType: SkillType;
}

export interface SandboxSkill {
  id: string;
  displayName: string;
  buttonType: SkillType;
  iconUrl?: string;
  hitCount: number;
  source: 'official' | 'local';
  customHits?: SandboxSkillHit[];
}

export type OperatorBuffGroupKey = 'talent' | 'potential' | 'skill';
export type OperatorBuffCategory = 'positive' | 'condition';
export type OperatorBuffValueMode = 'fixed' | 'derived';
export type OperatorBuffDerivedSource = 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';

export interface OperatorBuffDerivedValue {
  source: OperatorBuffDerivedSource;
  perPointValue: number;
}

export interface OperatorBuffEffect {
  effectId: string;
  name: string;
  type: string;
  category: OperatorBuffCategory;
  value?: number;
  unit?: 'flat' | 'percent' | string;
  description?: string;
  raw?: string;
  valueMode?: OperatorBuffValueMode;
  derivedValue?: OperatorBuffDerivedValue;
}

export type OperatorBuffs = Record<OperatorBuffGroupKey, { effects: Record<string, OperatorBuffEffect> }>;

export interface SkillButtonSkillOption {
  nextSkillType: SkillType;
  nextRuntimeSkillId?: string;
  nextSkillDisplayName?: string;
  nextSkillIconUrl?: string;
  nextCustomHits?: SandboxSkillHit[];
}

export interface SkillButtonSkillChangePayload extends SkillButtonSkillOption {
  buttonId: string;
}

/**
 * 干员完整数据
 * 从 public/data/characters/*.json 加载，包含属性、技能、天赋、潜能等
 * avatarUrl / skillIconMap 为派生字段，由 AppContext 加载后注入，非 JSON 直写
 */
export interface Character {
  id: string;
  name: string;
  nameEn: string;
  rarity: number;            // 星级
  profession: string;       // 职业
  element: ElementType;      // 元素属性
  mainStat: AbilityType;      // 主属性
  subStat: AbilityType;       // 副属性
  tags?: string[];            // 标签（如"支援"等）
  position?: string[];       // 站位偏好
  attributes: {
    level1: CharacterAttribute;
    level20?: CharacterAttribute;
    level40?: CharacterAttribute;
    level60?: CharacterAttribute;
    level80?: CharacterAttribute;
    level90: CharacterAttribute;
  };
  talents?: Array<{           // 天赋
    name: string;
    description: string;
    levels: Record<string, Record<string, number>>;
  }>;
  potentials?: Array<{        // 潜能
    id: number;
    name: string;
    description: string;
    stats?: Record<string, number>;
  }>;
  skills: {
    normalAttack: Skill;  // 普通攻击（A）
    skill: Skill;         // 战技（B）
    chainSkill: Skill;    // 连携技（E）
    ultimate: Skill;      // 终结技（Q）
  };
  /** 派生字段：头像图片路径，由 AppContext 根据 name 生成 */
  avatarUrl?: string;
  /** 派生字段：四个技能的图标路径映射，由 AppContext 根据 name 和 SkillType 生成 */
  skillIconMap?: Partial<Record<SkillType, string>>;
  /** 数据来源：官方角色库或本地编辑器库 */
  librarySource?: 'official' | 'local';
  /** 运行时沙盒技能列表，官方角色为四键，本地角色可多技能 */
  sandboxSkills?: SandboxSkill[];
  /** 本地 operator-studio 干员自带 Buff */
  operatorBuffs?: OperatorBuffs;
}

/**
 * 画布上的技能按钮实例
 * 由 useCanvasDrag 拖拽吸附后创建，存储在 AppState.skillButtons 中
 */
export interface SkillButton {
  id: string;
  characterId: string;     // 所属干员 ID
  characterName: string;  // 所属干员名称（冗余存储，方便渲染）
  skillType: SkillType;    // 技能类型 A/B/E/Q
  position: Position;      // 按钮圆心在画布内的坐标
  staffIndex: number;      // 所属 staff 组索引（画布 Y 轴分组）
  lineIndex: number;       // 所属谱线索引
  nodeIndex?: number;      // 所属伤害节点索引（用于吸附去重）
  nodeNumber?: number;     // 节点编号（展示/持久化同步）
  isDragging: boolean;     // 是否正在拖拽
  isSelected: boolean;    // 是否被选中
  isFromSandbox: boolean;  // 是否从技能沙盒拖拽而来
  /** 派生字段：技能图标 URL，由 useCanvasDrag 创建按钮时注入 */
  skillIconUrl?: string;
  /** 运行时字段：自定义技能稳定标识 */
  runtimeSkillId?: string;
  /** 运行时字段：技能显示名 */
  skillDisplayName?: string;
  /** 运行时字段：自定义技能 hit 明细 */
  customHits?: SandboxSkillHit[];
  /** 派生字段：干员元素属性，用于渲染底色，由 useCanvasDrag 注入 */
  element?: string;
  /** 运行时字段：是否锁定（锁定后右键不能删除），不进入持久化 */
  isLocked?: boolean;
}

/**
 * 碰撞检测结果
 * 用于检测画布上两个技能按钮是否重叠
 */
export interface CollisionResult {
  hasCollision: boolean;
  collidingButtonIds: string[];
}

/**
 * 谱线（staff）
 * 一条水平谱线，对应一个干员的一个技能施放时机
 * index = 谱线在 staff 组内的序号，y = 谱线在画布内的 Y 绝对坐标
 */
export interface Staff {
  index: number;
  characterId: string | null;   // 该谱线当前绑定的干员 ID（null 表示空）
  characterName: string | null;
  y: number;                    // 谱线圆心 Y 坐标（画布内绝对坐标）
}

/**
 * 画布配置
 * 定义谱线布局（数量/间距）、节点数量/大小、技能按钮尺寸、边距等
 */
export interface CanvasConfig {
  canvasWidthPercent: number;  // 画布占视口宽度比例
  canvasHeight: number;        // 画布总高度
  staffCount: number;          // staff（干员）数量上限
  lineCount: number;           // 每条谱线的节点数量（时间轴刻度）
  staffHeight: number;        // 谱线本身的高度（渲染线条的粗细）
  staffMarginTop: number;     // staff 组内第一条谱线的上边距
  staffMarginBottom: number;   // staff 组内最后一条谱线的下边距
  nodeCount: number;           // 每条谱线上的节点（时间点）数量
  nodeSize: number;            // 节点圆点大小（渲染用）
  skillButtonSize: number;     // 技能按钮直径
  avatarSize: number;         // 干员头像大小
  marginLeft: number;          // 画布左侧安全边距（节点不吸附到最左边缘）
  marginRight: number;         // 画布右侧安全边距
  sandboxWidth: number;        // 技能沙盒面板宽度
  snapThreshold: number;        // 吸附阈值（px，小于此距离自动吸附）
  nodeSpacing: number;          // 节点之间的水平间距
  groupSpacing: number;         // staff 组之间的垂直间距
  staffGroupHeight: number;     // 单个 staff 组的总高度
}

/**
 * 应用全局状态
 * currentView = 当前界面，selectedCharacters = 已选干员列表，skillButtons = 画布上所有技能按钮
 */
export interface AppState {
  currentView: ViewType;
  selectedCharacters: Character[];   // 已选中的干员列表（最多 4 人）
  canvasConfig: CanvasConfig;       // 画布配置
  skillButtons: SkillButton[];     // 画布上所有技能按钮
  loadedCharacters: Character[];    // 已加载的所有干员数据
}

/** 技能标签（用于 UI 显示） */
export const SKILL_LABELS: Record<SkillType, string> = {
  A: 'A',
  B: 'B',
  E: 'E',
  Q: 'Q',
};

/**
 * 技能名称映射（用于拼接资源路径）
 * 对应 public/assets/avatars/<角色名>/<角色名><技能名>.png
 */
export const SKILL_NAMES: Record<SkillType, string> = {
  A: '普通攻击',
  B: '战技',
  E: '连携技',
  Q: '终结技',
};

/** 默认画布配置（DEFAULT_CANVAS_CONFIG）*/
export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  canvasWidthPercent: 0.6,
  canvasHeight: 600,
  staffCount: 2,
  lineCount: 4,
  staffHeight: 2,
  staffMarginTop: 60,
  staffMarginBottom: 60,
  nodeCount: 40,
  nodeSize: 2,
  skillButtonSize: 44,
  avatarSize: 40,
  marginLeft: 80,
  marginRight: 40,
  sandboxWidth: 200,
  snapThreshold: 10,
  nodeSpacing: 22,
  groupSpacing: 0,
  staffGroupHeight: 300,
};

// ==================== 排轴持久化数据类型 ====================

/**
 * 技能按钮数据（用于排轴持久化）
 * 存储在谱线上的技能按钮信息
 */
export interface SkillButtonData {
  id: string;              // 按钮唯一 ID
  characterId?: string;    // 干员 ID（用于和本地角色配置缓存对齐）
  characterName: string;   // 干员名称（如：陈千语）
  skillType: SkillType;    // 技能类型 A/B/E/Q
  staffIndex: number;      // 干员索引（0=管理员, 1=干员2, 2=干员3, 3=干员4）
  nodeIndex: number;       // 节点索引（0 ~ N）
  nodeNumber: number;      // 节点编号（1 ~ 50, 51 ~ 100, ...）
  position: Position;      // 位置坐标
  runtimeSkillId?: string; // 自定义技能稳定标识
  skillDisplayName?: string; // 技能显示名
  skillIconUrl?: string;   // 技能图标
  customHits?: SandboxSkillHit[]; // 自定义技能 hit 明细
  buffIds?: string[];      // 关联的 Buff ID 列表（持久化用）
}

/**
 * 单个干员的谱线数据
 */
export interface StaffLineData {
  staffIndex: number;              // 干员索引
  characterName: string;           // 干员名称
  occupiedNodes: number[];         // 已被占用的节点索引列表（自动排序）
  buttons: SkillButtonData[];      // 该干员谱线上的所有按钮（按 nodeIndex 排序）
}

/**
 * 排轴总数据结构
 * 包含 4 个干员的谱线数据
 */
export interface TimelineData {
  version: string;                 // 数据版本号
  createdAt: number;               // 创建时间
  updatedAt: number;               // 最后更新时间
  staffLines: StaffLineData[];     // 4 个干员的谱线数据
}
