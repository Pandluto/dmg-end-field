import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  hydrateDefAgentSession,
  sendDefAgentContinue,
  startDefAgentStream,
  stopDefAgentStream,
  subscribeDefAgentSession,
  subscribeWorkbenchTestUiEvents,
  type DefAgentStreamEvent,
  type DefAgentThinkingEffort,
  type DefAgentTokens,
  type DefAgentWorkbenchTestUiEvent,
} from '../../utils/defAgent';
import { getLocalAgentHealth, requestOpenAiCliRest } from '../../utils/localAgent';
import type { Character, SkillButton } from '../../types';
import {
  MAIN_WORKBENCH_REST_BASE_URL,
  type MainWorkbenchCommand,
  type MainWorkbenchSnapshot,
} from '../../utils/mainWorkbenchControl';
import {
  buildMainWorkbenchSnapshotEvidence,
  buildMainWorkbenchSnapshotAnswerFromPrompt,
  isMainWorkbenchMutatingPrompt,
  resolveMainWorkbenchSnapshotFocus,
  shouldCreateMainWorkbenchRollback,
  verifyMainWorkbenchTurn,
  type MainWorkbenchCommandEvidence,
  type MainWorkbenchSnapshotEvidenceFocus,
} from '../../agentKernel/mainWorkbench';
import { summarizeMainWorkbenchToolsForAgent } from '../../agentKernel/mainWorkbench/toolRegistry';
import { buildGameKnowledgePromptLines } from '../../utils/gameKnowledge';
import { probeAiTimelineWorkNodeRuntime } from '../../agentKernel/timelineWorktree/localNodeClient';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { buildAiTurnCheckpointCommand, buildManualCheckpointCommand } from './workNodeAutosave';
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
  rollbackNodeId?: string;
};

type DefToolGovernanceRecord = {
  id?: string;
  createdAt?: number;
  decidedAt?: number;
  status?: string;
  mode?: string;
  riskLevel?: string;
  question?: string;
  summary?: string;
  rationale?: string;
  context?: Record<string, unknown>;
};

type DefToolGovernanceResponse = {
  ok?: boolean;
  latestAt?: number;
  questions?: DefToolGovernanceRecord[];
  approvals?: DefToolGovernanceRecord[];
};

function WorkbenchAiMessageBody({ message }: { message: WorkbenchAiMessage }) {
  const fallbackText = message.status === 'running' ? '正在处理' : '';
  const text = message.text || fallbackText;

  if (message.role === 'agent' && text) {
    return (
      <div className="ai-markdown main-workbench-ai-markdown">
        <MarkdownRenderer text={text} />
      </div>
    );
  }

  return <p>{text}</p>;
}

type WorkbenchAiWorkNodeContext = {
  nodeId: string;
  saveId?: string;
  branchId?: string;
  label?: string;
  path?: string;
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
  onOpenWorkNodePanel?: () => void;
  onWorkNodeChanged?: () => void;
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

function isTestGovernanceRecord(record: DefToolGovernanceRecord) {
  const suite = typeof record.context?.suite === 'string' ? record.context.suite : '';
  return Boolean(suite && /test|smoke|matrix|点测|测试/i.test(suite));
}

function formatSessionId(sessionId: string | null) {
  if (!sessionId) return 'new';
  return sessionId.length > 12 ? `${sessionId.slice(0, 5)}...${sessionId.slice(-4)}` : sessionId;
}

function formatTokens(tokens: DefAgentTokens | null) {
  if (!tokens) return 'token 0';
  return `token ${tokens.total || 0} · 入 ${tokens.prompt || 0} · 出 ${tokens.completion || 0}`;
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildSelectedSignature(selectedCharacters: Character[]) {
  return selectedCharacters.map((character) => character.id || character.name).sort().join('|');
}

function buildInitialSteps(): WorkbenchAiStep[] {
  return [
    { id: 'backup', label: '安全点', detail: '等待判断', status: 'pending' },
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
  snapshotEvidence: string,
  workNodeContext?: WorkbenchAiWorkNodeContext | null,
) {
  const selectedSummary = selectedCharacters.length
    ? selectedCharacters.map((character) => `${character.name}(${character.id})`).join(', ')
    : 'none';
  const buttonSummary = skillButtons.length
    ? skillButtons.map((button) => `${button.characterName}-${button.skillDisplayName || button.skillType}@${button.staffIndex + 1}-${(button.nodeIndex ?? 0) + 1}`).join(', ')
    : 'none';
  const toolRegistrySummary = summarizeMainWorkbenchToolsForAgent().join('\n');

  return [
    '你正在 dmg-end-field 主界面右侧 AI 模式中。用户要通过自然语言操作当前主界面排轴。',
    '工具事实源是 /api/def-tools；模型选择工具和参数，代码负责 schema、policy、verifier、rollback。',
    `LEGACY_TOOL_REGISTRY_SUMMARY（仅作兼容摘要，schema 以 /api/def-tools 为准）:\n${toolRegistrySummary}`,
    '业务操作优先通过 http://127.0.0.1:17321/api/def-tools/call 调用 DEF typed tools；/api/main-workbench/commands/enqueue 只是兼容执行层，不是首选协议。',
    '先用 def.tool.list / def.tool.describe 查看工具，再用 read/resolver/edit/verify 工具完成动作；tool 返回 queued 不等于已生效，最终回复前必须做关键验证。',
    '低风险明确操作可用 current checkout typed tools；批量/高风险/重排轴优先使用 def.worknode.patch_and_validate。没有 nodeId 时直接省略 nodeId，工具会先从可用的当前 payload 镜像创建 work node；checkout 单独执行。',
    'def.worknode.patch 只能修改 appdata node.workingPayload，不会写当前 localStorage/sessionStorage 迁出态；当前迁出态只允许 checkout/rollback 阶段写入。',
    'saveTimelineSnapshot/restoreTimelineSnapshot 只是当前迁出态的用户快照兼容回退，不是 AI work node、branch log 或修改日志；不要把 localStorage/sessionStorage 当前 checkout 当成 appdata work node。',
    ...(workNodeContext ? [
      `本轮 AI_WORK_NODE: nodeId=${workNodeContext.nodeId}; saveId=${workNodeContext.saveId || 'unknown'}; branchId=${workNodeContext.branchId || 'unknown'}; label=${workNodeContext.label || 'unknown'}; path=${workNodeContext.path || 'unknown'}`,
      '本轮需要回退、diff、checkout 或说明安全边界时，优先引用并使用上面的 AI_WORK_NODE。',
    ] : []),
    '配置页修改使用 def.operator.config.patch / def.gear.set_entry_level；可用 gearSetName/gearSetId + fillSlots 自动填 4 件，也可用 slotKey + equipmentName/equipmentId 指定单件。',
    '用户要求合适配装但没有指定名称时，不要写死回放步骤；优先读取当前配置和 resolver 候选，必要时用 def.user.ask 做非阻塞确认。',
    ...buildGameKnowledgePromptLines(),
    '换人时只读一次快照，保留未提到的已选干员，然后一次性 selectCharacters 写入最终名单；命中当前快照或上述别名时不要搜索干员库，不要先查 ID。',
    '下方当前已选干员与当前技能按钮就是可信上下文；能从这里判断的干员/按钮不要再读快照、查 schema 或查库。',
    '用户只问当前状态/现在穿什么/有哪些按钮/伤害是多少时，这是只读查询：优先使用下方 MAIN_WORKBENCH_READONLY_EVIDENCE 自行组织答案；必要时可读取 /api/main-workbench/snapshot 核对，不要投递命令，不要只说“已完成”。',
    '只读回答必须由你基于证据生成，不要要求前端模板代答。用户追问“它/这个/刚才那个/有什么 Buff”时，结合上一轮对话里的定位对象。',
    '如果用户问某个具体按钮有什么 Buff，只回答该按钮；不要退回到角色级或全局 Buff 汇总。',
    '用户要求增加、删除、替换、配置、释放技能、添加 Buff、回退或计算时，必须先投递实际命令；如果无法执行，明确说明失败，不要只读取快照当作完成。',
    '单个技能按钮/Buff 的添加或移除不要创建用户快照；高风险操作如果本轮已经提供 AI_WORK_NODE，不要再保存用户快照作为 AI 工作日志。',
    '用户说添加/增加/释放/放一个技能按钮时，必须使用 addSkillButton；不要使用 addBuff。',
    '用户说添加 Buff/增益时，必须使用 addBuff 且 command.buff 必须是完整对象；如果只有 buffId、没有 buff 对象，或者用户只说“任意/随便一个 Buff”，应询问具体 Buff，不要投递 addBuff。',
    'Buff 操作优先用 addBuff/removeBuff；同一个完整 Buff 对象要加到多个明确 buttonIds 时，必须用 addBuffToButtons 一次性批量投递，避免逐个按钮耗尽步骤；用户要求重算时把 calculateDamage 和 refreshSnapshot 放进同一个 commands 数组。',
    '发命令后最多读取一次 /api/main-workbench/snapshot、/api/main-workbench/commands 或批次 /api/main-workbench/commands/batch 确认执行结果；enqueue 成功不等于浏览器已执行，状态已符合就立刻简短回复。',
    `当前已选干员: ${selectedSummary}`,
    `当前技能按钮: ${buttonSummary}`,
    snapshotEvidence,
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
  return isMainWorkbenchMutatingPrompt(text) ? 'medium' : 'low';
}

function formatGovernanceMessage(kind: 'question' | 'approval', record: DefToolGovernanceRecord) {
  if (kind === 'question') {
    const mode = record.mode ? ` · ${record.mode}` : '';
    return `AI 反问${mode}\n\n${record.question || '需要补充信息'}`;
  }
  const mode = record.mode ? ` · ${record.mode}` : '';
  const risk = record.riskLevel ? ` · ${record.riskLevel}` : '';
  return `AI 审批提示${risk}${mode}\n\n${record.summary || record.rationale || '需要审批确认'}`;
}

/* === [DISABLED] 本地流辅助函数 — 硬编码角色/武器/装备，仅用于开发者手测 ===
 * 如需恢复：取消此注释块，并同步恢复下方 runLocal* 和 sendWorkbenchPrompt dispatch。
 */

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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function hasActiveWorkbenchCommands(status: 'pending' | 'running', since = 0) {
  const localCommands = typeof window !== 'undefined'
    ? (window.defMainWorkbench?.commands?.() || [])
    : [];
  if (localCommands.some((command) => (
    command.status === status &&
    (typeof command.createdAt !== 'number' || command.createdAt >= since)
  ))) {
    return true;
  }
  try {
    const response = await fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/main-workbench/commands?status=${status}`, { cache: 'no-store' });
    if (!response.ok) return false;
    const payload = await response.json() as { commands?: Array<{ createdAt?: number }> };
    return Array.isArray(payload.commands) && payload.commands.some((command) => (
      typeof command.createdAt !== 'number' || command.createdAt >= since
    ));
  } catch {
    return false;
  }
}

async function readWorkbenchCommandEvidence(since: number): Promise<MainWorkbenchCommandEvidence[]> {
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
    const payload = await response.json() as { commands?: MainWorkbenchCommandEvidence[] };
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

function readStringField(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field : undefined;
}

function extractCreatedWorkNodeContext(evidence: MainWorkbenchCommandEvidence[]): WorkbenchAiWorkNodeContext | null {
  const createdEntry = [...evidence].reverse().find((entry) => (
    entry.status === 'done' &&
    entry.command?.op === 'createAiTimelineWorkNodeFromCurrent' &&
    readStringField(entry.result, 'nodeId')
  ));
  const nodeId = readStringField(createdEntry?.result, 'nodeId');
  if (!nodeId) return null;
  return {
    nodeId,
    saveId: readStringField(createdEntry?.result, 'saveId'),
    branchId: readStringField(createdEntry?.result, 'branchId'),
    label: readStringField(createdEntry?.result, 'label'),
    path: readStringField(createdEntry?.result, 'path'),
  };
}

async function waitForWorkbenchCommandsToSettle(since = 0, timeoutMs = 7000) {
  const startedAt = Date.now();
  await wait(500);
  while (Date.now() - startedAt < timeoutMs) {
    const [hasPending, hasRunning] = await Promise.all([
      hasActiveWorkbenchCommands('pending', since),
      hasActiveWorkbenchCommands('running', since),
    ]);
    if (!hasPending && !hasRunning) {
      await wait(400);
      return;
    }
    await wait(500);
  }
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

function WorkNodeTreeIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v5" />
      <path d="M7 9h10" />
      <path d="M7 9v4" />
      <path d="M17 9v4" />
      <path d="M5 13h4v4H5z" />
      <path d="M15 13h4v4h-4z" />
      <path d="M10 3h4v4h-4z" />
    </svg>
  );
}

export function MainWorkbenchAiPanel({
  selectedCharacters,
  skillButtons,
  onExit,
  onOpenWorkNodePanel,
  onWorkNodeChanged,
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
  const [lastRollbackNodeId, setLastRollbackNodeId] = useState('');
  const [thinkingDetails, setThinkingDetails] = useState<string[]>([]);
  const [currentWorkNodeContext, setCurrentWorkNodeContext] = useState<WorkbenchAiWorkNodeContext | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
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
  const lastFocusRef = useRef<MainWorkbenchSnapshotEvidenceFocus | null>(null);
  const governanceSeenRef = useRef<Set<string>>(new Set());
  const governanceInitializedRef = useRef(false);
  const manualCheckpointCreatedRef = useRef(false);

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
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (manualCheckpointCreatedRef.current) return;
    manualCheckpointCreatedRef.current = true;
    let cancelled = false;
    void ensureMainWorkbenchRest()
      .then(() => probeAiTimelineWorkNodeRuntime())
      .then(() => {
        if (cancelled) return;
        const createdAt = Date.now();
        const entry = enqueueLocalWorkbenchCommand(buildManualCheckpointCommand(createdAt), 'main-workbench-ai-manual-checkpoint');
        if (!entry) {
          setStatus('进入 AI 模式前节点保存失败');
          return;
        }
        setStatus((current) => current === '待命' ? '已保存进入 AI 模式前节点' : current);
        onWorkNodeChanged?.();
        void waitForWorkbenchCommandsToSettle(createdAt, 7000).then(() => {
          onWorkNodeChanged?.();
        });
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const pollGovernance = async () => {
      try {
        const response = await fetch(`${MAIN_WORKBENCH_REST_BASE_URL}/api/def-tools/governance?limit=8`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as DefToolGovernanceResponse;
        if (disposed || !payload.ok) return;
        const nextMessages: WorkbenchAiMessage[] = [];
        const firstPoll = !governanceInitializedRef.current;
        (payload.questions || []).forEach((question) => {
          if (!question.id || governanceSeenRef.current.has(question.id)) return;
          governanceSeenRef.current.add(question.id);
          if (isTestGovernanceRecord(question)) return;
          if (firstPoll) return;
          nextMessages.push({
            id: `governance-question-${question.id}`,
            role: 'system',
            text: formatGovernanceMessage('question', question),
            status: 'done',
          });
        });
        (payload.approvals || []).forEach((approval) => {
          if (!approval.id || governanceSeenRef.current.has(approval.id)) return;
          governanceSeenRef.current.add(approval.id);
          if (isTestGovernanceRecord(approval)) return;
          if (firstPoll) return;
          nextMessages.push({
            id: `governance-approval-${approval.id}`,
            role: 'system',
            text: formatGovernanceMessage('approval', approval),
            status: 'done',
          });
        });
        if (nextMessages.length) {
          setMessages((current) => [...current, ...nextMessages]);
        }
        governanceInitializedRef.current = true;
      } catch {
        // Governance visibility is best-effort; agent execution must not depend on UI polling.
      }
    };
    void pollGovernance();
    const timer = window.setInterval(() => void pollGovernance(), 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    lastFocusRef.current = null;
  }, [selectedSignature]);

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
        if (activeMessageIdRef.current || activeSessionIdRef.current !== stored.sessionId) {
          return;
        }
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
    onWorkNodeChanged?.();
  };

  const finishMessageWithSnapshotFallback = (messageId: string, fallbackText: string, prompt: string, nextTokens?: DefAgentTokens) => {
    finishMessage(messageId, 'done', fallbackText, nextTokens);
    if (!shouldUseSnapshotFallback(prompt, fallbackText)) return;
    setStatus('核对快照中');
    void waitForWorkbenchCommandsToSettle(activePromptStartedAtRef.current).then(async () => {
      const evidence = isMainWorkbenchMutatingPrompt(prompt)
        ? await readWorkbenchCommandEvidence(activePromptStartedAtRef.current)
        : [];
      const verification = verifyMainWorkbenchTurn({ prompt, evidence });
      if (!verification.ok) {
        return {
          snapshot: null,
          text: verification.message,
          status: verification.status as WorkbenchAiMessage['status'],
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
      const answer = buildMainWorkbenchSnapshotAnswerFromPrompt(prompt, snapshot);
      if (!answer) return;
      setMessages((current) => current.map((message) => (
        message.id === messageId ? { ...message, text: answer, status: 'done' } : message
      )));
      setStatus('已核对快照');
    });
  };

/* === [DISABLED] 本地流执行函数 — 仅用于开发者手测 ===
 * runLocalComplexWorkbenchFlow: 硬编码 4 角色 + 武器 宏愿 + 装备 潮涌
 * runLocalRemoveAddBackFlow / runLocalAddRemoveBuffFlow: CRUD 测试
 * 如需恢复：取消此注释块，并同步恢复上方辅助函数和下方 dispatch。
 */

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
      setStatus('步骤完成，等待最终结果');
      patchStep('agent', { status: 'done', detail: '回复完成' });
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

  useEffect(() => {
    // Agent ability smoke tests enter through /def-agent/workbench-test/prompt.
    // This listener makes that REST-fed turn visible in the same panel as real user input.
    const events = subscribeWorkbenchTestUiEvents();
    events.addEventListener('ui.prompt', (event) => {
      if (typeof (event as MessageEvent).data !== 'string') return;
      let payload: DefAgentWorkbenchTestUiEvent;
      try {
        payload = JSON.parse((event as MessageEvent).data) as DefAgentWorkbenchTestUiEvent;
      } catch {
        setStatus('REST 投喂事件解析失败');
        return;
      }
      const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
      const sessionId = payload.sessionId || payload.sessionID || '';
      const messageId = payload.clientTurnId || `workbench-test-${Date.now()}`;
      if (payload.replay) return;
      if (!prompt || !sessionId) return;

      if (turnTimeoutRef.current) {
        window.clearTimeout(turnTimeoutRef.current);
        turnTimeoutRef.current = null;
      }
      if (finishFallbackTimeoutRef.current) {
        window.clearTimeout(finishFallbackTimeoutRef.current);
        finishFallbackTimeoutRef.current = null;
      }
      eventSourceRef.current?.close();
      reconnectAttemptsRef.current = 0;
      lastSeqRef.current = 0;
      activeMessageIdRef.current = messageId;
      activePromptRef.current = prompt;
      activePromptStartedAtRef.current = payload.at || Date.now();
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      setIsBusy(true);
      setLastPrompt(prompt);
      setStatus('REST 投喂中');
      setSteps(buildInitialSteps().map((step) => (
        step.id === 'agent'
          ? { ...step, status: 'running', detail: 'REST 投喂已接入主界面 AI' }
          : step.id === 'rest'
          ? { ...step, status: 'done', detail: payload.snapshotAvailable ? '快照证据已注入' : '快照证据缺失' }
          : step.id === 'backup'
          ? { ...step, status: 'done', detail: 'REST 投喂不创建新回退点' }
          : step
      )));
      writeStoredDefAgentSession({
        sessionId,
        skillId: WORKBENCH_AGENT_SKILL_ID,
        selectedSignature,
      });
      setMessages((current) => [
        ...current,
        { id: `${messageId}-user`, role: 'user', text: prompt, status: 'done', prompt },
        { id: messageId, role: 'agent', text: '', status: 'running', prompt },
      ]);

      const stream = subscribeDefAgentSession(sessionId, 0);
      eventSourceRef.current = stream;
      bindEventSource(stream, messageId);
    });
    events.onerror = () => {
      if (events.readyState === EventSource.CLOSED) setStatus('REST 投喂监听已断开');
    };
    return () => {
      events.close();
    };
  }, [selectedSignature]);

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
    const shouldCreateRollback = shouldCreateMainWorkbenchRollback(userText);
    const shouldCreateWorkNode = shouldCreateRollback || isMainWorkbenchMutatingPrompt(userText);
    setInput('');
    setIsBusy(true);
    setLastPrompt(userText);
    setLastRollbackLabel('');
    setLastRollbackNodeId('');
    setCurrentWorkNodeContext(null);
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
      { id: messageId, role: 'agent', text: '', status: 'running', prompt: userText },
    ]);

    // 第二阶段：关闭前端正则 quick action，避免绕过工具注册表和 work node patch 主路径。

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
      let workNodeContext: WorkbenchAiWorkNodeContext | null = null;
      if (shouldCreateWorkNode) {
        patchStep('backup', { status: 'running', detail: '创建 AI work node' });
        await ensureMainWorkbenchRest();
        await probeAiTimelineWorkNodeRuntime();
        const backupEntry = enqueueLocalWorkbenchCommand(buildAiTurnCheckpointCommand({
          messageId,
          prompt: userText,
        }));
        if (!backupEntry) {
          patchStep('backup', { status: 'error', detail: '页面控制入口不可用' });
          finishMessage(messageId, 'error', '无法创建 AI work node 节点，已停止本轮操作。');
          setStatus('安全点创建失败');
          return;
        }
        await waitForWorkbenchCommandsToSettle(activePromptStartedAtRef.current, 10000);
        const backupEvidence = await readWorkbenchCommandEvidence(activePromptStartedAtRef.current);
        const failedBackup = backupEvidence.find((entry) => entry.command?.op === 'createAiTimelineWorkNodeFromCurrent' && entry.status === 'error');
        workNodeContext = extractCreatedWorkNodeContext(backupEvidence);
        if (!workNodeContext) {
          const reason = failedBackup?.error || '未取得 nodeId';
          patchStep('backup', { status: 'error', detail: reason });
          finishMessage(messageId, 'error', `无法创建 AI work node 节点：${reason}。已停止本轮操作。`);
          setStatus('安全点创建失败');
          return;
        }
        setLastRollbackNodeId(workNodeContext.nodeId);
        setLastRollbackLabel(rollbackLabel);
        setCurrentWorkNodeContext(workNodeContext);
        setMessages((current) => current.map((message) => (
          message.id === messageId ? { ...message, rollbackLabel, rollbackNodeId: workNodeContext?.nodeId } : message
        )));
        onWorkNodeChanged?.();
        patchStep('backup', { status: 'done', detail: `work node ${workNodeContext.nodeId}` });
      } else {
        patchStep('backup', { status: 'done', detail: '只读请求' });
      }
      setStatus('启动 REST');
      patchStep('rest', { status: 'running', detail: '启动 17321' });
      await ensureMainWorkbenchRest();
      const snapshot = await readMainWorkbenchSnapshot();
      const focusState = resolveMainWorkbenchSnapshotFocus(snapshot, userText, lastFocusRef.current);
      if (focusState.focus && !focusState.focus.stale) {
        lastFocusRef.current = focusState.focus;
      } else if (focusState.previousFocus?.stale) {
        lastFocusRef.current = null;
      }
      const snapshotEvidence = buildMainWorkbenchSnapshotEvidence(snapshot, userText, focusState);
      const agentText = buildWorkbenchAgentMessage(userText, selectedCharacters, skillButtons, snapshotEvidence, workNodeContext);
      patchStep('rest', { status: 'done', detail: snapshot ? 'REST 已就绪，快照证据已注入' : 'REST 已就绪，快照证据缺失' });
      patchStep('agent', { status: 'running', detail: 'def-opencode 正在思考' });
      eventSourceRef.current?.close();
      const thinkingEffort = chooseWorkbenchThinkingEffort(userText);
      const existingSessionId = activeSessionIdRef.current;
      if (existingSessionId) {
        const nextEventSource = subscribeDefAgentSession(existingSessionId, lastSeqRef.current);
        eventSourceRef.current = nextEventSource;
        bindEventSource(nextEventSource, messageId);
        try {
          await sendDefAgentContinue(existingSessionId, agentText, messageId, {
            thinkingEffort,
            skillId: WORKBENCH_AGENT_SKILL_ID,
          });
          rememberSession(existingSessionId);
        } catch (continueError) {
          nextEventSource.close();
          const message = continueError instanceof Error ? continueError.message : String(continueError);
          if (!/not.?found|session/i.test(message)) throw continueError;
          lastSeqRef.current = 0;
          const stream = await startDefAgentStream(agentText, {
            thinkingEffort,
            skillId: WORKBENCH_AGENT_SKILL_ID,
            clientTurnId: messageId,
          });
          rememberSession(stream.sessionId);
          eventSourceRef.current?.close();
          eventSourceRef.current = stream.eventSource;
          bindEventSource(stream.eventSource, messageId);
        }
      } else {
        lastSeqRef.current = 0;
        const stream = await startDefAgentStream(agentText, {
          thinkingEffort,
          skillId: WORKBENCH_AGENT_SKILL_ID,
          clientTurnId: messageId,
        });
        rememberSession(stream.sessionId);
        eventSourceRef.current = stream.eventSource;
        bindEventSource(stream.eventSource, messageId);
      }
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

  const handleRollback = (rollbackNodeId = lastRollbackNodeId, rollbackLabel = lastRollbackLabel) => {
    if (isBusy) return;
    const command: MainWorkbenchCommand = rollbackNodeId
      ? {
        op: 'restoreAiTimelineWorkNodeBase',
        nodeId: rollbackNodeId,
        reload: true,
        approval: {
          approvedBy: 'user',
          rationale: '用户从 AI 面板回退到本轮 AI work node base',
        },
      }
      : rollbackLabel
      ? { op: 'restoreTimelineSnapshot', label: rollbackLabel, reload: true }
      : { op: 'restoreTimelineSnapshot', latest: true, reload: true };
    const entry = enqueueLocalWorkbenchCommand(command);
    setStatus(entry ? '已请求回退' : '回退失败：页面控制入口不可用');
    if (entry) {
      onWorkNodeChanged?.();
      void waitForWorkbenchCommandsToSettle(Date.now(), 7000).then(() => {
        onWorkNodeChanged?.();
      });
    }
    setSteps((current) => current.map((step) => (
      step.id === 'operate'
        ? { ...step, status: entry ? 'running' : 'error', detail: entry ? (rollbackNodeId ? '恢复 work node base' : '恢复排轴快照') : '控制入口不可用' }
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
    setLastRollbackNodeId('');
    setCurrentWorkNodeContext(null);
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
  const elapsedText = isBusy && activePromptStartedAtRef.current
    ? `计时 ${formatElapsed(nowTick - activePromptStartedAtRef.current)}`
    : '待命';
  const latestNode = currentWorkNodeContext?.nodeId
    ? `当前节点 ${currentWorkNodeContext.nodeId.slice(0, 8)}`
    : '暂无节点';
  const workNodeStatusText = currentWorkNodeContext ? '本轮已保存节点' : '未关联本轮节点';

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
        <button
          type="button"
          className="main-workbench-ai-topbar-button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onOpenWorkNodePanel?.();
          }}
          aria-label="Work node 节点树"
          title="Work node 节点树"
        >
          <WorkNodeTreeIcon />
        </button>
        <div className="main-workbench-ai-session">
          <strong>DEF OpenCode</strong>
          <span>{formatSessionId(activeSessionId)} · {formatTokens(tokens)}</span>
        </div>
      </div>

      <div className="main-workbench-ai-node-summary">
        <span>{elapsedText}</span>
        <span>{latestNode}</span>
        <span>{workNodeStatusText}</span>
      </div>

      <div className="main-workbench-ai-body">
        <div className="main-workbench-ai-messages" ref={messagesRef}>
          {messages.map((message) => (
            <div key={message.id} className={`main-workbench-ai-message is-${message.role} ${message.status ? `is-${message.status}` : ''}`}>
              <span>{message.role === 'user' ? '你' : message.role === 'agent' ? '后台' : '系统'}</span>
              <WorkbenchAiMessageBody message={message} />
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
                    {message.role === 'agent' && (message.rollbackNodeId || message.rollbackLabel) && (
                      <button
                        type="button"
                        className="main-workbench-ai-icon-button"
                        onClick={() => handleRollback(message.rollbackNodeId, message.rollbackLabel)}
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
