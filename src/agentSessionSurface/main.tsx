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

  const submitPrompt = async (prompt: string) => {
    lastSubmittedPrompt = prompt;
    await client.startTurn(launch.defSessionId, prompt);
    const status = store.getState().status;
    if (status === 'disconnected' || status === 'error') {
      void store.reconnect().catch(() => undefined);
    }
  };

  mountAgentSessionSurface({
    root,
    store,
    sessionId: launch.defSessionId,
    connect: true,
    onSubmitPrompt: submitPrompt,
    actions: {
      onStop: (context) => client.stopTurn(launch.defSessionId, context.turnId),
      onRetry: async () => {
        const prompt = latestUserPrompt(store.getState().snapshot) ?? lastSubmittedPrompt;
        if (prompt) await submitPrompt(prompt);
      },
    },
  });
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
