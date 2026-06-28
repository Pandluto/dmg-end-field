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
  sendDefAgentMessage,
  stopDefAgentMessage,
  type DefAgentActivityItem,
  type DefAgentChatResult,
  type DefAgentLoopStep,
  type DefAgentThinkingEffort,
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
  activity?: DefAgentActivityItem[];
  loopSteps?: DefAgentLoopStep[];
};

const THINKING_EFFORTS: Array<{ value: DefAgentThinkingEffort; label: string; title: string }> = [
  { value: 'low', label: '快', title: '快速' },
  { value: 'medium', label: '中', title: '标准' },
  { value: 'high', label: '深', title: '深入' },
];

const LONG_MESSAGE_LIMIT = 1600;

function labelThinkingEffort(value: DefAgentThinkingEffort) {
  return THINKING_EFFORTS.find((item) => item.value === value)?.title || '标准';
}

function buildRunningLoopSteps(thinkingEffort: DefAgentThinkingEffort, taskLabel: string): DefAgentLoopStep[] {
  return [
    {
      phase: 'think',
      label: '思考',
      detail: `${labelThinkingEffort(thinkingEffort)}模式分析输入、当前能力和缺失条件`,
      status: 'running',
    },
    {
      phase: 'act',
      label: '执行',
      detail: `准备调用 ${taskLabel} skill / 模型运行时`,
      status: 'pending',
    },
    {
      phase: 'observe',
      label: '观察',
      detail: '等待工具或模型返回',
      status: 'pending',
    },
    {
      phase: 'answer',
      label: '回复',
      detail: '整理为用户可读输出',
      status: 'pending',
    },
  ];
}

function buildStoppedLoopSteps(steps: DefAgentLoopStep[] = []): DefAgentLoopStep[] {
  const fallback = buildRunningLoopSteps('medium', '当前');
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
    return (
      <>
        {message.activity?.length ? <SkillAgentActivity activity={message.activity} /> : null}
        {!message.activity?.length && message.loopSteps?.length ? <SkillAgentLoop steps={message.loopSteps} /> : null}
        {message.text ? <div className="ai-skill-markdown">{renderMarkdown(message.text)}</div> : null}
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

function buildSkillProgressActivity(stage: 0 | 1 | 2 | 3, taskLabel: string, thinkingLabel: string): DefAgentActivityItem[] {
  const items: DefAgentActivityItem[] = [
    {
      id: 'pending-open-code',
      kind: 'step',
      title: '接入 OpenCode',
      detail: `${taskLabel} · ${thinkingLabel}思考`,
      status: stage > 0 ? 'done' : 'running',
    },
    {
      id: 'pending-think',
      kind: 'reasoning',
      title: '思考',
      detail: '分析输入和缺失条件',
      status: stage > 1 ? 'done' : stage === 1 ? 'running' : 'pending',
    },
    {
      id: 'pending-act',
      kind: 'tool',
      title: '执行',
      detail: '交给当前能力处理',
      status: stage > 2 ? 'done' : stage === 2 ? 'running' : 'pending',
    },
    {
      id: 'pending-answer',
      kind: 'message',
      title: '回复',
      detail: '整理为用户可读结果',
      status: stage === 3 ? 'running' : 'pending',
    },
  ];
  return items.filter((item) => item.status !== 'pending');
}

function SkillAgentActivity({ activity }: { activity: DefAgentActivityItem[] }) {
  return (
    <div className="ai-agent-activity" aria-label="OpenCode activity">
      {activity.map((item, index) => (
        <div key={item.id || `${item.kind}-${index}`} className={`ai-agent-activity-item is-${item.status}`}>
          <span>{labelActivityKind(item.kind)}</span>
          <div>
            <strong>{item.title}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </div>
          <em>{labelActivityStatus(item.status)}</em>
        </div>
      ))}
    </div>
  );
}

function SkillAgentLoop({ steps }: { steps: DefAgentLoopStep[] }) {
  return (
    <div className="ai-agent-loop" aria-label="Agent loop">
      {steps.map((step) => (
        <div key={step.phase} className={`ai-agent-loop-step is-${step.status}`}>
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
  const activeSkillRequestRef = useRef<AbortController | null>(null);
  const activeSkillMessageIdRef = useRef<string | null>(null);
  const skillProgressTimersRef = useRef<number[]>([]);
  const skillTypewriterTimerRef = useRef<number | null>(null);
  const lastAgentLogIdRef = useRef<string | null>(null);
  const lastPreviewProposalIdRef = useRef<string | null>(null);

  // Command history state
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [draftInput, setDraftInput] = useState<string>('');

  const [sessionId, setSessionId] = useState(() => ensureActiveSession('web-cli').id);
  const [skillInput, setSkillInput] = useState('hi');
  const [skillStatus, setSkillStatus] = useState('等待输入');
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

  const fetchAgentRecordsSnapshot = async (reason: string) => {
    try {
      const response = await fetch('http://127.0.0.1:17321/api/agent/records', { cache: 'no-store' });
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
    void fetchAgentRecordsSnapshot('startup');
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
    activeSkillRequestRef.current?.abort();
    skillProgressTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    if (skillTypewriterTimerRef.current !== null) {
      window.clearTimeout(skillTypewriterTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return undefined;
    }

    const events = new EventSource('http://127.0.0.1:17321/api/agent/events');
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
      appendLines([info('agent SSE reconnecting or AI REST is offline')]);
      void fetchAgentRecordsSnapshot('sse-error');
    };

    return () => {
      events.close();
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

  const clearSkillProgressTimers = () => {
    skillProgressTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    skillProgressTimersRef.current = [];
    if (skillTypewriterTimerRef.current !== null) {
      window.clearTimeout(skillTypewriterTimerRef.current);
      skillTypewriterTimerRef.current = null;
    }
  };

  const startSkillProgress = (messageId: string, taskLabel: string, effortLabel: string) => {
    clearSkillProgressTimers();
    ([1, 2, 3] as const).forEach((stage, index) => {
      const timer = window.setTimeout(() => {
        if (activeSkillMessageIdRef.current !== messageId) {
          return;
        }
        setSkillMessages((prev) => prev.map((message) => (
          message.id === messageId
            ? { ...message, activity: buildSkillProgressActivity(stage, taskLabel, effortLabel) }
            : message
        )));
      }, [700, 1900, 3600][index]);
      skillProgressTimersRef.current.push(timer);
    });
  };

  const revealSkillText = (messageId: string, fullText: string) => {
    const text = fullText || '后台没有返回内容';
    if (text.length < 140) {
      setSkillMessages((prev) => prev.map((message) => (
        message.id === messageId ? { ...message, text } : message
      )));
      return;
    }

    const checkpoints = Array.from(new Set([
      Math.min(text.length, 90),
      Math.min(text.length, 220),
      ...text
        .split(/(?<=。|！|？|\n\n)/)
        .reduce<number[]>((points, chunk) => {
          const previous = points[points.length - 1] || 0;
          const next = Math.min(text.length, previous + chunk.length);
          if (next - previous >= 40 || chunk.includes('\n\n')) {
            points.push(next);
          }
          return points;
        }, []),
      text.length,
    ])).filter((point) => point > 0).slice(0, 10);

    const reveal = (index: number) => {
      const point = checkpoints[index] ?? text.length;
      setSkillMessages((prev) => prev.map((message) => (
        message.id === messageId ? { ...message, text: text.slice(0, point) } : message
      )));
      if (point >= text.length) {
        skillTypewriterTimerRef.current = null;
        return;
      }
      skillTypewriterTimerRef.current = window.setTimeout(() => reveal(index + 1), 140);
    };

    reveal(0);
  };

  const handleStopSkillMessage = () => {
    const activeMessageId = activeSkillMessageIdRef.current;
    void stopDefAgentMessage().catch((error) => {
      setSkillStatus(`停止失败 · ${error instanceof Error ? error.message : String(error)}`);
    });
    clearSkillProgressTimers();
    activeSkillRequestRef.current?.abort();
    activeSkillRequestRef.current = null;
    activeSkillMessageIdRef.current = null;
    setIsSkillBusy(false);
    setSkillStatus('已打断');
    setSkillMessages((prev) => prev.map((message) => (
      message.id === activeMessageId
        ? {
          ...message,
          text: '已停止当前响应。',
          activity: message.activity?.map((item) => ({
            ...item,
            status: item.status === 'done' ? item.status : 'stopped',
          })),
          loopSteps: buildStoppedLoopSteps(message.loopSteps),
        }
        : message
    )));
  };

  const handleSendSkillMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (isSkillBusy) {
      handleStopSkillMessage();
      return;
    }
    const message = skillInput.trim() || 'hi';
    const controller = new AbortController();
    const loopMessageId = `agent-loop-${Date.now()}`;
    const effortLabel = labelThinkingEffort(thinkingEffort);
    activeSkillRequestRef.current = controller;
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
        activity: buildSkillProgressActivity(0, selectedSkillTask.label, effortLabel),
      },
    ]);
    startSkillProgress(loopMessageId, selectedSkillTask.label, effortLabel);
    try {
      const result: DefAgentChatResult = await sendDefAgentMessage(message, {
        thinkingEffort,
        skillId: selectedSkillTask.id,
        signal: controller.signal,
      });
      clearSkillProgressTimers();
      setSkillStatus(result.realOpenCode ? `已响应 · OpenCode · ${result.model || 'DeepSeek'}` : '已响应 · 本地运行时');
      setSkillMessages((prev) => prev.map((item) => (
        item.id === loopMessageId
          ? {
            ...item,
            text: '',
            activity: result.activity?.length ? result.activity : item.activity,
            loopSteps: result.steps?.length ? result.steps : item.loopSteps?.map((step) => ({ ...step, status: 'done' as const })),
          }
          : item
      )));
      revealSkillText(loopMessageId, result.content || result.error || '后台没有返回内容');
    } catch (error) {
      clearSkillProgressTimers();
      if (error instanceof DOMException && error.name === 'AbortError') {
        setSkillStatus('已打断');
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      setSkillStatus(text);
      setSkillMessages((prev) => prev.map((item) => (
        item.id === loopMessageId
          ? {
            ...item,
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
    } finally {
      if (activeSkillRequestRef.current === controller) {
        activeSkillRequestRef.current = null;
      }
      if (activeSkillMessageIdRef.current === loopMessageId) {
        activeSkillMessageIdRef.current = null;
      }
      setIsSkillBusy(false);
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

      <aside className="ai-skill-pane" aria-label="智能录入">
        <section className="ai-skill-console">
          <header className="ai-skill-topbar">
            <div className="ai-skill-title">
              <h1>智能录入</h1>
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
