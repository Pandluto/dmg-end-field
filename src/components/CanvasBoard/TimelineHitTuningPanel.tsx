import type { TimelineDetailActiveHit } from './TimelineSkillDetailWorkbench';

interface TimelineHitTuningPanelProps {
  activeHit: TimelineDetailActiveHit | null;
}

export function TimelineHitTuningPanel({ activeHit }: TimelineHitTuningPanelProps) {
  return (
    <section className="timeline-detail-card timeline-tuning-card">
      <h3>Hit 微调</h3>
      {!activeHit ? <p className="timeline-detail-empty">请选择 Hit</p> : (
        <>
          <header>
            <strong>{activeHit.title}</strong>
            {activeHit.onToggleDisabled ? (
              <button type="button" onClick={activeHit.onToggleDisabled}>
                {activeHit.disabled ? '启用本段' : '禁用本段'}
              </button>
            ) : null}
          </header>
          <p>{activeHit.stats.join(' · ')}</p>
          <div className="timeline-tuning-list">
            {activeHit.buffs.map((buff) => (
              <button
                type="button"
                key={buff.id}
                className={activeHit.isBuffActive(buff.id) ? 'is-active' : ''}
                onClick={() => activeHit.onToggleBuff(buff.id)}
              >
                {buff.displayLabel || buff.label}
              </button>
            ))}
          </div>
          {activeHit.onResetBuffs ? <button type="button" onClick={activeHit.onResetBuffs}>重置微调</button> : null}
        </>
      )}
    </section>
  );
}
