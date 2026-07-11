import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiTimelineWorkNodeStore } = require('../electron/ai-timeline-work-node-store.cjs');
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const local = path.resolve(readOption('--local-dir') || path.join(root, 'data', 'localdata'));
const backupDirectoryInput = readOption('--backup-dir');
const backupDirectory = backupDirectoryInput ? path.resolve(backupDirectoryInput) : null;
const legacyDatabasePath = path.join(local, 'ai-timeline-worknodes.sqlite3');
const legacyJsonPath = path.join(local, 'ai-timeline-worknodes.json');
const repositoryDatabasePath = path.join(local, 'timeline-repository.sqlite3');

function copyIfPresent(sourcePath, targetDirectory, copiedFiles) {
  if (!fs.existsSync(sourcePath)) return;
  const targetPath = path.join(targetDirectory, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  copiedFiles.push({ sourcePath, targetPath });
}

function createMigrationBackup() {
  if (!backupDirectory) return null;
  fs.mkdirSync(backupDirectory, { recursive: true });
  const copiedFiles = [];
  const trackedPaths = [
    legacyDatabasePath,
    `${legacyDatabasePath}-wal`,
    `${legacyDatabasePath}-shm`,
    legacyJsonPath,
    repositoryDatabasePath,
    `${repositoryDatabasePath}-wal`,
    `${repositoryDatabasePath}-shm`,
    path.join(local, 'now-storage.json'),
  ];
  trackedPaths.forEach((sourcePath) => copyIfPresent(sourcePath, backupDirectory, copiedFiles));
  const manifestPath = path.join(backupDirectory, 'timeline-migration-backup.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    type: 'def.timeline-migration.raw-backup.v1',
    createdAt: new Date().toISOString(),
    sourceLocalDirectory: local,
    files: copiedFiles,
    missingPaths: trackedPaths.filter((sourcePath) => !fs.existsSync(sourcePath)),
    note: 'This is a raw local-data backup set. Close the app before backup or restore so SQLite database, WAL, and SHM files stay consistent.',
  }, null, 2)}\n`, 'utf8');
  return { backupDirectory, manifestPath, copiedFiles };
}

const backup = createMigrationBackup();
const oldStore = createAiTimelineWorkNodeStore({ databasePath: legacyDatabasePath, legacyJsonPath });
const repository = createTimelineRepository({ databasePath: repositoryDatabasePath });
const archive = oldStore.readArchive();
const anomalous = [];
const nodes = archive.nodes.filter((node) => {
  const bad = node.saveId?.startsWith('timeline-snapshot-') || node.branchId?.startsWith('timeline-snapshot-') || /^\[snapshot\]/i.test(node.label || '');
  if (bad) anomalous.push({ id: node.id, saveId: node.saveId, branchId: node.branchId, label: node.label, reason: 'legacy-snapshot-work-node' });
  return !bad;
}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
let imported = 0;
let importedCommits = 0;
try {
  const importedIds = new Set();
  const nodeTimelineIds = new Map();
  for (const node of nodes) {
    const timelineId = node.timelineId || node.saveId || 'current-main-workbench';
    repository.ensureDocument({
      id: timelineId,
      label: timelineId === 'current-main-workbench' ? '主排轴' : `迁移排轴 ${timelineId}`,
      preserveExistingLabel: true,
    });
    const parentNodeId = importedIds.has(node.parentNodeId) && nodeTimelineIds.get(node.parentNodeId) === timelineId
      ? node.parentNodeId
      : null;
    repository.importWorkNode({ ...node, timelineId, parentNodeId, migration: true });
    importedIds.add(node.id);
    nodeTimelineIds.set(node.id, timelineId);
    imported += 1;
  }
  const migratedCommits = archive.commits.filter((commit) => importedIds.has(commit?.nodeId));
  for (const commit of migratedCommits) {
    const timelineId = nodeTimelineIds.get(commit.nodeId);
    repository.importWorkNodeCommit({ ...commit, timelineId });
    importedCommits += 1;
  }
  const latestAppliedByTimeline = new Map();
  for (const commit of migratedCommits.filter((item) => item?.checkoutApplied)) {
    const timelineId = nodeTimelineIds.get(commit.nodeId);
    const previous = latestAppliedByTimeline.get(timelineId);
    if (!previous || (commit.createdAt || 0) > (previous.createdAt || 0)) latestAppliedByTimeline.set(timelineId, commit);
    repository.appendAuditEvent({
      id: `legacy-checkout-${commit.id}`,
      timelineId,
      eventType: 'work-node.checked-out',
      subjectType: 'work-node',
      subjectId: commit.nodeId,
      details: { legacyCommitId: commit.id, checkout: commit.checkout || null },
      createdAt: commit.createdAt || Date.now(),
    });
  }
  for (const [timelineId, commit] of latestAppliedByTimeline) {
    repository.setCheckoutRef({ timelineId, targetType: 'work-node', targetId: commit.nodeId, updatedAt: commit.createdAt || Date.now() });
  }
  const timelineCounts = [...new Set(nodeTimelineIds.values())].map((timelineId) => ({
    timelineId,
    expectedNodes: [...nodeTimelineIds.values()].filter((value) => value === timelineId).length,
    actualNodes: repository.listWorkNodes(timelineId).length,
    expectedCommits: migratedCommits.filter((commit) => nodeTimelineIds.get(commit.nodeId) === timelineId).length,
    actualCommits: repository.listWorkNodeCommits(timelineId).length,
  }));
  const complete = timelineCounts.every((entry) => entry.actualNodes >= entry.expectedNodes && entry.actualCommits >= entry.expectedCommits);
  const migrationState = {
    version: 1,
    complete,
    completedAt: complete ? Date.now() : null,
    sourceNodeCount: nodes.length,
    sourceCommitCount: migratedCommits.length,
    importedNodeCount: imported,
    importedCommitCount: importedCommits,
    anomalousCount: anomalous.length,
    timelineCounts,
  };
  repository.setMeta('legacy_work_node_migration_v1', migrationState);
  const reportPath = path.join(local, 'timeline-work-node-migration-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...migrationState, anomalous, backup }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: complete, imported, importedCommits, anomalous: anomalous.length, timelineCounts, reportPath, backup }, null, 2));
} finally {
  oldStore.close();
  repository.close();
}
