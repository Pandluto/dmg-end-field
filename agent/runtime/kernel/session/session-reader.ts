/**
 * JSONL scanner and safe path boundary for Runtime Session files.
 *
 * A malformed physical line is incompatible unless it is the final,
 * unterminated line. Such a tail is returned to the caller for explicit
 * truncation; this reader does not replay or execute anything.
 * The JSONL scan/reopen shape is derived from Pi session-manager pinned at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02; DEF adds strict local-file safety.
 */
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { RUNTIME_SESSION_LIMITS } from './entries.ts';
import {
  SessionLogError,
  type ValidatedSession,
  validateSessionRecords,
} from './session-validator.ts';

const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;

export type SessionTailState = 'none' | 'incomplete' | 'complete-no-newline';

export interface SessionPathOptions {
  /** Optional real directory boundary for the log path. */
  readonly rootDir?: string;
}

export interface SessionReaderOptions extends SessionPathOptions {
  /** Repair an unterminated malformed tail before returning. */
  readonly repairIncompleteTail?: boolean;
}

export interface SessionFileScan {
  readonly filePath: string;
  readonly records: readonly unknown[];
  readonly validation: ValidatedSession;
  readonly fileByteLength: number;
  readonly validByteLength: number;
  readonly tail: SessionTailState;
  readonly endsWithNewline: boolean;
}

export interface SessionReadResult extends ValidatedSession {
  readonly filePath: string;
  readonly fileByteLength: number;
  readonly validByteLength: number;
  readonly tail: SessionTailState;
  readonly repairedTail: boolean;
  readonly endsWithNewline: boolean;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function currentUid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function pathInvalid(reason: string): never {
  throw new SessionLogError('SESSION_PATH_INVALID', `Session path is invalid: ${reason}`);
}

function ioError(): never {
  throw new SessionLogError('SESSION_IO_ERROR', 'Session file I/O failed.');
}

function notFound(): never {
  throw new SessionLogError('SESSION_NOT_FOUND', 'Session file was not found.');
}

function assertOwned(stats: { readonly uid: number | bigint }): void {
  const uid = currentUid();
  if (uid !== null && Number(stats.uid) !== uid) pathInvalid('file owner is not the current process owner');
}

function assertStrictPrivateMode(stats: { readonly mode: number | bigint }): void {
  if ((Number(stats.mode) & 0o7777) !== 0o600) pathInvalid('session file must be mode 0600');
}

function lstatIfExists(target: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(target);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    ioError();
  }
  return null;
}

/** Reject symlinked path components before any create/open operation. */
export function assertNoSymlinkComponents(target: string, boundary?: string): void {
  const absolute = resolve(target);
  if (boundary === undefined) {
    const finalStats = lstatIfExists(absolute);
    if (finalStats?.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
    return;
  }
  const root = resolve(boundary);
  let cursor = root;
  const rootStats = lstatIfExists(root);
  if (rootStats?.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
  if (rootStats && !rootStats.isDirectory()) pathInvalid('session root is not a directory');
  const childPath = relative(root, absolute);
  for (const part of childPath.split(/[\\/]/u).filter(Boolean)) {
    cursor = `${cursor}${sep}${part}`;
    const stats = lstatIfExists(cursor);
    if (!stats) break;
    if (stats.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
    if (cursor !== absolute && !stats.isDirectory()) pathInvalid('a parent is not a directory');
  }
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(child);
}

/** Resolve a log path and enforce an optional non-escaping directory root. */
export function resolveSessionPath(filePath: string, options: SessionPathOptions = {}): string {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) pathInvalid('path must be a non-empty string');
  const target = resolve(filePath);
  if (target === dirname(target)) pathInvalid('the filesystem root cannot be a session file');
  if (options.rootDir !== undefined) {
    if (typeof options.rootDir !== 'string' || options.rootDir.trim().length === 0) pathInvalid('root directory is invalid');
    const root = resolve(options.rootDir);
    if (root === dirname(root)) pathInvalid('the filesystem root cannot be a session root');
    if (!isInside(root, target)) pathInvalid('path escapes the session root');
    const rootRelative = relative(root, target);
    if (rootRelative.split(/[\\/]/u).includes('..')) pathInvalid('path traversal is not allowed');
  }
  assertNoSymlinkComponents(target, options.rootDir);
  return target;
}

/** Ensure the parent exists without following a symlinked component. */
export function ensureSessionParent(filePath: string, options: SessionPathOptions = {}): void {
  const target = resolveSessionPath(filePath, options);
  const parent = dirname(target);
  assertNoSymlinkComponents(parent, options.rootDir);
  try {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  } catch {
    ioError();
  }
  assertNoSymlinkComponents(parent, options.rootDir);
  const parentStats = lstatIfExists(parent);
  if (!parentStats || !parentStats.isDirectory()) pathInvalid('session parent is not a directory');
  assertOwned(parentStats);
}

/** Verify a session file is already a current-owner regular file with mode 0600. */
export function assertPrivateSessionFile(filePath: string, options: SessionPathOptions = {}): void {
  const target = resolveSessionPath(filePath, options);
  const stats = lstatIfExists(target);
  if (!stats) notFound();
  if (stats.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
  if (!stats.isFile()) pathInvalid('session path is not a regular file');
  assertOwned(stats);
  // A permissive historical mode is irreversible exposure, so reopening must
  // reject it instead of chmod-ing the file into apparent compliance.
  assertStrictPrivateMode(stats);
}

function readPrivateFile(filePath: string, options: SessionPathOptions = {}): Buffer {
  assertPrivateSessionFile(filePath, options);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) pathInvalid('session path is not a regular file');
    assertOwned(stats);
    assertStrictPrivateMode(stats);
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof SessionLogError) throw error;
    if (isNodeError(error) && error.code === 'ENOENT') notFound();
    ioError();
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  return Buffer.alloc(0);
}

export function truncateSessionFile(filePath: string, byteLength: number, options: SessionPathOptions = {}): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) pathInvalid('tail offset is invalid');
  assertPrivateSessionFile(filePath, options);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(filePath, fsConstants.O_WRONLY | NO_FOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) pathInvalid('session path is not a regular file');
    assertOwned(stats);
    assertStrictPrivateMode(stats);
    if (byteLength > stats.size) pathInvalid('tail offset exceeds file size');
    ftruncateSync(descriptor, byteLength);
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof SessionLogError) throw error;
    ioError();
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function parsePhysicalLine(line: string, lineNumber: number): unknown {
  if (line.length > RUNTIME_SESSION_LIMITS.maxLineCodeUnits) {
    throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains an oversized JSONL record.', lineNumber);
  }
  if (line.trim().length === 0) {
    throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains an empty JSONL record.', lineNumber);
  }
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains malformed JSON before its tail.', lineNumber);
  }
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains invalid UTF-8.');
  }
}

export function scanSessionFile(filePath: string, options: SessionPathOptions = {}): SessionFileScan {
  const target = resolveSessionPath(filePath, options);
  const buffer = readPrivateFile(target, options);
  const text = decodeUtf8(buffer);
  const records: unknown[] = [];
  let lineStart = 0;
  let lineNumber = 0;
  let validByteLength = 0;

  while (true) {
    const newlineIndex = text.indexOf('\n', lineStart);
    if (newlineIndex < 0) break;
    const line = text.slice(lineStart, newlineIndex);
    records.push(parsePhysicalLine(line, lineNumber));
    lineNumber += 1;
    validByteLength = Buffer.byteLength(text.slice(0, newlineIndex + 1), 'utf8');
    lineStart = newlineIndex + 1;
    if (records.length > RUNTIME_SESSION_LIMITS.maxEntries + 1) {
      throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains too many records.');
    }
  }

  const tailText = text.slice(lineStart);
  let tail: SessionTailState = 'none';
  if (tailText.length > 0) {
    if (tailText.length > RUNTIME_SESSION_LIMITS.maxLineCodeUnits) {
      throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains an oversized tail record.', lineNumber);
    }
    if (tailText.trim().length === 0) {
      tail = 'incomplete';
    } else {
      try {
        records.push(JSON.parse(tailText) as unknown);
        validByteLength = buffer.length;
        tail = 'complete-no-newline';
      } catch {
        tail = 'incomplete';
      }
    }
  }

  if (records.length > RUNTIME_SESSION_LIMITS.maxEntries + 1) {
    throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains too many records.');
  }
  const validation = validateSessionRecords(records);
  return {
    filePath: target,
    records,
    validation,
    fileByteLength: buffer.length,
    validByteLength,
    tail,
    endsWithNewline: buffer.length > 0 && buffer[buffer.length - 1] === 0x0a,
  };
}

export function readSessionFile(filePath: string, options: SessionReaderOptions = {}): SessionReadResult {
  const scan = scanSessionFile(filePath, options);
  let repairedTail = false;
  let fileByteLength = scan.fileByteLength;
  let endsWithNewline = scan.endsWithNewline;
  if (scan.tail === 'incomplete' && options.repairIncompleteTail === true) {
    truncateSessionFile(scan.filePath, scan.validByteLength, options);
    repairedTail = true;
    fileByteLength = scan.validByteLength;
    endsWithNewline = fileByteLength > 0 && readPrivateFile(scan.filePath, options).at(-1) === 0x0a;
  }
  return {
    ...scan.validation,
    filePath: scan.filePath,
    fileByteLength,
    validByteLength: scan.validByteLength,
    tail: scan.tail,
    repairedTail,
    endsWithNewline,
  };
}

export const readSessionLog = readSessionFile;

export class SessionReader {
  readonly #filePath: string;
  readonly #options: SessionReaderOptions;

  constructor(filePath: string, options: SessionReaderOptions = {}) {
    this.#filePath = resolveSessionPath(filePath, options);
    this.#options = { ...options };
  }

  read(): SessionReadResult {
    return readSessionFile(this.#filePath, this.#options);
  }

  reopen(): SessionReadResult {
    return readSessionFile(this.#filePath, { ...this.#options, repairIncompleteTail: true });
  }
}
