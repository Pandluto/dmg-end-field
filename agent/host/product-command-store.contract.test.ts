import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type Phase2ProductCommand,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../core/contracts/index.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import {
  createFileProductCommandStore,
  type ProductCommandStore,
} from './product-command-store.ts';
import { RemoteBrowserProductGateway } from './remote-browser-product-gateway.ts';
import type { AgentUiCapabilityClaims } from './token-authority.ts';

const binding: ProductBinding = {
  workspaceId: asWorkspaceId('workspace-product-store'),
  databaseGeneration: asDatabaseGeneration('generation-product-store'),
  timelineId: asTimelineId('timeline-product-store'),
  checkoutTargetId: 'checkout-product-store',
  checkoutUpdatedAt: 10,
  contentRevision: 10,
  snapshotDigest: 'sha256:product-store',
};

const owner: AgentUiCapabilityClaims = {
  capabilityId: 'capability-product-store',
  origin: 'http://127.0.0.1:31457',
  audience: 'workbench-ai-mode',
  issuedAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

const registration = {
  consumerId: 'consumer-product-store',
  executorLeaseId: 'lease-product-store',
  writer: true as const,
  visible: true as const,
  binding,
};

function command(id: string, reason = 'agent-read'): Phase2ProductCommand {
  return {
    protocolVersion: 1,
    commandId: asCommandId(id),
    defSessionId: asDefSessionId('session-product-store'),
    defTurnId: asDefTurnId(`turn-${id}`),
    toolCallId: asToolCallId(`tool-${id}`),
    expected: binding,
    command: {
      op: 'workbench.refresh-snapshot',
      payload: { reason: reason as 'agent-read' },
    },
  };
}

function snapshot(): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding,
    capturedAt: '2026-08-07T00:00:00.000Z',
    payload: { schemaVersion: 1 },
  };
}

function initializeStore(store: ProductCommandStore): ProductCommandStore {
  store.initialize();
  return store;
}

const root = mkdtempSync(join(tmpdir(), 'dmg-product-command-store-'));
try {
  const logPath = join(root, 'commands.ndjson');
  const firstStore = initializeStore(createFileProductCommandStore(root));
  const firstCommand = command('command-restart-1');
  const accepted = firstStore.accept(firstCommand, '2026-08-07T00:00:01.000Z');
  assert.equal(accepted.status, 'queued');
  assert.equal(accepted.deliveryMode, 'execute');
  const dispatched = firstStore.markDispatched(firstCommand.commandId);
  assert.equal(dispatched.status, 'dispatched');
  assert.equal(dispatched.deliveryMode, 'execute');
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(logPath).mode & 0o777, 0o600);
  assert.match(readFileSync(logPath, 'utf8'), /command-restart-1/);

  // A crash while appending can leave only a final partial line. The previous
  // complete state remains loadable and is normalized to reconcile mode.
  appendFileSync(logPath, '{"schemaVersion":', 'utf8');
  const recoveredStore = initializeStore(createFileProductCommandStore(root));
  const recovered = recoveredStore.get(firstCommand.commandId);
  assert.ok(recovered);
  assert.equal(recovered.status, 'reconciling');
  assert.equal(recovered.deliveryMode, 'reconcile');
  assert.equal(recovered.result, null);

  assert.throws(
    () => recoveredStore.accept(command('command-restart-1', 'different-payload'), '2026-08-07T00:00:02.000Z'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'PRODUCT_COMMAND_CONFLICT',
  );

  const firstRegistry = new BrowserConsumerRegistry();
  firstRegistry.register(owner, registration);
  const firstGateway = new RemoteBrowserProductGateway(firstRegistry, {
    commandStore: firstStore,
    clock: () => Date.parse('2026-08-07T00:00:01.000Z'),
  });
  firstGateway.publishSnapshot(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    snapshot: snapshot(),
  });
  // This first process has not restarted yet, so a newly accepted command is
  // explicitly executable exactly once.
  const liveCommand = command('command-live-1');
  await firstGateway.dispatch(liveCommand);
  const liveDelivery = firstGateway.nextCommand(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    afterCursor: 1,
  });
  assert.equal(liveDelivery?.command.commandId, liveCommand.commandId);
  assert.equal(liveDelivery?.mode, 'execute');

  // A new gateway over the same durable log must never turn either in-flight
  // command back into an executable delivery.
  const secondRegistry = new BrowserConsumerRegistry();
  secondRegistry.register(owner, registration);
  const terminalNotifications: string[] = [];
  const secondGateway = new RemoteBrowserProductGateway(secondRegistry, {
    commandStore: initializeStore(createFileProductCommandStore(root)),
    onTerminalResult: (view) => terminalNotifications.push(
      `${view.command.commandId}:${view.deliveryMode}:${view.result?.status}`,
    ),
  });
  secondGateway.publishSnapshot(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    snapshot: snapshot(),
  });
  const recoveredDelivery = secondGateway.nextCommand(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    afterCursor: 0,
  });
  assert.equal(recoveredDelivery?.command.commandId, firstCommand.commandId);
  assert.equal(recoveredDelivery?.mode, 'reconcile');
  const recoveredLiveDelivery = secondGateway.nextCommand(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    afterCursor: recoveredDelivery!.cursor,
  });
  assert.equal(recoveredLiveDelivery?.command.commandId, liveCommand.commandId);
  assert.equal(recoveredLiveDelivery?.mode, 'reconcile');

  const result = {
    commandId: firstCommand.commandId,
    status: 'not-executed' as const,
    code: 'AGENT_COMMAND_RECONCILE_UNKNOWN',
    message: 'no durable browser receipt',
    beforeRevision: binding.contentRevision,
    afterRevision: binding.contentRevision,
    completedAt: '2026-08-07T00:00:03.000Z',
  };
  const terminal = secondGateway.submitResult(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    result,
  });
  assert.equal(terminal.status, 'not-executed');
  assert.deepEqual(terminalNotifications, [
    `${firstCommand.commandId}:reconcile:not-executed`,
  ]);
  assert.deepEqual(secondGateway.submitResult(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    result,
  }), result);
  assert.deepEqual(terminalNotifications, [
    `${firstCommand.commandId}:reconcile:not-executed`,
    `${firstCommand.commandId}:reconcile:not-executed`,
  ], 'an identical retry must re-run the idempotent Host journal hook');
  assert.equal(secondGateway.getCommand(firstCommand.commandId)?.status, 'terminal');
  assert.equal(secondGateway.getCommand(firstCommand.commandId)?.deliveryMode, 'reconcile');
  assert.deepEqual(await secondGateway.reconcile(firstCommand.commandId), result);
  const restartedAgain = initializeStore(createFileProductCommandStore(root));
  assert.deepEqual(restartedAgain.get(firstCommand.commandId)?.result, result);
  assert.equal(restartedAgain.list().find((entry) => entry.command.commandId === firstCommand.commandId)?.deliveryMode, 'reconcile');
} finally {
  rmSync(root, { recursive: true, force: true });
}

const corruptRoot = mkdtempSync(join(tmpdir(), 'dmg-product-command-corrupt-'));
try {
  const corruptStore = initializeStore(createFileProductCommandStore(corruptRoot));
  const corruptCommand = command('command-invalid-transition');
  corruptStore.accept(corruptCommand, '2026-08-07T00:00:01.000Z');
  corruptStore.markDispatched(corruptCommand.commandId);
  const lines = readFileSync(join(corruptRoot, 'commands.ndjson'), 'utf8').trim().split('\n');
  const backwards = {
    ...JSON.parse(lines.at(-1)!),
    status: 'queued',
  };
  appendFileSync(join(corruptRoot, 'commands.ndjson'), `${JSON.stringify(backwards)}\n`, 'utf8');
  assert.throws(
    () => initializeStore(createFileProductCommandStore(corruptRoot)),
    (error: unknown) => error instanceof Error
      && 'code' in error
      && error.code === 'PRODUCT_COMMAND_STORE_CORRUPT',
  );
} finally {
  rmSync(corruptRoot, { recursive: true, force: true });
}

const symlinkRoot = mkdtempSync(join(tmpdir(), 'dmg-product-command-symlink-'));
const symlinkTarget = join(tmpdir(), `dmg-product-command-target-${process.pid}.ndjson`);
try {
  writeFileSync(symlinkTarget, '', { mode: 0o600 });
  symlinkSync(symlinkTarget, join(symlinkRoot, 'commands.ndjson'));
  assert.throws(
    () => initializeStore(createFileProductCommandStore(symlinkRoot)),
    (error: unknown) => error instanceof Error
      && 'code' in error
      && error.code === 'PRODUCT_COMMAND_STORE_PATH_INVALID',
  );
} finally {
  rmSync(symlinkRoot, { recursive: true, force: true });
  rmSync(symlinkTarget, { force: true });
}

console.log('product command store crash/restart contract tests passed');
