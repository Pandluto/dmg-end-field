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
import type {
  RdpsAttributionSummary,
  RdpsCharacterContribution,
  RdpsDomain,
} from '../../core/services/rdpsAttribution.types';
import { buildRdpsOverviewModel } from '../../core/services/rdpsOverviewModel';
import type { Character, SkillType } from '../../types';
import {
  getElementBackgroundColor,
  normalizeAssetUrl,
  resolveAvatarUrl,
} from '../../utils/assetResolver';
import type {
  MobileCatalog,
  MobileDamageReport,
  MobileDraft,
  MobileDamageReportRow,
  MobileOperatorConfig,
  MobileSlotCalculation,
  MobileTimelineSlot,
} from '../model';
import {
  buildMobileShareUrl,
  createMobileShare,
  createMobileShareQrDataUrl,
  type MobileShareRecord,
} from '../mobileShare';
import { MobilePortal } from '../components/MobilePortal';
import {
  buildReportDonutSegmentPath,
  buildReportDonutSegments,
} from '../reportDonutGeometry';
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
  draft: MobileDraft;
  dataVersion: string;
  imageVersion: string;
  shareEnabled: boolean;
  onCreateShare?: () => Promise<MobileShareRecord>;
  timelineNotes: Record<string, string>;
  onTimelineNotesChange: (notes: Record<string, string>) => void;
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

interface ReportShareQr {
  id: string;
  url: string;
  qrDataUrl: string;
  reused: boolean;
}

interface TimelineReportNoteTarget {
  key: string;
  order: number;
  laneLabel: string;
  note: string;
}

interface TimelineReportNoteEditor extends TimelineReportNoteTarget {
  draft: string;
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
// Export on an intrinsic final-size HTML canvas. The output must not depend on
// the host display's DPR or enlarge a compressed mobile layout after rendering.
const REPORT_EXPORT_PANEL_WIDTH = 1600;
const REPORT_EXPORT_PIXEL_RATIO = 1;
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

function formatSignedDamage(value: number): string {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('zh-CN');
}

function formatCompactDamage(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const sign = safeValue < 0 ? '-' : '';
  const absolute = Math.abs(safeValue);
  if (absolute >= 1_000_000_000) return `${sign}${(absolute / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1)}K`;
  return `${Math.round(safeValue)}`;
}

function formatSignedPercentage(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${(safeValue * 100).toFixed(1)}%`;
}

function rdpsDomainLabel(domain: RdpsDomain): string {
  if (domain === 'operator') return '干员本体';
  if (domain === 'weapon') return '武器';
  return '装备';
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

function getTimelineReportNoteKey(slotId: string, laneIndex: number): string {
  return `${slotId}::lane-${laneIndex}`;
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

  const segments = buildReportDonutSegments(positiveRows, (row) => row.expected);
  const description = segments
    .map((segment) => `${segment.data.label} ${formatDamage(segment.data.expected)}，占比 ${formatPercentage(segment.share)}`)
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
          {segments.map((segment) => (
            <path
              key={`${segment.data.id}-${segment.index}`}
              className="mobile-report-share-segment"
              d={buildReportDonutSegmentPath(100, 100, 83, 49, segment.startAngle, segment.endAngle)}
              fill={getSeriesColor(segment.index)}
              stroke="none"
              style={{
                fill: getSeriesColor(segment.index),
                stroke: 'none',
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
        {segments.map((segment) => (
          <li key={`${segment.data.id}-legend`} className="mobile-report-legend-item">
            <span className="mobile-report-legend-swatch" style={{ backgroundColor: getSeriesColor(segment.index) }} aria-hidden="true" />
            <span className="mobile-report-legend-copy">
              <span className="mobile-report-legend-label">{segment.data.label}</span>
              <span className="mobile-report-legend-value">{formatDamage(segment.data.expected)}</span>
            </span>
            <span className="mobile-report-legend-share">{formatPercentage(segment.share)}</span>
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

function MobileRdpsOverview({ summary }: { summary: RdpsAttributionSummary | undefined }) {
  if (!summary) return <EmptyReportState>暂无 RD 归因数据</EmptyReportState>;
  const model = buildRdpsOverviewModel(summary);
  const { actualTotal, characters, parts, canRenderPie } = model;
  if (characters.length === 0 && actualTotal === 0) return <EmptyReportState>当前队伍没有可归因干员</EmptyReportState>;
  const positiveParts = parts.filter((part) => part.damage > 0);
  const segments = buildReportDonutSegments(positiveParts, (part) => part.damage);
  const maxAbsolute = Math.max(...characters.map((character) => Math.abs(character.damage)), 1);

  return (
    <div className="mobile-report-rdps-overview">
      {canRenderPie && segments.length > 0 ? (
        <div className="mobile-report-share-layout mobile-report-rdps-share-layout">
          <div className="mobile-report-share-chart">
            <svg className="mobile-report-share-svg" viewBox="0 0 200 200" role="img" aria-label="四名干员 RD 与其他占实际总伤比例">
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
              {segments.map((segment) => (
                <path
                  key={segment.data.key}
                  className="mobile-report-share-segment"
                  d={buildReportDonutSegmentPath(100, 100, 83, 49, segment.startAngle, segment.endAngle)}
                  fill={getSeriesColor(segment.data.colorIndex)}
                  stroke="none"
                  style={{
                    fill: getSeriesColor(segment.data.colorIndex),
                    stroke: 'none',
                  }}
                >
                  <title>{segment.data.name}：{formatSignedDamage(segment.data.damage)} / {formatPercentage(segment.data.shareOfActual)}</title>
                </path>
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
                y="92"
                textAnchor="middle"
                fill={REPORT_CHART_COLORS.muted}
                style={{ fill: REPORT_CHART_COLORS.muted }}
              >总伤</text>
              <text
                className="mobile-report-share-total mobile-report-rdps-total"
                x="100"
                y="113"
                textAnchor="middle"
                fill={REPORT_CHART_COLORS.ink}
                style={{ fill: REPORT_CHART_COLORS.ink }}
              >
                {formatCompactDamage(actualTotal)}
              </text>
            </svg>
          </div>
          <ol className="mobile-report-share-legend" aria-label="四名干员 RD 与其他占比明细">
            {parts.map((part) => (
              <li key={part.key} className="mobile-report-legend-item">
                <span className="mobile-report-legend-swatch" style={{ backgroundColor: getSeriesColor(part.colorIndex) }} aria-hidden="true" />
                <span className="mobile-report-legend-copy">
                  <span className="mobile-report-legend-label">{part.name}</span>
                  <span className="mobile-report-legend-value">{formatSignedDamage(part.damage)}</span>
                </span>
                <span className="mobile-report-legend-share">{formatPercentage(part.shareOfActual)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="mobile-report-rdps-signed-notice" role="note">
          <strong>{formatCompactDamage(actualTotal)}</strong>
          <span>{parts.some((part) => part.damage < 0) ? '存在负贡献，改用带符号对比' : '暂无正 RD'}</span>
        </div>
      )}
      <ol className="mobile-report-rdps-team-bars" aria-label="四名干员总 RD 对比">
        {characters.map((character, index) => (
          <li key={`${character.characterId}-bar`} className={character.damage < 0 ? 'is-negative' : undefined}>
            <span className="mobile-report-rdps-team-bar-heading">
              <strong>{character.characterName}</strong>
              <em>{formatSignedDamage(character.damage)}</em>
            </span>
            <span className="mobile-report-rdps-team-bar-track" aria-hidden="true">
              <span
                style={{
                  width: `${(Math.abs(character.damage) / maxAbsolute) * 100}%`,
                  backgroundColor: character.damage < 0 ? undefined : getSeriesColor(index),
                }}
              />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MobileRdpsCharacterCard({ character }: { character: RdpsCharacterContribution }) {
  const hasNegative = character.domains.some((domain) => domain.damage < 0);
  const maxAbsolute = Math.max(...character.domains.map((domain) => Math.abs(domain.damage)), 1);
  return (
    <div className="mobile-report-rdps-character-card">
      <header>
        <strong>{character.characterName}</strong>
        <span>{formatSignedDamage(character.damage)} · {formatSignedPercentage(character.shareOfActual)}</span>
      </header>
      <div className="mobile-report-rdps-domain-list">
        {character.domains.map((domain) => {
          const width = hasNegative
            ? Math.abs(domain.damage) / maxAbsolute
            : Math.max(0, Math.min(1, domain.shareOfCharacter));
          return (
            <div key={domain.domain} className={`mobile-report-rdps-domain-row${domain.damage < 0 ? ' is-negative' : ''}`}>
              <span>{rdpsDomainLabel(domain.domain)}</span>
              <span className="mobile-report-rdps-domain-track" aria-hidden="true"><i style={{ width: `${width * 100}%` }} /></span>
              <em>{hasNegative ? formatSignedDamage(domain.damage) : formatSignedPercentage(domain.shareOfCharacter)}</em>
              <strong>{formatSignedDamage(domain.damage)}</strong>
            </div>
          );
        })}
      </div>
      {hasNegative ? <small>含负贡献，比例栏按绝对值缩放</small> : null}
    </div>
  );
}

function MobileRdpsDomains({ summary }: { summary: RdpsAttributionSummary | undefined }) {
  if (!summary) return <EmptyReportState>暂无 RD 来源域数据</EmptyReportState>;
  const characters = summary.characters.slice(0, 4);
  if (characters.length === 0) return <EmptyReportState>当前队伍没有来源域数据</EmptyReportState>;
  const unresolvedCount = summary.diagnostics.unresolvedDefinitionCount
    + summary.diagnostics.ambiguousDefinitionCount;
  return (
    <div className="mobile-report-rdps-domains">
      {characters.map((character) => <MobileRdpsCharacterCard key={character.characterId} character={character} />)}
      {unresolvedCount > 0 ? (
        <p className="mobile-report-rdps-warning">{unresolvedCount} 个来源未能唯一解析，已归入自身/其他</p>
      ) : null}
      {summary.diagnostics.outOfTeamCharacterCount > 0 ? (
        <p className="mobile-report-rdps-warning">队伍外来源已合并为图 3 的“其他”，图 4 仅显示当前四人</p>
      ) : null}
    </div>
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
      <ReportSlideHeader index="03" title="伤害图表" note="伤害、时序、总 RD 归因与来源域明细" titleId={titleId} />
      <div className="mobile-report-damage-strip">
        <span><small>期望</small><strong>{formatDamage(report.totalExpected)}</strong></span>
        <span><small>非暴击</small><strong>{formatDamage(report.totalNonCrit)}</strong></span>
        <span><small>暴击</small><strong>{formatDamage(report.totalCrit)}</strong></span>
      </div>
      <div className="mobile-report-chart-grid">
        <article className="mobile-report-chart-card">
          <h3><span>图 1</span>干员伤害占比</h3>
          <OperatorShareChart rows={operatorRows} />
        </article>
        <article className="mobile-report-chart-card">
          <h3><span>图 2</span>伤害过程时序</h3>
          <CumulativeDamageChart entries={entries} />
        </article>
        <article className="mobile-report-chart-card">
          <h3><span>图 3</span>总 RD 归因</h3>
          <MobileRdpsOverview summary={report.rdps} />
        </article>
        <article className="mobile-report-chart-card">
          <h3><span>图 4</span>干员来源域 RD</h3>
          <MobileRdpsDomains summary={report.rdps} />
        </article>
        <article className="mobile-report-chart-card">
          <h3><span>明细</span>技能伤害</h3>
          <SkillDamageBars rows={skillRows} />
        </article>
      </div>
    </section>
  );
}

function TimelineReportSlide({
  slots,
  operators,
  notes = {},
  onEditNote,
  titleId = 'mobile-report-timeline-title',
}: {
  slots: MobileTimelineSlot[];
  operators: Character[];
  notes?: Record<string, string>;
  onEditNote?: (target: TimelineReportNoteTarget) => void;
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
                  const noteKey = getTimelineReportNoteKey(slot.id, laneIndex);
                  const note = notes[noteKey]?.trim() ?? '';
                  const laneLabel = operator?.name ?? `位置 ${laneIndex + 1}`;
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
                      ) : onEditNote ? (
                        <button
                          type="button"
                          className={`mobile-report-timeline-note-button${note ? ' has-note' : ''}`}
                          title={note || '添加批注'}
                          aria-label={note
                            ? `编辑第 ${slotIndex + 1} 行 ${laneLabel} 批注：${note}`
                            : `为第 ${slotIndex + 1} 行 ${laneLabel} 添加批注`}
                          data-mobile-pager-lock
                          onClick={() => onEditNote({
                            key: noteKey,
                            order: slotIndex + 1,
                            laneLabel,
                            note,
                          })}
                        >
                          {note ? (
                            <span className="mobile-report-timeline-note-text">{note}</span>
                          ) : (
                            <span className="mobile-report-timeline-note-placeholder" aria-hidden="true">＋</span>
                          )}
                        </button>
                      ) : note ? (
                        <span className="mobile-report-timeline-note-static">
                          <span className="mobile-report-timeline-note-text">{note}</span>
                        </span>
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

function buildReportFilename(timestamp = Date.now(), shared = false): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `终末地战术报告${shared ? '-分享' : ''}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.png`;
}

function ReportShareQrCard({ share }: { share: ReportShareQr }) {
  return (
    <aside className="mobile-report-share-qr" aria-label="战术报告分享二维码">
      <img src={share.qrDataUrl} alt="战术报告分享二维码" />
      <span>
        <small>MOBILE TACTICAL SHARE</small>
        <strong>扫码导入此战术报告</strong>
        <p>手机与桌面会按生成端自动选择当前快照或完整节点树；导入不会持续同步。</p>
        <code>{share.id}</code>
      </span>
    </aside>
  );
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
  draft,
  dataVersion,
  imageVersion,
  shareEnabled,
  onCreateShare,
  timelineNotes,
  onTimelineNotesChange,
}: MobileReportPageProps) {
  const [activePage, setActivePage] = useState<ReportPageId>('team');
  const [isExporting, setIsExporting] = useState(false);
  const [exportStageMounted, setExportStageMounted] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportPreview, setExportPreview] = useState<ReportExportPreview | null>(null);
  const [exportPreviewActualSize, setExportPreviewActualSize] = useState(false);
  const [exportShareQr, setExportShareQr] = useState<ReportShareQr | null>(null);
  const [timelineNoteEditor, setTimelineNoteEditor] = useState<TimelineReportNoteEditor | null>(null);
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
    setExportPreviewActualSize(false);
    setExportStageMounted(false);
  };

  const openTimelineNoteEditor = (target: TimelineReportNoteTarget) => {
    setTimelineNoteEditor({ ...target, draft: target.note });
  };

  const saveTimelineNote = () => {
    if (!timelineNoteEditor) return;
    const nextNote = timelineNoteEditor.draft.trim();
    const next = { ...timelineNotes };
    if (nextNote) next[timelineNoteEditor.key] = nextNote;
    else delete next[timelineNoteEditor.key];
    onTimelineNotesChange(next);
    setTimelineNoteEditor(null);
  };

  const removeTimelineNote = () => {
    if (!timelineNoteEditor) return;
    const next = { ...timelineNotes };
    delete next[timelineNoteEditor.key];
    onTimelineNotesChange(next);
    setTimelineNoteEditor(null);
  };

  const exportReport = async (createShareQr?: () => Promise<ReportShareQr>) => {
    if (isExporting) return;
    setIsExporting(true);
    setExportMessage('');
    let previewReady = false;
    try {
      const shareQr = createShareQr ? await createShareQr() : null;
      flushSync(() => {
        setExportShareQr(shareQr);
        setExportStageMounted(true);
      });
      await nextPaint();
      const stage = exportStageRef.current;
      if (!stage) throw new Error('导出画布尚未准备完成。');

      const pageWidth = REPORT_EXPORT_PANEL_WIDTH;
      stage.style.setProperty('--mobile-report-export-panel-width', `${pageWidth}px`);
      stage.style.width = `${pageWidth * REPORT_PAGES.length}px`;
      stage.style.height = 'auto';
      const panels = Array.from(stage.querySelectorAll<HTMLElement>('.mobile-report-export-panel'));
      panels.forEach((panel) => { panel.style.height = 'auto'; });

      await waitForReportAssets(stage);
      await nextPaint();
      const shareQrCard = stage.querySelector<HTMLElement>('.mobile-report-share-qr');
      if (shareQr && !shareQrCard) throw new Error('分享二维码没有进入导出画布。');
      const chartSlide = stage.querySelector<HTMLElement>('.mobile-report-export-panel-stack > .mobile-report-slide');
      const chartShareHeight = shareQrCard
        ? Math.ceil((chartSlide?.scrollHeight ?? 0) + shareQrCard.scrollHeight + 16)
        : 0;
      const maxHeight = Math.max(
        ...panels.map((panel) => Math.ceil(panel.scrollHeight)),
        chartShareHeight,
        1,
      );
      panels.forEach((panel) => { panel.style.height = `${maxHeight}px`; });
      stage.style.height = `${maxHeight}px`;
      await nextPaint();

      const canvas = await toCanvas(stage, {
        backgroundColor: '#fbfcfb',
        cacheBust: true,
        pixelRatio: REPORT_EXPORT_PIXEL_RATIO,
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
      const filename = buildReportFilename(Date.now(), Boolean(shareQr));
      if (exportPreviewUrlRef.current) URL.revokeObjectURL(exportPreviewUrlRef.current);
      exportPreviewUrlRef.current = url;
      setExportPreviewActualSize(false);
      setExportPreview({ url, filename, width: canvas.width, height: canvas.height });
      previewReady = true;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setExportMessage(shareQr
        ? (shareQr.reused
          ? '分享版已生成；已复用相同内容的永久二维码'
          : '分享版已生成；永久二维码已写入报告')
        : `已生成 ${canvas.width} × ${canvas.height} PNG`);
    } catch (error) {
      setExportMessage(error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试。');
    } finally {
      if (!previewReady) setExportStageMounted(false);
      setIsExporting(false);
    }
  };

  const handleExport = () => void exportReport();

  const handleShareExport = () => void exportReport(async () => {
    const share = await (onCreateShare
      ? onCreateShare()
      : createMobileShare(draft, dataVersion, imageVersion));
    const url = buildMobileShareUrl(share.id);
    return {
      id: share.id,
      url,
      qrDataUrl: await createMobileShareQrDataUrl(url),
      reused: share.reused,
    };
  });

  return (
    <main className="mobile-report-page" aria-label="伤害报表">
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
        <TimelineReportSlide
          slots={slots}
          operators={operators}
          notes={timelineNotes}
          onEditNote={openTimelineNoteEditor}
        />
      ) : (
        <ChartReportSlide report={safeReport} operatorRows={operatorRows} skillRows={skillRows} entries={entries} />
      )}

      <section className="mobile-report-export-control" data-mobile-pager-lock>
        <span>
          <small>EXPORT COMPOSITE</small>
          <strong>导出三联战术报告</strong>
          <p>01 / 02 / 03 各按 1600px 原生 HTML 模板排版，固定 4800px 横向拼接</p>
        </span>
        <div className="mobile-report-export-actions">
          <button type="button" onClick={handleExport} disabled={isExporting}>
            <span aria-hidden="true">⇩</span>{isExporting ? '正在生成' : '普通导出'}
          </button>
          {shareEnabled ? (
            <button type="button" className="is-share" onClick={handleShareExport} disabled={isExporting}>
              <span aria-hidden="true">▦</span>{isExporting ? '请稍候' : '生成分享版'}
            </button>
          ) : null}
        </div>
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
                notes={timelineNotes}
                titleId="mobile-report-export-timeline-title"
              />
            </div>
            <div className="mobile-report-export-panel">
              <div className="mobile-report-export-panel-stack">
                <ChartReportSlide
                  report={safeReport}
                  operatorRows={operatorRows}
                  skillRows={skillRows}
                  entries={entries}
                  titleId="mobile-report-export-charts-title"
                />
                {exportShareQr ? <ReportShareQrCard share={exportShareQr} /> : null}
              </div>
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
              <div className={`mobile-report-preview-image-frame${exportPreviewActualSize ? ' is-actual-size' : ''}`}>
                <img
                  className={`mobile-report-preview-image${exportPreviewActualSize ? ' is-actual-size' : ''}`}
                  src={exportPreview.url}
                  alt="三联战术报告导出预览"
                />
              </div>
              <footer>
                <span>{exportPreview.width} × {exportPreview.height} PNG</span>
                <div>
                  <button type="button" onClick={() => setExportPreviewActualSize((value) => !value)}>
                    {exportPreviewActualSize ? '适应窗口' : '1:1 看细节'}
                  </button>
                  <a href={exportPreview.url} download={exportPreview.filename}>再次下载</a>
                </div>
              </footer>
            </section>
          </div>
        </MobilePortal>
      ) : null}

      {timelineNoteEditor ? (
        <MobilePortal>
          <div
            className="mobile-report-note-editor-backdrop"
            role="presentation"
            data-mobile-pager-lock
            onClick={() => setTimelineNoteEditor(null)}
          >
            <form
              className="mobile-report-note-editor-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-report-note-editor-title"
              onClick={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                saveTimelineNote();
              }}
            >
              <header>
                <span>
                  <small>TIMELINE NOTE</small>
                  <strong id="mobile-report-note-editor-title">
                    {timelineNoteEditor.note ? '编辑批注' : '添加批注'}
                  </strong>
                </span>
                <button type="button" onClick={() => setTimelineNoteEditor(null)} aria-label="关闭批注编辑器">×</button>
              </header>
              <label htmlFor="mobile-report-note-editor-input">
                第 {String(timelineNoteEditor.order).padStart(2, '0')} 行 · {timelineNoteEditor.laneLabel}
              </label>
              <textarea
                id="mobile-report-note-editor-input"
                autoFocus
                maxLength={80}
                placeholder="输入小笔记或批注…"
                value={timelineNoteEditor.draft}
                onChange={(event) => setTimelineNoteEditor((current) => (
                  current ? { ...current, draft: event.target.value } : current
                ))}
              />
              <div className="mobile-report-note-editor-meta">
                <span>留空保存也会移除批注</span>
                <small>{timelineNoteEditor.draft.length} / 80</small>
              </div>
              <footer>
                {timelineNoteEditor.note ? (
                  <button type="button" className="is-remove" onClick={removeTimelineNote}>移除批注</button>
                ) : <span />}
                <span>
                  <button type="button" onClick={() => setTimelineNoteEditor(null)}>取消</button>
                  <button type="submit" className="is-primary">保存</button>
                </span>
              </footer>
            </form>
          </div>
        </MobilePortal>
      ) : null}
    </main>
  );
}

export default MobileReportPage;
