import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  assistantPartsForMessage,
  isActiveSessionStatus,
  isPinnedToBottom,
  lastAssistantTextPartId,
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
  const latestTurnId = props.snapshot?.messages.at(-1)?.defTurnId;

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
  const userText = props.turn.userMessage
    ? textPartsForMessage(props.turn, props.turn.userMessage)[0]
    : undefined;
  const lastTextId = lastAssistantTextPartId(props.turn);
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
      <div data-slot="session-turn-message-content" aria-live="off">
        {props.turn.userMessage ? (
          <UserMessageDisplay
            message={props.turn.userMessage}
            textPart={userText}
            actions={props.actions}
            context={actionContext}
          />
        ) : null}
      </div>
      {props.turn.compactionParts.length > 0 ? (
        <div data-slot="session-turn-compaction">
          {props.turn.compactionParts.map((part) => <MessageDivider key={part.id} part={part} />)}
        </div>
      ) : null}
      {props.turn.assistantMessages.length > 0 ? (
        <div data-slot="session-turn-assistant-content" aria-live="polite">
          <AssistantParts
            messages={props.turn.assistantMessages}
            partsForMessage={(message) => assistantPartsForMessage(props.turn, message)}
            lastTextId={lastTextId}
            actions={props.actions}
            context={actionContext}
          />
        </div>
      ) : null}
      {props.working && props.turn.assistantMessages.length === 0 ? (
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

function UserMessageDisplay(props: {
  readonly message: ConversationMessage;
  readonly textPart?: ConversationTextPart;
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const text = props.textPart?.text ?? '';
  const handleCopy = async () => {
    if (!text) return;
    await copyText(text, { ...props.context, messageId: props.message.id, partId: props.textPart?.id }, props.actions);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };
  return (
    <div data-component="user-message" data-timeline-part-id={props.textPart?.id}>
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

function AssistantParts(props: {
  readonly messages: readonly ConversationMessage[];
  readonly partsForMessage: (message: ConversationMessage) => readonly ConversationPart[];
  readonly lastTextId: string | null;
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element {
  return (
    <>
      {props.messages.map((message) => (
        <AssistantMessageParts
          key={message.id}
          parts={props.partsForMessage(message)}
          lastTextId={props.lastTextId}
          actions={props.actions}
          context={props.context}
        />
      ))}
    </>
  );
}

function AssistantMessageParts(props: {
  readonly parts: readonly ConversationPart[];
  readonly lastTextId: string | null;
  readonly actions?: SessionSurfaceActions;
  readonly context: SessionSurfaceActionContext;
}): JSX.Element {
  return (
    <>
      {props.parts.map((part) => (
        <MessagePart
          key={part.id}
          part={part}
          showCopy={part.id === props.lastTextId}
          actions={props.actions}
          context={props.context}
        />
      ))}
    </>
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
      return <InteractionDisplay part={props.part} />;
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

function InteractionDisplay(props: { readonly part: ConversationInteractionPart }): JSX.Element {
  const resolved = props.part.state.status === 'resolved';
  return (
    <div
      data-component="question-card"
      data-interaction-id={props.part.interactionId}
      data-interaction-kind={props.part.interactionKind}
      data-interaction-status={props.part.state.status}
      data-timeline-part-id={props.part.id}
    >
      <div data-slot="question-header">Interaction · {props.part.interactionKind === 'approval' ? 'Approval' : 'Question'}</div>
      <div data-slot="question-text">{props.part.prompt}</div>
      <div data-slot="question-footer">
        {resolved ? `${props.part.state.resolution} · resolved by DEF Host` : 'pending · awaiting DEF Host'}
      </div>
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
      {props.text.split(/\r?\n/).map((line, index) => (
        <p key={`${index}:${line}`}>{line || '\u00a0'}</p>
      ))}
    </div>
  );
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
              disabled={!snapshot || state?.status === 'loading' || isActiveSessionStatus(snapshot)}
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
        placeholder="Ask DEF Agent…"
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
        {pending ? 'Sending…' : 'Send'}
      </button>
      {error ? <div data-slot="session-prompt-error" role="alert">{error}</div> : null}
    </form>
  );
}

export function snapshotFromState(state: ConversationStoreState | null): ConversationSnapshot | null {
  return state?.snapshot ?? null;
}
