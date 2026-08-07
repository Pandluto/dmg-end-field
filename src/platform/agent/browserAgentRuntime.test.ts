import assert from 'node:assert/strict';
import {
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
} from '../../../agent/core/contracts/ids.ts';
import { canonicalJson, type JsonValue } from '../../../agent/core/contracts/json.ts';
import { ApprovalCapabilitySigner } from '../../../agent/host/approval-capability-signer.ts';
import type {
  BrowserCommandClaim,
  BrowserCommandJournalRecord,
  BrowserProductStore,
  BrowserWorkspaceIdentity,
  RuntimeSnapshotInput,
} from './browserProductStore';
import type {
  BrowserCommandDelivery,
  BrowserCommandResultSubmission,
  BrowserSnapshotPublish,
  BrowserWorkbenchConsumerState,
  Phase2ProductCommand,
  ProductCommandResult,
  ProductSnapshotEnvelope,
} from '../../../agent/core/contracts/index.ts';
import {
  AGENT_SELECTION_WORKSPACE_TIMELINE_ID,
  BrowserAgentRuntime,
} from './browserAgentRuntime';

const binding = {
  workspaceId: asWorkspaceId('workspace-runtime'),
  databaseGeneration: asDatabaseGeneration('generation-runtime'),
  timelineId: asTimelineId('timeline-runtime'),
  checkoutTargetId: 'checkout-runtime',
  checkoutUpdatedAt: 100,
  contentRevision: 100,
  snapshotDigest: 'sha256:runtime',
};

const consumer: BrowserWorkbenchConsumerState = {
  consumerId: 'consumer-runtime',
  executorLeaseId: 'lease-runtime',
  binding,
  registeredAt: 1,
  heartbeatExpiresAt: 20_000,
};

const productCommand: Phase2ProductCommand = {
  protocolVersion: 1,
  commandId: asCommandId('command-runtime'),
  defSessionId: asDefSessionId('session-runtime'),
  defTurnId: asDefTurnId('turn-runtime'),
  toolCallId: asToolCallId('tool-runtime'),
  expected: binding,
  command: { op: 'workbench.refresh-snapshot', payload: { reason: 'agent-read' } },
};
const approvalSigner = new ApprovalCapabilitySigner({ keyEpoch: 'approval-runtime-test' });

async function withApprovalCapability(
  command: Phase2ProductCommand,
  options: { readonly expiresAt?: string; readonly proposalCommand?: JsonValue } = {},
): Promise<Phase2ProductCommand> {
  if (command.command.op !== 'workbench.execute-command') throw new Error('approval fixture requires execute-command');
  const scope = ['selection.roster'];
  const proposal = {
    command: options.proposalCommand ?? command.command.payload.command,
    scope,
  };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(proposal)),
  );
  const proposalHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const claims = {
    schemaVersion: 1,
    audience: 'browser-product-gateway',
    keyEpoch: approvalSigner.verificationKey.keyEpoch,
    nonce: `nonce-${command.commandId}`,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
    interactionId: asInteractionId(`interaction-${command.commandId}`),
    commandId: command.commandId,
    defSessionId: command.defSessionId,
    defTurnId: command.defTurnId,
    toolCallId: command.toolCallId,
    proposalHash,
    binding: command.expected,
    scope,
  };
  return {
    ...command,
    approvalCapability: approvalSigner.sign(claims),
  };
}

function makeJournal(command: Phase2ProductCommand = productCommand): BrowserCommandJournalRecord {
  return {
    commandId: command.commandId,
    commandJournalSchemaVersion: 1,
    operation: command.command.op,
    command: command.command,
    workspaceId: binding.workspaceId,
    databaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    checkoutTargetId: binding.checkoutTargetId,
    checkoutUpdatedAt: binding.checkoutUpdatedAt,
    expectedRevision: binding.contentRevision,
    expectedDigest: binding.snapshotDigest,
    defSessionId: command.defSessionId,
    defTurnId: command.defTurnId,
    toolCallId: command.toolCallId,
    status: 'claimed',
    executorLeaseId: consumer.executorLeaseId,
    beforeRevision: null,
    afterRevision: null,
    browserResult: null,
    visiblePostcondition: null,
    receiptDigest: null,
    errorCode: null,
    errorMessage: null,
    acceptedAt: '2026-08-07T00:00:00.000Z',
    claimedAt: '2026-08-07T00:00:00.000Z',
    completedAt: null,
    commandDigest: 'sha256:command',
  };
}

class FakeStore implements BrowserProductStore {
  initialized = 0;
  snapshotInputs: RuntimeSnapshotInput[] = [];
  snapshotBinding = binding;
  claims = 0;
  result: ProductCommandResult | null = null;
  lastCommand: Phase2ProductCommand = productCommand;
  readonly events: string[];

  constructor(events: string[]) { this.events = events; }

  async initialize(): Promise<BrowserWorkspaceIdentity> {
    this.initialized += 1;
    return {
      workspaceId: binding.workspaceId,
      databaseGeneration: binding.databaseGeneration,
      agentRuntimeSchemaVersion: 1,
      commandJournalSchemaVersion: 1,
    };
  }

  readIdentity(): Promise<BrowserWorkspaceIdentity> { return this.initialize(); }
  rotateDatabaseGeneration(): Promise<BrowserWorkspaceIdentity> { return this.initialize(); }

  async createRuntimeSnapshot(input: RuntimeSnapshotInput): Promise<ProductSnapshotEnvelope> {
    this.snapshotInputs.push(input);
    return { protocolVersion: 1, binding: this.snapshotBinding, capturedAt: input.capturedAt!, payload: input.payload };
  }

  async readRuntimeSnapshot(): Promise<ProductSnapshotEnvelope | null> { return null; }

  async claimCommand(command: Phase2ProductCommand): Promise<BrowserCommandClaim> {
    this.claims += 1;
    this.lastCommand = command;
    return { kind: 'claimed', journal: makeJournal(command) };
  }

  async recordCommandResult(
    commandId: ReturnType<typeof asCommandId>,
    input: Omit<ProductCommandResult, 'commandId' | 'completedAt'> & { completedAt?: string },
  ): Promise<ProductCommandResult> {
    this.events.push('journal-result');
    this.result = {
      ...input,
      commandId,
      completedAt: input.completedAt || '2026-08-07T00:00:01.000Z',
    };
    return this.result;
  }

  async getCommand(): Promise<BrowserCommandJournalRecord | null> { return makeJournal(this.lastCommand); }
  async reconcileCommand(): Promise<ProductCommandResult | null> { return this.result; }
}

class UnknownReconcileStore extends FakeStore {
  async getCommand(): Promise<BrowserCommandJournalRecord | null> { return null; }
  async reconcileCommand(): Promise<ProductCommandResult | null> { return null; }
}

class AlreadyPendingStore extends FakeStore {
  async claimCommand(command: Phase2ProductCommand): Promise<BrowserCommandClaim> {
    this.claims += 1;
    this.lastCommand = command;
    return { kind: 'already-pending', journal: makeJournal(command) };
  }
}

class FakeBridge {
  active = true;
  failSnapshotPublish = false;
  commitSnapshotBeforeFailure = false;
  delivery: BrowserCommandDelivery | null = { cursor: 1, command: productCommand };
  readonly snapshots: BrowserSnapshotPublish[] = [];
  readonly results: BrowserCommandResultSubmission[] = [];
  readonly events: string[];

  constructor(events: string[]) { this.events = events; }
  isAgentModeRoute(): boolean { return this.active; }
  getSessionCapability(): string | null { return this.active ? 'capability-runtime-1234567890' : null; }
  getApprovalVerificationKey() { return this.active ? approvalSigner.verificationKey : null; }
  async publishSnapshot(input: BrowserSnapshotPublish): Promise<void> {
    if (this.commitSnapshotBeforeFailure) {
      this.snapshots.push(input);
      throw new Error('snapshot response lost after commit');
    }
    if (this.failSnapshotPublish) throw new Error('snapshot publish failed');
    this.snapshots.push(input);
  }
  async nextCommand(): Promise<BrowserCommandDelivery | null> {
    const delivery = this.delivery;
    this.delivery = null;
    return delivery;
  }
  async submitCommandResult(input: BrowserCommandResultSubmission): Promise<void> {
    this.events.push('host-result');
    this.results.push(input);
  }
}

const events: string[] = [];
const bridge = new FakeBridge(events);
const store = new FakeStore(events);
let refreshes = 0;
const controller = {
  getState: () => ({
    state: 'registered' as const,
    visible: true,
    role: 'writer' as const,
    consumer,
    error: null,
  }),
  refreshEligibility: async () => { refreshes += 1; },
};
const runtime = new BrowserAgentRuntime({ bridge, consumerController: controller, store });

await runtime.initializeWorkspace();
assert.equal(store.initialized, 1);
await runtime.publishMainWorkbenchSnapshot({
  schemaVersion: 1,
  updatedAt: 100,
  source: 'app',
  timelineId: 'timeline-runtime',
  activeTimelineId: 'timeline-runtime',
  checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 100 },
  currentView: 'canvas',
  selectedCharacters: [],
  skillButtons: [],
});
assert.equal(refreshes, 1);
assert.equal(bridge.snapshots.length, 1);
assert.equal(runtime.getBinding()?.snapshotDigest, binding.snapshotDigest);

const failedBinding = {
  ...binding,
  checkoutUpdatedAt: 101,
  contentRevision: 101,
  snapshotDigest: 'sha256:runtime-failed',
};
store.snapshotBinding = failedBinding;
bridge.failSnapshotPublish = true;
await assert.rejects(
  runtime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
  }),
  /snapshot publish failed/,
);
assert.equal(runtime.getBinding(), null, 'an uncertain publish must suspend the heartbeat binding');
assert.equal(refreshes, 2, 'an uncertain publish must close or suspend the current consumer');
bridge.failSnapshotPublish = false;
store.snapshotBinding = binding;
await runtime.publishMainWorkbenchSnapshot({
  schemaVersion: 1,
  updatedAt: 100,
  source: 'app',
  timelineId: 'timeline-runtime',
  activeTimelineId: 'timeline-runtime',
  checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 100 },
  currentView: 'canvas',
  selectedCharacters: [],
  skillButtons: [],
});
assert.equal(runtime.getBinding()?.snapshotDigest, binding.snapshotDigest);

store.snapshotBinding = failedBinding;
bridge.commitSnapshotBeforeFailure = true;
await assert.rejects(
  runtime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
  }),
  /snapshot response lost after commit/,
);
assert.equal(
  bridge.snapshots.at(-1)?.snapshot.binding.snapshotDigest,
  failedBinding.snapshotDigest,
  'the Host-side commit fixture must have accepted the new snapshot before the response is lost',
);
assert.equal(runtime.getBinding(), null, 'a lost response must not leave the old heartbeat binding active');
assert.equal(refreshes, 4);
bridge.commitSnapshotBeforeFailure = false;
store.snapshotBinding = binding;

const enqueued: Array<{ command: unknown; id: string }> = [];
await runtime.pullRemoteCommands((command, id) => enqueued.push({ command, id }));
assert.deepEqual(enqueued, [{ command: { op: 'refreshSnapshot' }, id: 'command-runtime' }]);
assert.equal(store.claims, 1);

await runtime.pushCommandResult({
  id: 'command-runtime',
  command: { op: 'refreshSnapshot' },
  status: 'done',
  source: 'agent-host',
  createdAt: 100,
  updatedAt: 101,
  result: { refreshed: true },
});
assert.deepEqual(events, ['journal-result', 'host-result']);
assert.equal(bridge.results.length, 1);

await runtime.publishMainWorkbenchSnapshot({
  schemaVersion: 1,
  updatedAt: 150,
  source: 'app',
  currentView: 'selection',
  selectedCharacters: [],
  skillButtons: [],
});
assert.equal(
  store.snapshotInputs.at(-1)?.timelineId,
  AGENT_SELECTION_WORKSPACE_TIMELINE_ID,
  'the empty selection workspace still needs a stable Product binding',
);

const selectionCommandPayload = {
  op: 'selectCharacters',
  characterNames: ['洛茜'],
  nodeTitle: '调整阵容：仅保留洛茜',
  nodeDescription: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
  openCanvas: true,
  approval: {
    mode: 'manual',
    approvedBy: 'user',
    rationale: 'Approved in the embedded DEF AI mode.',
  },
} as const;
const unsignedSelectionCommand: Phase2ProductCommand = {
  protocolVersion: 1,
  commandId: asCommandId('command-selection-approved'),
  defSessionId: asDefSessionId('session-selection-approved'),
  defTurnId: asDefTurnId('turn-selection-approved'),
  toolCallId: asToolCallId('tool-selection-approved'),
  expected: binding,
  command: {
    op: 'workbench.execute-command',
    payload: { command: selectionCommandPayload },
  },
};

// A mutating renderer command is admitted only when the capability binds the
// exact command, proposal and current Product snapshot.
{
  const approvalEvents: string[] = [];
  const approvalBridge = new FakeBridge(approvalEvents);
  approvalBridge.delivery = {
    cursor: 1,
    command: await withApprovalCapability(unsignedSelectionCommand),
  };
  const approvalStore = new FakeStore(approvalEvents);
  const approvalRuntime = new BrowserAgentRuntime({
    bridge: approvalBridge,
    consumerController: controller,
    store: approvalStore,
  });
  const admitted: Array<{ command: unknown; id: string }> = [];
  await approvalRuntime.pullRemoteCommands((command, id) => admitted.push({ command, id }));
  assert.deepEqual(admitted, [{
    command: selectionCommandPayload,
    id: unsignedSelectionCommand.commandId,
  }]);
  assert.equal(approvalBridge.results.length, 0);
}

// Missing, expired, or proposal-mismatched capabilities fail closed before
// any Canvas command is enqueued and the typed rejection returns to the Host.
{
  const invalidCommands: Phase2ProductCommand[] = [
    unsignedSelectionCommand,
    await withApprovalCapability({
      ...unsignedSelectionCommand,
      commandId: asCommandId('command-selection-expired'),
    }, { expiresAt: new Date(Date.now() - 1_000).toISOString() }),
    await withApprovalCapability({
      ...unsignedSelectionCommand,
      commandId: asCommandId('command-selection-mismatch'),
    }, { proposalCommand: { ...selectionCommandPayload, characterNames: ['错误对象'] } }),
  ];
  const expectedCodes = [
    'AGENT_APPROVAL_REQUIRED',
    'AGENT_APPROVAL_EXPIRED',
    'AGENT_APPROVAL_PROPOSAL_MISMATCH',
  ];
for (const [index, invalidCommand] of invalidCommands.entries()) {
    const invalidEvents: string[] = [];
    const invalidBridge = new FakeBridge(invalidEvents);
    invalidBridge.delivery = { cursor: 1, command: invalidCommand };
    const invalidStore = new FakeStore(invalidEvents);
    const invalidRuntime = new BrowserAgentRuntime({
      bridge: invalidBridge,
      consumerController: controller,
      store: invalidStore,
    });
    const admitted: unknown[] = [];
    await invalidRuntime.pullRemoteCommands((command) => admitted.push(command));
    assert.deepEqual(admitted, []);
    assert.equal(invalidBridge.results[0]?.result.status, 'rejected');
    assert.equal(invalidBridge.results[0]?.result.code, expectedCodes[index]);
  }
}

// A mutating Canvas result is not allowed to report success until the
// runtime observes a newer persisted snapshot.
{
  const unchangedEvents: string[] = [];
  const unchangedBridge = new FakeBridge(unchangedEvents);
  unchangedBridge.delivery = {
    cursor: 1,
    command: await withApprovalCapability(unsignedSelectionCommand),
  };
  const unchangedStore = new FakeStore(unchangedEvents);
  const unchangedRuntime = new BrowserAgentRuntime({
    bridge: unchangedBridge,
    consumerController: controller,
    store: unchangedStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await unchangedRuntime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 100,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 100 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
  });
  await unchangedRuntime.pullRemoteCommands(() => undefined);
  await unchangedRuntime.pushCommandResult({
    id: unsignedSelectionCommand.commandId,
    command: selectionCommandPayload,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 101,
    result: { selectedCharacterIds: ['char-luoqian'] },
  });
  assert.equal(unchangedBridge.results[0]?.result.status, 'error');
  assert.equal(unchangedBridge.results[0]?.result.code, 'AGENT_POSTCONDITION_NOT_OBSERVED');
}

// If Canvas persisted its business result before a renderer crash, the next
// renderer recovers that result log entry and couples it to the newer
// snapshot instead of incorrectly declaring the mutation not-executed.
{
  const recoveryEvents: string[] = [];
  const recoveryBridge = new FakeBridge(recoveryEvents);
  const recoveryCommand = await withApprovalCapability(unsignedSelectionCommand);
  recoveryBridge.delivery = { cursor: 1, command: recoveryCommand, mode: 'execute' };
  const recoveryStore = new AlreadyPendingStore(recoveryEvents);
  recoveryStore.snapshotBinding = failedBinding;
  const recoveryRuntime = new BrowserAgentRuntime({
    bridge: recoveryBridge,
    consumerController: controller,
    store: recoveryStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await recoveryRuntime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
  });
  const admitted: unknown[] = [];
  await recoveryRuntime.pullRemoteCommands(
    (command) => admitted.push(command),
    (commandId) => commandId === recoveryCommand.commandId
      ? {
          id: recoveryCommand.commandId,
          command: selectionCommandPayload,
          status: 'done',
          source: 'agent-host',
          createdAt: 100,
          updatedAt: 101,
          result: { selectedCharacterIds: ['char-luoqian'] },
        }
      : null,
  );
  assert.deepEqual(admitted, []);
  assert.equal(recoveryBridge.results[0]?.result.status, 'succeeded');
  assert.equal(
    (recoveryBridge.results[0]?.result.visiblePostcondition as { binding?: { snapshotDigest?: string } })
      ?.binding?.snapshotDigest,
    failedBinding.snapshotDigest,
  );
  assert.deepEqual(recoveryEvents, ['journal-result', 'host-result']);
}

// A command recovered by the Host is never claimed or enqueued. A missing
// browser receipt is an explicit not-executed terminal response.
{
  const reconcileEvents: string[] = [];
  const reconcileBridge = new FakeBridge(reconcileEvents);
  const unknownCommand: Phase2ProductCommand = {
    ...productCommand,
    commandId: asCommandId('command-reconcile-unknown'),
  };
  reconcileBridge.delivery = { cursor: 1, command: unknownCommand, mode: 'reconcile' };
  const reconcileStore = new UnknownReconcileStore(reconcileEvents);
  const reconcileRuntime = new BrowserAgentRuntime({
    bridge: reconcileBridge,
    consumerController: controller,
    store: reconcileStore,
  });
  const admitted: unknown[] = [];
  await reconcileRuntime.pullRemoteCommands((command) => admitted.push(command));
  assert.deepEqual(admitted, []);
  assert.equal(reconcileStore.claims, 0, 'reconcile must not claim a browser command');
  assert.equal(reconcileBridge.results[0]?.result.status, 'not-executed');
  assert.equal(reconcileBridge.results[0]?.result.code, 'AGENT_COMMAND_RECONCILE_UNKNOWN');
}

// The same fail-closed rule applies when the Host did not restart but the
// browser renderer did: an already-pending local journal row is not claimed
// into a second Canvas execution.
{
  const reconcileEvents: string[] = [];
  const reconcileBridge = new FakeBridge(reconcileEvents);
  reconcileBridge.delivery = { cursor: 1, command: productCommand, mode: 'execute' };
  const reconcileStore = new AlreadyPendingStore(reconcileEvents);
  const reconcileRuntime = new BrowserAgentRuntime({
    bridge: reconcileBridge,
    consumerController: controller,
    store: reconcileStore,
  });
  const admitted: unknown[] = [];
  await reconcileRuntime.pullRemoteCommands((command) => admitted.push(command));
  assert.deepEqual(admitted, []);
  assert.equal(reconcileStore.claims, 1);
  assert.equal(reconcileBridge.results[0]?.result.status, 'not-executed');
  assert.equal(reconcileBridge.results[0]?.result.code, 'AGENT_COMMAND_RECONCILE_NO_RECEIPT');
}

// Even when a local journal row exists, a non-terminal row is fail-closed as
// not-executed; it is never replayed into the Canvas mutation queue.
{
  const reconcileEvents: string[] = [];
  const reconcileBridge = new FakeBridge(reconcileEvents);
  reconcileBridge.delivery = { cursor: 1, command: productCommand, mode: 'reconcile' };
  const reconcileStore = new FakeStore(reconcileEvents);
  const reconcileRuntime = new BrowserAgentRuntime({
    bridge: reconcileBridge,
    consumerController: controller,
    store: reconcileStore,
  });
  const admitted: unknown[] = [];
  await reconcileRuntime.pullRemoteCommands((command) => admitted.push(command));
  assert.deepEqual(admitted, []);
  assert.equal(reconcileStore.claims, 0);
  assert.equal(reconcileBridge.results[0]?.result.status, 'not-executed');
  assert.equal(reconcileBridge.results[0]?.result.code, 'AGENT_COMMAND_RECONCILE_NO_RECEIPT');
  assert.deepEqual(reconcileEvents, ['journal-result', 'host-result']);
}

const snapshotInputsBeforeOrdinaryRoute = store.snapshotInputs.length;
const publishedSnapshotsBeforeOrdinaryRoute = bridge.snapshots.length;
bridge.active = false;
await runtime.publishMainWorkbenchSnapshot({
  schemaVersion: 1,
  updatedAt: 200,
  source: 'app',
  timelineId: 'timeline-runtime',
  activeTimelineId: 'timeline-runtime',
  checkout: null,
  currentView: 'canvas',
  selectedCharacters: [],
  skillButtons: [],
});
await runtime.pullRemoteCommands(() => { throw new Error('ordinary page must not enqueue'); });
await runtime.pushCommandResult({
  id: 'ordinary',
  command: { op: 'refreshSnapshot' },
  status: 'done',
  source: 'browser',
  createdAt: 0,
  updatedAt: 0,
});
assert.equal(
  store.snapshotInputs.length,
  snapshotInputsBeforeOrdinaryRoute,
  'ordinary pages must not touch Agent identity/snapshots',
);
assert.equal(
  bridge.snapshots.length,
  publishedSnapshotsBeforeOrdinaryRoute,
  'ordinary pages must not issue Agent requests',
);

console.log('browserAgentRuntime seam contract tests passed');
