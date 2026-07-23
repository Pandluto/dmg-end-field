import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const managerTests = fs.readdirSync(path.join(projectRoot, 'agent', 'runtime', 'def-harness-manager'))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join('agent', 'runtime', 'def-harness-manager', name));

const contracts = [
  ['manager-unit-and-integration', ['--test', ...managerTests]],
  ['manager-host-tool-boundary', ['scripts/def-harness-manager-boundary-contract-test.mjs']],
  ['formal-turn-routing', ['scripts/def-harness-turn-routing-contract-test.mjs']],
  ['disabled-host-retirement', ['scripts/def-opencode-host-retirement-contract-test.mjs']],
  ['interop-authorization', ['scripts/def-interop-snapshot-auth-contract-test.mjs']],
  ['projection-bridge', ['scripts/def-workbench-projection-bridge-contract-test.mjs']],
  ['work-node-codec', ['agent/runtime/def-node-workspace/codec.test.mjs']],
  ['workbench-binding', ['scripts/def-workbench-binding-contract-test.mjs']],
  ['workbench-rest-binding', ['scripts/def-workbench-binding-rest-contract-test.mjs']],
  ['canonical-current-gate', ['scripts/def-workbench-current-gate-contract-test.mjs']],
  ['current-tool-policy', ['scripts/def-workbench-tool-policy-contract-test.mjs']],
  ['raw-route-policy', ['scripts/def-workbench-raw-route-policy-contract-test.mjs']],
  ['approval-capability', ['scripts/def-workbench-approval-capability-contract-test.mjs']],
  ['operator-config-atomicity', ['scripts/def-operator-config-atomic-contract-test.mjs']],
  ['team-candidate-atomicity', ['scripts/def-team-atomic-candidate-contract-test.mjs']],
  ['team-rollback', ['scripts/def-team-rollback-contract-test.mjs']],
  ['team-late-command', ['scripts/def-team-late-command-contract-test.mjs']],
  ['team-pending-reconciliation', ['scripts/def-team-pending-reconciliation-rest-contract-test.mjs']],
  ['session-cleanup', ['scripts/def-workbench-session-cleanup-contract-test.mjs']],
];

for (const [name, args] of contracts) {
  process.stdout.write(`\n[def-harness-manager] ${name}\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    process.stderr.write(`[def-harness-manager] FAILED: ${name}\n`);
    break;
  }
}

if (!process.exitCode) {
  process.stdout.write('\nDEF Harness Manager contract suite: PASS\n');
}
