/**
 * JSONL scanner and safe path boundary for Runtime Session files.
 *
 * A malformed physical line is incompatible unless it is the final,
 * unterminated line. Such a tail is returned to the caller for explicit
 * truncation; this reader does not replay or execute anything.
 * The JSONL scan/reopen shape is derived from Pi
 * packages/coding-agent/src/core/session-manager.ts pinned at commit
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
  readSync,
  realpathSync,
  type BigIntStats,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { RUNTIME_SESSION_LIMITS } from './entries.ts';
import {
  createSessionValidationCursor,
  SessionLogError,
  type SessionValidationCursor,
  type ValidatedSession,
} from './session-validator.ts';

const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
const READ_CHUNK_BYTES = 64 * 1_024;
export const SESSION_LINE_BYTE_LIMIT = RUNTIME_SESSION_LIMITS.maxLineCodeUnits * 4;
export const SESSION_FILE_BYTE_LIMIT = 512 * 1_024 * 1_024;
export const SESSION_VALIDATION_CURSOR = Symbol('sessionValidationCursor');

export type SessionTailState = 'none' | 'incomplete' | 'complete-no-newline';

export interface SessionPathOptions {
  /** Required trusted directory boundary for the log path. */
  readonly rootDir: string;
}

export interface SessionReaderOptions extends SessionPathOptions {
  /** Repair an unterminated malformed tail before returning. */
  readonly repairIncompleteTail?: boolean;
}

export interface SessionPathBindingSnapshot {
  readonly device: string;
  readonly inode: string;
  readonly owner: number;
  readonly mode: number;
}

export interface SessionParentSnapshot {
  /** Trusted root followed by every directory down to the file's parent. */
  readonly directories: readonly SessionPathBindingSnapshot[];
}

export interface SessionFileSnapshot extends SessionPathBindingSnapshot {
  readonly byteLength: number;
  /** Bigint timestamps are revision checks, never part of inode identity. */
  readonly modifiedAtNs: string;
  readonly changedAtNs: string;
  readonly parent: SessionParentSnapshot;
}

export interface SessionFileScan {
  readonly filePath: string;
  readonly records: readonly unknown[];
  readonly validation: ValidatedSession;
  readonly fileByteLength: number;
  readonly validByteLength: number;
  readonly tail: SessionTailState;
  readonly endsWithNewline: boolean;
  readonly fileSnapshot: SessionFileSnapshot;
  readonly [SESSION_VALIDATION_CURSOR]: SessionValidationCursor;
}

export interface SessionReadResult extends ValidatedSession {
  readonly filePath: string;
  readonly fileByteLength: number;
  readonly validByteLength: number;
  readonly tail: SessionTailState;
  readonly repairedTail: boolean;
  readonly endsWithNewline: boolean;
  readonly fileSnapshot: SessionFileSnapshot;
  readonly [SESSION_VALIDATION_CURSOR]: SessionValidationCursor;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function currentUid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

export type SessionPlatformStatIssue = 'owner' | 'private-mode' | 'writable-directory' | null;

export interface SessionPlatformAdapter {
  readonly platform: NodeJS.Platform;
  directoryIssue(stats: { readonly uid: number | bigint; readonly mode: number | bigint }): SessionPlatformStatIssue;
  privateFileIssue(stats: { readonly uid: number | bigint; readonly mode: number | bigint }): SessionPlatformStatIssue;
}

/**
 * Node exposes POSIX ownership/mode semantics only on POSIX. On Windows the
 * adapter relies on lstat/fstat type, symlink and identity checks elsewhere in
 * this module instead of misinterpreting synthetic uid/mode values.
 */
export function createSessionPlatformAdapter(
  platform: NodeJS.Platform,
  uid: number | null,
): SessionPlatformAdapter {
  return {
    platform,
    directoryIssue: (stats) => {
      if (platform === 'win32') return null;
      if (uid !== null && Number(stats.uid) !== uid) return 'owner';
      return (Number(stats.mode) & 0o022) === 0 ? null : 'writable-directory';
    },
    privateFileIssue: (stats) => {
      if (platform === 'win32') return null;
      if (uid !== null && Number(stats.uid) !== uid) return 'owner';
      return (Number(stats.mode) & 0o7777) === 0o600 ? null : 'private-mode';
    },
  };
}

const PLATFORM_ADAPTER = createSessionPlatformAdapter(process.platform, currentUid());

function pathInvalid(reason: string): never {
  throw new SessionLogError('SESSION_PATH_INVALID', `Session path is invalid: ${reason}`);
}

function ioError(): never {
  throw new SessionLogError('SESSION_IO_ERROR', 'Session file I/O failed.');
}

function notFound(): never {
  throw new SessionLogError('SESSION_NOT_FOUND', 'Session file was not found.');
}

function stale(): never {
  throw new SessionLogError('SESSION_STALE', 'Session file changed during operation.');
}

function assertSafeDirectoryStats(stats: BigIntStats, label: string): void {
  if (!stats.isDirectory()) pathInvalid(`${label} is not a directory`);
  const issue = PLATFORM_ADAPTER.directoryIssue(stats);
  if (issue === 'owner') pathInvalid(`${label} owner is not the current process owner`);
  if (issue === 'writable-directory') {
    pathInvalid(`${label} is group- or world-writable`);
  }
}

function bindingFromStats(stats: BigIntStats): SessionPathBindingSnapshot {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    owner: Number(stats.uid),
    mode: Number(stats.mode) & 0o7777,
  };
}

function snapshotFromStats(
  stats: BigIntStats,
  parent: SessionParentSnapshot,
): SessionFileSnapshot {
  if (stats.size < 0n || stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    pathInvalid('session file size is invalid');
  }
  return {
    ...bindingFromStats(stats),
    byteLength: Number(stats.size),
    modifiedAtNs: String(stats.mtimeNs),
    changedAtNs: String(stats.ctimeNs),
    parent,
  };
}

function sameBinding(
  left: SessionPathBindingSnapshot,
  right: SessionPathBindingSnapshot,
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.owner === right.owner
    && left.mode === right.mode;
}

function sameParent(left: SessionParentSnapshot, right: SessionParentSnapshot): boolean {
  return left.directories.length === right.directories.length
    && left.directories.every((directory, index) => (
      sameBinding(directory, right.directories[index]!)
    ));
}

function sameFileBinding(left: SessionFileSnapshot, right: SessionFileSnapshot): boolean {
  return sameBinding(left, right) && sameParent(left.parent, right.parent);
}

function sameObservedFile(left: SessionFileSnapshot, right: SessionFileSnapshot): boolean {
  return sameFileBinding(left, right)
    && left.byteLength === right.byteLength;
}

function samePreOperationSnapshot(left: SessionFileSnapshot, right: SessionFileSnapshot): boolean {
  return sameObservedFile(left, right)
    && left.modifiedAtNs === right.modifiedAtNs
    && left.changedAtNs === right.changedAtNs;
}

function assertPrivateRegularStats(stats: BigIntStats): void {
  if (!stats.isFile()) pathInvalid('session path is not a regular file');
  const issue = PLATFORM_ADAPTER.privateFileIssue(stats);
  if (issue === 'owner') pathInvalid('file owner is not the current process owner');
  if (issue === 'private-mode') pathInvalid('session file must be mode 0600');
}

function lstatIfExists(target: string): BigIntStats | null {
  try {
    return lstatSync(target, { bigint: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    ioError();
  }
  return null;
}

interface TrustedRoot {
  readonly lexical: string;
  readonly canonical: string;
  readonly binding: SessionPathBindingSnapshot;
}

function resolveTrustedRoot(boundary: string | undefined): TrustedRoot {
  if (typeof boundary !== 'string' || boundary.trim().length === 0) {
    pathInvalid('rootDir is required');
  }
  const lexical = resolve(boundary);
  if (lexical === dirname(lexical)) pathInvalid('the filesystem root cannot be a session root');
  const rootStats = lstatIfExists(lexical);
  if (!rootStats) pathInvalid('session root does not exist');
  if (rootStats.isSymbolicLink()) pathInvalid('session root cannot be a symbolic link');
  assertSafeDirectoryStats(rootStats, 'session root');
  let canonical: string;
  try {
    canonical = realpathSync.native(lexical);
  } catch {
    ioError();
  }
  const canonicalStats = lstatIfExists(canonical);
  if (!canonicalStats || canonicalStats.isSymbolicLink()) {
    pathInvalid('session root is not a stable directory');
  }
  assertSafeDirectoryStats(canonicalStats, 'session root');
  const lexicalBinding = bindingFromStats(rootStats);
  const canonicalBinding = bindingFromStats(canonicalStats);
  if (!sameBinding(lexicalBinding, canonicalBinding)) stale();
  return { lexical, canonical, binding: canonicalBinding };
}

function childWithinTrustedRoot(target: string, root: TrustedRoot): string {
  if (isInside(root.lexical, target)) return relative(root.lexical, target);
  if (isInside(root.canonical, target)) return relative(root.canonical, target);
  pathInvalid('path escapes the session root');
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(child);
}

interface SessionPathContext {
  readonly root: TrustedRoot;
  readonly target: string;
  readonly childParts: readonly string[];
}

function sessionPathContext(
  filePath: string,
  options: SessionPathOptions | undefined,
): SessionPathContext {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) pathInvalid('path must be a non-empty string');
  const root = resolveTrustedRoot(options?.rootDir);
  const requested = resolve(filePath);
  if (requested === dirname(requested)) pathInvalid('the filesystem root cannot be a session file');
  const childPath = childWithinTrustedRoot(requested, root);
  const childParts = childPath.split(/[\\/]/u).filter(Boolean);
  if (childParts.includes('..') || childParts.length === 0) pathInvalid('path traversal is not allowed');
  return { root, target: resolve(root.canonical, childPath), childParts };
}

function inspectPathComponents(
  context: SessionPathContext,
  requireCompleteParent: boolean,
): SessionParentSnapshot {
  const directories: SessionPathBindingSnapshot[] = [context.root.binding];
  let cursor = context.root.canonical;
  for (const [index, part] of context.childParts.entries()) {
    const isTarget = index === context.childParts.length - 1;
    cursor = `${cursor}${cursor.endsWith(sep) ? '' : sep}${part}`;
    const stats = lstatIfExists(cursor);
    if (!stats) {
      if (requireCompleteParent && !isTarget) pathInvalid('session parent does not exist');
      break;
    }
    if (stats.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
    if (isTarget) break;
    assertSafeDirectoryStats(stats, 'session parent');
    directories.push(bindingFromStats(stats));
  }
  if (requireCompleteParent && directories.length !== context.childParts.length) {
    pathInvalid('session parent does not exist');
  }
  return { directories };
}

/** Reject symlinked path components below (not above) the canonical trusted root. */
export function assertNoSymlinkComponents(target: string, boundary: string): void {
  const root = resolveTrustedRoot(boundary);
  const absolute = resolve(target);
  if (absolute === root.lexical || absolute === root.canonical) return;
  inspectPathComponents(sessionPathContext(target, { rootDir: boundary }), false);
}

/** Resolve a log path beneath its required non-escaping trusted root. */
export function resolveSessionPath(filePath: string, options: SessionPathOptions): string {
  const context = sessionPathContext(filePath, options);
  inspectPathComponents(context, false);
  return context.target;
}

export function snapshotSessionParent(
  filePath: string,
  options: SessionPathOptions,
): SessionParentSnapshot {
  // Node has no portable openat/dirfd walk. This snapshot detects every parent
  // swap that crosses the pre/post checkpoints used by create/read/append/
  // truncate; a swap fully performed and restored between two lstat calls
  // cannot be proven absent, so all observed mismatches fail closed.
  return inspectPathComponents(sessionPathContext(filePath, options), true);
}

export function assertSessionParentSnapshot(
  filePath: string,
  expected: SessionParentSnapshot,
  options: SessionPathOptions,
): SessionParentSnapshot {
  const current = snapshotSessionParent(filePath, options);
  if (!sameParent(expected, current)) stale();
  return current;
}

/** Ensure the parent exists without following a symlinked component. */
export function ensureSessionParent(
  filePath: string,
  options: SessionPathOptions,
): SessionParentSnapshot {
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
  if (!parentStats) pathInvalid('session parent is not a directory');
  assertSafeDirectoryStats(parentStats, 'session parent');
  return snapshotSessionParent(target, options);
}

/** Verify a session file is already a current-owner regular file with mode 0600. */
export function assertPrivateSessionFile(
  filePath: string,
  options: SessionPathOptions,
): SessionFileSnapshot {
  const target = resolveSessionPath(filePath, options);
  const parentBefore = snapshotSessionParent(target, options);
  const stats = lstatIfExists(target);
  if (!stats) notFound();
  if (stats.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
  assertPrivateRegularStats(stats);
  const parentAfter = snapshotSessionParent(target, options);
  if (!sameParent(parentBefore, parentAfter)) stale();
  // A permissive historical mode is irreversible exposure, so reopening must
  // reject it instead of chmod-ing the file into apparent compliance.
  return snapshotFromStats(stats, parentAfter);
}

export function assertSessionFileSnapshot(
  filePath: string,
  expected: SessionFileSnapshot,
  options: SessionPathOptions,
): SessionFileSnapshot {
  const current = assertPrivateSessionFile(filePath, options);
  if (!samePreOperationSnapshot(expected, current)) stale();
  return current;
}

/** Bind an opened descriptor to the current path and an optional prior snapshot. */
export function assertBoundSessionFileDescriptor(
  filePath: string,
  descriptor: number,
  options: SessionPathOptions,
  expected?: SessionFileSnapshot,
  expectedParent?: SessionParentSnapshot,
): SessionFileSnapshot {
  const target = resolveSessionPath(filePath, options);
  const parentBefore = snapshotSessionParent(target, options);
  if (expectedParent !== undefined && !sameParent(expectedParent, parentBefore)) stale();
  const pathStatsBefore = lstatIfExists(target);
  if (!pathStatsBefore) notFound();
  if (pathStatsBefore.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
  assertPrivateRegularStats(pathStatsBefore);

  const descriptorStats = fstatSync(descriptor, { bigint: true });
  assertPrivateRegularStats(descriptorStats);

  const pathStatsAfter = lstatIfExists(target);
  if (!pathStatsAfter) stale();
  if (pathStatsAfter.isSymbolicLink()) pathInvalid('symbolic links are not allowed');
  assertPrivateRegularStats(pathStatsAfter);
  const parentAfter = snapshotSessionParent(target, options);
  if (!sameParent(parentBefore, parentAfter)) stale();
  if (expectedParent !== undefined && !sameParent(expectedParent, parentAfter)) stale();

  const pathBefore = snapshotFromStats(pathStatsBefore, parentBefore);
  const descriptorSnapshot = snapshotFromStats(descriptorStats, parentAfter);
  const pathAfter = snapshotFromStats(pathStatsAfter, parentAfter);
  if (!sameObservedFile(pathBefore, descriptorSnapshot) || !sameObservedFile(descriptorSnapshot, pathAfter)) {
    pathInvalid('path and descriptor do not identify the same file');
  }
  if (expected !== undefined && !samePreOperationSnapshot(expected, descriptorSnapshot)) stale();
  return descriptorSnapshot;
}

export function truncateSessionFile(
  filePath: string,
  byteLength: number,
  options: SessionPathOptions,
  expectedSnapshot?: SessionFileSnapshot,
): SessionFileSnapshot {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) pathInvalid('tail offset is invalid');
  const target = resolveSessionPath(filePath, options);
  const expected = expectedSnapshot ?? assertPrivateSessionFile(target, options);
  if (byteLength > expected.byteLength) pathInvalid('tail offset exceeds file size');
  let descriptor: number | null = null;
  try {
    descriptor = openSync(target, fsConstants.O_WRONLY | NO_FOLLOW);
    // Identity, ownership, mode, and the scanned size are checked immediately
    // before truncation so a replacement cannot redirect tail repair.
    assertBoundSessionFileDescriptor(target, descriptor, options, expected);
    ftruncateSync(descriptor, byteLength);
    fsyncSync(descriptor);
    const truncated = assertBoundSessionFileDescriptor(target, descriptor, options);
    if (!sameFileBinding(expected, truncated) || truncated.byteLength !== byteLength) stale();
    return truncated;
  } catch (error) {
    if (error instanceof SessionLogError) throw error;
    ioError();
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  return expected;
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

function decodeCompleteUtf8(buffer: Buffer, lineNumber: number): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new SessionLogError(
      'SESSION_INCOMPATIBLE',
      'Session contains invalid UTF-8 before its tail.',
      lineNumber,
    );
  }
}

function decodeTailUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

interface DescriptorScan {
  readonly records: readonly unknown[];
  readonly validByteLength: number;
  readonly tail: SessionTailState;
  readonly endsWithNewline: boolean;
}

function scanSessionDescriptor(descriptor: number, fileByteLength: number): DescriptorScan {
  const records: unknown[] = [];
  let lineParts: Buffer[] = [];
  let lineByteLength = 0;
  let lineNumber = 0;
  let validByteLength = 0;
  let position = 0;

  while (position < fileByteLength) {
    const requested = Math.min(READ_CHUNK_BYTES, fileByteLength - position);
    const chunk = Buffer.allocUnsafe(requested);
    let filled = 0;
    while (filled < requested) {
      const read = readSync(descriptor, chunk, filled, requested - filled, position + filled);
      if (read === 0) stale();
      filled += read;
    }

    let segmentStart = 0;
    for (let index = 0; index < requested; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      const segment = chunk.subarray(segmentStart, index);
      if (segment.length > 0) lineParts.push(segment);
      lineByteLength += segment.length;
      if (lineByteLength > SESSION_LINE_BYTE_LIMIT) {
        throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains an oversized JSONL record.', lineNumber);
      }
      const lineBuffer = lineByteLength === 0
        ? Buffer.alloc(0)
        : lineParts.length === 1
          ? lineParts[0]!
          : Buffer.concat(lineParts, lineByteLength);
      records.push(parsePhysicalLine(decodeCompleteUtf8(lineBuffer, lineNumber), lineNumber));
      lineNumber += 1;
      if (records.length > RUNTIME_SESSION_LIMITS.maxEntries + 1) {
        throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains too many records.');
      }
      lineParts = [];
      lineByteLength = 0;
      validByteLength = position + index + 1;
      segmentStart = index + 1;
    }
    if (segmentStart < requested) {
      const segment = chunk.subarray(segmentStart, requested);
      lineParts.push(segment);
      lineByteLength += segment.length;
      if (lineByteLength > SESSION_LINE_BYTE_LIMIT) {
        throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains an oversized tail record.', lineNumber);
      }
    }
    position += requested;
  }

  let tail: SessionTailState = 'none';
  if (lineByteLength > 0) {
    const tailBuffer = lineParts.length === 1 ? lineParts[0]! : Buffer.concat(lineParts, lineByteLength);
    const tailText = decodeTailUtf8(tailBuffer);
    if (tailText === null) {
      // A crash may split a UTF-8 code point. Only this final unterminated byte
      // span is repairable; every newline-terminated prefix was decoded fatally.
      tail = 'incomplete';
    } else if (tailText.length > RUNTIME_SESSION_LIMITS.maxLineCodeUnits) {
      throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains an oversized tail record.', lineNumber);
    } else if (tailText.trim().length === 0) {
      tail = 'incomplete';
    } else {
      try {
        records.push(JSON.parse(tailText) as unknown);
        validByteLength = fileByteLength;
        tail = 'complete-no-newline';
      } catch {
        tail = 'incomplete';
      }
    }
  }

  if (records.length > RUNTIME_SESSION_LIMITS.maxEntries + 1) {
    throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session contains too many records.');
  }
  return {
    records,
    validByteLength,
    tail,
    endsWithNewline: fileByteLength > 0 && tail === 'none',
  };
}

export function scanSessionFile(filePath: string, options: SessionPathOptions): SessionFileScan {
  const target = resolveSessionPath(filePath, options);
  const expected = assertPrivateSessionFile(target, options);
  if (expected.byteLength > SESSION_FILE_BYTE_LIMIT) {
    throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session file exceeds its structural byte limit.');
  }

  let descriptor: number | null = null;
  try {
    descriptor = openSync(target, fsConstants.O_RDONLY | NO_FOLLOW);
    const bound = assertBoundSessionFileDescriptor(target, descriptor, options, expected);
    // The descriptor is the authority for allocation/read bounds. The earlier
    // lstat limit is only a fast rejection; this fstat-bound value closes the
    // replacement window before the first read buffer is allocated.
    if (bound.byteLength > SESSION_FILE_BYTE_LIMIT) {
      throw new SessionLogError('SESSION_INCOMPATIBLE', 'Session file exceeds its structural byte limit.');
    }
    const scanned = scanSessionDescriptor(descriptor, bound.byteLength);
    const stable = assertBoundSessionFileDescriptor(target, descriptor, options, expected);
    const validationCursor = createSessionValidationCursor(scanned.records);
    const validation = validationCursor.snapshot();
    return {
      filePath: target,
      records: scanned.records,
      validation,
      fileByteLength: stable.byteLength,
      validByteLength: scanned.validByteLength,
      tail: scanned.tail,
      endsWithNewline: scanned.endsWithNewline,
      fileSnapshot: stable,
      [SESSION_VALIDATION_CURSOR]: validationCursor,
    };
  } catch (error) {
    if (error instanceof SessionLogError) throw error;
    if (isNodeError(error) && error.code === 'ENOENT') stale();
    ioError();
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  throw new SessionLogError('SESSION_IO_ERROR', 'Session file I/O failed.');
}

export function readSessionFile(filePath: string, options: SessionReaderOptions): SessionReadResult {
  const scan = scanSessionFile(filePath, options);
  let repairedTail = false;
  let fileByteLength = scan.fileByteLength;
  let validByteLength = scan.validByteLength;
  let tail = scan.tail;
  let endsWithNewline = scan.endsWithNewline;
  let fileSnapshot = scan.fileSnapshot;
  if (scan.tail === 'incomplete' && options.repairIncompleteTail === true) {
    fileSnapshot = truncateSessionFile(scan.filePath, scan.validByteLength, options, scan.fileSnapshot);
    repairedTail = true;
    fileByteLength = fileSnapshot.byteLength;
    validByteLength = fileSnapshot.byteLength;
    tail = 'none';
    endsWithNewline = fileByteLength > 0;
  }
  return {
    ...scan.validation,
    filePath: scan.filePath,
    fileByteLength,
    validByteLength,
    tail,
    repairedTail,
    endsWithNewline,
    fileSnapshot,
    [SESSION_VALIDATION_CURSOR]: scan[SESSION_VALIDATION_CURSOR],
  };
}

export const readSessionLog = readSessionFile;

export class SessionReader {
  readonly #filePath: string;
  readonly #options: SessionReaderOptions;

  constructor(filePath: string, options: SessionReaderOptions) {
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
