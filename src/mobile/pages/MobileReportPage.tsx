import { useMemo, useState, type CSSProperties, type SyntheticEvent } from 'react';
import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator';
import type { EquipmentItem, EquipmentLibrary } from '../../core/services/operatorEquipmentLibrary';
import type { Character } from '../../types';
import { normalizeAssetUrl, resolveAvatarUrl } from '../../utils/assetResolver';
import type {
  MobileCatalog,
  MobileDamageReport,
  MobileDamageReportRow,
  MobileOperatorConfig,
  MobileSlotCalculation,
  MobileTimelineSlot,
} from '../model';
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

const REPORT_PAGES: Array<{ id: ReportPageId; index: string; label: string }> = [
  { id: 'team', index: '01', label: '队伍配置' },
  { id: 'timeline', index: '02', label: '排轴概览' },
  { id: 'charts', index: '03', label: '伤害图表' },
];

const EQUIPMENT_SLOT_ORDER = ['armor', 'glove', 'accessory1', 'accessory2'] as const;
const SKILL_LEVEL_ORDER = ['A', 'B', 'E', 'Q', 'Dot'] as const;
const ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '灼热',
  ice: '寒冷',
  electric: '电磁',
  nature: '自然',
};

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

function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none';
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

function getEquipmentLevelText(
  config: MobileOperatorConfig | undefined,
  slotKey: (typeof EQUIPMENT_SLOT_ORDER)[number],
): string {
  const levels = Object.values(config?.equipment[slotKey]?.effectLevels ?? {})
    .filter((level): level is number => Number.isFinite(level));
  return levels.length > 0 ? levels.map((level) => `Lv.${level}`).join(' / ') : '未设词条';
}

function getEquipmentSetName(snapshot: ConfigSnapshot | undefined): string {
  return Array.from(new Set(snapshot?.equipment.setBuffs.map((buff) => buff.gearSetName).filter(Boolean) ?? [])).join(' / ');
}

function ReportSlideHeader({ index, title, note }: { index: string; title: string; note: string }) {
  return (
    <header className="mobile-report-slide-heading">
      <span>{index}</span>
      <div><h2>{title}</h2><p>{note}</p></div>
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
}: {
  operators: Character[];
  operatorConfigs: Record<string, MobileOperatorConfig>;
  operatorSnapshots: Record<string, ConfigSnapshot>;
  weapons: MobileCatalog['weapons'];
  equipmentMap: Map<string, EquipmentItem>;
}) {
  return (
    <section className="mobile-report-slide" aria-labelledby="mobile-report-team-title">
      <ReportSlideHeader index="01" title="队伍配置" note="当前干员、武器、装备与技能等级" />
      {operators.length === 0 ? <EmptyReportState>选好干员后，这里会生成队伍配置页。</EmptyReportState> : (
        <div className="mobile-report-team-list">
          {operators.map((operator) => {
            const config = operatorConfigs[operator.id];
            const snapshot = operatorSnapshots[operator.id];
            const weapon = findWeapon(weapons, config?.weapon.weaponId);
            const avatarUrl = normalizeAssetUrl(operator.avatarUrl) || resolveAvatarUrl(operator.name);
            const setName = getEquipmentSetName(snapshot);
            const potentialCount = snapshot?.operator.potentialCount ?? getPotentialCount(config?.potential);
            return (
              <article key={operator.id} className="mobile-report-loadout-row">
                <div className="mobile-report-operator-portrait" data-fallback={operator.name.slice(0, 1)}>
                  {avatarUrl ? <img src={avatarUrl} alt={operator.name} onError={handleImageError} /> : null}
                  <span className="mobile-report-potential">★ {potentialCount}</span>
                  <span className="mobile-report-operator-caption">
                    <strong>{operator.name}</strong>
                    <small>Lv.{config?.level ?? '—'} · {ELEMENT_LABELS[operator.element] ?? operator.element} · {operator.profession}</small>
                  </span>
                </div>

                <div className="mobile-report-loadout-body">
                  <section className="mobile-report-weapon-panel">
                    <span className="mobile-report-block-label">WEAPON</span>
                    <strong>{weapon?.name || '未配置武器'}</strong>
                    <small>Lv.{config?.weapon.level ?? '—'} · {config?.weapon.potential || '无潜能配置'}</small>
                    <div className="mobile-report-level-rail" aria-label="武器技能等级">
                      <span>能力 {config?.weapon.skillLevels.skill1 ?? '—'}</span>
                      <span>属性 {config?.weapon.skillLevels.skill2 ?? '—'}</span>
                      <span>特效 {config?.weapon.skillLevels.skill3 ?? '—'}</span>
                    </div>
                    <div className="mobile-report-weapon-art" data-fallback="无">
                      {weapon?.imgUrl ? <img src={normalizeAssetUrl(weapon.imgUrl)} alt={weapon.name} onError={handleImageError} /> : null}
                    </div>
                  </section>

                  {setName ? <div className="mobile-report-set-name">套装 / {setName}</div> : null}
                  <div className="mobile-report-equipment-grid">
                    {EQUIPMENT_SLOT_ORDER.map((slotKey) => {
                      const equipmentId = config?.equipment[slotKey]?.equipmentId ?? '';
                      const item = equipmentMap.get(equipmentId);
                      return (
                        <section key={slotKey} className="mobile-report-equipment-panel">
                          <span>{item?.part || (slotKey.startsWith('accessory') ? '配件' : slotKey === 'armor' ? '护甲' : '护手')}</span>
                          <strong>{item?.name || '未配置'}</strong>
                          <small>{getEquipmentLevelText(config, slotKey)}</small>
                          <div className="mobile-report-equipment-art" data-fallback="＋">
                            {item?.imgUrl ? <img src={normalizeAssetUrl(item.imgUrl)} alt={item.name} onError={handleImageError} /> : null}
                          </div>
                        </section>
                      );
                    })}
                  </div>

                  <div className="mobile-report-skill-levels" aria-label={`${operator.name}技能等级`}>
                    {SKILL_LEVEL_ORDER.map((skillKey) => (
                      <span key={skillKey}><b>{skillKey}</b><strong>{config?.skillLevels[skillKey] ?? '—'}</strong></span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TimelineReportSlide({
  operators,
  entries,
  totalExpected,
}: {
  operators: Character[];
  entries: TimelineReportEntry[];
  totalExpected: number;
}) {
  return (
    <section className="mobile-report-slide" aria-labelledby="mobile-report-timeline-title">
      <ReportSlideHeader index="02" title="排轴概览" note="按干员轨道保留技能先后顺序" />
      <div className="mobile-report-timeline-summary">
        <span><small>有效动作</small><strong>{entries.length}</strong></span>
        <span><small>累计期望</small><strong>{formatDamage(totalExpected)}</strong></span>
      </div>
      {entries.length === 0 ? <EmptyReportState>完成排轴后，这里会按干员生成技能轨道。</EmptyReportState> : (
        <div className="mobile-report-lanes">
          {operators.map((operator) => {
            const operatorEntries = entries.filter((entry) => entry.operator.id === operator.id);
            const operatorTotal = operatorEntries.reduce(
              (sum, entry) => sum + toSafeAmount(entry.calculation?.result.summary.totalExpected),
              0,
            );
            const avatarUrl = normalizeAssetUrl(operator.avatarUrl) || resolveAvatarUrl(operator.name);
            return (
              <article key={operator.id} className="mobile-report-lane">
                <header>
                  <span className="mobile-report-lane-avatar" data-fallback={operator.name.slice(0, 1)}>
                    {avatarUrl ? <img src={avatarUrl} alt="" onError={handleImageError} /> : null}
                  </span>
                  <span><strong>{operator.name}</strong><small>{operatorEntries.length} 次技能 · {formatDamage(operatorTotal)}</small></span>
                </header>
                <div className="mobile-report-lane-track" data-mobile-pager-lock>
                  {operatorEntries.length === 0 ? <span className="mobile-report-lane-empty">本轴暂无动作</span> : operatorEntries.map((entry) => (
                    <div key={entry.slotId} className="mobile-report-axis-action">
                      <span className="mobile-report-axis-order">{String(entry.order).padStart(2, '0')}</span>
                      <span className="mobile-report-axis-icon" data-fallback={entry.action.skillType}>
                        {entry.action.skillIconUrl ? <img src={normalizeAssetUrl(entry.action.skillIconUrl)} alt="" onError={handleImageError} /> : null}
                      </span>
                      <span className="mobile-report-axis-copy">
                        <strong>{entry.action.skillName}</strong>
                        <small>{formatDamage(entry.calculation?.result.summary.totalExpected)}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function getPolarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = angle * (Math.PI / 180);
  return { x: cx + Math.cos(radians) * radius, y: cy + Math.sin(radians) * radius };
}

function getRoundedSectorPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const angleSpan = endAngle - startAngle;
  if (angleSpan >= 359.999) {
    const outerStart = getPolarPoint(cx, cy, radius, startAngle);
    const opposite = getPolarPoint(cx, cy, radius, startAngle + 180);
    return `M ${outerStart.x} ${outerStart.y} A ${radius} ${radius} 0 1 1 ${opposite.x} ${opposite.y} A ${radius} ${radius} 0 1 1 ${outerStart.x} ${outerStart.y} Z`;
  }
  const cornerRadius = Math.min(4, radius * 0.22);
  const cornerAngle = (cornerRadius / radius) * (180 / Math.PI);
  const innerRadius = Math.min(3.2, radius * 0.24);
  const innerStart = getPolarPoint(cx, cy, innerRadius, startAngle);
  const innerEnd = getPolarPoint(cx, cy, innerRadius, endAngle);
  const radialStart = getPolarPoint(cx, cy, radius - cornerRadius, startAngle);
  const outerStartControl = getPolarPoint(cx, cy, radius, startAngle);
  const outerStart = getPolarPoint(cx, cy, radius, startAngle + cornerAngle);
  const outerEnd = getPolarPoint(cx, cy, radius, endAngle - cornerAngle);
  const outerEndControl = getPolarPoint(cx, cy, radius, endAngle);
  const radialEnd = getPolarPoint(cx, cy, radius - cornerRadius, endAngle);
  return [
    `M ${innerStart.x} ${innerStart.y}`,
    `L ${radialStart.x} ${radialStart.y}`,
    `Q ${outerStartControl.x} ${outerStartControl.y} ${outerStart.x} ${outerStart.y}`,
    `A ${radius} ${radius} 0 ${angleSpan > 180 ? 1 : 0} 1 ${outerEnd.x} ${outerEnd.y}`,
    `Q ${outerEndControl.x} ${outerEndControl.y} ${radialEnd.x} ${radialEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `Q ${cx} ${cy} ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function OperatorRoseChart({ rows }: { rows: DisplayReportRow[] }) {
  const positiveRows = rows.filter((row) => row.expected > 0);
  const total = positiveRows.reduce((sum, row) => sum + row.expected, 0);
  if (positiveRows.length === 0 || total <= 0) return <EmptyReportState>暂无干员伤害数据</EmptyReportState>;

  const maxExpected = Math.max(...positiveRows.map((row) => row.expected), 1);
  const slotAngle = 360 / positiveRows.length;
  const petals = positiveRows.map((row, index) => ({
    row,
    index,
    startAngle: -180 + index * slotAngle + Math.min(2.4, slotAngle * 0.025) / 2,
    endAngle: -180 + (index + 1) * slotAngle - Math.min(2.4, slotAngle * 0.025) / 2,
    radius: 47 * Math.sqrt(row.expected / maxExpected),
  }));

  return (
    <div className="mobile-report-rose-layout">
      <svg viewBox="0 0 100 100" className="mobile-report-rose" role="img" aria-label="干员伤害占比扇瓣图">
        {petals.map(({ row, startAngle, endAngle }) => (
          <path key={`base-${row.id}`} className="mobile-report-petal-base" d={getRoundedSectorPath(50, 50, 47, startAngle, endAngle)} />
        ))}
        {petals.map(({ row, index, startAngle, endAngle, radius }) => (
          <path key={row.id} className={`mobile-report-petal-value is-segment-${index % 4}`} d={getRoundedSectorPath(50, 50, radius, startAngle, endAngle)} />
        ))}
        <circle cx="50" cy="50" r="2.2" className="mobile-report-petal-hub" />
      </svg>
      <ol className="mobile-report-chart-legend">
        {positiveRows.map((row, index) => (
          <li key={row.id}>
            <i className={`is-segment-${index % 4}`} />
            <span><strong>{row.label}</strong><small>{formatDamage(row.expected)}</small></span>
            <b>{formatPercentage(row.expected / total)}</b>
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
  const areaPath = `${linePath} L ${chartPoints.at(-1)?.x ?? 24} 122 L ${chartPoints[0]?.x ?? 24} 122 Z`;

  return (
    <svg className="mobile-report-line-chart" viewBox="0 0 320 150" role="img" aria-label="累计伤害时序折线图">
      {[30, 61, 92, 122].map((y) => <path key={y} d={`M 24 ${y} H 300`} className="mobile-report-chart-grid-line" />)}
      <path d="M 24 20 V 122 H 300" className="mobile-report-chart-axis" />
      <path d={areaPath} className="mobile-report-chart-area" />
      <path d={linePath} className="mobile-report-chart-line" />
      {chartPoints.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="3.2" />)}
      <text x="24" y="14">累计总伤 {formatDamage(runningTotal)}</text>
      <text x="300" y="142" textAnchor="end">{entries.length} 次技能</text>
    </svg>
  );
}

function SkillDamageBars({ rows }: { rows: DisplayReportRow[] }) {
  const maxExpected = Math.max(...rows.map((row) => row.expected), 0);
  if (rows.length === 0 || maxExpected <= 0) return <EmptyReportState>暂无技能伤害数据</EmptyReportState>;
  return (
    <ol className="mobile-report-skill-bars">
      {rows.map((row) => {
        const parts = row.label.split(/\s*[·｜|]\s*/).filter(Boolean);
        return (
          <li key={row.id}>
            <div><span><small>{parts[0]}</small><strong>{parts.slice(1).join(' · ') || row.label}</strong></span><b>{formatDamage(row.expected)}</b></div>
            <span className="mobile-report-skill-track"><i style={{ width: `${Math.max(1.5, row.expected / maxExpected * 100)}%` } as CSSProperties} /></span>
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
}: {
  report: MobileDamageReport;
  operatorRows: DisplayReportRow[];
  skillRows: DisplayReportRow[];
  entries: TimelineReportEntry[];
}) {
  return (
    <section className="mobile-report-slide" aria-labelledby="mobile-report-charts-title">
      <ReportSlideHeader index="03" title="伤害图表" note="复用 PPT 的占比、时序与技能明细" />
      <div className="mobile-report-damage-strip">
        <span><small>期望</small><strong>{formatDamage(report.totalExpected)}</strong></span>
        <span><small>非暴击</small><strong>{formatDamage(report.totalNonCrit)}</strong></span>
        <span><small>暴击</small><strong>{formatDamage(report.totalCrit)}</strong></span>
      </div>
      <article className="mobile-report-chart-card">
        <h3><span>图 1</span>干员伤害占比</h3>
        <OperatorRoseChart rows={operatorRows} />
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
        <TimelineReportSlide operators={operators} entries={entries} totalExpected={safeReport.totalExpected} />
      ) : (
        <ChartReportSlide report={safeReport} operatorRows={operatorRows} skillRows={skillRows} entries={entries} />
      )}
    </main>
  );
}

export default MobileReportPage;
