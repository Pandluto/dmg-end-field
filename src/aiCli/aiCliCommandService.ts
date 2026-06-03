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
  appendOperationLog,
  appendSessionMessage,
  assertPermission,
  createAgentProposal,
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
import { WEAPON_DRAFT_STORAGE_KEY, WEAPON_LIBRARY_STORAGE_KEY, weaponFillAdapter } from './weaponFillAdapter';
import { buffFillAdapter } from './buffFillAdapter';

registerFillDomainAdapter(buffFillAdapter);
registerFillDomainAdapter(weaponFillAdapter);

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
          ['scope', 'command', 'purpose / 用途'],
          [
            ['system', 'help | clear | spec | /purpose', 'show help/spec/purpose / 查看帮助、规范、用途'],
            ['route', 'route home|buff', 'navigate app route / 跳转页面'],
            ['operator', 'operator.add <id> <name> [weapon=] [potential=] [skillLevel=]', 'create/select test operator / 创建并选中测试干员'],
            ['operator', 'operator.show [id]', 'read operator config / 查看干员配置'],
            ['operator', 'operator.delete <id>', 'delete test operator config / 删除测试干员配置'],
            ['buff', 'buff.list [limit]', 'list Buff library entries / 查看 Buff 主库'],
            ['buff', 'buff.show <id>', 'read one Buff library entry / 查看主库单个 Buff'],
            ['buff', 'buff.search <keyword>', 'search Buff library / 搜索 Buff 主库'],
            ['buff', 'buff.open <id>', 'set active draft from library / 从主库打开到当前编辑'],
            ['draft', 'draft.show', 'read active draft only / 查看当前打开项'],
            ['draft', 'draft.rename <name>', 'rename active draft and sync library / 重命名当前打开项并同步主库'],
            ['item', 'item.list | item.add | item.set | item.delete', 'CRUD buff items / 增删改查 Buff 分组'],
            ['effect', 'effect.list | effect.add | effect.set | effect.delete', 'CRUD modifier effects / 增删改查 Buff 效果'],
            ['fill', 'fill.source <text>', 'set source text for task package / 设置填表原文'],
            ['fill', 'fill.task', 'return structured task package / 返回结构化任务包'],
            ['fill', 'fill.task.copy', 'copy task package to clipboard / 复制任务包'],
            ['fill', 'fill.check <json>', 'validate BuffFillAiDraft without writing / 只校验不写入'],
            ['fill', 'fill.apply <json>', 'create proposal from AI fill result / 创建填表提案'],
            ['weapon', 'weapon.fill.task', 'return weapon task package / 返回武器填表任务包'],
            ['weapon', 'weapon.fill.check <json>', 'validate WeaponFillAiDraft / 校验武器填表结果'],
            ['weapon', 'weapon.fill.apply <json>', 'create weapon fill proposal / 创建武器填表提案'],
            ['proposal', 'proposal.list', 'list pending proposals / 查看待处理提案'],
            ['proposal', 'proposal.show <id>', 'show proposal details / 查看提案详情'],
            ['proposal', 'proposal.approve <id>', 'approve and apply to working state / 批准并应用到工作状态'],
            ['proposal', 'proposal.reject <id>', 'reject proposal / 拒绝提案'],
            ['proposal', 'proposal.save <id>', 'save approved proposal to local truth / 保存已批准提案到本地主库'],
            ['proposal', 'proposal.unsave <id>', 'mark saved proposal as unsaved / 标记提案为未保存'],
            ['shortcut', 'Y', 'approve pending proposal or save approved / 快捷批准或保存'],
            ['shortcut', 'N', 'reject pending proposal or unsave approved / 快捷拒绝或取消保存'],
            ['agent', 'agent.logs [limit]', 'show recent agent operation logs / 查看智能体访问记录'],
            ['agent', 'agent.sessions [limit]', 'show current single agent session / 查看当前单会话'],
            ['agent', 'agent.guide', 'show first-call guide for LLM agents / 查看智能体首次接入指南'],
          ],
        ),
        '',
        `main truth: localStorage.${BUFF_LIBRARY_STORAGE_KEY}`,
        `active editor state: localStorage.${BUFF_DRAFT_STORAGE_KEY}`,
        'quote values with spaces: item.add item-1 "测试天赋" desc="长描述"',
      ],
    });
  }

  if (command === '/purpose' || command === 'purpose') {
    return makeResponse({
      lines: [
        'purpose / 用途:',
        '  EN: Provide a terminal-style, app-controlled bridge for Codex/Claude to inspect the Buff library and propose edits.',
        '  CN: 提供一个由软件本体控制的终端式桥接界面，让 Codex/Claude 查看 Buff 主库并提交修改。',
        '',
        'boundary / 边界:',
        '  EN: Agents produce commands or BuffFillAiDraft JSON; the app validates and writes.',
        '  CN: 智能体只产生命令或 BuffFillAiDraft JSON；校验和写入由软件本体完成。',
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
        '',
        'storage touched:',
        `  localStorage.${BUFF_DRAFT_STORAGE_KEY}`,
        `  localStorage.${BUFF_LIBRARY_STORAGE_KEY}`,
        `  localStorage.${BUFF_UNDO_STORAGE_KEY}`,
        `  localStorage.${WEAPON_DRAFT_STORAGE_KEY}`,
        `  localStorage.${WEAPON_LIBRARY_STORAGE_KEY}`,
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
    const rows = readOperationLogs().slice(0, limit).map((log) => [
      formatDateTime(log.createdAt),
      log.client,
      log.ok ? 'ok' : 'err',
      log.writes ? 'write' : 'read',
      log.approval || '-',
      log.save || '-',
      log.command,
      log.errorCode || '-',
    ]);
    return makeResponse({
      lines: rows.length
        ? table(['time', 'client', 'ok', 'effect', 'approval', 'save', 'command', 'error'], rows)
        : [info('no agent logs')],
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
        '  events: GET /api/agent/events',
        '',
        'rule: agent proposes commands/JSON; app validates, logs, and writes.',
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
        : [info(`no library match: ${keyword}`)],
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

  if (command === 'agent.sessions') {
    const limit = Math.max(1, Math.min(50, Number(args[0] || 10) || 10));
    const rows = readAgentSessions().slice(0, limit).map((session) => {
      const state = session.state as { approval?: string; save?: string } | undefined;
      return [
        formatDateTime(session.updatedAt),
        session.client,
        session.status,
        state?.approval || '-',
        state?.save || '-',
        session.summary || '-',
        String(session.messages.length),
        session.context.lastCommand || '-',
        session.id,
      ];
    });
    return makeResponse({
      lines: rows.length
        ? table(['updated', 'client', 'status', 'approval', 'save', 'summary', 'messages', 'last', 'sessionId'], rows)
        : [info('no agent sessions')],
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
      const targetId = (proposalPayload.normalized as { id?: string }).id;
      const existingPending = allProposals.find(
        (p) => p.domain === adapter.domain
          && targetId
          && (p.payload as { id?: string }).id === targetId
          && (p.approvalStatus === 'Wait' || (p.approvalStatus === 'Yes' && p.saveStatus === 'Wait')),
      );
      if (existingPending) {
        return makeResponse({
          ok: false,
          lines: [fail(`pending proposal already exists for ${adapter.domain} id=${targetId}: ${existingPending.id}`)],
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
      return makeResponse({
        lines: [ok(`proposal created: ${proposal.id}`)],
        effects: { writes: false, storage: [] },
        workflow: adapter.workflow,
        proposal: {
          id: proposal.id,
          domain: proposal.domain,
          approval: proposal.approvalStatus,
          save: proposal.saveStatus,
          nextAction: 'approve or reject',
        },
      });
    }
  }

  if (command === 'proposal.list') {
    const proposals = readPendingAgentProposals();
    return makeResponse({
      lines: proposals.length
        ? table(
            ['id', 'domain', 'operation', 'approval', 'save', 'client', 'updatedAt'],
            proposals.map((p) => [
              p.id,
              p.domain,
              p.operation,
              p.approvalStatus,
              p.saveStatus,
              p.client,
              formatDateTime(p.updatedAt),
            ]),
          )
        : [info('no pending proposals')],
      data: { proposals },
    });
  }

  if (command === 'proposal.show') {
    const [proposalId] = args;
    if (!proposalId) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.show <proposalId>')] });
    }
    const allProposals = readAgentProposals();
    const proposal = allProposals.find((p) => p.id === proposalId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalId}`)] });
    }
    return makeResponse({
      lines: [
        `id=${proposal.id}`,
        `domain=${proposal.domain}`,
        `operation=${proposal.operation}`,
        `approval=${proposal.approvalStatus}`,
        `save=${proposal.saveStatus}`,
        `summary=${proposal.summary || '-'}`,
        `payload=${JSON.stringify(proposal.payload).slice(0, 200)}...`,
      ],
      data: { proposal },
    });
  }

  if (command === 'proposal.approve') {
    const [proposalId] = args;
    if (!proposalId) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.approve <proposalId>')] });
    }
    const allProposals = readAgentProposals();
    const proposal = allProposals.find((p) => p.id === proposalId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalId}`)] });
    }
    if (proposal.approvalStatus !== 'Wait') {
      return makeResponse({ ok: false, lines: [fail(`proposal ${proposalId} is not waiting for approval`)] });
    }
    const adapter = findFillDomainAdapterByDomain(proposal.domain);
    if (!adapter) {
      return makeResponse({ ok: false, lines: [fail(`no adapter for domain: ${proposal.domain}`)] });
    }
    const applyResult = adapter.applyToWorkingState(proposal.payload);
    if (!applyResult.ok) {
      return makeResponse({ ok: false, lines: [fail(`apply failed: ${applyResult.error || 'unknown'}`)] });
    }
    const updated = approveAgentProposal(proposal.id);
    return makeResponse({
      lines: [ok(`proposal approved: ${proposalId}`)],
      effects: { writes: true, storage: [adapter.draftStorageKey] },
      data: { proposal: updated },
      proposal: updated ? {
        id: updated.id,
        domain: updated.domain,
        approval: updated.approvalStatus,
        save: updated.saveStatus,
        nextAction: 'save or unsave',
      } : undefined,
    });
  }

  if (command === 'proposal.reject') {
    const [proposalId] = args;
    if (!proposalId) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.reject <proposalId>')] });
    }
    const updated = rejectAgentProposal(proposalId);
    if (!updated) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found or not in Wait status: ${proposalId}`)] });
    }
    return makeResponse({
      lines: [ok(`proposal rejected: ${proposalId}`)],
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
    const [proposalId] = args;
    if (!proposalId) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.save <proposalId>')] });
    }
    const allProposals = readAgentProposals();
    const proposal = allProposals.find((p) => p.id === proposalId);
    if (!proposal) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found: ${proposalId}`)] });
    }
    if (proposal.approvalStatus !== 'Yes' || proposal.saveStatus !== 'Wait') {
      return makeResponse({ ok: false, lines: [fail(`proposal ${proposalId} is not ready to save`)] });
    }
    const adapter = findFillDomainAdapterByDomain(proposal.domain);
    if (!adapter) {
      return makeResponse({ ok: false, lines: [fail(`no adapter for domain: ${proposal.domain}`)] });
    }
    const saveResult = adapter.saveToLocalTruth(proposal.payload);
    if (!saveResult.ok) {
      return makeResponse({ ok: false, lines: [fail(`save failed: ${saveResult.error || 'unknown'}`)] });
    }
    const updated = markAgentProposalSaved(proposal.id);
    const storageKeys = proposal.domain === 'buff'
      ? [adapter.draftStorageKey, adapter.libraryStorageKey, BUFF_UNDO_STORAGE_KEY]
      : [adapter.draftStorageKey, adapter.libraryStorageKey];
    return makeResponse({
      lines: [ok(`proposal saved: ${proposalId}`)],
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
    const [proposalId] = args;
    if (!proposalId) {
      return makeResponse({ ok: false, lines: [fail('usage: proposal.unsave <proposalId>')] });
    }
    const updated = markAgentProposalUnsaved(proposalId);
    if (!updated) {
      return makeResponse({ ok: false, lines: [fail(`proposal not found or not in saveable status: ${proposalId}`)] });
    }
    return makeResponse({
      lines: [ok(`proposal unsaved: ${proposalId}`)],
      data: { proposal: updated },
      proposal: {
        id: updated.id,
        domain: updated.domain,
        approval: updated.approvalStatus,
        save: updated.saveStatus,
        nextAction: 'save or unsave',
      },
    });
  }

  if (command === 'y') {
    const targets = readPendingAgentProposals(sessionId);
    if (targets.length === 0) {
      return makeResponse({ ok: false, lines: [fail('no pending proposals in current session')] });
    }
    if (targets.length > 1) {
      return makeResponse({
        ok: false,
        lines: [fail(`ambiguous: ${targets.length} pending proposals. use proposal.approve <id> or proposal.save <id>`)],
      });
    }
    const target = targets[0];
    if (target.approvalStatus === 'Wait') {
      return executeCommand(`proposal.approve ${target.id}`, draft, sourceText, client, sessionId);
    }
    if (target.approvalStatus === 'Yes' && target.saveStatus === 'Wait') {
      return executeCommand(`proposal.save ${target.id}`, draft, sourceText, client, sessionId);
    }
    return makeResponse({ lines: [info(`proposal ${target.id} is already resolved`)] });
  }

  if (command === 'n') {
    const targets = readPendingAgentProposals(sessionId);
    if (targets.length === 0) {
      return makeResponse({ ok: false, lines: [fail('no pending proposals in current session')] });
    }
    if (targets.length > 1) {
      return makeResponse({
        ok: false,
        lines: [fail(`ambiguous: ${targets.length} pending proposals. use proposal.reject <id> or proposal.unsave <id>`)],
      });
    }
    const target = targets[0];
    if (target.approvalStatus === 'Wait') {
      return executeCommand(`proposal.reject ${target.id}`, draft, sourceText, client, sessionId);
    }
    if (target.approvalStatus === 'Yes' && target.saveStatus === 'Wait') {
      return executeCommand(`proposal.unsave ${target.id}`, draft, sourceText, client, sessionId);
    }
    return makeResponse({ lines: [info(`proposal ${target.id} is already resolved`)] });
  }

  if (command === 'fill.source') {
    return makeResponse({ lines: [info('source text is set by fill.source <text>')] });
  }

  return makeResponse({
    ok: false,
    lines: [fail(`unknown command: ${command}`), 'type help'],
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
      lines: [info('type help')],
    });
  } else if (permissionError) {
    response = makeResponse({
      ok: false,
      lines: [fail(permissionError.message)],
      error: { code: permissionError.code, message: permissionError.message },
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
