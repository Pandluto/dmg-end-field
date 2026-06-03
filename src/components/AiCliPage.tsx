import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  const lastAgentLogIdRef = useRef<string | null>(null);

  // Command history state
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [draftInput, setDraftInput] = useState<string>('');

  const [sessionId, setSessionId] = useState(() => ensureActiveSession('web-cli').id);

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

  const appendLines = (nextLines: string[]) => {
    setLines((prev) => [...prev, ...nextLines]);
    window.setTimeout(() => {
      outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
    }, 0);
  };

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return undefined;
    }

    const events = new EventSource('http://127.0.0.1:17321/api/agent/events');
    events.addEventListener('agent.records', (event) => {
      try {
        const payload = JSON.parse(event.data) as {
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
        // Handoff external proposals first
        if (payload.proposals && payload.proposals.length > 0) {
          const currentSessionId = syncSessionId();
          const handoff = importExternalProposals(payload.proposals, currentSessionId);
          if (handoff.lines.length > 0) {
            appendLines(handoff.lines);
          }
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
      } catch {
        appendLines([fail('agent SSE event parse failed')]);
      }
    });

    events.onerror = () => {
      appendLines([info('agent SSE reconnecting or AI REST is offline')]);
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

  return (
    <main className="ai-cli-page">
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
