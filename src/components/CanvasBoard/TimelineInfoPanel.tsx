interface TimelineInfoPanelProps {
  lines: string[];
}

export function TimelineInfoPanel({ lines }: TimelineInfoPanelProps) {
  return (
    <section className="timeline-detail-card timeline-info-card">
      <h3>信息</h3>
      {lines.length > 0 ? (
        <pre>{lines.join('\n')}</pre>
      ) : (
        <p className="timeline-detail-empty">暂无信息快照</p>
      )}
    </section>
  );
}
