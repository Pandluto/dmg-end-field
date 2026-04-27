import { useState, useRef, useCallback, useEffect } from 'react';
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
  calculateSkillButtonDamage,
  ELEMENT_LABELS,
} from '../../core/calculators/skillButtonDamageCalculator';
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
}

export function SkillButtonComponent({ button, size, onMouseDown, onContextMenu, timelineData, onModalOpen, onModalClose, contextMenuState, onConfirmRemove, onCloseContextMenu, onCopy }: SkillButtonProps) {
  /**
   * position.y 语义约定（v1.1.0+）：
   * - position.x: 按钮碰撞箱左边界（原始值，未做视觉偏移）
   * - position.y: 底座中线（不是圆心！）
   *   渲染时通过 `top: position.y - radius - visualOffsetY` 转换为 CSS top
   *   其中 visualOffsetY = 15，用于对齐谱线中心
   *
   * 恢复兼容性说明：
   * - timeline version < 1.1.0 时，position.y 存储的是旧语义（圆心），
   *   恢复时会自动在 CanvasBoard 恢复链中补偿 +15px
   * - timeline version >= 1.1.0 时，position.y 已是底座中线，无需补偿
   */
  const { position, skillType, isSelected, isDragging, characterName, skillIconUrl, element, isLocked } = button;
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
  // 角色技能乘数数据
  const [characterSkillData, setCharacterSkillData] = useState<{
    element?: string;
    skills?: {
      normalAttack?: { damage?: Record<string, Record<string, number>> };
      skill?: { damage?: Record<string, Record<string, number>> };
      chainSkill?: { damage?: Record<string, Record<string, number>> };
      ultimate?: { damage?: Record<string, Record<string, number>> };
    };
  } | null>(null);

 //console.log("characterSkillData:", skills);

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

  // 用于区分单击/双击/长按的引用
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const clickCountRef = useRef(0);

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

  /**
   * 从 JSON 文件加载角色技能乘数数据
   */
  const loadCharacterSkillData = useCallback(async () => {
    try {
      const response = await fetch(`/data/characters/${encodeURIComponent(characterName)}/${encodeURIComponent(characterName)}max.json`);
      if (response.ok) {
        const data = await response.json();
        setCharacterSkillData(data);
      }
    } catch (error) {
      console.error('加载角色技能数据失败:', error);
    }
  }, [characterName]);

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

  // 弹窗打开时加载数据，并设置当前选中的技能按钮
  useEffect(() => {
    if (isModalOpen) {
      loadBuffList();
      setSkillLevelModeMap(loadSkillLevelModeMap());
      loadCharacterSkillData();
      loadPanelData();
      setIsExpanded(false);
      setSelectedSkillButton(button.id);
    } else {
      setSelectedSkillButton(null);
    }
  }, [isModalOpen, button.id, loadBuffList, loadSkillLevelModeMap, loadCharacterSkillData, loadPanelData]);

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
  const handleIconLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const parent = (e.target as HTMLImageElement).parentElement;
    parent?.querySelectorAll('.skill-label').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
  };

  /**
   * 图标加载失败时：隐藏破损图标，文字标签自然显示作为兜底
   * 不触发 handleIconLoad，保证文字正常展现
   */
  const handleIconError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.target as HTMLImageElement).style.display = 'none';
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
            <span className="skill-button-type">{skillType}</span>
            {isLocked ? <span className="skill-button-lock">锁</span> : null}
          </div>
          <div className="skill-button-orb" title={`${characterName} - ${SKILL_LABELS[skillType]}`}>
            {/* skillIconUrl 有值时渲染图标，onLoad 成功后自动隐藏圆内兜底文字 */}
            {skillIconUrl ? (
              <img
                className="skill-icon"
                src={skillIconUrl}
                alt={SKILL_LABELS[skillType]}
                onLoad={handleIconLoad}
                onError={handleIconError}
              />
            ) : null}
            {/* 兜底文字：图标加载成功时由 handleIconLoad 隐藏，失败时正常显示 */}
            <span className="skill-label">{skillType}</span>
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
            className="context-menu-item context-menu-item-danger"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onConfirmRemove?.();
            }}
          >
            删除
          </button>
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
            className="context-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCloseContextMenu?.();
            }}
          >
            取消
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
                <p><strong>技能:</strong> {skillType} <strong>L{skillLevelModeMap[skillType].replace('L', '')}</strong></p>
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

            {/* 弹窗2：技能伤害 */}
            <div className="skill-button-modal skill-button-modal-damage">
              <h4>技能伤害</h4>
              <div className="modal-content">
                {characterSkillData?.skills && panelData ? (
                  (() => {
                    const skillKeyMap: Record<string, string> = {
                      'A': 'normalAttack',
                      'B': 'skill',
                      'E': 'chainSkill',
                      'Q': 'ultimate'
                    };
                    const skillData = characterSkillData.skills[skillKeyMap[skillType] as keyof typeof characterSkillData.skills];
                    const levelKey = skillLevelModeMap[skillType] === 'M3' ? 'M3' : '9';
                    const damage = skillData?.damage?.[levelKey];

                    if (!damage) {
                      return <p className="skill-damage-empty">无伤害数据</p>;
                    }

                    // 使用 calculator 计算伤害
                    const damageResult = calculateSkillButtonDamage({
                      buffList,
                      characterElement: characterSkillData?.element,
                      skillType,
                      levelKey,
                      damage,
                      panelData,
                      infoSnap,
                    });

                    const {
                      buffTotals,
                      elementDmgBonus,
                      skillDmgBonus,
                      damageBonusRate,
                      critRate,
                      critDmg,
                      critExpected,
                      amplifyRate,
                      fragileRate,
                      vulnerabilityRate,
                      comboDamageBonus,
                      defenseZone,
                      hitResults,
                      totalExpected,
                      totalCrit,
                      totalNonCrit,
                      processedDamage,
                      isPhysical,
                    } = damageResult;

                    return (
                      <>
                        <div className="skill-damage-summary">
                          <p className="skill-damage-title">{SKILL_LABELS[skillType]} L{skillLevelModeMap[skillType]}</p>
                          <div className="skill-damage-hits">
                            {hitResults.map((result) => (
                              <div key={result.key} className="skill-damage-hit-row" onDoubleClick={() => setIsExpanded(!isExpanded)}>
                                <span className="hit-label">{result.index}hit</span>
                                <span className="hit-value expected">期望: {result.expected.final.toFixed(0)}</span>
                                <span className="hit-value crit">暴: {result.crit.final.toFixed(0)}</span>
                                <span className="hit-value non-crit">常: {result.nonCrit.final.toFixed(0)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="skill-damage-total">
                            <span>总伤(期望): {totalExpected.toFixed(0)}</span>
                            <span>总伤(暴击): {totalCrit.toFixed(0)}</span>
                            <span>总伤(不暴): {totalNonCrit.toFixed(0)}</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="skill-damage-expanded">
                            <p className="skill-damage-expand-title">计算过程</p>
                            <div className="skill-damage-formula">
                              <p className="formula-section-title">【面板属性】</p>
                              <p>ATK: {panelData.atk.toFixed(0)}</p>
                              <p className="formula-section-title">【暴击期望】</p>
                              <p>暴击率: {(critRate * 100).toFixed(1)}%</p>
                              <p>暴击伤害: {(critDmg * 100).toFixed(1)}%</p>
                              <p>暴击期望: 1 + {critRate.toFixed(3)} × {critDmg.toFixed(3)} = {critExpected.toFixed(3)}</p>
                              <p className="formula-section-title">【伤害加成区】</p>
                              {isPhysical ? (
                                <p>物理伤害加成: {(elementDmgBonus * 100).toFixed(1)}%</p>
                              ) : (
                                <p>{ELEMENT_LABELS[characterSkillData?.element || 'magic']}伤害加成: {(elementDmgBonus * 100).toFixed(1)}%</p>
                              )}
                              {!isPhysical && buffTotals.magicDmgBonus > 0 && (
                                <p>法术伤害加成: {(buffTotals.magicDmgBonus * 100).toFixed(1)}%</p>
                              )}
                              {skillType === 'A' ? (
                                <p>普攻伤害加成: {(skillDmgBonus * 100).toFixed(1)}%</p>
                              ) : null}
                              {skillType === 'B' ? (
                                <p>战技伤害加成: {(skillDmgBonus * 100).toFixed(1)}%</p>
                              ) : null}
                              {skillType === 'E' ? (
                                <p>连携技伤害加成: {(skillDmgBonus * 100).toFixed(1)}%</p>
                              ) : null}
                              {skillType === 'Q' ? (
                                <p>终结技伤害加成: {(skillDmgBonus * 100).toFixed(1)}%</p>
                              ) : null}

                              <p>所有伤害加成: {(infoSnap.allDmgBonus * 100).toFixed(1)}%</p>
                              <p>伤害加成区: {damageBonusRate.toFixed(3)}</p>

                              {/* 增幅区显示 */}
                              {amplifyRate > 0 && (
                                <>
                                  <p className="formula-section-title">【增幅区】</p>
                                  <p>增幅区: +{(amplifyRate * 100).toFixed(1)}%</p>
                                  {buffTotals.physicalAmplify > 0 && <p>物理增幅: +{(buffTotals.physicalAmplify * 100).toFixed(1)}%</p>}
                                  {buffTotals.fireAmplify > 0 && <p>灼热增幅: +{(buffTotals.fireAmplify * 100).toFixed(1)}%</p>}
                                  {buffTotals.electricAmplify > 0 && <p>电磁增幅: +{(buffTotals.electricAmplify * 100).toFixed(1)}%</p>}
                                  {buffTotals.iceAmplify > 0 && <p>寒冷增幅: +{(buffTotals.iceAmplify * 100).toFixed(1)}%</p>}
                                  {buffTotals.natureAmplify > 0 && <p>自然增幅: +{(buffTotals.natureAmplify * 100).toFixed(1)}%</p>}
                                  {buffTotals.magicAmplify > 0 && <p>法术增幅: +{(buffTotals.magicAmplify * 100).toFixed(1)}%</p>}
                                </>
                              )}

                              {/* 脆弱区显示 */}
                              {fragileRate > 0 && (
                                <>
                                  <p className="formula-section-title">【脆弱区】</p>
                                  <p>脆弱区: +{(fragileRate * 100).toFixed(1)}%</p>
                                  {buffTotals.physicalFragile > 0 && <p>物理脆弱: +{(buffTotals.physicalFragile * 100).toFixed(1)}%</p>}
                                  {buffTotals.fireFragile > 0 && <p>灼热脆弱: +{(buffTotals.fireFragile * 100).toFixed(1)}%</p>}  
                                  {buffTotals.electricFragile > 0 && <p>电磁脆弱: +{(buffTotals.electricFragile * 100).toFixed(1)}%</p>}
                                  {buffTotals.iceFragile > 0 && <p>寒冷脆弱: +{(buffTotals.iceFragile * 100).toFixed(1)}%</p>}  
                                  {buffTotals.natureFragile > 0 && <p>自然脆弱: +{(buffTotals.natureFragile * 100).toFixed(1)}%</p>}
                                  {buffTotals.magicFragile > 0 && <p>法术脆弱: +{(buffTotals.magicFragile * 100).toFixed(1)}%</p>}  
                                </>
                              )}

                              {/* 易伤区显示 */}
                              {vulnerabilityRate > 0 && (
                                <>
                                  <p className="formula-section-title">【易伤区】</p>
                                  <p>易伤区: +{(vulnerabilityRate * 100).toFixed(1)}%</p>
                                  {buffTotals.physicalVulnerability > 0 && <p>物理易伤: +{(buffTotals.physicalVulnerability * 100).toFixed(1)}%</p>}
                                  {buffTotals.fireVulnerability > 0 && <p>灼热易伤: +{(buffTotals.fireVulnerability * 100).toFixed(1)}%</p>}
                                  {buffTotals.electricVulnerability > 0 && <p>电磁易伤: +{(buffTotals.electricVulnerability * 100).toFixed(1)}%</p>}
                                  {buffTotals.iceVulnerability > 0 && <p>寒冷易伤: +{(buffTotals.iceVulnerability * 100).toFixed(1)}%</p>}
                                  {buffTotals.natureVulnerability > 0 && <p>自然易伤: +{(buffTotals.natureVulnerability * 100).toFixed(1)}%</p>}
                                  {buffTotals.magicTakenDmgBonus > 0 && <p>法术易伤: +{(buffTotals.magicTakenDmgBonus * 100).toFixed(1)}%</p>}
                                </>
                              )}

                              {/* 连击区显示 */}
                              {comboDamageBonus > 0 && (
                                <>
                                  <p className="formula-section-title">【连击区】</p>
                                  <p>连击增伤: +{(comboDamageBonus * 100).toFixed(1)}%</p>
                                </>
                              )}

                              <p className="formula-section-title">【防御区】</p>
                              <p>防御减免: {defenseZone}</p>

                              {/* Buff 贡献单独显示 */}
                              {(buffTotals.multiplierBonus > 0 || buffTotals.multiplierMultiplier !== 1) && (
                                <p className="buff-contrib">
                                  Buff伤害倍率: +{buffTotals.multiplierBonus.toFixed(2)} × {buffTotals.multiplierMultiplier.toFixed(2)}
                                </p>
                              )}
                              {(buffTotals.critRateBoost > 0 || buffTotals.critDmgBonusBoost > 0) && (
                                <p className="buff-contrib">
                                  Buff暴击: +{(buffTotals.critRateBoost * 100).toFixed(1)}% / +{(buffTotals.critDmgBonusBoost * 100).toFixed(1)}%
                                </p>
                              )}
                            </div>
                            {hitResults.map((result) => (
                              <div key={result.key} className="skill-damage-hit-detail">
                                <p className="hit-detail-title">{result.index}hit: {processedDamage[result.key] * 100}%</p>
                                <p>= {panelData.atk.toFixed(0)} × {processedDamage[result.key]} (基础伤害区)</p>
                                <p>  × {critExpected.toFixed(3)} (暴击期望)</p>
                                <p>  × {damageBonusRate.toFixed(3)} (伤害加成区)</p>
                                <p>  × {defenseZone} (防御区)</p>
                                {amplifyRate > 0 && <p>  × {(1 + amplifyRate).toFixed(3)} (增幅区)</p>}
                                {fragileRate > 0 && <p>  × {(1 + fragileRate).toFixed(3)} (脆弱区)</p>}
                                {vulnerabilityRate > 0 && <p>  × {(1 + vulnerabilityRate).toFixed(3)} (易伤区)</p>}
                                {comboDamageBonus > 0 && <p>  × {(1 + comboDamageBonus).toFixed(3)} (连击区)</p>}
                                <p>= {result.expected.final.toFixed(2)} (期望)</p>
                                <p>= {result.crit.final.toFixed(2)} (暴击)</p>
                                <p>= {result.nonCrit.final.toFixed(2)} (不暴)</p>
                              </div>
                            ))}
                          </div>
                        )}

                        <button className="skill-damage-expand-btn" onClick={() => setIsExpanded(!isExpanded)}>
                          {isExpanded ? '收起计算过程' : '展开计算过程'}
                        </button>
                      </>
                    );
                  })()
                ) : (
                  <p className="skill-damage-empty">{!panelData ? '加载面板数据...' : '加载中...'}</p>
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
