import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-timeline-bundle-v2-'));
const output = path.join(directory, 'timeline-bundle.mjs');

try {
  await build({
    entryPoints: [path.resolve('src/utils/timelineSnapshotStorage.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const { buildTimelineBundleV2, parseTimelineBundleV2 } = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
  const payload = {
    selectedCharacters: ['operator-1'],
    timelineData: { version: '1.0.0', createdAt: 1, updatedAt: 1, staffLines: [] },
    skillButtonTable: {},
    allBuffList: [],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: { operator: { portraitPath: 'C:\\Users\\tester\\AppData\\Local\\secret.png' } },
    operatorConfigPageCache: {},
  };
  const snapshot = { id: 'snapshot-1', label: '快照', createdAt: 1, summary: { characterCount: 1, buttonCount: 0, buffCount: 0 }, payload };
  const root = {
    id: 'node-root', branchId: 'main', label: '[ai] root', status: 'committed', approvalPolicy: 'auto-low-risk',
    riskFlags: [], logs: [], createdAt: 2, updatedAt: 2, basePayload: payload, workingPayload: payload,
  };
  const child = { ...root, id: 'node-child', parentNodeId: 'node-root', label: '[ai] child', createdAt: 3, updatedAt: 3 };
  const commit = {
    id: 'commit-child', nodeId: 'node-child', branchId: 'main', label: 'commit', createdAt: 4, summary: {},
    riskFlags: [], approval: { mode: 'auto', approvedBy: 'ai', rationale: 'smoke' }, checkoutApplied: true,
    checkout: { appliedAt: 4, appliedBy: 'ai', rationale: 'smoke' }, basePayload: payload, appliedPayload: payload,
  };

  const snapshotBundle = await buildTimelineBundleV2({ timelineId: 'timeline-source', snapshot, scope: 'snapshot' });
  const parsedSnapshot = await parseTimelineBundleV2(JSON.stringify(snapshotBundle));
  assert.equal(parsedSnapshot.manifest.scope, 'snapshot');
  assert.equal(parsedSnapshot.workNodes, undefined);
  assert.equal(parsedSnapshot.payloads[0].characterDisplayCacheMap.operator.portraitPath, '');

  const branchBundle = await buildTimelineBundleV2({
    timelineId: 'timeline-source', snapshot, scope: 'branch', workNodes: [root, child], commits: [commit],
    checkoutRef: { targetType: 'work-node', targetId: 'node-child', updatedAt: 4 },
  });
  const parsedBranch = await parseTimelineBundleV2(JSON.stringify(branchBundle));
  assert.equal(parsedBranch.workNodes.length, 2);
  assert.equal(parsedBranch.commits[0].nodeId, 'node-child');
  assert.equal(parsedBranch.checkoutRef.targetId, 'node-child');

  const documentBundle = await buildTimelineBundleV2({
    timelineId: 'timeline-source', snapshot, snapshots: [snapshot], scope: 'document', workNodes: [root, child], commits: [commit],
    checkoutRef: { targetType: 'work-node', targetId: 'node-child', updatedAt: 4 },
  });
  assert.equal((await parseTimelineBundleV2(JSON.stringify(documentBundle))).manifest.scope, 'document');

  const tampered = structuredClone(documentBundle);
  tampered.payloads[0].selectedCharacters.push('tampered');
  assert.equal(await parseTimelineBundleV2(JSON.stringify(tampered)), null);
  const escapedParent = structuredClone(documentBundle);
  escapedParent.workNodes[1].parentNodeId = 'outside-document';
  assert.equal(await parseTimelineBundleV2(JSON.stringify(escapedParent)), null);
  const localPathInjection = structuredClone(documentBundle);
  localPathInjection.document.label = 'C:\\Users\\tester\\AppData\\secret';
  assert.equal(await parseTimelineBundleV2(JSON.stringify(localPathInjection)), null);

  console.log('Timeline Bundle V2 smoke passed.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
