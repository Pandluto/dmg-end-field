/**
 * Buff Service
 * 负责 Buff 业务规则和写入顺序
 * 不依赖 React，不访问 DOM，不手写 dispatchEvent
 */

import { SkillButtonBuff } from '../../types/storage';
import {
  getSkillButtonById,
  upsertSkillButton,
  getSkillButtonTable,
  getBuffById,
  upsertBuff,
  removeBuffById,
  getAllBuffList,
} from '../repositories';
import { calculateBuffTotals } from '../calculators/buffCalculator';
import { getCharacterComputed } from '../../utils/storage';

// 运行时缓存（用于快速访问）
let buffCache: Record<string, SkillButtonBuff> = {};

function buildSkillButtonPanelSnapshot(buttonId: string) {
  const button = getSkillButtonById(buttonId);
  if (!button) return null;

  const characterId = button.characterId || button.characterName;
  const characterComputed = getCharacterComputed(characterId);
  const nowTimePanel = characterComputed?.panel;

  if (!nowTimePanel) {
    return null;
  }

  const buffList = getBuffsByButtonId(buttonId);
  const buffTotals = calculateBuffTotals(buffList);

  const currentAtkPercent = nowTimePanel.weaponAtkPercent * 0.01;
  const rawAtk = nowTimePanel.characterAtk + nowTimePanel.weaponAtk;
  const fixedAtk = nowTimePanel.baseAtk - rawAtk * (1 + currentAtkPercent);
  const nextBaseAtk = rawAtk * (1 + currentAtkPercent + buffTotals.atkPercentBoost) + fixedAtk;
  const abilityAtkPercentBonus = nowTimePanel.abilityBonus * 0.01;
  const nextAtk = nextBaseAtk * (1 + abilityAtkPercentBonus);

  return {
    atk: nextAtk,
    critRate: (nowTimePanel.critRate ?? 0.05) + buffTotals.critRateBoost,
    critDmg: (nowTimePanel.critDmg ?? 0.5) + buffTotals.critDmgBonusBoost,
  };
}

export function recomputeSkillButtonPanel(buttonId: string): void {
  const button = getSkillButtonById(buttonId);
  if (!button) return;

  const selectedBuff = [...(button.selectedBuff || [])];
  const panelSnapshot = buildSkillButtonPanelSnapshot(buttonId);

  upsertSkillButton({
    ...button,
    panelConfig: {
      ...(button.panelConfig ?? { selectedBuff: [] }),
      selectedBuff,
    },
    panelSnapshot,
    updatedAt: Date.now(),
  });
}

/**
 * 从 repository 加载所有 Buff 到缓存
 */
export function loadBuffsToCache(): void {
  const list = getAllBuffList();
  buffCache = {};
  list.forEach(buff => {
    buffCache[buff.id] = buff;
  });
}

/**
 * 获取缓存中的 Buff
 */
export function getBuffFromCache(buffId: string): SkillButtonBuff | undefined {
  return buffCache[buffId];
}

/**
 * 添加 Buff 到技能按钮
 * 规则：先检查重复 → 生成 id → 写 buff-list → 写 button.selectedBuff
 * @returns 添加结果和实际 buffId
 */
export function addBuffToButton(
  buttonId: string,
  buff: Omit<SkillButtonBuff, 'id'> & { id?: string }
): { success: boolean; buffId?: string; isDuplicate?: boolean } {
  // 1. 检查 button 是否存在
  const button = getSkillButtonById(buttonId);
  if (!button) {
    console.warn('[buffService] 按钮不存在:', buttonId);
    return { success: false };
  }

  const currentSelectedBuff = button.selectedBuff || [];

  // 2. 检查是否已存在相同 displayName 的 Buff
  const exists = currentSelectedBuff.some(id => {
    const existingBuff = buffCache[id] || getBuffById(id);
    return existingBuff?.displayName === buff.displayName;
  });

  if (exists) {
    console.log('[buffService] 已存在相同 displayName 的 Buff:', buff.displayName);
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
    panelConfig: {
      ...(button.panelConfig ?? { selectedBuff: [] }),
      selectedBuff: [...currentSelectedBuff, buffId],
    },
    updatedAt: Date.now(),
  });
  recomputeSkillButtonPanel(buttonId);

  console.log('[buffService] 已添加 Buff:', buttonId, buff.displayName, buffId);
  return { success: true, buffId };
}

/**
 * 获取指定技能按钮的 Buff 列表
 * 从 skill-button 总表读取 selectedBuff，再从 buff-list 总表解引用
 */
export function getBuffsByButtonId(buttonId: string): SkillButtonBuff[] {
  const button = getSkillButtonById(buttonId);
  if (!button || !button.selectedBuff || button.selectedBuff.length === 0) {
    return [];
  }

  return button.selectedBuff
    .map(buffId => buffCache[buffId] || getBuffById(buffId))
    .filter((buff): buff is SkillButtonBuff => buff !== null);
}

/**
 * 从技能按钮移除单个 Buff
 * 规则：先从 button.selectedBuff 解绑 → 再检查引用 → 无引用才删除 Buff 实体
 */
export function removeBuffFromButton(buttonId: string, buffId: string): void {
  // 1. 从 skill-button 总表的 selectedBuff 中移除
  const button = getSkillButtonById(buttonId);
  if (button && button.selectedBuff) {
    const newSelectedBuff = button.selectedBuff.filter(id => id !== buffId);
    upsertSkillButton({
      ...button,
      selectedBuff: newSelectedBuff,
      panelConfig: {
        ...(button.panelConfig ?? { selectedBuff: [] }),
        selectedBuff: newSelectedBuff,
      },
      updatedAt: Date.now(),
    });
    recomputeSkillButtonPanel(buttonId);
  }

  // 2. 检查 Buff 是否还被其他 button 引用
  if (!isBuffReferenced(buffId)) {
    // 无引用则删除
    removeBuffById(buffId);
    delete buffCache[buffId];
    console.log('[buffService] 删除无引用 Buff:', buffId);
  }

  console.log('[buffService] 已从按钮移除 Buff:', buttonId, buffId);
}

/**
 * 清空技能按钮的所有 Buff
 * 规则：先保存旧 selectedBuff → 先解绑当前 button → 再查引用 → 再删除无引用实体
 */
export function clearButtonBuffs(buttonId: string): void {
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
    panelConfig: {
      ...(button.panelConfig ?? { selectedBuff: [] }),
      selectedBuff: [],
    },
    updatedAt: Date.now(),
  });
  recomputeSkillButtonPanel(buttonId);

  // 3. 对旧 buffIds 执行引用检查（此时当前 button 已不持有这些 Buff）
  oldSelectedBuff.forEach(buffId => {
    if (!isBuffReferenced(buffId)) {
      removeBuffById(buffId);
      delete buffCache[buffId];
      console.log('[buffService] 删除无引用 Buff:', buffId);
    }
  });

  console.log('[buffService] 已清空按钮 Buff:', buttonId);
}

/**
 * 删除按钮时清理 Buff 引用
 * 规则：接收已保存的 oldSelectedBuff → 对旧 buffIds 做引用检查 → 无引用才删除 Buff 实体
 * @param oldSelectedBuff - 删除前保存的 buffId 列表
 */
export function cleanupBuffsOnButtonRemove(oldSelectedBuff: string[]): void {
  // 对旧 selectedBuff 逐个执行引用检查，删除无引用的 Buff
  oldSelectedBuff.forEach(buffId => {
    if (!isBuffReferenced(buffId)) {
      removeBuffById(buffId);
      delete buffCache[buffId];
      console.log('[buffService] 删除无引用 Buff:', buffId);
    }
  });
}

/**
 * 检查 Buff 是否被任何 button 引用
 */
export function isBuffReferenced(buffId: string): boolean {
  const table = getSkillButtonTable();
  return Object.values(table).some((button: { selectedBuff?: string[] }) =>
    button.selectedBuff?.includes(buffId)
  );
}

// ===== 选中技能按钮 ID 的读写 =====

import { STORAGE_KEYS } from '../../constants/storage-keys';
import { safeSessionStorage } from '../../utils/storage';

/**
 * 设置当前选中的技能按钮 ID
 */
export function setSelectedSkillButton(buttonId: string | null): void {
  if (buttonId) {
    safeSessionStorage.setItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON, buttonId);
  } else {
    safeSessionStorage.removeItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON);
  }
}

/**
 * 获取当前选中的技能按钮 ID
 */
export function getSelectedSkillButton(): string | null {
  return safeSessionStorage.getItem(STORAGE_KEYS.SELECTED_SKILL_BUTTON);
}
