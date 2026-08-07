import { SKILL_BUTTON_BASELINE_OFFSET_Y } from '../../constants/canvas-layout';
import type { Character, SkillButtonType } from '../../types';
import type { PersistedSkillButton, SkillButtonBuff } from '../../types/storage';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  getGridGroupTop,
  getGridLineCenterY,
  GRID_NODE_COUNT,
} from '../calculators/gridSnapLayout';
import { validateTimelinePayload } from '../../agentKernel/timelineWorktree/validator';
import { classifySelectionWorkspaceTransition } from './selectionWorkspacePolicy';

export type PreparedSelectionDestination = 'current-timeline' | 'new-temporary-workspace';

export type PreparedSelectionPayloadResult = {
  readonly destination: PreparedSelectionDestination;
  readonly payload: TimelineSnapshotPayload;
  readonly removedButtonIds: readonly string[];
  readonly retainedButtonIds: readonly string[];
};

export type PreparedSelectionRosterRequest = {
  readonly characterIds?: readonly string[];
  readonly characterNames?: readonly string[];
  readonly nodeTitle: string;
  readonly nodeDescription: string;
  readonly openCanvas?: boolean;
};

export type ResolvedPreparedSelectionRoster = {
  readonly characters: readonly Character[];
  readonly nodeTitle: string;
  readonly nodeDescription: string;
  readonly openCanvas: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function exactRosterKeys(value: readonly string[] | undefined, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw new Error(`${label} must contain between one and four exact values.`);
  }
  const normalized = value.map((entry, index) => {
    if (typeof entry !== 'string') throw new Error(`${label}[${index}] must be a string.`);
    const key = entry.trim();
    if (!key || key.length > 160 || key.includes('\u0000')) {
      throw new Error(`${label}[${index}] is not a valid exact operator key.`);
    }
    return key;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate values.`);
  }
  return normalized;
}

function exactRosterText(value: string, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes('\u0000')) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

/**
 * Resolve a model-requested roster against browser-owned operator facts.
 * Nothing is truncated, de-duplicated, or silently dropped. If both ids and
 * names are provided, they are treated as exact parallel identities.
 */
export function resolvePreparedSelectionRoster(input: {
  readonly roster: PreparedSelectionRosterRequest;
  readonly availableCharacters: readonly Character[];
}): ResolvedPreparedSelectionRoster {
  const characterIds = exactRosterKeys(input.roster.characterIds, 'characterIds');
  const characterNames = exactRosterKeys(input.roster.characterNames, 'characterNames');
  if (!characterIds && !characterNames) {
    throw new Error('Selection roster requires characterIds or characterNames.');
  }
  if (characterIds && characterNames && characterIds.length !== characterNames.length) {
    throw new Error('characterIds and characterNames must have the same length when both are provided.');
  }

  const byId = new Map<string, Character[]>();
  const byName = new Map<string, Character[]>();
  for (const character of input.availableCharacters) {
    const id = character.id?.trim();
    const name = character.name?.trim();
    if (!id || !name) continue;
    byId.set(id, [...(byId.get(id) ?? []), character]);
    byName.set(name, [...(byName.get(name) ?? []), character]);
  }
  const count = characterIds?.length ?? characterNames!.length;
  const characters: Character[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = characterIds?.[index];
    const name = characterNames?.[index];
    const idMatches = id ? byId.get(id) ?? [] : [];
    const nameMatches = name ? byName.get(name) ?? [] : [];
    if (id && idMatches.length !== 1) {
      throw new Error(idMatches.length === 0
        ? `Selection roster operator id is missing: ${id}.`
        : `Selection roster operator id is ambiguous: ${id}.`);
    }
    if (name && nameMatches.length !== 1) {
      throw new Error(nameMatches.length === 0
        ? `Selection roster operator name is missing: ${name}.`
        : `Selection roster operator name is ambiguous: ${name}.`);
    }
    const resolved = id ? idMatches[0]! : nameMatches[0]!;
    if (id && name && resolved.id !== nameMatches[0]!.id) {
      throw new Error(`Selection roster id/name pair does not identify the same operator: ${id} / ${name}.`);
    }
    characters.push(resolved);
  }
  const duplicateId = characters.find((character, index) => (
    characters.findIndex((candidate) => candidate.id === character.id) !== index
  ));
  if (duplicateId) throw new Error(`Selection roster resolves duplicate operator: ${duplicateId.id}.`);
  if (characters.length < 1 || characters.length > 4) {
    throw new Error('Selection roster must resolve to between one and four operators.');
  }

  const nodeTitle = exactRosterText(input.roster.nodeTitle, 'nodeTitle', 80);
  if (/^\[ai\]/iu.test(nodeTitle)) {
    throw new Error('nodeTitle must not use the [ai] fixed prefix.');
  }
  return {
    characters,
    nodeTitle,
    nodeDescription: exactRosterText(input.roster.nodeDescription, 'nodeDescription', 400),
    openCanvas: input.roster.openCanvas !== false,
  };
}

function normalizedRoster(characters: readonly Pick<Character, 'id' | 'name'>[]) {
  if (characters.length < 1 || characters.length > 4) {
    throw new Error('Selection candidate requires between one and four operators.');
  }
  const result = characters.map((character, index) => {
    const id = character.id?.trim();
    const name = character.name?.trim();
    if (!id || !name) throw new Error(`Selection candidate operator ${index + 1} has no exact id/name.`);
    return { id, name };
  });
  if (new Set(result.map((character) => character.id)).size !== result.length) {
    throw new Error('Selection candidate contains duplicate operator ids.');
  }
  return result;
}

function buildEmptyPayload(
  characters: readonly { id: string; name: string }[],
  now: number,
): TimelineSnapshotPayload {
  return {
    selectedCharacters: characters.map((character) => character.id),
    timelineData: {
      version: '1.1.0',
      createdAt: now,
      updatedAt: now,
      staffLines: characters.map((character, staffIndex) => ({
        staffIndex,
        characterName: character.name,
        occupiedNodes: [],
        buttons: [],
      })),
    },
    skillButtonTable: {},
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
}

function globalButtonGroup(nodeIndex: number): number {
  return Number.isFinite(nodeIndex) && nodeIndex >= 0
    ? Math.floor(nodeIndex / GRID_NODE_COUNT)
    : 0;
}

function rebindButton(
  button: PersistedSkillButton,
  character: { id: string; name: string },
  lineIndex: number,
  now: number,
): PersistedSkillButton {
  return {
    ...clone(button),
    characterId: character.id,
    characterName: character.name,
    staffIndex: lineIndex,
    lineIndex,
    position: {
      ...button.position,
      y: getGridGroupTop(globalButtonGroup(button.nodeIndex))
        + getGridLineCenterY(lineIndex)
        + SKILL_BUTTON_BASELINE_OFFSET_Y,
    },
    updatedAt: now,
  };
}

function rebuildBuffList(
  source: readonly SkillButtonBuff[],
  table: Record<string, PersistedSkillButton>,
): SkillButtonBuff[] {
  const sourceById = new Map(source.map((buff) => [buff.id, buff]));
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const button of Object.values(table)) {
    for (const buffId of button.selectedBuff ?? []) {
      if (!sourceById.has(buffId)) {
        throw new Error(`Selection candidate retained a missing Buff reference: ${buffId}.`);
      }
      if (!counts.has(buffId)) order.push(buffId);
      counts.set(buffId, (counts.get(buffId) ?? 0) + 1);
    }
  }
  return order.map((buffId) => ({
    ...clone(sourceById.get(buffId)!),
    refCount: counts.get(buffId)!,
  }));
}

/**
 * Builds a selection candidate without touching browser/session state.
 * Horizontal changes preserve retained operators' timeline/loadout state;
 * a complete four-person replacement follows the existing product policy and
 * starts an isolated temporary workspace with an empty timeline.
 */
export function buildPreparedSelectionPayload(input: {
  readonly basePayload: TimelineSnapshotPayload;
  readonly nextCharacters: readonly Pick<Character, 'id' | 'name'>[];
  readonly now?: number;
}): PreparedSelectionPayloadResult {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Selection candidate timestamp is invalid.');
  const baseValidation = validateTimelinePayload(input.basePayload);
  if (!baseValidation.ok) {
    throw new Error(`Selection candidate base payload is invalid: ${baseValidation.issues.map((issue) => issue.message).join('; ')}`);
  }
  const nextCharacters = normalizedRoster(input.nextCharacters);
  const transition = classifySelectionWorkspaceTransition(
    input.basePayload.selectedCharacters,
    nextCharacters.map((character) => character.id),
  );
  if (transition === 'new-temporary-workspace') {
    return {
      destination: 'new-temporary-workspace',
      payload: buildEmptyPayload(nextCharacters, now),
      removedButtonIds: Object.keys(input.basePayload.skillButtonTable),
      retainedButtonIds: [],
    };
  }

  const targetById = new Map(nextCharacters.map((character, index) => [character.id, { character, index }]));
  const nextTable: Record<string, PersistedSkillButton> = {};
  const removedButtonIds: string[] = [];
  const retainedButtonIds: string[] = [];
  for (const [buttonId, button] of Object.entries(input.basePayload.skillButtonTable)) {
    const target = button.characterId ? targetById.get(button.characterId) : undefined;
    if (!target) {
      removedButtonIds.push(buttonId);
      continue;
    }
    retainedButtonIds.push(buttonId);
    nextTable[buttonId] = rebindButton(button, target.character, target.index, now);
  }

  const nextPayload = clone(input.basePayload);
  nextPayload.selectedCharacters = nextCharacters.map((character) => character.id);
  nextPayload.skillButtonTable = nextTable;
  nextPayload.allBuffList = rebuildBuffList(input.basePayload.allBuffList, nextTable);
  nextPayload.timelineData = {
    ...clone(input.basePayload.timelineData),
    updatedAt: now,
    staffLines: nextCharacters.map((character, staffIndex) => {
      const buttons = Object.values(nextTable)
        .filter((button) => button.characterId === character.id)
        .sort((left, right) => left.nodeIndex - right.nodeIndex || left.id.localeCompare(right.id))
        .map((button) => ({
          id: button.id,
          characterId: character.id,
          characterName: character.name,
          skillType: button.skillType as SkillButtonType,
          staffIndex,
          lineIndex: staffIndex,
          nodeIndex: button.nodeIndex,
          nodeNumber: button.nodeNumber,
          position: clone(button.position),
          runtimeSkillId: button.runtimeSkillId,
          skillDisplayName: button.skillDisplayName,
          skillIconUrl: button.skillIconUrl,
          customHits: clone(button.customHits),
          buffIds: [...(button.selectedBuff ?? [])],
        }));
      return {
        staffIndex,
        characterName: character.name,
        occupiedNodes: [...new Set(buttons.map((button) => button.nodeIndex))].sort((left, right) => left - right),
        buttons,
      };
    }),
  };
  const validation = validateTimelinePayload(nextPayload);
  if (!validation.ok) {
    throw new Error(`Selection candidate payload is invalid: ${validation.issues.map((issue) => issue.message).join('; ')}`);
  }
  return {
    destination: 'current-timeline',
    payload: nextPayload,
    removedButtonIds,
    retainedButtonIds,
  };
}
