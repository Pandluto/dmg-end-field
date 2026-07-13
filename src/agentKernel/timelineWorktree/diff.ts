import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type {
  TimelineBuffDiffItem,
  TimelineButtonChange,
  TimelineButtonDiffItem,
  TimelineButtonFieldChange,
  TimelineCharacterInputChange,
  TimelinePayloadDiff,
  TimelinePayloadSummary,
} from './types';

function makeButtonLabel(button: TimelineButtonDiffItem) {
  return `${button.characterName}-${button.skillDisplayName || button.skillType}@${button.staffIndex + 1}-${button.nodeIndex + 1}`;
}

function normalizeButton(button: TimelineSnapshotPayload['skillButtonTable'][string]): TimelineButtonDiffItem {
  const item: TimelineButtonDiffItem = {
    id: button.id,
    characterName: button.characterName,
    skillType: button.skillType,
    skillDisplayName: button.skillDisplayName,
    staffIndex: button.staffIndex,
    nodeIndex: button.nodeIndex,
    selectedBuffIds: [...(button.selectedBuff || [])].sort(),
    label: '',
  };
  return {
    ...item,
    label: makeButtonLabel(item),
  };
}

function normalizeBuff(buff: TimelineSnapshotPayload['allBuffList'][number]): TimelineBuffDiffItem {
  return {
    id: buff.id,
    displayName: buff.displayName || buff.name || buff.id,
    sourceName: buff.sourceName,
  };
}

function buttonMap(payload: TimelineSnapshotPayload) {
  return new Map(Object.values(payload.skillButtonTable || {}).map((button) => [button.id, normalizeButton(button)]));
}

function buffMap(payload: TimelineSnapshotPayload) {
  return new Map((payload.allBuffList || []).map((buff) => [buff.id, normalizeBuff(buff)]));
}

function compareField(changes: TimelineButtonFieldChange[], field: string, before: unknown, after: unknown) {
  const beforeValue = Array.isArray(before) ? JSON.stringify(before) : before;
  const afterValue = Array.isArray(after) ? JSON.stringify(after) : after;
  if (beforeValue === afterValue) return;
  changes.push({ field, before, after });
}

function compareButton(before: TimelineButtonDiffItem, after: TimelineButtonDiffItem): TimelineButtonChange | null {
  const changes: TimelineButtonFieldChange[] = [];
  compareField(changes, 'characterName', before.characterName, after.characterName);
  compareField(changes, 'skillType', before.skillType, after.skillType);
  compareField(changes, 'skillDisplayName', before.skillDisplayName, after.skillDisplayName);
  compareField(changes, 'staffIndex', before.staffIndex, after.staffIndex);
  compareField(changes, 'nodeIndex', before.nodeIndex, after.nodeIndex);
  compareField(changes, 'selectedBuffIds', before.selectedBuffIds, after.selectedBuffIds);
  if (!changes.length) return null;
  return { id: before.id, before, after, changes };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}

function inputMap(payload: TimelineSnapshotPayload) {
  return new Map(Object.entries(payload.characterInputMap || {}));
}

export function summarizeTimelinePayload(payload: TimelineSnapshotPayload): TimelinePayloadSummary {
  return {
    characterCount: payload.selectedCharacters.length,
    buttonCount: Object.keys(payload.skillButtonTable || {}).length,
    buffCount: (payload.allBuffList || []).length,
  };
}

export function diffTimelinePayloads(basePayload: TimelineSnapshotPayload, workingPayload: TimelineSnapshotPayload): TimelinePayloadDiff {
  const baseButtons = buttonMap(basePayload);
  const workingButtons = buttonMap(workingPayload);
  const baseBuffs = buffMap(basePayload);
  const workingBuffs = buffMap(workingPayload);
  const baseInputs = inputMap(basePayload);
  const workingInputs = inputMap(workingPayload);
  const addedButtons: TimelineButtonDiffItem[] = [];
  const removedButtons: TimelineButtonDiffItem[] = [];
  const changedButtons: TimelineButtonChange[] = [];
  const addedBuffs: TimelineBuffDiffItem[] = [];
  const removedBuffs: TimelineBuffDiffItem[] = [];
  const changedCharacterInputs: TimelineCharacterInputChange[] = [];

  for (const [id, button] of workingButtons) {
    const before = baseButtons.get(id);
    if (!before) {
      addedButtons.push(button);
      continue;
    }
    const change = compareButton(before, button);
    if (change) changedButtons.push(change);
  }
  for (const [id, button] of baseButtons) {
    if (!workingButtons.has(id)) removedButtons.push(button);
  }
  for (const [id, buff] of workingBuffs) {
    if (!baseBuffs.has(id)) addedBuffs.push(buff);
  }
  for (const [id, buff] of baseBuffs) {
    if (!workingBuffs.has(id)) removedBuffs.push(buff);
  }
  for (const characterId of new Set([...baseInputs.keys(), ...workingInputs.keys()])) {
    const before = baseInputs.get(characterId);
    const after = workingInputs.get(characterId);
    if (stableJson(before) !== stableJson(after)) {
      changedCharacterInputs.push({ characterId, before: before ?? null, after: after ?? null });
    }
  }

  return {
    summary: {
      addedButtonCount: addedButtons.length,
      removedButtonCount: removedButtons.length,
      changedButtonCount: changedButtons.length,
      addedBuffCount: addedBuffs.length,
      removedBuffCount: removedBuffs.length,
      changedCharacterInputCount: changedCharacterInputs.length,
      beforeButtonCount: baseButtons.size,
      afterButtonCount: workingButtons.size,
      beforeBuffCount: baseBuffs.size,
      afterBuffCount: workingBuffs.size,
    },
    selectedCharactersChanged: JSON.stringify(basePayload.selectedCharacters) !== JSON.stringify(workingPayload.selectedCharacters),
    beforeSelectedCharacters: basePayload.selectedCharacters,
    afterSelectedCharacters: workingPayload.selectedCharacters,
    addedButtons: addedButtons.sort((left, right) => left.label.localeCompare(right.label)),
    removedButtons: removedButtons.sort((left, right) => left.label.localeCompare(right.label)),
    changedButtons: changedButtons.sort((left, right) => left.after.label.localeCompare(right.after.label)),
    addedBuffs: addedBuffs.sort((left, right) => left.displayName.localeCompare(right.displayName)),
    removedBuffs: removedBuffs.sort((left, right) => left.displayName.localeCompare(right.displayName)),
    changedCharacterInputs: changedCharacterInputs.sort((left, right) => left.characterId.localeCompare(right.characterId)),
  };
}
