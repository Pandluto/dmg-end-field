import type { SkillButtonData, SkillButtonType, StaffLineData, TimelineData } from '../../types';
import type { PersistedSkillButton, SkillButtonTable } from '../../types/storage';
import {
  normalizeSnapshotPayload,
  type TimelineSnapshotPayload,
} from '../../utils/timelineSnapshotStorage';
import { calculateNodeNumber } from '../../utils/nodeNumbering';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';

export type TimelinePayloadCompatibilityRepair = {
  code: string;
  message: string;
};

export type TimelinePayloadCompatibilityResult = {
  payload: TimelineSnapshotPayload;
  changed: boolean;
  repairs: TimelinePayloadCompatibilityRepair[];
};

export class TimelinePayloadCompatibilityError extends Error {
  constructor(
    message: string,
    readonly issues: Array<{ code: string; message: string; path?: string }>,
  ) {
    super(message);
    this.name = 'TimelinePayloadCompatibilityError';
  }
}

type TimelineButtonSource = {
  button: Record<string, unknown>;
  staffIndex?: number;
};

const SKILL_TYPES = new Set<SkillButtonType>(['A', 'B', 'E', 'Q', 'Dot']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function integerAtLeastZero(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finitePosition(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => (
    typeof entry === 'string' && Boolean(entry.trim())
  )))];
}

function compatiblePayloadShape(value: unknown): value is TimelineSnapshotPayload {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.selectedCharacters)
    && isRecord(value.timelineData)
    && Array.isArray(value.timelineData.staffLines)
    && isRecord(value.skillButtonTable)
    && Array.isArray(value.allBuffList)
  );
}

function invalidPayload(message: string, path?: string): never {
  throw new TimelinePayloadCompatibilityError(message, [{
    code: 'legacy-timeline-payload-unrecoverable',
    message,
    ...(path ? { path } : {}),
  }]);
}

function timelineButtonFromTable(button: PersistedSkillButton): SkillButtonData {
  return {
    id: button.id,
    characterId: button.characterId,
    characterName: button.characterName,
    skillType: button.skillType as SkillButtonType,
    staffIndex: button.staffIndex,
    lineIndex: button.lineIndex ?? button.staffIndex,
    nodeIndex: button.nodeIndex,
    nodeNumber: button.nodeNumber,
    position: { ...button.position },
    ...(button.runtimeSkillId ? { runtimeSkillId: button.runtimeSkillId } : {}),
    ...(button.skillDisplayName ? { skillDisplayName: button.skillDisplayName } : {}),
    ...(button.skillIconUrl ? { skillIconUrl: button.skillIconUrl } : {}),
    ...(button.customHits ? { customHits: button.customHits } : {}),
    buffIds: [...button.selectedBuff],
  };
}

/**
 * Upgrades browser/Electron-era timeline payloads to the strict Work Node
 * identity contract. The old timeline rows intentionally stored a compact
 * projection, while skillButtonTable retained the authoritative character and
 * Buff identities. This function merges both mirrors before anything is
 * persisted to the Web SQLite repository.
 */
export function normalizeCompatibleTimelinePayload(
  value: unknown,
): TimelinePayloadCompatibilityResult {
  if (!compatiblePayloadShape(value)) {
    invalidPayload('旧排轴缺少 selectedCharacters、timelineData、skillButtonTable 或 allBuffList。');
  }
  if (!value.selectedCharacters.every((characterId) => (
    typeof characterId === 'string' && Boolean(characterId.trim())
  ))) {
    invalidPayload('旧排轴的 selectedCharacters 含有无效干员 ID。', 'selectedCharacters');
  }

  const normalizedDefaults = normalizeSnapshotPayload(value);
  const selectedCharacters = normalizedDefaults.selectedCharacters.map((characterId) => characterId.trim());
  const originalLines = normalizedDefaults.timelineData.staffLines;
  const originalTable = normalizedDefaults.skillButtonTable;
  const lineNameByIndex = new Map<number, string>();
  const lineIndexByName = new Map<string, number>();
  const timelineButtons = new Map<string, TimelineButtonSource>();

  originalLines.forEach((line, offset) => {
    if (!isRecord(line)) return;
    const lineIndex = integerAtLeastZero(line.staffIndex) ?? offset;
    const characterName = nonEmptyText(line.characterName);
    if (lineIndex < selectedCharacters.length && characterName) {
      lineNameByIndex.set(lineIndex, characterName);
      lineIndexByName.set(characterName, lineIndex);
    }
    const buttons = Array.isArray(line.buttons) ? line.buttons : [];
    buttons.forEach((button, buttonOffset) => {
      if (!isRecord(button)) return;
      const id = nonEmptyText(button.id);
      if (!id) {
        invalidPayload(
          `旧排轴第 ${lineIndex + 1} 行第 ${buttonOffset + 1} 个按钮缺少 ID。`,
          `timelineData.staffLines.${offset}.buttons.${buttonOffset}.id`,
        );
      }
      if (timelineButtons.has(id)) {
        invalidPayload(`旧排轴按钮 ${id} 在多条谱线上重复出现。`, 'timelineData.staffLines');
      }
      timelineButtons.set(id, { button, staffIndex: lineIndex });
    });
  });

  const tableRecords = new Map<string, Record<string, unknown>>();
  Object.entries(originalTable).forEach(([key, button]) => {
    const id = nonEmptyText(key) || (isRecord(button) ? nonEmptyText(button.id) : undefined);
    if (!id) return;
    tableRecords.set(id, isRecord(button) ? button : {});
  });

  const allButtonIds = [...new Set([
    ...timelineButtons.keys(),
    ...tableRecords.keys(),
  ])];
  const buffIds = new Set(
    normalizedDefaults.allBuffList
      .map((buff) => nonEmptyText(buff.id))
      .filter((id): id is string => Boolean(id)),
  );
  const canonicalTable: SkillButtonTable = {};
  let synthesizedTableEntries = 0;
  let synthesizedTimelineEntries = 0;
  let repairedIdentityEntries = 0;
  let removedBuffReferences = 0;

  for (const buttonId of allButtonIds) {
    const timelineSource = timelineButtons.get(buttonId);
    const timelineButton = timelineSource?.button || {};
    const tableButton = tableRecords.get(buttonId) || {};
    if (!tableRecords.has(buttonId)) synthesizedTableEntries += 1;
    if (!timelineSource) synthesizedTimelineEntries += 1;

    const characterIdCandidates = [
      nonEmptyText(tableButton.characterId),
      nonEmptyText(timelineButton.characterId),
    ];
    const selectedCharacterIndex = characterIdCandidates
      .map((characterId) => characterId ? selectedCharacters.indexOf(characterId) : -1)
      .find((index) => index >= 0);
    const indexCandidates = [
      selectedCharacterIndex,
      integerAtLeastZero(tableButton.lineIndex),
      integerAtLeastZero(tableButton.staffIndex),
      integerAtLeastZero(timelineButton.lineIndex),
      integerAtLeastZero(timelineButton.staffIndex),
      timelineSource?.staffIndex,
      lineIndexByName.get(nonEmptyText(tableButton.characterName) || ''),
      lineIndexByName.get(nonEmptyText(timelineButton.characterName) || ''),
    ];
    const staffIndex = indexCandidates.find((index): index is number => (
      typeof index === 'number' && index >= 0 && index < selectedCharacters.length
    ));
    if (staffIndex === undefined) {
      invalidPayload(
        `旧排轴按钮 ${buttonId} 无法绑定到 selectedCharacters。`,
        `skillButtonTable.${buttonId}`,
      );
    }

    const characterId = selectedCharacters[staffIndex];
    const characterName = lineNameByIndex.get(staffIndex)
      || nonEmptyText(tableButton.characterName)
      || nonEmptyText(timelineButton.characterName)
      || characterId;
    lineNameByIndex.set(staffIndex, characterName);
    lineIndexByName.set(characterName, staffIndex);

    const skillTypeValue = nonEmptyText(tableButton.skillType)
      || nonEmptyText(timelineButton.skillType);
    if (!skillTypeValue || !SKILL_TYPES.has(skillTypeValue as SkillButtonType)) {
      invalidPayload(
        `旧排轴按钮 ${buttonId} 的技能类型无效。`,
        `skillButtonTable.${buttonId}.skillType`,
      );
    }
    const skillType = skillTypeValue as SkillButtonType;
    const nodeIndex = integerAtLeastZero(tableButton.nodeIndex)
      ?? integerAtLeastZero(timelineButton.nodeIndex);
    if (nodeIndex === undefined) {
      invalidPayload(
        `旧排轴按钮 ${buttonId} 的节点索引无效。`,
        `skillButtonTable.${buttonId}.nodeIndex`,
      );
    }
    const position = finitePosition(tableButton.position)
      || finitePosition(timelineButton.position)
      || { x: 0, y: 0 };
    const sourceBuffIds = uniqueStrings(
      Array.isArray(tableButton.selectedBuff)
        ? tableButton.selectedBuff
        : timelineButton.buffIds,
    );
    const selectedBuff = sourceBuffIds.filter((buffId) => buffIds.has(buffId));
    removedBuffReferences += sourceBuffIds.length - selectedBuff.length;
    const panelConfig = isRecord(tableButton.panelConfig)
      ? { ...tableButton.panelConfig, selectedBuff: [...selectedBuff] }
      : undefined;
    const canonicalButton: PersistedSkillButton = {
      ...timelineButton,
      ...tableButton,
      id: buttonId,
      characterId,
      characterName,
      skillType,
      staffIndex,
      lineIndex: staffIndex,
      nodeIndex,
      nodeNumber: calculateNodeNumber(nodeIndex),
      position,
      selectedBuff,
      ...(panelConfig ? { panelConfig } : {}),
    } as PersistedSkillButton;
    canonicalTable[buttonId] = canonicalButton;

    if (
      nonEmptyText(timelineButton.characterId) !== characterId
      || nonEmptyText(timelineButton.characterName) !== characterName
      || integerAtLeastZero(timelineButton.staffIndex) !== staffIndex
      || integerAtLeastZero(timelineButton.lineIndex) !== staffIndex
      || integerAtLeastZero(timelineButton.nodeIndex) !== nodeIndex
      || Number(timelineButton.nodeNumber) !== canonicalButton.nodeNumber
      || JSON.stringify(uniqueStrings(timelineButton.buffIds).sort())
        !== JSON.stringify([...selectedBuff].sort())
    ) {
      repairedIdentityEntries += 1;
    }
  }

  const staffLines: StaffLineData[] = selectedCharacters.map((characterId, staffIndex) => {
    const characterName = lineNameByIndex.get(staffIndex) || characterId;
    const buttons = Object.values(canonicalTable)
      .filter((button) => button.staffIndex === staffIndex)
      .map(timelineButtonFromTable)
      .sort((left, right) => left.nodeIndex - right.nodeIndex || left.id.localeCompare(right.id));
    return {
      staffIndex,
      characterName,
      occupiedNodes: [...new Set(buttons.map((button) => button.nodeIndex))].sort(
        (left, right) => left - right,
      ),
      buttons,
    };
  });
  const originalTimeline = normalizedDefaults.timelineData;
  const timelineData: TimelineData = {
    version: nonEmptyText(originalTimeline.version) || '1',
    createdAt: Number.isFinite(Number(originalTimeline.createdAt))
      ? Number(originalTimeline.createdAt)
      : 0,
    updatedAt: Number.isFinite(Number(originalTimeline.updatedAt))
      ? Number(originalTimeline.updatedAt)
      : 0,
    staffLines,
  };
  const payload = {
    ...(value as unknown as Record<string, unknown>),
    ...normalizedDefaults,
    selectedCharacters,
    timelineData,
    skillButtonTable: canonicalTable,
  } as TimelineSnapshotPayload;
  const validation = validateTimelinePayload(payload);
  if (!validation.ok) {
    throw new TimelinePayloadCompatibilityError(
      validation.issues.map((issue) => issue.message).join('；'),
      validation.issues,
    );
  }

  const repairs: TimelinePayloadCompatibilityRepair[] = [];
  if (repairedIdentityEntries > 0) {
    repairs.push({
      code: 'legacy-button-identities-repaired',
      message: `已补全 ${repairedIdentityEntries} 个旧时间轴按钮的干员、谱线、节点与 Buff 镜像。`,
    });
  }
  if (synthesizedTableEntries > 0 || synthesizedTimelineEntries > 0) {
    repairs.push({
      code: 'legacy-button-mirrors-rebuilt',
      message: `已重建 ${synthesizedTableEntries} 个按钮表条目和 ${synthesizedTimelineEntries} 个时间轴条目。`,
    });
  }
  if (removedBuffReferences > 0) {
    repairs.push({
      code: 'legacy-missing-buff-references-removed',
      message: `已移除 ${removedBuffReferences} 个指向不存在 Buff 的旧引用。`,
    });
  }
  const changed = JSON.stringify(value) !== JSON.stringify(payload);
  if (changed && repairs.length === 0) {
    repairs.push({
      code: 'legacy-payload-defaults-normalized',
      message: '已补全旧排轴 payload 的缺省字段。',
    });
  }
  return { payload, changed, repairs };
}
