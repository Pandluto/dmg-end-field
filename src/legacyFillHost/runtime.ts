import { createLegacyFillBrowserHostGateway, LEGACY_FILL_STORAGE_KEYS, type ReviewedProposal } from './browserGateway';
import {
  claimMcpFillWebProposal,
  confirmAndBeginSaveMcpFillWebProposal,
  decideMcpFillWebProposal,
  getMcpFillWebServiceState,
  issueMcpFillWebAction,
  listMcpFillWebProposals,
  publishMcpFillWebSnapshot,
  reconcileMcpFillWebSave,
  recordSaveMcpFillWebProposal,
} from '../platform/runtime/desktopMcpBridge';
import { hasDesktopMcpCapability } from '../platform/runtime/desktopMcpBridge';
import { persistentLocalStorage } from '../platform/storage/persistentStorage';
import { LOCAL_LIBRARY_CHANGED_EVENT } from '../constants/events';
import type { LegacyFillDomain } from '../legacyFillCore';

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
const SAVE_OUTBOX_KEY = 'def.legacy-fill.save-outbox.v1';

type SaveOutboxBase = {
  contract: 'LegacyFillSaveOutboxV1';
  ownerNamespace: string;
  proposalId: string;
  reviewSessionId: string;
  expectedRevision: number;
  expectedManifestDigest: string;
  result: { targetId: string };
};

type PreparedSaveOutboxEntry = SaveOutboxBase & {
  phase: 'prepared';
  domain: LegacyFillDomain;
  postconditionDigest: string;
};

type AppliedSaveOutboxEntry = SaveOutboxBase & {
  phase: 'applied';
  snapshot: unknown;
};

type SaveOutboxEntry = PreparedSaveOutboxEntry | AppliedSaveOutboxEntry;

function requireTrustedUserAction(event: Event) {
  // Product-flow guard only: the protected main Web renderer capability is the
  // Host authority boundary because browsers do not provide server-attested clicks.
  if (!event?.isTrusted) throw new Error('MCP Fill confirm/reject requires a trusted product UI event');
}

function responseError(response: { error?: { code?: string; message?: string } }, fallback: string) {
  return new Error(`${response.error?.code || fallback}: ${response.error?.message || fallback}`);
}

function readSaveOutbox(): SaveOutboxEntry | null {
  try {
    const value = JSON.parse(persistentLocalStorage.getItem(SAVE_OUTBOX_KEY) || 'null') as Partial<SaveOutboxEntry> | null;
    const baseValid = value?.contract === 'LegacyFillSaveOutboxV1'
      && typeof value.ownerNamespace === 'string'
      && typeof value.proposalId === 'string'
      && typeof value.reviewSessionId === 'string'
      && typeof value.expectedRevision === 'number'
      && typeof value.expectedManifestDigest === 'string'
      && typeof value.result?.targetId === 'string';
    if (!baseValid) return null;
    if (value.phase === 'prepared') {
      return ['buff', 'weapon', 'operator', 'equipment'].includes(String(value.domain))
        && typeof value.postconditionDigest === 'string'
        ? value as PreparedSaveOutboxEntry
        : null;
    }
    // Entries written by the first desktop migration build had no phase field.
    const appliedValue = value as Partial<AppliedSaveOutboxEntry>;
    if ((value.phase === 'applied' || value.phase === undefined) && appliedValue.snapshot !== undefined) {
      return { ...value, phase: 'applied' } as AppliedSaveOutboxEntry;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeSaveOutbox(entry: SaveOutboxEntry) {
  persistentLocalStorage.setItem(SAVE_OUTBOX_KEY, JSON.stringify(entry));
  await persistentLocalStorage.flush();
}

async function clearSaveOutbox(proposalId: string) {
  if (readSaveOutbox()?.proposalId === proposalId) persistentLocalStorage.removeItem(SAVE_OUTBOX_KEY);
  await persistentLocalStorage.flush();
}

async function reconcileSaveOutbox(entry = readSaveOutbox()) {
  if (!entry) return null;
  let appliedEntry: AppliedSaveOutboxEntry;
  if (entry.phase === 'prepared') {
    const host = getLegacyFillHostGateway();
    const recovered = await host.internal.recoverPreparedWrite(host.internal.authority, {
      domain: entry.domain,
      postconditionDigest: entry.postconditionDigest,
    });
    if (!recovered.ok) {
      await clearSaveOutbox(entry.proposalId);
      return null;
    }
    appliedEntry = { ...entry, phase: 'applied', snapshot: recovered.snapshot };
    await writeSaveOutbox(appliedEntry);
  } else {
    appliedEntry = entry;
  }
  const response = await reconcileMcpFillWebSave(appliedEntry);
  if (!response.ok || !response.proposal) throw responseError(response, 'legacy-fill-proposal-save-reconcile-failed');
  await clearSaveOutbox(appliedEntry.proposalId);
  return response.proposal as LegacyFillReviewProposal;
}

export async function bootstrapLegacyFillHostGateway(): Promise<BrowserGateway | null> {
  if (typeof window === 'undefined' || !hasDesktopMcpCapability()) return null;
  if (gateway) return gateway;
  gateway = createLegacyFillBrowserHostGateway({
    storage: persistentLocalStorage,
    emit(event) {
      window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
      if (event.type === 'legacy-fill.library.changed') {
        window.dispatchEvent(new CustomEvent(LOCAL_LIBRARY_CHANGED_EVENT, { detail: event.detail }));
      }
    },
  });
  const watchedKeys = new Set(Object.values(LEGACY_FILL_STORAGE_KEYS).flatMap((entry) => [entry.current, entry.library]));
  let publishTimer: number | null = null;
  persistentLocalStorage.subscribe((keys) => {
    if (!keys.some((key) => watchedKeys.has(key))) return;
    if (publishTimer !== null) window.clearTimeout(publishTimer);
    publishTimer = window.setTimeout(() => {
      publishTimer = null;
      void persistentLocalStorage.flush()
        .then(() => gateway?.publishSnapshot())
        .then((snapshot) => (snapshot ? publishMcpFillWebSnapshot(snapshot) : undefined))
        .catch(() => undefined);
    }, 100);
  });
  const initialSnapshot = await gateway.publishSnapshot();
  await publishMcpFillWebSnapshot(initialSnapshot);
  await reconcileSaveOutbox();
  return gateway;
}

export function getLegacyFillHostGateway(): BrowserGateway {
  if (!gateway) throw new Error('Legacy Fill Host gateway has not been bootstrapped');
  return gateway;
}

export async function publishLegacyFillHostSnapshot() {
  if (!gateway) return null;
  await persistentLocalStorage.flush();
  const snapshot = await gateway.publishSnapshot();
  await publishMcpFillWebSnapshot(snapshot);
  return snapshot;
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
  const actionCapability = await issueMcpFillWebAction('reject', {
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: session.proposal.revision,
    expectedManifestDigest: session.proposal.manifestDigest,
  });
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
  const actionCapability = await issueMcpFillWebAction('confirm', {
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: session.proposal.revision,
    expectedManifestDigest: session.proposal.manifestDigest,
  });
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
  const writeBinding = {
    proposal: saving,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: saving.revision,
    expectedManifestDigest: saving.manifestDigest,
  };
  const preparation = await host.internal.prepareReviewedProposalWrite(
    host.internal.authority,
    writeBinding,
  );
  if (!begin.saveCapability) throw new Error('Legacy Fill confirm/save did not receive a Host continuation capability');
  let preparedOutbox: PreparedSaveOutboxEntry | null = null;
  let applied: Awaited<ReturnType<typeof host.internal.applyReviewedProposal>>;
  if (preparation.ok) {
    preparedOutbox = {
      contract: 'LegacyFillSaveOutboxV1',
      phase: 'prepared',
      ownerNamespace: saving.ownerNamespace,
      proposalId,
      reviewSessionId: session.reviewSessionId,
      expectedRevision: saving.revision,
      expectedManifestDigest: saving.manifestDigest,
      domain: saving.domain,
      postconditionDigest: preparation.postconditionDigest,
      result: { targetId: preparation.targetId },
    };
    // Persist the recovery intent before touching the product database. If the
    // renderer dies after the durable write, bootstrap can prove the expected
    // postcondition and complete the daemon audit record.
    await writeSaveOutbox(preparedOutbox);
    applied = await host.internal.applyReviewedProposal(host.internal.authority, {
      ...writeBinding,
      preparedPlanId: preparation.planId,
    });
    if (!applied.ok) await clearSaveOutbox(proposalId);
  } else {
    applied = preparation;
  }
  if (applied.ok) {
    if (!preparedOutbox) throw new Error('Legacy Fill write completed without a durable recovery intent');
    const outbox: AppliedSaveOutboxEntry = {
      ...preparedOutbox,
      phase: 'applied',
      snapshot: applied.snapshot,
    };
    await writeSaveOutbox(outbox);
    try {
      await publishMcpFillWebSnapshot(applied.snapshot);
      const recorded = await recordSaveMcpFillWebProposal({ ...outbox, ok: true }, String(begin.saveCapability));
      if (!recorded.ok || !recorded.proposal) throw responseError(recorded, 'legacy-fill-proposal-confirm-save-result-failed');
      await clearSaveOutbox(proposalId);
      session.proposal = recorded.proposal as LegacyFillReviewProposal;
      return { ...applied, proposal: session.proposal };
    } catch (error) {
      try {
        const reconciled = await reconcileSaveOutbox(outbox);
        if (reconciled) {
          session.proposal = reconciled;
          return { ...applied, proposal: reconciled, reconciled: true as const };
        }
      } catch {
        // Keep the durable outbox for the next authorized Web bootstrap.
      }
      throw new Error(`产品资料已写入，审计结果将在下次打开页面时自动恢复：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const recorded = await recordSaveMcpFillWebProposal({
    ownerNamespace: saving.ownerNamespace,
    proposalId,
    reviewSessionId: session.reviewSessionId,
    expectedRevision: saving.revision,
    expectedManifestDigest: saving.manifestDigest,
    ok: false,
    result: {
      code: applied.code,
      error: 'error' in applied ? applied.error : undefined,
    },
  }, String(begin.saveCapability));
  if (!recorded.ok || !recorded.proposal) throw responseError(recorded, 'legacy-fill-proposal-confirm-save-result-failed');
  session.proposal = recorded.proposal as LegacyFillReviewProposal;
  return { ...applied, proposal: session.proposal };
}
