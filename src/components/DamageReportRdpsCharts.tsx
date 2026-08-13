/**
 * RDPS 归因图表组件（v2）：图 3 总 RD 概览与图 4 四干员域拆分。
 * 图 3 只呈现 RD / 自身其他的总伤构成与各干员 RD 总量；图 4 才展示域明细。
 * 使用语义 class，负值保留符号。
 */

import type {
  RdpsAttributionSummary,
  RdpsCharacterContribution,
} from '../core/services/rdpsAttribution.types';

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

interface RdpsOverviewBar {
  key: string;
  name: string;
  damage: number;
}

function buildOverviewBars(summary: RdpsAttributionSummary): RdpsOverviewBar[] {
  const teamIds = new Set(summary.characters.map((character) => character.characterId));
  const teamBars = summary.characters.map((character) => ({
    key: character.characterId,
    name: character.characterName,
    damage: character.damage,
  }));
  const outOfTeam = new Map<string, RdpsOverviewBar>();

  for (const source of summary.sources) {
    if (source.characterId && teamIds.has(source.characterId)) continue;
    const key = source.characterId ?? `unknown:${source.characterName}`;
    const current = outOfTeam.get(key) ?? {
      key,
      name: source.characterName || '其他来源',
      damage: 0,
    };
    current.damage += source.damage;
    outOfTeam.set(key, current);
  }

  return [
    ...teamBars,
    ...Array.from(outOfTeam.values()).sort((left, right) => Math.abs(right.damage) - Math.abs(left.damage)),
  ];
}

function compactBarLabel(value: string): string {
  return value.length > 5 ? `${value.slice(0, 4)}…` : value;
}

/** 图 3 左侧：来源 RD 与自身/其他的总伤构成。 */
function RdpsTotalPie({ summary }: { summary: RdpsAttributionSummary }) {
  const parts = [
    { key: 'attributed', label: '来源 RD', value: summary.attributedTotal },
    { key: 'residual', label: '自身/其他', value: summary.residualTotal },
  ];
  const canRenderPie = summary.actualTotal > 0 && parts.every((part) => part.value >= 0);
  const visibleParts = parts.filter((part) => part.value > 0);
  let startAngle = -90;
  const slices = visibleParts.map((part) => {
    const endAngle = startAngle + (part.value / summary.actualTotal) * 360;
    const slice = { ...part, startAngle, endAngle };
    startAngle = endAngle;
    return slice;
  });

  return (
    <section className="rdps-overview-panel rdps-overview-pie-panel">
      <h3>总伤 RD 构成</h3>
      {!canRenderPie || visibleParts.length === 0 ? (
        <div className="rdps-overview-pie-fallback">
          <strong>{formatInteger(summary.actualTotal)}</strong>
          <span>存在负总量，饼图不适用</span>
        </div>
      ) : (
        <div className="rdps-overview-pie-layout">
          <div className="rdps-overview-pie-stage">
            <svg
              className="rdps-overview-pie"
              viewBox="0 0 120 120"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="总伤害中来源 RD 与自身其他占比饼图"
            >
              <title>总伤害 {formatInteger(summary.actualTotal)}，来源 RD {formatInteger(summary.attributedTotal)}，自身/其他 {formatInteger(summary.residualTotal)}</title>
              {slices.length === 1 ? (
                <circle
                  className={`rdps-overview-series is-${slices[0].key}`}
                  cx="60"
                  cy="60"
                  r="52"
                />
              ) : slices.map((slice) => (
                <path
                  key={slice.key}
                  className={`rdps-overview-series is-${slice.key}`}
                  d={pieSlicePath(60, 60, 52, slice.startAngle, slice.endAngle)}
                >
                  <title>{slice.label}：{formatInteger(slice.value)} / {formatPercent(slice.value / summary.actualTotal)}</title>
                </path>
              ))}
            </svg>
          </div>
          <div className="rdps-overview-legend">
            {parts.map((part) => (
              <div key={part.key} className="rdps-overview-legend-row">
                <span className={`rdps-overview-legend-swatch rdps-overview-series is-${part.key}`} />
                <strong>{part.label}</strong>
                <em>{formatInteger(part.value)}</em>
                <small>{formatPercent(part.value / summary.actualTotal)}</small>
              </div>
            ))}
            <div className="rdps-overview-total">总伤 {formatInteger(summary.actualTotal)}</div>
          </div>
        </div>
      )}
    </section>
  );
}

/** 图 3 右侧：按干员聚合后的 RD 总量柱状图，不重复域明细。 */
function RdpsTotalBars({ summary }: { summary: RdpsAttributionSummary }) {
  const bars = buildOverviewBars(summary);
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
      <h3>各干员总 RD <span>{formatInteger(summary.attributedTotal)}</span></h3>
      <svg
        className="rdps-overview-bar-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="各干员总 RD 柱状图"
      >
        <title>来源 RD 合计 {formatInteger(summary.attributedTotal)}</title>
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
                <title>{bar.name}：{formatInteger(bar.damage)} / {formatPercent(summary.actualTotal === 0 ? 0 : bar.damage / summary.actualTotal)}</title>
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
        <div className="rdps-warn">队伍外来源已计入图 3 对账，未显示在本图</div>
      )}
    </div>
  );
}
