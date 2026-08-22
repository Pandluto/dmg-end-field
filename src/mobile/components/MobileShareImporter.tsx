import { useEffect, useMemo, useRef, useState } from 'react';
import type { MobileCatalog, MobileDraft } from '../model';
import {
  decodeMobileShareIdFromImage,
  fetchMobileShare,
  isDesktopWorktreeSharePayload,
  isMobileSnapshotSharePayload,
  type MobileShareRecord,
} from '../mobileShare';
import { MobilePortal } from './MobilePortal';
import './MobileShareImporter.css';

interface MobileShareImporterProps {
  catalog: MobileCatalog;
  initialShareId?: string | null;
  onSave: (draft: MobileDraft, archiveName: string) => void;
  onClose: () => void;
}

type ImportState =
  | { status: 'idle' }
  | { status: 'loading'; message: string }
  | {
    status: 'ready';
    share: MobileShareRecord;
    draft: MobileDraft;
    source: 'mobile' | 'desktop';
  }
  | { status: 'error'; message: string };

function formatExpiry(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function buildArchiveName(names: string[]): string {
  const teamName = names.slice(0, 2).join('、') || '未命名队伍';
  return `分享 · ${teamName}`;
}

export function MobileShareImporter({
  catalog,
  initialShareId,
  onSave,
  onClose,
}: MobileShareImporterProps) {
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const loadShare = async (shareId: string) => {
    setState({ status: 'loading', message: '正在读取分享内容…' });
    try {
      const share = await fetchMobileShare(shareId);
      if (isMobileSnapshotSharePayload(share.payload)) {
        setState({ status: 'ready', share, draft: share.payload.draft, source: 'mobile' });
        return;
      }
      if (isDesktopWorktreeSharePayload(share.payload)) {
        setState({
          status: 'ready',
          share,
          draft: share.payload.presentedDraft,
          source: 'desktop',
        });
        return;
      }
      throw new Error('分享来源无法识别。');
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '分享读取失败，请稍后重试。',
      });
    }
  };

  useEffect(() => {
    if (initialShareId) void loadShare(initialShareId);
  }, [initialShareId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const operatorNames = useMemo(() => {
    if (state.status !== 'ready') return [];
    const characterById = new Map(catalog.characters.map((character) => [character.id, character.name]));
    return state.draft.selectedOperatorIds
      .map((operatorId) => characterById.get(operatorId) || operatorId)
      .filter(Boolean);
  }, [catalog.characters, state]);

  const summary = useMemo(() => {
    if (state.status !== 'ready') return null;
    const actions = state.draft.slots.flatMap((slot) => slot.action ? [slot.action] : []);
    return {
      actionCount: actions.length,
      buffCount: actions.reduce((sum, action) => sum + action.buffs.length, 0),
      noteCount: Object.keys(state.draft.reportNotes).length,
    };
  }, [state]);

  const handleImage = async (file: File | undefined) => {
    if (!file) return;
    setState({ status: 'loading', message: '正在从图片识别二维码…' });
    try {
      const shareId = await decodeMobileShareIdFromImage(file);
      await loadShare(shareId);
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '二维码识别失败。',
      });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const saveShare = () => {
    if (state.status !== 'ready') return;
    try {
      onSave(state.draft, buildArchiveName(operatorNames));
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '存档写入失败，请检查浏览器存储空间。',
      });
    }
  };

  const versionMismatch = state.status === 'ready'
    && Boolean(state.share.payload.dataVersion)
    && state.share.payload.dataVersion !== catalog.dataVersion;

  return (
    <MobilePortal>
      <div className="mobile-share-import-backdrop" role="presentation" onClick={onClose}>
        <section
          className="mobile-share-import-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-share-import-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header>
            <span>
              <small>IMPORT TACTICAL SHARE</small>
              <strong id="mobile-share-import-title">导入战术分享</strong>
            </span>
            <button type="button" onClick={onClose} aria-label="关闭分享导入">×</button>
          </header>

          <div className="mobile-share-import-content" aria-live="polite">
            {state.status === 'idle' ? (
              <div className="mobile-share-import-picker">
                <span className="mobile-share-import-mark" aria-hidden="true">▦</span>
                <strong>选择战术报告图片</strong>
                <p>从手机相册选择带二维码的报告。图片只在当前设备识别，不会上传服务器。</p>
                <button type="button" onClick={() => inputRef.current?.click()}>从相册选择</button>
              </div>
            ) : null}

            {state.status === 'loading' ? (
              <div className="mobile-share-import-loading">
                <span aria-hidden="true" />
                <strong>{state.message}</strong>
              </div>
            ) : null}

            {state.status === 'error' ? (
              <div className="mobile-share-import-error" role="alert">
                <strong>没有完成导入</strong>
                <p>{state.message}</p>
                <button type="button" onClick={() => inputRef.current?.click()}>重新选择图片</button>
              </div>
            ) : null}

            {state.status === 'ready' && summary ? (
              <div className="mobile-share-import-preview">
                <div className="mobile-share-import-team">
                  <small>分享队伍</small>
                  <strong>{operatorNames.join(' / ') || '空队伍'}</strong>
                </div>
                <dl>
                  <div><dt>干员</dt><dd>{operatorNames.length}</dd></div>
                  <div><dt>排轴技能</dt><dd>{summary.actionCount}</dd></div>
                  <div><dt>Buff 项</dt><dd>{summary.buffCount}</dd></div>
                  <div><dt>批注</dt><dd>{summary.noteCount}</dd></div>
                </dl>
                <div className="mobile-share-import-meta">
                  <span>数据版本 {state.share.payload.dataVersion || '未知'}</span>
                  <span>
                    {state.share.permanent || state.share.expiresAt === null
                      ? '永久保存'
                      : `${formatExpiry(state.share.expiresAt)} 前可读取`}
                  </span>
                </div>
                {state.source === 'desktop' ? (
                  <p className="mobile-share-import-warning">
                    此码来自桌面完整节点树；手机版只会保存生成二维码时正在展示的节点。
                  </p>
                ) : null}
                {versionMismatch ? (
                  <p className="mobile-share-import-warning">
                    分享使用的数据版本与当前版本不同；保存后会按当前目录自动对齐可用内容。
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer>
            {state.status === 'ready' ? (
              <>
                <button type="button" onClick={() => inputRef.current?.click()}>换一张图片</button>
                <button type="button" className="is-primary" onClick={saveShare}>加入本机存档</button>
              </>
            ) : (
              <button type="button" onClick={onClose}>取消</button>
            )}
          </footer>

          <input
            ref={inputRef}
            className="mobile-share-import-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*"
            onChange={(event) => void handleImage(event.target.files?.[0])}
          />
        </section>
      </div>
    </MobilePortal>
  );
}

export default MobileShareImporter;
