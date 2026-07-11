import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const backupDirectoryInput = option('--backup-dir');
const targetLocalDirectoryInput = option('--target-local-dir');
const confirmed = process.argv.includes('--confirm');

if (!backupDirectoryInput || !confirmed) {
  process.stderr.write('Usage: node scripts/restore-timeline-migration-backup.mjs --backup-dir <directory> [--target-local-dir <directory>] --confirm\n');
  process.exitCode = 2;
} else {
  const backupDirectory = path.resolve(backupDirectoryInput);
  const manifestPath = path.join(backupDirectory, 'timeline-migration-backup.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Backup manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.type !== 'def.timeline-migration.raw-backup.v1' || !Array.isArray(manifest.files)) {
    throw new Error('Backup manifest is not a supported Timeline migration backup.');
  }
  const targetLocalDirectory = path.resolve(targetLocalDirectoryInput || manifest.sourceLocalDirectory || '');
  if (!targetLocalDirectory) throw new Error('Backup manifest does not specify a target local-data directory.');
  fs.mkdirSync(targetLocalDirectory, { recursive: true });
  const restoredFiles = [];
  for (const file of manifest.files) {
    const source = typeof file?.targetPath === 'string' ? path.resolve(file.targetPath) : '';
    const name = path.basename(source);
    if (!name || !source.startsWith(`${backupDirectory}${path.sep}`) || !fs.existsSync(source)) continue;
    const target = path.join(targetLocalDirectory, name);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    fs.copyFileSync(source, target);
    restoredFiles.push(target);
  }
  for (const missingPath of Array.isArray(manifest.missingPaths) ? manifest.missingPaths : []) {
    const name = path.basename(typeof missingPath === 'string' ? missingPath : '');
    if (!name) continue;
    const target = path.join(targetLocalDirectory, name);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      restoredFiles.push(`${target} (removed: absent in backup)`);
    }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, type: 'def.timeline-migration.restore.v1', targetLocalDirectory, restoredFiles }, null, 2)}\n`);
}
