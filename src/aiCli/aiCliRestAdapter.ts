import type { BuffDraft } from '../types/buffFill';
import { createBuffFillAiDraftSchema } from '../ai/buffFillSchema';
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
  formatLibrarySummary,
  readBuffLibrary,
} from './buffFillAdapter';
import {
  KNOWN_COMMANDS,
  readAgentRecordSnapshot,
  readAgentSessions,
  readOperationLogs,
} from './aiCliAgentInfrastructure';

export const AI_CLI_REST_ENDPOINTS = [
  'GET /api/agent/guide',
  'GET /api/agent/skills',
  'GET /api/ai-cli/spec',
  'POST /api/ai-cli/run',
  'GET /api/buff/library',
  'GET /api/buff/library/<id>',
  'GET /api/buff/current',
  'GET /api/buff/fill/template',
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
  query?: Record<string, string>;
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

const buffFillTemplate = {
  id: 'example-buff-id',
  name: 'Example Buff Name',
  sourceName: 'Example Source',
  source: 'agent',
  description: 'What this Buff group does.',
  items: [
    {
      name: 'Example Item',
      sourceName: 'Example Source',
      description: 'Why these effects belong together.',
      effects: [
        {
          displayName: 'Attack +20%',
          name: 'Attack +20%',
          level: '',
          source: 'agent',
          sourceName: 'Example Source',
          description: 'Increases attack by 20%.',
          condition: '',
          effectKind: 'modifier',
          type: 'atkPercentBoost',
          value: 0.2,
          evidenceText: 'Source text proving attack +20%.',
          confidence: 0.9,
        },
      ],
    },
  ],
};

const formatGuide = {
  readFormat: {
    name: 'BuffDraft',
    endpoints: ['GET /api/buff/library', 'GET /api/buff/library/<id>', 'GET /api/buff/current'],
    shape: 'items is an object map: { [itemKey]: { effects: { [effectKey]: effect } } }',
    use: 'Read app state only. Do not send this object-map shape to fill.check/apply.',
  },
  writeProposalFormat: {
    name: 'BuffFillAiDraft',
    endpoints: ['POST /api/buff/fill/check', 'POST /api/buff/fill/apply'],
    shape: 'items is an array and effects is an array: { items: [{ effects: [...] }] }',
    use: 'Agent proposal format. Always validate with fill.check before apply.',
    requiredEffectFields: ['displayName', 'name', 'level', 'source', 'sourceName', 'description', 'condition', 'effectKind', 'type', 'value', 'evidenceText', 'confidence'],
  },
};

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
      formats: formatGuide,
      schemas: {
        read: {
          BuffDraft: {
            id: 'string',
            name: 'string',
            sourceName: 'string',
            source: 'string',
            description: 'string',
            items: '{ [itemKey]: BuffItemDraft }',
          },
        },
        writeProposal: {
          BuffFillAiDraft: createBuffFillAiDraftSchema(),
        },
      },
      examples: {
        readLibrary: {
          method: 'GET',
          path: '/api/buff/library',
          note: 'Returns BuffDraft object-map format.',
        },
        checkFill: {
          method: 'POST',
          path: '/api/buff/fill/check',
          note: 'Accepts BuffFillAiDraft array format, not BuffDraft object-map format.',
          body: { protocolVersion: 1, requestId: 'example-check', draft: buffFillTemplate },
        },
      },
      commands: Array.from(KNOWN_COMMANDS),
      commandUsage: {
        'buff.list': 'buff.list [limit]',
        'buff.show': 'buff.show <id>',
        'buff.search': 'buff.search <keyword>',
        'buff.open': 'buff.open <id>',
        'operator.add': 'operator.add <id> <name> [weapon=] [potential=] [skillLevel=]',
        'operator.show': 'operator.show [id]',
        'operator.delete': 'operator.delete <id>',
        'draft.rename': 'draft.rename <name>',
        'item.add': 'item.add <itemKey> <name> [sourceName=] [desc=]',
        'item.set': 'item.set <existingItemKey> [name=] [sourceName=] [desc=]',
        'item.delete': 'item.delete <itemKey>',
        'effect.add': 'effect.add <existingItemKey> <effectKey> type=<modifierType> value=<number> [display=] [level=] [source=] [sourceName=] [condition=] [desc=]',
        'effect.set': 'effect.set <existingItemKey> <existingEffectKey> [type=] [value=] [display=] [name=] [level=] [source=] [sourceName=] [condition=] [desc=]',
        'effect.delete': 'effect.delete <itemKey> <effectKey>',
        'fill.source': 'fill.source <text>',
        'fill.check': 'fill.check <BuffFillAiDraft JSON>',
        'fill.apply': 'fill.apply <BuffFillAiDraft JSON>',
      },
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
      mainTruth: {
        storage: 'localStorage.def.buff-editor.library.v1',
        meaning: 'Complete Buff library. Treat this as the source of truth.',
      },
      activeDraft: {
        storage: 'localStorage.def.buff-editor.draft.v1',
        meaning: 'Only the Buff currently opened in the web editor.',
      },
      formats: formatGuide,
      firstCall: 'GET /api/agent/guide',
      recommendedFlow: [
        'GET /api/agent/guide',
        'GET /api/ai-cli/spec',
        'GET /api/buff/library',
        'GET /api/buff/library/<id> when editing an existing Buff',
        'GET /api/buff/fill/template before creating a fill.check payload',
        'POST /api/buff/fill/check',
        'POST /api/buff/fill/apply only after check passes and write permission is intended',
        'GET /api/agent/logs or subscribe GET /api/agent/events for audit records',
      ],
      safetyRules: [
        'Do not write app storage directly.',
        'Treat /api/buff/library as the Buff source of truth.',
        'Treat /api/buff/current as editor state only.',
        'Do not submit BuffDraft read responses directly to fill.check/apply; convert to BuffFillAiDraft array format.',
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
          body: { protocolVersion: 1, requestId: 'example-buff-list', command: 'buff.list' },
        },
        checkFill: {
          method: 'POST',
          path: '/api/buff/fill/check',
          body: { protocolVersion: 1, requestId: 'example-check', draft: buffFillTemplate },
        },
        applyFill: {
          method: 'POST',
          path: '/api/buff/fill/apply?client=web-cli',
          body: { protocolVersion: 1, requestId: 'example-apply', draft: buffFillTemplate },
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
          title: 'Fill or Update Buff Library Entry',
          intent: 'Convert source text into a validated BuffFillAiDraft and let the app upsert it into the Buff library.',
          readBeforeUse: [
            'GET /api/agent/guide',
            'GET /api/buff/library',
            'GET /api/buff/library/<id> if the user is updating an existing Buff',
            'GET /api/buff/fill/template to see the exact write proposal shape',
            'POST /api/ai-cli/run with command fill.task when source text/context is needed',
          ],
          procedure: [
            'Read the library first. This is the source of truth.',
            'Remember read endpoints return BuffDraft object-map format.',
            'Use BuffFillAiDraft array format for fill.check/apply.',
            'Choose whether to create a new library entry or update an existing id.',
            'Build exactly one BuffFillAiDraft JSON object.',
            'Call POST /api/buff/fill/check.',
            'If check fails, fix JSON and check again.',
            'Call POST /api/buff/fill/apply only after validation passes and the user expects a write. The app writes library and active draft.',
            'Read GET /api/agent/logs or SSE records to confirm audit output.',
          ],
          outputContract: {
            formatName: 'BuffFillAiDraft',
            root: ['id', 'name', 'sourceName', 'source', 'description', 'items'],
            item: ['name', 'sourceName', 'description', 'effects'],
            effect: ['displayName', 'name', 'level', 'source', 'sourceName', 'description', 'condition', 'effectKind', 'type', 'value', 'evidenceText', 'confidence'],
          },
          hardRules: [
            'Return JSON only when producing a fill result.',
            'items must be an array, not an object map.',
            'effects must be an array, not an object map.',
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
      format: 'BuffDraft',
      warning: 'Read format only: items/effects are object maps. Do not submit this shape to fill.check/apply.',
      draft: currentDraft,
      summary: formatDraftSummary(currentDraft),
    });
  }

  if (request.method === 'GET' && request.path === '/api/buff/fill/template') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      format: 'BuffFillAiDraft',
      note: 'Use this array-based draft shape for POST /api/buff/fill/check and POST /api/buff/fill/apply.',
      template: buffFillTemplate,
      schema: createBuffFillAiDraftSchema(),
      commonMistakes: [
        'Do not send BuffDraft read format from /api/buff/current or /api/buff/library/<id> directly.',
        'items must be an array.',
        'effects must be an array.',
        'Each effect must include evidenceText and confidence.',
      ],
    });
  }

  if (request.method === 'GET' && request.path === '/api/buff/library') {
    const library = readBuffLibrary();
    const keyword = request.query?.q || request.query?.query || '';
    const summary = formatLibrarySummary(library).filter((entry) => {
      if (!keyword.trim()) {
        return true;
      }
      const normalizedKeyword = keyword.trim().toLowerCase();
      const draft = library[entry.id];
      return [
        entry.id,
        entry.name,
        entry.sourceName,
        draft?.description,
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedKeyword);
    });
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: 'def.buff-editor.library.v1',
      format: 'BuffDraftMap',
      warning: 'Read format only: library entries use object-map items/effects. For fill.check/apply use GET /api/buff/fill/template.',
      count: summary.length,
      summary,
      library,
    });
  }

  if (request.method === 'GET' && request.path.startsWith('/api/buff/library/')) {
    const buffId = decodeURIComponent(request.path.slice('/api/buff/library/'.length));
    const library = readBuffLibrary();
    const draft = library[buffId];
    if (!draft) {
      return jsonResponse(404, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: { code: 'not-found', message: `Buff library entry not found: ${buffId}` },
      });
    }
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: 'def.buff-editor.library.v1',
      format: 'BuffDraft',
      warning: 'Read format only: items/effects are object maps. For fill.check/apply convert to BuffFillAiDraft array format or use /api/buff/fill/template.',
      draft,
      summary: formatDraftSummary(draft),
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

    const cmd = request.body.command.trim().toLowerCase();
    const approvalCommands = ['proposal.approve', 'proposal.reject', 'proposal.save', 'proposal.unsave', 'y', 'n'];
    if (approvalCommands.some((ac) => cmd === ac || cmd.startsWith(`${ac} `))) {
      // Approval/save commands are user actions and must not be executed through REST.
      // Web-cli should call runAiCliCommand directly, not via REST.
      return jsonResponse(403, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: {
          code: 'forbidden',
          message: 'proposal approval/save commands are not allowed via REST. use web-cli directly.',
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
