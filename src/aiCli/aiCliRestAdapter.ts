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
  WEAPON_DRAFT_STORAGE_KEY,
  WEAPON_LIBRARY_STORAGE_KEY,
  getWeaponFillAdapterDiagnostics,
  readCurrentWeaponDraft,
  readWeaponLibrary,
} from './weaponFillAdapter';
import {
  OPERATOR_DRAFT_STORAGE_KEY,
  OPERATOR_LIBRARY_STORAGE_KEY,
  formatOperatorLibrarySummary,
  readCurrentOperatorDraft,
  readOperatorLibrary,
} from './operatorFillAdapter';
import {
  EQUIPMENT_DRAFT_STORAGE_KEY,
  EQUIPMENT_LIBRARY_STORAGE_KEY,
  formatEquipmentLibrarySummary,
  readCurrentEquipmentLibrary,
  readEquipmentLibrary,
} from './equipmentFillAdapter';
import {
  findWeaponLibraryEntry,
  formatWeaponLibrarySummary,
} from './weaponDataSurface';
import {
  KNOWN_COMMANDS,
  readAgentRecordSnapshot,
  readAgentSessions,
  readOperationLogs,
  readPendingAgentProposals,
} from './aiCliAgentInfrastructure';

export const AI_CLI_REST_ENDPOINTS = [
  'GET /api/agent/guide',
  'GET /api/agent/skills',
  'GET /api/ai-cli/spec',
  'POST /api/ai-cli/run',
  'GET /api/buff/library',
  'GET /api/buff/library/<id>',
  'GET /api/buff/current',
  'GET /api/weapon/current',
  'GET /api/weapon/library',
  'GET /api/weapon/library/<id-or-name>',
  'GET /api/weapon/fill/template',
  'POST /api/weapon/fill/check',
  'POST /api/weapon/fill/apply',
  'GET /api/operator/current',
  'GET /api/operator/library',
  'GET /api/operator/library/<id-or-name>',
  'GET /api/operator/fill/template',
  'POST /api/operator/fill/check',
  'POST /api/operator/fill/apply',
  'GET /api/equipment/current',
  'GET /api/equipment/library',
  'GET /api/equipment/library/<id-or-name>',
  'GET /api/equipment/fill/template',
  'POST /api/equipment/fill/check',
  'POST /api/equipment/fill/apply',
  'GET /api/buff/fill/template',
  'POST /api/buff/fill/check',
  'POST /api/buff/fill/apply',
  'GET /api/agent/sessions',
  'GET /api/agent/logs',
  'GET /api/agent/records',
  'GET /api/agent/events',
  'GET /api/agent/scripts',
  'GET /api/agent/scripts/<name>',
  'POST /api/agent/scripts/write',
  'POST /api/agent/scripts/run',
  'POST /api/agent/scripts/delete',
  'GET /api/main-workbench/snapshot',
  'GET /api/main-workbench/commands',
  'POST /api/main-workbench/commands/enqueue',
  'POST /api/main-workbench/commands/result',
  'GET /api/def-tools',
  'GET /api/def-tools/describe?name=<toolName>',
  'POST /api/def-tools/call',
  'POST /api/def-tools/<toolName>/call',
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

export function getAiCliRestDiagnostics() {
  return {
    weaponFill: getWeaponFillAdapterDiagnostics(),
  };
}

function isCommandRequest(value: unknown): value is Partial<AiCliCommandRequest> {
  return Boolean(value && typeof value === 'object' && 'command' in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveRestClient(request: AiCliRestRequest): AiAgentClient {
  const bodyClient = isRecord(request.body) && typeof request.body.client === 'string' ? request.body.client : '';
  return (request.client || bodyClient || 'rest') as AiAgentClient;
}

function decodePathSegment(encoded: string): { ok: true; value: string } | { ok: false; response: AiCliRestResponse } {
  try {
    return { ok: true, value: decodeURIComponent(encoded) };
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: {
          code: 'bad-url-encoding',
          message: 'URL path contains malformed percent-encoding. Use encodeURIComponent for path parameters.',
        },
      }),
    };
  }
}

function isDraftBody(value: unknown): value is { draft: unknown; requestId?: string } {
  return Boolean(value && typeof value === 'object' && 'draft' in value);
}

function jsonResponse(status: number, body: unknown): AiCliRestResponse {
  return { status, body };
}

function pendingApplyBlockedResponse(pendingCount: number): AiCliRestResponse {
  return jsonResponse(409, {
    ok: false,
    protocolVersion: AI_CLI_PROTOCOL_VERSION,
    lines: [
      `[blocked] fill.apply refused because ${pendingCount} pending proposal${pendingCount === 1 ? '' : 's'} already exist (已有 ${pendingCount} 个待处理提案，拒绝继续创建新提案)`,
      '[action] Do not submit another fill.apply now. Call REST proposal.clear, then resubmit only the current proposal. For multiple edits, submit and finish them one by one. (不要继续提交 fill.apply；请先通过 REST 调用 proposal.clear，再只重新提交当前这一个；多个提案请逐个提交、逐个审批)',
    ],
    error: {
      code: 'pending-proposals-blocking',
      message: 'pending proposals block another fill.apply',
      details: { pendingCount },
    },
    effects: { writes: false, storage: [] },
  });
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
  const client = resolveRestClient(request);

  if (request.method === 'GET' && request.path === '/api/ai-cli/spec') {
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      endpoints: AI_CLI_REST_ENDPOINTS,
      diagnostics: getAiCliRestDiagnostics(),
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
        'weapon.list': 'weapon.list [limit]',
        'weapon.show': 'weapon.show <id|name>',
        'weapon.search': 'weapon.search <keyword>',
        'weapon.draft.show': 'weapon.draft.show',
        'weapon.open': 'weapon.open <id|name>',
        'weapon.fill.task': 'weapon.fill.task',
        'weapon.fill.check': 'weapon.fill.check <WeaponFillAiDraft JSON>',
        'weapon.fill.apply': 'weapon.fill.apply <WeaponFillAiDraft JSON>',
        'operator.fill.task': 'operator.fill.task',
        'operator.fill.check': 'operator.fill.check <OperatorFillAiDraft JSON>',
        'operator.fill.apply': 'operator.fill.apply <OperatorFillAiDraft JSON>',
        'equipment.fill.task': 'equipment.fill.task',
        'equipment.fill.check': 'equipment.fill.check <EquipmentFillAiDraft JSON>',
        'equipment.fill.apply': 'equipment.fill.apply <EquipmentFillAiDraft JSON>',
        'equipment.setbuff': 'equipment.setBuff { gearSetId, buffKey?, buff } or { gearSetId, threePieceBuffs, mode?: merge|replace }',
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
      weaponTruth: {
        storage: 'localStorage.def.weapon-sheet.library.v1',
        sourceData: 'Official/static source data is outside Agent CLI. Use app data services before submitting weapon.fill drafts.',
        meaning: 'Complete local Weapon library. Official/static source data is outside Agent CLI.',
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
        'For weapon fill: GET /api/weapon/library and GET /api/weapon/current, then POST /api/ai-cli/run with command weapon.fill.task to get schema',
        'GET /api/agent/logs or subscribe GET /api/agent/events for audit records',
      ],
      safetyRules: [
        'Do not write app storage directly.',
        'Treat /api/buff/library as the Buff source of truth.',
        'Treat /api/buff/current as editor state only.',
        'Treat /api/weapon/library as local Weapon truth. Official/static Weapon source data is outside Agent CLI.',
        'Do not submit BuffDraft read responses directly to fill.check/apply; convert to BuffFillAiDraft array format.',
        'Use fill.check before fill.apply.',
        'Use weapon.fill.check before weapon.fill.apply.',
        'Use decimal numbers for percentages, for example 20% => 0.2.',
        'Do not invent modifier types; use the app-provided modifier catalog in fill.task.',
        'For Weapon fill, only skill3.effects is preserved; use category condition/passive/countable and leave imgUrl empty if no image URL exists.',
        'Treat REST apply as a proposal creation only; it does NOT save to library.',
        'After REST apply, guide the user to open /ai-cli and use Y/Y or proposal.approve #1 / proposal.save #1.',
        'Before fill.apply, self-check the pending proposal count with proposal.list.',
        'If any pending proposal exists, REST fill.apply is refused. Call proposal.clear through POST /api/ai-cli/run only for stale backlog, then resubmit only the current proposal. If multiple edits are intended, submit and finish them one by one.',
        'Do NOT ask the user to re-run fill.apply in the browser.',
      ],
      clientHints: {
        readonly: 'Default rest client is read/dry-run oriented.',
        write: 'Use explicit write profile/client only when the user has confirmed.',
        events: 'Subscribe to GET /api/agent/events for SSE agent.records updates.',
        handoff: 'REST fill.apply creates a proposal. Web CLI imports pending proposals via SSE. REST refuses another fill.apply while any pending proposal exists. Call proposal.clear through POST /api/ai-cli/run only for stale backlog, then resubmit only the current proposal, or submit multiple edits one by one. Do not re-run fill.apply in Web CLI.',
      },
      scriptWorkbench: {
        purpose: 'Optional temporary helper scripts for JSON cleanup, comparison, batching, and draft generation.',
        directory: '.runtime/def-agent/scripts',
        endpoints: [
          'GET /api/agent/scripts',
          'GET /api/agent/scripts/<name>',
          'POST /api/agent/scripts/write',
          'POST /api/agent/scripts/run',
          'POST /api/agent/scripts/delete',
        ],
        rules: [
          'Use scripts only when the transformation is too large or repetitive for direct model reasoning.',
          'Scripts must be small .js/.mjs files and operate on JSON input/output.',
          'Scripts may support fill draft generation, library diffing, duplicate checks, and validation-error aggregation.',
          'Scripts must not write app truth directly. Final writes still go through fill.check/fill.apply proposals.',
          'Do not use scripts for source-code edits, git, npm install, shell automation, or external data fetching.',
        ],
        writeExample: {
          method: 'POST',
          path: '/api/agent/scripts/write',
          body: {
            name: 'compare-library.mjs',
            content: 'const chunks=[]; for await (const c of process.stdin) chunks.push(c); const { input } = JSON.parse(Buffer.concat(chunks).toString("utf8")); console.log(JSON.stringify({ ok: true, count: Array.isArray(input?.items) ? input.items.length : 0 }));',
          },
        },
        runExample: {
          method: 'POST',
          path: '/api/agent/scripts/run',
          body: {
            name: 'compare-library.mjs',
            input: { items: [] },
          },
        },
      },
      mainWorkbenchControl: {
        purpose: 'Code-driven control surface for the main workbench selection/timeline/buff/damage flow.',
        storage: {
          commandQueue: 'localStorage.def.main-workbench.command-queue.v1',
          resultLog: 'localStorage.def.main-workbench.result-log.v1',
          snapshot: 'localStorage.def.main-workbench.snapshot.v1',
        },
        endpoints: [
          'GET /api/def-tools',
          'GET /api/def-tools/describe?name=<toolName>',
          'POST /api/def-tools/call',
          'POST /api/def-tools/<toolName>/call',
          'GET /api/main-workbench/evidence?prompt=<user text>&previousButtonId=<optional>',
          'GET /api/main-workbench/snapshot',
          'GET /api/main-workbench/commands?status=pending',
          'GET /api/main-workbench/commands?batchId=<batchId>',
          'GET /api/main-workbench/commands/batch?batchId=<batchId>',
          'POST /api/main-workbench/commands/enqueue',
        ],
        commandOps: [
          'selectCharacters',
          'openView',
          'openWorkbenchPage',
          'clearTimeline',
          'setOperatorWeapon',
          'setOperatorEquipment',
          'addSkillButton',
          'removeSkillButton',
          'addBuff',
          'addBuffToButtons',
          'removeBuff',
          'setTargetResistance',
          'saveTimelineSnapshot',
          'restoreTimelineSnapshot',
          'listTimelineSnapshots',
          'createAiTimelineWorkNodeFromCurrent',
          'patchAiTimelineWorkNode',
          'diffAiTimelineWorkNode',
          'checkoutAiTimelineWorkNode',
          'restoreAiTimelineWorkNodeBase',
          'refreshOperatorConfig',
          'calculateDamage',
          'refreshSnapshot',
        ],
        rules: [
          'Prefer DEF typed tools over hand-written command JSON when a matching tool exists.',
          'Use GET /api/def-tools and /api/def-tools/describe to discover tool schema, risk, approval, verification, rollback, and status.',
          'Use POST /api/def-tools/call with {"tool":"def.workbench.list_buttons","input":{...}} or POST /api/def-tools/<toolName>/call.',
          'Use resolver tools such as def.workbench.find_buttons, def.buff.resolve, def.skill.resolve, and def.character.resolve before edit tools when the target is ambiguous.',
          'Use verification tools such as def.verify.command_result, def.verify.snapshot_delta, def.verify.buttons_have_buff, and def.verify.damage_recalculated before claiming completion.',
          'Use def.worknode.patch as the class-code Patch DSL / CRUD path for high-risk, batch, timeline rewrite, or trial-and-error edits.',
          'Commands are declarative JSON; never simulate DOM clicks.',
          'The browser page executes commands through existing React services and writes results back to result-log/snapshot.',
          'For read-only questions, prefer GET /api/main-workbench/evidence with the user prompt; use focus/previousFocus to answer pronoun follow-ups.',
          'Evidence is current checkout state only; it is not an appdata AI work node and must not be used as branch/commit/rollback state.',
          'For multi-command enqueue, keep the returned batchId and use GET /api/main-workbench/commands/batch?batchId=<batchId> to observe total/pending/running/done/error before summarizing.',
          'Enqueue success only means commands entered the queue; use batch summary or result log to decide whether the browser has executed the batch.',
          'Read snapshot after enqueue to confirm selectedCharacters, skillButtons, buff ids, and damage totals.',
          'Use addBuffToButtons when the same complete buff object must be attached to multiple explicit buttonIds; do not enqueue one addBuff per target unless there is only one target.',
          'For risky/batch/timeline rewrite operations, call def.worknode.patch_and_validate directly. It creates a Work Node only when needed, writes only workingPayload during staging, and checkout remains an explicit tool decision; use restoreAiTimelineWorkNodeBase only for a chosen node rollback.',
          'patchAiTimelineWorkNode applies a constrained patch DSL to appdata node.workingPayload only; it must not be described as writing browser localStorage/sessionStorage current checkout.',
          'saveTimelineSnapshot/restoreTimelineSnapshot are legacy user snapshot compatibility tools for current checkout only; do not use them as AI branch logs or appdata work nodes.',
          'Use setOperatorWeapon to equip a selected operator weapon before refreshing operator config.',
          'Use setOperatorEquipment with gearSetName/gearSetId and fillSlots:true for four-piece equipment, or slotKey plus equipmentName/equipmentId for one piece.',
          'Use openWorkbenchPage for operatorConfig, weaponSheet, equipmentSheet, damageSheet, damageReportPpt, aiCli, selection, or canvas.',
        ],
        enqueueExample: {
          method: 'POST',
          path: '/api/main-workbench/commands/enqueue',
          body: {
            command: { op: 'selectCharacters', characterIds: ['operator-id'], openCanvas: true },
            source: 'script',
          },
        },
      },
      emergencyFallback: {
        name: 'now-storage proposal injection',
        useOnlyWhen: 'REST fill.check/fill.apply is blocked by a verified REST runtime/cache mismatch and the draft data has already been independently validated.',
        effect: 'Creates a Wait/Wait proposal only; it must still be approved and saved through Web CLI Y/Y before the library changes.',
        bridgeSyncRequired: [
          'POST http://127.0.0.1:31457/local-data/now-storage with the full archive object',
          'POST http://127.0.0.1:31457/local-data/now-storage-state with {"forceApply":true}',
          'Refresh Web CLI after bridge sync so browser localStorage imports the proposal',
        ],
        warning: 'Do not use direct now-storage writes as the normal agent path. Prefer REST validation/apply whenever /health diagnostics match the current contract.',
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
        readWeaponLocalTruth: {
          method: 'GET',
          path: '/api/weapon/library',
          note: 'Read local Weapon truth through Agent CLI. Official/static source data is outside Agent CLI.',
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
          id: 'agent.script-workbench',
          title: 'Temporary JSON Script Workbench',
          intent: 'Maintain a few small temporary scripts for repetitive DEF JSON cleanup, comparison, batching, and draft generation.',
          readBeforeUse: [
            'GET /api/agent/guide',
            'GET /api/agent/scripts to inspect existing helper scripts and constraints',
          ],
          procedure: [
            'Prefer direct REST reads and model reasoning for small tasks.',
            'For repetitive or large JSON transformations, write one small .mjs/.js helper with POST /api/agent/scripts/write.',
            'Pass all business data through the run input body; do not assume access to project files.',
            'Run it with POST /api/agent/scripts/run and parse stdout/json from the response.',
            'Use the script output only as a candidate draft or report.',
            'Validate generated drafts with fill.check before any fill.apply.',
            'Delete stale helper scripts when they are no longer useful.',
          ],
          outputContract: {
            writeBody: ['name', 'content'],
            runBody: ['name', 'input'],
            scriptInput: '{ protocolVersion, input, restBaseUrl, constraints } via stdin JSON',
            scriptOutput: 'Print one JSON object to stdout when structured output is needed.',
          },
          hardRules: [
            'Scripts are for DEF JSON work only.',
            'Do not edit project source code through scripts.',
            'Do not use git, npm install, shell automation, or external network fetches.',
            'Do not write app truth directly; use fill.check/fill.apply proposals.',
          ],
        },
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
            'Call POST /api/buff/fill/apply only after validation passes. This creates a proposal, NOT a library write.',
            'After apply, guide the user to open /ai-cli. The pending proposal is imported automatically.',
            'Single pending: user presses Y to approve, then Y to save.',
            'Before fill.apply, self-check pending count with proposal.list.',
            'If any pending proposal exists, REST fill.apply is refused. For stale backlog, call proposal.clear through POST /api/ai-cli/run, then resubmit only the current proposal. If multiple edits are intended, submit and finish them one by one.',
            'Do NOT ask the user to re-run fill.apply in the browser.',
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
        {
          id: 'weapon.fill',
          title: 'Fill or Update Weapon Sheet Entry',
          intent: 'Convert an app-provided Weapon draft into a validated WeaponFillAiDraft proposal.',
          readBeforeUse: [
            'GET /api/agent/guide',
            'GET /api/weapon/fill/template or weapon.fill.task to get schema and supported effect types',
            'GET /api/weapon/library and GET /api/weapon/current when updating local Weapon state',
          ],
          procedure: [
            'Use app-provided source data outside Agent CLI when needed. Agent CLI only owns current/library/fill/proposal state.',
            'Build exactly one WeaponFillAiDraft JSON object aligned with Sheet-Weapon.',
            'Leave imgUrl empty if source data has no image URL. Do not use url as imgUrl.',
            'Only skill3.effects is preserved by Sheet-Weapon.',
            'Use category condition/passive/countable for skill3 effects.',
            'Call POST /api/weapon/fill/check.',
            'If check fails, fix JSON and check again.',
            'Call POST /api/weapon/fill/apply only after validation passes. This creates a proposal, NOT a library write.',
            'After apply, guide the user to open /ai-cli. The pending proposal is imported automatically.',
            'Single pending: user presses Y to approve, then Y to save.',
          ],
          outputContract: {
            formatName: 'WeaponFillAiDraft',
            root: ['id', 'name', 'rarity', 'type?', 'description', 'imgUrl?', 'attackGrowth?', 'sourceName', 'source', 'skills'],
            skill: ['name', 'statType', 'effects', 'levels'],
            effect: ['name', 'type', 'category', 'levels'],
          },
          hardRules: [
            'Return JSON only when producing a fill result.',
            'Do not include url.',
            'skill1.effects and skill2.effects are rejected.',
            'skill3.effects.*.category must be condition, passive, or countable.',
            'effect levels must be numbers, not string numbers.',
            'weapon.fill.apply creates a proposal only; it does not save the Weapon library.',
          ],
        },
        {
          id: 'operator.fill',
          title: 'Fill or Update Operator Editor Entry',
          intent: 'Convert an app-provided Operator draft into a validated OperatorFillAiDraft proposal.',
          readBeforeUse: [
            'GET /api/operator/fill/template or operator.fill.task for schema and allowlists',
            'GET /api/operator/library and GET /api/operator/current when updating local Operator state',
          ],
          procedure: [
            'Use app-provided source data outside Agent CLI when needed. Agent CLI only owns current/library/fill/proposal state.',
            'Build one OperatorFillAiDraft JSON object with id/name/rarity/profession/weapon/element/mainStat/subStat/skills.',
            'Use latest system skill keys: skill-{buttonType}-{index}, e.g. skill-A-1 / skill-B-1 / skill-E-1 / skill-Q-1. Each buttonType counts from 1.',
            'Call POST /api/operator/fill/check.',
            'If check fails, fix JSON and check again.',
            'Call POST /api/operator/fill/apply only after validation passes. This creates a proposal, NOT a library write.',
            'Approval writes the Operator working draft; save writes the Operator local library.',
          ],
          outputContract: {
            formatName: 'OperatorFillAiDraft',
            root: ['id', 'name', 'rarity', 'profession', 'weapon', 'element', 'mainStat', 'subStat', 'skills', 'buffs?'],
            skillKeys: 'Record keys should use skill-{buttonType}-{index}; legacy skill-1 input is accepted but normalized by check/apply.',
            skill: ['displayName', 'buttonType', 'iconUrl?', 'hitCount?', 'hitMeta?'],
            buffs: 'optional talent/potential/skill groups; each group is { effects: Record<effectKey, effect> }',
            buffEffect: ['effectId?', 'name', 'effectKind?', 'type', 'category', 'value?', 'multiplier?', 'maxStacks?', 'unit?', 'valueMode?', 'derivedValue?', 'extraHitConfig?', 'description?', 'raw?'],
            derivedValue: {
              source: ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'],
              perPointValue: 'number; 每点提升多少. Percent-like buff types use decimal numbers, e.g. 每点 +0.10% => 0.001',
            },
          },
          hardRules: [
            'buttonType must be A/B/E/Q/Dot.',
            'Skill keys are system-maintained; prefer skill-A-1 / skill-B-1 / skill-E-1 / skill-Q-1 / skill-Dot-1, not plain A/B/E/Q/Dot or old global skill-1 numbering.',
            'skill hit level values must be numbers.',
            'operator buff category must be passive, condition, or countable; legacy positive is migration-only.',
            'fixed operator buff effects use numeric value; derived effects use valueMode=derived and derivedValue.source/perPointValue.',
            'Do not use arbitrary formulas in operator buffs. For 智识+意志, create two derived effects.',
            'operator.fill.apply creates a proposal only; it does not save the Operator library.',
          ],
        },
        {
          id: 'equipment.fill',
          title: 'Fill or Update Equipment Sheet Entry',
          intent: 'Convert an app-provided Equipment draft into a validated EquipmentFillAiDraft proposal.',
          readBeforeUse: [
            'GET /api/equipment/fill/template or equipment.fill.task for schema and allowlists',
            'GET /api/equipment/library and GET /api/equipment/current when updating local Equipment state',
          ],
          procedure: [
            'Use app-provided source data outside Agent CLI when needed. Agent CLI only owns current/library/fill/proposal state.',
            'Build one EquipmentFillAiDraft JSON object. gearSets may contain only the complete gear sets being changed; omitted gear sets are preserved.',
            'Call POST /api/equipment/fill/check.',
            'If check fails, fix JSON and check again.',
            'Call POST /api/equipment/fill/apply only after validation passes. This creates a proposal, NOT a direct save.',
            'Approval writes def.equipment-sheet.draft.v1; save writes def.equipment-sheet.library.v1.',
          ],
          outputContract: {
            formatName: 'EquipmentFillAiDraft',
            root: ['gearSets'],
            gearSet: ['gearSetId', 'name', 'equipments'],
            equipment: ['equipmentId', 'name', 'part', 'fixedStat?', 'effects'],
          },
          hardRules: [
            'part must be 护甲/护手/配件.',
            'effect slots must be effect1/effect2/effect3.',
            'level keys must be 0/1/2/3 and values must be numbers.',
            'Partial gearSets submissions are incrementally merged by gearSetId and do not delete omitted gear sets.',
            'equipment.fill.apply creates a proposal only.',
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

  if (request.method === 'GET' && request.path === '/api/weapon/current') {
    const draft = readCurrentWeaponDraft();
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: WEAPON_DRAFT_STORAGE_KEY,
      format: 'WeaponDraft',
      warning: 'Read format only. Use weapon.fill.check/apply for proposals.',
      draft,
      summary: {
        id: draft.id,
        name: draft.name,
        rarity: draft.rarity,
        type: draft.type,
        skills: Object.keys(draft.skills || {}).length,
      },
    });
  }

  if (request.method === 'GET' && request.path === '/api/weapon/library') {
    const library = readWeaponLibrary();
    const keyword = request.query?.q || request.query?.query || '';
    const summary = formatWeaponLibrarySummary(library).filter((entry) => {
      if (!keyword.trim()) return true;
      const normalizedKeyword = keyword.trim().toLowerCase();
      return [entry.id, entry.name, entry.type].filter(Boolean).join(' ').toLowerCase().includes(normalizedKeyword);
    });
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: WEAPON_LIBRARY_STORAGE_KEY,
      format: 'WeaponDraftMap',
      warning: 'Read format only. External agents must not write weapon storage directly.',
      count: summary.length,
      summary,
      library,
    });
  }

  if (request.method === 'GET' && request.path.startsWith('/api/weapon/library/')) {
    const decoded = decodePathSegment(request.path.slice('/api/weapon/library/'.length));
    if (!decoded.ok) return decoded.response;
    const ref = decoded.value;
    const entry = findWeaponLibraryEntry(ref, readWeaponLibrary());
    if (!entry) {
      return jsonResponse(404, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: { code: 'not-found', message: `Weapon library entry not found: ${ref}` },
      });
    }
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: WEAPON_LIBRARY_STORAGE_KEY,
      format: 'WeaponDraft',
      warning: 'Read format only. Use weapon.fill.check/apply for proposals.',
      id: entry.id,
      draft: entry.draft,
    });
  }

  if (request.method === 'GET' && request.path === '/api/operator/current') {
    const draft = readCurrentOperatorDraft();
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: OPERATOR_DRAFT_STORAGE_KEY,
      format: 'OperatorDraft',
      warning: 'Read format only. Use operator.fill.check/apply for proposals.',
      draft,
      summary: {
        id: draft.id,
        name: draft.name,
        rarity: draft.rarity,
        profession: draft.profession,
        skills: Object.keys(draft.skills || {}).length,
      },
    });
  }

  if (request.method === 'GET' && request.path === '/api/operator/library') {
    const library = readOperatorLibrary();
    const keyword = request.query?.q || request.query?.query || '';
    const summary = formatOperatorLibrarySummary(library).filter((entry) => {
      if (!keyword.trim()) return true;
      const normalizedKeyword = keyword.trim().toLowerCase();
      return [entry.id, entry.name, entry.profession, entry.element].filter(Boolean).join(' ').toLowerCase().includes(normalizedKeyword);
    });
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: OPERATOR_LIBRARY_STORAGE_KEY,
      format: 'OperatorDraftMap',
      warning: 'Read format only. External agents must not write operator storage directly.',
      count: summary.length,
      summary,
      library,
    });
  }

  if (request.method === 'GET' && request.path.startsWith('/api/operator/library/')) {
    const decoded = decodePathSegment(request.path.slice('/api/operator/library/'.length));
    if (!decoded.ok) return decoded.response;
    const ref = decoded.value;
    const library = readOperatorLibrary();
    const lower = ref.toLowerCase();
    const entry = Object.entries(library).find(([id, draft]) => id === ref || id.toLowerCase() === lower || draft.name === ref);
    if (!entry) {
      return jsonResponse(404, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: { code: 'not-found', message: `Operator library entry not found: ${ref}` },
      });
    }
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: OPERATOR_LIBRARY_STORAGE_KEY,
      format: 'OperatorDraft',
      warning: 'Read format only. Use operator.fill.check/apply for proposals.',
      id: entry[0],
      draft: entry[1],
    });
  }

  if (request.method === 'GET' && request.path === '/api/equipment/current') {
    const draft = readCurrentEquipmentLibrary();
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: EQUIPMENT_DRAFT_STORAGE_KEY,
      format: 'EquipmentLibrary',
      warning: 'Read format only. Use equipment.fill.check/apply for proposals.',
      draft,
      summary: formatEquipmentLibrarySummary(draft),
    });
  }

  if (request.method === 'GET' && request.path === '/api/equipment/library') {
    const library = readEquipmentLibrary();
    const keyword = request.query?.q || request.query?.query || '';
    const summary = formatEquipmentLibrarySummary(library).filter((entry) => {
      if (!keyword.trim()) return true;
      const normalizedKeyword = keyword.trim().toLowerCase();
      return [entry.id, entry.name].filter(Boolean).join(' ').toLowerCase().includes(normalizedKeyword);
    });
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: EQUIPMENT_LIBRARY_STORAGE_KEY,
      format: 'EquipmentLibrary',
      warning: 'Read format only. External agents must not write equipment storage directly.',
      count: summary.length,
      summary,
      library,
    });
  }

  if (request.method === 'GET' && request.path.startsWith('/api/equipment/library/')) {
    const decoded = decodePathSegment(request.path.slice('/api/equipment/library/'.length));
    if (!decoded.ok) return decoded.response;
    const ref = decoded.value;
    const library = readEquipmentLibrary();
    const lower = ref.toLowerCase();
    const entry = Object.values(library.gearSets || {}).find((gearSet) => gearSet.gearSetId === ref || gearSet.gearSetId.toLowerCase() === lower || gearSet.name === ref);
    if (!entry) {
      return jsonResponse(404, {
        ok: false,
        protocolVersion: AI_CLI_PROTOCOL_VERSION,
        error: { code: 'not-found', message: `Equipment gear set not found: ${ref}` },
      });
    }
    return jsonResponse(200, {
      ok: true,
      protocolVersion: AI_CLI_PROTOCOL_VERSION,
      storage: EQUIPMENT_LIBRARY_STORAGE_KEY,
      format: 'EquipmentGearSet',
      warning: 'Read format only. Use equipment.fill.check/apply for proposals.',
      gearSet: entry,
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

  if (request.method === 'GET' && (
    request.path === '/api/weapon/fill/template'
    || request.path === '/api/operator/fill/template'
    || request.path === '/api/equipment/fill/template'
  )) {
    const commandName = request.path.startsWith('/api/weapon/')
      ? 'weapon.fill.task'
      : request.path.startsWith('/api/operator/')
        ? 'operator.fill.task'
        : 'equipment.fill.task';
    const response = runAiCliCommand(createAiCliCommandRequest(commandName, client), currentDraft, context);
    return jsonResponse(response.ok ? 200 : 400, {
      ...response,
      template: response.data,
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
    const decoded = decodePathSegment(request.path.slice('/api/buff/library/'.length));
    if (!decoded.ok) return decoded.response;
    const buffId = decoded.value;
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
    const pendingBeforeApply = readPendingAgentProposals(context.sessionId).length;
    if ((cmd === 'fill.apply' || cmd.startsWith('fill.apply ')
      || cmd === 'weapon.fill.apply' || cmd.startsWith('weapon.fill.apply ')
      || cmd === 'operator.fill.apply' || cmd.startsWith('operator.fill.apply ')
      || cmd === 'equipment.fill.apply' || cmd.startsWith('equipment.fill.apply '))
      && pendingBeforeApply > 0) {
      return pendingApplyBlockedResponse(pendingBeforeApply);
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
    const pendingBeforeApply = readPendingAgentProposals(context.sessionId).length;
    if (commandName === 'fill.apply' && pendingBeforeApply > 0) {
      return pendingApplyBlockedResponse(pendingBeforeApply);
    }
    const response = runAiCliCommand(createAiCliCommandRequest(
      `${commandName} ${JSON.stringify(request.body.draft)}`,
      client,
    ), currentDraft, {
      ...context,
      sessionId: context.sessionId,
    });
    response.requestId = request.body.requestId;
    // Override nextAction and lines for REST apply to always guide users to Web CLI
    if (request.path.endsWith('/apply') && response.proposal) {
      const pendingCount = readPendingAgentProposals(context.sessionId).length;
      const approvalBlocked = pendingCount > 1;
      if (approvalBlocked && !response.lines.some((line) => line.includes('proposal.clear now'))) {
        response.lines.push(`[check] pending proposals=${pendingCount}; Y/Y will be blocked before user approval (待处理提案=${pendingCount}，用户审批前 Y/Y 会被阻塞)`);
        response.lines.push('[action] Call REST proposal.clear now, then resubmit only the current proposal. For multiple edits, submit and finish them one by one. (请外部 agent 立刻通过 REST 调用 proposal.clear 删除所有提案，再重新提交当前这一个；多个提案请逐个提交、逐个审批)');
      }
      response.proposal.nextAction = approvalBlocked
        ? 'call REST proposal.clear now, then resubmit only the current proposal; for multiple edits, submit and finish them one by one.'
        : 'open Web CLI /ai-cli; the pending proposal will be imported automatically. press Y to approve, then Y to save. do not re-run fill.apply.';
      if (!response.lines.some((l) => l.includes('handoff') || l.includes('Web CLI'))) {
        response.lines.push('[handoff] this proposal will auto-sync to Web CLI. Do not re-run fill.apply. (将自动同步到 Web CLI，无需重新 fill.apply)');
      }
    }
    return jsonResponse(response.ok ? 200 : 400, response);
  }

  if (request.method === 'POST' && (
    request.path === '/api/weapon/fill/check'
    || request.path === '/api/weapon/fill/apply'
    || request.path === '/api/operator/fill/check'
    || request.path === '/api/operator/fill/apply'
    || request.path === '/api/equipment/fill/check'
    || request.path === '/api/equipment/fill/apply'
  )) {
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
    const commandPrefix = request.path.startsWith('/api/weapon/')
      ? 'weapon.fill'
      : request.path.startsWith('/api/operator/')
        ? 'operator.fill'
        : 'equipment.fill';
    const commandName = request.path.endsWith('/apply') ? `${commandPrefix}.apply` : `${commandPrefix}.check`;
    const pendingBeforeApply = readPendingAgentProposals(context.sessionId).length;
    if (commandName.endsWith('.apply') && pendingBeforeApply > 0) {
      return pendingApplyBlockedResponse(pendingBeforeApply);
    }
    const response = runAiCliCommand(createAiCliCommandRequest(
      `${commandName} ${JSON.stringify(request.body.draft)}`,
      client,
    ), currentDraft, {
      ...context,
      sessionId: context.sessionId,
    });
    response.requestId = request.body.requestId;
    if (request.path.endsWith('/apply') && response.proposal) {
      response.proposal.nextAction = 'open Web CLI /ai-cli; the pending proposal will be imported automatically. press Y to approve, then Y to save. do not re-run fill.apply.';
      if (!response.lines.some((l) => l.includes('handoff') || l.includes('Web CLI'))) {
        response.lines.push('[handoff] this proposal will auto-sync to Web CLI. Do not re-run fill.apply. (将自动同步到 Web CLI，无需重新 fill.apply)');
      }
    }
    return jsonResponse(response.ok ? 200 : 400, response);
  }

  return jsonResponse(404, {
    ok: false,
    protocolVersion: AI_CLI_PROTOCOL_VERSION,
    error: {
      code: 'not-found',
      message: `${request.method} ${request.path} is not defined. See GET /api/ai-cli/spec for supported endpoints.`,
      details: {
        spec: 'GET /api/ai-cli/spec',
      },
    },
  });
}
