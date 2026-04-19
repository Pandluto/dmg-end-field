/**
 * Operator Config Repository
 * 只负责角色配置和计算缓存相关读取
 * 不依赖 React，不写业务规则
 */

import { STORAGE_KEYS } from '../../constants/storage-keys';
import {
  CharacterInputConfig,
  CharacterComputedCache,
  CharacterDisplayCache,
} from '../../types/storage';
import { getStorageJson } from '../../utils/storage';

// ===== Character Input Config =====

/**
 * 获取角色输入配置 Map
 */
export function getCharacterInputMap(): Record<string, CharacterInputConfig> {
  return getStorageJson(STORAGE_KEYS.CHARACTER_INPUT_MAP, {});
}

/**
 * 获取单个角色输入配置
 */
export function getCharacterInputConfig(characterId: string): CharacterInputConfig | null {
  const map = getCharacterInputMap();
  return map[characterId] ?? null;
}

// ===== Character Computed Cache =====

/**
 * 获取角色计算缓存 Map
 */
export function getCharacterComputedMap(): Record<string, CharacterComputedCache> {
  return getStorageJson(STORAGE_KEYS.CHARACTER_COMPUTED_MAP, {});
}

/**
 * 获取单个角色计算缓存
 */
export function getCharacterComputedCache(characterId: string): CharacterComputedCache | null {
  const map = getCharacterComputedMap();
  return map[characterId] ?? null;
}

// ===== Character Display Cache =====

/**
 * 获取角色展示缓存 Map
 */
export function getCharacterDisplayMap(): Record<string, CharacterDisplayCache> {
  return getStorageJson(STORAGE_KEYS.CHARACTER_DISPLAY_CACHE, {});
}

/**
 * 获取单个角色展示缓存
 */
export function getCharacterDisplayCache(characterId: string): CharacterDisplayCache | null {
  const map = getCharacterDisplayMap();
  return map[characterId] ?? null;
}
