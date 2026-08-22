'use strict';

const assert = require('node:assert/strict');
const {
  PROXY_PREFIX,
  createOfficialResourceProxyHandler,
  parseOfficialResourceProxyTarget,
} = require('./official-resource-proxy.cjs');

function responseRecorder() {
  return {
    statusCode: 0,
    headers: new Map(),
    body: Buffer.alloc(0),
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), String(value));
    },
    end(value) {
      this.body = value ? Buffer.from(value) : Buffer.alloc(0);
    },
  };
}

async function main() {
assert.equal(parseOfficialResourceProxyTarget('/ordinary/path'), null);
assert.equal(
  parseOfficialResourceProxyTarget(`${PROXY_PREFIX}resources/stable.json?channel=123`)?.href,
  'https://dmgendfield.cloud/resources/stable.json?channel=123',
);
for (const invalid of [
  `${PROXY_PREFIX}assets/images/a.png`,
  `${PROXY_PREFIX}resources/%2e%2e/private`,
  `${PROXY_PREFIX}resources/a%2fb`,
  `${PROXY_PREFIX}resources/a b`,
  `${PROXY_PREFIX}resources/stable.json?url=https%3A%2F%2Fevil.example`,
]) {
  assert.throws(() => parseOfficialResourceProxyTarget(invalid));
}

let captured;
const handler = createOfficialResourceProxyHandler({
  async fetchImpl(target, options) {
    captured = { target: String(target), options };
    return new Response('{"releaseVersion":"test"}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-cache',
        'set-cookie': 'must-not-pass=1',
      },
    });
  },
});
const response = responseRecorder();
assert.equal(await handler({
  method: 'GET',
  url: `${PROXY_PREFIX}resources/stable.json?channel=1`,
  headers: { authorization: 'secret', cookie: 'private=1', 'if-none-match': 'etag-1' },
}, response), true);
assert.equal(response.statusCode, 200);
assert.equal(response.headers.get('content-type'), 'application/json');
assert.equal(response.headers.has('set-cookie'), false);
assert.equal(captured.target, 'https://dmgendfield.cloud/resources/stable.json?channel=1');
assert.equal(captured.options.headers.authorization, undefined);
assert.equal(captured.options.headers.cookie, undefined);
assert.equal(captured.options.headers['if-none-match'], 'etag-1');

const rejectedRedirect = createOfficialResourceProxyHandler({
  async fetchImpl() {
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/resources/a' } });
  },
});
const redirectResponse = responseRecorder();
await rejectedRedirect({
  method: 'GET',
  url: `${PROXY_PREFIX}resources/stable.json`,
  headers: {},
}, redirectResponse);
assert.equal(redirectResponse.statusCode, 502);

const methodResponse = responseRecorder();
await handler({
  method: 'POST',
  url: `${PROXY_PREFIX}resources/stable.json`,
  headers: {},
}, methodResponse);
assert.equal(methodResponse.statusCode, 405);
assert.equal(methodResponse.headers.get('allow'), 'GET, HEAD');

console.log('Desktop official resource proxy contract: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
