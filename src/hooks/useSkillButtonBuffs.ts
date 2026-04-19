/**
 * 技能按钮 Buff 管理 Hook (v2 新缓存模型)
 * 管理每个技能按钮关联的 Buff 列表
 * 
 * 新模型：
 * - skill-button 总表：存放所有 button，包含 selectedBuff（buffId 列表）
 * - buff-list 总表：存放所有 Buff 完整数据
 * - 本 Hook 只负责 React 状态、生命周期和调用 buffService
 */

import { useState, useCallback, useEffect } from 'react';
import { SkillButtonBuff } from '../types/storage';
import {
  loadBuffsToCache,
  getBuffFromCache,
  addBuffToButton,
  getBuffsByButtonId,
  removeBuffFromButton,
  clearButtonBuffs,
  setSelectedSkillButton,
  getSelectedSkillButton,
} from '../core/services/buffService';

/**
 * 使用技能按钮 Buff 管理
 * @returns Buff 管理方法和状态
 */
export function useSkillButtonBuffs() {
  // 存储每个技能按钮的 Buff 列表（运行时内存态）
  const [buttonBuffs, setButtonBuffs] = useState<Record<string, SkillButtonBuff[]>>({});

  // 初始化时加载缓存
  useEffect(() => {
    loadBuffsToCache();
  }, []);

  /**
   * 获取指定技能按钮的 Buff 列表
   * @param buttonId - 技能按钮 ID
   * @returns Buff 列表
   */
  const getBuffs = useCallback((buttonId: string): SkillButtonBuff[] => {
    return getBuffsByButtonId(buttonId);
  }, []);

  /**
   * 添加 Buff 到指定技能按钮
   * @param buttonId - 技能按钮 ID
   * @param buff - Buff 数据（不含 id，或包含 id）
   * @returns 是否添加成功，以及生成的 buffId
   */
  const addBuff = useCallback((buttonId: string, buff: Omit<SkillButtonBuff, 'id'> & { id?: string }): { success: boolean; buffId?: string } => {
    const result = addBuffToButton(buttonId, buff);

    if (result.success && result.buffId) {
      // 更新本地状态
      const newBuff = getBuffFromCache(result.buffId);
      if (newBuff) {
        setButtonBuffs(prev => ({
          ...prev,
          [buttonId]: [...(prev[buttonId] || []), newBuff],
        }));
      }
    }

    return { success: result.success, buffId: result.buffId };
  }, []);

  /**
   * 从指定技能按钮移除 Buff
   * @param buttonId - 技能按钮 ID
   * @param buffId - Buff ID
   */
  const removeBuff = useCallback((buttonId: string, buffId: string) => {
    removeBuffFromButton(buttonId, buffId);

    // 更新本地状态
    setButtonBuffs(prev => ({
      ...prev,
      [buttonId]: (prev[buttonId] || []).filter(b => b.id !== buffId),
    }));
  }, []);

  /**
   * 清空指定技能按钮的所有 Buff
   * @param buttonId - 技能按钮 ID
   */
  const clearBuffs = useCallback((buttonId: string) => {
    clearButtonBuffs(buttonId);

    // 更新本地状态
    setButtonBuffs(prev => {
      const newMap = { ...prev };
      delete newMap[buttonId];
      return newMap;
    });
  }, []);

  /**
   * 获取所有 Buff 数据
   * @returns 完整的 Buff Map
   */
  const getAllBuffs = useCallback((): Record<string, SkillButtonBuff[]> => {
    return buttonBuffs;
  }, [buttonBuffs]);

  /**
   * 从 storage 同步 Buff 数据到本地状态
   * 页面刷新后调用
   */
  const syncBuffsFromStorage = useCallback(() => {
    loadBuffsToCache();
    // 清空本地状态，下次 getBuffs 会重新从 storage 读取
    setButtonBuffs({});
    console.log('[Buff] 已从 storage 同步');
  }, []);

  return {
    buttonBuffs,
    getBuffs,
    addBuff,
    removeBuff,
    clearBuffs,
    getAllBuffs,
    syncBuffsFromStorage,
  };
}

// ===== 独立函数版本，供组件直接调用 =====

/**
 * 设置当前选中的技能按钮 ID（用于 DamageTab 添加 Buff）
 * @param buttonId - 技能按钮 ID，null 表示清除
 */
export { setSelectedSkillButton };

/**
 * 获取当前选中的技能按钮 ID
 * @returns 技能按钮 ID 或 null
 */
export { getSelectedSkillButton };

/**
 * 获取指定按钮的完整 Buff 数据（独立函数版本）
 * @param buttonId - 按钮 ID
 * @returns Buff 列表（包含完整字段）
 */
export { getBuffsByButtonId as getButtonBuffs };

/**
 * 添加 Buff 到技能按钮（独立函数版本，供 DamageTab 使用）
 * 纯函数实现，不调用任何 Hook
 * @param buttonId - 按钮 ID
 * @param buff - Buff 数据（如果传入的 buff 已有 id，则使用该 id）
 * @returns 添加结果和实际 buffId
 */
export { addBuffToButton as addSkillButtonBuff };

/**
 * 从技能按钮移除 Buff（独立函数版本）
 * @param buttonId - 按钮 ID
 * @param buffId - Buff ID
 */
export { removeBuffFromButton as removeSkillButtonBuff };
