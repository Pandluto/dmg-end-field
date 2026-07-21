import type { SkillButton as SkillButtonType, TimelineData } from '../../types';
import type { HitResistanceInput } from '../../types/storage';
import DeferredNumberInput from '../DeferredNumberInput';
import type { useSkillButtonAnomaly } from './useSkillButtonAnomaly';
import type { useSkillButtonRuntime } from './useSkillButtonRuntime';

interface SkillButtonInfoModalProps {
  anomaly: ReturnType<typeof useSkillButtonAnomaly>;
  button: SkillButtonType & { nodeNumber?: number };
  characterName: string;
  currentSkillLevelMode: string;
  displayName: string;
  isLocked: boolean;
  onClose: () => void;
  onToggleLock: () => void;
  runtime: ReturnType<typeof useSkillButtonRuntime>;
  skillType: string;
  timelineData?: TimelineData;
}

const RESISTANCE_FIELDS: Array<[keyof HitResistanceInput, string]> = [
  ['physicalResistance', '物理'],
  ['fireResistance', '灼热'],
  ['electricResistance', '电磁'],
  ['iceResistance', '寒冷'],
  ['natureResistance', '自然'],
];

export function SkillButtonInfoModal({
  anomaly,
  button,
  characterName,
  currentSkillLevelMode,
  displayName,
  isLocked,
  onClose,
  onToggleLock,
  runtime,
  skillType,
  timelineData,
}: SkillButtonInfoModalProps) {
  const {
    buffList,
    buttonStackCounts,
    decrementBuffStack,
    incrementBuffStack,
    isTargetResistanceExpanded,
    removeBuff,
    setIsTargetResistanceExpanded,
    targetResistance,
    updateTargetResistance,
  } = runtime;
  const {
    removeAnomalyCard,
    removeAnomalyStateSnapshotCard,
    selectedAnomalyDamages,
    selectedAnomalyStateSnapshots,
    selectedStatusCards,
  } = anomaly;
  const staffLine = timelineData?.staffLines?.find((line) => line.staffIndex === button.lineIndex);
  const timelineButton = staffLine?.buttons?.find((item) => item.id === button.id);

  return (
    <div className="skill-button-modal skill-button-modal-info">
      <div className="modal-header">
        <h4 className="modal-title">技能信息</h4>
        <button
          className={`lock-control ${isLocked ? 'is-locked' : ''}`}
          onClick={onToggleLock}
          title={isLocked ? '点击解锁，解锁后可右键删除' : '点击锁定，锁定后右键不能删除'}
        >
          <span className="lock-icon">{isLocked ? '🔒' : '🔓'}</span>
          <span className="lock-text">{isLocked ? '已锁定' : '未锁定'}</span>
        </button>
      </div>
      <div className="modal-content">
        <p><strong>角色:</strong> {characterName}</p>
        <p><strong>技能:</strong> {skillType} / {displayName} <strong>{currentSkillLevelMode}</strong></p>
        <p><strong>干员索引:</strong> {button.lineIndex}</p>
        {timelineButton ? (
          <>
            <p><strong>节点索引:</strong> {timelineButton.nodeIndex}</p>
            <p><strong>节点编号:</strong> {timelineButton.nodeNumber}</p>
          </>
        ) : null}
      </div>

      <div className="skill-button-buff-section skill-button-resistance-section">
        <button
          type="button"
          className="skill-button-resistance-toggle"
          onClick={() => setIsTargetResistanceExpanded((expanded) => !expanded)}
        >
          <span>目标抗性</span>
          <span>{isTargetResistanceExpanded ? '收起' : '展开'}</span>
        </button>
        {isTargetResistanceExpanded ? (
          <div className="skill-button-resistance-grid">
            {RESISTANCE_FIELDS.map(([key, label]) => (
              <label key={key} className="skill-button-resistance-field">
                <span>{label}</span>
                <DeferredNumberInput
                  step="1"
                  value={targetResistance[key] ?? 0}
                  onCommit={(value) => updateTargetResistance(key, value ?? 0)}
                />
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div className="skill-button-buff-section">
        <h5>已选 Buff</h5>
        <div className="skill-button-buff-list">
          {buffList.length === 0 ? (
            <div className="skill-button-buff-empty">按 Tab 从 Buff组、干员、武器或装备入口添加</div>
          ) : buffList.map((buff) => {
            const isCountable = buff.category === 'countable';
            const maxStacks = typeof buff.maxStacks === 'number' && Number.isFinite(buff.maxStacks)
              ? Math.max(1, Math.floor(buff.maxStacks))
              : 1;
            const stackCount = Math.min(Math.max(Math.floor(buttonStackCounts[buff.id] ?? maxStacks), 0), maxStacks);
            return (
              <div
                key={buff.id}
                className="skill-button-buff-item"
                title={`${buff.displayName} (${buff.sourceName})${isCountable ? ` ${stackCount}/${maxStacks}` : ''}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  removeBuff(buff.id);
                }}
              >
                <span>{buff.displayName}</span>
                {isCountable ? (
                  <span className="skill-button-buff-stack-controls">
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); decrementBuffStack(buff.id); }}
                      disabled={stackCount <= 1}
                      title={stackCount <= 1 ? '已是最低 1 层，右键删除 Buff' : '减少 1 层'}
                    >-</button>
                    <span>{stackCount}/{maxStacks}</span>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); incrementBuffStack(buff); }}
                      disabled={stackCount >= maxStacks}
                      title={stackCount >= maxStacks ? '已达到最大层数' : '增加 1 层'}
                    >+</button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="skill-button-buff-section skill-button-anomaly-summary-section">
        <h5>已选状态 / 异常</h5>
        <div className="skill-button-anomaly-summary-list">
          {[...selectedStatusCards, ...selectedAnomalyStateSnapshots, ...selectedAnomalyDamages].length === 0 ? (
            <div className="skill-button-buff-empty">按 Tab 打开状态区、异常状态区或异常伤害页勾选要演示的项</div>
          ) : [
            ...selectedStatusCards,
            ...selectedAnomalyStateSnapshots.map((snapshot) => ({ ...snapshot, kind: 'state' as const })),
            ...selectedAnomalyDamages,
          ].map((card) => (
            <div
              key={card.id}
              className={`skill-button-anomaly-summary-card is-${card.kind}`}
              onContextMenu={(event) => {
                event.preventDefault();
                if (typeof card.id === 'number') {
                  removeAnomalyStateSnapshotCard(card.id);
                  return;
                }
                removeAnomalyCard(card.kind, card.id);
              }}
              title="右键移除"
            >
              <div className="anomaly-summary-head">
                <span className="anomaly-summary-kind">{card.kind === 'state' ? '状态' : '伤害'}</span>
                <span className="anomaly-summary-title">{card.primaryText}</span>
              </div>
              <p>{card.secondaryText}</p>
              {card.tertiaryText ? <p>{card.tertiaryText}</p> : null}
            </div>
          ))}
        </div>
      </div>

      <button className="modal-close-btn" onClick={onClose}>关闭</button>
    </div>
  );
}
