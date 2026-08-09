import { useId, type CSSProperties } from 'react';
import type { MobileDamageReport, MobileDamageReportRow } from '../model';
import './MobileReportPage.css';

export interface MobileReportPageProps {
  report: MobileDamageReport;
}

interface DisplayReportRow {
  id: string;
  label: string;
  expected: number;
}

const SERIES_COLORS = ['#1f6f8b', '#d17742', '#688a55', '#8d6b9e', '#bf5d62', '#be9852'];

function toSafeAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function toSafeCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
}

function formatDamage(value: number | undefined): string {
  return Math.round(toSafeAmount(value)).toLocaleString('zh-CN');
}

function formatPercentage(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return `${(safeValue * 100).toFixed(1)}%`;
}

function normalizeRows(rows: MobileDamageReportRow[] | undefined): DisplayReportRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.map((row, index) => ({
    id: typeof row.id === 'string' && row.id.trim() ? row.id : `report-row-${index}`,
    label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : `未命名项目 ${index + 1}`,
    expected: toSafeAmount(row.expected),
  }));
}

function getSeriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

function getSkillLabelParts(label: string): { groupLabel: string; skillLabel: string } {
  const parts = label.split(/\s*[·｜|]\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { groupLabel: '', skillLabel: label };
  }
  return {
    groupLabel: parts[0],
    skillLabel: parts.slice(1).join(' · '),
  };
}

function EmptyReportState({ children }: { children: string }) {
  return (
    <p className="mobile-report-empty" role="status">
      {children}
    </p>
  );
}

function OperatorShareChart({ rows }: { rows: DisplayReportRow[] }) {
  const titleId = useId();
  const descriptionId = useId();
  const positiveRows = rows.filter((row) => row.expected > 0);
  const total = positiveRows.reduce((sum, row) => sum + row.expected, 0);

  if (positiveRows.length === 0 || total <= 0) {
    return <EmptyReportState>暂无干员伤害数据</EmptyReportState>;
  }

  let accumulatedShare = 0;
  const segments = positiveRows.map((row, index) => {
    const share = row.expected / total;
    const segment = {
      ...row,
      index,
      share,
      offset: accumulatedShare,
    };
    accumulatedShare += share;
    return segment;
  });

  const description = segments
    .map((row) => `${row.label} ${formatDamage(row.expected)}，占比 ${formatPercentage(row.share)}`)
    .join('；');

  return (
    <div className="mobile-report-share-layout">
      <div className="mobile-report-share-chart">
        <svg
          className="mobile-report-share-svg"
          viewBox="0 0 200 200"
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          focusable="false"
        >
          <title id={titleId}>干员伤害占比</title>
          <desc id={descriptionId}>{description}</desc>
          <circle className="mobile-report-share-track" cx="100" cy="100" r="66" pathLength="100" />
          {segments.map((row) => (
            <circle
              key={`${row.id}-${row.index}`}
              className="mobile-report-share-segment"
              cx="100"
              cy="100"
              r="66"
              pathLength="100"
              stroke={getSeriesColor(row.index)}
              strokeDasharray={`${row.share * 100} ${100 - row.share * 100}`}
              strokeDashoffset={-row.offset * 100}
              transform="rotate(-90 100 100)"
            />
          ))}
          <circle className="mobile-report-share-hole" cx="100" cy="100" r="46" />
          <text className="mobile-report-share-total-label" x="100" y="94" textAnchor="middle">
            干员
          </text>
          <text className="mobile-report-share-total" x="100" y="113" textAnchor="middle">
            {positiveRows.length}
          </text>
        </svg>
      </div>
      <ol className="mobile-report-share-legend" aria-label="干员伤害占比明细">
        {segments.map((row) => (
          <li key={`${row.id}-legend`} className="mobile-report-legend-item">
            <span
              className="mobile-report-legend-swatch"
              style={{ backgroundColor: getSeriesColor(row.index) }}
              aria-hidden="true"
            />
            <span className="mobile-report-legend-copy">
              <span className="mobile-report-legend-label">{row.label}</span>
              <span className="mobile-report-legend-value">{formatDamage(row.expected)}</span>
            </span>
            <span className="mobile-report-legend-share">{formatPercentage(row.share)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SkillDamageBars({ rows }: { rows: DisplayReportRow[] }) {
  if (rows.length === 0) {
    return <EmptyReportState>暂无技能伤害数据</EmptyReportState>;
  }

  const maxExpected = Math.max(...rows.map((row) => row.expected), 0);
  if (maxExpected <= 0) {
    return <EmptyReportState>暂无可展示的技能伤害</EmptyReportState>;
  }

  return (
    <ol className="mobile-report-skill-bars" aria-label="按干员和技能排列的预计伤害">
      {rows.map((row, index) => {
        const { groupLabel, skillLabel } = getSkillLabelParts(row.label);
        const width = row.expected > 0 ? Math.max((row.expected / maxExpected) * 100, 1.5) : 0;
        const accessibleLabel = `${row.label}，预计伤害 ${formatDamage(row.expected)}`;
        return (
          <li
            key={`${row.id}-${index}`}
            className="mobile-report-skill-bar-row"
            aria-label={accessibleLabel}
          >
            <div className="mobile-report-skill-bar-heading">
              <span className="mobile-report-skill-label">
                {groupLabel ? <span className="mobile-report-skill-group">{groupLabel}</span> : null}
                <span>{skillLabel}</span>
              </span>
              <strong>{formatDamage(row.expected)}</strong>
            </div>
            <div className="mobile-report-skill-bar-track" aria-hidden="true">
              <span
                className="mobile-report-skill-bar-fill"
                style={{ width: `${width}%` } as CSSProperties}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function MobileReportPage({ report }: MobileReportPageProps) {
  const safeReport = report ?? {
    totalExpected: 0,
    totalCrit: 0,
    totalNonCrit: 0,
    slotCount: 0,
    byOperator: [],
    bySkill: [],
  } satisfies MobileDamageReport;
  const operatorRows = normalizeRows(safeReport.byOperator);
  const skillRows = normalizeRows(safeReport.bySkill);
  const filledSlotCount = toSafeCount(safeReport.slotCount);

  return (
    <main className="mobile-report-page" aria-label="伤害报表">
      <section className="mobile-report-module mobile-report-overview" aria-labelledby="mobile-report-overview-title">
        <div className="mobile-report-module-heading">
          <div>
            <p className="mobile-report-kicker">04 / 伤害报表</p>
            <h1 id="mobile-report-overview-title">伤害汇总</h1>
          </div>
          <span className="mobile-report-module-index" aria-hidden="true">01</span>
        </div>
        <div className="mobile-report-kpi" aria-label={`总预计伤害 ${formatDamage(safeReport.totalExpected)}`}>
          <span>总预计伤害</span>
          <strong>{formatDamage(safeReport.totalExpected)}</strong>
        </div>
        <dl className="mobile-report-metrics">
          <div>
            <dt>暴击伤害</dt>
            <dd>{formatDamage(safeReport.totalCrit)}</dd>
          </div>
          <div>
            <dt>非暴击伤害</dt>
            <dd>{formatDamage(safeReport.totalNonCrit)}</dd>
          </div>
          <div>
            <dt>已填槽位</dt>
            <dd>{filledSlotCount}</dd>
          </div>
        </dl>
        {filledSlotCount === 0 ? (
          <p className="mobile-report-inline-note">完成排轴后，这里会显示当前规划的预计伤害。</p>
        ) : null}
      </section>

      <section className="mobile-report-module" aria-labelledby="mobile-report-operator-title">
        <div className="mobile-report-module-heading">
          <div>
            <p className="mobile-report-kicker">02 / 队伍构成</p>
            <h2 id="mobile-report-operator-title">干员伤害占比</h2>
          </div>
          <span className="mobile-report-module-index" aria-hidden="true">02</span>
        </div>
        <OperatorShareChart rows={operatorRows} />
      </section>

      <section className="mobile-report-module" aria-labelledby="mobile-report-skill-title">
        <div className="mobile-report-module-heading">
          <div>
            <p className="mobile-report-kicker">03 / 技能明细</p>
            <h2 id="mobile-report-skill-title">技能预计伤害</h2>
          </div>
          <span className="mobile-report-module-index" aria-hidden="true">03</span>
        </div>
        <SkillDamageBars rows={skillRows} />
      </section>
    </main>
  );
}

export default MobileReportPage;
