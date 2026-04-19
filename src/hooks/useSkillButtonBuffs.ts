/**
 * 技能按钮 Buff 管理 Hook (v2 新缓存模型)
 * 管理每个技能按钮关联的 Buff 列表
 * 
 * 新模型：
 * - skill-button 总表：存放所有 button，包含 selectedBuff（buffId 列表）
 * - buff-list 总表：存放所有 Buff 完整数据
 * - 本 Hook 提供运行时读取/添加/删除接口
 */

import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { SkillButtonBuff } from '../types/storage';
import {
  safeSessionStorage,
  getSkillButtonById,
  upsertSkillButton,
  getBuffById,
  upsertBuff,
  removeBuffById,
  isBuffReferenced,
  getAllBuffList,
} from '../utils/storage';

// Buff 数据缓存（用于运行时快速访问，不持久化）
let buffCache: Record<string, SkillButtonBuff> = {};

/**
 * 从 buff-list 总表加载所有 Buff 到缓存
 */
const loadBuffsToCache = (): void => {
  const list = getAllBuffList();
  buffCache = {};
  list.forEach(buff => {
    buffCache[buff.id] = buff;
  });
};

/**
 * 纯函数：添加 Buff 到技能按钮
 * 供 Hook 内 addBuff 和独立函数 addSkillButtonBuff 共用
 * @param buttonId - 按钮 ID
 * @param buff - Buff 数据（如果传入的 buff 已有 id，则使用该 id）
 * @returns 添加结果和实际 buffId
 */
function addBuffToButtonHelper(
  buttonId: string,
  buff: Omit<SkillButtonBuff, 'id'> & { id?: string }
): { success: boolean; buffId?: string; isDuplicate?: boolean } {
  // 1. 检查 button 是否存在
  const button = getSkillButtonById(buttonId);
  if (!button) {
    console.warn('[Buff] 按钮不存在:', buttonId);
    return { success: false };
  }

  const currentSelectedBuff = button.selectedBuff || [];

  // 2. 检查是否已存在相同 displayName 的 Buff
  const exists = currentSelectedBuff.some(id => {
    const existingBuff = buffCache[id] || getBuffById(id);
    return existingBuff?.displayName === buff.displayName;
  });

  if (exists) {
    console.log('[Buff] 已存在相同 displayName 的 Buff:', buff.displayName);
    return { success: true, buffId: undefined, isDuplicate: true };
  }

  // 3. 生成或使用传入的 buffId
  const buffId = buff.id || `buff-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // 4. 构造完整 Buff 对象
  const newBuff: SkillButtonBuff = {
    ...buff,
    id: buffId,
  };

  // 5. 写入 buff-list 总表
  upsertBuff(newBuff);
  buffCache[buffId] = newBuff;

  // 6. 更新 skill-button 总表中的 selectedBuff
  upsertSkillButton({
    ...button,
    selectedBuff: [...currentSelectedBuff, buffId],
    updatedAt: Date.now(),
  });

  console.log('[Buff] 已添加到技能按钮:', buttonId, buff.displayName, buffId);
  return { success: true, buffId };
}

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
   * 从 skill-button 总表读取 selectedBuff，再从 buff-list 总表解引用
   * @param buttonId - 技能按钮 ID
   * @returns Buff 列表
   */
  const getBuffs = useCallback((buttonId: string): SkillButtonBuff[] => {
    // 从 skill-button 总表读取 button
    const button = getSkillButtonById(buttonId);
    if (!button || !button.selectedBuff || button.selectedBuff.length === 0) {
      return [];
    }

    // 根据 selectedBuff 中的 buffId 从缓存/总表解引用
    return button.selectedBuff
      .map(buffId => buffCache[buffId] || getBuffById(buffId))
      .filter((buff): buff is SkillButtonBuff => buff !== null);
  }, []);

  /**
   * 添加 Buff 到指定技能按钮
   * @param buttonId - 技能按钮 ID
   * @param buff - Buff 数据（不含 id，或包含 id）
   * @returns 是否添加成功，以及生成的 buffId
   */
  const addBuff = useCallback((buttonId: string, buff: Omit<SkillButtonBuff, 'id'> & { id?: string }): { success: boolean; buffId?: string } => {
    const result = addBuffToButtonHelper(buttonId, buff);

    if (result.success && result.buffId) {
      // 更新本地状态
      const newBuff = buffCache[result.buffId];
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
    // 1. 从 skill-button 总表的 selectedBuff 中移除
    const button = getSkillButtonById(buttonId);
    if (button && button.selectedBuff) {
      const newSelectedBuff = button.selectedBuff.filter(id => id !== buffId);
      upsertSkillButton({
        ...button,
        selectedBuff: newSelectedBuff,
        updatedAt: Date.now(),
      });
    }

    // 2. 检查 Buff 是否还被其他按钮引用
    if (!isBuffReferenced(buffId)) {
      // 无引用则删除
      removeBuffById(buffId);
      delete buffCache[buffId];
    }

    // 3. 更新本地状态
    setButtonBuffs(prev => ({
      ...prev,
      [buttonId]: (prev[buttonId] || []).filter(b => b.id !== buffId),
    }));

    console.log('[Buff] 已从技能按钮移除:', buttonId, buffId);
  }, []);

  /**
   * 清空指定技能按钮的所有 Buff
   * @param buttonId - 技能按钮 ID
   */
  const clearBuffs = useCallback((buttonId: string) => {
    // 1. 读取 button 并保存旧 selectedBuff
    const button = getSkillButtonById(buttonId);
    if (!button || !button.selectedBuff || button.selectedBuff.length === 0) {
      return;
    }

    const oldSelectedBuff = [...button.selectedBuff]; // 保存旧引用

    // 2. 先将当前 button 的 selectedBuff 写回为空数组（先解绑）
    upsertSkillButton({
      ...button,
      selectedBuff: [],
      updatedAt: Date.now(),
    });

    // 3. 对旧 buffIds 执行引用检查（此时当前 button 已不持有这些 Buff）
    oldSelectedBuff.forEach(buffId => {
      if (!isBuffReferenced(buffId)) {
        removeBuffById(buffId);
        delete buffCache[buffId];
        console.log('[Buff 清理] 删除无引用 Buff:', buffId);
      }
    });

    // 4. 更新本地状态
    setButtonBuffs(prev => {
      const newMap = { ...prev };
      delete newMap[buttonId];
      return newMap;
    });

    console.log('[Buff] 已清空技能按钮的所有 Buff:', buttonId);
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
 * 获取指定按钮的完整 Buff 数据（独立函数版本）
 * @param buttonId - 按钮 ID
 * @returns Buff 列表（包含完整字段）
 */
export function getButtonBuffs(buttonId: string): SkillButtonBuff[] {
  const button = getSkillButtonById(buttonId);
  if (!button || !button.selectedBuff) {
    return [];
  }
  return button.selectedBuff
    .map(buffId => buffCache[buffId] || getBuffById(buffId))
    .filter((buff): buff is SkillButtonBuff => buff !== null);
}

/**
 * 添加 Buff 到技能按钮（独立函数版本，供 DamageTab 使用）
 * 纯函数实现，不调用任何 Hook
 * @param buttonId - 按钮 ID
 * @param buff - Buff 数据（如果传入的 buff 已有 id，则使用该 id）
 * @returns 添加结果和实际 buffId
 */
export function addSkillButtonBuff(
  buttonId: string,
  buff: Omit<SkillButtonBuff, 'id'> & { id?: string }
): { success: boolean; buffId?: string; isDuplicate?: boolean } {
  return addBuffToButtonHelper(buttonId, buff);
}

/**
 * 从技能按钮移除 Buff（独立函数版本）
 * @param buttonId - 按钮 ID
 * @param buffId - Buff ID
 */
export const removeSkillButtonBuff = (buttonId: string, buffId: string): void => {
  const button = getSkillButtonById(buttonId);
  if (button && button.selectedBuff) {
    const newSelectedBuff = button.selectedBuff.filter(id => id !== buffId);
    upsertSkillButton({
      ...button,
      selectedBuff: newSelectedBuff,
      updatedAt: Date.now(),
    });

    if (!isBuffReferenced(buffId)) {
      removeBuffById(buffId);
    }
  }
};
