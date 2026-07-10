import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiTimelineWorkNodeStore } = require('../electron/ai-timeline-work-node-store.cjs');
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, 'data', 'localdata');
const oldStore = createAiTimelineWorkNodeStore({ databasePath: path.join(local, 'ai-timeline-worknodes.sqlite3'), legacyJsonPath: path.join(local, 'ai-timeline-worknodes.json') });
const repository = createTimelineRepository({ databasePath: path.join(local, 'timeline-repository.sqlite3') });
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
  const reportPath = path.join(local, 'timeline-work-node-migration-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), imported, checkoutNodeId: appliedCommit?.nodeId || null, anomalous }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, imported, checkoutNodeId: appliedCommit?.nodeId || null, anomalous: anomalous.length, reportPath }, null, 2));
} finally {
  oldStore.close();
  repository.close();
}
