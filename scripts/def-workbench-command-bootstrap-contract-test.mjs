import assert from 'node:assert/strict';
import fs from 'node:fs';

const canvasBoardSource = fs.readFileSync(
  new URL('../src/components/CanvasBoard/index.tsx', import.meta.url),
  'utf8',
);

const pullIndex = canvasBoardSource.indexOf('await pullRemoteMainWorkbenchCommands();');
const bootstrapGateIndex = canvasBoardSource.indexOf(
  'if (isCheckoutBootstrapPendingRef.current)',
  pullIndex,
);
const claimIndex = canvasBoardSource.indexOf(
  'patchMainWorkbenchCommand(commandEntry.id, { status: \'running\' });',
  pullIndex,
);

assert.ok(pullIndex >= 0, 'renderer command processing must pull remote commands');
assert.ok(
  bootstrapGateIndex > pullIndex,
  'renderer must re-check checkout bootstrap after the asynchronous remote pull',
);
assert.ok(
  claimIndex > bootstrapGateIndex,
  'renderer must leave commands pending until checkout bootstrap completes',
);

console.log('DEF Workbench checkout bootstrap command admission contract: PASS');
