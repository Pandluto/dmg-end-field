import type { BuffDraft, BuffEffectDraft } from '../../types/buffFill';
import { getOperatorBuffTypeLabel, inferOperatorBuffUnit } from '../operatorDraftBuffModel';

type Props = { value: unknown };

const CATEGORY_LABELS: Record<string, string> = {
  passive: '常驻',
  positive: '常驻',
  condition: '条件生效',
  countable: '可叠层',
};

function asBuffDraft(value: unknown): BuffDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const draft = value as Partial<BuffDraft>;
  if (typeof draft.name !== 'string' || !draft.items || typeof draft.items !== 'object') return null;
  return value as BuffDraft;
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function formatBuffValue(effect: BuffEffectDraft) {
  if (effect.effectKind === 'extraHit') {
    const multiplier = effect.extraHitConfig?.baseMultiplier ?? 1;
    return `${formatNumber(multiplier * 100)}% ${effect.extraHitConfig?.damageType || '物理'}伤害`;
  }
  if (effect.multiplier) return `×${formatNumber(effect.multiplier.coefficient)}`;
  const value = Number(effect.value ?? 0);
  return inferOperatorBuffUnit(effect.type || '') === 'percent' ? `${formatNumber(value)}%` : formatNumber(value);
}

export function BuffResultPreview({ value }: Props) {
  const draft = asBuffDraft(value);
  if (!draft) return <div className="mcp-result-empty">这份 Buff 结果暂时无法预览。</div>;

  const items = Object.values(draft.items || {});
  const effectCount = items.reduce((sum, item) => sum + Object.keys(item.effects || {}).length, 0);

  return (
    <article className="mcp-domain-result is-buff">
      <header className="mcp-domain-result-hero is-without-image">
        <div className="mcp-domain-result-heading">
          <span className="mcp-domain-result-kicker">Buff 资料已整理</span>
          <h1>{draft.name}</h1>
          <p>{draft.description || '没有补充说明。'}</p>
          <div className="mcp-domain-result-tags">
            <span>{draft.sourceName || '本地自定义'}</span>
            <span>{items.length} 个条目</span>
            <span>{effectCount} 个效果</span>
          </div>
        </div>
      </header>

      <section className="mcp-domain-result-summary">
        <div><span>写入结果</span><strong>新增或更新 1 组 Buff</strong></div>
        <div><span>效果组织</span><strong>{items.length} 个条目，共 {effectCount} 个效果</strong></div>
      </section>

      <section className="mcp-domain-result-section">
        <div className="mcp-domain-result-section-title"><h2>效果结果</h2><span>使用 Buff 编辑器的产品术语</span></div>
        <div className="mcp-result-card-list">
          {items.map((item) => (
            <article className="mcp-result-card" key={item.id}>
              <div className="mcp-result-card-heading">
                <div><small>Buff 条目</small><h3>{item.name}</h3></div>
                <span>{Object.keys(item.effects || {}).length} 个效果</span>
              </div>
              {item.description ? <p className="mcp-result-muted">{item.description}</p> : null}
              <div className="mcp-result-effect-list">
                {Object.values(item.effects || {}).map((effect) => (
                  <div key={effect.id}>
                    <strong>{effect.displayName || effect.name || effect.id}</strong>
                    <span>
                      {effect.effectKind === 'extraHit' ? '额外伤害段' : getOperatorBuffTypeLabel(effect.type || '')}
                      {' · '}{formatBuffValue(effect)}
                      {' · '}{CATEGORY_LABELS[effect.category || ''] || '条件生效'}
                      {effect.category === 'countable' ? `，最多 ${effect.maxStacks || 1} 层` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </article>
  );
}
