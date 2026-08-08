/**
 * DEF-owned model transport port, behaviorally derived from pi-mono's
 * StreamFunction contract at e47b8e37a6211ebd0b2942fa87059d64f81eec02.
 * Once stream() returns, request/runtime failures are represented by terminal
 * ProviderStreamEvent values rather than rejected iteration.
 */
import type { RuntimeMessage } from '../messages.ts';
import type { RuntimeRunId, RuntimeTurnId } from '../ids.ts';
import type { ProviderStreamEvent } from '../stream-events.ts';
import type { RuntimeToolDescriptor } from '../tool.ts';

export interface RuntimeModelConnection {
  readonly providerId: string;
  readonly modelId: string;
  readonly baseUrl: string;
  /** Ephemeral secret: never persist, trace, or expose through Conversation. */
  readonly apiKey: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contextLimit?: number;
  readonly outputLimit?: number;
}

export interface RuntimeModelRequest {
  readonly runId: RuntimeRunId;
  readonly turnId: RuntimeTurnId;
  readonly connection: RuntimeModelConnection;
  readonly systemPrompt: string;
  readonly messages: readonly RuntimeMessage[];
  readonly tools: readonly RuntimeToolDescriptor[];
  readonly signal: AbortSignal;
}

export interface ModelStream extends AsyncIterable<ProviderStreamEvent> {}

export interface ModelDriver {
  readonly kind: string;
  /**
   * Implementations must return a stream synchronously. Fetch/setup failures
   * that occur afterwards terminate the stream with response.error.
   */
  stream(input: RuntimeModelRequest): ModelStream;
}
