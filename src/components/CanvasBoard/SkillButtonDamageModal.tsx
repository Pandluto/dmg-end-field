import type {
  AppliedBuffTagViewModel,
  SkillDamageModalViewModel,
} from '../../core/calculators/skillDamage.types';
import type { AnomalyDamageSegmentView } from './skillButton.shared';

interface DamageSummary {
  expected: number;
  crit: number;
  nonCrit: number;
}

interface SkillButtonDamageModalProps {
  isDamageReady: boolean;
  isPanelReady: boolean;
  damageViewModel: SkillDamageModalViewModel | null;
  anomalyDamageSummary: DamageSummary;
  totalNonCritSummaryFormula: string;
  anomalyDamageSegments: AnomalyDamageSegmentView[];
  activeAnomalySegment: AnomalyDamageSegmentView | null;
  isShowingAnomalyDetail: boolean;
  activeNormalHitKey: string | null;
  activeNormalHitSegmentKey: string | null;
  isActiveNormalHitDisabled: boolean;
  activeHitBuffOptions: AppliedBuffTagViewModel[];
  activeAnomalyBuffOptions: AppliedBuffTagViewModel[];
  isExpanded: boolean;
  isAnomalyFormulaExpanded: boolean;
  hasManualBuffTweaks: (segmentKey: string) => boolean;
  isBuffManuallyActive: (segmentKey: string, buffId: string) => boolean;
  onSelectHit: (index: number) => void;
  onSelectAnomalySegment: (segmentKey: string) => void;
  onToggleActiveNormalHit: () => void;
  onToggleManualBuff: (segmentKey: string, buffId: string) => void;
  onResetManualBuffTweaks: (segmentKey: string) => void;
  onToggleFormula: () => void;
}

export function SkillButtonDamageModal({
  isDamageReady,
  isPanelReady,
  damageViewModel,
  anomalyDamageSummary,
  totalNonCritSummaryFormula,
  anomalyDamageSegments,
  activeAnomalySegment,
  isShowingAnomalyDetail,
  activeNormalHitKey,
  activeNormalHitSegmentKey,
  isActiveNormalHitDisabled,
  activeHitBuffOptions,
  activeAnomalyBuffOptions,
  isExpanded,
  isAnomalyFormulaExpanded,
  hasManualBuffTweaks,
  isBuffManuallyActive,
  onSelectHit,
  onSelectAnomalySegment,
  onToggleActiveNormalHit,
  onToggleManualBuff,
  onResetManualBuffTweaks,
  onToggleFormula,
}: SkillButtonDamageModalProps) {
  const renderAppliedBuffButtons = (segmentKey: string | null, buffTags: AppliedBuffTagViewModel[]) => {
    if (buffTags.length === 0) {
      return <span className="no-buff">无</span>;
    }

    return buffTags.map((buff) => {
      const isSelected = segmentKey ? isBuffManuallyActive(segmentKey, buff.id) : true;
      return (
        <button
          type="button"
          key={buff.id}
          className={`buff-tag buff-tag-selectable${isSelected ? ' is-selected' : ''}`}
          onClick={() => segmentKey && onToggleManualBuff(segmentKey, buff.id)}
          title={`${isSelected ? '点击停用' : '点击恢复'}：${buff.displayLabel || buff.label} / ${buff.sourceName}`}
        >
          {buff.displayLabel || buff.label}
        </button>
      );
    });
  };

  const normalFormula = damageViewModel?.activeHitFormula ?? null;

  return (
    <div className="skill-button-modal skill-button-modal-damage">
      <h4>技能伤害</h4>
      <div className="modal-content">
        {!isDamageReady ? (
          <p className="skill-damage-empty">{!isPanelReady ? '加载面板数据...' : '加载技能模板中...'}</p>
        ) : !damageViewModel ? (
          <p className="skill-damage-empty">加载技能数据中...</p>
        ) : (
          <>
            <div className="skill-damage-summary">
              <p className="skill-damage-title">{damageViewModel.header.fullText}</p>
              <div className="skill-damage-total">
                <span>总伤(期望): {(Number(damageViewModel.summary.totalExpectedText) + anomalyDamageSummary.expected).toFixed(0)}</span>
                <span>总伤(暴击): {(Number(damageViewModel.summary.totalCritText) + anomalyDamageSummary.crit).toFixed(0)}</span>
                <span>总伤(非暴): {(Number(damageViewModel.summary.totalNonCritText) + anomalyDamageSummary.nonCrit).toFixed(0)}</span>
              </div>
              <p className="skill-damage-total-formula">总伤(非暴)步骤: {totalNonCritSummaryFormula}</p>
            </div>

            <div className="skill-damage-hits">
              {damageViewModel.hitCards.map((hitCard, index) => (
                <div
                  key={hitCard.key}
                  className={`skill-damage-hit-card${hitCard.isSelected ? ' selected' : ''}${hitCard.isDisabled ? ' is-disabled' : ''}`}
                  onClick={() => onSelectHit(index)}
                >
                  <div className="hit-card-header">
                    <div className="hit-card-title-group">
                      <span className="hit-name">{hitCard.displayName}</span>
                      <span className="buff-count">{hitCard.buffCountText}</span>
                    </div>
                    <span className="hit-multiplier">{hitCard.multiplierText}</span>
                  </div>
                  <div className="hit-card-damage">
                    <span className="damage-line">期望: <span className="damage-expected">{hitCard.expectedText}</span></span>
                    <span className="damage-line">暴击: <span className="damage-crit">{hitCard.critText}</span></span>
                    <span className="damage-line">非暴: <span className="damage-non-crit">{hitCard.nonCritText}</span></span>
                  </div>
                </div>
              ))}
              {anomalyDamageSegments.map((segment) => (
                <div
                  key={segment.key}
                  className={`skill-damage-hit-card${activeAnomalySegment?.key === segment.key ? ' selected' : ''}${segment.isDisabled ? ' is-disabled' : ''}`}
                  onClick={() => onSelectAnomalySegment(segment.key)}
                >
                  <div className="hit-card-header">
                    <div className="hit-card-title-group">
                      <span className="hit-name">{segment.sequenceTitle}</span>
                      <span className="buff-count">{segment.buffText}</span>
                      <span className="buff-count">{segment.compactTitle}</span>
                      <span className="buff-count">{segment.skillTypeText ? `${segment.skillTypeText} / ${segment.elementText}` : segment.elementText}</span>
                    </div>
                    <span className="hit-multiplier">{segment.multiplierText}</span>
                  </div>
                  <div className="hit-card-damage">
                    <span className="damage-line">期望: <span className="damage-expected">{segment.expectedText}</span></span>
                    <span className="damage-line">暴击: <span className="damage-crit">{segment.critText}</span></span>
                    <span className="damage-line">非暴: <span className="damage-non-crit">{segment.nonCritText}</span></span>
                  </div>
                </div>
              ))}
            </div>

            {!isShowingAnomalyDetail && damageViewModel.activeHitDetail && (
              <div className="skill-damage-hit-detail">
                <div className="hit-detail-head">
                  <p className="hit-detail-title">{damageViewModel.activeHitDetail.title}</p>
                  {activeNormalHitKey ? (
                    <button
                      type="button"
                      className={`hit-toggle-btn${isActiveNormalHitDisabled ? ' is-restore' : ''}`}
                      onClick={onToggleActiveNormalHit}
                      title={isActiveNormalHitDisabled ? '启用当前 hit 并重新计入总伤' : '禁用当前 hit 并从总伤中扣除'}
                    >
                      {isActiveNormalHitDisabled ? '启用本段' : '禁用本段'}
                    </button>
                  ) : null}
                </div>
                <div className="hit-detail-stats">
                  <p>倍率: {damageViewModel.activeHitDetail.multiplierText}</p>
                  <p>元素: {damageViewModel.activeHitDetail.elementText}</p>
                  <p>期望伤害: {damageViewModel.activeHitDetail.expectedText}</p>
                  <p>暴击伤害: {damageViewModel.activeHitDetail.critText}</p>
                  <p>非暴击伤害: {damageViewModel.activeHitDetail.nonCritText}</p>
                </div>
                <div className="hit-detail-buffs">
                  <div className="hit-detail-buffs-head">
                    <p className="buff-section-title">生效 Buff:</p>
                    {activeNormalHitSegmentKey && hasManualBuffTweaks(activeNormalHitSegmentKey) ? (
                      <button type="button" className="buff-reset-btn" onClick={() => onResetManualBuffTweaks(activeNormalHitSegmentKey)}>重置微调</button>
                    ) : null}
                  </div>
                  <p className="buff-section-tip">点按按钮可临时启停本次计算</p>
                  {renderAppliedBuffButtons(activeNormalHitSegmentKey, activeHitBuffOptions)}
                </div>
              </div>
            )}

            {isShowingAnomalyDetail && activeAnomalySegment && (
              <div className="skill-damage-hit-detail">
                <p className="hit-detail-title">{activeAnomalySegment.title}</p>
                <div className="hit-detail-stats">
                  <p>ATK: {activeAnomalySegment.panelAtkText}</p>
                  <p>暴击率: {activeAnomalySegment.critRateText}</p>
                  <p>暴击伤害: {activeAnomalySegment.critDmgText}</p>
                  <p>技能类型: {activeAnomalySegment.skillTypeText || '-'}</p>
                  <p>伤害类型: {activeAnomalySegment.elementText}</p>
                  <p>最终倍率: {activeAnomalySegment.multiplierText}</p>
                  {activeAnomalySegment.sourceKind === 'buff-extra-hit' && (
                    <>
                      <p>来源 Buff: {activeAnomalySegment.sourceBuffName || '-'}</p>
                      <p>失衡值: {activeAnomalySegment.imbalanceText || '-'}</p>
                      <p>冷却文案: {activeAnomalySegment.cooldownText || '-'}</p>
                    </>
                  )}
                  <p>期望伤害: {activeAnomalySegment.expectedText}</p>
                  <p>暴击伤害: {activeAnomalySegment.critText}</p>
                  <p>非暴击伤害: {activeAnomalySegment.nonCritText}</p>
                </div>
                <div className="hit-detail-buffs">
                  <div className="hit-detail-buffs-head">
                    <p className="buff-section-title">生效 Buff:</p>
                    {hasManualBuffTweaks(activeAnomalySegment.key) ? (
                      <button type="button" className="buff-reset-btn" onClick={() => onResetManualBuffTweaks(activeAnomalySegment.key)}>重置微调</button>
                    ) : null}
                  </div>
                  <p className="buff-section-tip">点按按钮可临时启停本次计算</p>
                  {renderAppliedBuffButtons(activeAnomalySegment.key, activeAnomalyBuffOptions)}
                </div>
              </div>
            )}

            {!isShowingAnomalyDetail && isExpanded && normalFormula && (
              <div className="skill-damage-expanded">
                <p className="skill-damage-expand-title">{normalFormula.title}</p>
                <div className="skill-damage-formula">
                  <p className="formula-section-title">【面板属性】</p>
                  {normalFormula.panelLines.map((line) => <p key={line}>{line}</p>)}
                  <p className="formula-section-title">【生效 Buff】</p>
                  {normalFormula.buffTags.length > 0 ? (
                    <div className="formula-buff-tags">
                      {normalFormula.buffTags.map((buff) => <span key={buff.id} className="buff-tag">{buff.displayLabel || buff.label}</span>)}
                    </div>
                  ) : <p>无</p>}

                  <div className="formula-zone-section">
                    <p className="formula-section-title">【倍率区】</p>
                    <p>基础倍率: {normalFormula.baseMultiplierText}</p>
                    <p>倍率 Buff 加算: {normalFormula.multiplierFormulaText}</p>
                    <p className="formula-zone-total">最终倍率 = {normalFormula.formulaText}</p>
                  </div>
                  <div className="formula-zone-section">
                    <p className="formula-section-title">【加成区】</p>
                    <p>元素伤害加成 {normalFormula.elementBonusText}</p>
                    <p>技能伤害加成 {normalFormula.skillBonusText}</p>
                    <p>全伤害加成 {normalFormula.allDamageBonusText}</p>
                    <p className="formula-zone-total">加成区系数 = {normalFormula.damageBonusFormulaText}</p>
                  </div>
                  <FormulaZone title="增幅区" label="法术/元素增幅" value={normalFormula.amplifyFormulaText} />
                  <FormulaZone title="易伤区" label="易伤效果" value={normalFormula.fragileFormulaText} />
                  <FormulaZone title="脆弱区" label="脆弱效果" value={normalFormula.vulnerabilityFormulaText} />
                  <FormulaZone title="连击区" label="连击增伤" value={normalFormula.comboFormulaText} />
                  <FormulaZone title="失衡区" label="失衡增伤" value={normalFormula.imbalanceFormulaText} />
                  <FormulaZone title="防御区" label="防御减免系数" value={normalFormula.defenseZoneText} />
                  <div className="formula-zone-section">
                    <p className="formula-section-title">【抗性区】</p>
                    <p>抗性 / 降抗 / 无视抗性</p>
                    <p>有效抗性: {normalFormula.resistanceEffectiveText}</p>
                    <p className="formula-zone-total">抗性区 = {normalFormula.resistanceFormulaText}</p>
                  </div>
                  <p className="formula-section-title">【结果】</p>
                  <p>非暴击总伤 = {normalFormula.nonCritFormulaText}</p>
                  <p>期望伤害: {normalFormula.expectedText}</p>
                  <p>暴击伤害: {normalFormula.critText}</p>
                  <p>非暴击伤害: {normalFormula.nonCritText}</p>
                </div>
              </div>
            )}

            {isShowingAnomalyDetail && activeAnomalySegment && isAnomalyFormulaExpanded && (
              <div className="skill-damage-expanded">
                <p className="skill-damage-expand-title">{activeAnomalySegment.title} 计算过程</p>
                <div className="skill-damage-formula">
                  <p className="formula-section-title">【面板属性】</p>
                  <p>ATK: {activeAnomalySegment.panelAtkText}</p>
                  <p>暴击率: {activeAnomalySegment.critRateText}</p>
                  <p>暴击伤害: {activeAnomalySegment.critDmgText}</p>
                  <p className="formula-section-title">【生效 Buff】</p>
                  {activeAnomalySegment.appliedBuffTags.length > 0 ? (
                    <div className="formula-buff-tags">
                      {activeAnomalySegment.appliedBuffTags.map((buff) => <span key={buff.id} className="buff-tag">{buff.displayLabel || buff.label}</span>)}
                    </div>
                  ) : <p>无</p>}
                  <div className="formula-zone-section">
                    <p className="formula-section-title">【倍率区】</p>
                    <p>基础倍率: {activeAnomalySegment.baseMultiplierText}</p>
                    <p>倍率 Buff 加算: {activeAnomalySegment.multiplierFormulaText}</p>
                    {activeAnomalySegment.sourceKind === 'anomaly' && (
                      <>
                        <p>源石技艺强度: {activeAnomalySegment.sourceSkillBoostText}</p>
                        <p>等级系数区: × {activeAnomalySegment.levelCoefficientText}</p>
                        <p>源石技艺强度区: × {activeAnomalySegment.sourceSkillZoneText}</p>
                      </>
                    )}
                    <p className="formula-zone-total">最终倍率 = {activeAnomalySegment.formulaText}</p>
                  </div>
                  <div className="formula-zone-section">
                    <p className="formula-section-title">【加成区】</p>
                    <p>元素伤害加成 {activeAnomalySegment.elementBonusText}</p>
                    <p>技能伤害加成 {activeAnomalySegment.skillBonusText}</p>
                    <p>全伤害加成 {activeAnomalySegment.allDamageBonusText}</p>
                    <p className="formula-zone-total">加成区系数 = 1 + {activeAnomalySegment.elementBonusText} + {activeAnomalySegment.skillBonusText} + {activeAnomalySegment.allDamageBonusText} = {activeAnomalySegment.damageBonusRateText}</p>
                  </div>
                  <FormulaZone title="增幅区" label="法术/元素增幅" value={activeAnomalySegment.amplifyFormulaText} />
                  <FormulaZone title="易伤区" label="易伤效果" value={activeAnomalySegment.fragileFormulaText} />
                  <FormulaZone title="脆弱区" label="脆弱效果" value={activeAnomalySegment.vulnerabilityFormulaText} />
                  <FormulaZone title="连击区" label="连击增伤" value={activeAnomalySegment.comboFormulaText} />
                  <FormulaZone title="失衡区" label="失衡增伤" value={activeAnomalySegment.imbalanceFormulaText} />
                  <FormulaZone title="防御区" label="防御减免系数" value={activeAnomalySegment.defenseZoneText} />
                  <div className="formula-zone-section">
                    <p className="formula-section-title">【抗性区】</p>
                    <p>抗性 / 降抗 / 无视抗性</p>
                    <p>有效抗性: {(Number(activeAnomalySegment.resistanceBaseText) - Number(activeAnomalySegment.corrosionText)).toFixed(1)}</p>
                    <p className="formula-zone-total">抗性区 = {activeAnomalySegment.resistanceFormulaText}</p>
                  </div>
                  {activeAnomalySegment.sourceKind === 'buff-extra-hit' && (
                    <div className="formula-zone-section">
                      <p className="formula-section-title">【附加信息】</p>
                      <p>来源 Buff: {activeAnomalySegment.sourceBuffName || '-'}</p>
                      <p>失衡值: {activeAnomalySegment.imbalanceText || '-'}</p>
                      <p>冷却文案: {activeAnomalySegment.cooldownText || '-'}</p>
                    </div>
                  )}
                  <p className="formula-section-title">【结果】</p>
                  <p>非暴击总伤 = {activeAnomalySegment.nonCritFormulaText}</p>
                  <p>期望伤害: {activeAnomalySegment.expectedText}</p>
                  <p>暴击伤害: {activeAnomalySegment.critText}</p>
                  <p>非暴击伤害: {activeAnomalySegment.nonCritText}</p>
                </div>
              </div>
            )}

            <button className="skill-damage-expand-btn" onClick={onToggleFormula}>
              {isShowingAnomalyDetail
                ? (isAnomalyFormulaExpanded ? '收起异常计算过程' : '展开异常计算过程')
                : (isExpanded ? '收起计算过程' : '展开计算过程')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FormulaZone({ title, label, value }: { title: string; label: string; value: string }) {
  return (
    <div className="formula-zone-section">
      <p className="formula-section-title">【{title}】</p>
      <p>{label}</p>
      <p className="formula-zone-total">{title} = {value}</p>
    </div>
  );
}
