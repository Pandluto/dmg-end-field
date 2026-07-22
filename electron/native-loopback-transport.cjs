const http = require('http');

/**
 * Send a native-host request to the private REST sidecar without traversing
 * Chromium's default session.  The default session is deliberately allowed
 * to use proxy and request-interception policy for user-facing traffic; an
 * already-authorized loopback hop must not depend on either of those paths.
 */
function fetchNativeLoopbackUrl(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1') {
      reject(new Error(`Native loopback transport requires an http://127.0.0.1 target: ${targetUrl}`));
      return;
    }

    const request = http.request(parsedUrl, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'dmg-end-field-native-loopback',
        Accept: 'application/json, */*;q=0.8',
        ...(options.headers || {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          url: parsedUrl.toString(),
        });
      });
    });

    request.on('error', reject);
    const timeoutMs = options.timeoutMs || 10000;
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`request timeout after ${timeoutMs}ms: ${targetUrl}`));
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON-compatible companion for the bridge's fetchJson/postJson callbacks.
 * It preserves their { status, body } result shape while keeping the request
 * on the fixed native loopback transport.
 */
async function requestNativeLoopbackJson(targetUrl, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const hasJson = Object.prototype.hasOwnProperty.call(options, 'json');
  const body = hasJson ? JSON.stringify(options.json) : undefined;
  const headers = {
    ...(options.headers || {}),
    ...(body === undefined ? {} : {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    }),
  };
  const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : 1;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchNativeLoopbackUrl(targetUrl, {
        method,
        headers,
        body,
        timeoutMs: options.timeoutMs,
      });
      if (response.statusCode >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.statusCode}`);
        await delay(500 * (attempt + 1));
        continue;
      }
      return {
        status: response.statusCode,
        body: JSON.parse(response.body.toString('utf8') || '{}'),
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(500 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError || new Error(`request failed: ${targetUrl}`);
}

module.exports = {
  fetchNativeLoopbackUrl,
  requestNativeLoopbackJson,
};
