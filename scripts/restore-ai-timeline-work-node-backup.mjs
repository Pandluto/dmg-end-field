import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const backupDirectory = option('--backup-dir');
const targetOverride = option('--target-database');
const confirmed = process.argv.includes('--confirm');

if (!backupDirectory || !confirmed) {
  process.stderr.write('Usage: node scripts/restore-ai-timeline-work-node-backup.mjs --backup-dir <directory> [--target-database <path>] --confirm\n');
  process.exitCode = 2;
} else {
  const resolvedBackupDirectory = path.resolve(backupDirectory);
  const manifestPath = path.join(resolvedBackupDirectory, 'migration-preview-backup.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Backup manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.type !== 'def.ai-timeline-worknodes.raw-backup.v1' || !Array.isArray(manifest.files)) {
    throw new Error('Backup manifest is not a supported raw Work Node backup.');
  }
  const targetDatabase = path.resolve(targetOverride || manifest.sourceDatabasePath || '');
  if (!targetDatabase) throw new Error('Backup manifest does not specify a source database path.');
  const targetDirectory = path.dirname(targetDatabase);
  fs.mkdirSync(targetDirectory, { recursive: true });
  const backupBaseName = path.basename(targetDatabase);
  const required = manifest.files.find((file) => path.basename(file.targetPath || '') === backupBaseName);
  if (!required) throw new Error(`Backup does not contain database file ${backupBaseName}.`);

  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${targetDatabase}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
  const restoredFiles = [];
  for (const file of manifest.files) {
    const source = file.targetPath || path.join(resolvedBackupDirectory, path.basename(file.sourcePath || ''));
    const name = path.basename(source);
    if (!name.startsWith(backupBaseName) || !fs.existsSync(source)) continue;
    const suffix = name.slice(backupBaseName.length);
    if (!['', '-wal', '-shm'].includes(suffix)) continue;
    const target = `${targetDatabase}${suffix}`;
    fs.copyFileSync(source, target);
    restoredFiles.push(target);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, type: 'def.ai-timeline-worknodes.restore.v1', targetDatabase, restoredFiles }, null, 2)}\n`);
}
