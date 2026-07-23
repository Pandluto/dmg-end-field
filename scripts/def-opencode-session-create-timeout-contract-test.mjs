import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requestJson } = require('../agent/runtime/def-opencode-adapter/index.cjs');
const adapterSource = fs.readFileSync(
  new URL('../agent/runtime/def-opencode-adapter/index.cjs', import.meta.url),
  'utf8',
);

assert.equal(typeof requestJson, 'function', 'the transport is callable with an injected short deadline');
assert.match(
  adapterSource,
  /const NATIVE_OPENCODE_FRESH_SESSION_CREATE_TIMEOUT_MS = 45000;/,
  'retained bootstrap and startup-lock evidence receive a bounded 45s fresh-create budget',
);
assert.equal(
  (adapterSource.match(/NATIVE_OPENCODE_FRESH_SESSION_CREATE_TIMEOUT_MS/g) || []).length,
  2,
  'the larger deadline is declared once and used only by native fresh-workspace creation',
);
assert.match(
  adapterSource,
  /function requestJson\(method, url, body, signal, timeoutMs = 60000\)/,
  'the generic request deadline is unchanged',
);
assert.match(
  adapterSource,
  /\/session\/\$\{encodeURIComponent\(session\.id\)\}\/message[\s\S]*?120000/,
  'the provider-turn request keeps its independent deadline',
);

const originalRequest = http.request;
let requestCount = 0;
let destroyedWith = null;

class CloseFirstRequest extends EventEmitter {
  write() {}

  end() {}

  destroy(error) {
    destroyedWith = error;
    // Reproduce the transport ordering that used to overwrite the timeout.
    this.emit('close');
    queueMicrotask(() => this.emit('error', error));
  }
}

try {
  http.request = () => {
    requestCount += 1;
    return new CloseFirstRequest();
  };
  const startedAt = Date.now();
  await assert.rejects(
    requestJson(
      'POST',
      'http://127.0.0.1:9/session?directory=fresh-workspace',
      { title: 'contract-only' },
      undefined,
      15,
    ),
    (error) => {
      assert.equal(error.code, 'OPENCODE_REQUEST_TIMEOUT');
      assert.equal(error.message, 'OpenCode request timeout');
      return true;
    },
  );
  assert(Date.now() - startedAt < 2000, 'the contract uses an injected short deadline without provider access');
  await new Promise((resolve) => setImmediate(resolve));
} finally {
  http.request = originalRequest;
}

assert.equal(requestCount, 1, 'a timed-out POST is never retried');
assert.equal(destroyedWith?.code, 'OPENCODE_REQUEST_TIMEOUT', 'the socket is destroyed with the same typed timeout');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'native-fresh-session-create-only-45s',
    'generic-and-provider-timeouts-unchanged',
    'injected-short-timeout-no-provider',
    'close-race-preserves-exact-timeout-code',
    'timed-out-post-not-retried',
  ],
}));
