/**
 * Candidate Buff Repository
 * 只负责 def.candidate-buff-list.v1（候选 Buff 列表）的读写
 * 不依赖 React，不写业务规则
 */

import { STORAGE_KEYS } from '../../constants/storage-keys';
import { CandidateBuff } from '../../core/domain/buff';
import { safeSessionStorage } from '../../utils/storage';
import { normalizeStoredCandidateBuffList } from '../services/buffStorageNormalization';

/**
 * 获取候选 Buff 列表
 */
export function getCandidateBuffList(): CandidateBuff[] {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.CANDIDATE_BUFF_LIST);
  if (!raw) return [];
  try {
    return normalizeStoredCandidateBuffList(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * 设置候选 Buff 列表
 */
export function setCandidateBuffList(list: CandidateBuff[]): void {
  safeSessionStorage.setItem(
    STORAGE_KEYS.CANDIDATE_BUFF_LIST,
    JSON.stringify(normalizeStoredCandidateBuffList(list))
  );
}

/**
 * 清空候选 Buff 列表
 */
export function clearCandidateBuffList(): void {
  safeSessionStorage.removeItem(STORAGE_KEYS.CANDIDATE_BUFF_LIST);
}

