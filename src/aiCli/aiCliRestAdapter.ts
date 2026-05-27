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
import {
  readAgentRecordSnapshot,
  readAgentSessions,
  readOperationLogs,
} from './aiCliAgentInfrastructure';

export const AI_CLI_REST_ENDPOINTS = [
  'GET /api/agent/guide',
  'GET /api/agent/skills',
  'GET /api/ai-cli/spec',
  'POST /api/ai-cli/run',
  'GET /api/buff/current',
  'POST /api/buff/fill/check',
  'POST /api/buff/fill/apply',
  'GET /api/agent/sessions',
  'GET /api/agent/logs',
  'GET /api/agent/records',
  'GET /api/agent/events',
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
        'agent.logs',
        'agent.sessions',
      ],
    });
  }

  if (request.method === 'GET' && request.path === '/api/agent/sessions') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      sessions: readAgentSessions(),
    });
  }

  if (request.method === 'GET' && request.path === '/api/agent/logs') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      operationLogs: readOperationLogs(),
    });
  }

  if (request.method === 'GET' && request.path === '/api/agent/records') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      ...readAgentRecordSnapshot(),
    });
  }

  if (request.method === 'GET' && request.path === '/api/agent/guide') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      purpose: 'Local app-controlled bridge for LLM agents. Agents propose commands or JSON; the app validates, logs, and writes.',
      firstCall: 'GET /api/agent/guide',
      recommendedFlow: [
        'GET /api/agent/guide',
        'GET /api/ai-cli/spec',
        'GET /api/buff/current',
        'POST /api/buff/fill/check',
        'POST /api/buff/fill/apply only after check passes and write permission is intended',
        'GET /api/agent/logs or subscribe GET /api/agent/events for audit records',
      ],
      safetyRules: [
        'Do not write app storage directly.',
        'Use fill.check before fill.apply.',
        'Use decimal numbers for percentages, for example 20% => 0.2.',
        'Do not invent modifier types; use the app-provided modifier catalog in fill.task.',
        'Treat REST apply as a write operation.',
      ],
      clientHints: {
        readonly: 'Default rest client is read/dry-run oriented.',
        write: 'Use explicit write profile/client only when the user has confirmed.',
        events: 'Subscribe to GET /api/agent/events for SSE agent.records updates.',
      },
      examples: {
        readDraft: {
          method: 'POST',
          path: '/api/ai-cli/run',
          body: { protocolVersion: 1, requestId: 'example-draft-show', command: 'draft.show' },
        },
        checkFill: {
          method: 'POST',
          path: '/api/buff/fill/check',
          body: { protocolVersion: 1, requestId: 'example-check', draft: '<BuffFillAiDraft>' },
        },
        applyFill: {
          method: 'POST',
          path: '/api/buff/fill/apply?client=web-cli',
          body: { protocolVersion: 1, requestId: 'example-apply', draft: '<BuffFillAiDraft>' },
        },
      },
    });
  }

  if (request.method === 'GET' && request.path === '/api/agent/skills') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      skills: [
        {
          id: 'buff.fill',
          title: 'Fill Buff Draft',
          intent: 'Convert source text into a validated BuffFillAiDraft and let the app apply it.',
          readBeforeUse: [
            'GET /api/agent/guide',
            'GET /api/buff/current',
            'POST /api/ai-cli/run with command fill.task when source text/context is needed',
          ],
          procedure: [
            'Read current draft/context.',
            'Build exactly one BuffFillAiDraft JSON object.',
            'Call POST /api/buff/fill/check.',
            'If check fails, fix JSON and check again.',
            'Call POST /api/buff/fill/apply only after validation passes and the user expects a write.',
            'Read GET /api/agent/logs or SSE records to confirm audit output.',
          ],
          outputContract: {
            root: ['id', 'name', 'sourceName', 'source', 'description', 'items'],
            item: ['name', 'sourceName', 'description', 'effects'],
            effect: ['displayName', 'name', 'level', 'source', 'sourceName', 'description', 'condition', 'effectKind', 'type', 'value', 'evidenceText', 'confidence'],
          },
          hardRules: [
            'Return JSON only when producing a fill result.',
            'effectKind must be modifier or extraHit.',
            'modifier type must be known by the app catalog.',
            'value must be a number.',
            'confidence must be between 0 and 1.',
          ],
        },
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
