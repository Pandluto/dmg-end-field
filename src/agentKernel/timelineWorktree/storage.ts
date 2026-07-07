import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { diffTimelinePayloads, summarizeTimelinePayload } from './diff';
import type { AiTimelineCommit, AiTimelineWorktree, AiTimelineWorktreeArchive } from './types';

export const AI_TIMELINE_WORKTREE_ARCHIVE_KEY = 'def.ai-timeline.worktree-archive.v1';
const WORKTREE_LIMIT = 20;
const COMMIT_LIMIT = 100;

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function clonePayload(payload: TimelineSnapshotPayload): TimelineSnapshotPayload {
  return JSON.parse(JSON.stringify(payload)) as TimelineSnapshotPayload;
}

function emptyArchive(): AiTimelineWorktreeArchive {
  return { version: 'v1', worktrees: [], commits: [] };
}

export function readAiTimelineWorktreeArchive(): AiTimelineWorktreeArchive {
  if (!canUseLocalStorage()) return emptyArchive();
  const raw = window.localStorage.getItem(AI_TIMELINE_WORKTREE_ARCHIVE_KEY);
  if (!raw) return emptyArchive();
  try {
    const parsed = JSON.parse(raw) as Partial<AiTimelineWorktreeArchive>;
    return {
      version: 'v1',
      worktrees: Array.isArray(parsed.worktrees) ? parsed.worktrees : [],
      commits: Array.isArray(parsed.commits) ? parsed.commits : [],
    };
  } catch {
    return emptyArchive();
  }
}

export function writeAiTimelineWorktreeArchive(archive: AiTimelineWorktreeArchive) {
  if (!canUseLocalStorage()) return;
  window.localStorage.setItem(AI_TIMELINE_WORKTREE_ARCHIVE_KEY, JSON.stringify({
    version: 'v1',
    worktrees: archive.worktrees.slice(0, WORKTREE_LIMIT),
    commits: archive.commits.slice(0, COMMIT_LIMIT),
  }));
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listAiTimelineWorktrees() {
  return [...readAiTimelineWorktreeArchive().worktrees].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function getAiTimelineWorktree(id: string) {
  return readAiTimelineWorktreeArchive().worktrees.find((worktree) => worktree.id === id) || null;
}

export function listAiTimelineCommits() {
  return [...readAiTimelineWorktreeArchive().commits].sort((left, right) => right.createdAt - left.createdAt);
}

export function createAiTimelineWorktree(payload: TimelineSnapshotPayload, label = 'AI Timeline Worktree') {
  const now = Date.now();
  const basePayload = clonePayload(payload);
  const worktree: AiTimelineWorktree = {
    id: makeId('ai-timeline-worktree'),
    createdAt: now,
    updatedAt: now,
    label: label.trim() || 'AI Timeline Worktree',
    status: 'open',
    basePayload,
    workingPayload: clonePayload(payload),
    baseSummary: summarizeTimelinePayload(basePayload),
    workingSummary: summarizeTimelinePayload(basePayload),
    logs: [{ id: makeId('ai-timeline-log'), at: now, level: 'info', message: 'Created worktree from current timeline payload.' }],
  };
  const archive = readAiTimelineWorktreeArchive();
  writeAiTimelineWorktreeArchive({
    ...archive,
    worktrees: [worktree, ...archive.worktrees.filter((item) => item.id !== worktree.id)],
  });
  return worktree;
}

export function updateAiTimelineWorktree(worktree: AiTimelineWorktree) {
  const nextWorktree: AiTimelineWorktree = {
    ...worktree,
    updatedAt: Date.now(),
    workingSummary: summarizeTimelinePayload(worktree.workingPayload),
  };
  const archive = readAiTimelineWorktreeArchive();
  writeAiTimelineWorktreeArchive({
    ...archive,
    worktrees: [nextWorktree, ...archive.worktrees.filter((item) => item.id !== nextWorktree.id)],
  });
  return nextWorktree;
}

export function appendAiTimelineCommit(worktree: AiTimelineWorktree, label = worktree.label) {
  const now = Date.now();
  const diff = diffTimelinePayloads(worktree.basePayload, worktree.workingPayload);
  const commit: AiTimelineCommit = {
    id: makeId('ai-timeline-commit'),
    worktreeId: worktree.id,
    createdAt: now,
    label: label.trim() || worktree.label,
    summary: diff.summary,
    basePayload: clonePayload(worktree.basePayload),
    appliedPayload: clonePayload(worktree.workingPayload),
  };
  const committedWorktree: AiTimelineWorktree = {
    ...worktree,
    status: 'committed',
    updatedAt: now,
    workingSummary: summarizeTimelinePayload(worktree.workingPayload),
    logs: [
      { id: makeId('ai-timeline-log'), at: now, level: 'info', message: `Committed worktree as ${commit.id}.` },
      ...worktree.logs,
    ],
  };
  const archive = readAiTimelineWorktreeArchive();
  writeAiTimelineWorktreeArchive({
    version: 'v1',
    worktrees: [committedWorktree, ...archive.worktrees.filter((item) => item.id !== worktree.id)],
    commits: [commit, ...archive.commits.filter((item) => item.id !== commit.id)],
  });
  return { commit, worktree: committedWorktree, diff };
}
