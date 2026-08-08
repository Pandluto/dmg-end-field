/**
 * Append-only Runtime Session JSONL log.
 *
 * This module persists only validated Runtime records. Reopening a log builds
 * an in-memory projection; it never replays a tool, product command, approval,
 * or any other mutation outside the log itself.
 * Its append-only JSONL/header model follows Pi
 * packages/coding-agent/src/core/session-manager.ts pinned at commit
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02, with DEF-owned validation.
 */
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  RuntimeEntryId,
} from '../ids.ts';
import type {
  RuntimeRunMarkerEntry,
  RuntimeSessionEntry,
  RuntimeSessionHeader,
  RuntimeSessionRecord,
} from './entries.ts';
import {
  assertBoundSessionFileDescriptor,
  assertPrivateSessionFile,
  assertSessionParentSnapshot,
  assertSessionFileSnapshot,
  ensureSessionParent,
  readSessionFile,
  resolveSessionPath,
  SESSION_FILE_BYTE_LIMIT,
  type SessionPathOptions,
  type SessionFileSnapshot,
  type SessionParentSnapshot,
  type SessionReadResult,
} from './session-reader.ts';
import {
  SessionLogError,
  type InterruptedRuntimeRun,
  validateRuntimeSessionEntry,
  validateSessionRecords,
} from './session-validator.ts';

const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;

export interface SessionLogOptions extends SessionPathOptions {
  /** Reopen repairs only a malformed final unterminated line. */
  readonly repairIncompleteTail?: boolean;
}

export interface SessionAppendResult {
  readonly entry: RuntimeSessionEntry;
  readonly appended: boolean;
  /** True when the same entry id and payload were already durable. */
  readonly idempotent: boolean;
  readonly leafId: RuntimeEntryId;
  readonly updatedAt: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('value is not JSON serializable');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error('write made no progress');
    offset += written;
  }
}

function existingPathKind(filePath: string): 'missing' | 'file' | 'other' {
  try {
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink()) return 'other';
    return stats.isFile() ? 'file' : 'other';
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw new SessionLogError('SESSION_IO_ERROR', 'Session file status could not be read.');
  }
}

function sameFileBinding(left: SessionFileSnapshot, right: SessionFileSnapshot): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.owner === right.owner
    && left.mode === right.mode
    && left.parent.directories.length === right.parent.directories.length
    && left.parent.directories.every((directory, index) => {
      const other = right.parent.directories[index];
      return other !== undefined
        && directory.device === other.device
        && directory.inode === other.inode
        && directory.owner === other.owner
        && directory.mode === other.mode;
    });
}

function openNewSessionFile(
  filePath: string,
  header: RuntimeSessionHeader,
  options: SessionLogOptions,
  expectedParent: SessionParentSnapshot,
): void {
  const headerBytes = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8');
  let descriptor: number | null = null;
  try {
    assertSessionParentSnapshot(filePath, expectedParent, options);
    descriptor = openSync(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      0o600,
    );
    // O_EXCL proves this descriptor names the file created by this call; setting
    // its mode cannot conceal prior exposure of an existing session file.
    fchmodSync(descriptor, 0o600);
    // Node does not expose a portable openat-style parent-dir capability. We
    // therefore bind every parent before open and verify it again through the
    // final path immediately after open and after fsync; any observed swap is
    // fail-closed even though an undetectably transient swap cannot be locked.
    const created = assertBoundSessionFileDescriptor(
      filePath,
      descriptor,
      options,
      undefined,
      expectedParent,
    );
    writeAll(descriptor, headerBytes);
    fsyncSync(descriptor);
    const durable = assertBoundSessionFileDescriptor(
      filePath,
      descriptor,
      options,
      undefined,
      expectedParent,
    );
    if (!sameFileBinding(created, durable) || durable.byteLength !== headerBytes.length) {
      throw new SessionLogError('SESSION_IO_ERROR', 'Session header was not durably bound to its new file.');
    }
  } catch (error) {
    if (error instanceof SessionLogError) throw error;
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new SessionLogError('SESSION_EXISTS', 'Session file already exists.');
    }
    throw new SessionLogError('SESSION_IO_ERROR', 'Session file could not be created.');
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  assertPrivateSessionFile(filePath, options);
}

function readState(filePath: string, options: SessionLogOptions): SessionReadResult {
  return readSessionFile(filePath, {
    ...options,
    repairIncompleteTail: options.repairIncompleteTail !== false,
  });
}

export class SessionLog {
  readonly #filePath: string;
  readonly #options: SessionLogOptions;
  readonly #entryById: Map<RuntimeEntryId, RuntimeSessionEntry>;
  #state: SessionReadResult;

  private constructor(filePath: string, options: SessionLogOptions, state: SessionReadResult) {
    this.#filePath = filePath;
    this.#options = { ...options };
    this.#state = state;
    this.#entryById = new Map(state.entries.map((entry) => [entry.id, entry]));
  }

  static create(filePath: string, header: RuntimeSessionHeader, options: SessionLogOptions): SessionLog {
    const target = resolveSessionPath(filePath, options);
    const parentSnapshot = ensureSessionParent(target, options);
    const headerState = validateSessionRecords([header]);
    const kind = existingPathKind(target);
    if (kind === 'other') throw new SessionLogError('SESSION_PATH_INVALID', 'Session path is not a regular file.');
    if (kind === 'file') throw new SessionLogError('SESSION_EXISTS', 'Session file already exists.');
    openNewSessionFile(target, headerState.header, options, parentSnapshot);
    return new SessionLog(target, options, readState(target, options));
  }

  static reopen(filePath: string, options: SessionLogOptions): SessionLog {
    const target = resolveSessionPath(filePath, options);
    const state = readState(target, options);
    return new SessionLog(target, options, state);
  }

  static open(filePath: string, options: SessionLogOptions): SessionLog {
    return SessionLog.reopen(filePath, options);
  }

  static createOrReopen(filePath: string, header: RuntimeSessionHeader, options: SessionLogOptions): SessionLog {
    const suppliedHeader = validateSessionRecords([header]).header;
    const target = resolveSessionPath(filePath, options);
    const kind = existingPathKind(target);
    if (kind === 'other') throw new SessionLogError('SESSION_PATH_INVALID', 'Session path is not a regular file.');
    if (kind === 'missing') return SessionLog.create(target, suppliedHeader, options);

    // Compare before a normal reopen can repair an incomplete tail. A caller
    // must never mutate or bind to durable bytes owned by another session.
    const durable = readState(target, { ...options, repairIncompleteTail: false });
    if (canonical(suppliedHeader) !== canonical(durable.header)) {
      throw new SessionLogError('SESSION_APPEND_CONFLICT', 'Supplied session header does not match the durable header.');
    }
    if (durable.tail === 'incomplete' && options.repairIncompleteTail !== false) {
      return SessionLog.reopen(target, options);
    }
    return new SessionLog(target, options, durable);
  }

  get filePath(): string {
    return this.#filePath;
  }

  get path(): string {
    return this.#filePath;
  }

  get header(): RuntimeSessionHeader {
    return clone(this.#state.header);
  }

  get entries(): readonly RuntimeSessionEntry[] {
    return clone(this.#state.entries);
  }

  get records(): readonly RuntimeSessionRecord[] {
    return clone(this.#state.records);
  }

  get updatedAt(): string {
    return this.#state.updatedAt;
  }

  get leafId(): RuntimeEntryId | null {
    return this.#state.leafId;
  }

  get interruptedRuns(): readonly InterruptedRuntimeRun[] {
    return clone(this.#state.interruptedRuns);
  }

  get state(): SessionReadResult {
    return clone(this.#state);
  }

  getEntries(): readonly RuntimeSessionEntry[] {
    return this.entries;
  }

  getRecords(): readonly RuntimeSessionRecord[] {
    return this.records;
  }

  getHeader(): RuntimeSessionHeader {
    return this.header;
  }

  getLeafId(): RuntimeEntryId | null {
    return this.leafId;
  }

  getUpdatedAt(): string {
    return this.updatedAt;
  }

  getInterruptedRuns(): readonly InterruptedRuntimeRun[] {
    return this.interruptedRuns;
  }

  /**
   * Append one validated entry. Repeating the same id and canonical payload is
   * a no-op within this descriptor-bound instance snapshot; after another
   * writer changes the file, the caller must reopen before retrying. Reusing an
   * id with another payload is a conflict. A new id is never deduplicated by
   * payload, so callers must own entry-id generation.
   */
  append(entry: RuntimeSessionEntry): RuntimeEntryId {
    return this.appendDetailed(entry).entry.id;
  }

  appendEntry(entry: RuntimeSessionEntry): SessionAppendResult {
    return this.appendDetailed(entry);
  }

  appendDetailed(entry: RuntimeSessionEntry): SessionAppendResult {
    assertSessionFileSnapshot(this.#filePath, this.#state.fileSnapshot, this.#options);
    if (this.#state.tail === 'incomplete' && !this.#state.repairedTail) {
      throw new SessionLogError('SESSION_INCOMPATIBLE', 'An incomplete session tail must be repaired before append.');
    }

    const incoming = clone(validateRuntimeSessionEntry(entry, this.#state.records.length));
    const existing = this.#entryById.get(incoming.id);
    if (existing) {
      if (canonical(existing) !== canonical(incoming)) {
        throw new SessionLogError('SESSION_APPEND_CONFLICT', 'An entry id already has a different payload.');
      }
      return {
        entry: clone(existing),
        appended: false,
        idempotent: true,
        leafId: this.#state.leafId!,
        updatedAt: this.#state.updatedAt,
      };
    }

    // One linear in-memory whole-graph validation preserves all lifecycle and
    // ancestry invariants. Append performs no redundant disk rescan; reopen is
    // the single streaming recovery/validation path after external changes.
    const candidateRecords = [...this.#state.records, incoming];
    const candidateState = validateSessionRecords(candidateRecords);
    const durable = this.#appendPhysicalLine(
      this.#state.endsWithNewline,
      incoming,
      this.#state.fileSnapshot,
    );
    this.#state = {
      ...candidateState,
      filePath: this.#filePath,
      fileByteLength: durable.byteLength,
      validByteLength: durable.byteLength,
      tail: 'none',
      repairedTail: false,
      endsWithNewline: true,
      fileSnapshot: durable,
    };
    this.#entryById.set(incoming.id, incoming);
    return {
      entry: clone(incoming),
      appended: true,
      idempotent: false,
      leafId: this.#state.leafId!,
      updatedAt: this.#state.updatedAt,
    };
  }

  #appendPhysicalLine(
    endsWithNewline: boolean,
    entry: RuntimeSessionEntry,
    expected: SessionFileSnapshot,
  ): SessionFileSnapshot {
    const bytes = Buffer.from(`${endsWithNewline ? '' : '\n'}${JSON.stringify(entry)}\n`, 'utf8');
    if (expected.byteLength + bytes.length > SESSION_FILE_BYTE_LIMIT) {
      throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session file would exceed its operational byte limit.');
    }
    let descriptor: number | null = null;
    try {
      descriptor = openSync(this.#filePath, fsConstants.O_WRONLY | fsConstants.O_APPEND | NO_FOLLOW);
      // Re-bind immediately before write: stale size or inode means another
      // writer/replacement won, so this instance must reopen instead of append.
      const before = assertBoundSessionFileDescriptor(
        this.#filePath,
        descriptor,
        this.#options,
        expected,
      );
      writeAll(descriptor, bytes);
      fsyncSync(descriptor);
      const durable = assertBoundSessionFileDescriptor(this.#filePath, descriptor, this.#options);
      if (!sameFileBinding(before, durable) || durable.byteLength !== before.byteLength + bytes.length) {
        throw new SessionLogError('SESSION_STALE', 'Session file changed during append.');
      }
      return durable;
    } catch (error) {
      if (error instanceof SessionLogError) throw error;
      throw new SessionLogError('SESSION_IO_ERROR', 'Session entry could not be appended.');
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
    return expected;
  }

  /**
   * Explicitly persist the interrupted terminal marker for the currently
   * unclosed run. This only appends a Runtime marker; it never re-executes a
   * tool or product mutation. Reopen itself remains read/repair-only.
   */
  markInterrupted(options: {
    readonly entryId?: RuntimeEntryId;
    readonly createdAt?: string;
    readonly code?: string;
    readonly message?: string;
  } = {}): RuntimeEntryId | null {
    const run = this.#state.interruptedRuns.find((candidate) => candidate.endEntryId === null);
    if (!run) return null;
    const entry: RuntimeRunMarkerEntry = {
      schemaVersion: 1,
      id: options.entryId ?? (`runtime-entry-recovery-${randomUUID()}` as RuntimeEntryId),
      parentId: this.#state.leafId,
      createdAt: options.createdAt ?? new Date().toISOString(),
      type: 'run-marker',
      phase: 'end',
      defTurnId: run.defTurnId,
      runId: run.runId,
      turnId: run.turnId,
      terminal: {
        status: 'interrupted',
        code: options.code ?? 'session-recovered-interrupted',
        message: options.message ?? 'The runtime run was interrupted before session reopen.',
      },
    };
    return this.append(entry);
  }

  recoverInterruptedRun(options: {
    readonly entryId?: RuntimeEntryId;
    readonly createdAt?: string;
    readonly code?: string;
    readonly message?: string;
  } = {}): RuntimeEntryId | null {
    return this.markInterrupted(options);
  }

  /** No open descriptor is retained; provided for lifecycle symmetry. */
  close(): void {
    // Intentionally empty. Each operation uses a short-lived descriptor.
  }
}

export function createSessionLog(
  filePath: string,
  header: RuntimeSessionHeader,
  options: SessionLogOptions,
): SessionLog {
  return SessionLog.create(filePath, header, options);
}

export function reopenSessionLog(filePath: string, options: SessionLogOptions): SessionLog {
  return SessionLog.reopen(filePath, options);
}

export const openSessionLog = reopenSessionLog;

export function createOrReopenSessionLog(
  filePath: string,
  header: RuntimeSessionHeader,
  options: SessionLogOptions,
): SessionLog {
  return SessionLog.createOrReopen(filePath, header, options);
}

export { SessionLogError };
