import type { SkillButtonBuff } from '../../types/storage';

interface TimelineBuffListPanelProps {
  buffs: SkillButtonBuff[];
  stackCounts: Record<string, number>;
  onRemove: (buffId: string) => void;
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
            <article className="timeline-buff-row" key={buff.id}>
              <button
                type="button"
                className="timeline-buff-main"
                onContextMenu={(event) => {
                  event.preventDefault();
                  onRemove(buff.id);
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
            </article>
          );
        })}
      </div>
    </section>
  );
}
