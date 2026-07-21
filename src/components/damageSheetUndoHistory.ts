import type { SkillButtonBuff } from '../types/storage';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { safeSessionStorage } from '../utils/storage';
import {
  getUserWorkspaceManagedKeys,
  getUserWorkspaceStorageEntries,
} from '../utils/userWorkspaceBridge';

export interface UndoSnapshot {
  id: string;
  createdAt: number;
  label: string;
  sessionEntries: Array<[string, string]>;
}

const DAMAGE_SHEET_UNDO_KEY = 'def.damage-sheet.undo.v1';
const DAMAGE_SHEET_UNDO_LIMIT = 5;
export function formatUndoLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}`;
}

function getUndoSnapshotEntryValue(snapshot: UndoSnapshot, key: string): string | null {
  const matchedEntry = snapshot.sessionEntries.find(([entryKey]) => entryKey === key);
  return matchedEntry?.[1] ?? null;
}

function buildUndoSnapshotBuffPreview(snapshot: UndoSnapshot): string[] {
  const rawBuffList = getUndoSnapshotEntryValue(snapshot, STORAGE_KEYS.ALL_BUFF_LIST);
  if (!rawBuffList) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawBuffList) as SkillButtonBuff[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((buff) => buff.displayName?.trim() || buff.name?.trim() || buff.id)
      .filter((name, index, array) => Boolean(name) && array.indexOf(name) === index);
  } catch {
    return [];
  }
}

export function buildUndoSnapshotHoverText(snapshot: UndoSnapshot): string {
  const buffPreview = buildUndoSnapshotBuffPreview(snapshot);
  const buffLine = buffPreview.length > 0
    ? buffPreview.slice(0, 10).join(' / ')
    : '无 Buff';

  return [
    `时间：${formatUndoLabel(snapshot.createdAt)}`,
    `操作：${snapshot.label}`,
    `Buff：${buffLine}`,
  ].join('\n');
}

export function readUndoSnapshots(): UndoSnapshot[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(DAMAGE_SHEET_UNDO_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as UndoSnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUndoSnapshots(snapshots: UndoSnapshot[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(DAMAGE_SHEET_UNDO_KEY, JSON.stringify(snapshots));
}

export function captureSessionSnapshot(label: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const sessionEntries: Array<[string, string]> = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (!key) {
      continue;
    }
    const value = window.sessionStorage.getItem(key);
    if (value != null) {
      sessionEntries.push([key, value]);
    }
  }
  const workspaceEntries = getUserWorkspaceStorageEntries();
  const workspaceKeys = new Set(workspaceEntries.map(([key]) => key));
  const filteredEntries = sessionEntries.filter(([key]) => !workspaceKeys.has(key));

  const snapshot: UndoSnapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    label,
    sessionEntries: [...filteredEntries, ...workspaceEntries],
  };

  const nextSnapshots = [snapshot, ...readUndoSnapshots()].slice(0, DAMAGE_SHEET_UNDO_LIMIT);
  writeUndoSnapshots(nextSnapshots);
}

export function restoreUndoSnapshot(snapshotId: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const snapshots = readUndoSnapshots();
  const target = snapshots.find((item) => item.id === snapshotId);
  if (!target) {
    return false;
  }

  const browserSessionKeys: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key) browserSessionKeys.push(key);
  }
  browserSessionKeys.forEach((key) => safeSessionStorage.removeItem(key));
  getUserWorkspaceManagedKeys().forEach((key) => safeSessionStorage.removeItem(key));
  target.sessionEntries.forEach(([key, value]) => {
    safeSessionStorage.setItem(key, value);
  });

  writeUndoSnapshots(snapshots.filter((item) => item.id !== snapshotId));
  return true;
}
