import type { TimelineDetailStatus } from './TimelineSkillDetailWorkbench';

interface TimelineStatusPanelProps {
  statuses: TimelineDetailStatus[];
}

export function TimelineStatusPanel({ statuses }: TimelineStatusPanelProps) {
  return (
    <section className="timeline-detail-card timeline-status-card">
      <h3>已选状态 / 异常</h3>
      <div className="timeline-status-list">
        {statuses.length === 0 ? <p className="timeline-detail-empty">暂无状态或异常</p> : statuses.map((status) => (
          <button
            type="button"
            key={status.key}
            onContextMenu={(event) => {
              event.preventDefault();
              status.onRemove();
            }}
            title={`${status.detail || ''} · 右键移除`}
          >
            <small>{status.kind}</small>
            <span>{status.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
