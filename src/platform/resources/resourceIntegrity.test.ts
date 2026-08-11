import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from './resourceIntegrity';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const bytes = new TextEncoder().encode('server resources work on domestic HTTP mobile');
const expected = createHash('sha256').update(bytes).digest('hex');

try {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  });
  assert.equal(await sha256Hex(bytes), expected);
} finally {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
}

console.log('SHA-256 insecure-context fallback contract: PASS');
