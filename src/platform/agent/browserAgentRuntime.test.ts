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
  ProductBinding,
  ProductCommandResult,
  ProductSnapshotEnvelope,
} from '../../../agent/core/contracts/index.ts';
import type { DefPreparedWorkNodeCandidateRefV1 } from '../../../agent/core/contracts/prepared-work-node.ts';
import type { MainWorkbenchSnapshot } from '../../utils/mainWorkbenchControl';
import {
  BrowserAgentRuntime,
  enterDesktopAgentModeFromWorkbench,
  exitDesktopAgentModeToWorkbench,
  type DesktopAgentModeNavigationDependencies,
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

const preparedDigest = `sha256:${'c'.repeat(64)}`;

function preparedCandidate(
  overrides: Partial<DefPreparedWorkNodeCandidateRefV1> = {},
): DefPreparedWorkNodeCandidateRefV1 {
  return {
    contract: 'DefPreparedWorkNodeCandidateRefV1',
    schemaVersion: 1,
    proposalId: 'proposal-runtime-prepared',
    intent: 'timeline',
    destination: 'current-timeline',
    sourceTargetId: binding.checkoutTargetId,
    sourceRevision: binding.contentRevision,
    candidateTimelineId: binding.timelineId,
    nodeId: 'candidate-runtime-prepared',
    nodeRevision: 0,
    basePayloadDigest: preparedDigest,
    workingPayloadDigest: `sha256:${'d'.repeat(64)}`,
    diffDigest: `sha256:${'e'.repeat(64)}`,
    proposalDigest: `sha256:${'f'.repeat(64)}`,
    scope: ['timeline.structure'],
    ...overrides,
  };
}

async function withPreparedApprovalCapability(
  command: Phase2ProductCommand,
  candidate: DefPreparedWorkNodeCandidateRefV1,
  options: {
    readonly proposalHash?: string;
    readonly scope?: readonly string[];
    readonly binding?: typeof binding;
    readonly expiresAt?: string;
    readonly toolCallId?: ReturnType<typeof asToolCallId>;
  } = {},
): Promise<Phase2ProductCommand> {
  const claims = {
    schemaVersion: 2 as const,
    audience: 'browser-product-gateway' as const,
    keyEpoch: approvalSigner.verificationKey.keyEpoch,
    nonce: `nonce-${command.commandId}`,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
    interactionId: asInteractionId(`interaction-${command.commandId}`),
    commandId: command.commandId,
    defSessionId: command.defSessionId,
    defTurnId: command.defTurnId,
    toolCallId: options.toolCallId ?? command.toolCallId,
    proposalHash: options.proposalHash ?? candidate.proposalDigest,
    binding: options.binding ?? command.expected,
    scope: options.scope ?? candidate.scope,
    candidate,
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

class InputBindingStore extends FakeStore {
  async createRuntimeSnapshot(input: RuntimeSnapshotInput): Promise<ProductSnapshotEnvelope> {
    this.snapshotInputs.push(input);
    return {
      protocolVersion: 1,
      binding: {
        ...binding,
        checkoutTargetId: input.checkoutTargetId,
        checkoutUpdatedAt: input.checkoutUpdatedAt,
        contentRevision: input.contentRevision,
        snapshotDigest: `sha256:input-${input.contentRevision}-${input.checkoutUpdatedAt}`,
      },
      capturedAt: input.capturedAt!,
      payload: input.payload,
    };
  }
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

class GatedSnapshotStore extends FakeStore {
  #resolveFirstSnapshotStarted!: () => void;
  #releaseFirstSnapshot!: () => void;
  readonly firstSnapshotStarted = new Promise<void>((resolve) => {
    this.#resolveFirstSnapshotStarted = resolve;
  });
  readonly firstSnapshotRelease = new Promise<void>((resolve) => {
    this.#releaseFirstSnapshot = resolve;
  });

  async createRuntimeSnapshot(input: RuntimeSnapshotInput): Promise<ProductSnapshotEnvelope> {
    this.snapshotInputs.push(input);
    if (this.snapshotInputs.length === 1) {
      this.#resolveFirstSnapshotStarted();
      await this.firstSnapshotRelease;
    }
    return {
      protocolVersion: 1,
      binding: {
        ...binding,
        checkoutUpdatedAt: input.checkoutUpdatedAt,
        contentRevision: input.contentRevision,
        snapshotDigest: `sha256:runtime-${input.contentRevision}`,
      },
      capturedAt: input.capturedAt!,
      payload: input.payload,
    };
  }

  releaseFirstSnapshot(): void {
    this.#releaseFirstSnapshot();
  }
}

function runtimeSnapshotAt(revision: number, checkoutUpdatedAt = revision): MainWorkbenchSnapshot {
  return {
    schemaVersion: 1,
    updatedAt: revision,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: {
      targetType: 'snapshot',
      targetId: 'checkout-runtime',
      contentRevision: revision,
      updatedAt: checkoutUpdatedAt,
    },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
  };
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
  async nextCommand(_input?: { readonly signal?: AbortSignal }): Promise<BrowserCommandDelivery | null> {
    const delivery = this.delivery;
    this.delivery = null;
    return delivery;
  }
  async submitCommandResult(input: BrowserCommandResultSubmission): Promise<void> {
    this.events.push('host-result');
    this.results.push(input);
  }
}

class BlockingCommandBridge extends FakeBridge {
  started = false;
  aborted = false;

  override nextCommand(input?: { readonly signal?: AbortSignal }): Promise<BrowserCommandDelivery | null> {
    this.started = true;
    return new Promise<BrowserCommandDelivery | null>((resolve) => {
      const signal = input?.signal;
      if (!signal) {
        resolve(null);
        return;
      }
      const finish = () => {
        this.aborted = true;
        signal.removeEventListener('abort', finish);
        resolve(null);
      };
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish, { once: true });
    });
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
  checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 100, updatedAt: 100 },
  currentView: 'canvas',
  selectedCharacters: [],
  skillButtons: [],
});
assert.equal(refreshes, 1);
assert.equal(bridge.snapshots.length, 1);
assert.equal(runtime.getBinding()?.snapshotDigest, binding.snapshotDigest);

// Re-render churn changes only snapshot/row timestamps. It must not cause a
// second runtime hash, SQLite write, or Host publication. A real damage report
// value change remains publishable even when generatedAt also changes.
{
  const dedupEvents: string[] = [];
  const dedupBridge = new FakeBridge(dedupEvents);
  dedupBridge.delivery = null;
  const dedupStore = new FakeStore(dedupEvents);
  const dedupRuntime = new BrowserAgentRuntime({
    bridge: dedupBridge,
    consumerController: {
      getState: controller.getState,
      refreshEligibility: async () => undefined,
    },
    store: dedupStore,
  });
  await dedupRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  const beforeEquivalentPublishes = dedupStore.snapshotInputs.length;
  for (let index = 1; index <= 100; index += 1) {
    await dedupRuntime.publishMainWorkbenchSnapshot({
      ...runtimeSnapshotAt(100 + index),
      checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 100, updatedAt: 100 },
    });
  }
  assert.equal(dedupStore.snapshotInputs.length, beforeEquivalentPublishes);

  const report = {
    generatedAt: 1,
    totalDamage: 10,
    totalExpected: 12,
    totalNonCrit: 8,
    buttonCount: 0,
    buttons: [],
    characters: [],
  };
  const reportSnapshot = {
    ...runtimeSnapshotAt(201),
    checkout: { targetType: 'snapshot' as const, targetId: 'checkout-runtime', contentRevision: 100, updatedAt: 100 },
    damageReportStatus: 'ready' as const,
    damageReport: report,
  } as MainWorkbenchSnapshot;
  await dedupRuntime.publishMainWorkbenchSnapshot(reportSnapshot);
  assert.equal(dedupStore.snapshotInputs.length, beforeEquivalentPublishes + 1);
  await dedupRuntime.publishMainWorkbenchSnapshot({
    ...reportSnapshot,
    updatedAt: 202,
    damageReport: { ...report, generatedAt: 2 },
  });
  assert.equal(dedupStore.snapshotInputs.length, beforeEquivalentPublishes + 1);
  await dedupRuntime.publishMainWorkbenchSnapshot({
    ...reportSnapshot,
    updatedAt: 203,
    damageReport: { ...report, generatedAt: 3, totalDamage: 11 },
  });
  assert.equal(dedupStore.snapshotInputs.length, beforeEquivalentPublishes + 2);
}

// Exiting AI mode aborts an in-flight Host long-poll. The browser runtime must
// settle promptly and must not leave a pull promise that a later state change
// can accidentally reuse.
{
  const blockedEvents: string[] = [];
  const blockedBridge = new BlockingCommandBridge(blockedEvents);
  blockedBridge.delivery = null;
  const blockedRuntime = new BrowserAgentRuntime({
    bridge: blockedBridge,
    consumerController: controller,
    store: new FakeStore(blockedEvents),
  });
  const pull = blockedRuntime.pullRemoteCommands(() => undefined);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(blockedBridge.started, true);
  blockedRuntime.cancelCommandPull();
  await pull;
  assert.equal(blockedBridge.aborted, true);
}

// Consecutive snapshots that are waiting behind one in-flight publish keep
// only the newest binding/revision/digest candidate.
{
  const coalescingEvents: string[] = [];
  const coalescingBridge = new FakeBridge(coalescingEvents);
  coalescingBridge.delivery = null;
  const coalescingStore = new GatedSnapshotStore(coalescingEvents);
  const coalescingRuntime = new BrowserAgentRuntime({
    bridge: coalescingBridge,
    consumerController: {
      getState: controller.getState,
      refreshEligibility: async () => undefined,
    },
    store: coalescingStore,
  });
  const firstPublish = coalescingRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(101));
  await coalescingStore.firstSnapshotStarted;
  const intermediatePublish = coalescingRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(102));
  const newestPublish = coalescingRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(103));
  assert.equal(coalescingStore.snapshotInputs.length, 1);
  coalescingStore.releaseFirstSnapshot();
  await Promise.all([firstPublish, intermediatePublish, newestPublish]);
  assert.equal(coalescingStore.snapshotInputs.length, 2);
  assert.equal(coalescingStore.snapshotInputs.at(-1)?.contentRevision, 103);
  assert.equal(coalescingBridge.snapshots.at(-1)?.snapshot.binding.contentRevision, 103);
  assert.equal(coalescingBridge.snapshots.at(-1)?.snapshot.binding.snapshotDigest, 'sha256:runtime-103');
}

// Revoking authority while a snapshot is blocked in storage must cancel that
// in-flight publication and every older queued projection.
{
  const revocationEvents: string[] = [];
  const revocationBridge = new FakeBridge(revocationEvents);
  revocationBridge.delivery = null;
  const revocationStore = new GatedSnapshotStore(revocationEvents);
  const revocationRuntime = new BrowserAgentRuntime({
    bridge: revocationBridge,
    consumerController: {
      getState: controller.getState,
      refreshEligibility: async () => undefined,
    },
    store: revocationStore,
  });
  const blockedPublish = revocationRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(201));
  await revocationStore.firstSnapshotStarted;
  const queuedPublish = revocationRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(202));
  await revocationRuntime.suspendWritableBinding();
  revocationStore.releaseFirstSnapshot();
  await Promise.all([blockedPublish, queuedPublish]);
  assert.equal(revocationRuntime.getBinding(), null);
  assert.equal(revocationBridge.snapshots.length, 0, 'revoked projections must never reach the Host');
  assert.equal(revocationStore.snapshotInputs.length, 1, 'queued stale projections must be discarded');
}

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
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 101, updatedAt: 101 },
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
  checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 100, updatedAt: 100 },
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
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 101, updatedAt: 101 },
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

const enqueued: Array<{ command: unknown; id: string; expectedBinding: ProductBinding }> = [];
await runtime.pullRemoteCommands((command, id, expectedBinding) => enqueued.push({ command, id, expectedBinding }));
assert.deepEqual(enqueued, [{
  command: { op: 'refreshSnapshot' },
  id: 'command-runtime',
  expectedBinding: productCommand.expected,
}]);
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

const snapshotsBeforeUnboundSelection = store.snapshotInputs.length;
await runtime.publishMainWorkbenchSnapshot({
  schemaVersion: 1,
  updatedAt: 150,
  source: 'app',
  currentView: 'selection',
  selectedCharacters: [],
  skillButtons: [],
});
assert.equal(
  store.snapshotInputs.length,
  snapshotsBeforeUnboundSelection,
  'selection without a persisted checkout must stay unbound and fail closed',
);
assert.equal(runtime.getBinding(), null, 'an unbound snapshot must revoke any previously writable binding');
await runtime.publishMainWorkbenchSnapshot({
  ...runtimeSnapshotAt(100, 777),
  currentView: 'selection',
});
assert.equal(store.snapshotInputs.at(-1)?.timelineId, 'timeline-runtime');
assert.equal(store.snapshotInputs.at(-1)?.checkoutUpdatedAt, 777);
assert.equal(
  store.snapshotInputs.at(-1)?.contentRevision,
  100,
  'authoritative target revision must not be copied from checkout.updatedAt',
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

// Prepared apply is the only renderer mutation that accepts an Approval
// Capability V2. The signed candidate, proposal hash, scope, binding, and
// command candidate all have to be byte-for-byte equivalent; V1 cannot cross
// this boundary.
{
  const candidate = preparedCandidate();
  const applyPayload = {
    op: 'applyReviewedWorkNodeProposal',
    operation: 'timeline.preview',
    candidate,
  } as const;
  const unsignedApplyCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-prepared-v2-admitted'),
    toolCallId: asToolCallId('tool-prepared-v2-admitted'),
    command: { op: 'workbench.execute-command', payload: { command: applyPayload } },
  };
  const v2Events: string[] = [];
  const v2Bridge = new FakeBridge(v2Events);
  v2Bridge.delivery = {
    cursor: 1,
    command: await withPreparedApprovalCapability(unsignedApplyCommand, candidate),
  };
  const v2Runtime = new BrowserAgentRuntime({
    bridge: v2Bridge,
    consumerController: controller,
    store: new FakeStore(v2Events),
  });
  await v2Runtime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  const v2Admitted: Array<{ command: unknown; id: string }> = [];
  await v2Runtime.pullRemoteCommands((command, id) => v2Admitted.push({ command, id }));
  assert.deepEqual(v2Admitted, [{ command: applyPayload, id: unsignedApplyCommand.commandId }]);
  assert.equal(v2Bridge.results.length, 0);

  // Real checkouts commonly move after their target content was written.
  // Keep checkoutUpdatedAt=777 and authoritative node/snapshot revision=100:
  // the V2 candidate is admitted only when sourceRevision follows the latter.
  const distinctCasStore = new InputBindingStore([]);
  const distinctCasExpected = {
    ...binding,
    checkoutUpdatedAt: 777,
    contentRevision: 100,
    snapshotDigest: 'sha256:input-100-777',
  };
  const distinctCasCommand: Phase2ProductCommand = {
    ...unsignedApplyCommand,
    commandId: asCommandId('command-prepared-distinct-checkout-cas'),
    toolCallId: asToolCallId('tool-prepared-distinct-checkout-cas'),
    expected: distinctCasExpected,
  };
  const distinctCasBridge = new FakeBridge([]);
  distinctCasBridge.delivery = {
    cursor: 1,
    command: await withPreparedApprovalCapability(distinctCasCommand, candidate),
  };
  const distinctCasRuntime = new BrowserAgentRuntime({
    bridge: distinctCasBridge,
    consumerController: controller,
    store: distinctCasStore,
  });
  await distinctCasRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100, 777));
  const distinctCasAdmitted: unknown[] = [];
  await distinctCasRuntime.pullRemoteCommands((command) => distinctCasAdmitted.push(command));
  assert.deepEqual(distinctCasAdmitted, [applyPayload]);
  assert.equal(distinctCasStore.snapshotInputs[0]?.contentRevision, 100);
  assert.equal(distinctCasStore.snapshotInputs[0]?.checkoutUpdatedAt, 777);

  const wrongMappedCandidate = preparedCandidate({ sourceRevision: 777 });
  const wrongMappedPayload = { ...applyPayload, candidate: wrongMappedCandidate };
  const wrongMappedCommand: Phase2ProductCommand = {
    ...distinctCasCommand,
    commandId: asCommandId('command-prepared-checkout-time-as-revision'),
    toolCallId: asToolCallId('tool-prepared-checkout-time-as-revision'),
    command: { op: 'workbench.execute-command', payload: { command: wrongMappedPayload } },
  };
  const wrongMappedBridge = new FakeBridge([]);
  wrongMappedBridge.delivery = {
    cursor: 1,
    command: await withPreparedApprovalCapability(wrongMappedCommand, wrongMappedCandidate),
  };
  const wrongMappedRuntime = new BrowserAgentRuntime({
    bridge: wrongMappedBridge,
    consumerController: controller,
    store: new InputBindingStore([]),
  });
  await wrongMappedRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100, 777));
  await wrongMappedRuntime.pullRemoteCommands(() => undefined);
  assert.equal(wrongMappedBridge.results[0]?.result.code, 'AGENT_PREPARED_CANDIDATE_BINDING_MISMATCH');

  const v1Events: string[] = [];
  const v1Bridge = new FakeBridge(v1Events);
  v1Bridge.delivery = {
    cursor: 1,
    command: await withApprovalCapability({
      ...unsignedApplyCommand,
      commandId: asCommandId('command-prepared-v1-rejected'),
      toolCallId: asToolCallId('tool-prepared-v1-rejected'),
    }),
  };
  const v1Runtime = new BrowserAgentRuntime({
    bridge: v1Bridge,
    consumerController: controller,
    store: new FakeStore(v1Events),
  });
  await v1Runtime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await v1Runtime.pullRemoteCommands(() => undefined);
  assert.equal(v1Bridge.results[0]?.result.status, 'rejected');
  assert.equal(v1Bridge.results[0]?.result.code, 'AGENT_PREPARED_APPROVAL_REQUIRED');

  const tamperedEvents: string[] = [];
  const tamperedBridge = new FakeBridge(tamperedEvents);
  const tamperedCommand: Phase2ProductCommand = {
    ...unsignedApplyCommand,
    commandId: asCommandId('command-prepared-v2-tampered-candidate'),
    toolCallId: asToolCallId('tool-prepared-v2-tampered-candidate'),
    command: {
      op: 'workbench.execute-command',
      payload: { command: { ...applyPayload, candidate: { ...candidate, nodeId: 'forged-candidate' } } },
    },
  };
  tamperedBridge.delivery = {
    cursor: 1,
    command: await withPreparedApprovalCapability(tamperedCommand, candidate),
  };
  const tamperedRuntime = new BrowserAgentRuntime({
    bridge: tamperedBridge,
    consumerController: controller,
    store: new FakeStore(tamperedEvents),
  });
  await tamperedRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await tamperedRuntime.pullRemoteCommands(() => undefined);
  assert.equal(tamperedBridge.results[0]?.result.status, 'rejected');
  assert.equal(tamperedBridge.results[0]?.result.code, 'AGENT_PREPARED_CANDIDATE_MISMATCH');

  const hashEvents: string[] = [];
  const hashBridge = new FakeBridge(hashEvents);
  hashBridge.delivery = {
    cursor: 1,
    command: await withPreparedApprovalCapability(unsignedApplyCommand, candidate, {
      proposalHash: `sha256:${'0'.repeat(64)}`,
    }),
  };
  const hashRuntime = new BrowserAgentRuntime({
    bridge: hashBridge,
    consumerController: controller,
    store: new FakeStore(hashEvents),
  });
  await hashRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await hashRuntime.pullRemoteCommands(() => undefined);
  assert.equal(hashBridge.results[0]?.result.status, 'rejected');
  assert.equal(hashBridge.results[0]?.result.code, 'AGENT_PREPARED_PROPOSAL_HASH_MISMATCH');

  const selectionCandidate = preparedCandidate({
    intent: 'selection',
    destination: 'new-temporary-workspace',
    candidateTimelineId: 'prepared-selection-document-proposal-runtime-prepared',
    scope: [
      'selection.roster',
      'timeline.structure',
      'buff.attachments',
      'buff.resistance',
      'loadout.config',
    ],
  });
  const selectionApplyPayload = {
    op: 'applyReviewedWorkNodeProposal',
    operation: 'selection.preview',
    candidate: selectionCandidate,
  } as const;
  const selectionApplyCommand: Phase2ProductCommand = {
    ...unsignedApplyCommand,
    commandId: asCommandId('command-prepared-selection-new-temp'),
    toolCallId: asToolCallId('tool-prepared-selection-new-temp'),
    command: { op: 'workbench.execute-command', payload: { command: selectionApplyPayload } },
  };
  const selectionApplyBridge = new FakeBridge([]);
  selectionApplyBridge.delivery = {
    cursor: 1,
    command: await withPreparedApprovalCapability(selectionApplyCommand, selectionCandidate),
  };
  const selectionApplyRuntime = new BrowserAgentRuntime({
    bridge: selectionApplyBridge,
    consumerController: controller,
    store: new FakeStore([]),
  });
  await selectionApplyRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  const selectionApplyAdmitted: unknown[] = [];
  await selectionApplyRuntime.pullRemoteCommands((command) => selectionApplyAdmitted.push(command));
  assert.deepEqual(selectionApplyAdmitted, [selectionApplyPayload]);

  const wrongDestinationCandidate = {
    ...selectionCandidate,
    candidateTimelineId: binding.timelineId,
  };
  const wrongDestinationCommand: Phase2ProductCommand = {
    ...selectionApplyCommand,
    commandId: asCommandId('command-prepared-selection-destination-tampered'),
    toolCallId: asToolCallId('tool-prepared-selection-destination-tampered'),
    command: {
      op: 'workbench.execute-command',
      payload: {
        command: {
          ...selectionApplyPayload,
          candidate: wrongDestinationCandidate,
        },
      },
    },
  };
  const wrongDestinationBridge = new FakeBridge([]);
  wrongDestinationBridge.delivery = {
    cursor: 1,
    command: await withPreparedApprovalCapability(wrongDestinationCommand, wrongDestinationCandidate),
  };
  const wrongDestinationRuntime = new BrowserAgentRuntime({
    bridge: wrongDestinationBridge,
    consumerController: controller,
    store: new FakeStore([]),
  });
  await wrongDestinationRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await wrongDestinationRuntime.pullRemoteCommands(() => undefined);
  assert.equal(wrongDestinationBridge.results[0]?.result.code, 'AGENT_PREPARED_CANDIDATE_BINDING_MISMATCH');

  const v2BoundaryCases = [
    {
      id: 'scope',
      options: { scope: ['selection.roster'] },
      expectedCode: 'AGENT_PREPARED_SCOPE_MISMATCH',
    },
    {
      id: 'binding',
      options: { binding: { ...binding, checkoutUpdatedAt: 999 } },
      expectedCode: 'AGENT_APPROVAL_BINDING_MISMATCH',
    },
    {
      id: 'correlation',
      options: { toolCallId: asToolCallId('tool-prepared-wrong-correlation') },
      expectedCode: 'AGENT_APPROVAL_CORRELATION_MISMATCH',
    },
    {
      id: 'expired',
      options: { expiresAt: new Date(Date.now() - 1_000).toISOString() },
      expectedCode: 'AGENT_APPROVAL_EXPIRED',
    },
  ] as const;
  for (const boundary of v2BoundaryCases) {
    const boundaryCommand: Phase2ProductCommand = {
      ...selectionApplyCommand,
      commandId: asCommandId(`command-prepared-v2-${boundary.id}`),
      toolCallId: asToolCallId(`tool-prepared-v2-${boundary.id}`),
    };
    const boundaryBridge = new FakeBridge([]);
    boundaryBridge.delivery = {
      cursor: 1,
      command: await withPreparedApprovalCapability(
        boundaryCommand,
        selectionCandidate,
        boundary.options,
      ),
    };
    const boundaryRuntime = new BrowserAgentRuntime({
      bridge: boundaryBridge,
      consumerController: controller,
      store: new FakeStore([]),
    });
    await boundaryRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
    await boundaryRuntime.pullRemoteCommands(() => undefined);
    assert.equal(boundaryBridge.results[0]?.result.code, boundary.expectedCode);
  }
}

// Prepare and abandon are constrained proposal/cleanup commands: they do not
// ask for user approval, but prepare still requires the Host-inserted source
// binding. This also keeps the empty-roster/selection-page command owner on
// the same independent runtime pull path.
{
  const preparePayload = {
    op: 'prepareReviewedWorkNodeProposal',
    operation: 'timeline.preview',
    intent: 'timeline',
    scope: ['timeline.structure'],
    patch: [{ op: 'clearTimeline' }],
    label: '准备候选',
    description: '仅创建隔离候选供审阅。',
    sourceBinding: binding,
  } as const;
  const prepareCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-prepared-no-approval'),
    toolCallId: asToolCallId('tool-prepared-no-approval'),
    command: { op: 'workbench.execute-command', payload: { command: preparePayload } },
  };
  const prepareEvents: string[] = [];
  const prepareBridge = new FakeBridge(prepareEvents);
  prepareBridge.delivery = { cursor: 1, command: prepareCommand };
  const prepareRuntime = new BrowserAgentRuntime({
    bridge: prepareBridge,
    consumerController: controller,
    store: new FakeStore(prepareEvents),
  });
  await prepareRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  const prepareAdmitted: unknown[] = [];
  await prepareRuntime.pullRemoteCommands((command) => prepareAdmitted.push(command));
  assert.deepEqual(prepareAdmitted, [preparePayload]);
  assert.equal(prepareBridge.results.length, 0);

  const selectionPreparedPayload = {
    op: 'prepareReviewedWorkNodeProposal',
    operation: 'selection.preview',
    intent: 'selection',
    scope: [
      'selection.roster',
      'timeline.structure',
      'buff.attachments',
      'buff.resistance',
      'loadout.config',
    ],
    roster: {
      characterIds: ['operator-a'],
      characterNames: ['测试甲'],
      nodeTitle: '选择测试甲',
      nodeDescription: '精确选择测试甲并创建隔离候选。',
      openCanvas: false,
    },
    label: '准备选人候选',
    description: '完整 selection scope 候选。',
    sourceBinding: binding,
  } as const;
  const selectionPreparedBridge = new FakeBridge([]);
  selectionPreparedBridge.delivery = {
    cursor: 1,
    command: {
      ...prepareCommand,
      commandId: asCommandId('command-prepared-selection-admitted'),
      toolCallId: asToolCallId('tool-prepared-selection-admitted'),
      command: {
        op: 'workbench.execute-command',
        payload: { command: selectionPreparedPayload },
      },
    },
  };
  const selectionPreparedRuntime = new BrowserAgentRuntime({
    bridge: selectionPreparedBridge,
    consumerController: controller,
    store: new FakeStore([]),
  });
  await selectionPreparedRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  const selectionPreparedAdmitted: unknown[] = [];
  await selectionPreparedRuntime.pullRemoteCommands((command) => selectionPreparedAdmitted.push(command));
  assert.deepEqual(selectionPreparedAdmitted, [selectionPreparedPayload]);

  const wrongSelectionScopeBridge = new FakeBridge([]);
  wrongSelectionScopeBridge.delivery = {
    cursor: 1,
    command: {
      ...prepareCommand,
      commandId: asCommandId('command-prepared-selection-scope-rejected'),
      toolCallId: asToolCallId('tool-prepared-selection-scope-rejected'),
      command: {
        op: 'workbench.execute-command',
        payload: {
          command: {
            ...selectionPreparedPayload,
            scope: [...selectionPreparedPayload.scope].reverse(),
          },
        },
      },
    },
  };
  const wrongSelectionScopeRuntime = new BrowserAgentRuntime({
    bridge: wrongSelectionScopeBridge,
    consumerController: controller,
    store: new FakeStore([]),
  });
  await wrongSelectionScopeRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await wrongSelectionScopeRuntime.pullRemoteCommands(() => undefined);
  assert.equal(wrongSelectionScopeBridge.results[0]?.result.status, 'rejected');
  assert.equal(wrongSelectionScopeBridge.results[0]?.result.code, 'AGENT_PREPARED_SCOPE_INVALID');

  const mismatchBridge = new FakeBridge([]);
  mismatchBridge.delivery = {
    cursor: 1,
    command: {
      ...prepareCommand,
      commandId: asCommandId('command-prepared-binding-mismatch'),
      toolCallId: asToolCallId('tool-prepared-binding-mismatch'),
      command: {
        op: 'workbench.execute-command',
        payload: {
          command: {
            ...preparePayload,
            sourceBinding: { ...binding, contentRevision: binding.contentRevision + 1 },
          },
        },
      },
    },
  };
  const mismatchRuntime = new BrowserAgentRuntime({
    bridge: mismatchBridge,
    consumerController: controller,
    store: new FakeStore([]),
  });
  await mismatchRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await mismatchRuntime.pullRemoteCommands(() => undefined);
  assert.equal(mismatchBridge.results[0]?.result.status, 'rejected');
  assert.equal(mismatchBridge.results[0]?.result.code, 'AGENT_PREPARED_SOURCE_BINDING_MISMATCH');

  const restoreCases = [
    {
      semanticScope: 'timeline.structure',
      intent: 'timeline',
      proposalScope: ['timeline.structure', 'buff.attachments', 'buff.resistance'],
    },
    {
      semanticScope: 'buff.attachments',
      intent: 'buff',
      proposalScope: ['buff.attachments'],
    },
    {
      semanticScope: 'buff.resistance',
      intent: 'buff',
      proposalScope: ['buff.resistance'],
    },
  ] as const;
  for (const [index, restoreCase] of restoreCases.entries()) {
    const restorePayload = {
      op: 'prepareReviewedWorkNodeProposal',
      operation: `restore.scope.${index}`,
      intent: restoreCase.intent,
      scope: [...restoreCase.proposalScope],
      restore: { nodeId: 'baseline-node', scope: restoreCase.semanticScope },
      label: '准备范围恢复',
      description: '从 baseline Work Node 的 base payload 创建隔离恢复候选。',
      sourceBinding: binding,
    } as const;
    const restoreBridge = new FakeBridge([]);
    restoreBridge.delivery = {
      cursor: 1,
      command: {
        ...prepareCommand,
        commandId: asCommandId(`command-prepared-restore-${index}`),
        toolCallId: asToolCallId(`tool-prepared-restore-${index}`),
        command: { op: 'workbench.execute-command', payload: { command: restorePayload } },
      },
    };
    const restoreRuntime = new BrowserAgentRuntime({
      bridge: restoreBridge,
      consumerController: controller,
      store: new FakeStore([]),
    });
    await restoreRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
    const admitted: unknown[] = [];
    await restoreRuntime.pullRemoteCommands((command) => admitted.push(command));
    assert.deepEqual(admitted, [restorePayload]);
  }

  const mixedPrepareBridge = new FakeBridge([]);
  mixedPrepareBridge.delivery = {
    cursor: 1,
    command: {
      ...prepareCommand,
      commandId: asCommandId('command-prepared-mixed-rejected'),
      toolCallId: asToolCallId('tool-prepared-mixed-rejected'),
      command: {
        op: 'workbench.execute-command',
        payload: {
          command: {
            ...preparePayload,
            restore: { nodeId: 'baseline-node', scope: 'timeline.structure' },
          },
        },
      },
    },
  };
  const mixedPrepareRuntime = new BrowserAgentRuntime({
    bridge: mixedPrepareBridge,
    consumerController: controller,
    store: new FakeStore([]),
  });
  await mixedPrepareRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await mixedPrepareRuntime.pullRemoteCommands(() => undefined);
  assert.equal(mixedPrepareBridge.results[0]?.result.code, 'AGENT_COMMAND_SCHEMA_INVALID');
}

// The reviewed loadout mutation is admitted only with the signed capability,
// and a newer snapshot must prove the exact candidate checkout and visible
// operator configuration rather than merely a revision bump.
{
  const loadoutFinalConfig = {
    characterId: 'operator-test',
    characterName: '测试干员',
    weapon: {
      id: 'weapon-test',
      name: '测试武器',
      level: 90,
      potential: '0潜',
      skillLevels: { skill1: 5, skill2: 5, skill3: 5 },
    },
    equipment: [],
    operatorSkillLevels: { A: 'M3', B: 'L9', E: 'L9', Q: 'L9', Dot: 'L9' },
  } as const;
  const loadoutCommandPayload = {
    op: 'applyPreparedOperatorConfigProposal',
    parentNodeId: 'parent-node',
    parentRevision: 100,
    nodeId: 'candidate-node',
    nodeRevision: 101,
    proposalDigest: `sha256:${'a'.repeat(64)}`,
    finalConfig: loadoutFinalConfig,
    approval: { mode: 'manual', approvedBy: 'user', rationale: '测试批准' },
  } as const;
  const loadoutCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-loadout-approved'),
    toolCallId: asToolCallId('tool-loadout-approved'),
    command: { op: 'workbench.execute-command', payload: { command: loadoutCommandPayload } },
  };
  const loadoutEvents: string[] = [];
  const loadoutBridge = new FakeBridge(loadoutEvents);
  loadoutBridge.delivery = {
    cursor: 1,
    command: await withApprovalCapability(loadoutCommand),
  };
  const loadoutStore = new FakeStore(loadoutEvents);
  loadoutStore.snapshotBinding = {
    ...binding,
    checkoutTargetId: 'candidate-node',
    checkoutUpdatedAt: 101,
    contentRevision: 101,
    snapshotDigest: 'sha256:loadout-101',
  };
  const loadoutRuntime = new BrowserAgentRuntime({
    bridge: loadoutBridge,
    consumerController: controller,
    store: loadoutStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await loadoutRuntime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'work-node', targetId: 'candidate-node', contentRevision: 101, updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
    operatorConfigs: [{
      characterId: 'operator-test',
      characterName: '测试干员',
      weapon: {
        id: 'weapon-test',
        name: '测试武器',
        level: 90,
        potential: '0潜',
        skillLevels: { skill1: 5, skill2: 5, skill3: 5 },
        attack: 100,
      },
      equipment: [],
      operatorSkillLevels: { A: 'M3', B: 'L9', E: 'L9', Q: 'L9', Dot: 'L9' },
    }],
  });
  const loadoutAdmitted: Array<{ command: unknown; id: string }> = [];
  await loadoutRuntime.pullRemoteCommands((command, id) => loadoutAdmitted.push({ command, id }));
  assert.equal(loadoutAdmitted.length, 1);
  await loadoutRuntime.pushCommandResult({
    id: loadoutCommand.commandId,
    command: loadoutCommandPayload as never,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 101,
    result: {
      ok: true,
      applied: true,
      nodeId: 'candidate-node',
      commitId: 'commit-loadout',
      checkoutApplied: true,
      finalized: true,
      finalConfig: loadoutFinalConfig,
      visiblePostcondition: { pass: true },
    },
  });
  assert.equal(loadoutBridge.results[0]?.result.status, 'succeeded');

  const failedLoadoutEvents: string[] = [];
  const failedLoadoutBridge = new FakeBridge(failedLoadoutEvents);
  const failedLoadoutCommand = await withApprovalCapability({
    ...loadoutCommand,
    commandId: asCommandId('command-loadout-visible-mismatch'),
    toolCallId: asToolCallId('tool-loadout-visible-mismatch'),
    command: {
      op: 'workbench.execute-command',
      payload: {
        command: {
          ...loadoutCommandPayload,
          finalConfig: { ...loadoutFinalConfig, weapon: { ...loadoutFinalConfig.weapon, name: '错误武器' } },
        },
      },
    },
  });
  failedLoadoutBridge.delivery = { cursor: 1, command: failedLoadoutCommand };
  const failedLoadoutStore = new FakeStore(failedLoadoutEvents);
  failedLoadoutStore.snapshotBinding = loadoutStore.snapshotBinding;
  const failedLoadoutRuntime = new BrowserAgentRuntime({
    bridge: failedLoadoutBridge,
    consumerController: controller,
    store: failedLoadoutStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await failedLoadoutRuntime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'work-node', targetId: 'candidate-node', contentRevision: 101, updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
    operatorConfigs: [{
      characterId: 'operator-test',
      characterName: '测试干员',
      weapon: {
        id: 'weapon-test',
        name: '测试武器',
        level: 90,
        potential: '0潜',
        skillLevels: { skill1: 5, skill2: 5, skill3: 5 },
        attack: 100,
      },
      equipment: [],
      operatorSkillLevels: { A: 'M3', B: 'L9', E: 'L9', Q: 'L9', Dot: 'L9' },
    }],
  });
  await failedLoadoutRuntime.pullRemoteCommands(() => undefined);
  await failedLoadoutRuntime.pushCommandResult({
    id: failedLoadoutCommand.commandId,
    command: failedLoadoutCommand.command.payload.command as never,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 101,
    result: {
      ok: true,
      applied: true,
      nodeId: 'candidate-node',
      commitId: 'commit-loadout',
      checkoutApplied: true,
      finalized: true,
      finalConfig: { ...loadoutFinalConfig, weapon: { ...loadoutFinalConfig.weapon, name: '错误武器' } },
      visiblePostcondition: { pass: true },
    },
  });
  assert.equal(failedLoadoutBridge.results[0]?.result.status, 'error');
  assert.equal(failedLoadoutBridge.results[0]?.result.code, 'AGENT_POSTCONDITION_NOT_OBSERVED');
}

// A mutating result waits on the snapshot publication event rather than a
// fixed 16ms polling loop. Publishing the exact visible button shortly after
// the result starts should complete well before the legacy 1.5s timeout.
{
  const eventEvents: string[] = [];
  const eventBridge = new FakeBridge(eventEvents);
  const eventPayload = {
    op: 'removeSkillButton',
    buttonId: 'button-event',
    latest: false,
  } as const;
  const eventCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-snapshot-event-wait'),
    toolCallId: asToolCallId('tool-snapshot-event-wait'),
    command: { op: 'workbench.execute-command', payload: { command: eventPayload } },
  };
  eventBridge.delivery = { cursor: 1, command: await withApprovalCapability(eventCommand) };
  const eventStore = new FakeStore(eventEvents);
  eventStore.snapshotBinding = {
    ...binding,
    checkoutUpdatedAt: 101,
    contentRevision: 101,
    snapshotDigest: 'sha256:event-101',
  };
  const eventRuntime = new BrowserAgentRuntime({
    bridge: eventBridge,
    consumerController: controller,
    store: eventStore,
  });
  await eventRuntime.publishMainWorkbenchSnapshot(runtimeSnapshotAt(100));
  await eventRuntime.pullRemoteCommands(() => undefined);
  const startedAt = Date.now();
  const resultPromise = eventRuntime.pushCommandResult({
    id: eventCommand.commandId,
    command: eventPayload as never,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 101,
    result: { buttonId: 'button-event' },
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  await eventRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('event-node', 101, [], 101));
  await resultPromise;
  assert.ok(Date.now() - startedAt < 1_000, 'snapshot event should wake the postcondition waiter promptly');
  assert.equal(eventBridge.results[0]?.result.status, 'succeeded');
}

function exactWorkNodeReceipt(input: {
  readonly checkoutTargetId: string;
  readonly checkoutUpdatedAt: number;
  readonly checkoutTargetRevision: number;
  readonly nodeRevision: number;
  readonly buttonIds?: readonly string[];
  readonly observedCheckoutTargetId?: string;
  readonly observedCheckoutTargetRevision?: number;
}) {
  const buttonIds = [...(input.buttonIds || ['button-base'])].sort();
  const expectedCheckoutTargetId = input.checkoutTargetId;
  const observedCheckoutTargetId = input.observedCheckoutTargetId || expectedCheckoutTargetId;
  const expectedNodeRevision = input.checkoutTargetRevision;
  const observedNodeRevision = input.observedCheckoutTargetRevision ?? expectedNodeRevision;
  const digestFields = {
    payloadDigest: 'sha256:payload-base',
    timelineDigest: 'sha256:timeline-base',
    buttonDigest: 'sha256:buttons-base',
    buffDigest: 'sha256:buffs-base',
    resistanceDigest: 'sha256:resistance-base',
    operatorConfigDigest: 'sha256:operator-config-base',
  };
  return {
    pass: true,
    failures: [],
    expected: {
      ...digestFields,
      visibleButtonIds: buttonIds,
      checkout: { targetType: 'work-node', targetId: expectedCheckoutTargetId },
      nodeRevision: expectedNodeRevision,
    },
    observed: {
      ...digestFields,
      visibleButtonIds: buttonIds,
      checkout: { targetType: 'work-node', targetId: observedCheckoutTargetId },
      nodeRevision: observedNodeRevision,
    },
  };
}

function makeExactWorkNodeSnapshot(
  targetId: string,
  contentRevision: number,
  buttonIds = ['button-base'],
  checkoutUpdatedAt = contentRevision,
): MainWorkbenchSnapshot {
  return {
    schemaVersion: 1,
    updatedAt: checkoutUpdatedAt,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'work-node', targetId, contentRevision, updatedAt: checkoutUpdatedAt },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: buttonIds.map((id) => ({
      id,
      characterId: 'operator-test',
      characterName: '测试干员',
      skillType: 'A',
      staffIndex: 0,
      lineIndex: 0,
      persistenceStaffIndex: 0,
      persistenceNodeIndex: 0,
      selectedBuffIds: [],
    })),
  };
}

// Restore only succeeds when the Canvas receipt proves the ready rollback
// ledger, exact base payload digests, target checkout and visible buttons.
{
  const restoreCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-worknode-restore-exact'),
    toolCallId: asToolCallId('tool-worknode-restore-exact'),
    command: {
      op: 'workbench.execute-command',
      payload: {
        command: {
          op: 'restoreAiTimelineWorkNodeBase',
          nodeId: 'candidate-node',
          reload: false,
          approval: { mode: 'manual', approvedBy: 'user', rationale: '恢复测试' },
        },
      },
    },
  };
  const restoreEvents: string[] = [];
  const restoreBridge = new FakeBridge(restoreEvents);
  restoreBridge.delivery = { cursor: 1, command: await withApprovalCapability(restoreCommand) };
  const restoreStore = new FakeStore(restoreEvents);
  const restoreRuntime = new BrowserAgentRuntime({
    bridge: restoreBridge,
    consumerController: controller,
    store: restoreStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await restoreRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('base-node', 300));
  await restoreRuntime.pullRemoteCommands(() => undefined);
  restoreStore.snapshotBinding = { ...binding, checkoutUpdatedAt: 301, contentRevision: 301, snapshotDigest: 'sha256:restore-301' };
  await restoreRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('base-node', 301, ['button-base'], 301));
  const visiblePostcondition = exactWorkNodeReceipt({
    checkoutTargetId: 'base-node',
    checkoutUpdatedAt: 300,
    checkoutTargetRevision: 8,
    nodeRevision: 9,
  });
  await restoreRuntime.pushCommandResult({
    id: restoreCommand.commandId,
    command: restoreCommand.command.payload.command,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 300,
    result: {
      ok: true,
      done: true,
      nodeId: 'candidate-node',
      nodeRevision: 9,
      status: 'ready',
      rollbackApplied: true,
      rollbackMarkError: null,
      checkout: { timelineId: 'timeline-runtime', targetType: 'work-node', targetId: 'base-node', updatedAt: 301 },
      checkoutTargetRevision: 8,
      basePayloadDigest: 'sha256:payload-base',
      visiblePostcondition,
    },
  });
  assert.equal(restoreBridge.results[0]?.result.status, 'succeeded');

  const badRestoreEvents: string[] = [];
  const badRestoreBridge = new FakeBridge(badRestoreEvents);
  const badRestoreCommand = await withApprovalCapability({
    ...restoreCommand,
    commandId: asCommandId('command-worknode-restore-bad-ledger'),
    toolCallId: asToolCallId('tool-worknode-restore-bad-ledger'),
  });
  badRestoreBridge.delivery = { cursor: 1, command: badRestoreCommand };
  const badRestoreStore = new FakeStore(badRestoreEvents);
  const badRestoreRuntime = new BrowserAgentRuntime({
    bridge: badRestoreBridge,
    consumerController: controller,
    store: badRestoreStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await badRestoreRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('base-node', 300));
  await badRestoreRuntime.pullRemoteCommands(() => undefined);
  badRestoreStore.snapshotBinding = { ...binding, checkoutUpdatedAt: 301, contentRevision: 301, snapshotDigest: 'sha256:bad-restore-301' };
  await badRestoreRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('base-node', 301, ['button-base'], 300));
  await badRestoreRuntime.pushCommandResult({
    id: badRestoreCommand.commandId,
    command: badRestoreCommand.command.payload.command,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 300,
    result: {
      ok: true,
      done: true,
      nodeId: 'candidate-node',
      nodeRevision: 9,
      status: 'ready',
      rollbackApplied: false,
      rollbackMarkError: 'ledger write failed',
      checkout: { timelineId: 'timeline-runtime', targetType: 'work-node', targetId: 'base-node', updatedAt: 300 },
      checkoutTargetRevision: 8,
      basePayloadDigest: 'sha256:payload-base',
      visiblePostcondition,
    },
  });
  assert.equal(badRestoreBridge.results[0]?.result.status, 'error');
}

// The browser-side delete/use checks consume the fresh ledger and exact
// checkout receipt rather than trusting a generic `ok` flag.
{
  const deleteCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-worknode-delete-exact'),
    toolCallId: asToolCallId('tool-worknode-delete-exact'),
    command: {
      op: 'workbench.execute-command',
      payload: {
        command: {
          op: 'deleteAiTimelineWorkNode',
          nodeId: 'parent-node',
          expectedNodeRevision: 3,
          expectedSubtreeNodeCount: 2,
          expectedSubtreeDigest: `sha256:${'c'.repeat(64)}`,
        },
      },
    },
  };
  const deleteEvents: string[] = [];
  const deleteBridge = new FakeBridge(deleteEvents);
  deleteBridge.delivery = { cursor: 1, command: await withApprovalCapability(deleteCommand) };
  const deleteStore = new FakeStore(deleteEvents);
  const deleteRuntime = new BrowserAgentRuntime({
    bridge: deleteBridge,
    consumerController: controller,
    store: deleteStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await deleteRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('unrelated-node', 301));
  await deleteRuntime.pullRemoteCommands(() => undefined);
  deleteStore.snapshotBinding = { ...binding, checkoutUpdatedAt: 302, contentRevision: 302, snapshotDigest: 'sha256:delete-302' };
  await deleteRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('unrelated-node', 302));
  await deleteRuntime.pushCommandResult({
    id: deleteCommand.commandId,
    command: deleteCommand.command.payload.command,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 301,
    result: {
      ok: true,
      deleted: true,
      nodeId: 'parent-node',
      deletedNodeIds: ['parent-node'],
      remainingNodeCount: 2,
      ledgerPostcondition: {
        pass: false,
        deletedNodeIds: ['parent-node'],
        remainingNodeIds: ['child-node', 'unrelated-node'],
      },
    },
  });
  assert.equal(deleteBridge.results[0]?.result.status, 'error');

  const useCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-worknode-use-exact'),
    toolCallId: asToolCallId('tool-worknode-use-exact'),
    command: {
      op: 'workbench.execute-command',
      payload: {
        command: {
          op: 'checkoutAiTimelineWorkNode',
          nodeId: 'node-a',
          commitId: undefined,
          expectedNodeRevision: 7,
          expectedWorkingPayloadDigest: `sha256:${'a'.repeat(64)}`,
          expectedDiffDigest: `sha256:${'b'.repeat(64)}`,
          reload: false,
          approval: { mode: 'manual', approvedBy: 'user', rationale: 'use test' },
        },
      },
    },
  };
  const useEvents: string[] = [];
  const useBridge = new FakeBridge(useEvents);
  useBridge.delivery = { cursor: 1, command: await withApprovalCapability(useCommand) };
  const useStore = new FakeStore(useEvents);
  const useRuntime = new BrowserAgentRuntime({
    bridge: useBridge,
    consumerController: controller,
    store: useStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await useRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('node-b', 302));
  await useRuntime.pullRemoteCommands(() => undefined);
  useStore.snapshotBinding = { ...binding, checkoutUpdatedAt: 303, contentRevision: 303, snapshotDigest: 'sha256:use-303' };
  await useRuntime.publishMainWorkbenchSnapshot(makeExactWorkNodeSnapshot('node-b', 303, ['button-base'], 302));
  await useRuntime.pushCommandResult({
    id: useCommand.commandId,
    command: useCommand.command.payload.command,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 302,
    result: {
      ok: true,
      done: true,
      nodeId: 'node-a',
      nodeRevision: 11,
      checkoutApplied: true,
      checkout: { timelineId: 'timeline-runtime', targetType: 'work-node', targetId: 'node-a', updatedAt: 302 },
      checkoutTargetRevision: 10,
      visiblePostcondition: exactWorkNodeReceipt({
        checkoutTargetId: 'node-a',
        checkoutUpdatedAt: 302,
        checkoutTargetRevision: 10,
        nodeRevision: 11,
      }),
    },
  });
  assert.equal(useBridge.results[0]?.result.status, 'error');
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
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 100, updatedAt: 100 },
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

// A changed digest is not enough: the exact roster returned by Canvas must
// also be visible in the newest persisted product snapshot.
{
  const mismatchedEvents: string[] = [];
  const mismatchedBridge = new FakeBridge(mismatchedEvents);
  mismatchedBridge.delivery = {
    cursor: 1,
    command: await withApprovalCapability(unsignedSelectionCommand),
  };
  const mismatchedStore = new FakeStore(mismatchedEvents);
  mismatchedStore.snapshotBinding = failedBinding;
  const mismatchedRuntime = new BrowserAgentRuntime({
    bridge: mismatchedBridge,
    consumerController: controller,
    store: mismatchedStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await mismatchedRuntime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 101, updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
  });
  await mismatchedRuntime.pullRemoteCommands(() => undefined);
  await mismatchedRuntime.pushCommandResult({
    id: unsignedSelectionCommand.commandId,
    command: selectionCommandPayload,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 101,
    result: {
      selectedCharacters: [{ id: 'char-luoqian', name: '洛茜' }],
      currentView: 'canvas',
      timelineId: 'timeline-runtime',
      nodeId: 'node-luoqian',
    },
  });
  assert.equal(mismatchedBridge.results[0]?.result.status, 'error');
  assert.match(mismatchedBridge.results[0]?.result.message ?? '', /精确队伍/u);
}

// Roster order is an exact postcondition. The same member set in the wrong
// order must not make a reorder command appear successful.
{
  const orderedPayload = {
    ...selectionCommandPayload,
    characterNames: ['测试甲', '测试乙'],
    nodeTitle: '调整阵容顺序：测试甲、测试乙',
  } as const;
  const orderedCommand: Phase2ProductCommand = {
    ...unsignedSelectionCommand,
    commandId: asCommandId('command-selection-ordered'),
    toolCallId: asToolCallId('tool-selection-ordered'),
    command: {
      op: 'workbench.execute-command',
      payload: { command: orderedPayload },
    },
  };
  const orderedEvents: string[] = [];
  const orderedBridge = new FakeBridge(orderedEvents);
  const signedOrderedCommand = await withApprovalCapability(orderedCommand);
  orderedBridge.delivery = { cursor: 1, command: signedOrderedCommand };
  const orderedStore = new FakeStore(orderedEvents);
  orderedStore.snapshotBinding = failedBinding;
  const orderedRuntime = new BrowserAgentRuntime({
    bridge: orderedBridge,
    consumerController: controller,
    store: orderedStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await orderedRuntime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 101, updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [
      { id: 'operator-b', name: '测试乙' },
      { id: 'operator-a', name: '测试甲' },
    ],
    skillButtons: [],
  });
  await orderedRuntime.pullRemoteCommands(() => undefined);
  await orderedRuntime.pushCommandResult({
    id: signedOrderedCommand.commandId,
    command: orderedPayload,
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 101,
    result: {
      selectedCharacters: [
        { id: 'operator-a', name: '测试甲' },
        { id: 'operator-b', name: '测试乙' },
      ],
      currentView: 'canvas',
      timelineId: 'timeline-runtime',
      nodeId: 'node-ordered',
    },
  });
  assert.equal(orderedBridge.results[0]?.result.status, 'error');
  assert.equal(orderedBridge.results[0]?.result.code, 'AGENT_POSTCONDITION_NOT_OBSERVED');
  assert.match(orderedBridge.results[0]?.result.message ?? '', /顺序/u);
}

// Read-like commands with an explicit visible postcondition are verified too;
// calculation cannot succeed while the browser still publishes a placeholder.
{
  const calculationCommand: Phase2ProductCommand = {
    ...productCommand,
    commandId: asCommandId('command-calculation-visible'),
    toolCallId: asToolCallId('tool-calculation-visible'),
    command: {
      op: 'workbench.execute-command',
      payload: {
        command: { op: 'calculateDamage' },
        visiblePostcondition: { damageReportStatus: 'ready' },
      },
    },
  };
  const calculationEvents: string[] = [];
  const calculationBridge = new FakeBridge(calculationEvents);
  calculationBridge.delivery = { cursor: 1, command: calculationCommand };
  const calculationStore = new FakeStore(calculationEvents);
  calculationStore.snapshotBinding = failedBinding;
  const calculationRuntime = new BrowserAgentRuntime({
    bridge: calculationBridge,
    consumerController: controller,
    store: calculationStore,
    postCommandSnapshotTimeoutMs: 0,
  });
  await calculationRuntime.publishMainWorkbenchSnapshot({
    schemaVersion: 1,
    updatedAt: 101,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 101, updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [],
    skillButtons: [],
    damageReportStatus: 'placeholder',
  });
  await calculationRuntime.pullRemoteCommands(() => undefined);
  await calculationRuntime.pushCommandResult({
    id: calculationCommand.commandId,
    command: { op: 'calculateDamage' },
    status: 'done',
    source: 'agent-host',
    createdAt: 100,
    updatedAt: 101,
    result: { calculated: true },
  });
  assert.equal(calculationBridge.results[0]?.result.status, 'error');
  assert.match(calculationBridge.results[0]?.result.message ?? '', /可见后置条件/u);
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
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', contentRevision: 101, updatedAt: 101 },
    currentView: 'canvas',
    selectedCharacters: [{
      id: 'char-luoqian',
      name: '洛茜',
      element: 'physical',
      profession: '近卫',
      librarySource: 'official',
    }],
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
          result: {
            selectedCharacters: [{ id: 'char-luoqian', name: '洛茜' }],
            currentView: 'canvas',
            timelineId: 'timeline-runtime',
            nodeId: 'node-luoqian',
          },
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

// AI mode is a same-document lifecycle. Authorization and consumer startup
// finish before the route event mounts the overlay; no location.assign/reload
// is involved and failures restore the exact previous URL.
{
  let href = 'http://127.0.0.1:3030/?__agent_mode=1#/timeline';
  const events: string[] = [];
  const dependencies: DesktopAgentModeNavigationDependencies = {
    currentHref: () => href,
    pushHref: (next) => { href = next; events.push(`push:${new URL(next).hash}`); },
    replaceHref: (next) => { href = next; events.push(`replace:${new URL(next).hash}`); },
    announceRoute: (_oldHref, nextHref) => events.push(`route:${new URL(nextHref).hash}`),
    authorize: async () => { events.push('authorize'); },
    initializeWorkspace: async () => { events.push('workspace'); },
    startConsumer: async () => { events.push('consumer:start'); },
    stopConsumer: async () => { events.push('consumer:stop'); },
    clearCapability: () => { events.push('capability:clear'); },
  };
  await enterDesktopAgentModeFromWorkbench(dependencies);
  assert.equal(new URL(href).hash, '#/timeline/ai');
  assert.equal(new URL(href).searchParams.has('__agent_mode'), false);
  assert.deepEqual(events, [
    'push:#/timeline/ai',
    'authorize',
    'workspace',
    'consumer:start',
    'route:#/timeline/ai',
  ]);

  events.length = 0;
  await exitDesktopAgentModeToWorkbench(dependencies);
  assert.equal(new URL(href).hash, '#/timeline');
  assert.deepEqual(events, [
    'consumer:stop',
    'capability:clear',
    'push:#/timeline',
    'route:#/timeline',
  ]);
}

{
  const originalHref = 'http://127.0.0.1:3030/#/timeline';
  let href = originalHref;
  const events: string[] = [];
  const failure = new Error('authorization failed');
  const dependencies: DesktopAgentModeNavigationDependencies = {
    currentHref: () => href,
    pushHref: (next) => { href = next; events.push(`push:${new URL(next).hash}`); },
    replaceHref: (next) => { href = next; events.push(`replace:${new URL(next).hash}`); },
    announceRoute: (_oldHref, nextHref) => events.push(`route:${new URL(nextHref).hash}`),
    authorize: async () => { events.push('authorize'); throw failure; },
    initializeWorkspace: async () => { events.push('workspace'); },
    startConsumer: async () => { events.push('consumer:start'); },
    stopConsumer: async () => { events.push('consumer:stop'); },
    clearCapability: () => { events.push('capability:clear'); },
  };
  await assert.rejects(
    () => enterDesktopAgentModeFromWorkbench(dependencies),
    (error: unknown) => error === failure,
  );
  assert.equal(href, originalHref);
  assert.deepEqual(events, [
    'push:#/timeline/ai',
    'authorize',
    'consumer:stop',
    'capability:clear',
    'replace:#/timeline',
    'route:#/timeline',
  ]);
}

console.log('browserAgentRuntime seam contract tests passed');
