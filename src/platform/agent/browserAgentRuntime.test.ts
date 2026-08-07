import assert from 'node:assert/strict';
import {
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
} from '../../../agent/core/contracts/ids.ts';
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

function makeJournal(): BrowserCommandJournalRecord {
  return {
    commandId: productCommand.commandId,
    commandJournalSchemaVersion: 1,
    operation: productCommand.command.op,
    command: productCommand.command,
    workspaceId: binding.workspaceId,
    databaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    checkoutTargetId: binding.checkoutTargetId,
    checkoutUpdatedAt: binding.checkoutUpdatedAt,
    expectedRevision: binding.contentRevision,
    expectedDigest: binding.snapshotDigest,
    defSessionId: productCommand.defSessionId,
    defTurnId: productCommand.defTurnId,
    toolCallId: productCommand.toolCallId,
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

  async claimCommand(): Promise<BrowserCommandClaim> {
    this.claims += 1;
    return { kind: 'claimed', journal: makeJournal() };
  }

  async recordCommandResult(): Promise<ProductCommandResult> {
    this.events.push('journal-result');
    this.result = {
      commandId: productCommand.commandId,
      status: 'succeeded',
      beforeRevision: 100,
      afterRevision: 100,
      browserResult: { refreshed: true },
      executorLeaseId: consumer.executorLeaseId,
      completedAt: '2026-08-07T00:00:01.000Z',
    };
    return this.result;
  }

  async getCommand(): Promise<BrowserCommandJournalRecord | null> { return makeJournal(); }
  async reconcileCommand(): Promise<ProductCommandResult | null> { return this.result; }
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
