import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-work-node-rest-'));
const databasePath = path.join(tempDirectory, 'work-nodes.sqlite3');
const timelineRepositoryPath = path.join(tempDirectory, 'timeline-repository.sqlite3');
const legacyJsonPath = path.join(tempDirectory, 'legacy.json');
const port = 18000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const payload = {
  selectedCharacters: [],
  timelineData: { staffLines: [] },
  skillButtonTable: {},
  allBuffList: [],
  characterInputMap: {},
  operatorConfigPageCache: {},
};

fs.writeFileSync(legacyJsonPath, JSON.stringify({
  type: 'def.ai-timeline.worknodes.v1',
  schemaVersion: 1,
  nodes: [],
  commits: [],
}));

const server = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
    AI_TIMELINE_WORK_NODE_DB_PATH: databasePath,
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: legacyJsonPath,
    TIMELINE_REPOSITORY_DB_PATH: timelineRepositoryPath,
    AI_TIMELINE_DISABLE_LEGACY_PROJECTION: '1',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});

let stderr = '';
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

async function request(method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`REST server did not start. ${stderr}`);
}

async function createNode(id, parentNodeId) {
  const result = await request('POST', '/api/ai-timeline-worknodes/create', {
    id,
    timelineId: 'save-rest',
    branchId: id,
    parentNodeId,
    label: id,
    basePayload: payload,
    workingPayload: payload,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.node;
}

try {
  await waitForHealth();
  const invalidSnapshotMirror = await request('POST', '/api/main-workbench/snapshot', { updatedAt: Date.now(), source: 'rest' });
  assert.equal(invalidSnapshotMirror.status, 400, JSON.stringify(invalidSnapshotMirror.body));
  const validSnapshotMirror = await request('POST', '/api/main-workbench/snapshot', {
    selectedCharacters: [{ id: 'operator-1', name: '测试干员' }],
    skillButtons: [
      { id: 'button-a', characterId: 'operator-1', characterName: '测试干员', staffIndex: 0, nodeIndex: 0, skillType: 'normal' },
      { id: 'button-b', characterId: 'operator-1', characterName: '测试干员', staffIndex: 0, nodeIndex: 1, skillType: 'skill' },
    ],
  });
  assert.equal(validSnapshotMirror.status, 200, JSON.stringify(validSnapshotMirror.body));
  const invalidGridPosition = await request('POST', '/api/def-tools/def.workbench.add_skill_button/call', {
    characterId: 'operator-1', characterName: '测试干员', skillType: 'A', staffIndex: 0, nodeIndex: 18,
  });
  assert.equal(invalidGridPosition.status, 400, JSON.stringify(invalidGridPosition.body));
  assert.equal(invalidGridPosition.body.error?.code, 'invalid-main-workbench-node-index');
  const stagedBatch = await request('POST', '/api/def-tools/def.buff.add_to_buttons/call', {
    buttonIds: ['button-a', 'button-b'],
    buff: { id: 'buff-batch', displayName: '批量测试 Buff', category: 'positive' },
  });
  assert.equal(stagedBatch.status, 200, JSON.stringify(stagedBatch.body));
  assert.equal(stagedBatch.body.result.currentCheckoutTouched, false);
  assert.equal(stagedBatch.body.result.checkoutDecision.requiresManualApproval, true);
  assert.equal(stagedBatch.body.result.diff.summary.changedButtonCount, 2);
  const stagedNodes = await request('GET', '/api/timeline-work-nodes?timelineId=current-main-workbench');
  assert.equal(stagedNodes.body.nodes.length, 1, JSON.stringify(stagedNodes.body));
  assert.match(stagedNodes.body.nodes[0].label, /^\[ai\]/);
  const document = await request('POST', '/api/timeline-documents', { id: 'timeline-rest', label: 'REST 排轴' });
  assert.equal(document.status, 200, JSON.stringify(document.body));
  const snapshot = await request('POST', '/api/timeline-snapshots', {
    id: 'snapshot-rest', timelineId: 'timeline-rest', label: 'REST 快照', payload,
  });
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
  const checkoutRef = await request('POST', '/api/timeline-checkout-ref', {
    timelineId: 'timeline-rest', targetType: 'snapshot', targetId: 'snapshot-rest',
  });
  assert.equal(checkoutRef.status, 200, JSON.stringify(checkoutRef.body));
  const snapshots = await request('GET', '/api/timeline-snapshots?timelineId=timeline-rest');
  assert.equal(snapshots.body.snapshots.length, 1);

  const imported = await request('POST', '/api/timeline-bundles/import', {
    document: { id: 'timeline-imported', label: 'Imported timeline' },
    snapshots: [{ id: 'snapshot-imported', label: 'Imported snapshot', payload }],
    workNodes: [{
      id: 'imported-node', branchId: 'imported-branch', label: 'Imported branch',
      basePayload: payload, workingPayload: payload,
    }],
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.snapshots.length, 1);
  assert.equal(imported.body.workNodeCount, 1);
  const importedNodes = await request('GET', '/api/timeline-work-nodes?timelineId=timeline-imported');
  assert.equal(importedNodes.body.nodes[0]?.id, 'imported-node');
  const exported = await request('GET', '/api/timeline-bundles/export?timelineId=timeline-imported');
  assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.snapshots[0]?.id, 'snapshot-imported');
  assert.equal(exported.body.workNodes[0]?.id, 'imported-node');
  assert.deepEqual(exported.body.workNodes[0]?.workingPayload, payload);
  const brokenImport = await request('POST', '/api/timeline-bundles/import', {
    document: { id: 'timeline-broken', label: 'Broken timeline' },
    snapshots: [{ id: 'snapshot-broken', label: 'Broken snapshot' }],
  });
  assert.equal(brokenImport.status, 400, JSON.stringify(brokenImport.body));
  const documents = await request('GET', '/api/timeline-documents');
  assert.equal(documents.body.documents.some((document) => document.id === 'timeline-broken'), false);

  const orphanCreate = await request('POST', '/api/ai-timeline-worknodes/create', {
    id: 'orphan', timelineId: 'save-rest', branchId: 'orphan', parentNodeId: 'missing-parent',
    label: 'orphan', basePayload: payload, workingPayload: payload,
  });
  assert.equal(orphanCreate.status, 404, JSON.stringify(orphanCreate.body));
  assert.equal(orphanCreate.body.error?.code, 'timeline-work-node-parent-not-found');
  const orphanLegacyProjection = await request('GET', '/api/ai-timeline-worknodes/orphan');
  assert.equal(orphanLegacyProjection.status, 404, JSON.stringify(orphanLegacyProjection.body));
  const orphanRepositoryProjection = await request('GET', '/api/timeline-work-nodes?timelineId=save-rest');
  assert.deepEqual(orphanRepositoryProjection.body.nodes, []);

  await createNode('root', null);
  await createNode('child', 'root');
  await createNode('branch', 'root');

  // Repository deletion is authoritative during migration: it must clean the
  // compatibility tree too, otherwise a later legacy update resurrects nodes.
  const erasedRepositoryTree = await request('POST', '/api/timeline-work-nodes/root/delete', {});
  assert.equal(erasedRepositoryTree.status, 200, JSON.stringify(erasedRepositoryTree.body));
  const deletedLegacyChild = await request('GET', '/api/ai-timeline-worknodes/child');
  assert.equal(deletedLegacyChild.status, 404, JSON.stringify(deletedLegacyChild.body));
  const deletedRepositoryTree = await request('GET', '/api/timeline-work-nodes?timelineId=save-rest');
  assert.deepEqual(deletedRepositoryTree.body.nodes, []);

  // Recreate the test tree for the checkout and protected-delete checks below.
  await createNode('root', null);
  await createNode('child', 'root');
  await createNode('branch', 'root');

  let list = await request('GET', '/api/ai-timeline-worknodes');
  assert.equal(list.status, 200);
  assert.equal(list.body.headNodeId, '');
  assert.equal(list.body.nodes.find((node) => node.id === 'child')?.parentNodeId, 'root');
  assert.equal(list.body.nodes.some((node) => 'basePayload' in node || 'workingPayload' in node), false);

  const invalidStatus = await request('POST', '/api/ai-timeline-worknodes/branch/update', { status: 'made-up-state' });
  assert.equal(invalidStatus.status, 400, JSON.stringify(invalidStatus.body));
  assert.equal(invalidStatus.body.error?.code, 'invalid-timeline-work-node-status');

  const committed = await request('POST', '/api/ai-timeline-worknodes/branch/commit', {
    commitId: 'commit-branch',
    approval: { approvedBy: 'user', rationale: 'REST smoke checkout' },
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  const duplicateCommit = await request('POST', '/api/ai-timeline-worknodes/branch/commit', {
    commitId: 'commit-branch', approval: { approvedBy: 'user', rationale: 'duplicate id check' },
  });
  assert.equal(duplicateCommit.status, 409, JSON.stringify(duplicateCommit.body));
  assert.equal(duplicateCommit.body.error?.code, 'ai-worknode-commit-id-conflict');
  const checkedOut = await request('POST', '/api/ai-timeline-worknodes/branch/checkout-applied', {
    commitId: 'commit-branch', appliedBy: 'user', rationale: 'REST smoke checkout',
  });
  assert.equal(checkedOut.status, 200, JSON.stringify(checkedOut.body));
  const repositoryCheckout = await request('GET', '/api/timeline-checkout-ref?timelineId=save-rest');
  assert.equal(repositoryCheckout.status, 200, JSON.stringify(repositoryCheckout.body));
  assert.equal(repositoryCheckout.body.checkoutRef.targetId, 'branch');
  const repositoryCommits = await request('GET', '/api/timeline-work-node-commits?timelineId=save-rest');
  assert.equal(repositoryCommits.status, 200, JSON.stringify(repositoryCommits.body));
  assert.equal(repositoryCommits.body.commits.length, 1);
  assert.equal(repositoryCommits.body.commits[0].id, 'commit-branch');
  assert.equal(repositoryCommits.body.commits[0].checkoutApplied, true);

  const restored = await request('POST', '/api/ai-timeline-worknodes/branch/rollback-applied', {
    appliedBy: 'user',
    rationale: 'REST smoke restore',
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.node.id, 'branch');
  assert.equal(restored.body.node.status, 'ready');
  const repositoryNodes = await request('GET', '/api/timeline-work-nodes?timelineId=save-rest');
  assert.equal(repositoryNodes.body.nodes.length, 3);
  const audit = await request('GET', '/api/timeline-audit-events?timelineId=save-rest');
  assert.equal(audit.status, 200, JSON.stringify(audit.body));
  assert.equal(audit.body.events.some((event) => event.eventType === 'work-node.base-restored'), true);

  const protectedDelete = await request('POST', '/api/ai-timeline-worknodes/root/delete', {});
  assert.notEqual(protectedDelete.status, 200);

  const grayDelete = await request('POST', '/api/ai-timeline-worknodes/child/delete', {});
  assert.equal(grayDelete.status, 200, JSON.stringify(grayDelete.body));
  assert.equal(grayDelete.body.nodes.some((node) => node.id === 'child'), false);

  list = await request('GET', '/api/ai-timeline-worknodes');
  assert.equal(list.body.nodes.filter((node) => node.timelineId === 'save-rest').length, 2);
  assert.equal(list.body.nodes.some((node) => node.timelineId === 'current-main-workbench' && /^\[ai\]/.test(node.label)), true);
  assert.equal(list.body.headNodeId, 'branch');
  const legacyDb = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(legacyDb.prepare('SELECT COUNT(*) AS count FROM work_nodes').get().count, 0);
  assert.equal(legacyDb.prepare('SELECT COUNT(*) AS count FROM work_node_commits').get().count, 0);
  legacyDb.close();
  console.log('AI timeline Work Node REST smoke passed.');
} finally {
  if (server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (stderr.trim() && !/ExperimentalWarning/.test(stderr)) console.error(stderr.trim());
}
