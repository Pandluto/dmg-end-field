import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildDamageReportSnapshot, DamageReportSnapshot } from '../../../core/services/damageReportService';

interface ReportTabProps {
  autoGenerateToken?: number;
}

function formatInteger(value: number): string {
  return value.toFixed(0);
}

function formatShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function ReportTab({ autoGenerateToken = 0 }: ReportTabProps) {
  const [activePage, setActivePage] = useState<1 | 2>(1);
  const [expandedButtons, setExpandedButtons] = useState<Record<string, boolean>>({});
  const [expandedHits, setExpandedHits] = useState<Record<string, boolean>>({});
  const [expandedCharacters, setExpandedCharacters] = useState<Record<string, boolean>>({});
  const [snapshot, setSnapshot] = useState<DamageReportSnapshot | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateReport = useCallback(() => {
    setIsGenerating(true);
    try {
      const nextSnapshot = buildDamageReportSnapshot();
      setSnapshot(nextSnapshot);
      setExpandedButtons({});
      setExpandedHits({});
      setExpandedCharacters({});
    } finally {
      setIsGenerating(false);
    }
  }, []);

  useEffect(() => {
    if (autoGenerateToken <= 0) {
      return;
    }
    handleGenerateReport();
  }, [autoGenerateToken, handleGenerateReport]);

  const reportButtons = snapshot?.buttons ?? [];
  const reportCharacters = snapshot?.characters ?? [];

  const summaryRows = useMemo(() => {
    const roleMap = new Map<string, { characterName: string; expected: number; nonCrit: number; count: number }>();
    reportButtons.forEach((button) => {
      const current = roleMap.get(button.characterName) ?? {
        characterName: button.characterName,
        expected: 0,
        nonCrit: 0,
        count: 0,
      };
      current.expected += button.expected;
      current.nonCrit += button.nonCrit;
      current.count += 1;
      roleMap.set(button.characterName, current);
    });

    return Array.from(roleMap.values())
      .sort((left, right) => right.expected - left.expected)
      .map((row) => ({
        id: row.characterName,
        title: row.characterName,
        subtitle: `${row.count} 个按钮`,
        expected: formatInteger(row.expected),
        nonCrit: formatInteger(row.nonCrit),
        share: formatShare(snapshot ? row.expected / Math.max(snapshot.totalExpected, 1) : 0),
      }));
  }, [reportButtons, snapshot]);

  const toggleButton = (buttonId: string) => {
    setExpandedButtons((prev) => ({ ...prev, [buttonId]: !prev[buttonId] }));
  };

  const toggleHit = (hitId: string) => {
    setExpandedHits((prev) => ({ ...prev, [hitId]: !prev[hitId] }));
  };

  const toggleCharacter = (characterId: string) => {
    setExpandedCharacters((prev) => ({ ...prev, [characterId]: !prev[characterId] }));
  };

  return (
    <div className="tab-content-report">
      <div className="report-toolbar">
        <button className="refresh-button" type="button" onClick={handleGenerateReport} disabled={isGenerating}>
          {isGenerating ? '生成中...' : '生成报表'}
        </button>
        <div className="report-page-switch">
          <button
            type="button"
            className={`tool-panel-tab report-page-tab${activePage === 1 ? ' is-active' : ''}`}
            onClick={() => setActivePage(1)}
          >
            第1页
          </button>
          <button
            type="button"
            className={`tool-panel-tab report-page-tab${activePage === 2 ? ' is-active' : ''}`}
            onClick={() => setActivePage(2)}
          >
            第2页
          </button>
        </div>
      </div>

      {!snapshot ? (
        <div className="report-page report-page-summary">
          <div className="report-page-header">
            <h3>伤害结算报表</h3>
            <p>点击“生成报表”读取当前时间轴按钮快照</p>
          </div>
        </div>
      ) : null}

      {snapshot && activePage === 1 && (
        <div className="report-page report-page-summary">
          <div className="report-page-header">
            <h3>伤害结算报表</h3>
            <p>第1页 · 总览</p>
          </div>

          <div className="report-text-panel">
            <div className="report-text-block">
              <div className="report-text-line report-text-line-main">总伤害：{formatInteger(snapshot.totalDamage)}</div>
              <div className="report-text-line">总期望伤害：{formatInteger(snapshot.totalExpected)}</div>
              <div className="report-text-line">总非暴击伤害：{formatInteger(snapshot.totalNonCrit)}</div>
              <div className="report-text-line">统计按钮数：{snapshot.buttonCount}</div>
            </div>
          </div>

          <div className="report-text-panel">
            <div className="report-panel-head report-panel-head-text">
              <h4>干员伤害占比</h4>
              <span>按期望伤害汇总</span>
            </div>
            <div className="report-text-list">
              {summaryRows.length === 0 ? (
                <div className="report-text-line">当前时间轴没有可统计按钮</div>
              ) : (
                summaryRows.map((row, index) => (
                  <div key={row.id} className="report-text-row">
                    <span className="report-text-rank">{index + 1}.</span>
                    <span className="report-text-name">{row.title}</span>
                    <span className="report-text-meta">{row.subtitle}</span>
                    <span className="report-text-value">期望 {row.expected}</span>
                    <span className="report-text-value">非暴击 {row.nonCrit}</span>
                    <span className="report-text-value">占比 {row.share}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {snapshot && activePage === 2 && (
        <div className="report-page report-page-detail">
          <div className="report-page-header">
            <h3>按钮明细主表</h3>
            <p>第2页 · 默认展开到按钮层，Hit 和 Buff 可逐层展开</p>
          </div>

          <div className="report-detail-layout">
            <div className="report-detail-left">
              <div className="report-tree">
                {reportButtons.length === 0 ? (
                  <div className="report-tree-row report-tree-row-button">
                    <div className="report-tree-main">
                      <span className="report-tree-label">当前时间轴没有可统计按钮</span>
                    </div>
                  </div>
                ) : (
                  reportButtons.map((button) => {
                    const buttonExpanded = expandedButtons[button.id] ?? false;
                    return (
                      <div key={button.id} className="report-tree-group">
                        <div className="report-tree-row report-tree-row-button">
                          <button type="button" className="report-tree-toggle" onClick={() => toggleButton(button.id)}>
                            {buttonExpanded ? '[-]' : '[+]'}
                          </button>
                          <div className="report-tree-main">
                            <div className="report-tree-line report-tree-line-button">
                              #{button.orderLabel} / {button.characterName} / {button.skillType} / {button.skillName}
                            </div>
                            <div className="report-tree-line report-tree-line-values">
                              伤害 {formatInteger(button.damage)}　期望 {formatInteger(button.expected)}　非暴击 {formatInteger(button.nonCrit)}　占比 {formatShare(button.share)}
                            </div>
                          </div>
                        </div>

                        {buttonExpanded && (
                          <div className="report-tree-children report-tree-children-hit">
                            {button.hits.map((hit) => {
                              const hitExpanded = expandedHits[hit.id] ?? false;
                              return (
                                <div key={hit.id} className="report-tree-group">
                                  <div className="report-tree-row report-tree-row-hit">
                                    <button type="button" className="report-tree-toggle" onClick={() => toggleHit(hit.id)}>
                                      {hitExpanded ? '[-]' : '[+]'}
                                    </button>
                                    <div className="report-tree-main">
                                      <div className="report-tree-line report-tree-line-hit">
                                        {hit.title} / {hit.damageSourceLabel} / {hit.elementLabel} / 技能类型: {hit.skillTypeLabel}
                                      </div>
                                      <div className="report-tree-line report-tree-line-values">
                                        伤害 {formatInteger(hit.damage)}　期望 {formatInteger(hit.expected)}　非暴击 {formatInteger(hit.nonCrit)}　抗性区 {hit.resistanceZone.toFixed(3)}
                                      </div>
                                    </div>
                                  </div>

                                  {hitExpanded && (
                                    <div className="report-tree-children report-tree-children-buff">
                                      <div className="report-tree-row report-tree-row-buff">
                                        <div className="report-tree-main">
                                          <div className="report-tree-line report-tree-line-buff">抗性区</div>
                                          <div className="report-tree-line report-tree-line-buff-meta">
                                            基础 {hit.resistance.baseResistance.toFixed(1)}　腐蚀 {hit.resistance.corrosion.toFixed(1)}　有效 {hit.resistance.effectiveResistance.toFixed(1)}　无视 {hit.resistance.resistanceIgnore.toFixed(1)}　公式: {hit.resistance.formulaText}
                                          </div>
                                        </div>
                                      </div>
                                      {hit.buffs.length === 0 ? (
                                        <div className="report-tree-row report-tree-row-buff">
                                          <div className="report-tree-main">
                                            <div className="report-tree-line report-tree-line-buff">无 Buff</div>
                                          </div>
                                        </div>
                                      ) : (
                                        hit.buffs.map((buff) => (
                                          <div key={buff.id} className="report-tree-row report-tree-row-buff">
                                            <div className="report-tree-main">
                                              <div className="report-tree-line report-tree-line-buff">
                                                {buff.name}
                                              </div>
                                              <div className="report-tree-line report-tree-line-buff-meta">
                                                id: {buff.traceId || buff.id}　效果: {buff.effect}
                                              </div>
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="report-detail-right">
              <div className="report-character-tree">
                {reportCharacters.length === 0 ? (
                  <div className="report-tree-row report-tree-row-button">
                    <div className="report-tree-main">
                      <span className="report-tree-label">当前没有可统计干员</span>
                    </div>
                  </div>
                ) : (
                  reportCharacters.map((character) => {
                    const isExpanded = expandedCharacters[character.characterId] ?? false;
                    return (
                      <div key={character.characterId} className="report-tree-group">
                        <div className="report-tree-row report-tree-row-button">
                          <button type="button" className="report-tree-toggle" onClick={() => toggleCharacter(character.characterId)}>
                            {isExpanded ? '[-]' : '[+]'}
                          </button>
                          <div className="report-tree-main">
                            <div className="report-tree-line report-tree-line-button">
                              {character.characterName} / ID: {character.characterId} / 武器: {character.weaponName} / 潜能: {character.weaponPotentialMode} / 等级: {character.level ?? '-'}
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="report-tree-children report-tree-children-character">
                            <div className="report-character-section">
                              <div className="report-tree-line report-tree-line-hit">基础属性</div>
                              {character.attributeLines.map((line, index) => (
                                <div key={`${character.characterId}-attribute-${index}`} className="report-tree-line report-tree-line-buff-meta">
                                  {line}
                                </div>
                              ))}
                            </div>

                            <div className="report-character-section">
                              <div className="report-tree-line report-tree-line-hit">技能等级</div>
                              {character.skillLevels.length === 0 ? (
                                <div className="report-tree-line report-tree-line-buff-meta">无</div>
                              ) : (
                                character.skillLevels.map((line) => (
                                  <div key={`${character.characterId}-${line}`} className="report-tree-line report-tree-line-buff-meta">
                                    {line}
                                  </div>
                                ))
                              )}
                            </div>

                            <div className="report-character-section">
                              <div className="report-tree-line report-tree-line-hit">装备加成</div>
                              {character.equipmentLines.length === 0 ? (
                                <div className="report-tree-line report-tree-line-buff-meta">无</div>
                              ) : (
                                character.equipmentLines.map((line, index) => (
                                  <div key={`${character.characterId}-equipment-${index}`} className="report-tree-line report-tree-line-buff-meta">
                                    {line}
                                  </div>
                                ))
                              )}
                            </div>

                            <div className="report-character-section">
                              <div className="report-tree-line report-tree-line-hit">技能与倍率</div>
                              {character.skills.length === 0 ? (
                                <div className="report-tree-line report-tree-line-buff-meta">无</div>
                              ) : (
                                character.skills.map((skill) => (
                                  <div key={`${character.characterId}-${skill.id}`} className="report-character-section">
                                    <div className="report-tree-line report-tree-line-buff">{skill.title}</div>
                                    <div className="report-tree-line report-tree-line-buff-meta">{skill.meta}</div>
                                    {skill.hitLines.map((line, index) => (
                                      <div key={`${character.characterId}-${skill.id}-hit-${index}`} className="report-tree-line report-tree-line-buff-meta">
                                        {line}
                                      </div>
                                    ))}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
