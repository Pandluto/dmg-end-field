import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { SkillButton as SkillButtonType, SKILL_LABELS, TimelineData } from '../../types';
import { getElementBackgroundColor } from '../../utils/assetResolver';
import {
  removeSkillButtonBuff,
  setSelectedSkillButton,
  getButtonBuffs,
  recomputeSkillButtonPanel,
} from '../../hooks/useSkillButtonBuffs';
import { SkillButtonBuff, SkillLevelMode } from '../../types/storage';
import { getCharacterConfig } from '../../utils/storage';
import { getSkillButtonById } from '../../core/repositories';
import {
  buildSkillDamageModalViewModel,
} from '../../core/calculators/skillDamageModalViewModel';
import { calculateSkillButtonDamageV2 } from '../../core/calculators/skillButtonDamageCalculatorV2';
import type { ResolvedSkillDamageTemplate } from '../../core/calculators/skillDamage.types';
import { resolveSkillDamageTemplate } from '../../core/services/skillDamageTemplateResolver';
import { useAppContext } from '../../context/AppContext';
import { emitSkillButtonBuffRemoved, onSkillButtonBuffAdded } from '../../core/events/buffEvents';
import './SkillButton.css';

interface SkillButtonProps {
  button: SkillButtonType & { nodeNumber?: number };
  size: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  timelineData?: TimelineData;
  onModalOpen?: () => void;
  onModalClose?: () => void;
  contextMenuState?: { buttonId: string; position: { x: number; y: number } } | null;
  onConfirmRemove?: () => void;
  onCloseContextMenu?: () => void;
  onCopy?: () => void;
  onChangeSkillType?: (buttonId: string, nextSkillType: 'A' | 'B' | 'E' | 'Q') => void;
}

export function SkillButtonComponent({ button, size, onMouseDown, onContextMenu, timelineData, onModalOpen, onModalClose, contextMenuState, onConfirmRemove, onCloseContextMenu, onCopy, onChangeSkillType }: SkillButtonProps) {
  /**
   * position.y 语义约定（v1.1.0+）：
   * - position.x: 按钮碰撞箱左边界（原始值，未做视觉偏移）
   * - position.y: 底座中线（不是圆心！）
   *   渲染时通过 `top: position.y - radius - visualOffsetY` 转换为 CSS top
   *   其中 visualOffsetY = 15，用于对齐谱线中心
   *
   * 恢复兼容性说明：
   * - timeline version < 1.1.0 时：CanvasBoard 恢复链直接使用缓存中的 position.y
   * - timeline version >= 1.1.0 时：CanvasBoard 恢复链按 nodeIndex + lineIndex 重建标准 Y
   * - 本组件只消费最终的 position.y，不再区分旧缓存/新缓存细节
   */
  const { position, skillType, isSelected, isDragging, characterName, skillIconUrl, element, isLocked, skillDisplayName } = button;
  const displayName = skillDisplayName || SKILL_LABELS[skillType];
  const { dispatch } = useAppContext();
  const radius = size / 2;
  const baseWidth = 80;
  const baseHeight = 30;
  const visualOffsetX = 40;
  const visualOffsetY = 15;
  const hitWidth = radius + baseWidth;
  const hitHeight = Math.max(size, radius + baseHeight);

  // 弹窗显示状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  // 当前技能按钮的 Buff 列表
  const [buffList, setBuffList] = useState<SkillButtonBuff[]>([]);
  // 当前角色的技能等级模式 (L9/M3)
  const [skillLevelModeMap, setSkillLevelModeMap] = useState<Record<string, SkillLevelMode>>({ A: 'L9', B: 'L9', E: 'L9', Q: 'L9' });
  // 已解析的技能伤害模板（skill 是容器，hit 是计算单元）
  const [resolvedTemplate, setResolvedTemplate] = useState<ResolvedSkillDamageTemplate | null>(null);

  // 当前选中的 hit（用于详情展示）
  const [selectedHitIndex, setSelectedHitIndex] = useState<number | null>(null);

  // 面板数据 (ATK、暴击、伤害加成等)
  const [panelData, setPanelData] = useState<{
    atk: number;
    critRate: number;
    critDmg: number;
    physicalDmgBonus: number;
    fireDmgBonus: number;
    electricDmgBonus: number;
    iceDmgBonus: number;
    natureDmgBonus: number;
    skillDmgBonus: number;
    chainSkillDmgBonus: number;
    ultimateDmgBonus: number;
    allSkillDmgBonus: number;
    allDmgBonus: number;
  } | null>(null);
  // 计算过程展开状态
  const [isExpanded, setIsExpanded] = useState(false);
  // infoSnapshot 数据（从 sessionStorage 只读，不影响原数据）
  const [infoSnapshotLines, setInfoSnapshotLines] = useState<string[]>([]);
  // infoSnap JSON 数据（从 sessionStorage 只读，不影响原数据）
  const [infoSnap, setInfoSnap] = useState<Record<string, number>>({});

  // 图标加载失败状态，用于 CSS 类切换
  const [iconLoadFailed, setIconLoadFailed] = useState(false);

  // 用于区分单击/双击/长按的引用
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const clickCountRef = useRef(0);
  const wasModalOpenRef = useRef(false);

  // skillIconUrl 变化时重置图标加载失败状态
  useEffect(() => {
    setIconLoadFailed(false);
  }, [skillIconUrl]);

  /**
   * 从 buffCache 加载 Buff 列表
   */
  const loadBuffList = useCallback(() => {
    const buffs = getButtonBuffs(button.id);
    setBuffList(buffs);
  }, [button.id]);

  /**
   * 从 sessionStorage 加载 skillLevelModeMap（角色技能等级配置）
   */
  const loadSkillLevelModeMap = useCallback((): Record<string, SkillLevelMode> => {
    const characterConfig = getCharacterConfig(button.characterId);
    if (characterConfig) {
      return characterConfig.skillLevelModeMap ?? { A: 'L9', B: 'L9', E: 'L9', Q: 'L9' };
    }
    return { A: 'L9', B: 'L9', E: 'L9', Q: 'L9' };
  }, [button.characterId]);

  const loadResolvedTemplate = useCallback(() => {
    const template = resolveSkillDamageTemplate(button);
    if (!template) {
      setResolvedTemplate(null);
      return;
    }

    setResolvedTemplate(template);
    console.log(`[SkillButton] 已加载解析模板: ${template.displayName} ${template.buttonType}, hits: ${template.hits.length}`);
  }, [button]);

  /**
   * 从 sessionStorage 加载面板数据 
   */
  const loadPanelData = useCallback(() => {
    recomputeSkillButtonPanel(button.id);
    const buttonStorage = getSkillButtonById(button.id);
    const characterConfig = getCharacterConfig(button.characterId);
    if (characterConfig?.panelSnapshot) {
      const buttonSnapshot = buttonStorage?.panelSnapshot;
      const snapshot = characterConfig.panelSnapshot;
      const equipment = characterConfig.equipment ?? {};
      setPanelData({
        atk: buttonSnapshot?.atk ?? snapshot.atk ?? 0,
        critRate: buttonSnapshot?.critRate ?? snapshot.critRate ?? (0.05 + (equipment.critRateBoost ?? 0)),
        critDmg: buttonSnapshot?.critDmg ?? snapshot.critDmg ?? (0.5 + (equipment.critDmgBonusBoost ?? 0)),
        physicalDmgBonus: equipment.physicalDmgBonus ?? 0,
        fireDmgBonus: equipment.fireDmgBonus ?? 0,
        electricDmgBonus: equipment.electricDmgBonus ?? 0,
        iceDmgBonus: equipment.iceDmgBonus ?? 0,
        natureDmgBonus: equipment.natureDmgBonus ?? 0,
        skillDmgBonus: equipment.skillDmgBonus ?? 0,
        chainSkillDmgBonus: equipment.chainSkillDmgBonus ?? 0,
        ultimateDmgBonus: equipment.ultimateDmgBonus ?? 0,
        allSkillDmgBonus: (equipment.allSkillDmgBonus ?? 0) + (snapshot.weaponAllSkillDmgBonus ?? 0),
        allDmgBonus: equipment.allDmgBonus ?? 0,
      });
      setInfoSnapshotLines(characterConfig.infoSnapshot ?? []);
      setInfoSnap((characterConfig.infoSnap ?? {}) as unknown as Record<string, number>);
    }
  }, [button.characterId, button.id]);

  /**
   * 移除指定 Buff
   * 同时触发事件通知 CanvasBoard 更新 timelineData
   * @param buffId - Buff ID
   */
  const removeBuff = useCallback((buffId: string) => {
    removeSkillButtonBuff(button.id, buffId);
    loadBuffList(); // 重新加载列表
    loadPanelData();

    // 触发事件通知 CanvasBoard 从 timelineData 中移除 buffId
    emitSkillButtonBuffRemoved(button.id, buffId);
  }, [button.id, loadBuffList, loadPanelData]);

  const damageResult = useMemo(() => {
    if (!resolvedTemplate || resolvedTemplate.hits.length === 0 || !panelData) {
      return null;
    }

    return calculateSkillButtonDamageV2({
      buttonId: button.id,
      characterId: button.characterId,
      runtimeSkillId: resolvedTemplate.runtimeSkillId,
      template: resolvedTemplate,
      buffs: buffList,
      panel: {
        atk: panelData.atk,
        critRate: panelData.critRate,
        critDmg: panelData.critDmg,
      },
      damageBonus: infoSnap as unknown as import('../../types/storage').DamageBonusSnapshot,
    });
  }, [resolvedTemplate, panelData, button.id, button.characterId, buffList, infoSnap]);

  const damageViewModel = useMemo(() => {
    if (!resolvedTemplate || !damageResult || !panelData) {
      return null;
    }

    return buildSkillDamageModalViewModel(
      resolvedTemplate,
      damageResult,
      selectedHitIndex,
      {
        atk: panelData.atk,
        critRate: panelData.critRate,
        critDmg: panelData.critDmg,
      }
    );
  }, [resolvedTemplate, damageResult, selectedHitIndex, panelData]);

  // 弹窗打开时加载数据，并设置当前选中的技能按钮
  useEffect(() => {
    if (isModalOpen && !wasModalOpenRef.current) {
      loadBuffList();
      setSkillLevelModeMap(loadSkillLevelModeMap());
      loadResolvedTemplate();
      loadPanelData();
      setIsExpanded(false);
      setSelectedHitIndex(0);
      setSelectedSkillButton(button.id);
    } else if (!isModalOpen && wasModalOpenRef.current) {
      setSelectedSkillButton(null);
    }

    wasModalOpenRef.current = isModalOpen;
  }, [isModalOpen, button.id, loadBuffList, loadSkillLevelModeMap, loadResolvedTemplate, loadPanelData]);

  // 监听 Buff 添加事件，实时刷新 Buff 列表
  useEffect(() => {
    // 使用 events 层封装监听 Buff 添加事件
    const unsubscribe = onSkillButtonBuffAdded(({ buttonId }) => {
      // 只有当 Buff 是添加到当前按钮时才刷新
      if (buttonId === button.id) {
        loadBuffList();
        loadPanelData();
      }
    });

    return unsubscribe;
  }, [button.id, loadBuffList, loadPanelData]);

  /**
   * 处理鼠标按下事件
   * 启动长按检测，0.2秒后触发拖拽
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    // 重置长按标志
    isLongPressRef.current = false;

    // 启动长按定时器（0.2秒 = 200ms）
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      // 长按触发拖拽
      onMouseDown(e);
    }, 200);

    // 添加全局鼠标释放监听，用于清除定时器
    const handleMouseUp = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mouseup', handleMouseUp);
  }, [onMouseDown]);

  /**
   * 处理点击事件（区分单击和双击）
   */
  const handleClick = useCallback(() => {
    // 如果是长按，不处理点击
    if (isLongPressRef.current) return;

    clickCountRef.current += 1;

    // 单击检测：等待一段时间确认不是双击
    if (clickCountRef.current === 1) {
      clickTimerRef.current = setTimeout(() => {
        // 单击处理（目前无操作）
        clickCountRef.current = 0;
      }, 250); // 250ms 内无第二次点击视为单击
    } else if (clickCountRef.current === 2) {
      // 双击处理
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickCountRef.current = 0;

      // 打开居中弹窗
      setIsModalOpen(true);
      // 通知父组件弹窗已打开（用于强制显示 ToolPanel）
      onModalOpen?.();
      console.log('双击技能按钮，打开弹窗:', button.id);

      // 输出总数据结构到控制台
      if (timelineData) {
        console.log('【排轴数据】当前总数据结构:', timelineData);
      }
    }
  }, [button.id, timelineData]);

  /**
   * 关闭弹窗
   */
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    onModalClose?.();
  }, [onModalClose]);

  /**
   * 图标加载成功时：隐藏圆形图标内的兜底技能字母，底座文字继续显示。
   */
  const handleIconLoad = () => {
    setIconLoadFailed(false);
  };

  /**
   * 图标加载失败时：标记失败状态，CSS 类切换显示兜底文字
   */
  const handleIconError = () => {
    setIconLoadFailed(true);
  };

  return (
    <>
      <div
        className={`canvas-skill-button ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isLocked ? 'locked' : ''}`}
        style={{
          left: position.x - radius - visualOffsetX,
          top: position.y - radius - visualOffsetY,
          width: hitWidth,
          height: hitHeight,
          '--skill-button-size': `${size}px`,
          '--skill-button-radius': `${radius}px`,
          '--skill-button-element-color': getElementBackgroundColor(element ?? ''),
        } as CSSProperties}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onContextMenu={onContextMenu}
      >
        <div className="skill-button-anchor">
          <div className="skill-button-base">
            <span className="skill-button-name">{skillType} {displayName}</span>
            {isLocked ? <span className="skill-button-lock">锁</span> : null}
          </div>
          <div className="skill-button-orb" title={`${characterName} - ${displayName}`}>
            {/* skillIconUrl 有值且未失败时渲染图标 */}
            {skillIconUrl && !iconLoadFailed ? (
              <img
                className="skill-icon"
                key={skillIconUrl}
                src={skillIconUrl}
                alt={displayName}
                onLoad={handleIconLoad}
                onError={handleIconError}
              />
            ) : null}
            {/* 兜底文字：图标加载失败或无图标时显示 */}
            <span className={`skill-label ${!iconLoadFailed && skillIconUrl ? 'hidden' : ''}`}>{skillType}</span>
          </div>
        </div>
      </div>

      {/* 右键上下文菜单 - 贴着按钮右侧，垂直中段对齐 */}
      {contextMenuState?.buttonId === button.id && (
        <div
          className="skill-button-context-menu"
          style={{
            left: position.x + visualOffsetX,
            top: position.y + radius - visualOffsetY,
          }}
        >
          <button
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCloseContextMenu?.();
            }}
          >
            取消
          </button>
          <div className="context-menu-item-submenu">
            <div className="context-menu-item context-menu-submenu-trigger">
              <span>编辑</span>
              <span className="context-menu-submenu-arrow">▶</span>
            </div>
            <div className="context-menu-submenu">
              {(['A', 'B', 'E', 'Q'] as const).filter(type => type !== skillType).map((type) => (
                <button
                  key={type}
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onChangeSkillType?.(button.id, type);
                    onCloseContextMenu?.();
                  }}
                >
                  {`改为${type}`}
                </button>
              ))}
            </div>
          </div>
          <button
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCopy?.();
            }}
          >
            复制
          </button>
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onConfirmRemove?.();
            }}
          >
            删除
          </button>
        </div>
      )}

      {/* 技能信息弹窗 + 技能伤害弹窗 */}
      {isModalOpen && (
        <div className="skill-button-modal-overlay">
          <div className="skill-button-modal-pair">
            {/* 弹窗1：技能信息 */}
            <div className="skill-button-modal skill-button-modal-info">
              {/* 独立标题区 */}
              <div className="modal-header">
                <h4 className="modal-title">技能信息</h4>
                <button
                  className={`lock-control ${isLocked ? 'is-locked' : ''}`}
                  onClick={() => dispatch({ type: 'TOGGLE_SKILL_BUTTON_LOCK', buttonId: button.id })}
                  title={isLocked ? '点击解锁，解锁后可右键删除' : '点击锁定，锁定后右键不能删除'}
                >
                  <span className="lock-icon">{isLocked ? '🔒' : '🔓'}</span>
                  <span className="lock-text">{isLocked ? '已锁定' : '未锁定'}</span>
                </button>
              </div>
              <div className="modal-content">
                <p><strong>角色:</strong> {characterName}</p>
                <p><strong>技能:</strong> {skillType} / {displayName} <strong>L{skillLevelModeMap[skillType].replace('L', '')}</strong></p>
                <p><strong>干员索引:</strong> {(button as SkillButtonType).lineIndex}</p>
                {(() => {
                  const staffLine = timelineData?.staffLines?.find(s => s.staffIndex === (button as SkillButtonType).lineIndex);
                  const btnData = staffLine?.buttons?.find(b => b.id === button.id);
                  if (btnData) {
                    return (
                      <>
                        <p><strong>节点索引:</strong> {btnData.nodeIndex}</p>
                        <p><strong>节点编号:</strong> {btnData.nodeNumber}</p>
                      </>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Buff 列表 */}
              <div className="skill-button-buff-section">
                <h5>已选 Buff</h5>
                <div className="skill-button-buff-list">
                  {buffList.length === 0 ? (
                    <div className="skill-button-buff-empty">单击陈列区或搜索抽屉的 Buff 添加</div>
                  ) : (
                    buffList.map((buff) => (
                      <div
                        key={buff.id}
                        className="skill-button-buff-item"
                        title={`${buff.displayName} (${buff.sourceName})`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          removeBuff(buff.id);
                        }}
                      >
                        {buff.displayName}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <button className="modal-close-btn" onClick={handleCloseModal}>关闭</button>
            </div>

            {/* 弹窗2：技能伤害 - Hit 主导版本 */}
            <div className="skill-button-modal skill-button-modal-damage">
              <h4>技能伤害</h4>
              <div className="modal-content">
                {damageResult ? (
                  (() => {
                    if (!damageViewModel) {
                      return <p className="skill-damage-empty">加载技能数据中...</p>;
                    }

                    return (
                      <>
                        {/* 总览区 */}
                        <div className="skill-damage-summary">
                          <p className="skill-damage-title">{damageViewModel.header.fullText}</p>
                          <div className="skill-damage-total">
                            <span>总伤(期望): {damageViewModel.summary.totalExpectedText}</span>
                            <span>总伤(暴击): {damageViewModel.summary.totalCritText}</span>
                            <span>总伤(非暴): {damageViewModel.summary.totalNonCritText}</span>
                          </div>
                        </div>

                        {/* Hit 列表区 */}
                        <div className="skill-damage-hits">
                          {damageViewModel.hitCards.map((hitCard, index) => (
                            <div
                              key={hitCard.key}
                              className={`skill-damage-hit-card ${hitCard.isSelected ? 'selected' : ''}`}
                              onClick={() => setSelectedHitIndex(index)}
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
                        </div>

                        {/* Hit 详情区 */}
                        {damageViewModel.activeHitDetail && (
                          <div className="skill-damage-hit-detail">
                            <p className="hit-detail-title">{damageViewModel.activeHitDetail.title}</p>
                            <div className="hit-detail-stats">
                              <p>倍率: {damageViewModel.activeHitDetail.multiplierText}</p>
                              <p>元素: {damageViewModel.activeHitDetail.elementText}</p>
                              <p>期望伤害: {damageViewModel.activeHitDetail.expectedText}</p>
                              <p>暴击伤害: {damageViewModel.activeHitDetail.critText}</p>
                              <p>非暴击伤害: {damageViewModel.activeHitDetail.nonCritText}</p>
                            </div>
                            <div className="hit-detail-buffs">
                              <p className="buff-section-title">生效 Buff:</p>
                              {damageViewModel.activeHitDetail.appliedBuffTags.length > 0 ? (
                                damageViewModel.activeHitDetail.appliedBuffTags.map((buffName) => (
                                  <span key={buffName} className="buff-tag">{buffName}</span>
                                ))
                              ) : (
                                <span className="no-buff">无</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 展开计算过程 - 基于当前选中的 activeHit */}
                        {isExpanded && damageViewModel.activeHitFormula && (
                          <div className="skill-damage-expanded">
                            <p className="skill-damage-expand-title">{damageViewModel.activeHitFormula.title}</p>
                            <div className="skill-damage-formula">
                              <p className="formula-section-title">【面板属性】</p>
                              {damageViewModel.activeHitFormula.panelLines.map((line) => (
                                <p key={line}>{line}</p>
                              ))}
                              <p className="formula-section-title">【生效 Buff】</p>
                              {damageViewModel.activeHitFormula.buffTags.length > 0 ? (
                                <div className="formula-buff-tags">
                                  {damageViewModel.activeHitFormula.buffTags.map((buffName) => (
                                    <span key={buffName} className="buff-tag">{buffName}</span>
                                  ))}
                                </div>
                              ) : (
                                <p>无</p>
                              )}
                              {damageViewModel.activeHitFormula.zoneSections.map((section) => (
                                <div key={section.title} className="formula-zone-section">
                                  <p className="formula-section-title">{section.title}</p>
                                  {section.lines.map((line) => (
                                    <p key={line}>{line}</p>
                                  ))}
                                  <p className="formula-zone-total">{section.totalText}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <button className="skill-damage-expand-btn" onClick={() => setIsExpanded(!isExpanded)}>
                          {isExpanded ? '收起计算过程' : '展开计算过程'}
                        </button>
                      </>
                    );
                  })()
                ) : (
                  <p className="skill-damage-empty">{!panelData ? '加载面板数据...' : '加载技能模板中...'}</p>
                )}
              </div>
            </div>

            {/* 弹窗3：信息快照 */}
            <div className="skill-button-modal skill-button-modal-info-snapshot">
              <h4>信息</h4>
              <div className="modal-content">
                {infoSnapshotLines.length > 0 ? (
                  <pre className="skill-info-snapshot-content">{infoSnapshotLines.join('\n')}</pre>
                ) : (
                  <p className="skill-info-snapshot-empty">暂无信息快照</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
