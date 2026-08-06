import {
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type CommandId,
  type DatabaseGeneration,
  type DefSessionId,
  type DefTurnId,
  type TimelineId,
  type ToolCallId,
  type WorkspaceId,
} from '../../../agent/core/contracts/ids.ts';
import { canonicalJson, type JsonObject, type JsonValue } from '../../../agent/core/contracts/json.ts';
import type {
  ProductBinding,
  ProductCommandEnvelope,
  ProductCommandResult,
  ProductOperationSchema,
  ProductSnapshotEnvelope,
} from '../../../agent/core/contracts/product.ts';
import {
  webDatabase,
  type SqlPrimitive,
  type SqlStatement,
} from '../database/webDatabase.ts';

export const AGENT_RUNTIME_SCHEMA_VERSION = 1;
export const COMMAND_JOURNAL_SCHEMA_VERSION = 1;

const ACTIVE_COMMAND_STATUSES = [
  'queued',
  'dispatched',
  'claimed',
  'reconciling',
] as const;

const TERMINAL_COMMAND_STATUSES = [
  'committed',
  'succeeded',
  'not-executed',
  'rejected',
  'conflict',
  'error',
  'orphaned',
] as const;

export type BrowserCommandJournalStatus =
  | (typeof ACTIVE_COMMAND_STATUSES)[number]
  | (typeof TERMINAL_COMMAND_STATUSES)[number];

type TerminalCommandStatus = (typeof TERMINAL_COMMAND_STATUSES)[number];

type SqlRow = Record<string, SqlPrimitive>;

export interface BrowserProductDatabaseAdapter {
  initialize(): Promise<unknown>;
  query<T extends SqlRow>(sql: string, bind?: SqlPrimitive[]): Promise<T[]>;
  execute(sql: string, bind?: SqlPrimitive[]): Promise<{ changes: number }>;
  batch(statements: SqlStatement[]): Promise<{ changes: number }>;
}

export interface BrowserWorkspaceIdentity {
  readonly workspaceId: WorkspaceId;
  readonly databaseGeneration: DatabaseGeneration;
  readonly agentRuntimeSchemaVersion: number;
  readonly commandJournalSchemaVersion: number;
}

export type RuntimeSnapshotInput = {
  readonly timelineId: TimelineId;
  readonly checkoutTargetId: string | null;
  readonly checkoutUpdatedAt: number;
  readonly contentRevision: number;
  readonly payload: JsonObject;
  readonly capturedAt?: string;
};

export interface BrowserProductStoreOptions {
  readonly now?: () => Date;
  readonly createId?: (kind: 'workspace' | 'generation') => string;
}

export interface BrowserCommandJournalRecord {
  readonly commandId: CommandId;
  readonly commandJournalSchemaVersion: number;
  readonly operation: string;
  readonly command: JsonObject;
  readonly workspaceId: WorkspaceId;
  readonly databaseGeneration: DatabaseGeneration;
  readonly timelineId: TimelineId;
  readonly checkoutTargetId: string | null;
  readonly checkoutUpdatedAt: number;
  readonly expectedRevision: number;
  readonly expectedDigest: string;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly toolCallId: ToolCallId;
  readonly status: BrowserCommandJournalStatus;
  readonly executorLeaseId: string | null;
  readonly beforeRevision: number | null;
  readonly afterRevision: number | null;
  readonly browserResult: JsonValue | null;
  readonly visiblePostcondition: JsonValue | null;
  readonly receiptDigest: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly acceptedAt: string;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly commandDigest: string;
}

export type BrowserCommandResultInput = Omit<ProductCommandResult, 'commandId' | 'completedAt'> & {
  readonly completedAt?: string;
};

export type BrowserCommandClaim =
  | {
      readonly kind: 'claimed';
      readonly journal: BrowserCommandJournalRecord;
    }
  | {
      readonly kind: 'already-claimed' | 'already-pending' | 'already-terminal';
      readonly journal: BrowserCommandJournalRecord;
    }
  | {
      readonly kind: 'rejected';
      readonly journal: BrowserCommandJournalRecord;
      readonly result: ProductCommandResult;
    };

export class BrowserProductStoreError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    code: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'BrowserProductStoreError';
    this.code = code;
    this.details = details;
  }
}

type RuntimeMetaRow = SqlRow & {
  id: SqlPrimitive;
  workspace_id: SqlPrimitive;
  database_generation: SqlPrimitive;
  agent_runtime_schema_version: SqlPrimitive;
  command_journal_schema_version: SqlPrimitive;
};

type CommandJournalRow = SqlRow & {
  command_id: SqlPrimitive;
  command_journal_schema_version: SqlPrimitive;
  operation: SqlPrimitive;
  command_payload_json: SqlPrimitive;
  workspace_id: SqlPrimitive;
  database_generation: SqlPrimitive;
  timeline_id: SqlPrimitive;
  checkout_target_id: SqlPrimitive;
  checkout_updated_at: SqlPrimitive;
  expected_revision: SqlPrimitive;
  expected_digest: SqlPrimitive;
  def_session_id: SqlPrimitive;
  def_turn_id: SqlPrimitive;
  tool_call_id: SqlPrimitive;
  status: SqlPrimitive;
  executor_lease_id: SqlPrimitive;
  before_revision: SqlPrimitive;
  after_revision: SqlPrimitive;
  browser_result_json: SqlPrimitive;
  visible_postcondition_json: SqlPrimitive;
  receipt_digest: SqlPrimitive;
  error_code: SqlPrimitive;
  error_message: SqlPrimitive;
  accepted_at: SqlPrimitive;
  claimed_at: SqlPrimitive;
  completed_at: SqlPrimitive;
  command_digest: SqlPrimitive;
};

type RuntimeSnapshotRow = SqlRow & {
  workspace_id: SqlPrimitive;
  database_generation: SqlPrimitive;
  timeline_id: SqlPrimitive;
  checkout_target_id: SqlPrimitive;
  checkout_updated_at: SqlPrimitive;
  content_revision: SqlPrimitive;
  snapshot_digest: SqlPrimitive;
  captured_at: SqlPrimitive;
  payload_json: SqlPrimitive;
};

const createSchemaStatements: SqlStatement[] = [
  {
    sql: `
      CREATE TABLE IF NOT EXISTS agent_runtime_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        workspace_id TEXT NOT NULL,
        database_generation TEXT NOT NULL,
        agent_runtime_schema_version INTEGER NOT NULL,
        command_journal_schema_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `,
  },
  {
    sql: `
      CREATE TABLE IF NOT EXISTS agent_command_journal (
        command_id TEXT PRIMARY KEY,
        command_journal_schema_version INTEGER NOT NULL,
        operation TEXT NOT NULL,
        command_payload_json TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        database_generation TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        checkout_target_id TEXT,
        checkout_updated_at INTEGER NOT NULL,
        expected_revision INTEGER NOT NULL,
        expected_digest TEXT NOT NULL,
        def_session_id TEXT NOT NULL,
        def_turn_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'queued', 'dispatched', 'claimed', 'reconciling',
          'committed', 'succeeded', 'not-executed', 'rejected',
          'conflict', 'error', 'orphaned'
        )),
        executor_lease_id TEXT,
        before_revision INTEGER,
        after_revision INTEGER,
        browser_result_json TEXT,
        visible_postcondition_json TEXT,
        receipt_digest TEXT,
        error_code TEXT,
        error_message TEXT,
        accepted_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        command_digest TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `,
  },
  {
    sql: `
      CREATE TABLE IF NOT EXISTS agent_runtime_snapshot (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        workspace_id TEXT NOT NULL,
        database_generation TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        checkout_target_id TEXT,
        checkout_updated_at INTEGER NOT NULL,
        content_revision INTEGER NOT NULL,
        snapshot_digest TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `,
  },
  {
    sql: `
      CREATE INDEX IF NOT EXISTS idx_agent_command_journal_pending
      ON agent_command_journal(status, accepted_at)
    `,
  },
  {
    sql: `
      CREATE INDEX IF NOT EXISTS idx_agent_command_journal_generation
      ON agent_command_journal(workspace_id, database_generation, status)
    `,
  },
];

function isTerminalStatus(status: BrowserCommandJournalStatus): status is TerminalCommandStatus {
  return (TERMINAL_COMMAND_STATUSES as readonly string[]).includes(status);
}

function isActiveStatus(status: BrowserCommandJournalStatus): status is (typeof ACTIVE_COMMAND_STATUSES)[number] {
  return (ACTIVE_COMMAND_STATUSES as readonly string[]).includes(status);
}

function textValue(value: SqlPrimitive | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BrowserProductStoreError(`Invalid ${label} in browser product journal.`, 'INVALID_DATABASE_VALUE', value);
  }
  return value;
}

function nullableTextValue(value: SqlPrimitive | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function integerValue(value: SqlPrimitive | undefined, label: string): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new BrowserProductStoreError(`Invalid ${label} in browser product journal.`, 'INVALID_DATABASE_VALUE', value);
  }
  return number;
}

function nullableIntegerValue(value: SqlPrimitive | undefined): number | null {
  if (value === null || value === undefined) return null;
  return integerValue(value, 'nullable integer');
}

function parseJsonValue(value: SqlPrimitive | undefined, label: string): JsonValue | null {
  if (value === null || value === undefined) return null;
  const raw = textValue(value, label);
  try {
    return JSON.parse(raw) as JsonValue;
  } catch (error) {
    throw new BrowserProductStoreError(`Invalid ${label} JSON in browser product journal.`, 'INVALID_DATABASE_JSON', error);
  }
}

function parseJsonObject(value: SqlPrimitive | undefined, label: string): JsonObject {
  const parsed = parseJsonValue(value, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BrowserProductStoreError(`Invalid ${label} object in browser product journal.`, 'INVALID_DATABASE_JSON');
  }
  return parsed;
}

function jsonText(value: JsonValue | null | undefined): string | null {
  return value === null || value === undefined ? null : canonicalJson(value);
}

function isoNow(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BrowserProductStoreError('Browser product clock returned an invalid Date.', 'INVALID_CLOCK');
  }
  return value.toISOString();
}

function defaultId(kind: 'workspace' | 'generation'): string {
  const prefix = kind === 'workspace' ? 'workspace' : 'generation';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function asDigestInput(value: JsonObject): JsonValue {
  return value;
}

async function sha256Canonical(value: JsonObject): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(asDigestInput(value)));
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new BrowserProductStoreError('Web Crypto is required for browser product digests.', 'CRYPTO_UNAVAILABLE');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function bindingFromSnapshotInput(
  identity: BrowserWorkspaceIdentity,
  input: RuntimeSnapshotInput,
): Omit<ProductBinding, 'snapshotDigest'> {
  if (!Number.isSafeInteger(input.checkoutUpdatedAt) || input.checkoutUpdatedAt < 0) {
    throw new BrowserProductStoreError('checkoutUpdatedAt must be a non-negative safe integer.', 'INVALID_SNAPSHOT_BINDING');
  }
  if (!Number.isSafeInteger(input.contentRevision) || input.contentRevision < 0) {
    throw new BrowserProductStoreError('contentRevision must be a non-negative safe integer.', 'INVALID_SNAPSHOT_BINDING');
  }
  return {
    workspaceId: identity.workspaceId,
    databaseGeneration: identity.databaseGeneration,
    timelineId: input.timelineId,
    checkoutTargetId: input.checkoutTargetId,
    checkoutUpdatedAt: input.checkoutUpdatedAt,
    contentRevision: input.contentRevision,
  };
}

function journalBinding(record: BrowserCommandJournalRecord): ProductBinding {
  return {
    workspaceId: record.workspaceId,
    databaseGeneration: record.databaseGeneration,
    timelineId: record.timelineId,
    checkoutTargetId: record.checkoutTargetId,
    checkoutUpdatedAt: record.checkoutUpdatedAt,
    contentRevision: record.expectedRevision,
    snapshotDigest: record.expectedDigest,
  };
}

function bindingMismatch(
  identity: BrowserWorkspaceIdentity,
  expected: ProductBinding,
): { kind: 'ok' } | { kind: 'conflict' | 'orphaned'; code: string; message: string } {
  if (expected.workspaceId !== identity.workspaceId) {
    return {
      kind: 'conflict',
      code: 'WORKSPACE_BINDING_MISMATCH',
      message: 'The command belongs to a different browser workspace.',
    };
  }
  if (expected.databaseGeneration !== identity.databaseGeneration) {
    return {
      kind: 'orphaned',
      code: 'DATABASE_GENERATION_MISMATCH',
      message: 'The command belongs to an obsolete browser database generation.',
    };
  }
  if (
    !expected.timelineId.trim()
    || expected.checkoutTargetId === undefined
    || !Number.isSafeInteger(expected.checkoutUpdatedAt)
    || !Number.isSafeInteger(expected.contentRevision)
    || !expected.snapshotDigest.trim()
  ) {
    return {
      kind: 'conflict',
      code: 'INVALID_SNAPSHOT_BINDING',
      message: 'The command has an invalid snapshot binding.',
    };
  }
  return { kind: 'ok' };
}

function sameBinding(left: ProductBinding, right: ProductBinding): boolean {
  return (
    left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest
  );
}

function snapshotBindingMismatch(
  snapshot: ProductSnapshotEnvelope | null,
  expected: ProductBinding,
): { kind: 'ok' } | { kind: 'conflict'; code: string; message: string } {
  if (!snapshot) {
    return {
      kind: 'conflict',
      code: 'RUNTIME_SNAPSHOT_UNAVAILABLE',
      message: 'No current runtime snapshot is available for the command.',
    };
  }
  if (!sameBinding(snapshot.binding, expected)) {
    return {
      kind: 'conflict',
      code: 'SNAPSHOT_BINDING_MISMATCH',
      message: 'The command is bound to an obsolete runtime snapshot.',
    };
  }
  return { kind: 'ok' };
}

function commandPayload(command: ProductCommandEnvelope<ProductOperationSchema>): JsonObject {
  return command.command as unknown as JsonObject;
}

function rowToIdentity(row: RuntimeMetaRow): BrowserWorkspaceIdentity {
  const runtimeVersion = integerValue(row.agent_runtime_schema_version, 'agent runtime schema version');
  const journalVersion = integerValue(row.command_journal_schema_version, 'command journal schema version');
  if (runtimeVersion !== AGENT_RUNTIME_SCHEMA_VERSION) {
    throw new BrowserProductStoreError(
      `Unsupported agent runtime schema version: ${runtimeVersion}.`,
      'UNSUPPORTED_RUNTIME_SCHEMA',
      { expected: AGENT_RUNTIME_SCHEMA_VERSION, actual: runtimeVersion },
    );
  }
  if (journalVersion !== COMMAND_JOURNAL_SCHEMA_VERSION) {
    throw new BrowserProductStoreError(
      `Unsupported command journal schema version: ${journalVersion}.`,
      'UNSUPPORTED_COMMAND_JOURNAL_SCHEMA',
      { expected: COMMAND_JOURNAL_SCHEMA_VERSION, actual: journalVersion },
    );
  }
  return {
    workspaceId: asWorkspaceId(textValue(row.workspace_id, 'workspace ID')),
    databaseGeneration: asDatabaseGeneration(textValue(row.database_generation, 'database generation')),
    agentRuntimeSchemaVersion: runtimeVersion,
    commandJournalSchemaVersion: journalVersion,
  };
}

function rowToJournal(row: CommandJournalRow): BrowserCommandJournalRecord {
  const status = textValue(row.status, 'command status') as BrowserCommandJournalStatus;
  if (!isActiveStatus(status) && !isTerminalStatus(status)) {
    throw new BrowserProductStoreError(`Unknown command journal status: ${status}.`, 'INVALID_COMMAND_STATUS');
  }
  let command: JsonObject;
  try {
    command = JSON.parse(textValue(row.command_payload_json, 'command payload')) as JsonObject;
  } catch (error) {
    throw new BrowserProductStoreError('Invalid command payload JSON in browser product journal.', 'INVALID_DATABASE_JSON', error);
  }
  return {
    commandId: asCommandId(textValue(row.command_id, 'command ID')),
    commandJournalSchemaVersion: integerValue(row.command_journal_schema_version, 'command journal schema version'),
    operation: textValue(row.operation, 'command operation'),
    command,
    workspaceId: asWorkspaceId(textValue(row.workspace_id, 'workspace ID')),
    databaseGeneration: asDatabaseGeneration(textValue(row.database_generation, 'database generation')),
    timelineId: asTimelineId(textValue(row.timeline_id, 'timeline ID')),
    checkoutTargetId: nullableTextValue(row.checkout_target_id),
    checkoutUpdatedAt: integerValue(row.checkout_updated_at, 'checkout updated at'),
    expectedRevision: integerValue(row.expected_revision, 'expected revision'),
    expectedDigest: textValue(row.expected_digest, 'expected digest'),
    defSessionId: asDefSessionId(textValue(row.def_session_id, 'DEF session ID')),
    defTurnId: asDefTurnId(textValue(row.def_turn_id, 'DEF turn ID')),
    toolCallId: asToolCallId(textValue(row.tool_call_id, 'tool call ID')),
    status,
    executorLeaseId: nullableTextValue(row.executor_lease_id),
    beforeRevision: nullableIntegerValue(row.before_revision),
    afterRevision: nullableIntegerValue(row.after_revision),
    browserResult: parseJsonValue(row.browser_result_json, 'browser result'),
    visiblePostcondition: parseJsonValue(row.visible_postcondition_json, 'visible postcondition'),
    receiptDigest: nullableTextValue(row.receipt_digest),
    errorCode: nullableTextValue(row.error_code),
    errorMessage: nullableTextValue(row.error_message),
    acceptedAt: textValue(row.accepted_at, 'accepted at'),
    claimedAt: nullableTextValue(row.claimed_at),
    completedAt: nullableTextValue(row.completed_at),
    commandDigest: textValue(row.command_digest, 'command digest'),
  };
}

function resultFromJournal(record: BrowserCommandJournalRecord): ProductCommandResult | null {
  if (!isTerminalStatus(record.status)) return null;
  return {
    commandId: record.commandId,
    status: record.status,
    ...(record.errorCode ? { code: record.errorCode } : {}),
    ...(record.errorMessage ? { message: record.errorMessage } : {}),
    beforeRevision: record.beforeRevision,
    afterRevision: record.afterRevision,
    ...(record.browserResult === null ? {} : { browserResult: record.browserResult }),
    ...(record.visiblePostcondition === null ? {} : { visiblePostcondition: record.visiblePostcondition }),
    ...(record.executorLeaseId ? { executorLeaseId: record.executorLeaseId } : {}),
    completedAt: record.completedAt || record.acceptedAt,
  };
}

function resultWithStatus(
  commandId: CommandId,
  status: TerminalCommandStatus,
  code: string,
  message: string,
  completedAt: string,
): ProductCommandResult {
  return {
    commandId,
    status,
    code,
    message,
    beforeRevision: null,
    afterRevision: null,
    completedAt,
  };
}

async function receiptDigest(result: ProductCommandResult): Promise<string> {
  return sha256Canonical({
    commandId: result.commandId,
    status: result.status,
    code: result.code || null,
    message: result.message || null,
    beforeRevision: result.beforeRevision,
    afterRevision: result.afterRevision,
    browserResult: result.browserResult === undefined ? null : result.browserResult,
    visiblePostcondition: result.visiblePostcondition === undefined ? null : result.visiblePostcondition,
    executorLeaseId: result.executorLeaseId || null,
    completedAt: result.completedAt,
  });
}

function commandRowSelectSql(): string {
  return `
    SELECT
      command_id, command_journal_schema_version, operation, command_payload_json,
      workspace_id, database_generation, timeline_id, checkout_target_id,
      checkout_updated_at, expected_revision, expected_digest,
      def_session_id, def_turn_id, tool_call_id, status, executor_lease_id,
      before_revision, after_revision, browser_result_json, visible_postcondition_json,
      receipt_digest, error_code, error_message, accepted_at, claimed_at,
      completed_at, command_digest
    FROM agent_command_journal
  `;
}

function commandInsertStatement(
  command: ProductCommandEnvelope<ProductOperationSchema>,
  commandDigest: string,
  status: BrowserCommandJournalStatus,
  acceptedAt: string,
  completedAt: string | null,
  errorCode: string | null,
  errorMessage: string | null,
  resultDigest: string | null,
): SqlStatement {
  const expected = command.expected;
  return {
    sql: `
      INSERT OR IGNORE INTO agent_command_journal (
        command_id, command_journal_schema_version, operation, command_payload_json,
        workspace_id, database_generation, timeline_id, checkout_target_id,
        checkout_updated_at, expected_revision, expected_digest,
        def_session_id, def_turn_id, tool_call_id, status, executor_lease_id,
        before_revision, after_revision, browser_result_json, visible_postcondition_json,
        receipt_digest, error_code, error_message, accepted_at, claimed_at,
        completed_at, command_digest, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    bind: [
      command.commandId,
      COMMAND_JOURNAL_SCHEMA_VERSION,
      command.command.op,
      jsonText(commandPayload(command)),
      expected.workspaceId,
      expected.databaseGeneration,
      expected.timelineId,
      expected.checkoutTargetId,
      expected.checkoutUpdatedAt,
      expected.contentRevision,
      expected.snapshotDigest,
      command.defSessionId,
      command.defTurnId,
      command.toolCallId,
      status,
      null,
      null,
      null,
      null,
      null,
      resultDigest,
      errorCode,
      errorMessage,
      acceptedAt,
      null,
      completedAt,
      commandDigest,
      acceptedAt,
    ],
  };
}

function commandBinding(record: BrowserCommandJournalRecord): ProductBinding {
  return journalBinding(record);
}

export interface BrowserProductStore {
  initialize(): Promise<BrowserWorkspaceIdentity>;
  readIdentity(): Promise<BrowserWorkspaceIdentity>;
  rotateDatabaseGeneration(reason?: string): Promise<BrowserWorkspaceIdentity>;
  createRuntimeSnapshot(input: RuntimeSnapshotInput): Promise<ProductSnapshotEnvelope>;
  readRuntimeSnapshot(): Promise<ProductSnapshotEnvelope | null>;
  claimCommand<Schema extends ProductOperationSchema>(
    command: ProductCommandEnvelope<Schema>,
    executorLeaseId: string,
  ): Promise<BrowserCommandClaim>;
  recordCommandResult(commandId: CommandId, result: BrowserCommandResultInput): Promise<ProductCommandResult>;
  getCommand(commandId: CommandId): Promise<BrowserCommandJournalRecord | null>;
  reconcileCommand(commandId: CommandId): Promise<ProductCommandResult | null>;
}

export function createBrowserProductStore(
  adapter: BrowserProductDatabaseAdapter = webDatabase,
  options: BrowserProductStoreOptions = {},
): BrowserProductStore {
  const now = options.now || (() => new Date());
  const createId = options.createId || defaultId;
  let initialization: Promise<BrowserWorkspaceIdentity> | null = null;

  async function ensureSchema(): Promise<void> {
    await adapter.batch(createSchemaStatements);
  }

  async function readMetaRow(): Promise<RuntimeMetaRow | null> {
    const rows = await adapter.query<RuntimeMetaRow>(`
      SELECT id, workspace_id, database_generation, agent_runtime_schema_version,
        command_journal_schema_version
      FROM agent_runtime_meta
      WHERE id = 1
    `);
    return rows[0] || null;
  }

  async function initializeInternal(): Promise<BrowserWorkspaceIdentity> {
    await adapter.initialize();
    await ensureSchema();
    let row = await readMetaRow();
    if (!row) {
      const workspaceId = asWorkspaceId(createId('workspace'));
      const databaseGeneration = asDatabaseGeneration(createId('generation'));
      await adapter.batch([{
        sql: `
          INSERT OR IGNORE INTO agent_runtime_meta (
            id, workspace_id, database_generation,
            agent_runtime_schema_version, command_journal_schema_version, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?)
        `,
        bind: [
          workspaceId,
          databaseGeneration,
          AGENT_RUNTIME_SCHEMA_VERSION,
          COMMAND_JOURNAL_SCHEMA_VERSION,
          isoNow(now),
        ],
      }]);
      row = await readMetaRow();
    }
    if (!row) throw new BrowserProductStoreError('Browser workspace identity could not be initialized.', 'IDENTITY_INIT_FAILED');
    return rowToIdentity(row);
  }

  async function initialize(): Promise<BrowserWorkspaceIdentity> {
    if (!initialization) {
      initialization = initializeInternal().catch((error) => {
        initialization = null;
        throw error;
      });
    }
    return initialization;
  }

  async function readIdentity(): Promise<BrowserWorkspaceIdentity> {
    await initialize();
    const row = await readMetaRow();
    if (!row) throw new BrowserProductStoreError('Browser workspace identity disappeared.', 'IDENTITY_NOT_FOUND');
    const identity = rowToIdentity(row);
    initialization = Promise.resolve(identity);
    return identity;
  }

  async function getCommand(commandId: CommandId): Promise<BrowserCommandJournalRecord | null> {
    await initialize();
    const rows = await adapter.query<CommandJournalRow>(
      `${commandRowSelectSql()} WHERE command_id = ?`,
      [commandId],
    );
    return rows[0] ? rowToJournal(rows[0]) : null;
  }

  async function readRuntimeSnapshot(): Promise<ProductSnapshotEnvelope | null> {
    const identity = await readIdentity();
    const rows = await adapter.query<RuntimeSnapshotRow>(`
      SELECT workspace_id, database_generation, timeline_id, checkout_target_id,
        checkout_updated_at, content_revision, snapshot_digest, captured_at, payload_json
      FROM agent_runtime_snapshot
      WHERE id = 1
    `);
    const row = rows[0];
    if (!row) return null;
    const binding: ProductBinding = {
      workspaceId: asWorkspaceId(textValue(row.workspace_id, 'snapshot workspace ID')),
      databaseGeneration: asDatabaseGeneration(textValue(row.database_generation, 'snapshot database generation')),
      timelineId: asTimelineId(textValue(row.timeline_id, 'snapshot timeline ID')),
      checkoutTargetId: nullableTextValue(row.checkout_target_id),
      checkoutUpdatedAt: integerValue(row.checkout_updated_at, 'snapshot checkout updated at'),
      contentRevision: integerValue(row.content_revision, 'snapshot content revision'),
      snapshotDigest: textValue(row.snapshot_digest, 'snapshot digest'),
    };
    const payload = parseJsonObject(row.payload_json, 'runtime snapshot payload');
    const expectedDigest = await sha256Canonical({
      workspaceId: binding.workspaceId,
      databaseGeneration: binding.databaseGeneration,
      timelineId: binding.timelineId,
      checkoutTargetId: binding.checkoutTargetId,
      checkoutUpdatedAt: binding.checkoutUpdatedAt,
      contentRevision: binding.contentRevision,
      payload,
    });
    if (expectedDigest !== binding.snapshotDigest) {
      throw new BrowserProductStoreError(
        'The persisted runtime snapshot digest does not match its canonical payload.',
        'SNAPSHOT_DIGEST_MISMATCH',
        { expected: expectedDigest, actual: binding.snapshotDigest },
      );
    }
    if (binding.workspaceId !== identity.workspaceId || binding.databaseGeneration !== identity.databaseGeneration) {
      return null;
    }
    return {
      protocolVersion: 1,
      binding,
      capturedAt: textValue(row.captured_at, 'snapshot captured at'),
      payload,
    };
  }

  async function rotateDatabaseGeneration(reason = 'database generation rotated'): Promise<BrowserWorkspaceIdentity> {
    const current = await readIdentity();
    const nextGeneration = asDatabaseGeneration(createId('generation'));
    if (nextGeneration === current.databaseGeneration) {
      throw new BrowserProductStoreError('Generation rotation must produce a new generation ID.', 'GENERATION_NOT_ROTATED');
    }
    const completedAt = isoNow(now);
    const pendingRows = await adapter.query<CommandJournalRow>(`
      ${commandRowSelectSql()}
      WHERE status IN ('queued', 'dispatched', 'claimed', 'reconciling')
    `);
    const pendingRecords = pendingRows.map(rowToJournal);
    const orphanedResults = await Promise.all(pendingRecords.map(async (record) => {
      const result = resultWithStatus(
        record.commandId,
        'orphaned',
        'DATABASE_GENERATION_ROTATED',
        reason,
        completedAt,
      );
      return { record, result, digest: await receiptDigest(result) };
    }));
    const statements: SqlStatement[] = [{
      sql: `
        UPDATE agent_runtime_meta
        SET database_generation = ?, updated_at = ?
        WHERE id = 1
      `,
      bind: [nextGeneration, completedAt],
    }, {
      sql: 'DELETE FROM agent_runtime_snapshot WHERE id = 1',
    }];
    for (const orphaned of orphanedResults) {
      statements.push({
        sql: `
          UPDATE agent_command_journal
          SET status = 'orphaned', error_code = ?, error_message = ?,
            before_revision = ?, after_revision = ?,
            receipt_digest = ?, completed_at = ?, updated_at = ?
          WHERE command_id = ?
            AND status IN ('queued', 'dispatched', 'claimed', 'reconciling')
        `,
        bind: [
          orphaned.result.code || null,
          orphaned.result.message || null,
          orphaned.result.beforeRevision,
          orphaned.result.afterRevision,
          orphaned.digest,
          completedAt,
          completedAt,
          orphaned.record.commandId,
        ],
      });
    }
    await adapter.batch(statements);
    const next: BrowserWorkspaceIdentity = {
      ...current,
      databaseGeneration: nextGeneration,
    };
    initialization = Promise.resolve(next);
    return next;
  }

  async function createRuntimeSnapshot(input: RuntimeSnapshotInput): Promise<ProductSnapshotEnvelope> {
    const identity = await readIdentity();
    const binding = bindingFromSnapshotInput(identity, input);
    const digest = await sha256Canonical({
      ...binding,
      payload: input.payload,
    });
    const snapshot: ProductSnapshotEnvelope = {
      protocolVersion: 1,
      binding: { ...binding, snapshotDigest: digest },
      capturedAt: input.capturedAt || isoNow(now),
      payload: input.payload,
    };
    await adapter.batch([{
      sql: `
        INSERT OR REPLACE INTO agent_runtime_snapshot (
          id, workspace_id, database_generation, timeline_id, checkout_target_id,
          checkout_updated_at, content_revision, snapshot_digest, captured_at,
          payload_json, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      bind: [
        snapshot.binding.workspaceId,
        snapshot.binding.databaseGeneration,
        snapshot.binding.timelineId,
        snapshot.binding.checkoutTargetId,
        snapshot.binding.checkoutUpdatedAt,
        snapshot.binding.contentRevision,
        snapshot.binding.snapshotDigest,
        snapshot.capturedAt,
        jsonText(snapshot.payload),
        snapshot.capturedAt,
      ],
    }]);
    return snapshot;
  }

  async function claimCommand<Schema extends ProductOperationSchema>(
    command: ProductCommandEnvelope<Schema>,
    executorLeaseId: string,
  ): Promise<BrowserCommandClaim> {
    if (!executorLeaseId.trim()) {
      throw new BrowserProductStoreError('executorLeaseId must be a non-empty string.', 'INVALID_EXECUTOR_LEASE');
    }
    const identity = await readIdentity();
    const typedCommand = command as unknown as ProductCommandEnvelope<ProductOperationSchema>;
    const commandDigest = await sha256Canonical(typedCommand as unknown as JsonObject);
    const acceptedAt = isoNow(now);
    const existingBefore = await getCommand(command.commandId);
    let mismatch = bindingMismatch(identity, command.expected);
    if (mismatch.kind === 'ok') {
      const snapshotMismatch = snapshotBindingMismatch(await readRuntimeSnapshot(), command.expected);
      if (snapshotMismatch.kind !== 'ok') mismatch = snapshotMismatch;
    }
    let initialStatus: BrowserCommandJournalStatus = 'queued';
    let initialResult: ProductCommandResult | null = null;
    let initialReceiptDigest: string | null = null;
    if (mismatch.kind !== 'ok') {
      initialStatus = mismatch.kind;
      initialResult = resultWithStatus(command.commandId, mismatch.kind, mismatch.code, mismatch.message, acceptedAt);
      initialReceiptDigest = await receiptDigest(initialResult);
    }
    await adapter.batch([
      commandInsertStatement(
        typedCommand,
        commandDigest,
        initialStatus,
        acceptedAt,
        initialResult?.completedAt || null,
        initialResult?.code || null,
        initialResult?.message || null,
        initialReceiptDigest,
      ),
      ...(initialStatus === 'queued'
        ? [{
            sql: `
              UPDATE agent_command_journal
              SET status = 'claimed', executor_lease_id = ?, claimed_at = ?, updated_at = ?
              WHERE command_id = ?
                AND command_digest = ?
                AND status = 'queued'
                AND workspace_id = ?
                AND database_generation = ?
                AND timeline_id = ?
                AND (checkout_target_id IS ? OR checkout_target_id = ?)
                AND checkout_updated_at = ?
                AND expected_revision = ?
                AND expected_digest = ?
                AND EXISTS (
                  SELECT 1 FROM agent_runtime_snapshot
                  WHERE id = 1
                    AND workspace_id = ?
                    AND database_generation = ?
                    AND timeline_id = ?
                    AND (checkout_target_id IS ? OR checkout_target_id = ?)
                    AND checkout_updated_at = ?
                    AND content_revision = ?
                    AND snapshot_digest = ?
                )
            `,
            bind: [
              executorLeaseId,
              acceptedAt,
              acceptedAt,
              command.commandId,
              commandDigest,
              command.expected.workspaceId,
              command.expected.databaseGeneration,
              command.expected.timelineId,
              command.expected.checkoutTargetId,
              command.expected.checkoutTargetId,
              command.expected.checkoutUpdatedAt,
              command.expected.contentRevision,
              command.expected.snapshotDigest,
              command.expected.workspaceId,
              command.expected.databaseGeneration,
              command.expected.timelineId,
              command.expected.checkoutTargetId,
              command.expected.checkoutTargetId,
              command.expected.checkoutUpdatedAt,
              command.expected.contentRevision,
              command.expected.snapshotDigest,
            ],
          }]
        : []),
    ]);
    const journal = await getCommand(command.commandId);
    if (!journal) throw new BrowserProductStoreError('Claimed command disappeared from browser journal.', 'COMMAND_CLAIM_FAILED');
    const storedBinding = commandBinding(journal);
    const sameCommand = journal.commandDigest === commandDigest
      && sameBinding(storedBinding, command.expected)
      && canonicalJson(journal.command) === canonicalJson(commandPayload(typedCommand));
    if (!sameCommand) {
      const conflict = resultWithStatus(
        command.commandId,
        journal.databaseGeneration !== command.expected.databaseGeneration ? 'orphaned' : 'conflict',
        journal.databaseGeneration !== command.expected.databaseGeneration
          ? 'DATABASE_GENERATION_MISMATCH'
          : 'COMMAND_ID_REUSE',
        journal.databaseGeneration !== command.expected.databaseGeneration
          ? 'The command belongs to an obsolete browser database generation.'
          : 'The command ID is already bound to a different command.',
        acceptedAt,
      );
      return { kind: 'rejected', journal, result: conflict };
    }
    const storedResult = resultFromJournal(journal);
    if (storedResult) {
      if (initialStatus !== 'queued') return { kind: 'rejected', journal, result: storedResult };
      return { kind: 'already-terminal', journal };
    }
    if (journal.status === 'claimed') {
      return {
        kind: existingBefore?.status === 'claimed' ? 'already-claimed' : 'claimed',
        journal,
      };
    }
    if (journal.status === 'queued' || journal.status === 'dispatched' || journal.status === 'reconciling') {
      return { kind: 'already-pending', journal };
    }
    throw new BrowserProductStoreError(`Unexpected command journal status: ${journal.status}.`, 'COMMAND_CLAIM_FAILED');
  }

  async function recordCommandResult(commandId: CommandId, input: BrowserCommandResultInput): Promise<ProductCommandResult> {
    const journal = await getCommand(commandId);
    if (!journal) throw new BrowserProductStoreError('Cannot record a result for an unknown command.', 'COMMAND_NOT_FOUND');
    const completedAt = input.completedAt || isoNow(now);
    const result: ProductCommandResult = {
      ...input,
      commandId,
      completedAt,
      ...(input.executorLeaseId ? { executorLeaseId: input.executorLeaseId } : {}),
    };
    if (!isTerminalStatus(result.status)) {
      throw new BrowserProductStoreError('Only terminal command results can be recorded.', 'NON_TERMINAL_COMMAND_RESULT');
    }
    if (journal.executorLeaseId && result.executorLeaseId && journal.executorLeaseId !== result.executorLeaseId) {
      throw new BrowserProductStoreError('Command result was submitted by a different executor lease.', 'EXECUTOR_LEASE_MISMATCH');
    }
    if (isTerminalStatus(journal.status)) {
      const existing = resultFromJournal(journal);
      if (!existing) throw new BrowserProductStoreError('Terminal journal row has no result.', 'INVALID_TERMINAL_JOURNAL');
      return existing;
    }
    const digest = await receiptDigest(result);
    await adapter.batch([{
      sql: `
        UPDATE agent_command_journal
        SET status = ?, executor_lease_id = COALESCE(?, executor_lease_id),
          before_revision = ?, after_revision = ?, browser_result_json = ?,
          visible_postcondition_json = ?, receipt_digest = ?, error_code = ?,
          error_message = ?, completed_at = ?, updated_at = ?
        WHERE command_id = ?
          AND status IN ('queued', 'dispatched', 'claimed', 'reconciling')
      `,
      bind: [
        result.status,
        result.executorLeaseId || null,
        result.beforeRevision,
        result.afterRevision,
        jsonText(result.browserResult),
        jsonText(result.visiblePostcondition),
        digest,
        result.code || null,
        result.message || null,
        completedAt,
        completedAt,
        commandId,
      ],
    }]);
    const updated = await getCommand(commandId);
    if (!updated) throw new BrowserProductStoreError('Command result disappeared from browser journal.', 'COMMAND_RESULT_FAILED');
    const persisted = resultFromJournal(updated);
    if (!persisted) throw new BrowserProductStoreError('Browser command result was not committed.', 'COMMAND_RESULT_FAILED');
    return persisted;
  }

  async function reconcileCommand(commandId: CommandId): Promise<ProductCommandResult | null> {
    const journal = await getCommand(commandId);
    return journal ? resultFromJournal(journal) : null;
  }

  return {
    initialize,
    readIdentity,
    rotateDatabaseGeneration,
    createRuntimeSnapshot,
    readRuntimeSnapshot,
    claimCommand,
    recordCommandResult,
    getCommand,
    reconcileCommand,
  };
}

export const browserProductStore = createBrowserProductStore();
