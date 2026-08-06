import type { LegacyFillReviewProposal, McpFillRuntimeState } from '../legacyFillHost/runtime';

export type QueueFilter = 'active' | 'all';
export type ReviewView = 'changes' | 'result' | 'context';

export type ReviewIssue = {
  code?: string;
  message: string;
  path?: string;
};

export type ReviewDiffEntry = {
  path: string;
  kind: 'add' | 'remove' | 'replace';
  before?: unknown;
  after?: unknown;
};

export type ReviewManifest = {
  target?: { id?: string; displayName?: string; existsInBase?: boolean };
  normalizedDraft?: unknown;
  validation?: { valid?: boolean; errors?: unknown[]; warnings?: unknown[] };
  diff?: ReviewDiffEntry[];
  intent?: string;
  evidence?: Array<{ label?: string; text?: string }>;
  requestedWrites?: Array<{ storageDomain?: string; targetId?: string }>;
  baseSnapshot?: { snapshotId?: string; revision?: number; contentHash?: string };
};

const ACTIVE_STATUSES = new Set<LegacyFillReviewProposal['lifecycleStatus']>([
  'pending',
  'claimed',
  'approved',
]);

const FIELD_LABELS: Record<string, string> = {
  id: '标识',
  name: '名称',
  description: '说明',
  items: '条目',
  effects: '效果',
  category: '触发方式',
  value: '数值',
  multiplier: '乘数',
  coefficient: '系数',
  levels: '等级数据',
  skills: '技能',
  gearSets: '装备套装',
  equipments: '装备',
  threePieceBuff: '三件套效果',
  threePieceBuffs: '三件套效果',
  stats: '属性',
  attributes: '属性',
  imgUrl: '图片',
  imageUrl: '图片',
  avatarUrl: '头像',
  iconUrl: '图标',
};

export function manifestOf(proposal: LegacyFillReviewProposal | null): ReviewManifest {
  return (proposal?.review || {}) as ReviewManifest;
}

export function proposalTargetLabel(proposal: LegacyFillReviewProposal) {
  const manifest = manifestOf(proposal);
  if (manifest.target?.displayName) return manifest.target.displayName;
  if (proposal.domain === 'equipment' && manifest.normalizedDraft && typeof manifest.normalizedDraft === 'object') {
    const gearSets = (manifest.normalizedDraft as { gearSets?: unknown }).gearSets;
    if (gearSets && typeof gearSets === 'object' && !Array.isArray(gearSets)) {
      const names = Object.values(gearSets).flatMap((value) => (
        value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
          ? [(value as { name: string }).name]
          : []
      ));
      if (names.length === 1) return names[0];
      if (names.length > 1) return `${names[0]}等 ${names.length} 个套装`;
    }
  }
  return manifest.target?.id || proposal.summary;
}

export function belongsToQueue(proposal: LegacyFillReviewProposal, filter: QueueFilter) {
  return filter === 'all' || ACTIVE_STATUSES.has(proposal.lifecycleStatus);
}

export function filterReviewProposals(
  proposals: LegacyFillReviewProposal[],
  filter: QueueFilter,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  return proposals
    .filter((proposal) => belongsToQueue(proposal, filter))
    .filter((proposal) => {
      if (!needle) return true;
      const target = manifestOf(proposal).target;
      return [
        proposal.proposalId,
        proposal.summary,
        proposal.ownerNamespace,
        proposal.domain,
        target?.id,
        proposalTargetLabel(proposal),
      ].filter(Boolean).join('\n').toLocaleLowerCase().includes(needle);
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function selectVisibleProposal(
  current: LegacyFillReviewProposal | null,
  visible: LegacyFillReviewProposal[],
) {
  if (current) {
    const stillVisible = visible.find((proposal) => proposal.proposalId === current.proposalId);
    if (stillVisible) return stillVisible;
  }
  return visible[0] || null;
}

function normalizeIssue(issue: unknown): ReviewIssue {
  if (typeof issue === 'string') return { message: issue };
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return { message: String(issue) };
  const value = issue as { code?: unknown; message?: unknown; path?: unknown };
  return {
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    message: typeof value.message === 'string' ? value.message : JSON.stringify(issue),
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
  };
}

export function proposalValidation(proposal: LegacyFillReviewProposal | null) {
  const manifest = manifestOf(proposal);
  const fallback = (proposal as (LegacyFillReviewProposal & {
    validation?: { valid?: boolean; errors?: unknown[]; warnings?: unknown[] };
  }) | null)?.validation;
  const validation = manifest.validation || fallback;
  return {
    known: Boolean(validation),
    valid: validation?.valid === true,
    errors: (validation?.errors || []).map(normalizeIssue),
    warnings: (validation?.warnings || []).map(normalizeIssue),
  };
}

export function canConfirmProposal(
  proposal: LegacyFillReviewProposal | null,
  runtime: McpFillRuntimeState | null,
) {
  if (!proposal || !runtime?.ready || !ACTIVE_STATUSES.has(proposal.lifecycleStatus) || proposal.staleBase) return false;
  return proposalValidation(proposal).valid;
}

export function canRejectProposal(
  proposal: LegacyFillReviewProposal | null,
  runtime: McpFillRuntimeState | null,
) {
  return Boolean(proposal && runtime?.ready && ACTIVE_STATUSES.has(proposal.lifecycleStatus));
}

export function displayDiffPath(path: string) {
  if (!path || path === '/') return '完整资料';
  return path.split('/').slice(1).map((segment) => {
    const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    return FIELD_LABELS[decoded] || decoded;
  }).join(' / ');
}

export function formatReviewValue(value: unknown) {
  if (value === undefined) return '不存在';
  if (value === null) return '空';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value || '空字符串';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '无效数值';
  return JSON.stringify(value, null, 2);
}

export function proposalChangeSummary(proposal: LegacyFillReviewProposal | null) {
  const manifest = manifestOf(proposal);
  const diff = manifest.diff || [];
  const counts = { add: 0, remove: 0, replace: 0 };
  for (const entry of diff) counts[entry.kind] += 1;
  return { diff, counts, total: diff.length, isNew: manifest.target?.existsInBase === false };
}
