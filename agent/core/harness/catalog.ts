import type { DefHarnessRevisionDefinition } from '../contracts/index.ts';

const terminalCompleted = {
  id: 'done',
  kind: 'response',
  tools: [],
  writes: [],
  instructions: 'Return only facts established by the typed result and retain the bound snapshot identity. This Turn is complete: do not call, serialize, or announce another Tool invocation.',
  terminalState: 'completed',
} as const;

const terminalFailed = {
  id: 'failed',
  kind: 'response',
  tools: [],
  writes: [],
  instructions: 'Report the typed unavailable or invalid state. Do not infer missing business facts or call, serialize, or announce another Tool invocation.',
  terminalState: 'aborted',
} as const;

export const PHASE3_READONLY_HARNESS_CATALOG = [
  {
    schemaVersion: 1,
    businessId: 'selection',
    displayName: '队伍选择',
    sourceLineage: 'selection@v1',
    revision: 'v1-slim-readonly',
    summary: 'Inspect the exact selected roster in the current Browser Workbench snapshot.',
    writeScope: [],
    operations: [{
      operation: 'inspect',
      entryPhase: 'read-current',
      phases: [
        {
          id: 'read-current',
          kind: 'context',
          tools: ['def.node.crud.context'],
          writes: [],
          instructions: 'Read the current selected roster once. An empty roster is not proof that the local operator catalog is empty.',
          onSuccess: 'done',
          onFailure: 'failed',
        },
        terminalCompleted,
        terminalFailed,
      ],
    }],
  },
  {
    schemaVersion: 1,
    businessId: 'loadout',
    displayName: '配装',
    sourceLineage: 'loadout@v4',
    revision: 'v4-slim-readonly',
    summary: 'Inspect exact current weapons, equipment, set effects and skill levels for the selected team.',
    writeScope: [],
    operations: [{
      operation: 'inspect',
      entryPhase: 'read-loadouts',
      phases: [
        {
          id: 'read-loadouts',
          kind: 'context',
          tools: ['def.data.resource.team_loadouts'],
          writes: [],
          instructions: 'Read the selected team loadouts once and preserve missing configuration as an explicit incomplete result.',
          onSuccess: 'done',
          onFailure: 'failed',
        },
        terminalCompleted,
        terminalFailed,
      ],
    }],
  },
  {
    schemaVersion: 1,
    businessId: 'timeline',
    displayName: '排轴',
    sourceLineage: 'timeline@v13',
    revision: 'v13-slim-readonly',
    summary: 'Read the current timeline checkout and stable skill-button coordinates without creating a draft.',
    writeScope: [],
    operations: [{
      operation: 'current',
      entryPhase: 'read-current',
      phases: [
        {
          id: 'read-current',
          kind: 'context',
          tools: ['def.node.crud.current'],
          writes: [],
          instructions: 'Read the current timeline identity, checkout and stable button coordinates. Do not create or select a Work Node.',
          onSuccess: 'done',
          onFailure: 'failed',
        },
        terminalCompleted,
        terminalFailed,
      ],
    }],
  },
  {
    schemaVersion: 1,
    businessId: 'buff',
    displayName: 'Buff',
    sourceLineage: 'buff@v1',
    revision: 'v1-slim-readonly',
    summary: 'Resolve bounded Buff facts from current buttons, equipment effects and set effects.',
    writeScope: [],
    operations: [{
      operation: 'resolve',
      entryPhase: 'resolve-buff',
      phases: [
        {
          id: 'resolve-buff',
          kind: 'evidence',
          tools: ['def.data.resource.buff'],
          writes: [],
          instructions: 'Resolve only Buff facts present in the bound current snapshot. Empty candidates do not prove catalog absence.',
          onSuccess: 'done',
          onFailure: 'failed',
        },
        terminalCompleted,
        terminalFailed,
      ],
    }],
  },
  {
    schemaVersion: 1,
    businessId: 'calculation',
    displayName: '计算统计',
    sourceLineage: 'calculation@v1',
    revision: 'v1-slim-readonly',
    summary: 'Read the current typed damage report without reimplementing any formula in the Harness.',
    writeScope: [],
    operations: [{
      operation: 'calculate',
      entryPhase: 'bind-scheme',
      phases: [
        {
          id: 'bind-scheme',
          kind: 'context',
          tools: ['def.node.crud.context'],
          writes: [],
          instructions: 'Bind the exact current snapshot, checkout revision and digest before reading its damage report.',
          onSuccess: 'read-damage',
          onFailure: 'failed',
        },
        {
          id: 'read-damage',
          kind: 'evidence',
          tools: ['def.data.resource.damage'],
          writes: [],
          instructions: 'Read the product-generated typed damage report once. Never recompute or repair formula output in the Harness.',
          onSuccess: 'done',
          onFailure: 'failed',
        },
        terminalCompleted,
        terminalFailed,
      ],
    }],
  },
] as const satisfies readonly DefHarnessRevisionDefinition[];

export const PHASE3_READONLY_TOOL_NAMES = [
  'def.node.crud.context',
  'def.data.resource.team_loadouts',
  'def.node.crud.current',
  'def.data.resource.buff',
  'def.data.resource.damage',
] as const;

export const DEF_HARNESS_ROUTE_TOOL_NAME = 'def.harness.route' as const;

const askOperation = {
  operation: 'ask',
  entryPhase: 'ask-user',
  phases: [
    {
      id: 'ask-user',
      kind: 'interaction',
      tools: ['def.user.ask'],
      writes: [],
      instructions: 'Ask one precise question only when the requested action cannot be made unambiguous from the bound snapshot.',
      onSuccess: 'done',
      onFailure: 'failed',
    },
    terminalCompleted,
    terminalFailed,
  ],
} as const;

function singleToolOperation(input: {
  readonly operation: 'apply' | 'edit' | 'add' | 'remove' | 'resistance' | 'recalculate';
  readonly phaseId: string;
  readonly phaseKind: 'proposal' | 'mutation' | 'verification';
  readonly toolName: string;
  readonly writes: readonly string[];
  readonly instructions: string;
}) {
  return {
    operation: input.operation,
    entryPhase: input.phaseId,
    phases: [
      {
        id: input.phaseId,
        kind: input.phaseKind,
        tools: [input.toolName],
        writes: [...input.writes],
        instructions: input.instructions,
        onSuccess: 'done',
        onFailure: 'failed',
      },
      terminalCompleted,
      terminalFailed,
    ],
  } as const;
}

const timelineRemoveOperation = {
  operation: 'remove',
  entryPhase: 'read-remove-targets',
  phases: [
    {
      id: 'read-remove-targets',
      kind: 'context',
      tools: ['def.node.crud.current'],
      writes: [],
      instructions: 'Read the authoritative current button list once and resolve the complete requested removal set. For a grouped or bulk request, retain every matching stable button id; do not start deleting one button at a time.',
      onSuccess: 'remove-buttons',
      onFailure: 'failed',
    },
    {
      id: 'remove-buttons',
      kind: 'mutation',
      tools: ['def.workbench.remove_skill_button'],
      writes: ['timeline.buttons', 'timeline.work-node', 'timeline.checkout'],
      instructions: 'Submit exactly one removal request containing the complete stable button-id set established by the preceding read. A single target may use buttonId; a grouped request must use buttonIds once so the browser creates and validates one isolated Work Node. Explicit approval is mandatory. Never serialize a second Tool call as response text.',
      onSuccess: 'done',
      onFailure: 'failed',
    },
    terminalCompleted,
    terminalFailed,
  ],
} as const;

/**
 * First interactive Slim catalog. It deliberately reuses the proven read-only
 * phases and adds only browser-owned operations that have a typed command and
 * an observable ProductGateway result.
 */
export const PHASE6_INTERACTIVE_HARNESS_CATALOG = [
  {
    ...PHASE3_READONLY_HARNESS_CATALOG[0],
    revision: 'v2-slim-interactive',
    summary: 'Inspect or explicitly replace the selected roster in the current Browser Workbench.',
    writeScope: ['selection.roster'],
    operations: [
      ...PHASE3_READONLY_HARNESS_CATALOG[0].operations,
      singleToolOperation({
        operation: 'apply',
        phaseId: 'apply-selection',
        phaseKind: 'mutation',
        toolName: 'def.team.selection.apply',
        writes: ['selection.roster'],
        instructions: 'Apply one exact final roster only. Provide a concise nodeTitle without an [ai] prefix and a nodeDescription that explains the change. The DEF Host will pause for explicit user approval before dispatch.',
      }),
      askOperation,
    ],
  },
  {
    ...PHASE3_READONLY_HARNESS_CATALOG[1],
    revision: 'v5-slim-interactive',
    summary: 'Inspect exact current loadouts and ask a bounded clarification question when configuration intent is ambiguous.',
    writeScope: [],
    operations: [
      ...PHASE3_READONLY_HARNESS_CATALOG[1].operations,
      askOperation,
    ],
  },
  {
    ...PHASE3_READONLY_HARNESS_CATALOG[2],
    revision: 'v15-slim-interactive',
    summary: 'Read or explicitly edit the current timeline through browser-owned typed commands.',
    writeScope: ['timeline.buttons', 'timeline.work-node', 'timeline.checkout', 'timeline.resistance'],
    operations: [
      ...PHASE3_READONLY_HARNESS_CATALOG[2].operations,
      singleToolOperation({
        operation: 'edit',
        phaseId: 'edit-work-node',
        phaseKind: 'mutation',
        toolName: 'def.worknode.patch_and_validate',
        writes: ['timeline.work-node', 'timeline.checkout'],
        instructions: 'Use a constrained patch for moves, copies, grouped changes, or resistance edits. Explicit approval is mandatory.',
      }),
      singleToolOperation({
        operation: 'add',
        phaseId: 'add-button',
        phaseKind: 'mutation',
        toolName: 'def.workbench.add_skill_button',
        writes: ['timeline.buttons'],
        instructions: 'Add exactly one unambiguous skill button. Explicit approval is mandatory.',
      }),
      timelineRemoveOperation,
      singleToolOperation({
        operation: 'resistance',
        phaseId: 'set-target-resistance',
        phaseKind: 'mutation',
        toolName: 'def.target.set_resistance',
        writes: ['timeline.resistance'],
        instructions: 'Set one exact button resistance map. Explicit approval is mandatory.',
      }),
      askOperation,
    ],
  },
  {
    ...PHASE3_READONLY_HARNESS_CATALOG[3],
    revision: 'v2-slim-interactive',
    summary: 'Resolve, add, or remove a Buff in the exact current checkout.',
    writeScope: ['timeline.buffs'],
    operations: [
      ...PHASE3_READONLY_HARNESS_CATALOG[3].operations,
      singleToolOperation({
        operation: 'add',
        phaseId: 'add-buff',
        phaseKind: 'mutation',
        toolName: 'def.buff.add_to_button',
        writes: ['timeline.buffs'],
        instructions: 'Attach one complete Buff to one exact button. Explicit approval is mandatory.',
      }),
      singleToolOperation({
        operation: 'remove',
        phaseId: 'remove-buff',
        phaseKind: 'mutation',
        toolName: 'def.buff.remove_from_button',
        writes: ['timeline.buffs'],
        instructions: 'Remove one exact Buff from one exact button. Explicit approval is mandatory.',
      }),
      askOperation,
    ],
  },
  {
    ...PHASE3_READONLY_HARNESS_CATALOG[4],
    revision: 'v2-slim-interactive',
    summary: 'Read the current damage report or ask the browser product to recalculate it.',
    writeScope: [],
    operations: [
      ...PHASE3_READONLY_HARNESS_CATALOG[4].operations,
      singleToolOperation({
        operation: 'recalculate',
        phaseId: 'recalculate-damage',
        phaseKind: 'verification',
        toolName: 'def.damage.calculate_and_verify',
        writes: [],
        instructions: 'Trigger the existing product calculator and return only its browser-generated result.',
      }),
      askOperation,
    ],
  },
] as const satisfies readonly DefHarnessRevisionDefinition[];
