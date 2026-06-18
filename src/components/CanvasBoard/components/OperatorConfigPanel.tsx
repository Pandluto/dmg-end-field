import { Character } from '../../../types';
import React from 'react';
import { buildWeaponSearchIndex, searchWeapons } from '../../../utils/weaponFuzzySearch';
import { parseEquipmentTextAndFill, isPercentField, EquipmentConfig } from '../../../utils/equipmentParser';
import {
  CharacterConfigJson,
  DamageBonusSnapshot,
  PanelSummary,
  SkillLevelMode,
  SkillPanelKey,
  WeaponPotentialMode,
} from '../../../types/storage';
import {
  getCharacterConfigMap,
  setCharacterConfigMap,
  getRuntimeOperatorTemplateById,
} from '../../../utils/storage';
import type { RuntimeOperatorTemplateSkill } from '../../../core/templates/operatorTemplate';
import { normalizeAssetUrl, resolvePublicPath } from '../../../utils/assetResolver';
import DeferredNumberInput, {
  formatPercentDisplayValue,
  parsePercentDisplayValue,
} from '../../DeferredNumberInput';

interface CharacterMaxData {
  name: string;
  profession: string;
  weapon: string;
  element: string;
  mainStat: string;
  subStat: string;
  tags?: string[];
  attributes?: {
    level90?: {
      strength: number;
      agility: number;
      intelligence: number;
      will: number;
      atk: number;
      hp: number;
    };
  };
  talents?: Array<{
    name: string;
    description: string;
  }>;
  skills?: {
    normalAttack?: { name: string; type: string };
    skill?: { name: string; type: string };
    chainSkill?: { name: string; type: string };
    ultimate?: { name: string; type: string };
  };
}

interface WeaponMaxSkillLevelData {
  value?: number;
  description?: string;
  // skill3 的无条件面板贡献放在 passive（条件效果不在这里）
  passive?: Record<string, number>;
}

interface WeaponMaxSkillData {
  name: string;
  statType?: string;
  levels?: Record<string, WeaponMaxSkillLevelData>;
}

interface WeaponMaxData {
  name: string;
  attackGrowth?: Record<string, number>;
  skills?: Record<string, WeaponMaxSkillData>;
}

interface WeaponListItem {
  name: string;
}

interface WeaponBuffItem {
  displayName?: string;
  level?: string;
  condition?: string;
  description?: string;
}

interface WeaponBuffData {
  name: string;
  buffs?: WeaponBuffItem[];
}

type WeaponUnconditionalSourceSlot = 'skill1' | 'skill2' | 'skill3';

interface LegacyEquipmentConfig extends Partial<EquipmentConfig> {
  mainStat?: number;
  subStat?: number;
  atkPercent?: number;
  burnDmgBonus?: number;
  artsDmgBonus?: number;
  magicDmgBoost?: number;
}

interface OperatorConfigPanelProps {
  isOpen: boolean;
  activeCharacterId: string | null;
  selectedCharacters: Character[];
  onSelectCharacter: (characterId: string) => void;
  onClose: () => void;
}

type AbilityField = 'strength' | 'agility' | 'intelligence' | 'will';
const NONE_WEAPON_NAME = '无';
const DEFAULT_SKILL_LEVEL_MODE_MAP: Record<SkillPanelKey, SkillLevelMode> = {
  A: 'L9',
  B: 'L9',
  E: 'L9',
  Q: 'L9',
};
const DEFAULT_EQUIPMENT: EquipmentConfig = {
  strength: 0,
  agility: 0,
  intelligence: 0,
  will: 0,
  mainStatBoost: 0,
  subStatBoost: 0,
  allStatBoost: 0,
  flatAtk: 0,
  atkPercentBoost: 0,
  critRateBoost: 0,
  critDmgBonusBoost: 0,
  defense: 0,
  hp: 0,
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0,
  magicDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  normalAttackDmgBonus: 0,
  dotDmgBonus: 0,
  imbalanceDmgBonus: 0,
  sourceSkillBoost: 0,
  allSkillDmgBonus: 0,
  allDmgBonus: 0,
};

// 能力字段映射
const ABILITY_FIELD_MAP: Record<string, AbilityField> = {
  力量: 'strength',
  敏捷: 'agility',
  智识: 'intelligence',
  意志: 'will',
};
// 能力字段映射
const STAT_TYPE_TO_ABILITY_FIELD: Record<string, AbilityField> = {
  strength: 'strength',
  agility: 'agility',
  intelligence: 'intelligence',
  will: 'will',
};
const WEAPON_FORMAL_STAT_TYPES = new Set<string>([
  'atkPercent',
  'fireDmgBonus',
  'natureDmgBonus',
  'ultimateChargeEfficiency',
  'hpPercent',
  'electricDmgBonus',
  'critRate',
  'magicDmgBonus',
  'physicalDmgBonus',
  'iceDmgBonus',
  'memoryStrength',
  'healingBonus',
]);
const WEAPON_PERCENTLIKE_STAT_TYPES = new Set<string>([
  'atkPercent',
  'fireDmgBonus',
  'natureDmgBonus',
  'ultimateChargeEfficiency',
  'hpPercent',
  'electricDmgBonus',
  'critRate',
  'magicDmgBonus',
  'physicalDmgBonus',
  'iceDmgBonus',
  'healingBonus',
]);
const LEGACY_SKILL3_PASSIVE_PERCENTLIKE_STAT_TYPES = new Set<string>([
  'atkPercent',
  'subStat',
  'subStatBoost',
  'allStatBoost',
  'critRate',
  'critDmgBonus',
  'magicDmgBoost',
  'physicalDmgBonus',
  'burnDmgBonus',
  'fireDmgBonus',
  'iceDmgBonus',
  'natureDmgBonus',
  'electricDmgBonus',
  'magicDmgBonus',
  'allSkillDmgBonus',
  'skillDmgBonus',
  'chainSkillDmgBonus',
  'ultimateDmgBonus',
  'normalAttackDmgBonus',
  'dotDmgBonus',
]);
// 默认潜在
const getDefaultCharacterPotential = (rarity?: number) => (rarity === 6 ? '0潜' : '满潜');
// 装备配置
const normalizeEquipment = (equipment?: LegacyEquipmentConfig): EquipmentConfig => ({
  ...DEFAULT_EQUIPMENT,
  ...equipment,
  mainStatBoost: equipment?.mainStatBoost ?? equipment?.mainStat ?? 0,
  subStatBoost: equipment?.subStatBoost ?? equipment?.subStat ?? 0,
  atkPercentBoost: equipment?.atkPercentBoost ?? equipment?.atkPercent ?? 0,
  fireDmgBonus: equipment?.fireDmgBonus ?? equipment?.burnDmgBonus ?? 0,
  magicDmgBonus: equipment?.magicDmgBonus ?? equipment?.artsDmgBonus ?? equipment?.magicDmgBoost ?? 0,
});
// 装备配置行
const EQUIPMENT_FORM_ROWS: Array<Array<{ key: keyof EquipmentConfig; label: string; isPercent: boolean }>> = [
  [
    { key: 'strength', label: '力量', isPercent: false },
    { key: 'agility', label: '敏捷', isPercent: false },
    { key: 'intelligence', label: '智识', isPercent: false },
    { key: 'will', label: '意志', isPercent: false },
    { key: 'mainStatBoost', label: '主能力', isPercent: true },
    { key: 'subStatBoost', label: '副能力', isPercent: true },
  ],
  [
    { key: 'critRateBoost', label: '暴击率', isPercent: true },
    { key: 'critDmgBonusBoost', label: '暴击伤害', isPercent: true },
    { key: 'defense', label: '防御值', isPercent: false },
    { key: 'hp', label: '生命', isPercent: false },
  ],
  [
    { key: 'physicalDmgBonus', label: '物理伤害加成', isPercent: true },
    { key: 'fireDmgBonus', label: '灼热伤害加成', isPercent: true },
    { key: 'electricDmgBonus', label: '电磁伤害加成', isPercent: true },
  ],
  [
    { key: 'iceDmgBonus', label: '寒冷伤害加成', isPercent: true },
    { key: 'natureDmgBonus', label: '自然伤害加成', isPercent: true },
    { key: 'magicDmgBonus', label: '法术伤害加成', isPercent: true },
  ],
  [
    { key: 'skillDmgBonus', label: '战技伤害加成', isPercent: true },
    { key: 'chainSkillDmgBonus', label: '连携技伤害加成', isPercent: true },
    { key: 'ultimateDmgBonus', label: '终结技伤害加成', isPercent: true },
  ],
  [
    { key: 'normalAttackDmgBonus', label: '普通攻击伤害加成', isPercent: true },
    { key: 'dotDmgBonus', label: '持续伤害加成', isPercent: true },
    { key: 'imbalanceDmgBonus', label: '对失衡目标伤害加成', isPercent: true },
    { key: 'sourceSkillBoost', label: '源石技艺强度', isPercent: false },
  ],
];

// 每个角色在运行时维护一份配置快照：
// - 武器选择/潜能
// - 预留装备输入
// - 最近一次面板计算结果与信息模块渲染文本
const DEFAULT_DAMAGE_BONUS_SNAPSHOT: DamageBonusSnapshot = {
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
const STORAGE_WRITE_DEBOUNCE_MS = 300;

const initCharacterConfig = (
  characterId: string,
  characterName: string,
  rarity?: number
): CharacterConfigJson => ({
  characterId,
  characterName,
  characterPotential: getDefaultCharacterPotential(rarity),
  skillLevelModeMap: { ...DEFAULT_SKILL_LEVEL_MODE_MAP },
  weaponName: NONE_WEAPON_NAME,
  weaponPotentialMode: 'P0',
  equipment: { ...DEFAULT_EQUIPMENT },
  panelSnapshot: null,
  infoSnapshot: [],
  infoSnap: { ...DEFAULT_DAMAGE_BONUS_SNAPSHOT },
  weaponBuffSnapshot: [],
});

const toFixedNumber = (value: number, digits = 2) => Number(value.toFixed(digits));
const toPercentText = (value: number, digits = 2) => `${toFixedNumber(value * 100, digits)}%`;

const readCharacterConfigMapFromSession = (): Record<string, CharacterConfigJson> => {
  // v3: 统一通过 storage.ts 的兼容层读取，合并 input + computed + display
  return getCharacterConfigMap();
};

const writeCharacterConfigMapToSession = (value: Record<string, CharacterConfigJson>) => {
  // v3: 通过 storage.ts 的兼容层统一写入，自动拆分为 input + computed + display
  setCharacterConfigMap(value);
};

export function OperatorConfigPanel({
  isOpen,
  activeCharacterId,
  selectedCharacters,
  onSelectCharacter,
  onClose,
}: OperatorConfigPanelProps) {
  // 注意：不能在 Hook 之前做任何条件 return，否则违反 React Hook 规则
  // 所有 Hook 必须无条件执行，"关闭时不渲染"的逻辑移到最终 JSX return

  // 头像层最多展示 4 人，和选人上限保持一致
  const visibleCharacters = selectedCharacters.slice(0, 4);
  // 若外部未传入 activeCharacterId，默认回退到当前可见首个角色
  const resolvedActiveCharacterId = activeCharacterId ?? visibleCharacters[0]?.id ?? null;
  // 当前角色对象供右侧头像高亮、左侧数据渲染复用
  const activeCharacter = visibleCharacters.find((character) => character.id === resolvedActiveCharacterId) ?? null;
  const [characterMaxData, setCharacterMaxData] = React.useState<CharacterMaxData | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // 四个技能卡片分别维护等级开关，默认统一为 L9（9级）
  const [skillLevelModeMap, setSkillLevelModeMap] = React.useState<Record<SkillPanelKey, SkillLevelMode>>({ ...DEFAULT_SKILL_LEVEL_MODE_MAP });
  const [weaponOptions, setWeaponOptions] = React.useState<string[]>([]);
  const [weaponNameMap, setWeaponNameMap] = React.useState<Record<string, string>>({});
  const [weaponPotentialModeMap, setWeaponPotentialModeMap] = React.useState<Record<string, WeaponPotentialMode>>({});
  const [isWeaponDrawerOpen, setIsWeaponDrawerOpen] = React.useState(false);
  const [isWeaponDataDrawerOpen, setIsWeaponDataDrawerOpen] = React.useState(false);
  const [isWeaponListLoading, setIsWeaponListLoading] = React.useState(false);
  const [weaponListLoadError, setWeaponListLoadError] = React.useState<string | null>(null);
  const [weaponMaxDataMap, setWeaponMaxDataMap] = React.useState<Record<string, WeaponMaxData>>({});
  const [weaponBuffDataMap, setWeaponBuffDataMap] = React.useState<Record<string, WeaponBuffData>>({});
  const [isWeaponDataLoading, setIsWeaponDataLoading] = React.useState(false);
  const [weaponDataLoadError, setWeaponDataLoadError] = React.useState<string | null>(null);
  const [isWeaponBuffLoading, setIsWeaponBuffLoading] = React.useState(false);
  const [weaponBuffLoadError, setWeaponBuffLoadError] = React.useState<string | null>(null);
  const [characterConfigMap, setCharacterConfigMap] = React.useState<Record<string, CharacterConfigJson>>(
    () => readCharacterConfigMapFromSession()
  );
  const [ctiInputValue, setCtiInputValue] = React.useState('');
  const [isCtiDrawerOpen, setIsCtiDrawerOpen] = React.useState(false);
  const [isEquipCopyDrawerOpen, setIsEquipCopyDrawerOpen] = React.useState(false);
  const [equipCopyText, setEquipCopyText] = React.useState('');
  const [equipSyncTrigger, setEquipSyncTrigger] = React.useState(0);
  const weaponSelectorRef = React.useRef<HTMLDivElement | null>(null);
  const weaponDataHostRef = React.useRef<HTMLDivElement | null>(null);
  const ctiSelectorRef = React.useRef<HTMLDivElement | null>(null);
  const equipCopyDrawerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    // 角色为空时清理状态，防止展示上一次角色残留数据
    if (!activeCharacter?.name) {
      setCharacterMaxData(null);
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    // 获取 runtime template 检查是否有基础属性
    const runtimeTemplate = getRuntimeOperatorTemplateById(activeCharacter.id);
    const hasTemplateAttributes = runtimeTemplate?.attributes &&
      typeof runtimeTemplate.attributes.atk === 'number';

    // 如果 runtime template 有完整基础属性，不需要请求 max.json
    if (hasTemplateAttributes) {
      setCharacterMaxData(null);
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    let aborted = false;
    const controller = new AbortController();
    // 读取角色 max 面板数据：按"角色名/角色名max.json"约定路径拉取
    // 仅作为 runtime template 缺字段时的 fallback
    const loadMaxData = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const response = await fetch(
          resolvePublicPath(`data/characters/${encodeURIComponent(activeCharacter.name)}/${encodeURIComponent(activeCharacter.name)}max.json`),
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`读取失败: ${response.status}`);
        }
        // 校验 content-type，防止 HTML 错误页面被当 JSON 解析
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('响应格式错误：非 JSON 数据');
        }
        const payload = (await response.json()) as CharacterMaxData;
        if (!aborted) {
          // 请求成功后更新面板数据
          setCharacterMaxData(payload);
        }
      } catch (error) {
        if (!aborted) {
          // 失败时清空数据并记录错误，避免旧数据误导
          setCharacterMaxData(null);
          setLoadError(error instanceof Error ? error.message : '读取失败');
        }
      } finally {
        if (!aborted) {
          setIsLoading(false);
        }
      }
    };

    loadMaxData();
    return () => {
      // 组件卸载或角色切换时中断旧请求，避免竞态覆盖新角色数据
      aborted = true;
      controller.abort();
    };
  }, [activeCharacter?.id, activeCharacter?.name]);

  React.useEffect(() => {
    let aborted = false;
    const controller = new AbortController();
    const loadWeaponsList = async () => {
      try {
        setIsWeaponListLoading(true);
        setWeaponListLoadError(null);
        const response = await fetch(resolvePublicPath('data/weapons/weapons-list.json'), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`读取失败: ${response.status}`);
        }
        const payload = (await response.json()) as WeaponListItem[];
        const nextOptions = payload
          .map((item) => item.name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0);
        if (!aborted) {
          setWeaponOptions(nextOptions);
        }
      } catch (error) {
        if (!aborted) {
          setWeaponOptions([]);
          setWeaponListLoadError(error instanceof Error ? error.message : '读取失败');
        }
      } finally {
        if (!aborted) {
          setIsWeaponListLoading(false);
        }
      }
    };

    loadWeaponsList();
    return () => {
      aborted = true;
      controller.abort();
    };
  }, []);

  React.useEffect(() => {
    if (!isWeaponDrawerOpen && !isWeaponDataDrawerOpen && !isCtiDrawerOpen && !isEquipCopyDrawerOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        weaponSelectorRef.current &&
        target instanceof Node &&
        !weaponSelectorRef.current.contains(target)
      ) {
        setIsWeaponDrawerOpen(false);
      }
      if (
        isWeaponDataDrawerOpen &&
        weaponDataHostRef.current &&
        target instanceof Node &&
        !weaponDataHostRef.current.contains(target)
      ) {
        setIsWeaponDataDrawerOpen(false);
      }
      if (ctiSelectorRef.current && target instanceof Node && !ctiSelectorRef.current.contains(target)) {
        setIsCtiDrawerOpen(false);
      }
      if (
        isEquipCopyDrawerOpen &&
        equipCopyDrawerRef.current &&
        target instanceof Node &&
        !equipCopyDrawerRef.current.contains(target)
      ) {
        setIsEquipCopyDrawerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isWeaponDrawerOpen, isWeaponDataDrawerOpen, isCtiDrawerOpen, isEquipCopyDrawerOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (isCtiDrawerOpen) {
        setIsCtiDrawerOpen(false);
        return;
      }

      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCtiDrawerOpen, isOpen, onClose]);

  React.useEffect(() => {
    setIsWeaponDrawerOpen(false);
    setIsWeaponDataDrawerOpen(false);
    setIsCtiDrawerOpen(false);
    setCtiInputValue('');
  }, [resolvedActiveCharacterId]);

  // ========== Runtime Template 统一驱动 ==========
  // 读取运行时模板（支持官方角色和本地角色统一模板链）
  const runtimeTemplate = resolvedActiveCharacterId
    ? getRuntimeOperatorTemplateById(resolvedActiveCharacterId)
    : null;

  // 技能列表来源：从 runtime template 派生
  const runtimeSkillEntries: RuntimeOperatorTemplateSkill[] = runtimeTemplate?.skills ?? [];

  // 基础数据区来源：优先从 runtime template 派生，fallback 到 max.json
  // runtime template 中的基础属性
  const templateAttributes = runtimeTemplate?.attributes;
  const templateElement = runtimeTemplate?.element;
  const templateMainStat = runtimeTemplate?.mainStat;
  const templateSubStat = runtimeTemplate?.subStat;
  const templateLevel = runtimeTemplate?.level ?? 90;

  // 判断是否有 runtime template 基础数据
  const hasRuntimeBaseData = !!templateAttributes && typeof templateAttributes.atk === 'number';

  // 常用派生数据：优先从 runtime template，fallback 到 max.json
  const level90 = hasRuntimeBaseData
    ? {
        strength: templateAttributes!.strength,
        agility: templateAttributes!.agility,
        intelligence: templateAttributes!.intelligence,
        will: templateAttributes!.will,
        atk: templateAttributes!.atk,
        hp: templateAttributes!.hp,
      }
    : characterMaxData?.attributes?.level90;


  const weaponStateKey = resolvedActiveCharacterId ?? '__panel__';
  const currentCharacterConfig = characterConfigMap[weaponStateKey] ?? null;
  const currentEquipment = normalizeEquipment(currentCharacterConfig?.equipment);
  const attributeTags = [
    { key: '力量', label: '力量', value: currentCharacterConfig?.panelSnapshot?.strength ?? level90?.strength ?? '-' },
    { key: '敏捷', label: '敏捷', value: currentCharacterConfig?.panelSnapshot?.agility ?? level90?.agility ?? '-' },
    { key: '智识', label: '知识', value: currentCharacterConfig?.panelSnapshot?.intelligence ?? level90?.intelligence ?? '-' },
    { key: '意志', label: '意志', value: currentCharacterConfig?.panelSnapshot?.will ?? level90?.will ?? '-' },
  ];
  const currentWeaponName = weaponNameMap[weaponStateKey] ?? currentCharacterConfig?.weaponName ?? NONE_WEAPON_NAME;
  const currentWeaponPotentialMode = weaponPotentialModeMap[weaponStateKey] ?? currentCharacterConfig?.weaponPotentialMode ?? 'P0';
  const currentWeaponMaxData = currentWeaponName !== NONE_WEAPON_NAME ? weaponMaxDataMap[currentWeaponName] ?? null : null;
  const currentWeaponBuffData = currentWeaponName !== NONE_WEAPON_NAME ? weaponBuffDataMap[currentWeaponName] ?? null : null;
  const potentialTag = currentWeaponPotentialMode === 'PMAX' ? '满潜' : '0潜';
  const potentialSkillCommonLevel = '9';
  const potentialSkill3Level = currentWeaponPotentialMode === 'PMAX' ? '9' : '4';
  const weaponAttackAt90 = currentWeaponMaxData?.attackGrowth?.['90'] ?? '-';
  const weaponSkill1 = currentWeaponMaxData?.skills?.skill1;
  const weaponSkill2 = currentWeaponMaxData?.skills?.skill2;
  const weaponSkill3 = currentWeaponMaxData?.skills?.skill3;
  const weaponSkill1Text = weaponSkill1?.levels?.[potentialSkillCommonLevel]?.description ?? '-';
  const weaponSkill2Text = weaponSkill2?.levels?.[potentialSkillCommonLevel]?.description ?? '-';
  const weaponSkill3Text = weaponSkill3?.levels?.[potentialSkill3Level]?.description ?? '-';
  const weaponSkill1LevelData = weaponSkill1?.levels?.[potentialSkillCommonLevel];
  const weaponSkill2LevelData = weaponSkill2?.levels?.[potentialSkillCommonLevel];
  const weaponSkill3LevelData = weaponSkill3?.levels?.[potentialSkill3Level];
  const weaponSkill3Passive = weaponSkill3LevelData?.passive ?? {};
  const weaponSkill1Value = typeof weaponSkill1LevelData?.value === 'number' ? weaponSkill1LevelData.value : 0;
  const weaponSkill2Value = typeof weaponSkill2LevelData?.value === 'number' ? weaponSkill2LevelData.value : 0;
  const weaponUnconditionalSourceLines: string[] = [];
  const weaponAbilityFlatByField: Record<AbilityField, number> = {
    strength: 0,
    agility: 0,
    intelligence: 0,
    will: 0,
  };
  let weaponMainStatFlatBonus = 0;
  let weaponSubStatFlatBonus = 0;
  let weaponMainStatBoostBonus = 0;
  let weaponSubStatBoostBonus = 0;
  let weaponAllStatBoostBonus = 0;

  let weaponPassiveAtkPercent = 0;
  let weaponPassiveAtk = 0;
  let weaponCritRate = 0;
  let weaponHealingBonus = 0;
  let weaponUltimateChargeEfficiency = 0;
  let weaponHpPercent = 0;

  let weaponMemoryStrength = 0;
 
  let weaponAllSkillDmgBonus = 0;
  let weaponSkillDmgBonus = 0;
  let weaponChainSkillDmgBonus = 0;
  let weaponUltimateDmgBonus = 0;
  let weaponNormalAttackDmgBonus = 0;
  let weaponDotDmgBonus = 0;


  //let weaponAllDmgBonus = 0;

  let weaponPhysicalDmgBonus = 0;
  let weaponFireDmgBonus = 0;
  let weaponElectricDmgBonus = 0;
  let weaponIceDmgBonus = 0;
  let weaponNatureDmgBonus = 0;
  let weaponMagicDmgBonus = 0;

  const weaponOtherUnconditionalMap: Record<string, number> = {};// 其他非百分比加成
  // 百分比加成
  const isPercentLike = (statType: string, value: number) =>
    WEAPON_PERCENTLIKE_STAT_TYPES.has(statType) ||
    LEGACY_SKILL3_PASSIVE_PERCENTLIKE_STAT_TYPES.has(statType) ||
    (value >= -1 && value <= 1);
  const formatUnconditionalValue = (statType: string, value: number) =>
    isPercentLike(statType, value) ? toPercentText(value) : `${toFixedNumber(value)}`;
  const recordWeaponUnconditional = (
    source: string,
    sourceSlot: WeaponUnconditionalSourceSlot,
    statType: string,
    value: number
  ) => {
    if (!statType || !Number.isFinite(value)) {
      return;
    }
    weaponUnconditionalSourceLines.push(`${source} ${statType}: ${formatUnconditionalValue(statType, value)}`);
    if (sourceSlot === 'skill1' && statType in STAT_TYPE_TO_ABILITY_FIELD) {
      const abilityField = STAT_TYPE_TO_ABILITY_FIELD[statType];
      weaponAbilityFlatByField[abilityField] += value;
      return;
    }
    if (sourceSlot === 'skill2' && !WEAPON_FORMAL_STAT_TYPES.has(statType)) {
      weaponOtherUnconditionalMap[statType] = (weaponOtherUnconditionalMap[statType] ?? 0) + value;
      return;
    }
  
    switch (statType) {
      case 'mainStat':
      case 'mainStatBoost':
        weaponMainStatFlatBonus += value;
        return;
      case 'subStatFlat':
        weaponSubStatFlatBonus += value;
        return;
      case 'mainStatBoostRate':
        weaponMainStatBoostBonus += value;
        return;
      case 'subStat':
      case 'subStatBoost':
        weaponSubStatBoostBonus += value;
        return;
      case 'allStatBoost':
        weaponAllStatBoostBonus += value;
        return;
      case 'atkPercent':
        weaponPassiveAtkPercent += value;
        return;
      case 'atk':
        weaponPassiveAtk += value;
        return;
      case 'critRate':
        weaponCritRate += value;
        return;
      case 'critDmgBonus':
        weaponOtherUnconditionalMap[statType] = (weaponOtherUnconditionalMap[statType] ?? 0) + value;
        return;
      case 'memoryStrength':
        weaponMemoryStrength += value;
        return;
      case 'ultimateChargeEfficiency':
        weaponUltimateChargeEfficiency += value;
        return;
      case 'hpPercent':
        weaponHpPercent += value;
        return;
      case 'healingBonus':
        weaponHealingBonus += value;
        return;
      case 'allSkillDmgBonus':
        weaponAllSkillDmgBonus += value;
        return;
      case 'skillDmgBonus':
        weaponSkillDmgBonus += value;
        return;
      case 'chainSkillDmgBonus':
        weaponChainSkillDmgBonus += value;
        return;
      case 'ultimateDmgBonus':
        weaponUltimateDmgBonus += value;
        return;
      case 'normalAttackDmgBonus':
        weaponNormalAttackDmgBonus += value;
        return;
      case 'dotDmgBonus':
        weaponDotDmgBonus += value;
        return;
      case 'magicDmgBoost':
        weaponMagicDmgBonus += value;
        return;
      case 'burnDmgBonus':
        weaponFireDmgBonus += value;
        return;
      case 'magicDmgBonus':
        weaponMagicDmgBonus += value;
        return;
      case 'physicalDmgBonus':
        weaponPhysicalDmgBonus += value;
        return;
      case 'fireDmgBonus':
        weaponFireDmgBonus += value;
        return;
      case 'electricDmgBonus':
        weaponElectricDmgBonus += value;
        return;
      case 'iceDmgBonus':
        weaponIceDmgBonus += value;
        return;
      case 'natureDmgBonus':
        weaponNatureDmgBonus += value;
        return;
      default:
        weaponOtherUnconditionalMap[statType] = (weaponOtherUnconditionalMap[statType] ?? 0) + value;
    }

  };
  if (weaponSkill1?.statType && Number.isFinite(weaponSkill1Value)) {
    recordWeaponUnconditional(`skill1(${weaponSkill1.name ?? '-'})`, 'skill1', weaponSkill1.statType, weaponSkill1Value);
  }
  if (weaponSkill2?.statType && Number.isFinite(weaponSkill2Value)) {
    recordWeaponUnconditional(`skill2(${weaponSkill2.name ?? '-'})`, 'skill2', weaponSkill2.statType, weaponSkill2Value);
  }
  Object.entries(weaponSkill3Passive).forEach(([passiveType, passiveValue]) => {
    if (typeof passiveValue === 'number') {
      recordWeaponUnconditional(`skill3(${weaponSkill3?.name ?? '-'})`, 'skill3', passiveType, passiveValue);
    }
  });
  const weaponBuffSnapshot =
    currentWeaponBuffData?.buffs?.map((buff) => {
      const name = buff.displayName ?? '未命名';
      const condition = buff.condition ?? '无条件说明';
      const description = buff.description ?? '';
      return description ? `${name}｜条件: ${condition}｜效果: ${description}` : `${name}｜条件: ${condition}`;
    }) ??
    (isWeaponBuffLoading
      ? ['武器条件说明读取中']
      : weaponBuffLoadError
        ? [`武器条件说明读取失败: ${weaponBuffLoadError}`]
        : []);
  const weaponConditionalTriggerLines =
    currentWeaponBuffData?.buffs?.map((buff) => {
      const name = buff.displayName ?? '未命名';
      const condition = buff.condition ?? '条件未定义';
      const description = buff.description ?? '';
      return description ? `  ${name}：${condition}｜${description}` : `  ${name}：${condition}`;
    }) ??
    (isWeaponBuffLoading
      ? ['  条件触发读取中...']
      : weaponBuffLoadError
        ? [`  条件触发读取失败：${weaponBuffLoadError}`]
        : ['  暂无']);
  const weaponOtherUnconditionalLines = Object.entries(weaponOtherUnconditionalMap).map(
    ([key, value]) => `  ${key}: ${formatUnconditionalValue(key, value)}`
  );
  const weaponDataConsoleText = [
    `武器：${currentWeaponName}`,
    `等级：90`,
    `潜能：${potentialTag}`,
    `攻击：${weaponAttackAt90}`,
    `技能1：${weaponSkill1?.name ?? '-'} | ${weaponSkill1Text}`,
    `技能2：${weaponSkill2?.name ?? '-'} | ${weaponSkill2Text}`,
    `技能3：${weaponSkill3?.name ?? '-'} | ${weaponSkill3Text}`,
    '无条件触发：',
    ...(weaponUnconditionalSourceLines.length > 0 ? weaponUnconditionalSourceLines.map((line) => `  ${line}`) : ['  暂无']),
    ...weaponOtherUnconditionalLines,
    '有条件触发：',
    ...weaponConditionalTriggerLines,
  ].join('\n');
  const ctiKeyword = ctiInputValue.trim();
  const infoSnapshotLines = currentCharacterConfig?.infoSnapshot ?? [];
  const panelAtkDisplay = currentCharacterConfig?.panelSnapshot?.atk ?? '';
  const weaponSearchIndex = React.useMemo(() => buildWeaponSearchIndex(weaponOptions), [weaponOptions]);
  const ctiMatchedWeaponOptions = React.useMemo(() => {
    if (!ctiKeyword) {
      return [];
    }
    return searchWeapons(ctiKeyword, weaponSearchIndex);
  }, [ctiKeyword, weaponSearchIndex]);
  const handleWeaponSelect = (weaponName: string) => {
    // 1) 兼容当前武器模块已有状态
    setWeaponNameMap((prev) => ({
      ...prev,
      [weaponStateKey]: weaponName,
    }));
    // 2) 同步写回角色配置快照，保证“按角色记忆”
    setCharacterConfigMap((prev) => {
      const currentConfig =
        prev[weaponStateKey] ??
        initCharacterConfig(weaponStateKey, activeCharacter?.name ?? weaponStateKey, activeCharacter?.rarity);
      return {
        ...prev,
        [weaponStateKey]: {
          ...currentConfig,
          weaponName,
        },
      };
    });
    setIsWeaponDrawerOpen(false);
    setIsWeaponDataDrawerOpen(false);
    setCtiInputValue('');
    setIsCtiDrawerOpen(false);
  };
  const handleWeaponPotentialToggle = () => {
    // 武器潜能滑块只有 P0 / PMAX，两态切换
    const nextMode: WeaponPotentialMode = currentWeaponPotentialMode === 'PMAX' ? 'P0' : 'PMAX';
    setWeaponPotentialModeMap((prev) => ({
      ...prev,
      [weaponStateKey]: nextMode,
    }));
    // 同步写回角色配置快照，供面板计算与信息模块统一读取
    setCharacterConfigMap((prev) => {
      const currentConfig =
        prev[weaponStateKey] ??
        initCharacterConfig(weaponStateKey, activeCharacter?.name ?? weaponStateKey, activeCharacter?.rarity);
      return {
        ...prev,
        [weaponStateKey]: {
          ...currentConfig,
          weaponPotentialMode: nextMode,
        },
      };
    });
  };
  const handleEquipmentInputCommit = (key: keyof EquipmentConfig, nextValue: number) => {
    setCharacterConfigMap((prev) => {
      const currentConfig =
        prev[weaponStateKey] ??
        initCharacterConfig(
          resolvedActiveCharacterId ?? weaponStateKey,
          activeCharacter?.name ?? weaponStateKey,
          activeCharacter?.rarity
        );
      const nextEquipment = {
        ...normalizeEquipment(currentConfig.equipment),
        [key]: nextValue,
      };
      return {
        ...prev,
        [weaponStateKey]: {
          ...currentConfig,
          equipment: nextEquipment,
        },
      };
    });
  };
  const renderWeaponOption = (weaponName: string) => (
    <button
      key={weaponName}
      type="button"
      className={`config-weapon-option${currentWeaponName === weaponName ? ' is-selected' : ''}`}
      onClick={() => {
        handleWeaponSelect(weaponName);
      }}
    >
      {weaponName}
    </button>
  );

  React.useEffect(() => {
    if (currentWeaponName === NONE_WEAPON_NAME || weaponMaxDataMap[currentWeaponName]) {
      setWeaponDataLoadError(null);
      setIsWeaponDataLoading(false);
      return;
    }
    let aborted = false;
    const controller = new AbortController();
    const loadWeaponMaxData = async () => {
      try {
        setIsWeaponDataLoading(true);
        setWeaponDataLoadError(null);
        const response = await fetch(
          resolvePublicPath(`data/weapons/${encodeURIComponent(currentWeaponName)}/${encodeURIComponent(currentWeaponName)}max.json`),
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`读取失败: ${response.status}`);
        }
        const payload = (await response.json()) as WeaponMaxData;
        if (!aborted) {
          setWeaponMaxDataMap((prev) => ({
            ...prev,
            [currentWeaponName]: payload,
          }));
        }
      } catch (error) {
        if (!aborted) {
          setWeaponDataLoadError(error instanceof Error ? error.message : '读取失败');
        }
      } finally {
        if (!aborted) {
          setIsWeaponDataLoading(false);
        }
      }
    };
    loadWeaponMaxData();
    return () => {
      aborted = true;
      controller.abort();
    };
  }, [currentWeaponName, weaponMaxDataMap]);

  React.useEffect(() => {
    if (currentWeaponName === NONE_WEAPON_NAME || weaponBuffDataMap[currentWeaponName]) {
      setWeaponBuffLoadError(null);
      setIsWeaponBuffLoading(false);
      return;
    }
    let aborted = false;
    const controller = new AbortController();
    const loadWeaponBuffData = async () => {
      try {
        // 读取武器 buff.json 仅用于“条件说明”，不把条件效果并入默认面板
        setIsWeaponBuffLoading(true);
        setWeaponBuffLoadError(null);
        const response = await fetch(
          resolvePublicPath(`data/weapons/${encodeURIComponent(currentWeaponName)}/${encodeURIComponent(currentWeaponName)}buff.json`),
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`读取失败: ${response.status}`);
        }
        const payload = (await response.json()) as WeaponBuffData;
        if (!aborted) {
          setWeaponBuffDataMap((prev) => ({
            ...prev,
            [currentWeaponName]: payload,
          }));
        }
      } catch (error) {
        if (!aborted) {
          setWeaponBuffLoadError(error instanceof Error ? error.message : '读取失败');
        }
      } finally {
        if (!aborted) {
          setIsWeaponBuffLoading(false);
        }
      }
    };
    loadWeaponBuffData();
    return () => {
      aborted = true;
      controller.abort();
    };
  }, [currentWeaponName, weaponBuffDataMap]);

  React.useEffect(() => {
    if (!resolvedActiveCharacterId) {
      return;
    }
    const sessionConfigMap = readCharacterConfigMapFromSession();
    const sessionConfig = sessionConfigMap[weaponStateKey];
    if (!sessionConfig) {
      return;
    }
    setCharacterConfigMap((prev) => ({
      ...prev,
      [weaponStateKey]: {
        ...sessionConfig,
        skillLevelModeMap: sessionConfig.skillLevelModeMap ?? { ...DEFAULT_SKILL_LEVEL_MODE_MAP },
        equipment: normalizeEquipment(sessionConfig.equipment),
      },
    }));
  }, [resolvedActiveCharacterId, weaponStateKey]);

  React.useEffect(() => {
    if (!resolvedActiveCharacterId || !activeCharacter) {
      return;
    }
    // 角色切换时懒初始化配置快照：
    // 已存在则复用，不存在才创建，避免覆盖用户当前选择
    setCharacterConfigMap((prev) => {
      const currentConfig = prev[weaponStateKey];
      if (currentConfig) {
        const nextEquipment = normalizeEquipment(currentConfig.equipment);
        const isEquipmentConsistent = Object.keys(DEFAULT_EQUIPMENT).every((key) => {
          const equipmentKey = key as keyof EquipmentConfig;
          return currentConfig.equipment?.[equipmentKey] === nextEquipment[equipmentKey];
        });
        if (currentConfig.skillLevelModeMap && isEquipmentConsistent) {
          return prev;
        }
        return {
          ...prev,
          [weaponStateKey]: {
            ...currentConfig,
            skillLevelModeMap: currentConfig.skillLevelModeMap ?? { ...DEFAULT_SKILL_LEVEL_MODE_MAP },
            equipment: nextEquipment,
          },
        };
      }
      return {
        ...prev,
        [weaponStateKey]: initCharacterConfig(resolvedActiveCharacterId, activeCharacter.name, activeCharacter.rarity),
      };
    });
  }, [resolvedActiveCharacterId, activeCharacter, weaponStateKey]);

  React.useEffect(() => {
    const config = characterConfigMap[weaponStateKey];
    if (!config) {
      return;
    }
    setSkillLevelModeMap((prev) => {
      const nextSkillLevelModeMap = config.skillLevelModeMap ?? DEFAULT_SKILL_LEVEL_MODE_MAP;
      if (
        prev.A === nextSkillLevelModeMap.A &&
        prev.B === nextSkillLevelModeMap.B &&
        prev.E === nextSkillLevelModeMap.E &&
        prev.Q === nextSkillLevelModeMap.Q
      ) {
        return prev;
      }
      return {
        A: nextSkillLevelModeMap.A,
        B: nextSkillLevelModeMap.B,
        E: nextSkillLevelModeMap.E,
        Q: nextSkillLevelModeMap.Q,
      };
    });
  }, [characterConfigMap, weaponStateKey]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      writeCharacterConfigMapToSession(characterConfigMap);
    }, STORAGE_WRITE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [characterConfigMap]);

  React.useEffect(() => {
    const config = characterConfigMap[weaponStateKey];
    if (!config) {
      return;
    }
    setWeaponNameMap((prev) =>
      prev[weaponStateKey] === config.weaponName
        ? prev
        : {
          ...prev,
          [weaponStateKey]: config.weaponName,
        }
    );
    setWeaponPotentialModeMap((prev) =>
      prev[weaponStateKey] === config.weaponPotentialMode
        ? prev
        : {
          ...prev,
          [weaponStateKey]: config.weaponPotentialMode,
        }
    );
  }, [characterConfigMap, weaponStateKey]);

  React.useEffect(() => {
    if (!resolvedActiveCharacterId || !activeCharacter) {
      return;
    }
    // 统一使用已经整合好的 level90（优先 runtime template，fallback max.json）
    const level90Data = level90;
    if (!level90Data) {
      return;
    }
    // 统一主副属性来源：优先 runtime template，fallback characterMaxData
    const unifiedMainStat = runtimeTemplate?.mainStat || characterMaxData?.mainStat || '';
    const unifiedSubStat = runtimeTemplate?.subStat || characterMaxData?.subStat || '';
    const mainField = ABILITY_FIELD_MAP[unifiedMainStat];
    const subField = ABILITY_FIELD_MAP[unifiedSubStat];
    if (!mainField || !subField) {
      return;
    }
    const characterBaseAtk = level90Data.atk ?? 0;
    const characterBaseHp = level90Data.hp ?? 0;
    const weaponBaseAtk = typeof weaponAttackAt90 === 'number' ? weaponAttackAt90 : 0;
    const equipment = normalizeEquipment(currentCharacterConfig?.equipment);
    const characterPotential = currentCharacterConfig?.characterPotential ?? getDefaultCharacterPotential(activeCharacter.rarity);
    const level90Strength = level90Data.strength ?? 0;
    const level90Agility = level90Data.agility ?? 0;
    const level90Intelligence = level90Data.intelligence ?? 0;
    const level90Will = level90Data.will ?? 0;
    const totalStrength = level90Strength + weaponAbilityFlatByField.strength + equipment.strength;
    const totalAgility = level90Agility + weaponAbilityFlatByField.agility + equipment.agility;
    const totalIntelligence = level90Intelligence + weaponAbilityFlatByField.intelligence + equipment.intelligence;
    const totalWill = level90Will + weaponAbilityFlatByField.will + equipment.will;
    const totalAbilityByField: Record<AbilityField, number> = {
      strength: totalStrength,
      agility: totalAgility,
      intelligence: totalIntelligence,
      will: totalWill,
    };
    const mainStatCharacterValue = totalAbilityByField[mainField] ?? 0;
    const subStatCharacterValue = totalAbilityByField[subField] ?? 0;
    const mainStatWeaponFlat = weaponMainStatFlatBonus;
    const subStatWeaponFlat = weaponSubStatFlatBonus;
    const panelAbilityByField: Record<AbilityField, number> = { ...totalAbilityByField };
    panelAbilityByField[mainField] += 60 + mainStatWeaponFlat;
    panelAbilityByField[subField] += subStatWeaponFlat;
    const mainStatScale = equipment.mainStatBoost + weaponMainStatBoostBonus;
    const subStatScale = equipment.subStatBoost + weaponSubStatBoostBonus;
    const allStatScale = equipment.allStatBoost + weaponAllStatBoostBonus;
    const rawMainStat = panelAbilityByField[mainField];
    const rawSubStat = panelAbilityByField[subField];
    const mainStatFinal = rawMainStat * (1 + mainStatScale) * (1 + allStatScale);
    const subStatFinal = rawSubStat * (1 + subStatScale) * (1 + allStatScale);
    const mainAtkBonus = mainStatFinal * 0.005;
    const subAtkBonus = subStatFinal * 0.002;
    const abilityBonus = mainAtkBonus + subAtkBonus;
    const weaponAtkPercent = weaponPassiveAtkPercent + equipment.atkPercentBoost;
    const critRate = 0.05 + weaponCritRate + (equipment.critRateBoost ?? 0);
    const critDmg = 0.5 + (equipment.critDmgBonusBoost ?? 0);
    const sourceSkill = weaponMemoryStrength + equipment.sourceSkillBoost;
    const totalHp = characterBaseHp * (1 + weaponHpPercent) + equipment.hp;
    const baseAtk = (characterBaseAtk + weaponBaseAtk) * (1 + weaponAtkPercent) + weaponPassiveAtk + equipment.flatAtk;
    const atk = baseAtk * (1 + abilityBonus);
    const panelSnapshot: PanelSummary = {
      hp: toFixedNumber(totalHp),
      strength: toFixedNumber(panelAbilityByField.strength),
      agility: toFixedNumber(panelAbilityByField.agility),
      intelligence: toFixedNumber(panelAbilityByField.intelligence),
      will: toFixedNumber(panelAbilityByField.will),
      atk: toFixedNumber(atk),
      baseAtk: toFixedNumber(baseAtk),
      abilityBonus: toFixedNumber(abilityBonus * 100),
      mainStatFinal: toFixedNumber(mainStatFinal),
      subStatFinal: toFixedNumber(subStatFinal),
      characterAtk: toFixedNumber(characterBaseAtk),
      weaponAtk: toFixedNumber(weaponBaseAtk),
      weaponAtkPercent: toFixedNumber(weaponAtkPercent * 100),
      critRate: toFixedNumber(critRate, 4),
      critDmg: toFixedNumber(critDmg, 4),
      sourceSkill: toFixedNumber(sourceSkill),
      healingBonus: toFixedNumber(weaponHealingBonus, 4),
      ultimateChargeEfficiency: toFixedNumber(weaponUltimateChargeEfficiency, 4),
      weaponAllSkillDmgBonus: toFixedNumber(weaponAllSkillDmgBonus),
    };
    const separator = '--------------------------------------------------';
    const blockLine = '==================================================';
    // 统一主副属性名称来源：优先 runtime template，fallback characterMaxData
    const mainStatName = runtimeTemplate?.mainStat || characterMaxData?.mainStat || '主能力';
    const subStatName = runtimeTemplate?.subStat || characterMaxData?.subStat || '副能力';
    const weaponPotentialLabel = currentWeaponPotentialMode === 'PMAX' ? '满潜' : '0潜';
    const weaponUnconditionalInfoLines =
      weaponUnconditionalSourceLines.length > 0 ? weaponUnconditionalSourceLines.map((line) => `  ${line}`) : ['  暂无'];
    const infoSnapshot = [
      blockLine,
      `干员面板: ${activeCharacter.name} Lv.90 (${characterPotential})`,
      `武器: ${currentWeaponName} Lv.90 (${weaponPotentialLabel})`,
      blockLine,
      '干员能力值：',
      `力量: ${toFixedNumber(totalStrength)} \t | \t 敏捷: ${toFixedNumber(totalAgility)} \t | \t 智识: ${toFixedNumber(totalIntelligence)} \t | \t 意志: ${toFixedNumber(totalWill)}`,
      separator,
      '面板能力值（计算后）：',
      `力量: ${toFixedNumber(panelAbilityByField.strength)} \t | \t 敏捷: ${toFixedNumber(panelAbilityByField.agility)} \t | \t 智识: ${toFixedNumber(panelAbilityByField.intelligence)} \t | \t 意志: ${toFixedNumber(panelAbilityByField.will)}`,
      separator,
      '装备：',
      `力量: ${toFixedNumber(equipment.strength)}`,
      `敏捷: ${toFixedNumber(equipment.agility)}`,
      `智识: ${toFixedNumber(equipment.intelligence)}`,
      `意志: ${toFixedNumber(equipment.will)}`,
      `主能力: ${toPercentText(equipment.mainStatBoost)}`,
      `副能力: ${toPercentText(equipment.subStatBoost)}`,
      `全能力: ${toPercentText(equipment.allStatBoost)}`,
      `固定攻击: ${toFixedNumber(equipment.flatAtk)}`,
      `攻击百分比: ${toPercentText(equipment.atkPercentBoost)}`,
      separator,
      '主副能力换算',
      separator,
      `${mainStatName}(主): ${toFixedNumber(rawMainStat)} × (1 + ${toPercentText(mainStatScale)}) × (1 + ${toPercentText(allStatScale)}) = ${panelSnapshot.mainStatFinal}`,
      ` = ${toFixedNumber(mainStatCharacterValue)} (干员+武器+装备) + 60 (好感)`,
      `${subStatName}(副): ${toFixedNumber(rawSubStat)} × (1 + ${toPercentText(subStatScale)}) × (1 + ${toPercentText(allStatScale)}) = ${panelSnapshot.subStatFinal}`,
      ` = ${toFixedNumber(subStatCharacterValue)} (干员+武器+装备)`,
      separator,
      '能力值加成：',
      `主能力攻击加成: +${toFixedNumber(mainAtkBonus * 100)}%`,
      `副能力攻击加成: +${toFixedNumber(subAtkBonus * 100)}%`,
      `总能力攻击加成: ${panelSnapshot.abilityBonus}%`,
      separator,
      '基础属性',
      separator,
      `生命值:    ${panelSnapshot.hp}`,
      separator,
      '攻击力计算：',
      `攻击力:    ${panelSnapshot.atk}`,
      ` 基础攻击 = ${toFixedNumber(characterBaseAtk)} (干员) + ${toFixedNumber(weaponBaseAtk)} (武器) = ${toFixedNumber(characterBaseAtk + weaponBaseAtk)}`,
      ` 百分比加成 = (1 + ${toPercentText(weaponPassiveAtkPercent)} 武器 + ${toPercentText(equipment.atkPercentBoost)} 装备 + 0% 潜能)`,
      ` 最终基础 = ${toFixedNumber(characterBaseAtk + weaponBaseAtk)} × ${toFixedNumber(1 + weaponAtkPercent)} + ${toFixedNumber(weaponPassiveAtk)} (武器) + ${toFixedNumber(equipment.flatAtk)} (装备) = ${panelSnapshot.baseAtk}`,
      ` 面板攻击 = ${panelSnapshot.baseAtk} × (1 + ${panelSnapshot.abilityBonus}%) = ${panelSnapshot.atk}`,
      separator,
      `暴击率:    ${toPercentText(panelSnapshot.critRate, 2)}`,
      `暴击伤害:   ${toPercentText(panelSnapshot.critDmg, 2)}`,
      separator,
      `源石技艺强度: ${panelSnapshot.sourceSkill}`,
      separator,
      '抗性(省略)',
      separator,
      `治疗效率加成:   ${toPercentText(weaponHealingBonus)}`,
      '受治疗效率加成:  代码没写',
      '连携技冷却缩减:  代码没写',
      `终结技充能效率:  ${toPercentText(weaponUltimateChargeEfficiency)}`,
      '失衡效率加成:   代码没写',
      separator,
      '伤害加成：',
      `物理伤害加成:   ${toPercentText(equipment.physicalDmgBonus + weaponPhysicalDmgBonus)}`,
      `灼热伤害加成:   ${toPercentText(equipment.fireDmgBonus + weaponFireDmgBonus)}`,
      `电磁伤害加成:   ${toPercentText(equipment.electricDmgBonus + weaponElectricDmgBonus)}`,
      `寒冷伤害加成:   ${toPercentText(equipment.iceDmgBonus + weaponIceDmgBonus)}`,
      `自然伤害加成:   ${toPercentText(equipment.natureDmgBonus + weaponNatureDmgBonus)}`,
      `法术伤害加成:   ${toPercentText(equipment.magicDmgBonus + weaponMagicDmgBonus)}`,
      `普通攻击伤害加成: ${toPercentText(equipment.normalAttackDmgBonus + weaponNormalAttackDmgBonus)}`,
      `持续伤害加成: ${toPercentText(equipment.dotDmgBonus + weaponDotDmgBonus)}`,
      `战技伤害加成:   ${toPercentText(equipment.skillDmgBonus + weaponSkillDmgBonus)}`,
      `连携技伤害加成:  ${toPercentText(equipment.chainSkillDmgBonus + weaponChainSkillDmgBonus)}`,
      `终结技伤害加成:  ${toPercentText(equipment.ultimateDmgBonus + weaponUltimateDmgBonus)}`,
      `对失衡目标伤害加成: ${toPercentText(equipment.imbalanceDmgBonus)}`,
      `所有技能伤害加成: ${toPercentText(equipment.allSkillDmgBonus + weaponAllSkillDmgBonus)}`,
      `所有伤害加成:   ${toPercentText(equipment.allDmgBonus)}`,
      separator,
      '武器：',
      '无条件触发：',
      ...weaponUnconditionalInfoLines,
      ...weaponOtherUnconditionalLines,
      '有条件触发：自动补充',
      ...weaponConditionalTriggerLines,
      blockLine,
    ];
    const infoSnap: DamageBonusSnapshot = {
      physicalDmgBonus: equipment.physicalDmgBonus + weaponPhysicalDmgBonus,
      fireDmgBonus: equipment.fireDmgBonus + weaponFireDmgBonus,
      electricDmgBonus: equipment.electricDmgBonus + weaponElectricDmgBonus,
      iceDmgBonus: equipment.iceDmgBonus + weaponIceDmgBonus,
      natureDmgBonus: equipment.natureDmgBonus + weaponNatureDmgBonus,
      magicDmgBonus: equipment.magicDmgBonus + weaponMagicDmgBonus,
      normalAttackDmgBonus: equipment.normalAttackDmgBonus + weaponNormalAttackDmgBonus,
      dotDmgBonus: equipment.dotDmgBonus + weaponDotDmgBonus,
      skillDmgBonus: equipment.skillDmgBonus + weaponSkillDmgBonus,
      chainSkillDmgBonus: equipment.chainSkillDmgBonus + weaponChainSkillDmgBonus,
      ultimateDmgBonus: equipment.ultimateDmgBonus + weaponUltimateDmgBonus,
      allSkillDmgBonus: equipment.allSkillDmgBonus + weaponAllSkillDmgBonus,
      imbalanceDmgBonus: equipment.imbalanceDmgBonus,
      allDmgBonus: equipment.allDmgBonus,
    };
    // 每次输入变动后，统一回写 panelSnapshot + infoSnapshot
    // 供"基础数据攻击力"与"信息模块"直接读取
    setCharacterConfigMap((prev) => {
      const prevConfig = prev[weaponStateKey] ?? initCharacterConfig(resolvedActiveCharacterId, activeCharacter.name, activeCharacter.rarity);

      // 相等性判断：比较关键字段是否真正变化
      const isWeaponNameChanged = prevConfig.weaponName !== currentWeaponName;
      const isWeaponPotentialModeChanged = prevConfig.weaponPotentialMode !== currentWeaponPotentialMode;
      const isPanelSnapshotChanged = JSON.stringify(prevConfig.panelSnapshot) !== JSON.stringify(panelSnapshot);
      const isInfoSnapshotChanged = JSON.stringify(prevConfig.infoSnapshot) !== JSON.stringify(infoSnapshot);
      const isInfoSnapChanged = JSON.stringify(prevConfig.infoSnap) !== JSON.stringify(infoSnap);
      const isWeaponBuffSnapshotChanged = JSON.stringify(prevConfig.weaponBuffSnapshot) !== JSON.stringify(weaponBuffSnapshot);

      // 如果全部相等，直接返回 prev，避免触发更新
      if (
        !isWeaponNameChanged &&
        !isWeaponPotentialModeChanged &&
        !isPanelSnapshotChanged &&
        !isInfoSnapshotChanged &&
        !isInfoSnapChanged &&
        !isWeaponBuffSnapshotChanged
      ) {
        return prev;
      }

      return {
        ...prev,
        [weaponStateKey]: {
          ...prevConfig,
          characterId: resolvedActiveCharacterId,
          characterName: activeCharacter.name,
          characterPotential: getDefaultCharacterPotential(activeCharacter.rarity),
          weaponName: currentWeaponName,
          weaponPotentialMode: currentWeaponPotentialMode,
          panelSnapshot,
          infoSnapshot,
          infoSnap,
          weaponBuffSnapshot,
        },
      };
    });
  }, [
    resolvedActiveCharacterId,
    activeCharacter,
    characterMaxData,
    currentWeaponName,
    currentWeaponPotentialMode,
    weaponStateKey,
    weaponAttackAt90,
    weaponPassiveAtkPercent,
    weaponPassiveAtk,
    potentialTag,
    currentWeaponBuffData,
    currentCharacterConfig,
    equipSyncTrigger,
  ]);

  // 面板关闭时返回 null（在 Hook 执行之后，符合 React 规则）
  if (!isOpen) {
    return null;
  }

  return (
    <div className="config-panel-overlay" onClick={onClose}>
      <div
        className="config-panel"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="config-panel-header">
          <button className="config-panel-back-btn" type="button" onClick={onClose}>
            返回
          </button>
        </div>
        <div className="config-panel-content" data-character-id={resolvedActiveCharacterId ?? ''}>
          <div className="config-main-area">
            <div className="config-top-grid">
              <div className="config-left-column">
                <section className="config-data-section config-scrollable-module">
                  <h4 className="config-data-title">基础数据</h4>
                  {isLoading ? (
                    <p className="config-loading-text">数据加载中...</p>
                  ) : loadError ? (
                    <p className="config-error-text">{loadError}</p>
                  ) : hasRuntimeBaseData || characterMaxData ? (
                    <div className="config-data-grid">
                      <div className="config-data-item">
                        <span className="config-data-label">名称</span>
                        <span className="config-data-value">{runtimeTemplate?.name || characterMaxData?.name || '-'}</span>
                      </div>
                      <div className="config-data-item">
                        <span className="config-data-label">属性</span>
                        <span className="config-data-value">{templateElement || characterMaxData?.element || '-'}</span>
                      </div>
                      <div className="config-data-item">
                        <span className="config-data-label">等级</span>
                        <span className="config-data-value">{templateLevel}</span>
                      </div>
                      <div className="config-data-item">
                        <span className="config-data-label">攻击力</span>
                        <span className="config-data-value">{panelAtkDisplay || level90?.atk || '-'}</span>
                      </div>
                      {attributeTags.map((tag) => {
                        const mainStat = templateMainStat || characterMaxData?.mainStat;
                        const subStat = templateSubStat || characterMaxData?.subStat;
                        return (
                          <div
                            key={tag.key}
                            className={`config-data-item${mainStat === tag.key ? ' is-main' : ''}${subStat === tag.key ? ' is-sub' : ''}`}
                          >
                            <span className="config-data-label">{tag.label}</span>
                            <span className="config-data-value">{tag.value}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="config-empty-text">暂无基础数据</p>
                  )}
                </section>
                <section className="config-data-section config-scrollable-module">
                  <h4 className="config-data-title">技能</h4>
                  {/* 技能区完全脱离 max.json，只依赖 runtime template */}
                  {runtimeTemplate ? (
                    runtimeSkillEntries.length > 0 ? (
                      <div className="config-skill-grid">
                        {runtimeSkillEntries.map((skill) => (
                          <div key={skill.id} className="config-skill-card">
                            <div className="config-skill-content">
                              <p className="config-skill-key">{skill.buttonType}</p>
                              <p className="config-skill-name">{skill.displayName}</p>
                              <p className="config-skill-hits">{skill.hitCount}段</p>
                            </div>
                            {/* L9/M3 滑块 - 冻结逻辑，仅 UI 占位 */}
                            {/* 本地角色隐藏滑块，官方角色显示但仅作为占位 */}
                            {runtimeTemplate.source === 'official' ? (
                              <button
                                type="button"
                                className={`config-skill-level-switch${skillLevelModeMap[skill.buttonType as SkillPanelKey] === 'M3' ? ' is-m3' : ''}`}
                                onClick={() => {
                                  // 冻结逻辑：仅切换 UI 状态，不影响计算
                                  setSkillLevelModeMap((prev) => {
                                    const nextMode: SkillLevelMode = prev[skill.buttonType as SkillPanelKey] === 'L9' ? 'M3' : 'L9';
                                    const nextSkillLevelModeMap = {
                                      ...prev,
                                      [skill.buttonType as SkillPanelKey]: nextMode,
                                    };
                                    // 写回 session 但不影响伤害计算（冻结逻辑）
                                    setCharacterConfigMap((prevConfigMap) => {
                                      const currentConfig =
                                        prevConfigMap[weaponStateKey] ??
                                        initCharacterConfig(
                                          resolvedActiveCharacterId ?? weaponStateKey,
                                          activeCharacter?.name ?? weaponStateKey,
                                          activeCharacter?.rarity
                                        );
                                      return {
                                        ...prevConfigMap,
                                        [weaponStateKey]: {
                                          ...currentConfig,
                                          skillLevelModeMap: nextSkillLevelModeMap,
                                        },
                                      };
                                    });
                                    return nextSkillLevelModeMap;
                                  });
                                }}
                                aria-label={`${skill.buttonType} 等级切换`}
                              >
                                <span className="config-skill-level-thumb" />
                                <span className="config-skill-level-label config-skill-level-label-l9">L9</span>
                                <span className="config-skill-level-label config-skill-level-label-m3">M3</span>
                              </button>
                            ) : (
                              <div className="config-skill-level-disabled">
                                <span className="config-skill-level-fixed">L9</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="config-empty-text">该干员暂无技能数据</p>
                    )
                  ) : (
                    <p className="config-empty-text">未找到运行时技能模板</p>
                  )}
                </section>
                <section
                  className="config-data-section config-placeholder-panel config-drawer-host"
                  data-selected-weapon={currentWeaponName}
                >
                  <h4 className="config-data-title">武器</h4>
                  <div className="config-weapon-selector" ref={weaponSelectorRef}>
                    <div className={`config-weapon-trigger-row${currentWeaponName !== NONE_WEAPON_NAME ? ' has-potential' : ''}`}>
                      <button
                        type="button"
                        className={`config-weapon-trigger${isWeaponDrawerOpen ? ' is-open' : ''}`}
                        onClick={() => {
                          setIsWeaponDrawerOpen((prev) => !prev);
                        }}
                        aria-expanded={isWeaponDrawerOpen}
                        aria-haspopup="listbox"
                      >
                        <span className="config-weapon-trigger-value">{currentWeaponName}</span>
                      </button>
                      {currentWeaponName !== NONE_WEAPON_NAME ? (
                        <div className="config-weapon-potential-box">
                          <span className="config-weapon-potential-title">潜能：</span>
                          <button
                            type="button"
                            className={`config-weapon-potential-switch${currentWeaponPotentialMode === 'PMAX' ? ' is-max' : ''}`}
                            onClick={handleWeaponPotentialToggle}
                            aria-label="武器潜能切换"
                          >
                            <span className="config-weapon-potential-thumb" />
                            <span className="config-weapon-potential-label config-weapon-potential-label-p0">0潜</span>
                            <span className="config-weapon-potential-label config-weapon-potential-label-max">满潜</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {currentWeaponName !== NONE_WEAPON_NAME ? (
                      <div className="config-weapon-data-host" ref={weaponDataHostRef}>
                        <button
                          type="button"
                          className={`config-weapon-data-trigger${isWeaponDataDrawerOpen ? ' is-open' : ''}`}
                          onClick={() => {
                            setIsWeaponDataDrawerOpen((prev) => !prev);
                          }}
                          aria-expanded={isWeaponDataDrawerOpen}
                          aria-label="武器数据展开"
                        >
                          {isWeaponDataLoading ? (
                            <p className="config-weapon-message">武器数据读取中...</p>
                          ) : weaponDataLoadError ? (
                            <p className="config-weapon-message">武器数据读取失败</p>
                          ) : currentWeaponMaxData ? (
                            <pre className="config-weapon-console-block">{weaponDataConsoleText}</pre>
                          ) : (
                            <p className="config-weapon-message">暂无武器数据</p>
                          )}
                        </button>
                        <div className={`config-weapon-data-drawer${isWeaponDataDrawerOpen ? ' is-open' : ''}`} aria-hidden={!isWeaponDataDrawerOpen}>
                          {isWeaponDataLoading ? (
                            <p className="config-weapon-message">武器数据读取中...</p>
                          ) : weaponDataLoadError ? (
                            <p className="config-weapon-message">武器数据读取失败</p>
                          ) : currentWeaponMaxData ? (
                            <pre className="config-weapon-console-block">{weaponDataConsoleText}</pre>
                          ) : (
                            <p className="config-weapon-message">暂无武器数据</p>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <div
                      className={`config-weapon-drawer${isWeaponDrawerOpen ? ' is-open' : ''}`}
                      role="listbox"
                      aria-hidden={!isWeaponDrawerOpen}
                    >
                      {renderWeaponOption(NONE_WEAPON_NAME)}
                      {isWeaponListLoading ? (
                        <p className="config-weapon-message">武器读取中...</p>
                      ) : weaponListLoadError ? (
                        <p className="config-weapon-message">武器读取失败</p>
                      ) : (
                        weaponOptions
                          .filter((weaponName) => weaponName !== NONE_WEAPON_NAME)
                          .map((weaponName) => renderWeaponOption(weaponName))
                      )}
                    </div>
                  </div>
                </section>
              </div>
              <div className="config-right-panel">
                <section className="config-data-section config-equip-panel config-scrollable-module">
                  <h4 className="config-data-title">装备</h4>
                  <div className="config-equip-layout">
                    <div className="config-equip-values-box">
                      <p className="config-equip-box-title">装备数值</p>
                      <div className="config-equip-values-grid">
                        {EQUIPMENT_FORM_ROWS.map((row, rowIndex) => (
                          <div
                            key={`equip-row-${rowIndex}`}
                            className="config-equip-row"
                            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
                          >
                            {row.map((field) => (
                              <label key={field.key} className="config-equip-item">
                                <span className="config-equip-item-label">{field.label}</span>
                                <span className="config-equip-item-input-wrap">
                                  <span className="config-equip-item-prefix">+</span>
                                  <DeferredNumberInput
                                    className="config-equip-item-input"
                                    value={currentEquipment[field.key]}
                                    format={field.isPercent ? formatPercentDisplayValue : undefined}
                                    parse={field.isPercent ? parsePercentDisplayValue : undefined}
                                    onCommit={(nextValue) => {
                                      handleEquipmentInputCommit(field.key, nextValue ?? 0);
                                    }}
                                  />
                                  {field.isPercent ? <span className="config-equip-item-suffix">%</span> : null}
                                </span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="config-equip-copy-drawer-host" ref={equipCopyDrawerRef}>
                        <button
                          type="button"
                          className="config-equip-sync-btn"
                          title="同步装备数值到信息模块"
                          onClick={() => {
                            const currentConfig = characterConfigMap[weaponStateKey];
                            if (!currentConfig) return;
                            const currentEquipment = currentConfig.equipment;
                            const newEquipment: EquipmentConfig = { ...normalizeEquipment(currentEquipment) };
                            const updatedConfig = {
                              ...currentConfig,
                              equipment: newEquipment,
                            };
                            const sessionData = readCharacterConfigMapFromSession();
                            const newSessionData = {
                              ...sessionData,
                              [weaponStateKey]: updatedConfig,
                            };
                            writeCharacterConfigMapToSession(newSessionData);
                            setCharacterConfigMap((prev) => ({
                              ...prev,
                              [weaponStateKey]: updatedConfig,
                            }));
                            setEquipSyncTrigger((prev) => prev + 1);
                          }}
                        >
                          同步
                        </button>
                        <button
                          type="button"
                          className={`config-equip-copy-btn${isEquipCopyDrawerOpen ? ' is-open' : ''}`}
                          title="复制文本"
                          onClick={() => {
                            setIsEquipCopyDrawerOpen((prev) => !prev);
                          }}
                        >
                          复制
                        </button>
                        <div className={`config-equip-copy-drawer${isEquipCopyDrawerOpen ? ' is-open' : ''}`} aria-hidden={!isEquipCopyDrawerOpen}>
                          <textarea
                            className="config-equip-copy-textarea"
                            value={equipCopyText}
                            onChange={(e) => setEquipCopyText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                parseEquipmentTextAndFill(equipCopyText, (key, value) => {
                                  handleEquipmentInputCommit(
                                    key,
                                    isPercentField(key) ? value / 100 : value
                                  );
                                });
                                setIsEquipCopyDrawerOpen(false);
                              }
                            }}
                            placeholder="ctrl -v 粘贴 回车确认"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="config-equip-set-box">
                      <p className="config-equip-box-title">三件套效果</p>
                      <div className="config-equip-set-sub-box">
                        <p className="config-equip-set-title">1、非条件触发部分</p>
                      </div>
                      <div className="config-equip-set-sub-box">
                        <p className="config-equip-set-title">2、条件触发部分</p>
                      </div>
                    </div>
                  </div>
                </section>
                <section className="config-data-section config-info-panel config-scrollable-module">
                  <h4 className="config-data-title">信息</h4>
                  {infoSnapshotLines.length > 0 ? (
                    <pre className="config-weapon-console-block">{infoSnapshotLines.join('\n')}</pre>
                  ) : (
                    <p className="config-empty-text">暂无信息快照</p>
                  )}
                </section>
              </div>
            </div>
            <div className="config-cti-strip config-drawer-host" ref={ctiSelectorRef}>
              <textarea
                className="config-cti-input"
                placeholder="CTI 输入武器名/缩写自动搜索"
                value={ctiInputValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setCtiInputValue(nextValue);
                  setIsCtiDrawerOpen(nextValue.trim().length > 0);
                }}
                onFocus={() => {
                  if (ctiKeyword.length > 0) {
                    setIsCtiDrawerOpen(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setIsCtiDrawerOpen(false);
                  }
                }}
              />
              <div className={`config-cti-drawer${isCtiDrawerOpen ? ' is-open' : ''}`} role="listbox" aria-hidden={!isCtiDrawerOpen}>
                {isWeaponListLoading ? (
                  <p className="config-weapon-message">武器读取中...</p>
                ) : weaponListLoadError ? (
                  <p className="config-weapon-message">武器读取失败</p>
                ) : ctiMatchedWeaponOptions.length > 0 ? (
                  ctiMatchedWeaponOptions.map((weaponName) => renderWeaponOption(weaponName))
                ) : (
                  <p className="config-weapon-message">未匹配到武器</p>
                )}
              </div>
            </div>
          </div>
          <div className="config-side-rail">
            <div className="config-avatar-strip">
              {visibleCharacters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  className={`config-avatar-item${resolvedActiveCharacterId === character.id ? ' is-active' : ''}`}
                  onClick={() => {
                    onSelectCharacter(character.id);
                  }}
                >
                  {character.avatarUrl ? (
                    <img
                      className="config-avatar-image"
                      src={normalizeAssetUrl(character.avatarUrl)}
                      alt={`${character.name} 头像`}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
