import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-work-node-backup-'));
const databasePath = path.join(tempDirectory, 'work-nodes.sqlite3');
const backupDirectory = path.join(tempDirectory, 'backup');

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${script} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

try {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE work_nodes (
      id TEXT PRIMARY KEY, save_id TEXT, branch_id TEXT, parent_id TEXT,
      label TEXT, status TEXT, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE work_node_heads (save_id TEXT, current_node_id TEXT);
  `);
  db.prepare(`
    INSERT INTO work_nodes (id, save_id, branch_id, parent_id, label, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('node-before', 'current-main-workbench', 'main', null, 'before-restore', 'open', 1, 1);
  db.close();

  run('scripts/ai-timeline-work-node-migration-preview.mjs', [
    '--database', databasePath,
    '--backup-dir', backupDirectory,
    '--json',
  ]);
  assert.equal(fs.existsSync(path.join(backupDirectory, 'migration-preview-backup.json')), true);

  const mutated = new DatabaseSync(databasePath);
  mutated.prepare('UPDATE work_nodes SET label = ? WHERE id = ?').run('after-mutation', 'node-before');
  mutated.close();

  run('scripts/restore-ai-timeline-work-node-backup.mjs', [
    '--backup-dir', backupDirectory,
    '--target-database', databasePath,
    '--confirm',
  ]);

  const restored = new DatabaseSync(databasePath, { readOnly: true });
  const row = restored.prepare('SELECT label FROM work_nodes WHERE id = ?').get('node-before');
  restored.close();
  assert.equal(row.label, 'before-restore');
  console.log('AI timeline Work Node backup restore smoke passed.');
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
