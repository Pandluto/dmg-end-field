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
  asEngineSessionId,
  asTimelineId,
  asWorkspaceId,
  type DefSessionV6,
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
    getActiveIds() {
      return { defSessionId: null, defTurnId: null };
    },
    async abortTurn() {},
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
    async requestNativeUi(pathname: string) {
      upstreamRequests.push(pathname);
      if (pathname === '/global/config') {
        return Response.json({ theme: 'system' });
      }
      if (pathname.startsWith('/session/ses_native_ui/message')) {
        return Response.json([], { headers: { 'x-next-cursor': 'cursor-native-ui' } });
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
    assert.match(await indexResponse.text(), /__DEF_EMBEDDED_PROFILE__/u);
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

    const unauthorizedResponse = await fetch(`${gateway.origin}/session`);
    assert.equal(unauthorizedResponse.status, 401);

    const unsupportedAttachmentResponse = await fetch(`${gateway.origin}/session/ses_native_ui/prompt_async`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messageID: 'msg_000000000002ABCDEFGHIJKLMN',
        parts: [
          { type: 'text', text: '检查附件' },
          { type: 'file', mime: 'text/plain', url: 'data:text/plain;base64,dGVzdA==' },
        ],
      }),
    });
    assert.equal(unsupportedAttachmentResponse.status, 400);
    assert.equal(started.length, 0);

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
    assert.equal(started.length, 1);
    assert.deepEqual(started[0], {
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
