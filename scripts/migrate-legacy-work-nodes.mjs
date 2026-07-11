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
const timelineId = 'current-main-workbench';
const archive = oldStore.readArchive();
const anomalous = [];
const nodes = archive.nodes.filter((node) => {
  const bad = node.saveId?.startsWith('timeline-snapshot-') || node.branchId?.startsWith('timeline-snapshot-') || /^\[snapshot\]/i.test(node.label || '');
  if (bad) anomalous.push({ id: node.id, saveId: node.saveId, branchId: node.branchId, label: node.label, reason: 'legacy-snapshot-work-node' });
  return !bad;
}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
let imported = 0;
try {
  repository.ensureDocument({ id: timelineId, label: '主排轴' });
  const importedIds = new Set();
  for (const node of nodes) {
    const parentNodeId = importedIds.has(node.parentNodeId) ? node.parentNodeId : null;
    repository.importWorkNode({ ...node, timelineId, parentNodeId });
    importedIds.add(node.id);
    imported += 1;
  }
  const appliedCommit = archive.commits
    .filter((commit) => commit?.checkoutApplied && importedIds.has(commit.nodeId))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))[0];
  if (appliedCommit) {
    repository.setCheckoutRef({
      timelineId,
      targetType: 'work-node',
      targetId: appliedCommit.nodeId,
      updatedAt: appliedCommit.createdAt || Date.now(),
    });
  }
  for (const commit of archive.commits.filter((item) => item?.checkoutApplied && importedIds.has(item.nodeId))) {
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
  const reportPath = path.join(local, 'timeline-work-node-migration-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), imported, checkoutNodeId: appliedCommit?.nodeId || null, anomalous, backup }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, imported, checkoutNodeId: appliedCommit?.nodeId || null, anomalous: anomalous.length, reportPath, backup }, null, 2));
} finally {
  oldStore.close();
  repository.close();
}
