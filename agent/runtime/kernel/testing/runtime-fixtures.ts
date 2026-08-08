/** Small product-path fixtures for the Runtime Session orchestrator tests. */
import type { ClientTurnId, DefTurnId, ToolCallId } from '../../../core/contracts/ids.ts';
import {
  asClientTurnId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
} from '../../../core/contracts/ids.ts';
import type { JsonObject, JsonValue } from '../../../core/contracts/json.ts';
import type { ProductBinding } from '../../../core/contracts/product.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeFileBlock,
  RuntimeTextBlock,
  RuntimeUserMessage,
  RuntimeUsage,
} from '../messages.ts';
import {
  asRuntimeContentId,
  asRuntimeMessageId,
  asRuntimeSessionId,
  asRuntimeTurnId,
  type RuntimeMessageId,
  type RuntimeSessionId,
  type RuntimeTurnId,
} from '../ids.ts';
import type { RuntimeModelConnection } from '../provider/model-driver.ts';
import type { ProviderStreamEvent } from '../stream-events.ts';
import type {
  RuntimeToolBridge,
  RuntimeToolInvocation,
  RuntimeToolProjection,
  RuntimeToolSettlement,
  RuntimeToolUpdateListener,
} from '../tool.ts';
import { numberProviderEvents, type ProviderEventWithoutOrdinal } from './fake-model-driver.ts';

export { FakeModelDriver, numberProviderEvents } from './fake-model-driver.ts';
export { FakeToolBridge, projection } from './fake-tool-bridge.ts';
export { DeferredToolSettlement } from './fake-tool-bridge.ts';

export const FIXTURE_TIME = '2026-08-08T00:00:00.000Z';
export const FIXTURE_RUNTIME_SESSION_ID = asRuntimeSessionId('runtime-session-p7');
export const FIXTURE_DEF_SESSION_ID = asDefSessionId('def-session-p7');
export const FIXTURE_DEF_TURN_ID = asDefTurnId('def-turn-p7');
export const FIXTURE_CLIENT_TURN_ID = asClientTurnId('client-turn-p7');
export const FIXTURE_CONNECTION: RuntimeModelConnection = Object.freeze({
  providerId: 'fixture-provider',
  modelId: 'fixture-model',
  baseUrl: 'https://provider.invalid',
  apiKey: 'fixture-secret-key',
  contextLimit: 128,
  outputLimit: 32,
});

export const FIXTURE_PROJECTION: RuntimeToolProjection = Object.freeze({
  revision: 1,
  tools: Object.freeze([
    Object.freeze({
      name: 'echo',
      description: 'Return the fixture input.',
      inputSchema: Object.freeze({ type: 'object' }),
      risk: 'read' as const,
    }),
    Object.freeze({
      name: 'mutate',
      description: 'Return a fixture mutation receipt.',
      inputSchema: Object.freeze({ type: 'object' }),
      risk: 'mutate' as const,
    }),
  ]),
});

export interface FixtureContext {
  readonly stableSystemPrompt: string;
  readonly defInstructions?: string;
  readonly harnessInstructions?: string;
  readonly product?: {
    readonly binding: FixtureProductBinding;
    readonly snapshot?: {
      readonly protocolVersion: 1;
      readonly binding: FixtureProductBinding;
      readonly capturedAt: string;
      readonly payload: JsonObject;
    };
  };
}

type FixtureProductBinding = ProductBinding;

export function fixtureContext(snapshotLabel = 'snapshot-1'): FixtureContext {
  const binding = {
    workspaceId: asWorkspaceId('workspace-p7'),
    databaseGeneration: asDatabaseGeneration('generation-p7'),
    timelineId: asTimelineId('timeline-p7'),
    checkoutTargetId: null,
    checkoutUpdatedAt: 1,
    contentRevision: 1,
    snapshotDigest: `digest-${snapshotLabel}`,
  } satisfies ProductBinding;
  return {
    stableSystemPrompt: 'You are the DEF fixture assistant.',
    defInstructions: 'Keep the answer concise.',
    harnessInstructions: 'Use only the currently projected tools.',
    product: {
      binding,
      snapshot: {
        protocolVersion: 1,
        binding,
        capturedAt: FIXTURE_TIME,
        payload: { label: snapshotLabel, ephemeral: true },
      },
    },
  };
}

export function fixtureUsage(outputTokens = 1): RuntimeUsage {
  return { inputTokens: 3, outputTokens, totalTokens: 3 + outputTokens };
}

export function textResponse(text: string, responseId = 'response-text'): ProviderStreamEvent[] {
  return numberProviderEvents([
    { type: 'response.start', responseId, responseModel: 'fixture-model' },
    { type: 'text.start', contentIndex: 0 },
    { type: 'text.delta', contentIndex: 0, delta: text },
    { type: 'text.end', contentIndex: 0, text },
    {
      type: 'response.done',
      responseId,
      stopReason: 'stop',
      usage: fixtureUsage(),
    },
  ]);
}

export function toolResponse(
  calls: readonly { readonly id: string; readonly name: string; readonly arguments: JsonObject }[],
  responseId = 'response-tool',
): ProviderStreamEvent[] {
  const events: ProviderEventWithoutOrdinal[] = [
    { type: 'response.start', responseId, responseModel: 'fixture-model' },
  ];
  calls.forEach((call, index) => {
    const toolCallId = asToolCallId(call.id);
    events.push(
      { type: 'tool-call.start', contentIndex: index, toolCallId, name: call.name },
      {
        type: 'tool-call.delta',
        contentIndex: index,
        toolCallId,
        nameDelta: '',
        argumentsDelta: JSON.stringify(call.arguments),
      },
      { type: 'tool-call.end', contentIndex: index, toolCallId, name: call.name, arguments: call.arguments },
    );
  });
  events.push({
    type: 'response.done',
    responseId,
    stopReason: 'tool-use',
    usage: fixtureUsage(),
  });
  return numberProviderEvents(events);
}

export function overflowResponse(code = 'context_overflow'): ProviderStreamEvent[] {
  return numberProviderEvents([{
    type: 'response.error',
    failure: {
      kind: 'context-overflow',
      code,
      message: 'fixture context overflow',
      retryable: false,
    },
  }]);
}

export function fixtureUserMessage(
  text: string,
  options: {
    readonly runId?: string;
    readonly defTurnId?: DefTurnId;
    readonly clientTurnId?: ClientTurnId;
    readonly turnId?: RuntimeTurnId;
    readonly messageId?: RuntimeMessageId;
  } = {},
): RuntimeUserMessage {
  const runId = options.runId ?? 'run-p7';
  const turnId = options.turnId ?? asRuntimeTurnId(`${runId}:turn:1`);
  const messageId = options.messageId ?? asRuntimeMessageId(`${runId}:user`);
  const contentId = asRuntimeContentId(`${messageId}:content:0`);
  return {
    schemaVersion: 1,
    id: messageId,
    createdAt: FIXTURE_TIME,
    defTurnId: options.defTurnId ?? FIXTURE_DEF_TURN_ID,
    turnId,
    role: 'user',
    clientTurnId: options.clientTurnId ?? FIXTURE_CLIENT_TURN_ID,
    content: [{ type: 'text', id: contentId, text }],
  };
}

export function fixtureSettlement(
  toolCallId: ToolCallId,
  output: JsonValue,
  nextProjection: RuntimeToolProjection = FIXTURE_PROJECTION,
): RuntimeToolSettlement {
  return {
    toolCallId,
    result: { status: 'succeeded', output },
    nextProjection,
  };
}

export function assistantText(message: RuntimeAssistantMessage): string {
  return message.content
    .filter((block): block is RuntimeTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export function createAbortableDeferredBridge(
  initialProjection: RuntimeToolProjection = FIXTURE_PROJECTION,
): {
  readonly bridge: RuntimeToolBridge & { readonly projection: RuntimeToolProjection; abort(): Promise<void>; close(): Promise<void> };
  readonly invocations: RuntimeToolInvocation[];
  readonly resolve: (settlement: RuntimeToolSettlement) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolveDeferred!: (settlement: RuntimeToolSettlement) => void;
  let rejectDeferred!: (error: unknown) => void;
  let pendingReject: ((error: unknown) => void) | undefined;
  let closed = false;
  const invocations: RuntimeToolInvocation[] = [];
  const deferred = new Promise<RuntimeToolSettlement>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  const bridge = {
    projection: initialProjection,
    invoke(input: RuntimeToolInvocation, signal: AbortSignal, _onUpdate: RuntimeToolUpdateListener): Promise<RuntimeToolSettlement> {
      if (closed) return Promise.reject(new Error('fixture bridge closed'));
      invocations.push(input);
      return new Promise<RuntimeToolSettlement>((resolve, reject) => {
        pendingReject = reject;
        const onAbort = (): void => {
          signal.removeEventListener('abort', onAbort);
          pendingReject = undefined;
          reject(new Error('fixture tool aborted'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
        void deferred.then(
          (settlement) => {
            signal.removeEventListener('abort', onAbort);
            if (pendingReject === reject) pendingReject = undefined;
            resolve(settlement);
          },
          (error) => {
            signal.removeEventListener('abort', onAbort);
            if (pendingReject === reject) pendingReject = undefined;
            reject(error);
          },
        );
      });
    },
    async abort(): Promise<void> {
      closed = true;
      pendingReject?.(new Error('fixture tool aborted'));
      pendingReject = undefined;
    },
    async close(): Promise<void> {
      closed = true;
      pendingReject?.(new Error('fixture bridge closed'));
      pendingReject = undefined;
    },
  };
  return { bridge, invocations, resolve: resolveDeferred, reject: rejectDeferred };
}

export function asFixtureRuntimeSessionId(value = 'runtime-session-p7'): RuntimeSessionId {
  return asRuntimeSessionId(value);
}

export function asFixtureRuntimeTurnId(value: string): RuntimeTurnId {
  return asRuntimeTurnId(value);
}

export type FixtureFileBlock = RuntimeFileBlock;
export type FixtureTextBlock = RuntimeTextBlock;
