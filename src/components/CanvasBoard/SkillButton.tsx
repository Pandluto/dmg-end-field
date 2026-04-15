import { useState, useRef, useCallback, useEffect } from 'react';
import { SkillButton as SkillButtonType, SKILL_LABELS, TimelineData } from '../../types';
import { getElementBackgroundColor } from '../../utils/assetResolver';
import { SkillButtonBuff, setSelectedSkillButton } from '../../hooks/useSkillButtonBuffs';
import {
  calculateBuffTotals,
  calculateElementDmgBonus,
  calculateSkillDmgBonus,
  calculateFragileRate,
  calculateVulnerabilityRate,
  ELEMENT_LABELS,
} from './SkillButtonBuffCalculator';
import './SkillButton.css';

interface SkillButtonProps {
  button: SkillButtonType & { nodeNumber?: number };
  size: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  timelineData?: TimelineData;
}

export function SkillButtonComponent({ button, size, onMouseDown, onContextMenu, timelineData }: SkillButtonProps) {
  const { position, skillType, isSelected, isDragging, characterName, skillIconUrl, element } = button;

  // 弹窗显示状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  // 当前技能按钮的 Buff 列表
  const [buffList, setBuffList] = useState<SkillButtonBuff[]>([]);
  // 当前角色的技能等级模式 (L9/M3)
  const [skillLevelModeMap, setSkillLevelModeMap] = useState<Record<string, 'L9' | 'M3'>>({ A: 'L9', B: 'L9', E: 'L9', Q: 'L9' });
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
   * 从 sessionStorage 加载 Buff 列表
   */
  const loadBuffList = useCallback(() => {
    const key = 'ddd.skill-button-buffs.v1';
    const data = sessionStorage.getItem(key);
    if (data) {
      const buttonBuffs: Record<string, SkillButtonBuff[]> = JSON.parse(data);
      setBuffList(buttonBuffs[button.id] || []);
    } else {
      setBuffList([]);
    }
  }, [button.id]);

  /**
   * 从 sessionStorage 加载 skillLevelModeMap（角色技能等级配置）
   */
  const loadSkillLevelModeMap = useCallback((): Record<string, 'L9' | 'M3'> => {
    const key = 'ddd.operator-config.character-config-map.v1';
    const data = sessionStorage.getItem(key);
    if (data) {
      const configMap: Record<string, { skillLevelModeMap?: Record<string, 'L9' | 'M3'> }> = JSON.parse(data);
      const characterConfig = configMap[button.characterId];
      return characterConfig?.skillLevelModeMap ?? { A: 'L9', B: 'L9', E: 'L9', Q: 'L9' };
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
    const key = 'ddd.operator-config.character-config-map.v1';
    const data = sessionStorage.getItem(key);
    if (data) {
      const configMap = JSON.parse(data);
      const characterConfig = configMap[button.characterId];
      if (characterConfig?.panelSnapshot) {
        const snapshot = characterConfig.panelSnapshot;
        const equipment = characterConfig.equipment ?? {};
        setPanelData({
          atk: snapshot.atk ?? 0,
          critRate: 0.05 + (equipment.critRateBoost ?? 0),
          critDmg: 0.5 + (equipment.critDmgBonusBoost ?? 0),
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
        setInfoSnap(characterConfig.infoSnap ?? {});
      }
    }
  }, [button.characterId]);

  /**
   * 从 sessionStorage 移除指定 Buff
   * @param buffId - Buff ID
   */
  const removeBuff = useCallback((buffId: string) => {
    const key = 'ddd.skill-button-buffs.v1';
    const data = sessionStorage.getItem(key);
    if (data) {
      const buttonBuffs: Record<string, SkillButtonBuff[]> = JSON.parse(data);
      if (buttonBuffs[button.id]) {
        buttonBuffs[button.id] = buttonBuffs[button.id].filter(b => b.id !== buffId);
        sessionStorage.setItem(key, JSON.stringify(buttonBuffs));
        loadBuffList(); // 重新加载列表
      }
    }
  }, [button.id, loadBuffList]);

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
    const handleBuffAdded = (event: CustomEvent) => {
      const { buttonId } = event.detail;
      // 只有当 Buff 是添加到当前按钮时才刷新
      if (buttonId === button.id) {
        loadBuffList();
      }
    };

    window.addEventListener('skillbutton-buff-added', handleBuffAdded as EventListener);
    return () => {
      window.removeEventListener('skillbutton-buff-added', handleBuffAdded as EventListener);
    };
  }, [button.id, loadBuffList]);

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
  }, []);

  /**
   * 图标加载成功时：隐藏技能类型标签和干员名称，仅保留图标
   * 通过 DOM 操作一次性隐藏两个文字节点，避免重复渲染
   */
  const handleIconLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const parent = (e.target as HTMLImageElement).parentElement;
    parent?.querySelectorAll('.skill-label, .skill-character-name').forEach(el => {
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
        className={`canvas-skill-button ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
        style={{
          left: position.x - size / 2,
          top: position.y - size / 2,
          width: size,
          height: size,
          // 按干员 element 属性取半透明底色，适配半透明 PNG 技能图标
          backgroundColor: getElementBackgroundColor(element ?? ''),
        }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onContextMenu={onContextMenu}
      >
        {/* skillIconUrl 有值时渲染图标，onLoad 成功后自动隐藏文字 */}
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
        <span className="skill-character-name">{characterName}</span>
      </div>

      {/* 技能信息弹窗 + 技能伤害弹窗 */}
      {isModalOpen && (
        <div className="skill-button-modal-overlay">
          <div className="skill-button-modal-pair">
            {/* 弹窗1：技能信息 */}
            <div className="skill-button-modal skill-button-modal-info">
              <h4>技能信息</h4>
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

                    // 计算 Buff 汇总
                    const buffTotals = calculateBuffTotals(buffList);
                    console.log("buffTotals:", buffTotals);
                    
                    // 直接使用 infoSnap JSON 数据
                    const parsedDamageBonus = infoSnap;
                    
                    console.log("parsedDamageBonus:", parsedDamageBonus);

                    // 计算元素伤害加成
                    const elementDmgBonus = calculateElementDmgBonus(
                      characterSkillData?.element,
                      parsedDamageBonus,
                      buffTotals
                    );
                    console.log("elementDmgBonus:", elementDmgBonus);
                    
                    // 计算技能伤害加成
                    const skillDmgBonus = calculateSkillDmgBonus(
                      skillType,
                      parsedDamageBonus,
                      buffTotals
                    );
                    // 计算所有伤害加成
                    const allDmgBonus = parsedDamageBonus.allDmgBonus + buffTotals.allElementDmgBonus;
                    
    
                    console.log("面板:", panelData);

                    // 伤害加成区 = 1 + 元素 + 技能 + 所有技能 + 所有伤害 √
                    const damageBonusRate = 1 + elementDmgBonus + skillDmgBonus  + allDmgBonus;

                    // 暴击期望（面板基础值 + Buff 叠加）√
                    const critRate = panelData.critRate + buffTotals.critRateBoost;
                    const critDmg = panelData.critDmg + buffTotals.critDmgBonusBoost;
                    const critExpected = 1 + critRate * critDmg;

                    // 脆弱区（根据干员元素属性计算） 
                    const fragileRate = calculateVulnerabilityRate(
                      characterSkillData?.element,
                      buffTotals
                    );

                    // 易伤区（根据干员元素属性计算）
                    const vulnerabilityRate = calculateFragileRate(
                      characterSkillData?.element,
                      buffTotals
                    );

                    // 连击区（独立叠加）
                    const comboDamageBonus = buffTotals.comboDamageBonus;

                    // 防御区
                    const defenseZone = 0.5;
                    
                    // 处理伤害倍率区（加到最后一个 hit）
                    let processedDamage = { ...damage };
                    const hitKeys = Object.keys(damage).filter(k =>
                      !k.endsWith('Imbalance') && (
                        k.startsWith('hit') ||
                        k === 'damage' ||
                        k === 'phantomDamage' ||
                        k === 'spikeDamage' ||
                        k === 'slashDamage' ||
                        k === 'slashBaseDamage'
                      )
                    );
                    if (hitKeys.length > 0) {
                      const lastHitKey = hitKeys[hitKeys.length - 1];
                      const originalHitValue = damage[lastHitKey];
                      // 先加后乘
                      const afterAdd = originalHitValue + buffTotals.multiplierBonus;
                      console.log(afterAdd ,"=", originalHitValue ,"+", buffTotals.multiplierBonus);
                      const afterMultiply = afterAdd * buffTotals.multiplierMultiplier;
                      processedDamage[lastHitKey] = afterMultiply;
                    }

                    const calculateHit = (multiplierValue: number, critMultiplier: number) => {
                      const base = panelData.atk * multiplierValue;
                      const afterCrit = base * critMultiplier;
                      const afterBonus = afterCrit * damageBonusRate;
                      const afterDefense = afterBonus * defenseZone;
                      const afterFragile = afterDefense * (1 + fragileRate);
                      const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
                      const final = afterVulnerability * (1 + comboDamageBonus);
                      return { base, afterCrit, afterBonus, afterDefense, afterFragile, afterVulnerability, final };
                    };

                    const hitResults = hitKeys.map((key, idx) => {
                      const value = processedDamage[key];
                      if (typeof value !== 'number') return null;
                      const nonCrit = calculateHit(value, 1);
                      const crit = calculateHit(value, 1 + critDmg);
                      const expected = calculateHit(value, critExpected);
                      return { key, index: idx + 1, nonCrit, crit, expected };
                    }).filter(Boolean);

                    const totalExpected = hitResults.reduce((sum, r) => sum + (r?.expected.final ?? 0), 0);
                    const totalCrit = hitResults.reduce((sum, r) => sum + (r?.crit.final ?? 0), 0);
                    const totalNonCrit = hitResults.reduce((sum, r) => sum + (r?.nonCrit.final ?? 0), 0);

                    // 判断是否为物理属性
                    const isPhysical = characterSkillData?.element === 'physical';

                    return (
                      <>
                        <div className="skill-damage-summary">
                          <p className="skill-damage-title">{SKILL_LABELS[skillType]} L{skillLevelModeMap[skillType]}</p>
                          <div className="skill-damage-hits">
                            {hitResults.map((result) => (
                              result && (
                                <div key={result.key} className="skill-damage-hit-row" onDoubleClick={() => setIsExpanded(!isExpanded)}>
                                  <span className="hit-label">{result.index}hit</span>
                                  <span className="hit-value expected">期望: {result.expected.final.toFixed(0)}</span>
                                  <span className="hit-value crit">暴: {result.crit.final.toFixed(0)}</span>
                                  <span className="hit-value non-crit">常: {result.nonCrit.final.toFixed(0)}</span>
                                </div>
                              )
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

                              <p>所有伤害加成: {(parsedDamageBonus.allDmgBonus * 100).toFixed(1)}%</p>
                              <p>伤害加成区: {damageBonusRate.toFixed(3)}</p>

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
                              result && (
                                <div key={result.key} className="skill-damage-hit-detail">
                                  <p className="hit-detail-title">{result.index}hit: {processedDamage[result.key] * 100}%</p>
                                  <p>= {panelData.atk.toFixed(0)} × {processedDamage[result.key]} (基础伤害区)</p>
                                  <p>  × {critExpected.toFixed(3)} (暴击期望)</p>
                                  <p>  × {damageBonusRate.toFixed(3)} (伤害加成区)</p>
                                  <p>  × {defenseZone} (防御区)</p>
                                  {fragileRate > 0 && <p>  × {(1 + fragileRate).toFixed(3)} (脆弱区)</p>}
                                  {vulnerabilityRate > 0 && <p>  × {(1 + vulnerabilityRate).toFixed(3)} (易伤区)</p>}
                                  {comboDamageBonus > 0 && <p>  × {(1 + comboDamageBonus).toFixed(3)} (连击区)</p>}
                                  <p>= {result.expected.final.toFixed(2)} (期望)</p>
                                  <p>= {result.crit.final.toFixed(2)} (暴击)</p>
                                  <p>= {result.nonCrit.final.toFixed(2)} (不暴)</p>
                                </div>
                              )
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
