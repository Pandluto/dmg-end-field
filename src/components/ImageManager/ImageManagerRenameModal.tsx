interface ImageManagerRenameModalProps {
  isOpen: boolean;
  currentName: string;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  onRenameValueChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  title?: string;
  hint?: string;
}

export function ImageManagerRenameModal(props: ImageManagerRenameModalProps) {
  const { isOpen, currentName, renameValue, renameInputRef, onRenameValueChange, onCommit, onCancel, onKeyDown, title = '重命名', hint = '输入基础名，不改变扩展名' } = props;

  if (!isOpen) return null;

  return (
    <div className="operator-draft-modal-overlay" onClick={onCancel}>
      <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="operator-draft-section-header">
          <div>
            <h3>{title}</h3>
            <p>{hint}</p>
          </div>
        </div>
        <div className="operator-draft-confirm-body">
          <p style={{ marginBottom: 8 }}>当前名称: <strong>{currentName}</strong></p>
          <input
            ref={renameInputRef}
            className="image-manager-rename-input"
            type="text"
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
        </div>
        <div className="operator-draft-modal-actions">
          <button className="operator-draft-ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="operator-draft-copy-button" type="button" onClick={onCommit}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
