import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  asDatabaseGeneration,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  canonicalJson,
  type CommandId,
  type DefPreparedWorkNodeCandidateRefV1,
  type DefPreparedWorkNodeProposalV1,
  type JsonValue,
  type Phase2ProductCommand,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductCommandReceipt,
  type ProductCommandResult,
  type ProductGateway,
  type ProductSnapshotEnvelope,
  type ProductWaitOptions,
} from '../core/contracts/index.ts';
import { PHASE6_INTERACTIVE_HARNESS_CATALOG } from '../core/harness/catalog.ts';
import { DefHarnessManager } from '../core/harness/manager.ts';
import { DeterministicFakeAgentEngine } from '../core/testing/fake-engine.ts';
import { DefProductToolRegistry } from '../core/tools/interactive-workbench.ts';
import { verifyApprovalCapabilityToken } from './approval-capability-signer.ts';
import { DefAgentHost } from './def-agent-host.ts';

const productBinding: ProductBinding = {
  workspaceId: asWorkspaceId('workspace-interactive'),
  databaseGeneration: asDatabaseGeneration('generation-interactive'),
  timelineId: asTimelineId('timeline-interactive'),
  checkoutTargetId: 'node-interactive',
  checkoutUpdatedAt: 10,
  contentRevision: 4,
  snapshotDigest: 'sha256:interactive-4',
};

class ControlledProductGateway implements ProductGateway<Phase2ProductOperationSchema> {
  readonly commands: Phase2ProductCommand[] = [];
  readonly #results = new Map<CommandId, ProductCommandResult>();
  readonly #waiters = new Map<CommandId, (result: ProductCommandResult) => void>();
  snapshot: ProductSnapshotEnvelope = {
    protocolVersion: 1,
    binding: productBinding,
    capturedAt: '2026-08-07T00:00:00.000Z',
    payload: {
      schemaVersion: 1,
      selectedCharacters: [],
      skillButtons: [],
      operatorConfigs: [],
    },
  };

  async getSnapshot(binding: ProductBinding): Promise<ProductSnapshotEnvelope> {
    assert.equal(canonicalJson(binding as unknown as JsonValue), canonicalJson(this.snapshot.binding as unknown as JsonValue));
    return structuredClone(this.snapshot);
  }

  async dispatch(command: Phase2ProductCommand): Promise<ProductCommandReceipt> {
    this.commands.push(structuredClone(command));
    return {
      commandId: command.commandId,
      status: 'queued',
      acceptedAt: '2026-08-07T00:00:01.000Z',
    };
  }

  async awaitResult(commandId: CommandId, _options?: ProductWaitOptions): Promise<ProductCommandResult> {
    const existing = this.#results.get(commandId);
    if (existing) return existing;
    return new Promise<ProductCommandResult>((resolve) => this.#waiters.set(commandId, resolve));
  }

  async reconcile(commandId: CommandId): Promise<ProductCommandResult | null> {
    return this.#results.get(commandId) ?? null;
  }

  settle(result: ProductCommandResult): void {
    this.#results.set(result.commandId, result);
    this.#waiters.get(result.commandId)?.(result);
    this.#waiters.delete(result.commandId);
  }
}

function fixture() {
  const engine = new DeterministicFakeAgentEngine();
  const gateway = new ControlledProductGateway();
  const tools = new DefProductToolRegistry();
  const harness = new DefHarnessManager({
    catalog: PHASE6_INTERACTIVE_HARNESS_CATALOG,
    resolveToolDescriptor: (name) => tools.resolveDescriptor(name),
  });
  const host = new DefAgentHost({
    engine,
    productGateway: gateway,
    harnessManager: harness,
    toolRegistry: tools,
    requireConsumer: () => {},
  });
  return { engine, gateway, host };
}

async function waitFor<Value>(read: () => Value | null | undefined, message: string): Promise<Value> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(message);
}

async function createSession(host: DefAgentHost, binding: ProductBinding = productBinding) {
  return host.createSession({ binding, providerProfileRef: 'test' });
}

function digestJson(value: JsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function preparedProposal(
  binding: ProductBinding,
  operation: string,
  options: {
    readonly targetType?: 'snapshot' | 'work-node';
    readonly sourceTargetId?: string;
    readonly intent?: 'timeline' | 'buff' | 'selection' | 'loadout';
    readonly destination?: 'current-timeline' | 'new-temporary-workspace';
    readonly candidateTimelineId?: string;
    readonly sourceCheckoutTargetId?: string;
    readonly sourceCheckoutRevision?: number;
    readonly scope?: readonly ('timeline.structure' | 'buff.attachments' | 'buff.resistance' | 'selection.roster' | 'loadout.config')[];
  } = {},
): DefPreparedWorkNodeProposalV1 {
  const scope = options.scope ?? ['timeline.structure'];
  const intent = options.intent ?? (
    scope[0] === 'selection.roster' ? 'selection'
      : scope[0] === 'loadout.config' ? 'loadout'
        : scope[0] === 'buff.attachments' || scope[0] === 'buff.resistance' ? 'buff'
          : 'timeline'
  );
  const sourceTargetId = options.sourceTargetId
    ?? binding.checkoutTargetId
    ?? `snapshot-${binding.timelineId}`;
  const changes = [{
    path: '/timelineData/skillButtons/0',
    kind: 'changed' as const,
    before: { id: 'button-old', nodeIndex: 0 },
    after: { id: 'button-old', nodeIndex: 1 },
  }];
  const candidateWithoutDigest = {
    contract: 'DefPreparedWorkNodeCandidateRefV1' as const,
    schemaVersion: 1 as const,
    proposalId: `proposal-${operation.replaceAll('.', '-')}`,
    intent,
    destination: options.destination ?? 'current-timeline',
    sourceTargetId,
    sourceRevision: binding.contentRevision,
    candidateTimelineId: options.candidateTimelineId ?? binding.timelineId,
    nodeId: `candidate-${operation.replaceAll('.', '-')}`,
    nodeRevision: 1,
    basePayloadDigest: `sha256:${'1'.repeat(64)}`,
    workingPayloadDigest: `sha256:${'2'.repeat(64)}`,
    diffDigest: digestJson(changes as unknown as JsonValue),
    scope: [...scope],
  };
  const proposalDigest = digestJson({
    operation,
    intent: candidateWithoutDigest.intent,
    candidate: candidateWithoutDigest,
    scope: [...scope],
  } as unknown as JsonValue);
  const candidate = { ...candidateWithoutDigest, proposalDigest };
  return {
    ...candidate,
    contract: 'DefPreparedWorkNodeProposalV1',
    sourceBinding: { ...binding },
    sourceCheckout: {
      timelineId: binding.timelineId,
      targetType: options.targetType ?? 'work-node',
      targetId: options.sourceCheckoutTargetId ?? sourceTargetId,
      revision: options.sourceCheckoutRevision ?? binding.contentRevision,
      payloadDigest: candidate.basePayloadDigest,
    },
    structuralParentNodeId: null,
    review: {
      contract: 'DefPreparedWorkNodeReviewV1',
      schemaVersion: 1,
      manifest: {
        proposalId: candidate.proposalId,
        nodeId: candidate.nodeId,
        nodeRevision: candidate.nodeRevision,
        diffDigest: candidate.diffDigest,
        proposalDigest: candidate.proposalDigest,
        scope: [...candidate.scope],
      },
      summary: { addedPathCount: 0, removedPathCount: 0, changedPathCount: 1 },
      changes,
    },
    liveCheckoutTouched: false,
  };
}

function enqueuePreparedRemoval(
  engine: DeterministicFakeAgentEngine,
  suffix: string,
): void {
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId(`route-prepared-${suffix}`),
      name: 'def.harness.route',
      input: { businessId: 'timeline', operation: 'remove' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId(`context-prepared-${suffix}`),
      name: 'def.node.crud.current',
      input: {},
    },
    {
      type: 'tool',
      toolCallId: asToolCallId(`remove-prepared-${suffix}`),
      name: 'def.workbench.remove_skill_button',
      input: { buttonId: 'button-prepared' },
    },
    { type: 'complete', output: { ok: true } },
  ]);
}

function enqueuePreparedSelection(
  engine: DeterministicFakeAgentEngine,
  suffix: string,
): void {
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId(`route-prepared-selection-${suffix}`),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'apply' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId(`context-prepared-selection-${suffix}`),
      name: 'def.node.crud.context',
      input: {},
    },
    {
      type: 'tool',
      toolCallId: asToolCallId(`apply-prepared-selection-${suffix}`),
      name: 'def.team.selection.apply',
      input: {
        operation: 'apply',
        characterNames: ['洛茜'],
        nodeTitle: '调整阵容：仅保留洛茜',
        nodeDescription: '记录候选 selection Work Node 变更。',
      },
    },
    { type: 'complete', output: { ok: true } },
  ]);
}

function cleanupBrowserResult(
  candidate: DefPreparedWorkNodeCandidateRefV1,
  status: 'deleted' | 'preserved' | 'failed' = 'deleted',
): JsonValue {
  return {
    cleanup: {
      contract: 'DefPreparedWorkNodeCleanupAuditV1',
      schemaVersion: 1,
      proposalId: candidate.proposalId,
      nodeId: candidate.nodeId,
      candidateTimelineId: candidate.candidateTimelineId,
      status,
    },
  };
}

// Greetings and prior-result questions terminate as direct conversation instead of inventing a business Tool.
{
  const { engine, gateway, host } = fixture();
  engine.enqueueScript([
    { type: 'complete', output: { text: '你好，我在。' } },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '你好',
    binding: productBinding,
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.completed');
  assert.equal(gateway.commands.length, 0);
  assert.deepEqual(
    host.readEvents(session.defSessionId)
      .filter((event) => event.type === 'harness.tool.projected')
      .map((event) => event.payload.tools),
    [['def.harness.route'], []],
  );
  await host.shutdown();
}

// A typed question pauses the Engine Tool and resumes with the exact answer.
{
  const { engine, gateway, host } = fixture();
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-question'),
      name: 'def.harness.route',
      input: {
        businessId: 'selection',
        operation: 'ask',
        resume: { steps: [{ businessId: 'selection', operation: 'inspect' }] },
      },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('ask-question'),
      name: 'def.user.ask',
      input: { prompt: '请选择测试队伍', options: ['甲', '乙'] },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('inspect-after-question'),
      name: 'def.node.crud.context',
      input: {},
    },
    { type: 'complete', output: { ok: true } },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '帮我选队伍',
    binding: productBinding,
  });
  const interaction = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'question interaction was not published',
  );
  assert.equal(interaction.kind, 'question');
  assert.deepEqual(interaction.details, { options: ['甲', '乙'] });
  host.resolveInteraction(interaction.interactionId, { status: 'answered', value: '乙' }, productBinding);
  const terminal = await host.waitForTurnTerminal(turn.defTurnId);
  assert.equal(terminal.type, 'turn.completed');
  assert.equal(gateway.commands.length, 0);
  const answer = host.readEvents(session.defSessionId).find((event) => (
    event.type === 'tool.result' && event.toolCallId === asToolCallId('ask-question')
  ));
  assert.ok(answer && answer.type === 'tool.result');
  assert.deepEqual(answer.payload.result, {
    contract: 'DefQuestionAnswerV1',
    interactionId: interaction.interactionId,
    answer: '乙',
  });
  assert.deepEqual(
    host.readEvents(session.defSessionId)
      .filter((event) => event.type === 'harness.tool.projected')
      .map((event) => event.payload.tools),
    [
      ['def.harness.route'],
      ['def.user.ask'],
      ['def.node.crud.context'],
      [],
    ],
  );
  await host.shutdown();
}

// High-confidence read requests are committed before Engine startup: the
// model receives the business Tool directly and never spends a roundtrip on
// def.harness.route. The trace still records the deterministic route.
{
  const { engine, gateway, host } = fixture();
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('deterministic-roster-context'),
      name: 'def.node.crud.context',
      input: {},
    },
    { type: 'complete', output: { selected: [] } },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '当前队伍有谁？',
    binding: productBinding,
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.completed');
  assert.equal(gateway.commands.length, 0);
  const events = host.readEvents(session.defSessionId);
  assert.deepEqual(
    events
      .filter((event) => event.type === 'tool.requested')
      .map((event) => event.payload.name),
    ['def.node.crud.context'],
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === 'harness.routed')
      .map((event) => `${event.payload.businessId}.${event.payload.operation}`),
    ['selection.inspect'],
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === 'harness.tool.projected')
      .map((event) => event.payload.tools),
    [['def.harness.route'], ['def.node.crud.context'], []],
  );
  await host.shutdown();
}

// A continuation word without durable pending/interrupted context is not an
// executable command. It remains model-routable and cannot resume anything.
{
  const { engine, gateway, host } = fixture();
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('ungated-continuation-route'),
      name: 'def.harness.route',
      input: { businessId: 'conversation', operation: 'respond' },
    },
    { type: 'complete', output: { text: '没有可继续的任务。' } },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '继续',
    binding: productBinding,
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.completed');
  assert.equal(gateway.commands.length, 0);
  assert.deepEqual(
    host.readEvents(session.defSessionId)
      .filter((event) => event.type === 'tool.requested')
      .map((event) => event.payload.name),
    ['def.harness.route'],
  );
  await host.shutdown();
}

// Selection uses the same candidate-first flow as timeline and Buff writes;
// prepare may create an isolated candidate, but apply cannot reach the live
// checkout until the matching approval is granted.
{
  const { engine, gateway, host } = fixture();
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-selection-apply'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'apply' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('context-selection-apply'),
      name: 'def.node.crud.context',
      input: {},
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('apply-selection'),
      name: 'def.team.selection.apply',
      input: {
        operation: 'apply',
        characterNames: ['洛茜'],
        nodeTitle: '调整阵容：仅保留洛茜',
        nodeDescription: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
        openCanvas: true,
      },
    },
    { type: 'complete', output: { ok: true } },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '把队伍改成洛茜',
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'selection prepare was not dispatched');
  assert.equal(prepare.command.op, 'workbench.execute-command');
  if (prepare.command.op !== 'workbench.execute-command') throw new Error('expected selection prepare command');
  assert.deepEqual(prepare.command.payload.command, {
    op: 'prepareReviewedWorkNodeProposal',
    operation: 'selection.apply',
    intent: 'selection',
    scope: ['selection.roster', 'timeline.structure', 'buff.attachments', 'buff.resistance', 'loadout.config'],
    roster: {
      characterNames: ['洛茜'],
      nodeTitle: '调整阵容：仅保留洛茜',
      nodeDescription: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
      openCanvas: true,
    },
    label: '调整阵容：仅保留洛茜',
    description: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
    sourceBinding: productBinding,
  });
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(productBinding, 'selection.apply', {
      intent: 'selection',
      scope: ['selection.roster', 'timeline.structure', 'buff.attachments', 'buff.resistance', 'loadout.config'],
      destination: 'new-temporary-workspace',
      candidateTimelineId: 'timeline-selection-candidate',
    }) as unknown as JsonValue,
    completedAt: '2026-08-07T00:00:00.500Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'approval interaction was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval') throw new Error('expected approval');
  assert.deepEqual(approval.scope, ['selection.roster', 'timeline.structure', 'buff.attachments', 'buff.resistance', 'loadout.config']);
  if (!approval.candidate) throw new Error('expected prepared selection candidate');
  assert.equal(gateway.commands.length, 1, 'approval must gate live apply dispatch');
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, productBinding);
  const command = await waitFor(() => gateway.commands[1], 'approved command was not dispatched');
  assert.equal(command.command.op, 'workbench.execute-command');
  if (command.command.op !== 'workbench.execute-command') throw new Error('expected selection apply command');
  assert.deepEqual(command.command.payload.command, {
    op: 'applyReviewedWorkNodeProposal',
    operation: 'selection.apply',
    candidate: approval.candidate,
  });
  assert.ok(command.approvalCapability);
  const claims = verifyApprovalCapabilityToken(
    command.approvalCapability!,
    host.getApprovalVerificationKey(),
  );
  assert.equal(claims.interactionId, approval.interactionId);
  assert.equal(claims.commandId, command.commandId);
  assert.equal(claims.schemaVersion, 2);
  assert.deepEqual(claims.candidate, approval.candidate);
  assert.deepEqual(claims.scope, approval.scope);
  const postMutationBinding: ProductBinding = {
    ...productBinding,
    checkoutTargetId: 'node-ai-selection',
    checkoutUpdatedAt: 11,
    contentRevision: 5,
    snapshotDigest: 'sha256:interactive-5',
  };
  gateway.settle({
    commandId: command.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 5,
    browserResult: { selectedCharacters: ['洛茜'] },
    visiblePostcondition: JSON.parse(JSON.stringify({
      pass: true,
      contentRevision: 5,
      binding: postMutationBinding,
    })) as JsonValue,
    completedAt: '2026-08-07T00:00:02.000Z',
  });
  const terminal = await host.waitForTurnTerminal(turn.defTurnId);
  assert.equal(terminal.type, 'turn.completed');
  const events = host.readEvents(session.defSessionId);
  assert.equal(events.some((event) => event.type === 'command.queued'), true);
  assert.equal(events.some((event) => event.type === 'command.result' && event.payload.status === 'succeeded'), true);
  assert.equal(host.readSession(session.defSessionId, postMutationBinding).boundNodeId, 'node-ai-selection');

  // A successful mutation has already moved the Session to the exact Browser
  // binding. The next Turn can use it without a manual rebinding repair.
  gateway.snapshot = {
    protocolVersion: 1,
    binding: postMutationBinding,
    capturedAt: '2026-08-07T00:00:03.000Z',
    payload: {
      schemaVersion: 1,
      currentView: 'canvas',
      selectedCharacters: [{ id: 'operator-luoxi', name: '洛茜' }],
      skillButtons: [],
    },
  };
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-after-selection-apply'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'inspect' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('inspect-after-selection-apply'),
      name: 'def.node.crud.context',
      input: {},
    },
    { type: 'complete', output: { ok: true } },
  ]);
  const followUp = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '继续检查修改后的队伍',
    binding: postMutationBinding,
  });
  assert.equal((await host.waitForTurnTerminal(followUp.defTurnId)).type, 'turn.completed');
  assert.equal(host.readSession(session.defSessionId, postMutationBinding).boundNodeId, 'node-ai-selection');
  await host.shutdown();
}

// A temporary selection candidate is allowed only when it is a distinct
// candidate Timeline and the Product proposal still binds its source checkout
// exactly. Destination, intent and source-checkout tampering never publishes
// an approval interaction.
for (const [suffix, proposalOptions] of [
  ['selection-forged-timeline', { candidateTimelineId: productBinding.timelineId }],
  ['selection-forged-intent', { intent: 'timeline' as const, candidateTimelineId: 'timeline-selection-forged-intent' }],
  ['selection-forged-source-checkout', { candidateTimelineId: 'timeline-selection-forged-source', sourceCheckoutTargetId: 'tampered-source-target' }],
] as const) {
  const { engine, gateway, host } = fixture();
  enqueuePreparedSelection(engine, suffix);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: `验证 ${suffix}`,
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], `${suffix} prepare was not dispatched`);
  const proposal = preparedProposal(productBinding, 'selection.apply', {
    intent: proposalOptions.intent ?? 'selection',
    destination: 'new-temporary-workspace',
    candidateTimelineId: proposalOptions.candidateTimelineId,
    sourceCheckoutTargetId: proposalOptions.sourceCheckoutTargetId,
    scope: ['selection.roster', 'timeline.structure', 'buff.attachments', 'buff.resistance', 'loadout.config'],
  });
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: proposal as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:00.500Z',
  });
  const cleanup = await waitFor(() => gateway.commands[1], `${suffix} cleanup was not dispatched`);
  assert.equal(cleanup.command.op, 'workbench.execute-command');
  if (cleanup.command.op !== 'workbench.execute-command') throw new Error(`expected ${suffix} cleanup command`);
  assert.equal(cleanup.command.payload.command.op, 'abandonPreparedWorkNodeProposal');
  const cleanupCandidate = cleanup.command.payload.command.candidate as unknown as DefPreparedWorkNodeCandidateRefV1;
  gateway.settle({
    commandId: cleanup.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: cleanupBrowserResult(cleanupCandidate),
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.failed');
  assert.equal(host.listPendingInteractions(productBinding).length, 0);
  assert.equal(host.readEvents(session.defSessionId).some((event) => (
    event.type === 'interaction.requested' && event.defTurnId === turn.defTurnId
  )), false);
  await host.shutdown();
}

// Timeline removal reads the authoritative set, then applies one approved Work Node patch for the whole group.
{
  const { engine, gateway, host } = fixture();
  gateway.snapshot = {
    protocolVersion: 1,
    binding: productBinding,
    capturedAt: '2026-08-07T00:00:00.000Z',
    payload: {
      schemaVersion: 1,
      selectedCharacters: [],
      skillButtons: [
        {
          id: 'bzb6ptf17',
          characterId: 'operator-luoxi',
          characterName: '洛茜',
          skillType: 'A',
          staffIndex: 0,
          lineIndex: 0,
          persistenceStaffIndex: 0,
          persistenceNodeIndex: 0,
          selectedBuffIds: [],
        },
        {
          id: 'k1n3s6ze4',
          characterId: 'operator-luoxi',
          characterName: '洛茜',
          skillType: 'A',
          staffIndex: 0,
          lineIndex: 0,
          persistenceStaffIndex: 0,
          persistenceNodeIndex: 1,
          selectedBuffIds: [],
        },
      ],
    },
  };
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-bulk-remove'),
      name: 'def.harness.route',
      input: { businessId: 'timeline', operation: 'remove' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('read-bulk-remove-targets'),
      name: 'def.node.crud.current',
      input: {},
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('apply-bulk-remove'),
      name: 'def.workbench.remove_skill_button',
      input: { buttonIds: ['bzb6ptf17', 'k1n3s6ze4'] },
    },
    { type: 'complete', output: { removed: 2 } },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '把洛茜这一组技能按钮都删掉',
    binding: productBinding,
  });
  const prepareCommand = await waitFor(() => gateway.commands[0], 'bulk removal prepare command was not dispatched');
  assert.equal(prepareCommand.command.op, 'workbench.execute-command');
  if (prepareCommand.command.op !== 'workbench.execute-command') throw new Error('expected prepare command');
  assert.deepEqual(prepareCommand.command.payload.command, {
    op: 'prepareReviewedWorkNodeProposal',
    operation: 'timeline.remove',
    intent: 'timeline',
    scope: ['timeline.structure'],
    patch: [
      { op: 'removeButton', target: { buttonId: 'bzb6ptf17' } },
      { op: 'removeButton', target: { buttonId: 'k1n3s6ze4' } },
    ],
    label: '移除 2 个技能按钮',
    description: '从当前排轴移除 2 个已确认的技能按钮，并由工作节点验证变更。',
    sourceBinding: productBinding,
  });
  gateway.settle({
    commandId: prepareCommand.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(productBinding, 'timeline.remove') as unknown as JsonValue,
    completedAt: '2026-08-07T00:00:01.000Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'bulk removal approval interaction was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval') throw new Error('expected approval');
  assert.deepEqual(approval.scope, ['timeline.structure']);
  assert.equal(approval.proposalHash, approval.candidate?.proposalDigest);
  assert.ok(approval.candidateReview);
  assert.deepEqual(approval.proposal, preparedProposal(productBinding, 'timeline.remove'));
  assert.equal(gateway.commands.length, 1);
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, productBinding);
  const command = await waitFor(() => gateway.commands[1], 'bulk removal apply command was not dispatched');
  assert.equal(command.command.op, 'workbench.execute-command');
  if (command.command.op !== 'workbench.execute-command') throw new Error('expected workbench command');
  assert.deepEqual(command.command.payload.command, {
    op: 'applyReviewedWorkNodeProposal',
    operation: 'timeline.remove',
    candidate: approval.candidate,
  });
  assert.ok(command.approvalCapability);
  const claims = verifyApprovalCapabilityToken(command.approvalCapability!, host.getApprovalVerificationKey());
  assert.equal(claims.schemaVersion, 2);
  assert.deepEqual(claims.candidate, approval.candidate);
  gateway.settle({
    commandId: command.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 5,
    browserResult: {
      removedButtonIds: ['bzb6ptf17', 'k1n3s6ze4'],
      candidate: approval.candidate ? structuredClone(approval.candidate) : undefined,
    } as unknown as JsonValue,
    visiblePostcondition: { contentRevision: 5 },
    completedAt: '2026-08-07T00:00:02.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.completed');
  assert.deepEqual(
    host.readEvents(session.defSessionId)
      .filter((event) => event.type === 'harness.tool.projected')
      .map((event) => event.payload.tools),
    [
      ['def.harness.route'],
      ['def.node.crud.current'],
      ['def.workbench.remove_skill_button'],
      [],
    ],
  );
  const journal = host.readEvents(session.defSessionId);
  const prepareResultIndex = journal.findIndex((event) => (
    event.type === 'command.result' && event.commandId === prepareCommand.commandId
  ));
  const interactionRequestedIndex = journal.findIndex((event) => (
    event.type === 'interaction.requested' && event.interactionId === approval.interactionId
  ));
  const approvedIndex = journal.findIndex((event) => (
    event.type === 'interaction.resolved'
      && event.interactionId === approval.interactionId
      && event.payload.status === 'approved'
  ));
  const applyQueuedIndex = journal.findIndex((event) => (
    event.type === 'command.queued' && event.commandId === command.commandId
  ));
  assert.ok(prepareResultIndex >= 0);
  assert.ok(prepareResultIndex < interactionRequestedIndex);
  assert.ok(interactionRequestedIndex < approvedIndex);
  assert.ok(approvedIndex < applyQueuedIndex);
  const requested = journal.find((event) => (
    event.type === 'interaction.requested' && event.interactionId === approval.interactionId
  ));
  assert.equal(requested?.type, 'interaction.requested');
  if (requested?.type === 'interaction.requested') {
    assert.deepEqual(requested.payload.proposal, approval.proposal);
    assert.deepEqual(requested.payload.candidate, approval.candidate);
    assert.deepEqual(requested.payload.candidateReview, approval.candidateReview);
  }
  await host.shutdown();
}

// A fresh snapshot baseline is a valid prepared source even without a
// checkout target. The Host binds the proposal to the pinned snapshot and
// still constructs the V2 apply candidate itself.
{
  const { engine, gateway, host } = fixture();
  const snapshotBinding: ProductBinding = {
    ...productBinding,
    checkoutTargetId: null,
    snapshotDigest: 'sha256:interactive-snapshot-4',
  };
  gateway.snapshot = { ...gateway.snapshot, binding: snapshotBinding };
  enqueuePreparedRemoval(engine, 'snapshot-baseline');
  const session = await createSession(host, snapshotBinding);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '从当前快照准备排轴修改',
    binding: snapshotBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'snapshot prepare was not dispatched');
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(snapshotBinding, 'timeline.remove', {
      targetType: 'snapshot',
      sourceTargetId: 'snapshot-baseline',
    }) as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(snapshotBinding)[0],
    'snapshot baseline approval was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval' || !approval.candidate) throw new Error('expected snapshot approval candidate');
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, snapshotBinding);
  const apply = await waitFor(() => gateway.commands[1], 'snapshot apply was not dispatched');
  assert.equal(apply.command.op, 'workbench.execute-command');
  if (apply.command.op !== 'workbench.execute-command') throw new Error('expected snapshot apply command');
  assert.equal(apply.command.payload.command.op, 'applyReviewedWorkNodeProposal');
  assert.deepEqual(apply.command.payload.command.candidate, approval.candidate);
  gateway.settle({
    commandId: apply.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 5,
    browserResult: { candidate: structuredClone(approval.candidate) } as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:02.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.completed');
  await host.shutdown();
}

// Loadout apply is a separate-Turn consumer of the persisted preview result.
// The second Turn supplies only the proposal identity; the Host restores the
// exact finalConfig from the completed preview journal before approval.
{
  const { engine, gateway, host } = fixture();
  const finalConfig = {
    characterId: 'operator-luoxi',
    weaponName: '测试武器',
    weaponLevel: 90,
    potential: '满潜',
    operatorSkillLevels: { A: 'M3' },
  };
  const proposalDigest = 'sha256:' + 'a'.repeat(64);
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-loadout-preview'),
      name: 'def.harness.route',
      input: { businessId: 'loadout', operation: 'preview' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('loadout-preview-current'),
      name: 'def.data.resource.team_loadouts',
      input: { action: 'current' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('loadout-preview-catalog'),
      name: 'def.data.catalog.query',
      input: {
        action: 'compareLoadoutCandidate',
        operatorQuery: 'operator-luoxi',
        candidate: { weaponId: 'weapon-test' },
      },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('loadout-preview'),
      name: 'def.loadout.preview',
      input: {
        characterId: 'operator-luoxi',
        weaponName: '测试武器',
        weaponLevel: 90,
        potential: '满潜',
        operatorSkillLevels: { A: 'M3' },
      },
    },
    { type: 'complete', output: { preview: true } },
  ]);
  const session = await createSession(host);
  const previewTurn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '执行配装预览测试流程',
    binding: productBinding,
  });
  const catalogCommand = await waitFor(() => gateway.commands[0], 'loadout catalog command was not dispatched');
  assert.equal(catalogCommand.command.op, 'workbench.execute-command');
  if (catalogCommand.command.op !== 'workbench.execute-command') throw new Error('expected loadout catalog command');
  assert.equal(catalogCommand.command.payload.command.op, 'queryAgentProductCatalog');
  assert.deepEqual(catalogCommand.command.payload.command, {
    op: 'queryAgentProductCatalog',
    action: 'compareLoadoutCandidate',
    operatorQuery: 'operator-luoxi',
    candidate: { weaponId: 'weapon-test' },
    currentLoadout: {
      contract: 'DefTeamLoadoutsV1',
      binding: productBinding,
      complete: true,
      missingCharacterIds: [],
      operators: [],
    },
  });
  gateway.settle({
    commandId: catalogCommand.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: { contract: 'DefProductCatalogQueryV1', candidates: [] },
    completedAt: '2026-08-08T00:00:00.500Z',
  });
  const previewCommand = await waitFor(() => gateway.commands[1], 'loadout preview command was not dispatched');
  assert.equal(previewCommand.command.op, 'workbench.execute-command');
  if (previewCommand.command.op !== 'workbench.execute-command') throw new Error('expected loadout preview command');
  assert.equal(previewCommand.command.payload.command.op, 'prepareOperatorConfigProposal');
  gateway.settle({
    commandId: previewCommand.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: {
      contract: 'DefPreparedLoadoutProposalV1',
      parentNodeId: productBinding.checkoutTargetId,
      parentRevision: productBinding.contentRevision,
      nodeId: 'loadout-candidate',
      nodeRevision: 7,
      proposalDigest,
      finalConfig,
      semanticDiff: { changedPaths: ['/weaponName'] },
    } as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(previewTurn.defTurnId)).type, 'turn.completed');

  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-loadout-apply'),
      name: 'def.harness.route',
      input: { businessId: 'loadout', operation: 'apply' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('loadout-apply-prepared'),
      name: 'def.loadout.apply_prepared',
      input: {
        parentNodeId: productBinding.checkoutTargetId,
        parentRevision: productBinding.contentRevision,
        nodeId: 'loadout-candidate',
        nodeRevision: 7,
        proposalDigest,
      },
    },
    { type: 'complete', output: { applied: true } },
  ]);
  const applyTurn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '执行配装应用测试流程',
    binding: productBinding,
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'loadout apply approval was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval') throw new Error('expected loadout apply approval');
  assert.equal(gateway.commands.length, 2, 'loadout apply must wait for approval');
  assert.deepEqual((approval.proposal as { source?: { finalConfig?: JsonValue } }).source?.finalConfig, finalConfig);
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, productBinding);
  const applyCommand = await waitFor(() => gateway.commands[2], 'loadout apply command was not dispatched');
  assert.equal(applyCommand.command.op, 'workbench.execute-command');
  if (applyCommand.command.op !== 'workbench.execute-command') throw new Error('expected loadout apply command');
  assert.deepEqual(applyCommand.command.payload.command, {
    op: 'applyPreparedOperatorConfigProposal',
    parentNodeId: productBinding.checkoutTargetId,
    parentRevision: productBinding.contentRevision,
    nodeId: 'loadout-candidate',
    nodeRevision: 7,
    proposalDigest,
    finalConfig,
    approval: {
      mode: 'manual',
      approvedBy: 'user',
      rationale: 'Approved in the embedded DEF AI mode.',
    },
  });
  gateway.settle({
    commandId: applyCommand.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 5,
    browserResult: { applied: true },
    completedAt: '2026-08-08T00:00:02.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(applyTurn.defTurnId)).type, 'turn.completed');
  await host.shutdown();
}

// Rejection must abandon the exact Host-derived candidate and journal the
// Product's final deletion audit.
{
  const { engine, gateway, host } = fixture();
  enqueuePreparedRemoval(engine, 'reject-cleanup');
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '拒绝排轴候选',
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'reject prepare was not dispatched');
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(productBinding, 'timeline.remove') as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'reject cleanup approval was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval' || !approval.candidate) throw new Error('expected reject candidate');
  host.resolveInteraction(approval.interactionId, { status: 'rejected' }, productBinding);
  const cleanup = await waitFor(() => gateway.commands[1], 'reject cleanup was not dispatched');
  assert.equal(cleanup.command.op, 'workbench.execute-command');
  if (cleanup.command.op !== 'workbench.execute-command') throw new Error('expected cleanup command');
  assert.equal(cleanup.command.payload.command.op, 'abandonPreparedWorkNodeProposal');
  assert.deepEqual(cleanup.command.payload.command.candidate, approval.candidate);
  gateway.settle({
    commandId: cleanup.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: cleanupBrowserResult(approval.candidate),
    completedAt: '2026-08-08T00:00:02.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.failed');
  const audit = host.readEvents(session.defSessionId).find((event) => (
    event.type === 'interaction.resolved'
      && event.interactionId === approval.interactionId
      && event.payload.cleanup
  ));
  assert.equal(audit?.type, 'interaction.resolved');
  if (audit?.type === 'interaction.resolved') {
    assert.equal(audit.payload.cleanup?.status, 'deleted');
  }
  assert.equal(
    gateway.commands.some((command) => (
      command.command.op === 'workbench.execute-command'
      && command.command.payload.command.op === 'applyReviewedWorkNodeProposal'
    )),
    false,
  );
  await host.shutdown();
}

async function assertPreparedProposalTamperRejected(
  suffix: string,
  mutate: (proposal: DefPreparedWorkNodeProposalV1) => DefPreparedWorkNodeProposalV1,
): Promise<void> {
  const { engine, gateway, host } = fixture();
  enqueuePreparedRemoval(engine, 'tamper-' + suffix);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '拒绝篡改的排轴候选 ' + suffix,
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'tamper prepare was not dispatched');
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: mutate(structuredClone(preparedProposal(productBinding, 'timeline.remove'))) as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  const cleanup = await waitFor(() => gateway.commands[1], 'tamper cleanup was not dispatched');
  assert.equal(cleanup.command.op, 'workbench.execute-command');
  if (cleanup.command.op !== 'workbench.execute-command') throw new Error('expected tamper cleanup command');
  assert.equal(cleanup.command.payload.command.op, 'abandonPreparedWorkNodeProposal');
  const cleanupCandidate = cleanup.command.payload.command.candidate as unknown as DefPreparedWorkNodeCandidateRefV1;
  gateway.settle({
    commandId: cleanup.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: cleanupBrowserResult(cleanupCandidate),
    completedAt: '2026-08-08T00:00:02.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.failed');
  assert.equal(gateway.commands.length, 2);
  assert.equal(host.listPendingInteractions(productBinding).length, 0);
  const error = host.readEvents(session.defSessionId).find((event) => (
    event.type === 'tool.error' && event.toolCallId === asToolCallId('remove-prepared-tamper-' + suffix)
  ));
  assert.equal(error?.type, 'tool.error');
  if (error?.type === 'tool.error') assert.equal(error.payload.code, 'DEF_PRODUCT_COMMAND_FAILED');
  await host.shutdown();
}

await assertPreparedProposalTamperRejected('binding', (proposal) => ({
  ...proposal,
  sourceBinding: { ...proposal.sourceBinding, contentRevision: 99 },
}));
await assertPreparedProposalTamperRejected('revision', (proposal) => ({
  ...proposal,
  sourceRevision: 99,
  sourceCheckout: { ...proposal.sourceCheckout, revision: 99 },
}));
await assertPreparedProposalTamperRejected('digest', (proposal) => ({
  ...proposal,
  diffDigest: 'sha256:' + '9'.repeat(64),
  review: {
    ...proposal.review,
    manifest: { ...proposal.review.manifest, diffDigest: 'sha256:' + '9'.repeat(64) },
  },
}));
await assertPreparedProposalTamperRejected('scope', (proposal) => ({
  ...proposal,
  scope: ['buff.attachments'],
  review: {
    ...proposal.review,
    manifest: { ...proposal.review.manifest, scope: ['buff.attachments'] },
  },
}));

// Expiration follows the same cleanup path as rejection and records deletion.
{
  const { engine, gateway, host } = fixture();
  enqueuePreparedRemoval(engine, 'timeout-cleanup');
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '等待排轴审批超时',
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'timeout prepare was not dispatched');
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(productBinding, 'timeline.remove') as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'timeout cleanup approval was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval' || !approval.candidate) throw new Error('expected timeout candidate');
  host.resolveInteraction(approval.interactionId, { status: 'expired' }, productBinding);
  const cleanup = await waitFor(() => gateway.commands[1], 'timeout cleanup was not dispatched');
  if (cleanup.command.op !== 'workbench.execute-command') throw new Error('expected timeout cleanup command');
  gateway.settle({
    commandId: cleanup.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: cleanupBrowserResult(approval.candidate),
    completedAt: '2026-08-08T00:00:02.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.failed');
  const audit = host.readEvents(session.defSessionId).find((event) => (
    event.type === 'interaction.resolved'
      && event.interactionId === approval.interactionId
      && event.payload.cleanup
  ));
  assert.equal(audit?.type, 'interaction.resolved');
  if (audit?.type === 'interaction.resolved') assert.equal(audit.payload.cleanup?.status, 'deleted');
  await host.shutdown();
}

// If the checkout changes while approval is open, cleanup must not dispatch
// against a stale binding; it preserves the candidate with an explicit audit.
{
  const { engine, gateway, host } = fixture();
  enqueuePreparedRemoval(engine, 'stale-cleanup');
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '切换 checkout 后批准排轴候选',
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'stale prepare was not dispatched');
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(productBinding, 'timeline.remove') as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'stale cleanup approval was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval' || !approval.candidate) throw new Error('expected stale candidate');
  const staleBinding: ProductBinding = {
    ...productBinding,
    checkoutTargetId: 'node-changed-during-approval',
    checkoutUpdatedAt: 11,
    contentRevision: 5,
    snapshotDigest: 'sha256:interactive-5',
  };
  gateway.snapshot = { ...gateway.snapshot, binding: staleBinding };
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, productBinding);
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.failed');
  assert.equal(gateway.commands.length, 1);
  const audit = host.readEvents(session.defSessionId).find((event) => (
    event.type === 'interaction.resolved'
      && event.interactionId === approval.interactionId
      && event.payload.cleanup
  ));
  assert.equal(audit?.type, 'interaction.resolved');
  if (audit?.type === 'interaction.resolved') {
    assert.equal(audit.payload.cleanup?.status, 'preserved');
    assert.match(audit.payload.cleanup?.reason ?? '', /binding/u);
  }
  const error = host.readEvents(session.defSessionId).find((event) => (
    event.type === 'tool.error' && event.toolCallId === asToolCallId('remove-prepared-stale-cleanup')
  ));
  assert.equal(error?.type, 'tool.error');
  if (error?.type === 'tool.error') assert.equal(error.payload.code, 'DEF_INTERACTION_STALE');
  await host.shutdown();
}

// An apply failure still runs cleanup. A cleanup failure is audited separately
// and never replaces the original apply error.
{
  const { engine, gateway, host } = fixture();
  enqueuePreparedRemoval(engine, 'apply-failure-cleanup');
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '应用排轴候选失败',
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'apply-failure prepare was not dispatched');
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(productBinding, 'timeline.remove') as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'apply-failure approval was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval' || !approval.candidate) throw new Error('expected apply-failure candidate');
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, productBinding);
  const apply = await waitFor(() => gateway.commands[1], 'apply-failure apply was not dispatched');
  gateway.settle({
    commandId: apply.commandId,
    status: 'error',
    code: 'PRODUCT_APPLY_FAILED',
    message: 'apply failed',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: { error: 'apply failed' },
    completedAt: '2026-08-08T00:00:02.000Z',
  });
  const cleanup = await waitFor(() => gateway.commands[2], 'apply-failure cleanup was not dispatched');
  if (cleanup.command.op !== 'workbench.execute-command') throw new Error('expected apply-failure cleanup command');
  gateway.settle({
    commandId: cleanup.commandId,
    status: 'error',
    code: 'CLEANUP_FAILED',
    message: 'cleanup failed',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: { error: 'cleanup failed' },
    completedAt: '2026-08-08T00:00:03.000Z',
  });
  assert.equal((await host.waitForTurnTerminal(turn.defTurnId)).type, 'turn.failed');
  const events = host.readEvents(session.defSessionId);
  const error = events.find((event) => (
    event.type === 'tool.error' && event.toolCallId === asToolCallId('remove-prepared-apply-failure-cleanup')
  ));
  assert.equal(error?.type, 'tool.error');
  if (error?.type === 'tool.error') {
    assert.equal(error.payload.code, 'DEF_PRODUCT_COMMAND_FAILED');
    assert.match(error.payload.message, /apply failed/u);
    assert.doesNotMatch(error.payload.message, /cleanup failed/u);
  }
  const audit = events.find((event) => (
    event.type === 'interaction.resolved'
      && event.interactionId === approval.interactionId
      && event.payload.cleanup
  ));
  assert.equal(audit?.type, 'interaction.resolved');
  if (audit?.type === 'interaction.resolved') assert.equal(audit.payload.cleanup?.status, 'failed');
  await host.shutdown();
}

// Rejection is terminal for the proposed Harness action and dispatches nothing.
{
  const { engine, gateway, host } = fixture();
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-rejected-selection'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'apply' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('context-rejected-selection'),
      name: 'def.node.crud.context',
      input: {},
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('reject-selection'),
      name: 'def.team.selection.apply',
      input: {
        operation: 'apply',
        characterNames: ['洛茜'],
        nodeTitle: '调整阵容：仅保留洛茜',
        nodeDescription: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
      },
    },
    { type: 'complete' },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '尝试改队伍',
    binding: productBinding,
  });
  const prepare = await waitFor(() => gateway.commands[0], 'rejected selection prepare was not dispatched');
  assert.equal(prepare.command.op, 'workbench.execute-command');
  if (prepare.command.op !== 'workbench.execute-command') throw new Error('expected rejected selection prepare command');
  gateway.settle({
    commandId: prepare.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: preparedProposal(productBinding, 'selection.apply', {
      intent: 'selection',
      scope: ['selection.roster', 'timeline.structure', 'buff.attachments', 'buff.resistance', 'loadout.config'],
      destination: 'new-temporary-workspace',
      candidateTimelineId: 'timeline-rejected-selection-candidate',
    }) as unknown as JsonValue,
    completedAt: '2026-08-08T00:00:00.500Z',
  });
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'rejection approval interaction was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval' || !approval.candidate) throw new Error('expected rejection candidate');
  host.resolveInteraction(approval.interactionId, { status: 'rejected' }, productBinding);
  const cleanup = await waitFor(() => gateway.commands[1], 'rejected selection cleanup was not dispatched');
  assert.equal(cleanup.command.op, 'workbench.execute-command');
  if (cleanup.command.op !== 'workbench.execute-command') throw new Error('expected rejected selection cleanup command');
  assert.equal(cleanup.command.payload.command.op, 'abandonPreparedWorkNodeProposal');
  gateway.settle({
    commandId: cleanup.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: cleanupBrowserResult(approval.candidate),
    completedAt: '2026-08-08T00:00:01.000Z',
  });
  const terminal = await host.waitForTurnTerminal(turn.defTurnId);
  assert.equal(terminal.type, 'turn.failed');
  assert.equal(gateway.commands.length, 2);
  assert.equal(gateway.commands.some((command) => (
    command.command.op === 'workbench.execute-command'
      && command.command.payload.command.op === 'applyReviewedWorkNodeProposal'
  )), false);
  assert.equal(host.readEvents(session.defSessionId).some((event) => (
    event.type === 'tool.error' && event.payload.code === 'DEF_INTERACTION_REJECTED'
  )), true);
  await host.shutdown();
}

// Stopping a Turn resolves its pending question and leaves no dead interaction.
{
  const { engine, host } = fixture();
  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-stop-question'),
      name: 'def.harness.route',
      input: {
        businessId: 'selection',
        operation: 'ask',
        resume: { steps: [{ businessId: 'selection', operation: 'inspect' }] },
      },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('stop-question'),
      name: 'def.user.ask',
      input: { prompt: '等待停止' },
    },
  ]);
  const session = await createSession(host);
  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: '开始后停止',
    binding: productBinding,
  });
  await waitFor(() => host.listPendingInteractions(productBinding)[0], 'stop question was not published');
  await host.abortTurn(turn.defTurnId, 'USER_STOPPED', productBinding);
  const terminal = await host.waitForTurnTerminal(turn.defTurnId);
  assert.equal(terminal.type, 'turn.stopped');
  assert.deepEqual(host.listPendingInteractions(productBinding), []);
  assert.equal(host.readEvents(session.defSessionId).some((event) => (
    event.type === 'interaction.resolved' && event.payload.status === 'cancelled'
  )), true);
  await host.shutdown();
}

console.log('DEF_AGENT_INTERACTIVE_HOST_CONTRACT_OK');
