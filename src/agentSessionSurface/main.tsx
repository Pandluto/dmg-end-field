import './styles/session-surface.css';
import type { ConversationSnapshot } from '../../agent/core/contracts/conversation.ts';
import { BrowserConversationStore } from './conversation-store.ts';
import {
  AgentUiHttpClient,
  readAgentUiLaunchConfig,
} from './components/agent-ui-http-client.ts';
import {
  mountAgentSessionSurface,
} from './components/mount.tsx';

export * from './components/SessionSurface.tsx';
export * from './components/mount.tsx';
export * from './components/session-model.ts';
export * from './components/agent-ui-http-client.ts';
export { OPENCODE_SESSION_SURFACE_PROVENANCE } from './components/opencode-provenance.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Agent Session Surface root is missing');

try {
  const launch = readAgentUiLaunchConfig();
  const client = new AgentUiHttpClient(launch);
  const store = new BrowserConversationStore(client);
  let lastSubmittedPrompt = '';
  let reconnectTimer: number | null = null;
  let reconnectDelay = 250;
  let connection: Promise<void> | null = null;

  const scheduleReconnect = () => {
    if (reconnectTimer !== null || connection) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connectConversation();
    }, reconnectDelay);
    reconnectDelay = Math.min(4_000, reconnectDelay * 2);
  };

  const connectConversation = (force = false): Promise<void> => {
    if (connection && !force) return connection;
    const pending = store.connect(launch.defSessionId);
    connection = pending;
    void pending.catch(() => undefined).finally(() => {
      if (connection !== pending) return;
      connection = null;
      const status = store.getState().status;
      if (status === 'disconnected' || status === 'error') scheduleReconnect();
    });
    return pending;
  };

  store.subscribe((state) => {
    if (state.status === 'ready' || state.status === 'loading' || state.status === 'reconnecting') {
      reconnectDelay = 250;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      return;
    }
    if (state.status === 'disconnected' || state.status === 'error') scheduleReconnect();
  });

  const submitPrompt = async (prompt: string) => {
    const snapshot = store.getState().snapshot;
    const status = snapshot?.status;
    if (status?.status === 'waiting-interaction') {
      throw new Error('请先回答上方问题，再继续对话。');
    }
    const activeTurnId = activeDefTurnId(snapshot);
    try {
      if (activeTurnId) {
        await client.steerTurn(launch.defSessionId, activeTurnId, prompt);
      } else {
        lastSubmittedPrompt = prompt;
        await client.startTurn(launch.defSessionId, prompt);
      }
    } finally {
      // Re-anchor on the accepted Turn before consuming deltas. This closes
      // the snapshot/SSE race and also materializes a Host-side preflight
      // failure without requiring a full Workbench refresh.
      void connectConversation(true).catch(() => undefined);
    }
  };

  mountAgentSessionSurface({
    root,
    store,
    sessionId: launch.defSessionId,
    connect: false,
    onSubmitPrompt: submitPrompt,
    actions: {
      onStop: async (context) => {
        try {
          await client.stopTurn(launch.defSessionId, context.turnId);
        } finally {
          void connectConversation(true).catch(() => undefined);
        }
      },
      onRespondInteraction: async (input) => {
        try {
          await client.respondInteraction(input.interactionId, input.status, input.value);
        } finally {
          void connectConversation(true).catch(() => undefined);
        }
      },
      onRetry: async () => {
        const prompt = latestUserPrompt(store.getState().snapshot) ?? lastSubmittedPrompt;
        if (prompt) await submitPrompt(prompt);
      },
    },
  });
  void connectConversation().catch(() => undefined);
} catch (error) {
  mountAgentSessionSurface({
    root,
    launchError: error instanceof Error ? error.message : 'Agent UI launch configuration is invalid',
  });
}

function latestUserPrompt(snapshot: ConversationSnapshot | null): string | null {
  if (!snapshot) return null;
  const parts = new Map(snapshot.parts.map((part) => [part.id, part] as const));
  for (let messageIndex = snapshot.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = snapshot.messages[messageIndex];
    if (!message || message.role !== 'user') continue;
    for (let partIndex = message.partIds.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts.get(message.partIds[partIndex]!);
      if (part?.type === 'text' && part.text.trim()) return part.text;
    }
  }
  return null;
}

function activeDefTurnId(snapshot: ConversationSnapshot | null): string | null {
  if (!snapshot) return null;
  if (
    snapshot.status.status === 'running'
    || snapshot.status.status === 'waiting-tool'
    || snapshot.status.status === 'waiting-interaction'
  ) return String(snapshot.status.defTurnId);
  if (snapshot.status.status === 'compacting') {
    return snapshot.messages.at(-1)?.defTurnId ? String(snapshot.messages.at(-1)!.defTurnId) : null;
  }
  return null;
}
