import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  canonicalJson,
  type ApprovalCapabilityClaims,
  type ApprovalCapabilityVerificationKey,
  type JsonValue,
  isApprovalCapabilityClaimsShape,
} from '../core/contracts/index.ts';

const TOKEN_VERSION = 'v1';
const PORTABLE_EPOCH = /^[A-Za-z0-9_-]{16,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface ApprovalCapabilitySignerOptions {
  readonly keyEpoch?: string;
  readonly privateKey?: KeyObject;
  readonly publicKey?: KeyObject;
}
export class ApprovalCapabilitySigner {
  readonly #privateKey: KeyObject;
  readonly verificationKey: ApprovalCapabilityVerificationKey;

  constructor(options: ApprovalCapabilitySignerOptions = {}) {
    const keyEpoch = options.keyEpoch ?? `approval-${randomBytes(18).toString('base64url')}`;
    if (!PORTABLE_EPOCH.test(keyEpoch)) throw new TypeError('Approval keyEpoch is invalid');
    if (Boolean(options.privateKey) !== Boolean(options.publicKey)) {
      throw new TypeError('Approval signer requires both privateKey and publicKey');
    }
    const pair = options.privateKey && options.publicKey
      ? { privateKey: options.privateKey, publicKey: options.publicKey }
      : generateKeyPairSync('ed25519');
    if (pair.privateKey.asymmetricKeyType !== 'ed25519' || pair.publicKey.asymmetricKeyType !== 'ed25519') {
      throw new TypeError('Approval signer requires an Ed25519 key pair');
    }
    this.#privateKey = pair.privateKey;
    this.verificationKey = Object.freeze({
      algorithm: 'Ed25519',
      keyEpoch,
      publicKeySpki: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    });
  }

  sign(claims: ApprovalCapabilityClaims): string {
    if (!isApprovalCapabilityClaimsShape(claims)) {
      throw new TypeError('Approval claims are malformed');
    }
    if (claims.keyEpoch !== this.verificationKey.keyEpoch) {
      throw new TypeError('Approval claims keyEpoch does not match the signing key');
    }
    const payload = canonicalJson(claims as unknown as JsonValue);
    const payloadSegment = Buffer.from(payload, 'utf8').toString('base64url');
    const signingInput = Buffer.from(`${TOKEN_VERSION}.${payloadSegment}`, 'ascii');
    const signature = sign(null, signingInput, this.#privateKey).toString('base64url');
    return `${TOKEN_VERSION}.${payloadSegment}.${signature}`;
  }
}

export function verifyApprovalCapabilityToken(
  token: string,
  descriptor: ApprovalCapabilityVerificationKey,
): ApprovalCapabilityClaims {
  if (
    descriptor.algorithm !== 'Ed25519'
    || !PORTABLE_EPOCH.test(descriptor.keyEpoch)
    || !BASE64URL.test(descriptor.publicKeySpki)
  ) throw new TypeError('Approval verification key is invalid');
  const segments = token.split('.');
  if (
    segments.length !== 3
    || segments[0] !== TOKEN_VERSION
    || !BASE64URL.test(segments[1] ?? '')
    || !BASE64URL.test(segments[2] ?? '')
  ) throw new TypeError('Approval capability token is invalid');
  const signingInput = Buffer.from(`${TOKEN_VERSION}.${segments[1]}`, 'ascii');
  const publicKey = createPublicKey({
    key: Buffer.from(descriptor.publicKeySpki, 'base64url'),
    type: 'spki',
    format: 'der',
  });
  if (!verify(null, signingInput, publicKey, Buffer.from(segments[2]!, 'base64url'))) {
    throw new TypeError('Approval capability signature is invalid');
  }
  const payload = Buffer.from(segments[1]!, 'base64url').toString('utf8');
  const claims = JSON.parse(payload) as unknown;
  if (
    !isApprovalCapabilityClaimsShape(claims)
    || canonicalJson(claims as unknown as JsonValue) !== payload
    || claims.keyEpoch !== descriptor.keyEpoch
  ) throw new TypeError('Approval capability payload is not canonical or belongs to another key');
  return claims;
}
