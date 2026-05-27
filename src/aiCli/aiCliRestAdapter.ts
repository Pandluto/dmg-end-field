import type { BuffDraft } from '../types/buffFill';
import {
  AI_CLI_PROTOCOL_VERSION,
  type AiAgentClient,
  type AiCliCommandRequest,
  type AiCliExecutionContext,
} from './aiCliAgentTypes';
import {
  createAiCliCommandRequest,
  formatDraftSummary,
  runAiCliCommand,
} from './aiCliCommandService';

export const AI_CLI_REST_ENDPOINTS = [
  'GET /api/ai-cli/spec',
  'POST /api/ai-cli/run',
  'GET /api/buff/current',
  'POST /api/buff/fill/check',
  'POST /api/buff/fill/apply',
] as const;

export interface AiCliRestRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  client?: AiAgentClient;
}

export interface AiCliRestResponse {
  status: number;
  body: unknown;
}

function isCommandRequest(value: unknown): value is Partial<AiCliCommandRequest> {
  return Boolean(value && typeof value === 'object' && 'command' in value);
}

function isDraftBody(value: unknown): value is { draft: unknown; requestId?: string } {
  return Boolean(value && typeof value === 'object' && 'draft' in value);
}

function jsonResponse(status: number, body: unknown): AiCliRestResponse {
  return { status, body };
}

export function handleAiCliRestRequest(
  request: AiCliRestRequest,
  currentDraft: BuffDraft,
  context: AiCliExecutionContext,
): AiCliRestResponse {
  const client = request.client || 'rest';

  if (request.method === 'GET' && request.path === '/api/ai-cli/spec') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      endpoints: AI_CLI_REST_ENDPOINTS,
      commands: [
        'help',
        '/purpose',
        'spec',
        'draft.show',
        'item.list',
        'effect.list <itemKey>',
        'fill.task',
        'fill.check <BuffFillAiDraft JSON>',
        'fill.apply <BuffFillAiDraft JSON>',
      ],
    });
  }

  if (request.method === 'GET' && request.path === '/api/buff/current') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      draft: currentDraft,
      summary: formatDraftSummary(currentDraft),
    });
  }

  if (request.method === 'POST' && request.path === '/api/ai-cli/run') {
    if (!isCommandRequest(request.body) || typeof request.body.command !== 'string') {
      return jsonResponse(400, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: {
          code: 'bad-request',
          message: 'body.command is required',
        },
      });
    }

    const response = runAiCliCommand({
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      requestId: request.body.requestId,
      client,
      command: request.body.command,
    }, currentDraft, context);
    return jsonResponse(response.ok ? 200 : 400, response);
  }

  if (request.method === 'POST' && (request.path === '/api/buff/fill/check' || request.path === '/api/buff/fill/apply')) {
    if (!isDraftBody(request.body)) {
      return jsonResponse(400, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: {
          code: 'bad-request',
          message: 'body.draft is required',
        },
      });
    }

    const commandName = request.path.endsWith('/apply') ? 'fill.apply' : 'fill.check';
    const response = runAiCliCommand(createAiCliCommandRequest(
      `${commandName} ${JSON.stringify(request.body.draft)}`,
      client,
    ), currentDraft, {
      ...context,
      sessionId: context.sessionId,
    });
    response.requestId = request.body.requestId;
    return jsonResponse(response.ok ? 200 : 400, response);
  }

  return jsonResponse(404, {
    ok: false,
    protocolVersion: AI_CLI_PROTOCOL_VERSION,
    error: {
      code: 'not-found',
      message: `${request.method} ${request.path} is not defined`,
    },
  });
}
