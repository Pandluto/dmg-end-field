import assert from 'node:assert/strict';
import type { DefEvent } from '../../../agent/core/contracts/events.ts';
import {
  asClientTurnId,
  asDefSessionId,
  asDefTurnId,
  asToolCallId,
} from '../../../agent/core/contracts/ids.ts';
import { findActiveAgentTurn, projectAgentTranscript } from './agentModeModel';

const defSessionId = asDefSessionId('def-session-model');
const firstTurnId = asDefTurnId('def-turn-one');
const secondTurnId = asDefTurnId('def-turn-two');
const toolCallId = asToolCallId('tool-call-one');

function event(value: Omit<DefEvent, 'schemaVersion' | 'occurredAt' | 'defSessionId'>): DefEvent {
  return {
    schemaVersion: 1,
    occurredAt: '2026-08-07T00:00:00.000Z',
    defSessionId,
    ...value,
  } as DefEvent;
}

const transcript = projectAgentTranscript([
  event({
    sequence: 1,
    type: 'session.ready',
    payload: { engineKind: 'opencode', engineRuntimeVersion: 'test' },
  }),
  event({
    sequence: 2,
    type: 'turn.accepted',
    defTurnId: firstTurnId,
    payload: { clientTurnId: asClientTurnId('client-one'), userMessage: '计算当前技能。' },
  }),
  event({
    sequence: 3,
    type: 'response.delta',
    defTurnId: firstTurnId,
    payload: { delta: '先读取' },
  }),
  event({
    sequence: 4,
    type: 'tool.requested',
    defTurnId: firstTurnId,
    toolCallId,
    payload: { name: 'def.read.timeline', risk: 'read', input: { scope: 'current' } },
  }),
  event({
    sequence: 5,
    type: 'tool.started',
    defTurnId: firstTurnId,
    toolCallId,
    payload: { name: 'def.read.timeline' },
  }),
  event({
    sequence: 6,
    type: 'tool.result',
    defTurnId: firstTurnId,
    toolCallId,
    payload: { result: { damage: 12345 } },
  }),
  event({
    sequence: 7,
    type: 'response.delta',
    defTurnId: firstTurnId,
    payload: { delta: '，再计算。' },
  }),
  event({
    sequence: 8,
    type: 'turn.completed',
    defTurnId: firstTurnId,
    payload: {},
  }),
  event({
    sequence: 9,
    type: 'turn.accepted',
    defTurnId: secondTurnId,
    payload: { clientTurnId: asClientTurnId('client-two'), userMessage: '继续。' },
  }),
  event({
    sequence: 10,
    type: 'tool.error',
    defTurnId: secondTurnId,
    toolCallId: asToolCallId('tool-call-two'),
    payload: { code: 'READ_FAILED', message: '读取失败' },
  }),
  event({
    sequence: 11,
    type: 'turn.failed',
    defTurnId: secondTurnId,
    payload: { code: 'TURN_FAILED', message: '无法完成' },
  }),
]);

assert.equal(transcript.length, 2);
assert.deepEqual(transcript[0], {
  defTurnId: firstTurnId,
  clientTurnId: asClientTurnId('client-one'),
  userMessage: '计算当前技能。',
  assistantText: '先读取，再计算。',
  tools: [{
    toolCallId,
    name: 'def.read.timeline',
    risk: 'read',
    input: { scope: 'current' },
    status: 'succeeded',
    result: { damage: 12345 },
  }],
  status: 'completed',
  terminalMessage: null,
});
assert.equal(transcript[1].status, 'failed');
assert.equal(transcript[1].terminalMessage, 'TURN_FAILED：无法完成');
assert.equal(transcript[1].tools[0].status, 'failed');
assert.equal(findActiveAgentTurn(transcript), null);

const activeTranscript = projectAgentTranscript([
  event({
    sequence: 1,
    type: 'turn.accepted',
    defTurnId: firstTurnId,
    payload: { clientTurnId: asClientTurnId('client-active'), userMessage: '还在运行。' },
  }),
]);
assert.equal(findActiveAgentTurn(activeTranscript)?.defTurnId, firstTurnId);

assert.throws(
  () => projectAgentTranscript([
    event({
      sequence: 2,
      type: 'turn.accepted',
      defTurnId: firstTurnId,
      payload: { clientTurnId: asClientTurnId('client-order'), userMessage: '顺序错误。' },
    }),
    event({
      sequence: 2,
      type: 'turn.completed',
      defTurnId: firstTurnId,
      payload: {},
    }),
  ]),
  /strictly increasing/,
);
