import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

export type AiTimelineWorktreeStatus = 'open' | 'committed' | 'abandoned';
export type AiTimelineWorkNodeStatus = 'open' | 'ready' | 'committed' | 'applied' | 'abandoned';
export type AiTimelineLogLevel = 'info' | 'warning' | 'error';
export type AiTimelineApprovalPolicy = 'auto-low-risk' | 'ask-on-risk' | 'manual';
export type AiTimelineRiskSeverity = 'info' | 'warning' | 'blocker';

export type TimelinePayloadSummary = {
  characterCount: number;
  buttonCount: number;
  buffCount: number;
};

export type AiTimelineWorktreeLog = {
  id: string;
  at: number;
  level: AiTimelineLogLevel;
  message: string;
};

export type AiTimelineWorktree = {
  id: string;
  createdAt: number;
  updatedAt: number;
  label: string;
  status: AiTimelineWorktreeStatus;
  basePayload: TimelineSnapshotPayload;
  workingPayload: TimelineSnapshotPayload;
  baseSummary: TimelinePayloadSummary;
  workingSummary: TimelinePayloadSummary;
  logs: AiTimelineWorktreeLog[];
};

export type AiTimelineRiskFlag = {
  id: string;
  severity: AiTimelineRiskSeverity;
  code: string;
  message: string;
  path?: string;
};

export type AiTimelineApproval = {
  mode: 'auto' | 'manual';
  approvedAt: number;
  approvedBy: 'ai' | 'user' | 'system';
  rationale: string;
};

export type AiTimelineCheckoutDecision = {
  status: 'auto' | 'needs-manual-approval' | 'blocked';
  approvalMode: 'auto' | 'manual';
  canAutoApprove: boolean;
  requiresManualApproval: boolean;
  blockerCount: number;
  warningCount: number;
  rationale: string;
  reasons: string[];
};

export type AiTimelineCheckout = {
  appliedAt: number;
  appliedBy: 'ai' | 'user' | 'system';
  rationale: string;
};

export type AiTimelineWorkNode = {
  id: string;
  parentNodeId?: string;
  saveId: string;
  branchId: string;
  createdAt: number;
  updatedAt: number;
  label: string;
  status: AiTimelineWorkNodeStatus;
  basePayload: TimelineSnapshotPayload;
  workingPayload: TimelineSnapshotPayload;
  baseSummary: TimelinePayloadSummary;
  workingSummary: TimelinePayloadSummary;
  approvalPolicy: AiTimelineApprovalPolicy;
  riskFlags: AiTimelineRiskFlag[];
  logs: AiTimelineWorktreeLog[];
};

export type AiTimelineWorkNodeListItem = Omit<AiTimelineWorkNode, 'basePayload' | 'workingPayload'>;

export type TimelineButtonDiffItem = {
  id: string;
  label: string;
  characterName: string;
  skillType: string;
  skillDisplayName?: string;
  staffIndex: number;
  nodeIndex: number;
  selectedBuffIds: string[];
};

export type TimelineButtonFieldChange = {
  field: string;
  before: unknown;
  after: unknown;
};

export type TimelineButtonChange = {
  id: string;
  before: TimelineButtonDiffItem;
  after: TimelineButtonDiffItem;
  changes: TimelineButtonFieldChange[];
};

export type TimelineBuffDiffItem = {
  id: string;
  displayName: string;
  sourceName?: string;
};

export type TimelinePayloadDiffSummary = {
  addedButtonCount: number;
  removedButtonCount: number;
  changedButtonCount: number;
  addedBuffCount: number;
  removedBuffCount: number;
  beforeButtonCount: number;
  afterButtonCount: number;
  beforeBuffCount: number;
  afterBuffCount: number;
};

export type TimelinePayloadDiff = {
  summary: TimelinePayloadDiffSummary;
  selectedCharactersChanged: boolean;
  beforeSelectedCharacters: string[];
  afterSelectedCharacters: string[];
  addedButtons: TimelineButtonDiffItem[];
  removedButtons: TimelineButtonDiffItem[];
  changedButtons: TimelineButtonChange[];
  addedBuffs: TimelineBuffDiffItem[];
  removedBuffs: TimelineBuffDiffItem[];
};

export type AiTimelineCommit = {
  id: string;
  worktreeId: string;
  createdAt: number;
  label: string;
  summary: TimelinePayloadDiffSummary;
  basePayload: TimelineSnapshotPayload;
  appliedPayload: TimelineSnapshotPayload;
};

export type AiTimelineWorkNodeCommit = {
  id: string;
  nodeId: string;
  saveId: string;
  branchId: string;
  createdAt: number;
  label: string;
  summary: TimelinePayloadDiffSummary;
  basePayload: TimelineSnapshotPayload;
  appliedPayload: TimelineSnapshotPayload;
  riskFlags: AiTimelineRiskFlag[];
  approval: AiTimelineApproval;
  checkoutApplied: boolean;
  checkout?: AiTimelineCheckout;
};

export type AiTimelineWorkNodeCommitListItem = Omit<AiTimelineWorkNodeCommit, 'basePayload' | 'appliedPayload'>;

export type AiTimelineWorktreeArchive = {
  version: 'v1';
  worktrees: AiTimelineWorktree[];
  commits: AiTimelineCommit[];
};

export type AiTimelineWorkNodeArchive = {
  type: 'def.ai-timeline.worknodes.v1';
  schemaVersion: 1;
  nodes: AiTimelineWorkNode[];
  commits: AiTimelineWorkNodeCommit[];
};

export type AiTimelineValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type AiTimelineValidationResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: AiTimelineValidationIssue[] };

export type CommitAiTimelineWorktreeResult =
  | { ok: true; worktree: AiTimelineWorktree; commit: AiTimelineCommit; diff: TimelinePayloadDiff }
  | { ok: false; worktree?: AiTimelineWorktree; issues: AiTimelineValidationIssue[] };
