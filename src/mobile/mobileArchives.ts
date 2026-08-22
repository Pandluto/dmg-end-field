import { createMobileId, normalizeMobileDraft } from './mobileDraft';
import type { MobileDraft } from './model';

export const MOBILE_ARCHIVE_STORAGE_KEY = 'def.mobile-workbench.archives.v1';
export const MOBILE_ARCHIVE_SCHEMA_VERSION = 1 as const;

export interface MobileWorkspaceArchive {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: MobileDraft;
}

interface MobileArchiveCollection {
  schemaVersion: typeof MOBILE_ARCHIVE_SCHEMA_VERSION;
  archives: MobileWorkspaceArchive[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneDraft(draft: MobileDraft, now = Date.now()): MobileDraft {
  return normalizeMobileDraft(JSON.parse(JSON.stringify(draft)), now);
}

function normalizeArchive(value: unknown): MobileWorkspaceArchive | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isRecord(value.snapshot)) {
    return null;
  }
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
    ? value.createdAt
    : Date.now();
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : createdAt;
  const name = typeof value.name === 'string' && value.name.trim()
    ? value.name.trim()
    : formatDefaultArchiveName(createdAt);
  return {
    id: value.id,
    name,
    createdAt,
    updatedAt,
    snapshot: cloneDraft(value.snapshot as unknown as MobileDraft, updatedAt),
  };
}

function readCollection(): MobileArchiveCollection {
  if (typeof window === 'undefined') {
    return { schemaVersion: MOBILE_ARCHIVE_SCHEMA_VERSION, archives: [] };
  }
  try {
    const raw = window.localStorage.getItem(MOBILE_ARCHIVE_STORAGE_KEY);
    if (!raw) return { schemaVersion: MOBILE_ARCHIVE_SCHEMA_VERSION, archives: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== MOBILE_ARCHIVE_SCHEMA_VERSION || !Array.isArray(parsed.archives)) {
      return { schemaVersion: MOBILE_ARCHIVE_SCHEMA_VERSION, archives: [] };
    }
    return {
      schemaVersion: MOBILE_ARCHIVE_SCHEMA_VERSION,
      archives: parsed.archives
        .map(normalizeArchive)
        .filter((archive): archive is MobileWorkspaceArchive => Boolean(archive))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    };
  } catch {
    return { schemaVersion: MOBILE_ARCHIVE_SCHEMA_VERSION, archives: [] };
  }
}

function writeCollection(archives: MobileWorkspaceArchive[]): MobileWorkspaceArchive[] {
  if (typeof window === 'undefined') return archives;
  const nextArchives = [...archives].sort((left, right) => right.updatedAt - left.updatedAt);
  window.localStorage.setItem(MOBILE_ARCHIVE_STORAGE_KEY, JSON.stringify({
    schemaVersion: MOBILE_ARCHIVE_SCHEMA_VERSION,
    archives: nextArchives,
  } satisfies MobileArchiveCollection));
  return nextArchives;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDefaultArchiveName(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `存档 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function readMobileArchives(): MobileWorkspaceArchive[] {
  return readCollection().archives;
}

export function saveMobileArchive(draft: MobileDraft, requestedName: string): MobileWorkspaceArchive[] {
  const now = Date.now();
  const archive: MobileWorkspaceArchive = {
    id: createMobileId('mobile-archive'),
    name: requestedName.trim() || formatDefaultArchiveName(now),
    createdAt: now,
    updatedAt: now,
    snapshot: cloneDraft(draft, now),
  };
  return writeCollection([archive, ...readCollection().archives]);
}

export function renameMobileArchive(archiveId: string, requestedName: string): MobileWorkspaceArchive[] {
  const name = requestedName.trim();
  if (!name) return readCollection().archives;
  const now = Date.now();
  return writeCollection(readCollection().archives.map((archive) => (
    archive.id === archiveId ? { ...archive, name, updatedAt: now } : archive
  )));
}

export function deleteMobileArchive(archiveId: string): MobileWorkspaceArchive[] {
  return writeCollection(readCollection().archives.filter((archive) => archive.id !== archiveId));
}

export function cloneMobileArchiveSnapshot(archive: MobileWorkspaceArchive): MobileDraft {
  return cloneDraft(archive.snapshot);
}
