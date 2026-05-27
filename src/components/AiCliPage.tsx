import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createAiCliCommandRequest,
  fail,
  formatDraftSummary,
  info,
  readCurrentBuffDraft,
  runAiCliCommand,
  summarizeAiCliCommand,
} from '../aiCli/aiCliCommandService';
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
  const lastAgentLogIdRef = useRef<string | null>(null);

  const prompt = useMemo(() => `def:${currentDraft.id}>`, [currentDraft.id]);

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
          }>;
        };
        const latestLog = payload.operationLogs?.[0];
        if (!latestLog?.id || latestLog.id === lastAgentLogIdRef.current) {
          return;
        }
        lastAgentLogIdRef.current = latestLog.id;
        appendLines([
          `[agent] ${latestLog.client || '-'} ${latestLog.ok ? 'ok' : 'err'} ${latestLog.writes ? 'write' : 'read'} ${latestLog.command || '-'}${latestLog.errorCode ? ` error=${latestLog.errorCode}` : ''}`,
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
          className="ai-cli-terminal-input"
          data-testid="ai-cli-input"
          value={commandText}
          onChange={(event) => setCommandText(event.target.value)}
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
