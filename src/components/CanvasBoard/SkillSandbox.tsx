/**
 * 技能沙盒（SkillSandbox）
 *
 * 位于画布界面右侧，显示当前已选干员及其四个技能按钮（A/B/E/Q）
 * 用户从沙盒拖拽技能按钮到画布谱线上，完成"排轴"
 *
 * 渲染逻辑：
 * - 遍历 selectedCharacters，为每个干员渲染一个 sandbox-character 卡片
 * - 头像 img 优先显示，加载失败时隐藏（不显示断裂图）
 * - 技能按钮优先显示 skillIconMap 对应的图标，缺失时退回文字标签
 * - 按钮底色由干员 element 属性决定（通过 getElementBackgroundColor 取半透明底色）
 */

import React, { useEffect, useRef, useState } from 'react';
import { Character, SandboxSkill, SkillType, SKILL_LABELS } from '../../types';
import { getElementBackgroundColor, normalizeAssetUrl } from '../../utils/assetResolver';
import './SkillSandbox.css';

interface SkillSandboxProps {
  /** 当前已选的干员列表（来自 AppState.selectedCharacters） */
  selectedCharacters: Character[];
  /** 拖拽开始回调，传递给 useCanvasDrag.handleSandboxDragStart */
  onDragStart: (
    characterId: string,
    characterName: string,
    sandboxSkill: SandboxSkill,
    lineIndex: number,
    e: React.MouseEvent
  ) => void;
  /** 头像双击回调：用于打开干员配置界面 */
  onAvatarDoubleClick: (characterId: string) => void;
  /** 保存排轴快照回调 */
  onSave?: () => void;
  /** 打开全局敌方抗性设置 */
  onOpenResistance?: () => void;
  /** 刷新当前干员/武器/装备可用候选内容 */
  onRefreshAvailableCandidates?: () => void;
  /** 可用候选内容刷新中 */
  isRefreshingAvailableCandidates?: boolean;
  /** 浏览模式是否开启 */
  isBrowseMode?: boolean;
  /** 切换浏览模式回调 */
  onToggleBrowseMode?: () => void;
  /** 透视模式是否按住 */
  isInspectMode?: boolean;
  /** 开始透视模式 */
  onInspectStart?: () => void;
  /** 结束透视模式 */
  onInspectEnd?: () => void;
  /** AI 模式是否开启 */
  isAiMode?: boolean;
  /** 切换 AI 模式 */
  onToggleAiMode?: () => void;
}

/** 技能显示标签（用于按钮右侧标注） */
const SKILL_DISPLAY_LABELS: Record<SkillType, string> = {
  A: '重击',
  B: '战技',
  E: '连携',
  Q: '终结',
  Dot: '持续',
};

function getCharacterSandboxSkills(character: Character): SandboxSkill[] {
  if (Array.isArray(character.sandboxSkills) && character.sandboxSkills.length > 0) {
    return character.sandboxSkills;
  }

  return (['A', 'B', 'E', 'Q'] as const).map((skillType) => ({
    id: `fallback-${skillType}`,
    displayName: SKILL_LABELS[skillType],
    buttonType: skillType,
    iconUrl: character.skillIconMap?.[skillType],
    hitCount: 1,
    source: character.librarySource ?? 'official',
  }));
}

export function SkillSandbox({
  selectedCharacters,
  onDragStart,
  onAvatarDoubleClick,
  onSave,
  onOpenResistance,
  onRefreshAvailableCandidates,
  isRefreshingAvailableCandidates = false,
  isBrowseMode = false,
  onToggleBrowseMode,
  isInspectMode = false,
  onInspectStart,
  onInspectEnd,
  isAiMode = false,
  onToggleAiMode,
}: SkillSandboxProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pageByCharacterId, setPageByCharacterId] = useState<Record<string, number>>({});
  const [expandedByCharacterId, setExpandedByCharacterId] = useState<Record<string, boolean>>({});

  // 使用卡片长边实时计算角标长度，满足“角标长度=长边0.34倍”的视觉约束
  useEffect(() => {
    const visibleCards = selectedCharacters
      .map((character) => cardRefs.current[character.id])
      .filter((card): card is HTMLDivElement => Boolean(card));

    if (visibleCards.length === 0) {
      return;
    }

    const cornerRatio = 0.34;

    // 将几何计算结果回写为 CSS 变量，样式层只消费变量，避免硬编码扩散
    const updateCardMetrics = (card: HTMLDivElement) => {
      const { width, height } = card.getBoundingClientRect();
      const longEdge = Math.max(width, height);
      card.style.setProperty('--sandbox-card-long-edge', `${longEdge}px`);
      card.style.setProperty('--corner-len', `${longEdge * cornerRatio}px`);
    };

    visibleCards.forEach((card) => updateCardMetrics(card));

    // 降级策略：当运行环境不支持 ResizeObserver 时，保留 CSS 断点默认值
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    // 通过观察尺寸变化保持角标比例稳定，同时避免改动业务拖拽与排轴逻辑
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        updateCardMetrics(entry.target as HTMLDivElement);
      });
    });

    visibleCards.forEach((card) => observer.observe(card));

    return () => {
      observer.disconnect();
    };
  }, [selectedCharacters]);

  if (selectedCharacters.length === 0) {
    return (
      <div className="skill-sandbox">
        <div className="sandbox-empty">请先选择干员</div>
      </div>
    );
  }

  return (
    <div className={`skill-sandbox${isBrowseMode ? ' is-browse-mode' : ''}`}>
      {/* 遍历每个已选干员，渲染一个角色卡片 */}
      <div className="sandbox-characters">
        <div className="sandbox-characters-extra-spacer">
          <button
            type="button"
            className="sandbox-reserved-action"
            onClick={onSave}
            aria-label="保存"
            title="保存"
          >
            <svg className="sandbox-reserved-action-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 3h12l2 2v16H5V3zm2 2v6h9V5H7zm0 14h10v-6H7v6zm2-12h5V5H9v2z" />
            </svg>
          </button>
          <button
            type="button"
            className="sandbox-reserved-action"
            onClick={onOpenResistance}
            aria-label="批量设置敌方抗性"
            title="批量设置敌方抗性"
          >
            <svg className="sandbox-reserved-action-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2 4 5v6c0 5.1 3.4 9.7 8 11 4.6-1.3 8-5.9 8-11V5l-8-3zm0 2.2L18 6.4V11c0 3.9-2.4 7.6-6 8.8-3.6-1.2-6-4.9-6-8.8V6.4l6-2.2zm-1 3.3h2v5h-2v-5zm0 6.5h2v2h-2v-2z" />
            </svg>
          </button>
          <button
            type="button"
            className={`sandbox-reserved-action sandbox-reserved-action--refresh${isRefreshingAvailableCandidates ? ' is-loading' : ''}`}
            onClick={onRefreshAvailableCandidates}
            disabled={isRefreshingAvailableCandidates}
            aria-label="刷新可用候选内容"
            title="刷新干员、武器、装备可用候选内容"
          >
            <svg className="sandbox-reserved-action-icon sandbox-reserved-action-icon--refresh" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6v5h-5l1.9-1.9A6.1 6.1 0 0 0 6 12H4A8.1 8.1 0 0 1 18.3 7.7L20 6zm-2 6a6.1 6.1 0 0 1-10.9 3.8L9 14H4v5l1.7-1.7A8.1 8.1 0 0 0 20 12h-2z" />
            </svg>
          </button>
          <button
            type="button"
            className={`sandbox-reserved-action sandbox-reserved-action--inspect${isInspectMode ? ' is-active' : ''}`}
            aria-label="查看"
            title="查看"
            aria-pressed={isInspectMode}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              onInspectStart?.();
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              onInspectEnd?.();
            }}
            onPointerCancel={onInspectEnd}
            onPointerLeave={(event) => {
              if (event.buttons === 0) {
                onInspectEnd?.();
              }
            }}
          >
            <svg className="sandbox-reserved-action-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5c5.2 0 8.8 4.2 10 7-1.2 2.8-4.8 7-10 7S3.2 14.8 2 12c1.2-2.8 4.8-7 10-7zm0 2c-3.6 0-6.4 2.5-7.7 5 1.3 2.5 4.1 5 7.7 5s6.4-2.5 7.7-5C18.4 9.5 15.6 7 12 7zm0 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z" />
            </svg>
          </button>
          <button
            type="button"
            className={`sandbox-reserved-action sandbox-reserved-action--browse${isBrowseMode ? ' is-active' : ''}`}
            aria-label="浏览模式"
            title="浏览模式"
            aria-pressed={isBrowseMode}
            onClick={onToggleBrowseMode}
          >
            <svg className="sandbox-reserved-action-icon sandbox-reserved-action-icon--book" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5.5h1.2c2.7 0 4.9.7 6.8 2.1v12c-1.9-1.3-4.1-1.9-6.8-1.9H4V5.5z" />
              <path d="M20 5.5h-1.2c-2.7 0-4.9.7-6.8 2.1v12c1.9-1.3 4.1-1.9 6.8-1.9H20V5.5z" />
              <path d="M12 7.6v12" />
              <path d="M6.4 8.5c1.4.1 2.5.4 3.4 1" />
              <path d="M17.6 8.5c-1.4.1-2.5.4-3.4 1" />
            </svg>
          </button>
          <button
            type="button"
            className={`sandbox-reserved-action sandbox-reserved-action--ai${isAiMode ? ' is-active' : ''}`}
            aria-label="AI 模式"
            title="AI 模式"
            aria-pressed={isAiMode}
            onClick={onToggleAiMode}
          >
            <span className="sandbox-reserved-action-text">AI</span>
          </button>
        </div>
        {selectedCharacters.map((character, index) => {
          const sandboxSkills = getCharacterSandboxSkills(character);
          const isLocalCharacter = character.librarySource === 'local';
          const pageSize = 8;
          const isExpanded = Boolean(expandedByCharacterId[character.id]);
          const totalPages = Math.max(1, Math.ceil(sandboxSkills.length / pageSize));
          const currentPage = Math.min(pageByCharacterId[character.id] ?? 0, totalPages - 1);
          const visibleSkills = sandboxSkills.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
          const updateCharacterPage = (nextPage: number) => {
            setPageByCharacterId((prev) => ({
              ...prev,
              [character.id]: nextPage,
            }));
          };
          const toggleCharacterExpanded = () => {
            setExpandedByCharacterId((prev) => (
              prev[character.id] ? {} : { [character.id]: true }
            ));
          };

          return (
          <div
            key={character.id}
            className={`sandbox-character sandbox-character--hoverable ${isExpanded ? 'sandbox-character--expanded' : 'sandbox-character--collapsed'} ${isLocalCharacter ? 'sandbox-character--local' : 'sandbox-character--official'}`}
            ref={(node) => {
              cardRefs.current[character.id] = node;
            }}
          >
            {/* 角色头部：名称 + 头像 */}
            <button
              type="button"
              className="sandbox-character-header"
              onClick={toggleCharacterExpanded}
              aria-expanded={isExpanded}
            >
              {/* 头像 img：资源缺失时由 onError 隐藏，不显示断裂图 */}
              {character.avatarUrl && (
                <img
                  className="sandbox-avatar"
                  src={normalizeAssetUrl(character.avatarUrl)}
                  alt={`${character.name} 头像`}
                  style={{ backgroundColor: getElementBackgroundColor(character.element) }}
                  onDoubleClick={() => {
                    onAvatarDoubleClick(character.id);
                  }}
                  draggable={false}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <span className="sandbox-character-name">{character.name}</span>
              <span className="sandbox-character-count">{sandboxSkills.length} 技能</span>
              <span className="sandbox-expand-indicator" aria-hidden="true">{isExpanded ? '−' : '+'}</span>
            </button>

            {isExpanded ? (
              <div className="sandbox-character-body">
                {totalPages > 1 ? (
                <div className="sandbox-skill-pager">
                  <button
                    type="button"
                    className="sandbox-pager-button"
                    onClick={() => updateCharacterPage(Math.max(0, currentPage - 1))}
                    disabled={currentPage === 0}
                    aria-label="上一页技能"
                  >
                    ‹
                  </button>
                  <span className="sandbox-pager-indicator">{currentPage + 1}/{totalPages}</span>
                  <button
                    type="button"
                    className="sandbox-pager-button"
                    onClick={() => updateCharacterPage(Math.min(totalPages - 1, currentPage + 1))}
                    disabled={currentPage >= totalPages - 1}
                    aria-label="下一页技能"
                  >
                    ›
                  </button>
                </div>
              ) : null}

            <div className="sandbox-skills">
              {visibleSkills.map((sandboxSkill) => (
                <div
                  key={sandboxSkill.id}
                  className={`sandbox-skill-item ${isLocalCharacter ? 'sandbox-skill-item--local' : ''}`}
                >
                  <div
                    className={`sandbox-skill-button skill-${sandboxSkill.buttonType.toLowerCase()}`}
                    style={{ backgroundColor: getElementBackgroundColor(character.element) }}
                    onMouseDown={(e) => {
                      if (isBrowseMode) {
                        e.preventDefault();
                        return;
                      }
                      onDragStart(character.id, character.name, sandboxSkill, index, e);
                    }}
                    title={`${character.name} - ${sandboxSkill.displayName}`}
                  >
                    {/* 技能图标：优先渲染 skillIconMap 中的路径，缺失时退回文字 */}
                    {sandboxSkill.iconUrl ? (
                      <img
                        className="skill-icon"
                        src={normalizeAssetUrl(sandboxSkill.iconUrl)}
                        alt={sandboxSkill.displayName}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                    {/* 兜底文字：图标加载成功时由父容器隐藏，失败时正常显示 */}
                    <span className="skill-label">{sandboxSkill.buttonType}</span>
                  </div>
                  <div className="sandbox-skill-meta">
                    <span className="sandbox-skill-tag">{SKILL_DISPLAY_LABELS[sandboxSkill.buttonType]}</span>
                    <span className="sandbox-skill-name">{sandboxSkill.displayName}</span>
                    <span className="sandbox-skill-hit-count">{sandboxSkill.hitCount} hit</span>
                  </div>
                </div>
              ))}
            </div>
              </div>
            ) : null}
          </div>
          );
        })}
      </div>
    </div>
  );
}
