import type {
  DefHarnessOperationDefinition,
  DefHarnessOperationId,
  DefHarnessPhaseDefinition,
  DefHarnessPhaseKind,
  DefHarnessRevisionDefinition,
} from '../contracts/index.ts';

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

export const DEF_HARNESS_ROUTE_TOOL_NAME = 'def.harness.route' as const;

const T = {
  context: 'def.node.crud.context',
  loadouts: 'def.data.resource.team_loadouts',
  current: 'def.node.crud.current',
  buff: 'def.data.resource.buff',
  damage: 'def.data.resource.damage',
  catalog: 'def.data.catalog.query',
  ask: 'def.user.ask',
  selectionApply: 'def.team.selection.apply',
  addSkill: 'def.workbench.add_skill_button',
  removeSkill: 'def.workbench.remove_skill_button',
  addBuff: 'def.buff.add_to_button',
  removeBuff: 'def.buff.remove_from_button',
  setResistance: 'def.target.set_resistance',
  patch: 'def.worknode.patch_and_validate',
  calculate: 'def.damage.calculate_and_verify',
  worknodeList: 'def.worknode.list',
  worknodeRead: 'def.worknode.read',
  worknodeDiff: 'def.worknode.diff',
  worknodeValidate: 'def.worknode.validate',
  worknodeDelete: 'def.worknode.delete',
  worknodeUse: 'def.worknode.use',
  worknodeRestore: 'def.worknode.restore',
  loadoutPreview: 'def.loadout.preview',
  loadoutApplyPrepared: 'def.loadout.apply_prepared',
} as const;

/**
 * The complete tool vocabulary expected by the full matrix.  The list is
 * intentionally independent from an Engine binding: a Harness revision can
 * be validated with a stub resolver while a product registry is being wired.
 */
export const DEF_HARNESS_CANONICAL_TOOL_NAMES = [
  T.context,
  T.loadouts,
  T.current,
  T.buff,
  T.damage,
  T.catalog,
  T.ask,
  T.selectionApply,
  T.addSkill,
  T.removeSkill,
  T.addBuff,
  T.removeBuff,
  T.setResistance,
  T.patch,
  T.calculate,
  T.worknodeList,
  T.worknodeRead,
  T.worknodeDiff,
  T.worknodeValidate,
  T.worknodeDelete,
  T.worknodeUse,
  T.worknodeRestore,
  T.loadoutPreview,
  T.loadoutApplyPrepared,
] as const;

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
          tools: [T.context],
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
          tools: [T.loadouts],
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
          tools: [T.current],
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
          tools: [T.buff],
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
          tools: [T.context],
          writes: [],
          instructions: 'Bind the exact current snapshot, checkout revision and digest before reading its damage report.',
          onSuccess: 'read-damage',
          onFailure: 'failed',
        },
        {
          id: 'read-damage',
          kind: 'evidence',
          tools: [T.damage],
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
  T.context,
  T.loadouts,
  T.current,
  T.buff,
  T.damage,
] as const;

type PhaseSpec = {
  readonly id: string;
  readonly kind: DefHarnessPhaseKind;
  readonly tool: string;
  readonly instructions: string;
  readonly writes?: readonly string[];
};

function phase(
  id: string,
  kind: DefHarnessPhaseKind,
  tool: string,
  instructions: string,
  writes: readonly string[] = [],
): PhaseSpec {
  return { id, kind, tool, instructions, writes };
}

function defineOperation(input: {
  readonly operation: DefHarnessOperationId;
  readonly phases: readonly PhaseSpec[];
}): DefHarnessOperationDefinition {
  if (input.phases.length === 0) throw new Error(`Harness operation has no active phase: ${input.operation}`);
  const activePhases: DefHarnessPhaseDefinition[] = input.phases.map((entry, index) => ({
    id: entry.id,
    kind: entry.kind,
    tools: [entry.tool],
    writes: [...(entry.writes ?? [])],
    instructions: entry.instructions,
    onSuccess: index + 1 < input.phases.length ? input.phases[index + 1]!.id : 'done',
    onFailure: 'failed',
  }));
  return {
    operation: input.operation,
    entryPhase: input.phases[0]!.id,
    phases: [...activePhases, terminalCompleted, terminalFailed],
  };
}

function askOperation(): DefHarnessOperationDefinition {
  return defineOperation({
    operation: 'ask',
    phases: [
      phase(
        'ask-user',
        'interaction',
        T.ask,
        'Ask exactly one precise clarification question and wait for the typed answer. Do not guess a target or mutate the Browser Workbench.',
      ),
      phase(
        'reroute',
        'route',
        DEF_HARNESS_ROUTE_TOOL_NAME,
        'After the user answers, route the original business request again using the answer. The route must select the requested operation; do not terminate merely by echoing the answer.',
      ),
    ],
  });
}

const SELECTION_WRITE_SCOPE = ['selection.roster'] as const;
const selectionOperations: readonly DefHarnessOperationDefinition[] = [
  defineOperation({
    operation: 'inspect',
    phases: [phase('selection-context', 'context', T.context, 'Read the exact selected roster and its current snapshot binding. Preserve an empty roster as data, not as catalog absence.')],
  }),
  defineOperation({
    operation: 'search',
    phases: [phase('selection-search', 'evidence', T.catalog, 'Search only the browser 1.8 operator catalog. Return bounded matches and mark truncated or unavailable evidence explicitly.')],
  }),
  defineOperation({
    operation: 'add',
    phases: [
      phase('selection-add-context', 'context', T.context, 'Read the current roster and resolve the requested addition against the current snapshot before writing.'),
      phase('selection-add', 'mutation', T.selectionApply, 'Apply one exact final roster containing the requested new operator. The typed mutation must create, validate and expose its Work Node before approval.', SELECTION_WRITE_SCOPE),
    ],
  }),
  defineOperation({
    operation: 'remove',
    phases: [
      phase('selection-remove-context', 'context', T.context, 'Read the current roster and resolve the exact operator to remove; never remove by an ambiguous display name.'),
      phase('selection-remove', 'mutation', T.selectionApply, 'Apply one exact final roster with the requested operator removed. Keep all unrelated selected operators unchanged and require explicit approval.', SELECTION_WRITE_SCOPE),
    ],
  }),
  defineOperation({
    operation: 'replace',
    phases: [
      phase('selection-replace-context', 'context', T.context, 'Read the current roster before resolving both the outgoing and incoming operator identities.'),
      phase('selection-replace', 'mutation', T.selectionApply, 'Apply one exact replacement roster and retain unrelated roster order where the product supports it. Require explicit approval.', SELECTION_WRITE_SCOPE),
    ],
  }),
  defineOperation({
    operation: 'reorder',
    phases: [
      phase('selection-reorder-context', 'context', T.context, 'Read the current roster and preserve every selected operator while resolving the requested order.'),
      phase('selection-reorder', 'mutation', T.selectionApply, 'Apply one exact reordered roster only; do not use reorder as an opportunity to add or remove operators.', SELECTION_WRITE_SCOPE),
    ],
  }),
  defineOperation({
    operation: 'analyze',
    phases: [
      phase('selection-analyze-context', 'context', T.context, 'Bind the current selected roster and snapshot before analysis.'),
      phase('selection-analyze-catalog', 'evidence', T.catalog, 'Analyze the selected roster with browser 1.8 catalog facts only; distinguish unavailable recommendations from established facts.'),
    ],
  }),
  defineOperation({
    operation: 'apply',
    phases: [
      phase('selection-apply-context', 'context', T.context, 'Read and bind the current roster before applying a user-requested final roster.'),
      phase('selection-apply', 'mutation', T.selectionApply, 'Apply the exact approved roster through the typed selection mutation and report its Work Node and visible postcondition.', SELECTION_WRITE_SCOPE),
    ],
  }),
  askOperation(),
];

const LOADOUT_WRITE_SCOPE = ['loadout.config', 'timeline.work-node', 'timeline.checkout'] as const;
const LOADOUT_RECOMMENDATION_NOTE = 'Use browser 1.8 catalog facts and explicit evidenceUnavailable states. The historical 1.2 guide is not a fact source and must never be presented as current product truth.';
const loadoutOperations: readonly DefHarnessOperationDefinition[] = [
  defineOperation({
    operation: 'inspect',
    phases: [phase('loadout-inspect', 'context', T.loadouts, 'Read exact current weapons, equipment, set effects and skill levels for every selected operator. Preserve incomplete records explicitly.')],
  }),
  defineOperation({
    operation: 'evaluate',
    phases: [
      phase('loadout-evaluate-context', 'context', T.loadouts, 'Bind current loadout state and identify missing or conflicting configuration.'),
      phase('loadout-evaluate-facts', 'evidence', T.catalog, `Evaluate only current browser facts. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'resolve',
    phases: [
      phase('loadout-resolve-context', 'context', T.loadouts, 'Read the current loadout slots before resolving requested weapon or equipment identities.'),
      phase('loadout-resolve-facts', 'evidence', T.catalog, `Resolve names and compatibility from the browser 1.8 catalog. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'recommend',
    phases: [
      phase('loadout-recommend-context', 'context', T.loadouts, 'Read the current selected operators and loadout gaps before making a recommendation.'),
      phase('loadout-recommend-facts', 'evidence', T.catalog, `Recommend only from browser 1.8 facts; expose evidenceUnavailable for subjective or unsupported build-guide claims. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'recommend_named_set',
    phases: [
      phase('loadout-named-set-context', 'context', T.loadouts, 'Bind the current team and requested named set before evaluating it.'),
      phase('loadout-named-set-facts', 'evidence', T.catalog, `Resolve the named set and its 3+1 topology from browser 1.8 facts. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'recommend_discovered_set',
    phases: [
      phase('loadout-discovered-set-context', 'context', T.loadouts, 'Bind the current team before discovering compatible set candidates.'),
      phase('loadout-discovered-set-facts', 'evidence', T.catalog, `Discover and rank compatible 3+1 set candidates from browser 1.8 facts, marking unavailable evidence instead of filling gaps from the 1.2 guide. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'recommend_weapon',
    phases: [
      phase('loadout-weapon-context', 'context', T.loadouts, 'Bind each selected operator and its weapon type before evaluating weapon candidates.'),
      phase('loadout-weapon-facts', 'evidence', T.catalog, `Recommend only weapons compatible with the operator weapon type and current browser facts. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'recommend_equipment',
    phases: [
      phase('loadout-equipment-context', 'context', T.loadouts, 'Bind the current equipment slots and requested operator before evaluating candidates.'),
      phase('loadout-equipment-facts', 'evidence', T.catalog, `Resolve equipment candidates from browser 1.8 facts. This is the retained legacy recommendation name, not permission to treat the old 1.2 guide as truth. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'compare',
    phases: [
      phase('loadout-compare-context', 'context', T.loadouts, 'Read the exact current loadout as the comparison baseline.'),
      phase('loadout-compare-facts', 'evidence', T.catalog, `Compare candidates against browser 1.8 facts and clearly separate facts from unavailable subjective evidence. ${LOADOUT_RECOMMENDATION_NOTE}`),
    ],
  }),
  defineOperation({
    operation: 'preview',
    phases: [
      phase('loadout-preview-context', 'context', T.loadouts, 'Read and bind the current loadout before preparing a candidate configuration.'),
      phase('loadout-preview-facts', 'evidence', T.catalog, `Resolve the candidate using browser 1.8 facts before preparing it. ${LOADOUT_RECOMMENDATION_NOTE}`),
      phase('loadout-preview', 'proposal', T.loadoutPreview, 'Create a non-live proposal with an exact operator configuration, parent Work Node, revisions and semantic diff. Do not mutate the current checkout.'),
    ],
  }),
  defineOperation({
    operation: 'apply',
    phases: [
      phase('loadout-apply-preview', 'proposal', T.loadoutPreview, 'Require an explicit preview of the exact candidate configuration before approval; reject direct unreviewed application.'),
      phase('loadout-apply-prepared', 'mutation', T.loadoutApplyPrepared, 'Apply only the approved prepared loadout proposal after validating its token, parent revision, Work Node revision and exact visible postcondition.', LOADOUT_WRITE_SCOPE),
    ],
  }),
  defineOperation({
    operation: 'restore',
    phases: [
      phase('loadout-restore-read', 'context', T.worknodeRead, 'Read the explicitly named Work Node baseline and verify its lineage before restoration. Never infer a baseline from the current checkout.'),
      phase('loadout-restore', 'mutation', T.worknodeRestore, 'Restore only the explicitly requested Work Node baseline, with approval and an exact checkout/configuration postcondition.', LOADOUT_WRITE_SCOPE),
    ],
  }),
  askOperation(),
];

const TIMELINE_WRITE_SCOPE = ['timeline.buttons', 'timeline.buffs', 'timeline.resistance', 'timeline.work-node', 'timeline.checkout'] as const;
const timelineMutationWrites = ['timeline.buttons', 'timeline.work-node', 'timeline.checkout'] as const;
const timelineOperations: readonly DefHarnessOperationDefinition[] = [
  defineOperation({
    operation: 'current',
    phases: [phase('timeline-current', 'context', T.current, 'Read the current timeline identity, checkout and stable button coordinates without creating a draft.')],
  }),
  defineOperation({
    operation: 'inspect',
    phases: [
      phase('timeline-inspect-current', 'context', T.current, 'Read the current timeline and resolve the requested button or checkout target.'),
      phase('timeline-inspect-nodes', 'evidence', T.worknodeList, 'List available Work Nodes from the current bound timeline; do not select or mutate one implicitly.'),
      phase('timeline-inspect-node', 'evidence', T.worknodeRead, 'Read only the explicitly selected Work Node and retain its revision and source lineage.'),
    ],
  }),
  defineOperation({
    operation: 'add',
    phases: [
      phase('timeline-add-context', 'context', T.current, 'Read the current timeline and resolve one unambiguous insertion position.'),
      phase('timeline-add', 'mutation', T.addSkill, 'Add exactly one skill button through the browser Work Node mutation, then require approval and an exact visible button postcondition.', timelineMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'remove',
    phases: [
      phase('timeline-remove-context', 'context', T.current, 'Read the authoritative current button list and resolve the complete stable-id removal set before writing.'),
      phase('timeline-remove', 'mutation', T.removeSkill, 'Remove the complete requested button set in one Work Node mutation. Never delete one member of a grouped request at a time.', timelineMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'move',
    phases: [
      phase('timeline-move-context', 'context', T.current, 'Read the current coordinates and resolve the exact button move without changing its skill or Buff payload.'),
      phase('timeline-move', 'mutation', T.patch, 'Apply the constrained move through one isolated validated Work Node, with explicit approval and exact visible coordinates.', timelineMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'replace',
    phases: [
      phase('timeline-replace-context', 'context', T.current, 'Read the current button and resolve the exact replacement skill and preserved fields.'),
      phase('timeline-replace', 'mutation', T.patch, 'Apply the replacement only through a validated Work Node and preserve unrelated buttons, Buffs and resistance.', timelineMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'copy',
    phases: [
      phase('timeline-copy-context', 'context', T.current, 'Read the current source button and destination coordinates before copying.'),
      phase('timeline-copy', 'mutation', T.patch, 'Copy the requested button through a validated Work Node with stable identity and exact destination postcondition.', timelineMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'validate',
    phases: [
      phase('timeline-validate-read', 'context', T.worknodeRead, 'Read the explicitly named Work Node and bind its revision before validation.'),
      phase('timeline-validate', 'verification', T.worknodeValidate, 'Validate the Work Node against the current browser schema and report every typed violation; validation must not mutate the checkout.'),
    ],
  }),
  defineOperation({
    operation: 'preview',
    phases: [
      phase('timeline-preview-current', 'context', T.current, 'Read the current timeline baseline before preparing a preview.'),
      phase('timeline-preview-diff', 'evidence', T.worknodeDiff, 'Return the exact Work Node diff, additions/deletions and semantic risk without using or checking out the node.'),
    ],
  }),
  defineOperation({
    operation: 'apply',
    phases: [
      phase('timeline-apply-read', 'context', T.worknodeRead, 'Read the explicitly reviewed Work Node and verify its parent/revision before application.'),
      phase('timeline-apply', 'mutation', T.worknodeUse, 'Use only the explicitly reviewed Work Node after approval; verify the exact checkout and visible timeline postcondition.', timelineMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'restore',
    phases: [
      phase('timeline-restore-read', 'context', T.worknodeRead, 'Read the explicitly named baseline Work Node and verify its source lineage. Do not infer or silently choose a node.'),
      phase('timeline-restore', 'mutation', T.worknodeRestore, 'Restore only that explicit Work Node baseline after approval, with exact checkout, buttons, Buffs and resistance verification.', TIMELINE_WRITE_SCOPE),
    ],
  }),
  askOperation(),
];

const BUFF_WRITE_SCOPE = ['timeline.buffs', 'timeline.work-node', 'timeline.checkout'] as const;
const buffMutationWrites = ['timeline.buffs', 'timeline.work-node', 'timeline.checkout'] as const;
const buffOperations: readonly DefHarnessOperationDefinition[] = [
  defineOperation({
    operation: 'inspect',
    phases: [
      phase('buff-inspect-current', 'context', T.current, 'Read the current button Buff attachments and stable button identities.'),
      phase('buff-inspect-resource', 'evidence', T.buff, 'Resolve the displayed Buffs and preserve stack counts, conditions, source and evidence status.'),
    ],
  }),
  defineOperation({
    operation: 'resolve',
    phases: [
      phase('buff-resolve-current', 'context', T.current, 'Bind the current button, operator and checkout before resolving a Buff.'),
      phase('buff-resolve-resource', 'evidence', T.buff, 'Resolve only Buff facts present in the bound snapshot and identify ambiguous or unavailable evidence explicitly.'),
    ],
  }),
  defineOperation({
    operation: 'source',
    phases: [
      phase('buff-source-current', 'context', T.current, 'Read the exact button attachment and current equipment/set context.'),
      phase('buff-source-resource', 'evidence', T.buff, 'Trace Buff source, owner, condition and stack semantics from the typed browser resource; do not invent source lineage.'),
    ],
  }),
  defineOperation({
    operation: 'add',
    phases: [
      phase('buff-add-context', 'context', T.current, 'Read the exact target button and resolve the complete Buff payload before mutation.'),
      phase('buff-add', 'mutation', T.addBuff, 'Attach one complete Buff through one isolated validated Work Node with explicit approval and exact attachment postcondition.', buffMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'remove',
    phases: [
      phase('buff-remove-context', 'context', T.current, 'Read the exact target button and resolve the Buff id and requested count before mutation.'),
      phase('buff-remove', 'mutation', T.removeBuff, 'Remove only the requested Buff stacks or attachment through one validated Work Node; preserve unrelated Buffs.', buffMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'replace',
    phases: [
      phase('buff-replace-context', 'context', T.current, 'Read the target button and existing Buff attachments before constructing the replacement.'),
      phase('buff-replace', 'mutation', T.patch, 'Replace the exact Buff through a constrained validated Work Node, preserving stack and target semantics not requested to change.', buffMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'batch',
    phases: [
      phase('buff-batch-context', 'context', T.current, 'Read all target buttons and resolve the complete stable-id batch before writing.'),
      phase('buff-batch', 'mutation', T.patch, 'Apply the complete Buff batch in one isolated validated Work Node. Do not serialize one mutation per button.', buffMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'stack',
    phases: [
      phase('buff-stack-context', 'context', T.current, 'Read the current stack count, max stacks and trigger context for the exact target Buff.'),
      phase('buff-stack', 'mutation', T.patch, 'Change only the requested stack state through a validated Work Node and verify the exact resulting stack count.', buffMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'coverage',
    phases: [
      phase('buff-coverage-current', 'context', T.current, 'Read all buttons and their Buff attachments in the current checkout.'),
      phase('buff-coverage-resource', 'evidence', T.buff, 'Report typed Buff coverage by button, source, condition and stack state; unavailable evidence must remain explicit.'),
    ],
  }),
  defineOperation({
    operation: 'apply',
    phases: [
      phase('buff-apply-read', 'context', T.worknodeRead, 'Read the explicitly reviewed Buff Work Node and verify its revision and parent before application.'),
      phase('buff-apply', 'mutation', T.worknodeUse, 'Use only the explicitly reviewed Buff Work Node after approval and verify exact Buff attachments and checkout.', buffMutationWrites),
    ],
  }),
  defineOperation({
    operation: 'restore',
    phases: [
      phase('buff-restore-read', 'context', T.worknodeRead, 'Read the explicitly named Buff baseline Work Node and verify its source lineage.'),
      phase('buff-restore', 'mutation', T.worknodeRestore, 'Restore only the explicit Buff Work Node baseline after approval and verify exact Buff attachments and checkout.', BUFF_WRITE_SCOPE),
    ],
  }),
  askOperation(),
];

const CALCULATION_FACTS_SCOPE = [] as const;
const calculationOperations: readonly DefHarnessOperationDefinition[] = [
  defineOperation({
    operation: 'calculate',
    phases: [
      phase('calculation-context', 'context', T.context, 'Bind the exact current snapshot, selected roster, timeline checkout and digest before reading damage.'),
      phase('calculation-report', 'evidence', T.damage, 'Read the browser-generated typed damage report. Never reimplement or repair formulas in the Harness.'),
    ],
  }),
  defineOperation({
    operation: 'aggregate',
    phases: [
      phase('calculation-aggregate-context', 'context', T.context, 'Bind the exact current calculation context and checkout.'),
      phase('calculation-aggregate-report', 'evidence', T.damage, 'Read product-generated aggregate damage results and preserve per-button attribution.'),
    ],
  }),
  defineOperation({
    operation: 'compare',
    phases: [
      phase('calculation-compare-context', 'context', T.context, 'Bind the current calculation baseline before comparison.'),
      phase('calculation-compare-report', 'evidence', T.damage, 'Read typed damage output for the requested comparison and distinguish unavailable alternate baselines from zero values.'),
    ],
  }),
  defineOperation({
    operation: 'attribute',
    phases: [
      phase('calculation-attribute-context', 'context', T.context, 'Bind the exact current buttons, Buffs and checkout before attribution.'),
      phase('calculation-attribute-report', 'evidence', T.damage, 'Read typed per-button and per-source attribution from the product report without recomputation.'),
    ],
  }),
  defineOperation({
    operation: 'diagnose',
    phases: [
      phase('calculation-diagnose-context', 'context', T.context, 'Bind the current calculation context and requested diagnosis target.'),
      phase('calculation-diagnose', 'verification', T.calculate, 'Ask the browser product to calculate and verify the target, then report typed failures or results; do not patch formulas in the Harness.'),
    ],
  }),
  defineOperation({
    operation: 'export',
    phases: [
      phase('calculation-export-context', 'context', T.context, 'Bind the current calculation snapshot and report identity before preparing an export result.'),
      phase('calculation-export-report', 'evidence', T.damage, 'Return the typed product report in the requested export representation without creating an untracked file or inventing fields.'),
    ],
  }),
  defineOperation({
    operation: 'explain',
    phases: [
      phase('calculation-explain-context', 'context', T.context, 'Bind the exact current inputs and checkout before explaining a result.'),
      phase('calculation-explain-report', 'evidence', T.damage, 'Explain only formula stages and values present in the typed product report; label unavailable evidence explicitly.'),
    ],
  }),
  defineOperation({
    operation: 'skill_fact',
    phases: [phase('calculation-skill-fact', 'evidence', T.catalog, 'Read skill facts from the browser 1.8 catalog and return evidenceUnavailable when a fact is not present; do not use the old 1.2 guide as truth.')],
  }),
  askOperation(),
];

/**
 * This is the audited old-stable operation matrix.  Keep this list explicit:
 * it is the source of truth for parity tests and prevents a canonical Tool
 * refactor from silently dropping a business operation.
 */
type FullMatrixOperationPlaceholder = {
  readonly selection: readonly DefHarnessOperationId[];
  readonly loadout: readonly DefHarnessOperationId[];
  readonly timeline: readonly DefHarnessOperationId[];
  readonly buff: readonly DefHarnessOperationId[];
  readonly calculation: readonly DefHarnessOperationId[];
};

export const DEF_HARNESS_FULL_OPERATION_MATRIX = {
  selection: ['inspect', 'search', 'add', 'remove', 'replace', 'reorder', 'analyze', 'apply'],
  loadout: ['inspect', 'evaluate', 'resolve', 'recommend', 'recommend_named_set', 'recommend_discovered_set', 'recommend_weapon', 'recommend_equipment', 'compare', 'preview', 'apply', 'restore'],
  timeline: ['current', 'inspect', 'add', 'remove', 'move', 'replace', 'copy', 'validate', 'preview', 'apply', 'restore'],
  buff: ['inspect', 'resolve', 'source', 'add', 'remove', 'replace', 'batch', 'stack', 'coverage', 'apply', 'restore'],
  calculation: ['calculate', 'aggregate', 'compare', 'attribute', 'diagnose', 'export', 'explain', 'skill_fact'],
} as const satisfies FullMatrixOperationPlaceholder;

const FULL_MATRIX_SOURCE = 'old-stable:bcea5f12a3148737e7a9b799d2fa4e0170ffe0bb';

function fullRevision(businessId: Exclude<keyof typeof DEF_HARNESS_FULL_OPERATION_MATRIX, never>): string {
  return `${businessId}-v17-full-matrix`;
}

function fullLineage(businessId: Exclude<keyof typeof DEF_HARNESS_FULL_OPERATION_MATRIX, never>): string {
  return `${businessId}@${FULL_MATRIX_SOURCE}:50-operation-parity`;
}

export const PHASE7_FULL_HARNESS_CATALOG = [
  {
    schemaVersion: 1,
    businessId: 'selection',
    displayName: '队伍选择',
    sourceLineage: fullLineage('selection'),
    revision: fullRevision('selection'),
    summary: 'Restore all eight audited selection operations with exact roster context, browser facts and approved roster Work Node mutations.',
    writeScope: SELECTION_WRITE_SCOPE,
    operations: selectionOperations,
  },
  {
    schemaVersion: 1,
    businessId: 'loadout',
    displayName: '配装',
    sourceLineage: fullLineage('loadout'),
    revision: fullRevision('loadout'),
    summary: 'Restore all twelve audited loadout operations with browser 1.8 facts, evidenceUnavailable semantics and preview-before-apply Work Node lifecycle.',
    writeScope: LOADOUT_WRITE_SCOPE,
    operations: loadoutOperations,
  },
  {
    schemaVersion: 1,
    businessId: 'timeline',
    displayName: '排轴',
    sourceLineage: fullLineage('timeline'),
    revision: fullRevision('timeline'),
    summary: 'Restore all eleven audited timeline operations; every write is isolated, validated and applied through a Work Node.',
    writeScope: TIMELINE_WRITE_SCOPE,
    operations: timelineOperations,
  },
  {
    schemaVersion: 1,
    businessId: 'buff',
    displayName: 'Buff',
    sourceLineage: fullLineage('buff'),
    revision: fullRevision('buff'),
    summary: 'Restore all eleven audited Buff operations; every Buff write is isolated, validated and applied through a Work Node.',
    writeScope: BUFF_WRITE_SCOPE,
    operations: buffOperations,
  },
  {
    schemaVersion: 1,
    businessId: 'calculation',
    displayName: '计算统计',
    sourceLineage: fullLineage('calculation'),
    revision: fullRevision('calculation'),
    summary: 'Restore all eight audited calculation operations using only browser-generated typed reports and 1.8 catalog facts.',
    writeScope: CALCULATION_FACTS_SCOPE,
    operations: calculationOperations,
  },
  {
    schemaVersion: 1,
    businessId: 'conversation',
    displayName: '直接对话',
    sourceLineage: 'conversation@current-harness:direct-response',
    revision: 'conversation-v2-direct-response',
    summary: 'Answer greetings, acknowledgements, capability questions and questions about prior visible results without inventing a business mutation.',
    writeScope: [],
    operations: [{
      operation: 'respond',
      entryPhase: 'done',
      phases: [{
        id: 'done',
        kind: 'response',
        tools: [],
        writes: [],
        instructions: 'Answer the user directly from the conversation and established DEF event history. Do not invent game facts or emit a Tool call.',
        terminalState: 'completed',
      }],
    }],
  },
] as const satisfies readonly DefHarnessRevisionDefinition[];

/** Current interactive catalog name retained for Host and Engine callers. */
export const PHASE6_INTERACTIVE_HARNESS_CATALOG = PHASE7_FULL_HARNESS_CATALOG;
