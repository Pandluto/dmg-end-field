import {
  OPENCODE_TOOL_BINDINGS,
  type OpenCodeSafeToolName,
} from './tool-bindings.ts';
import { sanitizeAgentCompletedText } from '../../core/output-sanitizer.ts';

type ToolContext = {
  readonly sessionID: string;
  readonly messageID: string;
  readonly callID: string;
  readonly abort: AbortSignal;
  readonly messages?: readonly {
    readonly info?: { readonly id?: string; readonly role?: string };
  }[];
};

type TurnState = {
  readonly engineTurnId: string;
  readonly turnLease: string;
  readonly userMessageId: string;
  readonly systemContext: string;
  readonly projectionRevision: number;
  readonly safeTools: readonly OpenCodeSafeToolName[];
  readonly projectedTools: readonly {
    readonly safeName: OpenCodeSafeToolName;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly risk: 'read' | 'propose' | 'mutate';
  }[];
};

type ToolResponse =
  | { readonly status: 'succeeded'; readonly result: unknown }
  | { readonly status: 'failed'; readonly code: string; readonly message: string; readonly details?: unknown };

const safeToolNames = new Set<string>(OPENCODE_TOOL_BINDINGS.map(([, safe]) => safe));
const MAX_BRIDGE_RESPONSE_BYTES = 4_194_304;

export default async function DefOpenCodeEnginePlugin(input: { readonly directory: string }) {
  const bridge = readBridgeConfiguration();
  await bridge.pluginReady(input.directory);
  const execute = (safeToolName: OpenCodeSafeToolName) => async (args: unknown, context: ToolContext) => {
    const state = await bridge.turnState(context.sessionID, context.abort);
    if (!state.safeTools.includes(safeToolName)) {
      throw new Error(`DEF_TOOL_NOT_PROJECTED: ${safeToolName} is not available in projection ${state.projectionRevision}`);
    }
    const projectedTool = state.projectedTools.find((entry) => entry.safeName === safeToolName);
    if (!projectedTool) {
      throw new Error(`DEF_TOOL_NOT_PROJECTED: ${safeToolName} has no projected descriptor`);
    }
    const userMessageId = lastUserMessageId(context.messages);
    if (!userMessageId || userMessageId !== state.userMessageId) {
      throw new Error('DEF_TURN_CORRELATION_FAILED: Tool is not attached to the active user message');
    }
    const response = await bridge.callTool({
      sessionId: context.sessionID,
      messageId: context.messageID,
      callId: context.callID,
      engineTurnId: state.engineTurnId,
      turnLease: state.turnLease,
      userMessageId,
      safeToolName,
      input: args,
      projectionRevision: state.projectionRevision,
    }, context.abort);
    if (response.status === 'failed') {
      throw new Error(`${response.code}: ${response.message}`);
    }
    return {
      title: `DEF ${safeToolName}`,
      output: JSON.stringify(response.result),
      metadata: {
        family: 'def-engine-bridge',
        projectionRevision: state.projectionRevision,
        risk: projectedTool.risk,
        readOnly: projectedTool.risk === 'read',
      },
    };
  };

  const pluginTools = Object.fromEntries(OPENCODE_TOOL_BINDINGS.map(([, safeToolName]) => [
    safeToolName,
    {
      description: `DEF projected Tool ${safeToolName}`,
      args: {},
      execute: execute(safeToolName),
    },
  ]));

  return {
    tool: pluginTools,
    'experimental.chat.system.transform': async (
      input: { readonly sessionID?: string },
      output: { readonly system: string[] },
    ) => {
      if (!input.sessionID) throw new Error('DEF_BRIDGE_SESSION_MISSING: system projection has no session');
      const state = await bridge.turnState(input.sessionID);
      output.system.push([
        'DEF Harness is authoritative for this Turn.',
        `Current projection revision: ${state.projectionRevision}.`,
        state.systemContext,
      ].join('\n'));
    },
    'experimental.chat.tools.transform': async (
      input: { readonly sessionID: string },
      output: { tools: Record<string, unknown>; toolChoice?: 'auto' | 'required' | 'none' },
    ) => {
      const state = await bridge.turnState(input.sessionID);
      if (state.safeTools.length > 1) {
        throw new Error('DEF_PROJECTION_INVALID: only one DEF Tool may be projected per step');
      }
      if (
        state.projectedTools.length !== state.safeTools.length
        || state.projectedTools.some((tool, index) => tool.safeName !== state.safeTools[index])
      ) {
        throw new Error('DEF_PROJECTION_INVALID: projected Tool descriptors do not match the safe Tool list');
      }
      const allowed = new Set(state.safeTools);
      for (const name of Object.keys(output.tools)) {
        if (!allowed.has(name as OpenCodeSafeToolName)) delete output.tools[name];
      }
      for (const name of allowed) {
        if (!safeToolNames.has(name) || !(name in output.tools)) {
          throw new Error(`DEF_PROJECTION_BINDING_MISSING: ${name}`);
        }
      }
      for (const projected of state.projectedTools) {
        const tool = record(output.tools[projected.safeName]);
        if (!tool) throw new Error(`DEF_PROJECTION_BINDING_MISSING: ${projected.safeName}`);
        tool.description = projected.description;
        tool.inputSchema = aiJsonSchema(projected.inputSchema);
      }
      output.toolChoice = allowed.size === 0 ? 'none' : 'required';
    },
    'experimental.text.complete': async (
      _input: { readonly sessionID?: string },
      output: { text: string },
    ) => {
      output.text = sanitizeAgentCompletedText(output.text);
    },
  };
}

function readBridgeConfiguration() {
  const rawUrl = process.env.DEF_OPENCODE_TOOL_BRIDGE_URL?.trim();
  const token = process.env.DEF_OPENCODE_TOOL_BRIDGE_TOKEN?.trim();
  const processNonce = process.env.DEF_OPENCODE_PROCESS_NONCE?.trim();
  const runtimeVersion = process.env.DEF_OPENCODE_RUNTIME_VERSION?.trim();
  if (!rawUrl || !token || !processNonce || !runtimeVersion) {
    throw new Error('DEF OpenCode private bridge configuration is missing');
  }
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') {
    throw new Error('DEF OpenCode private bridge must use an exact loopback HTTP origin');
  }
  const request = async (pathname: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await fetch(new URL(pathname, url), {
      ...init,
      headers: {
        'x-def-opencode-bridge-token': token,
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    });
    const responseText = await readBoundedResponseText(response, MAX_BRIDGE_RESPONSE_BYTES);
    let body: unknown = null;
    try {
      body = JSON.parse(responseText);
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = record(body)?.error;
      const details = record(error);
      throw new Error(`${string(details?.code) ?? 'DEF_BRIDGE_HTTP_FAILED'}: ${string(details?.message) ?? `HTTP ${response.status}`}`);
    }
    return body;
  };
  return {
    async pluginReady(directory: string): Promise<void> {
      const value = await request('/v1/plugin-ready', {
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: 1,
          buildId: 'def-opencode-engine-phase4-v1',
          processNonce,
          runtimeVersion,
          directory,
        }),
      });
      if (record(value)?.ready !== true) throw new Error('DEF_PLUGIN_HANDSHAKE_FAILED: bridge rejected plugin');
    },
    async turnState(sessionId: string, signal?: AbortSignal): Promise<TurnState> {
      const value = await request(`/v1/turn-state?sessionId=${encodeURIComponent(sessionId)}`, { signal });
      const state = record(value);
      const tools = Array.isArray(state?.safeTools) ? state.safeTools : null;
      const projectedTools = Array.isArray(state?.projectedTools) ? state.projectedTools : null;
      if (
        !state
        || typeof state.engineTurnId !== 'string'
        || typeof state.turnLease !== 'string'
        || typeof state.userMessageId !== 'string'
        || typeof state.systemContext !== 'string'
        || !Number.isSafeInteger(state.projectionRevision)
        || !tools
        || !tools.every((item) => typeof item === 'string' && safeToolNames.has(item))
        || !projectedTools
      ) {
        throw new Error('DEF_BRIDGE_RESPONSE_INVALID: Turn state is malformed');
      }
      return {
        engineTurnId: state.engineTurnId,
        turnLease: state.turnLease,
        userMessageId: state.userMessageId,
        systemContext: state.systemContext,
        projectionRevision: Number(state.projectionRevision),
        safeTools: tools as OpenCodeSafeToolName[],
        projectedTools: projectedTools.map((value) => {
          const projected = record(value);
          const safeName = string(projected?.safeName);
          if (
            !projected
            || !safeName
            || !safeToolNames.has(safeName)
            || typeof projected.description !== 'string'
            || !['read', 'propose', 'mutate'].includes(String(projected.risk))
            || !record(projected.inputSchema)
          ) throw new Error('DEF_BRIDGE_RESPONSE_INVALID: projected Tool is malformed');
          return {
            safeName: safeName as OpenCodeSafeToolName,
            description: projected.description,
            inputSchema: projected.inputSchema as Record<string, unknown>,
            risk: projected.risk as 'read' | 'propose' | 'mutate',
          };
        }),
      };
    },
    async callTool(body: Record<string, unknown>, signal: AbortSignal): Promise<ToolResponse> {
      const value = await request('/v1/tool-call', {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      });
      const response = record(value);
      if (response?.status === 'succeeded') return { status: 'succeeded', result: response.result };
      if (
        response?.status === 'failed'
        && typeof response.code === 'string'
        && typeof response.message === 'string'
      ) {
        return {
          status: 'failed',
          code: response.code,
          message: response.message,
          ...(response.details === undefined ? {} : { details: response.details }),
        };
      }
      throw new Error('DEF_BRIDGE_RESPONSE_INVALID: Tool result is malformed');
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function lastUserMessageId(messages: ToolContext['messages']): string | null {
  if (!messages) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role === 'user' && typeof info.id === 'string') return info.id;
  }
  return null;
}

function aiJsonSchema(inputSchema: Record<string, unknown>): Record<PropertyKey, unknown> {
  const schema = structuredClone(inputSchema);
  const result: Record<PropertyKey, unknown> = {
    _type: undefined,
    get jsonSchema() { return schema; },
    validate: undefined,
  };
  result[Symbol.for('vercel.ai.schema')] = true;
  return result;
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const header = response.headers.get('content-length');
  if (header !== null && Number(header) > maxBytes) {
    throw new Error('DEF_BRIDGE_RESPONSE_INVALID: private bridge response is too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new Error('DEF_BRIDGE_RESPONSE_INVALID: private bridge response is too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
