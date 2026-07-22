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

module.exports = {
  fetchNativeLoopbackUrl,
};
