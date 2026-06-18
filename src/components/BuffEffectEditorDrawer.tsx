import { useEffect, useMemo, useState } from 'react';
import DeferredNumberInput, { parseIntegerInput } from './DeferredNumberInput';
import { EXTRA_HIT_DAMAGE_TYPES, normalizeExtraHitConfig } from '../core/services/buffExtraHit';
import * as buffModel from './operatorDraftBuffModel';
import './BuffEffectEditorDrawer.css';

const BUSINESS_TYPE_LABELS: Record<buffModel.OperatorBuffBusinessType, string> = {
  passive: 'passive 常驻',
  condition: 'condition 条件',
  countable: 'countable 计层',
  multiplier: 'multiplier 乘区乘算',
  extraHit: 'extraHit 额外伤害段',
};

export interface BuffDrawerLevelOption {
  key: string;
  label: string;
}

interface BuffEffectEditorDrawerProps {
  open: boolean;
  sourceLabel: string;
  effect: buffModel.OperatorBuffEffect | null;
  onChange: (effect: buffModel.OperatorBuffEffect) => void;
  onClose: () => void;
  levelOptions?: BuffDrawerLevelOption[];
  activeLevelKey?: string;
  onActiveLevelChange?: (levelKey: string) => void;
}

function buildSearchText(value: string) {
  return value.trim().toLowerCase();
}

export default function BuffEffectEditorDrawer({
  open,
  sourceLabel,
  effect,
  onChange,
  onClose,
  levelOptions = [],
  activeLevelKey,
  onActiveLevelChange,
}: BuffEffectEditorDrawerProps) {
  const [typeQuery, setTypeQuery] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) setTypeQuery('');
  }, [effect?.effectId, open]);

  const typeOptions = useMemo(() => buffModel.getFilteredOperatorBuffTypeOptions({
    query: typeQuery,
    selectedEffect: effect,
    buildSearchIndex: (values) => buildSearchText(values.filter(Boolean).join(' ')),
  }), [effect, typeQuery]);

  if (!open || !effect) return null;

  const businessType = buffModel.deriveOperatorBuffBusinessType(effect);
  const update = (next: buffModel.OperatorBuffEffect) => onChange(next);
  const config = normalizeExtraHitConfig(effect.extraHitConfig, `${effect.effectId}-extra-hit`);

  return (
    <div className="buff-editor-drawer-mask" onMouseDown={onClose}>
      <aside className="buff-editor-drawer" role="dialog" aria-modal="true" aria-label="Buff 编辑器" onMouseDown={(event) => event.stopPropagation()}>
        <header className="buff-editor-drawer-header">
          <div>
            <span>{sourceLabel}</span>
            <strong>{effect.name || effect.effectId || '未命名 Buff'}</strong>
            <small>{effect.effectId || '-'}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>

        {levelOptions.length > 0 ? (
          <div className="buff-editor-drawer-levels">
            {levelOptions.map((level) => (
              <button
                key={level.key}
                type="button"
                className={activeLevelKey === level.key ? 'is-active' : ''}
                onClick={() => onActiveLevelChange?.(level.key)}
              >
                {level.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="buff-editor-drawer-body">
          <section>
            <h4>基础</h4>
            <div className="buff-editor-drawer-grid">
              <label><span>名称</span><input value={effect.name} onChange={(event) => update({ ...effect, name: event.target.value })} /></label>
              <label><span>Effect ID</span><input value={effect.effectId} onChange={(event) => update({ ...effect, effectId: event.target.value })} /></label>
              <label className="is-wide">
                <span>业务类型</span>
                <select value={businessType} onChange={(event) => update(buffModel.applyBuffBusinessType(effect, event.target.value as buffModel.OperatorBuffBusinessType, effect.effectId))}>
                  {buffModel.OPERATOR_BUFF_BUSINESS_TYPES.map((type) => <option key={type} value={type}>{BUSINESS_TYPE_LABELS[type]}</option>)}
                </select>
              </label>
            </div>
          </section>

          {businessType !== 'extraHit' ? (
            <section>
              <h4>类型</h4>
              <div className="buff-editor-drawer-grid">
                <label className="is-wide">
                  <span>搜索 typeKey</span>
                  <input value={typeQuery} onChange={(event) => setTypeQuery(event.target.value)} placeholder="攻击 / 主能力 / 法术 / 暴击" />
                </label>
                <label className="is-wide">
                  <span>typeKey</span>
                  <select value={effect.type} onChange={(event) => update(buffModel.applyBuffType(effect, event.target.value))}>
                    <option value="">未设置类型</option>
                    {typeOptions.map((type) => <option key={type} value={type}>{buffModel.getOperatorBuffTypeDisplayLabel(type)}</option>)}
                  </select>
                </label>
                <label><span>单位</span><div className="buff-editor-drawer-readonly">{effect.type ? (buffModel.inferOperatorBuffUnit(effect.type) === 'percent' ? '%' : '固定值') : '-'}</div></label>
              </div>
            </section>
          ) : null}

          {businessType !== 'extraHit' && businessType !== 'multiplier' ? (
            <section>
              <h4>数值</h4>
              <div className="buff-editor-drawer-grid">
                <label>
                  <span>数值模式</span>
                  <select value={effect.valueMode ?? 'fixed'} disabled={businessType === 'countable'} onChange={(event) => update(buffModel.applyBuffValueMode(effect, event.target.value as buffModel.OperatorBuffValueMode))}>
                    <option value="fixed">固定数值</option>
                    <option value="derived">来源值派生</option>
                  </select>
                </label>
                {(effect.valueMode ?? 'fixed') === 'fixed' ? (
                  <label><span>{levelOptions.length ? '当前等级值' : '数值'}</span><DeferredNumberInput step="0.01" value={effect.value} onCommit={(value) => update(buffModel.applyFixedBuffValue(effect, value))} /></label>
                ) : (
                  <>
                    <label>
                      <span>来源值</span>
                      <select value={effect.derivedValue?.source ?? 'intelligence'} onChange={(event) => update(buffModel.applyDerivedBuffSource(effect, event.target.value as buffModel.OperatorBuffDerivedSource))}>
                        {buffModel.OPERATOR_BUFF_DERIVED_SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label><span>{levelOptions.length ? '当前等级每点提升' : '每点提升'}</span><DeferredNumberInput step="0.0001" value={effect.derivedValue?.perPointValue} onCommit={(value) => update(buffModel.applyDerivedBuffPerPointValue(effect, value))} /></label>
                  </>
                )}
                {businessType === 'countable' ? (
                  <label><span>最大层数</span><DeferredNumberInput min={1} value={effect.maxStacks ?? 1} parse={parseIntegerInput} onCommit={(value) => update(buffModel.applyBuffMaxStacks(effect, value))} /></label>
                ) : null}
              </div>
            </section>
          ) : null}

          {businessType === 'multiplier' ? (
            <section>
              <h4>乘算</h4>
              <div className="buff-editor-drawer-grid">
                <label><span>{levelOptions.length ? '当前等级乘算系数' : '乘算系数'}</span><DeferredNumberInput min={0.000001} step="0.01" value={effect.multiplier?.coefficient ?? 1} onCommit={(value) => update(buffModel.setBuffMultiplierCoefficient(effect, value))} /></label>
              </div>
            </section>
          ) : null}

          {businessType === 'extraHit' ? (
            <section>
              <h4>额外伤害段</h4>
              <div className="buff-editor-drawer-grid">
                <label><span>伤害段 Key</span><input value={config.key} onChange={(event) => update({ ...effect, extraHitConfig: normalizeExtraHitConfig({ ...config, key: event.target.value }, config.key) })} /></label>
                <label><span>伤害属性</span><select value={config.damageType} onChange={(event) => update({ ...effect, extraHitConfig: normalizeExtraHitConfig({ ...config, damageType: event.target.value as typeof config.damageType }, config.key) })}>{EXTRA_HIT_DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                <label><span>技能类型</span><select value={config.skillType} onChange={(event) => update({ ...effect, extraHitConfig: normalizeExtraHitConfig({ ...config, skillType: event.target.value as typeof config.skillType }, config.key) })}><option value="">空</option>{['A', 'B', 'E', 'Q', 'Dot'].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                <label><span>{levelOptions.length ? '当前等级攻击力倍率' : '攻击力倍率'}</span><DeferredNumberInput min={0} step="0.01" value={config.baseMultiplier} onCommit={(value) => update({ ...effect, extraHitConfig: normalizeExtraHitConfig({ ...config, baseMultiplier: Math.max(0, value ?? 0) }, config.key) })} /></label>
              </div>
            </section>
          ) : null}

          <section>
            <h4>文本</h4>
            <div className="buff-editor-drawer-grid">
              <label className="is-wide"><span>描述</span><textarea value={effect.description ?? ''} onChange={(event) => update({ ...effect, description: event.target.value })} /></label>
              <label className="is-wide"><span>原文</span><textarea value={effect.raw ?? ''} onChange={(event) => update({ ...effect, raw: event.target.value })} /></label>
            </div>
          </section>
        </div>

        <footer><span>修改实时写入当前草稿</span><button type="button" onClick={onClose}>完成</button></footer>
      </aside>
    </div>
  );
}
