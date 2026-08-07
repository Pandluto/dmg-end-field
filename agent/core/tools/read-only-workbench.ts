import {
  DefToolExecutionError,
  canonicalJson,
  type DefToolDescriptor,
  type DefToolExecutionContext,
  type DefToolHandler,
  type DefHarnessBusinessId,
  type DefHarnessOperationId,
  type JsonObject,
  type JsonValue,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../contracts/index.ts';
import {
  aggregateDamageReport,
  attributeDamageReport,
  compareDamageReports,
  currentDamageReportProjection,
  diagnoseDamageReport,
  explainDamageReport,
  exportDamageReport,
  validateDamageReportCapsule,
  type DamageReportOperationResult,
  type DefDamageReportCapsule,
} from './damage-report-operations.ts';
import {
  compareFacts as compareLoadoutFacts,
  evaluateFacts as evaluateLoadoutFacts,
  validateLoadoutCapsule,
  type LoadoutFactResult,
} from './loadout-fact-operations.ts';
import { operationCapabilityJson } from './operation-capability.ts';

export const DEF_DAMAGE_REPORT_VERSION = 'damage-report-v1' as const;
const MAX_BUFF_CANDIDATES = 200;
const MAX_BUFF_EVIDENCE_PER_CANDIDATE = 200;

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
          'Read, validate, evaluate completeness or compare exact current loadout facts without ranking equipment.',
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: ['current', 'evaluate', 'compare'] },
              baseline: { type: 'object' },
              operatorId: { type: 'string', maxLength: 256 },
              directoryCompatibilityEvidence: {},
            },
          },
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
          'Resolve bounded, snapshot-bound Buff facts including source, condition, stack, target and owner evidence.',
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
          'Read, aggregate, compare, attribute, diagnose, export or explain the product-generated typed damage report without recomputing formulas.',
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: {
                type: 'string',
                enum: ['current', 'aggregate', 'compare', 'attribute', 'diagnose', 'export', 'explain'],
              },
              baseline: { type: 'object' },
              buttonId: { type: 'string', maxLength: 256 },
              hitId: { type: 'string', maxLength: 256 },
              format: { type: 'string', enum: ['table', 'json'] },
              maxRows: { type: 'integer', minimum: 1, maximum: 256 },
              includeCharacters: { type: 'boolean' },
            },
          },
        ),
        readDamageReport,
      ),
      createHandler(
        descriptor(
          'def.capability.status',
          'Read the authoritative 1.8 capability status for one Harness business operation.',
          {
            type: 'object',
            additionalProperties: false,
            required: ['businessId', 'operation'],
            properties: {
              businessId: { type: 'string', maxLength: 64 },
              operation: { type: 'string', maxLength: 64 },
            },
          },
        ),
        readCapabilityStatus,
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

  executeRead(
    name: string,
    input: JsonValue,
    context: DefToolExecutionContext,
  ): Promise<JsonValue> {
    return this.execute(name, input, context);
  }

  async prepareInteractive(): Promise<never> {
    throw new DefToolExecutionError(
      'DEF_TOOL_UNSUPPORTED',
      'The read-only DEF Tool registry does not expose interactive Tools',
    );
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
    damageReportAvailable: isDamageReportReady(payload, snapshot.binding),
  };
}

async function readTeamLoadouts(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  const args = expectExactObject(input, [
    'action',
    'baseline',
    'operatorId',
    'directoryCompatibilityEvidence',
  ]);
  const action = optionalLoadoutAction(args.action);
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
  const capsule = {
    contract: 'DefTeamLoadoutsV1',
    binding: bindingJson(snapshot.binding),
    complete: missingCharacterIds.length === 0,
    missingCharacterIds,
    operators,
  };
  if (action === null) return capsule;
  const validated = validateLoadoutCapsule(capsule);
  if (!validated.ok) {
    throw new DefToolExecutionError(
      'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
      `Projected loadout facts are malformed: ${validated.error.code}: ${validated.error.message}`,
    );
  }
  if (action === 'current') return validated.value as unknown as JsonValue;
  const options = loadoutFactOptions(args);
  if (action === 'evaluate') {
    return unwrapLoadoutFactOperation(evaluateLoadoutFacts(validated.value, options)) as unknown as JsonValue;
  }
  if (!isRecord(args.baseline)) {
    throw new DefToolExecutionError(
      'DEF_TOOL_INPUT_INVALID',
      'baseline must be a DefTeamLoadoutsV1 object when action is compare',
    );
  }
  const baseline = validateLoadoutCapsule(args.baseline);
  if (!baseline.ok) {
    throw new DefToolExecutionError(
      'DEF_TOOL_INPUT_INVALID',
      `Baseline loadout facts are malformed: ${baseline.error.code}: ${baseline.error.message}`,
    );
  }
  return unwrapLoadoutFactOperation(
    compareLoadoutFacts(baseline.value, validated.value, options),
  ) as unknown as JsonValue;
}

function optionalLoadoutAction(value: JsonValue | undefined): 'current' | 'evaluate' | 'compare' | null {
  if (value === undefined) return null;
  if (value !== 'current' && value !== 'evaluate' && value !== 'compare') {
    throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', 'action is not a supported loadout fact operation');
  }
  return value;
}

function loadoutFactOptions(args: JsonObject): JsonObject {
  const options: JsonObject = {};
  if (args.operatorId !== undefined) {
    options.operatorId = requiredInputString(args.operatorId, 'operatorId', 256);
  }
  if (args.directoryCompatibilityEvidence !== undefined) {
    options.directoryCompatibilityEvidence = args.directoryCompatibilityEvidence;
  }
  return options;
}

function unwrapLoadoutFactOperation(result: LoadoutFactResult<unknown>): unknown {
  if (result.ok) return result.value;
  throw new DefToolExecutionError(
    'DEF_TOOL_INPUT_INVALID',
    `${result.error.code}: ${result.error.message}`,
  );
}

async function readCurrentTimeline(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  expectExactObject(input, []);
  const snapshot = await readSnapshot(context);
  const payload = workbenchPayload(snapshot);
  const buttons = payload.skillButtons
    .map(projectCurrentTimelineButton)
    .sort((left, right) => (
      Number(left.persistenceStaffIndex) - Number(right.persistenceStaffIndex)
      || Number(left.persistenceNodeIndex) - Number(right.persistenceNodeIndex)
      || String(left.id).localeCompare(String(right.id))
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
        facts: projectBuffFacts(buff),
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
            facts: projectBuffFacts({
              id: effect.effectId,
              name: effect.label,
              displayName: effect.label,
              sourceName: equipment.name,
              source: equipment.name,
              type: effect.typeKey,
              value: effect.value,
              description: null,
              condition: null,
              category: effect.category,
              effectKind: effect.effectKind,
              ownerBuffDomain: 'equipment',
              ownerCharacterId: characterId,
              ownerBuffGroup: null,
              refCount: null,
            }),
            sourceKind: 'equipment',
            buttonId: null,
            characterId,
          });
        }
      }
      for (const setBuff of optionalObjectArray(config.setBuffs, 'operatorConfig.setBuffs')) {
        collectBuff(candidates, {
          facts: projectBuffFacts({
            id: setBuff.effectId,
            name: setBuff.label,
            displayName: setBuff.label,
            sourceName: setBuff.gearSetName,
            source: setBuff.gearSetName,
            type: setBuff.typeKey,
            value: setBuff.value,
            description: null,
            condition: null,
            category: setBuff.category,
            effectKind: setBuff.effectKind,
            ownerBuffDomain: 'equipment',
            ownerCharacterId: characterId,
            ownerBuffGroup: 'threePiece',
            refCount: null,
          }),
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
      return [
        candidate.id,
        candidate.label,
        candidate.type,
        ...candidate.sourceLabels,
        stringOrNull(candidate.facts.description),
        stringOrNull(candidate.facts.condition),
        stringOrNull(candidate.facts.ownerBuffDomain),
        stringOrNull(candidate.facts.ownerBuffGroup),
      ]
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
    facts: candidate.facts,
    evidence: candidate.evidence.map((evidence) => ({
      ...evidence,
      snapshotBinding: bindingJson(snapshot.binding),
    })),
    evidenceTruncated: candidate.evidenceTruncated,
  }));
  return {
    contract: 'DefBuffCandidatesV1',
    schemaVersion: 2,
    binding: bindingJson(snapshot.binding),
    query: query ?? null,
    buttonId: buttonId ?? null,
    candidateCount: all.length,
    truncated: all.length > MAX_BUFF_CANDIDATES,
    candidates: bounded,
  };
}

async function readDamageReport(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue> {
  const args = expectExactObject(input, [
    'action',
    'baseline',
    'buttonId',
    'hitId',
    'format',
    'maxRows',
    'includeCharacters',
  ]);
  const action = optionalDamageAction(args.action);
  const snapshot = await readSnapshot(context);
  const payload = workbenchPayload(snapshot);
  if (action === 'diagnose') {
    return diagnoseSnapshotDamageReport(payload, snapshot.binding);
  }
  const capsule = buildValidatedDamageReportCapsule(payload, snapshot.binding);
  // Backward compatibility: the original `{}` call returned the full capsule.
  if (action === null) return capsule as unknown as JsonValue;

  const selection = damageSelectionOptions(args);
  const result = (() => {
    switch (action) {
      case 'current': return currentDamageReportProjection(capsule);
      case 'aggregate': return aggregateDamageReport(capsule);
      case 'compare': {
        if (!isRecord(args.baseline)) {
          throw new DefToolExecutionError(
            'DEF_TOOL_INPUT_INVALID',
            'baseline must be a DefDamageReportV1 object when action is compare',
          );
        }
        return compareDamageReports(capsule, args.baseline);
      }
      case 'attribute': return attributeDamageReport(capsule, selection);
      case 'explain': return explainDamageReport(capsule, selection);
      case 'export': return exportDamageReport(capsule, damageExportOptions(args));
    }
  })();
  return unwrapDamageOperation(result) as unknown as JsonValue;
}

async function readCapabilityStatus(input: JsonValue): Promise<JsonValue> {
  const args = expectExactObject(input, ['businessId', 'operation']);
  const businessId = requiredInputString(args.businessId, 'businessId', 64);
  const operation = requiredInputString(args.operation, 'operation', 64);
  return operationCapabilityJson(
    businessId as DefHarnessBusinessId,
    operation as DefHarnessOperationId,
  );
}

function damageReportCapsule(
  report: JsonObject,
  binding: ProductBinding,
): DefDamageReportCapsule {
  return {
    contract: 'DefDamageReportV1',
    binding: bindingJson(binding) as unknown as DefDamageReportCapsule['binding'],
    formulaVersion: DEF_DAMAGE_REPORT_VERSION,
    statisticalScope: 'current-workbench-snapshot',
    schemeDigest: binding.snapshotDigest,
    report: report as unknown as DefDamageReportCapsule['report'],
  };
}

function buildValidatedDamageReportCapsule(
  payload: WorkbenchPayload,
  binding: ProductBinding,
): DefDamageReportCapsule {
  const capsule = damageReportCapsule(requireReadyDamageReport(payload), binding);
  const validated = validateDamageReportCapsule(capsule);
  if (!validated.ok) {
    throw new DefToolExecutionError(
      'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
      `Generated damage report is malformed: ${validated.error.message}`,
    );
  }
  return validated.value;
}

function diagnoseSnapshotDamageReport(
  payload: WorkbenchPayload,
  binding: ProductBinding,
): JsonValue {
  if (
    payload.raw.currentView !== 'canvas'
    || payload.raw.damageReportStatus !== 'ready'
    || !isRecord(payload.raw.damageReport)
  ) {
    return unwrapDamageOperation(diagnoseDamageReport(null)) as unknown as JsonValue;
  }
  return unwrapDamageOperation(
    diagnoseDamageReport(damageReportCapsule(payload.raw.damageReport, binding)),
  ) as unknown as JsonValue;
}

function unwrapDamageOperation(result: DamageReportOperationResult<unknown>): unknown {
  if (result.ok) return result.value;
  throw new DefToolExecutionError(
    'DEF_TOOL_INPUT_INVALID',
    `${result.error.code}: ${result.error.message}`,
  );
}

function optionalDamageAction(value: JsonValue | undefined):
  | 'current'
  | 'aggregate'
  | 'compare'
  | 'attribute'
  | 'diagnose'
  | 'export'
  | 'explain'
  | null {
  if (value === undefined) return null;
  const actions = new Set([
    'current',
    'aggregate',
    'compare',
    'attribute',
    'diagnose',
    'export',
    'explain',
  ]);
  if (typeof value !== 'string' || !actions.has(value)) {
    throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', 'action is not a supported damage report operation');
  }
  return value as Exclude<ReturnType<typeof optionalDamageAction>, null>;
}

function damageSelectionOptions(args: JsonObject): JsonObject {
  const options: JsonObject = {};
  if (args.buttonId !== undefined) options.buttonId = requiredInputString(args.buttonId, 'buttonId', 256);
  if (args.hitId !== undefined) options.hitId = requiredInputString(args.hitId, 'hitId', 256);
  return options;
}

function damageExportOptions(args: JsonObject): JsonObject {
  const options: JsonObject = {};
  if (args.format !== undefined) {
    if (args.format !== 'table' && args.format !== 'json') {
      throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', 'format must be table or json');
    }
    options.format = args.format;
  }
  if (args.maxRows !== undefined) {
    if (!Number.isSafeInteger(args.maxRows) || Number(args.maxRows) < 1 || Number(args.maxRows) > 256) {
      throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', 'maxRows must be an integer between 1 and 256');
    }
    options.maxRows = args.maxRows;
  }
  if (args.includeCharacters !== undefined) {
    if (typeof args.includeCharacters !== 'boolean') {
      throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', 'includeCharacters must be a boolean');
    }
    options.includeCharacters = args.includeCharacters;
  }
  return options;
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

function isDamageReportReady(payload: WorkbenchPayload, binding: ProductBinding): boolean {
  try {
    buildValidatedDamageReportCapsule(payload, binding);
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

/**
 * Project every Buff field at the read boundary. This intentionally does not
 * return the source object: old snapshots can contain undefined/partial
 * records, while the Agent must receive explicit nulls and plain JSON values.
 */
function projectBuffFacts(value: JsonObject | null | undefined): JsonObject {
  const buff = value ?? {};
  const target = isRecord(buff.target) ? buff.target : null;
  const multiplier = isRecord(buff.multiplier) ? buff.multiplier : null;
  const derivedValue = isRecord(buff.derivedValue) ? buff.derivedValue : null;
  const extraHitConfig = isRecord(buff.extraHitConfig) ? buff.extraHitConfig : null;
  return {
    schemaVersion: buff.schemaVersion === 2 ? 2 : null,
    id: stringOrNull(buff.id),
    name: stringOrNull(buff.name),
    displayName: stringOrNull(buff.displayName),
    sourceName: stringOrNull(buff.sourceName),
    level: stringOrNull(buff.level),
    type: stringOrNull(buff.type),
    value: numberOrNull(buff.value),
    description: stringOrNull(buff.description),
    source: stringOrNull(buff.source),
    condition: stringOrNull(buff.condition),
    category: stringOrNull(buff.category),
    effectKind: stringOrNull(buff.effectKind),
    ownerBuffDomain: stringOrNull(buff.ownerBuffDomain),
    ownerCharacterId: stringOrNull(buff.ownerCharacterId),
    ownerBuffGroup: stringOrNull(buff.ownerBuffGroup),
    maxStacks: numberOrNull(buff.maxStacks),
    refCount: numberOrNull(buff.refCount),
    multiplier: multiplier
      ? { coefficient: numberOrNull(multiplier.coefficient) }
      : null,
    target: target
      ? {
          mode: stringOrNull(target.mode),
          key: stringOrNull(target.key),
          skillType: stringOrNull(target.skillType),
          element: stringOrNull(target.element),
        }
      : null,
    valueMode: stringOrNull(buff.valueMode),
    derivedValue: derivedValue
      ? {
          source: stringOrNull(derivedValue.source),
          perPointValue: numberOrNull(derivedValue.perPointValue),
        }
      : null,
    extraHitConfig: extraHitConfig
      ? {
          key: stringOrNull(extraHitConfig.key),
          damageType: stringOrNull(extraHitConfig.damageType),
          skillType: stringOrNull(extraHitConfig.skillType),
          baseMultiplier: numberOrNull(extraHitConfig.baseMultiplier),
          imbalanceValue: numberOrNull(extraHitConfig.imbalanceValue),
          cooldownSeconds: numberOrNull(extraHitConfig.cooldownSeconds),
          trigger: stringOrNull(extraHitConfig.trigger),
        }
      : null,
  };
}

function projectResistance(value: JsonValue | undefined): JsonObject {
  const resistance = isRecord(value) ? value : {};
  const keys = new Set([
    'physicalResistance',
    'fireResistance',
    'electricResistance',
    'iceResistance',
    'natureResistance',
    ...Object.keys(resistance),
  ]);
  return Object.fromEntries(
    [...keys]
      .sort(compareText)
      .map((key) => [key, numberOrNull(resistance[key])]),
  );
}

function projectNumberMap(value: JsonValue | undefined): JsonObject {
  const record = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, count]) => [key, numberOrNull(count)]),
  );
}

function projectSegmentNumberMap(value: JsonValue | undefined): JsonObject {
  const record = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => compareText(left, right))
      .map(([segmentKey, counts]) => [segmentKey, projectNumberMap(counts)]),
  );
}

function projectStringMap(value: JsonValue | undefined): JsonObject {
  const record = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, values]) => [key, Array.isArray(values)
        ? values.filter((entry): entry is string => typeof entry === 'string')
        : []]),
  );
}

function projectEffectiveStackCounts(
  button: JsonObject,
  selectedBuffIds: readonly string[],
  selectedBuffs: readonly JsonObject[],
): { counts: JsonObject; sources: JsonObject } {
  const raw = isRecord(button.currentStackCounts)
    ? button.currentStackCounts
    : isRecord(button.buffStackCounts)
      ? button.buffStackCounts
      : {};
  const declaredSources = isRecord(button.currentStackCountSources)
    ? button.currentStackCountSources
    : {};
  const factsById = new Map<string, JsonObject>();
  selectedBuffs.forEach((buff) => {
    const id = stringOrNull(buff.id);
    if (id) factsById.set(id, buff);
  });
  const result: JsonObject = {};
  const sources: JsonObject = {};
  const acceptedSources = new Set([
    'persisted',
    'default-max-stacks',
    'default-one',
    'unavailable',
  ]);
  selectedBuffIds.forEach((buffId) => {
    if (Object.prototype.hasOwnProperty.call(raw, buffId)) {
      result[buffId] = numberOrNull(raw[buffId]);
      const declaredSource = stringOrNull(declaredSources[buffId]);
      sources[buffId] = declaredSource && acceptedSources.has(declaredSource)
        ? declaredSource
        : result[buffId] === null ? 'unavailable' : 'persisted';
      return;
    }
    const buff = factsById.get(buffId);
    const maxStacks = buff
      && buff.category === 'countable'
      && typeof buff.maxStacks === 'number'
      && Number.isFinite(buff.maxStacks)
      && buff.maxStacks > 0
      ? Math.floor(buff.maxStacks)
      : 1;
    result[buffId] = buff ? maxStacks : null;
    sources[buffId] = buff
      ? buff.category === 'countable' ? 'default-max-stacks' : 'default-one'
      : 'unavailable';
  });
  Object.entries(raw).forEach(([buffId, count]) => {
    if (!Object.prototype.hasOwnProperty.call(result, buffId)) {
      result[buffId] = numberOrNull(count);
      const declaredSource = stringOrNull(declaredSources[buffId]);
      sources[buffId] = declaredSource && acceptedSources.has(declaredSource)
        ? declaredSource
        : result[buffId] === null ? 'unavailable' : 'persisted';
    }
  });
  return {
    counts: Object.fromEntries(Object.entries(result).sort(([left], [right]) => compareText(left, right))),
    sources: Object.fromEntries(Object.entries(sources).sort(([left], [right]) => compareText(left, right))),
  };
}

function projectCurrentTimelineButton(button: JsonObject): JsonObject {
  const selectedBuffIds = stringArray(
    button.selectedBuffIds ?? button.selectedBuff ?? [],
    'skillButton.selectedBuffIds',
  );
  const selectedBuffs = optionalObjectArray(button.selectedBuffs, 'skillButton.selectedBuffs')
    .map(projectBuffFacts);
  const stackProjection = projectEffectiveStackCounts(button, selectedBuffIds, selectedBuffs);
  const panelConfig = isRecord(button.panelConfig) ? button.panelConfig : {};
  const targetResistance = button.targetResistance ?? (
    isRecord(button.resistanceConfig) ? button.resistanceConfig.targetResistance : undefined
  );
  return {
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
    selectedBuffIds,
    selectedBuffCount: selectedBuffIds.length,
    selectedBuffs,
    currentStackCounts: stackProjection.counts,
    currentStackCountSources: stackProjection.sources,
    globallyDisabledBuffIds: stringArray(
      panelConfig.globallyDisabledBuffIds ?? button.globallyDisabledBuffIds ?? [],
      'skillButton.globallyDisabledBuffIds',
    ),
    manualDisabledBuffIdsBySegmentKey: projectStringMap(
      panelConfig.manualDisabledBuffIdsBySegmentKey ?? button.manualDisabledBuffIdsBySegmentKey,
    ),
    manualBuffStackCountsBySegmentKey: projectSegmentNumberMap(
      panelConfig.manualBuffStackCountsBySegmentKey ?? button.manualBuffStackCountsBySegmentKey,
    ),
    manualDisabledHitKeys: stringArray(
      panelConfig.manualDisabledHitKeys ?? button.manualDisabledHitKeys ?? [],
      'skillButton.manualDisabledHitKeys',
    ),
    targetResistance: projectResistance(targetResistance),
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
  readonly facts: JsonObject;
  readonly sourceKinds: Set<string>;
  readonly sourceLabels: Set<string>;
  readonly buttonIds: Set<string>;
  readonly characterIds: Set<string>;
  readonly evidence: MutableBuffEvidence[];
  evidenceTruncated: boolean;
};

type MutableBuffEvidence = {
  readonly sourceKind: 'button' | 'equipment' | 'set';
  readonly buttonId: string | null;
  readonly characterId: string;
  readonly sourceName: string | null;
  readonly source: string | null;
  readonly ownerBuffDomain: string | null;
  readonly ownerCharacterId: string | null;
  readonly ownerBuffGroup: string | null;
};

function collectBuff(
  candidates: Map<string, MutableBuffCandidate>,
  input: {
    readonly facts: JsonObject;
    readonly sourceKind: 'button' | 'equipment' | 'set';
    readonly buttonId: string | null;
    readonly characterId: string;
  },
): void {
  const id = stringOrNull(input.facts.id);
  const label = stringOrNull(input.facts.displayName)
    ?? stringOrNull(input.facts.name)
    ?? id
    ?? 'unnamed-buff';
  const type = stringOrNull(input.facts.type);
  const value = numberOrNull(input.facts.value);
  const sourceName = stringOrNull(input.facts.sourceName);
  const source = stringOrNull(input.facts.source);
  // Include every fact in the identity. In particular, same-name Buffs with
  // different source/owner/condition/target are distinct candidates.
  const key = canonicalJson(input.facts);
  const existing = candidates.get(key) ?? {
    key,
    id,
    label,
    type,
    value,
    facts: input.facts,
    sourceKinds: new Set<string>(),
    sourceLabels: new Set<string>(),
    buttonIds: new Set<string>(),
    characterIds: new Set<string>(),
    evidence: [],
    evidenceTruncated: false,
  };
  existing.sourceKinds.add(input.sourceKind);
  if (sourceName) existing.sourceLabels.add(sourceName);
  if (source) existing.sourceLabels.add(source);
  if (input.buttonId) existing.buttonIds.add(input.buttonId);
  existing.characterIds.add(input.characterId);
  const evidence: MutableBuffEvidence = {
    sourceKind: input.sourceKind,
    buttonId: input.buttonId,
    characterId: input.characterId,
    sourceName,
    source,
    ownerBuffDomain: stringOrNull(input.facts.ownerBuffDomain),
    ownerCharacterId: stringOrNull(input.facts.ownerCharacterId),
    ownerBuffGroup: stringOrNull(input.facts.ownerBuffGroup),
  };
  const evidenceKey = canonicalJson(evidence as unknown as JsonObject);
  if (!existing.evidence.some((entry) => canonicalJson(entry as unknown as JsonObject) === evidenceKey)) {
    if (existing.evidence.length < MAX_BUFF_EVIDENCE_PER_CANDIDATE) {
      existing.evidence.push(evidence);
    } else {
      existing.evidenceTruncated = true;
    }
  }
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

function requiredInputString(
  value: JsonValue | undefined,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new DefToolExecutionError(
      'DEF_TOOL_INPUT_INVALID',
      `${field} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return trimmed;
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
