import type { SkillButtonType } from '../../types';
import type { SkillButtonBuff, SkillButtonTable } from '../../types/storage';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { diffTimelinePayloads } from './diff';
import type { AiTimelineRiskFlag, TimelinePayloadDiff } from './types';
import { validateTimelinePayload } from './validator';

type TimelinePatchTarget = {
  buttonId?: string;
  characterName?: string;
  skillType?: SkillButtonType;
  nodeIndex?: number;
  latest?: boolean;
};

export type TimelineWorkNodePatchOperation =
  | {
      op: 'addButton';
      characterName: string;
      skillType?: SkillButtonType;
      runtimeSkillId?: string;
      skillDisplayName?: string;
      staffIndex?: number;
      nodeIndex?: number;
    }
  | {
      op: 'removeButton';
      target: TimelinePatchTarget;
    }
  | {
      op: 'moveButton';
      target: TimelinePatchTarget;
      staffIndex?: number;
      nodeIndex: number;
    }
  | {
      op: 'attachBuff';
      target: TimelinePatchTarget;
      buffId: string;
    }
  | {
      op: 'removeBuff';
      target: TimelinePatchTarget;
      buffId: string;
    }
  | {
      op: 'setTargetResistance';
      target: TimelinePatchTarget;
      targetResistance: Record<string, number>;
    }
  | {
      op: 'clearTimeline';
    };

export type TimelineWorkNodePatchResult = {
  ok: true;
  dryRun: boolean;
  operationsApplied: number;
  workingPayload: TimelineSnapshotPayload;
  diff: TimelinePayloadDiff;
  riskFlags: AiTimelineRiskFlag[];
  summary: string[];
} | {
  ok: false;
  dryRun: boolean;
  issues: Array<{ code: string; message: string; path?: string }>;
  riskFlags: AiTimelineRiskFlag[];
};

function clonePayload(payload: TimelineSnapshotPayload): TimelineSnapshotPayload {
  return JSON.parse(JSON.stringify(payload)) as TimelineSnapshotPayload;
}

function makeRiskFlag(severity: AiTimelineRiskFlag['severity'], code: string, message: string, path?: string): AiTimelineRiskFlag {
  return {
    id: `timeline-patch-risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    code,
    message,
    path,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asPatchList(value: unknown): TimelineWorkNodePatchOperation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as TimelineWorkNodePatchOperation[];
}

function getSelectedBuffIds(button: SkillButtonTable[string]) {
  return Array.isArray(button.selectedBuff) ? button.selectedBuff : [];
}

function findStaffLineByCharacter(payload: TimelineSnapshotPayload, characterName: string) {
  return payload.timelineData.staffLines.find((line) => line.characterName === characterName);
}

function findButton(payload: TimelineSnapshotPayload, target: TimelinePatchTarget, path: string) {
  if (target.buttonId) {
    const button = payload.skillButtonTable[target.buttonId];
    if (!button) {
      throw new Error(`${path}: buttonId not found: ${target.buttonId}`);
    }
    return button;
  }

  const candidates = Object.values(payload.skillButtonTable || {}).filter((button) => {
    if (target.characterName && button.characterName !== target.characterName) return false;
    if (target.skillType && button.skillType !== target.skillType) return false;
    if (typeof target.nodeIndex === 'number' && button.nodeIndex !== target.nodeIndex) return false;
    return true;
  });
  if (!candidates.length) {
    throw new Error(`${path}: no button matched target`);
  }
  if (candidates.length > 1 && !target.latest) {
    throw new Error(`${path}: target matched ${candidates.length} buttons; provide buttonId/nodeIndex or latest:true`);
  }
  return [...candidates].sort((left, right) =>
    (right.staffIndex - left.staffIndex) || (right.nodeIndex - left.nodeIndex)
  )[0];
}

function syncTimelineButtonFromTable(payload: TimelineSnapshotPayload, buttonId: string) {
  const tableButton = payload.skillButtonTable[buttonId];
  if (!tableButton) return;
  for (const staffLine of payload.timelineData.staffLines) {
    const timelineButton = staffLine.buttons.find((button) => button.id === buttonId);
    if (!timelineButton) continue;
    timelineButton.characterId = tableButton.characterId;
    timelineButton.characterName = tableButton.characterName;
    timelineButton.skillType = tableButton.skillType as SkillButtonType;
    timelineButton.staffIndex = tableButton.staffIndex;
    timelineButton.nodeIndex = tableButton.nodeIndex;
    timelineButton.nodeNumber = tableButton.nodeNumber;
    timelineButton.position = tableButton.position;
    timelineButton.runtimeSkillId = tableButton.runtimeSkillId;
    timelineButton.skillDisplayName = tableButton.skillDisplayName;
    timelineButton.skillIconUrl = tableButton.skillIconUrl;
    timelineButton.customHits = tableButton.customHits;
    timelineButton.buffIds = [...getSelectedBuffIds(tableButton)];
  }
}

function removeTimelineButton(payload: TimelineSnapshotPayload, buttonId: string) {
  for (const staffLine of payload.timelineData.staffLines) {
    staffLine.buttons = staffLine.buttons.filter((button) => button.id !== buttonId);
    staffLine.occupiedNodes = staffLine.buttons.map((button) => button.nodeIndex).sort((a, b) => a - b);
  }
}

function insertTimelineButton(payload: TimelineSnapshotPayload, buttonId: string) {
  const tableButton = payload.skillButtonTable[buttonId];
  const staffLine = payload.timelineData.staffLines.find((line) => line.staffIndex === tableButton.staffIndex)
    || findStaffLineByCharacter(payload, tableButton.characterName);
  if (!staffLine) {
    throw new Error(`addButton: staff line not found for ${tableButton.characterName}`);
  }
  staffLine.buttons = staffLine.buttons.filter((button) => button.id !== buttonId);
  staffLine.buttons.push({
    id: tableButton.id,
    characterId: tableButton.characterId,
    characterName: tableButton.characterName,
    skillType: tableButton.skillType as SkillButtonType,
    staffIndex: tableButton.staffIndex,
    nodeIndex: tableButton.nodeIndex,
    nodeNumber: tableButton.nodeNumber,
    position: tableButton.position,
    runtimeSkillId: tableButton.runtimeSkillId,
    skillDisplayName: tableButton.skillDisplayName,
    skillIconUrl: tableButton.skillIconUrl,
    customHits: tableButton.customHits,
    buffIds: [...getSelectedBuffIds(tableButton)],
  });
  staffLine.buttons.sort((left, right) => left.nodeIndex - right.nodeIndex);
  staffLine.occupiedNodes = staffLine.buttons.map((button) => button.nodeIndex).sort((a, b) => a - b);
}

function findBuff(payload: TimelineSnapshotPayload, buffId: string): SkillButtonBuff {
  const buff = payload.allBuffList.find((item) => item.id === buffId);
  if (!buff) {
    throw new Error(`buff not found: ${buffId}`);
  }
  return buff;
}

function applyPatchOperation(payload: TimelineSnapshotPayload, operation: TimelineWorkNodePatchOperation, index: number, summary: string[], riskFlags: AiTimelineRiskFlag[]) {
  const path = `patch[${index}]`;
  if (operation.op === 'clearTimeline') {
    payload.timelineData.staffLines.forEach((line) => {
      line.buttons = [];
      line.occupiedNodes = [];
    });
    payload.skillButtonTable = {};
    riskFlags.push(makeRiskFlag('warning', 'timeline-cleared', 'Patch clears all timeline buttons.', path));
    summary.push('Cleared timeline buttons.');
    return;
  }

  if (operation.op === 'addButton') {
    if (!operation.characterName) throw new Error(`${path}: addButton requires characterName`);
    const staffLine = findStaffLineByCharacter(payload, operation.characterName);
    if (!staffLine && typeof operation.staffIndex !== 'number') {
      throw new Error(`${path}: addButton requires a selected characterName or explicit staffIndex`);
    }
    const staffIndex = typeof operation.staffIndex === 'number' ? operation.staffIndex : staffLine?.staffIndex ?? 0;
    const nodeIndex = typeof operation.nodeIndex === 'number'
      ? operation.nodeIndex
      : Math.max(-1, ...(staffLine?.buttons || []).map((button) => button.nodeIndex)) + 1;
    const id = `ai-patch-button-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
    const nodeNumber = nodeIndex + 1;
    payload.skillButtonTable[id] = {
      id,
      characterName: operation.characterName,
      skillType: operation.skillType || 'A',
      staffIndex,
      nodeIndex,
      nodeNumber,
      position: { x: 80 + nodeIndex * 22, y: 60 + staffIndex * 300 },
      runtimeSkillId: operation.runtimeSkillId,
      skillDisplayName: operation.skillDisplayName,
      selectedBuff: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    insertTimelineButton(payload, id);
    summary.push(`Added button ${operation.characterName}-${operation.skillType || 'A'}@${staffIndex + 1}-${nodeIndex + 1}.`);
    return;
  }

  if (operation.op === 'removeButton') {
    const button = findButton(payload, operation.target || {}, path);
    delete payload.skillButtonTable[button.id];
    removeTimelineButton(payload, button.id);
    riskFlags.push(makeRiskFlag('warning', 'button-removed', `Patch removes button ${button.characterName}-${button.skillType}.`, path));
    summary.push(`Removed button ${button.characterName}-${button.skillType}@${button.staffIndex + 1}-${button.nodeIndex + 1}.`);
    return;
  }

  if (operation.op === 'moveButton') {
    const button = findButton(payload, operation.target || {}, path);
    const nextStaffIndex = typeof operation.staffIndex === 'number' ? operation.staffIndex : button.staffIndex;
    button.staffIndex = nextStaffIndex;
    button.nodeIndex = operation.nodeIndex;
    button.nodeNumber = operation.nodeIndex + 1;
    button.position = { ...button.position, x: 80 + operation.nodeIndex * 22, y: 60 + nextStaffIndex * 300 };
    removeTimelineButton(payload, button.id);
    insertTimelineButton(payload, button.id);
    summary.push(`Moved button ${button.characterName}-${button.skillType} to ${nextStaffIndex + 1}-${operation.nodeIndex + 1}.`);
    return;
  }

  if (operation.op === 'attachBuff') {
    const button = findButton(payload, operation.target || {}, path);
    const buff = findBuff(payload, operation.buffId);
    const selectedBuff = new Set(getSelectedBuffIds(button));
    selectedBuff.add(buff.id);
    button.selectedBuff = [...selectedBuff];
    button.updatedAt = Date.now();
    buff.refCount = Math.max(1, Number(buff.refCount || 0) + 1);
    syncTimelineButtonFromTable(payload, button.id);
    summary.push(`Attached buff ${buff.displayName || buff.name || buff.id} to ${button.characterName}-${button.skillType}.`);
    return;
  }

  if (operation.op === 'removeBuff') {
    const button = findButton(payload, operation.target || {}, path);
    const before = getSelectedBuffIds(button);
    if (!before.includes(operation.buffId)) {
      throw new Error(`${path}: button does not reference buff ${operation.buffId}`);
    }
    button.selectedBuff = before.filter((id) => id !== operation.buffId);
    button.updatedAt = Date.now();
    const buff = payload.allBuffList.find((item) => item.id === operation.buffId);
    if (buff) buff.refCount = Math.max(0, Number(buff.refCount || 0) - 1);
    syncTimelineButtonFromTable(payload, button.id);
    riskFlags.push(makeRiskFlag('warning', 'buff-removed', `Patch removes buff ${operation.buffId} from a button.`, path));
    summary.push(`Removed buff ${operation.buffId} from ${button.characterName}-${button.skillType}.`);
    return;
  }

  if (operation.op === 'setTargetResistance') {
    const button = findButton(payload, operation.target || {}, path);
    if (!isRecord(operation.targetResistance)) {
      throw new Error(`${path}: setTargetResistance requires targetResistance object`);
    }
    button.resistanceConfig = {
      targetResistance: { ...operation.targetResistance },
    };
    button.updatedAt = Date.now();
    summary.push(`Updated target resistance for ${button.characterName}-${button.skillType}.`);
    return;
  }

  throw new Error(`${path}: unsupported patch op ${(operation as { op?: unknown }).op || 'unknown'}`);
}

export function applyTimelineWorkNodePatch(
  basePayload: TimelineSnapshotPayload,
  patch: unknown,
  options: { dryRun?: boolean } = {},
): TimelineWorkNodePatchResult {
  const operations = asPatchList(patch);
  const dryRun = options.dryRun === true;
  const riskFlags: AiTimelineRiskFlag[] = [];
  const summary: string[] = [];
  if (!operations.length) {
    return {
      ok: false,
      dryRun,
      issues: [{ code: 'empty-timeline-patch', message: 'Patch must be a non-empty operation array.' }],
      riskFlags,
    };
  }

  const workingPayload = clonePayload(basePayload);
  try {
    operations.forEach((operation, index) => applyPatchOperation(workingPayload, operation, index, summary, riskFlags));
  } catch (error) {
    return {
      ok: false,
      dryRun,
      issues: [{ code: 'timeline-patch-apply-failed', message: error instanceof Error ? error.message : String(error) }],
      riskFlags: [
        ...riskFlags,
        makeRiskFlag('blocker', 'timeline-patch-apply-failed', error instanceof Error ? error.message : String(error)),
      ],
    };
  }

  workingPayload.timelineData.updatedAt = Date.now();
  const validation = validateTimelinePayload(workingPayload);
  if (!validation.ok) {
    return {
      ok: false,
      dryRun,
      issues: validation.issues,
      riskFlags: [
        ...riskFlags,
        ...validation.issues.map((issue) => makeRiskFlag('blocker', issue.code, issue.message, issue.path)),
      ],
    };
  }

  return {
    ok: true,
    dryRun,
    operationsApplied: operations.length,
    workingPayload,
    diff: diffTimelinePayloads(basePayload, workingPayload),
    riskFlags,
    summary,
  };
}
