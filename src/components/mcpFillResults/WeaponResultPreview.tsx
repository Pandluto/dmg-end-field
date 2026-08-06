import type { WeaponDraft, WeaponEffectData } from '../../legacyFillCore/domains/weapon';
import { normalizeAssetUrl } from '../../utils/assetResolver';
import { getOperatorBuffTypeLabel, inferOperatorBuffUnit } from '../operatorDraftBuffModel';
import { formatWeaponSkillValueRange, normalizeWeaponSkillStatType } from './weaponResultFormatting';

type Props = { value: unknown };

const WEAPON_TYPE_LABELS: Record<string, string> = {
  sword: '单手剑',
  greatsword: '双手剑',
  claymore: '双手剑',
  polearm: '长柄武器',
  lance: '长柄武器',
  pistol: '手铳',
  handgun: '手铳',
  caster: '法术单元',
  arts: '法术单元',
  '单手剑': '单手剑',
  '双手剑': '双手剑',
  '长柄': '长柄武器',
  '长柄武器': '长柄武器',
  '手铳': '手铳',
  '法术单元': '法术单元',
};

const STAT_LABELS: Record<string, string> = {
  strength: '力量',
  agility: '敏捷',
  intelligence: '智识',
  will: '意志',
  special: '武器特效',
};

function asWeaponDraft(value: unknown): WeaponDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draft = value as Partial<WeaponDraft>;
  if (typeof draft.name !== 'string' || !draft.skills || typeof draft.skills !== 'object') return null;
  return value as WeaponDraft;
}

function orderedNumericEntries(values: Record<string, number> | undefined) {
  return Object.entries(values || {})
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .sort(([a], [b]) => Number(a) - Number(b));
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function formatEffectValue(type: string, value: number) {
  if (inferOperatorBuffUnit(type) === 'percent') return `${formatNumber(value * 100)}%`;
  return formatNumber(value);
}

function formatLevelRange(effect: WeaponEffectData) {
  const entries = orderedNumericEntries(effect.levels);
  if (!entries.length) return '暂无等级数值';
  const [firstLevel, firstValue] = entries[0];
  const [lastLevel, lastValue] = entries[entries.length - 1];
  if (firstLevel === lastLevel) return `Lv.${firstLevel} ${formatEffectValue(effect.type, firstValue)}`;
  return `Lv.${firstLevel} ${formatEffectValue(effect.type, firstValue)} → Lv.${lastLevel} ${formatEffectValue(effect.type, lastValue)}`;
}

export function WeaponResultPreview({ value }: Props) {
  const draft = asWeaponDraft(value);
  if (!draft) return <div className="mcp-result-empty">这份武器结果暂时无法预览。</div>;

  const skills = Object.entries(draft.skills || {});
  const effects = skills.flatMap(([, skill]) => Object.values(skill.effects || {}));
  const growth = orderedNumericEntries(draft.attackGrowth);
  const growthSummary = growth.length
    ? `Lv.${growth[0][0]} ${formatNumber(growth[0][1])} → Lv.${growth[growth.length - 1][0]} ${formatNumber(growth[growth.length - 1][1])}`
    : '未填写攻击成长';
  const imageUrl = draft.imgUrl ? normalizeAssetUrl(draft.imgUrl) : '';

  return (
    <article className="mcp-domain-result is-weapon">
      <header className="mcp-domain-result-hero">
        <div className="mcp-domain-result-image" aria-hidden={!imageUrl}>
          {imageUrl ? <img src={imageUrl} alt="" /> : <span>武器</span>}
        </div>
        <div className="mcp-domain-result-heading">
          <span className="mcp-domain-result-kicker">武器资料已整理</span>
          <h1>{draft.name}</h1>
          <p>{draft.description || '没有补充说明。'}</p>
          <div className="mcp-domain-result-tags">
            <span>{'★'.repeat(Math.max(1, Math.min(6, Number(draft.rarity) || 1)))}</span>
            <span>{WEAPON_TYPE_LABELS[draft.type] || draft.type || '未设置类型'}</span>
            <span>{skills.length} 个技能</span>
            <span>{effects.length} 个特效</span>
          </div>
        </div>
      </header>

      <section className="mcp-domain-result-summary">
        <div><span>攻击成长</span><strong>{growthSummary}</strong></div>
        <div><span>写入结果</span><strong>新增或更新 1 把武器</strong></div>
      </section>

      <section className="mcp-domain-result-section">
        <div className="mcp-domain-result-section-title"><h2>技能结果</h2><span>等级数值已压缩为首尾区间</span></div>
        <div className="mcp-result-card-list">
          {skills.map(([skillKey, skill]) => {
            const skillEffects = Object.values(skill.effects || {});
            const normalizedStatType = normalizeWeaponSkillStatType(skill.statType || '');
            const valueRange = formatWeaponSkillValueRange(normalizedStatType, skill.levels);
            return (
              <article className="mcp-result-card" key={skillKey}>
                <div className="mcp-result-card-heading">
                  <div><small>{skillKey === 'skill1' ? '能力值' : skillKey === 'skill2' ? '属性' : '特效'}</small><h3>{skill.name}</h3></div>
                  <span>{STAT_LABELS[skill.statType] || getOperatorBuffTypeLabel(normalizedStatType)}</span>
                </div>
                {valueRange ? <p className="mcp-result-range">{valueRange}</p> : null}
                {skillEffects.length ? (
                  <div className="mcp-result-effect-list">
                    {skillEffects.map((effect, index) => (
                      <div key={`${effect.name}-${index}`}>
                        <strong>{effect.name}</strong>
                        <span>{getOperatorBuffTypeLabel(effect.type)} · {formatLevelRange(effect)}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="mcp-result-muted">没有额外特效</p>}
              </article>
            );
          })}
        </div>
      </section>
    </article>
  );
}
