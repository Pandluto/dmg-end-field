/**
 * 旧缓存迁移工具
 * 将旧的缓存模型迁移到新的 v2 缓存模型
 * 
 * 旧模型：
 * - def.timeline.data.v1: buttons[] 中包含 buffIds
 * - def.skill-button-buffs.v1: Record<buttonId, Buff[]>
 * 
 * 新模型：
 * - def.skill-button.v1: Record<buttonId, PersistedSkillButton>（包含 selectedBuff: string[]）
 * - def.all-buff-list.v1: Buff[]（所有 Buff 完整数据）
 * - def.timeline.data.v1: 只保留按钮引用和位置，不再包含 buffIds
 */

import { STORAGE_KEYS } from '../constants/storage-keys';
import { SkillButtonBuff, PersistedSkillButton } from '../types/storage';
import { TimelineData, SkillButtonData } from '../types';
import {
  safeSessionStorage,
  getSkillButtonTable,
  setSkillButtonTable,
  getAllBuffList,
  setAllBuffList,
  getSkillButtonBuffMap,
} from './storage';

const LEGACY_NAMESPACE_PREFIX = 'ddd.';
const CURRENT_NAMESPACE_PREFIX = 'def.';

function migrateNamespaceForStorage(
  storage: Storage,
  storageName: 'localStorage' | 'sessionStorage'
): void {
  const legacyKeys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_NAMESPACE_PREFIX)) {
      legacyKeys.push(key);
    }
  }

  legacyKeys.forEach((legacyKey) => {
    const nextKey = `${CURRENT_NAMESPACE_PREFIX}${legacyKey.slice(LEGACY_NAMESPACE_PREFIX.length)}`;
    if (storage.getItem(nextKey) !== null) {
      return;
    }

    const value = storage.getItem(legacyKey);
    if (value === null) {
      return;
    }

    storage.setItem(nextKey, value);
    console.log(`[迁移] ${storageName}: ${legacyKey} -> ${nextKey}`);
  });
}

/**
 * 将历史 ddd.* 命名空间复制到新的 def.* 命名空间
 * 幂等：如果新 key 已存在，则保留新 key，不覆盖用户当前数据
 */
export function migrateLegacyStorageNamespace(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    migrateNamespaceForStorage(window.localStorage, 'localStorage');
    migrateNamespaceForStorage(window.sessionStorage, 'sessionStorage');
  } catch (error) {
    console.warn('[迁移] 命名空间迁移失败', error);
  }
}

/**
 * 检查是否需要迁移
 * @returns boolean
 */
export function needsMigration(): boolean {
  // 如果旧 key 存在且新 key 不存在，需要迁移
  const oldBuffs = safeSessionStorage.getItem(STORAGE_KEYS.SKILL_BUTTON_BUFFS);
  const newTable = safeSessionStorage.getItem(STORAGE_KEYS.SKILL_BUTTON_TABLE);
  return !!oldBuffs && !newTable;
}

/**
 * 从旧缓存迁移到新缓存模型
 * 幂等：可重复执行，不会重复污染
 */
export function migrateOldBuffStorage(): void {
  migrateLegacyStorageNamespace();

  if (!needsMigration()) {
    console.log('[迁移] 无需迁移或已迁移完成');
    return;
  }

  console.log('[迁移] 开始迁移旧缓存...');

  // 1. 读取旧数据
  const oldButtonBuffs = getSkillButtonBuffMap(); // Record<buttonId, Buff[]>
  const timelineDataRaw = safeSessionStorage.getItem(STORAGE_KEYS.TIMELINE_DATA);
  let timelineData: TimelineData | null = null;
  
  if (timelineDataRaw) {
    try {
      timelineData = JSON.parse(timelineDataRaw) as TimelineData;
    } catch {
      console.warn('[迁移] 解析 timeline data 失败');
    }
  }

  // 2. 准备新数据结构
  const newSkillButtonTable: Record<string, PersistedSkillButton> = getSkillButtonTable();
  const newBuffList: SkillButtonBuff[] = getAllBuffList();
  const existingBuffIds = new Set(newBuffList.map(b => b.id));

  // 3. 迁移 Buff 数据
  Object.entries(oldButtonBuffs).forEach(([buttonId, buffs]) => {
    if (!buffs || buffs.length === 0) return;

    // 为每个 Buff 生成稳定 ID（如果没有）
    const selectedBuffIds: string[] = [];
    
    buffs.forEach(buff => {
      // 生成稳定 ID：优先使用已有 id，否则生成新的
      const stableId = buff.id || `buff-${buttonId}-${buff.displayName}-${Date.now()}`;
      
      // 补全 Buff 字段
      const fullBuff: SkillButtonBuff = {
        id: stableId,
        name: buff.name || '',
        displayName: buff.displayName,
        sourceName: buff.sourceName,
        level: buff.level || '',
        type: buff.type || '',
        value: buff.value || 0,
        description: buff.description || '',
        source: buff.source || buff.sourceName || '',
        condition: buff.condition || '',
        refCount: 1,
      };

      // 添加到 buff-list（去重）
      if (!existingBuffIds.has(stableId)) {
        newBuffList.push(fullBuff);
        existingBuffIds.add(stableId);
      }

      selectedBuffIds.push(stableId);
    });

    // 4. 创建或更新 PersistedSkillButton
    // 从 timelineData 中查找对应的 button 信息
    let buttonInfo: SkillButtonData | undefined;
    if (timelineData) {
      for (const staffLine of timelineData.staffLines) {
        buttonInfo = staffLine.buttons.find(b => b.id === buttonId);
        if (buttonInfo) break;
      }
    }

    if (buttonInfo) {
      newSkillButtonTable[buttonId] = {
        id: buttonId,
        characterId: buttonInfo.characterName,
        characterName: buttonInfo.characterName,
        skillType: buttonInfo.skillType,
        staffIndex: buttonInfo.staffIndex,
        nodeIndex: buttonInfo.nodeIndex,
        nodeNumber: buttonInfo.nodeNumber,
        position: buttonInfo.position,
        selectedBuff: selectedBuffIds,
        panelConfig: {
          selectedBuff: [...selectedBuffIds],
        },
        panelSnapshot: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      // 如果找不到 button 信息，创建一个基本的记录
      newSkillButtonTable[buttonId] = {
        id: buttonId,
        characterId: '',
        characterName: '',
        skillType: '',
        staffIndex: 0,
        nodeIndex: 0,
        nodeNumber: 0,
        position: { x: 0, y: 0 },
        selectedBuff: selectedBuffIds,
        panelConfig: {
          selectedBuff: [...selectedBuffIds],
        },
        panelSnapshot: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    console.log(`[迁移] Button ${buttonId}: 迁移了 ${selectedBuffIds.length} 个 Buff`);
  });

  // 5. 写入新缓存
  setSkillButtonTable(newSkillButtonTable);
  setAllBuffList(newBuffList);

  // 6. 清理旧缓存（可选：保留一段时间以确保安全）
  // safeSessionStorage.removeItem(STORAGE_KEYS.SKILL_BUTTON_BUFFS);
  console.log('[迁移] 旧缓存已迁移完成');
  console.log(`[迁移] 新 skill-button 表: ${Object.keys(newSkillButtonTable).length} 个按钮`);
  console.log(`[迁移] 新 buff-list: ${newBuffList.length} 个 Buff`);
}

/**
 * 强制重新迁移（用于调试）
 */
export function forceRemigrate(): void {
  safeSessionStorage.removeItem(STORAGE_KEYS.SKILL_BUTTON_TABLE);
  migrateOldBuffStorage();
}

