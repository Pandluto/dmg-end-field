import {
  DefToolExecutionError,
  type DefToolDescriptor,
  type DefToolExecutionContext,
  type DefToolHandler,
  type JsonObject,
  type JsonValue,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../contracts/index.ts';

export const DEF_DAMAGE_REPORT_VERSION = 'damage-report-v1' as const;
const MAX_BUFF_CANDIDATES = 200;

type WorkbenchPayload = {
  readonly raw: JsonObject;
  readonly selectedCharacters: readonly JsonObject[];
  readonly skillButtons: readonly JsonObject[];
  readonly operatorConfigs: readonly JsonObject[];
};

export class DefReadToolRegistry {
  readonly #handlers: ReadonlyMap<string, DefToolHandler>;

  constructor() {
    const handlers = [
      createHandler(
        descriptor(
          'def.node.crud.context',
          'Read the bound current Workbench context and selected roster.',
          emptyObjectSchema(),
        ),
        readContext,
      ),
      createHandler(
        descriptor(
          'def.data.resource.team_loadouts',
          'Read exact current loadouts for all selected operators.',
          emptyObjectSchema(),
        ),
        readTeamLoadouts,
      ),
      createHandler(
        descriptor(
          'def.node.crud.current',
          'Read the current timeline checkout and stable skill-button coordinates.',
          emptyObjectSchema(),
        ),
        readCurrentTimeline,
      ),
      createHandler(
        descriptor(
          'def.data.resource.buff',
          'Resolve bounded Buff facts present in the current Workbench snapshot.',
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string', maxLength: 200 },
              buttonId: { type: 'string', maxLength: 200 },
            },
          },
        ),
        resolveBuffs,
      ),
      createHandler(
        descriptor(
          'def.data.resource.damage',
          'Read the product-generated typed damage report without recomputing formulas.',
          emptyObjectSchema(),
        ),
        readDamageReport,
      ),
    ];
    this.#handlers = new Map(handlers.map((handler) => [handler.descriptor.name, handler]));
  }

  listDescriptors(): readonly DefToolDescriptor[] {
    return [...this.#handlers.values()].map((handler) => cloneDescriptor(handler.descriptor));
  }

  resolveDescriptor(name: string): DefToolDescriptor | null {
    const resolved = this.#handlers.get(name)?.descriptor;
    return resolved ? cloneDescriptor(resolved) : null;
  }

  async execute(
    name: string,
    input: JsonValue,
    context: DefToolExecutionContext,
  ): Promise<JsonValue> {
    const handler = this.#handlers.get(name);
    if (!handler) {
      throw new DefToolExecutionError('DEF_TOOL_UNSUPPORTED', `Unsupported DEF read Tool: ${name}`);
    }
    assertNotAborted(context);
    const result = await handler.execute(input, context);
    assertNotAborted(context);
    return cloneJson(result);
  }
}

function createHandler(
  toolDescriptor: DefToolDescriptor,
  execute: DefToolHandler['execute'],
): DefToolHandler {
  return { descriptor: toolDescriptor, execute };
}

function descriptor(
  name: string,
  description: string,
  inputSchema: JsonObject,
): DefToolDescriptor {
  return { name, description, inputSchema, risk: 'read' };
}

function emptyObjectSchema(): JsonObject {
  return { type: 'object', additionalProperties: false, properties: {} };
}

async function readContext(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  expectExactObject(input, []);
  const snapshot = await readSnapshot(context);
  const payload = workbenchPayload(snapshot);
  return {
    contract: 'DefWorkbenchContextV1',
    binding: bindingJson(snapshot.binding),
    capturedAt: snapshot.capturedAt,
    currentView: stringOrNull(payload.raw.currentView),
    checkout: objectOrNull(payload.raw.checkout),
    selectedCharacters: payload.selectedCharacters.map(projectCharacter),
    counts: {
      selectedCharacters: payload.selectedCharacters.length,
      skillButtons: payload.skillButtons.length,
      operatorConfigs: payload.operatorConfigs.length,
    },
    damageReportAvailable: isDamageReportReady(payload),
  };
}

async function readTeamLoadouts(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  expectExactObject(input, []);
  const snapshot = await readSnapshot(context);
  const payload = workbenchPayload(snapshot);
  const configs = new Map<string, JsonObject>();
  for (const config of payload.operatorConfigs) {
    const characterId = stringOrNull(config.characterId);
    if (characterId) configs.set(characterId, config);
  }
  const missingCharacterIds: string[] = [];
  const operators = payload.selectedCharacters.map((character) => {
    const projectedCharacter = projectCharacter(character);
    const characterId = stringOrNull(character.id) ?? '';
    const config = configs.get(characterId) ?? null;
    if (!config) missingCharacterIds.push(characterId);
    return {
      character: projectedCharacter,
      weapon: config ? objectOrNull(config.weapon) : null,
      equipment: config
        ? [...objectArray(config.equipment, 'operatorConfig.equipment')]
          .sort(compareByStableIdentity('slotKey', 'equipmentId'))
        : [],
      setBuffs: config
        ? [...optionalObjectArray(config.setBuffs, 'operatorConfig.setBuffs')]
          .sort(compareByStableIdentity('gearSetId', 'effectId'))
        : [],
      operatorSkillLevels: config ? objectOrNull(config.operatorSkillLevels) : null,
      configured: Boolean(config),
    };
  });
  return {
    contract: 'DefTeamLoadoutsV1',
    binding: bindingJson(snapshot.binding),
    complete: missingCharacterIds.length === 0,
    missingCharacterIds,
    operators,
  };
}

async function readCurrentTimeline(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  expectExactObject(input, []);
  const snapshot = await readSnapshot(context);
  const payload = workbenchPayload(snapshot);
  const buttons = payload.skillButtons
    .map((button) => ({
      id: requiredString(button.id, 'skillButton.id'),
      characterId: requiredString(button.characterId, 'skillButton.characterId'),
      characterName: requiredString(button.characterName, 'skillButton.characterName'),
      skillType: requiredString(button.skillType, 'skillButton.skillType'),
      runtimeSkillId: stringOrNull(button.runtimeSkillId),
      skillDisplayName: stringOrNull(button.skillDisplayName),
      staffIndex: finiteNumber(button.staffIndex, 'skillButton.staffIndex'),
      lineIndex: finiteNumber(button.lineIndex, 'skillButton.lineIndex'),
      persistenceStaffIndex: finiteNumber(button.persistenceStaffIndex, 'skillButton.persistenceStaffIndex'),
      persistenceNodeIndex: finiteNumber(button.persistenceNodeIndex, 'skillButton.persistenceNodeIndex'),
      selectedBuffCount: stringArray(button.selectedBuffIds, 'skillButton.selectedBuffIds').length,
    }))
    .sort((left, right) => (
      left.persistenceStaffIndex - right.persistenceStaffIndex
      || left.persistenceNodeIndex - right.persistenceNodeIndex
      || left.id.localeCompare(right.id)
    ));
  return {
    contract: 'DefCurrentTimelineV1',
    binding: bindingJson(snapshot.binding),
    timelineId: stringOrNull(payload.raw.activeTimelineId)
      ?? stringOrNull(payload.raw.timelineId)
      ?? snapshot.binding.timelineId,
    checkout: objectOrNull(payload.raw.checkout),
    contentRevision: snapshot.binding.contentRevision,
    buttonCount: buttons.length,
    buttons,
  };
}

async function resolveBuffs(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  const args = expectExactObject(input, ['query', 'buttonId']);
  const query = optionalBoundedString(args.query, 'query');
  const buttonId = optionalBoundedString(args.buttonId, 'buttonId');
  const normalizedQuery = query?.toLowerCase() ?? '';
  const snapshot = await readSnapshot(context);
  const payload = workbenchPayload(snapshot);
  const candidates = new Map<string, MutableBuffCandidate>();

  for (const button of payload.skillButtons) {
    const currentButtonId = requiredString(button.id, 'skillButton.id');
    if (buttonId && currentButtonId !== buttonId) continue;
    const characterId = requiredString(button.characterId, 'skillButton.characterId');
    for (const buff of optionalObjectArray(button.selectedBuffs, 'skillButton.selectedBuffs')) {
      collectBuff(candidates, {
        id: stringOrNull(buff.id),
        label: stringOrNull(buff.displayName) ?? stringOrNull(buff.name) ?? stringOrNull(buff.id) ?? 'unnamed-buff',
        type: stringOrNull(buff.type),
        value: numberOrNull(buff.value),
        sourceLabel: stringOrNull(buff.sourceName) ?? stringOrNull(buff.source),
        sourceKind: 'button',
        buttonId: currentButtonId,
        characterId,
      });
    }
  }

  if (!buttonId) {
    for (const config of payload.operatorConfigs) {
      const characterId = requiredString(config.characterId, 'operatorConfig.characterId');
      for (const equipment of optionalObjectArray(config.equipment, 'operatorConfig.equipment')) {
        for (const effect of optionalObjectArray(equipment.effects, 'equipment.effects')) {
          collectBuff(candidates, {
            id: stringOrNull(effect.effectId),
            label: stringOrNull(effect.label) ?? stringOrNull(effect.effectId) ?? 'unnamed-equipment-effect',
            type: stringOrNull(effect.typeKey),
            value: numberOrNull(effect.value),
            sourceLabel: stringOrNull(equipment.name),
            sourceKind: 'equipment',
            buttonId: null,
            characterId,
          });
        }
      }
      for (const setBuff of optionalObjectArray(config.setBuffs, 'operatorConfig.setBuffs')) {
        collectBuff(candidates, {
          id: stringOrNull(setBuff.effectId),
          label: stringOrNull(setBuff.label) ?? stringOrNull(setBuff.effectId) ?? 'unnamed-set-effect',
          type: stringOrNull(setBuff.typeKey),
          value: numberOrNull(setBuff.value),
          sourceLabel: stringOrNull(setBuff.gearSetName),
          sourceKind: 'set',
          buttonId: null,
          characterId,
        });
      }
    }
  }

  const all = [...candidates.values()]
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      return [candidate.id, candidate.label, candidate.type, ...candidate.sourceLabels]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .sort((left, right) => compareText(left.label, right.label) || compareText(left.key, right.key));
  const bounded = all.slice(0, MAX_BUFF_CANDIDATES).map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    type: candidate.type,
    value: candidate.value,
    sourceKinds: [...candidate.sourceKinds].sort(),
    sourceLabels: [...candidate.sourceLabels].sort(),
    buttonIds: [...candidate.buttonIds].sort(),
    characterIds: [...candidate.characterIds].sort(),
  }));
  return {
    contract: 'DefBuffCandidatesV1',
    binding: bindingJson(snapshot.binding),
    query: query ?? null,
    buttonId: buttonId ?? null,
    candidateCount: all.length,
    truncated: all.length > MAX_BUFF_CANDIDATES,
    candidates: bounded,
  };
}

async function readDamageReport(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  expectExactObject(input, []);
  const snapshot = await readSnapshot(context);
  const payload = workbenchPayload(snapshot);
  const damageReport = requireReadyDamageReport(payload);
  return {
    contract: 'DefDamageReportV1',
    binding: bindingJson(snapshot.binding),
    formulaVersion: DEF_DAMAGE_REPORT_VERSION,
    statisticalScope: 'current-workbench-snapshot',
    schemeDigest: snapshot.binding.snapshotDigest,
    report: damageReport,
  };
}

function requireReadyDamageReport(payload: WorkbenchPayload): JsonObject {
  if (
    payload.raw.currentView !== 'canvas'
    || payload.raw.damageReportStatus !== 'ready'
    || !isRecord(payload.raw.damageReport)
  ) {
    throw new DefToolExecutionError(
      'DEF_DAMAGE_REPORT_UNAVAILABLE',
      'The current Canvas snapshot does not contain a generated damage report',
    );
  }
  const report = payload.raw.damageReport;
  const generatedAt = report.generatedAt;
  const totalExpected = report.totalExpected;
  const totalNonCrit = report.totalNonCrit;
  const buttonCount = report.buttonCount;
  if (
    typeof generatedAt !== 'number'
    || !Number.isSafeInteger(generatedAt)
    || generatedAt <= 0
    || typeof totalExpected !== 'number'
    || !Number.isFinite(totalExpected)
    || typeof totalNonCrit !== 'number'
    || !Number.isFinite(totalNonCrit)
    || typeof buttonCount !== 'number'
    || !Number.isSafeInteger(buttonCount)
    || buttonCount < 0
  ) {
    throw new DefToolExecutionError(
      'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
      'Generated damage report summary is malformed',
    );
  }
  const buttons = objectArray(report.buttons, 'damageReport.buttons');
  if (buttons.length !== buttonCount) {
    throw new DefToolExecutionError(
      'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
      'Generated damage report buttonCount does not match its rows',
    );
  }
  const currentButtonIds = new Set(payload.skillButtons.map((button) => (
    requiredString(button.id, 'skillButton.id')
  )));
  const reportButtonIds = new Set<string>();
  for (const button of buttons) {
    const id = requiredString(button.id, 'damageReport.button.id');
    requiredString(button.characterId, 'damageReport.button.characterId');
    finiteNumber(button.expected, 'damageReport.button.expected');
    finiteNumber(button.nonCrit, 'damageReport.button.nonCrit');
    if (reportButtonIds.has(id) || !currentButtonIds.has(id)) {
      throw new DefToolExecutionError(
        'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
        `Generated damage report row ${id} is duplicated or absent from the current timeline`,
      );
    }
    reportButtonIds.add(id);
  }
  return report;
}

function isDamageReportReady(payload: WorkbenchPayload): boolean {
  try {
    requireReadyDamageReport(payload);
    return true;
  } catch {
    return false;
  }
}

async function readSnapshot(context: DefToolExecutionContext): Promise<ProductSnapshotEnvelope> {
  assertNotAborted(context);
  const snapshot = await context.product.getSnapshot(context.binding);
  assertNotAborted(context);
  if (!sameBinding(snapshot.binding, context.binding)) {
    throw new DefToolExecutionError(
      'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
      'Product snapshot binding does not match the pinned DEF Turn binding',
    );
  }
  return snapshot;
}

function sameBinding(left: ProductBinding, right: ProductBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest;
}

function workbenchPayload(snapshot: ProductSnapshotEnvelope): WorkbenchPayload {
  const raw = snapshot.payload;
  if (raw.schemaVersion !== 1) {
    throw new DefToolExecutionError(
      'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
      'Workbench snapshot schemaVersion must be 1',
    );
  }
  return {
    raw,
    selectedCharacters: objectArray(raw.selectedCharacters, 'selectedCharacters'),
    skillButtons: objectArray(raw.skillButtons, 'skillButtons'),
    operatorConfigs: optionalObjectArray(raw.operatorConfigs, 'operatorConfigs'),
  };
}

function projectCharacter(value: JsonObject): JsonObject {
  return {
    id: requiredString(value.id, 'character.id'),
    name: requiredString(value.name, 'character.name'),
    element: stringOrNull(value.element),
    profession: stringOrNull(value.profession),
    librarySource: stringOrNull(value.librarySource),
  };
}

function bindingJson(binding: ProductBinding): JsonObject {
  return {
    workspaceId: binding.workspaceId,
    databaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    checkoutTargetId: binding.checkoutTargetId,
    checkoutUpdatedAt: binding.checkoutUpdatedAt,
    contentRevision: binding.contentRevision,
    snapshotDigest: binding.snapshotDigest,
  };
}

type MutableBuffCandidate = {
  readonly key: string;
  readonly id: string | null;
  readonly label: string;
  readonly type: string | null;
  readonly value: number | null;
  readonly sourceKinds: Set<string>;
  readonly sourceLabels: Set<string>;
  readonly buttonIds: Set<string>;
  readonly characterIds: Set<string>;
};

function collectBuff(
  candidates: Map<string, MutableBuffCandidate>,
  input: {
    readonly id: string | null;
    readonly label: string;
    readonly type: string | null;
    readonly value: number | null;
    readonly sourceLabel: string | null;
    readonly sourceKind: 'button' | 'equipment' | 'set';
    readonly buttonId: string | null;
    readonly characterId: string;
  },
): void {
  const key = [input.id ?? '', input.label, input.type ?? '', input.value ?? ''].join('\u0000');
  const existing = candidates.get(key) ?? {
    key,
    id: input.id,
    label: input.label,
    type: input.type,
    value: input.value,
    sourceKinds: new Set<string>(),
    sourceLabels: new Set<string>(),
    buttonIds: new Set<string>(),
    characterIds: new Set<string>(),
  };
  existing.sourceKinds.add(input.sourceKind);
  if (input.sourceLabel) existing.sourceLabels.add(input.sourceLabel);
  if (input.buttonId) existing.buttonIds.add(input.buttonId);
  existing.characterIds.add(input.characterId);
  candidates.set(key, existing);
}

function expectExactObject(value: JsonValue, allowedKeys: readonly string[]): JsonObject {
  if (!isRecord(value)) {
    throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', 'Tool input must be a JSON object');
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new DefToolExecutionError(
      'DEF_TOOL_INPUT_INVALID',
      `Tool input contains unsupported fields: ${unknown.sort().join(', ')}`,
    );
  }
  return value;
}

function optionalBoundedString(value: JsonValue | undefined, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 200) {
    throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', `${field} must be a string of at most 200 characters`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function objectArray(value: JsonValue | undefined, field: string): JsonObject[] {
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new DefToolExecutionError('DEF_TOOL_PRODUCT_SNAPSHOT_INVALID', `${field} must be an object array`);
  }
  return value as JsonObject[];
}

function optionalObjectArray(value: JsonValue | undefined, field: string): JsonObject[] {
  return value === undefined ? [] : objectArray(value, field);
}

function objectOrNull(value: JsonValue | undefined): JsonObject | null {
  return isRecord(value) ? value : null;
}

function stringArray(value: JsonValue | undefined, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new DefToolExecutionError('DEF_TOOL_PRODUCT_SNAPSHOT_INVALID', `${field} must be a string array`);
  }
  return value as string[];
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DefToolExecutionError('DEF_TOOL_PRODUCT_SNAPSHOT_INVALID', `${field} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DefToolExecutionError('DEF_TOOL_PRODUCT_SNAPSHOT_INVALID', `${field} must be a finite number`);
  }
  return value;
}

function stringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertNotAborted(context: DefToolExecutionContext): void {
  if (context.abortSignal.aborted) {
    throw new DefToolExecutionError('DEF_TOOL_ABORTED', 'DEF Tool execution was aborted');
  }
}

function cloneJson<Value extends JsonValue>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function cloneDescriptor(value: DefToolDescriptor): DefToolDescriptor {
  return {
    ...value,
    inputSchema: cloneJson(value.inputSchema),
  };
}

function compareByStableIdentity(
  primary: string,
  secondary: string,
): (left: JsonObject, right: JsonObject) => number {
  return (left, right) => (
    compareText(stringOrNull(left[primary]) ?? '', stringOrNull(right[primary]) ?? '')
    || compareText(stringOrNull(left[secondary]) ?? '', stringOrNull(right[secondary]) ?? '')
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
