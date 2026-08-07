import assert from 'node:assert/strict';
import {
  asDatabaseGeneration,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  canonicalJson,
  type CommandId,
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

async function createSession(host: DefAgentHost) {
  return host.createSession({ binding: productBinding, providerProfileRef: 'test' });
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

// A mutation cannot reach the Browser until the matching approval is granted.
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
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'approval interaction was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval') throw new Error('expected approval');
  assert.deepEqual(approval.scope, ['selection.roster']);
  assert.equal(gateway.commands.length, 0, 'approval must gate Browser dispatch');
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, productBinding);
  const command = await waitFor(() => gateway.commands[0], 'approved command was not dispatched');
  assert.equal(command.command.op, 'workbench.execute-command');
  assert.ok(command.approvalCapability);
  const claims = verifyApprovalCapabilityToken(
    command.approvalCapability!,
    host.getApprovalVerificationKey(),
  );
  assert.equal(claims.interactionId, approval.interactionId);
  assert.equal(claims.commandId, command.commandId);
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
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'bulk removal approval interaction was not published',
  );
  assert.equal(approval.kind, 'approval');
  if (approval.kind !== 'approval') throw new Error('expected approval');
  assert.deepEqual(approval.scope, ['timeline.buttons', 'timeline.work-node', 'timeline.checkout']);
  assert.equal(gateway.commands.length, 0);
  host.resolveInteraction(approval.interactionId, { status: 'approved' }, productBinding);
  const command = await waitFor(() => gateway.commands[0], 'bulk removal command was not dispatched');
  assert.equal(command.command.op, 'workbench.execute-command');
  if (command.command.op !== 'workbench.execute-command') throw new Error('expected workbench command');
  assert.deepEqual(command.command.payload.command, {
    op: 'applyApprovedWorkNodePatch',
    patch: [
      { op: 'removeButton', target: { buttonId: 'bzb6ptf17' } },
      { op: 'removeButton', target: { buttonId: 'k1n3s6ze4' } },
    ],
    label: '移除 2 个技能按钮',
    description: '从当前排轴移除 2 个已确认的技能按钮，并由工作节点验证变更。',
  });
  gateway.settle({
    commandId: command.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 5,
    browserResult: { removedButtonIds: ['bzb6ptf17', 'k1n3s6ze4'] },
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
  const approval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'rejection approval interaction was not published',
  );
  host.resolveInteraction(approval.interactionId, { status: 'rejected' }, productBinding);
  const terminal = await host.waitForTurnTerminal(turn.defTurnId);
  assert.equal(terminal.type, 'turn.failed');
  assert.equal(gateway.commands.length, 0);
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
