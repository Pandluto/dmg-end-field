import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./index.tsx', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const dispatcherStart = source.indexOf('const processMainWorkbenchCanvasCommand');
const dispatcherEnd = source.indexOf('\n  useEffect(', dispatcherStart);

assert.ok(dispatcherStart >= 0, 'Canvas command dispatcher must remain present');
assert.ok(dispatcherEnd > dispatcherStart, 'Canvas command dispatcher boundary must remain detectable');

const dispatcher = source.slice(dispatcherStart, dispatcherEnd);
const supportedListMatch = dispatcher.match(
  /getPendingMainWorkbenchCommands\(\[([\s\S]*?)\]\)\[0\]/,
);
assert.ok(supportedListMatch, 'dispatcher must declare its supported command list');

const supportedOps = [...supportedListMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.equal(supportedOps.length, 22, 'all 22 Canvas command operations must stay registered');
assert.equal(new Set(supportedOps).size, supportedOps.length, 'supported command operations must be unique');

const branchMatches = [...dispatcher.matchAll(/if \(command\.op === '([^']+)'\) \{/g)];
const explicitBranchOps = branchMatches.map((match) => match[1]);
assert.deepEqual(
  explicitBranchOps,
  supportedOps.filter((op) => op !== 'calculateDamage'),
  'every supported operation except the shared damage fallback must keep an explicit branch',
);

branchMatches.forEach((match, index) => {
  const branchStart = match.index ?? 0;
  const branchEnd = index + 1 < branchMatches.length
    ? branchMatches[index + 1].index ?? dispatcher.length
    : dispatcher.indexOf('\n        let timelineSkillButtonIds', branchStart);
  const branchSource = dispatcher.slice(branchStart, branchEnd > branchStart ? branchEnd : dispatcher.length);
  assert.match(
    branchSource,
    /settleCommand\s*\(/,
    `${match[1]} must settle through the shared command result path`,
  );
});

assert.match(
  dispatcher,
  /command\.op === 'calculateDamage' && command\.buttonId[\s\S]*?settleCommand\(\{ status: 'done', result \}\)/,
  'calculateDamage and its shared snapshot fallback must settle through the same path',
);
assert.match(
  dispatcher,
  /catch \(error\) \{[\s\S]*?settleCommand\(\{[\s\S]*?status: 'error'/,
  'thrown command errors must settle through the shared error path',
);

assert.equal(
  (dispatcher.match(/patchMainWorkbenchCommand\s*\(/g) ?? []).length,
  2,
  'the dispatcher may patch directly only for running status and inside settleCommand',
);
assert.equal(
  (dispatcher.match(/pushMainWorkbenchCommandResult\s*\(/g) ?? []).length,
  1,
  'the shared settlement helper must remain the only result push call site',
);

console.log('Canvas command settlement static contract: PASS');
