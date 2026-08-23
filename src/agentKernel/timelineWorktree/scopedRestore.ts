import type { SkillButtonData, TimelineData } from '../../types';
import type {
  PersistedSkillButton,
  SkillButtonBuff,
  SkillButtonPanelConfig,
} from '../../types/storage';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { AiTimelineValidationIssue, AiTimelineValidationResult } from './types';
import { validateTimelinePayload } from './validator';

export type ScopedRestoreScope = 'timeline' | 'buff' | 'resistance';

export type ScopedRestoreFailureCode =
  | 'invalid-current-payload'
  | 'invalid-baseline-payload'
  | 'restored-payload-invalid';

export interface ScopedRestoreSuccess {
  ok: true;
  scope: ScopedRestoreScope;
  payload: TimelineSnapshotPayload;
}

export interface ScopedRestoreFailure {
  ok: false;
  scope: ScopedRestoreScope;
  code: ScopedRestoreFailureCode;
  message: string;
  issues: AiTimelineValidationIssue[];
}

export type ScopedRestoreResult = ScopedRestoreSuccess | ScopedRestoreFailure;

type AnyRecord = Record<string, unknown>;
type MutableButtonRecord = AnyRecord & {
  selectedBuff?: string[];
  buffStackCounts?: Record<string, number>;
  panelConfig?: SkillButtonPanelConfig;
};

/** Fields owned by timeline structure and skill identity. */
const BUTTON_STRUCTURE_KEYS = [
  'id',
  'characterId',
  'characterName',
  'skillType',
  'staffIndex',
  'lineIndex',
  'nodeIndex',
  'nodeNumber',
  'position',
  'runtimeSkillId',
  'skillDisplayName',
  'skillIconUrl',
  'customHits',
] as const;

/** Persisted Buff/panel runtime owned by the Buff scope. */
const BUTTON_BUFF_STATE_KEYS = [
  'selectedBuff',
  'buffStackCounts',
  'anomalyConfig',
  'panelConfig',
] as const;

/** Derived from the current loadout/calculation input; restore scopes invalidate it rather than copy it. */
const BUTTON_DERIVED_RUNTIME_KEYS = ['runtimeSnapshot'] as const;

const PANEL_BUFF_STATE_KEYS = [
  'selectedBuff',
  'globallyDisabledBuffIds',
  'manualDisabledBuffIdsBySegmentKey',
  'manualBuffStackCountsBySegmentKey',
  'singleHitBuffTargetByBuffId',
] as const;

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Clone JSON-like snapshots without JSON serialization. This preserves
 * undefined and unknown schema fields and never mutates either input.
 */
function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;

  if (value instanceof Date) return new Date(value.getTime()) as T;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    value.forEach((item, index) => {
      clone[index] = deepClone(item, seen);
    });
    return clone as T;
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as AnyRecord;
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ('value' in descriptor) descriptor.value = deepClone(descriptor.value, seen);
    Object.defineProperty(clone, key, descriptor);
  }
  return clone as T;
}

function hasOwn(source: AnyRecord | undefined, key: string): boolean {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function cloneRecord(value: unknown): AnyRecord {
  return isRecord(value) ? deepClone(value) : {};
}

/** Current values win on unknown-key collisions; scoped fields are assigned explicitly. */
function mergeRecords<T extends AnyRecord>(baseline: T | undefined, current: T | undefined): T {
  return {
    ...cloneRecord(baseline),
    ...cloneRecord(current),
  } as T;
}

function copyOptionalField(target: AnyRecord, source: AnyRecord | undefined, key: string): void {
  if (source && hasOwn(source, key)) target[key] = deepClone(source[key]);
  else delete target[key];
}

function copyFields(target: AnyRecord, source: AnyRecord | undefined, keys: readonly string[]): void {
  for (const key of keys) copyOptionalField(target, source, key);
}

/**
 * Buff and resistance restore change inputs used by the derived panel. Keep
 * the invalidation explicit so a later damage consumer cannot mistake a
 * snapshot calculated from the pre-restore state for a fresh calculation.
 */
function invalidateDerivedRuntimeSnapshot(target: AnyRecord): void {
  target.runtimeSnapshot = null;
}

function readSelectedBuff(button: AnyRecord | undefined): string[] {
  const value = button?.selectedBuff;
  if (!Array.isArray(value)) return [];
  return (deepClone(value) as unknown[]).filter((id): id is string => typeof id === 'string');
}

function filterSelectedBuffIds(value: unknown, selectedBuff: Set<string>): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && selectedBuff.has(id))
    : [];
}

function pruneDisabledBuffMap(value: unknown, selectedBuff: Set<string>): Record<string, string[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([segmentKey, buffIds]) => {
      const remaining = filterSelectedBuffIds(buffIds, selectedBuff);
      return remaining.length > 0 ? [[segmentKey, remaining] as const] : [];
    }),
  );
}

function pruneStackCountMap(value: unknown, selectedBuff: Set<string>): Record<string, Record<string, number>> {
  if (!isRecord(value)) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const [segmentKey, stackCounts] of Object.entries(value)) {
    if (!isRecord(stackCounts)) continue;
    const remaining: Record<string, number> = {};
    for (const [buffId, count] of Object.entries(stackCounts)) {
      if (selectedBuff.has(buffId) && typeof count === 'number') remaining[buffId] = count;
    }
    if (Object.keys(remaining).length > 0) result[segmentKey] = remaining;
  }
  return result;
}

function pruneSingleHitBuffTargetMap(
  value: unknown,
  selectedBuff: Set<string>,
): Record<string, string | null> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | null] => (
      selectedBuff.has(entry[0])
      && (entry[1] === null || typeof entry[1] === 'string')
    )),
  );
}

function normalizePanelConfig(
  panelConfig: unknown,
  selectedBuff: string[],
): SkillButtonPanelConfig | undefined {
  if (!isRecord(panelConfig)) {
    return selectedBuff.length > 0
      ? { selectedBuff: deepClone(selectedBuff) }
      : undefined;
  }

  const selectedBuffSet = new Set(selectedBuff);
  const next = cloneRecord(panelConfig) as MutableButtonRecord;
  next.selectedBuff = deepClone(selectedBuff);

  if (hasOwn(panelConfig, 'globallyDisabledBuffIds')) {
    next.globallyDisabledBuffIds = filterSelectedBuffIds(panelConfig.globallyDisabledBuffIds, selectedBuffSet);
  }
  if (hasOwn(panelConfig, 'manualDisabledBuffIdsBySegmentKey')) {
    next.manualDisabledBuffIdsBySegmentKey = pruneDisabledBuffMap(
      panelConfig.manualDisabledBuffIdsBySegmentKey,
      selectedBuffSet,
    );
  }
  if (hasOwn(panelConfig, 'manualBuffStackCountsBySegmentKey')) {
    next.manualBuffStackCountsBySegmentKey = pruneStackCountMap(
      panelConfig.manualBuffStackCountsBySegmentKey,
      selectedBuffSet,
    );
  }
  if (hasOwn(panelConfig, 'singleHitBuffTargetByBuffId')) {
    next.singleHitBuffTargetByBuffId = pruneSingleHitBuffTargetMap(
      panelConfig.singleHitBuffTargetByBuffId,
      selectedBuffSet,
    );
  }

  return next as unknown as SkillButtonPanelConfig;
}

function normalizeButtonBuffState(button: MutableButtonRecord): void {
  const selectedBuff = readSelectedBuff(button);
  button.selectedBuff = selectedBuff;
  const selectedBuffSet = new Set(selectedBuff);

  if (hasOwn(button, 'buffStackCounts')) {
    button.buffStackCounts = isRecord(button.buffStackCounts)
      ? Object.fromEntries(
        Object.entries(button.buffStackCounts).filter(([buffId]) => selectedBuffSet.has(buffId)),
      ) as Record<string, number>
      : {};
  }

  if (hasOwn(button, 'panelConfig') || selectedBuff.length > 0) {
    button.panelConfig = normalizePanelConfig(button.panelConfig, selectedBuff);
  }
}

function applyStructureFromBaseline(target: AnyRecord, baseline: AnyRecord): void {
  copyFields(target, baseline, BUTTON_STRUCTURE_KEYS);
}

function applyFullBuffState(target: AnyRecord, source: AnyRecord): void {
  copyFields(target, source, BUTTON_BUFF_STATE_KEYS);
  copyOptionalField(target, source, 'resistanceConfig');
}

function mergeBuffPanelConfigForRestore(
  currentPanel: unknown,
  baselinePanel: unknown,
): SkillButtonPanelConfig | undefined {
  const currentRecord = isRecord(currentPanel) ? currentPanel : undefined;
  const baselineRecord = isRecord(baselinePanel) ? baselinePanel : undefined;
  if (!currentRecord && !baselineRecord) return undefined;

  const merged = mergeRecords(baselineRecord, currentRecord);
  // Buff restore owns only these panel keys. Preserve current hit/runtime and
  // future unknown keys, while removing stale current Buff keys absent in base.
  copyFields(merged, baselineRecord, PANEL_BUFF_STATE_KEYS);
  return merged as unknown as SkillButtonPanelConfig;
}

function applyBuffStateFromBaseline(
  target: MutableButtonRecord,
  current: AnyRecord,
  baseline: AnyRecord,
): void {
  copyOptionalField(target, baseline, 'selectedBuff');
  copyOptionalField(target, baseline, 'buffStackCounts');
  copyOptionalField(target, baseline, 'anomalyConfig');

  const panelConfig = mergeBuffPanelConfigForRestore(current.panelConfig, baseline.panelConfig);
  if (panelConfig) target.panelConfig = panelConfig;
  else delete target.panelConfig;

  // Deliberately do not copy resistanceConfig: Buff scope cannot change it.
}

function timelineButtonMap(payload: TimelineSnapshotPayload): Map<string, AnyRecord> {
  const result = new Map<string, AnyRecord>();
  for (const staffLine of payload.timelineData.staffLines) {
    for (const button of staffLine.buttons ?? []) {
      result.set(button.id, button as unknown as AnyRecord);
    }
  }
  return result;
}

function orderedButtonIds(payload: TimelineSnapshotPayload): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const staffLine of payload.timelineData.staffLines) {
    for (const button of staffLine.buttons ?? []) {
      if (seen.has(button.id)) continue;
      seen.add(button.id);
      ids.push(button.id);
    }
  }
  return ids;
}

function lineMap(payload: TimelineSnapshotPayload): Map<number, AnyRecord> {
  return new Map(
    payload.timelineData.staffLines.map((line) => [line.staffIndex, line as unknown as AnyRecord]),
  );
}

function buildTimelineRestoreTable(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
): Record<string, PersistedSkillButton> {
  const currentTable = current.skillButtonTable as unknown as Record<string, AnyRecord>;
  const baselineTable = baseline.skillButtonTable as unknown as Record<string, AnyRecord>;
  const result: Record<string, PersistedSkillButton> = {};

  for (const buttonId of orderedButtonIds(baseline)) {
    const baselineButton = baselineTable[buttonId];
    const currentButton = currentTable[buttonId];
    const next = mergeRecords(baselineButton, currentButton) as MutableButtonRecord;
    applyStructureFromBaseline(next, baselineButton);
    if (currentButton) {
      applyFullBuffState(next, currentButton);
    } else {
      // Timeline restore must not smuggle baseline Buff/runtime state into a
      // newly restored button. Buff scope owns that state separately.
      copyFields(next, undefined, BUTTON_BUFF_STATE_KEYS);
      copyFields(next, undefined, BUTTON_DERIVED_RUNTIME_KEYS);
      copyOptionalField(next, undefined, 'resistanceConfig');
    }
    normalizeButtonBuffState(next);
    result[buttonId] = next as unknown as PersistedSkillButton;
  }

  return result;
}

function buildBuffRestoreTable(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
  baselineBuffIdRemap: ReadonlyMap<string, string>,
): Record<string, PersistedSkillButton> {
  const currentTable = current.skillButtonTable as unknown as Record<string, AnyRecord>;
  const baselineTable = baseline.skillButtonTable as unknown as Record<string, AnyRecord>;
  const result: Record<string, PersistedSkillButton> = {};

  for (const [buttonId, currentButton] of Object.entries(currentTable)) {
    const next = deepClone(currentButton) as MutableButtonRecord;
    const baselineButton = baselineTable[buttonId];
    if (baselineButton) {
      applyBuffStateFromBaseline(next, currentButton, baselineButton);
      remapBuffStateReferences(next, baselineBuffIdRemap);
    }
    invalidateDerivedRuntimeSnapshot(next);
    normalizeButtonBuffState(next);
    result[buttonId] = next as unknown as PersistedSkillButton;
  }

  return result;
}

/**
 * Resistance is an independent scope. Only buttons that still exist in the
 * current timeline can be restored. All non-resistance fields remain a
 * byte-for-byte clone of current except the derived runtime snapshot, which
 * is invalidated because resistance participates in damage calculation. A
 * missing baseline field restores absence; current-only buttons retain their
 * current resistance.
 */
function buildResistanceRestoreTable(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
): Record<string, PersistedSkillButton> {
  const currentTable = current.skillButtonTable as unknown as Record<string, AnyRecord>;
  const baselineTable = baseline.skillButtonTable as unknown as Record<string, AnyRecord>;
  return Object.fromEntries(Object.entries(currentTable).map(([buttonId, currentButton]) => {
    const next = deepClone(currentButton);
    const baselineButton = baselineTable[buttonId];
    if (baselineButton) {
      copyOptionalField(next, baselineButton, 'resistanceConfig');
      // Preserve compatibility with payloads that persisted targetResistance
      // directly before resistanceConfig became the canonical container.
      copyOptionalField(next, baselineButton, 'targetResistance');
    }
    invalidateDerivedRuntimeSnapshot(next);
    return [buttonId, next as unknown as PersistedSkillButton];
  }));
}

function buildTimelineDataForTimelineRestore(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
  restoredTable: Record<string, PersistedSkillButton>,
): TimelineData {
  const currentLines = lineMap(current);
  const currentButtons = timelineButtonMap(current);
  const baselineTable = baseline.skillButtonTable as unknown as Record<string, AnyRecord>;
  const baselineLines = baseline.timelineData.staffLines as unknown as Array<AnyRecord>;

  const staffLines = baselineLines.map((baselineLine) => {
    const currentLine = currentLines.get(Number(baselineLine.staffIndex));
    const nextLine = mergeRecords(baselineLine, currentLine);
    copyFields(nextLine, baselineLine, ['staffIndex', 'characterName', 'occupiedNodes']);

    const baselineButtons = Array.isArray(baselineLine.buttons) ? baselineLine.buttons as AnyRecord[] : [];
    nextLine.buttons = baselineButtons.map((baselineTimelineButton) => {
      const buttonId = String(baselineTimelineButton.id);
      const currentTimelineButton = currentButtons.get(buttonId);
      const nextButton = mergeRecords(baselineTimelineButton, currentTimelineButton);
      applyStructureFromBaseline(nextButton, baselineTable[buttonId]);
      const restoredButton = restoredTable[buttonId] as unknown as AnyRecord;
      nextButton.buffIds = readSelectedBuff(restoredButton);
      return nextButton as unknown as SkillButtonData;
    });

    return nextLine;
  });

  const nextTimelineData = mergeRecords(
    baseline.timelineData as unknown as AnyRecord,
    current.timelineData as unknown as AnyRecord,
  );
  copyFields(nextTimelineData, baseline.timelineData as unknown as AnyRecord, [
    'version',
    'createdAt',
    'updatedAt',
  ]);
  nextTimelineData.staffLines = staffLines;
  return nextTimelineData as unknown as TimelineData;
}

function buildTimelineDataForBuffRestore(
  current: TimelineSnapshotPayload,
  restoredTable: Record<string, PersistedSkillButton>,
): TimelineData {
  const currentLines = current.timelineData.staffLines as unknown as Array<AnyRecord>;
  const staffLines = currentLines.map((currentLine) => {
    const nextLine = deepClone(currentLine);
    const currentButtons = Array.isArray(currentLine.buttons) ? currentLine.buttons as AnyRecord[] : [];
    nextLine.buttons = currentButtons.map((currentTimelineButton) => {
      const nextButton = deepClone(currentTimelineButton);
      const restoredButton = restoredTable[String(currentTimelineButton.id)] as unknown as AnyRecord;
      nextButton.buffIds = readSelectedBuff(restoredButton);
      return nextButton as unknown as SkillButtonData;
    });
    return nextLine;
  });

  const nextTimelineData = deepClone(current.timelineData) as unknown as AnyRecord;
  nextTimelineData.staffLines = staffLines;
  return nextTimelineData as unknown as TimelineData;
}

function buffMap(payload: TimelineSnapshotPayload): Map<string, SkillButtonBuff> {
  return new Map(payload.allBuffList.map((buff) => [buff.id, buff]));
}

function collectReferencedBuffIds(
  table: Record<string, PersistedSkillButton>,
): { order: string[]; counts: Map<string, number> } {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const button of Object.values(table)) {
    for (const buffId of readSelectedBuff(button as unknown as AnyRecord)) {
      if (!counts.has(buffId)) order.push(buffId);
      counts.set(buffId, (counts.get(buffId) ?? 0) + 1);
    }
  }
  return { order, counts };
}

function rebuildBuffList(
  table: Record<string, PersistedSkillButton>,
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
  preferredSource: Map<string, 'current' | 'baseline'>,
  baselineBuffIdRemap: ReadonlyMap<string, string> = new Map(),
): SkillButtonBuff[] {
  const currentBuffs = buffMap(current);
  const baselineBuffs = buffMap(baseline);
  const baselineIdByRestoredId = new Map(
    [...baselineBuffIdRemap.entries()].map(([baselineId, restoredId]) => [restoredId, baselineId] as const),
  );
  const references = collectReferencedBuffIds(table);

  return references.order.map((buffId) => {
    const baselineId = baselineIdByRestoredId.get(buffId);
    const preferred = baselineId ? 'baseline' : preferredSource.get(buffId);
    const buff = preferred === 'baseline'
      ? baselineBuffs.get(baselineId ?? buffId) ?? currentBuffs.get(buffId)
      : currentBuffs.get(buffId) ?? baselineBuffs.get(buffId);
    if (!buff) throw new Error(`Scoped restore could not resolve referenced Buff ${buffId}.`);
    return {
      ...deepClone(buff),
      id: buffId,
      refCount: references.counts.get(buffId) ?? 0,
    };
  });
}

function preferredBuffSourcesForTimelineRestore(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
  restoredTable: Record<string, PersistedSkillButton>,
): Map<string, 'current' | 'baseline'> {
  const currentTable = current.skillButtonTable as unknown as Record<string, AnyRecord>;
  const baselineTable = baseline.skillButtonTable as unknown as Record<string, AnyRecord>;
  const preferred = new Map<string, 'current' | 'baseline'>();
  for (const buttonId of Object.keys(restoredTable)) {
    const source = currentTable[buttonId] ?? baselineTable[buttonId];
    const sourceKind: 'current' | 'baseline' = currentTable[buttonId] ? 'current' : 'baseline';
    for (const buffId of readSelectedBuff(source)) {
      if (!preferred.has(buffId)) preferred.set(buffId, sourceKind);
    }
  }
  return preferred;
}

function compareStableText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value as AnyRecord)
    .sort(([left], [right]) => compareStableText(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}

function buffDefinitionSignature(buff: SkillButtonBuff): string {
  const definition = cloneRecord(buff);
  delete definition.id;
  delete definition.refCount;
  return stableJson(definition);
}

function stableDefinitionHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

/**
 * A baseline Buff with the same ID but a different definition cannot share
 * the current ID: current-only buttons may still legitimately refer to the
 * current definition. Allocate baseline IDs from sorted definitions so the
 * result is independent of button traversal order.
 */
function buildBuffRestoreIdRemap(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
): Map<string, string> {
  const currentBuffs = buffMap(current);
  const baselineBuffs = buffMap(baseline);
  const reservedIds = new Set([...currentBuffs.keys(), ...baselineBuffs.keys()]);
  const conflicts = [...baselineBuffs.entries()]
    .filter(([buffId, baselineBuff]) => {
      const currentBuff = currentBuffs.get(buffId);
      return currentBuff !== undefined && buffDefinitionSignature(currentBuff) !== buffDefinitionSignature(baselineBuff);
    })
    .sort(([left], [right]) => compareStableText(left, right));
  const remap = new Map<string, string>();

  for (const [buffId, baselineBuff] of conflicts) {
    const baseId = `${buffId}::baseline-${stableDefinitionHash(buffDefinitionSignature(baselineBuff))}`;
    let restoredId = baseId;
    let suffix = 2;
    while (reservedIds.has(restoredId)) {
      restoredId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    reservedIds.add(restoredId);
    remap.set(buffId, restoredId);
  }

  return remap;
}

function remapBuffIdList(value: unknown, idRemap: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(value)) return deepClone(value);
  return value.map((entry) => (
    typeof entry === 'string' ? idRemap.get(entry) ?? entry : deepClone(entry)
  ));
}

function remapBuffCountMap(value: unknown, idRemap: ReadonlyMap<string, string>): unknown {
  if (!isRecord(value)) return deepClone(value);
  return Object.fromEntries(
    Object.entries(value).map(([buffId, count]) => [idRemap.get(buffId) ?? buffId, deepClone(count)]),
  );
}

function remapBuffIdKeyMap(value: unknown, idRemap: ReadonlyMap<string, string>): unknown {
  if (!isRecord(value)) return deepClone(value);
  return Object.fromEntries(
    Object.entries(value).map(([buffId, target]) => [
      idRemap.get(buffId) ?? buffId,
      deepClone(target),
    ]),
  );
}

function remapBuffIdArrayMap(value: unknown, idRemap: ReadonlyMap<string, string>): unknown {
  if (!isRecord(value)) return deepClone(value);
  return Object.fromEntries(
    Object.entries(value).map(([segmentKey, buffIds]) => [segmentKey, remapBuffIdList(buffIds, idRemap)]),
  );
}

function remapBuffPanelReferences(panelConfig: unknown, idRemap: ReadonlyMap<string, string>): unknown {
  if (!isRecord(panelConfig)) return deepClone(panelConfig);
  const next = cloneRecord(panelConfig);
  if (hasOwn(panelConfig, 'selectedBuff')) {
    next.selectedBuff = remapBuffIdList(panelConfig.selectedBuff, idRemap);
  }
  if (hasOwn(panelConfig, 'globallyDisabledBuffIds')) {
    next.globallyDisabledBuffIds = remapBuffIdList(panelConfig.globallyDisabledBuffIds, idRemap);
  }
  if (hasOwn(panelConfig, 'manualDisabledBuffIdsBySegmentKey')) {
    next.manualDisabledBuffIdsBySegmentKey = remapBuffIdArrayMap(
      panelConfig.manualDisabledBuffIdsBySegmentKey,
      idRemap,
    );
  }
  if (hasOwn(panelConfig, 'manualBuffStackCountsBySegmentKey')) {
    next.manualBuffStackCountsBySegmentKey = isRecord(panelConfig.manualBuffStackCountsBySegmentKey)
      ? Object.fromEntries(
        Object.entries(panelConfig.manualBuffStackCountsBySegmentKey).map(([segmentKey, counts]) => [
          segmentKey,
          remapBuffCountMap(counts, idRemap),
        ]),
      )
      : deepClone(panelConfig.manualBuffStackCountsBySegmentKey);
  }
  if (hasOwn(panelConfig, 'singleHitBuffTargetByBuffId')) {
    next.singleHitBuffTargetByBuffId = remapBuffIdKeyMap(
      panelConfig.singleHitBuffTargetByBuffId,
      idRemap,
    );
  }
  return next;
}

function remapBuffStateReferences(
  target: MutableButtonRecord,
  idRemap: ReadonlyMap<string, string>,
): void {
  if (idRemap.size === 0) return;
  if (hasOwn(target, 'selectedBuff')) target.selectedBuff = remapBuffIdList(target.selectedBuff, idRemap) as string[];
  if (hasOwn(target, 'buffStackCounts')) target.buffStackCounts = remapBuffCountMap(target.buffStackCounts, idRemap) as Record<string, number>;
  if (hasOwn(target, 'panelConfig')) {
    target.panelConfig = remapBuffPanelReferences(target.panelConfig, idRemap) as SkillButtonPanelConfig;
  }
}

function selectedAnomalySnapshotIds(button: AnyRecord | undefined): number[] {
  const anomalyConfig = isRecord(button?.anomalyConfig) ? button.anomalyConfig : undefined;
  const value = anomalyConfig?.selectedStateSnapshotIds;
  return Array.isArray(value)
    ? value.filter((id): id is number => Number.isSafeInteger(id) && id >= 0)
    : [];
}

/**
 * Buff restore changes anomaly state only for buttons that exist in both the
 * current and baseline payload. Current-only buttons keep their current
 * snapshot objects. If a shared numeric id now denotes different snapshots,
 * the current-only reference is deterministically remapped before the
 * baseline version takes that id.
 */
function restoreBuffAnomalySnapshots(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
  restoredTable: Record<string, PersistedSkillButton>,
): { snapshots: TimelineSnapshotPayload['anomalyStateSnapshots']; issues: AiTimelineValidationIssue[] } {
  const currentTable = current.skillButtonTable as unknown as Record<string, AnyRecord>;
  const baselineTable = baseline.skillButtonTable as unknown as Record<string, AnyRecord>;
  const currentById = new Map(current.anomalyStateSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const baselineById = new Map(baseline.anomalyStateSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const resultById = new Map(current.anomalyStateSnapshots.map((snapshot) => [snapshot.id, deepClone(snapshot)]));
  const resultOrder = current.anomalyStateSnapshots.map((snapshot) => snapshot.id);
  const issues: AiTimelineValidationIssue[] = [];
  let nextId = Math.max(
    0,
    ...current.anomalyStateSnapshots.map((snapshot) => snapshot.id),
    ...baseline.anomalyStateSnapshots.map((snapshot) => snapshot.id),
  ) + 1;

  const commonBaselineIds = new Set<number>();
  for (const buttonId of Object.keys(restoredTable)) {
    if (!currentTable[buttonId] || !baselineTable[buttonId]) continue;
    for (const snapshotId of selectedAnomalySnapshotIds(baselineTable[buttonId])) {
      commonBaselineIds.add(snapshotId);
    }
  }

  for (const [buttonId, restoredButton] of Object.entries(restoredTable)) {
    if (baselineTable[buttonId]) continue;
    const currentButton = currentTable[buttonId];
    const currentIds = selectedAnomalySnapshotIds(currentButton);
    const remappedIds = currentIds.map((snapshotId) => {
      if (!commonBaselineIds.has(snapshotId)) return snapshotId;
      const currentSnapshot = currentById.get(snapshotId);
      const baselineSnapshot = baselineById.get(snapshotId);
      if (!currentSnapshot || !baselineSnapshot || stableJson(currentSnapshot) === stableJson(baselineSnapshot)) {
        return snapshotId;
      }
      const remappedId = nextId;
      nextId += 1;
      resultById.set(remappedId, { ...deepClone(currentSnapshot), id: remappedId });
      resultOrder.push(remappedId);
      return remappedId;
    });
    if (isRecord((restoredButton as unknown as AnyRecord).anomalyConfig)) {
      (restoredButton as unknown as AnyRecord).anomalyConfig = {
        ...deepClone((restoredButton as unknown as AnyRecord).anomalyConfig as AnyRecord),
        selectedStateSnapshotIds: remappedIds,
      };
    }
  }

  for (const snapshotId of commonBaselineIds) {
    const baselineSnapshot = baselineById.get(snapshotId);
    if (!baselineSnapshot) {
      issues.push({
        code: 'unresolved-anomaly-snapshot-reference',
        message: `Baseline button references missing anomaly state snapshot ${snapshotId}.`,
      });
      continue;
    }
    if (!resultById.has(snapshotId)) resultOrder.push(snapshotId);
    resultById.set(snapshotId, deepClone(baselineSnapshot));
  }

  for (const [buttonId, button] of Object.entries(restoredTable)) {
    for (const snapshotId of selectedAnomalySnapshotIds(button as unknown as AnyRecord)) {
      if (resultById.has(snapshotId)) continue;
      issues.push({
        code: 'unresolved-anomaly-snapshot-reference',
        message: `Restored button ${buttonId} references missing anomaly state snapshot ${snapshotId}.`,
        path: `skillButtonTable.${buttonId}.anomalyConfig.selectedStateSnapshotIds`,
      });
    }
  }

  return {
    snapshots: resultOrder.flatMap((snapshotId) => {
      const snapshot = resultById.get(snapshotId);
      return snapshot ? [snapshot] : [];
    }),
    issues,
  };
}

function safeValidatePayload(value: unknown): AiTimelineValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ code: 'invalid-payload', message: 'Timeline snapshot payload must be an object.' }],
    };
  }

  try {
    return validateTimelinePayload(value as unknown as TimelineSnapshotPayload);
  } catch (error) {
    return {
      ok: false,
      issues: [{
        code: 'payload-validation-threw',
        message: error instanceof Error ? error.message : 'Timeline snapshot validation failed unexpectedly.',
      }],
    };
  }
}

function duplicateBuffIssues(payload: TimelineSnapshotPayload): AiTimelineValidationIssue[] {
  const seen = new Set<string>();
  const issues: AiTimelineValidationIssue[] = [];
  payload.allBuffList.forEach((buff, index) => {
    if (seen.has(buff.id)) {
      issues.push({
        code: 'duplicate-buff-id',
        message: `Buff ${buff.id} appears more than once in allBuffList.`,
        path: `allBuffList.${index}.id`,
      });
    }
    seen.add(buff.id);
  });
  return issues;
}

function inputFailure(
  scope: ScopedRestoreScope,
  code: 'invalid-current-payload' | 'invalid-baseline-payload',
  role: string,
  validation: AiTimelineValidationResult,
  duplicateIssues: AiTimelineValidationIssue[],
): ScopedRestoreFailure {
  const issues = validation.ok ? duplicateIssues : [...validation.issues, ...duplicateIssues];
  return {
    ok: false,
    scope,
    code,
    message: `${role} timeline payload is not valid for scoped restore.`,
    issues,
  };
}

function restoredFailure(
  scope: ScopedRestoreScope,
  validation: AiTimelineValidationResult,
  extraIssues: AiTimelineValidationIssue[] = [],
): ScopedRestoreFailure {
  return {
    ok: false,
    scope,
    code: 'restored-payload-invalid',
    message: 'Scoped restore produced a timeline payload that failed validation.',
    issues: validation.ok ? extraIssues : [...validation.issues, ...extraIssues],
  };
}

export function restoreScopedTimelinePayload(
  scope: ScopedRestoreScope,
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
): ScopedRestoreResult {
  const currentValidation = safeValidatePayload(current);
  const currentDuplicateIssues = currentValidation.ok ? duplicateBuffIssues(current) : [];
  if (!currentValidation.ok || currentDuplicateIssues.length > 0) {
    return inputFailure(scope, 'invalid-current-payload', 'Current', currentValidation, currentDuplicateIssues);
  }

  const baselineValidation = safeValidatePayload(baseline);
  const baselineDuplicateIssues = baselineValidation.ok ? duplicateBuffIssues(baseline) : [];
  if (!baselineValidation.ok || baselineDuplicateIssues.length > 0) {
    return inputFailure(scope, 'invalid-baseline-payload', 'Baseline', baselineValidation, baselineDuplicateIssues);
  }

  if (scope === 'resistance') {
    const restoredPayload = deepClone(current);
    restoredPayload.skillButtonTable = buildResistanceRestoreTable(current, baseline);
    const restoredValidation = safeValidatePayload(restoredPayload);
    if (!restoredValidation.ok) return restoredFailure(scope, restoredValidation);
    return { ok: true, scope, payload: restoredPayload };
  }

  const baselineBuffIdRemap = scope === 'buff'
    ? buildBuffRestoreIdRemap(current, baseline)
    : new Map<string, string>();
  const restoredTable = scope === 'timeline'
    ? buildTimelineRestoreTable(current, baseline)
    : buildBuffRestoreTable(current, baseline, baselineBuffIdRemap);
  const preferredSource = scope === 'timeline'
    ? preferredBuffSourcesForTimelineRestore(current, baseline, restoredTable)
    : new Map<string, 'current' | 'baseline'>();

  let restoredBuffList: SkillButtonBuff[];
  try {
    restoredBuffList = rebuildBuffList(restoredTable, current, baseline, preferredSource, baselineBuffIdRemap);
  } catch (error) {
    return restoredFailure(scope, { ok: false, issues: [{
      code: 'unresolved-buff-reference',
      message: error instanceof Error ? error.message : 'Scoped restore could not resolve a Buff reference.',
    }] });
  }

  const restoredPayload = mergeRecords(
    baseline as unknown as AnyRecord,
    current as unknown as AnyRecord,
  ) as unknown as TimelineSnapshotPayload;
  restoredPayload.skillButtonTable = restoredTable;
  restoredPayload.allBuffList = restoredBuffList;

  if (scope === 'timeline') {
    restoredPayload.selectedCharacters = deepClone(current.selectedCharacters);
    restoredPayload.anomalyStateSnapshots = deepClone(current.anomalyStateSnapshots);
    restoredPayload.characterInputMap = deepClone(current.characterInputMap);
    restoredPayload.operatorConfigPageCache = deepClone(current.operatorConfigPageCache);
    restoredPayload.timelineData = buildTimelineDataForTimelineRestore(current, baseline, restoredTable);
  } else {
    const restoredAnomalies = restoreBuffAnomalySnapshots(current, baseline, restoredTable);
    if (restoredAnomalies.issues.length > 0) {
      return restoredFailure(scope, { ok: true, issues: [] }, restoredAnomalies.issues);
    }
    restoredPayload.selectedCharacters = deepClone(current.selectedCharacters);
    restoredPayload.anomalyStateSnapshots = restoredAnomalies.snapshots;
    restoredPayload.timelineData = buildTimelineDataForBuffRestore(current, restoredTable);
    restoredPayload.characterInputMap = deepClone(current.characterInputMap);
    restoredPayload.characterComputedMap = deepClone(current.characterComputedMap);
    restoredPayload.characterDisplayCacheMap = deepClone(current.characterDisplayCacheMap);
    restoredPayload.operatorConfigPageCache = deepClone(current.operatorConfigPageCache);
  }

  const restoredValidation = safeValidatePayload(restoredPayload);
  if (!restoredValidation.ok) return restoredFailure(scope, restoredValidation);

  return {
    ok: true,
    scope,
    payload: restoredPayload,
  };
}

/** Restore baseline timeline structure/skill placement and preserve live Buff runtime for common IDs. */
export function restoreTimelineScope(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
): ScopedRestoreResult {
  return restoreScopedTimelinePayload('timeline', current, baseline);
}

/** Restore baseline Buff attachments and invalidate derived runtime for the live timeline structure. */
export function restoreBuffScope(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
): ScopedRestoreResult {
  return restoreScopedTimelinePayload('buff', current, baseline);
}

/** Restore only baseline target resistance and invalidate derived runtime snapshots. */
export function restoreResistanceScope(
  current: TimelineSnapshotPayload,
  baseline: TimelineSnapshotPayload,
): ScopedRestoreResult {
  return restoreScopedTimelinePayload('resistance', current, baseline);
}
