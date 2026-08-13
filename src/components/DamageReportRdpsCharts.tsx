/**
 * RDPS 归因图表组件（v2）：图 3 RD 总表与图 4 四干员域拆分。
 * 使用语义 class；域显示中文；独立展示 Owen 效率误差、层级误差与总账误差；
 * legacy-resolved 不显示为缺失来源；负值保留符号。
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

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatPercent(value)}`;
}

function domainLabel(domain: 'operator' | 'weapon' | 'equipment'): string {
  if (domain === 'operator') return '干员本体';
  if (domain === 'weapon') return '武器';
  return '装备';
}

function isOwenSound(summary: RdpsAttributionSummary): boolean {
  const threshold = 1e-6 * Math.max(1, Math.abs(summary.attributionWorldTotal - summary.baselineTotal));
  return summary.owenEfficiencyError <= threshold;
}

/** 图 3：RD 总表。 */
export function RdpsTableChart({ summary }: { summary: RdpsAttributionSummary | undefined }) {
  if (!summary) {
    return <div className="rdps-empty">暂无归因数据</div>;
  }
  const rows = [...summary.sources].sort((left, right) => Math.abs(right.damage) - Math.abs(left.damage));
  const diagnostics = summary.diagnostics;
  const warnings: string[] = [];
  if (diagnostics.unresolvedDefinitionCount > 0 || diagnostics.unresolvedApplicationCount > 0) {
    warnings.push(`${diagnostics.unresolvedDefinitionCount} 个来源无法解析（${diagnostics.unresolvedApplicationCount} 处应用），已计入自身/其他`);
  }
  if (diagnostics.ambiguousDefinitionCount > 0) warnings.push(`${diagnostics.ambiguousDefinitionCount} 个来源存在歧义，已计入自身/其他`);
  if (diagnostics.outOfTeamCharacterCount > 0) warnings.push(`${diagnostics.outOfTeamCharacterCount} 个队伍外来源（仅图 3 对账）`);
  if (diagnostics.excludedImbalanceEffectCount > 0) warnings.push(`${diagnostics.excludedImbalanceEffectCount} 个失衡效果已严格排除`);
  if (diagnostics.negativeContributionCount > 0) warnings.push(`${diagnostics.negativeContributionCount} 个负贡献来源（保留符号）`);
  if (diagnostics.unresolvedDisplayNameCount > 0) warnings.push(`${diagnostics.unresolvedDisplayNameCount} 个干员显示名未解析`);

  return (
    <div className="is-rdps-table">
      <div className="rdps-table-summary">
        <span>总损伤 <strong>{formatInteger(summary.actualTotal)}</strong></span>
        <span>来源合计 <strong>{formatInteger(summary.attributedTotal)}</strong></span>
        <span>自身/其他 <strong>{formatInteger(summary.residualTotal)}</strong></span>
      </div>
      <table className="rdps-table">
        <thead>
          <tr>
            <th>来源</th>
            <th>域</th>
            <th className="rdps-num">贡献伤害</th>
            <th className="rdps-num">占比</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.negative ? 'rdps-negative' : undefined}>
              <td>{row.label}</td>
              <td>{row.domain ? domainLabel(row.domain) : '—'}</td>
              <td className="rdps-num">{formatInteger(row.damage)}</td>
              <td className="rdps-num">{formatSignedPercent(row.shareOfActual)}</td>
            </tr>
          ))}
          <tr className="rdps-residual-row">
            <td>自身/其他</td>
            <td>—</td>
            <td className="rdps-num">{formatInteger(summary.residualTotal)}</td>
            <td className="rdps-num">{summary.actualTotal > 0 ? formatPercent(summary.residualTotal / summary.actualTotal) : '—'}</td>
          </tr>
        </tbody>
      </table>
      <div className="rdps-error-row">
        <span>Owen 效率误差 <strong className={isOwenSound(summary) ? '' : 'rdps-error-strong'}>{formatInteger(summary.owenEfficiencyError)}</strong></span>
        <span>层级误差 <strong>{formatInteger(summary.hierarchyError)}</strong></span>
        <span>总账误差 <strong>{formatInteger(summary.accountingError)}</strong></span>
      </div>
      {warnings.length > 0 && (
        <div className="rdps-diagnostics">
          {warnings.map((warning) => <div key={warning}>⚠ {warning}</div>)}
        </div>
      )}
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
