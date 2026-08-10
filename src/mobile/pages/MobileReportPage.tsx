import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { toCanvas } from 'html-to-image';
import {
  handleReportImageError,
  ReportLevelRows,
  ReportPotentialStar,
} from '../../components/DamageReportPptPrimitives';
import '../../components/DamageReportPptPage.css';
import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator';
import type { EquipmentItem, EquipmentLibrary } from '../../core/services/operatorEquipmentLibrary';
import type { Character, SkillType } from '../../types';
import {
  getElementBackgroundColor,
  normalizeAssetUrl,
  resolveAvatarUrl,
} from '../../utils/assetResolver';
import type {
  MobileCatalog,
  MobileDamageReport,
  MobileDamageReportRow,
  MobileOperatorConfig,
  MobileSlotCalculation,
  MobileTimelineSlot,
} from '../model';
import { MobilePortal } from '../components/MobilePortal';
import './MobileReportPage.css';

export interface MobileReportPageProps {
  report: MobileDamageReport;
  operators: Character[];
  operatorConfigs: Record<string, MobileOperatorConfig>;
  operatorSnapshots: Record<string, ConfigSnapshot>;
  weapons: MobileCatalog['weapons'];
  equipment: EquipmentLibrary;
  slots: MobileTimelineSlot[];
  slotCalculations: Record<string, MobileSlotCalculation>;
}

type ReportPageId = 'team' | 'timeline' | 'charts';

interface DisplayReportRow {
  id: string;
  label: string;
  expected: number;
}

interface TimelineReportEntry {
  slotId: string;
  order: number;
  operator: Character;
  action: NonNullable<MobileTimelineSlot['action']>;
  calculation?: MobileSlotCalculation;
}

interface ReportExportPreview {
  url: string;
  filename: string;
  width: number;
  height: number;
}

const REPORT_PAGES: Array<{ id: ReportPageId; index: string; label: string }> = [
  { id: 'team', index: '01', label: '队伍配置' },
  { id: 'timeline', index: '02', label: '排轴概览' },
  { id: 'charts', index: '03', label: '伤害图表' },
];

const EQUIPMENT_SLOT_ORDER = ['armor', 'glove', 'accessory1', 'accessory2'] as const;
const SKILL_LEVEL_ORDER = ['A', 'B', 'E', 'Q', 'Dot'] as const;
const REPORT_SKILL_TYPE_LABELS: Record<SkillType, string> = {
  A: '重击',
  B: '战技',
  E: '连携技',
  Q: '终结技',
  Dot: '持续',
};
const SERIES_COLORS = ['#1f6f8b', '#d17742', '#688a55', '#8d6b9e', '#bf5d62', '#be9852'];
const REPORT_CHART_COLORS = {
  accent: '#1f6f8b',
  ink: '#172d32',
  muted: '#68787a',
  paper: '#ffffff',
  paperSoft: '#f4f6f5',
  line: 'rgba(23, 45, 50, 0.18)',
  grid: 'rgba(23, 45, 50, 0.08)',
  axis: 'rgba(23, 45, 50, 0.44)',
  area: 'rgba(31, 111, 139, 0.1)',
} as const;

function toSafeAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
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

function getPotentialCount(value: string | undefined): number {
  if (!value) return 1;
  if (value.includes('满')) return 6;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(6, Math.max(1, parsed + 1)) : 1;
}

function buildEquipmentMap(library: EquipmentLibrary): Map<string, EquipmentItem> {
  const result = new Map<string, EquipmentItem>();
  Object.values(library.gearSets).forEach((gearSet) => {
    Object.values(gearSet.equipments).forEach((item) => {
      result.set(item.equipmentId, item);
    });
  });
  return result;
}

function findWeapon(
  weapons: MobileCatalog['weapons'],
  weaponId: string | undefined,
): MobileCatalog['weapons'][string] | null {
  if (!weaponId) return null;
  return Object.entries(weapons).find(([key, weapon]) => key === weaponId || weapon.id === weaponId)?.[1] ?? null;
}

function getEquipmentSetName(snapshot: ConfigSnapshot | undefined): string {
  return Array.from(new Set(snapshot?.equipment.setBuffs.map((buff) => buff.gearSetName).filter(Boolean) ?? [])).join(' / ');
}

function getSeriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

function getSkillLabelParts(label: string): { groupLabel: string; skillLabel: string } {
  const parts = label.split(/\s*[·｜|]\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { groupLabel: '', skillLabel: label };
  return { groupLabel: parts[0], skillLabel: parts.slice(1).join(' · ') };
}

function ReportSlideHeader({
  index,
  title,
  note,
  titleId,
}: {
  index: string;
  title: string;
  note: string;
  titleId?: string;
}) {
  return (
    <header className="mobile-report-slide-heading">
      <span>{index}</span>
      <div><h2 id={titleId}>{title}</h2><p>{note}</p></div>
    </header>
  );
}

function EmptyReportState({ children }: { children: string }) {
  return <p className="mobile-report-empty" role="status">{children}</p>;
}

function TeamReportSlide({
  operators,
  operatorConfigs,
  operatorSnapshots,
  weapons,
  equipmentMap,
  titleId = 'mobile-report-team-title',
}: {
  operators: Character[];
  operatorConfigs: Record<string, MobileOperatorConfig>;
  operatorSnapshots: Record<string, ConfigSnapshot>;
  weapons: MobileCatalog['weapons'];
  equipmentMap: Map<string, EquipmentItem>;
  titleId?: string;
}) {
  const displayOperators: Array<Character | null> = operators.length > 0
    ? operators.slice(0, 4)
    : Array.from({ length: 4 }, () => null);

  return (
    <section className="report-ppt-slide mobile-report-ppt-team-slide" aria-labelledby={titleId}>
      <div className="report-ppt-slide-inner">
        <header className="report-ppt-slide-head">
          <span>01</span>
          <h1 id={titleId}>队伍配置</h1>
        </header>
        <div className="report-ppt-team-list">
          {displayOperators.map((operator, operatorIndex) => {
            const operatorId = operator?.id ?? `empty-${operatorIndex}`;
            const operatorName = operator?.name ?? '未选择';
            const config = operator ? operatorConfigs[operator.id] : undefined;
            const snapshot = operator ? operatorSnapshots[operator.id] : undefined;
            const weapon = findWeapon(weapons, config?.weapon.weaponId);
            const weaponName = snapshot?.weapon.name || weapon?.name || '';
            const avatarUrl = operator
              ? normalizeAssetUrl(operator.avatarUrl) || resolveAvatarUrl(operator.name)
              : '';
            const setName = getEquipmentSetName(snapshot);
            const potentialCount = snapshot?.operator.potentialCount ?? getPotentialCount(config?.potential);
            const equipmentPieces = EQUIPMENT_SLOT_ORDER.flatMap((slotKey) => {
              const selection = config?.equipment[slotKey];
              const snapshotPiece = snapshot?.equipment.pieces.find((piece) => piece.slotKey === slotKey);
              const item = equipmentMap.get(selection?.equipmentId || snapshotPiece?.equipmentId || '');
              const name = snapshotPiece?.name || item?.name || '';
              if (!name) return [];
              const snapshotLevels = snapshotPiece?.effects.map((effect) => Number(effect.level) || 0) ?? [];
              const configuredLevels = Object.values(selection?.effectLevels ?? {})
                .filter((level): level is number => Number.isFinite(level));
              return [{
                slotKey,
                name,
                part: snapshotPiece?.part || item?.part || '',
                imageUrl: normalizeAssetUrl(snapshotPiece?.imgUrl || item?.imgUrl),
                levels: snapshotLevels.length > 0 ? snapshotLevels : configuredLevels,
              }];
            });
            const weaponLevels = [
              snapshot?.weapon.config.skillLevels.skill1 ?? config?.weapon.skillLevels.skill1 ?? 0,
              snapshot?.weapon.config.skillLevels.skill2 ?? config?.weapon.skillLevels.skill2 ?? 0,
              snapshot?.weapon.config.skillLevels.skill3 ?? config?.weapon.skillLevels.skill3 ?? 0,
            ];
            return (
              <article key={operatorId} className="report-ppt-operator-row">
                <div className="report-ppt-avatar-frame">
                  {avatarUrl ? (
                    <img
                      className="report-ppt-avatar"
                      src={avatarUrl}
                      data-fallback-src={operator ? resolveAvatarUrl(operator.name) : undefined}
                      alt={operatorName}
                      onError={handleReportImageError(operatorName.slice(0, 2))}
                    />
                  ) : null}
                  <ReportPotentialStar count={potentialCount} potential={config?.potential} />
                  <div className="report-ppt-operator-main"><h2>{operatorName}</h2></div>
                  <div className="report-ppt-operator-level">Lv.{snapshot?.operator.level ?? config?.level ?? '-'}</div>
                </div>
                <div className="report-ppt-weapon-block">
                  <div className="report-ppt-weapon-image-frame">
                    <div className="report-ppt-weapon-image" data-fallback={weaponName ? undefined : '无'}>
                      {weapon?.imgUrl ? (
                        <img
                          src={normalizeAssetUrl(weapon.imgUrl)}
                          alt={weaponName}
                          onError={handleReportImageError(weaponName.slice(0, 2))}
                        />
                      ) : null}
                    </div>
                    <ReportPotentialStar
                      count={snapshot?.weapon.config.potentialCount}
                      potential={snapshot?.weapon.config.potential || config?.weapon.potential}
                    />
                    <div className="report-ppt-weapon-name">{weaponName || '无'}</div>
                    <div className="report-ppt-weapon-level">Lv.{snapshot?.weapon.config.level ?? config?.weapon.level ?? '-'}</div>
                  </div>
                  <ReportLevelRows levels={weaponLevels} className="report-ppt-weapon-level-rows" />
                </div>
                <div className="report-ppt-equipment-block">
                  {setName ? <div className="report-ppt-equipment-set-name">{setName}</div> : null}
                  <div className="report-ppt-equipment-icons">
                    {equipmentPieces.length === 0 ? <strong>未配置</strong> : equipmentPieces.map((piece) => (
                      <div key={`${operatorId}-${piece.slotKey}`} className="report-ppt-weapon-equipment-item" title={piece.name}>
                        <div className="report-ppt-equipment-image-frame">
                          <div className="report-ppt-equipment-icon">
                            {piece.imageUrl ? (
                              <img src={piece.imageUrl} alt={piece.name} onError={handleReportImageError(piece.part || piece.name.slice(0, 2))} />
                            ) : (
                              <span>{piece.part || piece.name.slice(0, 2)}</span>
                            )}
                          </div>
                          <div className="report-ppt-equipment-name">{piece.name}</div>
                        </div>
                        <ReportLevelRows levels={piece.levels} className="report-ppt-equipment-level-rows" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="report-ppt-skill-levels" aria-label={`${operatorName}技能等级`}>
                  {SKILL_LEVEL_ORDER.map((skillKey) => (
                    <span key={skillKey}><b>{skillKey}</b><strong>{config?.skillLevels[skillKey] ?? '-'}</strong></span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function OperatorShareChart({ rows }: { rows: DisplayReportRow[] }) {
  const titleId = useId();
  const descriptionId = useId();
  const positiveRows = rows.filter((row) => row.expected > 0);
  const total = positiveRows.reduce((sum, row) => sum + row.expected, 0);
  if (positiveRows.length === 0 || total <= 0) return <EmptyReportState>暂无干员伤害数据</EmptyReportState>;

  let accumulatedShare = 0;
  const segments = positiveRows.map((row, index) => {
    const share = row.expected / total;
    const segment = { ...row, index, share, offset: accumulatedShare };
    accumulatedShare += share;
    return segment;
  });
  const description = segments
    .map((row) => `${row.label} ${formatDamage(row.expected)}，占比 ${formatPercentage(row.share)}`)
    .join('；');

  return (
    <div className="mobile-report-share-layout">
      <div className="mobile-report-share-chart">
        <svg className="mobile-report-share-svg" viewBox="0 0 200 200" role="img" aria-labelledby={`${titleId} ${descriptionId}`} focusable="false">
          <title id={titleId}>干员伤害占比</title>
          <desc id={descriptionId}>{description}</desc>
          <circle
            className="mobile-report-share-track"
            cx="100"
            cy="100"
            r="66"
            pathLength="100"
            fill="none"
            stroke={REPORT_CHART_COLORS.grid}
            strokeWidth="34"
            style={{ fill: 'none', stroke: REPORT_CHART_COLORS.grid, strokeWidth: 34 }}
          />
          {segments.map((row) => (
            <circle
              key={`${row.id}-${row.index}`}
              className="mobile-report-share-segment"
              cx="100"
              cy="100"
              r="66"
              pathLength="100"
              fill="none"
              stroke={getSeriesColor(row.index)}
              strokeWidth="34"
              strokeLinecap="butt"
              strokeDasharray={`${row.share * 100} ${100 - row.share * 100}`}
              strokeDashoffset={-row.offset * 100}
              transform="rotate(-90 100 100)"
              style={{
                fill: 'none',
                stroke: getSeriesColor(row.index),
                strokeWidth: 34,
                strokeLinecap: 'butt',
                strokeDasharray: `${row.share * 100} ${100 - row.share * 100}`,
                strokeDashoffset: -row.offset * 100,
              }}
            />
          ))}
          <circle
            className="mobile-report-share-hole"
            cx="100"
            cy="100"
            r="46"
            fill={REPORT_CHART_COLORS.paper}
            style={{ fill: REPORT_CHART_COLORS.paper }}
          />
          <text
            className="mobile-report-share-total-label"
            x="100"
            y="94"
            textAnchor="middle"
            fill={REPORT_CHART_COLORS.muted}
            style={{ fill: REPORT_CHART_COLORS.muted }}
          >干员</text>
          <text
            className="mobile-report-share-total"
            x="100"
            y="113"
            textAnchor="middle"
            fill={REPORT_CHART_COLORS.ink}
            style={{ fill: REPORT_CHART_COLORS.ink }}
          >{positiveRows.length}</text>
        </svg>
      </div>
      <ol className="mobile-report-share-legend" aria-label="干员伤害占比明细">
        {segments.map((row) => (
          <li key={`${row.id}-legend`} className="mobile-report-legend-item">
            <span className="mobile-report-legend-swatch" style={{ backgroundColor: getSeriesColor(row.index) }} aria-hidden="true" />
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

function CumulativeDamageChart({ entries }: { entries: TimelineReportEntry[] }) {
  let runningTotal = 0;
  const points = entries.map((entry, index) => {
    runningTotal += toSafeAmount(entry.calculation?.result.summary.totalExpected);
    return { index, value: runningTotal, label: `${entry.order}. ${entry.operator.name} ${entry.action.skillName}` };
  });
  if (points.length === 0) return <EmptyReportState>暂无时序伤害数据</EmptyReportState>;

  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const chartPoints = points.map((point) => ({
    ...point,
    x: points.length === 1 ? 28 : 24 + (point.index / (points.length - 1)) * 276,
    y: 122 - (point.value / maxValue) * 92,
  }));
  const linePath = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${chartPoints[chartPoints.length - 1]?.x ?? 24} 122 L ${chartPoints[0]?.x ?? 24} 122 Z`;

  return (
    <svg className="mobile-report-line-chart" viewBox="0 0 320 150" role="img" aria-label="累计伤害时序折线图">
      {[30, 61, 92, 122].map((y) => (
        <path
          key={y}
          d={`M 24 ${y} H 300`}
          className="mobile-report-chart-grid-line"
          fill="none"
          stroke={REPORT_CHART_COLORS.grid}
          strokeWidth="1"
          style={{ fill: 'none', stroke: REPORT_CHART_COLORS.grid, strokeWidth: 1 }}
        />
      ))}
      <path
        d="M 24 20 V 122 H 300"
        className="mobile-report-chart-axis"
        fill="none"
        stroke={REPORT_CHART_COLORS.axis}
        strokeWidth="1"
        style={{ fill: 'none', stroke: REPORT_CHART_COLORS.axis, strokeWidth: 1 }}
      />
      <path
        d={areaPath}
        className="mobile-report-chart-area"
        fill={REPORT_CHART_COLORS.area}
        stroke="none"
        style={{ fill: REPORT_CHART_COLORS.area, stroke: 'none' }}
      />
      <path
        d={linePath}
        className="mobile-report-chart-line"
        fill="none"
        stroke={REPORT_CHART_COLORS.ink}
        strokeWidth="2"
        style={{ fill: 'none', stroke: REPORT_CHART_COLORS.ink, strokeWidth: 2 }}
      />
      {chartPoints.map((point) => (
        <circle
          key={point.label}
          cx={point.x}
          cy={point.y}
          r="3.2"
          fill={REPORT_CHART_COLORS.paper}
          stroke={REPORT_CHART_COLORS.ink}
          strokeWidth="1.5"
          style={{ fill: REPORT_CHART_COLORS.paper, stroke: REPORT_CHART_COLORS.ink, strokeWidth: 1.5 }}
        />
      ))}
      <text x="24" y="14" fill={REPORT_CHART_COLORS.muted} style={{ fill: REPORT_CHART_COLORS.muted }}>
        累计总伤 {formatDamage(runningTotal)}
      </text>
      <text
        x="300"
        y="142"
        textAnchor="end"
        fill={REPORT_CHART_COLORS.muted}
        style={{ fill: REPORT_CHART_COLORS.muted }}
      >{entries.length} 次技能</text>
    </svg>
  );
}

function SkillDamageBars({ rows }: { rows: DisplayReportRow[] }) {
  const maxExpected = Math.max(...rows.map((row) => row.expected), 0);
  if (rows.length === 0 || maxExpected <= 0) return <EmptyReportState>暂无技能伤害数据</EmptyReportState>;
  return (
    <ol className="mobile-report-skill-bars" aria-label="按干员和技能排列的预计伤害">
      {rows.map((row, index) => {
        const { groupLabel, skillLabel } = getSkillLabelParts(row.label);
        const width = row.expected > 0 ? Math.max((row.expected / maxExpected) * 100, 1.5) : 0;
        return (
          <li key={`${row.id}-${index}`} className="mobile-report-skill-bar-row">
            <div className="mobile-report-skill-bar-heading">
              <span className="mobile-report-skill-label">
                {groupLabel ? <span className="mobile-report-skill-group">{groupLabel}</span> : null}
                <span>{skillLabel}</span>
              </span>
              <strong>{formatDamage(row.expected)}</strong>
            </div>
            <div
              className="mobile-report-skill-bar-track"
              aria-hidden="true"
              style={{
                borderColor: REPORT_CHART_COLORS.line,
                backgroundColor: REPORT_CHART_COLORS.paperSoft,
              }}
            >
              <span
                className="mobile-report-skill-bar-fill"
                style={{ width: `${width}%`, backgroundColor: REPORT_CHART_COLORS.accent } as CSSProperties}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ChartReportSlide({
  report,
  operatorRows,
  skillRows,
  entries,
  titleId = 'mobile-report-charts-title',
}: {
  report: MobileDamageReport;
  operatorRows: DisplayReportRow[];
  skillRows: DisplayReportRow[];
  entries: TimelineReportEntry[];
  titleId?: string;
}) {
  return (
    <section className="mobile-report-slide" aria-labelledby={titleId}>
      <ReportSlideHeader index="03" title="伤害图表" note="复用 PPT 的占比、时序与技能明细" titleId={titleId} />
      <div className="mobile-report-damage-strip">
        <span><small>期望</small><strong>{formatDamage(report.totalExpected)}</strong></span>
        <span><small>非暴击</small><strong>{formatDamage(report.totalNonCrit)}</strong></span>
        <span><small>暴击</small><strong>{formatDamage(report.totalCrit)}</strong></span>
      </div>
      <article className="mobile-report-chart-card">
        <h3><span>图 1</span>干员伤害占比</h3>
        <OperatorShareChart rows={operatorRows} />
      </article>
      <article className="mobile-report-chart-card">
        <h3><span>图 2</span>伤害过程时序</h3>
        <CumulativeDamageChart entries={entries} />
      </article>
      <article className="mobile-report-chart-card">
        <h3><span>图 3</span>技能伤害明细</h3>
        <SkillDamageBars rows={skillRows} />
      </article>
    </section>
  );
}

function TimelineReportSlide({
  slots,
  operators,
  titleId = 'mobile-report-timeline-title',
}: {
  slots: MobileTimelineSlot[];
  operators: Character[];
  titleId?: string;
}) {
  const lanes: Array<Character | null> = Array.from(
    { length: 4 },
    (_, index) => operators[index] ?? null,
  );
  const rows = slots.flatMap((slot, slotIndex) => (
    slot.action ? [{ slot, slotIndex, action: slot.action }] : []
  ));

  return (
    <section className="mobile-report-slide" aria-labelledby={titleId}>
      <ReportSlideHeader
        index="02"
        title="排轴概览"
        note="四列对应四名干员，排轴顺序沿竖向推进"
        titleId={titleId}
      />
      {operators.length === 0 ? (
        <EmptyReportState>暂无队伍配置，无法生成排轴概览。</EmptyReportState>
      ) : rows.length === 0 ? (
        <EmptyReportState>暂无已排技能。</EmptyReportState>
      ) : (
        <div className="mobile-report-timeline-matrix" role="table" aria-label="四列竖向排轴概览">
          <div className="mobile-report-timeline-head" role="row">
            {lanes.map((operator, laneIndex) => {
              const avatarUrl = operator
                ? normalizeAssetUrl(operator.avatarUrl) || resolveAvatarUrl(operator.name)
                : '';
              return (
                <div
                  key={operator?.id ?? `empty-lane-${laneIndex}`}
                  className={`mobile-report-timeline-lane-heading${operator ? '' : ' is-empty'}`}
                  role="columnheader"
                >
                  <span
                    className="mobile-report-timeline-operator-avatar"
                    data-fallback={operator?.name.slice(0, 1) ?? String(laneIndex + 1)}
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        onError={handleReportImageError(operator?.name.slice(0, 1) ?? '')}
                      />
                    ) : null}
                  </span>
                  <strong>{operator?.name ?? `位置 ${laneIndex + 1}`}</strong>
                </div>
              );
            })}
          </div>

          <ol className="mobile-report-timeline-rows" role="rowgroup">
            {rows.map(({ slot, slotIndex, action }) => (
              <li key={slot.id} className="mobile-report-timeline-row" role="row">
                {lanes.map((operator, laneIndex) => {
                  const isActiveLane = operator?.id === action.operatorId;
                  const avatarUrl = operator
                    ? normalizeAssetUrl(operator.avatarUrl) || resolveAvatarUrl(operator.name)
                    : '';
                  const skillIconUrl = normalizeAssetUrl(action.skillIconUrl);
                  return (
                    <div
                      key={operator?.id ?? `empty-cell-${laneIndex}`}
                      className={`mobile-report-timeline-cell${isActiveLane ? ' is-active' : ''}`}
                      role="cell"
                    >
                      {isActiveLane && operator ? (
                        <article className="mobile-report-timeline-action" aria-label={`${String(slotIndex + 1).padStart(2, '0')}，${operator.name}，${action.skillName}`}>
                          <span
                            className="mobile-report-timeline-skill-icon"
                            style={{ backgroundColor: getElementBackgroundColor(operator.element) }}
                          >
                            {skillIconUrl ? (
                              <img
                                src={skillIconUrl}
                                alt=""
                                onError={handleReportImageError('')}
                              />
                            ) : null}
                          </span>
                          <span className="mobile-report-timeline-action-copy">
                            <strong title={action.skillName}>{action.skillName}</strong>
                            <small><b>{String(slotIndex + 1).padStart(2, '0')}</b>{REPORT_SKILL_TYPE_LABELS[action.skillType]}</small>
                          </span>
                          <span
                            className="mobile-report-timeline-card-avatar"
                            data-fallback={operator.name.slice(0, 1)}
                          >
                            {avatarUrl ? (
                              <img
                                src={avatarUrl}
                                alt=""
                                onError={handleReportImageError(operator.name.slice(0, 1))}
                              />
                            ) : null}
                          </span>
                        </article>
                      ) : null}
                    </div>
                  );
                })}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function waitForReportAssets(root: HTMLElement): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }
    if (typeof image.decode === 'function') await image.decode().catch(() => undefined);
  }));
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('浏览器没有生成 PNG 数据。'));
    }, 'image/png');
  });
}

function assertCanvasHasVisibleContent(canvas: HTMLCanvasElement): void {
  const probe = document.createElement('canvas');
  probe.width = 64;
  probe.height = 64;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法检查导出结果。');
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
  let visiblePixelCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    const distanceFromPaper = Math.abs(pixels[index] - 251)
      + Math.abs(pixels[index + 1] - 252)
      + Math.abs(pixels[index + 2] - 251);
    if (alpha > 24 && distanceFromPaper > 42) visiblePixelCount += 1;
  }
  if (visiblePixelCount < 24) throw new Error('生成图片为空白，已取消下载。');
}

function buildReportFilename(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `终末地战术报告-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.png`;
}

export function MobileReportPage({
  report,
  operators,
  operatorConfigs,
  operatorSnapshots,
  weapons,
  equipment,
  slots,
  slotCalculations,
}: MobileReportPageProps) {
  const [activePage, setActivePage] = useState<ReportPageId>('team');
  const [isExporting, setIsExporting] = useState(false);
  const [exportStageMounted, setExportStageMounted] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportPreview, setExportPreview] = useState<ReportExportPreview | null>(null);
  const reportPageRef = useRef<HTMLElement>(null);
  const exportStageRef = useRef<HTMLDivElement>(null);
  const exportPreviewUrlRef = useRef<string | null>(null);
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
  const equipmentMap = useMemo(() => buildEquipmentMap(equipment), [equipment]);
  const operatorById = useMemo(() => new Map(operators.map((operator) => [operator.id, operator])), [operators]);
  const entries = useMemo(() => slots.flatMap((slot, index): TimelineReportEntry[] => {
    if (!slot.action) return [];
    const operator = operatorById.get(slot.action.operatorId);
    if (!operator) return [];
    return [{
      slotId: slot.id,
      order: index + 1,
      operator,
      action: slot.action,
      calculation: slotCalculations[slot.id],
    }];
  }), [operatorById, slotCalculations, slots]);

  useEffect(() => () => {
    if (exportPreviewUrlRef.current) URL.revokeObjectURL(exportPreviewUrlRef.current);
  }, []);

  const closeExportPreview = () => {
    if (exportPreviewUrlRef.current) URL.revokeObjectURL(exportPreviewUrlRef.current);
    exportPreviewUrlRef.current = null;
    setExportPreview(null);
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportMessage('');
    flushSync(() => setExportStageMounted(true));
    try {
      await nextPaint();
      const stage = exportStageRef.current;
      const visibleSlide = reportPageRef.current?.querySelector<HTMLElement>(
        ':scope > .mobile-report-ppt-team-slide, :scope > .mobile-report-slide',
      );
      if (!stage) throw new Error('导出画布尚未准备完成。');

      const pageWidth = Math.max(280, Math.ceil(visibleSlide?.getBoundingClientRect().width ?? 0));
      stage.style.setProperty('--mobile-report-export-panel-width', `${pageWidth}px`);
      stage.style.height = 'auto';
      const panels = Array.from(stage.querySelectorAll<HTMLElement>('.mobile-report-export-panel'));
      panels.forEach((panel) => { panel.style.height = 'auto'; });

      await waitForReportAssets(stage);
      await nextPaint();
      const maxHeight = Math.max(...panels.map((panel) => Math.ceil(panel.scrollHeight)), 1);
      panels.forEach((panel) => { panel.style.height = `${maxHeight}px`; });
      stage.style.height = `${maxHeight}px`;
      await nextPaint();

      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      const canvas = await toCanvas(stage, {
        backgroundColor: '#fbfcfb',
        cacheBust: true,
        pixelRatio,
        skipAutoScale: true,
        width: pageWidth * panels.length,
        height: maxHeight,
        style: {
          position: 'static',
          top: 'auto',
          left: 'auto',
          zIndex: 'auto',
          transform: 'none',
        },
      });
      assertCanvasHasVisibleContent(canvas);
      const blob = await canvasToPngBlob(canvas);
      const url = URL.createObjectURL(blob);
      const filename = buildReportFilename();
      if (exportPreviewUrlRef.current) URL.revokeObjectURL(exportPreviewUrlRef.current);
      exportPreviewUrlRef.current = url;
      setExportPreview({ url, filename, width: canvas.width, height: canvas.height });
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setExportMessage(`已生成 ${canvas.width} × ${canvas.height} PNG`);
    } catch (error) {
      setExportMessage(error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试。');
    } finally {
      setExportStageMounted(false);
      setIsExporting(false);
    }
  };

  return (
    <main ref={reportPageRef} className="mobile-report-page" aria-label="伤害报表">
      <header className="mobile-report-page-header">
        <div><p>04 / 伤害报表</p><h1>战术报告</h1></div>
        <span><small>总期望</small><strong>{safeReport.slotCount > 0 ? formatDamage(safeReport.totalExpected) : '—'}</strong></span>
      </header>

      <nav className="mobile-report-page-tabs" aria-label="报表分页">
        {REPORT_PAGES.map((page) => (
          <button
            key={page.id}
            type="button"
            className={activePage === page.id ? 'is-active' : ''}
            onClick={() => setActivePage(page.id)}
            aria-current={activePage === page.id ? 'page' : undefined}
          >
            <span>{page.index}</span><strong>{page.label}</strong>
          </button>
        ))}
      </nav>

      {activePage === 'team' ? (
        <TeamReportSlide
          operators={operators}
          operatorConfigs={operatorConfigs}
          operatorSnapshots={operatorSnapshots}
          weapons={weapons}
          equipmentMap={equipmentMap}
        />
      ) : activePage === 'timeline' ? (
        <TimelineReportSlide slots={slots} operators={operators} />
      ) : (
        <ChartReportSlide report={safeReport} operatorRows={operatorRows} skillRows={skillRows} entries={entries} />
      )}

      <section className="mobile-report-export-control" data-mobile-pager-lock>
        <span>
          <small>EXPORT COMPOSITE</small>
          <strong>导出三联战术报告</strong>
          <p>01 / 02 / 03 原尺寸横向拼接，按最高页面补齐</p>
        </span>
        <button type="button" onClick={handleExport} disabled={isExporting}>
          <span aria-hidden="true">⇩</span>{isExporting ? '正在生成' : '导出 PNG'}
        </button>
      </section>
      {exportMessage ? (
        <p className={`mobile-report-export-message${exportMessage.startsWith('导出失败') ? ' is-error' : ''}`} role="status">
          {exportMessage}
        </p>
      ) : null}

      {exportStageMounted ? (
        <MobilePortal>
          <div ref={exportStageRef} className="mobile-report-page mobile-report-export-stage" aria-hidden="true">
            <div className="mobile-report-export-panel">
              <TeamReportSlide
                operators={operators}
                operatorConfigs={operatorConfigs}
                operatorSnapshots={operatorSnapshots}
                weapons={weapons}
                equipmentMap={equipmentMap}
                titleId="mobile-report-export-team-title"
              />
            </div>
            <div className="mobile-report-export-panel">
              <TimelineReportSlide
                slots={slots}
                operators={operators}
                titleId="mobile-report-export-timeline-title"
              />
            </div>
            <div className="mobile-report-export-panel">
              <ChartReportSlide
                report={safeReport}
                operatorRows={operatorRows}
                skillRows={skillRows}
                entries={entries}
                titleId="mobile-report-export-charts-title"
              />
            </div>
          </div>
        </MobilePortal>
      ) : null}

      {exportPreview ? (
        <MobilePortal>
          <div className="mobile-report-preview" role="presentation" data-mobile-pager-lock>
            <section
              className="mobile-report-preview-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-report-preview-title"
            >
              <header>
                <span>
                  <small>EXPORT PREVIEW</small>
                  <strong id="mobile-report-preview-title">三联战术报告</strong>
                </span>
                <button type="button" onClick={closeExportPreview} aria-label="关闭导出预览">×</button>
              </header>
              <div className="mobile-report-preview-image-frame">
                <img className="mobile-report-preview-image" src={exportPreview.url} alt="三联战术报告导出预览" />
              </div>
              <footer>
                <span>{exportPreview.width} × {exportPreview.height} PNG</span>
                <a href={exportPreview.url} download={exportPreview.filename}>再次下载</a>
              </footer>
            </section>
          </div>
        </MobilePortal>
      ) : null}
    </main>
  );
}

export default MobileReportPage;
