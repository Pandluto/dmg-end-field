import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDatabasePath = path.join(projectRoot, 'data', 'localdata', 'ai-timeline-worknodes.sqlite3');

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isSnapshotWorkNode(row) {
  return row.save_id.startsWith('timeline-snapshot-')
    || row.branch_id.startsWith('timeline-snapshot-')
    || /^\s*\[snapshot\]/i.test(row.label);
}

function listSnapshotNodeAnomalies(databasePath) {
  if (!fs.existsSync(databasePath)) {
    return {
      databasePath,
      exists: false,
      nodeCount: 0,
      anomalies: [],
    };
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const nodes = db.prepare(`
      SELECT id, save_id, branch_id, parent_id, label, status, created_at, updated_at
      FROM work_nodes
      ORDER BY created_at ASC
    `).all();
    const heads = db.prepare('SELECT save_id, current_node_id FROM work_node_heads').all();
    const headNodeIds = new Set(heads.map((head) => head.current_node_id));
    const anomalies = nodes
      .filter(isSnapshotWorkNode)
      .map((node) => ({
        id: node.id,
        saveId: node.save_id,
        branchId: node.branch_id,
        label: node.label,
        status: node.status,
        parentNodeId: node.parent_id || null,
        isIndependentRoot: !node.parent_id,
        isCurrentHead: headNodeIds.has(node.id),
        createdAt: node.created_at,
        updatedAt: node.updated_at,
        classification: 'legacy-snapshot-work-node',
        recommendedAction: headNodeIds.has(node.id) ? 'repoint-checkout-before-archive' : 'archive-during-migration',
      }));

    return {
      databasePath,
      exists: true,
      nodeCount: nodes.length,
      headCount: heads.length,
      anomalies,
    };
  } finally {
    db.close();
  }
}

function copyIfPresent(sourcePath, backupDirectory, copiedFiles) {
  if (!fs.existsSync(sourcePath)) return;
  const targetPath = path.join(backupDirectory, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  copiedFiles.push({ sourcePath, targetPath });
}

function createRawBackup(databasePath, backupDirectory) {
  if (!backupDirectory) return null;
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Cannot back up missing database: ${databasePath}`);
  }
  fs.mkdirSync(backupDirectory, { recursive: true });
  const copiedFiles = [];
  copyIfPresent(databasePath, backupDirectory, copiedFiles);
  copyIfPresent(`${databasePath}-wal`, backupDirectory, copiedFiles);
  copyIfPresent(`${databasePath}-shm`, backupDirectory, copiedFiles);
  const manifestPath = path.join(backupDirectory, 'migration-preview-backup.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    type: 'def.ai-timeline-worknodes.raw-backup.v1',
    createdAt: new Date().toISOString(),
    sourceDatabasePath: databasePath,
    files: copiedFiles,
    note: 'This is a raw SQLite backup set. Close the app before creating a backup to guarantee a consistent database and WAL pair.',
  }, null, 2)}\n`, 'utf8');
  return { backupDirectory, manifestPath, copiedFiles };
}

const databasePath = path.resolve(readOption('--database') || defaultDatabasePath);
const backupDirectoryInput = readOption('--backup-dir');
const backupDirectory = backupDirectoryInput ? path.resolve(backupDirectoryInput) : null;
const preview = listSnapshotNodeAnomalies(databasePath);
const backup = createRawBackup(databasePath, backupDirectory);
const result = {
  type: 'def.ai-timeline-worknode-migration-preview.v1',
  generatedAt: new Date().toISOString(),
  readOnlySource: true,
  preview,
  backup,
  policy: 'No node is deleted, reparented, checked out, or otherwise mutated by this command.',
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`Work Node migration preview: ${preview.nodeCount} nodes, ${preview.anomalies.length} legacy snapshot node(s).\n`);
  for (const node of preview.anomalies) {
    process.stdout.write(`- ${node.id}: ${node.label} (${node.recommendedAction})\n`);
  }
  if (backup) process.stdout.write(`Raw backup written to ${backup.backupDirectory}\n`);
}
