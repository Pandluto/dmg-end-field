import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  truncateSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  canonicalJson,
  type Phase2ProductCommand,
  type ProductCommandResult,
} from '../core/contracts/index.ts';
import type { BrowserCommandDelivery } from '../core/contracts/browser-protocol.ts';

export const PRODUCT_COMMAND_STORE_SCHEMA_VERSION = 1 as const;

export type ProductCommandStoreStatus = 'queued' | 'dispatched' | 'reconciling' | 'terminal';
export type ProductCommandDeliveryMode = NonNullable<BrowserCommandDelivery['mode']>;

export type ProductCommandStoreRecord = {
  readonly schemaVersion: typeof PRODUCT_COMMAND_STORE_SCHEMA_VERSION;
  readonly cursor: number;
  readonly command: Phase2ProductCommand;
  readonly fingerprint: string;
  readonly acceptedAt: string;
  readonly status: ProductCommandStoreStatus;
  readonly deliveryMode: ProductCommandDeliveryMode;
  readonly result: ProductCommandResult | null;
};

export class ProductCommandStoreError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'ProductCommandStoreError';
    this.code = code;
    this.details = details;
  }
}

export interface ProductCommandStore {
  initialize(): void;
  accept(command: Phase2ProductCommand, acceptedAt: string): ProductCommandStoreRecord;
  markDispatched(commandId: string): ProductCommandStoreRecord;
  recordResult(commandId: string, result: ProductCommandResult): ProductCommandStoreRecord;
  get(commandId: string): ProductCommandStoreRecord | null;
  list(): readonly ProductCommandStoreRecord[];
}

const ACTIVE_STATUSES: readonly ProductCommandStoreStatus[] = [
  'queued',
  'dispatched',
  'reconciling',
];

const TERMINAL_RESULT_STATUSES = new Set<ProductCommandResult['status']>([
  'succeeded',
  'committed',
  'not-executed',
  'rejected',
  'conflict',
  'error',
  'orphaned',
]);
const RECORD_KEYS = new Set([
  'schemaVersion',
  'cursor',
  'command',
  'fingerprint',
  'acceptedAt',
  'status',
  'deliveryMode',
  'result',
]);
const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function canonical(value: unknown): string {
  return canonicalJson(value as Parameters<typeof canonicalJson>[0]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isSafeNullableRevision(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function assertDirectoryPath(target: string): void {
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new ProductCommandStoreError(
      'Product command store root must be a real directory.',
      'PRODUCT_COMMAND_STORE_PATH_INVALID',
      target,
    );
  }
}

function assertRegularFilePath(target: string): void {
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new ProductCommandStoreError(
      'Product command store log must be a real regular file.',
      'PRODUCT_COMMAND_STORE_PATH_INVALID',
      target,
    );
  }
}

function assertValidResult(value: unknown, commandId: string): asserts value is ProductCommandResult {
  if (!isRecord(value)) {
    throw new ProductCommandStoreError(
      `Persisted result for ${commandId} is not an object.`,
      'PRODUCT_COMMAND_STORE_CORRUPT',
    );
  }
  if (value.commandId !== commandId || !TERMINAL_RESULT_STATUSES.has(value.status as ProductCommandResult['status'])) {
    throw new ProductCommandStoreError(
      `Persisted result for ${commandId} has an invalid identity or status.`,
      'PRODUCT_COMMAND_STORE_CORRUPT',
    );
  }
  if (
    !isSafeNullableRevision(value.beforeRevision)
    || !isSafeNullableRevision(value.afterRevision)
    || !isNonEmptyString(value.completedAt)
    || Number.isNaN(Date.parse(value.completedAt))
    || (value.code !== undefined && typeof value.code !== 'string')
    || (value.message !== undefined && typeof value.message !== 'string')
    || (value.executorLeaseId !== undefined && !isNonEmptyString(value.executorLeaseId))
  ) {
    throw new ProductCommandStoreError(
      `Persisted result for ${commandId} has invalid terminal metadata.`,
      'PRODUCT_COMMAND_STORE_CORRUPT',
    );
  }
}

function parseRecord(value: unknown): ProductCommandStoreRecord {
  if (!isRecord(value)) {
    throw new ProductCommandStoreError('Persisted Product command record is not an object.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  if (Object.keys(value).some((key) => !RECORD_KEYS.has(key)) || Object.keys(value).length !== RECORD_KEYS.size) {
    throw new ProductCommandStoreError('Persisted Product command record has unknown or missing fields.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  if (value.schemaVersion !== PRODUCT_COMMAND_STORE_SCHEMA_VERSION) {
    throw new ProductCommandStoreError(
      `Unsupported Product command store schema version: ${String(value.schemaVersion)}.`,
      'PRODUCT_COMMAND_STORE_SCHEMA_UNSUPPORTED',
    );
  }
  if (
    !isSafePositiveInteger(value.cursor)
    || !isNonEmptyString(value.acceptedAt)
    || Number.isNaN(Date.parse(value.acceptedAt))
  ) {
    throw new ProductCommandStoreError('Persisted Product command record has invalid metadata.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  if (!isNonEmptyString(value.fingerprint) || !isRecord(value.command)) {
    throw new ProductCommandStoreError('Persisted Product command record has invalid command data.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  const command = value.command as unknown as Phase2ProductCommand;
  if (!isNonEmptyString(command.commandId) || canonical(command) !== value.fingerprint) {
    throw new ProductCommandStoreError('Persisted Product command fingerprint does not match its payload.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  if (value.status !== 'queued' && value.status !== 'dispatched' && value.status !== 'reconciling' && value.status !== 'terminal') {
    throw new ProductCommandStoreError('Persisted Product command status is invalid.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  if (value.deliveryMode !== 'execute' && value.deliveryMode !== 'reconcile') {
    throw new ProductCommandStoreError('Persisted Product command delivery mode is invalid.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  if (value.status === 'terminal') {
    assertValidResult(value.result, command.commandId);
  } else if (value.result !== null) {
    throw new ProductCommandStoreError('A non-terminal Product command cannot contain a result.', 'PRODUCT_COMMAND_STORE_CORRUPT');
  }
  return clone({
    schemaVersion: PRODUCT_COMMAND_STORE_SCHEMA_VERSION,
    cursor: value.cursor,
    command,
    fingerprint: value.fingerprint,
    acceptedAt: value.acceptedAt,
    status: value.status,
    deliveryMode: value.deliveryMode,
    result: value.result === null ? null : value.result,
  });
}

function assertRecordTransition(
  previous: ProductCommandStoreRecord,
  next: ProductCommandStoreRecord,
): void {
  if (
    previous.cursor !== next.cursor
    || previous.command.commandId !== next.command.commandId
    || previous.fingerprint !== next.fingerprint
    || canonical(previous.command) !== canonical(next.command)
    || previous.acceptedAt !== next.acceptedAt
  ) {
    throw new ProductCommandStoreError(
      `Product command ${next.command.commandId} changed immutable durable fields.`,
      'PRODUCT_COMMAND_STORE_CORRUPT',
    );
  }
  const duplicate = previous.status === next.status
    && previous.deliveryMode === next.deliveryMode
    && canonical(previous.result) === canonical(next.result);
  if (duplicate) return;
  const allowed = (
    previous.status === 'queued'
    && previous.deliveryMode === 'execute'
    && (
      (next.status === 'dispatched' && next.deliveryMode === 'execute')
      || (next.status === 'reconciling' && next.deliveryMode === 'reconcile')
      || (next.status === 'terminal' && next.deliveryMode === 'execute')
    )
  ) || (
    previous.status === 'dispatched'
    && previous.deliveryMode === 'execute'
    && (
      (next.status === 'reconciling' && next.deliveryMode === 'reconcile')
      || (next.status === 'terminal' && next.deliveryMode === 'execute')
    )
  ) || (
    previous.status === 'reconciling'
    && previous.deliveryMode === 'reconcile'
    && next.status === 'terminal'
    && next.deliveryMode === 'reconcile'
  );
  if (!allowed) {
    throw new ProductCommandStoreError(
      `Product command ${next.command.commandId} has an invalid durable state transition.`,
      'PRODUCT_COMMAND_STORE_CORRUPT',
    );
  }
}

function isActive(status: ProductCommandStoreStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

function terminalStoreStatus(record: ProductCommandStoreRecord, result: ProductCommandResult): ProductCommandStoreRecord {
  return {
    ...record,
    status: 'terminal',
    result: clone(result),
  };
}

function assertResultIdentity(commandId: string, result: ProductCommandResult): void {
  if (result.commandId !== commandId || !TERMINAL_RESULT_STATUSES.has(result.status)) {
    throw new ProductCommandStoreError(
      `Product command result does not match ${commandId}.`,
      'PRODUCT_COMMAND_RESULT_INVALID',
    );
  }
}

class MemoryProductCommandStore implements ProductCommandStore {
  readonly #records = new Map<string, ProductCommandStoreRecord>();
  #cursor = 0;
  #initialized = false;

  initialize(): void {
    this.#initialized = true;
    for (const [commandId, record] of this.#records) {
      if (!isActive(record.status)) continue;
      this.#records.set(commandId, {
        ...record,
        status: 'reconciling',
        deliveryMode: 'reconcile',
      });
    }
  }

  accept(command: Phase2ProductCommand, acceptedAt: string): ProductCommandStoreRecord {
    this.#requireInitialized();
    const fingerprint = canonical(command);
    const existing = this.#records.get(command.commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ProductCommandStoreError(
          `Product command ${command.commandId} already has another payload.`,
          'PRODUCT_COMMAND_CONFLICT',
        );
      }
      return clone(existing);
    }
    const record: ProductCommandStoreRecord = {
      schemaVersion: PRODUCT_COMMAND_STORE_SCHEMA_VERSION,
      cursor: ++this.#cursor,
      command: clone(command),
      fingerprint,
      acceptedAt,
      status: 'queued',
      deliveryMode: 'execute',
      result: null,
    };
    this.#records.set(command.commandId, record);
    return clone(record);
  }

  markDispatched(commandId: string): ProductCommandStoreRecord {
    this.#requireInitialized();
    const record = this.#require(commandId);
    if (!isActive(record.status) || record.deliveryMode === 'reconcile') return clone(record);
    const next = { ...record, status: 'dispatched' as const };
    this.#records.set(commandId, next);
    return clone(next);
  }

  recordResult(commandId: string, result: ProductCommandResult): ProductCommandStoreRecord {
    this.#requireInitialized();
    assertResultIdentity(commandId, result);
    const record = this.#require(commandId);
    if (record.status === 'terminal') {
      if (canonical(record.result) !== canonical(result)) {
        throw new ProductCommandStoreError(
          `Product command ${commandId} already has another result.`,
          'PRODUCT_COMMAND_CONFLICT',
        );
      }
      return clone(record);
    }
    const next = terminalStoreStatus(record, result);
    this.#records.set(commandId, next);
    return clone(next);
  }

  get(commandId: string): ProductCommandStoreRecord | null {
    this.#requireInitialized();
    const record = this.#records.get(commandId);
    return record ? clone(record) : null;
  }

  list(): readonly ProductCommandStoreRecord[] {
    this.#requireInitialized();
    return [...this.#records.values()]
      .sort((left, right) => left.cursor - right.cursor)
      .map((record) => clone(record));
  }

  #requireInitialized(): void {
    if (!this.#initialized) throw new ProductCommandStoreError('Product command store is not initialized.', 'PRODUCT_COMMAND_STORE_NOT_INITIALIZED');
  }

  #require(commandId: string): ProductCommandStoreRecord {
    const record = this.#records.get(commandId);
    if (!record) throw new ProductCommandStoreError(`Unknown Product command ${commandId}.`, 'PRODUCT_COMMAND_NOT_FOUND');
    return record;
  }
}

class FileProductCommandStore implements ProductCommandStore {
  readonly #root: string;
  readonly #logPath: string;
  readonly #records = new Map<string, ProductCommandStoreRecord>();
  #cursor = 0;
  #initialized = false;

  constructor(root: string) {
    const normalizedRoot = resolve(root);
    if (normalizedRoot === dirname(normalizedRoot)) {
      throw new ProductCommandStoreError('Product command store root must not be the filesystem root.', 'PRODUCT_COMMAND_STORE_PATH_INVALID');
    }
    this.#root = normalizedRoot;
    this.#logPath = `${normalizedRoot}/commands.ndjson`;
  }

  initialize(): void {
    if (this.#initialized) return;
    if (existsSync(this.#root)) assertDirectoryPath(this.#root);
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    assertDirectoryPath(this.#root);
    chmodSync(this.#root, 0o700);
    if (!existsSync(this.#logPath)) {
      const descriptor = openSync(
        this.#logPath,
        fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
        0o600,
      );
      closeSync(descriptor);
    }
    assertRegularFilePath(this.#logPath);
    chmodSync(this.#logPath, 0o600);
    const raw = readFileSync(this.#logPath, 'utf8');
    const hasPartialFinalLine = raw.length > 0 && !raw.endsWith('\n');
    const completeRaw = hasPartialFinalLine ? raw.slice(0, raw.lastIndexOf('\n') + 1) : raw;
    if (hasPartialFinalLine) {
      // A process may have died after writing only a prefix of the last JSON
      // record. Remove that prefix before appending the next state record;
      // otherwise the next append would turn two records into one corrupt line.
      truncateSync(this.#logPath, Buffer.byteLength(completeRaw, 'utf8'));
      chmodSync(this.#logPath, 0o600);
    }
    const lines = completeRaw.split('\n');
    const cursorOwners = new Map<number, string>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line.trim()) continue;
      try {
        const record = parseRecord(JSON.parse(line));
        const existing = this.#records.get(record.command.commandId);
        if (existing) {
          assertRecordTransition(existing, record);
        } else {
          const cursorOwner = cursorOwners.get(record.cursor);
          if (cursorOwner && cursorOwner !== record.command.commandId) {
            throw new ProductCommandStoreError(
              `Product command cursor ${record.cursor} is reused.`,
              'PRODUCT_COMMAND_STORE_CORRUPT',
            );
          }
          if (
            record.cursor <= this.#cursor
            || record.status !== 'queued'
            || record.deliveryMode !== 'execute'
            || record.result !== null
          ) {
            throw new ProductCommandStoreError(
              `Product command ${record.command.commandId} does not begin with a queued execute record.`,
              'PRODUCT_COMMAND_STORE_CORRUPT',
            );
          }
          cursorOwners.set(record.cursor, record.command.commandId);
        }
        this.#records.set(record.command.commandId, record);
        this.#cursor = Math.max(this.#cursor, record.cursor);
      } catch (error) {
        throw error;
      }
    }
    this.#initialized = true;
    // Every command surviving a process restart is uncertain. Persist the
    // mode transition before exposing the records to the gateway, so a crash
    // during recovery can only repeat this normalization, never execution.
    for (const [commandId, record] of this.#records) {
      if (!isActive(record.status)) continue;
      const recovered: ProductCommandStoreRecord = {
        ...record,
        status: 'reconciling',
        deliveryMode: 'reconcile',
      };
      this.#append(recovered);
      this.#records.set(commandId, recovered);
    }
  }

  accept(command: Phase2ProductCommand, acceptedAt: string): ProductCommandStoreRecord {
    this.#requireInitialized();
    const fingerprint = canonical(command);
    const existing = this.#records.get(command.commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ProductCommandStoreError(
          `Product command ${command.commandId} already has another payload.`,
          'PRODUCT_COMMAND_CONFLICT',
        );
      }
      return clone(existing);
    }
    const record: ProductCommandStoreRecord = {
      schemaVersion: PRODUCT_COMMAND_STORE_SCHEMA_VERSION,
      cursor: ++this.#cursor,
      command: clone(command),
      fingerprint,
      acceptedAt,
      status: 'queued',
      deliveryMode: 'execute',
      result: null,
    };
    this.#append(record);
    this.#records.set(command.commandId, record);
    return clone(record);
  }

  markDispatched(commandId: string): ProductCommandStoreRecord {
    this.#requireInitialized();
    const record = this.#require(commandId);
    if (!isActive(record.status) || record.deliveryMode === 'reconcile') return clone(record);
    const next: ProductCommandStoreRecord = { ...record, status: 'dispatched' };
    this.#append(next);
    this.#records.set(commandId, next);
    return clone(next);
  }

  recordResult(commandId: string, result: ProductCommandResult): ProductCommandStoreRecord {
    this.#requireInitialized();
    assertResultIdentity(commandId, result);
    const record = this.#require(commandId);
    if (record.status === 'terminal') {
      if (canonical(record.result) !== canonical(result)) {
        throw new ProductCommandStoreError(
          `Product command ${commandId} already has another result.`,
          'PRODUCT_COMMAND_CONFLICT',
        );
      }
      return clone(record);
    }
    const next = terminalStoreStatus(record, result);
    this.#append(next);
    this.#records.set(commandId, next);
    return clone(next);
  }

  get(commandId: string): ProductCommandStoreRecord | null {
    this.#requireInitialized();
    const record = this.#records.get(commandId);
    return record ? clone(record) : null;
  }

  list(): readonly ProductCommandStoreRecord[] {
    this.#requireInitialized();
    return [...this.#records.values()]
      .sort((left, right) => left.cursor - right.cursor)
      .map((record) => clone(record));
  }

  #append(record: ProductCommandStoreRecord): void {
    assertRegularFilePath(this.#logPath);
    const descriptor = openSync(
      this.#logPath,
      fsConstants.O_WRONLY | fsConstants.O_APPEND | NO_FOLLOW,
      0o600,
    );
    try {
      chmodSync(this.#logPath, 0o600);
      const line = `${JSON.stringify(record)}\n`;
      const buffer = Buffer.from(line, 'utf8');
      let offset = 0;
      while (offset < buffer.length) offset += writeSync(descriptor, buffer, offset, buffer.length - offset);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  #requireInitialized(): void {
    if (!this.#initialized) throw new ProductCommandStoreError('Product command store is not initialized.', 'PRODUCT_COMMAND_STORE_NOT_INITIALIZED');
  }

  #require(commandId: string): ProductCommandStoreRecord {
    const record = this.#records.get(commandId);
    if (!record) throw new ProductCommandStoreError(`Unknown Product command ${commandId}.`, 'PRODUCT_COMMAND_NOT_FOUND');
    return record;
  }
}

export function createMemoryProductCommandStore(): ProductCommandStore {
  return new MemoryProductCommandStore();
}

export function createFileProductCommandStore(root: string): ProductCommandStore {
  return new FileProductCommandStore(root);
}
