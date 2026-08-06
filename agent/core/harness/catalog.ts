import type { DefHarnessRevisionDefinition } from '../contracts/index.ts';

const terminalCompleted = {
  id: 'done',
  kind: 'response',
  tools: [],
  writes: [],
  instructions: 'Return only facts established by the typed result and retain the bound snapshot identity.',
  terminalState: 'completed',
} as const;

const terminalFailed = {
  id: 'failed',
  kind: 'response',
  tools: [],
  writes: [],
  instructions: 'Report the typed unavailable or invalid state. Do not infer missing business facts.',
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
