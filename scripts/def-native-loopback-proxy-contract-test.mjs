import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fetchNativeLoopbackUrl, requestNativeLoopbackJson } = require('../electron/native-loopback-transport.cjs');
const mainSource = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const proxyStart = mainSource.indexOf('async function proxyMainWorkbenchRendererTransport');
const proxyEnd = mainSource.indexOf('function normalizeMcpFillWebActionBinding', proxyStart);
const proxySource = mainSource.slice(proxyStart, proxyEnd);

assert(proxyStart >= 0 && proxyEnd > proxyStart, 'main Workbench renderer proxy must remain present');
assert.match(proxySource, /await fetchNativeLoopbackUrl\(upstreamUrl, \{/,
  'authorized Workbench proxy traffic must use the dedicated native loopback transport');
assert.doesNotMatch(proxySource, /fetchUrlRawWithRetry\(upstreamUrl/,
  'the private Workbench hop must not re-enter Chromium fetch through the generic helper');
assert.match(mainSource, /fetchJson: fetchInteropJson,[\s\S]*postJson: postInteropJson,/,
  'Interop must use the protected-loopback-aware JSON callbacks');
const interopStart = mainSource.indexOf('async function fetchInteropJson');
const interopEnd = mainSource.indexOf('const defCodexInterop =', interopStart);
const interopSource = mainSource.slice(interopStart, interopEnd);
const protectionStart = mainSource.indexOf('function isProtectedInteropLoopbackRequest');
const protectionEnd = mainSource.indexOf('function buildInteropRequestOptions', protectionStart);
const protectionSource = mainSource.slice(protectionStart, protectionEnd);
assert.match(interopSource, /isProtectedInteropLoopbackRequest\(url, requestOptions\.headers\)[\s\S]*requestNativeLoopbackJson/,
  'a valid internal authority must select native loopback for Interop JSON requests');
assert.match(protectionSource, /target\.hostname === '127\.0\.0\.1'[\s\S]*target\.port === '17321'/,
  'only the fixed AI REST loopback may receive this protected transport');

const expectedToken = 'native-loopback-contract-capability';
const received = [];
const server = http.createServer((request, response) => {
  const receivedToken = typeof request.headers['x-def-internal-token'] === 'string'
    ? request.headers['x-def-internal-token']
    : '';
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const requestBody = Buffer.concat(chunks).toString('utf8');
    received.push({ method: request.method, url: request.url, token: receivedToken, body: requestBody });
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
      }, 80);
      return;
    }
    if (request.url === '/invalid-json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{');
      return;
    }
    if (request.url !== '/api/main-workbench/snapshot' || receivedToken !== expectedToken) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    response.writeHead(request.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, snapshot: { marker: request.method === 'POST' ? 'native-loopback-post' : 'native-loopback' } }));
  });
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
  assert.equal(received.at(-1).token, expectedToken, 'the renderer proxy authority header must reach the sidecar unchanged');

  const interopGet = await requestNativeLoopbackJson(target, {
    headers: { 'x-def-internal-token': expectedToken }, timeoutMs: 1000, retries: 0,
  });
  assert.equal(interopGet.status, 200);
  assert.equal(interopGet.body.snapshot.marker, 'native-loopback');
  assert.equal(received.at(-1).token, expectedToken, 'the Interop snapshot authority header must reach the sidecar unchanged');

  const interopPost = await requestNativeLoopbackJson(target, {
    method: 'POST', json: { marker: 'interop-post' }, headers: { 'x-def-internal-token': expectedToken }, timeoutMs: 1000, retries: 0,
  });
  assert.equal(interopPost.status, 201);
  assert.equal(interopPost.body.snapshot.marker, 'native-loopback-post');
  assert.equal(received.at(-1).token, expectedToken, 'the Interop POST authority header must reach the sidecar unchanged');
  assert.deepEqual(JSON.parse(received.at(-1).body), { marker: 'interop-post' });

  const denied = await fetchNativeLoopbackUrl(target);
  assert.equal(denied.statusCode, 401, 'a missing native authority header must stay denied');
  await assert.rejects(
    requestNativeLoopbackJson(`http://127.0.0.1:${address.port}/slow`, { timeoutMs: 10, retries: 0 }),
    /request timeout after 10ms/,
    'native Interop JSON calls must preserve a bounded timeout',
  );
  await assert.rejects(
    requestNativeLoopbackJson(`http://127.0.0.1:${address.port}/invalid-json`, { timeoutMs: 1000, retries: 0 }),
    SyntaxError,
    'native Interop JSON calls must preserve JSON parse failures',
  );
  await assert.rejects(
    fetchNativeLoopbackUrl(`http://localhost:${address.port}/api/main-workbench/snapshot`),
    /requires an http:\/\/127\.0\.0\.1 target/,
    'the helper must not become a general network transport',
  );

  console.log('DEF native loopback proxy contract: PASS (authority header reaches the fixed sidecar and remains required)');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
