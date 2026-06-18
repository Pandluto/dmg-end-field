/**
 * Buff Repository
 * 只负责 def.all-buff-list.v1（已选 Buff 实体表）的读写
 * 不依赖 React，不写业务规则
 */

import { STORAGE_KEYS } from '../../constants/storage-keys';
import { SkillButtonBuff, BuffList } from '../../types/storage';
import { safeSessionStorage } from '../../utils/storage';
import { normalizeStoredBuffList } from '../services/buffStorageNormalization';

/**
 * 获取 buff-list 总表
 */
export function getAllBuffList(): BuffList {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.ALL_BUFF_LIST);
  if (!raw) return [];
  try {
    return normalizeStoredBuffList(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * 设置 buff-list 总表
 */
export function setAllBuffList(list: BuffList): void {
  safeSessionStorage.setItem(
    STORAGE_KEYS.ALL_BUFF_LIST,
    JSON.stringify(normalizeStoredBuffList(list))
  );
}

/**
 * 根据 ID 获取单个 Buff
 */
export function getBuffById(buffId: string): SkillButtonBuff | null {
  const list = getAllBuffList();
  return list.find(b => b.id === buffId) ?? null;
}

/**
 * 插入或更新单个 Buff
 */
export function upsertBuff(buff: SkillButtonBuff): void {
  const list = getAllBuffList();
  const idx = list.findIndex(b => b.id === buff.id);
  if (idx >= 0) {
    list[idx] = buff;
  } else {
    list.push(buff);
  }
  setAllBuffList(list);
}

/**
 * 根据 ID 删除 Buff
 */
export function removeBuffById(buffId: string): void {
  const list = getAllBuffList().filter(b => b.id !== buffId);
  setAllBuffList(list);
}

