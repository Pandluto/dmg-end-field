import assert from 'node:assert/strict';
import {
  getAppHostExtension,
  installAppHostExtension,
  resetAppHostExtensionForTests,
} from './appHost';

resetAppHostExtensionForTests();
assert.equal(getAppHostExtension().id, 'web');
assert.equal(getAppHostExtension().workspace?.skipAccessGate, false);
assert.equal(getAppHostExtension().ui?.showPageVersionUpdate, true);

const restore = installAppHostExtension({
  id: 'contract-host',
  workspace: {
    skipAccessGate: true,
    requestControlWhenSecondary: true,
  },
  routes: {
    isWorkspacePath: (path) => path === '/optional-workspace',
  },
});

assert.equal(getAppHostExtension().id, 'contract-host');
assert.equal(getAppHostExtension().workspace?.skipAccessGate, true);
assert.equal(getAppHostExtension().workspace?.requestControlWhenSecondary, true);
assert.equal(getAppHostExtension().ui?.showAccessSettings, true, 'unspecified Web defaults remain enabled');
assert.equal(getAppHostExtension().ui?.showLocalResourcePackager, true);
assert.equal(getAppHostExtension().routes?.isWorkspacePath?.('/optional-workspace'), true);

restore();
assert.equal(getAppHostExtension().id, 'web');
assert.throws(() => installAppHostExtension({ id: ' ' }), /non-empty id/);

console.log('App host extension contract: PASS');
