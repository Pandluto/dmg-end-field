/**
 * Append-only Runtime Session JSONL log.
 *
 * This module persists only validated Runtime records. Reopening a log builds
 * an in-memory projection; it never replays a tool, product command, approval,
 * or any other mutation outside the log itself.
 * Its append-only JSONL/header model follows Pi session-manager pinned at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02, with DEF-owned validation.
 */
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
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
  assertPrivateSessionFile,
  ensureSessionParent,
  readSessionFile,
  resolveSessionPath,
  type SessionPathOptions,
  type SessionReadResult,
} from './session-reader.ts';
import {
  SessionLogError,
  type InterruptedRuntimeRun,
  type ValidatedSession,
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

function openNewSessionFile(filePath: string, header: RuntimeSessionHeader): void {
  const headerBytes = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8');
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      0o600,
    );
    // O_EXCL proves this descriptor names the file created by this call; setting
    // its mode cannot conceal prior exposure of an existing session file.
    fchmodSync(descriptor, 0o600);
    writeAll(descriptor, headerBytes);
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof SessionLogError) throw error;
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new SessionLogError('SESSION_EXISTS', 'Session file already exists.');
    }
    throw new SessionLogError('SESSION_IO_ERROR', 'Session file could not be created.');
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  assertPrivateSessionFile(filePath);
}

function readState(filePath: string, options: SessionLogOptions): SessionReadResult {
  return readSessionFile(filePath, {
    ...options,
    repairIncompleteTail: options.repairIncompleteTail !== false,
  });
}

function stateRecords(state: ValidatedSession): readonly RuntimeSessionRecord[] {
  return state.records;
}

function sameRecords(left: readonly RuntimeSessionRecord[], right: readonly RuntimeSessionRecord[]): boolean {
  return canonical(left) === canonical(right);
}

export class SessionLog {
  readonly #filePath: string;
  readonly #options: SessionLogOptions;
  #state: SessionReadResult;

  private constructor(filePath: string, options: SessionLogOptions, state: SessionReadResult) {
    this.#filePath = filePath;
    this.#options = { ...options };
    this.#state = state;
  }

  static create(filePath: string, header: RuntimeSessionHeader, options: SessionLogOptions = {}): SessionLog {
    const target = resolveSessionPath(filePath, options);
    ensureSessionParent(target, options);
    const headerState = validateSessionRecords([header]);
    const kind = existingPathKind(target);
    if (kind === 'other') throw new SessionLogError('SESSION_PATH_INVALID', 'Session path is not a regular file.');
    if (kind === 'file') throw new SessionLogError('SESSION_EXISTS', 'Session file already exists.');
    openNewSessionFile(target, headerState.header);
    return new SessionLog(target, options, readState(target, options));
  }

  static reopen(filePath: string, options: SessionLogOptions = {}): SessionLog {
    const target = resolveSessionPath(filePath, options);
    const state = readState(target, options);
    return new SessionLog(target, options, state);
  }

  static open(filePath: string, options: SessionLogOptions = {}): SessionLog {
    return SessionLog.reopen(filePath, options);
  }

  static createOrReopen(filePath: string, header: RuntimeSessionHeader, options: SessionLogOptions = {}): SessionLog {
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
    return SessionLog.reopen(target, options);
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
   * a no-op; reusing an id with another payload is a conflict. A new id is
   * never deduplicated by payload, so callers must own entry-id generation.
   */
  append(entry: RuntimeSessionEntry): RuntimeEntryId {
    return this.appendDetailed(entry).entry.id;
  }

  appendEntry(entry: RuntimeSessionEntry): SessionAppendResult {
    return this.appendDetailed(entry);
  }

  appendDetailed(entry: RuntimeSessionEntry): SessionAppendResult {
    const current = readState(this.#filePath, this.#options);
    const incoming = validateRuntimeSessionEntry(entry, current.records.length);
    const existing = current.entries.find((candidate) => candidate.id === incoming.id);
    if (existing) {
      if (canonical(existing) !== canonical(incoming)) {
        throw new SessionLogError('SESSION_APPEND_CONFLICT', 'An entry id already has a different payload.');
      }
      this.#state = current;
      return {
        entry: clone(existing),
        appended: false,
        idempotent: true,
        leafId: current.leafId!,
        updatedAt: current.updatedAt,
      };
    }
    if (!sameRecords(stateRecords(current), stateRecords(this.#state))) {
      throw new SessionLogError('SESSION_STALE', 'Session log changed; reopen before appending.');
    }

    const candidateRecords = [...current.records, incoming];
    const candidateState = validateSessionRecords(candidateRecords);
    this.#appendPhysicalLine(current.endsWithNewline, incoming);
    this.#state = readState(this.#filePath, this.#options);
    // The second validation is intentional: the durable bytes, not the
    // in-memory candidate, are the source of truth after an append.
    if (!sameRecords(candidateState.records, this.#state.records)) {
      throw new SessionLogError('SESSION_IO_ERROR', 'Durable session bytes differ from the appended record.');
    }
    return {
      entry: clone(incoming),
      appended: true,
      idempotent: false,
      leafId: this.#state.leafId!,
      updatedAt: this.#state.updatedAt,
    };
  }

  #appendPhysicalLine(endsWithNewline: boolean, entry: RuntimeSessionEntry): void {
    const bytes = Buffer.from(`${endsWithNewline ? '' : '\n'}${JSON.stringify(entry)}\n`, 'utf8');
    let descriptor: number | null = null;
    try {
      assertPrivateSessionFile(this.#filePath, this.#options);
      descriptor = openSync(this.#filePath, fsConstants.O_WRONLY | fsConstants.O_APPEND | NO_FOLLOW);
      const stats = fstatSync(descriptor);
      if (!stats.isFile()) throw new SessionLogError('SESSION_PATH_INVALID', 'Session path is not a regular file.');
      if ((Number(stats.mode) & 0o7777) !== 0o600) {
        throw new SessionLogError('SESSION_PATH_INVALID', 'Session file must be mode 0600.');
      }
      writeAll(descriptor, bytes);
      fsyncSync(descriptor);
    } catch (error) {
      if (error instanceof SessionLogError) throw error;
      throw new SessionLogError('SESSION_IO_ERROR', 'Session entry could not be appended.');
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
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
  options: SessionLogOptions = {},
): SessionLog {
  return SessionLog.create(filePath, header, options);
}

export function reopenSessionLog(filePath: string, options: SessionLogOptions = {}): SessionLog {
  return SessionLog.reopen(filePath, options);
}

export const openSessionLog = reopenSessionLog;

export function createOrReopenSessionLog(
  filePath: string,
  header: RuntimeSessionHeader,
  options: SessionLogOptions = {},
): SessionLog {
  return SessionLog.createOrReopen(filePath, header, options);
}

export { SessionLogError };
