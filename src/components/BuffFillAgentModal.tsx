import { useState, type ReactNode } from 'react';

export interface BuffFillAgentModalProps {
  isOpen: boolean;
  hasSharedAiApiKey: boolean;
  sharedAiModel: string;
  promptPreviewMode: 'system' | 'mapping' | 'final';
  onPromptPreviewModeChange: (mode: 'system' | 'mapping' | 'final') => void;
  systemPrompt: string;
  mappingPrompt: string;
  finalPrompt: string;
  onSystemPromptChange: (value: string) => void;
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  previewMode: 'json' | 'text';
  onPreviewModeChange: (mode: 'json' | 'text') => void;
  rawResponseJson: string;
  status: string;
  elapsedSeconds: number;
  remainingSeconds: number;
  validationErrors: string[];
  renderPreview: ReactNode;
  workflowLogs: string;
  isSubmitting: boolean;
  canApply: boolean;
  onSubmit: () => void;
  onApply: () => void;
  onClose: () => void;
}

export function BuffFillAgentModal(props: BuffFillAgentModalProps) {
  const [isPromptPreviewOpen, setIsPromptPreviewOpen] = useState(false);
  const {
    isOpen,
    hasSharedAiApiKey,
    sharedAiModel,
    promptPreviewMode,
    onPromptPreviewModeChange,
    systemPrompt,
    mappingPrompt,
    finalPrompt,
    onSystemPromptChange,
    sourceText,
    onSourceTextChange,
    previewMode,
    onPreviewModeChange,
    rawResponseJson,
    status,
    elapsedSeconds,
    remainingSeconds,
    validationErrors,
    renderPreview,
    workflowLogs,
    isSubmitting,
    canApply,
    onSubmit,
    onApply,
    onClose,
  } = props;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="buff-sheet-ai-modal-mask" onClick={onClose}>
      <div className="buff-sheet-ai-modal" onClick={(event) => event.stopPropagation()}>
        <div className="buff-sheet-ai-modal-header">
          <div>
            <strong>AI填表</strong>
            <span>面向组级别 Buff 的 workflow 预览开发</span>
          </div>
          <div className="buff-sheet-ai-header-actions">
            <button type="button" className="buff-sheet-share-action" onClick={() => setIsPromptPreviewOpen(true)}>
              提示词
            </button>
            <button type="button" className="buff-sheet-share-modal-close" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
        </div>
        <div className="buff-sheet-ai-modal-body">
          <section className="buff-sheet-ai-panel">
            <div className="buff-sheet-ai-panel-head">
              <div className="buff-sheet-ai-panel-title">Workflow</div>
            </div>
            <div className="buff-sheet-ai-shared-banner is-workflow">
              <strong>{isSubmitting ? '执行中' : workflowLogs.trim() ? '执行日志' : '等待执行'}</strong>
              <span>{hasSharedAiApiKey ? `当前模型：${sharedAiModel}` : '当前未配置 API Key，请先到 shell 中设置。'}</span>
            </div>
            <pre className="buff-sheet-ai-console-log">{workflowLogs.trim() || '[workflow] 等待执行。'}</pre>
          </section>
          <section className="buff-sheet-ai-panel">
            <div className="buff-sheet-ai-panel-title">复制内容</div>
            <textarea
              className="buff-sheet-ai-textarea"
              value={sourceText}
              onChange={(event) => onSourceTextChange(event.target.value)}
              placeholder="把技能描述、攻略文本或整理需求粘贴到这里。"
              spellCheck={false}
            />
          </section>
          <section className="buff-sheet-ai-panel is-preview">
            <div className="buff-sheet-ai-panel-head">
              <div className="buff-sheet-ai-panel-title">结果预览</div>
              <div className="buff-sheet-ai-preview-switch">
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${previewMode === 'json' ? ' is-active' : ''}`}
                  onClick={() => onPreviewModeChange('json')}
                >
                  JSON
                </button>
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${previewMode === 'text' ? ' is-active' : ''}`}
                  onClick={() => onPreviewModeChange('text')}
                >
                  纯文本
                </button>
              </div>
            </div>
            <div className="buff-sheet-ai-status">
              <div>{status}</div>
              <div>{`读秒：已用 ${elapsedSeconds}s / 剩余 ${remainingSeconds}s`}</div>
            </div>
            {validationErrors.length > 0 ? (
              <div className="buff-sheet-ai-error-list">
                {validationErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}
            {previewMode === 'json' ? (
              <pre className="buff-sheet-ai-json-preview">{rawResponseJson.trim() || '{}'}</pre>
            ) : (
              <div className="buff-sheet-ai-text-preview">{renderPreview}</div>
            )}
          </section>
        </div>
        <div className="buff-sheet-ai-modal-footer">
          <button type="button" className="buff-sheet-share-action is-primary" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? '生成中…' : '生成预览'}
          </button>
          <button type="button" className="buff-sheet-share-action" onClick={onApply} disabled={!canApply || isSubmitting}>
            落实到当前组
          </button>
          <button type="button" className="buff-sheet-share-action" onClick={onClose}>
            关闭
          </button>
        </div>
        {isPromptPreviewOpen ? (
          <div className="buff-sheet-ai-submodal-mask" onClick={() => setIsPromptPreviewOpen(false)}>
            <div className="buff-sheet-ai-submodal" onClick={(event) => event.stopPropagation()}>
              <div className="buff-sheet-ai-panel-head">
                <div className="buff-sheet-ai-panel-title">提示词预览</div>
                <button type="button" className="buff-sheet-share-modal-close" onClick={() => setIsPromptPreviewOpen(false)} aria-label="关闭">
                  ×
                </button>
              </div>
              <div className="buff-sheet-ai-preview-switch">
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${promptPreviewMode === 'system' ? ' is-active' : ''}`}
                  onClick={() => onPromptPreviewModeChange('system')}
                >
                  系统提示词
                </button>
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${promptPreviewMode === 'mapping' ? ' is-active' : ''}`}
                  onClick={() => onPromptPreviewModeChange('mapping')}
                >
                  映射词典
                </button>
                <button
                  type="button"
                  className={`buff-sheet-share-modal-tab${promptPreviewMode === 'final' ? ' is-active' : ''}`}
                  onClick={() => onPromptPreviewModeChange('final')}
                >
                  最终请求
                </button>
              </div>
              <div className="buff-sheet-ai-shared-banner">
                <strong>使用共享模型配置</strong>
                <span>{hasSharedAiApiKey ? `当前模型：${sharedAiModel}` : '当前未配置 API Key，请先到 shell 中设置。'}</span>
              </div>
              <textarea
                className="buff-sheet-ai-textarea is-system"
                value={promptPreviewMode === 'system' ? systemPrompt : promptPreviewMode === 'mapping' ? mappingPrompt : finalPrompt}
                onChange={(event) => {
                  if (promptPreviewMode !== 'system') {
                    return;
                  }
                  onSystemPromptChange(event.target.value);
                }}
                readOnly={promptPreviewMode !== 'system'}
                spellCheck={false}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
