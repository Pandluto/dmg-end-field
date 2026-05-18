interface ImageManagerCreateFolderModalProps {
  isOpen: boolean;
  parentLabel: string;
  folderName: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onFolderNameChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function ImageManagerCreateFolderModal(props: ImageManagerCreateFolderModalProps) {
  const { isOpen, parentLabel, folderName, inputRef, onFolderNameChange, onCommit, onCancel, onKeyDown } = props;

  if (!isOpen) return null;

  return (
    <div className="operator-draft-modal-overlay" onClick={onCancel}>
      <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="operator-draft-section-header">
          <div>
            <h3>新建文件夹</h3>
            <p>在 {parentLabel} 下创建子文件夹</p>
          </div>
        </div>
        <div className="operator-draft-confirm-body">
          <input
            ref={inputRef}
            className="image-manager-rename-input"
            type="text"
            placeholder="输入文件夹名…"
            value={folderName}
            onChange={(e) => onFolderNameChange(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
        </div>
        <div className="operator-draft-modal-actions">
          <button className="operator-draft-ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="operator-draft-copy-button" type="button" onClick={onCommit}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
