import type { SkillButtonBuff } from '../../types/storage';

interface TimelineBuffListPanelProps {
  buffs: SkillButtonBuff[];
  stackCounts: Record<string, number>;
  onRemove: (buffId: string) => void;
  onToggleDisabled: (buffId: string) => void;
  isDisabled: (buffId: string) => boolean;
  onDecrement: (buffId: string) => void;
  onIncrement: (buff: SkillButtonBuff) => void;
}

function getMaxStacks(buff: SkillButtonBuff): number {
  return typeof buff.maxStacks === 'number' && Number.isFinite(buff.maxStacks)
    ? Math.max(1, Math.floor(buff.maxStacks))
    : 1;
}

export function TimelineBuffListPanel({
  buffs,
  stackCounts,
  onRemove,
  onToggleDisabled,
  isDisabled,
  onDecrement,
  onIncrement,
}: TimelineBuffListPanelProps) {
  return (
    <section className="timeline-detail-card timeline-buff-list-card">
      <h3>已选 Buff</h3>
      <div className="timeline-buff-rows">
        {buffs.length === 0 ? <p className="timeline-detail-empty">暂无 Buff</p> : buffs.map((buff) => {
          const maxStacks = getMaxStacks(buff);
          const stackCount = Math.min(Math.max(stackCounts[buff.id] ?? maxStacks, 0), maxStacks);
          return (
            <article className={`timeline-buff-row${isDisabled(buff.id) ? ' is-disabled' : ''}`} key={buff.id}>
              <button
                type="button"
                className="timeline-buff-main"
                onContextMenu={(event) => {
                  event.preventDefault();
                  onToggleDisabled(buff.id);
                }}
              >
                <strong>{buff.displayName || buff.name}</strong>
                <span>{buff.sourceName || buff.source || '未知来源'}</span>
              </button>
              {buff.category === 'countable' ? (
                <div className="timeline-buff-stack">
                  <button type="button" onClick={() => onDecrement(buff.id)} disabled={stackCount <= 1}>−</button>
                  <span>{stackCount}/{maxStacks}</span>
                  <button type="button" onClick={() => onIncrement(buff)} disabled={stackCount >= maxStacks}>＋</button>
                </div>
              ) : null}
              <button
                type="button"
                className="timeline-buff-delete"
                onClick={() => onRemove(buff.id)}
                title="删除 Buff"
                aria-label={`删除 ${buff.displayName || buff.name}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 4h8l1 2h4v2H3V6h4l1-2Zm1 6h2v7H9v-7Zm4 0h2v7h-2v-7Zm4-1h2l-1 11H6L5 9h2l.8 9h8.4L17 9Z" />
                </svg>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
