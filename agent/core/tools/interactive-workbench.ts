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

const SKILL_TYPE_SCHEMA: JsonObject = { enum: ['A', 'B', 'E', 'Q', 'Dot'] };
const PATCH_TARGET_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    buttonId: boundedStringSchema(1, 200),
    characterId: boundedStringSchema(1, 160),
    characterName: boundedStringSchema(1, 160),
    skillType: SKILL_TYPE_SCHEMA,
    nodeIndex: boundedIntegerSchema(0, 10_000),
    latest: { type: 'boolean' },
  },
  anyOf: [
    { required: ['buttonId'] },
    { required: ['characterId'] },
    { required: ['characterName'] },
  ],
};
const TARGET_RESISTANCE_SCHEMA: JsonObject = {
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
};
const TIMELINE_PATCH_OPERATION_SCHEMA: JsonObject = {
  oneOf: [
    exactSchema(['op', 'characterName'], {
      op: { const: 'addButton' },
      buttonId: boundedStringSchema(1, 200),
      characterId: boundedStringSchema(1, 160),
      characterName: boundedStringSchema(1, 160),
      skillType: SKILL_TYPE_SCHEMA,
      runtimeSkillId: boundedStringSchema(1, 200),
      skillDisplayName: boundedStringSchema(1, 200),
      staffIndex: boundedIntegerSchema(0, 100),
      lineIndex: boundedIntegerSchema(0, 100),
      nodeIndex: boundedIntegerSchema(0, 10_000),
    }),
    exactSchema(['op', 'sourceStaffIndex', 'targetStaffIndex'], {
      op: { const: 'copyStaffLine' },
      sourceStaffIndex: boundedIntegerSchema(0, 100),
      targetStaffIndex: boundedIntegerSchema(0, 100),
      preserveCharacterIdentity: { type: 'boolean' },
      replaceTarget: { type: 'boolean' },
    }),
    exactSchema(['op', 'target'], { op: { const: 'removeButton' }, target: PATCH_TARGET_SCHEMA }),
    exactSchema(['op', 'target', 'nodeIndex'], {
      op: { const: 'moveButton' },
      target: PATCH_TARGET_SCHEMA,
      staffIndex: boundedIntegerSchema(0, 100),
      nodeIndex: boundedIntegerSchema(0, 10_000),
    }),
    exactSchema(['op', 'target', 'nodeIndex'], {
      op: { const: 'copyButton' },
      target: PATCH_TARGET_SCHEMA,
      buttonId: boundedStringSchema(1, 200),
      staffIndex: boundedIntegerSchema(0, 100),
      nodeIndex: boundedIntegerSchema(0, 10_000),
      rebindCharacter: { type: 'boolean' },
    }),
    {
      ...exactSchema(['op', 'target'], {
        op: { const: 'replaceButton' },
        target: PATCH_TARGET_SCHEMA,
        skillType: SKILL_TYPE_SCHEMA,
        runtimeSkillId: boundedStringSchema(1, 200),
        skillDisplayName: boundedStringSchema(1, 200),
        skillIconUrl: boundedStringSchema(1, 2_000),
      }),
      anyOf: [
        { required: ['skillType'] },
        { required: ['runtimeSkillId'] },
        { required: ['skillDisplayName'] },
        { required: ['skillIconUrl'] },
      ],
    },
    {
      ...exactSchema(['op', 'target'], {
        op: { const: 'attachBuff' },
        target: PATCH_TARGET_SCHEMA,
        buffId: boundedStringSchema(1, 200),
        buff: BUFF_INPUT_SCHEMA,
        stackCount: boundedIntegerSchema(0, 10_000),
      }),
      anyOf: [{ required: ['buffId'] }, { required: ['buff'] }],
    },
    exactSchema(['op', 'target', 'buffId'], {
      op: { const: 'removeBuff' },
      target: PATCH_TARGET_SCHEMA,
      buffId: boundedStringSchema(1, 200),
      count: boundedIntegerSchema(1, 10_000),
    }),
    exactSchema(['op', 'target', 'buffId', 'stackCount'], {
      op: { const: 'setBuffStack' },
      target: PATCH_TARGET_SCHEMA,
      buffId: boundedStringSchema(1, 200),
      stackCount: boundedIntegerSchema(0, 10_000),
    }),
    exactSchema(['op', 'target', 'targetResistance'], {
      op: { const: 'setTargetResistance' },
      target: PATCH_TARGET_SCHEMA,
      targetResistance: TARGET_RESISTANCE_SCHEMA,
    }),
    exactSchema(['op'], { op: { const: 'clearTimeline' } }),
  ],
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
          'def.data.catalog.query',
          'Query bounded 1.8 browser-owned operator, skill, weapon, equipment, gear-set, compatibility, 3+1, or evidence-availability facts.',
          'propose',
          objectSchema({
            required: ['action'],
            properties: {
              action: { enum: ['query', 'compatibleWeapons', 'gearTopologyFacts', 'gearTopologyPlan', 'buildGuide'] },
              domain: { enum: ['operators', 'skills', 'weapons', 'equipment', 'gearSets'] },
              query: boundedStringSchema(1, 200),
              operatorQuery: boundedStringSchema(1, 200),
              setQuery: boundedStringSchema(1, 200),
              limit: boundedIntegerSchema(1, 256),
              allowDuplicateCompatibleAccessories: { type: 'boolean' },
            },
          }),
        ),
        prepareProductCatalogQuery,
      ),
      handler(
        descriptor(
          'def.worknode.list',
          'List browser SQLite Work Nodes and lifecycle state without changing checkout.',
          'propose',
          objectSchema({ properties: { timelineId: boundedStringSchema(1, 200) } }),
        ),
        prepareWorkNodeList,
      ),
      handler(
        descriptor(
          'def.worknode.read',
          'Read one exact browser SQLite Work Node without hydrating it into Canvas.',
          'propose',
          objectSchema({
            required: ['nodeId'],
            properties: {
              nodeId: boundedStringSchema(1, 200),
              includePayload: { type: 'boolean' },
            },
          }),
        ),
        prepareWorkNodeRead,
      ),
      handler(
        descriptor(
          'def.worknode.diff',
          'Read the semantic diff for one exact browser SQLite Work Node.',
          'propose',
          objectSchema({
            required: ['nodeId'],
            properties: { nodeId: boundedStringSchema(1, 200) },
          }),
        ),
        prepareWorkNodeDiff,
      ),
      handler(
        descriptor(
          'def.worknode.validate',
          'Validate one exact browser SQLite Work Node without repairing or changing its lifecycle state.',
          'propose',
          objectSchema({
            required: ['nodeId'],
            properties: { nodeId: boundedStringSchema(1, 200) },
          }),
        ),
        prepareWorkNodeValidation,
      ),
      handler(
        descriptor(
          'def.worknode.delete',
          'Delete one non-checked-out Work Node subtree after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['nodeId'],
            properties: { nodeId: boundedStringSchema(1, 200) },
          }),
        ),
        prepareWorkNodeDeletion,
      ),
      handler(
        descriptor(
          'def.worknode.use',
          'Checkout one exact validated Work Node after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['nodeId'],
            properties: {
              nodeId: boundedStringSchema(1, 200),
              commitId: boundedStringSchema(1, 200),
            },
          }),
        ),
        prepareWorkNodeUse,
      ),
      handler(
        descriptor(
          'def.worknode.restore',
          'Restore the exact base payload of one Work Node after explicit user approval.',
          'mutate',
          objectSchema({
            required: ['nodeId'],
            properties: { nodeId: boundedStringSchema(1, 200) },
          }),
        ),
        prepareWorkNodeRestore,
      ),
      handler(
        descriptor(
          'def.loadout.preview',
          'Create a read-only exact operator-configuration preview and isolated browser Work Node; no live checkout is changed.',
          'propose',
          operatorConfigPreviewSchema(),
        ),
        prepareLoadoutPreview,
      ),
      handler(
        descriptor(
          'def.loadout.apply_prepared',
          'Apply one unchanged prepared operator-configuration Work Node after explicit user approval and exact revision checks.',
          'mutate',
          objectSchema({
            required: ['parentNodeId', 'parentRevision', 'nodeId', 'nodeRevision', 'proposalDigest', 'finalConfig'],
            properties: {
              parentNodeId: boundedStringSchema(1, 200),
              parentRevision: boundedIntegerSchema(0, Number.MAX_SAFE_INTEGER),
              nodeId: boundedStringSchema(1, 200),
              nodeRevision: boundedIntegerSchema(0, Number.MAX_SAFE_INTEGER),
              proposalDigest: boundedStringSchema(16, 200),
              finalConfig: { type: 'object', additionalProperties: true },
            },
          }),
        ),
        prepareLoadoutApply,
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
                items: TIMELINE_PATCH_OPERATION_SCHEMA,
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

function operatorConfigPreviewSchema(): JsonObject {
  const level: JsonObject = { oneOf: [{ type: 'number' }, boundedStringSchema(1, 40)] };
  const weaponSkillLevels: JsonObject = {
    type: 'object',
    additionalProperties: false,
    properties: {
      skill1: boundedIntegerSchema(1, 20),
      skill2: boundedIntegerSchema(1, 20),
      skill3: boundedIntegerSchema(1, 20),
    },
  };
  const operatorSkillLevels: JsonObject = {
    type: 'object',
    additionalProperties: false,
    properties: {
      A: { enum: ['L9', 'M3'] },
      B: { enum: ['L9', 'M3'] },
      E: { enum: ['L9', 'M3'] },
      Q: { enum: ['L9', 'M3'] },
    },
  };
  const equipment: JsonObject = {
    type: 'object',
    additionalProperties: false,
    properties: {
      slotKey: { enum: ['armor', 'accessory2', 'accessory1', 'glove'] },
      part: { enum: ['护甲', '护手', '配件'] },
      equipmentId: boundedStringSchema(1, 200),
      equipmentName: boundedStringSchema(1, 200),
      gearSetId: boundedStringSchema(1, 200),
      gearSetName: boundedStringSchema(1, 200),
      entryLevel: level,
      entryLevels: {
        oneOf: [
          { type: 'array', minItems: 1, maxItems: 8, items: level },
          { type: 'object', maxProperties: 16, additionalProperties: level },
        ],
      },
    },
  };
  return objectSchema({
    properties: {
      characterId: boundedStringSchema(1, 160),
      characterName: boundedStringSchema(1, 160),
      weaponName: boundedStringSchema(1, 200),
      weaponLevel: level,
      potential: boundedStringSchema(1, 40),
      weaponSkillLevels,
      operatorSkillLevels,
      equipments: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: equipment,
      },
      label: boundedStringSchema(1, 120),
      description: boundedStringSchema(1, 500),
    },
    anyOf: [{ required: ['characterId'] }, { required: ['characterName'] }],
  });
}

async function prepareProductCatalogQuery(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, [
    'action', 'domain', 'query', 'operatorQuery', 'setQuery', 'limit',
    'allowDuplicateCompatibleAccessories',
  ]);
  const action = requiredEnum(value.action, 'action', [
    'query', 'compatibleWeapons', 'gearTopologyFacts', 'gearTopologyPlan', 'buildGuide',
  ] as const);
  if (action === 'query' && value.domain === undefined) invalid('catalog query requires domain');
  if ((action === 'compatibleWeapons' || action === 'buildGuide') && value.operatorQuery === undefined) {
    invalid(`${action} requires operatorQuery`);
  }
  if ((action === 'gearTopologyFacts' || action === 'gearTopologyPlan') && value.setQuery === undefined) {
    invalid(`${action} requires setQuery`);
  }
  return {
    kind: 'command',
    command: {
      op: 'queryAgentProductCatalog',
      action,
      ...(value.domain === undefined
        ? {}
        : { domain: requiredEnum(value.domain, 'domain', ['operators', 'skills', 'weapons', 'equipment', 'gearSets'] as const) }),
      ...(optionalString(value.query, 'query', 200) ? { query: value.query as string } : {}),
      ...(optionalString(value.operatorQuery, 'operatorQuery', 200)
        ? { operatorQuery: value.operatorQuery as string }
        : {}),
      ...(optionalString(value.setQuery, 'setQuery', 200) ? { setQuery: value.setQuery as string } : {}),
      ...(value.limit === undefined ? {} : { limit: requiredInteger(value.limit, 'limit', 1, 256) }),
      ...(value.allowDuplicateCompatibleAccessories === undefined
        ? {}
        : {
            allowDuplicateCompatibleAccessories: requiredBoolean(
              value.allowDuplicateCompatibleAccessories,
              'allowDuplicateCompatibleAccessories',
            ),
          }),
    },
  };
}

async function prepareWorkNodeList(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['timelineId']);
  return {
    kind: 'command',
    command: {
      op: 'listAiTimelineWorkNodes',
      ...(optionalString(value.timelineId, 'timelineId', 200) ? { timelineId: value.timelineId as string } : {}),
    },
  };
}

async function prepareWorkNodeRead(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['nodeId', 'includePayload']);
  return {
    kind: 'command',
    command: {
      op: 'readAiTimelineWorkNode',
      nodeId: requiredString(value.nodeId, 'nodeId', 200),
      ...(value.includePayload === undefined
        ? {}
        : { includePayload: requiredBoolean(value.includePayload, 'includePayload') }),
    },
  };
}

async function prepareWorkNodeDiff(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['nodeId']);
  return {
    kind: 'command',
    command: { op: 'diffAiTimelineWorkNode', nodeId: requiredString(value.nodeId, 'nodeId', 200) },
  };
}

async function prepareWorkNodeValidation(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['nodeId']);
  return {
    kind: 'command',
    command: {
      op: 'validateAiTimelineWorkNode',
      nodeId: requiredString(value.nodeId, 'nodeId', 200),
      repairStatus: false,
    },
  };
}

async function prepareWorkNodeDeletion(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['nodeId']);
  const nodeId = requiredString(value.nodeId, 'nodeId', 200);
  return mutationPlan(
    `删除 Work Node ${nodeId}`,
    ['timeline.work-node'],
    { op: 'deleteAiTimelineWorkNode', nodeId },
  );
}

async function prepareWorkNodeUse(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['nodeId', 'commitId']);
  const nodeId = requiredString(value.nodeId, 'nodeId', 200);
  return mutationPlan(
    `检出 Work Node ${nodeId}`,
    ['timeline.work-node', 'timeline.checkout'],
    {
      op: 'checkoutAiTimelineWorkNode',
      nodeId,
      ...(optionalString(value.commitId, 'commitId', 200) ? { commitId: value.commitId as string } : {}),
      reload: false,
      approval: {
        mode: 'manual',
        approvedBy: 'user',
        rationale: 'Approved in the embedded DEF AI mode.',
      },
    },
  );
}

async function prepareWorkNodeRestore(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, ['nodeId']);
  const nodeId = requiredString(value.nodeId, 'nodeId', 200);
  return mutationPlan(
    `恢复 Work Node ${nodeId} 的基线`,
    ['timeline.work-node', 'timeline.checkout'],
    {
      op: 'restoreAiTimelineWorkNodeBase',
      nodeId,
      reload: false,
      approval: {
        approvedBy: 'user',
        rationale: 'Approved in the embedded DEF AI mode.',
      },
    },
  );
}

async function prepareLoadoutPreview(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const allowed = [
    'characterId', 'characterName', 'weaponName', 'weaponLevel', 'potential',
    'weaponSkillLevels', 'operatorSkillLevels', 'equipments', 'label', 'description',
  ] as const;
  const value = exactObject(input, allowed);
  const characterId = optionalString(value.characterId, 'characterId', 160);
  const characterName = optionalString(value.characterName, 'characterName', 160);
  if (!characterId && !characterName) invalid('loadout preview requires characterId or characterName');
  const request: JsonObject = {
    op: 'setOperatorConfig',
    ...(characterId ? { characterId } : {}),
    ...(characterName ? { characterName } : {}),
    ...(optionalString(value.weaponName, 'weaponName', 200) ? { weaponName: value.weaponName as string } : {}),
    ...(value.weaponLevel === undefined ? {} : { weaponLevel: cloneJson(value.weaponLevel) }),
    ...(optionalString(value.potential, 'potential', 40) ? { potential: value.potential as string } : {}),
    ...(value.weaponSkillLevels === undefined
      ? {}
      : { weaponSkillLevels: unrestrictedObject(value.weaponSkillLevels, 'weaponSkillLevels') }),
    ...(value.operatorSkillLevels === undefined
      ? {}
      : { operatorSkillLevels: unrestrictedObject(value.operatorSkillLevels, 'operatorSkillLevels') }),
    ...(value.equipments === undefined
      ? {}
      : { equipments: objectArray(value.equipments, 'equipments', 4) }),
  };
  return {
    kind: 'command',
    command: {
      op: 'prepareOperatorConfigProposal',
      request,
      label: optionalString(value.label, 'label', 120) ?? `调整 ${characterName ?? characterId} 配装`,
      description: optionalString(value.description, 'description', 500)
        ?? '在隔离 Work Node 中预览角色配置，不改动当前 checkout。',
    },
  };
}

async function prepareLoadoutApply(input: JsonValue): Promise<DefInteractiveToolPlan> {
  const value = exactObject(input, [
    'parentNodeId', 'parentRevision', 'nodeId', 'nodeRevision', 'proposalDigest', 'finalConfig',
  ]);
  const nodeId = requiredString(value.nodeId, 'nodeId', 200);
  const finalConfig = unrestrictedObject(value.finalConfig, 'finalConfig');
  const command: JsonObject = {
    op: 'applyPreparedOperatorConfigProposal',
    parentNodeId: requiredString(value.parentNodeId, 'parentNodeId', 200),
    parentRevision: requiredInteger(value.parentRevision, 'parentRevision', 0, Number.MAX_SAFE_INTEGER),
    nodeId,
    nodeRevision: requiredInteger(value.nodeRevision, 'nodeRevision', 0, Number.MAX_SAFE_INTEGER),
    proposalDigest: requiredString(value.proposalDigest, 'proposalDigest', 200),
    finalConfig,
    approval: {
      mode: 'manual',
      approvedBy: 'user',
      rationale: 'Approved in the embedded DEF AI mode.',
    },
  };
  return mutationPlan(
    `应用已审阅配装 ${nodeId}`,
    ['loadout.config', 'timeline.work-node', 'timeline.checkout'],
    command,
  );
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
  const patch = parseTimelinePatchOperations(value.patch);
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

function parseTimelinePatchOperations(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARRAY_ITEMS) {
    invalid(`patch must contain between 1 and ${MAX_ARRAY_ITEMS} operations`);
  }
  return value.map((entry, index) => parseTimelinePatchOperation(entry, `patch[${index}]`));
}

function parseTimelinePatchOperation(value: JsonValue, label: string): JsonObject {
  const raw = unrestrictedObject(value, label);
  const op = requiredEnum(raw.op, `${label}.op`, [
    'addButton',
    'copyStaffLine',
    'removeButton',
    'moveButton',
    'copyButton',
    'replaceButton',
    'attachBuff',
    'removeBuff',
    'setBuffStack',
    'setTargetResistance',
    'clearTimeline',
  ] as const);
  if (op === 'addButton') {
    const input = exactObjectAt(raw, label, [
      'op', 'buttonId', 'characterId', 'characterName', 'skillType', 'runtimeSkillId',
      'skillDisplayName', 'staffIndex', 'lineIndex', 'nodeIndex',
    ]);
    return {
      op,
      characterName: requiredString(input.characterName, `${label}.characterName`, 160),
      ...(optionalString(input.buttonId, `${label}.buttonId`, 200) ? { buttonId: input.buttonId as string } : {}),
      ...(optionalString(input.characterId, `${label}.characterId`, 160) ? { characterId: input.characterId as string } : {}),
      ...(input.skillType === undefined ? {} : {
        skillType: requiredEnum(input.skillType, `${label}.skillType`, ['A', 'B', 'E', 'Q', 'Dot'] as const),
      }),
      ...(optionalString(input.runtimeSkillId, `${label}.runtimeSkillId`, 200)
        ? { runtimeSkillId: input.runtimeSkillId as string }
        : {}),
      ...(optionalString(input.skillDisplayName, `${label}.skillDisplayName`, 200)
        ? { skillDisplayName: input.skillDisplayName as string }
        : {}),
      ...optionalIntegerProperty(input.staffIndex, 'staffIndex', label, 0, 100),
      ...optionalIntegerProperty(input.lineIndex, 'lineIndex', label, 0, 100),
      ...optionalIntegerProperty(input.nodeIndex, 'nodeIndex', label, 0, 10_000),
    };
  }
  if (op === 'copyStaffLine') {
    const input = exactObjectAt(raw, label, [
      'op', 'sourceStaffIndex', 'targetStaffIndex', 'preserveCharacterIdentity', 'replaceTarget',
    ]);
    return {
      op,
      sourceStaffIndex: requiredInteger(input.sourceStaffIndex, `${label}.sourceStaffIndex`, 0, 100),
      targetStaffIndex: requiredInteger(input.targetStaffIndex, `${label}.targetStaffIndex`, 0, 100),
      ...optionalBooleanProperty(input.preserveCharacterIdentity, 'preserveCharacterIdentity', label),
      ...optionalBooleanProperty(input.replaceTarget, 'replaceTarget', label),
    };
  }
  if (op === 'removeButton') {
    const input = exactObjectAt(raw, label, ['op', 'target']);
    return { op, target: parseTimelinePatchTarget(input.target, `${label}.target`) };
  }
  if (op === 'moveButton' || op === 'copyButton') {
    const allowed = op === 'copyButton'
      ? ['op', 'target', 'buttonId', 'staffIndex', 'nodeIndex', 'rebindCharacter']
      : ['op', 'target', 'staffIndex', 'nodeIndex'];
    const input = exactObjectAt(raw, label, allowed);
    return {
      op,
      target: parseTimelinePatchTarget(input.target, `${label}.target`),
      nodeIndex: requiredInteger(input.nodeIndex, `${label}.nodeIndex`, 0, 10_000),
      ...optionalIntegerProperty(input.staffIndex, 'staffIndex', label, 0, 100),
      ...(op === 'copyButton' && optionalString(input.buttonId, `${label}.buttonId`, 200)
        ? { buttonId: input.buttonId as string }
        : {}),
      ...(op === 'copyButton'
        ? optionalBooleanProperty(input.rebindCharacter, 'rebindCharacter', label)
        : {}),
    };
  }
  if (op === 'replaceButton') {
    const input = exactObjectAt(raw, label, [
      'op', 'target', 'skillType', 'runtimeSkillId', 'skillDisplayName', 'skillIconUrl',
    ]);
    const replacement: JsonObject = {
      ...(input.skillType === undefined ? {} : {
        skillType: requiredEnum(input.skillType, `${label}.skillType`, ['A', 'B', 'E', 'Q', 'Dot'] as const),
      }),
      ...(optionalString(input.runtimeSkillId, `${label}.runtimeSkillId`, 200)
        ? { runtimeSkillId: input.runtimeSkillId as string }
        : {}),
      ...(optionalString(input.skillDisplayName, `${label}.skillDisplayName`, 200)
        ? { skillDisplayName: input.skillDisplayName as string }
        : {}),
      ...(optionalString(input.skillIconUrl, `${label}.skillIconUrl`, 2_000)
        ? { skillIconUrl: input.skillIconUrl as string }
        : {}),
    };
    if (Object.keys(replacement).length === 0) invalid(`${label} requires at least one replacement skill field`);
    return {
      op,
      target: parseTimelinePatchTarget(input.target, `${label}.target`),
      ...replacement,
    };
  }
  if (op === 'attachBuff') {
    const input = exactObjectAt(raw, label, ['op', 'target', 'buffId', 'buff', 'stackCount']);
    const buffId = optionalString(input.buffId, `${label}.buffId`, 200);
    const buff = input.buff === undefined ? undefined : parseTimelinePatchBuff(input.buff, `${label}.buff`);
    if (!buffId && !buff) invalid(`${label} requires buffId or buff`);
    return {
      op,
      target: parseTimelinePatchTarget(input.target, `${label}.target`),
      ...(buffId ? { buffId } : {}),
      ...(buff ? { buff } : {}),
      ...optionalIntegerProperty(input.stackCount, 'stackCount', label, 0, 10_000),
    };
  }
  if (op === 'removeBuff' || op === 'setBuffStack') {
    const allowed = op === 'removeBuff'
      ? ['op', 'target', 'buffId', 'count']
      : ['op', 'target', 'buffId', 'stackCount'];
    const input = exactObjectAt(raw, label, allowed);
    return {
      op,
      target: parseTimelinePatchTarget(input.target, `${label}.target`),
      buffId: requiredString(input.buffId, `${label}.buffId`, 200),
      ...(op === 'removeBuff'
        ? optionalIntegerProperty(input.count, 'count', label, 1, 10_000)
        : { stackCount: requiredInteger(input.stackCount, `${label}.stackCount`, 0, 10_000) }),
    };
  }
  if (op === 'setTargetResistance') {
    const input = exactObjectAt(raw, label, ['op', 'target', 'targetResistance']);
    return {
      op,
      target: parseTimelinePatchTarget(input.target, `${label}.target`),
      targetResistance: parseTargetResistance(input.targetResistance, `${label}.targetResistance`),
    };
  }
  exactObjectAt(raw, label, ['op']);
  return { op: 'clearTimeline' };
}

function parseTimelinePatchTarget(value: JsonValue | undefined, label: string): JsonObject {
  const input = exactObjectAt(value, label, [
    'buttonId', 'characterId', 'characterName', 'skillType', 'nodeIndex', 'latest',
  ]);
  const target: JsonObject = {
    ...(optionalString(input.buttonId, `${label}.buttonId`, 200) ? { buttonId: input.buttonId as string } : {}),
    ...(optionalString(input.characterId, `${label}.characterId`, 160) ? { characterId: input.characterId as string } : {}),
    ...(optionalString(input.characterName, `${label}.characterName`, 160)
      ? { characterName: input.characterName as string }
      : {}),
    ...(input.skillType === undefined ? {} : {
      skillType: requiredEnum(input.skillType, `${label}.skillType`, ['A', 'B', 'E', 'Q', 'Dot'] as const),
    }),
    ...optionalIntegerProperty(input.nodeIndex, 'nodeIndex', label, 0, 10_000),
    ...optionalBooleanProperty(input.latest, 'latest', label),
  };
  if (!target.buttonId && !target.characterId && !target.characterName) {
    invalid(`${label} requires buttonId, characterId, or characterName`);
  }
  return target;
}

function parseTimelinePatchBuff(value: JsonValue, label: string): JsonObject {
  const allowed = Object.keys(unrestrictedObject(BUFF_INPUT_SCHEMA.properties, 'BUFF_INPUT_SCHEMA.properties'));
  const input = exactObjectAt(value, label, allowed);
  requiredString(input.name, `${label}.name`, 200);
  requiredString(input.displayName, `${label}.displayName`, 200);
  requiredString(input.sourceName, `${label}.sourceName`, 200);
  if (input.id !== undefined) requiredString(input.id, `${label}.id`, 200);
  if (input.category !== undefined) {
    requiredEnum(input.category, `${label}.category`, ['condition', 'countable', 'passive'] as const);
  }
  if (input.maxStacks !== undefined) requiredInteger(input.maxStacks, `${label}.maxStacks`, 1, 10_000);
  if (input.refCount !== undefined) requiredInteger(input.refCount, `${label}.refCount`, 0, 1_000_000);
  for (const field of ['value'] as const) {
    if (input[field] !== undefined) requiredFiniteNumber(input[field], `${label}.${field}`, -1e12, 1e12);
  }
  return cloneJson(input);
}

function parseTargetResistance(value: JsonValue | undefined, label: string): JsonObject {
  const input = exactObjectAt(value, label, [
    'physicalResistance', 'fireResistance', 'electricResistance', 'iceResistance', 'natureResistance',
  ]);
  if (Object.keys(input).length === 0) invalid(`${label} requires at least one resistance field`);
  const result: JsonObject = {};
  for (const [key, entry] of Object.entries(input)) {
    result[key] = requiredFiniteNumber(entry, `${label}.${key}`, -10_000, 10_000);
  }
  return result;
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
  return exactObjectAt(value, 'input', allowed);
}

function exactObjectAt(
  value: JsonValue | undefined,
  label: string,
  allowed: readonly string[],
): JsonObject {
  const object = unrestrictedObject(value as JsonValue, label);
  const extras = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extras.length) invalid(`${label} has unexpected fields: ${extras.join(', ')}`);
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

function requiredEnum<const Value extends string>(
  value: JsonValue | undefined,
  label: string,
  values: readonly Value[],
): Value {
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    invalid(`${label} must be one of: ${values.join(', ')}`);
  }
  return value as Value;
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

function requiredFiniteNumber(
  value: JsonValue | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${label} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalIntegerProperty(
  value: JsonValue | undefined,
  key: string,
  label: string,
  minimum: number,
  maximum: number,
): JsonObject {
  return value === undefined
    ? {}
    : { [key]: requiredInteger(value, `${label}.${key}`, minimum, maximum) };
}

function optionalBooleanProperty(
  value: JsonValue | undefined,
  key: string,
  label: string,
): JsonObject {
  return value === undefined ? {} : { [key]: requiredBoolean(value, `${label}.${key}`) };
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
