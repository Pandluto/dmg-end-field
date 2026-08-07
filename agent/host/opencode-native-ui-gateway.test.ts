import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEF_EVENT_SCHEMA_VERSION,
  DEF_SESSION_SCHEMA_VERSION,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asEngineSessionId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type DefSessionV6,
  type InteractionRequest,
  type InteractionResponse,
  type ProductBinding,
} from '../core/contracts/index.ts';
import type { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import type { DefAgentHost } from './def-agent-host.ts';
import {
  OpenCodeNativeUiGateway,
  type OpenCodeNativeUiEngine,
} from './opencode-native-ui-gateway.ts';
import type { AgentUiCapabilityClaims } from './token-authority.ts';

test('native OpenCode UI keeps transcript reads upstream and routes prompts through DefAgentHost', async () => {
  const uiRoot = await mkdtemp(join(tmpdir(), 'def-native-ui-test-'));
  await writeFile(join(uiRoot, 'index.html'), '<html><head><title>OpenCode</title></head><body>native-ui</body></html>');
  await writeFile(join(uiRoot, 'font.woff'), Buffer.from('font'));

  const binding: ProductBinding = {
    workspaceId: asWorkspaceId('workspace-native-ui'),
    databaseGeneration: asDatabaseGeneration('generation-native-ui'),
    timelineId: asTimelineId('timeline-native-ui'),
    checkoutTargetId: null,
    checkoutUpdatedAt: 1,
    contentRevision: 1,
    snapshotDigest: 'digest-native-ui',
  };
  const session = makeSession(binding, 'def-session-native-ui', 'ses_native_ui');
  const foreignSession = makeSession(
    { ...binding, timelineId: asTimelineId('timeline-foreign') },
    'def-session-foreign',
    'ses_foreign',
  );
  const claims: AgentUiCapabilityClaims = {
    capabilityId: 'capability-native-ui',
    origin: 'http://127.0.0.1:31457',
    audience: 'workbench-ai-mode',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  const consumer = {
    consumerId: 'consumer-native-ui',
    executorLeaseId: 'lease-native-ui',
    binding,
    registeredAt: Date.now(),
    heartbeatExpiresAt: Date.now() + 60_000,
  };
  const started: unknown[] = [];
  const resolved: InteractionResponse[] = [];
  let pending: InteractionRequest[] = [];
  const upstreamRequests: string[] = [];
  const host = {
    readSession(defSessionId: string) {
      assert.equal(defSessionId, session.defSessionId);
      return session;
    },
    listSessions(expected?: ProductBinding) {
      return expected?.timelineId === binding.timelineId ? [session] : [session, foreignSession];
    },
    async createSession() {
      return session;
    },
    async deleteSession() {},
    async startHarnessTurn(input: unknown) {
      started.push(input);
      return { defTurnId: 'def-turn-native-ui', clientTurnId: 'native-message' };
    },
    listPendingInteractions() {
      return pending;
    },
    resolveInteraction(interactionId: string, input: { status: InteractionResponse['status']; value?: unknown }) {
      const interaction = pending.find((candidate) => candidate.interactionId === interactionId);
      assert.ok(interaction);
      pending = pending.filter((candidate) => candidate.interactionId !== interactionId);
      const response = {
        interactionId: interaction.interactionId,
        status: input.status,
        ...(Object.prototype.hasOwnProperty.call(input, 'value') ? { value: input.value } : {}),
        resolvedAt: '2026-08-08T00:00:01.000Z',
      } as InteractionResponse;
      resolved.push(response);
      return response;
    },
    getActiveIds() {
      return { defSessionId: null, defTurnId: null };
    },
    async abortTurn(defTurnId: string) {
      pending = pending.filter((candidate) => candidate.defTurnId !== defTurnId);
    },
  } as unknown as DefAgentHost;
  const consumers = {
    requireActive(candidate?: AgentUiCapabilityClaims) {
      assert.equal(candidate?.capabilityId, claims.capabilityId);
      return consumer;
    },
    currentFor(candidate: AgentUiCapabilityClaims) {
      return candidate.capabilityId === claims.capabilityId ? consumer : null;
    },
  } as unknown as BrowserConsumerRegistry;
  const engine = {
    async nativeUiDirectory() {
      return '/tmp/def-native-ui-workspace';
    },
    async requestNativeUi(pathname: string, init?: RequestInit) {
      upstreamRequests.push(pathname);
      if (pathname === '/global/event') return openEventStream(init?.signal);
      if (pathname === '/global/config') {
        return Response.json({ theme: 'system' });
      }
      if (pathname.startsWith('/session/ses_native_ui/message')) {
        return Response.json([
          {
            info: { id: 'message-native-ui', role: 'assistant' },
            parts: [{
              id: 'part-native-ui',
              type: 'text',
              text: '已删除一个按钮。\n<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="def_workbench_remove_skill_button"></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
            }],
          },
          {
            info: { id: 'message-user-native-ui', role: 'user' },
            parts: [{
              id: 'part-user-native-ui',
              type: 'text',
              text: '请解释 <｜｜DSML｜｜tool_calls> 是什么。',
            }],
          },
        ], { headers: { 'x-next-cursor': 'cursor-native-ui' } });
      }
      if (pathname.startsWith('/session/ses_native_ui')) {
        return Response.json({ id: 'ses_native_ui', title: 'DEF' });
      }
      if (pathname.startsWith('/session')) {
        return Response.json([
          { id: 'ses_native_ui', title: 'DEF' },
          { id: 'ses_foreign', title: 'foreign' },
        ]);
      }
      return Response.json({ healthy: true });
    },
  } satisfies OpenCodeNativeUiEngine;

  const gateway = new OpenCodeNativeUiGateway({
    uiRoot,
    browserOrigin: 'http://127.0.0.1:31457',
    host,
    engine,
    consumers,
    randomToken: () => 'native-ui-token-12345678901234567890',
  });

  try {
    await gateway.listen(0);
    const launch = await gateway.launch(session.defSessionId, claims);
    const launchUrl = new URL(launch.src);
    const authToken = launchUrl.searchParams.get('auth_token');
    assert.ok(authToken);

    const indexResponse = await fetch(launch.src, { headers: { accept: 'text/html' } });
    assert.equal(indexResponse.status, 200);
    const indexHtml = await indexResponse.text();
    assert.match(indexHtml, /__DEF_EMBEDDED_PROFILE__/u);
    assert.match(indexHtml, /permission-footer-actions/u);
    assert.match(indexResponse.headers.get('set-cookie') ?? '', /def_native_ui=/u);

    const fontResponse = await fetch(`${gateway.origin}/font.woff`);
    assert.equal(fontResponse.status, 200);
    assert.equal(fontResponse.headers.get('content-type'), 'font/woff');

    const sessionResponse = await fetch(`${gateway.origin}/session`, {
      headers: { authorization: `Basic ${authToken}` },
    });
    assert.equal(sessionResponse.status, 200);
    assert.deepEqual(await sessionResponse.json(), [{ id: 'ses_native_ui', title: 'DEF' }]);

    const globalConfigResponse = await fetch(`${gateway.origin}/global/config`, {
      headers: { authorization: `Basic ${authToken}` },
    });
    assert.equal(globalConfigResponse.status, 200);
    assert.deepEqual(await globalConfigResponse.json(), { theme: 'system' });
    assert.ok(upstreamRequests.includes('/global/config'));

    const messageResponse = await fetch(`${gateway.origin}/session/ses_native_ui/message?limit=2`, {
      headers: { authorization: `Basic ${authToken}` },
    });
    assert.equal(messageResponse.status, 200);
    assert.equal(messageResponse.headers.get('x-next-cursor'), 'cursor-native-ui');
    const nativeMessages = await messageResponse.json() as Array<{ parts: Array<{ text: string }> }>;
    assert.equal(nativeMessages[0]?.parts[0]?.text, '已删除一个按钮。');
    assert.equal(nativeMessages[1]?.parts[0]?.text, '请解释 <｜｜DSML｜｜tool_calls> 是什么。');

    const interactionTurnId = asDefTurnId('def-turn-native-interaction');
    const questionId = asInteractionId('question-native-ui');
    const approvalId = asInteractionId('approval-native-ui');
    pending = [
      {
        interactionId: questionId,
        defSessionId: session.defSessionId,
        defTurnId: interactionTurnId,
        toolCallId: asToolCallId('tool-question-native-ui'),
        kind: 'question',
        prompt: '请选择检查范围',
        details: { options: ['当前按钮', '整条时间轴'] },
        createdAt: '2026-08-08T00:00:00.000Z',
        expiresAt: '2026-08-08T00:15:00.000Z',
      },
      {
        interactionId: approvalId,
        defSessionId: session.defSessionId,
        defTurnId: interactionTurnId,
        toolCallId: asToolCallId('tool-approval-native-ui'),
        kind: 'approval',
        prompt: '确认修改当前时间轴',
        proposalHash: 'a'.repeat(64),
        binding: { ...binding },
        scope: ['timeline.write'],
        proposal: { operation: 'update-node', nodeId: 'node-1' },
        createdAt: '2026-08-08T00:00:00.000Z',
        expiresAt: '2026-08-08T00:15:00.000Z',
      },
    ];

    const questionResponse = await fetch(`${gateway.origin}/question`, {
      headers: { authorization: `Basic ${authToken}` },
    });
    const questions = await questionResponse.json() as Array<Record<string, unknown>>;
    assert.equal(questions.length, 1);
    assert.equal(questions[0]?.id, questionId);
    assert.equal(questions[0]?.sessionID, session.engine.sessionId);

    const permissionResponse = await fetch(`${gateway.origin}/permission`, {
      headers: { authorization: `Basic ${authToken}` },
    });
    const permissions = await permissionResponse.json() as Array<Record<string, unknown>>;
    assert.equal(permissions.length, 1);
    assert.equal(permissions[0]?.id, approvalId);
    assert.deepEqual(permissions[0]?.always, []);

    const eventAbort = new AbortController();
    const eventResponse = await fetch(`${gateway.origin}/global/event`, {
      headers: { authorization: `Basic ${authToken}` },
      signal: eventAbort.signal,
    });
    assert.equal(eventResponse.status, 200);
    assert.ok(eventResponse.body);
    const eventReader = eventResponse.body.getReader();
    try {
      const asked = await readSseUntil(
        eventReader,
        (text) => text.includes('question.asked') && text.includes('permission.asked'),
      );
      assert.match(asked, /请选择检查范围/u);
      assert.match(asked, /确认修改当前时间轴/u);

      const questionDecisionResponse = await fetch(
        `${gateway.origin}/api/native/question/${encodeURIComponent(questionId)}/reply`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sessionID: session.engine.sessionId,
            questions,
            answers: [['整条时间轴']],
          }),
        },
      );
      assert.equal(questionDecisionResponse.status, 200);
      assert.deepEqual(resolved.at(-1), {
        interactionId: questionId,
        status: 'answered',
        value: '整条时间轴',
        resolvedAt: '2026-08-08T00:00:01.000Z',
      });
      assert.match(await readSseUntil(eventReader, (text) => text.includes('question.replied')), /整条时间轴/u);

      const persistentApprovalResponse = await fetch(
        `${gateway.origin}/session/${session.engine.sessionId}/permissions/${encodeURIComponent(approvalId)}`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ response: 'always' }),
        },
      );
      assert.equal(persistentApprovalResponse.status, 400);

      const approvalDecisionResponse = await fetch(
        `${gateway.origin}/session/${session.engine.sessionId}/permissions/${encodeURIComponent(approvalId)}`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${authToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ response: 'once' }),
        },
      );
      assert.equal(approvalDecisionResponse.status, 200);
      assert.equal(await approvalDecisionResponse.json(), true);
      assert.equal(resolved.at(-1)?.status, 'approved');
      assert.match(await readSseUntil(eventReader, (text) => text.includes('permission.replied')), /"reply":"once"/u);
    } finally {
      eventAbort.abort();
      await eventReader.cancel().catch(() => undefined);
    }

    const unauthorizedResponse = await fetch(`${gateway.origin}/session`);
    assert.equal(unauthorizedResponse.status, 401);

    const attachmentResponse = await fetch(`${gateway.origin}/session/ses_native_ui/prompt_async`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messageID: 'msg_000000000002ABCDEFGHIJKLMN',
        parts: [
          { type: 'text', text: '检查附件' },
          {
            type: 'file',
            mime: 'text/plain',
            filename: '/private/Test Notes.txt',
            url: 'data:text/plain;base64,dGVzdA==',
          },
        ],
      }),
    });
    assert.equal(attachmentResponse.status, 204);
    assert.equal(started.length, 1);
    assert.deepEqual(started[0], {
      defSessionId: session.defSessionId,
      userMessage: '检查附件',
      userAttachments: [{
        type: 'file',
        mime: 'text/plain',
        filename: 'Test Notes.txt',
        url: 'data:text/plain;base64,dGVzdA==',
      }],
      clientTurnId: 'native-msg_000000000002ABCDEFGHIJKLMN',
      engineUserMessageId: 'msg_000000000002ABCDEFGHIJKLMN',
      binding,
    });

    const remoteAttachmentResponse = await fetch(`${gateway.origin}/session/ses_native_ui/prompt_async`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messageID: 'msg_000000000003ABCDEFGHIJKLMN',
        parts: [
          { type: 'text', text: '拒绝远程附件' },
          { type: 'file', mime: 'image/png', filename: 'remote.png', url: 'https://example.com/remote.png' },
        ],
      }),
    });
    assert.equal(remoteAttachmentResponse.status, 400);
    assert.equal(started.length, 1);

    const promptResponse = await fetch(`${gateway.origin}/session/ses_native_ui/prompt_async`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messageID: 'msg_000000000001ABCDEFGHIJKLMN',
        parts: [{ type: 'text', text: '检查当前排轴' }],
      }),
    });
    assert.equal(promptResponse.status, 204);
    assert.equal(started.length, 2);
    assert.deepEqual(started[1], {
      defSessionId: session.defSessionId,
      userMessage: '检查当前排轴',
      clientTurnId: 'native-msg_000000000001ABCDEFGHIJKLMN',
      engineUserMessageId: 'msg_000000000001ABCDEFGHIJKLMN',
      binding,
    });
  } finally {
    await gateway.stop();
    await rm(uiRoot, { recursive: true, force: true });
  }
});

function openEventStream(signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The reader may already have cancelled the fixture stream.
        }
      };
      if (signal?.aborted) close();
      else signal?.addEventListener('abort', close, { once: true });
      queueMicrotask(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(
          'event: message\ndata: {"payload":{"id":"evt_upstream","type":"server.connected","properties":{}}}\n\n',
        ));
      });
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + 3_000;
  let text = '';
  while (!predicate(text)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for SSE frame: ${text}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for SSE frame: ${text}`)), remaining);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (chunk.done) throw new Error(`SSE stream ended early: ${text}`);
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

function makeSession(
  binding: ProductBinding,
  defSessionId: string,
  engineSessionId: string,
): DefSessionV6 {
  return {
    schemaVersion: DEF_SESSION_SCHEMA_VERSION,
    eventSchemaVersion: DEF_EVENT_SCHEMA_VERSION,
    defSessionId: asDefSessionId(defSessionId),
    host: 'workbench',
    status: 'ready',
    workspaceId: binding.workspaceId,
    lastDatabaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    axisBindingId: null,
    boundNodeId: binding.checkoutTargetId,
    engine: {
      kind: 'opencode',
      sessionId: asEngineSessionId(engineSessionId),
      runtimeVersion: '1.17.11-def.1',
      storeSchemaVersion: 1,
    },
    harness: { stateVersion: 1, revision: 'phase6-interactive-v1' },
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  };
}
