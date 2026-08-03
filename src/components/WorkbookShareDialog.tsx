import type { ReactNode } from 'react';

export type WorkbookShareMode = 'export' | 'import';

interface WorkbookShareScope {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

interface WorkbookShareExportPanel {
  preview: string;
  hint?: ReactNode;
  scope?: WorkbookShareScope;
  onCopy: () => void;
  onDownload: () => void;
}

interface WorkbookShareImportPreview {
  details: readonly string[];
  onClear: () => void;
  onConfirm: () => void;
}

interface WorkbookShareImportPanel {
  text: string;
  error: string;
  placeholder: string;
  preview?: WorkbookShareImportPreview;
  onTextChange: (value: string) => void;
  onPickFile: () => void;
  onParse: () => void;
}

interface WorkbookShareDialogProps {
  open: boolean;
  mode: WorkbookShareMode;
  exportPanel: WorkbookShareExportPanel;
  importPanel: WorkbookShareImportPanel;
  onModeChange: (mode: WorkbookShareMode) => void;
  onClose: () => void;
}

export function WorkbookShareDialog({
  open,
  mode,
  exportPanel,
  importPanel,
  onModeChange,
  onClose,
}: WorkbookShareDialogProps) {
  if (!open) return null;

  return (
    <div className="buff-sheet-share-modal-mask" onClick={onClose}>
      <div className="buff-sheet-share-modal" onClick={(event) => event.stopPropagation()}>
        <div className="buff-sheet-share-modal-header">
          <div className="buff-sheet-share-modal-tabs">
            <button
              type="button"
              className={`buff-sheet-share-modal-tab${mode === 'export' ? ' is-active' : ''}`}
              onClick={() => onModeChange('export')}
            >
              导出
            </button>
            <button
              type="button"
              className={`buff-sheet-share-modal-tab${mode === 'import' ? ' is-active' : ''}`}
              onClick={() => onModeChange('import')}
            >
              导入
            </button>
          </div>
          <button type="button" className="buff-sheet-share-modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {mode === 'export' ? (
          <div className="buff-sheet-share-modal-body">
            <div className="buff-sheet-share-modal-copybar">
              {exportPanel.scope ? (
                <div className="buff-sheet-share-modal-tabs">
                  {exportPanel.scope.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`buff-sheet-share-modal-tab${exportPanel.scope?.value === option.value ? ' is-active' : ''}`}
                      onClick={() => exportPanel.scope?.onChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="buff-sheet-share-modal-copyhint">{exportPanel.hint}</div>
              )}
              <div className="buff-sheet-share-modal-actions">
                <button type="button" className="buff-sheet-share-action" onClick={exportPanel.onCopy}>
                  复制 JSON
                </button>
                <button type="button" className="buff-sheet-share-action is-primary" onClick={exportPanel.onDownload}>
                  导出文件
                </button>
              </div>
            </div>
            <textarea
              className="buff-sheet-share-textarea is-preview"
              value={exportPanel.preview}
              readOnly
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="buff-sheet-share-modal-body">
            <div className="buff-sheet-share-modal-copybar">
              <div className="buff-sheet-share-modal-copyhint">支持直接粘贴 JSON，或选择本地分享文件</div>
              <div className="buff-sheet-share-modal-actions">
                <button type="button" className="buff-sheet-share-action" onClick={importPanel.onPickFile}>
                  导入文件
                </button>
                <button type="button" className="buff-sheet-share-action is-primary" onClick={importPanel.onParse}>
                  读取粘贴内容
                </button>
              </div>
            </div>
            <textarea
              className="buff-sheet-share-textarea"
              value={importPanel.text}
              onChange={(event) => importPanel.onTextChange(event.target.value)}
              placeholder={importPanel.placeholder}
              spellCheck={false}
            />
            {importPanel.error ? <div className="buff-sheet-share-feedback is-error">{importPanel.error}</div> : null}
            {importPanel.preview ? (
              <div className="buff-sheet-share-import-preview">
                <div className="buff-sheet-share-import-title">导入预览</div>
                <div className="buff-sheet-share-import-meta">
                  {importPanel.preview.details.map((detail) => <span key={detail}>{detail}</span>)}
                </div>
                <div className="buff-sheet-share-modal-actions">
                  <button type="button" className="buff-sheet-share-action" onClick={importPanel.preview.onClear}>
                    清空预览
                  </button>
                  <button type="button" className="buff-sheet-share-action is-primary" onClick={importPanel.preview.onConfirm}>
                    确认导入
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
