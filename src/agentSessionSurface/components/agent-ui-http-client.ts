import {
  assertConversationEvent,
  assertConversationSnapshot,
  type ConversationCursor,
  type ConversationEvent,
  type ConversationProjector,
  type ConversationSnapshot,
} from '../../../agent/core/contracts/conversation.ts';
import {
  asClientTurnId,
  asDefSessionId,
  asDefTurnId,
  type DefSessionId,
  type DefTurnId,
} from '../../../agent/core/contracts/ids.ts';

const CAPABILITY_HEADER = 'x-dmg-agent-ui-capability';
const BROWSER_ORIGIN_HEADER = 'x-dmg-agent-browser-origin';
const GATEWAY_BASE_PATH = '/agent-ui/';

export interface AgentUiLaunchConfig {
  readonly apiBaseUrl: string;
  readonly browserOrigin: string;
  readonly defSessionId: DefSessionId;
  readonly capability: string;
}

export function readAgentUiLaunchConfig(locationValue: Location = window.location): AgentUiLaunchConfig {
  const params = readLaunchParams(locationValue);
  const apiOrigin = requiredParam(params, 'apiOrigin');
  const browserOrigin = normalizeOrigin(requiredParam(params, 'browserOrigin'), 'browserOrigin');
  const capability = requiredParam(params, 'capability');
  const defSessionId = asDefSessionId(requiredParam(params, 'defSessionId'));
  const apiUrl = new URL(apiOrigin, locationValue.href);
  if (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') {
    throw new TypeError('apiOrigin must use HTTP or HTTPS');
  }
  apiUrl.search = '';
  apiUrl.hash = '';
  if (apiUrl.pathname === '/' || apiUrl.pathname === '') apiUrl.pathname = GATEWAY_BASE_PATH;
  if (!apiUrl.pathname.endsWith('/')) apiUrl.pathname += '/';
  return {
    apiBaseUrl: apiUrl.toString(),
    browserOrigin,
    defSessionId,
    capability,
  };
}

/** P9 HTTP snapshot/SSE source plus the narrow prompt/stop command port. */
export class AgentUiHttpClient implements ConversationProjector {
  readonly #baseUrl: URL;
  readonly #capability: string;
  readonly #browserOrigin: string;

  constructor(config: Pick<AgentUiLaunchConfig, 'apiBaseUrl' | 'browserOrigin' | 'capability'>) {
    this.#baseUrl = new URL(config.apiBaseUrl);
    this.#capability = config.capability;
    this.#browserOrigin = config.browserOrigin;
  }

  async getSnapshot(defSessionId: DefSessionId): Promise<ConversationSnapshot> {
    const response = await this.#request(
      `sessions/${encodeURIComponent(defSessionId)}/conversation/snapshot`,
      { headers: this.#headers('application/json') },
    );
    const snapshot: unknown = await response.json();
    assertConversationSnapshot(snapshot);
    if (snapshot.defSessionId !== defSessionId) throw new Error('Conversation snapshot Session mismatch');
    return snapshot;
  }

  async *subscribe(
    defSessionId: DefSessionId,
    cursor: ConversationCursor,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationEvent> {
    const token = encodeConversationCursor(cursor);
    const response = await this.#request(
      `sessions/${encodeURIComponent(defSessionId)}/conversation/events?cursor=${encodeURIComponent(token)}`,
      {
        headers: this.#headers('text/event-stream'),
        signal,
      },
    );
    if (!response.body) throw new Error('Conversation event stream has no body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        for (;;) {
          const boundary = /\r?\n\r?\n/u.exec(buffer);
          if (!boundary || boundary.index === undefined) break;
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const event = decodeSseFrame(frame, defSessionId);
          if (event) yield event;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Abort and remote close both terminate the P4 subscription.
      }
      reader.releaseLock();
    }
  }

  async startTurn(defSessionId: DefSessionId, userMessage: string): Promise<DefTurnId> {
    const clientTurnId = asClientTurnId(createClientTurnId());
    const response = await this.#request(
      `sessions/${encodeURIComponent(defSessionId)}/turns`,
      {
        method: 'POST',
        headers: this.#headers('application/json', true),
        body: JSON.stringify({ clientTurnId, userMessage }),
      },
    );
    const value: unknown = await response.json();
    if (!isRecord(value) || value.defSessionId !== defSessionId || typeof value.defTurnId !== 'string') {
      throw new Error('Turn response is invalid');
    }
    return asDefTurnId(value.defTurnId);
  }

  async stopTurn(defSessionId: DefSessionId, defTurnIdValue: string): Promise<void> {
    const defTurnId = asDefTurnId(defTurnIdValue);
    await this.#request(
      `sessions/${encodeURIComponent(defSessionId)}/stop`,
      {
        method: 'POST',
        headers: this.#headers('application/json', true),
        body: JSON.stringify({ defTurnId }),
      },
    );
  }

  #headers(accept: string, json = false): Headers {
    const headers = new Headers({
      Accept: accept,
      [CAPABILITY_HEADER]: this.#capability,
      [BROWSER_ORIGIN_HEADER]: this.#browserOrigin,
    });
    if (json) headers.set('Content-Type', 'application/json');
    return headers;
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(new URL(path, this.#baseUrl), {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (response.ok) return response;
    let message = `Agent UI request failed (${response.status})`;
    try {
      const value: unknown = await response.json();
      if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
        message = value.error.message;
      }
    } catch {
      // Keep the bounded status-only fallback.
    }
    throw new Error(message);
  }
}

function readLaunchParams(locationValue: Location): URLSearchParams {
  const params = new URLSearchParams(locationValue.search);
  const fragment = locationValue.hash.startsWith('#') ? locationValue.hash.slice(1) : locationValue.hash;
  const queryIndex = fragment.indexOf('?');
  const fragmentQuery = queryIndex >= 0 ? fragment.slice(queryIndex + 1) : fragment.replace(/^\?/, '');
  for (const [key, value] of new URLSearchParams(fragmentQuery)) params.set(key, value);
  return params;
}

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name)?.trim();
  if (!value) throw new TypeError(`Missing Agent UI launch parameter: ${name}`);
  return value;
}

function normalizeOrigin(value: string, label: string): string {
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === 'null') {
    throw new TypeError(`${label} must be an HTTP origin`);
  }
  return url.origin;
}

function encodeConversationCursor(cursor: ConversationCursor): string {
  const payload = JSON.stringify({ cursor, version: 'c1' });
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `c1.${btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '')}`;
}

function decodeSseFrame(frame: string, defSessionId: DefSessionId): ConversationEvent | null {
  if (!frame || frame.startsWith(':')) return null;
  let eventName = '';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
    if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart());
  }
  if (data.length === 0) return null;
  const value: unknown = JSON.parse(data.join('\n'));
  if (eventName === 'gateway.error') {
    const code = isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string'
      ? value.error.code
      : 'AGENT_CONVERSATION_SOURCE_FAILED';
    throw new Error(code);
  }
  assertConversationEvent(value);
  if (value.defSessionId !== defSessionId) throw new Error('Conversation event Session mismatch');
  if (eventName && eventName !== value.type) throw new Error('Conversation SSE event name mismatch');
  return value;
}

function createClientTurnId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `agent-ui-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
