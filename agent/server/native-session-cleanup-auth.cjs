const crypto = require('crypto');

function readHeader(request, name) {
  const value = request?.headers?.[name];
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : '';
}

/**
 * The native session cleanup endpoint is a destructive private sidecar
 * operation.  Compare fixed-length digests so a malformed, missing, or
 * incorrect header never reaches a length-dependent token comparison.
 */
function isAuthorizedNativeSessionCleanupRequest(request, expectedToken) {
  const actualToken = readHeader(request, 'x-def-internal-token');
  const actualDigest = crypto.createHash('sha256').update(actualToken, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(
    typeof expectedToken === 'string' ? expectedToken : '',
    'utf8',
  ).digest();
  return Boolean(actualToken)
    && Boolean(expectedToken)
    && crypto.timingSafeEqual(actualDigest, expectedDigest);
}

module.exports = {
  isAuthorizedNativeSessionCleanupRequest,
};
