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
        (input) => directMutationPlan('添加技能按钮', 'timeline.buttons', 'addSkillButton', input),
      ),
      handler(
        descriptor(
          'def.workbench.remove_skill_button',
          'Remove one unambiguously identified skill button after explicit user approval.',
          'mutate',
          objectSchema({
            properties: {
              buttonId: boundedStringSchema(1, 200),
              characterId: boundedStringSchema(1, 160),
              characterName: boundedStringSchema(1, 160),
              skillType: { enum: ['A', 'B', 'E', 'Q', 'Dot'] },
              nodeIndex: boundedIntegerSchema(0, 10_000),
              latest: { type: 'boolean' },
            },
            anyOf: [
              { required: ['buttonId'] },
              { required: ['characterId'] },
              { required: ['characterName'] },
            ],
          }),
        ),
        (input) => directMutationPlan('移除技能按钮', 'timeline.buttons', 'removeSkillButton', input),
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
        (input) => directMutationPlan('添加 Buff', 'timeline.buffs', 'addBuff', input),
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
            ],
          }),
        ),
        (input) => directMutationPlan('移除 Buff', 'timeline.buffs', 'removeBuff', input),
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
        (input) => directMutationPlan('设置目标抗性', 'timeline.resistance', 'setTargetResistance', input),
      ),
      handler(
        descriptor(
          'def.worknode.patch_and_checkout',
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

async function prepareDamageCalculation(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['buttonId']);
  const buttonId = optionalString(value.buttonId, 'buttonId', 200);
  return {
    kind: 'command',
    command: { op: 'calculateDamage', ...(buttonId ? { buttonId } : {}) },
    visiblePostcondition: { damageReportStatus: 'ready' },
  };
}

async function directMutationPlan(
  prompt: string,
  scope: string,
  operation: string,
  input: JsonValue,
): Promise<DefInteractiveToolPlan> {
  const value = unrestrictedObject(input, operation);
  return mutationPlan(prompt, [scope], { op: operation, ...value });
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
