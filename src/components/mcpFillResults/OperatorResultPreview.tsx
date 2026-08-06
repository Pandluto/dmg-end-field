import { ELEMENT_LABELS } from '../../core/calculators/buffCalculator';
import type { OperatorDraft } from '../../legacyFillCore/domains/operator';
import { normalizeAssetUrl } from '../../utils/assetResolver';
import {
  getBuffEffectSummary,
  getOperatorBuffTypeLabel,
  OPERATOR_BUFF_GROUPS,
} from '../operatorDraftBuffModel';

type Props = { value: unknown };

const ATTRIBUTE_LABELS = {
  strength: '力量',
  agility: '敏捷',
  intelligence: '智识',
  will: '意志',
  atk: '攻击',
  hp: '生命',
} as const;

function asOperatorDraft(value: unknown): OperatorDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draft = value as Partial<OperatorDraft>;
  if (typeof draft.name !== 'string' || !draft.skills || !draft.attributes) return null;
  return value as OperatorDraft;
}

export function OperatorResultPreview({ value }: Props) {
  const draft = asOperatorDraft(value);
  if (!draft) return <div className="mcp-result-empty">这份干员结果暂时无法预览。</div>;

  const skills = Object.entries(draft.skills || {});
  const buffGroups = OPERATOR_BUFF_GROUPS.map((group) => ({
    ...group,
    effects: Object.values(draft.buffs?.[group.key]?.effects || {}),
  }));
  const buffCount = buffGroups.reduce((sum, group) => sum + group.effects.length, 0);
  const imageUrl = draft.avatarUrl ? normalizeAssetUrl(draft.avatarUrl) : '';

  return (
    <article className="mcp-domain-result is-operator">
      <header className="mcp-domain-result-hero">
        <div className="mcp-domain-result-image is-avatar" aria-hidden={!imageUrl}>
          {imageUrl ? <img src={imageUrl} alt="" /> : <span>干员</span>}
        </div>
        <div className="mcp-domain-result-heading">
          <span className="mcp-domain-result-kicker">干员资料已整理</span>
          <h1>{draft.name}</h1>
          <p>{draft.profession || '未设置职业'} · {ELEMENT_LABELS[draft.element] || draft.element || '未设置元素'} · {draft.weapon || '未设置武器'}</p>
          <div className="mcp-domain-result-tags">
            <span>{'★'.repeat(Math.max(1, Math.min(6, Number(draft.rarity) || 1)))}</span>
            <span>Lv.{draft.level || 90}</span>
            <span>主属性 {draft.mainStat || '未设置'}</span>
            <span>{skills.length} 个技能</span>
            <span>{buffCount} 个 Buff</span>
          </div>
        </div>
      </header>

      <section className="mcp-domain-result-section">
        <div className="mcp-domain-result-section-title"><h2>满级面板</h2><span>只展示 Lv.90 结果</span></div>
        <div className="mcp-result-metrics">
          {Object.entries(ATTRIBUTE_LABELS).map(([key, label]) => (
            <div key={key}><span>{label}</span><strong>{draft.attributes?.[key as keyof typeof ATTRIBUTE_LABELS]?.level90 ?? 0}</strong></div>
          ))}
        </div>
      </section>

      <section className="mcp-domain-result-section">
        <div className="mcp-domain-result-section-title"><h2>技能结果</h2><span>{skills.reduce((sum, [, skill]) => sum + Object.keys(skill.hitMeta || {}).length, 0)} 个伤害段</span></div>
        <div className="mcp-result-card-list is-compact">
          {skills.map(([skillKey, skill]) => (
            <article className="mcp-result-card" key={skillKey}>
              <div className="mcp-result-card-heading">
                <div><small>{skill.buttonType}</small><h3>{skill.displayName}</h3></div>
                <span>{skill.hitCount || Object.keys(skill.hitMeta || {}).length} hit</span>
              </div>
              <p className="mcp-result-muted">
                {Object.values(skill.hitMeta || {}).map((hit) => `${hit.displayName} · ${ELEMENT_LABELS[hit.element] || hit.element}`).join('　') || '暂无伤害段'}
              </p>
            </article>
          ))}
        </div>
      </section>

      {buffCount ? (
        <section className="mcp-domain-result-section">
          <div className="mcp-domain-result-section-title"><h2>干员 Buff</h2><span>{buffCount} 个结果</span></div>
          <div className="mcp-result-effect-list is-card">
            {buffGroups.flatMap((group) => group.effects.map((effect) => (
              <div key={`${group.key}-${effect.effectId}`}>
                <strong>{effect.name}</strong>
                <span>{group.label} · {getOperatorBuffTypeLabel(effect.type)} · {getBuffEffectSummary(effect)}</span>
              </div>
            )))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
