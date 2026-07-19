import { createLegacyFillBrowserHostGateway, LEGACY_FILL_STORAGE_KEYS, type ReviewedProposal } from './browserGateway';

type BrowserGateway = ReturnType<typeof createLegacyFillBrowserHostGateway>;
let gateway: BrowserGateway | null = null;

export interface LegacyFillReviewProposal extends ReviewedProposal {
  summary: string;
  lifecycleStatus: 'pending' | 'claimed' | 'approved' | 'rejected' | 'applied' | 'cancelled' | 'stale';
  approvalStatus: 'Wait' | 'Yes' | 'No';
  saveStatus: 'Wait' | 'Yes' | 'No';
  staleBase: boolean;
  staleReason: string;
  createdAt: string;
  updatedAt: string;
}
const reviewSessions = new Map<string, { proposal: LegacyFillReviewProposal; reviewSessionId: string }>();

function requireDesktopMethod<T extends keyof NonNullable<Window['desktopRuntime']>>(name: T) {
  const method = window.desktopRuntime?.[name];
  if (typeof method !== 'function') throw new Error(`Legacy Fill Host method unavailable: ${String(name)}`);
  return method as NonNullable<NonNullable<Window['desktopRuntime']>[T]>;
}

function requireTrustedUserAction(event: Event, trustedActionToken: string) {
  if (!event?.isTrusted || typeof trustedActionToken !== 'string' || !trustedActionToken) throw new Error('Legacy Fill approve/reject/save requires a trusted product UI event');
}

function responseError(response: { error?: { code?: string; message?: string } }, fallback: string) {
  return new Error(`${response.error?.code || fallback}: ${response.error?.message || fallback}`);
}

export async function bootstrapLegacyFillHostGateway(): Promise<BrowserGateway | null> {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  if (gateway) return gateway;
  gateway = createLegacyFillBrowserHostGateway({
    storage: window.localStorage,
    emit(event) {
      window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
      if (event.type === 'legacy-fill.snapshot.published' && window.desktopRuntime?.publishLegacyFillSnapshot) {
        void window.desktopRuntime.publishLegacyFillSnapshot(event.detail);
      }
    },
  });
  const watchedKeys = new Set(Object.values(LEGACY_FILL_STORAGE_KEYS).flatMap((entry) => [entry.current, entry.library]));
  window.addEventListener('storage', (event) => {
    if (event.key && watchedKeys.has(event.key)) void gateway?.publishSnapshot();
  });
  await gateway.publishSnapshot();
  return gateway;
}

export function getLegacyFillHostGateway(): BrowserGateway {
  if (!gateway) throw new Error('Legacy Fill Host gateway has not been bootstrapped');
  return gateway;
}

export async function listLegacyFillReviewProposals(): Promise<LegacyFillReviewProposal[]> {
  const response = await requireDesktopMethod('listLegacyFillProposals')();
  if (!response.ok) throw responseError(response, 'legacy-fill-proposal-list-failed');
  return (response.proposals || []) as LegacyFillReviewProposal[];
}

export async function claimLegacyFillReview(proposal: LegacyFillReviewProposal) {
  const response = await requireDesktopMethod('claimLegacyFillProposal')({
    ownerNamespace: proposal.ownerNamespace,
    proposalId: proposal.proposalId,
    expectedRevision: proposal.revision,
    expectedManifestDigest: proposal.manifestDigest,
  });
  if (!response.ok || !response.proposal || !response.reviewSessionId) throw responseError(response, 'legacy-fill-proposal-claim-failed');
  const claimed = response.proposal as LegacyFillReviewProposal;
  const reviewSessionId = response.reviewSessionId;
  const host = getLegacyFillHostGateway();
  host.internal.claimProposal(host.internal.authority, claimed, reviewSessionId);
  reviewSessions.set(claimed.proposalId, { proposal: claimed, reviewSessionId });
  return { proposal: claimed, reviewSessionId };
}

export async function decideLegacyFillReview(event: Event, trustedActionToken: string, proposalId: string, decision: 'approved' | 'rejected') {
  requireTrustedUserAction(event, trustedActionToken);
  const session = reviewSessions.get(proposalId);
  if (!session) throw new Error('Claim this Legacy Fill proposal in the product UI before deciding it');
  const response = await requireDesktopMethod('decideLegacyFillProposal')({
    ownerNamespace: session.proposal.ownerNamespace,
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: session.proposal.revision,
    expectedManifestDigest: session.proposal.manifestDigest,
    decision,
  }, trustedActionToken);
  if (!response.ok || !response.proposal) throw responseError(response, 'legacy-fill-proposal-decision-failed');
  const decided = response.proposal as LegacyFillReviewProposal;
  const host = getLegacyFillHostGateway();
  host.internal.recordDecision(host.internal.authority, {
    proposalId,
    reviewSessionId: session.reviewSessionId,
    decision,
    proposalRevision: decided.revision,
    manifestDigest: decided.manifestDigest,
  });
  session.proposal = decided;
  return decided;
}

export async function saveLegacyFillReview(event: Event, trustedActionToken: string, proposalId: string) {
  requireTrustedUserAction(event, trustedActionToken);
  const session = reviewSessions.get(proposalId);
  if (!session) throw new Error('Claim this Legacy Fill proposal in the product UI before saving it');
  const begin = await requireDesktopMethod('beginSaveLegacyFillProposal')({
    ownerNamespace: session.proposal.ownerNamespace,
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: session.proposal.revision,
    expectedManifestDigest: session.proposal.manifestDigest,
  }, trustedActionToken);
  if (!begin.ok || !begin.proposal) throw responseError(begin, 'legacy-fill-proposal-save-begin-failed');
  const saving = begin.proposal as LegacyFillReviewProposal;
  session.proposal = saving;
  if (saving.lifecycleStatus === 'stale') return { ok: false as const, proposal: saving, code: 'proposal-base-stale' };
  const host = getLegacyFillHostGateway();
  host.internal.bindApprovedRevision(host.internal.authority, {
    proposalId,
    reviewSessionId: session.reviewSessionId,
    proposalRevision: saving.revision,
    manifestDigest: saving.manifestDigest,
  });
  const applied = await host.internal.applyReviewedProposal(host.internal.authority, {
    proposal: saving,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: saving.revision,
    expectedManifestDigest: saving.manifestDigest,
  });
  if (applied.ok && window.desktopRuntime?.publishLegacyFillSnapshot) await window.desktopRuntime.publishLegacyFillSnapshot(applied.snapshot);
  if (!begin.saveCapability) throw new Error('Legacy Fill save did not receive a Host continuation capability');
  const recorded = await requireDesktopMethod('recordSaveLegacyFillProposal')({
    ownerNamespace: saving.ownerNamespace,
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: saving.revision,
    expectedManifestDigest: saving.manifestDigest,
    ok: applied.ok,
    result: applied.ok ? { targetId: applied.targetId } : {
      code: applied.code,
      error: 'error' in applied ? applied.error : undefined,
    },
  }, begin.saveCapability);
  if (!recorded.ok || !recorded.proposal) throw responseError(recorded, 'legacy-fill-proposal-save-result-failed');
  session.proposal = recorded.proposal as LegacyFillReviewProposal;
  return { ...applied, proposal: session.proposal };
}
