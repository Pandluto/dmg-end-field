import type { HitResistanceInput } from '../../types/storage';
import DeferredNumberInput from '../DeferredNumberInput';

interface TimelineTargetResistancePanelProps {
  value: Required<HitResistanceInput>;
  onChange: (key: keyof HitResistanceInput, value: number) => void;
}

const FIELDS: Array<[keyof HitResistanceInput, string]> = [
  ['physicalResistance', '物理'],
  ['fireResistance', '灼热'],
  ['electricResistance', '电磁'],
  ['iceResistance', '寒冷'],
  ['natureResistance', '自然'],
];

export function TimelineTargetResistancePanel({
  value,
  onChange,
}: TimelineTargetResistancePanelProps) {
  return (
    <section className="timeline-detail-card timeline-resistance-card">
      <h3>目标抗性</h3>
      <div className="timeline-resistance-fields">
        {FIELDS.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <DeferredNumberInput
              step="1"
              value={value[key] ?? 0}
              onCommit={(nextValue) => onChange(key, nextValue ?? 0)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
