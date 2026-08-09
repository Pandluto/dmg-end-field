import { useEffect, useState } from 'react';
import {
  cloneMobileArchiveSnapshot,
  deleteMobileArchive,
  readMobileArchives,
  renameMobileArchive,
  saveMobileArchive,
  type MobileWorkspaceArchive,
} from '../mobileArchives';
import type { MobileDraft } from '../model';
import { MobilePortal } from './MobilePortal';
import './MobileArchiveManager.css';

interface MobileArchiveManagerProps {
  draft: MobileDraft;
  onRestore: (draft: MobileDraft) => void;
  onClose: () => void;
}

type ArchiveDialogState =
  | { mode: 'save'; name: string }
  | { mode: 'rename'; archiveId: string; name: string }
  | { mode: 'delete'; archiveId: string }
  | null;

function formatArchiveTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function getArchiveSummary(archive: MobileWorkspaceArchive): string {
  const operatorCount = archive.snapshot.selectedOperatorIds.length;
  const actionCount = archive.snapshot.slots.filter((slot) => Boolean(slot.action)).length;
  return `${operatorCount} 名干员 · ${actionCount} 个技能`;
}

function storageErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return '浏览器本地空间已满，请删除不需要的存档后重试。';
  }
  return '存档写入失败，请检查浏览器是否允许本站使用本地存储。';
}

export function MobileArchiveManager({ draft, onRestore, onClose }: MobileArchiveManagerProps) {
  const [archives, setArchives] = useState<MobileWorkspaceArchive[]>(() => readMobileArchives());
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ArchiveDialogState>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const dialogArchive = dialog && dialog.mode !== 'save'
    ? archives.find((archive) => archive.id === dialog.archiveId) ?? null
    : null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dialog) setDialog(null);
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dialog, onClose]);

  const handleSave = () => {
    if (!dialog || dialog.mode !== 'save') return;
    try {
      const nextArchives = saveMobileArchive(draft, dialog.name);
      setArchives(nextArchives);
      setSelectedArchiveId(nextArchives[0]?.id ?? null);
      setDialog(null);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(storageErrorMessage(error));
    }
  };

  const handleRename = () => {
    if (!dialog || dialog.mode !== 'rename' || !dialog.name.trim()) return;
    try {
      setArchives(renameMobileArchive(dialog.archiveId, dialog.name));
      setDialog(null);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(storageErrorMessage(error));
    }
  };

  const handleDelete = () => {
    if (!dialog || dialog.mode !== 'delete') return;
    try {
      setArchives(deleteMobileArchive(dialog.archiveId));
      setSelectedArchiveId((current) => current === dialog.archiveId ? null : current);
      setDialog(null);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(storageErrorMessage(error));
    }
  };

  const handleRestore = (archive: MobileWorkspaceArchive) => {
    onRestore(cloneMobileArchiveSnapshot(archive));
    onClose();
  };

  return (
    <MobilePortal>
      <div className="mobile-archive-backdrop" role="presentation" onClick={onClose}>
        <section
          className="mobile-archive-manager"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-archive-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="mobile-archive-header">
            <div>
              <p>LOCAL ARCHIVE</p>
              <h2 id="mobile-archive-title">本机存档</h2>
            </div>
            <button type="button" className="mobile-archive-close" onClick={onClose} aria-label="关闭存档">×</button>
          </header>

          <div className="mobile-archive-toolbar">
            <span>完整保存队伍、配装、排轴与 Buff 状态</span>
            <button type="button" onClick={() => setDialog({ mode: 'save', name: '' })}>
              <span aria-hidden="true">＋</span>保存当前
            </button>
          </div>

          {errorMessage ? <p className="mobile-archive-error" role="alert">{errorMessage}</p> : null}

          <div className="mobile-archive-list" aria-live="polite">
            {archives.length === 0 ? (
              <div className="mobile-archive-empty">
                <span aria-hidden="true">◇</span>
                <strong>还没有存档</strong>
                <p>保存后会留在当前浏览器中，恢复时整份替换当前工作区。</p>
              </div>
            ) : archives.map((archive, index) => {
              const selected = selectedArchiveId === archive.id;
              return (
                <article key={archive.id} className={`mobile-archive-card${selected ? ' is-selected' : ''}`}>
                  <button
                    type="button"
                    className="mobile-archive-card-main"
                    onClick={() => setSelectedArchiveId(selected ? null : archive.id)}
                    aria-expanded={selected}
                  >
                    <span className="mobile-archive-card-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="mobile-archive-card-copy">
                      <strong>{archive.name}</strong>
                      <small>{getArchiveSummary(archive)}</small>
                    </span>
                    <time dateTime={new Date(archive.updatedAt).toISOString()}>{formatArchiveTime(archive.updatedAt)}</time>
                    <span className="mobile-archive-card-chevron" aria-hidden="true">{selected ? '−' : '＋'}</span>
                  </button>
                  {selected ? (
                    <div className="mobile-archive-card-actions">
                      <button type="button" className="is-primary" onClick={() => handleRestore(archive)}>恢复存档</button>
                      <button type="button" onClick={() => setDialog({ mode: 'rename', archiveId: archive.id, name: archive.name })}>重命名</button>
                      <button type="button" className="is-danger" onClick={() => setDialog({ mode: 'delete', archiveId: archive.id })}>删除</button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <footer className="mobile-archive-footer">
            <span>仅保存在此浏览器</span>
            <b>{archives.length} 份</b>
          </footer>
        </section>

        {dialog ? (
          <div className="mobile-archive-subdialog-backdrop" role="presentation" onClick={() => setDialog(null)}>
            <section
              className="mobile-archive-subdialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-archive-subdialog-title"
              onClick={(event) => event.stopPropagation()}
            >
              {dialog.mode === 'delete' ? (
                <>
                  <p>DELETE ARCHIVE</p>
                  <h3 id="mobile-archive-subdialog-title">确认删除存档？</h3>
                  <div className="mobile-archive-delete-copy">
                    <strong>{dialogArchive?.name ?? '这份存档'}</strong>
                    <span>删除后无法恢复，当前工作区不会受影响。</span>
                  </div>
                  <div className="mobile-archive-subdialog-actions">
                    <button type="button" onClick={() => setDialog(null)}>取消</button>
                    <button type="button" className="is-danger" onClick={handleDelete}>确认删除</button>
                  </div>
                </>
              ) : (
                <>
                  <p>{dialog.mode === 'save' ? 'SAVE SNAPSHOT' : 'RENAME ARCHIVE'}</p>
                  <h3 id="mobile-archive-subdialog-title">{dialog.mode === 'save' ? '保存当前快照' : '重命名存档'}</h3>
                  <label className="mobile-archive-name-field">
                    <span>存档名称</span>
                    <input
                      autoFocus
                      value={dialog.name}
                      maxLength={80}
                      placeholder={dialog.mode === 'save' ? '留空则使用当前时间' : '输入新名称'}
                      onChange={(event) => setDialog({ ...dialog, name: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          if (dialog.mode === 'save') handleSave();
                          else handleRename();
                        }
                      }}
                    />
                  </label>
                  <div className="mobile-archive-subdialog-actions">
                    <button type="button" onClick={() => setDialog(null)}>取消</button>
                    <button
                      type="button"
                      className="is-primary"
                      disabled={dialog.mode === 'rename' && !dialog.name.trim()}
                      onClick={dialog.mode === 'save' ? handleSave : handleRename}
                    >
                      {dialog.mode === 'save' ? '保存快照' : '保存名称'}
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </MobilePortal>
  );
}

export default MobileArchiveManager;
