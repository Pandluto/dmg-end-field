import type { AnomalyStateSnapshot, SkillButtonBuff } from '../../types/storage';

function formatAnomalyStateSnapshotValue(snapshot: AnomalyStateSnapshot): string {
  if (snapshot.key === 'corrosion') {
    return `${(snapshot.currentCorrosion ?? snapshot.effectValue).toFixed(2)}点`;
  }
  return `${(snapshot.effectValue * 100).toFixed(1)}%`;
}

function formatAnomalyStateSnapshotField(snapshot: AnomalyStateSnapshot): string {
  switch (snapshot.key) {
    case 'conductive':
      return '法术易伤';
    case 'armor-break':
      return '物伤易伤';
    case 'corrosion':
      return '全属性降抗';
    default:
      return '快照';
  }
}

export function formatAnomalyStateSnapshotName(snapshot: AnomalyStateSnapshot): string {
  const secondsText = snapshot.key === 'corrosion' && typeof snapshot.durationSeconds === 'number'
    ? `+${snapshot.durationSeconds.toFixed(0)}s`
    : '';
  return `${snapshot.label} Lv${snapshot.level}${secondsText} ${formatAnomalyStateSnapshotValue(snapshot)} (${formatAnomalyStateSnapshotField(snapshot)})`;
}

export function getBuffCategoryText(category: SkillButtonBuff['category']): string {
  if (category === 'countable') return '计层 countable';
  if (category === 'condition') return '条件 condition';
  return '常驻 passive';
}
