/**
 * Operator Config Repository
 * 只负责角色配置和计算缓存相关读取
 * 不依赖 React，不写业务规则
 */

import {
  CharacterInputConfig,
  CharacterComputedCache,
  CharacterDisplayCache,
} from '../../types/storage';
import {
  getCharacterComputed as readCharacterComputed,
  getCharacterComputedMap as readCharacterComputedMap,
  getCharacterDisplayCache as readCharacterDisplayCache,
  getCharacterDisplayCacheMap as readCharacterDisplayCacheMap,
  getCharacterInput as readCharacterInput,
  getCharacterInputMap as readCharacterInputMap,
  getOperatorConfigPageCache as readOperatorConfigPageCache,
  inflateEquipmentDefaults,
  setOperatorConfigPageCache as writeOperatorConfigPageCache,
} from '../../utils/storage';
import type { OperatorConfigPageCache } from '../../types/storage';
import {
  normalizeStoredOperatorConfigPageCache,
} from '../services/buffStorageNormalization';

export function getOperatorConfigPageCache(): OperatorConfigPageCache {
  return normalizeStoredOperatorConfigPageCache(readOperatorConfigPageCache());
}

export function setOperatorConfigPageCache(cache: OperatorConfigPageCache): void {
  writeOperatorConfigPageCache(normalizeStoredOperatorConfigPageCache(cache));
}

// ===== Character Input Config =====

/**
 * 获取角色输入配置 Map
 */
export function getCharacterInputMap(): Record<string, CharacterInputConfig> {
  return readCharacterInputMap();
}

/**
 * 获取单个角色输入配置
 */
export function getCharacterInputConfig(characterId: string): CharacterInputConfig | null {
  return readCharacterInput(characterId);
}

// ===== Character Computed Cache =====

/**
 * 获取角色计算缓存 Map
 */
export function getCharacterComputedMap(): Record<string, CharacterComputedCache> {
  return readCharacterComputedMap();
}

/**
 * 获取单个角色计算缓存
 */
export function getCharacterComputedCache(characterId: string): CharacterComputedCache | null {
  return readCharacterComputed(characterId);
}

// ===== Character Display Cache =====

/**
 * 获取角色展示缓存 Map
 */
export function getCharacterDisplayMap(): Record<string, CharacterDisplayCache> {
  return readCharacterDisplayCacheMap();
}

/**
 * 获取单个角色展示缓存
 */
export function getCharacterDisplayCache(characterId: string): CharacterDisplayCache | null {
  return readCharacterDisplayCache(characterId);
}

/**
 * 获取角色最终源石技艺强度快照。
 * 优先使用 computed.panel.sourceSkill，缺失时回退到输入层 equipment。
 */
export function getCharacterSourceSkillBoostSnapshot(characterId: string): number {
  const computed = getCharacterComputedCache(characterId);
  if (computed?.panel.sourceSkill !== undefined) {
    return computed.panel.sourceSkill;
  }

  const input = getCharacterInputConfig(characterId);
  if (!input) {
    return 0;
  }

  return inflateEquipmentDefaults(input.equipment).sourceSkillBoost ?? 0;
}
