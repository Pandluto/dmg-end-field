import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { factsComplete } from './def-harness-regression.mjs';

const require = createRequire(import.meta.url);
const { createAgentRelease } = require('../agent/runtime/def-opencode-adapter/agent-release.cjs');
const { createAgentSessionWorkspace, readNativeSessionBinding, writeSessionBinding } = require('../agent/runtime/def-opencode-adapter/index.cjs');
const projectRoot = path.resolve(import.meta.dirname, '..');
const harnessSealKey = '8'.repeat(64);

const harnessBinding = {
  kind: 'DefHarnessSessionBindingV1',
  schemaVersion: 1,
  sessionId: 'release-session',
  selector: 'candidate/release-contract',
  harness: {
    harnessId: 'release-contract',
    version: '1.0.0',
    contentHash: 'a'.repeat(64),
    schemaVersion: 1,
  },
  slotHashes: { agentContract: ['b'.repeat(64)] },
  createdAt: 1,
};

const release = createAgentRelease({
  projectRoot,
  skillId: 'workbench',
  modelId: 'deepseek-v4-pro',
  requestedThinkingEffort: 'medium',
  basePrompt: 'base prompt',
  harnessBinding,
  observedAt: 100,
});
const sameRelease = createAgentRelease({
  projectRoot,
  skillId: 'workbench',
  modelId: 'deepseek-v4-pro',
  requestedThinkingEffort: 'medium',
  basePrompt: 'base prompt',
  harnessBinding,
  observedAt: 200,
});

assert.equal(release.kind, 'AgentReleaseV1');
assert.equal(release.schemaVersion, 1);
assert.match(release.releaseHash, /^[a-f0-9]{64}$/);
assert.equal(release.releaseHash, sameRelease.releaseHash, 'observation time is not part of release identity');
assert.equal(release.pinning.sessionGuarantee, 'harness-only');
assert.equal(release.pinning.harness, 'immutable');
assert.equal(release.pinning.runtime, 'observed-not-pinned');
assert.equal(release.model.requestedThinkingEffort, 'medium');
assert.equal(release.model.configuredThinkingEffort, 'high');
for (const hash of Object.values(release.components)) assert.match(hash, /^[a-f0-9]{64}$/);

const changedPromptRelease = createAgentRelease({
  projectRoot,
  skillId: 'workbench',
  modelId: 'deepseek-v4-pro',
  requestedThinkingEffort: 'medium',
  basePrompt: 'changed base prompt',
  harnessBinding,
  observedAt: 100,
});
assert.notEqual(changedPromptRelease.releaseHash, release.releaseHash, 'base Prompt changes produce another observed release');

const completeRun = {
  status: 'EXECUTED',
  cleanup: { completed: true },
  session: { sessionId: harnessBinding.sessionId, harnessBinding, agentRelease: release },
  turns: [{
    terminal: { status: 'completed' },
    accepted: {
      testRunId: 'run-1',
      turnId: 'turn-1',
      clientTurnId: 'client-1',
      harness: harnessBinding,
      agentRelease: release,
    },
    nativeUserMessageId: 'message-1',
    assistantMessageIds: ['message-2'],
  }],
};
assert.equal(factsComplete(completeRun), true);
assert.equal(factsComplete({
  ...completeRun,
  turns: [{
    ...completeRun.turns[0],
    accepted: { ...completeRun.turns[0].accepted, agentRelease: changedPromptRelease },
  }],
}), false, 'a regression turn cannot silently use another observed Agent release');

const directory = createAgentSessionWorkspace('workbench');
const expectedRoot = path.resolve(os.tmpdir(), 'dmg-end-field', 'def-agent-workspace', 'sessions');
const relative = path.relative(expectedRoot, directory);
assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'contract workspace must stay under the DEF temp session root');
try {
  const copiedTool = path.join(directory, '.opencode', 'tools', 'def.js');
  const sentinel = 'session-copy-must-not-be-overwritten';
  fs.writeFileSync(copiedTool, sentinel, 'utf8');
  writeSessionBinding(directory, {
    id: harnessBinding.sessionId,
    agent: 'def-workbench',
    skillId: 'workbench',
    harnessBinding,
    agentRelease: release,
  }, { harnessSealKey });

  const read = readNativeSessionBinding(directory, harnessBinding.sessionId, { includeNodeRelation: false, harnessSealKey });
  assert.equal(read?.agentRelease?.releaseHash, release.releaseHash);
  assert.equal(fs.readFileSync(copiedTool, 'utf8'), sentinel, 'reading a session binding must never refresh its workspace files');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

const serverSource = fs.readFileSync(path.join(projectRoot, 'agent/server/def-agent-server.cjs'), 'utf8');
const interopSource = fs.readFileSync(path.join(projectRoot, 'agent/runtime/def-codex-interop.cjs'), 'utf8');
const runnerSource = fs.readFileSync(path.join(projectRoot, 'scripts/def-harness-native-runner.mjs'), 'utf8');
const agentReleaseSource = fs.readFileSync(path.join(projectRoot, 'agent/runtime/def-opencode-adapter/agent-release.cjs'), 'utf8');
assert.match(serverSource, /agentRelease: binding\.agentRelease \|\| null/);
assert.match(interopSource, /agentRelease/);
assert.match(runnerSource, /agentRelease: runner\.agentRelease \|\| null/);
assert.match(agentReleaseSource, /session-harness-seal\.cjs/,
  'AgentRelease toolImplementationHash must include the Session Harness seal implementation');

console.log(JSON.stringify({
  ok: true,
  checks: ['deterministic-release-identity', 'complete-component-hashes', 'harness-seal-component-hash', 'honest-harness-only-pinning', 'session-code-not-refreshed', 'interop-release-evidence', 'regression-release-consistency'],
}));
