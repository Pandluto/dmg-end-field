import { useMemo, type SyntheticEvent } from 'react';
import { useAppContext } from '../context/AppContext';
import { buildDamageReportSnapshot, DamageReportButtonRow, DamageReportCharacterRow } from '../core/services/damageReportService';
import { loadTimelineData } from '../core/repositories';
import { getOperatorConfigPageCache } from '../core/repositories/operatorConfigRepository';
import {
  GRID_NODE_COUNT,
  LINE_ROW_INDICES,
} from '../core/calculators/gridSnapLayout';
import { resolveRuntimeTemplateSkill } from '../core/services/skillDamageTemplateResolver';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { normalizeAssetUrl, resolveAvatarUrl, resolveSkillIconUrl } from '../utils/assetResolver';
import { getSelectedCharacterIds } from '../utils/storage';
import type { Character, SkillButtonData, TimelineData } from '../types';
import type { ConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import './DamageReportPptPage.css';

const REPORT_PPT_PATH = APP_ROUTE_PATHS.damageReportPpt;
const SLIDE_GROUPS_PER_PAGE = 2;
const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
const BROWSE_MODE_SKILL_LABELS: Record<string, string> = {
  A: '重击',
  B: '战技',
  E: '连携技',
  Q: '终结技',
  Dot: '持续',
};

interface ReportOperator {
  id: string;
  name: string;
  avatarUrl?: string;
  profession?: string;
  element?: string;
}

type ReportWeaponLibrary = Record<string, { id: string; name: string; imgUrl: string }>;

type RawWeaponLibrary = Record<string, {
  id?: string;
  name?: string;
  imgUrl?: string;
}>;

const REPORT_POTENTIAL_STAR_SEGMENTS = [
  { id: 4, transform: undefined },
  { id: 3, transform: 'rotate(72 40 30)' },
  { id: 2, transform: 'rotate(144 40 30)' },
  { id: 1, transform: 'rotate(216 40 30)' },
  { id: 5, transform: 'rotate(288 40 30)' },
] as const;

function parsePotentialToCount(potential: string): number {
  if (potential.trim() === '满潜') {
    return 6;
  }
  const numeric = Number.parseInt(potential, 10);
  if (Number.isNaN(numeric)) {
    return 1;
  }
  return Math.min(6, Math.max(1, numeric + 1));
}

function getPotentialStarSegmentFill(segmentId: number, count: number): string {
  if (count === 6) {
    return '#FFFFFF';
  }
  if (segmentId === count) {
    return '#FFF000';
  }
  if (segmentId < count) {
    return '#FFFFFF';
  }
  return '#C7C7C7';
}

function ReportPotentialStar({ count, potential }: { count?: number; potential?: string }) {
  const resolvedCount = typeof count === 'number'
    ? Math.min(6, Math.max(1, count))
    : parsePotentialToCount(potential ?? '0潜');
  return (
    <span className={`report-ppt-potential-star-wrap${resolvedCount === 6 ? ' is-max' : ''}`} aria-hidden="true">
      <svg
        className="report-ppt-potential-star"
        viewBox="-24 -26 126 122"
        focusable="false"
      >
        {REPORT_POTENTIAL_STAR_SEGMENTS.map((segment) => (
          <polygon
            key={segment.id}
            points="5,42 82,42 102,53 25,53"
            fill={getPotentialStarSegmentFill(segment.id, resolvedCount)}
            transform={segment.transform}
          />
        ))}
      </svg>
    </span>
  );
}

function formatInteger(value: number): string {
  return Math.round(value || 0).toLocaleString('zh-CN');
}

function formatPercent(value: number): string {
  return `${((Number.isFinite(value) ? value : 0) * 100).toFixed(1)}%`;
}

function getButtonNodeIndex(button: SkillButtonData): number {
  return typeof button.nodeIndex === 'number' && Number.isFinite(button.nodeIndex)
    ? button.nodeIndex
    : 0;
}

function getButtonGroupIndex(button: SkillButtonData): number {
  return Math.max(0, Math.floor(getButtonNodeIndex(button) / GRID_NODE_COUNT));
}

function getButtonLocalNodeIndex(button: SkillButtonData): number {
  return Math.max(0, Math.min(GRID_NODE_COUNT - 1, getButtonNodeIndex(button) % GRID_NODE_COUNT));
}

function getTimelineGroups(timelineData: TimelineData | null): number[] {
  if (!timelineData) return [];
  const groupSet = new Set<number>();
  timelineData.staffLines.forEach((line) => {
    (line.buttons ?? []).forEach((button) => {
      groupSet.add(getButtonGroupIndex(button));
    });
  });
  return Array.from(groupSet).sort((a, b) => a - b);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getCharacterReport(
  character: ReportOperator,
  reportCharacters: DamageReportCharacterRow[]
): DamageReportCharacterRow | null {
  return reportCharacters.find((item) => item.characterId === character.id || item.characterName === character.name) ?? null;
}

function resolveStoredImageUrl(path?: string): string {
  if (!path) return '';
  if (/^(?:https?:)?\/\//i.test(path)) return path;
  if (/^[A-Za-z]:[\\/]/.test(path)) return path;
  return normalizeAssetUrl(path);
}

function resolveWeaponImageUrl(weaponName?: string): string {
  if (!weaponName) return '';
  return `http://127.0.0.1:31457/user-images/${encodeURIComponent(`${weaponName}.png`)}`;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function normalizeWeaponLibrary(raw: unknown): ReportWeaponLibrary {
  const source = raw && typeof raw === 'object' ? raw as RawWeaponLibrary : {};
  const next: ReportWeaponLibrary = {};
  Object.entries(source).forEach(([draftId, rawWeapon]) => {
    const weaponName = String(rawWeapon?.name || draftId).trim();
    if (!weaponName) return;
    next[weaponName] = {
      id: String(rawWeapon?.id || draftId || weaponName),
      name: weaponName,
      imgUrl: String(rawWeapon?.imgUrl || ''),
    };
  });
  return next;
}

function loadReportWeaponLibrary(): ReportWeaponLibrary {
  return normalizeWeaponLibrary(readLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, {}));
}

function handleReportImageError(fallbackText: string) {
  return (event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    const fallback = target.dataset.fallbackSrc;
    if (fallback && target.src !== fallback) {
      target.src = fallback;
      target.dataset.fallbackSrc = '';
      return;
    }
    target.style.display = 'none';
    target.parentElement?.setAttribute('data-fallback', fallbackText);
  };
}

function getCharacterSnapshot(character: ReportOperator): ConfigSnapshot | null {
  const cache = getOperatorConfigPageCache();
  return cache[character.id] ?? cache[character.name] ?? null;
}

function buildReportOperators(
  selectedCharacters: Character[],
  loadedCharacters: Character[],
  reportCharacters: DamageReportCharacterRow[]
): ReportOperator[] {
  if (selectedCharacters.length > 0) {
    return selectedCharacters.slice(0, 4).map((character) => ({
      id: character.id,
      name: character.name,
      avatarUrl: character.avatarUrl,
      profession: character.profession,
      element: character.element,
    }));
  }

  const selectedIds = getSelectedCharacterIds();
  const loadedById = new Map(loadedCharacters.flatMap((character) => [
    [character.id, character],
    [character.name, character],
  ]));
  const restored = selectedIds
    .map((id) => loadedById.get(id))
    .filter((character): character is Character => Boolean(character))
    .slice(0, 4)
    .map((character) => ({
      id: character.id,
      name: character.name,
      avatarUrl: character.avatarUrl,
      profession: character.profession,
      element: character.element,
    }));

  if (restored.length > 0) {
    return restored;
  }

  return reportCharacters.slice(0, 4).map((character) => ({
    id: character.characterId,
    name: character.characterName,
    profession: '',
    element: '',
  }));
}

function getWeaponLevelItems(snapshot: ConfigSnapshot | null): number[] {
  const levels = snapshot?.weapon.config.skillLevels;
  return [levels?.skill1 ?? 9, levels?.skill2 ?? 9, levels?.skill3 ?? 4];
}

function getEquipmentPieces(snapshot: ConfigSnapshot | null) {
  return (snapshot?.equipment.pieces ?? []).slice(0, 4);
}

function getEquipmentSetName(snapshot: ConfigSnapshot | null): string {
  const names = Array.from(new Set((snapshot?.equipment.setBuffs ?? [])
    .map((buff) => buff.gearSetName)
    .filter(Boolean)));
  return names.join(' / ');
}

function getWeaponName(snapshot: ConfigSnapshot | null, reportCharacter: DamageReportCharacterRow | null): string {
  return snapshot?.weapon.name || reportCharacter?.weaponName || '';
}

function getWeaponImageUrl(
  weaponName: string,
  snapshot: ConfigSnapshot | null,
  weaponLibrary: ReportWeaponLibrary
): string {
  const snapshotWeapon = snapshot?.weapon as unknown as { id?: string; name?: string; imgUrl?: string };
  const libraryItem = weaponLibrary[weaponName] || weaponLibrary[snapshotWeapon?.id || ''] || weaponLibrary[snapshotWeapon?.name || ''];
  return resolveStoredImageUrl(snapshotWeapon?.imgUrl)
    || resolveStoredImageUrl(libraryItem?.imgUrl)
    || resolveWeaponImageUrl(weaponName);
}

function getAvatarImageUrl(character: ReportOperator): string {
  if (character.name === '未选择') return '';
  return resolveStoredImageUrl(character.avatarUrl) || resolveAvatarUrl(character.name);
}

function getSkillLevelItems(
  snapshot: ConfigSnapshot | null,
  reportCharacter: DamageReportCharacterRow | null
): Array<{ key: string; value: string }> {
  const reportedItems = reportCharacter?.skillLevels
    .map((item) => {
      const match = item.match(/^(Dot|[ABEQ])\s*[-:：]?\s*(.*)$/i);
      return match ? { key: match[1].toLowerCase() === 'dot' ? 'Dot' : match[1].toUpperCase(), value: match[2]?.trim() || '-' } : null;
    })
    .filter((item): item is { key: string; value: string } => Boolean(item));
  const reportedByKey = new Map((reportedItems ?? []).map((item) => [item.key, item.value]));
  const config = snapshot?.operator.skillConfig as Partial<Record<'A' | 'B' | 'E' | 'Q' | 'Dot', string>> | undefined;
  return (['A', 'B', 'E', 'Q', 'Dot'] as const).map((key) => ({
    key,
    value: reportedByKey.get(key) ?? config?.[key] ?? '-',
  }));
}

function ReportLevelRows({ levels, className }: { levels: number[]; className: string }) {
  return (
    <div className={className}>
      {levels.slice(0, 3).map((level, index) => (
        <div key={index} className="report-ppt-level-row">
          <div className="report-ppt-level-capsule">
            <i className={level > 0 ? 'is-active' : ''} />
          </div>
          <strong>{level || '-'}</strong>
        </div>
      ))}
    </div>
  );
}

function resolveTimelineSkillIcon(button: SkillButtonData, character?: ReportOperator): string {
  const runtimeSkill = resolveRuntimeTemplateSkill({
    id: button.id,
    characterId: character?.id ?? button.characterId ?? button.characterName,
    characterName: button.characterName,
    skillType: button.skillType,
    position: button.position,
    staffIndex: button.staffIndex,
    lineIndex: button.staffIndex,
    isDragging: false,
    isSelected: false,
    isFromSandbox: true,
    runtimeSkillId: button.runtimeSkillId,
    skillDisplayName: button.skillDisplayName,
    skillIconUrl: button.skillIconUrl,
    customHits: button.customHits,
    element: character?.element,
  });
  return normalizeAssetUrl(runtimeSkill?.iconUrl ?? button.skillIconUrl ?? resolveSkillIconUrl(button.characterName, button.skillType));
}

function buildCharacterDamageRows(buttons: DamageReportButtonRow[]) {
  const byCharacter = new Map<string, { name: string; expected: number }>();
  buttons.forEach((button) => {
    const current = byCharacter.get(button.characterId) ?? { name: button.characterName, expected: 0 };
    current.expected += button.expected;
    byCharacter.set(button.characterId, current);
  });
  return Array.from(byCharacter.entries())
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.expected - a.expected);
}

function PieChart({ rows }: { rows: ReturnType<typeof buildCharacterDamageRows> }) {
  const total = rows.reduce((sum, row) => sum + row.expected, 0);
  const colors = ['#111111', '#565656', '#9a9a9a', '#d2d2d2'];
  let offset = 0;

  if (total <= 0) {
    return <div className="report-ppt-empty-chart">暂无伤害数据</div>;
  }

  return (
    <div className="report-ppt-pie-layout">
      <svg className="report-ppt-pie" viewBox="0 0 42 42" aria-label="干员伤害占比">
        <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(0,0,0,0.08)" strokeWidth="8" />
        {rows.map((row, index) => {
          const share = row.expected / total;
          const dash = `${share * 100} ${100 - share * 100}`;
          const circle = (
            <circle
              key={row.id}
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              stroke={colors[index % colors.length]}
              strokeWidth="8"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += share * 100;
          return circle;
        })}
      </svg>
      <div className="report-ppt-chart-legend">
        {rows.map((row, index) => (
          <div key={row.id} className="report-ppt-legend-row">
            <span style={{ background: colors[index % colors.length] }} />
            <strong>{row.name}</strong>
            <em>{formatInteger(row.expected)} / {formatPercent(row.expected / total)}</em>
          </div>
        ))}
        <div className="report-ppt-chart-total">总伤 {formatInteger(total)}</div>
      </div>
    </div>
  );
}

function LineChart({ buttons }: { buttons: DamageReportButtonRow[] }) {
  let runningTotal = 0;
  const points = buttons.map((button, index) => {
    runningTotal += button.expected;
    return {
      x: index,
      y: runningTotal,
      label: `${button.orderLabel} ${button.characterName}`,
    };
  });
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? 8 : 8 + (point.x / (points.length - 1)) * 84;
    const y = 86 - (point.y / maxY) * 68;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  if (points.length === 0) {
    return <div className="report-ppt-empty-chart">暂无时序数据</div>;
  }

  return (
    <svg className="report-ppt-line" viewBox="0 0 100 100" aria-label="伤害过程折线图">
      <path d="M 8 12 V 86 H 94" fill="none" stroke="rgba(0,0,0,0.34)" strokeWidth="0.8" />
      <path d={path} fill="none" stroke="#111111" strokeWidth="1.4" />
      {points.map((point) => {
        const x = points.length <= 1 ? 8 : 8 + (point.x / (points.length - 1)) * 84;
        const y = 86 - (point.y / maxY) * 68;
        return <circle key={point.label} cx={x} cy={y} r="1.7" fill="#ffffff" stroke="#111111" strokeWidth="0.8" />;
      })}
      <text x="8" y="9" className="report-ppt-line-label">累计总伤 {formatInteger(runningTotal)}</text>
      <text x="94" y="94" className="report-ppt-line-label" textAnchor="end">{points.length} 次按钮</text>
    </svg>
  );
}

function TeamSlide({
  characters,
  reportCharacters,
  weaponLibrary,
}: {
  characters: ReportOperator[];
  reportCharacters: DamageReportCharacterRow[];
  weaponLibrary: ReportWeaponLibrary;
}) {
  const displayCharacters = characters.length > 0
    ? characters.slice(0, 4)
    : Array.from({ length: 4 }, (_, index) => ({
      id: `empty-${index}`,
      name: '未选择',
      avatarUrl: undefined,
      profession: '干员',
      element: '-',
    } satisfies ReportOperator));

  return (
    <section className="report-ppt-slide">
      <div className="report-ppt-slide-inner">
        <header className="report-ppt-slide-head">
          <span>01</span>
          <h1>队伍配置</h1>
        </header>
        <div className="report-ppt-team-list">
          {displayCharacters.map((character) => {
            const reportCharacter = getCharacterReport(character, reportCharacters);
            const snapshot = getCharacterSnapshot(character);
            const equipmentPieces = getEquipmentPieces(snapshot);
            const weaponName = getWeaponName(snapshot, reportCharacter);
            const equipmentSetName = getEquipmentSetName(snapshot);
            const avatarUrl = getAvatarImageUrl(character);
            const weaponImageUrl = weaponName ? getWeaponImageUrl(weaponName, snapshot, weaponLibrary) : '';
            const skillLevelItems = getSkillLevelItems(snapshot, reportCharacter);
            return (
              <article key={character.id} className="report-ppt-operator-row">
                <div className="report-ppt-avatar-frame">
                  {avatarUrl ? (
                    <img
                      className="report-ppt-avatar"
                      src={avatarUrl}
                      data-fallback-src={resolveAvatarUrl(character.name)}
                      alt={character.name}
                      onError={handleReportImageError(character.name.slice(0, 2))}
                    />
                  ) : null}
                  <ReportPotentialStar
                    count={snapshot?.operator.potentialCount}
                    potential={snapshot?.operator.potential}
                  />
                  <div className="report-ppt-operator-main">
                    <h2>{character.name}</h2>
                  </div>
                  <div className="report-ppt-operator-level">Lv.{snapshot?.operator.level ?? '-'}</div>
                </div>
                <div className="report-ppt-weapon-block">
                  <div className="report-ppt-weapon-image-frame">
                    <div className="report-ppt-weapon-image" data-fallback={weaponName ? undefined : '无'}>
                      {weaponImageUrl ? (
                        <img
                          src={weaponImageUrl}
                          data-fallback-src={resolveWeaponImageUrl(weaponName)}
                          alt={weaponName}
                          onError={handleReportImageError(weaponName.slice(0, 2))}
                        />
                      ) : null}
                    </div>
                    <ReportPotentialStar
                      count={snapshot?.weapon.config.potentialCount}
                      potential={snapshot?.weapon.config.potential}
                    />
                    <div className="report-ppt-weapon-name">{weaponName || '无'}</div>
                    <div className="report-ppt-weapon-level">Lv.{snapshot?.weapon.config.level ?? '-'}</div>
                  </div>
                  <ReportLevelRows levels={getWeaponLevelItems(snapshot)} className="report-ppt-weapon-level-rows" />
                </div>
                <div className="report-ppt-equipment-block">
                  {equipmentSetName ? <div className="report-ppt-equipment-set-name">{equipmentSetName}</div> : null}
                  <div className="report-ppt-equipment-icons">
                    {equipmentPieces.length === 0 ? (
                      <strong>未配置</strong>
                    ) : (
                      equipmentPieces.map((piece) => {
                        const levels = piece.effects.map((effect) => Number(effect.level) || 0);
                        return (
                        <div key={`${character.id}-${piece.slotKey}`} className="report-ppt-weapon-equipment-item" title={piece.name}>
                          <div className="report-ppt-equipment-image-frame">
                            <div className="report-ppt-equipment-icon">
                              {piece.imgUrl ? (
                                <img
                                  src={resolveStoredImageUrl(piece.imgUrl)}
                                  alt={piece.name}
                                  onError={handleReportImageError(piece.part || piece.name.slice(0, 2))}
                                />
                              ) : (
                                <span>{piece.part || piece.name.slice(0, 2)}</span>
                              )}
                            </div>
                            <div className="report-ppt-equipment-name">{piece.name}</div>
                          </div>
                          <ReportLevelRows levels={levels} className="report-ppt-equipment-level-rows" />
                        </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="report-ppt-skill-levels" aria-label="技能等级">
                  {skillLevelItems.map((item) => (
                    <span key={item.key}>
                      <b>{item.key}</b>
                      <strong>{item.value}</strong>
                    </span>
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

function TimelineGroupSlide({
  pageIndex,
  groupIndices,
  timelineData,
  characters,
}: {
  pageIndex: number;
  groupIndices: number[];
  timelineData: TimelineData | null;
  characters: ReportOperator[];
}) {
  const characterByName = new Map(characters.map((character) => [character.name, character]));
  const displayedGroupIndices = groupIndices.length > 0 ? groupIndices : [0, 1];

  return (
    <section className="report-ppt-slide">
      <div className="report-ppt-slide-inner">
        <header className="report-ppt-slide-head">
          <span>{String(pageIndex).padStart(2, '0')}</span>
          <h1>排轴概览</h1>
        </header>
        <div className="report-ppt-timeline-page">
          {displayedGroupIndices.map((groupIndex) => (
            <article key={groupIndex} className="report-ppt-axis-group">
              <h2>第 {groupIndex + 1} 组轴</h2>
              <div className="report-ppt-axis-lines">
                {LINE_ROW_INDICES.map((_, lineIndex) => {
                  const staffLine = timelineData?.staffLines[lineIndex];
                  const character = staffLine ? characterByName.get(staffLine.characterName) : characters[lineIndex];
                  const buttons = (staffLine?.buttons ?? [])
                    .filter((button) => getButtonGroupIndex(button) === groupIndex)
                    .sort((a, b) => getButtonLocalNodeIndex(a) - getButtonLocalNodeIndex(b));

                  return (
                    <div key={`${groupIndex}-${lineIndex}`} className="report-ppt-axis-line">
                      <div className="report-ppt-axis-label">
                        {character ? (
                          <img
                            src={getAvatarImageUrl(character)}
                            data-fallback-src={resolveAvatarUrl(character.name)}
                            alt={character.name}
                            onError={handleReportImageError(character.name.slice(0, 2))}
                          />
                        ) : null}
                      </div>
                      <div className="report-ppt-axis-track">
                        {buttons.map((button) => {
                          const buttonCharacter = characterByName.get(button.characterName);
                          const skillIconUrl = resolveTimelineSkillIcon(button, buttonCharacter);
                          const isDotButton = button.skillType === 'Dot';
                          const browseModeLabel = BROWSE_MODE_SKILL_LABELS[button.skillType] ?? button.skillType;
                          return (
                            <div
                              key={button.id}
                              className={`report-ppt-axis-button${isDotButton ? ' is-dot' : ''}`}
                              style={{ left: `${(getButtonLocalNodeIndex(button) / GRID_NODE_COUNT) * 100}%` }}
                              title={`${button.characterName} ${button.skillDisplayName ?? button.skillType}`}
                            >
                              <span className="report-ppt-axis-button-orb">
                                <img
                                  src={skillIconUrl}
                                  data-fallback-src={resolveSkillIconUrl(button.characterName, button.skillType)}
                                  alt=""
                                  onError={handleReportImageError(button.skillType)}
                                />
                              </span>
                              <span className="report-ppt-axis-button-body">{browseModeLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ChartSlide({
  pageIndex,
  snapshot,
}: {
  pageIndex: number;
  snapshot: ReturnType<typeof buildDamageReportSnapshot>;
}) {
  const rows = buildCharacterDamageRows(snapshot.buttons);

  return (
    <section className="report-ppt-slide">
      <div className="report-ppt-slide-inner">
        <header className="report-ppt-slide-head">
          <span>{String(pageIndex).padStart(2, '0')}</span>
          <h1>伤害图表</h1>
        </header>
        <div className="report-ppt-chart-grid">
          <article className="report-ppt-chart-card">
            <h2>图 1 / 干员伤害占比</h2>
            <PieChart rows={rows} />
          </article>
          <article className="report-ppt-chart-card">
            <h2>图 2 / 伤害过程时序</h2>
            <LineChart buttons={snapshot.buttons} />
          </article>
          <article className="report-ppt-chart-card is-placeholder">
            <h2>图 3</h2>
          </article>
          <article className="report-ppt-chart-card is-placeholder">
            <h2>图 4</h2>
          </article>
        </div>
      </div>
    </section>
  );
}

export function DamageReportPptPage() {
  const { state } = useAppContext();
  const snapshot = useMemo(() => buildDamageReportSnapshot(), []);
  const timelineData = useMemo(() => loadTimelineData(), []);
  const weaponLibrary = useMemo(() => loadReportWeaponLibrary(), []);
  const reportOperators = useMemo(
    () => buildReportOperators(state.selectedCharacters, state.loadedCharacters, snapshot.characters),
    [state.loadedCharacters, state.selectedCharacters, snapshot.characters]
  );
  const timelineGroups = useMemo(() => getTimelineGroups(timelineData), [timelineData]);
  const timelinePages = timelineGroups.length > 0 ? chunk(timelineGroups, SLIDE_GROUPS_PER_PAGE) : [[]];
  const chartPageIndex = 2 + timelinePages.length;
  const totalPages = chartPageIndex;

  return (
    <main className="report-ppt-page">
      <div className="report-ppt-toolbar">
        <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>返回</button>
        <div>
          <strong>伤害报表 PPT</strong>
          <span>{REPORT_PPT_PATH} / {totalPages} 页 / 总伤害 {formatInteger(snapshot.totalExpected)}</span>
        </div>
      </div>
      <div className="report-ppt-scroll">
        <TeamSlide characters={reportOperators} reportCharacters={snapshot.characters} weaponLibrary={weaponLibrary} />
        {timelinePages.map((groupIndices, index) => (
          <TimelineGroupSlide
            key={`timeline-page-${index}`}
            pageIndex={index + 2}
            groupIndices={groupIndices}
            timelineData={timelineData}
            characters={reportOperators}
          />
        ))}
        <ChartSlide pageIndex={chartPageIndex} snapshot={snapshot} />
      </div>
    </main>
  );
}

export function isDamageReportPptPath(path: string): boolean {
  return path === REPORT_PPT_PATH;
}
