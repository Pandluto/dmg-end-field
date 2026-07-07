import {
  applyTimelineSnapshotPayload,
  getCurrentTimelineSnapshotPayload,
} from '../../utils/timelineSnapshotStorage';
import { diffTimelinePayloads } from './diff';
import {
  appendAiTimelineCommit,
  createAiTimelineWorktree,
  getAiTimelineWorktree,
  listAiTimelineCommits,
  listAiTimelineWorktrees,
  updateAiTimelineWorktree,
} from './storage';
import type { AiTimelineWorktree, CommitAiTimelineWorktreeResult } from './types';
import { validateTimelinePayload } from './validator';

export * from './diff';
export * from './localNodeClient';
export * from './patchDsl';
export * from './storage';
export * from './types';
export * from './validator';

export function createWorktreeFromCurrentTimeline(label?: string) {
  const payload = getCurrentTimelineSnapshotPayload();
  if (!payload) return null;
  return createAiTimelineWorktree(payload, label);
}

export function diffWorktree(id: string) {
  const worktree = getAiTimelineWorktree(id);
  if (!worktree) return null;
  return diffTimelinePayloads(worktree.basePayload, worktree.workingPayload);
}

export function saveWorktreeWorkingPayload(worktree: AiTimelineWorktree) {
  return updateAiTimelineWorktree(worktree);
}

export function commitWorktree(id: string, label?: string): CommitAiTimelineWorktreeResult {
  const worktree = getAiTimelineWorktree(id);
  if (!worktree) {
    return { ok: false, issues: [{ code: 'worktree-not-found', message: `AI timeline worktree not found: ${id}` }] };
  }
  const validation = validateTimelinePayload(worktree.workingPayload);
  if (!validation.ok) {
    return { ok: false, worktree, issues: validation.issues };
  }
  applyTimelineSnapshotPayload(worktree.workingPayload);
  const result = appendAiTimelineCommit(worktree, label);
  return { ok: true, worktree: result.worktree, commit: result.commit, diff: result.diff };
}

export function abandonWorktree(id: string) {
  const worktree = getAiTimelineWorktree(id);
  if (!worktree) return null;
  return updateAiTimelineWorktree({
    ...worktree,
    status: 'abandoned',
    logs: [
      { id: `ai-timeline-log-${Date.now()}`, at: Date.now(), level: 'info', message: 'Abandoned worktree.' },
      ...worktree.logs,
    ],
  });
}

export { listAiTimelineCommits, listAiTimelineWorktrees };
