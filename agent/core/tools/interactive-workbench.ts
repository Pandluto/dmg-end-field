import {
  DefToolExecutionError,
  type DefInteractiveToolHandler,
  type DefInteractiveToolPlan,
  type DefToolDescriptor,
  type DefToolExecutionContext,
  type DefWorkbenchToolRegistry,
  type JsonObject,
  type JsonValue,
} from '../contracts/index.ts';
import { DefReadToolRegistry } from './read-only-workbench.ts';

const MAX_ARRAY_ITEMS = 64;
const MAX_TEXT_LENGTH = 2_000;
const BUFF_INPUT_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'displayName', 'sourceName'],
  properties: {
    schemaVersion: { const: 2 },
    id: boundedStringSchema(1, 200),
    name: boundedStringSchema(1, 200),
    displayName: boundedStringSchema(1, 200),
    sourceName: boundedStringSchema(1, 200),
    level: boundedStringSchema(1, 120),
    type: boundedStringSchema(1, 200),
    value: { type: 'number', minimum: -1e12, maximum: 1e12 },
    description: boundedStringSchema(1, 2_000),
    source: boundedStringSchema(1, 200),
    condition: boundedStringSchema(1, 1_000),
    category: { enum: ['condition', 'countable', 'passive'] },
    ownerBuffDomain: { enum: ['operator', 'weapon', 'equipment'] },
    ownerCharacterId: boundedStringSchema(1, 200),
    ownerBuffGroup: { enum: ['talent', 'potential', 'skill', 'weaponSkill', 'threePiece'] },
    maxStacks: boundedIntegerSchema(1, 10_000),
    multiplier: {
      type: 'object',
      additionalProperties: false,
      required: ['coefficient'],
      properties: { coefficient: { type: 'number', minimum: -1e6, maximum: 1e6 } },
    },
    refCount: boundedIntegerSchema(0, 1_000_000),
    target: {
      oneOf: [
        exactSchema(['mode'], { mode: { const: 'all' } }),
        exactSchema(['mode', 'key'], {
          mode: { const: 'damageKey' },
          key: boundedStringSchema(1, 200),
        }),
        exactSchema(['mode', 'skillType'], {
          mode: { const: 'skillType' },
          skillType: { enum: ['A', 'B', 'E', 'Q', 'Dot'] },
        }),
        exactSchema(['mode', 'element'], {
          mode: { const: 'element' },
          element: { enum: ['physical', 'fire', 'ice', 'electric', 'nature'] },
        }),
      ],
    },
    effectKind: { enum: ['modifier', 'extraHit'] },
    extraHitConfig: exactSchema(
      ['key', 'damageType', 'skillType', 'baseMultiplier', 'imbalanceValue', 'cooldownSeconds', 'trigger'],
      {
        key: boundedStringSchema(1, 200),
        damageType: { enum: ['physical', 'magic', 'fire', 'electric', 'ice', 'nature'] },
        skillType: { enum: ['', 'A', 'B', 'E', 'Q', 'Dot'] },
        baseMultiplier: { type: 'number', minimum: 0, maximum: 1e6 },
        imbalanceValue: { type: 'number', minimum: 0, maximum: 1e9 },
        cooldownSeconds: { type: 'number', minimum: 0, maximum: 1e9 },
        trigger: { const: 'physicalAbnormal' },
      },
    ),
    valueMode: { enum: ['fixed', 'derived'] },
    derivedValue: exactSchema(['source', 'perPointValue'], {
      source: { enum: ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'] },
      perPointValue: { type: 'number', minimum: -1e6, maximum: 1e6 },
    }),
  },
};

export class DefProductToolRegistry implements DefWorkbenchToolRegistry {
  readonly #read = new DefReadToolRegistry();
  readonly #interactive: ReadonlyMap<string, DefInteractiveToolHandler>;

  constructor() {
    const handlers: readonly DefInteractiveToolHandler[] = [
      handler(
        descriptor(
          'def.user.ask',
          'Ask the user one explicit question and wait for the answer in the DEF AI panel.',
          'propose',
          objectSchema({
            required: ['prompt'],
            properties: {
              prompt: boundedStringSchema(1, 1_000),
              options: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: boundedStringSchema(1, 200),
              },
            },
          }),
        ),
        prepareQuestion,
      ),
      handler(
        descriptor(
          'def.team.selection.apply',
          'Replace the selected roster with one exact one-to-four operator roster after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['nodeTitle', 'nodeDescription'],
            properties: {
              characterIds: stringArraySchema(1, 4, 160),
              characterNames: stringArraySchema(1, 4, 160),
              nodeTitle: boundedStringSchema(1, 80),
              nodeDescription: boundedStringSchema(1, 400),
              openCanvas: { type: 'boolean' },
            },
            anyOf: [{ required: ['characterIds'] }, { required: ['characterNames'] }],
          }),
        ),
        prepareSelectionApply,
      ),
      handler(
        descriptor(
          'def.workbench.add_skill_button',
          'Add one exact skill button to the current timeline after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['characterName'],
            properties: {
              buttonId: boundedStringSchema(1, 200),
              characterId: boundedStringSchema(1, 160),
              characterName: boundedStringSchema(1, 160),
              skillType: { enum: ['A', 'B', 'E', 'Q', 'Dot'] },
              runtimeSkillId: boundedStringSchema(1, 200),
              skillDisplayName: boundedStringSchema(1, 200),
              staffIndex: boundedIntegerSchema(0, 100),
              nodeIndex: boundedIntegerSchema(0, 10_000),
              select: { type: 'boolean' },
            },
          }),
        ),
        prepareTimelineButtonAddition,
      ),
      handler(
        descriptor(
          'def.workbench.remove_skill_button',
          'Remove one exact current skill button, or a complete stable button-id set through one validated Work Node, after explicit user approval.',
          'mutate',
          objectSchema({
            properties: {
              buttonIds: stringArraySchema(1, MAX_ARRAY_ITEMS, 200),
              buttonId: boundedStringSchema(1, 200),
              characterId: boundedStringSchema(1, 160),
              characterName: boundedStringSchema(1, 160),
              skillType: { enum: ['A', 'B', 'E', 'Q', 'Dot'] },
              nodeIndex: boundedIntegerSchema(0, 10_000),
              latest: { type: 'boolean' },
              label: boundedStringSchema(1, 120),
              description: boundedStringSchema(1, 500),
            },
            anyOf: [
              { required: ['buttonIds'] },
              { required: ['buttonId'] },
              { required: ['characterId'] },
              { required: ['characterName'] },
            ],
          }),
        ),
        prepareTimelineButtonRemoval,
      ),
      handler(
        descriptor(
          'def.buff.add_to_button',
          'Attach one complete Buff object to one exact skill button after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['buttonId', 'buff'],
            properties: {
              buttonId: boundedStringSchema(1, 200),
              buff: BUFF_INPUT_SCHEMA,
              select: { type: 'boolean' },
            },
          }),
        ),
        prepareBuffAddition,
      ),
      handler(
        descriptor(
          'def.buff.remove_from_button',
          'Remove one unambiguously identified Buff from one skill button after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['buttonId'],
            properties: {
              buttonId: boundedStringSchema(1, 200),
              buffId: boundedStringSchema(1, 200),
              name: boundedStringSchema(1, 200),
              displayName: boundedStringSchema(1, 200),
              latest: { type: 'boolean' },
              count: boundedIntegerSchema(1, 100),
              all: { type: 'boolean' },
            },
            anyOf: [
              { required: ['buffId'] },
              { required: ['name'] },
              { required: ['displayName'] },
              { required: ['latest'] },
              { required: ['all'] },
            ],
          }),
        ),
        prepareBuffRemoval,
      ),
      handler(
        descriptor(
          'def.target.set_resistance',
          'Set the target resistance map for one exact button after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['buttonId', 'targetResistance'],
            properties: {
              buttonId: boundedStringSchema(1, 200),
              targetResistance: {
                type: 'object',
                minProperties: 1,
                additionalProperties: false,
                properties: {
                  physicalResistance: { type: 'number', minimum: -10_000, maximum: 10_000 },
                  fireResistance: { type: 'number', minimum: -10_000, maximum: 10_000 },
                  electricResistance: { type: 'number', minimum: -10_000, maximum: 10_000 },
                  iceResistance: { type: 'number', minimum: -10_000, maximum: 10_000 },
                  natureResistance: { type: 'number', minimum: -10_000, maximum: 10_000 },
                },
              },
            },
          }),
        ),
        prepareTargetResistance,
      ),
      handler(
        descriptor(
          'def.worknode.patch_and_validate',
          'Apply a constrained timeline patch through a temporary Work Node, validate it, and checkout only after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['patch'],
            properties: {
              patch: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_ARRAY_ITEMS,
                items: { type: 'object', additionalProperties: true },
              },
              label: boundedStringSchema(1, 120),
              description: boundedStringSchema(1, 500),
            },
          }),
        ),
        prepareWorkNodePatch,
      ),
      handler(
        descriptor(
          'def.damage.calculate_and_verify',
          'Trigger the product damage calculation and return its browser-generated result.',
          'propose',
          objectSchema({
            properties: { buttonId: boundedStringSchema(1, 200) },
          }),
        ),
        prepareDamageCalculation,
      ),
    ];
    this.#interactive = new Map(handlers.map((entry) => [entry.descriptor.name, entry]));
  }

  listDescriptors(): readonly DefToolDescriptor[] {
    return [
      ...this.#read.listDescriptors(),
      ...[...this.#interactive.values()].map((entry) => cloneDescriptor(entry.descriptor)),
    ];
  }

  resolveDescriptor(name: string): DefToolDescriptor | null {
    const read = this.#read.resolveDescriptor(name);
    if (read) return read;
    const interactive = this.#interactive.get(name)?.descriptor;
    return interactive ? cloneDescriptor(interactive) : null;
  }

  executeRead(
    name: string,
    input: JsonValue,
    context: DefToolExecutionContext,
  ): Promise<JsonValue> {
    return this.#read.execute(name, input, context);
  }

  async prepareInteractive(
    name: string,
    input: JsonValue,
    context: DefToolExecutionContext,
  ): Promise<DefInteractiveToolPlan> {
    const entry = this.#interactive.get(name);
    if (!entry) {
      throw new DefToolExecutionError('DEF_TOOL_UNSUPPORTED', `Unsupported DEF interactive Tool: ${name}`);
    }
    assertNotAborted(context);
    const plan = await entry.prepare(cloneJson(input), context);
    assertNotAborted(context);
    return cloneJson(plan as unknown as JsonValue) as unknown as DefInteractiveToolPlan;
  }
}

function handler(
  toolDescriptor: DefToolDescriptor,
  prepare: DefInteractiveToolHandler['prepare'],
): DefInteractiveToolHandler {
  return { descriptor: toolDescriptor, prepare };
}

function descriptor(
  name: string,
  description: string,
  risk: DefToolDescriptor['risk'],
  inputSchema: JsonObject,
): DefToolDescriptor {
  return { name, description, risk, inputSchema };
}

function objectSchema(input: {
  readonly required?: readonly string[];
  readonly properties: JsonObject;
  readonly anyOf?: readonly JsonObject[];
}): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    ...(input.required ? { required: [...input.required] } : {}),
    ...(input.anyOf ? { anyOf: input.anyOf.map((entry) => cloneJson(entry)) } : {}),
    properties: cloneJson(input.properties),
  };
}

function exactSchema(required: readonly string[], properties: JsonObject): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...required],
    properties: cloneJson(properties),
  };
}

function boundedStringSchema(minLength: number, maxLength: number): JsonObject {
  return { type: 'string', minLength, maxLength };
}

function boundedIntegerSchema(minimum: number, maximum: number): JsonObject {
  return { type: 'integer', minimum, maximum };
}

function stringArraySchema(minItems: number, maxItems: number, maxLength: number): JsonObject {
  return {
    type: 'array',
    minItems,
    maxItems,
    uniqueItems: true,
    items: boundedStringSchema(1, maxLength),
  };
}

async function prepareQuestion(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['prompt', 'options']);
  const prompt = requiredString(value.prompt, 'prompt', 1_000);
  const options = value.options === undefined
    ? undefined
    : stringArray(value.options, 'options', 8, 200);
  return {
    kind: 'question',
    prompt,
    ...(options ? { details: { options } } : {}),
  };
}

async function prepareSelectionApply(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, [
    'characterIds',
    'characterNames',
    'nodeTitle',
    'nodeDescription',
    'openCanvas',
  ]);
  const characterIds = optionalStringArray(value.characterIds, 'characterIds', 4, 160);
  const characterNames = optionalStringArray(value.characterNames, 'characterNames', 4, 160);
  if (!characterIds?.length && !characterNames?.length) {
    invalid('selection requires characterIds or characterNames');
  }
  const nodeTitle = requiredString(value.nodeTitle, 'nodeTitle', 80);
  if (/^\[ai\]/iu.test(nodeTitle)) {
    invalid('nodeTitle must describe the change and must not use the [ai] fixed prefix');
  }
  const nodeDescription = requiredString(value.nodeDescription, 'nodeDescription', 400);
  const command: JsonObject = {
    op: 'selectCharacters',
    ...(characterIds ? { characterIds } : {}),
    ...(characterNames ? { characterNames } : {}),
    nodeTitle,
    nodeDescription,
    ...(value.openCanvas === undefined ? {} : { openCanvas: requiredBoolean(value.openCanvas, 'openCanvas') }),
    approval: {
      mode: 'manual',
      approvedBy: 'user',
      rationale: 'Approved in the embedded DEF AI mode.',
    },
  };
  return mutationPlan('应用新的干员队伍', ['selection.roster'], command);
}

async function prepareWorkNodePatch(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['patch', 'label', 'description']);
  const patch = objectArray(value.patch, 'patch', MAX_ARRAY_ITEMS);
  if (!patch.length) invalid('patch must contain at least one operation');
  const command: JsonObject = {
    op: 'applyApprovedWorkNodePatch',
    patch,
    ...(optionalString(value.label, 'label', 120) ? { label: value.label as string } : {}),
    ...(optionalString(value.description, 'description', 500)
      ? { description: value.description as string }
      : {}),
  };
  return mutationPlan('应用并检出排轴修改', ['timeline.work-node', 'timeline.checkout'], command);
}

async function prepareTimelineButtonAddition(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, [
    'buttonId', 'characterId', 'characterName', 'skillType', 'runtimeSkillId', 'skillDisplayName',
    'staffIndex', 'nodeIndex', 'select',
  ]);
  const characterName = requiredString(value.characterName, 'characterName', 160);
  const patch: JsonObject = {
    op: 'addButton',
    characterName,
    ...(optionalString(value.buttonId, 'buttonId', 200) ? { buttonId: value.buttonId as string } : {}),
    ...(optionalString(value.characterId, 'characterId', 160) ? { characterId: value.characterId as string } : {}),
    ...(optionalString(value.skillType, 'skillType', 8) ? { skillType: value.skillType as string } : {}),
    ...(optionalString(value.runtimeSkillId, 'runtimeSkillId', 200) ? { runtimeSkillId: value.runtimeSkillId as string } : {}),
    ...(optionalString(value.skillDisplayName, 'skillDisplayName', 200) ? { skillDisplayName: value.skillDisplayName as string } : {}),
    ...(value.staffIndex === undefined ? {} : { staffIndex: requiredInteger(value.staffIndex, 'staffIndex', 0, 100) }),
    ...(value.nodeIndex === undefined ? {} : { nodeIndex: requiredInteger(value.nodeIndex, 'nodeIndex', 0, 10_000) }),
  };
  return workNodeMutationPlan(
    '添加技能按钮',
    ['timeline.buttons', 'timeline.work-node', 'timeline.checkout'],
    [patch],
    `添加 ${characterName} 技能按钮`,
    `在隔离工作节点中添加 ${characterName} 的技能按钮，校验语义变更后检出。`,
  );
}

async function prepareBuffAddition(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['buttonId', 'buff', 'select']);
  const buttonId = requiredString(value.buttonId, 'buttonId', 200);
  const buff = unrestrictedObject(value.buff, 'buff');
  const displayName = optionalString(buff.displayName, 'buff.displayName', 200)
    ?? requiredString(buff.name, 'buff.name', 200);
  return workNodeMutationPlan(
    '添加 Buff',
    ['timeline.buffs', 'timeline.work-node', 'timeline.checkout'],
    [{
      op: 'attachBuff',
      target: { buttonId },
      ...(optionalString(buff.id, 'buff.id', 200) ? { buffId: buff.id as string } : {}),
      buff,
    }],
    `添加 Buff：${displayName}`,
    `在隔离工作节点中向按钮 ${buttonId} 添加 ${displayName}，校验后检出。`,
  );
}

async function prepareBuffRemoval(
  input: JsonValue,
  context: DefToolExecutionContext,
): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, [
    'buttonId', 'buffId', 'name', 'displayName', 'latest', 'count', 'all',
  ]);
  const buttonId = requiredString(value.buttonId, 'buttonId', 200);
  const snapshot = await context.product.getSnapshot(context.binding);
  const payload = unrestrictedObject(snapshot.payload, 'Product snapshot payload');
  const buttons = Array.isArray(payload.skillButtons) ? payload.skillButtons : [];
  const button = buttons
    .map((entry, index) => unrestrictedObject(entry, `skillButtons[${index}]`))
    .find((entry) => entry.id === buttonId);
  if (!button) invalid(`buttonId is not present in the bound snapshot: ${buttonId}`);
  const selectedBuffIds = Array.isArray(button.selectedBuffIds)
    ? button.selectedBuffIds.map((entry, index) => requiredString(entry, `selectedBuffIds[${index}]`, 200))
    : [];
  const selectedBuffs = Array.isArray(button.selectedBuffs)
    ? button.selectedBuffs.map((entry, index) => unrestrictedObject(entry, `selectedBuffs[${index}]`))
    : [];
  let buffIds: string[];
  if (value.all === true) {
    buffIds = [...selectedBuffIds];
  } else if (value.buffId !== undefined) {
    const buffId = requiredString(value.buffId, 'buffId', 200);
    buffIds = selectedBuffIds.includes(buffId) ? [buffId] : [];
  } else {
    const query = optionalString(value.displayName, 'displayName', 200)
      ?? optionalString(value.name, 'name', 200);
    if (!query) invalid('Buff removal requires buffId, name, displayName, or all:true');
    buffIds = selectedBuffs
      .filter((buff) => buff.id && [buff.displayName, buff.name].includes(query))
      .map((buff) => requiredString(buff.id, 'selectedBuff.id', 200));
    if (buffIds.length > 1 && value.latest !== true) {
      invalid(`Buff query matched ${buffIds.length} entries; provide buffId or latest:true`);
    }
    if (value.latest === true && buffIds.length > 1) buffIds = [buffIds[buffIds.length - 1]!];
  }
  if (!buffIds.length) invalid('No selected Buff matched the requested removal');
  const count = value.count === undefined
    ? undefined
    : requiredInteger(value.count, 'count', 1, 100);
  return workNodeMutationPlan(
    buffIds.length === 1 ? '移除 Buff' : `移除 ${buffIds.length} 个 Buff`,
    ['timeline.buffs', 'timeline.work-node', 'timeline.checkout'],
    buffIds.map((buffId) => ({
      op: 'removeBuff',
      target: { buttonId },
      buffId,
      ...(count === undefined || buffIds.length > 1 ? {} : { count }),
    })),
    buffIds.length === 1 ? '移除 Buff' : `批量移除 ${buffIds.length} 个 Buff`,
    `在隔离工作节点中从按钮 ${buttonId} 移除已确认的 Buff，校验后检出。`,
  );
}

async function prepareTargetResistance(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['buttonId', 'targetResistance']);
  const buttonId = requiredString(value.buttonId, 'buttonId', 200);
  const targetResistance = unrestrictedObject(value.targetResistance, 'targetResistance');
  return workNodeMutationPlan(
    '设置目标抗性',
    ['timeline.resistance', 'timeline.work-node', 'timeline.checkout'],
    [{ op: 'setTargetResistance', target: { buttonId }, targetResistance }],
    '设置目标抗性',
    `在隔离工作节点中修改按钮 ${buttonId} 的目标抗性，校验后检出。`,
  );
}

async function prepareTimelineButtonRemoval(
  input: JsonValue,
  context: DefToolExecutionContext,
): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, [
    'buttonIds', 'buttonId', 'characterId', 'characterName', 'skillType', 'nodeIndex', 'latest',
    'label', 'description',
  ]);
  if (value.buttonIds === undefined) {
    if (!value.buttonId && !value.characterId && !value.characterName) {
      invalid('skill-button removal requires one exact target or buttonIds');
    }
    const target: JsonObject = {
      ...(optionalString(value.buttonId, 'buttonId', 200) ? { buttonId: value.buttonId as string } : {}),
      ...(optionalString(value.characterId, 'characterId', 160) ? { characterId: value.characterId as string } : {}),
      ...(optionalString(value.characterName, 'characterName', 160) ? { characterName: value.characterName as string } : {}),
      ...(optionalString(value.skillType, 'skillType', 8) ? { skillType: value.skillType as string } : {}),
      ...(value.nodeIndex === undefined ? {} : { nodeIndex: requiredInteger(value.nodeIndex, 'nodeIndex', 0, 10_000) }),
      ...(value.latest === undefined ? {} : { latest: requiredBoolean(value.latest, 'latest') }),
    };
    return workNodeMutationPlan(
      '移除 1 个技能按钮',
      ['timeline.buttons', 'timeline.work-node', 'timeline.checkout'],
      [{ op: 'removeButton', target }],
      optionalString(value.label, 'label', 120) ?? '移除技能按钮',
      optionalString(value.description, 'description', 500)
        ?? '在隔离工作节点中移除已确认的技能按钮，校验后检出。',
    );
  }
  if (
    value.buttonId !== undefined
    || value.characterId !== undefined
    || value.characterName !== undefined
    || value.skillType !== undefined
    || value.nodeIndex !== undefined
    || value.latest !== undefined
  ) {
    invalid('buttonIds cannot be combined with a single-button target');
  }
  const buttonIds = stringArray(value.buttonIds, 'buttonIds', MAX_ARRAY_ITEMS, 200);
  const snapshot = await context.product.getSnapshot(context.binding);
  const payload = unrestrictedObject(snapshot.payload, 'Product snapshot payload');
  const currentButtons = Array.isArray(payload.skillButtons) ? payload.skillButtons : null;
  if (!currentButtons) invalid('Product snapshot has no current skill-button list');
  const currentIds = new Set(currentButtons.map((button, index) => (
    requiredString(unrestrictedObject(button, `skillButtons[${index}]`).id, `skillButtons[${index}].id`, 200)
  )));
  const missing = buttonIds.filter((buttonId) => !currentIds.has(buttonId));
  if (missing.length) invalid(`buttonIds are not present in the bound snapshot: ${missing.join(', ')}`);
  const label = optionalString(value.label, 'label', 120) ?? `移除 ${buttonIds.length} 个技能按钮`;
  const description = optionalString(value.description, 'description', 500)
    ?? `从当前排轴移除 ${buttonIds.length} 个已确认的技能按钮，并由工作节点验证变更。`;
  return workNodeMutationPlan(
    buttonIds.length === 1 ? '移除 1 个技能按钮' : `批量移除 ${buttonIds.length} 个技能按钮`,
    ['timeline.buttons', 'timeline.work-node', 'timeline.checkout'],
    buttonIds.map((buttonId) => ({ op: 'removeButton', target: { buttonId } })),
    label,
    description,
  );
}

async function prepareDamageCalculation(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['buttonId']);
  const buttonId = optionalString(value.buttonId, 'buttonId', 200);
  return {
    kind: 'command',
    command: { op: 'calculateDamage', ...(buttonId ? { buttonId } : {}) },
    visiblePostcondition: { damageReportStatus: 'ready' },
  };
}

function workNodeMutationPlan(
  prompt: string,
  scope: readonly string[],
  patch: readonly JsonObject[],
  label: string,
  description: string,
): DefInteractiveToolPlan {
  return mutationPlan(prompt, scope, {
    op: 'applyApprovedWorkNodePatch',
    patch: [...patch],
    label,
    description,
  });
}

function mutationPlan(
  prompt: string,
  scope: readonly string[],
  command: JsonObject,
): Extract<DefInteractiveToolPlan, { kind: 'mutation' }> {
  return {
    kind: 'mutation',
    prompt,
    proposal: { command: cloneJson(command), scope: [...scope] },
    scope: [...scope],
    command: cloneJson(command),
  };
}

function exactObject(value: JsonValue, allowed: readonly string[]): JsonObject {
  const object = unrestrictedObject(value, 'input');
  const extras = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extras.length) invalid(`unexpected fields: ${extras.join(', ')}`);
  return object;
}

function unrestrictedObject(value: JsonValue, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  const object = cloneJson(value) as JsonObject;
  if (JSON.stringify(object).length > 200_000) invalid(`${label} is too large`);
  return object;
}

function objectArray(value: JsonValue | undefined, label: string, maximum: number): JsonObject[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(`${label} must be a bounded array`);
  return value.map((entry, index) => unrestrictedObject(entry, `${label}[${index}]`));
}

function requiredString(value: JsonValue | undefined, label: string, maximum = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    invalid(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function optionalString(
  value: JsonValue | undefined,
  label: string,
  maximum = MAX_TEXT_LENGTH,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label, maximum);
}

function requiredBoolean(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} must be boolean`);
  return value;
}

function requiredInteger(
  value: JsonValue | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function stringArray(
  value: JsonValue | undefined,
  label: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
    invalid(`${label} must contain between 1 and ${maximumItems} strings`);
  }
  const result = value.map((entry, index) => requiredString(entry, `${label}[${index}]`, maximumLength));
  if (new Set(result).size !== result.length) invalid(`${label} must not contain duplicates`);
  return result;
}

function optionalStringArray(
  value: JsonValue | undefined,
  label: string,
  maximumItems: number,
  maximumLength: number,
): string[] | undefined {
  return value === undefined ? undefined : stringArray(value, label, maximumItems, maximumLength);
}

function assertNotAborted(context: DefToolExecutionContext): void {
  if (context.abortSignal.aborted) {
    throw new DefToolExecutionError('DEF_TOOL_ABORTED', 'DEF interactive Tool was aborted');
  }
}

function invalid(message: string): never {
  throw new DefToolExecutionError('DEF_TOOL_INPUT_INVALID', message);
}

function cloneDescriptor(value: DefToolDescriptor): DefToolDescriptor {
  return cloneJson(value as unknown as JsonValue) as unknown as DefToolDescriptor;
}

function cloneJson<Value extends JsonValue>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
