import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asDefTurnId,
  asToolCallId,
  type EngineAbortReason,
  type EngineToolProjectionInput,
  type EngineToolResultInput,
} from '../../core/contracts/index.ts';
import { asRuntimeContentId, asRuntimeRunId, asRuntimeSessionId, asRuntimeTurnId } from './ids.ts';
import {
  HostToolBridge,
  HostToolBridgeError,
  type HostToolBridgeRequest,
} from './host-tool-bridge.ts';
import type { RuntimeToolInvocation } from './tool.ts';

function hostProjection(revision: number, ...names: string[]): EngineToolProjectionInput {
  return {
    revision,
    tools: names.map((name) => ({
      name,
      description: `${name} fixture`,
      inputSchema: { type: 'object' },
      risk: 'read' as const,
    })),
  };
}

function invocation(
  name = 'def.harness.route',
  projectionRevision = 1,
  callId = 'call-1',
): RuntimeToolInvocation {
  return {
    sessionId: asRuntimeSessionId('runtime-session-1'),
    defTurnId: asDefTurnId('def-turn-1'),
    runId: asRuntimeRunId('runtime-run-1'),
    turnId: asRuntimeTurnId('runtime-turn-1'),
    call: {
      type: 'tool-call',
      id: asRuntimeContentId(`content-${callId}`),
      toolCallId: asToolCallId(callId),
      name,
      arguments: { businessId: 'calculation', operation: 'calculate' },
    },
    projectionRevision,
  };
}

function nextProjection(revision: number, ...names: string[]): EngineToolProjectionInput {
  return hostProjection(revision, ...names);
}

function code(codeValue: string) {
  return (error: unknown): boolean => error instanceof HostToolBridgeError && error.code === codeValue;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('invoke exposes a source-ordered request and atomically settles result plus projection', async () => {
  let request: HostToolBridgeRequest | undefined;
  const updates: unknown[] = [];
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(1, 'def.harness.route'),
    emitRequest: (next) => { request = next; },
  });
  const pending = bridge.invoke(invocation(), new AbortController().signal, async (update) => {
    updates.push(update.detail);
  });

  await flush();
  assert.ok(request);
  assert.equal(request!.invocation.call.name, 'def.harness.route');
  assert.equal(bridge.pendingToolCallId, asToolCallId('call-1'));
  await request!.update({ toolCallId: asToolCallId('call-1'), detail: { phase: 'host' } });
  assert.deepEqual(updates, [{ phase: 'host' }]);

  const engineResult: EngineToolResultInput = {
    toolCallId: asToolCallId('call-1'),
    status: 'succeeded',
    result: { routed: true },
  };
  await bridge.submitToolResultAndUpdateProjection(engineResult, nextProjection(2, 'def.node.crud.context'));
  const settlement = await pending;

  assert.deepEqual(settlement.result, { status: 'succeeded', output: { routed: true } });
  assert.equal(settlement.nextProjection.revision, 2);
  assert.equal(bridge.projection.revision, 2);
  assert.equal(bridge.pendingToolCallId, null);
});

test('Host failure is a model-visible failed result and still advances the phase projection', async () => {
  let request: HostToolBridgeRequest | undefined;
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(3, 'def.node.crud.context'),
    emitRequest: (next) => { request = next; },
  });
  const pending = bridge.invoke(invocation('def.node.crud.context', 3, 'call-failure'), new AbortController().signal, async () => {});
  await flush();
  assert.ok(request);

  await request!.settle({
    toolCallId: asToolCallId('call-failure'),
    result: {
      status: 'failed',
      code: 'DEF_PRODUCT_COMMAND_FAILED',
      message: 'The Host command failed.',
      details: { retryable: false },
    },
    nextProjection: nextProjection(4),
  });
  const settlement = await pending;
  assert.deepEqual(settlement.result, {
    status: 'failed',
    code: 'DEF_PRODUCT_COMMAND_FAILED',
    message: 'The Host command failed.',
    details: { retryable: false },
  });
  assert.equal(bridge.projection.revision, 4);
});

test('interaction-style pending wait can resume through the same settlement seam', async () => {
  let request: HostToolBridgeRequest | undefined;
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(1, 'def.user.ask'),
    emitRequest: (next) => { request = next; },
  });
  const pending = bridge.invoke(invocation('def.user.ask'), new AbortController().signal, async () => {});
  await flush();
  assert.ok(request);

  let completed = false;
  void pending.then(() => { completed = true; });
  await flush();
  assert.equal(completed, false);
  await request!.update({ toolCallId: asToolCallId('call-1'), detail: { interaction: 'pending' } });
  await request!.settle({
    toolCallId: asToolCallId('call-1'),
    result: { status: 'succeeded', output: { answer: 'approved' } },
    nextProjection: nextProjection(2),
  });

  assert.equal((await pending).result.status, 'succeeded');
});

test('stale and unknown calls never reach the Host request callback', async () => {
  let requestCount = 0;
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(2, 'def.harness.route'),
    emitRequest: () => { requestCount += 1; },
  });

  await assert.rejects(
    bridge.invoke(invocation('def.harness.route', 1, 'call-stale'), new AbortController().signal, async () => {}),
    code('RUNTIME_TOOL_PROJECTION_STALE'),
  );
  await assert.rejects(
    bridge.invoke(invocation('def.unknown', 2, 'call-unknown'), new AbortController().signal, async () => {}),
    code('RUNTIME_TOOL_NOT_PROJECTED'),
  );
  assert.equal(requestCount, 0);
});

test('duplicate, late, and parallel results are rejected without a second phase advance', async () => {
  let request: HostToolBridgeRequest | undefined;
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(1, 'def.harness.route'),
    emitRequest: (next) => { request = next; },
  });
  const first = bridge.invoke(invocation(), new AbortController().signal, async () => {});
  await flush();

  await assert.rejects(
    bridge.invoke(invocation('def.harness.route', 1, 'call-2'), new AbortController().signal, async () => {}),
    code('RUNTIME_TOOL_PARALLEL_UNSUPPORTED'),
  );
  await assert.rejects(
    bridge.invoke(invocation('def.harness.route', 1, 'call-1'), new AbortController().signal, async () => {}),
    code('RUNTIME_TOOL_DUPLICATE_CALL'),
  );

  await request!.settle({
    toolCallId: asToolCallId('call-1'),
    result: { status: 'succeeded', output: { once: true } },
    nextProjection: nextProjection(2),
  });
  await first;
  await assert.rejects(
    bridge.settle({
      toolCallId: asToolCallId('call-1'),
      result: { status: 'succeeded', output: { late: true } },
      nextProjection: nextProjection(3),
    }),
    code('RUNTIME_TOOL_RESULT_LATE'),
  );
  assert.equal(bridge.projection.revision, 2);
});

test('abort closes the wait and refuses a late Host result', async () => {
  let request: HostToolBridgeRequest | undefined;
  const aborts: EngineAbortReason[] = [];
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(1, 'def.harness.route'),
    emitRequest: (next) => { request = next; },
    onAbort: (reason) => { aborts.push(reason); },
  });
  const controller = new AbortController();
  const pending = bridge.invoke(invocation(), controller.signal, async () => {});
  await flush();
  controller.abort({ code: 'USER_STOP', message: 'stop' });

  await assert.rejects(pending, code('RUNTIME_TOOL_ABORTED'));
  await flush();
  assert.deepEqual(aborts, [{ code: 'USER_STOP', message: 'stop' }]);
  assert.equal(bridge.projection.revision, 1);
  await assert.rejects(
    request!.settle({
      toolCallId: asToolCallId('call-1'),
      result: { status: 'succeeded', output: { late: true } },
      nextProjection: nextProjection(2),
    }),
    code('RUNTIME_TOOL_RESULT_LATE'),
  );
});

test('ordinary bounded result validation has fixed diagnostics', async () => {
  let request: HostToolBridgeRequest | undefined;
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(1, 'def.harness.route'),
    emitRequest: (next) => { request = next; },
  });
  const pending = bridge.invoke(invocation(), new AbortController().signal, async () => {});
  await flush();
  assert.ok(request);

  const oversized = 'x'.repeat(300 * 1024);
  await assert.rejects(
    request!.settle({
      toolCallId: asToolCallId('call-1'),
      result: { status: 'succeeded', output: oversized },
      nextProjection: nextProjection(2),
    }),
    code('RUNTIME_TOOL_RESULT_TOO_LARGE'),
  );
  await assert.rejects(pending, code('RUNTIME_TOOL_RESULT_TOO_LARGE'));
  assert.equal(bridge.projection.revision, 1);
});

test('close rejects a pending wait and keeps the bridge terminal', async () => {
  let request: HostToolBridgeRequest | undefined;
  const bridge = new HostToolBridge({
    initialProjection: hostProjection(1, 'def.harness.route'),
    emitRequest: (next) => { request = next; },
  });
  const pending = bridge.invoke(invocation(), new AbortController().signal, async () => {});
  await flush();
  await bridge.close();

  await assert.rejects(pending, code('RUNTIME_TOOL_BRIDGE_CLOSED'));
  assert.equal(bridge.isClosed, true);
  assert.equal(bridge.pendingToolCallId, null);
  await assert.rejects(
    request!.settle({
      toolCallId: asToolCallId('call-1'),
      result: { status: 'succeeded', output: { late: true } },
      nextProjection: nextProjection(2),
    }),
    code('RUNTIME_TOOL_RESULT_LATE'),
  );
});
