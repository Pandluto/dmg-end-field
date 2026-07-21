import { useState, type CSSProperties } from 'react';
import { getElementBackgroundColor, normalizeAssetUrl, resolveSkillIconUrl } from '../utils/assetResolver';
import type { PersistedSkillButton } from '../types/storage';
import {
  SKILL_BUTTON_HIT_HEIGHT,
  SKILL_BUTTON_HIT_WIDTH,
  SKILL_BUTTON_RADIUS,
  SKILL_BUTTON_SIZE,
  SKILL_BUTTON_VISUAL_OFFSET_X,
  SKILL_BUTTON_VISUAL_OFFSET_Y,
  buildButtonPosition,
  getButtonSkillType,
} from './buffBatchEditModel';

interface BuffEditSkillButtonProps {
  button: PersistedSkillButton;
  element: string;
  isSelected: boolean;
  isAddOwned: boolean;
  isAddTarget: boolean;
  isRemoveOwned: boolean;
  isRemoveTarget: boolean;
  isEditAddTarget: boolean;
  isEditRemoveTarget: boolean;
  pendingAddCount: number;
  pendingRemoveCount: number;
  onToggle: (buttonId: string) => void;
}

export function BuffEditSkillButton({
  button,
  element,
  isSelected,
  isAddOwned,
  isAddTarget,
  isRemoveOwned,
  isRemoveTarget,
  isEditAddTarget,
  isEditRemoveTarget,
  pendingAddCount,
  pendingRemoveCount,
  onToggle,
}: BuffEditSkillButtonProps) {
  const [iconLoadFailed, setIconLoadFailed] = useState(false);
  const position = buildButtonPosition(button);
  const skillType = getButtonSkillType(button);
  const displayName = button.skillDisplayName || skillType;
  const skillIconUrl = button.skillIconUrl || resolveSkillIconUrl(button.characterName, skillType);

  return (
    <div
      className={`canvas-skill-button buff-edit-skill-button${isSelected ? ' selected' : ''}${isAddOwned || isRemoveOwned ? ' is-add-owned' : ''}${isAddTarget ? ' is-add-target' : ''}${isRemoveTarget ? ' is-remove-target' : ''}${isEditAddTarget ? ' is-edit-add-target' : ''}${isEditRemoveTarget ? ' is-edit-remove-target' : ''}${isEditAddTarget && isEditRemoveTarget ? ' is-edit-mixed-target' : ''}`}
      style={{
        left: position.x - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_X,
        top: position.y - SKILL_BUTTON_RADIUS - SKILL_BUTTON_VISUAL_OFFSET_Y,
        width: SKILL_BUTTON_HIT_WIDTH,
        height: SKILL_BUTTON_HIT_HEIGHT,
        '--skill-button-size': `${SKILL_BUTTON_SIZE}px`,
        '--skill-button-radius': `${SKILL_BUTTON_RADIUS}px`,
        '--skill-button-element-color': getElementBackgroundColor(element),
      } as CSSProperties}
      onClick={() => onToggle(button.id)}
      title={`${button.characterName} / ${displayName} / Buff ${button.selectedBuff?.length ?? 0}`}
    >
      <div className="skill-button-anchor">
        <div className="skill-button-base">
          <span className="skill-button-name">{skillType} {displayName}</span>
        </div>
        <div className="skill-button-orb" title={`${button.characterName} - ${displayName}`}>
          {skillIconUrl && !iconLoadFailed ? (
            <img
              className="skill-icon"
              key={normalizeAssetUrl(skillIconUrl)}
              src={normalizeAssetUrl(skillIconUrl)}
              alt={displayName}
              onLoad={() => setIconLoadFailed(false)}
              onError={() => setIconLoadFailed(true)}
            />
          ) : null}
          <span className={`skill-label ${!iconLoadFailed && skillIconUrl ? 'hidden' : ''}`}>{skillType}</span>
        </div>
      </div>
      {pendingAddCount > 0 ? <div className="buff-edit-pending-add-count">+{pendingAddCount}</div> : null}
      {pendingRemoveCount > 0 ? <div className="buff-edit-pending-remove-count">-{pendingRemoveCount}</div> : null}
    </div>
  );
}
