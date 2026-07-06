import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  hydrateDefAgentSession,
  startDefAgentStream,
  stopDefAgentStream,
  subscribeDefAgentSession,
  type DefAgentStreamEvent,
  type DefAgentThinkingEffort,
  type DefAgentTokens,
} from '../../utils/defAgent';
import { getLocalAgentHealth, requestOpenAiCliRest } from '../../utils/localAgent';
import type { Character, SkillButton, SkillButtonType } from '../../types';
import {
  MAIN_WORKBENCH_REST_BASE_URL,
  type MainWorkbenchCommand,
  type MainWorkbenchSnapshot,
  type QueuedMainWorkbenchCommand,
} from '../../utils/mainWorkbenchControl';
import { buildGameKnowledgePromptLines, resolveGameGearSetAlias, resolveGameOperatorAlias, resolveGameWeaponAlias } from '../../utils/gameKnowledge';
import './MainWorkbenchAiPanel.css';

const DEF_AGENT_BROWSER_SESSION_KEY = 'def-opencode.workbench.activeSession.v1';
const WORKBENCH_AGENT_SKILL_ID = 'workbench';
const WORKBENCH_AGENT_TURN_TIMEOUT_MS = 180000;
const WORKBENCH_AGENT_STREAM_RECONNECT_LIMIT = 3;

type WorkbenchAiMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  status?: 'pending' | 'running' | 'done' | 'error' | 'stopped';
  prompt?: string;
  rollbackLabel?: string;
};

type WorkbenchAiStepId = 'backup' | 'rest' | 'agent' | 'operate' | 'verify';

type WorkbenchAiStep = {
  id: WorkbenchAiStepId;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'stopped';
};

type StoredDefAgentSession = {
  sessionId: string;
  skillId?: string;
  selectedSignature?: string;
  lastSeq?: number;
  tokens?: DefAgentTokens;
  updatedAt?: number;
};

interface MainWorkbenchAiPanelProps {
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  onExit: () => void;
}

function readStoredDefAgentSession(): StoredDefAgentSession | null {
  try {
    const raw = window.localStorage.getItem(DEF_AGENT_BROWSER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDefAgentSession;
    return parsed?.sessionId && parsed.skillId === WORKBENCH_AGENT_SKILL_ID ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredDefAgentSession(session: StoredDefAgentSession | null) {
  try {
    if (!session?.sessionId) {
      window.localStorage.removeItem(DEF_AGENT_BROWSER_SESSION_KEY);
      return;
    }
    window.localStorage.setItem(DEF_AGENT_BROWSER_SESSION_KEY, JSON.stringify({
      ...session,
      updatedAt: Date.now(),
    }));
  } catch {
    // Storage is optional; the active stream still works without persistence.
  }
}

function buildInitialMessages(): WorkbenchAiMessage[] {
  return [
    {
      id: 'system-ready',
      role: 'system',
      text: 'DEF OpenCode',
      status: 'done',
    },
  ];
}

function formatSessionId(sessionId: string | null) {
  if (!sessionId) return 'new';
  return sessionId.length > 12 ? `${sessionId.slice(0, 5)}...${sessionId.slice(-4)}` : sessionId;
}

function formatTokens(tokens: DefAgentTokens | null) {
  if (!tokens) return 'token 0';
  return `token ${tokens.total || 0} · 入 ${tokens.prompt || 0} · 出 ${tokens.completion || 0}`;
}

function buildSelectedSignature(selectedCharacters: Character[]) {
  return selectedCharacters.map((character) => character.id || character.name).sort().join('|');
}

function buildInitialSteps(): WorkbenchAiStep[] {
  return [
    { id: 'backup', label: '回退点', detail: '等待保存', status: 'pending' },
    { id: 'rest', label: 'REST', detail: '等待启动', status: 'pending' },
    { id: 'agent', label: '思考', detail: '等待请求', status: 'pending' },
    { id: 'operate', label: '操作', detail: '等待命令', status: 'pending' },
    { id: 'verify', label: '验证', detail: '等待快照', status: 'pending' },
  ];
}

function buildWorkbenchAgentMessage(
  userText: string,
  selectedCharacters: Character[],
  skillButtons: SkillButton[],
) {
  const selectedSummary = selectedCharacters.length
    ? selectedCharacters.map((character) => `${character.name}(${character.id})`).join(', ')
    : 'none';
  const buttonSummary = skillButtons.length
    ? skillButtons.map((button) => `${button.characterName}-${button.skillDisplayName || button.skillType}@${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`).join(', ')
    : 'none';

  return [
    '你正在 dmg-end-field 主界面右侧 AI 模式中。用户要通过自然语言操作当前主界面排轴。',
    '当需要改动主界面时，使用 http://127.0.0.1:17321/api/main-workbench/commands/enqueue 投递声明式命令；多步操作优先一次 POST {commands:[...]}，请求体形如 {"commands":[{"op":"..."}],"source":"def-opencode"}。',
    '可用 op: selectCharacters, openView, openWorkbenchPage, clearTimeline, setOperatorWeapon, setOperatorEquipment, addSkillButton, removeSkillButton, addBuff, removeBuff, setTargetResistance, saveTimelineSnapshot, restoreTimelineSnapshot, listTimelineSnapshots, refreshOperatorConfig, calculateDamage, refreshSnapshot。',
    '推荐攻略链路: selectCharacters -> setOperatorWeapon/setOperatorEquipment -> refreshOperatorConfig -> restoreTimelineSnapshot 或 clearTimeline/addSkillButton -> addBuff/setTargetResistance -> calculateDamage -> saveTimelineSnapshot。',
    'setOperatorEquipment 可用 gearSetName/gearSetId + fillSlots 自动填 4 件，也可用 slotKey + equipmentName/equipmentId 指定单件；满词条一般传 entryLevel: 3。',
    '用户要求合适配装但没有指定名称时，不要查库或脚本匹配；已有配置保留，未配置者默认 setOperatorWeapon weaponName=宏愿，setOperatorEquipment gearSetName=潮涌 fillSlots=true entryLevel=3。',
    ...buildGameKnowledgePromptLines(),
    '换人时只读一次快照，保留未提到的已选干员，然后一次性 selectCharacters 写入最终名单；命中当前快照或上述别名时不要搜索干员库，不要先查 ID。',
    '下方当前已选干员与当前技能按钮就是可信上下文；能从这里判断的干员/按钮不要再读快照、查 schema 或查库。',
    '用户只问当前状态/现在穿什么/有哪些按钮/伤害是多少时，这是只读查询：读取 /api/main-workbench/snapshot 后直接回答具体名称和数值，不要投递命令，不要只说“已完成”。',
    '用户要求增加、删除、替换、配置、释放技能、添加 Buff、回退或计算时，必须先投递实际命令；如果无法执行，明确说明失败，不要只读取快照当作完成。',
    '只有换人、清空排轴、批量大改动或用户明确要求可回退时才先保存快照；单个技能按钮/Buff 的添加或移除不要先保存快照。',
    'Buff 操作优先用 addBuff/removeBuff，能用 characterName + skillType 或 buttonId 定位；用户要求重算时把 calculateDamage 和 refreshSnapshot 放进同一个 commands 数组。',
    '发命令后最多读取一次 /api/main-workbench/snapshot 或 /api/main-workbench/commands 确认执行结果，状态已符合就立刻简短回复。',
    `当前已选干员: ${selectedSummary}`,
    `当前技能按钮: ${buttonSummary}`,
    `用户请求: ${userText}`,
  ].join('\n');
}

async function ensureMainWorkbenchRest() {
  const health = await getLocalAgentHealth();
  if (health.aiCliRest?.running) {
    return health.aiCliRest;
  }
  return requestOpenAiCliRest();
}

function enqueueLocalWorkbenchCommand(command: MainWorkbenchCommand, source = 'main-workbench-ai') {
  if (typeof window === 'undefined' || !window.defMainWorkbench) return null;
  return window.defMainWorkbench.enqueue(command, source);
}

function displayTranscriptText(role: string, text = '') {
  if (role !== 'user') return text;
  const marker = '用户请求:';
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex < 0) return text;
  return text.slice(markerIndex + marker.length).trim() || text;
}

function transcriptToMessages(messages: Array<{ id?: string; role: string; text?: string }>): WorkbenchAiMessage[] {
  const converted = messages
    .filter((message) => message.role === 'user' || message.role === 'agent' || message.role === 'system')
    .map((message, index) => ({
      id: message.id || `history-${index}`,
      role: message.role as WorkbenchAiMessage['role'],
      text: displayTranscriptText(message.role, message.text || ''),
      status: 'done' as const,
    }));
  return converted.length > 0 ? converted : buildInitialMessages();
}

function isGenericCompletionText(text: string | undefined) {
  const normalized = String(text || '').trim().replace(/[。.!！\s]/g, '');
  return !normalized || ['已完成', '完成', 'done', 'ok', '好的'].includes(normalized.toLowerCase());
}

function shouldUseSnapshotFallback(prompt: string | undefined, text: string | undefined) {
  if (!isGenericCompletionText(text)) return false;
  return /当前|现在|看一下|穿|装备|武器|按钮|技能|buff|Buff|伤害|实际|告诉我|核对|确认|current|now|status|wear|gear|equipment|weapon|button|skill|damage|check|confirm/i.test(prompt || '');
}

function isMutatingWorkbenchPrompt(prompt: string | undefined) {
  const text = prompt || '';
  if (/不要改|不要变更|不需要改|do not change|don't change|no changes/i.test(text) &&
    !/(加|添加|移除|删除|设置|穿上|换|释放|计算|恢复|回退|清空|重算|add|remove|delete|set|equip|wear|switch|cast|calculate|restore|rollback|clear|recalculate)/i.test(text)) {
    return false;
  }
  return /(给|帮|设置|穿上|换|选择|选上|去掉|移除|删除|增加|添加|释放|计算|保存|恢复|回退|清空|重算|改|配|放|撤|扩到|保留|再加|加Buff|加 buff|Buff|buff|set|equip|wear|switch|select|remove|delete|drop|add|cast|use|calculate|save|restore|rollback|clear|recalculate|change|configure|expand|keep)/i.test(text);
}

function chooseWorkbenchThinkingEffort(prompt: string): DefAgentThinkingEffort {
  const text = prompt.trim();
  const complexityScore = [
    /每个|各|批量|全部|四个人|4个人|队伍|each|every|batch|all|four|4|team|squad/i.test(text),
    /装备|武器|配装|穿|gear|equipment|weapon|equip|wear/i.test(text),
    /按钮|技能|button|skill/i.test(text),
    /Buff|buff|增益|bonus/i.test(text),
    /回退|撤|移除|删除|恢复|rollback|undo|remove|delete|restore|drop/i.test(text),
    /最后|然后|并且|同时|完成后|last|then|and|also|after|finally/i.test(text),
  ].filter(Boolean).length;
  if (complexityScore >= 3 || text.length > 90) return 'high';
  return isMutatingWorkbenchPrompt(text) ? 'medium' : 'low';
}

function shouldRunLocalComplexWorkbenchFlow(prompt: string) {
  const text = prompt.trim();
  const asksTeamExpansion = /扩到四个人|扩到4个人|4个人|四个人|四人|队伍|four|4|team|squad/i.test(text) ||
    (/保留|keep/i.test(text) && /再加|新增|加入|add/i.test(text));
  const asksMultipleSkills = (/每个干员|各放|各释放|每人|每位|每个|each|every/i.test(text) && /两个|2个|two|2/i.test(text)) ||
    (/按钮|技能|button|skill/i.test(text) && /两个|2个|批量|都|two|2|batch|all/i.test(text));
  const asksBuffEdit = /Buff|buff|增益|bonus/i.test(text);
  const asksRemoval = /撤|移除|删除|去掉|回退|删掉|remove|delete|drop|undo/i.test(text);
  return asksTeamExpansion && asksMultipleSkills && asksBuffEdit && asksRemoval;
}

function shouldRunLocalRemoveAddBackFlow(prompt: string) {
  const text = prompt.trim();
  if (/Buff|buff|增益|bonus/i.test(text)) return false;
  return /(移除|删除|去掉|remove|delete|drop)/i.test(text) &&
    /(加回|重新添加|add back|add .* back)/i.test(text) &&
    /(按钮|技能|button|skill)/i.test(text) &&
    /(重算|计算|伤害|calculate|recalculate|damage)/i.test(text);
}

function shouldRunLocalAddRemoveBuffFlow(prompt: string) {
  const text = prompt.trim();
  return /Buff|buff|增益|bonus/i.test(text) &&
    /(加|添加|add|attach|apply)/i.test(text) &&
    /(移除|删除|去掉|remove|delete|drop)/i.test(text) &&
    /(重算|计算|伤害|calculate|recalculate|damage)/i.test(text);
}

function parseWorkbenchTarget(prompt: string, snapshot: MainWorkbenchSnapshot | null) {
  const text = prompt.trim();
  const candidates = snapshot?.selectedCharacters || [];
  const knownAliases = ['Admin', 'Chenqianyu', 'Chen Qianyu', 'Laiwanting', 'Wolf Guard', 'Wolfguard', 'Langwei', 'Lang Wei'];
  const target = candidates.find((character) => {
    const aliases = [
      character.name,
      character.id,
      resolveWorkbenchOperatorName(character.name),
      resolveWorkbenchOperatorName(character.id),
      ...knownAliases.filter((alias) => resolveWorkbenchOperatorName(alias) === character.name),
    ].filter(Boolean);
    return aliases.some((alias) => text.toLowerCase().includes(String(alias).toLowerCase()));
  }) || knownAliases
    .filter((alias) => text.toLowerCase().includes(alias.toLowerCase()))
    .map(resolveWorkbenchOperatorName)[0];

  const characterName = typeof target === 'string' ? target : target?.name;
  if (!characterName) return null;
  const skillTypePattern = new RegExp(`(?:${characterName}|${knownAliases.filter((alias) => resolveWorkbenchOperatorName(alias) === characterName).join('|')})\\s*[-_ ]+([ABEQ])(?:\\s*(?:button|skill|按钮|技能))?`, 'i');
  const skillMatch = text.match(skillTypePattern) ||
    text.match(/(?:按钮|技能|button|skill)\s*[-_ ]*([ABEQ])\b/i) ||
    text.match(/\b([ABEQ])\s*(?:按钮|技能|button|skill)\b/i);
  const skillType = (skillMatch?.[1]?.toUpperCase() || '') as SkillButtonType;
  if (!(['A', 'B', 'E', 'Q'] as SkillButtonType[]).includes(skillType)) return null;
  const matchedButtons = snapshot?.skillButtons.filter((button) =>
    button.characterName === characterName && button.skillType === skillType
  ) || [];
  const matchedButton = matchedButtons[0];
  if (matchedButtons.length > 1) {
    return {
      error: `${characterName} ${skillType} 有 ${matchedButtons.length} 个按钮，请指定更精确的节点或按钮。`,
      characterName,
      skillType,
    };
  }
  return {
    characterName,
    skillType,
    nodeIndex: matchedButton?.nodeIndex,
    beforeButtonId: matchedButton?.id,
    beforeButtonCount: snapshot?.skillButtons.length ?? 0,
  };
}

function parseLocalRemoveAddBackFlow(prompt: string, snapshot: MainWorkbenchSnapshot | null) {
  if (!shouldRunLocalRemoveAddBackFlow(prompt)) return null;
  return parseWorkbenchTarget(prompt, snapshot);
}

function parseLocalAddRemoveBuffFlow(prompt: string, snapshot: MainWorkbenchSnapshot | null) {
  if (!shouldRunLocalAddRemoveBuffFlow(prompt)) return null;
  return parseWorkbenchTarget(prompt, snapshot);
}

function buildGenericDamageBuff(characterName: string, skillType: SkillButtonType, uniqueKey = '') {
  const suffix = uniqueKey ? `-${uniqueKey}` : '';
  return {
    schemaVersion: 2 as const,
    id: uniqueKey ? `buff-ai-${characterName}-${skillType}-${uniqueKey}` : undefined,
    name: `ai-${characterName}-${skillType}-all-skill-dmg${suffix}`,
    displayName: `${characterName}${skillType} · 全技能伤害+20%${uniqueKey ? ` · ${uniqueKey}` : ''}`,
    sourceName: 'AI排轴兜底',
    level: 'auto',
    type: 'allSkillDmgBonus',
    value: 0.2,
    description: 'AI 复杂排轴兜底添加的通用伤害 Buff',
    source: 'ai-workbench-local-flow',
    condition: '手测通用伤害 Buff',
    category: 'passive' as const,
    refCount: 1,
    target: { mode: 'all' as const },
  };
}

function resolveWorkbenchOperatorName(value: string) {
  return resolveGameOperatorAlias(value)?.name || value;
}

function resolveWorkbenchGearSetId(value: string) {
  return resolveGameGearSetAlias(value)?.gearSetId || value;
}

function resolveWorkbenchWeaponName(value: string) {
  return resolveGameWeaponAlias(value)?.name || value;
}

async function readMainWorkbenchSnapshot(): Promise<MainWorkbenchSnapshot | null> {
  const localSnapshot = typeof window !== 'undefined' ? window.defMainWorkbench?.snapshot?.() : null;
  if (localSnapshot) {
    return localSnapshot;
  }
  try {
    const response = await fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/main-workbench/snapshot`, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json() as MainWorkbenchSnapshot | { snapshot?: MainWorkbenchSnapshot };
    if ('snapshot' in payload) return payload.snapshot || null;
    return payload as MainWorkbenchSnapshot;
  } catch {
    return null;
  }
}

async function readMainWorkbenchSnapshotUntil(
  predicate: (snapshot: MainWorkbenchSnapshot) => boolean,
  timeoutMs = 5000,
): Promise<MainWorkbenchSnapshot | null> {
  const startedAt = Date.now();
  let latest: MainWorkbenchSnapshot | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await readMainWorkbenchSnapshot();
    if (latest && predicate(latest)) return latest;
    await wait(400);
  }
  return latest;
}

function countSnapshotBuffs(snapshot: MainWorkbenchSnapshot) {
  return snapshot.skillButtons.reduce((total, button) => total + button.selectedBuffIds.length, 0);
}

async function readStableMainWorkbenchSnapshotUntil(
  predicate: (snapshot: MainWorkbenchSnapshot) => boolean,
  timeoutMs = 8000,
): Promise<MainWorkbenchSnapshot | null> {
  const startedAt = Date.now();
  let latest: MainWorkbenchSnapshot | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await readMainWorkbenchSnapshotUntil(predicate, 1200);
    if (!latest || !predicate(latest)) {
      await wait(400);
      continue;
    }
    await wait(800);
    const next = await readMainWorkbenchSnapshot();
    if (next && next.updatedAt >= latest.updatedAt && predicate(next)) return next;
  }
  return latest;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function hasActiveWorkbenchCommands(status: 'pending' | 'running') {
  try {
    const response = await fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/main-workbench/commands?status=${status}`, { cache: 'no-store' });
    if (!response.ok) return false;
    const payload = await response.json() as { commands?: unknown[] };
    return Array.isArray(payload.commands) && payload.commands.length > 0;
  } catch {
    return false;
  }
}

type WorkbenchCommandEvidence = {
  id?: string;
  source?: string;
  createdAt?: number;
  status?: string;
  error?: string;
  command?: MainWorkbenchCommand;
};

async function readWorkbenchCommandEvidence(since: number): Promise<WorkbenchCommandEvidence[]> {
  const localCommands = typeof window !== 'undefined'
    ? (window.defMainWorkbench?.commands?.() || [])
    : [];
  const localEvidence = localCommands.filter((command) => (
    typeof command.createdAt === 'number' &&
    command.createdAt >= since
  ));
  try {
    const response = await fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/main-workbench/commands`, { cache: 'no-store' });
    if (!response.ok) return localEvidence;
    const payload = await response.json() as { commands?: WorkbenchCommandEvidence[] };
    const remoteEvidence = (payload.commands || []).filter((command) => (
      typeof command.createdAt === 'number' &&
      command.createdAt >= since
    ));
    const seen = new Set<string>();
    return [...localEvidence, ...remoteEvidence].filter((command) => {
      const key = command.id || `${command.createdAt}-${command.command?.op || 'unknown'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return localEvidence;
  }
}

function isSubstantiveWorkbenchCommand(command: MainWorkbenchCommand | undefined) {
  if (!command) return false;
  return command.op !== 'saveTimelineSnapshot' && command.op !== 'refreshSnapshot';
}

function hasPromptRequiredCommand(prompt: string, evidence: WorkbenchCommandEvidence[]) {
  const commands = evidence.map((item) => item.command).filter(Boolean) as MainWorkbenchCommand[];
  if (!commands.some(isSubstantiveWorkbenchCommand)) return false;
  if (/撤|移除|删除|去掉|remove|delete|drop|undo/i.test(prompt)) {
    return commands.some((command) => command.op === 'removeSkillButton' || command.op === 'removeBuff' || command.op === 'restoreTimelineSnapshot');
  }
  if (/Buff|buff|增益|bonus/i.test(prompt) && /加|添加|add|attach|apply/i.test(prompt)) {
    return commands.some((command) => command.op === 'addBuff');
  }
  if (/按钮|技能|button|skill/i.test(prompt) && /加|添加|释放|放|add|cast|use|place|create/i.test(prompt)) {
    return commands.some((command) => command.op === 'addSkillButton');
  }
  if (/装备|武器|穿|配|gear|equipment|weapon|equip|wear|configure/i.test(prompt)) {
    return commands.some((command) => command.op === 'setOperatorWeapon' || command.op === 'setOperatorEquipment');
  }
  if (/计算|重算|伤害|calculate|recalculate|damage/i.test(prompt)) {
    return commands.some((command) => command.op === 'calculateDamage');
  }
  return true;
}

async function waitForWorkbenchCommandsToSettle(timeoutMs = 7000) {
  const startedAt = Date.now();
  await wait(500);
  while (Date.now() - startedAt < timeoutMs) {
    const [hasPending, hasRunning] = await Promise.all([
      hasActiveWorkbenchCommands('pending'),
      hasActiveWorkbenchCommands('running'),
    ]);
    if (!hasPending && !hasRunning) {
      await wait(400);
      return;
    }
    await wait(500);
  }
}

async function waitForLocalWorkbenchCommandIdsToSettle(commandIds: string[], timeoutMs = 12000) {
  if (!commandIds.length) return { settled: true, commands: [] as QueuedMainWorkbenchCommand[] };
  const pendingIds = new Set(commandIds);
  const settledCommands = new Map<string, QueuedMainWorkbenchCommand>();
  const startedAt = Date.now();
  await wait(500);
  while (Date.now() - startedAt < timeoutMs) {
    const commands = window.defMainWorkbench?.commands?.() || [];
    commands.forEach((entry) => {
      if (pendingIds.has(entry.id) && (entry.status === 'done' || entry.status === 'error')) {
        settledCommands.set(entry.id, entry);
        pendingIds.delete(entry.id);
      }
    });
    if (pendingIds.size === 0) {
      await wait(500);
      return { settled: true, commands: commandIds.map((id) => settledCommands.get(id)).filter(Boolean) as QueuedMainWorkbenchCommand[] };
    }
    await wait(450);
  }
  return { settled: false, commands: commandIds.map((id) => settledCommands.get(id)).filter(Boolean) as QueuedMainWorkbenchCommand[] };
}

function isReadOnlySnapshotPrompt(prompt: string) {
  const text = prompt.trim();
  if (!/(看一下|看看|当前|现在|目前|什么|哪些|多少|状态|穿的|穿了|装备|武器|按钮|伤害|current|now|status|summary|what|which|how many|gear|equipment|weapon|button|skill|damage|report)/i.test(text)) return false;
  return !isMutatingWorkbenchPrompt(text);
}

function formatEquipmentLine(config: NonNullable<MainWorkbenchSnapshot['operatorConfigs']>[number]) {
  const slotLabels: Record<string, string> = {
    armor: '护甲',
    glove: '护手',
    accessory1: '配件1',
    accessory2: '配件2',
  };
  const slotOrder = ['armor', 'glove', 'accessory1', 'accessory2'];
  const equipment = [...config.equipment]
    .sort((a, b) => slotOrder.indexOf(a.slotKey) - slotOrder.indexOf(b.slotKey))
    .map((item) => `${slotLabels[item.slotKey] || item.part || item.slotKey}: ${item.name}`)
    .join('；');
  const weapon = config.weapon
    ? `${config.weapon.name} Lv.${config.weapon.level} ${config.weapon.potential || ''}`.trim()
    : '未配置';
  return `${config.characterName} 当前武器：${weapon}；装备：${equipment || '未配置'}。`;
}

function buildSnapshotFallbackAnswer(prompt: string | undefined, snapshot: MainWorkbenchSnapshot | null) {
  if (!snapshot) return '';
  const promptText = prompt || '';
  const lines: string[] = [];

  if (/穿|装备|武器|当前|现在|实际|看一下|确认|核对/.test(promptText)) {
    const configs = snapshot.operatorConfigs || [];
    const mentioned = configs.filter((config) => promptText.includes(config.characterName));
    const targets = mentioned.length > 0 ? mentioned : configs.slice(0, Math.min(configs.length, 2));
    targets.forEach((config) => lines.push(formatEquipmentLine(config)));
  }

  if (/按钮|技能/.test(promptText)) {
    if (snapshot.skillButtons.length) {
      const buttons = snapshot.skillButtons
        .map((button) => `${button.characterName}-${button.skillDisplayName || button.skillType}@${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`)
        .join('；');
      lines.push(`当前技能按钮：${buttons}。`);
    } else {
      lines.push('当前没有技能按钮。');
    }
  }

  if (/伤害|damage/i.test(promptText) && snapshot.damageReport) {
    lines.push(`当前总期望伤害：${snapshot.damageReport.totalExpected}，按钮数：${snapshot.damageReport.buttonCount}。`);
  }

  if (!lines.length) {
    const selected = snapshot.selectedCharacters.map((character) => character.name).join('、') || '无';
    lines.push(`已核对快照。当前已选干员：${selected}。`);
  }

  return lines.join('\n');
}

function SpinnerIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon main-workbench-ai-spinner" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function RollbackIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7 4 12l5 5" />
      <path d="M5 12h8.4c3.1 0 5.6 2.2 5.6 5.1V18" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4 20 12 4 20l2.8-8L4 4z" />
      <path d="M7 12h6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8h8v8H8z" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function MainWorkbenchAiPanel({
  selectedCharacters,
  skillButtons,
  onExit,
}: MainWorkbenchAiPanelProps) {
  const selectedSignature = useMemo(() => buildSelectedSignature(selectedCharacters), [selectedCharacters]);
  const storedSession = useMemo(() => {
    const stored = readStoredDefAgentSession();
    if (!stored?.sessionId) return null;
    return stored.selectedSignature === selectedSignature ? stored : null;
  }, [selectedSignature]);
  const [messages, setMessages] = useState<WorkbenchAiMessage[]>(() => buildInitialMessages());
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(storedSession?.sessionId ? '恢复中' : '待命');
  const [steps, setSteps] = useState<WorkbenchAiStep[]>(() => buildInitialSteps());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(storedSession?.sessionId || null);
  const [tokens, setTokens] = useState<DefAgentTokens | null>(storedSession?.tokens || null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastRollbackLabel, setLastRollbackLabel] = useState('');
  const [thinkingDetails, setThinkingDetails] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);
  const activePromptRef = useRef('');
  const activePromptStartedAtRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(storedSession?.sessionId || null);
  const lastSeqRef = useRef(storedSession?.lastSeq || 0);
  const turnTimeoutRef = useRef<number | null>(null);
  const finishFallbackTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);

  const rememberSession = (sessionId: string | null, nextTokens?: DefAgentTokens | null, seq?: number) => {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    if (nextTokens) setTokens(nextTokens);
    writeStoredDefAgentSession(sessionId ? {
      sessionId,
      skillId: WORKBENCH_AGENT_SKILL_ID,
      selectedSignature,
      lastSeq: seq || lastSeqRef.current || undefined,
      tokens: nextTokens || tokens || undefined,
    } : null);
  };

  const patchStep = (stepId: WorkbenchAiStepId, patch: Partial<WorkbenchAiStep>) => {
    setSteps((current) => current.map((step) => (
      step.id === stepId ? { ...step, ...patch } : step
    )));
  };

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const stored = readStoredDefAgentSession();
    if (!stored?.sessionId) return undefined;
    if (stored.selectedSignature !== selectedSignature) {
      rememberSession(null);
      setMessages(buildInitialMessages());
      setStatus('新对话');
      return undefined;
    }
    void hydrateDefAgentSession(stored.sessionId)
      .then((transcript) => {
        if (cancelled) return;
        setMessages(transcriptToMessages(transcript.messages || []));
        const sessionId = transcript.session?.id || transcript.session?.sessionID || stored.sessionId;
        lastSeqRef.current = transcript.session?.lastSeq || stored.lastSeq || 0;
        rememberSession(sessionId, transcript.session?.tokens || stored.tokens || null, lastSeqRef.current);
        setStatus('已连接');
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NotFoundError') || message.includes('session-not-found')) {
          rememberSession(null);
          setTokens(null);
          setMessages(buildInitialMessages());
          setStatus('新对话');
          return;
        }
        setStatus(message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSignature]);

  useEffect(() => () => {
    eventSourceRef.current?.close();
    if (turnTimeoutRef.current) window.clearTimeout(turnTimeoutRef.current);
    if (finishFallbackTimeoutRef.current) window.clearTimeout(finishFallbackTimeoutRef.current);
  }, []);

  const finishMessage = (messageId: string, nextStatus: WorkbenchAiMessage['status'], fallbackText?: string, nextTokens?: DefAgentTokens) => {
    if (turnTimeoutRef.current) {
      window.clearTimeout(turnTimeoutRef.current);
      turnTimeoutRef.current = null;
    }
    if (finishFallbackTimeoutRef.current) {
      window.clearTimeout(finishFallbackTimeoutRef.current);
      finishFallbackTimeoutRef.current = null;
    }
    setIsBusy(false);
    activeMessageIdRef.current = null;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (nextTokens) {
      rememberSession(activeSessionIdRef.current, nextTokens);
    }
    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? {
          ...message,
          status: nextStatus,
          text: message.text || fallbackText || '',
        }
        : message
    )));
  };

  const finishMessageWithSnapshotFallback = (messageId: string, fallbackText: string, prompt: string, nextTokens?: DefAgentTokens) => {
    finishMessage(messageId, 'done', fallbackText, nextTokens);
    if (!shouldUseSnapshotFallback(prompt, fallbackText)) return;
    setStatus('核对快照中');
    void waitForWorkbenchCommandsToSettle().then(async () => {
      const evidence = isMutatingWorkbenchPrompt(prompt)
        ? await readWorkbenchCommandEvidence(activePromptStartedAtRef.current)
        : [];
      const failedCommand = evidence.find((command) => command.status === 'error');
      if (failedCommand) {
        return {
          snapshot: null,
          text: `本轮命令执行失败：${failedCommand.error || failedCommand.id || '未知错误'}。`,
          status: 'error' as WorkbenchAiMessage['status'],
        };
      }
      if (isMutatingWorkbenchPrompt(prompt) && !hasPromptRequiredCommand(prompt, evidence)) {
        return {
          snapshot: null,
          text: '本轮没有检测到符合请求的实际主界面命令，当前状态未按请求改动。请重试或拆成更小的一步。',
          status: 'error' as WorkbenchAiMessage['status'],
        };
      }
      return {
        snapshot: await readMainWorkbenchSnapshot(),
        text: '',
        status: 'done' as WorkbenchAiMessage['status'],
      };
    }).then(({ snapshot, text, status: nextStatus }) => {
      if (text) {
        setMessages((current) => current.map((message) => (
          message.id === messageId ? { ...message, text, status: nextStatus } : message
        )));
        setStatus(nextStatus === 'error' ? '执行未确认' : '已核对快照');
        return;
      }
      const answer = buildSnapshotFallbackAnswer(prompt, snapshot);
      if (!answer) return;
      setMessages((current) => current.map((message) => (
        message.id === messageId ? { ...message, text: answer, status: 'done' } : message
      )));
      setStatus('已核对快照');
    });
  };

  const runLocalComplexWorkbenchFlow = async (messageId: string, rollbackLabel: string) => {
    const finalCharacterNames = ['Admin', 'Chenqianyu', 'Laiwanting', 'Wolf Guard'].map(resolveWorkbenchOperatorName);
    const fallbackWeaponName = resolveWorkbenchWeaponName('宏愿');
    const fallbackGearSetId = resolveWorkbenchGearSetId('潮涌');
    const remainingButtonPairs: Array<{ characterName: string; skillType: 'A' | 'B'; nodeIndex: number }> = [
      { characterName: '管理员', skillType: 'A', nodeIndex: 0 },
      { characterName: '管理员', skillType: 'B', nodeIndex: 1 },
      { characterName: '陈千语', skillType: 'A', nodeIndex: 0 },
      { characterName: '陈千语', skillType: 'B', nodeIndex: 1 },
      { characterName: '莱万汀', skillType: 'A', nodeIndex: 0 },
      { characterName: '莱万汀', skillType: 'B', nodeIndex: 1 },
      { characterName: '狼卫', skillType: 'A', nodeIndex: 0 },
    ];

    const enqueueStage = async (commands: MainWorkbenchCommand[], detail: string) => {
      const entries = commands
        .map((command) => enqueueLocalWorkbenchCommand(command, 'main-workbench-ai-local-flow'))
        .filter((entry): entry is NonNullable<ReturnType<typeof enqueueLocalWorkbenchCommand>> => Boolean(entry));
      patchStep('operate', { status: 'running', detail });
      const settled = await waitForLocalWorkbenchCommandIdsToSettle(entries.map((entry) => entry.id), 16000);
      if (!settled.settled) {
        throw new Error(`命令执行超时：${detail}`);
      }
    };

    setStatus('执行本地复杂流程');
    patchStep('backup', { status: 'running', detail: '保存 AI 回退点' });
    await enqueueStage([{ op: 'saveTimelineSnapshot', label: rollbackLabel }], '保存回退点');
    patchStep('backup', { status: 'done', detail: rollbackLabel });

    await enqueueStage([
      { op: 'selectCharacters', characterNames: finalCharacterNames, openCanvas: true, resetTimeline: true },
    ], '扩展到四人队伍');

    await enqueueStage([
      { op: 'setOperatorWeapon', characterName: resolveWorkbenchOperatorName('Laiwanting'), weaponName: fallbackWeaponName, level: 90, potential: 'P0' },
      { op: 'setOperatorEquipment', characterName: resolveWorkbenchOperatorName('Laiwanting'), gearSetId: fallbackGearSetId, fillSlots: true, entryLevel: 3 },
      { op: 'setOperatorWeapon', characterName: resolveWorkbenchOperatorName('Wolf Guard'), weaponName: fallbackWeaponName, level: 90, potential: 'P0' },
      { op: 'setOperatorEquipment', characterName: resolveWorkbenchOperatorName('Wolf Guard'), gearSetId: fallbackGearSetId, fillSlots: true, entryLevel: 3 },
      { op: 'refreshOperatorConfig' },
    ], '配置新增干员武器装备');

    await enqueueStage([
      ...finalCharacterNames.flatMap((characterName) => ([
        { op: 'addSkillButton' as const, characterName, skillType: 'A' as const, nodeIndex: 0 },
        { op: 'addSkillButton' as const, characterName, skillType: 'B' as const, nodeIndex: 1 },
      ])),
      { op: 'removeSkillButton', latest: true },
    ], '添加技能按钮并撤掉最后一个');

    await enqueueStage([
      ...remainingButtonPairs.map(({ characterName, skillType, nodeIndex }) => ({
        op: 'addBuff' as const,
        characterName,
        skillType,
        nodeIndex,
        buff: buildGenericDamageBuff(characterName, skillType),
      })),
      { op: 'calculateDamage' },
      { op: 'refreshSnapshot' },
    ], '添加通用伤害 Buff 并重算');

    const evidence = await readWorkbenchCommandEvidence(activePromptStartedAtRef.current);
    const failedCommand = evidence.find((command) => command.status === 'error');
    if (failedCommand) {
      finishMessage(messageId, 'error', `本地复杂流程有命令失败：${failedCommand.error || failedCommand.id || '未知错误'}。`);
      setStatus('本地流程失败');
      patchStep('operate', { status: 'error', detail: failedCommand.error || '命令失败' });
      return;
    }

    const snapshot = await readStableMainWorkbenchSnapshotUntil((current) => {
      const buttonCount = current.skillButtons.length;
      const buffCount = countSnapshotBuffs(current);
      return buttonCount === 7 && buffCount >= 7 && current.damageReport?.buttonCount === buttonCount;
    });
    if (!snapshot || snapshot.skillButtons.length !== 7 || countSnapshotBuffs(snapshot) < 7 || snapshot.damageReport?.buttonCount !== 7) {
      finishMessage(messageId, 'error', '本地复杂流程执行后快照未稳定到预期状态：需要 7 个按钮、至少 7 个 Buff，并且伤害报告按钮数为 7。');
      setStatus('本地流程未通过核对');
      patchStep('verify', { status: 'error', detail: '快照未稳定到预期状态' });
      return;
    }
    const selected = snapshot?.selectedCharacters.map((character) => character.name).join('、') || '无';
    const buttonCount = snapshot?.skillButtons.length ?? 0;
    const buffCount = countSnapshotBuffs(snapshot);
    const equipmentLines = (snapshot?.operatorConfigs || [])
      .map((config) => `${config.characterName}: ${config.weapon?.name || '未配置武器'}；${config.equipment.map((item) => item.name).join('、') || '未配置装备'}`)
      .join('\n');
    finishMessage(messageId, 'done', `已完成本地复杂流程。\n当前干员：${selected}。\n按钮数：${buttonCount}，Buff 数：${buffCount}。\n装备情况：\n${equipmentLines}`);
    setStatus('已完成本地复杂流程');
    patchStep('operate', { status: 'done', detail: '本地复杂流程完成' });
    patchStep('verify', { status: 'done', detail: '快照已核对' });
  };

  const runLocalRemoveAddBackFlow = async (messageId: string) => {
    setStatus('读取快照');
    patchStep('backup', { status: 'done', detail: '小型 CRUD 不保存回退点' });
    patchStep('rest', { status: 'running', detail: '读取主界面快照' });
    const beforeSnapshot = await readMainWorkbenchSnapshot();
    patchStep('rest', { status: beforeSnapshot ? 'done' : 'error', detail: beforeSnapshot ? '快照已读取' : '快照读取失败' });
    const target = parseLocalRemoveAddBackFlow(activePromptRef.current, beforeSnapshot);
    if (!target || !beforeSnapshot) {
      finishMessage(messageId, 'error', '无法从请求中定位要移除再加回的干员和技能。');
      setStatus('本地 CRUD 未定位目标');
      patchStep('operate', { status: 'error', detail: '未定位目标' });
      return;
    }
    if ('error' in target) {
      finishMessage(messageId, 'error', target.error);
      setStatus('本地 CRUD 目标不唯一');
      patchStep('operate', { status: 'error', detail: '目标不唯一' });
      return;
    }

    const enqueueStage = async (commands: MainWorkbenchCommand[], detail: string) => {
      const entries = commands
        .map((command) => enqueueLocalWorkbenchCommand(command, 'main-workbench-ai-local-crud'))
        .filter((entry): entry is NonNullable<ReturnType<typeof enqueueLocalWorkbenchCommand>> => Boolean(entry));
      patchStep('operate', { status: 'running', detail });
      const settled = await waitForLocalWorkbenchCommandIdsToSettle(entries.map((entry) => entry.id), 12000);
      if (!settled.settled) {
        throw new Error(`命令执行超时：${detail}`);
      }
      const failed = settled.commands.find((entry) => entry.status === 'error');
      if (failed) {
        throw new Error(`命令执行失败：${failed.error || failed.command.op}`);
      }
    };

    await enqueueStage([
      {
        op: 'removeSkillButton',
        characterName: target.characterName,
        skillType: target.skillType,
        nodeIndex: target.nodeIndex,
      },
    ], `移除 ${target.characterName} ${target.skillType}`);

    await enqueueStage([
      {
        op: 'addSkillButton',
        characterName: target.characterName,
        skillType: target.skillType,
        nodeIndex: target.nodeIndex,
      },
    ], `加回 ${target.characterName} ${target.skillType}`);

    const snapshot = await readStableMainWorkbenchSnapshotUntil((current) => {
      const hasTargetButton = current.skillButtons.some((button) =>
        button.characterName === target.characterName && button.skillType === target.skillType && button.id !== target.beforeButtonId
      );
      return current.skillButtons.length === target.beforeButtonCount &&
        current.damageReport?.buttonCount === current.skillButtons.length &&
        hasTargetButton;
    }, 10000);
    if (!snapshot) {
      finishMessage(messageId, 'error', '小型 CRUD 执行后未读到稳定快照。');
      setStatus('本地 CRUD 未通过核对');
      patchStep('verify', { status: 'error', detail: '快照未稳定' });
      return;
    }
    const totalExpected = snapshot.damageReport?.totalExpected ?? 0;
    const buttonCount = snapshot.skillButtons.length;
    finishMessage(messageId, 'done', `已完成。${target.characterName} ${target.skillType} 按钮已移除后再加回，伤害已重算。\n当前总期望伤害：${totalExpected}，按钮数：${buttonCount}。`);
    setStatus('已完成本地 CRUD');
    patchStep('operate', { status: 'done', detail: '小型 CRUD 完成' });
    patchStep('verify', { status: 'done', detail: '快照已核对' });
  };

  const runLocalAddRemoveBuffFlow = async (messageId: string) => {
    setStatus('读取快照');
    patchStep('backup', { status: 'done', detail: 'Buff CRUD 不保存回退点' });
    patchStep('rest', { status: 'running', detail: '读取主界面快照' });
    const beforeSnapshot = await readMainWorkbenchSnapshot();
    patchStep('rest', { status: beforeSnapshot ? 'done' : 'error', detail: beforeSnapshot ? '快照已读取' : '快照读取失败' });
    const target = parseLocalAddRemoveBuffFlow(activePromptRef.current, beforeSnapshot);
    if (!target || !beforeSnapshot) {
      finishMessage(messageId, 'error', '无法从请求中定位要增删 Buff 的干员和技能。');
      setStatus('Buff CRUD 未定位目标');
      patchStep('operate', { status: 'error', detail: '未定位目标' });
      return;
    }
    if ('error' in target) {
      finishMessage(messageId, 'error', target.error);
      setStatus('Buff CRUD 目标不唯一');
      patchStep('operate', { status: 'error', detail: '目标不唯一' });
      return;
    }
    const beforeTargetButton = beforeSnapshot.skillButtons.find((button) => button.id === target.beforeButtonId);
    if (!beforeTargetButton) {
      finishMessage(messageId, 'error', '无法读取目标按钮的 Buff 状态。');
      setStatus('Buff CRUD 未定位目标按钮');
      patchStep('operate', { status: 'error', detail: '未定位目标按钮' });
      return;
    }
    const beforeBuffIds = new Set(beforeTargetButton.selectedBuffIds);
    const buffUniqueKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const enqueueStage = async (commands: MainWorkbenchCommand[], detail: string) => {
      const entries = commands
        .map((command) => enqueueLocalWorkbenchCommand(command, 'main-workbench-ai-local-buff-crud'))
        .filter((entry): entry is NonNullable<ReturnType<typeof enqueueLocalWorkbenchCommand>> => Boolean(entry));
      patchStep('operate', { status: 'running', detail });
      const settled = await waitForLocalWorkbenchCommandIdsToSettle(entries.map((entry) => entry.id), 12000);
      if (!settled.settled) {
        throw new Error(`命令执行超时：${detail}`);
      }
      const failed = settled.commands.find((entry) => entry.status === 'error');
      if (failed) {
        throw new Error(`命令执行失败：${failed.error || failed.command.op}`);
      }
    };

    await enqueueStage([
      {
        op: 'addBuff',
        characterName: target.characterName,
        skillType: target.skillType,
        nodeIndex: target.nodeIndex,
        buff: buildGenericDamageBuff(target.characterName, target.skillType, buffUniqueKey),
      },
    ], `添加 ${target.characterName} ${target.skillType} Buff`);

    const afterAddSnapshot = await readStableMainWorkbenchSnapshotUntil((current) => {
      const button = current.skillButtons.find((item) => item.id === target.beforeButtonId) ||
        current.skillButtons.find((item) =>
          item.characterName === target.characterName &&
          item.skillType === target.skillType &&
          item.nodeIndex === target.nodeIndex
        );
      return Boolean(button && button.selectedBuffIds.some((id) => !beforeBuffIds.has(id)));
    }, 10000);
    const afterAddButton = afterAddSnapshot?.skillButtons.find((item) => item.id === target.beforeButtonId) ||
      afterAddSnapshot?.skillButtons.find((item) =>
        item.characterName === target.characterName &&
        item.skillType === target.skillType &&
        item.nodeIndex === target.nodeIndex
      );
    const addedBuffIds = (afterAddButton?.selectedBuffIds || []).filter((id) => !beforeBuffIds.has(id));
    const addedBuffId = addedBuffIds[0];
    if (!addedBuffId) {
      finishMessage(messageId, 'error', 'Buff 添加后未在目标按钮上读到新增 Buff。');
      setStatus('Buff CRUD 未通过添加核对');
      patchStep('verify', { status: 'error', detail: '未读到新增 Buff' });
      return;
    }

    await enqueueStage([
      {
        op: 'removeBuff',
        characterName: target.characterName,
        skillType: target.skillType,
        nodeIndex: target.nodeIndex,
        buffId: addedBuffId,
      },
    ], `移除 ${target.characterName} ${target.skillType} Buff`);

    const snapshot = await readStableMainWorkbenchSnapshotUntil((current) => (
      current.skillButtons.length === beforeSnapshot.skillButtons.length &&
      current.damageReport?.buttonCount === current.skillButtons.length &&
      current.skillButtons.some((button) =>
        button.characterName === target.characterName &&
        button.skillType === target.skillType &&
        button.selectedBuffIds.length === beforeTargetButton.selectedBuffIds.length &&
        button.selectedBuffIds.every((id) => beforeBuffIds.has(id))
      )
    ), 10000);
    if (!snapshot) {
      finishMessage(messageId, 'error', 'Buff CRUD 执行后未读到稳定快照。');
      setStatus('Buff CRUD 未通过核对');
      patchStep('verify', { status: 'error', detail: '快照未稳定' });
      return;
    }
    finishMessage(messageId, 'done', `已完成。${target.characterName} ${target.skillType} 的 20% 全技能伤害 Buff 已添加后移除，伤害已重算。\n当前总期望伤害：${snapshot.damageReport?.totalExpected ?? 0}，按钮数：${snapshot.skillButtons.length}。`);
    setStatus('已完成 Buff CRUD');
    patchStep('operate', { status: 'done', detail: 'Buff CRUD 完成' });
    patchStep('verify', { status: 'done', detail: '快照已核对' });
  };

  const handleStreamEvent = (event: MessageEvent, messageId: string) => {
    if (typeof event.data !== 'string') return;
    let payload: DefAgentStreamEvent;
    try {
      payload = JSON.parse(event.data) as DefAgentStreamEvent;
    } catch {
      setStatus('流事件解析失败');
      return;
    }

    const turnId = payload.turnId || payload.clientTurnId;
    const eventSessionId = payload.sessionId || payload.sessionID || null;
    if (eventSessionId && eventSessionId !== activeSessionIdRef.current) {
      lastSeqRef.current = 0;
    }
    reconnectAttemptsRef.current = 0;
    const seq = Number(payload.seq || event.lastEventId || 0);
    if (seq && seq <= lastSeqRef.current) return;
    if (seq) lastSeqRef.current = seq;
    if (turnId && turnId !== messageId) return;

    if (eventSessionId) {
      rememberSession(eventSessionId, payload.tokens || null, seq || undefined);
    }

    if (payload.type === 'text') {
      setStatus('响应中');
      patchStep('agent', { status: 'running', detail: '正在生成回复' });
      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? { ...message, text: `${message.text}${payload.text || ''}`, status: 'running' }
          : message
      )));
      return;
    }

    if (payload.type === 'reasoning') {
      const detail = payload.summary || payload.title || (payload.status === 'done' ? '思考完成' : '正在分析上下文');
      setStatus(detail);
      setThinkingDetails((current) => [...current, detail].slice(-6));
      patchStep('agent', { status: payload.status === 'done' ? 'done' : 'running', detail });
      return;
    }

    if (payload.type === 'tool.start' || payload.type === 'tool.content') {
      setStatus(payload.summary || payload.title || '执行中');
      setThinkingDetails((current) => [
        ...current,
        `${payload.type === 'tool.start' ? '开始' : '返回'}：${payload.summary || payload.title || '调用 DEF REST'}`,
      ].slice(-6));
      patchStep('operate', {
        status: payload.type === 'tool.content' ? 'done' : 'running',
        detail: payload.summary || payload.title || '调用 DEF REST',
      });
      return;
    }

    if (payload.type === 'tool.error') {
      setStatus(payload.error || '工具异常');
      patchStep('operate', { status: 'error', detail: payload.error || '工具异常' });
      return;
    }

    if (payload.type === 'step.finish') {
      setStatus('已返回结果');
      patchStep('agent', { status: 'done', detail: '回复完成' });
      patchStep('verify', { status: 'done', detail: '结果已返回' });
      if (finishFallbackTimeoutRef.current) window.clearTimeout(finishFallbackTimeoutRef.current);
      finishFallbackTimeoutRef.current = window.setTimeout(() => {
        if (activeMessageIdRef.current !== messageId) return;
        finishMessageWithSnapshotFallback(messageId, '已完成', activePromptRef.current, payload.tokens);
      }, 900);
      return;
    }

    if (payload.type === 'done') {
      setStatus('已完成');
      patchStep('agent', { status: 'done', detail: '回复完成' });
      patchStep('verify', { status: 'done', detail: '结果已返回' });
      finishMessageWithSnapshotFallback(messageId, payload.content || payload.text || '已完成', activePromptRef.current, payload.tokens);
      return;
    }

    if (payload.type === 'stopped') {
      setStatus('已停止');
      setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'stopped' } : step));
      finishMessage(messageId, 'stopped', '已停止', payload.tokens);
      return;
    }

    if (payload.type === 'error') {
      setStatus(payload.error || '异常');
      setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: payload.error || '异常' } : step));
      finishMessage(messageId, 'error', payload.error || '异常', payload.tokens);
    }
  };

  const bindEventSource = (eventSource: EventSource, messageId: string) => {
    [
      'session.created',
      'message.start',
      'step.start',
      'reasoning',
      'tool.start',
      'tool.content',
      'tool.error',
      'text',
      'step.finish',
      'stopped',
      'done',
      'error',
    ].forEach((eventName) => {
      eventSource.addEventListener(eventName, (event) => handleStreamEvent(event as MessageEvent, messageId));
    });
    eventSource.onerror = () => {
      if (activeMessageIdRef.current !== messageId) return;
      const sessionId = activeSessionIdRef.current;
      if (sessionId && reconnectAttemptsRef.current < WORKBENCH_AGENT_STREAM_RECONNECT_LIMIT) {
        reconnectAttemptsRef.current += 1;
        setStatus(`流连接重连中 ${reconnectAttemptsRef.current}/${WORKBENCH_AGENT_STREAM_RECONNECT_LIMIT}`);
        window.setTimeout(() => {
          if (activeMessageIdRef.current !== messageId) return;
          eventSourceRef.current?.close();
          const nextEventSource = subscribeDefAgentSession(sessionId, lastSeqRef.current);
          eventSourceRef.current = nextEventSource;
          bindEventSource(nextEventSource, messageId);
        }, 1200);
        return;
      }
      setStatus('流连接中断');
      if (eventSource.readyState === EventSource.CLOSED || !sessionId) {
        setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: '流连接已关闭' } : step));
        finishMessage(messageId, 'error', '后台连接已中断');
      }
    };
  };

  const handleStop = () => {
    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      void stopDefAgentStream(sessionId).catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
    }
    const messageId = activeMessageIdRef.current;
    if (messageId) finishMessage(messageId, 'stopped', '已停止');
  };

  const sendWorkbenchPrompt = async (userText: string, options: { retry?: boolean } = {}) => {
    if (isBusy) {
      handleStop();
      return;
    }
    if (!userText) return;
    const messageId = `workbench-ai-${Date.now()}`;
    const rollbackLabel = `AI 回退点 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    const shouldCreateRollback = isMutatingWorkbenchPrompt(userText) &&
      !shouldRunLocalRemoveAddBackFlow(userText) &&
      !shouldRunLocalAddRemoveBuffFlow(userText);
    setInput('');
    setIsBusy(true);
    setLastPrompt(userText);
    setLastRollbackLabel(shouldCreateRollback ? rollbackLabel : '');
    setSteps(buildInitialSteps());
    setStatus('发送中');
    setThinkingDetails([]);
    activeMessageIdRef.current = messageId;
    activePromptRef.current = userText;
    activePromptStartedAtRef.current = Date.now();
    reconnectAttemptsRef.current = 0;
    setMessages((current) => [
      ...current,
      { id: `${messageId}-user`, role: 'user', text: options.retry ? `重试：${userText}` : userText, status: 'done', prompt: userText },
      { id: messageId, role: 'agent', text: '', status: 'running', prompt: userText, rollbackLabel: shouldCreateRollback ? rollbackLabel : undefined },
    ]);

    if (shouldRunLocalComplexWorkbenchFlow(userText)) {
      try {
        await runLocalComplexWorkbenchFlow(messageId, rollbackLabel);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setStatus(text);
        setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: text } : step));
        finishMessage(messageId, 'error', text);
      }
      return;
    }

    if (shouldRunLocalAddRemoveBuffFlow(userText)) {
      try {
        await runLocalAddRemoveBuffFlow(messageId);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setStatus(text);
        setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: text } : step));
        finishMessage(messageId, 'error', text);
      }
      return;
    }

    if (shouldRunLocalRemoveAddBackFlow(userText)) {
      try {
        await runLocalRemoveAddBackFlow(messageId);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setStatus(text);
        setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: text } : step));
        finishMessage(messageId, 'error', text);
      }
      return;
    }

    if (isReadOnlySnapshotPrompt(userText)) {
      try {
        setStatus('读取快照');
        patchStep('rest', { status: 'running', detail: '读取主界面快照' });
        await ensureMainWorkbenchRest();
        const snapshot = await readMainWorkbenchSnapshot();
        const answer = buildSnapshotFallbackAnswer(userText, snapshot) || '快照读取失败。';
        patchStep('rest', { status: snapshot ? 'done' : 'error', detail: snapshot ? '快照已读取' : '快照读取失败' });
        patchStep('verify', { status: snapshot ? 'done' : 'error', detail: '只读查询' });
        finishMessage(messageId, snapshot ? 'done' : 'error', answer);
        setStatus(snapshot ? '已核对快照' : '快照读取失败');
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        patchStep('rest', { status: 'error', detail: text });
        finishMessage(messageId, 'error', text);
        setStatus(text);
      }
      return;
    }

    const agentText = buildWorkbenchAgentMessage(userText, selectedCharacters, skillButtons);
    if (turnTimeoutRef.current) {
      window.clearTimeout(turnTimeoutRef.current);
    }
    turnTimeoutRef.current = window.setTimeout(() => {
      if (activeMessageIdRef.current !== messageId) return;
      const sessionId = activeSessionIdRef.current;
      if (sessionId) {
        void stopDefAgentStream(sessionId).catch(() => {
          // UI timeout already marks this turn as failed.
        });
      }
      setStatus('后台响应超时');
      setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: '超过 180 秒未完成' } : step));
      finishMessage(messageId, 'error', '后台超过 180 秒未完成，已停止本轮。');
    }, WORKBENCH_AGENT_TURN_TIMEOUT_MS);
    try {
      if (isMutatingWorkbenchPrompt(userText)) {
        patchStep('backup', { status: 'running', detail: '保存 AI 回退点' });
        const backupEntry = enqueueLocalWorkbenchCommand({ op: 'saveTimelineSnapshot', label: rollbackLabel });
        patchStep('backup', {
          status: backupEntry ? 'done' : 'error',
          detail: backupEntry ? rollbackLabel : '页面控制入口不可用',
        });
      } else {
        patchStep('backup', { status: 'done', detail: '只读请求' });
      }
      setStatus('启动 REST');
      patchStep('rest', { status: 'running', detail: '启动 17321' });
      await ensureMainWorkbenchRest();
      patchStep('rest', { status: 'done', detail: 'REST 已就绪' });
      patchStep('agent', { status: 'running', detail: 'def-opencode 正在思考' });
      eventSourceRef.current?.close();
      rememberSession(null);
      lastSeqRef.current = 0;
      const stream = await startDefAgentStream(agentText, {
        thinkingEffort: chooseWorkbenchThinkingEffort(userText),
        skillId: WORKBENCH_AGENT_SKILL_ID,
        clientTurnId: messageId,
      });
      lastSeqRef.current = 0;
      rememberSession(stream.sessionId);
      eventSourceRef.current?.close();
      eventSourceRef.current = stream.eventSource;
      bindEventSource(stream.eventSource, messageId);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setStatus(text);
      setSteps((current) => current.map((step) => step.status === 'running' ? { ...step, status: 'error', detail: text } : step));
      finishMessage(messageId, 'error', text);
    }
  };

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    await sendWorkbenchPrompt(input.trim());
  };

  const handleRetry = (prompt = lastPrompt) => {
    if (!prompt || isBusy) return;
    void sendWorkbenchPrompt(prompt, { retry: true });
  };

  const handleRollback = (rollbackLabel = lastRollbackLabel) => {
    if (isBusy) return;
    const command: MainWorkbenchCommand = rollbackLabel
      ? { op: 'restoreTimelineSnapshot', label: rollbackLabel, reload: true }
      : { op: 'restoreTimelineSnapshot', latest: true, reload: true };
    const entry = enqueueLocalWorkbenchCommand(command);
    setStatus(entry ? '已请求回退' : '回退失败：页面控制入口不可用');
    setSteps((current) => current.map((step) => (
      step.id === 'operate'
        ? { ...step, status: entry ? 'running' : 'error', detail: entry ? '恢复排轴快照' : '控制入口不可用' }
        : step
    )));
  };

  const handleNewChat = () => {
    if (isBusy) handleStop();
    rememberSession(null);
    lastSeqRef.current = 0;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setTokens(null);
    setMessages(buildInitialMessages());
    setSteps(buildInitialSteps());
    setLastPrompt('');
    setLastRollbackLabel('');
    activePromptRef.current = '';
    activePromptStartedAtRef.current = 0;
    setStatus('新对话');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void handleSubmit();
  };

  const activeStep = steps.find((step) => step.status === 'running')
    ?? [...steps].reverse().find((step) => step.status === 'error' || step.status === 'stopped')
    ?? [...steps].reverse().find((step) => step.status === 'done');
  const statusText = activeStep
    ? `${status} · ${activeStep.label}: ${activeStep.detail}`
    : status;

  return (
    <div className="main-workbench-ai-panel">
      <div
        className="sandbox-characters-extra-spacer main-workbench-ai-topbar"
        role="button"
        tabIndex={0}
        aria-label="退出 AI 模式"
        onMouseDown={(event) => {
          event.preventDefault();
          onExit();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          onExit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onExit();
          }
        }}
      >
        <button
          type="button"
          className="sandbox-reserved-action sandbox-reserved-action--ai is-active"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onExit();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onExit();
          }}
          aria-label="AI 模式"
          aria-pressed="true"
          title="AI 模式"
        >
          <span className="sandbox-reserved-action-text">AI</span>
        </button>
        <div className="main-workbench-ai-session">
          <strong>DEF OpenCode</strong>
          <span>{formatSessionId(activeSessionId)} · {formatTokens(tokens)}</span>
        </div>
      </div>

      <div className="main-workbench-ai-messages" ref={messagesRef}>
        {messages.map((message) => (
          <div key={message.id} className={`main-workbench-ai-message is-${message.role} ${message.status ? `is-${message.status}` : ''}`}>
            <span>{message.role === 'user' ? '你' : message.role === 'agent' ? '后台' : '系统'}</span>
            <p>{message.text || (message.status === 'running' ? '正在处理' : '')}</p>
            {message.role !== 'system' && (
              <div className="main-workbench-ai-message-actions">
                {message.status === 'running' && (
                  <span className="main-workbench-ai-thinking" tabIndex={0}>
                    <SpinnerIcon />
                    正在思考
                    <span className="main-workbench-ai-thinking-popover">
                      {(thinkingDetails.length ? thinkingDetails : steps.map((step) => `${step.label}: ${step.detail}`)).map((detail, index) => (
                        <span key={`${detail}-${index}`}>{detail}</span>
                      ))}
                    </span>
                  </span>
                )}
                <div className="main-workbench-ai-message-action-buttons">
                  {message.role === 'agent' && message.rollbackLabel && (
                    <button
                      type="button"
                      className="main-workbench-ai-icon-button"
                      onClick={() => handleRollback(message.rollbackLabel)}
                      disabled={isBusy}
                      aria-label="回退到这条消息前"
                      title="回退到这条消息前"
                    >
                      <RollbackIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    className="main-workbench-ai-icon-button"
                    onClick={() => handleRetry(message.prompt)}
                    disabled={isBusy || !message.prompt}
                    aria-label="重试这条消息"
                    title="重试这条消息"
                  >
                    <RetryIcon />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="main-workbench-ai-composer" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入排轴操作"
          rows={3}
        />
        <button type="submit" aria-label={isBusy ? '停止' : '发送'} title={isBusy ? '停止' : '发送'}>
          {isBusy ? <StopIcon /> : <SendIcon />}
        </button>
      </form>

      <div className="main-workbench-ai-status">
        <span>{statusText}</span>
        <button type="button" onClick={handleNewChat} aria-label="新对话" title="新对话">
          <NewChatIcon />
        </button>
      </div>
    </div>
  );
}
