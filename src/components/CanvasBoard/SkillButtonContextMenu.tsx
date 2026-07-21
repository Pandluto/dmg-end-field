import { createPortal } from 'react-dom';
import type { SkillButtonSkillChangePayload, SkillButtonSkillOption } from '../../types';

interface SkillButtonContextMenuProps {
  buttonId: string;
  isOpen: boolean;
  position?: { x: number; y: number };
  skillChangeOptions: SkillButtonSkillOption[];
  onChangeSkillType?: (payload: SkillButtonSkillChangePayload) => void;
  onClose?: () => void;
  onCopy?: () => void;
  onConfirmRemove?: () => void;
}

export function SkillButtonContextMenu({
  buttonId,
  isOpen,
  position,
  skillChangeOptions,
  onChangeSkillType,
  onClose,
  onCopy,
  onConfirmRemove,
}: SkillButtonContextMenuProps) {
  if (!isOpen || !position || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="skill-button-context-menu" style={{ left: position.x, top: position.y }}>
      <button
        className="context-menu-item"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onClose?.();
        }}
      >
        取消
      </button>
      <div className="context-menu-item-submenu">
        <div className="context-menu-item context-menu-submenu-trigger">
          <span>编辑</span>
          <span className="context-menu-submenu-arrow">▶</span>
        </div>
        <div className="context-menu-submenu">
          {skillChangeOptions.map((option, index) => (
            <button
              key={`${option.nextRuntimeSkillId ?? option.nextSkillType}-${index}`}
              className="context-menu-item"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onChangeSkillType?.({ buttonId, ...option });
                onClose?.();
              }}
            >
              {`改为${option.nextSkillType} / ${option.nextSkillDisplayName ?? option.nextSkillType}`}
            </button>
          ))}
        </div>
      </div>
      <button
        className="context-menu-item"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onCopy?.();
        }}
      >
        复制
      </button>
      <button
        className="context-menu-item context-menu-item-danger"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onConfirmRemove?.();
        }}
      >
        删除
      </button>
    </div>,
    document.body
  );
}
