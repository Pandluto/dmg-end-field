import type {
  AgentEventPage,
  AgentTurnAbortResult,
  AgentTurnAccepted,
} from '../../../agent/core/contracts/browser-protocol.ts';
import type { DefEvent } from '../../../agent/core/contracts/events.ts';
import type { DefSessionId, DefTurnId } from '../../../agent/core/contracts/ids.ts';
import { DesktopAgentBridgeError } from './desktopAgentBridgeError';

type RecordValue = Record<string, unknown>;

const EVENT_TYPES = new Set([
  'session.ready', 'session.recovered', 'session.archived', 'session.orphaned',
  'turn.accepted', 'response.first-token', 'response.delta', 'tool.requested',
  'tool.started', 'tool.result', 'tool.error', 'harness.routed',
  'harness.phase.entered', 'harness.tool.projected', 'harness.terminal',
  'interaction.requested', 'interaction.resolved', 'command.queued',
  'command.dispatched', 'command.claimed', 'command.committed', 'command.result',
  'command.reconciled', 'command.orphaned', 'turn.completed', 'turn.stopped',
  'turn.interrupted', 'turn.failed',
]);
const SESSION_EVENTS = new Set([
  'session.ready', 'session.recovered', 'session.archived', 'session.orphaned',
]);
const TOOL_EVENTS = new Set([
  'tool.requested', 'tool.started', 'tool.result', 'tool.error',
  'command.queued', 'command.dispatched', 'command.claimed', 'command.committed',
  'command.result', 'command.reconciled', 'command.orphaned',
]);
const INTERACTION_EVENTS = new Set(['interaction.requested', 'interaction.resolved']);
const COMMAND_EVENTS = new Set([
  'command.queued', 'command.dispatched', 'command.claimed', 'command.committed',
  'command.result', 'command.reconciled', 'command.orphaned',
]);
const BASE_KEYS = ['schemaVersion', 'sequence', 'occurredAt', 'defSessionId', 'type', 'payload'];
const COMMAND_BINDING_KEYS = [
  'workspaceId', 'databaseGeneration', 'timelineId', 'checkoutTargetId', 'beforeRevision',
];

function record(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => json(entry, depth + 1));
  return record(value) && Object.values(value).every((entry) => json(entry, depth + 1));
}

function exact(value: RecordValue, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function own(value: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function string(value: RecordValue, key: string): boolean {
  return typeof value[key] === 'string';
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function commandBinding(payload: RecordValue): boolean {
  return string(payload, 'workspaceId')
    && string(payload, 'databaseGeneration')
    && string(payload, 'timelineId')
    && nullableString(payload.checkoutTargetId)
    && finite(payload.beforeRevision);
}

export function isSafeProductEventShape(event: RecordValue): boolean {
  const type = event.type;
  if (typeof type !== 'string' || !EVENT_TYPES.has(type) || !record(event.payload)) return false;
  const payload = event.payload;
  const required = SESSION_EVENTS.has(type)
    ? BASE_KEYS
    : COMMAND_EVENTS.has(type)
      ? [...BASE_KEYS, 'defTurnId', 'toolCallId', 'commandId']
      : INTERACTION_EVENTS.has(type)
        ? [...BASE_KEYS, 'defTurnId', 'interactionId']
        : TOOL_EVENTS.has(type)
          ? [...BASE_KEYS, 'defTurnId', 'toolCallId']
          : [...BASE_KEYS, 'defTurnId'];
  const optional = COMMAND_EVENTS.has(type)
    ? ['interactionId']
    : INTERACTION_EVENTS.has(type)
      ? ['toolCallId']
      : [];
  if (!exact(event, required, optional)) return false;
  if (!SESSION_EVENTS.has(type) && typeof event.defTurnId !== 'string') return false;
  if (TOOL_EVENTS.has(type) && typeof event.toolCallId !== 'string') return false;
  if (INTERACTION_EVENTS.has(type) && typeof event.interactionId !== 'string') return false;
  if (own(event, 'toolCallId') && typeof event.toolCallId !== 'string') return false;
  if (COMMAND_EVENTS.has(type) && typeof event.commandId !== 'string') return false;
  if (own(event, 'interactionId') && typeof event.interactionId !== 'string') return false;

  switch (type) {
    case 'session.ready':
    case 'session.recovered':
      return exact(payload, ['engineKind', 'engineRuntimeVersion'])
        && string(payload, 'engineKind') && string(payload, 'engineRuntimeVersion');
    case 'session.archived':
      return exact(payload, ['reason']) && string(payload, 'reason');
    case 'session.orphaned':
    case 'turn.failed':
      return exact(payload, ['code', 'message']) && string(payload, 'code') && string(payload, 'message');
    case 'turn.accepted':
      return exact(payload, ['clientTurnId', 'userMessage'])
        && string(payload, 'clientTurnId') && string(payload, 'userMessage');
    case 'response.first-token':
      return exact(payload, []);
    case 'response.delta':
      return exact(payload, ['delta']) && string(payload, 'delta');
    case 'tool.requested':
      return exact(payload, ['name', 'risk', 'input'])
        && string(payload, 'name')
        && oneOf(payload.risk, ['read', 'propose', 'mutate'])
        && json(payload.input);
    case 'tool.started':
      return exact(payload, ['name']) && string(payload, 'name');
    case 'tool.result':
      return exact(payload, ['result']) && json(payload.result);
    case 'tool.error':
      return exact(payload, ['code', 'message'], ['details'])
        && string(payload, 'code') && string(payload, 'message')
        && (!own(payload, 'details') || json(payload.details));
    case 'harness.routed':
      return exact(payload, ['businessId', 'operation', 'revision', 'sourceLineage', 'contentHash'])
        && oneOf(payload.businessId, ['selection', 'loadout', 'timeline', 'buff', 'calculation'])
        && oneOf(payload.operation, ['inspect', 'current', 'resolve', 'calculate'])
        && string(payload, 'revision') && string(payload, 'sourceLineage') && string(payload, 'contentHash');
    case 'harness.phase.entered':
      return exact(payload, ['businessId', 'operation', 'phaseId', 'phaseKind'])
        && (payload.businessId === null
          || oneOf(payload.businessId, ['selection', 'loadout', 'timeline', 'buff', 'calculation']))
        && (payload.operation === null
          || oneOf(payload.operation, ['inspect', 'current', 'resolve', 'calculate']))
        && string(payload, 'phaseId')
        && oneOf(payload.phaseKind, ['route', 'context', 'evidence', 'response']);
    case 'harness.tool.projected':
      return exact(payload, ['projectionRevision', 'tools'])
        && finite(payload.projectionRevision)
        && Array.isArray(payload.tools)
        && payload.tools.every((tool) => typeof tool === 'string');
    case 'harness.terminal':
      return exact(payload, ['businessId', 'operation', 'phaseId', 'terminalState'], ['code'])
        && (payload.businessId === null
          || oneOf(payload.businessId, ['selection', 'loadout', 'timeline', 'buff', 'calculation']))
        && (payload.operation === null
          || oneOf(payload.operation, ['inspect', 'current', 'resolve', 'calculate']))
        && string(payload, 'phaseId')
        && oneOf(payload.terminalState, ['completed', 'aborted'])
        && (!own(payload, 'code') || typeof payload.code === 'string');
    case 'interaction.requested':
      return exact(payload, ['kind', 'prompt', 'expiresAt'])
        && oneOf(payload.kind, ['question', 'approval'])
        && string(payload, 'prompt') && string(payload, 'expiresAt');
    case 'interaction.resolved':
      return exact(payload, ['status'], ['value'])
        && oneOf(payload.status, ['answered', 'approved', 'rejected', 'expired', 'cancelled', 'stale'])
        && (!own(payload, 'value') || json(payload.value));
    case 'command.queued':
    case 'command.dispatched':
      return exact(payload, [...COMMAND_BINDING_KEYS, 'op', 'afterRevision', 'browserReceiptDigest'])
        && commandBinding(payload) && string(payload, 'op')
        && payload.afterRevision === null && payload.browserReceiptDigest === null;
    case 'command.claimed':
      return exact(payload, [
        ...COMMAND_BINDING_KEYS, 'executorLeaseId', 'afterRevision', 'browserReceiptDigest',
      ])
        && commandBinding(payload) && string(payload, 'executorLeaseId')
        && payload.afterRevision === null && string(payload, 'browserReceiptDigest');
    case 'command.committed':
      return exact(payload, [...COMMAND_BINDING_KEYS, 'afterRevision', 'browserReceiptDigest'])
        && commandBinding(payload) && finite(payload.afterRevision) && string(payload, 'browserReceiptDigest');
    case 'command.result':
    case 'command.reconciled':
      return exact(
        payload,
        [...COMMAND_BINDING_KEYS, 'status', 'afterRevision', 'browserReceiptDigest'],
        ['code', 'message'],
      )
        && commandBinding(payload)
        && oneOf(payload.status, [
          'succeeded', 'committed', 'not-executed', 'rejected', 'conflict', 'error', 'orphaned',
        ])
        && (payload.afterRevision === null || finite(payload.afterRevision))
        && nullableString(payload.browserReceiptDigest)
        && (!own(payload, 'code') || typeof payload.code === 'string')
        && (!own(payload, 'message') || typeof payload.message === 'string');
    case 'command.orphaned':
      return exact(payload, [
        ...COMMAND_BINDING_KEYS, 'code', 'message', 'afterRevision', 'browserReceiptDigest',
      ])
        && commandBinding(payload) && string(payload, 'code') && string(payload, 'message')
        && payload.afterRevision === null && nullableString(payload.browserReceiptDigest);
    case 'turn.completed':
      return exact(payload, [], ['output']) && (!own(payload, 'output') || json(payload.output));
    case 'turn.stopped':
      return exact(payload, ['code'], ['message'])
        && string(payload, 'code') && (!own(payload, 'message') || typeof payload.message === 'string');
    case 'turn.interrupted':
      return exact(payload, ['code', 'message', 'reconcileRequiredCommandIds'])
        && string(payload, 'code') && string(payload, 'message')
        && Array.isArray(payload.reconcileRequiredCommandIds)
        && payload.reconcileRequiredCommandIds.every((id) => typeof id === 'string');
    default:
      return false;
  }
}

function asDefEvent(
  value: unknown,
  defSessionId: string,
  afterSequence: number,
): DefEvent {
  if (!record(value)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的事件。', 'INVALID_HOST_RESPONSE');
  }
  if (
    value.schemaVersion !== 1
    || !Number.isSafeInteger(value.sequence)
    || Number(value.sequence) !== afterSequence + 1
    || value.defSessionId !== defSessionId
    || typeof value.occurredAt !== 'string'
    || typeof value.type !== 'string'
    || !record(value.payload)
    || !isSafeProductEventShape(value)
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了不兼容的事件。', 'INVALID_HOST_RESPONSE');
  }
  return value as unknown as DefEvent;
}

export function parseProductEventPage(
  payload: unknown,
  expectedSessionId: DefSessionId,
  expectedAfterSequence: number,
  limit: number,
): AgentEventPage {
  if (
    !record(payload)
    || !exact(payload, [
      'protocolVersion', 'defSessionId', 'afterSequence', 'nextSequence', 'hasMore', 'events',
    ])
    || payload.protocolVersion !== 2
    || payload.defSessionId !== expectedSessionId
    || payload.afterSequence !== expectedAfterSequence
    || !Number.isSafeInteger(payload.nextSequence)
    || Number(payload.nextSequence) < expectedAfterSequence
    || typeof payload.hasMore !== 'boolean'
    || !Array.isArray(payload.events)
    || payload.events.length > limit
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的事件页。', 'INVALID_HOST_RESPONSE');
  }
  let cursor = expectedAfterSequence;
  const events = payload.events.map((event) => {
    const parsed = asDefEvent(event, expectedSessionId, cursor);
    cursor = parsed.sequence;
    return parsed;
  });
  if (payload.nextSequence !== cursor) {
    throw new DesktopAgentBridgeError('Agent Host 事件游标不连续。', 'INVALID_HOST_RESPONSE');
  }
  return { ...payload, events } as unknown as AgentEventPage;
}

export function parseTurnAbortResult(
  payload: RecordValue,
  expectedTurnId: DefTurnId,
): AgentTurnAbortResult {
  if (
    !exact(payload, ['protocolVersion', 'defTurnId', 'stopped'])
    || payload.protocolVersion !== 2
    || payload.defTurnId !== expectedTurnId
    || payload.stopped !== true
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的停止结果。', 'INVALID_HOST_RESPONSE');
  }
  return payload as unknown as AgentTurnAbortResult;
}

export function parseTurnAccepted(
  payload: RecordValue,
  expectedSessionId: DefSessionId,
): AgentTurnAccepted {
  if (
    !exact(payload, ['protocolVersion', 'defSessionId', 'defTurnId', 'clientTurnId'])
    || payload.protocolVersion !== 2
    || payload.defSessionId !== expectedSessionId
    || typeof payload.defTurnId !== 'string'
    || typeof payload.clientTurnId !== 'string'
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 Turn。', 'INVALID_HOST_RESPONSE');
  }
  return payload as unknown as AgentTurnAccepted;
}
