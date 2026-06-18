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
import { normalizeBuffMultiplier } from '../domain/buffMultiplier';

// 运行时缓存（用于快速访问）
let buffCache: Record<string, SkillButtonBuff> = {};

function isModifierBuff(buff: SkillButtonBuff): boolean {
  return buff.effectKind !== 'extraHit';
}

function normalizeBuffCategory(category: unknown): 'condition' | 'countable' | 'passive' {
  if (category === 'countable' || category === 'passive' || category === 'condition') {
    return category;
  }
  if (category === 'positive') {
    return 'passive';
  }
  return 'condition';
}

function normalizeMaxStacks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function readButtonBuffStackCount(button: { buffStackCounts?: Record<string, number> }, buffId: string, buff: SkillButtonBuff): number {
  if (normalizeBuffCategory(buff.category) !== 'countable') return 1;
  const maxStacks = normalizeMaxStacks(buff.maxStacks);
  const rawCount = button.buffStackCounts?.[buffId];
  const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? Math.floor(rawCount) : maxStacks;
  return Math.min(Math.max(count, 0), maxStacks);
}

function withBuffStackCount(
  button: NonNullable<ReturnType<typeof getSkillButtonById>>,
  buffId: string,
  buff: SkillButtonBuff,
  nextCount: number | null,
) {
  const nextStackCounts = { ...(button.buffStackCounts ?? {}) };
  if (nextCount === null || normalizeBuffCategory(buff.category) !== 'countable') {
    delete nextStackCounts[buffId];
  } else {
    nextStackCounts[buffId] = Math.min(Math.max(Math.floor(nextCount), 0), normalizeMaxStacks(buff.maxStacks));
  }
  return nextStackCounts;
}

/**
 * 生成 Buff 内容的唯一签名
 * 用于全局去重：相同签名的 Buff 复用同一 buffId
 * 包含 target 字段，确保不同作用域的 Buff 不会错误合并
 */
export function getBuffIdentityKey(buff: Pick<SkillButtonBuff, 'name' | 'displayName' | 'sourceName' | 'level' | 'type' | 'value' | 'condition' | 'source' | 'target' | 'effectKind' | 'extraHitConfig' | 'category' | 'maxStacks' | 'multiplier'>): string {
  const targetStr = buff.target ? JSON.stringify(buff.target) : 'all';
  const extraHitStr = buff.extraHitConfig ? JSON.stringify(buff.extraHitConfig) : '';
  const multiplier = normalizeBuffMultiplier(buff.multiplier);
  const multiplierStr = multiplier ? String(multiplier.coefficient) : '';
  return `${buff.name}||${buff.displayName}||${buff.sourceName}||${buff.level}||${buff.type}||${buff.value}||${buff.condition}||${buff.source}||${targetStr}||${buff.effectKind || 'modifier'}||${extraHitStr}||${normalizeBuffCategory(buff.category)}||${normalizeBuffCategory(buff.category) === 'countable' ? normalizeMaxStacks(buff.maxStacks) : ''}||${multiplierStr}`;
}

/**
 * 按签名查全局 Buff 表，返回已有 buffId 或 null
 */
function findExistingBuffId(buff: Omit<SkillButtonBuff, 'id'>): string | null {
  const allBuffs = getAllBuffList();
  const targetKey = getBuffIdentityKey(buff);
  const existing = allBuffs.find(b => getBuffIdentityKey(b) === targetKey);
  return existing?.id ?? null;
}

function buildSkillButtonRuntimeSnapshot(buttonId: string) {
  const button = getSkillButtonById(buttonId);
  if (!button) return null;

  const characterId = button.characterId || button.characterName;
  const characterComputed = getCharacterComputed(characterId);
  const nowTimePanel = characterComputed?.panel;

  if (!nowTimePanel) {
    return null;
  }

  const buffList = getBuffsByButtonId(buttonId).filter(isModifierBuff);
  const buffTotals = calculateBuffTotals(buffList, button.buffStackCounts);

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
  const runtimeSnapshot = buildSkillButtonRuntimeSnapshot(buttonId);

  upsertSkillButton({
    ...button,
    panelConfig: {
      ...(button.panelConfig ?? { selectedBuff: [] }),
      selectedBuff,
    },
    runtimeSnapshot,
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

  // 2. 检查是否已存在相同内容的 Buff（当前按钮内），用 getBuffIdentityKey 统一判重
  const normalizedBuff = {
    ...buff,
    category: normalizeBuffCategory(buff.category),
    ...(normalizeBuffCategory(buff.category) === 'countable' ? { maxStacks: normalizeMaxStacks(buff.maxStacks) } : {}),
    multiplier: normalizeBuffMultiplier(buff.multiplier),
  };
  const targetKey = getBuffIdentityKey(normalizedBuff);
  const existsInButton = currentSelectedBuff.some(id => {
    const existingBuff = buffCache[id] || getBuffById(id);
    return existingBuff ? getBuffIdentityKey(existingBuff) === targetKey : false;
  });

  if (existsInButton) {
    const existingBuffId = currentSelectedBuff.find(id => {
      const existingBuff = buffCache[id] || getBuffById(id);
      return existingBuff ? getBuffIdentityKey(existingBuff) === targetKey : false;
    });
    const existingBuff = existingBuffId ? buffCache[existingBuffId] || getBuffById(existingBuffId) : null;
    if (existingBuffId && existingBuff && normalizeBuffCategory(existingBuff.category) === 'countable') {
      const currentCount = readButtonBuffStackCount(button, existingBuffId, existingBuff);
      const nextStackCounts = withBuffStackCount(button, existingBuffId, existingBuff, currentCount + 1);
      upsertSkillButton({
        ...button,
        buffStackCounts: nextStackCounts,
        panelConfig: {
          ...(button.panelConfig ?? { selectedBuff: [] }),
          selectedBuff: currentSelectedBuff,
        },
        updatedAt: Date.now(),
      });
      recomputeSkillButtonPanel(buttonId);
      return { success: true, buffId: existingBuffId, isDuplicate: false };
    }
    console.log('[buffService] 按钮内已存在相同内容 Buff:', normalizedBuff.displayName);
    return { success: true, buffId: undefined, isDuplicate: true };
  }

  // 3. 先查全局 def.all-buff-list.v1 是否有同内容 Buff，有则复用
  const existingBuffId = findExistingBuffId(normalizedBuff);
  let buffId: string;

  if (existingBuffId) {
    // 复用已有 buffId，refCount + 1
    buffId = existingBuffId;
    const existingBuff = getBuffById(existingBuffId);
    if (existingBuff) {
      upsertBuff({ ...existingBuff, refCount: (existingBuff.refCount || 1) + 1 });
      buffCache[buffId] = { ...existingBuff, refCount: (existingBuff.refCount || 1) + 1 };
    }
    console.log('[buffService] 复用已有 Buff 实体:', existingBuffId, buff.displayName, 'refCount+1');
  } else {
    // 生成新 buffId，refCount = 1
    buffId = buff.id || `buff-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newBuff: SkillButtonBuff = {
      ...buff,
      ...normalizedBuff,
      id: buffId,
      refCount: 1,
    };
    upsertBuff(newBuff);
    buffCache[buffId] = newBuff;
    console.log('[buffService] 新建 Buff 实体:', buffId, buff.displayName, 'refCount=1');
  }

  const nextSelectedBuff = [...currentSelectedBuff, buffId];
  const savedBuff = buffCache[buffId] || getBuffById(buffId);
  const nextStackCounts = savedBuff && normalizeBuffCategory(savedBuff.category) === 'countable'
    ? withBuffStackCount(button, buffId, savedBuff, normalizeMaxStacks(savedBuff.maxStacks))
    : { ...(button.buffStackCounts ?? {}) };

  // 4. 更新 skill-button 总表中的 selectedBuff
  upsertSkillButton({
    ...button,
    selectedBuff: nextSelectedBuff,
    buffStackCounts: nextStackCounts,
    panelConfig: {
      ...(button.panelConfig ?? { selectedBuff: [] }),
      selectedBuff: nextSelectedBuff,
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
 * 规则：先从 button.selectedBuff 解绑 → refCount - 1 → refCount === 0 时删除实体
 */
export function removeBuffFromButton(buttonId: string, buffId: string): void {
  // 1. 从 skill-button 总表的 selectedBuff 中移除
  const button = getSkillButtonById(buttonId);
  if (button && button.selectedBuff) {
    const newSelectedBuff = button.selectedBuff.filter(id => id !== buffId);
    const buff = getBuffById(buffId);
    upsertSkillButton({
      ...button,
      selectedBuff: newSelectedBuff,
      buffStackCounts: buff ? withBuffStackCount(button, buffId, buff, null) : button.buffStackCounts,
      panelConfig: {
        ...(button.panelConfig ?? { selectedBuff: [] }),
        selectedBuff: newSelectedBuff,
      },
      updatedAt: Date.now(),
    });
    recomputeSkillButtonPanel(buttonId);
  }

  // 2. refCount - 1，如果 === 0 则删除实体
  const buff = getBuffById(buffId);
  if (buff) {
    const newRefCount = (buff.refCount || 1) - 1;
    if (newRefCount <= 0) {
      removeBuffById(buffId);
      delete buffCache[buffId];
      console.log('[buffService] Buff refCount=0，删除实体:', buffId);
    } else {
      upsertBuff({ ...buff, refCount: newRefCount });
      buffCache[buffId] = { ...buff, refCount: newRefCount };
      console.log('[buffService] Buff refCount -1:', buffId, 'newRefCount=', newRefCount);
    }
  }

  console.log('[buffService] 已从按钮移除 Buff:', buttonId, buffId);
}

export function decrementBuffStackOnButton(buttonId: string, buffId: string): void {
  const button = getSkillButtonById(buttonId);
  const buff = getBuffById(buffId);
  if (!button || !buff || normalizeBuffCategory(buff.category) !== 'countable') {
    removeBuffFromButton(buttonId, buffId);
    return;
  }
  const currentCount = readButtonBuffStackCount(button, buffId, buff);
  if (currentCount <= 1) {
    upsertSkillButton({
      ...button,
      buffStackCounts: withBuffStackCount(button, buffId, buff, 1),
      updatedAt: Date.now(),
    });
    recomputeSkillButtonPanel(buttonId);
    return;
  }
  upsertSkillButton({
    ...button,
    buffStackCounts: withBuffStackCount(button, buffId, buff, currentCount - 1),
    updatedAt: Date.now(),
  });
  recomputeSkillButtonPanel(buttonId);
}

/**
 * 清空技能按钮的所有 Buff
 * 规则：对旧 selectedBuff 逐个 refCount - 1 → 0 时删除实体
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
    buffStackCounts: {},
    panelConfig: {
      ...(button.panelConfig ?? { selectedBuff: [] }),
      selectedBuff: [],
    },
    updatedAt: Date.now(),
  });
  recomputeSkillButtonPanel(buttonId);

  // 3. 对旧 buffIds 逐个 refCount - 1，0 时删除实体
  oldSelectedBuff.forEach(buffId => {
    const buff = getBuffById(buffId);
    if (buff) {
      const newRefCount = (buff.refCount || 1) - 1;
      if (newRefCount <= 0) {
        removeBuffById(buffId);
        delete buffCache[buffId];
        console.log('[buffService] Buff refCount=0，删除实体:', buffId);
      } else {
        upsertBuff({ ...buff, refCount: newRefCount });
        buffCache[buffId] = { ...buff, refCount: newRefCount };
        console.log('[buffService] Buff refCount -1:', buffId, 'newRefCount=', newRefCount);
      }
    }
  });

  console.log('[buffService] 已清空按钮 Buff:', buttonId);
}

/**
 * 删除按钮时清理 Buff 引用
 * 规则：接收已保存的 oldSelectedBuff → 对每个 buffId 做 refCount - 1 → 0 时删除实体
 * @param oldSelectedBuff - 删除前保存的 buffId 列表
 */
export function cleanupBuffsOnButtonRemove(oldSelectedBuff: string[]): void {
  // 对旧 selectedBuff 逐个 refCount - 1，0 时删除实体
  oldSelectedBuff.forEach(buffId => {
    const buff = getBuffById(buffId);
    if (buff) {
      const newRefCount = (buff.refCount || 1) - 1;
      if (newRefCount <= 0) {
        removeBuffById(buffId);
        delete buffCache[buffId];
        console.log('[buffService] Buff refCount=0，删除实体:', buffId);
      } else {
        upsertBuff({ ...buff, refCount: newRefCount });
        buffCache[buffId] = { ...buff, refCount: newRefCount };
        console.log('[buffService] Buff refCount -1:', buffId, 'newRefCount=', newRefCount);
      }
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

/**
 * 从 def.skill-button.v1.selectedBuff 全量重建 def.all-buff-list.v1.refCount
 * 用于修复历史脏数据，或校验 refCount 是否失真
 * 规则：扫描所有按钮的 selectedBuff，统计每个 buffId 被引用次数，回写 refCount
 */
export function rebuildBuffRefCounts(): {
  rebuilt: Record<string, number>;
  removedOrphans: string[];
} {
  const table = getSkillButtonTable();
  const allBuffs = getAllBuffList();

  // 1. 从 selectedBuff 统计实际引用次数
  const actualCounts: Record<string, number> = {};
  Object.values(table).forEach((button: { selectedBuff?: string[] }) => {
    button.selectedBuff?.forEach(buffId => {
      actualCounts[buffId] = (actualCounts[buffId] || 0) + 1;
    });
  });

  // 2. 回写 refCount 到 all-buff-list
  const rebuilt: Record<string, number> = {};
  Object.entries(actualCounts).forEach(([buffId, count]) => {
    const buff = getBuffById(buffId);
    if (buff) {
      upsertBuff({ ...buff, refCount: count });
      buffCache[buffId] = { ...buff, refCount: count };
      rebuilt[buffId] = count;
    }
  });

  // 3. 找出孤儿实体（refCount > 0 但实际上没有被任何按钮引用）
  const removedOrphans: string[] = [];
  allBuffs.forEach(buff => {
    if (actualCounts[buff.id] === undefined && buff.refCount > 0) {
      // 孤儿实体：refCount 还 > 0 但已无引用，删除
      removeBuffById(buff.id);
      delete buffCache[buff.id];
      removedOrphans.push(buff.id);
      console.log('[buffService] 清理孤儿 Buff 实体:', buff.id, 'oldRefCount=', buff.refCount);
    }
  });

  console.log('[buffService] 重建 refCount 完成:', Object.keys(rebuilt).length, '个已更新,', removedOrphans.length, '个孤儿已清理');
  return { rebuilt, removedOrphans };
}

/**
 * 归并 def.all-buff-list.v1 中的重复 Buff 实体
 * - 按 getBuffIdentityKey 分组
 * - 保留一个 canonical buffId
 * - 把 skill-button.v1 中指向重复 Buff 的引用都改写到 canonical buffId
 * - 删除重复实体
 */
export function deduplicateBuffEntities(): {
  merged: number;
  removed: string[];
} {
  const allBuffs = getAllBuffList();
  const table = getSkillButtonTable();

  // 按签名分组
  const groups: Record<string, string[]> = {};
  allBuffs.forEach(buff => {
    const key = getBuffIdentityKey(buff);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(buff.id);
  });

  const removedBuffIds: string[] = [];
  let merged = 0;

  // 对每组处理：保留第一个为 canonical，合并其他引用
  Object.entries(groups).forEach(([key, buffIds]) => {
    if (buffIds.length <= 1) return; // 没有重复

    const [canonicalId, ...duplicateIds] = buffIds;
    merged++;

    // 遍历所有按钮，把引用从 duplicateIds 改到 canonicalId
    Object.values(table).forEach((button) => {
      if (!button.selectedBuff) return;

      let changed = false;
      const newSelectedBuff = button.selectedBuff.map(id => {
        if (duplicateIds.includes(id)) {
          changed = true;
          return canonicalId;
        }
        return id;
      });

      // 去重（如果同一个按钮的 selectedBuff 原来就有重复引用的话）
      const uniqueSelectedBuff = [...new Set(newSelectedBuff)];
      const nextStackCounts = { ...(button.buffStackCounts ?? {}) };
      duplicateIds.forEach((duplicateId) => {
        if (nextStackCounts[duplicateId] !== undefined && nextStackCounts[canonicalId] === undefined) {
          nextStackCounts[canonicalId] = nextStackCounts[duplicateId];
        }
        delete nextStackCounts[duplicateId];
      });

      if (changed) {
        upsertSkillButton({
          ...button,
          selectedBuff: uniqueSelectedBuff,
          buffStackCounts: nextStackCounts,
          panelConfig: {
            ...(button.panelConfig ?? { selectedBuff: [] }),
            selectedBuff: uniqueSelectedBuff,
          },
          updatedAt: Date.now(),
        });
      }
    });

    // 删除重复实体
    duplicateIds.forEach(id => {
      removeBuffById(id);
      delete buffCache[id];
      removedBuffIds.push(id);
    });

    console.log(`[buffService] 归并 Buff 组: key=${key}, canonical=${canonicalId}, removed=${duplicateIds.join(',')}`);
  });

  console.log(`[buffService] 归并完成: ${merged} 组, 删除 ${removedBuffIds.length} 个重复实体`);
  return { merged, removed: removedBuffIds };
}

/**
 * 将已存在的 Buff 引用附加到新按钮（复制场景使用）
 * 规则：对每个 buffId → refCount + 1 → 更新按钮 selectedBuff → 同步 panelConfig.selectedBuff → recomputeSkillButtonPanel
 * @param buttonId - 目标按钮 ID
 * @param buffIds - 要附加的已有 buffId 列表
 */
export function attachExistingBuffsToButton(buttonId: string, buffIds: string[]): void {
  if (!buffIds || buffIds.length === 0) return;

  const button = getSkillButtonById(buttonId);
  if (!button) {
    console.warn('[buffService] attachExistingBuffsToButton: 按钮不存在:', buttonId);
    return;
  }

  const currentSelectedBuff = button.selectedBuff || [];

  buffIds.forEach(buffId => {
    const buff = getBuffById(buffId);
    if (buff) {
      upsertBuff({ ...buff, refCount: (buff.refCount || 1) + 1 });
      buffCache[buffId] = { ...buff, refCount: (buff.refCount || 1) + 1 };
      console.log('[buffService] 复制按钮附加 Buff，refCount +1:', buffId, 'newRefCount=', (buff.refCount || 1) + 1);
    } else {
      console.warn('[buffService] attachExistingBuffsToButton: Buff 不存在:', buffId);
    }
  });

  const newSelectedBuff = [...currentSelectedBuff, ...buffIds];
  const nextStackCounts = { ...(button.buffStackCounts ?? {}) };
  buffIds.forEach((buffId) => {
    const buff = getBuffById(buffId);
    if (buff && normalizeBuffCategory(buff.category) === 'countable' && nextStackCounts[buffId] === undefined) {
      nextStackCounts[buffId] = normalizeMaxStacks(buff.maxStacks);
    }
  });
  upsertSkillButton({
    ...button,
    selectedBuff: newSelectedBuff,
    buffStackCounts: nextStackCounts,
    panelConfig: {
      ...(button.panelConfig ?? { selectedBuff: [] }),
      selectedBuff: newSelectedBuff,
    },
    updatedAt: Date.now(),
  });

  recomputeSkillButtonPanel(buttonId);
  console.log('[buffService] attachExistingBuffsToButton 完成:', buttonId, '新增 buffIds:', buffIds);
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

