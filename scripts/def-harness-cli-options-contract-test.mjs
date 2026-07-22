import assert from 'node:assert/strict';
import {
  parseDefHarnessCliArguments,
  readDefHarnessCliOption,
} from './def-harness-cli-options.mjs';

assert.equal(
  readDefHarnessCliOption(['--harness', 'candidate/spec9'], '--harness', {}),
  'candidate/spec9',
  'space-separated Harness selector is accepted',
);
assert.equal(
  readDefHarnessCliOption(['--harness=candidate/spec9'], '--harness', {}),
  'candidate/spec9',
  'equals-form Harness selector is accepted',
);
assert.equal(
  readDefHarnessCliOption([], '--harness', { npm_config_harness: 'candidate/windows' }),
  'candidate/windows',
  'npm_config_harness supplies the Windows npm fallback',
);
assert.equal(
  readDefHarnessCliOption([], '--harness', { NPM_CONFIG_HARNESS: 'candidate/windows-uppercase' }),
  'candidate/windows-uppercase',
  'npm config lookup is case-insensitive for Windows environments',
);
assert.equal(
  readDefHarnessCliOption(['--harness=stable'], '--harness', { npm_config_harness: 'candidate/windows' }),
  'stable',
  'an explicit selector wins over the npm fallback',
);
assert.equal(
  readDefHarnessCliOption(['--baseline', 'stable'], '--baseline', { npm_config_baseline: 'previousStable' }),
  'stable',
);
assert.equal(
  readDefHarnessCliOption(['--candidate=candidate/new'], '--candidate', { npm_config_candidate: 'candidate/old' }),
  'candidate/new',
);
assert.equal(readDefHarnessCliOption([], '--baseline', { npm_config_baseline: 'previousStable' }), 'previousStable');
assert.equal(readDefHarnessCliOption([], '--candidate', { npm_config_candidate: 'candidate/windows' }), 'candidate/windows');

const parsed = parseDefHarnessCliArguments(
  ['regress', '--baseline=stable', '--candidate', 'candidate/spec9'],
  {},
);
assert.equal(parsed.command, 'regress');
assert.deepEqual(parsed.args, ['--baseline=stable', '--candidate', 'candidate/spec9']);
assert.equal(parsed.option('--baseline'), 'stable');
assert.equal(parsed.option('--candidate'), 'candidate/spec9');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'space-separated-options',
    'equals-form-options',
    'windows-npm-config-fallback',
    'baseline-and-candidate-parity',
    'explicit-options-win',
    'parser-import-does-not-run-provider',
  ],
}));
