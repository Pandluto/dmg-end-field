import {
  LEGACY_FILL_DOMAINS,
  canonicalLegacyFillJson,
  createLegacyFillReviewDigestPayload,
  digestLegacyFillValue,
  type LegacyFillDomain,
} from '../legacyFillCore/index.ts';

export const LEGACY_FILL_STORAGE_KEYS = Object.freeze({
  buff: { current: 'def.buff-editor.draft.v1', library: 'def.buff-editor.library.v1' },
  weapon: { current: 'def.weapon-sheet.draft.v1', library: 'def.weapon-sheet.library.v1' },
  operator: { current: 'def.operator-editor.draft.v1', library: 'def.operator-editor.library.v1' },
  equipment: { current: 'def.equipment-sheet.draft.v1', library: 'def.equipment-sheet.library.v1' },
}) satisfies Record<LegacyFillDomain, { current: string; library: string }>;

export interface LegacyFillHostDomainSnapshot {
  domain: LegacyFillDomain;
  schemaVersion: number;
  revision: number;
  contentHash: string;
  current: unknown;
  library: unknown;
}

export interface LegacyFillSnapshotV1 {
  contract: 'LegacyFillSnapshotV1';
  snapshotId: string;
  publishedAt: string;
  domains: Record<LegacyFillDomain, LegacyFillHostDomainSnapshot>;
}

interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ReviewedProposal {
  proposalId: string;
  ownerNamespace: string;
  domain: LegacyFillDomain;
  revision: number;
  manifestDigest: string;
  review: Record<string, unknown>;
  normalized: unknown;
  baseRevision: number;
  baseContentHash: string;
  approvalStatus?: 'Wait' | 'Yes' | 'No';
}

export interface LegacyFillHostGatewayOptions {
  storage: BrowserStorageLike;
  now?: () => Date;
  makeId?: () => string;
  emit?: (event: { type: string; detail: unknown }) => void;
}

function readJson(storage: BrowserStorageLike, key: string, fallback: unknown) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function proposalTarget(domain: LegacyFillDomain, payload: unknown): string {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (domain === 'equipment') {
    const gearSets = record.gearSets && typeof record.gearSets === 'object' && !Array.isArray(record.gearSets)
      ? record.gearSets as Record<string, unknown>
      : {};
    return Object.keys(gearSets).sort().join('|');
  }
  return typeof record.id === 'string' ? record.id : '';
}

function mergeLibrary(domain: LegacyFillDomain, previous: unknown, payload: unknown): unknown {
  const previousRecord = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
  const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (domain === 'equipment') {
    const oldGearSets = previousRecord.gearSets && typeof previousRecord.gearSets === 'object' && !Array.isArray(previousRecord.gearSets)
      ? previousRecord.gearSets as Record<string, unknown>
      : {};
    const newGearSets = payloadRecord.gearSets && typeof payloadRecord.gearSets === 'object' && !Array.isArray(payloadRecord.gearSets)
      ? payloadRecord.gearSets as Record<string, unknown>
      : {};
    if (!Object.keys(newGearSets).length) throw new TypeError('equipment proposal requires at least one gear set target');
    return { ...previousRecord, ...payloadRecord, gearSets: { ...oldGearSets, ...newGearSets } };
  }
  const id = proposalTarget(domain, payload);
  if (!id) throw new TypeError(`${domain} proposal requires one id target`);
  return { ...previousRecord, [id]: payload };
}

export function createLegacyFillBrowserHostGateway(options: LegacyFillHostGatewayOptions) {
  const { storage } = options;
  const now = options.now || (() => new Date());
  const makeId = options.makeId || (() => globalThis.crypto.randomUUID());
  const emit = options.emit || (() => undefined);
  const authority = Object.freeze({ type: 'LegacyFillHostAuthority' });
  const revisions = new Map<LegacyFillDomain, { revision: number; contentHash: string }>();
  const reviews = new Map<string, { reviewSessionId: string; decision: 'pending' | 'approved' | 'rejected'; proposalRevision: number; manifestDigest: string }>();
  let invalidationEpoch = 0;

  async function readDomain(domain: LegacyFillDomain): Promise<LegacyFillHostDomainSnapshot> {
    const keys = LEGACY_FILL_STORAGE_KEYS[domain];
    const current = readJson(storage, keys.current, domain === 'equipment' ? { schemaVersion: 1, gearSets: {} } : null);
    const library = readJson(storage, keys.library, domain === 'equipment' ? { schemaVersion: 1, gearSets: {} } : {});
    const contentHash = await digestLegacyFillValue({ domain, schemaVersion: 1, current, library, invalidationEpoch });
    const previous = revisions.get(domain);
    const revision = previous ? previous.revision + Number(previous.contentHash !== contentHash) : 1;
    revisions.set(domain, { revision, contentHash });
    return { domain, schemaVersion: 1, revision, contentHash, current, library };
  }

  async function publishSnapshot(): Promise<LegacyFillSnapshotV1> {
    const entries = await Promise.all(LEGACY_FILL_DOMAINS.map(async (domain) => [domain, await readDomain(domain)] as const));
    const domains = Object.fromEntries(entries) as Record<LegacyFillDomain, LegacyFillHostDomainSnapshot>;
    const identity = await digestLegacyFillValue(Object.fromEntries(entries.map(([domain, value]) => [domain, {
      revision: value.revision, contentHash: value.contentHash, schemaVersion: value.schemaVersion,
    }])));
    const snapshot = {
      contract: 'LegacyFillSnapshotV1' as const,
      snapshotId: `legacy-fill-snapshot-${identity.slice('sha256:'.length, 'sha256:'.length + 24)}`,
      publishedAt: now().toISOString(),
      domains,
    };
    emit({ type: 'legacy-fill.snapshot.published', detail: snapshot });
    return snapshot;
  }

  function requireAuthority(candidate: unknown) {
    if (candidate !== authority) throw new TypeError('legacy fill Host authority required');
  }

  function claimProposal(candidate: unknown, proposal: ReviewedProposal, suppliedReviewSessionId?: string) {
    requireAuthority(candidate);
    const reviewSessionId = suppliedReviewSessionId || `legacy-fill-review-${makeId()}`;
    reviews.set(proposal.proposalId, {
      reviewSessionId, decision: proposal.approvalStatus === 'Yes' ? 'approved' : 'pending', proposalRevision: proposal.revision, manifestDigest: proposal.manifestDigest,
    });
    return { reviewSessionId, proposalId: proposal.proposalId, proposalRevision: proposal.revision };
  }

  function recordDecision(candidate: unknown, input: {
    proposalId: string;
    reviewSessionId: string;
    decision: 'approved' | 'rejected';
    proposalRevision?: number;
    manifestDigest?: string;
  }) {
    requireAuthority(candidate);
    const review = reviews.get(input.proposalId);
    const canRevokeApproval = review?.decision === 'approved' && input.decision === 'rejected';
    if (!review || review.reviewSessionId !== input.reviewSessionId || (review.decision !== 'pending' && !canRevokeApproval)) throw new TypeError('stale or unknown legacy fill review session');
    review.decision = input.decision;
    if (input.proposalRevision !== undefined) review.proposalRevision = input.proposalRevision;
    if (input.manifestDigest !== undefined) review.manifestDigest = input.manifestDigest;
    return { ...review, proposalId: input.proposalId };
  }

  function bindApprovedRevision(candidate: unknown, input: { proposalId: string; reviewSessionId: string; proposalRevision: number; manifestDigest: string }) {
    requireAuthority(candidate);
    const review = reviews.get(input.proposalId);
    if (!review || review.reviewSessionId !== input.reviewSessionId || review.decision !== 'approved') throw new TypeError('approved legacy fill review session required');
    review.proposalRevision = input.proposalRevision;
    review.manifestDigest = input.manifestDigest;
    return { ...review, proposalId: input.proposalId };
  }

  async function applyReviewedProposal(candidate: unknown, input: {
    proposal: ReviewedProposal;
    reviewSessionId: string;
    expectedRevision: number;
    expectedManifestDigest: string;
  }) {
    requireAuthority(candidate);
    const { proposal } = input;
    const reviewState = reviews.get(proposal.proposalId);
    if (!reviewState || reviewState.reviewSessionId !== input.reviewSessionId || reviewState.decision !== 'approved') {
      return { ok: false, code: 'host-review-not-approved' };
    }
    if (reviewState.proposalRevision !== input.expectedRevision || proposal.revision !== input.expectedRevision) {
      return { ok: false, code: 'proposal-revision-conflict' };
    }
    if (reviewState.manifestDigest !== input.expectedManifestDigest || proposal.manifestDigest !== input.expectedManifestDigest) {
      return { ok: false, code: 'proposal-manifest-digest-mismatch' };
    }
    const { manifestDigest: embeddedDigest } = proposal.review;
    if ((embeddedDigest !== undefined && embeddedDigest !== proposal.manifestDigest)
      || await digestLegacyFillValue(embeddedDigest === undefined ? proposal.review : createLegacyFillReviewDigestPayload(proposal.review)) !== proposal.manifestDigest) {
      return { ok: false, code: 'proposal-manifest-digest-invalid' };
    }
    const currentSnapshot = await readDomain(proposal.domain);
    if (currentSnapshot.revision !== proposal.baseRevision || currentSnapshot.contentHash !== proposal.baseContentHash) {
      return { ok: false, code: 'proposal-base-stale' };
    }
    const target = proposal.review.target && typeof proposal.review.target === 'object' ? proposal.review.target as Record<string, unknown> : {};
    const expectedTarget = typeof target.id === 'string' ? target.id : typeof proposal.review.targetId === 'string' ? proposal.review.targetId : '';
    if (!expectedTarget || proposalTarget(proposal.domain, proposal.normalized) !== expectedTarget) {
      return { ok: false, code: 'proposal-target-mismatch' };
    }
    const keys = LEGACY_FILL_STORAGE_KEYS[proposal.domain];
    const previousLibraryRaw = storage.getItem(keys.library);
    const previousCurrentRaw = storage.getItem(keys.current);
    try {
      const nextLibrary = mergeLibrary(proposal.domain, currentSnapshot.library, proposal.normalized);
      storage.setItem(keys.library, canonicalLegacyFillJson(nextLibrary));
      storage.setItem(keys.current, canonicalLegacyFillJson(proposal.domain === 'equipment' ? nextLibrary : proposal.normalized));
      const rereadLibrary = readJson(storage, keys.library, null);
      const rereadCurrent = readJson(storage, keys.current, null);
      if (canonicalLegacyFillJson(rereadLibrary) !== canonicalLegacyFillJson(nextLibrary)
        || canonicalLegacyFillJson(rereadCurrent) !== canonicalLegacyFillJson(proposal.domain === 'equipment' ? nextLibrary : proposal.normalized)) {
        throw new Error('legacy fill postcondition mismatch');
      }
      reviewState.decision = 'rejected';
      const snapshot = await publishSnapshot();
      emit({ type: 'legacy-fill.library.changed', detail: { domain: proposal.domain, proposalId: proposal.proposalId, snapshot } });
      return { ok: true, snapshot, targetId: expectedTarget };
    } catch (error) {
      let rollbackError = '';
      try {
        if (previousLibraryRaw === null) storage.removeItem(keys.library); else storage.setItem(keys.library, previousLibraryRaw);
        if (previousCurrentRaw === null) storage.removeItem(keys.current); else storage.setItem(keys.current, previousCurrentRaw);
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure);
      }
      return {
        ok: false,
        code: rollbackError ? 'host-write-rollback-failed' : 'host-write-postcondition-failed',
        error: error instanceof Error ? error.message : String(error),
        ...(rollbackError ? { rollbackError } : {}),
      };
    }
  }

  function invalidateForNowStorageForceApply(candidate: unknown, reason = 'now-storage forceApply completed') {
    requireAuthority(candidate);
    invalidationEpoch += 1;
    emit({ type: 'legacy-fill.snapshot.invalidated', detail: { reason, invalidationEpoch } });
    return { invalidationEpoch, reason };
  }

  return Object.freeze({
    publishSnapshot,
    internal: Object.freeze({ authority, claimProposal, recordDecision, bindApprovedRevision, applyReviewedProposal, invalidateForNowStorageForceApply }),
  });
}
