import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type {
  TimelineBuffDiffItem,
  TimelineButtonChange,
  TimelineButtonDiffItem,
  TimelineButtonFieldChange,
  TimelineCharacterInputChange,
  TimelineOperatorConfigChange,
  TimelineOperatorConfigFieldChange,
  TimelineOperatorConfigSection,
  TimelinePayloadDiff,
  TimelinePayloadSummary,
} from './types';

type NormalizedOperatorConfig = {
  operator: {
    id: string | null;
    name: string | null;
    level: string | number | null;
    potential: string | number | null;
    mainStat: string | null;
    subStat: string | null;
    mainStatFlatBonus: number | null;
    subStatFlatBonus: number | null;
    skillConfig: Record<string, string | number | null>;
  };
  weapon: {
    id: string | null;
    name: string | null;
    config: {
      level: string | number | null;
      potential: string | number | null;
      skillLevels: Record<'skill1' | 'skill2' | 'skill3', string | number | null>;
    };
  };
  equipment: {
    pieces: Array<{
      slotKey: string | null;
      equipmentId: string | null;
      name: string | null;
      part: string | null;
      effects: Array<Record<string, unknown>>;
    }>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeNumberish(value: unknown): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : normalized;
}

function normalizeNumber(value: unknown): number | null {
  const normalized = normalizeNumberish(value);
  return typeof normalized === 'number' ? normalized : null;
}

function normalizeUnknown(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeUnknown).filter((entry) => entry !== null);
    return normalized.length ? normalized.sort((left, right) => stableJson(left).localeCompare(stableJson(right))) : null;
  }
  if (!isRecord(value)) return null;
  const normalized = Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, normalizeUnknown(entry)] as const)
      .filter(([, entry]) => entry !== null)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeSkillConfig(value: unknown): Record<string, string | number | null> {
  const source = isRecord(value) ? value : {};
  const keys = new Set(['A', 'B', 'E', 'Q', 'Dot']);
  Object.keys(source).forEach((key) => keys.add(key));
  return Object.fromEntries(
    [...keys].sort().map((key) => [key, normalizeNumberish(source[key])])
  );
}

function normalizeEffect(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  return {
    effectId: normalizeText(source.effectId),
    label: normalizeText(source.label),
    typeKey: normalizeText(source.typeKey),
    level: normalizeNumberish(source.level),
    value: normalizeNumberish(source.value),
    unit: normalizeText(source.unit),
    valueMode: normalizeText(source.valueMode),
    derivedValue: normalizeUnknown(source.derivedValue),
    maxStacks: normalizeNumberish(source.maxStacks),
    multiplier: normalizeUnknown(source.multiplier),
    effectKind: normalizeText(source.effectKind),
    extraHitConfig: normalizeUnknown(source.extraHitConfig),
  };
}

function compareStableText(left: unknown, right: unknown): number {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function compareNormalizedEffects(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return compareStableText(left.effectId, right.effectId)
    || compareStableText(left.label, right.label)
    || compareStableText(left.typeKey, right.typeKey)
    || stableJson(left).localeCompare(stableJson(right));
}

function compareNormalizedEquipmentPieces(
  left: NormalizedOperatorConfig['equipment']['pieces'][number],
  right: NormalizedOperatorConfig['equipment']['pieces'][number],
): number {
  return compareStableText(left.slotKey, right.slotKey)
    || compareStableText(left.equipmentId, right.equipmentId)
    || compareStableText(left.name, right.name)
    || stableJson(left).localeCompare(stableJson(right));
}

function normalizeEquipmentPiece(value: unknown): NormalizedOperatorConfig['equipment']['pieces'][number] {
  const source = isRecord(value) ? value : {};
  const effects = Array.isArray(source.effects)
    ? source.effects
      .map(normalizeEffect)
      .filter((effect) => Object.values(effect).some((entry) => entry !== null))
    : [];
  effects.sort(compareNormalizedEffects);
  return {
    slotKey: normalizeText(source.slotKey),
    equipmentId: normalizeText(source.equipmentId),
    name: normalizeText(source.name),
    part: normalizeText(source.part),
    effects,
  };
}

function isMeaningfulEquipmentPiece(piece: NormalizedOperatorConfig['equipment']['pieces'][number]): boolean {
  return Boolean(piece.equipmentId || piece.name || piece.part || piece.effects.length);
}

function normalizeOperatorConfig(value: unknown): NormalizedOperatorConfig {
  const source = isRecord(value) ? value : {};
  const operator = isRecord(source.operator) ? source.operator : {};
  const weapon = isRecord(source.weapon) ? source.weapon : {};
  const weaponConfig = isRecord(weapon.config) ? weapon.config : {};
  const equipment = isRecord(source.equipment) ? source.equipment : {};
  const rawPieces = Array.isArray(equipment.pieces) ? equipment.pieces : [];
  const pieces = rawPieces.map(normalizeEquipmentPiece).filter(isMeaningfulEquipmentPiece);
  pieces.sort(compareNormalizedEquipmentPieces);

  const rawSkillLevels = isRecord(weaponConfig.skillLevels) ? weaponConfig.skillLevels : {};
  return {
    operator: {
      id: normalizeText(operator.id),
      name: normalizeText(operator.name),
      level: normalizeNumberish(operator.level),
      potential: normalizeNumberish(operator.potential),
      mainStat: normalizeText(operator.mainStat),
      subStat: normalizeText(operator.subStat),
      mainStatFlatBonus: normalizeNumber(operator.mainStatFlatBonus),
      subStatFlatBonus: normalizeNumber(operator.subStatFlatBonus),
      skillConfig: normalizeSkillConfig(operator.skillConfig),
    },
    weapon: {
      id: normalizeText(weapon.id),
      name: normalizeText(weapon.name),
      config: {
        level: normalizeNumberish(weaponConfig.level),
        potential: normalizeNumberish(weaponConfig.potential),
        skillLevels: {
          skill1: normalizeNumberish(rawSkillLevels.skill1),
          skill2: normalizeNumberish(rawSkillLevels.skill2),
          skill3: normalizeNumberish(rawSkillLevels.skill3),
        },
      },
    },
    equipment: { pieces },
  };
}

function flattenComparable(value: unknown, path: string, output: Map<string, unknown>) {
  if (value === null || typeof value !== 'object') {
    output.set(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenComparable(entry, `${path}[${index}]`, output));
    if (value.length === 0) output.set(path, null);
    return;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    output.set(path, null);
    return;
  }
  entries.forEach(([key, entry]) => flattenComparable(entry, path ? `${path}.${key}` : key, output));
}

function hasMeaningfulConfig(value: NormalizedOperatorConfig): boolean {
  const leaves = new Map<string, unknown>();
  flattenComparable(value, '', leaves);
  return [...leaves.values()].some((entry) => entry !== null);
}

function operatorConfigSection(path: string): TimelineOperatorConfigSection {
  if (path.startsWith('weapon.')) return 'weapon';
  if (path.startsWith('equipment.')) return 'equipment';
  return 'operator';
}

function compareOperatorConfig(
  characterId: string,
  beforeValue: unknown,
  afterValue: unknown,
  change: TimelineOperatorConfigChange['change'],
): TimelineOperatorConfigChange {
  const before = normalizeOperatorConfig(beforeValue);
  const after = normalizeOperatorConfig(afterValue);
  const beforeLeaves = new Map<string, unknown>();
  const afterLeaves = new Map<string, unknown>();
  flattenComparable(before, '', beforeLeaves);
  flattenComparable(after, '', afterLeaves);
  const paths = [...new Set([...beforeLeaves.keys(), ...afterLeaves.keys()])].sort((left, right) => left.localeCompare(right));
  const changes: TimelineOperatorConfigFieldChange[] = paths
    .filter((path) => stableJson(beforeLeaves.get(path)) !== stableJson(afterLeaves.get(path)))
    .map((path) => ({
      section: operatorConfigSection(path),
      path,
      before: beforeLeaves.get(path) ?? null,
      after: afterLeaves.get(path) ?? null,
    }));

  if (!changes.length && change !== 'changed') {
    changes.push({
      section: 'operator',
      path: 'operatorConfig',
      before: change === 'removed' ? before : null,
      after: change === 'added' ? after : null,
    });
  }
  const characterName = normalizeText(
    (isRecord(afterValue) && isRecord(afterValue.operator) ? afterValue.operator.name : undefined)
      ?? (isRecord(beforeValue) && isRecord(beforeValue.operator) ? beforeValue.operator.name : undefined)
  ) || characterId;
  return { characterId, characterName, change, changes };
}

function diffOperatorConfigs(basePayload: TimelineSnapshotPayload, workingPayload: TimelineSnapshotPayload): TimelineOperatorConfigChange[] {
  const baseConfigs = isRecord(basePayload.operatorConfigPageCache) ? basePayload.operatorConfigPageCache : {};
  const workingConfigs = isRecord(workingPayload.operatorConfigPageCache) ? workingPayload.operatorConfigPageCache : {};
  const characterIds = [...new Set([...Object.keys(baseConfigs), ...Object.keys(workingConfigs)])].sort((left, right) => left.localeCompare(right));
  return characterIds.flatMap((characterId) => {
    const baseConfig = normalizeOperatorConfig(baseConfigs[characterId]);
    const workingConfig = normalizeOperatorConfig(workingConfigs[characterId]);
    const hasBefore = Object.prototype.hasOwnProperty.call(baseConfigs, characterId) && hasMeaningfulConfig(baseConfig);
    const hasAfter = Object.prototype.hasOwnProperty.call(workingConfigs, characterId) && hasMeaningfulConfig(workingConfig);
    if (!hasBefore && !hasAfter) return [];
    if (!hasBefore) return [compareOperatorConfig(characterId, null, workingConfigs[characterId], 'added')];
    if (!hasAfter) return [compareOperatorConfig(characterId, baseConfigs[characterId], null, 'removed')];
    const change = compareOperatorConfig(characterId, baseConfigs[characterId], workingConfigs[characterId], 'changed');
    return change.changes.length ? [change] : [];
  });
}

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
    buffStackCounts: Object.fromEntries(Object.entries(button.buffStackCounts ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    targetResistance: Object.fromEntries(Object.entries(button.resistanceConfig?.targetResistance ?? {}).sort(([left], [right]) => left.localeCompare(right))),
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
  // Work Node payloads are reconstructed from SQLite, so structurally equal
  // objects do not retain reference identity. Compare a stable representation
  // or an unchanged node would report empty stack/resistance objects as edits.
  const beforeValue = before && typeof before === 'object' ? stableJson(before) : before;
  const afterValue = after && typeof after === 'object' ? stableJson(after) : after;
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
  compareField(changes, 'buffStackCounts', before.buffStackCounts, after.buffStackCounts);
  compareField(changes, 'targetResistance', before.targetResistance, after.targetResistance);
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
  const changedOperatorConfigs = diffOperatorConfigs(basePayload, workingPayload);
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
      addedOperatorConfigCount: changedOperatorConfigs.filter((change) => change.change === 'added').length,
      removedOperatorConfigCount: changedOperatorConfigs.filter((change) => change.change === 'removed').length,
      changedOperatorConfigCount: changedOperatorConfigs.filter((change) => change.change === 'changed').length,
      changedOperatorConfigFieldCount: changedOperatorConfigs.reduce((count, change) => count + change.changes.length, 0),
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
    changedOperatorConfigs,
  };
}
