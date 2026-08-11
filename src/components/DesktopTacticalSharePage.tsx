import { useEffect, useMemo, useState } from 'react';
import { loadMobileCatalog } from '../mobile/mobileCatalog';
import {
  fetchMobileShare,
  isDesktopWorktreeSharePayload,
  isMobileSnapshotSharePayload,
  parseMobileShareId,
  type MobileShareRecord,
} from '../mobile/mobileShare';
import {
  buildMobileSnapshotTimelineBundle,
  validateDesktopTimelineBundle,
} from '../mobile/tacticalShareInterop';
import type { MobileCatalog, MobileDraft } from '../mobile/model';
import type { TimelineBundleV2 } from '../utils/timelineSnapshotStorage';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { importTacticalShareIntoDesktop } from './desktopTacticalShare';
import './DesktopTacticalSharePage.css';

type ReadyShare = {
  share: MobileShareRecord;
  catalog: MobileCatalog;
  draft: MobileDraft;
  source: 'mobile' | 'desktop';
  desktopBundle: TimelineBundleV2 | null;
};

type PageState =
  | { status: 'loading'; message: string }
  | { status: 'ready'; value: ReadyShare }
  | { status: 'importing'; value: ReadyShare }
  | { status: 'done'; value: ReadyShare; message: string }
  | { status: 'error'; message: string };

function buildLabel(value: ReadyShare, operatorNames: string[]): string {
  if (value.source === 'desktop') {
    return value.desktopBundle?.manifest.label?.trim() || '桌面战术分享';
  }
  return `手机分享 · ${operatorNames.slice(0, 2).join('、') || '未命名队伍'}`;
}

export function DesktopTacticalSharePage() {
  const shareId = useMemo(() => parseMobileShareId(window.location.href), []);
  const [state, setState] = useState<PageState>({ status: 'loading', message: '正在并发读取国内、海外分享节点…' });

  const load = async () => {
    if (!shareId) {
      setState({ status: 'error', message: '分享地址中的编号无效。' });
      return;
    }
    setState({ status: 'loading', message: '正在并发读取国内、海外分享节点…' });
    try {
      const [share, catalog] = await Promise.all([
        fetchMobileShare(shareId),
        loadMobileCatalog(),
      ]);
      if (isMobileSnapshotSharePayload(share.payload)) {
        setState({
          status: 'ready',
          value: {
            share,
            catalog,
            draft: share.payload.draft,
            source: 'mobile',
            desktopBundle: null,
          },
        });
        return;
      }
      if (isDesktopWorktreeSharePayload(share.payload)) {
        const desktopBundle = await validateDesktopTimelineBundle(share.payload.bundle);
        setState({
          status: 'ready',
          value: {
            share,
            catalog,
            draft: share.payload.presentedDraft,
            source: 'desktop',
            desktopBundle,
          },
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
    void load();
  }, []);

  const readyValue = state.status === 'ready' || state.status === 'importing' || state.status === 'done'
    ? state.value
    : null;
  const operatorNames = useMemo(() => {
    if (!readyValue) return [];
    const characterById = new Map(readyValue.catalog.characters.map((character) => [character.id, character.name]));
    return readyValue.draft.selectedOperatorIds.map((operatorId) => characterById.get(operatorId) || operatorId);
  }, [readyValue]);
  const actionCount = readyValue
    ? readyValue.draft.slots.filter((slot) => Boolean(slot.action)).length
    : 0;
  const workNodeCount = readyValue?.desktopBundle?.workNodes?.length ?? 0;
  const snapshotCount = readyValue?.desktopBundle?.snapshots.length ?? 1;

  const importShare = async () => {
    if (!readyValue || !shareId || state.status === 'importing') return;
    setState({ status: 'importing', value: readyValue });
    try {
      const label = buildLabel(readyValue, operatorNames);
      const bundle = readyValue.source === 'desktop' && readyValue.desktopBundle
        ? readyValue.desktopBundle
        : await buildMobileSnapshotTimelineBundle(
          shareId,
          readyValue.draft,
          readyValue.catalog,
          label,
        );
      const result = await importTacticalShareIntoDesktop({
        shareId,
        source: readyValue.source,
        label,
        bundle,
      });
      setState({
        status: 'done',
        value: readyValue,
        message: readyValue.source === 'desktop'
          ? `完整节点树已迁移：${result.converted.importedNodeCount} 个工作节点。`
          : '手机快照已作为根节点建立新的桌面工作树。',
      });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '桌面工作区写入失败。',
      });
    }
  };

  const openImportedWorkspace = () => {
    navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace);
    window.location.reload();
  };

  return (
    <main className="desktop-tactical-share-page">
      <section className="desktop-tactical-share-card" aria-live="polite">
        <header>
          <span><small>TACTICAL SHARE</small><strong>导入战术分享</strong></span>
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.timelineWorkspace)}>返回工作台</button>
        </header>

        {state.status === 'loading' ? (
          <div className="desktop-tactical-share-state">
            <i aria-hidden="true" />
            <strong>{state.message}</strong>
            <p>任一固定节点先返回有效内容，就立即采用该结果。</p>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <div className="desktop-tactical-share-state is-error" role="alert">
            <b aria-hidden="true">!</b>
            <strong>没有完成导入</strong>
            <p>{state.message}</p>
            <button type="button" onClick={() => void load()}>重新读取</button>
          </div>
        ) : null}

        {readyValue ? (
          <div className="desktop-tactical-share-preview">
            <div className="desktop-tactical-share-source">
              <small>{readyValue.source === 'desktop' ? 'DESKTOP WORKTREE' : 'MOBILE SNAPSHOT'}</small>
              <strong>{readyValue.source === 'desktop' ? '完整 SQLite 节点树' : '手机端当前快照'}</strong>
              <p>{readyValue.source === 'desktop'
                ? '桌面端将迁移完整节点树、恢复点与当前 checkout。'
                : '桌面端将以此快照为根，新建一棵独立节点树。'}</p>
            </div>
            <h1>{operatorNames.join(' / ') || '空队伍'}</h1>
            <dl>
              <div><dt>干员</dt><dd>{operatorNames.length}</dd></div>
              <div><dt>排轴技能</dt><dd>{actionCount}</dd></div>
              <div><dt>恢复快照</dt><dd>{snapshotCount}</dd></div>
              <div><dt>工作节点</dt><dd>{workNodeCount}</dd></div>
            </dl>
            <footer>
              <span>数据版本 {readyValue.share.payload.dataVersion || '未知'}</span>
              {state.status === 'done' ? (
                <button type="button" className="is-primary" onClick={openImportedWorkspace}>打开新工作区</button>
              ) : (
                <button
                  type="button"
                  className="is-primary"
                  disabled={state.status === 'importing'}
                  onClick={() => void importShare()}
                >
                  {state.status === 'importing'
                    ? '正在写入 SQLite…'
                    : readyValue.source === 'desktop' ? '迁移完整节点树' : '新建桌面节点树'}
                </button>
              )}
            </footer>
            {state.status === 'done' ? <p className="desktop-tactical-share-success">{state.message}</p> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default DesktopTacticalSharePage;
