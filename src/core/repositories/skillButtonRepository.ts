/**
 * SkillButton Repository
 * 只负责 ddd.skill-button.v1 的读写
 * 不依赖 React，不写业务规则
 */

import { STORAGE_KEYS } from '../../constants/storage-keys';
import { PersistedSkillButton, SkillButtonTable } from '../../types/storage';
import { safeSessionStorage } from '../../utils/storage';

function normalizeSkillButton(button: PersistedSkillButton): PersistedSkillButton {
  const selectedBuff = Array.isArray(button.selectedBuff) ? button.selectedBuff : [];

  return {
    ...button,
    characterId: button.characterId || button.characterName,
    selectedBuff,
    panelConfig: button.panelConfig ?? {
      selectedBuff: [...selectedBuff],
    },
    panelSnapshot: button.panelSnapshot ?? null,
  };
}

/**
 * 获取 skill-button 总表
 */
export function getSkillButtonTable(): SkillButtonTable {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.SKILL_BUTTON_TABLE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SkillButtonTable;
    const normalized = Object.fromEntries(
      Object.entries(parsed).map(([buttonId, button]) => [
        buttonId,
        normalizeSkillButton(button),
      ])
    );
    return normalized;
  } catch {
    return {};
  }
}

/**
 * 设置 skill-button 总表
 */
export function setSkillButtonTable(table: SkillButtonTable): void {
  safeSessionStorage.setItem(STORAGE_KEYS.SKILL_BUTTON_TABLE, JSON.stringify(table));
}

/**
 * 根据 ID 获取单个 button
 */
export function getSkillButtonById(buttonId: string): PersistedSkillButton | null {
  const table = getSkillButtonTable();
  return table[buttonId] ?? null;
}

/**
 * 插入或更新单个 button
 */
export function upsertSkillButton(button: PersistedSkillButton): void {
  const table = getSkillButtonTable();
  table[button.id] = {
    ...normalizeSkillButton(button),
    updatedAt: Date.now(),
  };
  setSkillButtonTable(table);
}

/**
 * 根据 ID 删除 button
 */
export function removeSkillButtonById(buttonId: string): void {
  const table = getSkillButtonTable();
  delete table[buttonId];
  setSkillButtonTable(table);
}
