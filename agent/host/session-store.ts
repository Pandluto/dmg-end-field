import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  asClientTurnId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asEngineSessionId,
  asTimelineId,
  asWorkspaceId,
  type ClientTurnId,
  type DefEvent,
  type DefSessionId,
  type DefSessionV6,
  type DefTurnId,
  type ProductBinding,
} from '../core/contracts/index.ts';

export const DEF_AGENT_SESSION_STORE_SCHEMA_VERSION = 1 as const;

export type DefAgentSessionStoreErrorCode =
  | 'INVALID_ROOT'
  | 'SYMLINK_ESCAPE'
  | 'INVALID_SESSION_ID'
  | 'INVALID_PROFILE_REF'
  | 'INVALID_RECORD'
  | 'CORRUPT_REGISTRY'
  | 'CORRUPT_METADATA'
  | 'CORRUPT_EVENT_JOURNAL'
  | 'IO_ERROR'
  | 'SESSION_EXISTS'
  | 'SESSION_NOT_FOUND'
  | 'CLIENT_TURN_CONFLICT'
  | 'ACTIVE_SESSION_NOT_FOUND';

export class DefAgentSessionStoreError extends Error {
  readonly code: DefAgentSessionStoreErrorCode;
  readonly target: string | null;

  constructor(code: DefAgentSessionStoreErrorCode, message: string, target: string | null = null) {
    super(message);
    this.name = 'DefAgentSessionStoreError';
    this.code = code;
    this.target = target;
  }
}

export interface DefAcceptedClientTurn {
  readonly clientTurnId: ClientTurnId;
  readonly userMessage: string;
  readonly result: {
    readonly defTurnId: DefTurnId;
    readonly clientTurnId: ClientTurnId;
  };
  readonly acceptedAt: string;
}

export type DefAcceptedClientTurnInput = Omit<DefAcceptedClientTurn, 'acceptedAt'> & {
  readonly acceptedAt?: string;
};

export interface DefAgentSessionRecord {
  readonly session: DefSessionV6;
  readonly binding: ProductBinding;
  /** This is a profile reference only. Provider credentials must never be placed here. */
  readonly providerProfileRef: string;
  readonly acceptedClientTurns: readonly DefAcceptedClientTurn[];
}

export interface DefAgentSessionStoreSnapshot {
  readonly activeSessionId: DefSessionId | null;
  readonly sessions: readonly DefAgentSessionRecord[];
  readonly events: ReadonlyMap<DefSessionId, readonly DefEvent[]>;
}

export interface DefAgentSessionStore {
  load(): DefAgentSessionStoreSnapshot;
  loadSession(defSessionId: DefSessionId): DefAgentSessionRecord | null;
  loadEvents(defSessionId: DefSessionId): readonly DefEvent[];
  loadAcceptedClientTurn(
    defSessionId: DefSessionId,
    clientTurnId: ClientTurnId,
  ): DefAcceptedClientTurn | null;
  create(record: DefAgentSessionRecord): void;
  update(record: DefAgentSessionRecord): void;
  acceptClientTurn(defSessionId: DefSessionId, turn: DefAcceptedClientTurnInput): void;
  append(defSessionId: DefSessionId, event: DefEvent): void;
  delete(defSessionId: DefSessionId): void;
  setActive(defSessionId: DefSessionId | null): void;
}

export interface FileDefAgentSessionStoreOptions {
  readonly root: string;
}

interface RegistryFile {
  readonly schemaVersion: typeof DEF_AGENT_SESSION_STORE_SCHEMA_VERSION;
  readonly activeSessionId: string | null;
  readonly sessionIds: readonly string[];
}

interface MetadataFile {
  readonly schemaVersion: typeof DEF_AGENT_SESSION_STORE_SCHEMA_VERSION;
  readonly session: DefSessionV6;
  readonly binding: ProductBinding;
  readonly providerProfileRef: string;
  readonly acceptedClientTurns: readonly DefAcceptedClientTurn[];
}

interface JournalScan {
  readonly events: readonly DefEvent[];
  readonly validByteLength: number;
  readonly tail: 'none' | 'incomplete' | 'complete-no-newline';
}

const PORTABLE_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const PORTABLE_PROFILE_REF_PATTERN = PORTABLE_ID_PATTERN;
const SESSION_DIRECTORY_NAME = 'sessions';
const REGISTRY_FILE_NAME = 'registry.json';
const METADATA_FILE_NAME = 'metadata.json';
const EVENTS_FILE_NAME = 'events.ndjson';
const EVENT_TYPES: ReadonlySet<string> = new Set([
  'session.ready',
  'session.recovered',
  'session.archived',
  'session.orphaned',
  'turn.accepted',
  'response.first-token',
  'response.delta',
  'tool.requested',
  'tool.started',
  'tool.result',
  'tool.error',
  'harness.routed',
  'harness.phase.entered',
  'harness.tool.projected',
  'harness.terminal',
  'interaction.requested',
  'interaction.resolved',
  'command.queued',
  'command.dispatched',
  'command.claimed',
  'command.committed',
  'command.result',
  'command.reconciled',
  'command.orphaned',
  'turn.completed',
  'turn.stopped',
  'turn.interrupted',
  'turn.failed',
]);
const SESSION_STATUSES: ReadonlySet<string> = new Set([
  'binding-pending',
  'creating',
  'create-failed',
  'ready',
  'engine-unavailable',
  'archived',
  'binding-missing',
  'orphaned',
  'deleting',
  'delete-failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingError(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(
  code: DefAgentSessionStoreErrorCode,
  message: string,
  target: string | null = null,
): never {
  throw new DefAgentSessionStoreError(code, message, target);
}

function normalizePath(root: string): string {
  if (typeof root !== 'string' || !root.trim()) {
    fail('INVALID_ROOT', 'Session store root must be a non-empty path');
  }
  return path.resolve(root);
}

function assertNoSymlinkComponents(target: string, label: string): void {
  // Parent aliases such as macOS /tmp -> /private/var are normal. Every
  // store directory/file itself is checked at its boundary by this helper;
  // callers check each known child directory before descending into it.
  let stats;
  try {
    stats = lstatSync(target);
  } catch (error) {
    if (isMissingError(error)) return;
    fail('IO_ERROR', `Unable to inspect ${label}: ${errorMessage(error)}`, target);
  }
  if (stats.isSymbolicLink()) {
    fail('SYMLINK_ESCAPE', `${label} is a symbolic link`, target);
  }
}

function assertDirectory(target: string, label: string, create = false): void {
  assertNoSymlinkComponents(target, label);
  if (create) {
    try {
      mkdirSync(target, { recursive: true, mode: 0o700 });
    } catch (error) {
      fail('IO_ERROR', `Unable to create ${label}: ${errorMessage(error)}`, target);
    }
  }
  let stats;
  try {
    stats = lstatSync(target);
  } catch (error) {
    fail('INVALID_ROOT', `${label} does not exist`, target);
  }
  if (stats.isSymbolicLink()) {
    fail('SYMLINK_ESCAPE', `${label} is a symbolic link`, target);
  }
  if (!stats.isDirectory()) {
    fail('INVALID_ROOT', `${label} is not a directory`, target);
  }
}

function assertRegularFile(target: string, label: string, allowMissing = false): boolean {
  let stats;
  try {
    stats = lstatSync(target);
  } catch (error) {
    if (allowMissing && isMissingError(error)) return false;
    fail('IO_ERROR', `Unable to inspect ${label}: ${errorMessage(error)}`, target);
  }
  if (stats.isSymbolicLink()) {
    fail('SYMLINK_ESCAPE', `${label} is a symbolic link`, target);
  }
  if (!stats.isFile()) {
    fail('IO_ERROR', `${label} is not a regular file`, target);
  }
  return true;
}

function assertPathWithinRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('SYMLINK_ESCAPE', 'Resolved store path escapes the configured root', target);
  }
}

function assertPortableId(
  value: unknown,
  label: string,
  code: 'INVALID_SESSION_ID' | 'INVALID_PROFILE_REF' | 'INVALID_RECORD' = 'INVALID_RECORD',
): string {
  if (typeof value !== 'string' || !PORTABLE_ID_PATTERN.test(value)) {
    fail(code, `${label} must be a portable ASCII identifier`, typeof value === 'string' ? value : null);
  }
  return value;
}

function assertProfileRef(value: unknown): string {
  if (typeof value !== 'string' || !PORTABLE_PROFILE_REF_PATTERN.test(value)) {
    fail('INVALID_PROFILE_REF', 'providerProfileRef must be a portable profile reference, not a secret or path', null);
  }
  return value;
}

function assertIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || value !== value.trim()
    || value.includes('\u0000')
  ) {
    fail('INVALID_RECORD', `${label} must be a non-empty identifier`, null);
  }
  return value;
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) {
    fail('INVALID_RECORD', `${label} must be non-empty text`, null);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_RECORD', `${label} must be a non-negative safe integer`, null);
  }
  return value;
}

function assertDateText(value: unknown, label: string): string {
  const text = assertText(value, label);
  if (Number.isNaN(Date.parse(text))) {
    fail('INVALID_RECORD', `${label} must be a parseable date`, null);
  }
  return text;
}

function assertBinding(value: unknown, session: DefSessionV6 | null = null): ProductBinding {
  if (!isRecord(value)) fail('INVALID_RECORD', 'ProductBinding must be an object', null);
  const binding: ProductBinding = {
    workspaceId: asWorkspaceId(assertIdentifier(value.workspaceId, 'binding.workspaceId')),
    databaseGeneration: asDatabaseGeneration(assertIdentifier(value.databaseGeneration, 'binding.databaseGeneration')),
    timelineId: asTimelineId(assertIdentifier(value.timelineId, 'binding.timelineId')),
    checkoutTargetId: value.checkoutTargetId === null
      ? null
      : assertIdentifier(value.checkoutTargetId, 'binding.checkoutTargetId'),
    checkoutUpdatedAt: assertNonNegativeInteger(value.checkoutUpdatedAt, 'binding.checkoutUpdatedAt'),
    contentRevision: assertNonNegativeInteger(value.contentRevision, 'binding.contentRevision'),
    snapshotDigest: assertIdentifier(value.snapshotDigest, 'binding.snapshotDigest'),
  };

  if (
    session
    && (
      session.workspaceId !== binding.workspaceId
      || session.lastDatabaseGeneration !== binding.databaseGeneration
      || session.timelineId !== binding.timelineId
      || session.boundNodeId !== binding.checkoutTargetId
    )
  ) {
    fail('INVALID_RECORD', 'Session metadata and ProductBinding do not describe the same workspace', null);
  }
  return binding;
}

function assertSession(value: unknown): DefSessionV6 {
  if (!isRecord(value)) fail('INVALID_RECORD', 'DefSessionV6 must be an object', null);
  if (value.schemaVersion !== 6 || value.eventSchemaVersion !== 1 || value.host !== 'workbench') {
    fail('INVALID_RECORD', 'Only DefSessionV6 workbench sessions are supported', null);
  }
  const defSessionId = asDefSessionId(assertPortableId(value.defSessionId, 'session.defSessionId', 'INVALID_SESSION_ID'));
  if (typeof value.status !== 'string' || !SESSION_STATUSES.has(value.status)) {
    fail('INVALID_RECORD', 'Session status is not recognized', null);
  }
  if (value.axisBindingId !== null && value.axisBindingId !== undefined) {
    assertIdentifier(value.axisBindingId, 'session.axisBindingId');
  }
  if (value.boundNodeId !== null && value.boundNodeId !== undefined) {
    assertIdentifier(value.boundNodeId, 'session.boundNodeId');
  }
  if (!isRecord(value.engine)) fail('INVALID_RECORD', 'Session engine reference must be an object', null);
  if (!isRecord(value.harness)) fail('INVALID_RECORD', 'Session harness binding must be an object', null);

  return {
    schemaVersion: 6,
    eventSchemaVersion: 1,
    defSessionId,
    host: 'workbench',
    status: value.status as DefSessionV6['status'],
    workspaceId: asWorkspaceId(assertIdentifier(value.workspaceId, 'session.workspaceId')),
    lastDatabaseGeneration: asDatabaseGeneration(assertIdentifier(value.lastDatabaseGeneration, 'session.lastDatabaseGeneration')),
    timelineId: asTimelineId(assertIdentifier(value.timelineId, 'session.timelineId')),
    axisBindingId: value.axisBindingId === null || value.axisBindingId === undefined
      ? null
      : assertIdentifier(value.axisBindingId, 'session.axisBindingId'),
    boundNodeId: value.boundNodeId === null || value.boundNodeId === undefined
      ? null
      : assertIdentifier(value.boundNodeId, 'session.boundNodeId'),
    engine: {
      kind: assertIdentifier(value.engine.kind, 'session.engine.kind'),
      sessionId: asEngineSessionId(assertIdentifier(value.engine.sessionId, 'session.engine.sessionId')),
      runtimeVersion: assertIdentifier(value.engine.runtimeVersion, 'session.engine.runtimeVersion'),
      storeSchemaVersion: assertNonNegativeInteger(value.engine.storeSchemaVersion, 'session.engine.storeSchemaVersion'),
    },
    harness: {
      stateVersion: assertNonNegativeInteger(value.harness.stateVersion, 'session.harness.stateVersion'),
      revision: assertIdentifier(value.harness.revision, 'session.harness.revision'),
    },
    createdAt: assertDateText(value.createdAt, 'session.createdAt'),
    updatedAt: assertDateText(value.updatedAt, 'session.updatedAt'),
  };
}

function assertAcceptedClientTurns(value: unknown): readonly DefAcceptedClientTurn[] {
  if (!Array.isArray(value)) fail('INVALID_RECORD', 'acceptedClientTurns must be an array', null);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail('INVALID_RECORD', `acceptedClientTurns[${index}] must be an object`, null);
    const clientTurnId = asClientTurnId(assertIdentifier(entry.clientTurnId, `acceptedClientTurns[${index}].clientTurnId`));
    if (seen.has(clientTurnId)) {
      fail('INVALID_RECORD', `acceptedClientTurns contains duplicate ${clientTurnId}`, null);
    }
    seen.add(clientTurnId);
    if (!isRecord(entry.result)) fail('INVALID_RECORD', `acceptedClientTurns[${index}].result must be an object`, null);
    const resultClientTurnId = asClientTurnId(assertIdentifier(entry.result.clientTurnId, `acceptedClientTurns[${index}].result.clientTurnId`));
    if (resultClientTurnId !== clientTurnId) {
      fail('INVALID_RECORD', `acceptedClientTurns[${index}] result correlation does not match`, null);
    }
    return {
      clientTurnId,
      userMessage: assertText(entry.userMessage, `acceptedClientTurns[${index}].userMessage`),
      result: {
        defTurnId: asDefTurnId(assertIdentifier(entry.result.defTurnId, `acceptedClientTurns[${index}].result.defTurnId`)),
        clientTurnId: resultClientTurnId,
      },
      acceptedAt: assertDateText(entry.acceptedAt, `acceptedClientTurns[${index}].acceptedAt`),
    };
  });
}

function validateRecord(value: unknown): DefAgentSessionRecord {
  if (!isRecord(value)) fail('INVALID_RECORD', 'Session record must be an object', null);
  const session = assertSession(value.session);
  const binding = assertBinding(value.binding, session);
  const providerProfileRef = assertProfileRef(value.providerProfileRef);
  const acceptedClientTurns = assertAcceptedClientTurns(value.acceptedClientTurns ?? []);
  return { session, binding, providerProfileRef, acceptedClientTurns };
}

function validateAcceptedClientTurn(value: DefAcceptedClientTurnInput): DefAcceptedClientTurn {
  if (!isRecord(value)) fail('INVALID_RECORD', 'Accepted client turn must be an object', null);
  const clientTurnId = asClientTurnId(assertIdentifier(value.clientTurnId, 'clientTurnId'));
  if (!isRecord(value.result)) fail('INVALID_RECORD', 'Accepted client turn result must be an object', null);
  const resultClientTurnId = asClientTurnId(assertIdentifier(value.result.clientTurnId, 'result.clientTurnId'));
  if (resultClientTurnId !== clientTurnId) {
    fail('INVALID_RECORD', 'Accepted client turn result correlation does not match', null);
  }
  return {
    clientTurnId,
    userMessage: assertText(value.userMessage, 'userMessage'),
    result: {
      defTurnId: asDefTurnId(assertIdentifier(value.result.defTurnId, 'result.defTurnId')),
      clientTurnId: resultClientTurnId,
    },
    acceptedAt: value.acceptedAt === undefined
      ? new Date().toISOString()
      : assertDateText(value.acceptedAt, 'acceptedAt'),
  };
}

function validateEvent(value: unknown, sessionId: DefSessionId, expectedSequence: number, target: string): DefEvent {
  try {
    if (!isRecord(value)) fail('CORRUPT_EVENT_JOURNAL', 'Event journal entry must be an object', target);
    if (value.schemaVersion !== 1) fail('CORRUPT_EVENT_JOURNAL', 'Unsupported event schema version', target);
    if (value.sequence !== expectedSequence || !Number.isSafeInteger(value.sequence)) {
      fail('CORRUPT_EVENT_JOURNAL', `Event sequence must be exactly ${expectedSequence}`, target);
    }
    if (value.defSessionId !== sessionId) {
      fail('CORRUPT_EVENT_JOURNAL', 'Event belongs to a different DEF Session', target);
    }
    if (typeof value.type !== 'string' || !EVENT_TYPES.has(value.type)) {
      fail('CORRUPT_EVENT_JOURNAL', 'Event type is not recognized', target);
    }
    assertDateText(value.occurredAt, 'event.occurredAt');
    if (!isRecord(value.payload)) fail('CORRUPT_EVENT_JOURNAL', 'Event payload must be an object', target);
    return value as unknown as DefEvent;
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError && error.code === 'CORRUPT_EVENT_JOURNAL') throw error;
    if (error instanceof DefAgentSessionStoreError) {
      fail('CORRUPT_EVENT_JOURNAL', error.message, target);
    }
    fail('CORRUPT_EVENT_JOURNAL', `Invalid event journal entry: ${errorMessage(error)}`, target);
  }
}

function serialize(value: unknown, target: string): string {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) fail('INVALID_RECORD', 'Store value is not JSON serializable', target);
    return json;
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError) throw error;
    fail('INVALID_RECORD', `Store value is not JSON serializable: ${errorMessage(error)}`, target);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function syncDirectory(directory: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directory, fsConstants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (!isNodeError(error) || !['EINVAL', 'ENOTSUP', 'EBADF', 'EISDIR'].includes(error.code ?? '')) {
      fail('IO_ERROR', `Unable to sync directory: ${errorMessage(error)}`, directory);
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function writeAtomicJson(target: string, value: unknown, parent: string): void {
  assertRegularFile(target, 'atomic target', true);
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  assertPathWithinRoot(parent, temp);
  let descriptor: number | null = null;
  let renamed = false;
  try {
    descriptor = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    const bytes = Buffer.from(`${serialize(value, target)}\n`, 'utf8');
    writeSync(descriptor, bytes, 0, bytes.length);
    fsyncSync(descriptor);
    chmodSync(temp, 0o600);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temp, target);
    renamed = true;
    syncDirectory(parent);
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError) throw error;
    fail('IO_ERROR', `Unable to atomically write ${target}: ${errorMessage(error)}`, target);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (!renamed) {
      try {
        if (assertRegularFile(temp, 'temporary atomic file', true)) unlinkSync(temp);
      } catch {
        // The original write error is the useful error. A crash can also leave a
        // harmless temporary file behind, which load deliberately ignores.
      }
    }
  }
}

function readJsonFile(target: string, kind: 'registry' | 'metadata'): unknown | null {
  if (!assertRegularFile(target, `${kind} file`, true)) return null;
  try {
    return JSON.parse(readFileSync(target, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError) throw error;
    fail(
      kind === 'registry' ? 'CORRUPT_REGISTRY' : 'CORRUPT_METADATA',
      `${kind} file is not valid JSON: ${errorMessage(error)}`,
      target,
    );
  }
}

function validateRegistry(value: unknown, target: string): RegistryFile {
  if (!isRecord(value) || value.schemaVersion !== DEF_AGENT_SESSION_STORE_SCHEMA_VERSION) {
    fail('CORRUPT_REGISTRY', 'Unsupported session registry schema', target);
  }
  if (!Array.isArray(value.sessionIds)) fail('CORRUPT_REGISTRY', 'Registry sessionIds must be an array', target);
  const sessionIds = value.sessionIds.map((sessionId, index) => {
    try {
      return assertPortableId(sessionId, `registry.sessionIds[${index}]`, 'INVALID_SESSION_ID');
    } catch (error) {
      if (error instanceof DefAgentSessionStoreError) {
        fail('CORRUPT_REGISTRY', error.message, target);
      }
      throw error;
    }
  });
  if (new Set(sessionIds).size !== sessionIds.length) {
    fail('CORRUPT_REGISTRY', 'Registry contains duplicate Session IDs', target);
  }
  const activeSessionId = value.activeSessionId === null
    ? null
    : assertPortableId(value.activeSessionId, 'registry.activeSessionId', 'INVALID_SESSION_ID');
  if (activeSessionId !== null && !sessionIds.includes(activeSessionId)) {
    fail('CORRUPT_REGISTRY', 'Registry activeSessionId is not registered', target);
  }
  return {
    schemaVersion: DEF_AGENT_SESSION_STORE_SCHEMA_VERSION,
    activeSessionId,
    sessionIds,
  };
}

function validateMetadata(value: unknown, expectedSessionId: DefSessionId, target: string): DefAgentSessionRecord {
  if (!isRecord(value) || value.schemaVersion !== DEF_AGENT_SESSION_STORE_SCHEMA_VERSION) {
    fail('CORRUPT_METADATA', 'Unsupported Session metadata schema', target);
  }
  let record: DefAgentSessionRecord;
  try {
    record = validateRecord(value);
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError) {
      fail('CORRUPT_METADATA', error.message, target);
    }
    throw error;
  }
  if (record.session.defSessionId !== expectedSessionId) {
    fail('CORRUPT_METADATA', 'Metadata Session ID does not match its directory', target);
  }
  return record;
}

function validateJournalBuffer(buffer: Buffer, sessionId: DefSessionId, target: string): JournalScan {
  const events: DefEvent[] = [];
  let offset = 0;
  let validByteLength = 0;

  while (offset < buffer.length) {
    const newline = buffer.indexOf(0x0a, offset);
    if (newline < 0) {
      const tailText = buffer.subarray(offset).toString('utf8');
      if (!tailText.trim()) {
        return { events, validByteLength, tail: 'incomplete' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(tailText) as unknown;
      } catch (error) {
        return { events, validByteLength, tail: 'incomplete' };
      }
      events.push(validateEvent(parsed, sessionId, events.length + 1, target));
      return { events, validByteLength: buffer.length, tail: 'complete-no-newline' };
    }

    const line = buffer.subarray(offset, newline).toString('utf8');
    if (!line.trim()) {
      fail('CORRUPT_EVENT_JOURNAL', 'Event journal contains an empty record', target);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      fail('CORRUPT_EVENT_JOURNAL', `Event journal contains invalid JSON: ${errorMessage(error)}`, target);
    }
    events.push(validateEvent(parsed, sessionId, events.length + 1, target));
    offset = newline + 1;
    validByteLength = offset;
  }

  return { events, validByteLength, tail: 'none' };
}

function readJournal(target: string, sessionId: DefSessionId): JournalScan {
  if (!assertRegularFile(target, 'event journal', true)) {
    fail('CORRUPT_EVENT_JOURNAL', 'Registered Session has no event journal', target);
  }
  try {
    return validateJournalBuffer(readFileSync(target), sessionId, target);
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError) throw error;
    fail('CORRUPT_EVENT_JOURNAL', `Unable to read event journal: ${errorMessage(error)}`, target);
  }
}

function makeSnapshot(
  activeSessionId: DefSessionId | null,
  sessions: readonly DefAgentSessionRecord[],
  events: ReadonlyMap<DefSessionId, readonly DefEvent[]>,
): DefAgentSessionStoreSnapshot {
  return {
    activeSessionId,
    sessions: sessions.map((record) => clone(record)),
    events: new Map([...events.entries()].map(([sessionId, journal]) => [sessionId, clone(journal)])),
  };
}

function equalTurn(left: DefAcceptedClientTurn, right: DefAcceptedClientTurn): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class MemoryDefAgentSessionStore implements DefAgentSessionStore {
  readonly #sessions = new Map<DefSessionId, DefAgentSessionRecord>();
  readonly #events = new Map<DefSessionId, DefEvent[]>();
  #activeSessionId: DefSessionId | null = null;

  load(): DefAgentSessionStoreSnapshot {
    return makeSnapshot(this.#activeSessionId, [...this.#sessions.values()], this.#events);
  }

  loadSession(defSessionId: DefSessionId): DefAgentSessionRecord | null {
    assertPortableId(defSessionId, 'defSessionId', 'INVALID_SESSION_ID');
    const record = this.#sessions.get(defSessionId);
    return record ? clone(record) : null;
  }

  loadEvents(defSessionId: DefSessionId): readonly DefEvent[] {
    assertPortableId(defSessionId, 'defSessionId', 'INVALID_SESSION_ID');
    return clone(this.#events.get(defSessionId) ?? []);
  }

  loadAcceptedClientTurn(defSessionId: DefSessionId, clientTurnId: ClientTurnId): DefAcceptedClientTurn | null {
    const record = this.loadSession(defSessionId);
    if (!record) return null;
    assertIdentifier(clientTurnId, 'clientTurnId');
    return clone(record.acceptedClientTurns.find((turn) => turn.clientTurnId === clientTurnId) ?? null);
  }

  create(input: DefAgentSessionRecord): void {
    const record = clone(validateRecord(input));
    const id = record.session.defSessionId;
    if (this.#sessions.has(id)) fail('SESSION_EXISTS', `Session ${id} already exists`, id);
    this.#sessions.set(id, record);
    this.#events.set(id, []);
  }

  update(input: DefAgentSessionRecord): void {
    const record = clone(validateRecord(input));
    const id = record.session.defSessionId;
    if (!this.#sessions.has(id)) fail('SESSION_NOT_FOUND', `Session ${id} does not exist`, id);
    this.#sessions.set(id, record);
  }

  acceptClientTurn(defSessionId: DefSessionId, input: DefAcceptedClientTurnInput): void {
    const record = this.#requireSession(defSessionId);
    const turn = validateAcceptedClientTurn(input);
    const existing = record.acceptedClientTurns.find((entry) => entry.clientTurnId === turn.clientTurnId);
    if (existing) {
      if (!equalTurn(existing, turn) && (existing.userMessage !== turn.userMessage || existing.result.defTurnId !== turn.result.defTurnId)) {
        fail('CLIENT_TURN_CONFLICT', `Client Turn ${turn.clientTurnId} was already accepted with another result`, turn.clientTurnId);
      }
      return;
    }
    this.#sessions.set(defSessionId, {
      ...record,
      acceptedClientTurns: [...record.acceptedClientTurns, turn],
    });
  }

  append(defSessionId: DefSessionId, event: DefEvent): void {
    this.#requireSession(defSessionId);
    const journal = this.#events.get(defSessionId);
    if (!journal) fail('SESSION_NOT_FOUND', `Session ${defSessionId} does not exist`, defSessionId);
    const checked = clone(validateEvent(event, defSessionId, journal.length + 1, `memory:${defSessionId}`));
    journal.push(checked);
  }

  delete(defSessionId: DefSessionId): void {
    this.#requireSession(defSessionId);
    this.#sessions.delete(defSessionId);
    this.#events.delete(defSessionId);
    if (this.#activeSessionId === defSessionId) this.#activeSessionId = null;
  }

  setActive(defSessionId: DefSessionId | null): void {
    if (defSessionId !== null) this.#requireSession(defSessionId);
    this.#activeSessionId = defSessionId;
  }

  #requireSession(defSessionId: DefSessionId): DefAgentSessionRecord {
    assertPortableId(defSessionId, 'defSessionId', 'INVALID_SESSION_ID');
    const record = this.#sessions.get(defSessionId);
    if (!record) fail('SESSION_NOT_FOUND', `Session ${defSessionId} does not exist`, defSessionId);
    return record;
  }
}

export class NoopDefAgentSessionStore implements DefAgentSessionStore {
  load(): DefAgentSessionStoreSnapshot {
    return makeSnapshot(null, [], new Map());
  }

  loadSession(_defSessionId: DefSessionId): DefAgentSessionRecord | null {
    return null;
  }

  loadEvents(_defSessionId: DefSessionId): readonly DefEvent[] {
    return [];
  }

  loadAcceptedClientTurn(
    _defSessionId: DefSessionId,
    _clientTurnId: ClientTurnId,
  ): DefAcceptedClientTurn | null {
    return null;
  }

  create(_record: DefAgentSessionRecord): void {}
  update(_record: DefAgentSessionRecord): void {}
  acceptClientTurn(_defSessionId: DefSessionId, _turn: DefAcceptedClientTurnInput): void {}
  append(_defSessionId: DefSessionId, _event: DefEvent): void {}
  delete(_defSessionId: DefSessionId): void {}
  setActive(_defSessionId: DefSessionId | null): void {}
}

export class FileDefAgentSessionStore implements DefAgentSessionStore {
  readonly root: string;
  readonly registryPath: string;
  readonly sessionsPath: string;

  constructor(options: FileDefAgentSessionStoreOptions) {
    this.root = normalizePath(options.root);
    this.registryPath = path.join(this.root, REGISTRY_FILE_NAME);
    this.sessionsPath = path.join(this.root, SESSION_DIRECTORY_NAME);
    assertPathWithinRoot(this.root, this.registryPath);
    assertPathWithinRoot(this.root, this.sessionsPath);
    assertDirectory(this.root, 'session store root', true);
    assertDirectory(this.sessionsPath, 'session store sessions directory', true);
  }

  load(): DefAgentSessionStoreSnapshot {
    const registry = this.#readRegistry();
    const sessions: DefAgentSessionRecord[] = [];
    const events = new Map<DefSessionId, readonly DefEvent[]>();
    for (const sessionIdText of registry.sessionIds) {
      const sessionId = asDefSessionId(sessionIdText);
      const record = this.#readMetadata(sessionId);
      sessions.push(record);
      events.set(sessionId, readJournal(this.#eventsPath(sessionId), sessionId).events);
    }
    return makeSnapshot(
      registry.activeSessionId === null ? null : asDefSessionId(registry.activeSessionId),
      sessions,
      events,
    );
  }

  loadSession(defSessionId: DefSessionId): DefAgentSessionRecord | null {
    const id = asDefSessionId(assertPortableId(defSessionId, 'defSessionId', 'INVALID_SESSION_ID'));
    if (!this.#readRegistry().sessionIds.includes(id)) return null;
    return this.#readMetadata(id);
  }

  loadEvents(defSessionId: DefSessionId): readonly DefEvent[] {
    const id = this.#assertRegistered(defSessionId);
    return clone(readJournal(this.#eventsPath(id), id).events);
  }

  loadAcceptedClientTurn(defSessionId: DefSessionId, clientTurnId: ClientTurnId): DefAcceptedClientTurn | null {
    const record = this.loadSession(defSessionId);
    if (!record) return null;
    assertIdentifier(clientTurnId, 'clientTurnId');
    return clone(record.acceptedClientTurns.find((turn) => turn.clientTurnId === clientTurnId) ?? null);
  }

  create(input: DefAgentSessionRecord): void {
    const record = clone(validateRecord(input));
    const id = record.session.defSessionId;
    const registry = this.#readRegistry();
    if (registry.sessionIds.includes(id)) fail('SESSION_EXISTS', `Session ${id} already exists`, id);
    const sessionDirectory = this.#sessionDirectory(id);
    if (assertDirectoryExists(sessionDirectory)) {
      fail('SESSION_EXISTS', `Session directory ${id} already exists`, sessionDirectory);
    }
    assertDirectory(sessionDirectory, `Session ${id} directory`, true);
    this.#createEmptyJournal(id);
    writeAtomicJson(this.#metadataPath(id), this.#toMetadata(record), sessionDirectory);
    writeAtomicJson(
      this.registryPath,
      {
        schemaVersion: DEF_AGENT_SESSION_STORE_SCHEMA_VERSION,
        activeSessionId: registry.activeSessionId,
        sessionIds: [...registry.sessionIds, id],
      } satisfies RegistryFile,
      this.root,
    );
  }

  update(input: DefAgentSessionRecord): void {
    const record = clone(validateRecord(input));
    const id = this.#assertRegistered(record.session.defSessionId);
    const sessionDirectory = this.#sessionDirectory(id);
    assertDirectory(sessionDirectory, `Session ${id} directory`);
    writeAtomicJson(this.#metadataPath(id), this.#toMetadata(record), sessionDirectory);
  }

  acceptClientTurn(defSessionId: DefSessionId, input: DefAcceptedClientTurnInput): void {
    const id = this.#assertRegistered(defSessionId);
    const record = this.#readMetadata(id);
    const turn = validateAcceptedClientTurn(input);
    const existing = record.acceptedClientTurns.find((entry) => entry.clientTurnId === turn.clientTurnId);
    if (existing) {
      if (!equalTurn(existing, turn) && (existing.userMessage !== turn.userMessage || existing.result.defTurnId !== turn.result.defTurnId)) {
        fail('CLIENT_TURN_CONFLICT', `Client Turn ${turn.clientTurnId} was already accepted with another result`, turn.clientTurnId);
      }
      return;
    }
    this.update({
      ...record,
      acceptedClientTurns: [...record.acceptedClientTurns, turn],
    });
  }

  append(defSessionId: DefSessionId, event: DefEvent): void {
    const id = this.#assertRegistered(defSessionId);
    const target = this.#eventsPath(id);
    const scan = readJournal(target, id);
    const checked = validateEvent(event, id, scan.events.length + 1, target);
    if (scan.tail === 'incomplete') {
      this.#truncateJournal(target, scan.validByteLength);
    }

    let descriptor: number | null = null;
    try {
      descriptor = openSync(target, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT, 0o600);
      const prefix = scan.tail === 'complete-no-newline' ? '\n' : '';
      const bytes = Buffer.from(`${prefix}${serialize(checked, target)}\n`, 'utf8');
      writeSync(descriptor, bytes, 0, bytes.length);
      fsyncSync(descriptor);
      chmodSync(target, 0o600);
    } catch (error) {
      if (error instanceof DefAgentSessionStoreError) throw error;
      fail('IO_ERROR', `Unable to append event journal: ${errorMessage(error)}`, target);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
    syncDirectory(path.dirname(target));
  }

  delete(defSessionId: DefSessionId): void {
    const id = this.#assertRegistered(defSessionId);
    const sessionDirectory = this.#sessionDirectory(id);
    assertDirectory(sessionDirectory, `Session ${id} directory`);
    const registry = this.#readRegistry();
    const nextRegistry: RegistryFile = {
      schemaVersion: DEF_AGENT_SESSION_STORE_SCHEMA_VERSION,
      activeSessionId: registry.activeSessionId === id ? null : registry.activeSessionId,
      sessionIds: registry.sessionIds.filter((sessionId) => sessionId !== id),
    };
    // Removing the registry entry first means a crash cannot leave an active
    // pointer to a directory that has already disappeared.
    writeAtomicJson(this.registryPath, nextRegistry, this.root);
    try {
      rmSync(sessionDirectory, { recursive: true, force: false });
    } catch (error) {
      fail('IO_ERROR', `Unable to delete Session directory: ${errorMessage(error)}`, sessionDirectory);
    }
    syncDirectory(this.sessionsPath);
  }

  setActive(defSessionId: DefSessionId | null): void {
    const registry = this.#readRegistry();
    if (defSessionId !== null) {
      const id = this.#assertRegistered(defSessionId, registry);
      this.#readMetadata(id);
    }
    writeAtomicJson(
      this.registryPath,
      {
        schemaVersion: DEF_AGENT_SESSION_STORE_SCHEMA_VERSION,
        activeSessionId: defSessionId,
        sessionIds: registry.sessionIds,
      } satisfies RegistryFile,
      this.root,
    );
  }

  #ensureLayout(): void {
    assertDirectory(this.root, 'session store root');
    assertDirectory(this.sessionsPath, 'session store sessions directory');
  }

  #readRegistry(): RegistryFile {
    this.#ensureLayout();
    const parsed = readJsonFile(this.registryPath, 'registry');
    if (parsed === null) {
      return {
        schemaVersion: DEF_AGENT_SESSION_STORE_SCHEMA_VERSION,
        activeSessionId: null,
        sessionIds: [],
      };
    }
    try {
      return validateRegistry(parsed, this.registryPath);
    } catch (error) {
      if (error instanceof DefAgentSessionStoreError) {
        if (error.code === 'INVALID_SESSION_ID' || error.code === 'INVALID_PROFILE_REF') {
          fail('CORRUPT_REGISTRY', error.message, this.registryPath);
        }
        throw error;
      }
      throw error;
    }
  }

  #readMetadata(id: DefSessionId): DefAgentSessionRecord {
    const target = this.#metadataPath(id);
    const parsed = readJsonFile(target, 'metadata');
    if (parsed === null) fail('CORRUPT_METADATA', `Registered Session ${id} has no metadata`, target);
    return validateMetadata(parsed, id, target);
  }

  #assertRegistered(defSessionId: DefSessionId, registry = this.#readRegistry()): DefSessionId {
    const id = asDefSessionId(assertPortableId(defSessionId, 'defSessionId', 'INVALID_SESSION_ID'));
    if (!registry.sessionIds.includes(id)) {
      fail('SESSION_NOT_FOUND', `Session ${id} does not exist`, id);
    }
    return id;
  }

  #sessionDirectory(id: DefSessionId): string {
    const sessionId = assertPortableId(id, 'defSessionId', 'INVALID_SESSION_ID');
    const target = path.join(this.sessionsPath, sessionId);
    assertPathWithinRoot(this.root, target);
    assertNoSymlinkComponents(target, `Session ${sessionId} path`);
    return target;
  }

  #metadataPath(id: DefSessionId): string {
    const directory = this.#sessionDirectory(id);
    const target = path.join(directory, METADATA_FILE_NAME);
    assertPathWithinRoot(this.root, target);
    return target;
  }

  #eventsPath(id: DefSessionId): string {
    const directory = this.#sessionDirectory(id);
    const target = path.join(directory, EVENTS_FILE_NAME);
    assertPathWithinRoot(this.root, target);
    return target;
  }

  #toMetadata(record: DefAgentSessionRecord): MetadataFile {
    return {
      schemaVersion: DEF_AGENT_SESSION_STORE_SCHEMA_VERSION,
      session: record.session,
      binding: record.binding,
      providerProfileRef: record.providerProfileRef,
      acceptedClientTurns: record.acceptedClientTurns,
    };
  }

  #createEmptyJournal(id: DefSessionId): void {
    const target = this.#eventsPath(id);
    let descriptor: number | null = null;
    try {
      descriptor = openSync(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
      fsyncSync(descriptor);
      chmodSync(target, 0o600);
    } catch (error) {
      if (error instanceof DefAgentSessionStoreError) throw error;
      if (isNodeError(error) && error.code === 'EEXIST') {
        fail('SESSION_EXISTS', `Event journal for Session ${id} already exists`, target);
      }
      fail('IO_ERROR', `Unable to create event journal: ${errorMessage(error)}`, target);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
    syncDirectory(path.dirname(target));
  }

  #truncateJournal(target: string, length: number): void {
    let descriptor: number | null = null;
    try {
      descriptor = openSync(target, fsConstants.O_WRONLY);
      ftruncateSync(descriptor, length);
      fsyncSync(descriptor);
    } catch (error) {
      if (error instanceof DefAgentSessionStoreError) throw error;
      fail('IO_ERROR', `Unable to discard an incomplete event tail: ${errorMessage(error)}`, target);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  }
}

function assertDirectoryExists(target: string): boolean {
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink()) fail('SYMLINK_ESCAPE', 'Session directory is a symbolic link', target);
    if (!stats.isDirectory()) fail('SESSION_EXISTS', 'Session path is not a directory', target);
    return true;
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError) throw error;
    if (isMissingError(error)) return false;
    fail('IO_ERROR', `Unable to inspect Session directory: ${errorMessage(error)}`, target);
  }
}

export function createFileDefAgentSessionStore(options: FileDefAgentSessionStoreOptions): FileDefAgentSessionStore {
  return new FileDefAgentSessionStore(options);
}

export function createMemoryDefAgentSessionStore(): MemoryDefAgentSessionStore {
  return new MemoryDefAgentSessionStore();
}

export function createNoopDefAgentSessionStore(): NoopDefAgentSessionStore {
  return new NoopDefAgentSessionStore();
}
