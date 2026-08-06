/// <reference lib="webworker" />

import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type SqlValue,
} from '@sqlite.org/sqlite-wasm';

type SqlStatement = {
  sql: string;
  bind?: SqlValue[];
};

type DatabaseRequest =
  | { id: number; operation: 'initialize' }
  | { id: number; operation: 'query'; statement: SqlStatement }
  | { id: number; operation: 'execute'; statement: SqlStatement }
  | { id: number; operation: 'batch'; statements: SqlStatement[] }
  | { id: number; operation: 'export' }
  | { id: number; operation: 'close' };

type DatabaseResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: { message: string; stack?: string } };

const DATABASE_FILENAME = '/dmg-end-field-web-lts-1.8.sqlite3';
const VFS_NAME = 'dmg-end-field-opfs-sahpool';
const VFS_DIRECTORY = '.dmg-end-field-opfs-sahpool';

let database: Database | null = null;
let pool: SAHPoolUtil | null = null;
let sqliteVersion = '';

function requireDatabase(): Database {
  if (!database) throw new Error('Web database has not been initialized.');
  return database;
}

function runStatement(statement: SqlStatement, collectRows: boolean): Record<string, SqlValue>[] {
  const db = requireDatabase();
  const prepared = db.prepare(statement.sql);
  try {
    if (statement.bind?.length) prepared.bind(statement.bind);
    const rows: Record<string, SqlValue>[] = [];
    while (prepared.step()) {
      if (collectRows) rows.push(prepared.get({}));
    }
    return rows;
  } finally {
    prepared.finalize();
  }
}

function migrateSchema(): void {
  const db = requireDatabase();
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA temp_store = MEMORY;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS kv_store (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS data_packages (
      package_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      installed_at INTEGER NOT NULL,
      verified_at INTEGER NOT NULL,
      byte_size INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS local_data_packages (
      storage_scope TEXT NOT NULL CHECK(storage_scope IN ('local', 'share')),
      package_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      archive_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_name TEXT,
      data_version TEXT,
      created_at TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      byte_size INTEGER NOT NULL,
      PRIMARY KEY (storage_scope, package_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_local_data_packages_scope
      ON local_data_packages(storage_scope, updated_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_documents (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_temporary INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS timeline_snapshots (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_timeline_snapshots_document
      ON timeline_snapshots(timeline_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_work_nodes (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE CASCADE,
      parent_node_id TEXT,
      branch_id TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_policy TEXT NOT NULL,
      risk_flags_json TEXT NOT NULL,
      logs_json TEXT NOT NULL,
      base_payload_json TEXT NOT NULL,
      working_payload_json TEXT NOT NULL,
      content_revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_timeline_work_nodes_document
      ON timeline_work_nodes(timeline_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_work_node_commits (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES timeline_work_nodes(id) ON DELETE CASCADE,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL,
      label TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      risk_flags_json TEXT NOT NULL,
      approval_json TEXT NOT NULL,
      checkout_applied INTEGER NOT NULL,
      checkout_json TEXT,
      base_payload_json TEXT NOT NULL,
      applied_payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_timeline_commits_document
      ON timeline_work_node_commits(timeline_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_work_node_patches (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL REFERENCES timeline_work_nodes(id) ON DELETE CASCADE,
      patch_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      diff_summary_json TEXT NOT NULL,
      risk_flags_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_timeline_patches_node
      ON timeline_work_node_patches(node_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_checkout_refs (
      timeline_id TEXT PRIMARY KEY REFERENCES timeline_documents(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS timeline_audit_events (
      id TEXT PRIMARY KEY,
      timeline_id TEXT NOT NULL REFERENCES timeline_documents(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_timeline_audit_document
      ON timeline_audit_events(timeline_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_archives (
      archive_id TEXT PRIMARY KEY,
      library TEXT NOT NULL CHECK(library IN ('local', 'shared')),
      label TEXT NOT NULL,
      bundle_json TEXT NOT NULL,
      payload_hash TEXT,
      summary_json TEXT NOT NULL,
      node_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_timeline_archives_library
      ON timeline_archives(library, created_at DESC);

    CREATE TABLE IF NOT EXISTS image_assets (
      relative_path TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      base_name TEXT NOT NULL,
      extension TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content BLOB,
      source TEXT NOT NULL,
      writable INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS agent_runtime_meta (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      workspace_id TEXT NOT NULL,
      database_generation TEXT NOT NULL,
      agent_runtime_schema_version INTEGER NOT NULL,
      command_journal_schema_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

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
    ) STRICT;
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
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_agent_command_journal_pending
      ON agent_command_journal(status, accepted_at);
    CREATE INDEX IF NOT EXISTS idx_agent_command_journal_generation
      ON agent_command_journal(workspace_id, database_generation, status);

    INSERT INTO app_meta(key, value, updated_at)
    VALUES ('schema_version', '3', unixepoch('subsec') * 1000)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
  `);
}

async function initialize(): Promise<Record<string, unknown>> {
  if (database && pool) {
    return {
      sqliteVersion,
      filename: DATABASE_FILENAME,
      vfs: pool.vfsName,
      persistent: true,
    };
  }
  const sqlite3 = await sqlite3InitModule();
  sqliteVersion = sqlite3.version.libVersion;
  pool = await sqlite3.installOpfsSAHPoolVfs({
    name: VFS_NAME,
    directory: VFS_DIRECTORY,
    initialCapacity: 8,
  });
  database = new pool.OpfsSAHPoolDb(DATABASE_FILENAME);
  migrateSchema();
  return {
    sqliteVersion,
    filename: DATABASE_FILENAME,
    vfs: pool.vfsName,
    persistent: true,
  };
}

async function handleRequest(request: DatabaseRequest): Promise<unknown> {
  switch (request.operation) {
    case 'initialize':
      return initialize();
    case 'query':
      return runStatement(request.statement, true);
    case 'execute':
      runStatement(request.statement, false);
      return { changes: requireDatabase().changes(false) };
    case 'batch':
      return requireDatabase().transaction(() => {
        let changes = 0;
        for (const statement of request.statements) {
          runStatement(statement, false);
          changes += requireDatabase().changes(false);
        }
        return { changes };
      });
    case 'export': {
      requireDatabase().exec('PRAGMA optimize;');
      if (!pool) throw new Error('OPFS pool is unavailable.');
      return pool.exportFile(DATABASE_FILENAME);
    }
    case 'close':
      database?.close();
      database = null;
      pool?.pauseVfs();
      pool = null;
      return { closed: true };
  }
}

const workerScope = self as DedicatedWorkerGlobalScope;
let requestChain = Promise.resolve();

workerScope.addEventListener('message', (event: MessageEvent<DatabaseRequest>) => {
  const request = event.data;
  requestChain = requestChain
    .catch(() => undefined)
    .then(async () => {
      try {
        const result = await handleRequest(request);
        const response: DatabaseResponse = { id: request.id, ok: true, result };
        if (result instanceof Uint8Array) {
          workerScope.postMessage(response, [result.buffer]);
        } else {
          workerScope.postMessage(response);
        }
      } catch (error) {
        const candidate = error instanceof Error ? error : new Error(String(error));
        const response: DatabaseResponse = {
          id: request.id,
          ok: false,
          error: { message: candidate.message, stack: candidate.stack },
        };
        workerScope.postMessage(response);
      }
    });
});
