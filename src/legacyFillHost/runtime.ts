import { createLegacyFillBrowserHostGateway, LEGACY_FILL_STORAGE_KEYS, type ReviewedProposal } from './browserGateway';
import {
  claimMcpFillWebProposal,
  confirmAndBeginSaveMcpFillWebProposal,
  decideMcpFillWebProposal,
  getMcpFillWebServiceState,
  issueMcpFillWebAction,
  listMcpFillWebProposals,
  publishMcpFillWebSnapshot,
  recordSaveMcpFillWebProposal,
} from '../utils/localAgent';

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

export interface McpFillRuntimeState {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  url: string;
  mcpUrl?: string;
}
const reviewSessions = new Map<string, { proposal: LegacyFillReviewProposal; reviewSessionId: string }>();

function requireTrustedUserAction(event: Event) {
  if (!event?.isTrusted) throw new Error('MCP Fill confirm/reject requires a trusted product UI event');
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
      if (event.type === 'legacy-fill.snapshot.published') {
        void publishMcpFillWebSnapshot(event.detail);
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
  const response = await listMcpFillWebProposals();
  if (!response.ok) throw responseError(response, 'legacy-fill-proposal-list-failed');
  return (response.proposals || []) as LegacyFillReviewProposal[];
}

export async function getMcpFillRuntimeState(): Promise<McpFillRuntimeState> {
  const response = await getMcpFillWebServiceState();
  if (!response.ok || !response.state) throw responseError(response, 'legacy-fill-service-state-failed');
  return response.state as unknown as McpFillRuntimeState;
}

export async function claimLegacyFillReview(proposal: LegacyFillReviewProposal) {
  const response = await claimMcpFillWebProposal({
    ownerNamespace: proposal.ownerNamespace,
    proposalId: proposal.proposalId,
    expectedRevision: proposal.revision,
    expectedManifestDigest: proposal.manifestDigest,
  });
  if (!response.ok || !response.proposal || !response.reviewSessionId) throw responseError(response, 'legacy-fill-proposal-claim-failed');
  const claimed = response.proposal as LegacyFillReviewProposal;
  const reviewSessionId = String(response.reviewSessionId);
  const host = getLegacyFillHostGateway();
  host.internal.claimProposal(host.internal.authority, claimed, reviewSessionId);
  reviewSessions.set(claimed.proposalId, { proposal: claimed, reviewSessionId });
  return { proposal: claimed, reviewSessionId };
}

export async function decideLegacyFillReview(event: Event, proposalId: string, decision: 'rejected') {
  requireTrustedUserAction(event);
  const session = reviewSessions.get(proposalId);
  if (!session) throw new Error('Claim this Legacy Fill proposal in the product UI before deciding it');
  const actionCapability = await issueMcpFillWebAction('reject', proposalId);
  const response = await decideMcpFillWebProposal({
    ownerNamespace: session.proposal.ownerNamespace,
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: session.proposal.revision,
    expectedManifestDigest: session.proposal.manifestDigest,
    decision,
  }, actionCapability);
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

export async function confirmAndSaveLegacyFillReview(event: Event, proposalId: string) {
  requireTrustedUserAction(event);
  const session = reviewSessions.get(proposalId);
  if (!session) throw new Error('Claim this Legacy Fill proposal in the product UI before confirming it');
  const actionCapability = await issueMcpFillWebAction('confirm', proposalId);
  const begin = await confirmAndBeginSaveMcpFillWebProposal({
    ownerNamespace: session.proposal.ownerNamespace,
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: session.proposal.revision,
    expectedManifestDigest: session.proposal.manifestDigest,
    alreadyApproved: session.proposal.approvalStatus === 'Yes',
    proposal: session.proposal,
  }, actionCapability);
  if (!begin.ok || !begin.proposal) throw responseError(begin, 'legacy-fill-proposal-confirm-save-begin-failed');
  const saving = begin.proposal as LegacyFillReviewProposal;
  if (saving.lifecycleStatus === 'stale') return { ok: false as const, proposal: saving, code: 'proposal-base-stale' };
  const host = getLegacyFillHostGateway();
  if (session.proposal.approvalStatus !== 'Yes') {
    host.internal.recordDecision(host.internal.authority, {
      proposalId,
      reviewSessionId: session.reviewSessionId,
      decision: 'approved',
      proposalRevision: saving.revision,
      manifestDigest: saving.manifestDigest,
    });
  }
  host.internal.bindApprovedRevision(host.internal.authority, {
    proposalId,
    reviewSessionId: session.reviewSessionId,
    proposalRevision: saving.revision,
    manifestDigest: saving.manifestDigest,
  });
  session.proposal = saving;
  const applied = await host.internal.applyReviewedProposal(host.internal.authority, {
    proposal: saving,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: saving.revision,
    expectedManifestDigest: saving.manifestDigest,
  });
  if (applied.ok) await publishMcpFillWebSnapshot(applied.snapshot);
  if (!begin.saveCapability) throw new Error('Legacy Fill confirm/save did not receive a Host continuation capability');
  const recorded = await recordSaveMcpFillWebProposal({
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
  }, String(begin.saveCapability));
  if (!recorded.ok || !recorded.proposal) throw responseError(recorded, 'legacy-fill-proposal-confirm-save-result-failed');
  session.proposal = recorded.proposal as LegacyFillReviewProposal;
  return { ...applied, proposal: session.proposal };
}
