/**
 * SkillButton Repository
 * 只负责 def.skill-button.v1 的读写
 * 不依赖 React，不写业务规则
 */

import { STORAGE_KEYS } from '../../constants/storage-keys';
import { HitResistanceInput, PersistedSkillButton, SkillButtonAnomalyConfig, SkillButtonTable } from '../../types/storage';
import { safeSessionStorage } from '../../utils/storage';

function normalizeResistanceInput(input: unknown): HitResistanceInput {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const readNumber = (key: keyof HitResistanceInput): number | undefined => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  return {
    physicalResistance: readNumber('physicalResistance') ?? 0,
    fireResistance: readNumber('fireResistance') ?? 0,
    electricResistance: readNumber('electricResistance') ?? 0,
    iceResistance: readNumber('iceResistance') ?? 0,
    natureResistance: readNumber('natureResistance') ?? 0,
  };
}

function normalizeSkillButton(button: PersistedSkillButton): PersistedSkillButton {
  const legacyButton = button as PersistedSkillButton & {
    panelSnapshot?: PersistedSkillButton['runtimeSnapshot'];
  };
  const { panelSnapshot: _legacyPanelSnapshot, ...buttonWithoutLegacySnapshot } = legacyButton;
  const anomalyConfig = (button.anomalyConfig ?? {}) as {
    selectedStatuses?: SkillButtonAnomalyConfig['selectedStatuses'];
    selectedStates?: SkillButtonAnomalyConfig['selectedStatuses'];
    selectedDamages?: SkillButtonAnomalyConfig['selectedDamages'];
    selectedStateSnapshotIds?: unknown[];
  };
  const selectedBuff = Array.isArray(button.selectedBuff) ? button.selectedBuff : [];
  const manualDisabledBuffIdsBySegmentKey = Object.fromEntries(
    Object.entries(button.panelConfig?.manualDisabledBuffIdsBySegmentKey ?? {}).map(([segmentKey, buffIds]) => [
      segmentKey,
      Array.isArray(buffIds) ? buffIds : [],
    ])
  );

  return {
    ...buttonWithoutLegacySnapshot,
    characterId: button.characterId || button.characterName,
    selectedBuff,
    anomalyConfig: {
      selectedStatuses: Array.isArray(anomalyConfig.selectedStatuses)
        ? anomalyConfig.selectedStatuses
        : Array.isArray(anomalyConfig.selectedStates)
          ? anomalyConfig.selectedStates
          : [],
      selectedDamages: Array.isArray(anomalyConfig.selectedDamages) ? anomalyConfig.selectedDamages : [],
      selectedStateSnapshotIds: Array.isArray(anomalyConfig.selectedStateSnapshotIds)
        ? anomalyConfig.selectedStateSnapshotIds
          .filter((id): id is number => typeof id === 'number')
        : [],
    },
    resistanceConfig: {
      targetResistance: normalizeResistanceInput(button.resistanceConfig?.targetResistance),
    },
    panelConfig: button.panelConfig
      ? {
          ...button.panelConfig,
          selectedBuff: Array.isArray(button.panelConfig.selectedBuff) ? button.panelConfig.selectedBuff : [...selectedBuff],
          manualDisabledBuffIdsBySegmentKey,
        }
      : {
          selectedBuff: [...selectedBuff],
          manualDisabledBuffIdsBySegmentKey: {},
        },
    runtimeSnapshot: button.runtimeSnapshot ?? legacyButton.panelSnapshot ?? null,
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
    if (JSON.stringify(normalized) !== raw) {
      safeSessionStorage.setItem(STORAGE_KEYS.SKILL_BUTTON_TABLE, JSON.stringify(normalized));
    }
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

