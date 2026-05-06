import { STORAGE_KEYS } from '../constants/storage-keys';
import {
  CharacterInputConfig,
  CharacterComputedCache,
  CharacterDisplayCache,
  SkillButtonBuff,
  SkillButtonBuffMap,
} from '../types/storage';
import type {
  PersistedSkillButton,
  SkillButtonTable,
  BuffList,
} from '../types/storage';
import { EquipmentConfig } from './equipmentParser';
import type {
  RuntimeOperatorTemplate,
  RuntimeOperatorTemplateMap,
} from '../core/templates/operatorTemplate';

// 重新导出类型供外部使用
export type { PersistedSkillButton, SkillButtonTable, BuffList };

const isClient = typeof window !== 'undefined';

// ==================== 基础存储工具 ====================

export const safeSessionStorage = {
  getItem(key: string): string | null {
    if (!isClient) return null;
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      console.warn(`读取 sessionStorage 失败 [${key}]`, error);
      return null;
    }
  },

  setItem(key: string, value: string): void {
    if (!isClient) return;
    try {
      window.sessionStorage.setItem(key, value);
    } catch (error) {
      console.warn(`写入 sessionStorage 失败 [${key}]`, error);
    }
  },

  removeItem(key: string): void {
    if (!isClient) return;
    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {
      console.warn(`删除 sessionStorage 失败 [${key}]`, error);
    }
  },
};

// ==================== Equipment 处理函数 ====================

const DEFAULT_EQUIPMENT_VALUES: EquipmentConfig = {
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
  imbalanceDmgBonus: 0,
  sourceSkillBoost: 0,
  allSkillDmgBonus: 0,
  allDmgBonus: 0,
};

/**
 * 裁剪 equipment 中的默认值（保存前调用）
 * 只保留非 0 值，减少存储体积
 */
export function pruneEquipmentDefaults(equipment: Partial<EquipmentConfig>): Partial<EquipmentConfig> {
  const pruned: Partial<EquipmentConfig> = {};
  for (const [key, value] of Object.entries(equipment)) {
    if (value !== undefined && value !== 0) {
      (pruned as Record<string, number>)[key] = value;
    }
  }
  return pruned;
}

/**
 * 补全 equipment 默认值（读取后调用）
 * 将稀疏存储还原为完整结构
 */
export function inflateEquipmentDefaults(equipment: Partial<EquipmentConfig>): EquipmentConfig {
  return {
    ...DEFAULT_EQUIPMENT_VALUES,
    ...equipment,
  };
}

// ==================== v3 存储函数 ====================

interface V3Wrapper<T> {
  version: string;
  timestamp: number;
  data: Record<string, T>;
}

function createV3Wrapper<T>(data: Record<string, T>): V3Wrapper<T> {
  return {
    version: '3',
    timestamp: Date.now(),
    data,
  };
}

function parseV3Wrapper<T>(raw: string): V3Wrapper<T> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      'timestamp' in parsed &&
      'data' in parsed &&
      parsed.version === '3'
    ) {
      return parsed as V3Wrapper<T>;
    }
  } catch {
    // ignore
  }
  return null;
}

// ----- Character Input Map (v3) -----

export function getCharacterInputMap(): Record<string, CharacterInputConfig> {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.CHARACTER_INPUT_MAP);
  if (!raw) return {};
  const wrapper = parseV3Wrapper<CharacterInputConfig>(raw);
  return wrapper?.data ?? {};
}

export function setCharacterInputMap(map: Record<string, CharacterInputConfig>): void {
  const wrapper = createV3Wrapper(map);
  safeSessionStorage.setItem(STORAGE_KEYS.CHARACTER_INPUT_MAP, JSON.stringify(wrapper));
}

export function getCharacterInput(characterId: string): CharacterInputConfig | null {
  const map = getCharacterInputMap();
  return map[characterId] ?? null;
}

export function setCharacterInput(characterId: string, config: CharacterInputConfig): void {
  const map = getCharacterInputMap();
  map[characterId] = config;
  setCharacterInputMap(map);
}

// ----- Character Computed Cache (v3) -----

export function getCharacterComputedMap(): Record<string, CharacterComputedCache> {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.CHARACTER_COMPUTED_MAP);
  if (!raw) return {};
  const wrapper = parseV3Wrapper<CharacterComputedCache>(raw);
  return wrapper?.data ?? {};
}

export function setCharacterComputedMap(map: Record<string, CharacterComputedCache>): void {
  const wrapper = createV3Wrapper(map);
  safeSessionStorage.setItem(STORAGE_KEYS.CHARACTER_COMPUTED_MAP, JSON.stringify(wrapper));
}

export function getCharacterComputed(characterId: string): CharacterComputedCache | null {
  const map = getCharacterComputedMap();
  return map[characterId] ?? null;
}

export function setCharacterComputed(characterId: string, cache: CharacterComputedCache): void {
  const map = getCharacterComputedMap();
  map[characterId] = cache;
  setCharacterComputedMap(map);
}

/**
 * 检查计算缓存是否有效（通过 fingerprint 比对）
 */
export function isCharacterComputedValid(characterId: string, fingerprint: string): boolean {
  const cache = getCharacterComputed(characterId);
  return cache?.fingerprint === fingerprint;
}

// ----- Character Display Cache (v3) -----

export function getCharacterDisplayCacheMap(): Record<string, CharacterDisplayCache> {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.CHARACTER_DISPLAY_CACHE);
  if (!raw) return {};
  const wrapper = parseV3Wrapper<CharacterDisplayCache>(raw);
  return wrapper?.data ?? {};
}

export function setCharacterDisplayCacheMap(map: Record<string, CharacterDisplayCache>): void {
  const wrapper = createV3Wrapper(map);
  safeSessionStorage.setItem(STORAGE_KEYS.CHARACTER_DISPLAY_CACHE, JSON.stringify(wrapper));
}

export function getCharacterDisplayCache(characterId: string): CharacterDisplayCache | null {
  const map = getCharacterDisplayCacheMap();
  return map[characterId] ?? null;
}

export function setCharacterDisplayCache(characterId: string, cache: CharacterDisplayCache): void {
  const map = getCharacterDisplayCacheMap();
  map[characterId] = cache;
  setCharacterDisplayCacheMap(map);
}

// ----- Skill Button Buffs (旧模型 - 仅迁移用) -----

/**
 * @deprecated 使用 skill-button 总表 + buff-list 总表替代
 * 仅用于迁移旧数据，新代码不要直接调用
 */
export function getSkillButtonBuffMap(): SkillButtonBuffMap {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.SKILL_BUTTON_BUFFS);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SkillButtonBuffMap;
  } catch {
    return {};
  }
}

/**
 * @deprecated 使用 skill-button 总表 + buff-list 总表替代
 * 仅用于迁移旧数据，新代码不要直接调用
 */
export function setSkillButtonBuffMap(buffs: SkillButtonBuffMap): void {
  safeSessionStorage.setItem(STORAGE_KEYS.SKILL_BUTTON_BUFFS, JSON.stringify(buffs));
}

/**
 * @deprecated 使用 useSkillButtonBuffs().addBuff 替代
 */
export function addBuffToSkillButton(buttonId: string, buff: SkillButtonBuff): boolean {
  const buttonBuffs = getSkillButtonBuffMap();
  const currentBuffs = buttonBuffs[buttonId] || [];

  if (currentBuffs.some((item) => item.displayName === buff.displayName)) {
    return false;
  }

  buttonBuffs[buttonId] = [...currentBuffs, buff];
  setSkillButtonBuffMap(buttonBuffs);
  return true;
}

/**
 * @deprecated 使用 useSkillButtonBuffs().removeBuff 替代
 */
export function removeBuffFromSkillButton(buttonId: string, buffId: string): void {
  const buttonBuffs = getSkillButtonBuffMap();
  if (!buttonBuffs[buttonId]) return;

  buttonBuffs[buttonId] = buttonBuffs[buttonId].filter((buff) => buff.id !== buffId);
  setSkillButtonBuffMap(buttonBuffs);
}

/**
 * @deprecated 使用 useSkillButtonBuffs().getBuffs 替代
 */
export function getButtonBuffs(buttonId: string): SkillButtonBuff[] {
  const buttonBuffs = getSkillButtonBuffMap();
  return buttonBuffs[buttonId] || [];
}

// ----- Selected Skill Button -----

export function setSelectedSkillButton(buttonId: string | null): void {
  if (buttonId) {
    safeSessionStorage.setItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON, buttonId);
  } else {
    safeSessionStorage.removeItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON);
  }
}

export function getSelectedSkillButton(): string | null {
  return safeSessionStorage.getItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON);
}

// ----- Cleanup -----

export function cleanupStorage(): void {
  if (!isClient) return;

  // 清理过期的 UI 展示缓存（1小时 TTL）
  const displayRaw = safeSessionStorage.getItem(STORAGE_KEYS.CHARACTER_DISPLAY_CACHE);
  if (displayRaw) {
    try {
      const wrapper = parseV3Wrapper<CharacterDisplayCache>(displayRaw);
      if (wrapper && Date.now() - wrapper.timestamp > 60 * 60 * 1000) {
        console.log('[cleanup] UI 展示缓存已过期，清除');
        safeSessionStorage.removeItem(STORAGE_KEYS.CHARACTER_DISPLAY_CACHE);
      }
    } catch {
      // ignore
    }
  }
}

// ==================== 兼容层（v2 -> v3 适配）====================

import { CharacterConfigJson, DamageBonusSnapshot, PanelSummary } from '../types/storage';

const DEFAULT_DAMAGE_BONUS_SNAPSHOT: DamageBonusSnapshot = {
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0,
  magicDmgBonus: 0,
  normalAttackDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0,
  imbalanceDmgBonus: 0,
  allDmgBonus: 0,
};

/**
 * 将 v3 数据合并为 v2 兼容格式（供现有组件读取）
 * 从 input + computed + display 合并为完整的 CharacterConfigJson
 */
function mergeV3ToV2(
  characterId: string,
  input: CharacterInputConfig | null,
  computed: CharacterComputedCache | null,
  display: CharacterDisplayCache | null
): CharacterConfigJson | null {
  if (!input) return null;

  const panelSnapshot: PanelSummary | null = computed
    ? {
        atk: computed.panel.atk,
        baseAtk: computed.panel.baseAtk,
        hp: computed.panel.hp ?? 0,
        strength: computed.panel.strength,
        agility: computed.panel.agility,
        intelligence: computed.panel.intelligence,
        will: computed.panel.will,
        abilityBonus: computed.panel.abilityBonus,
        mainStatFinal: computed.panel.mainStatFinal,
        subStatFinal: computed.panel.subStatFinal,
        characterAtk: computed.panel.characterAtk,
        weaponAtk: computed.panel.weaponAtk,
        weaponAtkPercent: computed.panel.weaponAtkPercent,
        critRate: computed.panel.critRate ?? 0.05,
        critDmg: computed.panel.critDmg ?? 0.5,
        sourceSkill: computed.panel.sourceSkill ?? 0,
        healingBonus: computed.panel.healingBonus ?? 0,
        ultimateChargeEfficiency: computed.panel.ultimateChargeEfficiency ?? 0,
        weaponAllSkillDmgBonus: computed.panel.weaponAllSkillDmgBonus,
      }
    : null;

  return {
    characterId,
    characterName: characterId, // 使用 characterId 作为兼容值，保证不为空
    characterPotential: input.potential || '满潜',
    skillLevelModeMap: input.skillLevels || { A: 'L9', B: 'L9', E: 'L9', Q: 'L9' },
    weaponName: input.weapon?.name || '无',
    weaponPotentialMode: input.weapon?.potentialMode || 'P0',
    equipment: inflateEquipmentDefaults(input.equipment || {}),
    panelSnapshot,
    infoSnapshot: display?.infoLines || [],
    infoSnap: computed?.damageBonus || { ...DEFAULT_DAMAGE_BONUS_SNAPSHOT },
    weaponBuffSnapshot: display?.weaponBuffLines || [],
  };
}

/**
 * 兼容函数：获取角色配置（v2 格式）
 */
export function getCharacterConfig(characterId: string): CharacterConfigJson | null {
  const input = getCharacterInput(characterId);
  const computed = getCharacterComputed(characterId);
  const display = getCharacterDisplayCache(characterId);
  return mergeV3ToV2(characterId, input, computed, display);
}

/**
 * 兼容函数：获取所有角色配置（v2 格式）
 */
export function getCharacterConfigMap(): Record<string, CharacterConfigJson> {
  const inputMap = getCharacterInputMap();
  const computedMap = getCharacterComputedMap();
  const displayMap = getCharacterDisplayCacheMap();

  const result: Record<string, CharacterConfigJson> = {};
  for (const characterId of Object.keys(inputMap)) {
    const merged = mergeV3ToV2(
      characterId,
      inputMap[characterId],
      computedMap[characterId] || null,
      displayMap[characterId] || null
    );
    if (merged) {
      result[characterId] = merged;
    }
  }
  return result;
}

/**
 * 兼容函数：设置角色配置（v2 格式，内部转换为 v3）
 */
export function setCharacterConfig(characterId: string, config: CharacterConfigJson): void {
  // 写入 input
  const input: CharacterInputConfig = {
    potential: config.characterPotential as '0潜' | '满潜',
    skillLevels: config.skillLevelModeMap,
    weapon: {
      name: config.weaponName,
      potentialMode: config.weaponPotentialMode,
    },
    equipment: pruneEquipmentDefaults(config.equipment),
  };
  setCharacterInput(characterId, input);

  // 写入 computed（如果有 panelSnapshot）
  if (config.panelSnapshot) {
    const fingerprint = JSON.stringify({
      potential: config.characterPotential,
      skillLevels: config.skillLevelModeMap,
      weapon: { name: config.weaponName, potentialMode: config.weaponPotentialMode },
      equipment: config.equipment,
    });
    const computed: CharacterComputedCache = {
      fingerprint,
      panel: {
        atk: config.panelSnapshot.atk,
        baseAtk: config.panelSnapshot.baseAtk,
        hp: config.panelSnapshot.hp ?? 0,
        strength: config.panelSnapshot.strength,
        agility: config.panelSnapshot.agility,
        intelligence: config.panelSnapshot.intelligence,
        will: config.panelSnapshot.will,
        abilityBonus: config.panelSnapshot.abilityBonus,
        mainStatFinal: config.panelSnapshot.mainStatFinal,
        subStatFinal: config.panelSnapshot.subStatFinal,
        characterAtk: config.panelSnapshot.characterAtk,
        weaponAtk: config.panelSnapshot.weaponAtk,
        weaponAtkPercent: config.panelSnapshot.weaponAtkPercent,
        critRate: config.panelSnapshot.critRate ?? 0.05,
        critDmg: config.panelSnapshot.critDmg ?? 0.5,
        sourceSkill: config.panelSnapshot.sourceSkill ?? 0,
        healingBonus: config.panelSnapshot.healingBonus ?? 0,
        ultimateChargeEfficiency: config.panelSnapshot.ultimateChargeEfficiency ?? 0,
        weaponAllSkillDmgBonus: config.panelSnapshot.weaponAllSkillDmgBonus,
      },
      damageBonus: config.infoSnap,
    };
    setCharacterComputed(characterId, computed);
  }

  // 写入 display（如果有 infoSnapshot 或 weaponBuffSnapshot）
  if (config.infoSnapshot?.length || config.weaponBuffSnapshot?.length) {
    const display: CharacterDisplayCache = {
      infoLines: config.infoSnapshot?.length ? config.infoSnapshot : undefined,
      weaponBuffLines: config.weaponBuffSnapshot?.length ? config.weaponBuffSnapshot : undefined,
    };
    setCharacterDisplayCache(characterId, display);
  }
}

/**
 * 兼容函数：设置所有角色配置（v2 格式，内部转换为 v3）
 */
export function setCharacterConfigMap(map: Record<string, CharacterConfigJson>): void {
  for (const [characterId, config] of Object.entries(map)) {
    setCharacterConfig(characterId, config);
  }
}

// 旧函数名别名（供 DamageTab.tsx 使用）
export const addBuffToSkillButtonStorage = addBuffToSkillButton;
export const removeBuffFromSkillButtonStorage = removeBuffFromSkillButton;

// 通用存储函数（兼容旧代码）
export function getStorageJson<T>(key: string, defaultValue: T): T {
  const raw = safeSessionStorage.getItem(key);
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function setStorageJson<T>(key: string, value: T): void {
  safeSessionStorage.setItem(key, JSON.stringify(value));
}

export function getSelectedCharacterIds(): string[] {
  return getStorageJson<string[]>(STORAGE_KEYS.SELECTED_CHARACTERS, []);
}

export function setSelectedCharacterIds(characterIds: string[]): void {
  setStorageJson(STORAGE_KEYS.SELECTED_CHARACTERS, characterIds);
}

// ==================== v2 新缓存模型 - skill-button 总表 ====================

function normalizePersistedSkillButton(button: PersistedSkillButton): PersistedSkillButton {
  const selectedBuff = Array.isArray(button.selectedBuff) ? button.selectedBuff : [];

  return {
    ...button,
    characterId: button.characterId || button.characterName,
    selectedBuff,
    panelConfig: button.panelConfig ?? {
      selectedBuff: [...selectedBuff],
    },
    panelSnapshot: button.panelSnapshot ?? null,
  };
}

/**
 * 获取 skill-button 总表
 * @returns Record<buttonId, PersistedSkillButton>
 */
export function getSkillButtonTable(): SkillButtonTable {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.SKILL_BUTTON_TABLE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SkillButtonTable;
    return Object.fromEntries(
      Object.entries(parsed).map(([buttonId, button]) => [
        buttonId,
        normalizePersistedSkillButton(button),
      ])
    );
  } catch {
    return {};
  }
}

/**
 * 设置 skill-button 总表
 * @param table - 完整的 button 表
 */
export function setSkillButtonTable(table: SkillButtonTable): void {
  safeSessionStorage.setItem(STORAGE_KEYS.SKILL_BUTTON_TABLE, JSON.stringify(table));
}

/**
 * 根据 ID 获取单个 button
 * @param buttonId - 按钮 ID
 * @returns PersistedSkillButton | null
 */
export function getSkillButtonById(buttonId: string): PersistedSkillButton | null {
  const table = getSkillButtonTable();
  return table[buttonId] ?? null;
}

/**
 * 插入或更新单个 button
 * @param button - button 数据
 */
export function upsertSkillButton(button: PersistedSkillButton): void {
  const table = getSkillButtonTable();
  table[button.id] = {
    ...normalizePersistedSkillButton(button),
    updatedAt: Date.now(),
  };
  setSkillButtonTable(table);
}

/**
 * 根据 ID 删除 button
 * @param buttonId - 按钮 ID
 */
export function removeSkillButtonById(buttonId: string): void {
  const table = getSkillButtonTable();
  delete table[buttonId];
  setSkillButtonTable(table);
}

// ==================== v2 新缓存模型 - buff-list 总表 ====================

/**
 * 获取 buff-list 总表
 * @returns SkillButtonBuff[]
 */
export function getAllBuffList(): BuffList {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.ALL_BUFF_LIST);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as BuffList;
  } catch {
    return [];
  }
}

/**
 * 设置 buff-list 总表
 * @param list - Buff 列表
 */
export function setAllBuffList(list: BuffList): void {
  safeSessionStorage.setItem(STORAGE_KEYS.ALL_BUFF_LIST, JSON.stringify(list));
}

/**
 * 根据 ID 获取单个 Buff
 * @param buffId - Buff ID
 * @returns SkillButtonBuff | null
 */
export function getBuffById(buffId: string): SkillButtonBuff | null {
  const list = getAllBuffList();
  return list.find(b => b.id === buffId) ?? null;
}

/**
 * 插入或更新单个 Buff
 * @param buff - Buff 数据
 */
export function upsertBuff(buff: SkillButtonBuff): void {
  const list = getAllBuffList();
  const idx = list.findIndex(b => b.id === buff.id);
  if (idx >= 0) {
    list[idx] = buff;
  } else {
    list.push(buff);
  }
  setAllBuffList(list);
}

/**
 * 根据 ID 删除 Buff
 * @param buffId - Buff ID
 */
export function removeBuffById(buffId: string): void {
  const list = getAllBuffList().filter(b => b.id !== buffId);
  setAllBuffList(list);
}

/**
 * 检查 Buff 是否被任何 button 引用
 * @param buffId - Buff ID
 * @returns boolean
 */
export function isBuffReferenced(buffId: string): boolean {
  const table = getSkillButtonTable();
  return Object.values(table).some(button =>
    button.selectedBuff?.includes(buffId)
  );
}

// ==================== 运行时模板表 ====================

/**
 * 获取运行时干员模板表
 * @returns Record<characterId, RuntimeOperatorTemplate>
 */
export function getRuntimeOperatorTemplateMap(): RuntimeOperatorTemplateMap {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.RUNTIME_OPERATOR_TEMPLATE_MAP);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as RuntimeOperatorTemplateMap;
  } catch {
    return {};
  }
}

/**
 * 设置运行时干员模板表
 * @param templateMap - 完整的模板表
 */
export function setRuntimeOperatorTemplateMap(templateMap: RuntimeOperatorTemplateMap): void {
  safeSessionStorage.setItem(
    STORAGE_KEYS.RUNTIME_OPERATOR_TEMPLATE_MAP,
    JSON.stringify(templateMap)
  );
}

/**
 * 根据 ID 获取单个运行时模板
 * @param characterId - 干员 ID
 * @returns RuntimeOperatorTemplate | null
 */
export function getRuntimeOperatorTemplateById(
  characterId: string
): RuntimeOperatorTemplate | null {
  const map = getRuntimeOperatorTemplateMap();
  return map[characterId] ?? null;
}
