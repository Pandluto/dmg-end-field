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
import type { MainWorkbenchSnapshot } from '../../utils/mainWorkbenchControl';
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

function runtimeSnapshotAt(revision: number): MainWorkbenchSnapshot {
  return {
    schemaVersion: 1,
    updatedAt: revision,
    source: 'app',
    timelineId: 'timeline-runtime',
    activeTimelineId: 'timeline-runtime',
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: revision },
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
    checkout: { targetType: 'work-node', targetId: 'candidate-node', updatedAt: 101 },
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
    checkout: { targetType: 'work-node', targetId: 'candidate-node', updatedAt: 101 },
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
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 101 },
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
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 101 },
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
    checkout: { targetType: 'snapshot', targetId: 'checkout-runtime', updatedAt: 101 },
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

console.log('browserAgentRuntime seam contract tests passed');
