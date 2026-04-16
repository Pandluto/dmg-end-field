/**
 * 技能按钮 Buff 管理 Hook
 * 管理每个技能按钮关联的 Buff 列表
 */

import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { SkillButtonBuff, SkillButtonBuffMap } from '../types/storage';
import {
  getSkillButtonBuffMap,
  safeSessionStorage,
  setSkillButtonBuffMap,
} from '../utils/storage';

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

const STORAGE_WRITE_DEBOUNCE_MS = 300;

/**
 * 使用技能按钮 Buff 管理
 * @returns Buff 管理方法和状态
 */
export function useSkillButtonBuffs() {
  // 存储每个技能按钮的 Buff 列表
  const [buttonBuffs, setButtonBuffs] = useState<SkillButtonBuffMap>(loadBuffsFromStorage);

  // 当数据变化时保存到 sessionStorage
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveBuffsToStorage(buttonBuffs);
    }, STORAGE_WRITE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [buttonBuffs]);

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
   * @returns 是否添加成功
   */
  const addBuff = useCallback((buttonId: string, buff: Omit<SkillButtonBuff, 'id'>): boolean => {
    let added = false;
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

      added = true;
      return {
        ...prev,
        [buttonId]: [...currentBuffs, newBuff],
      };
    });
    return added;
  }, []);

  /**
   * 从指定技能按钮移除 Buff
   * @param buttonId - 技能按钮 ID
   * @param buffId - Buff ID
   */
  const removeBuff = useCallback((buttonId: string, buffId: string) => {
    setButtonBuffs(prev => {
      const currentBuffs = prev[buttonId] || [];
      return {
        ...prev,
        [buttonId]: currentBuffs.filter(b => b.id !== buffId),
      };
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
      return newMap;
    });
  }, []);

  return {
    buttonBuffs,
    getBuffs,
    addBuff,
    removeBuff,
    clearBuffs,
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

export const removeSkillButtonBuff = (buttonId: string, buffId: string): void => {
  const buttonBuffs = getSkillButtonBuffMap();
  if (!buttonBuffs[buttonId]) {
    return;
  }

  buttonBuffs[buttonId] = buttonBuffs[buttonId].filter((buff) => buff.id !== buffId);
  setSkillButtonBuffMap(buttonBuffs);
};
