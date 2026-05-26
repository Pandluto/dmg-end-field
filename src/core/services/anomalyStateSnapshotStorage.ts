import { STORAGE_KEYS } from '../../constants/storage-keys';
import type { AnomalyStateSnapshot } from '../../types/storage';
import { safeSessionStorage } from '../../utils/storage';

interface AnomalyStateSnapshotArchive {
  version: 'v1';
  nextId: number;
  snapshots: AnomalyStateSnapshot[];
}

const EMPTY_ARCHIVE: AnomalyStateSnapshotArchive = {
  version: 'v1',
  nextId: 1,
  snapshots: [],
};

function calculateStateEffectEnhancement(sourceSkillStrength: number): number {
  return sourceSkillStrength > 0
    ? (2 * sourceSkillStrength) / (sourceSkillStrength + 300)
    : 0;
}

function resolveRateByLevel(level: number, values: number[]): number {
  return values[Math.min(Math.max(level - 1, 0), values.length - 1)] ?? values[0] ?? 0;
}

function normalizeSnapshotEffect(snapshot: AnomalyStateSnapshot): AnomalyStateSnapshot {
  const effectEnhancement = calculateStateEffectEnhancement(snapshot.sourceSkillStrengthSnapshot);

  if (snapshot.key === 'conductive') {
    const baseRate = resolveRateByLevel(snapshot.level, [0.12, 0.16, 0.2, 0.24]);
    const effectValue = baseRate * (1 + effectEnhancement);
    return {
      ...snapshot,
      effectValue,
      secondaryText: `快照效果: ${(effectValue * 100).toFixed(1)}% 法术易伤`,
    };
  }

  if (snapshot.key === 'armor-break') {
    const baseRate = resolveRateByLevel(snapshot.level, [0.12, 0.16, 0.2, 0.24]);
    const effectValue = baseRate * (1 + effectEnhancement);
    return {
      ...snapshot,
      effectValue,
      secondaryText: `快照效果: ${(effectValue * 100).toFixed(1)}% 物伤易伤`,
    };
  }

  return snapshot;
}

function normalizeSnapshot(snapshot: AnomalyStateSnapshot): AnomalyStateSnapshot {
  return normalizeSnapshotEffect({
    ...snapshot,
    durationSeconds: typeof snapshot.durationSeconds === 'number' ? snapshot.durationSeconds : undefined,
    tertiaryText: snapshot.tertiaryText?.trim() || undefined,
  });
}

export function getAnomalyStateSnapshotArchive(): AnomalyStateSnapshotArchive {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE);
  if (!raw) {
    return { ...EMPTY_ARCHIVE };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AnomalyStateSnapshotArchive>;
    return {
      version: 'v1',
      nextId: typeof parsed.nextId === 'number' && parsed.nextId > 0 ? parsed.nextId : 1,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots.map(normalizeSnapshot) : [],
    };
  } catch {
    return { ...EMPTY_ARCHIVE };
  }
}

export function setAnomalyStateSnapshotArchive(archive: AnomalyStateSnapshotArchive): void {
  safeSessionStorage.setItem(STORAGE_KEYS.ANOMALY_STATE_SNAPSHOT_ARCHIVE, JSON.stringify(archive));
}

export function listAnomalyStateSnapshots(): AnomalyStateSnapshot[] {
  return getAnomalyStateSnapshotArchive().snapshots;
}

export function getAnomalyStateSnapshotsByIds(ids: number[]): AnomalyStateSnapshot[] {
  if (ids.length === 0) {
    return [];
  }
  const idSet = new Set(ids);
  return listAnomalyStateSnapshots().filter((snapshot) => idSet.has(snapshot.id));
}

export function createAnomalyStateSnapshot(
  input: Omit<AnomalyStateSnapshot, 'id' | 'createdAt'>
): AnomalyStateSnapshot {
  const archive = getAnomalyStateSnapshotArchive();
  const snapshot: AnomalyStateSnapshot = normalizeSnapshot({
    ...input,
    id: archive.nextId,
    createdAt: Date.now(),
  });
  archive.nextId += 1;
  archive.snapshots = [...archive.snapshots, snapshot];
  setAnomalyStateSnapshotArchive(archive);
  return snapshot;
}

export function removeAnomalyStateSnapshot(snapshotId: number): void {
  const archive = getAnomalyStateSnapshotArchive();
  archive.snapshots = archive.snapshots.filter((snapshot) => snapshot.id !== snapshotId);
  setAnomalyStateSnapshotArchive(archive);
}
