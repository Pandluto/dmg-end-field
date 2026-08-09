import { useMemo } from 'react';
import type { Character } from '../../types';
import { normalizeAssetUrl, resolveAvatarUrl } from '../../utils/assetResolver';
import './MobileSelectionPage.css';

const MAX_SELECTED_OPERATORS = 4;

const ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '灼热',
  ice: '寒冷',
  electric: '电磁',
  nature: '自然',
};

const ELEMENT_TONES: Record<string, string> = {
  physical: 'neutral',
  fire: 'fire',
  ice: 'ice',
  electric: 'electric',
  nature: 'nature',
};

export interface MobileSelectionPageProps {
  /** 由移动端数据加载器传入的当前线上官方干员目录。 */
  characters: Character[];
  /** 当前队伍顺序；组件不会改写数组或持久化状态。 */
  selectedOperatorIds: string[];
  /** 当前会话实际使用的数据版本，用于给用户明确的线上版本提示。 */
  dataVersion: string;
  /** 图片包版本，存在时会和数据版本一起展示。 */
  imageVersion?: string;
  /** 每次加入、移除或清空后立即通知父级。 */
  onSelectionChange: (selectedOperatorIds: string[]) => void;
  /** 可选的下一页入口；不传时页面仍可独立完成选人。 */
  onContinue?: () => void;
}

function getAvatarUrl(character: Character): string {
  return normalizeAssetUrl(character.avatarUrl) || resolveAvatarUrl(character.name);
}

function getCharacterLabel(character: Character): string {
  return `${character.name} · ${character.profession || '未分类'}`;
}

export function MobileSelectionPage({
  characters,
  selectedOperatorIds,
  dataVersion,
  imageVersion,
  onSelectionChange,
  onContinue,
}: MobileSelectionPageProps) {
  const officialCharacters = useMemo(
    () => characters.filter((character) => character.librarySource !== 'local'),
    [characters],
  );

  const selectedIds = useMemo(
    () => selectedOperatorIds.filter((id, index, ids) => ids.indexOf(id) === index).slice(0, MAX_SELECTED_OPERATORS),
    [selectedOperatorIds],
  );

  const characterMap = useMemo(
    () => new Map(officialCharacters.map((character) => [character.id, character])),
    [officialCharacters],
  );

  const selectedCharacters = useMemo(
    () => selectedIds
      .map((id) => characterMap.get(id))
      .filter((character): character is Character => Boolean(character)),
    [characterMap, selectedIds],
  );

  const updateSelection = (operatorId: string) => {
    if (selectedIds.includes(operatorId)) {
      onSelectionChange(selectedIds.filter((id) => id !== operatorId));
      return;
    }
    if (selectedIds.length >= MAX_SELECTED_OPERATORS) return;
    onSelectionChange([...selectedIds, operatorId]);
  };

  const clearSelection = () => {
    if (selectedIds.length > 0) onSelectionChange([]);
  };

  const versionText = dataVersion.trim() || '当前线上版本';

  return (
    <main className="mobile-selection-page">
      <div className="mobile-selection-portrait-warning" role="status">
        <span className="mobile-selection-portrait-warning-icon" aria-hidden="true">↻</span>
        <strong>请旋转回竖屏</strong>
        <span>手机版工作台为竖屏布局</span>
      </div>

      <div className="mobile-selection-page-content">
        <header className="mobile-selection-header">
          <div className="mobile-selection-eyebrow">ONLINE WORKBENCH</div>
          <div className="mobile-selection-heading-row">
            <div>
              <h1>选择干员</h1>
              <p>从线上官方目录组建本次计算队伍</p>
            </div>
            <div className="mobile-selection-version" aria-label={`数据版本 ${versionText}`}>
              <span className="mobile-selection-version-dot" aria-hidden="true" />
              <span>{versionText}</span>
            </div>
          </div>
          <div className="mobile-selection-version-meta">
            {imageVersion?.trim() ? `图片 ${imageVersion.trim()}` : '图片随线上版本更新'}
          </div>
        </header>

        <section className="mobile-selection-team-section" aria-labelledby="mobile-selection-team-title">
          <div className="mobile-selection-section-heading">
            <div>
              <span className="mobile-selection-section-kicker">TEAM</span>
              <h2 id="mobile-selection-team-title">已选队伍</h2>
            </div>
            <span className="mobile-selection-count">{selectedCharacters.length}/{MAX_SELECTED_OPERATORS}</span>
          </div>

          <div className="mobile-selection-selected-strip" aria-live="polite">
            {Array.from({ length: MAX_SELECTED_OPERATORS }, (_, index) => {
              const character = selectedCharacters[index];
              if (!character) {
                return (
                  <div className="mobile-selection-selected-slot is-empty" key={`empty-slot-${index}`}>
                    <span>{index + 1}</span>
                    <small>空位</small>
                  </div>
                );
              }

              return (
                <div className="mobile-selection-selected-slot is-filled" key={character.id}>
                  <img src={getAvatarUrl(character)} alt="" />
                  <span>{character.name}</span>
                  <button
                    type="button"
                    className="mobile-selection-selected-remove"
                    onClick={() => updateSelection(character.id)}
                    aria-label={`移除 ${character.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mobile-selection-team-actions">
            <span>{selectedCharacters.length === 0 ? '先选择 1 名干员开始配置' : '队伍顺序会同步到配置与排轴'}</span>
            <button type="button" onClick={clearSelection} disabled={selectedIds.length === 0}>
              清空
            </button>
          </div>
        </section>

        <section className="mobile-selection-roster-section" aria-labelledby="mobile-selection-roster-title">
          <div className="mobile-selection-section-heading mobile-selection-roster-heading">
            <div>
              <span className="mobile-selection-section-kicker">ROSTER</span>
              <h2 id="mobile-selection-roster-title">官方干员</h2>
            </div>
            <span className="mobile-selection-result-count">{officialCharacters.length} 位</span>
          </div>

          {officialCharacters.length === 0 ? (
            <div className="mobile-selection-empty-state">
              <span className="mobile-selection-empty-mark" aria-hidden="true">◎</span>
              <strong>线上干员目录暂未载入</strong>
              <p>请确认当前网络可访问最新版数据后重新进入手机版。</p>
            </div>
          ) : (
            <div className="mobile-selection-roster-list">
              {officialCharacters.map((character) => {
                const isSelected = selectedIds.includes(character.id);
                const isDisabled = !isSelected && selectedIds.length >= MAX_SELECTED_OPERATORS;
                const tone = ELEMENT_TONES[character.element] || 'neutral';
                return (
                  <button
                    type="button"
                    key={character.id}
                    className={`mobile-selection-roster-card is-${tone}${isSelected ? ' is-selected' : ''}`}
                    onClick={() => updateSelection(character.id)}
                    disabled={isDisabled}
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? '移除' : '添加'} ${getCharacterLabel(character)}`}
                  >
                    <span className="mobile-selection-avatar-wrap">
                      <img src={getAvatarUrl(character)} alt="" loading="lazy" />
                      <span className="mobile-selection-rarity" aria-label={`${character.rarity}星`}>
                        {'★'.repeat(Math.max(0, Math.min(6, character.rarity)))}
                      </span>
                    </span>
                    <span className="mobile-selection-roster-copy">
                      <strong>{character.name}</strong>
                      <span>
                        <b>{ELEMENT_LABELS[character.element] || character.element}</b>
                        <i>{character.profession || '—'}</i>
                      </span>
                    </span>
                    {isSelected ? <span className="mobile-selection-selection-stamp" aria-hidden="true">✓</span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {onContinue && (
          <button
            type="button"
            className="mobile-selection-continue"
            onClick={onContinue}
            disabled={selectedCharacters.length === 0}
          >
            <span>进入干员配置</span>
            <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </main>
  );
}
