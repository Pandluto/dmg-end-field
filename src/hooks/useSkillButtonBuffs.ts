/**
 * 技能按钮 Buff 管理 Hook
 * 管理每个技能按钮关联的 Buff 列表
 */

import { useState, useCallback, useEffect } from 'react';

/**
 * Buff 数据接口
 */
export interface SkillButtonBuff {
  id: string;
  name: string;
  displayName: string;
  sourceName: string;
  level?: string;
  type?: string;
  value?: number;
}

/**
 * 技能按钮 Buff 映射
 * key: 技能按钮 ID
 * value: 该按钮关联的 Buff 列表
 */
type SkillButtonBuffMap = Record<string, SkillButtonBuff[]>;

// sessionStorage key
const SKILL_BUTTON_BUFFS_KEY = 'ddd.skill-button-buffs.v1';

/**
 * 从 sessionStorage 加载 Buff 数据
 */
const loadBuffsFromStorage = (): SkillButtonBuffMap => {
  try {
    const data = sessionStorage.getItem(SKILL_BUTTON_BUFFS_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('加载技能按钮 Buff 数据失败:', error);
  }
  return {};
};

/**
 * 保存 Buff 数据到 sessionStorage
 */
const saveBuffsToStorage = (buffs: SkillButtonBuffMap) => {
  try {
    sessionStorage.setItem(SKILL_BUTTON_BUFFS_KEY, JSON.stringify(buffs));
  } catch (error) {
    console.warn('保存技能按钮 Buff 数据失败:', error);
  }
};

/**
 * 使用技能按钮 Buff 管理
 * @returns Buff 管理方法和状态
 */
export function useSkillButtonBuffs() {
  // 存储每个技能按钮的 Buff 列表
  const [buttonBuffs, setButtonBuffs] = useState<SkillButtonBuffMap>(loadBuffsFromStorage);

  // 当数据变化时保存到 sessionStorage
  useEffect(() => {
    saveBuffsToStorage(buttonBuffs);
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
    sessionStorage.setItem('ddd.selected-skill-button', buttonId);
  } else {
    sessionStorage.removeItem('ddd.selected-skill-button');
  }
};

/**
 * 获取当前选中的技能按钮 ID
 * @returns 技能按钮 ID 或 null
 */
export const getSelectedSkillButton = (): string | null => {
  return sessionStorage.getItem('ddd.selected-skill-button');
};

/**
 * 获取指定按钮的完整 Buff 数据
 * @param buttonId - 按钮 ID
 * @returns Buff 列表（包含完整字段）
 */
export function getButtonBuffs(buttonId: string): SkillButtonBuff[] {
  const key = 'ddd.skill-button-buffs.v1';
  const data = sessionStorage.getItem(key);
  if (data) {
    const buttonBuffs: Record<string, SkillButtonBuff[]> = JSON.parse(data);
    return buttonBuffs[buttonId] || [];
  }
  return [];
}
