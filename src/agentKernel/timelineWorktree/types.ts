import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

export type AiTimelineWorktreeStatus = 'open' | 'committed' | 'abandoned';
export type AiTimelineLogLevel = 'info' | 'warning' | 'error';

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

export type AiTimelineWorktreeArchive = {
  version: 'v1';
  worktrees: AiTimelineWorktree[];
  commits: AiTimelineCommit[];
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
