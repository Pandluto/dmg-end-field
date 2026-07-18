import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'scripts/ai-cli-rest-server.mjs'), 'utf8');
const native = fs.readFileSync(path.join(root, 'agent/runtime/def-tools/opencode/def.js'), 'utf8');
const consumeStart = server.indexOf('function consumeApprovedApplyCapability');
const consumeEnd = server.indexOf('// Guide reads', consumeStart);
const consume = server.slice(consumeStart, consumeEnd);
assert(consume.includes('capability.used = true'), 'capability must be one-time consumed');
assert(server.includes("name === 'def.approval.record_decision'"), 'model-facing decision mint must be policy-gated');
assert(server.includes("'denied-approval-decision'"), 'forged generic decision must have a stable rejection contract');

const operatorStart = server.indexOf('async function executeDefOperatorConfigApplyPrepared');
const operatorEnd = server.indexOf('function discardDefPreparedOperatorConfig', operatorStart);
const operatorApply = server.slice(operatorStart, operatorEnd);
assert(operatorApply.indexOf('consumeApprovedApplyCapability') < operatorApply.indexOf("/commit`"), 'operator apply must consume approval before C commit');
for (const identity of ['sessionId', 'timelineId', 'axisBindingId', 'parentNodeId', 'parentRevision', 'candidateNodeId', 'candidateRevision', 'workingHash']) {
  assert(operatorApply.includes(identity), `operator approval capability must bind ${identity}`);
}

const teamStart = server.indexOf('async function applyDefTeamLoadoutPlan');
const teamEnd = server.indexOf('function discardPreparedTeamLoadoutPlan', teamStart);
const teamApply = server.slice(teamStart, teamEnd);
assert(teamApply.includes('planId: stored.planId') && teamApply.includes('planHash: stored.planHash'), 'team approval must bind the immutable plan identity');
assert(teamApply.indexOf('consumeApprovedApplyCapability') < teamApply.indexOf("/commit`"), 'team apply must consume approval before C commit');
for (const identity of ['sessionId', 'timelineId', 'axisBindingId', 'parentNodeId', 'parentRevision', 'candidateNodeId', 'candidateRevision', 'workingHash']) {
  assert(teamApply.includes(identity), `team approval capability must bind ${identity}`);
}
assert(native.includes('approvalCapability: decided.approvalCapability'), 'native continuation must receive a server-minted capability, not infer approval locally');

console.log('DEF approval capability contract: PASS (native-only decision, exact one-time apply binding)');
