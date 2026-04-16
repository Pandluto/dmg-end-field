/**
 * 技能按钮 Buff 管理 Hook
 * 管理每个技能按钮关联的 Buff 列表
 * 唯一持久化真相：timelineData（包含 buffIds）
 * 本 Hook 提供运行时读取/添加/删除接口，Buff 完整数据存储在 skill-button-buffs
 */

import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { SkillButtonBuff, SkillButtonBuffMap } from '../types/storage';
import {
  getSkillButtonBuffMap,
  safeSessionStorage,
  setSkillButtonBuffMap,
} from '../utils/storage';
import { TimelineData } from '../types';

// Buff 数据缓存（用于运行时快速访问，不持久化）
let buffCache: SkillButtonBuffMap = {};

/**
 * 从 sessionStorage 加载 Buff 数据
 */
const loadBuffsFromStorage = (): SkillButtonBuffMap => {
  return getSkillButtonBuffMap();
};

/**
 * 保存 Buff 数据到 sessionStorage
 */
const saveBuffsToStorage = (buffs: SkillButtonBuffMap) => {
  setSkillButtonBuffMap(buffs);
};

/**
 * 从 timelineData 提取所有 buffIds 并返回 Set
 */
const extractAllBuffIdsFromTimeline = (timelineData: TimelineData): Set<string> => {
  const buffIds = new Set<string>();
  timelineData.staffLines.forEach(staffLine => {
    staffLine.buttons.forEach(button => {
      if (button.buffIds) {
        button.buffIds.forEach(id => buffIds.add(id));
      }
    });
  });
  return buffIds;
};

/**
 * 清理无效的 Buff 数据（timelineData 中不存在的 buffId）
 */
const cleanupInvalidBuffs = (buffMap: SkillButtonBuffMap, validBuffIds: Set<string>): SkillButtonBuffMap => {
  const cleaned: SkillButtonBuffMap = {};
  Object.entries(buffMap).forEach(([buttonId, buffs]) => {
    const validBuffs = buffs.filter(buff => validBuffIds.has(buff.id));
    if (validBuffs.length > 0) {
      cleaned[buttonId] = validBuffs;
    }
  });
  return cleaned;
};

/**
 * 使用技能按钮 Buff 管理
 * @returns Buff 管理方法和状态
 */
export function useSkillButtonBuffs() {
  // 存储每个技能按钮的 Buff 列表（运行时内存态）
  const [buttonBuffs, setButtonBuffs] = useState<SkillButtonBuffMap>(() => {
    // 优先从缓存读取，否则从 storage 加载
    if (Object.keys(buffCache).length === 0) {
      buffCache = loadBuffsFromStorage();
    }
    return buffCache;
  });

  // 当数据变化时更新缓存（不自动持久化，由调用方控制）
  useEffect(() => {
    buffCache = buttonBuffs;
  }, [buttonBuffs]);

  /**
   * 从 timelineData 同步 Buff 数据
   * 页面刷新后调用，根据 timelineData 中的 buffIds 恢复 Buff 数据
   * @param timelineData - 排轴数据
   */
  const syncBuffsFromTimeline = useCallback((timelineData: TimelineData) => {
    const validBuffIds = extractAllBuffIdsFromTimeline(timelineData);
    const currentBuffs = loadBuffsFromStorage();
    
    // 清理无效的 Buff（保留 timelineData 中引用的 Buff）
    const cleanedBuffs = cleanupInvalidBuffs(currentBuffs, validBuffIds);
    
    setButtonBuffs(cleanedBuffs);
    saveBuffsToStorage(cleanedBuffs);
    buffCache = cleanedBuffs;
    
    console.log('【Buff 同步】已从 timelineData 同步，有效 Buff 数量:', validBuffIds.size);
  }, []);

  /**
   * 获取指定技能按钮的 Buff 列表
   * @param buttonId - 技能按钮 ID
   * @returns Buff 列表
   */
  const getBuffs = useCallback((buttonId: string): SkillButtonBuff[] => {
    return buttonBuffs[buttonId] || [];
  }, [buttonBuffs]);

  /**
   * 添加 Buff 到指定技能按钮
   * @param buttonId - 技能按钮 ID
   * @param buff - Buff 数据
   * @returns 是否添加成功，以及生成的 buffId
   */
  const addBuff = useCallback((buttonId: string, buff: Omit<SkillButtonBuff, 'id'>): { success: boolean; buffId?: string } => {
    let result = { success: false, buffId: undefined as string | undefined };
    
    setButtonBuffs(prev => {
      const currentBuffs = prev[buttonId] || [];
      // 检查是否已存在相同 displayName 的 Buff
      const exists = currentBuffs.some(b => b.displayName === buff.displayName);
      if (exists) {
        return prev; // 已存在则不添加
      }

      const newBuff: SkillButtonBuff = {
        ...buff,
        id: `buff-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      };

      result = { success: true, buffId: newBuff.id };
      
      const newBuffs = {
        ...prev,
        [buttonId]: [...currentBuffs, newBuff],
      };
      
      // 同步到 storage
      saveBuffsToStorage(newBuffs);
      
      return newBuffs;
    });
    
    return result;
  }, []);

  /**
   * 从指定技能按钮移除 Buff
   * @param buttonId - 技能按钮 ID
   * @param buffId - Buff ID
   */
  const removeBuff = useCallback((buttonId: string, buffId: string) => {
    setButtonBuffs(prev => {
      const currentBuffs = prev[buttonId] || [];
      const newBuffs = {
        ...prev,
        [buttonId]: currentBuffs.filter(b => b.id !== buffId),
      };
      
      // 同步到 storage
      saveBuffsToStorage(newBuffs);
      
      return newBuffs;
    });
  }, []);

  /**
   * 清空指定技能按钮的所有 Buff
   * @param buttonId - 技能按钮 ID
   */
  const clearBuffs = useCallback((buttonId: string) => {
    setButtonBuffs(prev => {
      const newMap = { ...prev };
      delete newMap[buttonId];
      
      // 同步到 storage
      saveBuffsToStorage(newMap);
      
      return newMap;
    });
  }, []);

  /**
   * 获取所有 Buff 数据（用于同步到 timelineData）
   * @returns 完整的 Buff Map
   */
  const getAllBuffs = useCallback((): SkillButtonBuffMap => {
    return buttonBuffs;
  }, [buttonBuffs]);

  return {
    buttonBuffs,
    getBuffs,
    addBuff,
    removeBuff,
    clearBuffs,
    getAllBuffs,
    syncBuffsFromTimeline,
  };
}

/**
 * 设置当前选中的技能按钮 ID（用于 DamageTab 添加 Buff）
 * @param buttonId - 技能按钮 ID，null 表示清除
 */
export const setSelectedSkillButton = (buttonId: string | null) => {
  if (buttonId) {
    safeSessionStorage.setItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON, buttonId);
  } else {
    safeSessionStorage.removeItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON);
  }
};

/**
 * 获取当前选中的技能按钮 ID
 * @returns 技能按钮 ID 或 null
 */
export const getSelectedSkillButton = (): string | null => {
  return safeSessionStorage.getItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON);
};

/**
 * 获取指定按钮的完整 Buff 数据
 * @param buttonId - 按钮 ID
 * @returns Buff 列表（包含完整字段）
 */
export function getButtonBuffs(buttonId: string): SkillButtonBuff[] {
  const buttonBuffs = getSkillButtonBuffMap();
  return buttonBuffs[buttonId] || [];
}

/**
 * 添加 Buff 到技能按钮（独立函数版本，供 DamageTab 使用）
 * @param buttonId - 按钮 ID
 * @param buff - Buff 数据
 * @returns 是否添加成功
 */
export const addSkillButtonBuff = (buttonId: string, buff: SkillButtonBuff): boolean => {
  const buttonBuffs = getSkillButtonBuffMap();
  const currentBuffs = buttonBuffs[buttonId] || [];

  if (currentBuffs.some((item) => item.displayName === buff.displayName)) {
    return false;
  }

  buttonBuffs[buttonId] = [...currentBuffs, buff];
  setSkillButtonBuffMap(buttonBuffs);
  return true;
};

/**
 * 从技能按钮移除 Buff（独立函数版本）
 * @param buttonId - 按钮 ID
 * @param buffId - Buff ID
 */
export const removeSkillButtonBuff = (buttonId: string, buffId: string): void => {
  const buttonBuffs = getSkillButtonBuffMap();
  if (!buttonBuffs[buttonId]) {
    return;
  }

  buttonBuffs[buttonId] = buttonBuffs[buttonId].filter((buff) => buff.id !== buffId);
  setSkillButtonBuffMap(buttonBuffs);
};
