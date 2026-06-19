import type { TimelineDetailActiveHit } from './TimelineSkillDetailWorkbench';

interface TimelineHitTuningPanelProps {
  activeHit: TimelineDetailActiveHit | null;
  compact?: boolean;
}

export function TimelineHitTuningPanel({ activeHit, compact = false }: TimelineHitTuningPanelProps) {
  if (compact) {
    if (!activeHit) {
      return null;
    }

    return (
      <div className="timeline-tuning-inline-actions">
        {activeHit.buffs.map((buff) => {
          const isCountable = buff.isCountable && typeof buff.maxStacks === 'number';
          const stackCount = buff.stackCount ?? buff.maxStacks ?? 1;
          return (
            <span
              className={`timeline-tuning-inline-item${activeHit.isBuffActive(buff.id) ? ' is-active' : ''}${isCountable ? ' is-countable' : ''}`}
              key={buff.id}
            >
              <button
                type="button"
                onClick={() => activeHit.onToggleBuff(buff.id)}
              >
                {buff.label}
              </button>
              {isCountable ? (
                <span className="timeline-tuning-inline-stack">
                  <button
                    type="button"
                    onClick={() => activeHit.onDecrementBuff?.(buff.id)}
                    disabled={stackCount <= 1}
                  >
                    −
                  </button>
                  <span>{stackCount}层</span>
                  <button
                    type="button"
                    onClick={() => activeHit.onIncrementBuff?.(buff.id)}
                    disabled={stackCount >= (buff.maxStacks ?? 1)}
                  >
                    ＋
                  </button>
                </span>
              ) : null}
            </span>
          );
        })}
        {activeHit.onToggleDisabled ? (
          <button type="button" className="is-danger" onClick={activeHit.onToggleDisabled}>
            {activeHit.disabled ? '启用本段' : '禁用本段'}
          </button>
        ) : null}
        {activeHit.onResetBuffs ? (
          <button type="button" onClick={activeHit.onResetBuffs}>重置</button>
        ) : null}
      </div>
    );
  }

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
