import { BUFF_MODIFIER_TYPE_IDS } from '../ai/buffFillCatalog';
import type { BuffDraft, BuffEffectDraft, BuffItemDraft } from '../types/buffFill';
import {
  AI_CLI_PROTOCOL_VERSION,
  type AiAgentClient,
  type AiAgentWorkflow,
  type AiCliCommandRequest,
  type AiCliCommandResponse,
  type AiCliExecutionContext,
} from './aiCliAgentTypes';
import {
  AI_AGENT_PROPOSALS_STORAGE_KEY,
  appendOperationLog,
  appendSessionMessage,
  assertPermission,
  createAgentProposal,
  clearPendingAgentProposals,
  ensureActiveSession,
  findPermissionProfile,
  overwriteSessionState,
  overwriteSessionSummary,
  readAgentSession,
  readAgentSessions,
  readOperationLogs,
  readPendingAgentProposals,
  readAgentProposals,
  approveAgentProposal,
  rejectAgentProposal,
  markAgentProposalSaved,
  markAgentProposalUnsaved,
  updateSessionContext,
} from './aiCliAgentInfrastructure';
import type { AiAgentProposal } from './aiCliAgentTypes';
import { resolveFillCommand, findFillDomainAdapter, findFillDomainAdapterByDomain, registerFillDomainAdapter } from './aiCliFillDomains';
import {
  readCurrentBuffDraft,
  readBuffLibrary,
  formatLibrarySummary,
  BUFF_DRAFT_STORAGE_KEY,
  BUFF_LIBRARY_STORAGE_KEY,
  BUFF_UNDO_STORAGE_KEY,
  ALL_BUFF_STORAGE_KEYS,
  persistDraft,
  writeUndoSnapshot,
} from './buffFillAdapter';
import { WEAPON_DRAFT_STORAGE_KEY, WEAPON_LIBRARY_STORAGE_KEY, readWeaponLibrary, weaponFillAdapter } from './weaponFillAdapter';
import { buffFillAdapter } from './buffFillAdapter';
import {
  operatorFillAdapter,
  OPERATOR_DRAFT_STORAGE_KEY,
  OPERATOR_LIBRARY_STORAGE_KEY,
  formatOperatorLibrarySummary,
  readCurrentOperatorDraft,
  readOperatorLibrary,
} from './operatorFillAdapter';
import {
  equipmentFillAdapter,
  EQUIPMENT_DRAFT_STORAGE_KEY,
  EQUIPMENT_LIBRARY_STORAGE_KEY,
  formatEquipmentLibrarySummary,
  readCurrentEquipmentLibrary,
  readEquipmentLibrary,
} from './equipmentFillAdapter';
import {
  findWeaponLibraryEntry,
  formatWeaponLibrarySummary,
  getCurrentWeaponDraft,
  openWeaponLibraryEntry,
  searchWeaponSurface,
} from './weaponDataSurface';

registerFillDomainAdapter(buffFillAdapter);
registerFillDomainAdapter(weaponFillAdapter);
registerFillDomainAdapter(operatorFillAdapter);
registerFillDomainAdapter(equipmentFillAdapter);

export const SELECTED_CHARACTERS_STORAGE_KEY = 'def.selected-characters.v1';
export const CHARACTER_INPUT_MAP_STORAGE_KEY = 'def.operator-config.character-input-map.v3';

interface CliOperatorInput {
  potential: '0潜' | '满潜';
  skillLevels: {
    A: 'L9' | 'M3';
    B: 'L9' | 'M3';
    E: 'L9' | 'M3';
    Q: 'L9' | 'M3';
  };
  weapon: {
    name: string;
    potentialMode: 'P0' | 'PMAX';
  };
  equipment: Record<string, unknown>;
  displayName?: string;
}

export interface AiCliCommandResult extends AiCliCommandResponse {
  nextDraft?: BuffDraft;
  workflow?: AiAgentWorkflow;
}

export function createFallbackDraft(): BuffDraft {
  return {
    id: 'custom-buff-001',
    name: '本地 Buff 草稿',
    sourceName: '',
    source: 'custom',
    description: '',
    items: {},
  };
}

function readSessionJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function readOperatorInputMap(): Record<string, CliOperatorInput> {
  const wrapper = readSessionJsonStorage<{ version?: string; data?: Record<string, CliOperatorInput> }>(
    CHARACTER_INPUT_MAP_STORAGE_KEY,
    {},
  );
  return wrapper.version === '3' && wrapper.data ? wrapper.data : {};
}

function writeOperatorInputMap(map: Record<string, CliOperatorInput>) {
  window.sessionStorage.setItem(CHARACTER_INPUT_MAP_STORAGE_KEY, JSON.stringify({
    version: '3',
    timestamp: Date.now(),
    data: map,
  }));
}

function readSelectedCharacterIds(): string[] {
  return readSessionJsonStorage<string[]>(SELECTED_CHARACTERS_STORAGE_KEY, []);
}

function writeSelectedCharacterIds(ids: string[]) {
  window.sessionStorage.setItem(SELECTED_CHARACTERS_STORAGE_KEY, JSON.stringify(ids));
}

export function splitAiCliCommand(input: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function parseOptions(tokens: string[]) {
  return tokens.reduce<Record<string, string>>((acc, token) => {
    const splitAt = token.indexOf('=');
    if (splitAt <= 0) {
      return acc;
    }
    acc[token.slice(0, splitAt)] = token.slice(splitAt + 1);
    return acc;
  }, {});
}

function pad(value: string, width: number) {
  return value.length >= width ? value : `${value}${' '.repeat(width - value.length)}`;
}

// Proposal status labels: English for main output, Chinese in compact annotations.
export const APPROVAL_LABELS: Record<string, string> = {
  Wait: 'Pending',
  Yes: 'Approved',
  No: 'Rejected',
};

export const SAVE_LABELS: Record<string, string> = {
  Wait: 'Pending',
  Yes: 'Saved',
  No: 'Unsaved',
};

const APPROVAL_LABELS_ZH: Record<string, string> = {
  Wait: '待审批',
  Yes: '已批准',
  No: '已拒绝',
};

const SAVE_LABELS_ZH: Record<string, string> = {
  Wait: '待保存',
  Yes: '已保存',
  No: '未保存',
};

export function labelApproval(status: string) {
  return APPROVAL_LABELS[status] ?? status;
}

export function labelSave(status: string) {
  return SAVE_LABELS[status] ?? status;
}

function labelApprovalZh(status: string) {
  return APPROVAL_LABELS_ZH[status] ?? status;
}

function labelSaveZh(status: string) {
  return SAVE_LABELS_ZH[status] ?? status;
}

/**
 * Resolve a proposal reference from input.
 * Accepts full proposal id or short alias like "#1".
 * Returns the proposal object or null if not found.
 */
export function resolveProposalReference(input: string, sessionId?: string): AiAgentProposal | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.startsWith('#')) {
    const index = parseInt(trimmed.slice(1), 10) - 1;
    if (!Number.isFinite(index) || index < 0) return null;
    const pending = readPendingAgentProposals(sessionId);
    if (index >= pending.length) return null;
    return pending[index] ?? null;
  }
  // Try full id
  const all = readAgentProposals();
  return all.find((p) => p.id === trimmed) ?? null;
}

/**
 * Get the alias for a proposal from the current pending list.
 * Returns "#1", "#2", etc. or null if not in pending list.
 */
export function getProposalAlias(proposalId: string, sessionId?: string): string | null {
  const pending = readPendingAgentProposals(sessionId);
  const index = pending.findIndex((p) => p.id === proposalId);
  if (index < 0) return null;
  return `#${index + 1}`;
}

function table(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => String(row[index] ?? '').length),
  ));
  const formatRow = (row: string[]) => row.map((cell, index) => pad(String(cell ?? ''), widths[index])).join('  ');
  return [
    formatRow(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(formatRow),
  ];
}

function formatDateTime(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export function ok(message: string) {
  return `[ok] ${message}`;
}

export function fail(message: string) {
  return `[err] ${message}`;
}

export function info(message: string) {
  return `[info] ${message}`;
}

export function summarizeAiCliCommand(command: string) {
  const lowerCommand = command.toLowerCase();
  if (lowerCommand.startsWith('fill.apply ')) {
    const payloadLength = command.length - 'fill.apply '.length;
    return `fill.apply <json:${payloadLength} chars>`;
  }
  if (lowerCommand.startsWith('fill.check ')) {
    const payloadLength = command.length - 'fill.check '.length;
    return `fill.check <json:${payloadLength} chars>`;
  }
  for (const prefix of ['weapon.fill', 'operator.fill', 'equipment.fill']) {
    for (const action of ['check', 'apply']) {
      const commandPrefix = `${prefix}.${action} `;
      if (lowerCommand.startsWith(commandPrefix)) {
        const payloadLength = command.length - commandPrefix.length;
        return `${prefix}.${action} <json:${payloadLength} chars>`;
      }
    }
  }
  const tokens = splitAiCliCommand(command);
  const name = tokens[0] || '';
  if (['operator.add', 'item.add', 'item.set', 'effect.add', 'effect.set'].includes(name) && command.length > 72) {
    const headSize = name.startsWith('effect.') ? 3 : name === 'operator.add' ? 3 : 2;
    return `${tokens.slice(0, headSize).join(' ')} <args:${command.length} chars>`;
  }
  return command.length > 120 ? `${command.slice(0, 117)}...` : command;
}

export function formatDraftSummary(draft: BuffDraft) {
  const itemCount = Object.keys(draft.items || {}).length;
  const effectCount = Object.values(draft.items || {}).reduce((sum, item) => sum + Object.keys(item.effects || {}).length, 0);
  return [
    `id=${draft.id}`,
    `name=${draft.name}`,
    `sourceName=${draft.sourceName || '-'}`,
    `items=${itemCount}`,
    `effects=${effectCount}`,
  ];
}



function searchLibrary(library: Record<string, BuffDraft>, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return formatLibrarySummary(library);
  }
  return formatLibrarySummary(library).filter((entry) => {
    const draft = library[entry.id];
    const haystack = [
      entry.id,
      entry.name,
      entry.sourceName,
      draft?.description,
      ...Object.values(draft?.items || {}).flatMap((item) => [
        item.id,
        item.name,
        item.sourceName,
        item.description,
        ...Object.values(item.effects || {}).flatMap((effect) => [
          effect.id,
          effect.displayName,
          effect.name,
          effect.sourceName,
          effect.description,
          effect.condition,
          effect.type,
        ]),
      ]),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalizedKeyword);
  });
}

function createItem(itemKey: string, name: string, options: Record<string, string>): BuffItemDraft {
  return {
    id: itemKey,
    name,
    sourceName: options.sourceName || options.source || '',
    description: options.desc || options.description || '',
    effects: {},
  };
}

function createEffect(effectKey: string, options: Record<string, string>): BuffEffectDraft {
  const type = options.type || 'atkPercentBoost';
  const value = Number(options.value ?? 0);
  if (!BUFF_MODIFIER_TYPE_IDS.includes(type as never)) {
    throw new Error(`unknown modifier type: ${type}`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`value must be number: ${options.value}`);
  }
  const name = options.name || options.display || effectKey;
  return {
    id: effectKey,
    displayName: options.display || name,
    name,
    level: options.level || '',
    source: options.source || '',
    sourceName: options.sourceName || options.source || '',
    description: options.desc || options.description || '',
    condition: options.condition || '',
    effectKind: 'modifier',
    type,
    value,
  };
}

function createOperatorInput(options: Record<string, string>): CliOperatorInput {
  const skillLevel = options.skillLevel === 'L9' ? 'L9' : 'M3';
  for (const key of ['sourceSkillBoost', 'critRate', 'atkPercent', 'critDmg']) {
    const value = Number(options[key] ?? 0);
    if (!Number.isFinite(value)) {
      throw new Error(`${key} must be number: ${options[key]}`);
    }
  }
  return {
    potential: options.potential === '0潜' ? '0潜' : '满潜',
    skillLevels: {
      A: skillLevel,
      B: skillLevel,
      E: skillLevel,
      Q: skillLevel,
    },
    weapon: {
      name: options.weapon || '测试武器',
      potentialMode: options.weaponPotential === 'P0' ? 'P0' : 'PMAX',
    },
    equipment: {
      accessory1: { sourceSkillBoost: Number(options.sourceSkillBoost ?? 0) },
      accessory2: { critRate: Number(options.critRate ?? 0) },
      armor: { atkPercent: Number(options.atkPercent ?? 0) },
      glove: { critDmg: Number(options.critDmg ?? 0) },
    },
    displayName: options.name,
  };
}



function makeResponse(partial: Omit<AiCliCommandResult, 'ok' | 'protocolVersion' | 'effects'> & {
  ok?: boolean;
  effects?: AiCliCommandResponse['effects'];
}): AiCliCommandResult {
  return {
    ok: partial.ok ?? !partial.lines.some((line) => line.startsWith('[err]')),
    protocolVersion: AI_CLI_PROTOCOL_VERSION,
    lines: partial.lines,
    effects: partial.effects ?? { writes: false, storage: [] },
    requestId: partial.requestId,
    data: partial.data,
    error: partial.error,
    copyText: partial.copyText,
    nextDraft: partial.nextDraft,
    proposal: partial.proposal,
    workflow: partial.workflow,
  };
}

function writeResponse(partial: Omit<AiCliCommandResult, 'ok' | 'protocolVersion' | 'effects'> & {
  lines: string[];
  nextDraft?: BuffDraft;
  storage: string[];
}) {
  return makeResponse({
    ...partial,
    effects: {
      writes: true,
      storage: partial.storage,
    },
  });
}

function executeCommand(
  rawCommand: string,
  draft: BuffDraft,
  sourceText: string,
  client: AiAgentClient,
  sessionId: string,
): AiCliCommandResult {
  const tokens = splitAiCliCommand(rawCommand);
  const command = tokens[0]?.toLowerCase() || '';
  const args = tokens.slice(1);

  if (command === 'help' || command === '/help') {
    return makeResponse({
      lines: [
        'DEF AI CLI command surface',
        '',
        ...table(
          ['scope', 'command', 'purpose'],
          [
            ['system', 'help | clear | spec | /purpose', 'show help/spec/purpose'],
            ['route', 'route home|buff', 'navigate app route'],
            ['operator', 'operator.add <id> <name> [weapon=] [potential=] [skillLevel=]', 'create/select test operator'],
            ['operator', 'operator.show [id]', 'read operator config'],
            ['operator', 'operator.delete <id>', 'delete test operator config'],
            ['buff', 'buff.list [limit]', 'list Buff library entries'],
            ['buff', 'buff.show <id>', 'read one Buff library entry'],
            ['buff', 'buff.search <keyword>', 'search Buff library'],
            ['buff', 'buff.open <id>', 'set active draft from library'],
            ['weapon', 'weapon.list [limit]', 'list Weapon library entries'],
            ['weapon', 'weapon.show <id|name>', 'read one local Weapon library entry'],
            ['weapon', 'weapon.search <keyword>', 'search local Weapon library'],
            ['weapon', 'weapon.draft.show', 'read current Weapon working draft'],
            ['weapon', 'weapon.open <id|name>', 'set active Weapon draft from library'],
            ['operator', 'operator.current', 'read current Operator working draft'],
            ['operator', 'operator.library [limit]', 'list local Operator library entries'],
            ['operator', 'operator.library.show <id|name>', 'read one local Operator library entry'],
            ['operator', 'operator.fill.task', 'return operator task package'],
            ['operator', 'operator.fill.check <json>', 'validate OperatorFillAiDraft; prefer REST for Chinese JSON'],
            ['operator', 'operator.fill.apply <json>', 'create operator fill proposal; prefer REST for Chinese JSON'],
            ['equipment', 'equipment.current', 'read current Equipment working draft'],
            ['equipment', 'equipment.library [limit]', 'list local Equipment library entries'],
            ['equipment', 'equipment.library.show <id|name>', 'read one local Equipment gear set'],
            ['equipment', 'equipment.fill.task', 'return equipment task package'],
            ['equipment', 'equipment.fill.check <json>', 'validate EquipmentFillAiDraft'],
            ['equipment', 'equipment.fill.apply <json>', 'create equipment fill proposal'],
            ['draft', 'draft.show', 'read active draft only'],
            ['draft', 'draft.rename <name>', 'rename active draft and sync library'],
            ['item', 'item.list | item.add | item.set | item.delete', 'CRUD buff items'],
            ['effect', 'effect.list | effect.add | effect.set | effect.delete', 'CRUD modifier effects'],
            ['fill', 'fill.source <text>', 'set source text for task package'],
            ['fill', 'fill.task', 'return structured task package'],
            ['fill', 'fill.task.copy', 'copy task package to clipboard'],
            ['fill', 'fill.check <json>', 'validate BuffFillAiDraft without writing'],
            ['fill', 'fill.apply <json>', 'create proposal from AI fill result'],
            ['weapon', 'weapon.fill.task', 'return weapon task package'],
            ['weapon', 'weapon.fill.check <json>', 'validate WeaponFillAiDraft'],
            ['weapon', 'weapon.fill.apply <json>', 'create weapon fill proposal'],
            ['proposal', 'proposal.list', 'list pending proposals'],
            ['proposal', 'proposal.show <id|#N>', 'show proposal details'],
            ['proposal', 'proposal.approve <id|#N>', 'approve and apply to working state'],
            ['proposal', 'proposal.reject <id|#N>', 'reject proposal'],
            ['proposal', 'proposal.save <id|#N>', 'save approved proposal to local truth'],
            ['proposal', 'proposal.unsave <id|#N>', 'mark saved proposal as unsaved'],
            ['proposal', 'proposal.clear', 'reject/unsave all pending proposals in current session'],
            ['shortcut', 'Y', 'approve pending or save approved'],
            ['shortcut', 'N', 'reject pending or unsave approved'],
            ['handoff', 'REST -> Web CLI', 'external proposals auto-import via SSE'],
            ['agent', 'agent.logs [limit]', 'show recent agent operation logs'],
            ['agent', 'agent.sessions [limit]', 'show current single agent session'],
            ['agent', 'agent.guide', 'show first-call guide for LLM agents'],
          ],
        ),
        `main truth: localStorage.${BUFF_LIBRARY_STORAGE_KEY}`,
        `active editor state: localStorage.${BUFF_DRAFT_STORAGE_KEY}`,
        'quote values with spaces: item.add item-1 "测试天赋" desc="长描述"',
      ],
    });
  }

  if (command === '/purpose' || command === 'purpose') {
    return makeResponse({
      lines: [
        'Provide a terminal-style, app-controlled bridge for Codex/Claude to inspect the Buff library and propose edits. (软件本体控制的终端桥接界面)',
        'Agents produce commands or BuffFillAiDraft JSON; the app validates and writes. (智能体只提交命令或 JSON，校验和写入由软件完成)',
      ],
    });
  }

  if (command === 'spec' || command === '/spec') {
    return makeResponse({
      lines: [
        'contract:',
        `  main truth is localStorage.${BUFF_LIBRARY_STORAGE_KEY}.`,
        `  ${BUFF_DRAFT_STORAGE_KEY} is only the active editor draft.`,
        '  external agents may propose BuffFillAiDraft JSON only.',
        '  app validates modifier type, numeric value, required fields, and extraHit config.',
        '  fill.check never writes; fill.apply creates a proposal (does not write library).',
        '  use proposal.approve to apply to working state; proposal.save to write to local truth.',
        '  buff.open only switches active editor draft from an existing library entry.',
        '  REST apply creates proposal only; Web CLI imports pending proposals via SSE for user Y/Y approval.',
        '  do not ask users to re-run fill.apply in browser after REST apply.',
        '  if multiple pending proposals block Y/N, call proposal.clear through REST or handle proposals explicitly.',
        '  for operator Chinese JSON payloads, prefer POST /api/operator/fill/check|apply over CLI args to avoid shell encoding loss.',
        '',
        'storage touched:',
        `  localStorage.${BUFF_DRAFT_STORAGE_KEY}`,
        `  localStorage.${BUFF_LIBRARY_STORAGE_KEY}`,
        `  localStorage.${BUFF_UNDO_STORAGE_KEY}`,
        `  localStorage.${WEAPON_DRAFT_STORAGE_KEY}`,
        `  localStorage.${WEAPON_LIBRARY_STORAGE_KEY}`,
        `  localStorage.${OPERATOR_DRAFT_STORAGE_KEY}`,
        `  localStorage.${OPERATOR_LIBRARY_STORAGE_KEY}`,
        `  localStorage.${EQUIPMENT_DRAFT_STORAGE_KEY}`,
        `  localStorage.${EQUIPMENT_LIBRARY_STORAGE_KEY}`,
        `  sessionStorage.${CHARACTER_INPUT_MAP_STORAGE_KEY}`,
        `  sessionStorage.${SELECTED_CHARACTERS_STORAGE_KEY}`,
      ],
    });
  }

  if (command === 'route') {
    if (args[0] === 'home' || args[0] === 'buff') {
      return makeResponse({
        lines: [info(`navigating ${args[0]}`)],
        data: { navigateTo: args[0] },
      });
    }
    return makeResponse({ ok: false, lines: [fail('usage: route home|buff')] });
  }

  if (command === 'agent.logs') {
    const limit = Math.max(1, Math.min(50, Number(args[0] || 10) || 10));
    const allLogs = readOperationLogs().slice(0, limit);
    if (!allLogs.length) {
      return makeResponse({ lines: [info('no agent logs (暂无操作日志)')] });
    }
    const rows = allLogs.map((log) => [
      formatDateTime(log.createdAt),
      log.client,
      log.ok ? 'ok' : 'err',
      log.writes ? 'write' : 'read',
      log.approval ? `${labelApproval(log.approval)} (${labelApprovalZh(log.approval)})` : '-',
      log.save ? `${labelSave(log.save)} (${labelSaveZh(log.save)})` : '-',
      log.command,
      log.errorCode || '-',
    ]);
    return makeResponse({
      lines: table(['time', 'client', 'ok', 'effect', 'approval', 'save', 'command', 'error'], rows),
    });
  }

  if (command === 'agent.guide') {
    return makeResponse({
      lines: [
        'LLM agent guide:',
        '  first call: GET /api/agent/guide',
        '  skills: GET /api/agent/skills',
        '  inspect truth: GET /api/buff/library or command buff.list',
        '  inspect one: GET /api/buff/library/<id> or command buff.show <id>',
        '  active editor only: GET /api/buff/current or command draft.show',
        '  dry-run: POST /api/buff/fill/check',
        '  write: POST /api/buff/fill/apply only after validation and user intent',
        '  operator write path: POST /api/operator/fill/check then POST /api/operator/fill/apply; avoid CLI JSON args for Chinese payloads.',
        '  events: GET /api/agent/events',
        '',
        'rule: agent proposes commands/JSON; app validates, logs, and writes.',
        '',
        'handoff rule:',
        '  REST fill.apply creates a proposal only. It does NOT save to library.',
        '  After REST apply, the proposal is automatically handed off to Web CLI via SSE.',
        '  Do NOT ask the user to re-run fill.apply in the browser.',
        '  Single pending: user opens /ai-cli and presses Y to approve, then Y to save.',
        '  Before asking the user to approve, self-check pending proposal count from apply response or proposal.list.',
        '  If multiple pending proposals block Y/Y, call REST proposal.clear immediately, then resubmit only the current proposal.',
        '  If multiple edits are intended, submit and finish them one by one.',
        '  REST approval/save commands return 403. This is expected; approval must happen in Web CLI.',
      ],
    });
  }

  if (command === 'buff.list') {
    const limit = Math.max(1, Math.min(200, Number(args[0] || 50) || 50));
    const rows = formatLibrarySummary(readBuffLibrary()).slice(0, limit);
    return makeResponse({
      lines: rows.length
        ? table(
            ['id', 'name', 'sourceName', 'items', 'effects'],
            rows.map((entry) => [entry.id, entry.name, entry.sourceName, String(entry.items), String(entry.effects)]),
          )
        : [info('buff library is empty')],
      data: { library: rows },
    });
  }

  if (command === 'buff.search') {
    const keyword = args.join(' ').trim();
    if (!keyword) {
      return makeResponse({ ok: false, lines: [fail('usage: buff.search <keyword>')] });
    }
    const rows = searchLibrary(readBuffLibrary(), keyword).slice(0, 50);
    return makeResponse({
      lines: rows.length
        ? table(
            ['id', 'name', 'sourceName', 'items', 'effects'],
            rows.map((entry) => [entry.id, entry.name, entry.sourceName, String(entry.items), String(entry.effects)]),
          )
        : [info(`no library match: ${keyword} (主库未找到)`)],
      data: { library: rows },
    });
  }

  if (command === 'buff.show') {
    const [buffId] = args;
    const library = readBuffLibrary();
    const entry = buffId ? library[buffId] : null;
    if (!buffId || !entry) {
      return makeResponse({ ok: false, lines: [fail('usage: buff.show <existingBuffId>')] });
    }
    return makeResponse({
      lines: formatDraftSummary(entry),
      data: { draft: entry },
    });
  }

  if (command === 'buff.open') {
    const [buffId] = args;
    const library = readBuffLibrary();
    const entry = buffId ? library[buffId] : null;
    if (!buffId || !entry) {
      return makeResponse({ ok: false, lines: [fail('usage: buff.open <existingBuffId>')] });
    }
    writeUndoSnapshot(`AI CLI buff.open · ${buffId}`, readCurrentBuffDraft());
    window.localStorage.setItem(BUFF_DRAFT_STORAGE_KEY, JSON.stringify(entry));
    return writeResponse({
      nextDraft: entry,
      lines: [ok(`buff opened as active draft: ${buffId}`)],
      storage: [BUFF_DRAFT_STORAGE_KEY, BUFF_UNDO_STORAGE_KEY],
    });
  }

  if (command === 'weapon.list') {
    const limit = Math.max(1, Math.min(200, Number(args[0] || 50) || 50));
    const rows = formatWeaponLibrarySummary().slice(0, limit);
    return makeResponse({
      lines: rows.length
        ? table(
            ['id', 'name', 'rarity', 'type', 'skills', 'effects'],
            rows.map((entry) => [entry.id, entry.name, String(entry.rarity), entry.type || '-', String(entry.skills), String(entry.effects)]),
          )
        : [info('no weapon library entries (本地武器库为空)')],
      data: { library: rows },
      workflow: 'weapon.fill',
    });
  }

  if (command === 'weapon.search') {
    const keyword = args.join(' ').trim();
    if (!keyword) {
      return makeResponse({ ok: false, lines: [fail('usage: weapon.search <keyword>')] });
    }
    const rows = searchWeaponSurface(keyword).slice(0, 50);
    return makeResponse({
      lines: rows.length
        ? table(
            ['id', 'name', 'rarity', 'type'],
            rows.map((entry) => [
              entry.id || '-',
              entry.name,
              String(entry.rarity),
              entry.type || '-',
            ]),
          )
        : [info(`no weapon match: ${keyword} (未匹配到武器)`)],
      data: { results: rows },
      workflow: 'weapon.fill',
    });
  }

  if (command === 'weapon.show') {
    const ref = args.join(' ').trim();
    const entry = ref ? findWeaponLibraryEntry(ref, readWeaponLibrary()) : null;
    if (!ref || !entry) {
      return makeResponse({
        ok: false,
        lines: [
          fail('usage: weapon.show <existingWeaponId|name>'),
          '[hint] For current local state, use weapon.list or weapon.search (本地状态请用 weapon.list 或 weapon.search)',
        ],
      });
    }
    const effectCount = Object.values(entry.draft.skills || {}).reduce((sum, skill) => sum + Object.keys(skill.effects || {}).length, 0);
    return makeResponse({
      lines: [
        `id=${entry.id}`,
        `name=${entry.draft.name}`,
        `rarity=${entry.draft.rarity}`,
        `type=${entry.draft.type || '-'}`,
        `skills=${Object.keys(entry.draft.skills || {}).length}`,
        `effects=${effectCount}`,
      ],
      data: { id: entry.id, draft: entry.draft },
      workflow: 'weapon.fill',
    });
  }

  if (command === 'weapon.draft.show') {
    const weaponDraft = getCurrentWeaponDraft();
    const effectCount = Object.values(weaponDraft.skills || {}).reduce((sum, skill) => sum + Object.keys(skill.effects || {}).length, 0);
    return makeResponse({
      lines: [
        `id=${weaponDraft.id}`,
        `name=${weaponDraft.name}`,
        `rarity=${weaponDraft.rarity}`,
        `type=${weaponDraft.type || '-'}`,
        `skills=${Object.keys(weaponDraft.skills || {}).length}`,
        `effects=${effectCount}`,
      ],
      data: { draft: weaponDraft },
      workflow: 'weapon.fill',
    });
  }

  if (command === 'weapon.open') {
    const ref = args.join(' ').trim();
    if (!ref) {
      return makeResponse({ ok: false, lines: [fail('usage: weapon.open <existingWeaponId|name>')] });
    }
    const result = openWeaponLibraryEntry(ref);
    if (!result.ok) {
      return makeResponse({ ok: false, lines: [fail(result.error)] });
    }
    return makeResponse({
      lines: [ok(`weapon opened as active draft: ${result.id} ${result.draft.name}`)],
      data: { id: result.id, draft: result.draft },
      effects: { writes: true, storage: [WEAPON_DRAFT_STORAGE_KEY] },
      workflow: 'weapon.fill',
    });
  }

  if (command === 'operator.current') {
    const operatorDraft = readCurrentOperatorDraft();
    return makeResponse({
      lines: [
        `id=${operatorDraft.id}`,
        `name=${operatorDraft.name}`,
        `rarity=${operatorDraft.rarity}`,
        `profession=${operatorDraft.profession || '-'}`,
        `element=${operatorDraft.element || '-'}`,
        `skills=${Object.keys(operatorDraft.skills || {}).length}`,
      ],
      data: { draft: operatorDraft },
      workflow: 'operator.fill',
    });
  }

  if (command === 'operator.library') {
    const limit = Math.max(1, Math.min(200, Number(args[0] || 50) || 50));
    const library = readOperatorLibrary();
    const rows = formatOperatorLibrarySummary(library).slice(0, limit);
    return makeResponse({
      lines: rows.length
        ? table(
            ['id', 'name', 'rarity', 'profession', 'element', 'skills'],
            rows.map((entry) => [entry.id, entry.name, String(entry.rarity), entry.profession || '-', entry.element || '-', String(entry.skills)]),
          )
        : [info('no operator library entries (本地干员库为空)')],
      data: { library: rows },
      workflow: 'operator.fill',
    });
  }

  if (command === 'operator.library.show') {
    const ref = args.join(' ').trim();
    const library = readOperatorLibrary();
    const lower = ref.toLowerCase();
    const entry = ref
      ? Object.entries(library).find(([id, operator]) => id === ref || id.toLowerCase() === lower || operator.name === ref)
      : null;
    if (!ref || !entry) {
      return makeResponse({
        ok: false,
        lines: [
          fail('usage: operator.library.show <existingOperatorId|name>'),
          '[hint] For current local state, use operator.current or operator.library (本地状态请用 operator.current 或 operator.library)',
        ],
      });
    }
    return makeResponse({
      lines: [
        `id=${entry[0]}`,
        `name=${entry[1].name}`,
        `rarity=${entry[1].rarity}`,
        `profession=${entry[1].profession || '-'}`,
        `element=${entry[1].element || '-'}`,
        `skills=${Object.keys(entry[1].skills || {}).length}`,
      ],
      data: { id: entry[0], draft: entry[1] },
      workflow: 'operator.fill',
    });
  }

  if (command === 'equipment.current') {
    const equipmentDraft = readCurrentEquipmentLibrary();
    return makeResponse({
      lines: [
        `gearSets=${Object.keys(equipmentDraft.gearSets || {}).length}`,
        `updatedAt=${equipmentDraft.updatedAt || '-'}`,
      ],
      data: { draft: equipmentDraft },
      workflow: 'equipment.fill',
    });
  }

  if (command === 'equipment.library') {
    const limit = Math.max(1, Math.min(200, Number(args[0] || 50) || 50));
    const library = readEquipmentLibrary();
    const rows = formatEquipmentLibrarySummary(library).slice(0, limit);
    return makeResponse({
      lines: rows.length
        ? table(
            ['id', 'name', 'equipments', 'effects'],
            rows.map((entry) => [entry.id, entry.name, String(entry.equipments), String(entry.effects)]),
          )
        : [info('no equipment library entries (本地装备库为空)')],
      data: { library: rows },
      workflow: 'equipment.fill',
    });
  }

  if (command === 'equipment.library.show') {
    const ref = args.join(' ').trim();
    const library = readEquipmentLibrary();
    const lower = ref.toLowerCase();
    const entry = ref
      ? Object.values(library.gearSets || {}).find((gearSet) => gearSet.gearSetId === ref || gearSet.gearSetId.toLowerCase() === lower || gearSet.name === ref)
      : null;
    if (!ref || !entry) {
      return makeResponse({
        ok: false,
        lines: [
          fail('usage: equipment.library.show <existingGearSetId|name>'),
          '[hint] For current local state, use equipment.current or equipment.library (本地状态请用 equipment.current 或 equipment.library)',
        ],
      });
    }
    return makeResponse({
      lines: [
        `id=${entry.gearSetId}`,
        `name=${entry.name}`,
        `equipments=${Object.keys(entry.equipments || {}).length}`,
      ],
      data: { gearSet: entry },
      workflow: 'equipment.fill',
    });
  }

  if (command === 'agent.sessions') {
    const limit = Math.max(1, Math.min(50, Number(args[0] || 10) || 10));
    const allSessions = readAgentSessions().slice(0, limit);
    if (!allSessions.length) {
      return makeResponse({ lines: [info('no agent sessions (暂无会话记录)')] });
    }
    const rows = allSessions.map((session) => {
      const state = session.state as { approval?: string; save?: string } | undefined;
      return [
        formatDateTime(session.updatedAt),
        session.client,
        session.status,
        state?.approval ? `${labelApproval(state.approval)} (${labelApprovalZh(state.approval)})` : '-',
        state?.save ? `${labelSave(state.save)} (${labelSaveZh(state.save)})` : '-',
        session.summary || '-',
        String(session.messages.length),
        session.context.lastCommand || '-',
        session.id,
      ];
    });
    return makeResponse({
      lines: table(['updated', 'client', 'status', 'approval', 'save', 'summary', 'msgs', 'last cmd', 'sessionId'], rows),
    });
  }

  if (command === 'operator.add') {
    const [operatorId, operatorName, ...optionTokens] = args;
    if (!operatorId || !operatorName) {
      return makeResponse({ ok: false, lines: [fail('usage: operator.add <operatorId> <name> [weapon=] [potential=满潜|0潜] [skillLevel=M3|L9]')] });
    }
    const options = parseOptions(optionTokens);
    const inputMap = readOperatorInputMap();
    inputMap[operatorId] = createOperatorInput({ ...options, name: operatorName });
    writeOperatorInputMap(inputMap);
    writeSelectedCharacterIds(Array.from(new Set([...readSelectedCharacterIds(), operatorId])).slice(0, 4));
    return writeResponse({
      lines: [ok(`operator added: ${operatorId} ${operatorName}`)],
      storage: [CHARACTER_INPUT_MAP_STORAGE_KEY, SELECTED_CHARACTERS_STORAGE_KEY],
    });
  }

  if (command === 'operator.show') {
    const [operatorId] = args;
    const inputMap = readOperatorInputMap();
    const selectedIds = readSelectedCharacterIds();
    if (operatorId) {
      const operator = inputMap[operatorId];
      return makeResponse({
        ok: !!operator,
        lines: operator
          ? [
              ...table(
                ['field', 'value'],
                [
                  ['operator', operatorId],
                  ['name', operator.displayName || operatorId],
                  ['potential', operator.potential],
                  ['weapon', operator.weapon.name],
                  ['skillLevels', Object.values(operator.skillLevels).join('/')],
                  ['selected', String(selectedIds.includes(operatorId))],
                ],
              ),
            ]
          : [fail(`operator not found: ${operatorId}`)],
      });
    }
    return makeResponse({
      lines: Object.keys(inputMap).length
        ? table(
            ['operatorId', 'name', 'weapon', 'selected'],
            Object.entries(inputMap).map(([id, operator]) => [
              id,
              operator.displayName || id,
              operator.weapon.name,
              String(selectedIds.includes(id)),
            ]),
          )
        : [info('no operators')],
    });
  }

  if (command === 'operator.delete') {
    const [operatorId] = args;
    if (!operatorId) {
      return makeResponse({ ok: false, lines: [fail('usage: operator.delete <operatorId>')] });
    }
    const inputMap = readOperatorInputMap();
    if (!inputMap[operatorId]) {
      return makeResponse({ ok: false, lines: [fail(`operator not found: ${operatorId}`)] });
    }
    delete inputMap[operatorId];
    writeOperatorInputMap(inputMap);
    writeSelectedCharacterIds(readSelectedCharacterIds().filter((id) => id !== operatorId));
    return writeResponse({
      lines: [ok(`operator deleted: ${operatorId}`)],
      storage: [CHARACTER_INPUT_MAP_STORAGE_KEY, SELECTED_CHARACTERS_STORAGE_KEY],
    });
  }

  if (command === 'draft.show') {
    return makeResponse({ lines: formatDraftSummary(draft), data: { draft } });
  }

  if (command === 'draft.rename') {
    const name = args.join(' ').trim();
    if (!name) {
      return makeResponse({ ok: false, lines: [fail('usage: draft.rename <name>')] });
    }
    const nextDraft = { ...draft, name };
    persistDraft(nextDraft, `AI CLI draft.rename · ${draft.id}`);
    return writeResponse({
      nextDraft,
      lines: [ok(`draft renamed: ${name}`)],
      storage: ALL_BUFF_STORAGE_KEYS,
    });
  }

  if (command === 'item.list') {
    const itemEntries = Object.entries(draft.items || {});
    return makeResponse({
      lines: itemEntries.length
        ? table(
            ['itemKey', 'name', 'sourceName', 'effects'],
            itemEntries.map(([itemKey, item]) => [
              itemKey,
              item.name,
              item.sourceName || '-',
              String(Object.keys(item.effects || {}).length),
            ]),
          )
        : [info('no items')],
    });
  }

  if (command === 'item.add') {
    const [itemKey, itemName, ...optionTokens] = args;
    if (!itemKey || !itemName) {
      return makeResponse({ ok: false, lines: [fail('usage: item.add <itemKey> <name> [sourceName=] [desc=]')] });
    }
    if (draft.items[itemKey]) {
      return makeResponse({ ok: false, lines: [fail(`item exists: ${itemKey}`)] });
    }
    const nextDraft = {
      ...draft,
      items: {
        ...draft.items,
        [itemKey]: createItem(itemKey, itemName, parseOptions(optionTokens)),
      },
    };
    persistDraft(nextDraft, `AI CLI item.add · ${itemKey}`);
    return writeResponse({
      nextDraft,
      lines: [ok(`item added: ${itemKey}`)],
      storage: ALL_BUFF_STORAGE_KEYS,
    });
  }

  if (command === 'item.set') {
    const [itemKey, ...optionTokens] = args;
    if (!itemKey || !draft.items[itemKey]) {
      return makeResponse({ ok: false, lines: [fail('usage: item.set <existingItemKey> [name=] [sourceName=] [desc=]')] });
    }
    const options = parseOptions(optionTokens);
    const currentItem = draft.items[itemKey];
    const nextItem = {
      ...currentItem,
      name: options.name ?? currentItem.name,
      sourceName: options.sourceName ?? currentItem.sourceName,
      description: options.desc ?? options.description ?? currentItem.description,
    };
    const nextDraft = {
      ...draft,
      items: {
        ...draft.items,
        [itemKey]: nextItem,
      },
    };
    persistDraft(nextDraft, `AI CLI item.set · ${itemKey}`);
    return writeResponse({
      nextDraft,
      lines: [ok(`item updated: ${itemKey}`)],
      storage: ALL_BUFF_STORAGE_KEYS,
    });
  }

  if (command === 'item.delete') {
    const [itemKey] = args;
    if (!itemKey || !draft.items[itemKey]) {
      return makeResponse({ ok: false, lines: [fail('usage: item.delete <existingItemKey>')] });
    }
    const nextItems = { ...draft.items };
    delete nextItems[itemKey];
    const nextDraft = { ...draft, items: nextItems };
    persistDraft(nextDraft, `AI CLI item.delete · ${itemKey}`);
    return writeResponse({
      nextDraft,
      lines: [ok(`item deleted: ${itemKey}`)],
      storage: ALL_BUFF_STORAGE_KEYS,
    });
  }

  if (command === 'effect.list') {
    const [itemKey] = args;
    const item = itemKey ? draft.items[itemKey] : null;
    if (!item) {
      return makeResponse({ ok: false, lines: [fail('usage: effect.list <existingItemKey>')] });
    }
    const effectEntries = Object.entries(item.effects || {});
    return makeResponse({
      lines: effectEntries.length
        ? table(
            ['effectKey', 'displayName', 'type', 'value', 'condition'],
            effectEntries.map(([effectKey, effect]) => [
              effectKey,
              effect.displayName,
              effect.type || '-',
              String(effect.value ?? 0),
              effect.condition || '-',
            ]),
          )
        : [info('no effects')],
    });
  }

  if (command === 'effect.add') {
    const [itemKey, effectKey, ...optionTokens] = args;
    const item = itemKey ? draft.items[itemKey] : null;
    if (!item || !effectKey) {
      return makeResponse({ ok: false, lines: [fail('usage: effect.add <existingItemKey> <effectKey> type=<modifierType> value=<number>')] });
    }
    if (item.effects[effectKey]) {
      return makeResponse({ ok: false, lines: [fail(`effect exists: ${itemKey}/${effectKey}`)] });
    }
    const nextEffect = createEffect(effectKey, parseOptions(optionTokens));
    const nextDraft = {
      ...draft,
      items: {
        ...draft.items,
        [itemKey]: {
          ...item,
          effects: {
            ...item.effects,
            [effectKey]: nextEffect,
          },
        },
      },
    };
    persistDraft(nextDraft, `AI CLI effect.add · ${itemKey}/${effectKey}`);
    return writeResponse({
      nextDraft,
      lines: [ok(`effect added: ${itemKey}/${effectKey}`)],
      storage: ALL_BUFF_STORAGE_KEYS,
    });
  }

  if (command === 'effect.set') {
    const [itemKey, effectKey, ...optionTokens] = args;
    const item = itemKey ? draft.items[itemKey] : null;
    const effect = item && effectKey ? item.effects[effectKey] : null;
    if (!item || !effect) {
      return makeResponse({ ok: false, lines: [fail('usage: effect.set <existingItemKey> <existingEffectKey> [type=] [value=]')] });
    }
    const options = parseOptions(optionTokens);
    const nextType = options.type ?? effect.type;
    if (nextType && !BUFF_MODIFIER_TYPE_IDS.includes(nextType as never)) {
      return makeResponse({ ok: false, lines: [fail(`unknown modifier type: ${nextType}`)] });
    }
    const nextValue = options.value === undefined ? effect.value : Number(options.value);
    if (options.value !== undefined && !Number.isFinite(nextValue)) {
      return makeResponse({ ok: false, lines: [fail(`value must be number: ${options.value}`)] });
    }
    const nextEffect = {
      ...effect,
      displayName: options.display ?? effect.displayName,
      name: options.name ?? effect.name,
      level: options.level ?? effect.level,
      source: options.source ?? effect.source,
      sourceName: options.sourceName ?? effect.sourceName,
      description: options.desc ?? options.description ?? effect.description,
      condition: options.condition ?? effect.condition,
      type: nextType,
      value: nextValue,
    };
    const nextDraft = {
      ...draft,
      items: {
        ...draft.items,
        [itemKey]: {
          ...item,
          effects: {
            ...item.effects,
            [effectKey]: nextEffect,
          },
        },
      },
    };
    persistDraft(nextDraft, `AI CLI effect.set · ${itemKey}/${effectKey}`);
    return writeResponse({
      nextDraft,
      lines: [ok(`effect updated: ${itemKey}/${effectKey}`)],
      storage: ALL_BUFF_STORAGE_KEYS,
    });
  }

  if (command === 'effect.delete') {
    const [itemKey, effectKey] = args;
    const item = itemKey ? draft.items[itemKey] : null;
    if (!item || !effectKey || !item.effects[effectKey]) {
      return makeResponse({ ok: false, lines: [fail('usage: effect.delete <existingItemKey> <existingEffectKey>')] });
    }
    const nextEffects = { ...item.effects };
    delete nextEffects[effectKey];
    const nextDraft = {
      ...draft,
      items: {
        ...draft.items,
        [itemKey]: {
          ...item,
          effects: nextEffects,
        },
      },
    };
    persistDraft(nextDraft, `AI CLI effect.delete · ${itemKey}/${effectKey}`);
    return writeResponse({
      nextDraft,
      lines: [ok(`effect deleted: ${itemKey}/${effectKey}`)],
      storage: ALL_BUFF_STORAGE_KEYS,
    });
  }

  const fillCommand = resolveFillCommand(rawCommand);
  if (fillCommand) {
    if ('error' in fillCommand) {
      return makeResponse({
        ok: false,
        lines: [fail(fillCommand.error)],
        error: { code: 'usage-error', message: fillCommand.error },
      });
    }
    const adapter = findFillDomainAdapter(fillCommand.prefix);
    if (!adapter) {
      return makeResponse({
        ok: false,
        lines: [fail(`unknown fill domain: ${fillCommand.prefix}`)],
        error: { code: 'unknown-domain', message: `unknown fill domain: ${fillCommand.prefix}` },
      });
    }

    if (fillCommand.action === 'task') {
      const pkg = adapter.buildTaskPackage();
      return makeResponse({
        lines: pkg.lines,
        data: pkg.data,
        workflow: adapter.workflow,
      });
    }

    if (fillCommand.action === 'check') {
      const validation = adapter.validateAiDraft(fillCommand.args);
      if (!validation.ok) {
        return makeResponse({
          ok: false,
          lines: [fail('fill result invalid'), ...validation.errors.map((error) => `  ${error}`)],
          error: { code: 'fill-invalid', message: 'fill result invalid', details: validation.errors },
        });
      }
      return makeResponse({
        lines: [ok(`fill result valid: ${adapter.domain}`)],
        effects: { writes: false, storage: [] },
      });
    }

    if (fillCommand.action === 'apply') {
      const validation = adapter.validateAiDraft(fillCommand.args);
      if (!validation.ok) {
        return makeResponse({
          ok: false,
          lines: [fail('fill result invalid'), ...validation.errors.map((error) => `  ${error}`)],
          error: { code: 'fill-invalid', message: 'fill result invalid', details: validation.errors },
        });
      }
      const proposalPayload = adapter.createProposalPayload(validation, rawCommand);
      const allProposals = readAgentProposals();
      const resolveTargetId = (payload: unknown) => {
        const typedPayload = payload as never;
        return adapter.getProposalTargetId?.(typedPayload) || (payload as { id?: string } | undefined)?.id || '';
      };
      const targetId = resolveTargetId(proposalPayload.normalized);
      const existingPending = allProposals.find(
        (p) => p.domain === adapter.domain
          && targetId
          && resolveTargetId(p.payload) === targetId
          && (p.approvalStatus === 'Wait' || (p.approvalStatus === 'Yes' && p.saveStatus === 'Wait')),
      );
      if (existingPending) {
        return makeResponse({
          ok: false,
          lines: [
            fail(`pending proposal already exists for ${adapter.domain} target=${targetId}: ${existingPending.id} (已有待处理提案，请先处理或用 proposal.clear 清理)`),
          ],
          error: { code: 'duplicate-proposal', message: 'pending proposal already exists', details: { proposalId: existingPending.id } },
        });
      }
      const proposal = createAgentProposal({
        domain: adapter.domain,
        operation: `${adapter.commandPrefix}.apply`,
        payload: proposalPayload.normalized,
        approvalStatus: 'Wait',
        saveStatus: 'Wait',
        client,
        sessionId,
        summary: proposalPayload.summary,
      });
      const alias = getProposalAlias(proposal.id, sessionId);
      const aliasPart = alias ? `${alias} ` : '';
      const pendingAfterCreate = readPendingAgentProposals(sessionId);
      const restBacklogLines = client === 'rest' && pendingAfterCreate.length > 1
        ? [
            `[check] pending proposals=${pendingAfterCreate.length}; Y/Y will be blocked before user approval (待处理提案=${pendingAfterCreate.length}，用户审批前 Y/Y 会被阻塞)`,
            '[action] Call REST proposal.clear now, then resubmit only the current proposal. For multiple edits, submit and finish them one by one. (请外部 agent 立刻通过 REST 调用 proposal.clear 删除所有提案，再重新提交当前这一个；多个提案请逐个提交、逐个审批)',
          ]
        : [];
      const nextActionText = client === 'rest'
        ? 'Open Web CLI /ai-cli; proposal auto-imports via SSE. Press Y to approve, then Y to save.'
        : 'Press Y to approve, N to reject';
      const nextActionZh = client === 'rest'
        ? '打开 /ai-cli，提案会自动同步；按 Y 批准，再按 Y 保存'
        : '按 Y 批准，按 N 拒绝';
      return makeResponse({
        lines: [
          ok(`proposal created: ${aliasPart}${proposal.id} (提案已创建)`),
          `[state] approval=${labelApproval(proposal.approvalStatus)} save=${labelSave(proposal.saveStatus)} (审批=${labelApprovalZh(proposal.approvalStatus)} 保存=${labelSaveZh(proposal.saveStatus)})`,
          `[next] ${nextActionText} (${nextActionZh})`,
          client === 'rest' ? '[handoff] auto-syncing to Web CLI via SSE. Do not re-run fill.apply. (将自动同步到 Web CLI，无需重新执行 fill.apply)' : '',
          ...restBacklogLines,
        ].filter(Boolean),
        effects: { writes: false, storage: [] },
        workflow: adapter.workflow,
        proposal: {
          id: proposal.id,
          domain: proposal.domain,
          approval: proposal.approvalStatus,
          save: proposal.saveStatus,
          nextAction: nextActionText,
        },
      });
    }
  }

  if (command === 'proposal.list') {
    const proposals = readPendingAgentProposals(sessionId);
    if (!proposals.length) {
      return makeResponse({
        lines: [info('no pending proposals (没有待处理提案)')],
        data: { proposals },
      });
    }
    const rows = proposals.map((p, idx) => [
      `#${idx + 1}`,
      p.domain,
      `${labelApproval(p.approvalStatus)} (${labelApprovalZh(p.approvalStatus)})`,
      `${labelSave(p.saveStatus)} (${labelSaveZh(p.saveStatus)})`,
      p.summary || '-',
      p.id,
    ]);
    return makeResponse({
      lines: table(
        ['#', 'Domain', 'Approval', 'Save', 'Summary', 'id'],
        rows,
      ),
      data: { proposals },
    });
  }

  if (command === 'proposal.clear') {
    const result = clearPendingAgentProposals(sessionId, client);
    if (result.cleared.length === 0) {
      return makeResponse({ lines: [info('no pending proposals to clear (没有可清理的待处理提案)')] });
    }
    return makeResponse({
      lines: [
        ok(`cleared ${result.cleared.length} pending proposal${result.cleared.length === 1 ? '' : 's'} (已清理 ${result.cleared.length} 个待处理提案)`),
        `[state] ${result.remaining} pending proposals in current session (当前会话 ${result.remaining} 个待处理提案)`,
        '[next] Submit a fresh fill.apply or inspect with proposal.list (可以重新提交 fill.apply，或用 proposal.list 查看)',
      ],
      effects: { writes: true, storage: [AI_AGENT_PROPOSALS_STORAGE_KEY] },
      data: { proposals: result.cleared },
    });
  }

  if (command === 'proposal.show') {
    const [proposalRef] = args;
    if (!proposalRef) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.show <id|#N> (用法: proposal.show <id|#N>)')] });
    }
    const proposal = resolveProposalReference(proposalRef, sessionId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalRef} (提案未找到)`)] });
    }
    const alias = getProposalAlias(proposal.id, sessionId);
    const aliasPart = alias ? `${alias} ` : '';
    const nextActionEn = (() => {
      if (proposal.approvalStatus === 'Wait') return '[next] Press Y to approve, N to reject';
      if (proposal.approvalStatus === 'Yes' && proposal.saveStatus === 'Wait') return '[next] Press Y to save, N to unsave';
      return '[done] review flow closed';
    })();
    const nextActionZh = (() => {
      if (proposal.approvalStatus === 'Wait') return '输入 Y 批准 N 拒绝';
      if (proposal.approvalStatus === 'Yes' && proposal.saveStatus === 'Wait') return '输入 Y 保存 N 取消保存';
      return '审核闭环已完成';
    })();
    return makeResponse({
      lines: [
        `Proposal: ${aliasPart}${proposal.id}`,
        `Domain: ${proposal.domain}`,
        `Operation: ${proposal.operation}`,
        `Source: ${proposal.client || '-'}`,
        `Reviewer: ${proposal.reviewedBy || '-'}`,
        `Approval: ${labelApproval(proposal.approvalStatus)} (${labelApprovalZh(proposal.approvalStatus)})`,
        `Save: ${labelSave(proposal.saveStatus)} (${labelSaveZh(proposal.saveStatus)})`,
        `Summary: ${proposal.summary || '-'}`,
        `${nextActionEn} (${nextActionZh})`,
        `Payload: ${JSON.stringify(proposal.payload).slice(0, 200)}...`,
      ],
      data: { proposal },
    });
  }

  if (command === 'proposal.approve') {
    const [proposalRef] = args;
    if (!proposalRef) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.approve <id|#N> (用法: proposal.approve <id|#N>)')] });
    }
    const proposal = resolveProposalReference(proposalRef, sessionId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalRef} (提案未找到)`)] });
    }
    if (proposal.approvalStatus !== 'Wait') {
      return makeResponse({ ok: false, lines: [fail(`proposal is not pending approval: ${proposal.id} (提案不在待审批状态)`)] });
    }
    const adapter = findFillDomainAdapterByDomain(proposal.domain);
    if (!adapter) {
      return makeResponse({ ok: false, lines: [fail(`no adapter for domain: ${proposal.domain} (未找到领域适配器)`)] });
    }
    const payloadValidation = adapter.validateProposalPayload?.(proposal.payload);
    if (payloadValidation && !payloadValidation.ok) {
      const message = payloadValidation.errors.slice(0, 3).join('; ') || 'invalid proposal payload';
      return makeResponse({
        ok: false,
        lines: [fail(`invalid proposal payload: ${message} (提案内容校验失败)`)],
        error: { code: 'invalid-proposal-payload', message, details: { proposalId: proposal.id, errors: payloadValidation.errors } },
      });
    }
    const applyPayload = payloadValidation?.normalized ?? proposal.payload;
    const applyResult = adapter.applyToWorkingState(applyPayload);
    if (!applyResult.ok) {
      return makeResponse({ ok: false, lines: [fail(`apply failed: ${applyResult.error || 'unknown'} (应用失败)`)] });
    }
    const updated = approveAgentProposal(proposal.id);
    const alias = getProposalAlias(updated?.id ?? proposal.id, sessionId);
    const aliasPart = alias ? `${alias} ` : '';
    return makeResponse({
      lines: [
        ok(`approved and applied to working draft: ${aliasPart}${updated?.id ?? proposal.id} (已批准并应用到当前草稿)`),
        `[state] approval=${labelApproval(updated?.approvalStatus ?? proposal.approvalStatus)} save=${labelSave(updated?.saveStatus ?? proposal.saveStatus)} (审批=${labelApprovalZh(updated?.approvalStatus ?? proposal.approvalStatus)} 保存=${labelSaveZh(updated?.saveStatus ?? proposal.saveStatus)})`,
        `[next] Press Y to save, N to unsave (Y 保存，N 取消保存)`,
      ],
      effects: { writes: true, storage: [adapter.draftStorageKey] },
      data: { proposal: updated },
      proposal: updated ? {
        id: updated.id,
        domain: updated.domain,
        approval: updated.approvalStatus,
        save: updated.saveStatus,
        nextAction: 'reply Y/N in web-cli to save or unsave',
      } : undefined,
    });
  }

  if (command === 'proposal.reject') {
    const [proposalRef] = args;
    if (!proposalRef) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.reject <id|#N> (用法: proposal.reject <id|#N>)')] });
    }
    const proposal = resolveProposalReference(proposalRef, sessionId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalRef} (提案未找到)`)] });
    }
    const updated = rejectAgentProposal(proposal.id);
    if (!updated) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found or not pending: ${proposal.id} (提案未找到或不在待审批状态)`)] });
    }
    const alias = getProposalAlias(updated.id, sessionId);
    const aliasPart = alias ? `${alias} ` : '';
    return makeResponse({
      lines: [
        ok(`rejected, draft unchanged: ${aliasPart}${updated.id} (已拒绝，草稿未修改)`),
        `[state] approval=${labelApproval(updated.approvalStatus)} save=${labelSave(updated.saveStatus)} (审批=${labelApprovalZh(updated.approvalStatus)} 保存=${labelSaveZh(updated.saveStatus)})`,
        `[done] review flow closed (审核闭环结束)`,
      ],
      data: { proposal: updated },
      proposal: {
        id: updated.id,
        domain: updated.domain,
        approval: updated.approvalStatus,
        save: updated.saveStatus,
        nextAction: 'none',
      },
    });
  }

  if (command === 'proposal.save') {
    const [proposalRef] = args;
    if (!proposalRef) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.save <id|#N> (用法: proposal.save <id|#N>)')] });
    }
    const proposal = resolveProposalReference(proposalRef, sessionId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalRef} (提案未找到)`)] });
    }
    if (proposal.approvalStatus !== 'Yes' || proposal.saveStatus !== 'Wait') {
      return makeResponse({ ok: false, lines: [fail(`proposal is not ready to save: ${proposal.id} (提案不在可保存状态)`)] });
    }
    const adapter = findFillDomainAdapterByDomain(proposal.domain);
    if (!adapter) {
      return makeResponse({ ok: false, lines: [fail(`no adapter for domain: ${proposal.domain} (未找到领域适配器)`)] });
    }
    const payloadValidation = adapter.validateProposalPayload?.(proposal.payload);
    if (payloadValidation && !payloadValidation.ok) {
      const message = payloadValidation.errors.slice(0, 3).join('; ') || 'invalid proposal payload';
      return makeResponse({
        ok: false,
        lines: [fail(`invalid proposal payload: ${message} (提案内容校验失败)`)],
        error: { code: 'invalid-proposal-payload', message, details: { proposalId: proposal.id, errors: payloadValidation.errors } },
      });
    }
    const savePayload = payloadValidation?.normalized ?? proposal.payload;
    const saveResult = adapter.saveToLocalTruth(savePayload);
    if (!saveResult.ok) {
      return makeResponse({ ok: false, lines: [fail(`save failed: ${saveResult.error || 'unknown'} (保存失败)`)] });
    }
    const updated = markAgentProposalSaved(proposal.id);
    const storageKeys = proposal.domain === 'buff'
      ? [adapter.draftStorageKey, adapter.libraryStorageKey, BUFF_UNDO_STORAGE_KEY]
      : [adapter.draftStorageKey, adapter.libraryStorageKey];
    const alias = getProposalAlias(updated?.id ?? proposal.id, sessionId);
    const aliasPart = alias ? `${alias} ` : '';
    return makeResponse({
      lines: [
        ok(`saved to local truth: ${aliasPart}${updated?.id ?? proposal.id} (已保存到本地主库)`),
        `[state] approval=${labelApproval(updated?.approvalStatus ?? proposal.approvalStatus)} save=${labelSave(updated?.saveStatus ?? proposal.saveStatus)} (审批=${labelApprovalZh(updated?.approvalStatus ?? proposal.approvalStatus)} 保存=${labelSaveZh(updated?.saveStatus ?? proposal.saveStatus)})`,
        `[done] review flow complete (审核闭环完成)`,
      ],
      data: { proposal: updated },
      effects: { writes: true, storage: storageKeys },
      proposal: updated ? {
        id: updated.id,
        domain: updated.domain,
        approval: updated.approvalStatus,
        save: updated.saveStatus,
        nextAction: 'none',
      } : undefined,
    });
  }

  if (command === 'proposal.unsave') {
    const [proposalRef] = args;
    if (!proposalRef) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.unsave <id|#N> (用法: proposal.unsave <id|#N>)')] });
    }
    const proposal = resolveProposalReference(proposalRef, sessionId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalRef} (提案未找到)`)] });
    }
    const updated = markAgentProposalUnsaved(proposal.id);
    if (!updated) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found or not saveable: ${proposal.id} (提案未找到或不在可保存状态)`)] });
    }
    const alias = getProposalAlias(updated.id, sessionId);
    const aliasPart = alias ? `${alias} ` : '';
    return makeResponse({
      lines: [
        ok(`save cancelled, library unchanged: ${aliasPart}${updated.id} (已取消保存，主库未写入)`),
        `[state] approval=${labelApproval(updated.approvalStatus)} save=${labelSave(updated.saveStatus)} (审批=${labelApprovalZh(updated.approvalStatus)} 保存=${labelSaveZh(updated.saveStatus)})`,
        `[done] review flow closed (审核闭环结束)`,
      ],
      data: { proposal: updated },
      proposal: {
        id: updated.id,
        domain: updated.domain,
        approval: updated.approvalStatus,
        save: updated.saveStatus,
        nextAction: 'none',
      },
    });
  }

  if (command === 'y') {
    const targets = readPendingAgentProposals(sessionId);
    if (targets.length === 0) {
      return makeResponse({ ok: false, lines: [fail('no pending proposals in current session (当前会话没有待处理提案)')] });
    }
    if (targets.length > 1) {
      return makeResponse({
        ok: false,
        lines: [
          fail(`Y/N is blocked by ${targets.length} pending proposals. Use proposal.list, explicit commands, or REST proposal.clear. (Y/N 已被 ${targets.length} 个待处理提案阻塞；请先查看列表、显式处理，或让外部模型调用 proposal.clear 清理)`),
        ],
      });
    }
    const target = targets[0];
    if (target.approvalStatus === 'Wait') {
      return executeCommand(`proposal.approve ${target.id}`, draft, sourceText, client, sessionId);
    }
    if (target.approvalStatus === 'Yes' && target.saveStatus === 'Wait') {
      return executeCommand(`proposal.save ${target.id}`, draft, sourceText, client, sessionId);
    }
    return makeResponse({ lines: [info(`proposal ${target.id} is already resolved (提案已处理完毕)`)] });
  }

  if (command === 'n') {
    const targets = readPendingAgentProposals(sessionId);
    if (targets.length === 0) {
      return makeResponse({ ok: false, lines: [fail('no pending proposals in current session (当前会话没有待处理提案)')] });
    }
    if (targets.length > 1) {
      return makeResponse({
        ok: false,
        lines: [
          fail(`Y/N is blocked by ${targets.length} pending proposals. Use proposal.list, explicit commands, or REST proposal.clear. (Y/N 已被 ${targets.length} 个待处理提案阻塞；请先查看列表、显式处理，或让外部模型调用 proposal.clear 清理)`),
        ],
      });
    }
    const target = targets[0];
    if (target.approvalStatus === 'Wait') {
      return executeCommand(`proposal.reject ${target.id}`, draft, sourceText, client, sessionId);
    }
    if (target.approvalStatus === 'Yes' && target.saveStatus === 'Wait') {
      return executeCommand(`proposal.unsave ${target.id}`, draft, sourceText, client, sessionId);
    }
    return makeResponse({ lines: [info(`proposal ${target.id} is already resolved (提案已处理完毕)`)] });
  }

  if (command === 'fill.source') {
    return makeResponse({ lines: [info('source text is set by fill.source <text>')] });
  }

  return makeResponse({
    ok: false,
    lines: [fail(`unknown command: ${command} (未知命令)`), 'type help (输入 help 查看可用命令)'],
    error: { code: 'unknown-command', message: `unknown command: ${command}` },
  });
}

export function runAiCliCommand(
  request: AiCliCommandRequest,
  draft: BuffDraft,
  context: AiCliExecutionContext,
): AiCliCommandResult {
  const startedAt = performance.now();
  const commandName = splitAiCliCommand(request.command)[0]?.toLowerCase() || '';
  const session = ensureActiveSession(request.client);
  const sessionId = context.sessionId || session?.id;
  const permission = findPermissionProfile(request.client);
  const permissionError = commandName ? assertPermission(permission, commandName) : null;

  appendSessionMessage(sessionId || '', {
    role: 'user',
    text: summarizeAiCliCommand(request.command),
  });

  let response: AiCliCommandResult;
  if (!commandName) {
    response = makeResponse({
      lines: [info('type help (输入 help 查看可用命令)')],
    });
  } else if (permissionError) {
    const permissionHint = request.client === 'rest'
      ? 'hint: this command requires a writer/user-confirmation client. Use ?client=web-cli or body.client="web-cli" only from the trusted Web CLI/user path. (提示：该命令需要写权限/用户确认客户端；可信 Web CLI 用户路径可使用 ?client=web-cli 或 body.client="web-cli")'
      : '';
    response = makeResponse({
      ok: false,
      lines: [fail(permissionError.message), permissionHint].filter(Boolean),
      error: { code: permissionError.code, message: permissionError.message, details: permissionHint ? { hint: permissionHint } : undefined },
    });
  } else {
    try {
      response = executeCommand(request.command, draft, context.sourceText, request.client, sessionId || '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response = makeResponse({
        ok: false,
        lines: [fail(message)],
        error: { code: 'command-error', message },
      });
    }
  }

  // fill.task 在 web-cli 时补 copyText，fill.task.copy 始终保留
  if ((commandName === 'fill.task' && request.client === 'web-cli' && response.data) || commandName === 'fill.task.copy') {
    response.copyText = JSON.stringify(response.data);
  }

  response.requestId = request.requestId;
  appendSessionMessage(sessionId || '', {
    role: 'app',
    text: response.lines.join('\n'),
    data: response.error,
  });
  const resolvedWorkflow = response.workflow ?? 'buff.fill';
  updateSessionContext(sessionId || '', {
    currentWorkflow: resolvedWorkflow,
    currentDraftId: response.nextDraft?.id ?? draft.id,
    lastCommand: commandName,
    lastValidationOk: response.ok,
  });
  overwriteSessionSummary(`${response.ok ? 'ok' : 'err'} ${commandName || 'empty'} · ${summarizeAiCliCommand(request.command)}`);
  const existingState = readAgentSession()?.state ?? {};
  const nextState: Record<string, unknown> = {
    currentWorkflow: resolvedWorkflow,
    currentDraftId: response.nextDraft?.id ?? draft.id,
    lastCommand: commandName,
    lastOk: response.ok,
    lastRequestId: request.requestId,
    lastClient: request.client,
    lastWrites: response.effects.writes,
    lastStorage: response.effects.storage,
    lastErrorCode: response.error?.code,
    updatedAt: Date.now(),
  };
  if (response.proposal) {
    nextState.proposalId = response.proposal.id;
    nextState.approval = response.proposal.approval;
    nextState.save = response.proposal.save;
  } else {
    nextState.proposalId = existingState.proposalId;
    nextState.approval = existingState.approval;
    nextState.save = existingState.save;
  }
  overwriteSessionState(nextState);

  const logEntry: Parameters<typeof appendOperationLog>[0] = {
    requestId: request.requestId,
    sessionId,
    client: request.client,
    permissionProfileId: permission.id,
    operationType: response.effects.writes ? 'write' : 'command',
    command: summarizeAiCliCommand(request.command),
    ok: response.ok,
    durationMs: Math.round(performance.now() - startedAt),
    writes: response.effects.writes,
    storage: response.effects.storage,
    errorCode: response.error?.code,
    errorMessage: response.error?.message,
  };

  if (response.proposal) {
    logEntry.proposalId = response.proposal.id;
    logEntry.approval = response.proposal.approval;
    logEntry.save = response.proposal.save;
  }

  appendOperationLog(logEntry);

  return response;
}

export function createAiCliCommandRequest(command: string, client: AiAgentClient = 'web-cli'): AiCliCommandRequest {
  return {
    protocolVersion: AI_CLI_PROTOCOL_VERSION,
    client,
    command,
  };
}
