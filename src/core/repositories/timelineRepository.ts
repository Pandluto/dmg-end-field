/**
 * Timeline Repository
 * 只负责 def.timeline.data.v1 的读写
 * 不依赖 React，不写业务规则
 */

import { STORAGE_KEYS } from '../../constants/storage-keys';
import { TimelineData } from '../../types';
import { safeSessionStorage } from '../../utils/storage';

/**
 * 保存 timeline 数据
 */
export function saveTimelineData(data: TimelineData): void {
  safeSessionStorage.setItem(STORAGE_KEYS.TIMELINE_DATA, JSON.stringify(data));
}

/**
 * 加载 timeline 数据
 */
export function loadTimelineData(): TimelineData | null {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.TIMELINE_DATA);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TimelineData;
  } catch {
    return null;
  }
}

/**
 * 删除 timeline 数据
 */
export function removeTimelineData(): void {
  safeSessionStorage.removeItem(STORAGE_KEYS.TIMELINE_DATA);
}

