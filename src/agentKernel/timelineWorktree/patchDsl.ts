import type { SkillButtonType } from '../../types';
import type { SkillButtonBuff, SkillButtonTable } from '../../types/storage';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { diffTimelinePayloads } from './diff';
import type { AiTimelineRiskFlag, TimelinePayloadDiff } from './types';
import { validateTimelinePayload } from './validator';

type TimelinePatchTarget = {
  buttonId?: string;
  characterId?: string;
  characterName?: string;
  skillType?: SkillButtonType;
  nodeIndex?: number;
  latest?: boolean;
};

type TimelinePatchBuff = Omit<SkillButtonBuff, 'id' | 'refCount'> & {
  id?: string;
  refCount?: number;
};

export type TimelineWorkNodePatchOperation =
  | {
      op: 'addButton';
      buttonId?: string;
      characterId?: string;
      characterName: string;
      skillType?: SkillButtonType;
      runtimeSkillId?: string;
      skillDisplayName?: string;
      staffIndex?: number;
      lineIndex?: number;
      nodeIndex?: number;
    }
  | {
      op: 'copyStaffLine';
      sourceStaffIndex: number;
      targetStaffIndex: number;
      preserveCharacterIdentity?: boolean;
      replaceTarget?: boolean;
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
      buffId?: string;
      buff?: TimelinePatchBuff;
      stackCount?: number;
    }
  | {
      op: 'removeBuff';
      target: TimelinePatchTarget;
      buffId: string;
      count?: number;
    }
  | {
      op: 'setBuffStack';
      target: TimelinePatchTarget;
      buffId: string;
      stackCount: number;
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

function normalizeBuffCategory(category: unknown): 'condition' | 'countable' | 'passive' {
  if (category === 'countable' || category === 'passive' || category === 'condition') return category;
  return category === 'positive' ? 'passive' : 'condition';
}

function normalizeMaxStacks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}

function buffIdentity(buff: TimelinePatchBuff | SkillButtonBuff): string {
  return stableJson({
    name: buff.name,
    displayName: buff.displayName,
    sourceName: buff.sourceName,
    level: buff.level,
    type: buff.type,
    value: buff.value,
    condition: buff.condition,
    source: buff.source,
    target: buff.target,
    effectKind: buff.effectKind ?? 'modifier',
    extraHitConfig: buff.extraHitConfig,
    category: normalizeBuffCategory(buff.category),
    maxStacks: normalizeBuffCategory(buff.category) === 'countable'
      ? normalizeMaxStacks(buff.maxStacks)
      : undefined,
    multiplier: buff.multiplier,
    ownerBuffDomain: buff.ownerBuffDomain,
    ownerCharacterId: buff.ownerCharacterId,
    ownerBuffGroup: buff.ownerBuffGroup,
    valueMode: buff.valueMode ?? 'fixed',
    derivedValue: buff.derivedValue,
  });
}

function setButtonBuffIds(button: SkillButtonTable[string], selectedBuff: string[]) {
  button.selectedBuff = selectedBuff;
  button.panelConfig = {
    ...(button.panelConfig ?? { selectedBuff: [] }),
    selectedBuff: [...selectedBuff],
  };
  button.updatedAt = Date.now();
}

function decrementBuffReference(payload: TimelineSnapshotPayload, buffId: string) {
  const index = payload.allBuffList.findIndex((buff) => buff.id === buffId);
  if (index < 0) return;
  const buff = payload.allBuffList[index];
  const nextRefCount = Math.max(0, Number(buff.refCount || 1) - 1);
  if (nextRefCount === 0) payload.allBuffList.splice(index, 1);
  else payload.allBuffList[index] = { ...buff, refCount: nextRefCount };
}

function detachAllButtonBuffs(payload: TimelineSnapshotPayload, button: SkillButtonTable[string]) {
  for (const buffId of getSelectedBuffIds(button)) decrementBuffReference(payload, buffId);
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
    if (target.characterId && button.characterId !== target.characterId) return false;
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
  const staffLine = findStaffLineByCharacter(payload, tableButton.characterName)
    || payload.timelineData.staffLines.find((line) => line.staffIndex === tableButton.staffIndex);
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
    payload.allBuffList = [];
    riskFlags.push(makeRiskFlag('warning', 'timeline-cleared', 'Patch clears all timeline buttons.', path));
    summary.push('Cleared timeline buttons.');
    return;
  }

  if (operation.op === 'addButton') {
    if (!operation.characterName) throw new Error(`${path}: addButton requires characterName`);
    const namedStaffLine = findStaffLineByCharacter(payload, operation.characterName);
    if (!namedStaffLine && typeof operation.staffIndex !== 'number' && typeof operation.lineIndex !== 'number') {
      throw new Error(`${path}: addButton requires a selected characterName or explicit staffIndex`);
    }
    const staffIndex = typeof operation.staffIndex === 'number'
      ? operation.staffIndex
      : typeof operation.lineIndex === 'number'
        ? operation.lineIndex
        : namedStaffLine?.staffIndex ?? 0;
    if (!Number.isInteger(staffIndex) || staffIndex < 0) {
      throw new Error(`${path}: addButton requires a non-negative integer staffIndex`);
    }
    const staffLine = payload.timelineData.staffLines.find((line) => line.staffIndex === staffIndex);
    if (!staffLine) throw new Error(`${path}: addButton staff line not found: ${staffIndex}`);
    if (staffLine.characterName !== operation.characterName) {
      throw new Error(`${path}: addButton characterName does not match staff ${staffIndex + 1}`);
    }
    const selectedCharacterId = payload.selectedCharacters[staffIndex];
    if (!selectedCharacterId) {
      throw new Error(`${path}: addButton could not resolve a selected characterId for staff ${staffIndex + 1}`);
    }
    if (operation.characterId && operation.characterId !== selectedCharacterId) {
      throw new Error(`${path}: addButton characterId does not match selectedCharacters[${staffIndex}]`);
    }
    const characterId = selectedCharacterId;
    const nodeIndex = typeof operation.nodeIndex === 'number'
      ? operation.nodeIndex
      : Math.max(-1, ...(staffLine?.buttons || []).map((button) => button.nodeIndex)) + 1;
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0) {
      throw new Error(`${path}: addButton requires a non-negative integer nodeIndex`);
    }
    if (staffLine.buttons.some((button) => button.nodeIndex === nodeIndex)) {
      throw new Error(`${path}: addButton node ${nodeIndex + 1} is already occupied on staff ${staffIndex + 1}`);
    }
    const id = operation.buttonId || `ai-patch-button-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
    if (payload.skillButtonTable[id]) throw new Error(`${path}: addButton id already exists: ${id}`);
    const nodeNumber = nodeIndex + 1;
    payload.skillButtonTable[id] = {
      id,
      characterId,
      characterName: operation.characterName,
      skillType: operation.skillType || 'A',
      staffIndex,
      lineIndex: staffIndex,
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

  if (operation.op === 'copyStaffLine') {
    if (!Number.isInteger(operation.sourceStaffIndex) || !Number.isInteger(operation.targetStaffIndex)) {
      throw new Error(`${path}: copyStaffLine requires integer sourceStaffIndex and targetStaffIndex`);
    }
    if (operation.sourceStaffIndex === operation.targetStaffIndex) {
      throw new Error(`${path}: copyStaffLine source and target must differ`);
    }
    const sourceLine = payload.timelineData.staffLines.find((line) => line.staffIndex === operation.sourceStaffIndex);
    const targetLine = payload.timelineData.staffLines.find((line) => line.staffIndex === operation.targetStaffIndex);
    if (!sourceLine || !targetLine) throw new Error(`${path}: copyStaffLine source or target staff line not found`);
    if (targetLine.buttons.length && operation.replaceTarget !== true) {
      throw new Error(`${path}: target staff line is not empty; replaceTarget:true requires explicit user approval`);
    }
    if (operation.replaceTarget === true) {
      targetLine.buttons.forEach((button) => {
        const tableButton = payload.skillButtonTable[button.id];
        if (tableButton) detachAllButtonBuffs(payload, tableButton);
        delete payload.skillButtonTable[button.id];
      });
      targetLine.buttons = [];
      targetLine.occupiedNodes = [];
      riskFlags.push(makeRiskFlag('warning', 'staff-line-replaced', `Patch replaces staff line ${operation.targetStaffIndex + 1}.`, path));
    }
    const sourceButtons = sourceLine.buttons
      .map((button) => payload.skillButtonTable[button.id])
      .filter(Boolean)
      .sort((left, right) => left.nodeIndex - right.nodeIndex);
    sourceButtons.forEach((sourceButton, copyIndex) => {
      const id = `ai-copy-button-${Date.now()}-${index}-${copyIndex}-${Math.random().toString(36).slice(2, 7)}`;
      const copiedButton = JSON.parse(JSON.stringify(sourceButton)) as SkillButtonTable[string];
      copiedButton.id = id;
      copiedButton.staffIndex = operation.targetStaffIndex;
      copiedButton.lineIndex = operation.targetStaffIndex;
      copiedButton.nodeNumber = copiedButton.nodeIndex + 1;
      copiedButton.position = { ...copiedButton.position, x: 80 + copiedButton.nodeIndex * 22, y: 60 + operation.targetStaffIndex * 300 };
      copiedButton.createdAt = Date.now();
      copiedButton.updatedAt = Date.now();
      if (operation.preserveCharacterIdentity === false) {
        copiedButton.characterId = payload.selectedCharacters[operation.targetStaffIndex] || copiedButton.characterId;
        copiedButton.characterName = targetLine.characterName || copiedButton.characterName;
      }
      payload.skillButtonTable[id] = copiedButton;
      getSelectedBuffIds(copiedButton).forEach((buffId) => {
        const buff = payload.allBuffList.find((item) => item.id === buffId);
        if (buff) buff.refCount = Math.max(1, Number(buff.refCount || 0) + 1);
      });
      insertTimelineButton(payload, id);
    });
    summary.push(`Copied ${sourceButtons.length} buttons from staff ${operation.sourceStaffIndex + 1} to staff ${operation.targetStaffIndex + 1}.`);
    return;
  }

  if (operation.op === 'removeButton') {
    const button = findButton(payload, operation.target || {}, path);
    detachAllButtonBuffs(payload, button);
    delete payload.skillButtonTable[button.id];
    removeTimelineButton(payload, button.id);
    riskFlags.push(makeRiskFlag('warning', 'button-removed', `Patch removes button ${button.characterName}-${button.skillType}.`, path));
    summary.push(`Removed button ${button.characterName}-${button.skillType}@${button.staffIndex + 1}-${button.nodeIndex + 1}.`);
    return;
  }

  if (operation.op === 'moveButton') {
    const button = findButton(payload, operation.target || {}, path);
    const nextStaffIndex = typeof operation.staffIndex === 'number' ? operation.staffIndex : button.staffIndex;
    if (!Number.isInteger(nextStaffIndex) || nextStaffIndex < 0) {
      throw new Error(`${path}: moveButton requires a non-negative integer staffIndex`);
    }
    if (!Number.isInteger(operation.nodeIndex) || operation.nodeIndex < 0) {
      throw new Error(`${path}: moveButton requires a non-negative integer nodeIndex`);
    }
    const targetLine = payload.timelineData.staffLines.find((line) => line.staffIndex === nextStaffIndex);
    if (!targetLine) throw new Error(`${path}: moveButton target staff line not found: ${nextStaffIndex}`);
    if (targetLine.buttons.some((candidate) => candidate.id !== button.id && candidate.nodeIndex === operation.nodeIndex)) {
      throw new Error(`${path}: moveButton target node ${operation.nodeIndex + 1} is already occupied`);
    }
    button.staffIndex = nextStaffIndex;
    button.lineIndex = nextStaffIndex;
    button.characterId = payload.selectedCharacters[nextStaffIndex] || button.characterId;
    if (targetLine?.characterName) button.characterName = targetLine.characterName;
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
    if (!operation.buffId && !operation.buff) {
      throw new Error(`${path}: attachBuff requires buffId or buff`);
    }
    let buff = operation.buffId
      ? payload.allBuffList.find((item) => item.id === operation.buffId)
      : undefined;
    if (!buff && operation.buff) {
      const identity = buffIdentity(operation.buff);
      buff = payload.allBuffList.find((candidate) => buffIdentity(candidate) === identity);
      if (!buff) {
        const id = operation.buff.id
          || operation.buffId
          || `ai-patch-buff-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
        if (payload.allBuffList.some((candidate) => candidate.id === id)) {
          throw new Error(`${path}: attachBuff id already exists with different content: ${id}`);
        }
        buff = {
          ...operation.buff,
          id,
          category: normalizeBuffCategory(operation.buff.category),
          ...(normalizeBuffCategory(operation.buff.category) === 'countable'
            ? { maxStacks: normalizeMaxStacks(operation.buff.maxStacks) }
            : {}),
          refCount: 0,
        } as SkillButtonBuff;
        payload.allBuffList.push(buff);
      }
    }
    if (!buff) throw new Error(`${path}: buff not found: ${operation.buffId}`);
    const selectedBuff = new Set(getSelectedBuffIds(button));
    const alreadySelected = selectedBuff.has(buff.id);
    selectedBuff.add(buff.id);
    setButtonBuffIds(button, [...selectedBuff]);
    if (!alreadySelected) buff.refCount = Math.max(1, Number(buff.refCount || 0) + 1);
    if (normalizeBuffCategory(buff.category) === 'countable') {
      const maximum = normalizeMaxStacks(buff.maxStacks);
      const current = Number(button.buffStackCounts?.[buff.id] ?? maximum);
      const requested = operation.stackCount ?? (alreadySelected ? current + 1 : maximum);
      button.buffStackCounts = {
        ...(button.buffStackCounts ?? {}),
        [buff.id]: Math.min(Math.max(Math.floor(requested), 0), maximum),
      };
    }
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
    const buff = payload.allBuffList.find((item) => item.id === operation.buffId);
    const currentStack = Number(button.buffStackCounts?.[operation.buffId] ?? normalizeMaxStacks(buff?.maxStacks));
    const removeCount = Math.max(1, Math.floor(operation.count ?? currentStack));
    if (buff && normalizeBuffCategory(buff.category) === 'countable' && currentStack > removeCount) {
      button.buffStackCounts = {
        ...(button.buffStackCounts ?? {}),
        [operation.buffId]: currentStack - removeCount,
      };
      button.updatedAt = Date.now();
      syncTimelineButtonFromTable(payload, button.id);
      summary.push(`Reduced buff ${operation.buffId} on ${button.characterName}-${button.skillType} to ${currentStack - removeCount} stacks.`);
      return;
    }
    setButtonBuffIds(button, before.filter((id) => id !== operation.buffId));
    if (button.buffStackCounts) {
      const nextStacks = { ...button.buffStackCounts };
      delete nextStacks[operation.buffId];
      button.buffStackCounts = nextStacks;
    }
    decrementBuffReference(payload, operation.buffId);
    syncTimelineButtonFromTable(payload, button.id);
    riskFlags.push(makeRiskFlag('warning', 'buff-removed', `Patch removes buff ${operation.buffId} from a button.`, path));
    summary.push(`Removed buff ${operation.buffId} from ${button.characterName}-${button.skillType}.`);
    return;
  }

  if (operation.op === 'setBuffStack') {
    const button = findButton(payload, operation.target || {}, path);
    if (!getSelectedBuffIds(button).includes(operation.buffId)) {
      throw new Error(`${path}: button does not reference buff ${operation.buffId}`);
    }
    const buff = findBuff(payload, operation.buffId);
    if (normalizeBuffCategory(buff.category) !== 'countable') {
      throw new Error(`${path}: buff ${operation.buffId} is not countable`);
    }
    if (!Number.isInteger(operation.stackCount) || operation.stackCount < 0) {
      throw new Error(`${path}: setBuffStack requires a non-negative integer stackCount`);
    }
    const stackCount = Math.min(operation.stackCount, normalizeMaxStacks(buff.maxStacks));
    button.buffStackCounts = { ...(button.buffStackCounts ?? {}), [operation.buffId]: stackCount };
    button.updatedAt = Date.now();
    syncTimelineButtonFromTable(payload, button.id);
    summary.push(`Set buff ${operation.buffId} on ${button.characterName}-${button.skillType} to ${stackCount} stacks.`);
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
