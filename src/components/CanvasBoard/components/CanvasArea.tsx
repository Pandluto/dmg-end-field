/**
 * 画布区域（CanvasArea）
 *
 * 负责渲染谱线、节点和已放置的技能按钮。
 * 包含 Toolbar（工具栏）和实际的画布 div（canvas-container > canvas）。
 *
 * 布局结构：
 * - Toolbar：顶部工具栏（返回/增删 staff 组）
 * - canvas-container：画布容器（可滚动）
 * - canvas：实际画布（绝对定位，内部渲染 staff 组、谱线、节点、技能按钮）
 *
 * 渲染层次（从底到顶）：
 * 1. staff 组（多个，按 groupOffset 纵向排列）
 * 2. 谱线 + 节点（每个 staff 组内循环渲染）
 * 3. 技能按钮（SkillButtonComponent，绝对定位）
 */

import React, { useRef, forwardRef } from 'react';
import { Character, SkillButton, CanvasConfig } from '../../../types';
import { calculateLineY, getGroupOffset } from '../../../utils/layout';
import { getElementBackgroundColor } from '../../../utils/assetResolver';
import { SkillButtonComponent } from '../SkillButton';
import { Toolbar } from './Toolbar';
import type { TimelineData } from '../../../types';

interface CanvasAreaProps {
  config: CanvasConfig;
  staffCount: number;
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  canvasWidth: number;
  canvasHeight: number;
  onBack: () => void;
  onAddGroup: () => void;
  onRemoveGroup: () => void;
  onSave?: () => void;
  onButtonMouseDown: (e: React.MouseEvent, buttonId: string) => void;
  onButtonContextMenu: (e: React.MouseEvent, buttonId: string) => void;
  onCanvasClick: () => void;
  timelineData?: TimelineData;
}

export const CanvasArea = forwardRef<HTMLDivElement, CanvasAreaProps>(({
  config,
  staffCount,
  selectedCharacters,
  skillButtons,
  canvasWidth,
  canvasHeight,
  onBack,
  onAddGroup,
  onRemoveGroup,
  onSave,
  onButtonMouseDown,
  onButtonContextMenu,
  onCanvasClick,
  timelineData,
}, canvasRef) => {
  const containerRef = useRef<HTMLDivElement>(null);

  /** 渲染单个 staff 组（包含所有谱线和节点） */
  const renderStaffGroup = (staffIndex: number) => {
    const groupOffset = getGroupOffset(config, staffIndex);
    const lines: React.ReactNode[] = [];

    for (let lineIndex = 0; lineIndex < config.lineCount; lineIndex++) {
      const character = selectedCharacters[lineIndex];
      // 谱线在 staff 组内的基准 Y（不含 groupOffset，由父容器 staff-group 绝对定位）
      const y = calculateLineY(config, lineIndex);

      // 谱线（水平粗线）
      lines.push(
        <div
          key={`line-${staffIndex}-${lineIndex}`}
          className="staff-line"
          style={{
            top: y,
            height: config.staffHeight,
          }}
        />
      );

      // 谱线标签（干员名称 + 头像）
      lines.push(
        <div
          key={`label-${staffIndex}-${lineIndex}`}
          className="staff-label-container"
          style={{
            top: y + config.staffHeight / 2 - 18,
            left: 10,
          }}
        >
          {character?.avatarUrl && (
            <img
              className="sandbox-avatar"
              src={character.avatarUrl}
              alt={`${character?.name} 头像`}
              style={{ backgroundColor: getElementBackgroundColor(character?.element ?? '') }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="sandbox-character-name"
            style={{
              marginTop: 20
            }}
          >            
            {character?.name || `干员${lineIndex + 1}`}
          </span>
        </div>
      );


      for (let nodeIndex = 0; nodeIndex < config.nodeCount; nodeIndex++) {
        const nodeX = config.marginLeft + nodeIndex * config.nodeSpacing;
        lines.push(
          <div
            key={`node-${staffIndex}-${lineIndex}-${nodeIndex}`}
            className="damage-node"
            style={{
              left: nodeX - 1,
              top: y + config.staffHeight / 2 - 3,
            }}
          />
        );
      }
    }

    // staff 组容器（绝对定位，top 由 groupOffset 决定）
    return (
      <div
        key={`staff-group-${staffIndex}`}
        className="staff-group"
        style={{
          position: 'absolute',
          top: groupOffset,
          left: 0,
          right: 0,
          height: config.staffGroupHeight,
        }}
      >
        {lines}
      </div>
    );
  };

  /** 渲染所有 staff 组 */
  const renderLines = () => {
    const groups: React.ReactNode[] = [];
    for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
      groups.push(renderStaffGroup(staffIndex));
    }
    return groups;
  };

  /** 渲染所有已放置的技能按钮（仅 isFromSandbox=true 的按钮） */
  const renderSkillButtons = () => {
    return skillButtons
      .filter((btn) => btn.isFromSandbox)
      .map((button) => (
        <SkillButtonComponent
          key={button.id}
          button={button}
          size={config.skillButtonSize}
          onMouseDown={(e) => onButtonMouseDown(e, button.id)}
          onContextMenu={(e) => onButtonContextMenu(e, button.id)}
          timelineData={timelineData}
        />
      ));
  };

  return (
    <div className="canvas-area">
      <Toolbar
        staffCount={staffCount}
        onBack={onBack}
        onAddGroup={onAddGroup}
        onRemoveGroup={onRemoveGroup}
        onSave={onSave}
      />
      <div ref={containerRef} className="canvas-container">
        <div
          ref={canvasRef}
          className="canvas"
          style={{
            width: canvasWidth,
            height: canvasHeight,
          }}
          onClick={onCanvasClick}
        >
          {renderLines()}
          {renderSkillButtons()}
        </div>
      </div>
    </div>
  );
});
