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
  readSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import {
  asClientTurnId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asEngineSessionId,
  asTimelineId,
  asWorkspaceId,
  DEF_HARNESS_PERSISTED_TRANSACTION_VERSION,
  DEF_HARNESS_PERSISTENCE_LIMITS,
  type DefHarnessPersistedTransaction,
  type ClientTurnId,
  type DefEvent,
  type DefSessionId,
  type DefSessionV6,
  type DefTurnId,
  type ProductBinding,
} from '../core/contracts/index.ts';
import { validateDefHarnessPersistedTransaction } from '../core/harness/manager.ts';

export const DEF_AGENT_SESSION_STORE_SCHEMA_VERSION = 2 as const;

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
  /** SHA-256 only; attachment bytes remain owned by the Engine transcript. */
  readonly attachmentDigest?: string;
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
  /** Optional on input for schema-v1 compatibility; stores always return an array. */
  readonly harnessTransactions?: readonly DefHarnessPersistedTransaction[];
}

export interface DefAgentSessionStoreSnapshot {
  readonly activeSessionId: DefSessionId | null;
  readonly sessions: readonly DefAgentSessionRecord[];
  readonly events: ReadonlyMap<DefSessionId, readonly DefEvent[]>;
}

/**
 * Controls how much of the append-only event journal is loaded with the
 * metadata snapshot. The default remains `all` for older callers; the Host
 * uses `active` during startup so historical journals stay cold.
 */
export interface DefAgentSessionStoreLoadOptions {
  readonly eventLoad?: 'all' | 'active' | 'none';
}

export interface DefAgentSessionStore {
  load(options?: DefAgentSessionStoreLoadOptions): DefAgentSessionStoreSnapshot;
  loadSession(defSessionId: DefSessionId): DefAgentSessionRecord | null;
  loadEvents(defSessionId: DefSessionId): readonly DefEvent[];
  /** Reads one bounded page without changing the durable journal. */
  loadEventPage?(
    defSessionId: DefSessionId,
    afterSequence: number,
    limit: number,
  ): readonly DefEvent[];
  loadAcceptedClientTurn(
    defSessionId: DefSessionId,
    clientTurnId: ClientTurnId,
  ): DefAcceptedClientTurn | null;
  create(record: DefAgentSessionRecord): void;
  update(record: DefAgentSessionRecord): void;
  acceptClientTurn(defSessionId: DefSessionId, turn: DefAcceptedClientTurnInput): void;
  append(defSessionId: DefSessionId, event: DefEvent): void;
  /** Flushes any response.delta bytes buffered by append. */
  flush?(defSessionId: DefSessionId): void;
  delete(defSessionId: DefSessionId): void;
  setActive(defSessionId: DefSessionId | null): void;
}

export interface FileDefAgentSessionStoreOptions {
  readonly root: string;
}

interface RegistryFile {
  readonly schemaVersion: 1 | typeof DEF_AGENT_SESSION_STORE_SCHEMA_VERSION;
  readonly activeSessionId: string | null;
  readonly sessionIds: readonly string[];
}

interface MetadataFile {
  readonly schemaVersion: typeof DEF_AGENT_SESSION_STORE_SCHEMA_VERSION;
  readonly session: DefSessionV6;
  readonly binding: ProductBinding;
  readonly providerProfileRef: string;
  readonly acceptedClientTurns: readonly DefAcceptedClientTurn[];
  readonly harnessTransactions: readonly DefHarnessPersistedTransaction[];
}

interface JournalScan {
  readonly events: readonly DefEvent[];
  readonly validByteLength: number;
  readonly fileByteLength: number;
  readonly tail: 'none' | 'incomplete' | 'complete-no-newline';
}

interface JournalState {
  nextSequence: number;
  validByteLength: number;
  fileByteLength: number;
  tail: JournalScan['tail'];
  dirty: boolean;
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
  'harness.resumed',
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

function assertSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    fail('INVALID_RECORD', `${label} must be a lowercase SHA-256 digest`, null);
  }
  return value;
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
      ...(entry.attachmentDigest === undefined
        ? {}
        : { attachmentDigest: assertSha256(entry.attachmentDigest, `acceptedClientTurns[${index}].attachmentDigest`) }),
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
  const harnessTransactions = assertHarnessTransactions(
    value.harnessTransactions ?? [],
    session.defSessionId,
  );
  return { session, binding, providerProfileRef, acceptedClientTurns, harnessTransactions };
}

function assertHarnessTransactions(
  value: unknown,
  expectedSessionId: DefSessionId,
): readonly DefHarnessPersistedTransaction[] {
  if (!Array.isArray(value)) fail('INVALID_RECORD', 'harnessTransactions must be an array', null);
  if (value.length > DEF_HARNESS_PERSISTENCE_LIMITS.maxTransactionsPerSession) {
    fail('INVALID_RECORD', 'harnessTransactions exceeds the per-Session limit', null);
  }
  const transactions: DefHarnessPersistedTransaction[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    let transaction: DefHarnessPersistedTransaction;
    try {
      transaction = validateDefHarnessPersistedTransaction(entry);
    } catch (error) {
      fail(
        'INVALID_RECORD',
        `harnessTransactions[${index}] is invalid: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    }
    if (transaction.defSessionId !== expectedSessionId) {
      fail('INVALID_RECORD', `harnessTransactions[${index}] belongs to another Session`, null);
    }
    if (seen.has(transaction.transactionId)) {
      fail('INVALID_RECORD', `harnessTransactions contains duplicate ${transaction.transactionId}`, null);
    }
    seen.add(transaction.transactionId);
    if (transaction.schemaVersion !== DEF_HARNESS_PERSISTED_TRANSACTION_VERSION) {
      fail('INVALID_RECORD', `harnessTransactions[${index}] has an unsupported schema`, null);
    }
    transactions.push(transaction);
  }
  const codeUnits = JSON.stringify(transactions).length;
  if (codeUnits > DEF_HARNESS_PERSISTENCE_LIMITS.maxSessionCodeUnits) {
    fail('INVALID_RECORD', 'harnessTransactions exceeds the Session metadata size limit', null);
  }
  return transactions;
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
    ...(value.attachmentDigest === undefined
      ? {}
      : { attachmentDigest: assertSha256(value.attachmentDigest, 'attachmentDigest') }),
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

function writeAll(descriptor: number, bytes: Buffer, target: string): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) {
      fail('IO_ERROR', 'Unable to make progress while writing event journal', target);
    }
    offset += written;
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
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== DEF_AGENT_SESSION_STORE_SCHEMA_VERSION)) {
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
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== DEF_AGENT_SESSION_STORE_SCHEMA_VERSION)) {
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
        return { events, validByteLength, fileByteLength: buffer.length, tail: 'incomplete' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(tailText) as unknown;
      } catch (error) {
        return { events, validByteLength, fileByteLength: buffer.length, tail: 'incomplete' };
      }
      events.push(validateEvent(parsed, sessionId, events.length + 1, target));
      return {
        events,
        validByteLength: buffer.length,
        fileByteLength: buffer.length,
        tail: 'complete-no-newline',
      };
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

  return { events, validByteLength, fileByteLength: buffer.length, tail: 'none' };
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

/**
 * Read only one event page from a journal. Validation still walks the journal
 * in sequence order, so a corrupt prefix or a reordered event cannot be
 * hidden by pagination, while the returned array stays bounded.
 */
function readJournalPage(
  target: string,
  sessionId: DefSessionId,
  afterSequence: number,
  limit: number,
): readonly DefEvent[] {
  if (!assertRegularFile(target, 'event journal', true)) {
    fail('CORRUPT_EVENT_JOURNAL', 'Registered Session has no event journal', target);
  }
  let descriptor: number | null = null;
  const decoder = new StringDecoder('utf8');
  const chunk = Buffer.allocUnsafe(64 * 1_024);
  const page: DefEvent[] = [];
  let pending = '';
  let expectedSequence = 1;

  const consume = (line: string): void => {
    if (!line.trim()) {
      fail('CORRUPT_EVENT_JOURNAL', 'Event journal contains an empty record', target);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      fail('CORRUPT_EVENT_JOURNAL', `Event journal contains invalid JSON: ${errorMessage(error)}`, target);
    }
    const event = validateEvent(parsed, sessionId, expectedSequence, target);
    expectedSequence += 1;
    if (event.sequence > afterSequence && page.length < limit) page.push(event);
  };

  try {
    descriptor = openSync(target, fsConstants.O_RDONLY);
    while (true) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      pending += decoder.write(chunk.subarray(0, bytesRead));
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        consume(line);
        newline = pending.indexOf('\n');
      }
    }
    pending += decoder.end();
    if (pending.trim()) {
      // Match readJournal's crash-tolerance contract: a complete final JSON
      // record without a newline is valid; an incomplete tail is ignored and
      // will be repaired by the next append.
      try {
        consume(pending);
      } catch (error) {
        if (!(error instanceof DefAgentSessionStoreError)
          || error.code !== 'CORRUPT_EVENT_JOURNAL'
          || !/invalid JSON/u.test(error.message)) {
          throw error;
        }
      }
    }
    return clone(page);
  } catch (error) {
    if (error instanceof DefAgentSessionStoreError) throw error;
    return fail('CORRUPT_EVENT_JOURNAL', `Unable to read event journal: ${errorMessage(error)}`, target);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
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

export class MemoryDefAgentSessionStore implements DefAgentSessionStore {
  readonly #sessions = new Map<DefSessionId, DefAgentSessionRecord>();
  readonly #events = new Map<DefSessionId, DefEvent[]>();
  #activeSessionId: DefSessionId | null = null;

  load(options: DefAgentSessionStoreLoadOptions = {}): DefAgentSessionStoreSnapshot {
    const eventLoad = options.eventLoad ?? 'all';
    const events = eventLoad === 'all'
      ? this.#events
      : eventLoad === 'active' && this.#activeSessionId !== null
        ? new Map([[this.#activeSessionId, this.#events.get(this.#activeSessionId) ?? []]])
        : new Map<DefSessionId, readonly DefEvent[]>();
    return makeSnapshot(this.#activeSessionId, [...this.#sessions.values()], events);
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

  loadEventPage(defSessionId: DefSessionId, afterSequence: number, limit: number): readonly DefEvent[] {
    assertPortableId(defSessionId, 'defSessionId', 'INVALID_SESSION_ID');
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      fail('INVALID_RECORD', 'afterSequence must be a non-negative safe integer', null);
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      fail('INVALID_RECORD', 'limit must be a positive safe integer', null);
    }
    return clone((this.#events.get(defSessionId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .slice(0, limit));
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
      if (
        existing.userMessage !== turn.userMessage
        || (existing.attachmentDigest ?? null) !== (turn.attachmentDigest ?? null)
        || existing.result.defTurnId !== turn.result.defTurnId
      ) {
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

  flush(_defSessionId: DefSessionId): void {}

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
  load(_options?: DefAgentSessionStoreLoadOptions): DefAgentSessionStoreSnapshot {
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
  flush(_defSessionId: DefSessionId): void {}
  delete(_defSessionId: DefSessionId): void {}
  setActive(_defSessionId: DefSessionId | null): void {}
}

export class FileDefAgentSessionStore implements DefAgentSessionStore {
  readonly root: string;
  readonly registryPath: string;
  readonly sessionsPath: string;
  readonly #journalStates = new Map<DefSessionId, JournalState>();

  constructor(options: FileDefAgentSessionStoreOptions) {
    this.root = normalizePath(options.root);
    this.registryPath = path.join(this.root, REGISTRY_FILE_NAME);
    this.sessionsPath = path.join(this.root, SESSION_DIRECTORY_NAME);
    assertPathWithinRoot(this.root, this.registryPath);
    assertPathWithinRoot(this.root, this.sessionsPath);
    assertDirectory(this.root, 'session store root', true);
    assertDirectory(this.sessionsPath, 'session store sessions directory', true);
  }

  load(options: DefAgentSessionStoreLoadOptions = {}): DefAgentSessionStoreSnapshot {
    const registry = this.#readRegistry();
    const eventLoad = options.eventLoad ?? 'all';
    const eventSessionIds = eventLoad === 'all'
      ? new Set(registry.sessionIds)
      : eventLoad === 'active' && registry.activeSessionId !== null
        ? new Set([registry.activeSessionId])
        : new Set<string>();
    const sessions: DefAgentSessionRecord[] = [];
    const events = new Map<DefSessionId, readonly DefEvent[]>();
    for (const sessionIdText of registry.sessionIds) {
      const sessionId = asDefSessionId(sessionIdText);
      const record = this.#readMetadata(sessionId);
      sessions.push(record);
      if (eventSessionIds.has(sessionIdText)) {
        const scan = readJournal(this.#eventsPath(sessionId), sessionId);
        events.set(sessionId, scan.events);
        this.#cacheJournalState(sessionId, scan);
      }
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
    const scan = readJournal(this.#eventsPath(id), id);
    this.#cacheJournalState(id, scan);
    return clone(scan.events);
  }

  loadEventPage(defSessionId: DefSessionId, afterSequence: number, limit: number): readonly DefEvent[] {
    const id = this.#assertRegistered(defSessionId);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      fail('INVALID_RECORD', 'afterSequence must be a non-negative safe integer', null);
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      fail('INVALID_RECORD', 'limit must be a positive safe integer', null);
    }
    return readJournalPage(this.#eventsPath(id), id, afterSequence, limit);
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
    this.#journalStates.set(id, {
      nextSequence: 1,
      validByteLength: 0,
      fileByteLength: 0,
      tail: 'none',
      dirty: false,
    });
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
      if (
        existing.userMessage !== turn.userMessage
        || (existing.attachmentDigest ?? null) !== (turn.attachmentDigest ?? null)
        || existing.result.defTurnId !== turn.result.defTurnId
      ) {
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
    const state = this.#getJournalState(id, target);
    const checked = validateEvent(event, id, state.nextSequence, target);
    if (state.tail === 'incomplete') {
      try {
        this.#truncateJournal(target, state.validByteLength);
      } catch (error) {
        this.#journalStates.delete(id);
        throw error;
      }
      state.fileByteLength = state.validByteLength;
      state.tail = 'none';
    }

    let descriptor: number | null = null;
    try {
      if (!assertRegularFile(target, 'event journal', true)) {
        fail('CORRUPT_EVENT_JOURNAL', 'Registered Session has no event journal', target);
      }
      descriptor = openSync(target, fsConstants.O_WRONLY | fsConstants.O_APPEND, 0o600);
      const prefix = state.tail === 'complete-no-newline' ? '\n' : '';
      const bytes = Buffer.from(`${prefix}${serialize(checked, target)}\n`, 'utf8');
      writeAll(descriptor, bytes, target);
      state.validByteLength = state.fileByteLength + bytes.length;
      state.fileByteLength = state.validByteLength;
      state.nextSequence = checked.sequence + 1;
      state.tail = 'none';
      state.dirty = true;
      if (event.type !== 'response.delta') {
        fsyncSync(descriptor);
        state.dirty = false;
      }
      chmodSync(target, 0o600);
    } catch (error) {
      this.#journalStates.delete(id);
      if (error instanceof DefAgentSessionStoreError) throw error;
      fail('IO_ERROR', `Unable to append event journal: ${errorMessage(error)}`, target);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
    if (event.type !== 'response.delta') {
      try {
        syncDirectory(path.dirname(target));
      } catch (error) {
        this.#journalStates.delete(id);
        throw error;
      }
    }
  }

  flush(defSessionId: DefSessionId): void {
    const id = this.#assertRegistered(defSessionId);
    const target = this.#eventsPath(id);
    const state = this.#getJournalState(id, target);
    if (!state.dirty) return;
    let descriptor: number | null = null;
    try {
      if (!assertRegularFile(target, 'event journal', true)) {
        fail('CORRUPT_EVENT_JOURNAL', 'Registered Session has no event journal', target);
      }
      descriptor = openSync(target, fsConstants.O_WRONLY, 0o600);
      fsyncSync(descriptor);
      state.dirty = false;
      syncDirectory(path.dirname(target));
    } catch (error) {
      this.#journalStates.delete(id);
      if (error instanceof DefAgentSessionStoreError) throw error;
      fail('IO_ERROR', `Unable to flush event journal: ${errorMessage(error)}`, target);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
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
    this.#journalStates.delete(id);
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

  #cacheJournalState(id: DefSessionId, scan: JournalScan): JournalState {
    const previous = this.#journalStates.get(id);
    const state: JournalState = {
      nextSequence: scan.events.length + 1,
      validByteLength: scan.validByteLength,
      fileByteLength: scan.fileByteLength,
      tail: scan.tail,
      dirty: previous?.fileByteLength === scan.fileByteLength && previous.dirty,
    };
    this.#journalStates.set(id, state);
    return state;
  }

  #journalFileByteLength(target: string): number {
    if (!assertRegularFile(target, 'event journal', true)) {
      fail('CORRUPT_EVENT_JOURNAL', 'Registered Session has no event journal', target);
    }
    try {
      return lstatSync(target).size;
    } catch (error) {
      if (error instanceof DefAgentSessionStoreError) throw error;
      fail('IO_ERROR', `Unable to inspect event journal: ${errorMessage(error)}`, target);
    }
  }

  #getJournalState(id: DefSessionId, target: string): JournalState {
    const cached = this.#journalStates.get(id);
    if (cached && this.#journalFileByteLength(target) === cached.fileByteLength) return cached;
    return this.#cacheJournalState(id, readJournal(target, id));
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
      harnessTransactions: record.harnessTransactions ?? [],
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
