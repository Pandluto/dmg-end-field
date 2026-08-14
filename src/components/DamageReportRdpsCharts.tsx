/**
 * RDPS 归因图表组件（v2）：图 3 总 RD 概览与图 4 四干员域拆分。
 * 图 3 用饼图呈现四名干员与“其他”的实际总伤占比，并用柱状图对比四人 RD；
 * 图 4 才展示域明细。
 * 使用语义 class，负值保留符号。
 */

import type {
  RdpsAttributionSummary,
  RdpsCharacterContribution,
} from '../core/services/rdpsAttribution.types';
import { buildRdpsOverviewModel } from '../core/services/rdpsOverviewModel';

function formatInteger(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function domainLabel(domain: 'operator' | 'weapon' | 'equipment'): string {
  if (domain === 'operator') return '干员本体';
  if (domain === 'weapon') return '武器';
  return '装备';
}

function polarPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function pieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    'Z',
  ].join(' ');
}

function compactBarLabel(value: string): string {
  return value.length > 5 ? `${value.slice(0, 4)}…` : value;
}

/** 图 3 左侧：四名干员 RD 与其余实际伤害的统一占比。 */
function RdpsTotalPie({ summary }: { summary: RdpsAttributionSummary }) {
  const model = buildRdpsOverviewModel(summary);
  const { actualTotal, parts, teamTotal, otherDamage, canRenderPie } = model;
  const visibleParts = parts.filter((part) => part.damage > 0);
  let startAngle = -90;
  const slices = visibleParts.map((part) => {
    const endAngle = startAngle + part.shareOfActual * 360;
    const slice = { ...part, startAngle, endAngle };
    startAngle = endAngle;
    return slice;
  });

  return (
    <section className="rdps-overview-panel rdps-overview-pie-panel">
      <h3>总 RD 归因占比 <span>{formatInteger(actualTotal)}</span></h3>
      {!canRenderPie || visibleParts.length === 0 ? (
        <div className="rdps-overview-pie-fallback">
          <strong>{formatInteger(actualTotal)}</strong>
          <span>{parts.some((part) => part.damage < 0) ? '存在负贡献，饼图不适用' : '暂无可展示伤害'}</span>
        </div>
      ) : (
        <div className="rdps-overview-pie-layout">
          <div className="rdps-overview-pie-stage">
            <svg
              className="rdps-overview-pie"
              viewBox="0 0 120 120"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="四名干员 RD 与其他占实际总伤比例饼图"
            >
              <title>实际总伤 {formatInteger(actualTotal)}，四人 RD {formatInteger(teamTotal)}，其他 {formatInteger(otherDamage)}</title>
              {slices.length === 1 ? (
                <circle
                  className={`rdps-overview-series report-ppt-share-color is-segment-${slices[0].colorIndex}`}
                  cx="60"
                  cy="60"
                  r="52"
                />
              ) : slices.map((slice) => (
                <path
                  key={slice.key}
                  className={`rdps-overview-series report-ppt-share-color is-segment-${slice.colorIndex}`}
                  d={pieSlicePath(60, 60, 52, slice.startAngle, slice.endAngle)}
                >
                  <title>{slice.name}：{formatInteger(slice.damage)} / {formatPercent(slice.shareOfActual)}</title>
                </path>
              ))}
            </svg>
          </div>
          <div className="rdps-overview-legend">
            {parts.map((part) => (
              <div key={part.key} className="rdps-overview-legend-row">
                <span className={`rdps-overview-legend-swatch rdps-overview-series report-ppt-share-color is-segment-${part.colorIndex}`} />
                <strong>{part.name}</strong>
                <em>{formatInteger(part.damage)}</em>
                <small>{formatPercent(part.shareOfActual)}</small>
              </div>
            ))}
            <div className="rdps-overview-total">总伤 {formatInteger(actualTotal)}</div>
          </div>
        </div>
      )}
    </section>
  );
}

/** 图 3 右侧：按干员聚合后的 RD 总量柱状图，不重复域明细。 */
function RdpsTotalBars({ summary }: { summary: RdpsAttributionSummary }) {
  const model = buildRdpsOverviewModel(summary);
  const bars = model.characters.map((character) => ({
    key: character.characterId,
    name: character.characterName,
    damage: character.damage,
  }));
  const { actualTotal, teamTotal } = model;
  if (bars.length === 0) {
    return (
      <section className="rdps-overview-panel">
        <h3>各干员总 RD</h3>
        <div className="rdps-empty">暂无来源贡献</div>
      </section>
    );
  }

  const width = 360;
  const height = 190;
  const top = 20;
  const bottom = 34;
  const left = 24;
  const right = 8;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  let domainMax = Math.max(0, ...bars.map((bar) => bar.damage));
  const domainMin = Math.min(0, ...bars.map((bar) => bar.damage));
  if (domainMax === 0 && domainMin === 0) domainMax = 1;
  const domainRange = domainMax - domainMin;
  const zeroY = top + (domainMax / domainRange) * plotHeight;
  const slotWidth = plotWidth / bars.length;
  const barWidth = Math.min(42, Math.max(16, slotWidth * 0.56));

  return (
    <section className="rdps-overview-panel rdps-overview-bar-panel">
      <h3>四干员总 RD <span>{formatInteger(teamTotal)}</span></h3>
      <svg
        className="rdps-overview-bar-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="四名干员总 RD 柱状图"
      >
        <title>四名干员 RD 合计 {formatInteger(teamTotal)}</title>
        <line className="rdps-overview-axis" x1={left} x2={width - right} y1={zeroY} y2={zeroY} />
        {bars.map((bar, index) => {
          const valueY = top + ((domainMax - bar.damage) / domainRange) * plotHeight;
          const rectY = Math.min(valueY, zeroY);
          const rectHeight = Math.max(0, Math.abs(zeroY - valueY));
          const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
          const valueLabelY = bar.damage >= 0
            ? Math.max(11, rectY - 5)
            : Math.min(height - bottom + 13, rectY + rectHeight + 12);
          return (
            <g key={bar.key}>
              <rect
                className={`rdps-overview-bar${bar.damage < 0 ? ' is-negative' : ''}`}
                x={x}
                y={rectY}
                width={barWidth}
                height={Math.max(rectHeight, bar.damage === 0 ? 0 : 1)}
                rx="3"
              >
                <title>{bar.name}：{formatInteger(bar.damage)} / {formatPercent(actualTotal > 0 ? bar.damage / actualTotal : 0)}</title>
              </rect>
              <text className="rdps-overview-bar-value" x={x + barWidth / 2} y={valueLabelY} textAnchor="middle">
                {formatInteger(bar.damage)}
              </text>
              <text className="rdps-overview-bar-label" x={x + barWidth / 2} y={height - 8} textAnchor="middle">
                {compactBarLabel(bar.name)}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

/** 图 3：总 RD 双图概览。 */
export function RdpsOverviewChart({ summary }: { summary: RdpsAttributionSummary | undefined }) {
  if (!summary) {
    return <div className="rdps-empty">暂无归因数据</div>;
  }
  return (
    <div className="is-rdps-overview">
      <RdpsTotalPie summary={summary} />
      <RdpsTotalBars summary={summary} />
    </div>
  );
}

/** 图 4 中单个干员卡片。 */
function CharacterDomainCard({ character }: { character: RdpsCharacterContribution }) {
  const hasNegative = character.domains.some((domain) => domain.damage < 0);
  const positiveSum = character.domains.filter((domain) => domain.damage > 0).reduce((sum, domain) => sum + domain.damage, 0);
  return (
    <div className="rdps-character-card">
      <div className="rdps-character-heading">
        <strong>{character.characterName}</strong>
        <span>贡献 {formatInteger(character.damage)} · {formatPercent(character.shareOfActual)}</span>
      </div>
      {character.damage === 0 ? (
        <div className="rdps-empty">无归因贡献</div>
      ) : hasNegative ? (
        <div className="rdps-signed-fallback">
          {character.domains.map((domain) => (
            <div key={domain.domain} className={domain.damage < 0 ? 'rdps-negative' : undefined}>
              <span>{domainLabel(domain.domain)}</span>
              <span className="rdps-num">{formatInteger(domain.damage)}</span>
            </div>
          ))}
          <div className="rdps-warn">存在负贡献，显示带符号数值（占比不适用）</div>
        </div>
      ) : (
        <div className="rdps-domain-bars">
          {character.domains.map((domain) => (
            <div key={domain.domain} className="rdps-domain-row">
              <span className="rdps-domain-label">{domainLabel(domain.domain)}</span>
              <span className="rdps-domain-bar-track">
                <span
                  className="rdps-domain-bar"
                  style={{ width: `${Math.max(0, Math.min(1, domain.shareOfCharacter)) * 100}%` }}
                />
              </span>
              <span className="rdps-num">{formatPercent(domain.shareOfCharacter)}</span>
              <span className="rdps-num rdps-domain-raw">{formatInteger(domain.damage)}</span>
            </div>
          ))}
          {positiveSum > 0 && character.damage > 0 && (
            <div className="rdps-character-total">三域合计 {formatInteger(positiveSum)}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 图 4：四干员域拆分。 */
export function RdpsCharacterSplitChart({ summary }: { summary: RdpsAttributionSummary | undefined }) {
  if (!summary) {
    return <div className="rdps-empty">暂无归因数据</div>;
  }
  const characters = summary.characters.slice(0, 4);
  if (characters.length === 0) {
    return <div className="rdps-empty">当前队伍没有可归因干员</div>;
  }
  return (
    <div className="is-rdps-character-split">
      <div className="rdps-character-grid">
        {characters.map((character) => (
          <CharacterDomainCard key={character.characterId} character={character} />
        ))}
      </div>
      {summary.diagnostics.outOfTeamCharacterCount > 0 && (
        <div className="rdps-warn">队伍外来源已合并为图 3 的“其他”，图 4 仅显示当前四人</div>
      )}
    </div>
  );
}
