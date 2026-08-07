import type { DefEvent } from '../../../agent/core/contracts/events.ts';
import type {
  ClientTurnId,
  DefTurnId,
  ToolCallId,
} from '../../../agent/core/contracts/ids.ts';
import type { JsonValue } from '../../../agent/core/contracts/json.ts';

export type AgentToolStatus = 'requested' | 'running' | 'succeeded' | 'failed';
export type AgentTurnStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';

export interface AgentToolView {
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly risk: 'read' | 'propose' | 'mutate' | null;
  readonly input: JsonValue | null;
  readonly status: AgentToolStatus;
  readonly result?: JsonValue;
  readonly code?: string;
  readonly message?: string;
}

export interface AgentTurnView {
  readonly defTurnId: DefTurnId;
  readonly clientTurnId: ClientTurnId | null;
  readonly userMessage: string;
  readonly assistantText: string;
  readonly tools: readonly AgentToolView[];
  readonly status: AgentTurnStatus;
  readonly terminalMessage: string | null;
}

interface MutableAgentToolView {
  toolCallId: ToolCallId;
  name: string;
  risk: AgentToolView['risk'];
  input: JsonValue | null;
  status: AgentToolStatus;
  result?: JsonValue;
  code?: string;
  message?: string;
}

interface MutableAgentTurnView {
  defTurnId: DefTurnId;
  clientTurnId: ClientTurnId | null;
  userMessage: string;
  assistantText: string;
  tools: MutableAgentToolView[];
  toolIndex: Map<ToolCallId, MutableAgentToolView>;
  status: AgentTurnStatus;
  terminalMessage: string | null;
}

function terminalMessage(code: string, message?: string): string {
  return message ? `${code}：${message}` : code;
}

function createTurn(defTurnId: DefTurnId): MutableAgentTurnView {
  return {
    defTurnId,
    clientTurnId: null,
    userMessage: '',
    assistantText: '',
    tools: [],
    toolIndex: new Map(),
    status: 'running',
    terminalMessage: null,
  };
}

function getTool(turn: MutableAgentTurnView, toolCallId: ToolCallId, name = '未知工具'): MutableAgentToolView {
  const existing = turn.toolIndex.get(toolCallId);
  if (existing) return existing;
  const tool: MutableAgentToolView = {
    toolCallId,
    name,
    risk: null,
    input: null,
    status: 'requested',
  };
  turn.tools.push(tool);
  turn.toolIndex.set(toolCallId, tool);
  return tool;
}

/**
 * Rebuilds the complete visible transcript from the authoritative DEF Event Journal.
 * The input must be one strictly increasing session stream; malformed streams fail closed.
 */
export function projectAgentTranscript(events: readonly DefEvent[]): readonly AgentTurnView[] {
  const turns: MutableAgentTurnView[] = [];
  const turnIndex = new Map<DefTurnId, MutableAgentTurnView>();
  let previousSequence = 0;
  let defSessionId: string | null = null;

  const getTurn = (defTurnId: DefTurnId): MutableAgentTurnView => {
    const existing = turnIndex.get(defTurnId);
    if (existing) return existing;
    const turn = createTurn(defTurnId);
    turns.push(turn);
    turnIndex.set(defTurnId, turn);
    return turn;
  };

  for (const event of events) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) {
      throw new Error('DEF Event Journal sequence must be strictly increasing.');
    }
    if (defSessionId !== null && event.defSessionId !== defSessionId) {
      throw new Error('DEF Event Journal cannot mix sessions.');
    }
    previousSequence = event.sequence;
    defSessionId = event.defSessionId;
    if (!('defTurnId' in event)) continue;

    const turn = getTurn(event.defTurnId);
    switch (event.type) {
      case 'turn.accepted':
        turn.clientTurnId = event.payload.clientTurnId;
        turn.userMessage = event.payload.userMessage;
        break;
      case 'response.delta':
        turn.assistantText += event.payload.delta;
        break;
      case 'tool.requested': {
        const tool = getTool(turn, event.toolCallId, event.payload.name);
        tool.name = event.payload.name;
        tool.risk = event.payload.risk;
        tool.input = event.payload.input;
        tool.status = 'requested';
        break;
      }
      case 'tool.started': {
        const tool = getTool(turn, event.toolCallId, event.payload.name);
        tool.name = event.payload.name;
        tool.status = 'running';
        break;
      }
      case 'tool.result': {
        const tool = getTool(turn, event.toolCallId);
        tool.status = 'succeeded';
        tool.result = event.payload.result;
        delete tool.code;
        delete tool.message;
        break;
      }
      case 'tool.error': {
        const tool = getTool(turn, event.toolCallId);
        tool.status = 'failed';
        tool.code = event.payload.code;
        tool.message = event.payload.message;
        break;
      }
      case 'turn.completed':
        if (turn.status === 'running') turn.status = 'completed';
        break;
      case 'turn.stopped':
        if (turn.status === 'running') {
          turn.status = 'stopped';
          turn.terminalMessage = terminalMessage(event.payload.code, event.payload.message);
        }
        break;
      case 'turn.failed':
        if (turn.status === 'running') {
          turn.status = 'failed';
          turn.terminalMessage = terminalMessage(event.payload.code, event.payload.message);
        }
        break;
      case 'turn.interrupted':
        if (turn.status === 'running') {
          turn.status = 'interrupted';
          turn.terminalMessage = terminalMessage(event.payload.code, event.payload.message);
        }
        break;
      default:
        break;
    }
  }

  return turns.map(({ toolIndex: _toolIndex, tools, ...turn }) => ({
    ...turn,
    tools: tools.map((tool) => ({ ...tool })),
  }));
}

export function findActiveAgentTurn(turns: readonly AgentTurnView[]): AgentTurnView | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].status === 'running') return turns[index];
  }
  return null;
}
