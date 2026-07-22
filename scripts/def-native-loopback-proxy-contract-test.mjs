import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fetchNativeLoopbackUrl } = require('../electron/native-loopback-transport.cjs');
const mainSource = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const proxyStart = mainSource.indexOf('async function proxyMainWorkbenchRendererTransport');
const proxyEnd = mainSource.indexOf('function normalizeMcpFillWebActionBinding', proxyStart);
const proxySource = mainSource.slice(proxyStart, proxyEnd);

assert(proxyStart >= 0 && proxyEnd > proxyStart, 'main Workbench renderer proxy must remain present');
assert.match(proxySource, /await fetchNativeLoopbackUrl\(upstreamUrl, \{/,
  'authorized Workbench proxy traffic must use the dedicated native loopback transport');
assert.doesNotMatch(proxySource, /fetchUrlRawWithRetry\(upstreamUrl/,
  'the private Workbench hop must not re-enter Chromium fetch through the generic helper');

const expectedToken = 'native-loopback-contract-capability';
let receivedToken = null;
const server = http.createServer((request, response) => {
  receivedToken = typeof request.headers['x-def-internal-token'] === 'string'
    ? request.headers['x-def-internal-token']
    : '';
  if (request.method !== 'GET' || request.url !== '/api/main-workbench/snapshot'
    || receivedToken !== expectedToken) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: true, snapshot: { marker: 'native-loopback' } }));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert(address && typeof address === 'object');
  const target = `http://127.0.0.1:${address.port}/api/main-workbench/snapshot`;
  const forwarded = await fetchNativeLoopbackUrl(target, {
    headers: { 'x-def-internal-token': expectedToken },
  });
  assert.equal(forwarded.statusCode, 200);
  assert.equal(JSON.parse(forwarded.body.toString('utf8')).snapshot.marker, 'native-loopback');
  assert.equal(receivedToken, expectedToken, 'the internal authority header must reach the sidecar unchanged');

  const denied = await fetchNativeLoopbackUrl(target);
  assert.equal(denied.statusCode, 401, 'a missing native authority header must stay denied');
  await assert.rejects(
    fetchNativeLoopbackUrl(`http://localhost:${address.port}/api/main-workbench/snapshot`),
    /requires an http:\/\/127\.0\.0\.1 target/,
    'the helper must not become a general network transport',
  );

  console.log('DEF native loopback proxy contract: PASS (authority header reaches the fixed sidecar and remains required)');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
