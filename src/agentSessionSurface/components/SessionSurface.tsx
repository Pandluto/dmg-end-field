import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ConversationErrorPart,
  ConversationInteractionPart,
  ConversationMessage,
  ConversationPart,
  ConversationReasoningPart,
  ConversationSnapshot,
  ConversationTextPart,
} from '../../../agent/core/contracts/conversation.ts';
import type { DefSessionId } from '../../../agent/core/contracts/ids.ts';
import type { ConversationStore, ConversationStoreState } from '../conversation-store.ts';
import {
  isActiveSessionStatus,
  isPinnedToBottom,
  lastAssistantTextPartId,
  orderedPartsForMessage,
  scrollElementToBottom,
  selectConversationTurns,
  textPartsForMessage,
  type ConversationTurnView,
} from './session-model.ts';
import { ToolPartView } from './basic-tool.tsx';
import { IconButton, TextReveal, TextShimmer } from './opencode-primitives.tsx';

export interface SessionSurfaceActionContext {
  readonly sessionId: DefSessionId;
  readonly turnId: string;
  readonly messageId?: string;
  readonly partId?: string;
}

export interface SessionSurfaceActions {
  readonly onCopy?: (text: string, context: SessionSurfaceActionContext) => void | Promise<void>;
  readonly onStop?: (context: SessionSurfaceActionContext) => void | Promise<void>;
  readonly onRetry?: (context: SessionSurfaceActionContext) => void | Promise<void>;
  readonly onRespondInteraction?: (input: SessionSurfaceInteractionResponse) => void | Promise<void>;
}

export interface SessionSurfaceInteractionResponse extends SessionSurfaceActionContext {
  readonly interactionId: string;
  readonly interactionKind: 'question' | 'approval';
  readonly status: 'answered' | 'approved' | 'rejected';
  readonly value?: string;
}

export interface SessionSurfaceProps {
  readonly snapshot: ConversationSnapshot | null;
  readonly actions?: SessionSurfaceActions;
  readonly turnId?: ConversationMessage['defTurnId'];
  readonly className?: string;
  readonly onUserInteracted?: () => void;
}

/**
 * OpenCode SessionTurn / message-part mechanical port.
 *
 * View state comes only from the P4 snapshot. React state below is limited to
 * local disclosure, copy feedback and scroll intent; it is never a second
 * transcript or event store.
 */
export function SessionSurface(props: SessionSurfaceProps): JSX.Element {
  const turns = useMemo(
    () => selectConversationTurns(props.snapshot, props.turnId),
    [props.snapshot, props.turnId],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const interactedRef = useRef(false);
  const working = isActiveSessionStatus(props.snapshot);
  const latestTurnId = activeSnapshotTurnId(props.snapshot)
    ?? props.snapshot?.messages[props.snapshot.messages.length - 1]?.defTurnId;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    scrollElementToBottom(element);
  }, [props.snapshot?.cursor.runtimeSequence, props.snapshot?.cursor.hostSequence, turns.length, latestTurnId, working]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const pinned = isPinnedToBottom(element);
    pinnedRef.current = pinned;
    if (!pinned && !interactedRef.current) {
      interactedRef.current = true;
      props.onUserInteracted?.();
    }
  };

  if (turns.length === 0 || !props.snapshot) {
    return (
      <div data-component="session-turn" className={props.className}>
        <div data-slot="session-turn-content" ref={scrollRef} onScroll={handleScroll}>
          <div data-component="session-surface-empty">等待 Conversation Snapshot</div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-component="session-turn"
      data-session-id={props.snapshot?.defSessionId}
      data-turn-id={latestTurnId}
      data-session-status={props.snapshot?.status.status}
      className={props.className}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-slot="session-turn-content"
      >
        <div data-slot="session-turn-content-inner">
          {turns.map((turn) => (
            <ConversationTurnBlock
              key={turn.turnId}
              turn={turn}
              snapshot={props.snapshot!}
              actions={props.actions}
              working={working && turn.turnId === latestTurnId}
              retryable={props.snapshot?.status.status === 'error' && turn.turnId === latestTurnId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ConversationTurnBlock(props: {
  readonly turn: ConversationTurnView;
  readonly snapshot: ConversationSnapshot;
  readonly actions?: SessionSurfaceActions;
  readonly working: boolean;
  readonly retryable: boolean;
}): JSX.Element {
  const lastTextId = lastAssistantTextPartId(props.turn);
  const latestMessage = props.turn.messages[props.turn.messages.length - 1];
  const latestMessageParts = latestMessage
    ? orderedPartsForMessage(props.turn, latestMessage)
    : [];
  const showThinking = props.working
    && props.snapshot.status.status !== 'waiting-interaction'
    && (
    latestMessage?.role === 'user'
    || (latestMessage?.role === 'assistant' && latestMessageParts.length === 0)
  );
  const actionContext: SessionSurfaceActionContext = {
    sessionId: props.snapshot.defSessionId,
    turnId: String(props.turn.turnId),
  };
  return (
    <section
      data-component="session-turn-block"
      data-turn-id={props.turn.turnId}
      data-message={props.turn.userMessage?.id}
      data-slot="session-turn-message-container"
    >
      {props.turn.messages.map((message) => {
        if (message.role === 'user') {
          return (
            <div key={message.id} data-slot="session-turn-message-content" aria-live="off">
              <UserMessageDisplay
                message={message}
                textParts={textPartsForMessage(props.turn, message)}
                actions={props.actions}
                context={actionContext}
              />
            </div>
          );
        }
        const parts = orderedPartsForMessage(props.turn, message);
        return (
          <div key={message.id} data-slot="session-turn-assistant-content" aria-live="polite">
            {parts.map((part) => (
              part.type === 'compaction'
                ? <MessageDivider key={part.id} part={part} />
                : (
                  <MessagePart
                    key={part.id}
                    part={part}
                    showCopy={part.id === lastTextId}
                    actions={props.actions}
                    context={actionContext}
                  />
                )
            ))}
          </div>
        );
      })}
      {showThinking ? (
        <div data-slot="session-turn-thinking">
          <TextShimmer text="Thinking" active />
          <TextReveal text="" className="session-turn-thinking-heading" />
        </div>
      ) : null}
      {props.actions?.onStop && props.working ? (
        <div data-slot="session-turn-actions" data-state="working">
          <IconButton
            icon="stop"
            label="Stop"
            onClick={() => void props.actions?.onStop?.(actionContext)}
          />
        </div>
      ) : null}
      {props.actions?.onRetry && props.retryable ? (
        <div data-slot="session-turn-actions" data-state="error">
          <IconButton
            icon="reset"
            label="Retry"
            onClick={() => void props.actions?.onRetry?.(actionContext)}
          />
        </div>
      ) : null}
    </section>
  );
}

function activeSnapshotTurnId(snapshot: ConversationSnapshot | null): ConversationMessage['defTurnId'] | null {
  if (!snapshot) return null;
  const status = snapshot.status;
  return status.status === 'running'
    || status.status === 'waiting-tool'
    || status.status === 'waiting-interaction'
    ? status.defTurnId
    : null;
}

function UserMessageDisplay(props: {
  readonly message: ConversationMessage;
  readonly textParts: readonly ConversationTextPart[];
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const text = props.textParts.map((part) => part.text).filter(Boolean).join('\n');
  const handleCopy = async () => {
    if (!text) return;
    await copyText(text, { ...props.context, messageId: props.message.id, partId: props.textParts[0]?.id }, props.actions);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };
  return (
    <div data-component="user-message" data-timeline-part-id={props.textParts[0]?.id}>
      {text ? (
        <>
          <div data-slot="user-message-body">
            <div data-slot="user-message-text"><HighlightedText text={text} /></div>
          </div>
          <div data-slot="user-message-copy-wrapper">
            <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy message'} onClick={() => void handleCopy()} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function MessagePart(props: {
  readonly part: ConversationPart;
  readonly showCopy: boolean;
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element | null {
  switch (props.part.type) {
    case 'text':
      return <TextPartDisplay part={props.part} showCopy={props.showCopy} actions={props.actions} context={props.context} />;
    case 'reasoning':
      return <ReasoningPartDisplay part={props.part} />;
    case 'tool':
      return <ToolPartView part={props.part} />;
    case 'interaction':
      return <InteractionDisplay part={props.part} actions={props.actions} context={props.context} />;
    case 'error':
      return <ErrorPartDisplay part={props.part} actions={props.actions} context={props.context} />;
    case 'compaction':
    case 'file':
      return null;
    default:
      return null;
  }
}

function TextPartDisplay(props: {
  readonly part: ConversationTextPart;
  readonly showCopy: boolean;
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element | null {
  const [copied, setCopied] = useState(false);
  if (!props.part.text) return null;
  const handleCopy = async () => {
    await copyText(
      props.part.text,
      { ...props.context, messageId: props.part.messageId, partId: props.part.id },
      props.actions,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };
  return (
    <div data-component="text-part" data-timeline-part-id={props.part.id}>
      <div data-slot="text-part-body"><Markdown text={props.part.text} /></div>
      {props.showCopy ? (
        <div data-slot="text-part-copy-wrapper">
          <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy response'} onClick={() => void handleCopy()} />
        </div>
      ) : null}
    </div>
  );
}

function ReasoningPartDisplay(props: { readonly part: ConversationReasoningPart }): JSX.Element | null {
  if (!props.part.text) return null;
  return (
    <details data-component="reasoning-part" data-timeline-part-id={props.part.id}>
      <summary data-slot="reasoning-summary">
        <span>思考过程</span>
        <small>点击展开</small>
      </summary>
      <div data-slot="reasoning-content">
        <Markdown text={props.part.text} />
      </div>
    </details>
  );
}

function InteractionDisplay(props: {
  readonly part: ConversationInteractionPart;
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element {
  const resolved = props.part.state.status === 'resolved';
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options = interactionOptions(props.part);
  const respond = async (
    status: SessionSurfaceInteractionResponse['status'],
    value?: string,
  ) => {
    if (resolved || pending || !props.actions?.onRespondInteraction) return;
    setPending(true);
    setError(null);
    try {
      await props.actions.onRespondInteraction({
        ...props.context,
        interactionId: String(props.part.interactionId),
        interactionKind: props.part.interactionKind,
        status,
        ...(value === undefined ? {} : { value }),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Interaction response failed');
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      data-component="question-card"
      data-interaction-id={props.part.interactionId}
      data-interaction-kind={props.part.interactionKind}
      data-interaction-status={props.part.state.status}
      data-timeline-part-id={props.part.id}
    >
      <div data-slot="question-header">{props.part.interactionKind === 'approval' ? '需要确认' : '需要你的回答'}</div>
      <div data-slot="question-text"><Markdown text={props.part.prompt} /></div>
      {!resolved && props.part.interactionKind === 'question' ? (
        <div data-slot="question-actions">
          {options.length > 0 ? (
            <div data-slot="question-options">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  data-slot="question-option"
                  disabled={pending}
                  onClick={() => void respond('answered', option)}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          <form
            data-slot="question-custom-answer"
            onSubmit={(event) => {
              event.preventDefault();
              const value = answer.trim();
              if (value) void respond('answered', value);
            }}
          >
            <input
              value={answer}
              disabled={pending}
              aria-label="自定义回答"
              placeholder={options.length > 0 ? '或输入其他回答' : '输入回答'}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <button type="submit" disabled={pending || !answer.trim()}>回答</button>
          </form>
        </div>
      ) : null}
      {!resolved && props.part.interactionKind === 'approval' ? (
        <div data-slot="question-approval-actions">
          <button type="button" disabled={pending} onClick={() => void respond('rejected')}>拒绝</button>
          <button type="button" data-primary="true" disabled={pending} onClick={() => void respond('approved')}>确认</button>
        </div>
      ) : null}
      {resolved ? (
        <div data-slot="question-footer">
          {interactionResolutionLabel(props.part)}
        </div>
      ) : null}
      {pending ? <div data-slot="question-footer">正在提交…</div> : null}
      {error ? <div data-slot="question-error" role="alert">{error}</div> : null}
    </div>
  );
}

function ErrorPartDisplay(props: {
  readonly part: ConversationErrorPart;
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element {
  return (
    <div
      data-component="card"
      data-variant="error"
      data-timeline-part-id={props.part.id}
      className="error-card"
    >
      <div data-slot="card-title">{props.part.code}</div>
      <div data-slot="card-description">{props.part.message}</div>
      {props.part.retryable && props.actions?.onRetry ? (
        <div data-slot="card-actions">
          <IconButton
            icon="reset"
            label="Retry"
            onClick={() => void props.actions?.onRetry?.({ ...props.context, messageId: props.part.messageId, partId: props.part.id })}
          />
        </div>
      ) : null}
    </div>
  );
}

function MessageDivider(props: {
  readonly part: Extract<ConversationPart, { type: 'compaction' }>;
}): JSX.Element {
  return (
    <div data-component="compaction-part" data-timeline-part-id={props.part.id}>
      <div data-slot="compaction-part-divider">
        <span data-slot="compaction-part-line" />
        <span data-slot="compaction-part-label">{compactionLabel(props.part)}</span>
        <span data-slot="compaction-part-line" />
      </div>
    </div>
  );
}

function Markdown(props: { readonly text: string }): JSX.Element {
  return (
    <div data-component="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
          table: ({ children }) => <div data-slot="markdown-table-wrap"><table>{children}</table></div>,
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

function interactionOptions(part: ConversationInteractionPart): readonly string[] {
  const details = part.payload?.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const options = (details as Record<string, unknown>).options;
  if (!Array.isArray(options)) return [];
  return options.filter((option): option is string => typeof option === 'string' && Boolean(option.trim()));
}

function interactionResolutionLabel(part: ConversationInteractionPart): string {
  if (part.state.status !== 'resolved') return '';
  const labels: Record<typeof part.state.resolution, string> = {
    answered: '已回答',
    approved: '已确认',
    rejected: '已拒绝',
    expired: '已过期',
    cancelled: '已取消',
    stale: '已失效',
  };
  const value = Object.prototype.hasOwnProperty.call(part.state, 'value')
    ? formatInteractionValue(part.state.value)
    : '';
  return value ? `${labels[part.state.resolution]}：${value}` : labels[part.state.resolution];
}

function formatInteractionValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function HighlightedText(props: { readonly text: string }): JSX.Element {
  return <span>{props.text}</span>;
}

function compactionLabel(part: Extract<ConversationPart, { type: 'compaction' }>): string {
  return part.summary?.trim() || `${part.reason} compaction`;
}

async function copyText(
  text: string,
  context: SessionSurfaceActionContext,
  actions?: SessionSurfaceActions,
): Promise<void> {
  if (actions?.onCopy) {
    await actions.onCopy(text, context);
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

export interface ConversationSurfaceMountProps {
  readonly store?: ConversationStore;
  readonly snapshot?: ConversationSnapshot | null;
  readonly sessionId?: DefSessionId;
  readonly actions?: SessionSurfaceActions;
  readonly turnId?: ConversationMessage['defTurnId'];
  readonly connect?: boolean;
  readonly theme?: string;
  readonly onUserInteracted?: () => void;
  readonly onSubmitPrompt?: (prompt: string) => void | Promise<void>;
  readonly launchError?: string;
}

export function AgentSessionSurface(props: ConversationSurfaceMountProps): JSX.Element {
  const [state, setState] = useState<ConversationStoreState | null>(() => props.store?.getState() ?? null);
  const snapshot = props.store ? state?.snapshot ?? null : props.snapshot ?? null;
  const storeStatus = props.store ? state?.status ?? 'empty' : snapshot ? 'ready' : 'empty';

  useEffect(() => {
    if (!props.store) return undefined;
    setState(props.store.getState());
    return props.store.subscribe(setState);
  }, [props.store]);

  useEffect(() => {
    if (!props.theme || typeof document === 'undefined') return undefined;
    document.documentElement.dataset.theme = props.theme;
    return undefined;
  }, [props.theme]);

  useEffect(() => {
    if (!props.connect || !props.store || !props.sessionId) return undefined;
    let disposed = false;
    void props.store.connect(props.sessionId).catch(() => {
      if (!disposed) setState(props.store?.getState() ?? null);
    });
    return () => {
      disposed = true;
      props.store?.disconnect();
    };
  }, [props.connect, props.sessionId, props.store]);

  return (
    <div data-component="agent-session-surface" data-store-status={storeStatus}>
      {props.launchError ? (
        <div data-component="session-surface-status" data-state="error" role="alert">
          {props.launchError}
        </div>
      ) : (
        <>
          <SessionSurface
            snapshot={snapshot}
            actions={props.actions}
            turnId={props.turnId}
            onUserInteracted={props.onUserInteracted}
          />
          {state?.error ? (
            <div data-component="session-surface-status" data-state="error" role="alert">
              {state.error.message}
            </div>
          ) : null}
          {props.onSubmitPrompt ? (
            <PromptComposer
              disabled={!snapshot || state?.status === 'loading' || snapshot.status.status === 'waiting-interaction'}
              mode={isActiveSessionStatus(snapshot) ? 'steer' : 'prompt'}
              onSubmit={props.onSubmitPrompt}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function PromptComposer(props: {
  readonly disabled: boolean;
  readonly mode: 'prompt' | 'steer';
  readonly onSubmit: (prompt: string) => void | Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const prompt = draft.trim();
    if (!prompt || pending || props.disabled) return;
    setPending(true);
    setError(null);
    try {
      await props.onSubmit(prompt);
      setDraft('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Prompt failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      data-component="session-prompt"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        data-slot="session-prompt-input"
        aria-label="Prompt"
        placeholder={props.mode === 'steer' ? '输入补充指引…' : '向 DEF Agent 提问…'}
        rows={1}
        value={draft}
        disabled={props.disabled || pending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          void submit();
        }}
      />
      <button
        type="submit"
        data-slot="session-prompt-submit"
        disabled={props.disabled || pending || !draft.trim()}
      >
        {pending ? '发送中…' : props.mode === 'steer' ? '引导' : '发送'}
      </button>
      {error ? <div data-slot="session-prompt-error" role="alert">{error}</div> : null}
    </form>
  );
}

export function snapshotFromState(state: ConversationStoreState | null): ConversationSnapshot | null {
  return state?.snapshot ?? null;
}
