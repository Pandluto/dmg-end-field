import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  createAiCliCommandRequest,
  fail,
  formatDraftSummary,
  info,
  labelApproval,
  labelSave,
  runAiCliCommand,
  summarizeAiCliCommand,
  getProposalAlias,
} from '../aiCli/aiCliCommandService';
import { readPendingAgentProposals, importExternalProposals, ensureActiveSession, readAgentSession } from '../aiCli/aiCliAgentInfrastructure';

import { readCurrentBuffDraft } from '../aiCli/buffFillAdapter';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  listDefAgentSessions,
  listPersistedDefAgentSessions,
  hydrateDefAgentSession,
  sendDefAgentContinue,
  startDefAgentStream,
  stopDefAgentStream,
  subscribeDefAgentSession,
  type DefAgentSessionSummary,
  type DefAgentActivityItem,
  type DefAgentLoopStep,
  type DefAgentStreamEvent,
  type DefAgentThinkingEffort,
  type DefAgentTokens,
  type DefAgentTranscriptMessage,
} from '../utils/defAgent';
import './AiCliPage.css';

async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function resolveNavigationTarget(data: unknown) {
  if (!data || typeof data !== 'object' || !('navigateTo' in data)) {
    return null;
  }
  const value = (data as { navigateTo?: unknown }).navigateTo;
  return value === 'home' || value === 'buff' ? value : null;
}

function labelApprovalZh(status: string) {
  return ({ Wait: '待审批', Yes: '已批准', No: '已拒绝' } as Record<string, string>)[status] ?? status;
}

function labelSaveZh(status: string) {
  return ({ Wait: '待保存', Yes: '已保存', No: '未保存' } as Record<string, string>)[status] ?? status;
}

type AgentRecordsPayload = {
  operationLogs?: Array<{
    id?: string;
    client?: string;
    command?: string;
    ok?: boolean;
    writes?: boolean;
    errorCode?: string;
    proposalId?: string;
    approval?: string;
    save?: string;
  }>;
  proposals?: Array<{
    id?: string;
    domain?: string;
    operation?: string;
    payload?: unknown;
    approvalStatus?: string;
    saveStatus?: string;
    client?: string;
    sessionId?: string;
    summary?: string;
    createdAt?: number;
    updatedAt?: number;
  }>;
};

type SkillTaskId = 'operator' | 'weapon' | 'equipment' | 'search' | 'repair' | 'audit';

type SkillTask = {
  id: SkillTaskId;
  label: string;
  hint: string;
  icon: 'person' | 'sword' | 'box' | 'globe' | 'repair' | 'audit';
};

type SkillChatMessage = {
  id?: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  meta?: string;
  sessionId?: string;
  activity?: DefAgentActivityItem[];
  loopSteps?: DefAgentLoopStep[];
  tokens?: DefAgentTokens;
  isStreaming?: boolean;
};

const THINKING_EFFORTS: Array<{ value: DefAgentThinkingEffort; label: string; title: string }> = [
  { value: 'low', label: '快', title: '快速' },
  { value: 'medium', label: '中', title: '标准' },
  { value: 'high', label: '深', title: '深入' },
];

const LONG_MESSAGE_LIMIT = 1600;
const DEF_AGENT_BROWSER_SESSION_KEY = 'def-opencode.activeSession.v1';

type StoredDefAgentSession = {
  sessionId: string;
  skillId?: SkillTaskId;
  lastSeq?: number;
  tokens?: DefAgentTokens;
  updatedAt?: number;
};

function readStoredDefAgentSession(): StoredDefAgentSession | null {
  try {
    const raw = window.localStorage.getItem(DEF_AGENT_BROWSER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDefAgentSession;
    return parsed?.sessionId ? parsed : null;
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
      updatedAt: session.updatedAt || Date.now(),
    }));
  } catch {
    // Browser storage is a convenience; chat must continue without it.
  }
}

function pickRestorableDefAgentSession(
  sessions: DefAgentSessionSummary[],
  stored: StoredDefAgentSession | null,
  skillId: SkillTaskId,
) {
  if (stored?.sessionId) {
    const exact = sessions.find((session) => session.id === stored.sessionId || session.sessionID === stored.sessionId);
    if (exact && !exact.stopped) return exact;
  }
  return sessions
    .filter((session) => !session.stopped && (!session.skillId || session.skillId === skillId))
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0] || null;
}

function transcriptToSkillMessages(messages: DefAgentTranscriptMessage[]): SkillChatMessage[] {
  return messages
    .filter((message) => message && (message.role === 'user' || message.role === 'agent' || message.role === 'system'))
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text || '',
      meta: message.meta,
      sessionId: message.sessionId,
      activity: message.activity,
      loopSteps: message.loopSteps,
      tokens: message.tokens,
      isStreaming: false,
    }));
}

function labelThinkingEffort(value: DefAgentThinkingEffort) {
  return THINKING_EFFORTS.find((item) => item.value === value)?.title || '标准';
}

function buildStoppedLoopSteps(steps: DefAgentLoopStep[] = []): DefAgentLoopStep[] {
  const fallback: DefAgentLoopStep[] = [
    { phase: 'think', label: '思考', detail: '已收到停止指令', status: 'stopped' },
    { phase: 'act', label: '执行', detail: '后台生成已中断', status: 'stopped' },
    { phase: 'observe', label: '观察', detail: '保留已返回内容', status: 'stopped' },
    { phase: 'answer', label: '回复', detail: '本次响应未完成', status: 'stopped' },
  ];
  return (steps.length ? steps : fallback).map((step) => ({
    ...step,
    status: step.status === 'done' ? 'done' : 'stopped',
  }));
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (match[2] && match[3]) {
      nodes.push(
        <a key={key} href={match[3]} target="_blank" rel="noreferrer">
          {match[2]}
        </a>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderMarkdown(text: string) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{language ? `// ${language}\n` : ''}{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = `h${heading[1].length + 2}` as 'h3' | 'h4' | 'h5';
      blocks.push(<Tag key={`h-${index}`}>{renderInlineMarkdown(heading[2], `h-${index}`)}</Tag>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length
      && (lines[index] ?? '').trim()
      && !(lines[index] ?? '').trimStart().startsWith('```')
      && !/^(#{1,3})\s+/.test(lines[index] ?? '')
      && !/^[-*]\s+/.test(lines[index] ?? '')
      && !/^\d+\.\s+/.test(lines[index] ?? '')
    ) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`}>
        {renderInlineMarkdown(paragraphLines.join('\n'), `p-${index}`)}
      </p>,
    );
  }

  return blocks;
}

function SkillMessageBody({ message }: { message: SkillChatMessage }) {
  if (message.role === 'agent') {
    const hasDebugDetails = Boolean(message.activity?.length || message.loopSteps?.length);
    return (
      <>
        {message.text ? null : <SkillAgentProgress message={message} />}
        {message.text ? (
          <div className={message.isStreaming ? 'ai-skill-markdown is-streaming' : 'ai-skill-markdown'}>
            {renderMarkdown(message.text)}
            {message.isStreaming ? <span className="ai-skill-stream-cursor" aria-hidden="true" /> : null}
          </div>
        ) : null}
        {hasDebugDetails ? (
          <details className="ai-agent-debug-details">
            <summary>{message.isStreaming ? '后台正在处理' : '后台细节'}</summary>
            {message.activity?.length ? <SkillAgentActivity activity={message.activity} /> : null}
            {message.loopSteps?.length ? <SkillAgentLoop steps={message.loopSteps} /> : null}
          </details>
        ) : null}
      </>
    );
  }
  if (message.text.length > LONG_MESSAGE_LIMIT) {
    return (
      <details className="ai-skill-long-message">
        <summary>{message.meta || `长文本 ${message.text.length} 字，点击展开`}</summary>
        <p>{message.text}</p>
      </details>
    );
  }
  return <p>{message.text}</p>;
}

function SkillAgentProgress({ message }: { message: SkillChatMessage }) {
  const activity = message.activity || [];
  const hasError = activity.some((item) => item.status === 'error');
  const hasRunningTool = activity.some((item) => item.kind === 'tool' && item.status === 'running');
  const hasTool = activity.some((item) => item.kind === 'tool');
  const hasTextStep = (message.loopSteps || []).some((step) => step.phase === 'answer' && step.status === 'running');
  let label = '正在处理你的请求';
  if (hasError) label = '后台处理异常，正在收尾';
  else if (hasTextStep) label = '正在生成回复';
  else if (hasRunningTool || hasTool) label = '正在查询和整理资料';
  else if (!message.isStreaming) label = '没有可显示的回复';
  return (
    <div className={message.isStreaming ? 'ai-skill-progress is-running' : hasError ? 'ai-skill-progress is-error' : 'ai-skill-progress'}>
      <span>{label}</span>
      {message.isStreaming ? <i aria-hidden="true" /> : null}
    </div>
  );
}

function labelActivityStatus(status: string) {
  return ({
    pending: '等待',
    running: '运行',
    done: '完成',
    stopped: '停止',
    error: '异常',
  } as Record<string, string>)[status] ?? status;
}

function labelActivityKind(kind: string) {
  return ({
    event: '事件',
    step: '步骤',
    reasoning: '思考',
    tool: '工具',
    message: '消息',
  } as Record<string, string>)[kind] ?? kind;
}

function labelBackendActor(value?: string) {
  if (!value) return '后台处理';
  if (value.includes('operator')) return '资料整理';
  if (value.includes('weapon')) return '武器整理';
  if (value.includes('equipment')) return '装备整理';
  if (value.includes('search')) return '数据查询';
  if (value.includes('repair')) return '错误修复';
  if (value.includes('audit')) return '数据审计';
  return '后台处理';
}

function labelToolName(value?: string) {
  return ({
    skill: '加载能力',
    read: '读取资料',
    grep: '搜索内容',
    glob: '查找文件',
    bash: '运行命令',
    webfetch: '读取网页',
    task: '子任务',
  } as Record<string, string>)[value || ''] || '处理资料';
}

function SkillAgentActivity({ activity }: { activity: DefAgentActivityItem[] }) {
  return (
    <div className="ai-agent-activity" aria-label="OpenCode activity">
      {activity.map((item, index) => (
        item.kind === 'tool'
          ? <SkillToolCallItem key={item.id || `${item.kind}-${index}`} item={item} />
          : (
            <div key={item.id || `${item.kind}-${index}`} className={`ai-agent-activity-item is-${item.status}`}>
              <span>{labelActivityKind(item.kind)}</span>
              <div>
                <strong>{item.title}</strong>
                {item.detail ? <small>{item.detail}</small> : null}
              </div>
              <em>{labelActivityStatus(item.status)}</em>
            </div>
          )
      ))}
    </div>
  );
}

function SkillToolCallItem({ item }: { item: DefAgentActivityItem }) {
  return (
    <details className={`ai-skill-tool-item is-${item.status}`} open={item.status === 'running'}>
      <summary>
        <span>{labelActivityKind(item.kind)}</span>
        <strong>{item.title}</strong>
        <em>{labelActivityStatus(item.status)}</em>
      </summary>
      {item.detail ? <small>{item.detail}</small> : null}
      {item.result ? <pre>{item.result}</pre> : null}
    </details>
  );
}

function formatShortSessionId(sessionId: string | null) {
  if (!sessionId) return '未建立';
  return sessionId.length > 14 ? `${sessionId.slice(0, 6)}…${sessionId.slice(-5)}` : sessionId;
}

function formatTokenUsage(tokens: DefAgentTokens | null) {
  if (!tokens) return 'token 0';
  return `token ${tokens.total || 0} · 入 ${tokens.prompt || 0} · 出 ${tokens.completion || 0}`;
}

function SkillAgentLoop({ steps }: { steps: DefAgentLoopStep[] }) {
  return (
    <div className="ai-agent-loop" aria-label="Agent loop">
      {steps.map((step, index) => (
        <div key={`${step.phase}-${index}`} className={`ai-agent-loop-step is-${step.status}`}>
          <span>{step.label}</span>
          <strong>{step.status === 'running' ? '进行中' : step.status === 'pending' ? '等待' : step.status === 'stopped' ? '已停止' : step.status === 'error' ? '异常' : '完成'}</strong>
          <small>{step.detail}</small>
        </div>
      ))}
    </div>
  );
}

const SKILL_TASKS: SkillTask[] = [
  { id: 'operator', label: '填干员', hint: '整理人物资料并生成待审核修改', icon: 'person' },
  { id: 'weapon', label: '填武器', hint: '处理武器参数、来源和描述', icon: 'sword' },
  { id: 'equipment', label: '填装备', hint: '补齐装备条目和关联字段', icon: 'box' },
  { id: 'search', label: '查库', hint: '通过 REST API 搜索已有数据', icon: 'globe' },
  { id: 'repair', label: '修复错误', hint: '解释报错并给出修复提案', icon: 'repair' },
  { id: 'audit', label: '审计数据', hint: '检查条件缺口、冲突和风险', icon: 'audit' },
];

function SkillTaskIcon({ icon }: { icon: SkillTask['icon'] }) {
  if (icon === 'person') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </svg>
    );
  }
  if (icon === 'sword') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 5.5 19 3l-2.5 4.5L8 16" />
        <path d="m6 14 4 4" />
        <path d="m4 20 4-4" />
      </svg>
    );
  }
  if (icon === 'box') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 7.5 8-4 8 4-8 4Z" />
        <path d="M4 7.5v9l8 4 8-4v-9" />
        <path d="M12 11.5v9" />
      </svg>
    );
  }
  if (icon === 'globe') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18" />
        <path d="M12 3a14 14 0 0 0 0 18" />
      </svg>
    );
  }
  if (icon === 'repair') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 6.5a4.5 4.5 0 0 0-5.8 5.8L4 17.5 6.5 20l5.2-5.2A4.5 4.5 0 0 0 17.5 9" />
        <path d="m15 6.5 2.5-2.5 2.5 2.5-2.5 2.5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6Z" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

export function AiCliPage() {
  const [currentDraft, setCurrentDraft] = useState(() => readCurrentBuffDraft());
  const [sourceText, setSourceText] = useState('');
  const [commandText, setCommandText] = useState('');
  const [lines, setLines] = useState<string[]>([
    'DEF AI CLI',
    'mode=buff.fill',
    'type help',
    ...formatDraftSummary(readCurrentBuffDraft()).map((line) => `current ${line}`),
  ]);
  const outputRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skillTextareaRef = useRef<HTMLTextAreaElement>(null);
  const skillMessagesRef = useRef<HTMLDivElement>(null);
  const activeSkillEventSourceRef = useRef<EventSource | null>(null);
  const activeSkillSessionIdRef = useRef<string | null>(readStoredDefAgentSession()?.sessionId || null);
  const activeSkillMessageIdRef = useRef<string | null>(null);
  const lastSkillStreamSeqRef = useRef(0);
  const skillStreamRetryCountRef = useRef(0);
  const lastAgentLogIdRef = useRef<string | null>(null);
  const lastPreviewProposalIdRef = useRef<string | null>(null);

  // Command history state
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [draftInput, setDraftInput] = useState<string>('');

  const [sessionId, setSessionId] = useState(() => ensureActiveSession('web-cli').id);
  const [skillInput, setSkillInput] = useState('hi');
  const [skillStatus, setSkillStatus] = useState('等待输入');
  const [activeDefSessionId, setActiveDefSessionId] = useState<string | null>(() => readStoredDefAgentSession()?.sessionId || null);
  const [skillTokenUsage, setSkillTokenUsage] = useState<DefAgentTokens | null>(() => readStoredDefAgentSession()?.tokens || null);
  const [skillMessages, setSkillMessages] = useState<SkillChatMessage[]>([
    { role: 'system', text: '说一句话，或粘贴资料让我整理成待审核修改。模型和后台配置在 DEF Shell 的服务与 Agent 页面。' },
  ]);
  const [isSkillBusy, setIsSkillBusy] = useState(false);
  const [isSkillTaskPanelOpen, setIsSkillTaskPanelOpen] = useState(false);
  const [selectedSkillTaskId, setSelectedSkillTaskId] = useState<SkillTaskId>('operator');
  const [thinkingEffort, setThinkingEffort] = useState<DefAgentThinkingEffort>('medium');
  const selectedSkillTask = useMemo(
    () => SKILL_TASKS.find((task) => task.id === selectedSkillTaskId) ?? SKILL_TASKS[0],
    [selectedSkillTaskId],
  );

  const rememberDefAgentSession = (sessionId: string | null, tokens?: DefAgentTokens | null, lastSeq?: number) => {
    activeSkillSessionIdRef.current = sessionId;
    setActiveDefSessionId(sessionId);
    if (tokens) setSkillTokenUsage(tokens);
    writeStoredDefAgentSession(sessionId ? {
      sessionId,
      skillId: selectedSkillTaskId,
      tokens: tokens || skillTokenUsage || undefined,
      lastSeq: lastSeq || lastSkillStreamSeqRef.current || undefined,
    } : null);
  };

  const syncSessionId = () => {
    const currentSessionId = readAgentSession()?.id ?? ensureActiveSession('web-cli').id;
    setSessionId((previous) => (previous === currentSessionId ? previous : currentSessionId));
    return currentSessionId;
  };

  const prompt = useMemo(() => {
    const sid = sessionId;
    const pending = readPendingAgentProposals(sid);
    if (pending.length === 0) {
      return `def:${currentDraft.id}>`;
    }
    const first = pending[0];
    const alias = getProposalAlias(first.id, sid);
    if (first.approvalStatus === 'Wait') {
      return `def:${currentDraft.id} pending=${alias} approve(Y=批准,N=拒绝)>`;
    }
    return `def:${currentDraft.id} pending=${alias} save(Y=保存,N=取消)>`;
  }, [currentDraft.id, lines, sessionId]);

  const pendingProposals = useMemo(() => readPendingAgentProposals(sessionId), [lines, sessionId]);

  const appendLines = (nextLines: string[]) => {
    setLines((prev) => [...prev, ...nextLines]);
    window.setTimeout(() => {
      outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
    }, 0);
  };

  const appendDefaultProposalPreview = (sid: string) => {
    const pending = readPendingAgentProposals(sid);
    const first = pending[0];
    if (!first || first.id === lastPreviewProposalIdRef.current) {
      return;
    }
    lastPreviewProposalIdRef.current = first.id;
    const result = runAiCliCommand(
      createAiCliCommandRequest('proposal.show #1', 'web-cli'),
      currentDraft,
      { sourceText, sessionId: sid },
    );
    appendLines([info('default pending proposal preview (默认待处理提案预览)'), ...result.lines]);
  };

  const handleAgentRecordsPayload = (payload: AgentRecordsPayload) => {
    if (payload.proposals && payload.proposals.length > 0) {
      const currentSessionId = syncSessionId();
      const handoff = importExternalProposals(payload.proposals, currentSessionId);
      if (handoff.lines.length > 0) {
        appendLines(handoff.lines);
      }
      appendDefaultProposalPreview(currentSessionId);
    }
    const latestLog = payload.operationLogs?.[0];
    if (!latestLog?.id || latestLog.id === lastAgentLogIdRef.current || !latestLog.command || latestLog.command === '-') {
      return;
    }
    lastAgentLogIdRef.current = latestLog.id;
    const currentSessionId = syncSessionId();
    const alias = latestLog.proposalId ? getProposalAlias(latestLog.proposalId, currentSessionId) : null;
    const aliasPart = alias ? ` proposal=${alias}` : '';
    const approvalPart = latestLog.approval ? ` approval=${labelApproval(latestLog.approval)}` : '';
    const savePart = latestLog.save ? ` save=${labelSave(latestLog.save)}` : '';
    const errorPart = latestLog.errorCode ? ` error=${latestLog.errorCode}` : '';
    const zhParts = [
      latestLog.errorCode ? `错误=${latestLog.errorCode}` : '',
      latestLog.writes ? '写入' : '',
      alias ? `提案=${alias}` : '',
      latestLog.approval ? `审批=${labelApprovalZh(latestLog.approval)}` : '',
      latestLog.save ? `保存=${labelSaveZh(latestLog.save)}` : '',
    ].filter(Boolean);
    const zhPart = zhParts.length ? ` (${zhParts.join(' ')})` : '';
    appendLines([
      `[agent] ${latestLog.client || '-'} ${latestLog.ok ? 'ok' : 'err'} ${latestLog.writes ? 'write' : 'read'} ${latestLog.command || '-'}${aliasPart}${approvalPart}${savePart}${errorPart}${zhPart}`,
    ]);
  };

  const isAiCliRestAvailable = async () => {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 800);
      const response = await fetch('http://127.0.0.1:31457/health', {
        cache: 'no-store',
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      if (!response.ok) return false;
      const payload = await response.json() as { aiCliRest?: { running?: boolean } };
      return Boolean(payload.aiCliRest?.running);
    } catch {
      return false;
    }
  };

  const fetchAgentRecordsSnapshot = async (reason: string) => {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1200);
      const response = await fetch('http://127.0.0.1:17321/api/agent/records', {
        cache: 'no-store',
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      if (!response.ok) {
        appendLines([fail(`agent records snapshot failed: HTTP ${response.status} (${reason})`)]);
        return;
      }
      const payload = await response.json() as AgentRecordsPayload;
      handleAgentRecordsPayload(payload);
    } catch (error) {
      appendLines([fail(`agent records snapshot failed: ${error instanceof Error ? error.message : String(error)} (${reason})`)]);
    }
  };

  useEffect(() => {
    appendDefaultProposalPreview(syncSessionId());
    void isAiCliRestAvailable().then((available) => {
      if (available) void fetchAgentRecordsSnapshot('startup');
    });
  }, []);

  useEffect(() => {
    const textarea = skillTextareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 58), 220)}px`;
  }, [skillInput]);

  useEffect(() => {
    window.setTimeout(() => {
      skillMessagesRef.current?.scrollTo({ top: skillMessagesRef.current.scrollHeight });
    }, 0);
  }, [skillMessages]);

  useEffect(() => () => {
    activeSkillEventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    const stored = readStoredDefAgentSession();
    if (stored?.sessionId) {
      activeSkillSessionIdRef.current = stored.sessionId;
      lastSkillStreamSeqRef.current = stored.lastSeq || 0;
      setActiveDefSessionId(stored.sessionId);
      if (stored.tokens) setSkillTokenUsage(stored.tokens);
      setSkillStatus('已恢复上次会话');
    }
    let cancelled = false;
    const applyHydratedSession = async (sessionId: string) => {
      const transcript = await hydrateDefAgentSession(sessionId);
      if (cancelled) return false;
      const messages = transcriptToSkillMessages(transcript.messages || []);
      if (messages.length > 0) {
        setSkillMessages(messages);
      }
      const session = transcript.session;
      activeSkillSessionIdRef.current = session.id;
      lastSkillStreamSeqRef.current = session.lastSeq || 0;
      setActiveDefSessionId(session.id);
      if (session.tokens) setSkillTokenUsage(session.tokens);
      writeStoredDefAgentSession({
        sessionId: session.id,
        skillId: (session.skillId as SkillTaskId | undefined) || selectedSkillTaskId,
        lastSeq: session.lastSeq || 0,
        tokens: session.tokens,
        updatedAt: session.updatedAt,
      });
      setSkillStatus(messages.length > 0 ? '已恢复历史会话' : '已恢复上次会话');
      return true;
    };
    (async () => {
      try {
        const sessions = await listDefAgentSessions();
        if (cancelled) return;
        const restored = pickRestorableDefAgentSession(sessions, stored, selectedSkillTaskId);
        if (restored?.id) {
          activeSkillSessionIdRef.current = restored.id;
          lastSkillStreamSeqRef.current = restored.lastSeq || stored?.lastSeq || 0;
          setActiveDefSessionId(restored.id);
          if (restored.tokens) setSkillTokenUsage(restored.tokens);
          writeStoredDefAgentSession({
            sessionId: restored.id,
            skillId: (restored.skillId as SkillTaskId | undefined) || selectedSkillTaskId,
            lastSeq: restored.lastSeq,
            tokens: restored.tokens,
            updatedAt: restored.updatedAt,
          });
          setSkillStatus('已恢复上次会话');
          await applyHydratedSession(restored.id).catch(() => false);
          return;
        }
      } catch {
        // Def-agent is started lazily on send; lack of a session list should not slow the page.
      }
      try {
        const persisted = await listPersistedDefAgentSessions();
        if (cancelled) return;
        const restored = pickRestorableDefAgentSession(persisted, stored, selectedSkillTaskId);
        if (restored?.id) await applyHydratedSession(restored.id);
      } catch {
        // Persisted history is best-effort; a missing runtime should not block normal chat.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return undefined;
    }

    let events: EventSource | null = null;
    let cancelled = false;
    void isAiCliRestAvailable().then((available) => {
      if (!available || cancelled) return;
      events = new EventSource('http://127.0.0.1:17321/api/agent/events');
      events.addEventListener('agent.records', (event) => {
      let payload: AgentRecordsPayload;
      try {
        payload = JSON.parse(event.data) as AgentRecordsPayload;
      } catch (error) {
        appendLines([
          fail(`agent SSE event parse failed: ${error instanceof Error ? error.message : String(error)}`),
          `[raw] ${String(event.data).slice(0, 200)}`,
        ]);
        void fetchAgentRecordsSnapshot('sse-parse-failed');
        return;
      }
      try {
        handleAgentRecordsPayload(payload);
      } catch (error) {
        appendLines([
          fail(`agent SSE event import failed: ${error instanceof Error ? error.message : String(error)}`),
          `[raw] ${String(event.data).slice(0, 200)}`,
        ]);
        void fetchAgentRecordsSnapshot('sse-import-failed');
      }
    });

      events.onerror = () => {
        void isAiCliRestAvailable().then((availableAfterError) => {
          if (availableAfterError) void fetchAgentRecordsSnapshot('sse-error');
        });
      };
    });

    return () => {
      cancelled = true;
      events?.close();
    };
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const rawCommand = commandText.trim();
    if (!rawCommand) {
      return;
    }
    // Add to history
    setHistory((prev) => {
      if (prev[prev.length - 1] === rawCommand) return prev;
      return [...prev, rawCommand];
    });
    setHistoryIndex(-1);
    setDraftInput('');
    setCommandText('');

    if (rawCommand === 'clear') {
      setLines(['DEF AI CLI', 'mode=buff.fill', 'type help']);
      return;
    }

    if (rawCommand.startsWith('fill.source ')) {
      const nextSourceText = rawCommand.slice('fill.source '.length);
      setSourceText(nextSourceText);
      appendLines([`${prompt} ${rawCommand}`, info(`source length=${nextSourceText.length}`)]);
      return;
    }

    const request = createAiCliCommandRequest(rawCommand, 'web-cli');
    const result = runAiCliCommand(request, currentDraft, { sourceText });

    if (result.nextDraft) {
      setCurrentDraft(result.nextDraft);
    }
    if (result.copyText) {
      void copyText(result.copyText);
    }

    const navigationTarget = resolveNavigationTarget(result.data);
    if (navigationTarget === 'home') {
      navigateToAppPath(APP_ROUTE_PATHS.home);
    } else if (navigationTarget === 'buff') {
      navigateToAppPath(APP_ROUTE_PATHS.buffSheet);
    }

    appendLines([`${prompt} ${summarizeAiCliCommand(rawCommand)}`, ...result.lines]);
  };

  const appendActivityItem = (
    items: DefAgentActivityItem[] | undefined,
    next: DefAgentActivityItem,
  ): DefAgentActivityItem[] => {
    const current = items || [];
    const index = current.findIndex((item) => item.id === next.id);
    if (index < 0) return [...current, next];
    return current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
  };

  const completeRunningSteps = (steps: DefAgentLoopStep[] | undefined, status: DefAgentLoopStep['status'] = 'done') => (
    (steps || []).map((step) => ({
      ...step,
      status: step.status === 'done' ? step.status : status,
    }))
  );

  const bindSkillEventSource = (eventSource: EventSource, agentMessageId: string) => {
    const streamEvents = [
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
    ];
    streamEvents.forEach((eventName) => {
      eventSource.addEventListener(eventName, (event) => handleSkillStreamEvent(event as MessageEvent, agentMessageId));
    });
    eventSource.onerror = () => {
      if (!activeSkillMessageIdRef.current || activeSkillMessageIdRef.current !== agentMessageId) return;
      if (skillStreamRetryCountRef.current >= 3) {
        setSkillStatus('流连接断开');
        setIsSkillBusy(false);
        eventSource.close();
        if (activeSkillEventSourceRef.current === eventSource) {
          activeSkillEventSourceRef.current = null;
        }
        return;
      }
      skillStreamRetryCountRef.current += 1;
      setSkillStatus(`流重连中 · ${skillStreamRetryCountRef.current}/3`);
    };
  };

  const openSkillEventSource = (sessionId: string, agentMessageId: string) => {
    activeSkillEventSourceRef.current?.close();
    const eventSource = subscribeDefAgentSession(sessionId, lastSkillStreamSeqRef.current);
    activeSkillEventSourceRef.current = eventSource;
    bindSkillEventSource(eventSource, agentMessageId);
  };

  const handleSkillStreamEvent = (event: MessageEvent, agentMessageId: string) => {
    if (typeof event.data !== 'string') return;
    let payload: DefAgentStreamEvent;
    try {
      payload = JSON.parse(event.data) as DefAgentStreamEvent;
    } catch (error) {
      setSkillStatus(`流事件解析失败 · ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const eventTurnId = payload.turnId || payload.clientTurnId;
    if (eventTurnId && eventTurnId !== agentMessageId) {
      const seq = Number(payload.seq || event.lastEventId || 0);
      if (seq && seq > lastSkillStreamSeqRef.current) {
        lastSkillStreamSeqRef.current = seq;
      }
      return;
    }
    const seq = Number(payload.seq || event.lastEventId || 0);
    if (seq && seq <= lastSkillStreamSeqRef.current) return;
    if (seq) lastSkillStreamSeqRef.current = seq;
    skillStreamRetryCountRef.current = 0;

    if (payload.sessionId || payload.sessionID) {
      const nextSessionId = payload.sessionId || payload.sessionID || null;
      rememberDefAgentSession(nextSessionId, payload.tokens || null, seq || undefined);
    }

    if (payload.type === 'done' || payload.type === 'stopped' || payload.type === 'error') {
      const stopped = payload.type === 'stopped';
      const error = payload.type === 'error';
      setIsSkillBusy(false);
      setSkillStatus(stopped ? '已打断' : error ? `异常 · ${payload.error || '流错误'}` : '已响应');
      activeSkillMessageIdRef.current = null;
      activeSkillEventSourceRef.current?.close();
      activeSkillEventSourceRef.current = null;
      setSkillMessages((prev) => prev.map((message) => (
        message.id === agentMessageId
          ? {
            ...message,
            isStreaming: false,
            text: error && !message.text ? (payload.error || '流错误') : message.text,
            activity: message.activity?.map((item) => ({
              ...item,
              status: item.status === 'done' ? item.status : stopped ? 'stopped' : error ? 'error' : 'done',
            })),
            loopSteps: stopped ? buildStoppedLoopSteps(message.loopSteps) : completeRunningSteps(message.loopSteps, error ? 'error' : 'done'),
            tokens: payload.tokens || message.tokens,
          }
          : message
      )));
      if (payload.tokens) {
        rememberDefAgentSession(activeSkillSessionIdRef.current, payload.tokens, seq || undefined);
      }
      return;
    }

    setSkillMessages((prev) => prev.map((message) => {
      if (message.id !== agentMessageId) return message;
      if (payload.type === 'session.created') {
        return {
          ...message,
          sessionId: payload.sessionId || payload.sessionID,
          activity: appendActivityItem(message.activity, {
            id: 'session-created',
            kind: 'step',
            title: '会话已建立',
            detail: `${selectedSkillTask.label} · ${labelThinkingEffort(thinkingEffort)}思考`,
            status: 'done',
          }),
        };
      }
      if (payload.type === 'message.start') {
        return {
          ...message,
          isStreaming: true,
          activity: appendActivityItem(message.activity, {
            id: `message-${payload.seq || Date.now()}`,
            kind: 'message',
            title: '发送消息',
            detail: '等待后台事件',
            status: 'running',
          }),
        };
      }
      if (payload.type === 'step.start') {
        const detail = labelBackendActor(payload.agent);
        return {
          ...message,
          activity: appendActivityItem(message.activity, {
            id: payload.messageId || `step-${payload.seq || Date.now()}`,
            kind: 'step',
            title: '处理资料',
            detail,
            status: 'running',
          }),
          loopSteps: [
            ...(message.loopSteps || []).map((step) => ({
              ...step,
              status: step.status === 'running' ? 'done' as const : step.status,
            })),
            { phase: 'think', label: '思考', detail: '理解请求和上下文', status: 'running' },
            { phase: 'act', label: '执行', detail: '查询或整理资料', status: 'pending' },
            { phase: 'observe', label: '观察', detail: '核对后台结果', status: 'pending' },
            { phase: 'answer', label: '回复', detail: '组织可读回答', status: 'pending' },
          ],
        };
      }
      if (payload.type === 'reasoning') {
        const status = payload.status === 'done' ? 'done' : 'running';
        return {
          ...message,
          activity: appendActivityItem(message.activity, {
            id: payload.partId || 'reasoning',
            kind: 'reasoning',
            title: '思考',
            detail: payload.summary || (status === 'done' ? '隐藏推理已保护' : '正在分析上下文'),
            status,
          }),
        };
      }
      if (payload.type === 'tool.start' || payload.type === 'tool.content' || payload.type === 'tool.error') {
        const status = payload.type === 'tool.error' ? 'error' : payload.status === 'done' ? 'done' : 'running';
        const toolLabel = labelToolName(payload.toolName);
        return {
          ...message,
          activity: appendActivityItem(message.activity, {
            id: payload.id || payload.partId || payload.callId || `tool-${payload.seq || Date.now()}`,
            kind: 'tool',
            title: toolLabel,
            detail: payload.summary || payload.title || (status === 'running' ? '运行中' : status === 'error' ? '执行异常' : '已返回结果'),
            result: payload.result || payload.error,
            status,
          }),
          loopSteps: (message.loopSteps || []).map((step) => (
            step.phase === 'act' && step.status === 'pending'
              ? { ...step, status: 'running' as const, detail: toolLabel }
              : step
          )),
        };
      }
      if (payload.type === 'text') {
        return {
          ...message,
          text: `${message.text}${payload.text || ''}`,
          loopSteps: (message.loopSteps || []).map((step) => (
            step.phase === 'answer' && step.status === 'pending'
              ? { ...step, status: 'running' as const }
              : step
          )),
        };
      }
      if (payload.type === 'step.finish') {
        if (payload.tokens) {
          rememberDefAgentSession(activeSkillSessionIdRef.current, payload.tokens, seq || undefined);
        }
        return {
          ...message,
          tokens: payload.tokens || message.tokens,
          activity: message.activity?.map((item) => ({
            ...item,
            status: item.status === 'running' ? 'done' : item.status,
          })),
          loopSteps: completeRunningSteps(message.loopSteps),
        };
      }
      return message;
    }));
  };

  const handleStopSkillMessage = () => {
    const activeMessageId = activeSkillMessageIdRef.current;
    const activeSessionId = activeSkillSessionIdRef.current;
    if (activeSessionId) {
      void stopDefAgentStream(activeSessionId).catch((error) => {
        setSkillStatus(`停止失败 · ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    activeSkillEventSourceRef.current?.close();
    activeSkillEventSourceRef.current = null;
    activeSkillMessageIdRef.current = null;
    setIsSkillBusy(false);
    setSkillStatus('已打断');
    setSkillMessages((prev) => prev.map((message) => (
      message.id === activeMessageId
        ? {
          ...message,
          isStreaming: false,
          activity: message.activity?.map((item) => ({
            ...item,
            status: item.status === 'done' ? item.status : 'stopped',
          })),
          loopSteps: buildStoppedLoopSteps(message.loopSteps),
        }
        : message
    )));
  };

  const handleStartNewSkillSession = () => {
    if (isSkillBusy) {
      handleStopSkillMessage();
    }
    rememberDefAgentSession(null);
    setSkillTokenUsage(null);
    lastSkillStreamSeqRef.current = 0;
    setSkillStatus('新对话已准备');
  };

  const handleSendSkillMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (isSkillBusy) {
      handleStopSkillMessage();
      return;
    }
    const message = skillInput.trim() || 'hi';
    const loopMessageId = `agent-loop-${Date.now()}`;
    const effortLabel = labelThinkingEffort(thinkingEffort);
    activeSkillMessageIdRef.current = loopMessageId;
    setSkillInput('');
    setIsSkillBusy(true);
    setSkillStatus(`正思考 · ${effortLabel}`);
    setSkillMessages((prev) => [
      ...prev,
      {
        role: 'user',
        text: message,
        meta: message.length > LONG_MESSAGE_LIMIT ? `长文本 ${message.length} 字，点击展开` : undefined,
      },
      {
        id: loopMessageId,
        role: 'agent',
        text: '',
        sessionId: activeSkillSessionIdRef.current || undefined,
        isStreaming: true,
        activity: [{
          id: 'stream-start',
          kind: 'step',
          title: '开始处理',
          detail: `${selectedSkillTask.label} · ${effortLabel}思考`,
          status: 'running',
        }],
      },
    ]);
    try {
      if (activeSkillSessionIdRef.current) {
        try {
          await sendDefAgentContinue(activeSkillSessionIdRef.current, message, loopMessageId, {
            thinkingEffort,
            skillId: selectedSkillTask.id,
          });
          openSkillEventSource(activeSkillSessionIdRef.current, loopMessageId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (!detail.includes('session-not-found') && !detail.includes('stream session not found')) {
            throw error;
          }
          rememberDefAgentSession(null);
          lastSkillStreamSeqRef.current = 0;
          const stream = await startDefAgentStream(message, {
            thinkingEffort,
            skillId: selectedSkillTask.id,
            clientTurnId: loopMessageId,
          });
          rememberDefAgentSession(stream.sessionId);
          activeSkillEventSourceRef.current?.close();
          activeSkillEventSourceRef.current = stream.eventSource;
          bindSkillEventSource(stream.eventSource, loopMessageId);
        }
      } else {
        lastSkillStreamSeqRef.current = 0;
        const stream = await startDefAgentStream(message, {
          thinkingEffort,
          skillId: selectedSkillTask.id,
          clientTurnId: loopMessageId,
        });
        rememberDefAgentSession(stream.sessionId);
        activeSkillEventSourceRef.current?.close();
        activeSkillEventSourceRef.current = stream.eventSource;
        bindSkillEventSource(stream.eventSource, loopMessageId);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setSkillStatus(text);
      setIsSkillBusy(false);
      activeSkillMessageIdRef.current = null;
      setSkillMessages((prev) => prev.map((item) => (
        item.id === loopMessageId
          ? {
            ...item,
            isStreaming: false,
            text,
            activity: item.activity?.map((activity) => ({
              ...activity,
              status: activity.status === 'done' ? activity.status : 'error',
            })),
            loopSteps: item.loopSteps?.map((step) => ({
              ...step,
              status: step.status === 'done' ? 'done' : 'error',
            })),
          }
          : item
      )));
    }
  };

  const handleSkillInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void handleSendSkillMessage();
  };

  const handleSkillPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData('text');
    if (pastedText.length > LONG_MESSAGE_LIMIT) {
      setSkillStatus(`已粘贴长文本 · ${pastedText.length} 字`);
    }
  };

  return (
    <main className="ai-cli-page">
      <section className="ai-cli-terminal-pane" aria-label="AI CLI Terminal">
        <pre className="ai-cli-terminal-output" ref={outputRef} data-testid="ai-cli-output">
          {lines.join('\n')}
        </pre>
        <form className="ai-cli-terminal-input-row" onSubmit={handleSubmit}>
          <span className="ai-cli-terminal-prompt">{prompt}</span>
          <input
            ref={inputRef}
            className="ai-cli-terminal-input"
            data-testid="ai-cli-input"
            value={commandText}
            onChange={(event) => setCommandText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (historyIndex === -1) {
                  setDraftInput(commandText);
                }
                const newIndex = historyIndex + 1;
                if (newIndex < history.length) {
                  setHistoryIndex(newIndex);
                  setCommandText(history[history.length - 1 - newIndex] ?? '');
                }
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (historyIndex <= 0) {
                  setHistoryIndex(-1);
                  setCommandText(draftInput);
                } else {
                  const newIndex = historyIndex - 1;
                  setHistoryIndex(newIndex);
                  setCommandText(history[history.length - 1 - newIndex] ?? '');
                }
                return;
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                const completions = getCommandCompletions(commandText);
                if (completions.length === 1) {
                  setCommandText(completions[0]! + ' ');
                } else if (completions.length > 1) {
                  const common = longestCommonPrefix(completions);
                  if (common && common !== commandText) {
                    setCommandText(common);
                  } else {
                    appendLines([info(`completions: ${completions.join(', ')} (可补全)`)]);
                  }
                }
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setCommandText('');
                setHistoryIndex(-1);
                setDraftInput('');
                return;
              }
              if (event.ctrlKey && event.key.toLowerCase() === 'l') {
                event.preventDefault();
                setLines(['DEF AI CLI', 'mode=buff.fill', 'type help']);
                return;
              }
            }}
            autoFocus
            spellCheck={false}
            aria-label="AI CLI command"
          />
        </form>
      </section>

      <aside className="ai-skill-pane" aria-label="def-opencode">
        <section className="ai-skill-console">
          <header className="ai-skill-topbar">
            <div className="ai-skill-title">
              <h1>def-opencode</h1>
              <p>{selectedSkillTask.label} · 像对话一样提交资料，后台整理为待审核修改。</p>
            </div>
            <div className="ai-skill-top-actions">
              <div className="ai-skill-effort-control" aria-label="思考力度">
                <span>思考</span>
                {THINKING_EFFORTS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={thinkingEffort === item.value ? 'is-active' : ''}
                    onClick={() => setThinkingEffort(item.value)}
                    disabled={isSkillBusy}
                    title={`${item.title}思考`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <span className={isSkillBusy ? 'ai-skill-status is-running' : 'ai-skill-status'}>
                {isSkillBusy ? '处理中' : '就绪'}
              </span>
              <button
                type="button"
                className={isSkillTaskPanelOpen ? 'ai-skill-menu-button is-active' : 'ai-skill-menu-button'}
                onClick={() => setIsSkillTaskPanelOpen((open) => !open)}
                aria-expanded={isSkillTaskPanelOpen}
                aria-label="打开任务能力面板"
                title="任务能力"
              >
                <SkillTaskIcon icon={selectedSkillTask.icon} />
                <span>{selectedSkillTask.label}</span>
                <svg className="ai-skill-chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </button>
            </div>
            {isSkillTaskPanelOpen ? (
              <div className="ai-skill-task-popover" role="menu">
                <div className="ai-skill-task-popover-title">能力面板</div>
                {SKILL_TASKS.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={task.id === selectedSkillTaskId ? 'ai-skill-task-option is-selected' : 'ai-skill-task-option'}
                    onClick={() => {
                      setSelectedSkillTaskId(task.id);
                      setIsSkillTaskPanelOpen(false);
                    }}
                    role="menuitem"
                  >
                    <span className="ai-skill-task-option-icon">
                      <SkillTaskIcon icon={task.icon} />
                    </span>
                    <span>
                      <strong>{task.label}</strong>
                      <small>{task.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </header>

          <div className="ai-skill-session-bar">
            <span>会话 {formatShortSessionId(activeDefSessionId)}</span>
            <strong className="ai-skill-tokens">{formatTokenUsage(skillTokenUsage)}</strong>
            <button type="button" onClick={handleStartNewSkillSession} disabled={isSkillBusy}>
              新对话
            </button>
          </div>

          <div className="ai-skill-chat-surface">
            <div className="ai-skill-messages" ref={skillMessagesRef}>
              {skillMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`ai-skill-message is-${message.role}`}>
                  <span>{message.role === 'user' ? '你' : message.role === 'agent' ? '后台' : '系统'}</span>
                  <SkillMessageBody message={message} />
                </div>
              ))}
            </div>
          </div>

          <form className="ai-skill-composer" onSubmit={handleSendSkillMessage}>
            <textarea
              ref={skillTextareaRef}
              value={skillInput}
              onChange={(event) => setSkillInput(event.target.value)}
              onKeyDown={handleSkillInputKeyDown}
              onPaste={handleSkillPaste}
              placeholder={`向${selectedSkillTask.label}说 hi，或粘贴资料`}
              rows={2}
            />
            <button type="submit">{isSkillBusy ? '停止' : '发送'}</button>
          </form>

          <div className="ai-skill-bottom-bar">
            <span>{skillStatus}</span>
            <strong>待审核修改 {pendingProposals.length}</strong>
          </div>

          {pendingProposals.length > 0 ? (
            <div className="ai-skill-proposal-drawer">
              {pendingProposals.slice(0, 3).map((proposal, index) => (
                <div key={proposal.id} className="ai-skill-proposal-card">
                  <strong>#{index + 1} · {proposal.domain}</strong>
                  <span>{proposal.summary || proposal.operation}</span>
                  <small>approval={proposal.approvalStatus} · save={proposal.saveStatus}</small>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </aside>
    </main>
  );
}

export function isAiCliPath(path: string) {
  return path === APP_ROUTE_PATHS.aiCli;
}

// Tab completion helpers
const ALL_COMMANDS = [
  'help',
  'spec',
  'agent.logs',
  'agent.sessions',
  'proposal.list',
  'proposal.show',
  'proposal.approve',
  'proposal.reject',
  'proposal.save',
  'proposal.unsave',
  'proposal.clear',
  'fill.task',
  'fill.task.copy',
  'fill.check',
  'fill.apply',
  'weapon.fill.task',
  'weapon.fill.check',
  'weapon.fill.apply',
];

function getCommandCompletions(input: string): string[] {
  const trimmed = input.trimStart();
  if (!trimmed) return [];
  const tokens = trimmed.split(/\s+/);
  const first = tokens[0] || '';
  if (tokens.length === 1) {
    return ALL_COMMANDS.filter((cmd) => cmd.startsWith(first));
  }
  if (tokens.length === 2 && first.startsWith('proposal.')) {
    const session = readAgentSession();
    const pending = readPendingAgentProposals(session?.id);
    return pending.map((_p: unknown, idx: number) => `#${idx + 1}`).filter((a: string) => a.startsWith(tokens[1] || ''));
  }
  return [];
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0]!;
  for (let i = 1; i < strings.length; i++) {
    const s = strings[i]!;
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}
