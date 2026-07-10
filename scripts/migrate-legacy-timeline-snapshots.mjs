import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.resolve(process.argv[2] || path.join(root, 'data', 'localdata', 'now-storage.json'));
const databasePath = path.resolve(process.env.TIMELINE_REPOSITORY_DB_PATH || path.join(root, 'data', 'localdata', 'timeline-repository.sqlite3'));
const timelineId = 'current-main-workbench';

const archive = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const storage = archive?.storage || {};
const snapshotArchive = storage.local?.['def.timeline.snapshot-archive.v1'] || storage.session?.['def.timeline.snapshot-archive.v1'];
const snapshots = Array.isArray(snapshotArchive?.snapshots) ? snapshotArchive.snapshots : [];
const repository = createTimelineRepository({ databasePath });
let imported = 0;
let reused = 0;
try {
  repository.ensureDocument({ id: timelineId, label: '主排轴' });
  for (const snapshot of snapshots) {
    if (!snapshot?.id || !snapshot?.payload) continue;
    const result = repository.createOrReuseSnapshot({
      id: snapshot.id,
      timelineId,
      label: snapshot.label || snapshot.id,
      payload: snapshot.payload,
      createdAt: snapshot.createdAt,
    });
    if (result.reused) reused += 1;
    else imported += 1;
  }
  console.log(JSON.stringify({ ok: true, sourcePath, databasePath, found: snapshots.length, imported, reused }, null, 2));
} finally {
  repository.close();
}
