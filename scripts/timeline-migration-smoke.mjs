import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiTimelineWorkNodeStore } = require('../electron/ai-timeline-work-node-store.cjs');
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-timeline-migration-'));
const localDirectory = path.join(tempDirectory, 'localdata');
const backupDirectory = path.join(tempDirectory, 'backup');
const databasePath = path.join(localDirectory, 'ai-timeline-worknodes.sqlite3');
const payload = { selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [] };

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, `${script} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

try {
  fs.mkdirSync(localDirectory, { recursive: true });
  fs.writeFileSync(path.join(localDirectory, 'now-storage.json'), '{"before":true}\n', 'utf8');
  const store = createAiTimelineWorkNodeStore({ databasePath, legacyJsonPath: path.join(localDirectory, 'ai-timeline-worknodes.json') });
  store.saveNode({
    id: 'good-node', saveId: 'current-main-workbench', timelineId: 'current-main-workbench', branchId: 'main',
    label: 'good node', status: 'open', approvalPolicy: 'auto-low-risk', basePayload: payload, workingPayload: payload,
    baseSummary: {}, workingSummary: {}, riskFlags: [], logs: [], createdAt: 1, updatedAt: 1,
  });
  store.saveNode({
    id: 'snapshot-node', saveId: 'timeline-snapshot-legacy', timelineId: 'timeline-snapshot-legacy', branchId: 'timeline-snapshot-legacy',
    label: '[snapshot] legacy', status: 'open', approvalPolicy: 'auto-low-risk', basePayload: payload, workingPayload: payload,
    baseSummary: {}, workingSummary: {}, riskFlags: [], logs: [], createdAt: 2, updatedAt: 2,
  });
  store.close();

  const migrated = run('scripts/migrate-legacy-work-nodes.mjs', ['--local-dir', localDirectory, '--backup-dir', backupDirectory]);
  assert.equal(migrated.imported, 1);
  assert.equal(migrated.anomalous, 1);
  assert.equal(fs.existsSync(path.join(backupDirectory, 'timeline-migration-backup.json')), true);
  const repository = createTimelineRepository({ databasePath: path.join(localDirectory, 'timeline-repository.sqlite3') });
  assert.equal(repository.listWorkNodes('current-main-workbench').length, 1);
  assert.equal(repository.getWorkNode('good-node')?.id, 'good-node');
  repository.close();

  fs.writeFileSync(path.join(localDirectory, 'now-storage.json'), '{"after":true}\n', 'utf8');
  run('scripts/restore-timeline-migration-backup.mjs', ['--backup-dir', backupDirectory, '--target-local-dir', localDirectory, '--confirm']);
  assert.equal(fs.readFileSync(path.join(localDirectory, 'now-storage.json'), 'utf8'), '{"before":true}\n');
  assert.equal(fs.existsSync(path.join(localDirectory, 'timeline-repository.sqlite3')), false);
  const restored = createAiTimelineWorkNodeStore({ databasePath, legacyJsonPath: path.join(localDirectory, 'ai-timeline-worknodes.json') });
  assert.equal(restored.getNode('good-node')?.label, 'good node');
  assert.equal(restored.getNode('snapshot-node')?.label, '[snapshot] legacy');
  restored.close();
  console.log('Timeline migration smoke passed.');
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
