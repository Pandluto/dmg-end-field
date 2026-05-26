import { useState } from 'react';
import type { AnomalyStateSnapshot } from '../../types/storage';
import {
  ANOMALY_GROUPS,
  ANOMALY_STATE_OPTIONS,
  FIXED_STATE_OPTIONS,
  getAnomalyDurationOptions,
  isFixedStateKey,
  type AnomalyCardKind,
  type AnomalyCategory,
  type AnomalyOption,
  type BurnDamageMode,
  type DropdownOption,
  type SelectedAnomalyCard,
} from './skillButton.shared';

interface CharacterRef {
  id: string;
  name: string;
}

interface PreviewLines {
  lines: string[];
}

interface AnomalyStateOption {
  key: 'conductive' | 'corrosion' | 'armor-break';
  label: string;
  category: AnomalyCategory;
  supportsDuration?: boolean;
  levelOptions: number[];
}

interface DropdownFieldProps<T extends string | number> {
  dropdownKey: string;
  label: string;
  valueLabel: string;
  options: Array<DropdownOption<T>>;
  onSelect: (value: T) => void;
  disabled?: boolean;
}

function AnomalyDropdownField<T extends string | number>({
  dropdownKey,
  label,
  valueLabel,
  options,
  onSelect,
  disabled = false,
}: DropdownFieldProps<T>) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="anomaly-inline-control">
      <p className="anomaly-config-label">{label}</p>
      <div className={`anomaly-select-wrap${disabled ? ' is-disabled' : ''}`}>
        <button
          type="button"
          className="anomaly-select-trigger"
          onClick={() => {
            if (disabled) {
              return;
            }
            setIsOpen((prev) => !prev);
          }}
          disabled={disabled}
        >
          <span className="anomaly-select-value">{valueLabel}</span>
          <span className="anomaly-select-arrow">{isOpen ? '▲' : '▼'}</span>
        </button>
        {!disabled && isOpen ? (
          <div className="anomaly-select-menu">
            {options.map((option) => (
              <button
                type="button"
                key={`${dropdownKey}-${option.value}`}
                className="anomaly-select-option"
                onClick={() => {
                  onSelect(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface SkillButtonStatePanelProps {
  activeAnomaly: AnomalyOption | null;
  activeAnomalyLevel: number;
  activeAnomalyPreview: PreviewLines | null;
  selectedStatusCards: SelectedAnomalyCard[];
  onSelectAnomaly: (option: AnomalyOption) => void;
  onApplyActiveAnomaly: () => void;
  onSetActiveAnomalyLevel: (level: number) => void;
  onRemoveAnomalyCard: (kind: AnomalyCardKind, cardId: string) => void;
}

export function SkillButtonStatePanel({
  activeAnomaly,
  activeAnomalyLevel,
  activeAnomalyPreview,
  selectedStatusCards,
  onSelectAnomaly,
  onApplyActiveAnomaly,
  onSetActiveAnomalyLevel,
  onRemoveAnomalyCard,
}: SkillButtonStatePanelProps) {
  return (
    <div className="modal-content skill-anomaly-layout">
      <div className="skill-anomaly-tree">
        <div className="anomaly-status-section">
          <p className="skill-anomaly-board-title">状态区</p>
          <div className="anomaly-button-strip">
            {FIXED_STATE_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={`anomaly-strip-button${activeAnomaly?.key === option.key ? ' is-active' : ''}`}
                onClick={() => onSelectAnomaly(option)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {activeAnomaly && isFixedStateKey(activeAnomaly.key) ? (
          <div className="anomaly-inline-panel">
            <div className="anomaly-inline-panel-head">
              <div>
                <p className="anomaly-config-title">{activeAnomaly.label}</p>
                <p className="anomaly-config-subtitle">{activeAnomaly.key === 'combo-state' ? '状态区连击增伤' : '状态区固定加成'}</p>
              </div>
              <button className="anomaly-apply-btn" onClick={onApplyActiveAnomaly}>加入蓝框</button>
            </div>

            {activeAnomaly.usesAnomalyLevel !== false ? (
              <div className="anomaly-inline-control-grid">
                <div className="anomaly-inline-control">
                  <p className="anomaly-config-label">层数</p>
                  <div className="anomaly-button-strip">
                    {activeAnomaly.levelOptions.map((level) => (
                      <button
                        key={`${activeAnomaly.key}-level-${level}`}
                        type="button"
                        className={`anomaly-strip-button${activeAnomalyLevel === level ? ' is-active' : ''}`}
                        onClick={() => onSetActiveAnomalyLevel(level)}
                      >
                        <span>{level} 层</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="anomaly-live-preview">
              {activeAnomalyPreview ? (
                activeAnomalyPreview.lines.map((line) => (
                  <p key={line} className="anomaly-live-line">{line}</p>
                ))
              ) : (
                <p className="anomaly-live-line">请选择状态项</p>
              )}
            </div>
          </div>
        ) : (
          <div className="anomaly-live-preview">
            <p className="anomaly-live-line">请选择状态项</p>
          </div>
        )}
      </div>

      <div className="skill-anomaly-config">
        <div className="skill-anomaly-board skill-anomaly-board-fixed">
          <div className="skill-anomaly-board-section">
            <p className="skill-anomaly-board-title">已选状态区</p>
            <div className="skill-anomaly-board-list">
              {selectedStatusCards.length === 0 ? (
                <div className="skill-button-buff-empty">连击 / 失衡 会显示在这里</div>
              ) : (
                selectedStatusCards.map((card) => (
                  <div
                    key={card.id}
                    className="anomaly-board-card is-state"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onRemoveAnomalyCard('state', card.id);
                    }}
                    title="右键移除"
                  >
                    <span className="anomaly-board-card-title">{card.primaryText}</span>
                    <span>{card.secondaryText}</span>
                    {card.tertiaryText ? <span>{card.tertiaryText}</span> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SkillButtonAnomalyStatePanelProps {
  activeAnomalyStateOption: AnomalyStateOption | null;
  activeAnomalyStateLevel: number;
  activeAnomalyStateDurationSeconds: number;
  activeAnomalyStatePreview: PreviewLines | null;
  activeAnomalyStateSourceCharacter: CharacterRef | null;
  sourceCharacters: CharacterRef[];
  selectedAnomalyStateSnapshots: AnomalyStateSnapshot[];
  availableAnomalyStateSnapshots: AnomalyStateSnapshot[];
  anomalyStateSnapshotUsageCounts: Map<number, number>;
  onSelectAnomalyState: (key: 'conductive' | 'corrosion' | 'armor-break') => void;
  onCreateSnapshot: () => void;
  onSetActiveAnomalyStateLevel: (level: number) => void;
  onSetActiveAnomalyStateSourceId: (id: string) => void;
  onSetActiveAnomalyStateDurationSeconds: (seconds: number) => void;
  onRemoveAnomalyStateSnapshotCard: (snapshotId: number) => void;
  onAttachAnomalyStateSnapshotCard: (snapshotId: number) => void;
  onDeleteAnomalyStateSnapshotCard: (snapshotId: number) => void;
}

export function SkillButtonAnomalyStatePanel({
  activeAnomalyStateOption,
  activeAnomalyStateLevel,
  activeAnomalyStateDurationSeconds,
  activeAnomalyStatePreview,
  activeAnomalyStateSourceCharacter,
  sourceCharacters,
  selectedAnomalyStateSnapshots,
  availableAnomalyStateSnapshots,
  anomalyStateSnapshotUsageCounts,
  onSelectAnomalyState,
  onCreateSnapshot,
  onSetActiveAnomalyStateLevel,
  onSetActiveAnomalyStateSourceId,
  onSetActiveAnomalyStateDurationSeconds,
  onRemoveAnomalyStateSnapshotCard,
  onAttachAnomalyStateSnapshotCard,
  onDeleteAnomalyStateSnapshotCard,
}: SkillButtonAnomalyStatePanelProps) {
  return (
    <div className="modal-content skill-anomaly-layout">
      <div className="skill-anomaly-tree">
        <div className="anomaly-status-section">
          <p className="skill-anomaly-board-title">异常状态区</p>
          <div className="anomaly-button-strip">
            {ANOMALY_STATE_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={`anomaly-strip-button${activeAnomalyStateOption?.key === option.key ? ' is-active' : ''}`}
                onClick={() => onSelectAnomalyState(option.key)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {activeAnomalyStateOption ? (
          <div className="anomaly-inline-panel">
            <div className="anomaly-inline-panel-head">
              <div>
                <p className="anomaly-config-title">{activeAnomalyStateOption.label}</p>
                <p className="anomaly-config-subtitle">异常状态快照 Buff</p>
              </div>
              <button className="anomaly-apply-btn" onClick={onCreateSnapshot}>创建快照</button>
            </div>

            <div className="anomaly-inline-control-grid">
              <AnomalyDropdownField
                dropdownKey={`${activeAnomalyStateOption.key}-snapshot-level`}
                label="异常等级"
                valueLabel={`${activeAnomalyStateLevel} 层`}
                options={activeAnomalyStateOption.levelOptions.map((level) => ({ value: level, label: `${level} 层` }))}
                onSelect={(value) => onSetActiveAnomalyStateLevel(Number(value))}
              />
              <AnomalyDropdownField
                dropdownKey={`${activeAnomalyStateOption.key}-snapshot-source`}
                label="来源角色"
                valueLabel={activeAnomalyStateSourceCharacter?.name ?? '未选择'}
                options={sourceCharacters.map((character) => ({ value: character.id, label: character.name }))}
                onSelect={(value) => onSetActiveAnomalyStateSourceId(String(value))}
              />
              {activeAnomalyStateOption.supportsDuration ? (
                <AnomalyDropdownField
                  dropdownKey={`${activeAnomalyStateOption.key}-snapshot-duration`}
                  label="持续时间"
                  valueLabel={`${activeAnomalyStateDurationSeconds || 0}s`}
                  options={getAnomalyDurationOptions({ ...activeAnomalyStateOption, kind: 'state', supportsSource: true }).map((seconds) => ({
                    value: seconds,
                    label: `${seconds}s`,
                  }))}
                  onSelect={(value) => onSetActiveAnomalyStateDurationSeconds(Number(value))}
                />
              ) : null}
            </div>

            <div className="anomaly-live-preview">
              {activeAnomalyStatePreview ? (
                activeAnomalyStatePreview.lines.map((line) => (
                  <p key={line} className="anomaly-live-line">{line}</p>
                ))
              ) : (
                <p className="anomaly-live-line">请选择异常状态项</p>
              )}
            </div>
          </div>
        ) : (
          <div className="anomaly-live-preview">
            <p className="anomaly-live-line">请选择异常状态项</p>
          </div>
        )}
      </div>

      <div className="skill-anomaly-config">
        <div className="skill-anomaly-board skill-anomaly-board-fixed">
          <div className="skill-anomaly-board-section">
            <p className="skill-anomaly-board-title">已选异常状态快照</p>
            <div className="skill-anomaly-board-list">
              {selectedAnomalyStateSnapshots.length === 0 ? (
                <div className="skill-button-buff-empty">导电 / 腐蚀 / 碎甲 快照会显示在这里</div>
              ) : (
                selectedAnomalyStateSnapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="anomaly-board-card is-state"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onRemoveAnomalyStateSnapshotCard(snapshot.id);
                    }}
                    title="右键从当前角色卸载"
                  >
                    <span className="anomaly-board-card-title">{snapshot.primaryText}</span>
                    <span>{snapshot.secondaryText}</span>
                    {snapshot.tertiaryText ? <span>{snapshot.tertiaryText}</span> : null}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="skill-anomaly-board-section">
            <p className="skill-anomaly-board-title">缓存异常状态快照</p>
            <div className="skill-anomaly-board-list">
              {availableAnomalyStateSnapshots.length === 0 ? (
                <div className="skill-button-buff-empty">暂无可挂载快照，先在任意角色创建导电 / 腐蚀 / 碎甲快照</div>
              ) : (
                availableAnomalyStateSnapshots.map((snapshot) => {
                  const usageCount = anomalyStateSnapshotUsageCounts.get(snapshot.id) ?? 0;
                  return (
                    <div
                      key={`available-${snapshot.id}`}
                      className="anomaly-board-card is-state"
                      onClick={() => onAttachAnomalyStateSnapshotCard(snapshot.id)}
                      title="单击挂载到当前角色"
                    >
                      <div className="anomaly-board-card-topline">
                        <span className="anomaly-board-card-title">{snapshot.primaryText}</span>
                        <button
                          type="button"
                          className="anomaly-board-card-delete-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteAnomalyStateSnapshotCard(snapshot.id);
                          }}
                          disabled={usageCount > 0}
                          title={usageCount > 0 ? '该快照仍被界面中的项目引用，无法删除' : '删除缓存快照'}
                        >
                          删除
                        </button>
                      </div>
                      <span>{snapshot.secondaryText}</span>
                      {snapshot.tertiaryText ? <span>{snapshot.tertiaryText}</span> : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SkillButtonAnomalyPanelProps {
  activeAnomaly: AnomalyOption | null;
  activeAnomalyGroup: AnomalyCategory;
  activeAnomalyLevel: number;
  activeAnomalyPreview: PreviewLines | null;
  activeSourceCharacter: CharacterRef | null;
  sourceCharacters: CharacterRef[];
  selectedAnomalyDamages: SelectedAnomalyCard[];
  activeDurationSeconds: number;
  burnDamageMode: BurnDamageMode;
  onSetActiveAnomalyGroup: (group: AnomalyCategory) => void;
  onResetActiveAnomalyKey: () => void;
  onSelectAnomaly: (option: AnomalyOption) => void;
  onApplyActiveAnomaly: () => void;
  onSetActiveAnomalyLevel: (level: number) => void;
  onSetActiveAnomalySourceId: (id: string) => void;
  onSetBurnDamageMode: (mode: BurnDamageMode) => void;
  onSetActiveDurationSeconds: (seconds: number) => void;
  onRemoveAnomalyCard: (kind: AnomalyCardKind, cardId: string) => void;
}

export function SkillButtonAnomalyPanel({
  activeAnomaly,
  activeAnomalyGroup,
  activeAnomalyLevel,
  activeAnomalyPreview,
  activeSourceCharacter,
  sourceCharacters,
  selectedAnomalyDamages,
  activeDurationSeconds,
  burnDamageMode,
  onSetActiveAnomalyGroup,
  onResetActiveAnomalyKey,
  onSelectAnomaly,
  onApplyActiveAnomaly,
  onSetActiveAnomalyLevel,
  onSetActiveAnomalySourceId,
  onSetBurnDamageMode,
  onSetActiveDurationSeconds,
  onRemoveAnomalyCard,
}: SkillButtonAnomalyPanelProps) {
  return (
    <div className="modal-content skill-anomaly-layout">
      <div className="skill-anomaly-tree">
        <div className="anomaly-category-tabs">
          {ANOMALY_GROUPS.map((group) => (
            <button
              key={group.key}
              className={`anomaly-category-tab${activeAnomalyGroup === group.key ? ' is-active' : ''}`}
              onClick={() => {
                onSetActiveAnomalyGroup(group.key);
                onResetActiveAnomalyKey();
              }}
            >
              {group.label}
            </button>
          ))}
        </div>

        <div className="anomaly-button-strip">
          {ANOMALY_GROUPS.find((group) => group.key === activeAnomalyGroup)?.items.map((option) => (
            <button
              key={option.key}
              className={`anomaly-strip-button${activeAnomaly?.key === option.key ? ' is-active' : ''}`}
              onClick={() => onSelectAnomaly(option)}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        {activeAnomaly ? (
          <div className="anomaly-inline-panel">
            <div className="anomaly-inline-panel-head">
              <div>
                <p className="anomaly-config-title">{activeAnomaly.label}</p>
                <p className="anomaly-config-subtitle">异常伤害演示</p>
              </div>
              <button className="anomaly-apply-btn" onClick={onApplyActiveAnomaly}>加入蓝框</button>
            </div>

            <div className="anomaly-inline-control-grid">
              {activeAnomaly.usesAnomalyLevel !== false ? (
                <AnomalyDropdownField
                  dropdownKey={`${activeAnomaly.key}-level`}
                  label="异常等级"
                  valueLabel={`${activeAnomalyLevel} 层`}
                  options={activeAnomaly.levelOptions.map((level) => ({ value: level, label: `${level} 层` }))}
                  onSelect={(value) => onSetActiveAnomalyLevel(Number(value))}
                />
              ) : (
                <AnomalyDropdownField
                  dropdownKey={`${activeAnomaly.key}-level`}
                  label="异常等级"
                  valueLabel="不适用"
                  options={[]}
                  onSelect={() => {}}
                  disabled
                />
              )}

              {activeAnomaly.supportsSource ? (
                <AnomalyDropdownField
                  dropdownKey={`${activeAnomaly.key}-source`}
                  label="来源角色"
                  valueLabel={activeSourceCharacter?.name ?? '未选择'}
                  options={sourceCharacters.map((character) => ({ value: character.id, label: character.name }))}
                  onSelect={(value) => onSetActiveAnomalySourceId(String(value))}
                />
              ) : activeAnomaly.supportsDotToggle ? (
                <AnomalyDropdownField
                  dropdownKey={`${activeAnomaly.key}-mode`}
                  label="结果口径"
                  valueLabel={
                    burnDamageMode === 'dotOnly'
                      ? '仅计入持续段'
                      : burnDamageMode === 'splitDot'
                        ? '分开计入持续段'
                        : '仅计入初始段'
                  }
                  options={[
                    { value: 'dotOnly', label: '仅计入持续段' },
                    { value: 'initialOnly', label: '仅计入初始段' },
                    { value: 'splitDot', label: '分开计入持续段' },
                  ]}
                  onSelect={(value) => {
                    onSetBurnDamageMode(value as BurnDamageMode);
                  }}
                />
              ) : (
                <AnomalyDropdownField
                  dropdownKey={`${activeAnomaly.key}-mode`}
                  label="结果口径"
                  valueLabel="独立 hit"
                  options={[]}
                  onSelect={() => {}}
                  disabled
                />
              )}

              {activeAnomaly.supportsDuration ? (
                <AnomalyDropdownField
                  dropdownKey={`${activeAnomaly.key}-duration`}
                  label="持续时间"
                  valueLabel={`${activeDurationSeconds || 0}s`}
                  options={getAnomalyDurationOptions(activeAnomaly).map((seconds) => ({ value: seconds, label: `${seconds}s` }))}
                  onSelect={(value) => onSetActiveDurationSeconds(Number(value))}
                />
              ) : null}
            </div>

            <div className="anomaly-live-preview">
              {activeAnomalyPreview ? (
                activeAnomalyPreview.lines.map((line) => (
                  <p key={line} className="anomaly-live-line">{line}</p>
                ))
              ) : (
                <p className="anomaly-live-line">请选择异常项</p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="skill-anomaly-config">
        <div className="skill-anomaly-board skill-anomaly-board-fixed">
          <div className="skill-anomaly-board-section">
            <p className="skill-anomaly-board-title">已选异常伤害</p>
            <div className="skill-anomaly-board-list">
              {selectedAnomalyDamages.length === 0 ? (
                <div className="skill-button-buff-empty">导电 / 腐蚀 / 燃烧 / 冻结 / 碎冰 / 法爆 / 倒地 / 击飞 / 碎甲 / 猛击 会显示在这里</div>
              ) : (
                selectedAnomalyDamages.map((card) => (
                  <div
                    key={card.id}
                    className="anomaly-board-card is-damage"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onRemoveAnomalyCard('damage', card.id);
                    }}
                    title="右键移除"
                  >
                    <span className="anomaly-board-card-title">{card.primaryText}</span>
                    <span>{card.secondaryText}</span>
                    {card.tertiaryText ? <span>{card.tertiaryText}</span> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
