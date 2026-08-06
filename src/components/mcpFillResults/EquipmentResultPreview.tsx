import {
  formatEquipmentLibrarySummary,
  type EquipmentLibrary,
} from '../../legacyFillCore/domains/equipment';
import { normalizeAssetUrl } from '../../utils/assetResolver';
import { getOperatorBuffTypeLabel } from '../operatorDraftBuffModel';

type Props = { value: unknown };
type GearSet = EquipmentLibrary['gearSets'][string];
type Equipment = GearSet['equipments'][string];
type EquipmentEffect = NonNullable<Equipment['effects'][keyof Equipment['effects']]>;

function asEquipmentLibrary(value: unknown): EquipmentLibrary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const library = value as Partial<EquipmentLibrary>;
  if (!library.gearSets || typeof library.gearSets !== 'object') return null;
  return value as EquipmentLibrary;
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function formatLevelRange(effect: EquipmentEffect) {
  const entries = Object.entries(effect.levels || {})
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .sort(([a], [b]) => Number(a) - Number(b));
  if (!entries.length) return '未填写等级数值';
  const display = (value: number) => effect.unit === 'percent' ? `${formatNumber(value * 100)}%` : formatNumber(value);
  const [firstLevel, firstValue] = entries[0];
  const [lastLevel, lastValue] = entries[entries.length - 1];
  return firstLevel === lastLevel
    ? `Lv.${firstLevel} ${display(firstValue)}`
    : `Lv.${firstLevel} ${display(firstValue)} → Lv.${lastLevel} ${display(lastValue)}`;
}

function threePieceBuffs(gearSet: GearSet) {
  const values = Object.values(gearSet.threePieceBuffs || {});
  if (!values.length && gearSet.threePieceBuff) values.push(gearSet.threePieceBuff);
  return values;
}

export function EquipmentResultPreview({ value }: Props) {
  const library = asEquipmentLibrary(value);
  if (!library) return <div className="mcp-result-empty">这份装备结果暂时无法预览。</div>;

  const gearSets = Object.values(library.gearSets || {});
  const summaries = formatEquipmentLibrarySummary(library);
  const equipmentCount = summaries.reduce((sum, item) => sum + item.equipments, 0);
  const effectCount = summaries.reduce((sum, item) => sum + item.effects, 0);

  return (
    <article className="mcp-domain-result is-equipment">
      <header className="mcp-domain-result-hero is-without-image">
        <div className="mcp-domain-result-heading">
          <span className="mcp-domain-result-kicker">装备资料已整理</span>
          <h1>{gearSets.length === 1 ? gearSets[0].name : `${gearSets.length} 套装备`}</h1>
          <p>装备、固定属性和词条等级已经按装备编辑器的结构整理完成。</p>
          <div className="mcp-domain-result-tags">
            <span>{gearSets.length} 个套装</span>
            <span>{equipmentCount} 件装备</span>
            <span>{effectCount} 个词条</span>
          </div>
        </div>
      </header>

      <section className="mcp-domain-result-summary">
        <div><span>写入结果</span><strong>更新装备资料库</strong></div>
        <div><span>内容规模</span><strong>{equipmentCount} 件装备，共 {effectCount} 个词条</strong></div>
      </section>

      <section className="mcp-domain-result-section">
        <div className="mcp-domain-result-section-title"><h2>套装结果</h2><span>词条等级已压缩为首尾区间</span></div>
        <div className="mcp-result-card-list">
          {gearSets.map((gearSet) => {
            const equipments = Object.values(gearSet.equipments || {});
            const setBuffs = threePieceBuffs(gearSet);
            const imageUrl = gearSet.imgUrl ? normalizeAssetUrl(gearSet.imgUrl) : '';
            return (
              <article className="mcp-result-card is-gear-set" key={gearSet.gearSetId}>
                <div className="mcp-result-card-heading">
                  <div className="mcp-result-card-title-with-image">
                    {imageUrl ? <img src={imageUrl} alt="" /> : null}
                    <div><small>装备套装</small><h3>{gearSet.name}</h3></div>
                  </div>
                  <span>{equipments.length} 件</span>
                </div>

                {setBuffs.length ? (
                  <div className="mcp-result-set-buff">
                    <small>三件套效果</small>
                    {setBuffs.map((buff) => <strong key={buff.effectId}>{buff.name || getOperatorBuffTypeLabel(buff.typeKey)}</strong>)}
                  </div>
                ) : null}

                <div className="mcp-result-equipment-grid">
                  {equipments.map((equipment) => (
                    <div className="mcp-result-equipment" key={equipment.equipmentId}>
                      <header><strong>{equipment.name}</strong><span>{equipment.part}</span></header>
                      {equipment.fixedStat ? <p>固定：{equipment.fixedStat.label} +{formatNumber(equipment.fixedStat.value)}</p> : null}
                      {Object.values(equipment.effects || {}).map((effect) => effect ? (
                        <p key={effect.effectId}>{effect.label || getOperatorBuffTypeLabel(effect.typeKey)} · {formatLevelRange(effect)}</p>
                      ) : null)}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </article>
  );
}
