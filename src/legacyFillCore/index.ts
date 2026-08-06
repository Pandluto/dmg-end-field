export const LEGACY_FILL_DOMAINS = ['buff', 'weapon', 'operator', 'equipment'] as const;

export type LegacyFillDomain = (typeof LEGACY_FILL_DOMAINS)[number];

export interface LegacyFillValidationResult<T = unknown> {
  ok: boolean;
  errors: string[];
  warnings?: string[];
  normalized?: T;
}

export interface LegacyFillDomainPort<T = unknown> {
  domain: LegacyFillDomain;
  schemaVersion: number;
  schema(): Readonly<Record<string, unknown>>;
  normalize(candidate: unknown): T;
  validate(candidate: unknown): LegacyFillValidationResult<T>;
  summarize(payload: T): string;
  targetId(payload: T): string;
}

export interface LegacyFillSnapshotPort<T = unknown> {
  readCurrent(domain: LegacyFillDomain): Promise<T | null>;
  readLibrary(domain: LegacyFillDomain): Promise<Readonly<Record<string, T>>>;
}

export interface LegacyFillProposalPort<T = unknown> {
  create(input: LegacyFillProposalCreateInput<T>): Promise<LegacyFillProposalManifest<T>>;
  list(ownerNamespace: string): Promise<ReadonlyArray<LegacyFillProposalManifest<T>>>;
  inspect(ownerNamespace: string, proposalId: string): Promise<LegacyFillProposalManifest<T> | null>;
}

export interface LegacyFillHostPort<T = unknown> extends LegacyFillSnapshotPort<T> {
  applyReviewedProposal(input: {
    ownerNamespace: string;
    proposalId: string;
    expectedRevision: number;
    expectedManifestDigest: string;
  }): Promise<{ ok: boolean; revision?: number; error?: string }>;
}

export interface LegacyFillProposalCreateInput<T = unknown> {
  ownerNamespace: string;
  proposalId: string;
  domain: LegacyFillDomain;
  baseIdentity: string;
  baseRevision: string;
  schemaVersion: number;
  normalized: T;
  summary: string;
  createdAt: string;
}

export interface LegacyFillReviewManifest {
  domain: LegacyFillDomain;
  targetId: string;
  summary: string;
  baseIdentity: string;
  baseRevision: string;
  schemaVersion: number;
  payloadDigest: string;
}

export interface LegacyFillProposalManifest<T = unknown> extends LegacyFillProposalCreateInput<T> {
  revision: number;
  manifestDigest: string;
  review: LegacyFillReviewManifest;
  approvalStatus: 'Wait' | 'Yes' | 'No';
  saveStatus: 'Wait' | 'Yes' | 'No';
}

export function canonicalizeLegacyFillValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeLegacyFillValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeLegacyFillValue(entry)]),
  );
}

export function canonicalLegacyFillJson(value: unknown): string {
  return JSON.stringify(canonicalizeLegacyFillValue(value));
}

export async function digestLegacyFillValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalLegacyFillJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createLegacyFillReviewDigestPayload(manifest: Record<string, unknown>): Record<string, unknown> {
  return {
    manifestVersion: manifest.manifestVersion,
    domain: manifest.domain,
    operation: manifest.operation,
    schemaVersion: manifest.schemaVersion,
    baseSnapshot: manifest.baseSnapshot,
    target: manifest.target,
    intent: manifest.intent,
    summary: manifest.summary,
    normalizedDraft: manifest.normalizedDraft,
    diff: manifest.diff,
    validation: manifest.validation,
    evidence: manifest.evidence,
    requestedWrites: manifest.requestedWrites,
  };
}

export function createLegacyFillDomainCore<T>(definition: LegacyFillDomainPort<T>): LegacyFillDomainPort<T> {
  if (!LEGACY_FILL_DOMAINS.includes(definition.domain)) throw new TypeError(`Unsupported legacy fill domain: ${definition.domain}`);
  if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1) throw new TypeError('schemaVersion must be a positive integer');
  for (const method of ['schema', 'normalize', 'validate', 'summarize', 'targetId'] as const) {
    if (typeof definition[method] !== 'function') throw new TypeError(`Legacy fill domain requires ${method}`);
  }
  return Object.freeze({ ...definition });
}

export function createLegacyFillProposalPayload<T>(input: {
  rawCommand: string;
  normalized: T;
  summary: string;
}): { rawCommand: string; normalized: T; summary: string } {
  return {
    rawCommand: input.rawCommand,
    normalized: input.normalized,
    summary: input.summary,
  };
}

export async function createLegacyFillProposalManifest<T>(input: LegacyFillProposalCreateInput<T> & {
  targetId: string;
}): Promise<LegacyFillProposalManifest<T>> {
  const payloadDigest = await digestLegacyFillValue(input.normalized);
  const review: LegacyFillReviewManifest = {
    domain: input.domain,
    targetId: input.targetId,
    summary: input.summary,
    baseIdentity: input.baseIdentity,
    baseRevision: input.baseRevision,
    schemaVersion: input.schemaVersion,
    payloadDigest,
  };
  return {
    ownerNamespace: input.ownerNamespace,
    proposalId: input.proposalId,
    domain: input.domain,
    baseIdentity: input.baseIdentity,
    baseRevision: input.baseRevision,
    schemaVersion: input.schemaVersion,
    normalized: input.normalized,
    summary: input.summary,
    createdAt: input.createdAt,
    revision: 1,
    manifestDigest: await digestLegacyFillValue(review),
    review,
    approvalStatus: 'Wait',
    saveStatus: 'Wait',
  };
}

export function createLegacyFillSchemaTemplate(input: {
  domain: LegacyFillDomain;
  schemaVersion: number;
  payloadSchema: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contract: 'LegacyFillDomainSchemaV1',
    domain: input.domain,
    schemaVersion: input.schemaVersion,
    payload: input.payloadSchema,
  });
}
