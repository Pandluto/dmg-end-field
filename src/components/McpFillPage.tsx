import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  claimLegacyFillReview,
  confirmAndSaveLegacyFillReview,
  decideLegacyFillReview,
  getMcpFillRuntimeState,
  listLegacyFillReviewProposals,
  type LegacyFillReviewProposal,
  type McpFillRuntimeState,
} from '../legacyFillHost/runtime';
import { hasDesktopMcpReviewAuthority } from '../platform/runtime/desktopMcpBridge';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import {
  canConfirmProposal,
  canRejectProposal,
  displayDiffPath,
  filterReviewProposals,
  formatReviewValue,
  manifestOf,
  proposalChangeSummary,
  proposalTargetLabel,
  proposalValidation,
  selectVisibleProposal,
  type QueueFilter,
  type ReviewDiffEntry,
  type ReviewIssue,
  type ReviewView,
} from './mcpFillReviewModel';
import { BuffResultPreview } from './mcpFillResults/BuffResultPreview';
import { EquipmentResultPreview } from './mcpFillResults/EquipmentResultPreview';
import { OperatorResultPreview } from './mcpFillResults/OperatorResultPreview';
import { WeaponResultPreview } from './mcpFillResults/WeaponResultPreview';
import './McpFillPage.css';
import './mcpFillResults/McpFillResultPreview.css';

type ReviewAction = 'confirm' | 'reject';
type Notice = { tone: 'info' | 'success' | 'warning' | 'error'; text: string };

const DOMAIN_LABELS = {
  buff: 'BUFF',
  weapon: '武器',
  operator: '干员',
  equipment: '装备',
} as const;

const STATUS_LABELS: Record<LegacyFillReviewProposal['lifecycleStatus'], string> = {
  pending: '待确认',
  claimed: '审查中',
  approved: '待保存',
  rejected: '已拒绝',
  applied: '已写入',
  cancelled: '已取消',
  stale: '已过期',
};

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: 'active', label: '待处理' },
  { id: 'all', label: '全部记录' },
];

const VIEWS: Array<{ id: ReviewView; label: string }> = [
  { id: 'changes', label: '变更内容' },
  { id: 'result', label: '完整结果' },
  { id: 'context', label: '提案依据' },
];

const DIFF_KIND_LABELS: Record<ReviewDiffEntry['kind'], string> = {
  add: '新增',
  remove: '删除',
  replace: '修改',
};

const MAX_VISIBLE_DIFFS = 200;

function renderResultPreview(domain: LegacyFillReviewProposal['domain'], value: unknown) {
  if (domain === 'weapon') return <WeaponResultPreview value={value} />;
  if (domain === 'operator') return <OperatorResultPreview value={value} />;
  if (domain === 'buff') return <BuffResultPreview value={value} />;
  return <EquipmentResultPreview value={value} />;
}

export function isMcpFillPath(pathname: string) {
  return pathname === '/mcp-fill' || pathname === '/legacy-fill-review';
}

function displayTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function actionCopy(action: ReviewAction, proposal: LegacyFillReviewProposal) {
  const target = proposalTargetLabel(proposal);
  if (action === 'confirm') return {
    eyebrow: '最终写入确认',
    title: `确认写入“${target}”？`,
    body: '系统会再次比对资料版本，通过后写入浏览器 SQLite，并立即重读验证结果。任何版本冲突都会阻止写入。',
    button: '确认并写入',
  };
  return {
    eyebrow: '结束这份提案',
    title: `拒绝“${target}”？`,
    body: '拒绝只会关闭这份提案，不会修改产品资料。之后仍可由 MCP 创建新的提案。',
    button: '确认拒绝',
  };
}

function RuntimeBadge({ runtime }: { runtime: McpFillRuntimeState | null }) {
  const state = runtime?.ready ? 'online' : runtime?.running ? 'starting' : 'offline';
  const label = runtime?.ready ? 'MCP 服务运行中' : runtime?.running ? 'MCP 服务启动中' : 'MCP 服务不可用';
  return <span className={`mcp-fill-runtime is-${state}`} title={runtime?.reason || label}><i aria-hidden="true" />{label}</span>;
}

function ValidationIssues({ errors, warnings }: { errors: ReviewIssue[]; warnings: ReviewIssue[] }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <section className="mcp-fill-validation-details" aria-label="内容检查详情">
      {errors.map((issue, index) => (
        <div className="is-error" key={`error-${issue.code || index}`}>
          <strong>错误{issue.code ? ` · ${issue.code}` : ''}</strong>
          <span>{issue.path ? `${displayDiffPath(issue.path)}：` : ''}{issue.message}</span>
        </div>
      ))}
      {warnings.map((issue, index) => (
        <div className="is-warning" key={`warning-${issue.code || index}`}>
          <strong>提醒{issue.code ? ` · ${issue.code}` : ''}</strong>
          <span>{issue.path ? `${displayDiffPath(issue.path)}：` : ''}{issue.message}</span>
        </div>
      ))}
    </section>
  );
}

function DiffValue({ label, value, emptyLabel }: { label: string; value: unknown; emptyLabel: string }) {
  const formatted = value === undefined ? emptyLabel : formatReviewValue(value);
  const multiline = formatted.includes('\n') || formatted.length > 90;
  return (
    <div className="mcp-fill-diff-value">
      <span>{label}</span>
      {multiline ? <pre>{formatted}</pre> : <strong>{formatted}</strong>}
    </div>
  );
}

function DiffList({ entries }: { entries: ReviewDiffEntry[] }) {
  const visible = entries.slice(0, MAX_VISIBLE_DIFFS);
  return (
    <div className="mcp-fill-diff-list">
      {visible.map((entry, index) => (
        <article className={`mcp-fill-diff-entry is-${entry.kind}`} key={`${entry.path}-${entry.kind}-${index}`}>
          <header>
            <span>{DIFF_KIND_LABELS[entry.kind]}</span>
            <strong>{displayDiffPath(entry.path)}</strong>
            <code>{entry.path || '/'}</code>
          </header>
          <div className="mcp-fill-diff-values">
            <DiffValue label="原内容" value={entry.before} emptyLabel={entry.kind === 'add' ? '原资料中不存在' : '不存在'} />
            <DiffValue label="新内容" value={entry.after} emptyLabel={entry.kind === 'remove' ? '写入后移除' : '不存在'} />
          </div>
        </article>
      ))}
      {entries.length > visible.length ? (
        <p className="mcp-fill-diff-limit">这份提案共有 {entries.length} 项字段变更；页面先显示前 {visible.length} 项，完整结果可在“完整结果”中核对。</p>
      ) : null}
    </div>
  );
}

function AccessRequiredPage() {
  return (
    <main className="mcp-fill-page is-access-required">
      <header className="mcp-fill-topbar">
        <div className="mcp-fill-brand">
          <span className="mcp-fill-mark" aria-hidden="true">M</span>
          <div><h1>MCP 填表</h1><p>受保护的产品资料审核页</p></div>
        </div>
      </header>
      <section className="mcp-fill-state-page" role="alert">
        <span className="mcp-fill-state-icon" aria-hidden="true">!</span>
        <p className="mcp-fill-eyebrow">需要 Shell 授权</p>
        <h2>请从 Electron Shell 打开此页面</h2>
        <p>审核入口不会出现在普通网页导航中。回到桌面 Shell，点击“打开 MCP 填表”即可获得一次性审核授权。</p>
        <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>返回主界面</button>
      </section>
    </main>
  );
}

export function McpFillPage() {
  const [authorityAvailable] = useState(() => hasDesktopMcpReviewAuthority());
  const [proposals, setProposals] = useState<LegacyFillReviewProposal[]>([]);
  const [selected, setSelected] = useState<LegacyFillReviewProposal | null>(null);
  const [runtime, setRuntime] = useState<McpFillRuntimeState | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('active');
  const [view, setView] = useState<ReviewView>('changes');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(authorityAvailable);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState<ReviewAction | 'refresh' | ''>('');
  const [dialog, setDialog] = useState<ReviewAction | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const dialogActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.body.classList.add('mcp-fill-route');
    return () => document.body.classList.remove('mcp-fill-route');
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!authorityAvailable) return;
    if (!quiet) setBusy('refresh');
    try {
      const [values, service] = await Promise.all([
        listLegacyFillReviewProposals(),
        getMcpFillRuntimeState(),
      ]);
      setProposals(values);
      setRuntime(service);
      setSelected((current) => current
        ? values.find((value) => value.proposalId === current.proposalId) || null
        : null);
      setFailure('');
      if (!quiet) setNotice(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntime(null);
      setFailure(message);
      if (!quiet) setNotice({ tone: 'error', text: message });
    } finally {
      setLoading(false);
      if (!quiet) setBusy('');
    }
  }, [authorityAvailable]);

  useEffect(() => {
    if (!authorityAvailable) return undefined;
    void refresh();
    const onLibraryChanged = () => void refresh(true);
    window.addEventListener('legacy-fill.library.changed', onLibraryChanged);
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => {
      window.removeEventListener('legacy-fill.library.changed', onLibraryChanged);
      window.clearInterval(timer);
    };
  }, [authorityAvailable, refresh]);

  const counts = useMemo(() => ({
    active: proposals.filter((proposal) => ['pending', 'claimed', 'approved'].includes(proposal.lifecycleStatus)).length,
    all: proposals.length,
  }), [proposals]);

  const visibleProposals = useMemo(
    () => filterReviewProposals(proposals, filter, query),
    [filter, proposals, query],
  );

  useEffect(() => {
    setSelected((current) => selectVisibleProposal(current, visibleProposals));
  }, [visibleProposals]);

  useEffect(() => {
    setView('changes');
    setDialog(null);
  }, [selected?.proposalId]);

  useEffect(() => {
    if (!dialog) return undefined;
    dialogActionRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setDialog(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, dialog]);

  const manifest = manifestOf(selected);
  const validation = proposalValidation(selected);
  const changes = proposalChangeSummary(selected);
  const confirmAvailable = canConfirmProposal(selected, runtime) && !busy;
  const rejectAvailable = canRejectProposal(selected, runtime) && !busy;
  const dialogActionAvailable = dialog === 'confirm'
    ? canConfirmProposal(selected, runtime)
    : dialog === 'reject' && canRejectProposal(selected, runtime);

  const runAction = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!selected || !dialog) return;
    const action = dialog;
    if (action === 'confirm' && !canConfirmProposal(selected, runtime)) return;
    if (action === 'reject' && !canRejectProposal(selected, runtime)) return;
    setBusy(action);
    try {
      const claimed = await claimLegacyFillReview(selected);
      let next: LegacyFillReviewProposal;
      if (action === 'confirm') {
        const result = await confirmAndSaveLegacyFillReview(event.nativeEvent, claimed.proposal.proposalId);
        next = result.proposal;
        setNotice(result.ok
          ? { tone: 'success', text: '写入完成：浏览器 SQLite 已保存，并通过重读校验。' }
          : { tone: 'warning', text: result.code === 'proposal-base-stale' ? '资料库已发生变化，本次写入已安全停止。请重新生成提案。' : `写入未完成：${result.code}` });
      } else {
        next = await decideLegacyFillReview(event.nativeEvent, claimed.proposal.proposalId, 'rejected');
        setNotice({ tone: 'info', text: '已拒绝这份变更，产品资料没有发生变化。' });
      }
      setFilter('all');
      setQuery('');
      setSelected(next);
      setDialog(null);
      await refresh(true);
      setSelected(next);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy('');
    }
  };

  const modalCopy = selected && dialog ? actionCopy(dialog, selected) : null;

  if (!authorityAvailable) return <AccessRequiredPage />;

  const actionHint = !selected ? '请选择一份提案'
    : selected.staleBase ? '基础资料已经变化，需要重新生成提案'
      : !validation.known ? '缺少校验结果，不能写入'
        : !validation.valid ? '内容检查未通过，不能写入'
          : !runtime?.ready ? runtime?.reason || 'MCP 服务尚未就绪'
            : ['pending', 'claimed', 'approved'].includes(selected.lifecycleStatus)
              ? '确认时会再次比对资料版本并重读写入结果'
              : `这份提案${STATUS_LABELS[selected.lifecycleStatus]}`;

  return (
    <main className={`mcp-fill-page${notice ? ' has-notice' : ''}`}>
      <header className="mcp-fill-topbar">
        <div className="mcp-fill-brand">
          <button className="mcp-fill-back" type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)} aria-label="返回主界面">←</button>
          <span className="mcp-fill-mark" aria-hidden="true">M</span>
          <div><h1>MCP 填表</h1><p>提案只在你确认后写入产品资料</p></div>
        </div>
        <div className="mcp-fill-topbar-actions">
          <RuntimeBadge runtime={runtime} />
          <button className="mcp-fill-button" type="button" onClick={() => void refresh()} disabled={Boolean(busy)}>
            {busy === 'refresh' ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      {notice ? (
        <div className={`mcp-fill-notice is-${notice.tone}`} role="status">
          <span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">关闭</button>
        </div>
      ) : null}

      <div className="mcp-fill-workspace">
        <aside className="mcp-fill-explorer" aria-label="提案审核队列">
          <div className="mcp-fill-explorer-heading">
            <div><span>审核队列</span><small>{counts.active ? `${counts.active} 份待处理` : '没有待处理提案'}</small></div>
            <strong>{counts.all}</strong>
          </div>
          <label className="mcp-fill-queue-search">
            <span className="sr-only">搜索提案</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、领域或提案 ID" aria-label="搜索提案" />
          </label>
          <div className="mcp-fill-filter-tabs" role="tablist" aria-label="提案状态">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={filter === item.id ? 'is-active' : ''}
                onClick={() => setFilter(item.id)}
              >
                <span>{item.label}</span><small>{counts[item.id]}</small>
              </button>
            ))}
          </div>
          <div className="mcp-fill-proposal-list">
            {loading ? <div className="mcp-fill-list-state"><i aria-hidden="true" />正在读取提案…</div> : null}
            {!loading && visibleProposals.length === 0 ? (
              <div className="mcp-fill-list-state is-empty"><strong>{query ? '没有匹配结果' : filter === 'active' ? '队列已经处理完' : '还没有提案'}</strong><span>{query ? '换一个关键词试试。' : filter === 'active' ? '新提案出现后会自动显示在这里。' : 'MCP 创建的提案会保留在这里。'}</span></div>
            ) : null}
            {visibleProposals.map((proposal) => (
              <button
                key={proposal.proposalId}
                type="button"
                className={selected?.proposalId === proposal.proposalId ? 'is-selected' : ''}
                aria-current={selected?.proposalId === proposal.proposalId ? 'true' : undefined}
                onClick={() => setSelected(proposal)}
              >
                <span className="mcp-fill-proposal-topline">
                  <small>{DOMAIN_LABELS[proposal.domain]}</small>
                  <i className={`is-${proposal.lifecycleStatus}`}>{STATUS_LABELS[proposal.lifecycleStatus]}</i>
                </span>
                <strong>{proposalTargetLabel(proposal)}</strong>
                <span className="mcp-fill-proposal-summary">{proposal.summary}</span>
                <time dateTime={proposal.updatedAt}>{displayTime(proposal.updatedAt)}</time>
              </button>
            ))}
          </div>
        </aside>

        <section className="mcp-fill-detail" aria-label="提案内容">
          {!selected && loading ? (
            <div className="mcp-fill-center-state"><i className="is-loading" aria-hidden="true" /><strong>正在准备审核页面</strong><span>读取提案和 MCP 服务状态。</span></div>
          ) : null}
          {!selected && !loading && failure ? (
            <div className="mcp-fill-center-state is-error" role="alert"><i aria-hidden="true">!</i><strong>审核服务暂时不可用</strong><span>{failure}</span><button type="button" onClick={() => void refresh()}>重新连接</button></div>
          ) : null}
          {!selected && !loading && !failure ? (
            <div className="mcp-fill-center-state"><i aria-hidden="true">✓</i><strong>{filter === 'active' ? '当前没有待审核内容' : '选择一份提案'}</strong><span>{filter === 'active' ? '可以先关闭此页面；新提案会保留在审核队列中。' : '查看变更、完整结果和提案依据。'}</span></div>
          ) : null}

          {selected ? (
            <>
              <div className="mcp-fill-review-toolbar">
                <nav className="mcp-fill-view-tabs" role="tablist" aria-label="提案查看方式">
                  {VIEWS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={view === item.id}
                      className={view === item.id ? 'is-active' : ''}
                      onClick={() => setView(item.id)}
                    >
                      {item.label}
                      {item.id === 'changes' ? <small>{changes.total}</small> : null}
                    </button>
                  ))}
                </nav>
                <div
                  className={`mcp-fill-review-status ${validation.valid ? 'is-valid' : 'is-invalid'}`}
                  role="status"
                  title={`${validation.valid ? '内容检查通过' : '内容检查未通过'}；${validation.errors.length} 错误，${validation.warnings.length} 提醒`}
                >
                  <i aria-hidden="true" />
                  <strong>{validation.valid ? '检查通过' : '检查未通过'}</strong>
                  <span>{validation.errors.length} 错误 · {validation.warnings.length} 提醒</span>
                </div>
              </div>

              <div className="mcp-fill-review-scroll" role="tabpanel">
                {view === 'changes' ? (
                  <div className="mcp-fill-review-section">
                    <ValidationIssues errors={validation.errors} warnings={validation.warnings} />
                    {changes.isNew ? (
                      <>
                        <div className="mcp-fill-new-record-note"><strong>这是新增资料</strong><span>原资料库中没有对应条目，因此没有旧版本可对比。下面直接展示将要写入的完整结果。</span></div>
                        {renderResultPreview(selected.domain, manifest.normalizedDraft ?? selected.normalized)}
                      </>
                    ) : changes.diff.length ? (
                      <DiffList entries={changes.diff} />
                    ) : (
                      <div className="mcp-fill-center-state is-inline"><i aria-hidden="true">—</i><strong>没有可显示的字段变化</strong><span>请在“完整结果”和“提案依据”中继续核对。</span></div>
                    )}
                  </div>
                ) : null}

                {view === 'result' ? (
                  <div className="mcp-fill-review-section">
                    {renderResultPreview(selected.domain, manifest.normalizedDraft ?? selected.normalized)}
                  </div>
                ) : null}

                {view === 'context' ? (
                  <div className="mcp-fill-context-grid">
                    <section className="mcp-fill-context-card is-wide"><span>修改目的</span><p>{manifest.intent || '提案没有附加修改说明。'}</p></section>
                    <section className="mcp-fill-context-card is-wide">
                      <span>参考依据</span>
                      {manifest.evidence?.length ? <ul>{manifest.evidence.map((item, index) => <li key={`${item.label || 'evidence'}-${index}`}><strong>{item.label || `依据 ${index + 1}`}</strong><p>{item.text || '—'}</p></li>)}</ul> : <p>提案没有附加参考依据。</p>}
                    </section>
                    <section className="mcp-fill-context-card"><span>基础快照</span><dl><div><dt>Revision</dt><dd>{manifest.baseSnapshot?.revision ?? selected.baseRevision}</dd></div><div><dt>Snapshot</dt><dd><code>{manifest.baseSnapshot?.snapshotId || '—'}</code></dd></div></dl></section>
                    <section className="mcp-fill-context-card"><span>写入目标</span><dl>{(manifest.requestedWrites || []).map((write, index) => <div key={`${write.storageDomain}-${index}`}><dt>{write.storageDomain || selected.domain}</dt><dd><code>{write.targetId || manifest.target?.id || '—'}</code></dd></div>)}</dl></section>
                    <section className="mcp-fill-context-card is-wide">
                      <span>提案信息</span>
                      <dl>
                        <div><dt>版本</dt><dd>r{selected.revision}</dd></div>
                        <div><dt>更新时间</dt><dd>{displayTime(selected.updatedAt)}</dd></div>
                        <div><dt>提案 ID</dt><dd><code>{selected.proposalId}</code></dd></div>
                        <div><dt>来源命名空间</dt><dd><code>{selected.ownerNamespace}</code></dd></div>
                      </dl>
                    </section>
                  </div>
                ) : null}
              </div>

              <footer className="mcp-fill-actionbar">
                <div className="mcp-fill-action-summary">
                  <strong className={confirmAvailable ? 'is-safe' : validation.errors.length ? 'is-danger' : ''}>{confirmAvailable ? '可以安全写入' : actionHint}</strong>
                  <span>{confirmAvailable ? actionHint : '拒绝提案不会修改任何产品资料。'}</span>
                </div>
                <div className="mcp-fill-actions">
                  <button type="button" className="is-reject" onClick={() => setDialog('reject')} disabled={!rejectAvailable}>拒绝</button>
                  <button type="button" className="is-confirm" onClick={() => setDialog('confirm')} disabled={!confirmAvailable}>确认并写入</button>
                </div>
              </footer>
            </>
          ) : null}
        </section>
      </div>

      {selected && dialog && modalCopy ? (
        <div className="mcp-fill-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
          <section className="mcp-fill-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mcp-fill-dialog-title" aria-describedby="mcp-fill-dialog-description">
            <span className={`mcp-fill-dialog-eyebrow is-${dialog}`}>{modalCopy.eyebrow}</span>
            <h2 id="mcp-fill-dialog-title">{modalCopy.title}</h2>
            <p id="mcp-fill-dialog-description">{modalCopy.body}</p>
            <dl>
              <div><dt>领域</dt><dd>{DOMAIN_LABELS[selected.domain]}</dd></div>
              <div><dt>字段变化</dt><dd>{changes.isNew ? '新增资料' : `${changes.total} 项`}</dd></div>
              <div><dt>提案版本</dt><dd>r{selected.revision}</dd></div>
            </dl>
            <div className="mcp-fill-dialog-actions">
              <button type="button" onClick={() => setDialog(null)} disabled={Boolean(busy)}>取消</button>
              <button
                ref={dialogActionRef}
                type="button"
                className={`is-${dialog}`}
                onClick={(event) => void runAction(event)}
                disabled={Boolean(busy) || !dialogActionAvailable}
              >
                {busy === dialog ? '处理中…' : modalCopy.button}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
