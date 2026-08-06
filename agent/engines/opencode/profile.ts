import { lstat, readFile } from 'node:fs/promises';
import { OpenCodeEngineError } from './errors.ts';

export const OPENCODE_PROVIDER_PROFILE_SCHEMA_VERSION = 1 as const;

export interface OpenCodeProviderProfile {
  readonly ref: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
  readonly contextLimit?: number;
  readonly outputLimit?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface OpenCodeProviderProfileSource {
  getProfile(ref: string): Promise<OpenCodeProviderProfile | null>;
}

export class FileOpenCodeProviderProfileSource implements OpenCodeProviderProfileSource {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async getProfile(ref: string): Promise<OpenCodeProviderProfile | null> {
    let text: string;
    try {
      const info = await lstat(this.#filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 262_144) {
        throw new OpenCodeEngineError('OPENCODE_PROFILE_INVALID', 'OpenCode provider profile must be a bounded regular file');
      }
      if (process.platform !== 'win32') {
        const currentUid = process.getuid?.();
        if ((currentUid !== undefined && info.uid !== currentUid) || (info.mode & 0o077) !== 0) {
          throw new OpenCodeEngineError(
            'OPENCODE_PROFILE_INVALID',
            'OpenCode provider profile must be owned by the current user with mode 0600',
          );
        }
      }
      text = await readFile(this.#filePath, 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null;
      if (error instanceof OpenCodeEngineError) throw error;
      throw new OpenCodeEngineError(
        'OPENCODE_PROFILE_INVALID',
        'OpenCode provider profile file cannot be read',
      );
    }
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      throw new OpenCodeEngineError('OPENCODE_PROFILE_INVALID', 'OpenCode provider profile file is not valid JSON');
    }
    const profiles = parseProfileDocument(document);
    return profiles.find((profile) => profile.ref === ref) ?? null;
  }
}

export class InMemoryOpenCodeProviderProfileSource implements OpenCodeProviderProfileSource {
  readonly #profiles: ReadonlyMap<string, OpenCodeProviderProfile>;

  constructor(profiles: readonly OpenCodeProviderProfile[]) {
    this.#profiles = new Map(profiles.map((profile) => {
      const parsed = parseProfile(profile, 'profile');
      return [parsed.ref, parsed];
    }));
  }

  async getProfile(ref: string): Promise<OpenCodeProviderProfile | null> {
    return this.#profiles.get(ref) ?? null;
  }
}

function parseProfileDocument(value: unknown): readonly OpenCodeProviderProfile[] {
  const document = expectRecord(value, 'profile document');
  const keys = Object.keys(document).sort();
  if (keys.length !== 2 || keys[0] !== 'profiles' || keys[1] !== 'schemaVersion') {
    throw invalid('profile document fields are invalid');
  }
  if (document.schemaVersion !== OPENCODE_PROVIDER_PROFILE_SCHEMA_VERSION) {
    throw new OpenCodeEngineError(
      'OPENCODE_PROFILE_INVALID',
      `OpenCode provider profile schema must be ${OPENCODE_PROVIDER_PROFILE_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(document.profiles)) {
    throw new OpenCodeEngineError('OPENCODE_PROFILE_INVALID', 'OpenCode provider profiles must be an array');
  }
  const profiles = document.profiles.map((profile, index) => parseProfile(profile, `profiles[${index}]`));
  if (new Set(profiles.map((profile) => profile.ref)).size !== profiles.length) {
    throw new OpenCodeEngineError('OPENCODE_PROFILE_INVALID', 'OpenCode provider profile refs must be unique');
  }
  return profiles;
}

function parseProfile(value: unknown, label: string): OpenCodeProviderProfile {
  const profile = expectRecord(value, label);
  const known = new Set([
    'ref', 'providerId', 'displayName', 'baseUrl', 'modelId', 'apiKey',
    'contextLimit', 'outputLimit', 'headers',
  ]);
  for (const key of Object.keys(profile)) {
    if (!known.has(key)) throw invalid(`${label}.${key} is not supported`);
  }
  const baseUrl = requiredString(profile.baseUrl, `${label}.baseUrl`).replace(/\/+$/u, '');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw invalid(`${label}.baseUrl is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw invalid(`${label}.baseUrl must be an HTTP(S) URL without embedded credentials`);
  }
  if (parsedUrl.protocol === 'http:' && !isExactLoopback(parsedUrl.hostname)) {
    throw invalid(`${label}.baseUrl must use HTTPS unless it is an exact loopback address`);
  }
  return Object.freeze({
    ref: requiredIdentifier(profile.ref, `${label}.ref`),
    providerId: requiredIdentifier(profile.providerId, `${label}.providerId`),
    displayName: requiredString(profile.displayName, `${label}.displayName`),
    baseUrl,
    modelId: requiredString(profile.modelId, `${label}.modelId`),
    apiKey: requiredString(profile.apiKey, `${label}.apiKey`),
    ...(profile.contextLimit === undefined
      ? {}
      : { contextLimit: positiveInteger(profile.contextLimit, `${label}.contextLimit`) }),
    ...(profile.outputLimit === undefined
      ? {}
      : { outputLimit: positiveInteger(profile.outputLimit, `${label}.outputLimit`) }),
    ...(profile.headers === undefined ? {} : { headers: stringRecord(profile.headers, `${label}.headers`) }),
  });
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${label} must be a non-empty string`);
  if (value.length > 4_096) throw invalid(`${label} is too long`);
  return value.trim();
}

function requiredIdentifier(value: unknown, label: string): string {
  const parsed = requiredString(value, label);
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(parsed)) throw invalid(`${label} is not a portable identifier`);
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw invalid(`${label} must be a positive integer`);
  return Number(value);
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  const record = expectRecord(value, label);
  if (Object.keys(record).length > 16) throw invalid(`${label} contains too many headers`);
  const output: Record<string, string> = {};
  const seen = new Set<string>();
  let totalBytes = 0;
  const blocked = new Set([
    'authorization', 'connection', 'content-length', 'content-type', 'cookie', 'host',
    'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  ]);
  for (const [key, item] of Object.entries(record)) {
    const normalized = key.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(key)
      || blocked.has(normalized)
      || seen.has(normalized)
      || typeof item !== 'string'
      || item.length > 4_096
      || /[\r\n]/u.test(item)
    ) {
      throw invalid(`${label} must contain bounded string headers`);
    }
    seen.add(normalized);
    totalBytes += Buffer.byteLength(key) + Buffer.byteLength(item);
    if (totalBytes > 16_384) throw invalid(`${label} is too large`);
    output[key] = item;
  }
  return Object.freeze(output);
}

function isExactLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]';
}

function invalid(message: string): OpenCodeEngineError {
  return new OpenCodeEngineError('OPENCODE_PROFILE_INVALID', message);
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
