import React from 'react';
import { Character, CanvasConfig } from '../../../types';
import { calculateLineY, getGroupOffset } from '../../../utils/layout';
import { getElementBackgroundColor } from '../../../utils/assetResolver';

interface CanvasStaffVisualBackupProps {
  config: CanvasConfig;
  staffCount: number;
  selectedCharacters: Character[];
}

// Backup only. Do not import into production render.
export function CanvasStaffVisualBackup({
  config,
  staffCount,
  selectedCharacters,
}: CanvasStaffVisualBackupProps) {
  const renderStaffGroup = (staffIndex: number) => {
    const groupOffset = getGroupOffset(config, staffIndex);
    const lines: React.ReactNode[] = [];

    for (let lineIndex = 0; lineIndex < config.lineCount; lineIndex++) {
      const character = selectedCharacters[lineIndex];
      const y = calculateLineY(config, lineIndex);

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
              alt={`${character?.name} avatar`}
              style={{ backgroundColor: getElementBackgroundColor(character?.element ?? '') }}
              onError={(event) => {
                (event.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="sandbox-character-name" style={{ marginTop: 20 }}>
            {character?.name || `operator ${lineIndex + 1}`}
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

  const renderLines = () => {
    const groups: React.ReactNode[] = [];
    for (let staffIndex = 0; staffIndex < staffCount; staffIndex++) {
      groups.push(renderStaffGroup(staffIndex));
    }
    return groups;
  };

  return <>{renderLines()}</>;
}
