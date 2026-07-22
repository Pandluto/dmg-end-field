import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-worknode-session-delete-'));
const port = 18700 + Math.floor(Math.random() * 200);
const databasePath = path.join(root, 'timeline.sqlite');
const internalToken = 'worknode-session-delete-contract-native-host';
const repository = createTimelineRepository({ databasePath });
const payload = {
  selectedCharacters: [],
  timelineData: { staffLines: [] },
  skillButtonTable: {},
  allBuffList: [],
  characterInputMap: {},
  operatorConfigPageCache: {},
};

// Keep the workspace id snapshot-shaped to cover the legacy projection guard
// that previously dropped a native fork before it reached SQLite.
const workspaceId = 'timeline-snapshot-formal-a';
repository.ensureDocument({ id: workspaceId, label: workspaceId });
repository.importWorkNode({
  id: 'node-a', timelineId: workspaceId, branchId: `${workspaceId}-main`, label: 'formal-a parent',
  status: 'ready', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload,
  contentRevision: 100,
});
repository.setCheckoutRef({ timelineId: workspaceId, targetType: 'work-node', targetId: 'node-a', updatedAt: 100 });
repository.upsertSessionAxisBinding({ id: 'axis-a', timelineId: workspaceId, host: 'workbench', opencodeSessionId: 'session-a' });
repository.upsertSessionAxisBinding({ id: 'axis-b', timelineId: workspaceId, host: 'workbench', opencodeSessionId: 'session-b' });

let childStderr = '';
const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_REST_STORAGE_MODE: 'runtime',
    AI_CLI_REST_STORAGE_DIR: path.join(root, 'rest'),
    AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite-cache'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite'),
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: databasePath,
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
    DEF_TOOL_GOVERNANCE_PATH: path.join(root, 'governance.json'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: internalToken,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.on('data', (chunk) => { childStderr += String(chunk); });

async function waitForReady() {
  for (let index = 0; index < 300; index += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Work Node session contract server (exit=${child.exitCode}, signal=${child.signalCode}). ${childStderr}`);
}

async function request(pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-def-internal-token': internalToken },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function mirror() {
  const response = await request('/api/main-workbench/snapshot', {
    source: 'app',
    activeTimelineId: workspaceId,
    timelineId: workspaceId,
    checkout: repository.getCheckoutRef(workspaceId),
    selectedCharacters: [],
    skillButtons: [],
    operatorConfigs: [],
    damageReport: { generatedAt: 1, totalExpected: 0, totalNonCrit: 0, buttonCount: 0, buttons: [] },
    updatedAt: Date.now(),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

process.env.DEF_REST_BASE_URL = `http://127.0.0.1:${port}`;
process.env.DEF_INTERNAL_GOVERNANCE_TOKEN = internalToken;
const { node_fork, node_bind, node_delete, node_list } = await import('../agent/runtime/def-tools/opencode/def.js');

function context(sessionID, directory, askCalls, decisions) {
  return {
    directory,
    sessionID,
    messageID: `${sessionID}-delete-turn`,
    metadata() {},
    async ask(requestInput) {
      askCalls.push(requestInput);
      if (decisions.shift() === 'reject') {
        const error = new Error('native permission rejected');
        error.name = 'PermissionDeniedError';
        throw error;
      }
    },
  };
}

try {
  await waitForReady();
  await mirror();

  const sessionADirectory = path.join(root, 'session-a');
  const sessionAAskCalls = [];
  const sessionA = context('session-a', sessionADirectory, sessionAAskCalls, ['reject', 'approve']);
  const forked = await node_fork.execute({
    name: 'contract draft',
    description: 'Create a draft for delete approval regression coverage.',
    placement: 'child',
  }, sessionA);
  const forkOutput = JSON.parse(forked.output);
  const nodeId = forkOutput.nodeId;
  assert.ok(nodeId, 'fork must return an exact nodeId for subsequent bind/delete calls');
  assert.equal(forkOutput.workspaceId, workspaceId, 'fork must return the exact SQLite workspace identity with its nodeId');
  assert.equal(repository.getWorkNode(nodeId)?.timelineId, workspaceId);
  assert.equal(repository.getWorkNode(nodeId)?.ownerSessionId, 'session-a');
  assert.equal(repository.getCheckoutRef(workspaceId)?.targetId, 'node-a', 'fork must not change checkout');

  const sessionAList = JSON.parse((await node_list.execute({}, sessionA)).output);
  assert.ok(sessionAList.nodes.some((node) => node.id === nodeId));

  await assert.rejects(
    () => node_delete.execute({ nodeId }, sessionA),
    /native permission rejected/,
    'same-session delete rejection must be handled by native approval',
  );
  assert.equal(sessionAAskCalls.length, 1);
  assert.equal(sessionAAskCalls[0].metadata?.nodeId, nodeId);
  assert.equal(sessionAAskCalls[0].metadata?.workspaceId, workspaceId);
  assert.ok(repository.getWorkNode(nodeId), 'rejecting delete must not change the repository');
  assert.equal(repository.getCheckoutRef(workspaceId)?.targetId, 'node-a');

  const sessionBDirectory = path.join(root, 'session-b');
  const sessionBAskCalls = [];
  const sessionB = context('session-b', sessionBDirectory, sessionBAskCalls, []);
  const sessionBList = JSON.parse((await node_list.execute({}, sessionB)).output);
  assert.equal(sessionBList.nodes.some((node) => node.id === nodeId), false, 'a different DEF session must not list another session draft');
  await assert.rejects(
    () => node_bind.execute({ nodeId }, sessionB),
    (error) => error?.code === 'blocked-session-mismatch',
    'a different DEF session must not bind a draft merely because it shares the timeline workspace',
  );
  assert.equal(sessionBAskCalls.length, 0);
  assert.equal(fs.existsSync(path.join(sessionBDirectory, '.def-node.json')), false);

  await assert.rejects(
    () => node_delete.execute({ nodeId }, sessionB),
    (error) => error?.code === 'blocked-session-mismatch',
    'a different DEF session must not reach native delete approval',
  );
  assert.equal(sessionBAskCalls.length, 0);
  assert.ok(repository.getWorkNode(nodeId), 'cross-session rejection must leave the draft intact');

  const deleted = await node_delete.execute({ nodeId }, sessionA);
  const deleteOutput = JSON.parse(deleted.output);
  assert.equal(deleteOutput.ok, true);
  assert.equal(deleteOutput.deleted, true);
  assert.equal(deleteOutput.workspaceId, workspaceId);
  assert.equal(deleteOutput.finalState, 'deleted');
  assert.equal(deleteOutput.postcondition?.contract, 'DefWorkNodeDeletePostconditionV1');
  assert.equal(deleteOutput.postcondition?.pass, true);
  assert.equal(repository.getWorkNode(nodeId), null, 'approved delete must remove the exact draft');
  assert.equal(repository.getCheckoutRef(workspaceId)?.targetId, 'node-a', 'approved draft delete must not move checkout');

  console.log('DEF Work Node same-session delete approval contract: PASS');
} finally {
  if (!child.killed) child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 1500);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  repository.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
