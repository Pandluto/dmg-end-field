interface ImageManagerDeleteFolderModalProps {
  isOpen: boolean;
  dirLabel: string;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImageManagerDeleteFolderModal(props: ImageManagerDeleteFolderModalProps) {
  const { isOpen, dirLabel, error, onConfirm, onCancel } = props;

  if (!isOpen) return null;

  return (
    <div className="operator-draft-modal-overlay" onClick={onCancel}>
      <div className="operator-draft-modal operator-draft-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="operator-draft-section-header">
          <div>
            <h3>删除文件夹</h3>
            <p>此操作不可撤销。</p>
          </div>
        </div>
        <div className="operator-draft-confirm-body">
          <p>确定要删除 <strong>{dirLabel}</strong> 及其所有内容吗？</p>
          {error && (
            <p style={{ color: '#c62828', fontSize: 11, marginTop: 8 }}>{error}</p>
          )}
        </div>
        <div className="operator-draft-modal-actions">
          <button className="operator-draft-ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="operator-draft-copy-button operator-draft-danger-button"
            type="button"
            disabled={!!error}
            onClick={onConfirm}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}
