import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  claimLegacyFillReview,
  confirmAndSaveLegacyFillReview,
  decideLegacyFillReview,
  getMcpFillRuntimeState,
  listLegacyFillReviewProposals,
  type LegacyFillReviewProposal,
  type McpFillRuntimeState,
} from '../legacyFillHost/runtime';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import './McpFillPage.css';

type ReviewManifest = {
  manifestVersion?: number;
  schemaVersion?: number;
  target?: { id?: string; displayName?: string; existsInBase?: boolean };
  baseSnapshot?: { snapshotId?: string; revision?: number; contentHash?: string };
  normalizedDraft?: unknown;
  diff?: Array<{ path?: string; kind?: string; before?: unknown; after?: unknown }>;
  validation?: { valid?: boolean; errors?: unknown[]; warnings?: unknown[]; digest?: string };
  evidence?: Array<{ label?: string; text?: string; source?: string }>;
  requestedWrites?: Array<{ storageDomain?: string; targetId?: string }>;
  review?: { status?: string };
  persistence?: { status?: string };
  manifestDigest?: string;
};

type QueueFilter = 'active' | 'completed' | 'stale' | 'all';
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
  { id: 'completed', label: '已完成' },
  { id: 'stale', label: '异常' },
  { id: 'all', label: '全部' },
];

export function isMcpFillPath(pathname: string) {
  return pathname === APP_ROUTE_PATHS.mcpFill || pathname === APP_ROUTE_PATHS.legacyFillReview;
}

function manifestOf(proposal: LegacyFillReviewProposal | null): ReviewManifest {
  return (proposal?.review || {}) as ReviewManifest;
}

function belongsToFilter(proposal: LegacyFillReviewProposal, filter: QueueFilter) {
  if (filter === 'active') return ['pending', 'claimed', 'approved'].includes(proposal.lifecycleStatus);
  if (filter === 'completed') return ['applied', 'rejected', 'cancelled'].includes(proposal.lifecycleStatus);
  if (filter === 'stale') return proposal.lifecycleStatus === 'stale' || proposal.staleBase;
  return true;
}

function displayTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function displayValue(value: unknown) {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function shortIdentity(value: string | undefined, visible = 18) {
  if (!value) return '—';
  if (value.length <= visible * 2 + 1) return value;
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

function actionCopy(action: ReviewAction, proposal: LegacyFillReviewProposal) {
  const target = manifestOf(proposal).target?.displayName || manifestOf(proposal).target?.id || proposal.summary;
  if (action === 'confirm') return {
    eyebrow: '确认变更',
    title: `确认并写入“${target}”？`,
    body: '本地 Host 将完成审查、受限写入、重新读取目标并验证 postcondition。若资料库 revision 已变化，本次写入会被安全阻止。',
    button: '确认并写入',
  };
  if (action === 'reject') return {
    eyebrow: '拒绝变更',
    title: `确认拒绝“${target}”？`,
    body: '拒绝只会结束这份提案，不会修改当前产品资料。之后可由 Codex 创建新的提案。',
    button: '确认拒绝',
  };
  return { eyebrow: '', title: '', body: '', button: '' };
}

export function McpFillPage() {
  const [proposals, setProposals] = useState<LegacyFillReviewProposal[]>([]);
  const [selected, setSelected] = useState<LegacyFillReviewProposal | null>(null);
  const [runtime, setRuntime] = useState<McpFillRuntimeState | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ReviewAction | 'refresh' | ''>('');
  const [dialog, setDialog] = useState<ReviewAction | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const manifest = manifestOf(selected);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setBusy('refresh');
    try {
      const [values, service] = await Promise.all([
        listLegacyFillReviewProposals(),
        getMcpFillRuntimeState(),
      ]);
      setProposals(values);
      setRuntime(service);
      setSelected((current) => {
        if (current) return values.find((value) => value.proposalId === current.proposalId) || values[0] || null;
        return values.find((value) => belongsToFilter(value, 'active')) || values[0] || null;
      });
      if (!quiet) setNotice(null);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
      if (!quiet) setBusy('');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onLibraryChanged = () => void refresh(true);
    window.addEventListener('legacy-fill.library.changed', onLibraryChanged);
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => {
      window.removeEventListener('legacy-fill.library.changed', onLibraryChanged);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const counts = useMemo(() => ({
    active: proposals.filter((proposal) => belongsToFilter(proposal, 'active')).length,
    completed: proposals.filter((proposal) => belongsToFilter(proposal, 'completed')).length,
    stale: proposals.filter((proposal) => belongsToFilter(proposal, 'stale')).length,
    all: proposals.length,
  }), [proposals]);

  const visibleProposals = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return proposals
      .filter((proposal) => belongsToFilter(proposal, filter))
      .filter((proposal) => {
        if (!needle) return true;
        const target = manifestOf(proposal).target;
        return [proposal.proposalId, proposal.summary, proposal.ownerNamespace, proposal.domain, target?.id, target?.displayName]
          .filter(Boolean).join('\n').toLocaleLowerCase().includes(needle);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [filter, proposals, query]);

  const canReview = Boolean(selected && ['pending', 'claimed', 'approved'].includes(selected.lifecycleStatus) && !selected.staleBase);
  const diff = manifest.diff || [];
  const errors = manifest.validation?.errors || [];
  const warnings = manifest.validation?.warnings || [];

  const runAction = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!selected || !dialog) return;
    const action = dialog;
    setBusy(action);
    try {
      const claimed = await claimLegacyFillReview(selected);
      let next: LegacyFillReviewProposal;
      if (action === 'confirm') {
        const result = await confirmAndSaveLegacyFillReview(event.nativeEvent, claimed.proposal.proposalId);
        next = result.proposal;
        setNotice(result.ok
          ? { tone: 'success', text: '写入完成：Host 已重新读取目标、验证结果并发布新的资料库 revision。' }
          : { tone: 'warning', text: result.code === 'proposal-base-stale' ? '资料库已发生变化，本次写入已安全阻止。请重新生成提案。' : `写入未完成：${result.code}` });
      } else {
        next = await decideLegacyFillReview(event.nativeEvent, claimed.proposal.proposalId, 'rejected');
        setNotice({ tone: 'info', text: '已拒绝这份变更，产品资料没有发生变化。' });
      }
      setFilter('completed');
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

  return (
    <main className="mcp-fill-page">
      <header className="mcp-fill-topbar">
        <div className="mcp-fill-topbar-left">
          <button className="mcp-fill-button" type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>返回主界面</button>
          <div className="mcp-fill-title-block">
            <h1>MCP 填表</h1>
            <p>Codex 提案 · Web 交互确认 · 本地 Host 受限写入</p>
          </div>
        </div>
        <div className="mcp-fill-topbar-right">
          <span className={`mcp-fill-runtime ${runtime?.running ? 'is-online' : 'is-offline'}`}>
            <i aria-hidden="true" />{runtime?.running ? 'MCP 服务运行中' : 'MCP 服务不可用'}
          </span>
          <button className="mcp-fill-button" type="button" onClick={() => void refresh()} disabled={Boolean(busy)}>
            {busy === 'refresh' ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      <section className="mcp-fill-ribbon" aria-label="MCP 填表概览">
        <div className="mcp-fill-ribbon-card">
          <span>连接</span>
          <strong>{runtime?.running ? '本地直连' : '离线'}</strong>
          <small>{runtime?.mcpUrl || 'http://127.0.0.1:17323/mcp'}</small>
        </div>
        <div className="mcp-fill-ribbon-card">
          <span>待处理</span>
          <strong>{counts.active}</strong>
          <small>待确认与待写入</small>
        </div>
        <div className="mcp-fill-ribbon-card">
          <span>当前提案</span>
          <strong>{selected ? DOMAIN_LABELS[selected.domain] : '—'}</strong>
          <small>{selected ? STATUS_LABELS[selected.lifecycleStatus] : '请选择一份提案'}</small>
        </div>
        <label className="mcp-fill-search">
          <span>搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、ID、领域或来源" />
        </label>
      </section>

      {notice ? <div className={`mcp-fill-notice is-${notice.tone}`} role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)}>关闭</button></div> : null}

      <div className="mcp-fill-workspace">
        <aside className="mcp-fill-explorer">
          <div className="mcp-fill-pane-title">
            <div><span>提案队列</span><small>{visibleProposals.length} / {proposals.length}</small></div>
          </div>
          <div className="mcp-fill-filter-tabs" role="tablist" aria-label="提案状态">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>
                <span>{item.label}</span><small>{counts[item.id]}</small>
              </button>
            ))}
          </div>
          <div className="mcp-fill-proposal-list">
            {loading ? <div className="mcp-fill-empty">正在读取提案…</div> : null}
            {!loading && visibleProposals.length === 0 ? <div className="mcp-fill-empty">当前分类没有提案。</div> : null}
            {visibleProposals.map((proposal) => {
              const itemManifest = manifestOf(proposal);
              return (
                <button
                  key={proposal.proposalId}
                  type="button"
                  className={selected?.proposalId === proposal.proposalId ? 'is-selected' : ''}
                  onClick={() => setSelected(proposal)}
                >
                  <span className={`mcp-fill-domain is-${proposal.domain}`}>{DOMAIN_LABELS[proposal.domain]}</span>
                  <span className="mcp-fill-proposal-copy">
                    <strong>{itemManifest.target?.displayName || itemManifest.target?.id || proposal.summary}</strong>
                    <small>{STATUS_LABELS[proposal.lifecycleStatus]} · r{proposal.revision} · {displayTime(proposal.updatedAt)}</small>
                  </span>
                  <i className={`mcp-fill-status-dot is-${proposal.lifecycleStatus}`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="mcp-fill-diff-pane">
          <div className="mcp-fill-pane-title">
            <div><span>字段 Diff</span><small>{selected ? `${diff.length} 项变更` : '未选择'}</small></div>
          </div>
          {!selected ? <div className="mcp-fill-center-empty"><strong>选择一份提案</strong><span>查看 Codex 生成的结构化变更，并由产品 Host 确认或拒绝。</span></div> : (
            <>
              <div className="mcp-fill-document-header">
                <div>
                  <span>{DOMAIN_LABELS[selected.domain]} · {selected.ownerNamespace}</span>
                  <h2>{manifest.target?.displayName || manifest.target?.id || selected.summary}</h2>
                  <p>{selected.summary}</p>
                </div>
                <div className={`mcp-fill-status-badge is-${selected.lifecycleStatus}`}>
                  {STATUS_LABELS[selected.lifecycleStatus]}
                </div>
              </div>
              <div className="mcp-fill-diff-table-wrap">
                {diff.length === 0 ? <div className="mcp-fill-center-empty"><strong>没有字段差异</strong><span>这份提案与当前基础快照一致。</span></div> : (
                  <table className="mcp-fill-diff-table">
                    <thead><tr><th>字段路径</th><th>变更前</th><th>变更后</th></tr></thead>
                    <tbody>
                      {diff.map((entry, index) => (
                        <tr key={`${entry.path}-${index}`}>
                          <td><span className={`mcp-fill-change-kind is-${entry.kind || 'replace'}`}>{entry.kind || 'replace'}</span><code>{entry.path || '/'}</code></td>
                          <td><pre>{displayValue(entry.before)}</pre></td>
                          <td><pre>{displayValue(entry.after)}</pre></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <footer className="mcp-fill-actionbar">
                <div>
                  <span>Manifest digest</span>
                  <code title={selected.manifestDigest}>{shortIdentity(selected.manifestDigest, 12)}</code>
                </div>
                <div className="mcp-fill-actions">
                  <button type="button" className="is-reject" onClick={() => setDialog('reject')} disabled={Boolean(busy) || !canReview}>拒绝</button>
                  <button type="button" className="is-confirm" onClick={() => setDialog('confirm')} disabled={Boolean(busy) || !canReview}>确认并写入</button>
                </div>
              </footer>
            </>
          )}
        </section>

        <aside className="mcp-fill-inspector">
          <div className="mcp-fill-pane-title"><div><span>审查详情</span><small>Web Host bridge</small></div></div>
          {!selected ? <div className="mcp-fill-empty">选择提案后显示校验、证据与写入边界。</div> : (
            <div className="mcp-fill-inspector-scroll">
              <section className="mcp-fill-inspector-section">
                <h3>状态</h3>
                <dl className="mcp-fill-property-grid">
                  <div><dt>审查</dt><dd>{manifest.review?.status || selected.approvalStatus}</dd></div>
                  <div><dt>持久化</dt><dd>{manifest.persistence?.status || selected.saveStatus}</dd></div>
                  <div><dt>Proposal</dt><dd>r{selected.revision}</dd></div>
                  <div><dt>Schema</dt><dd>v{manifest.schemaVersion || 1}</dd></div>
                </dl>
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>校验结果</h3>
                <div className={`mcp-fill-validation ${manifest.validation?.valid ? 'is-valid' : 'is-invalid'}`}>
                  <strong>{manifest.validation?.valid ? '结构校验通过' : '结构校验未通过'}</strong>
                  <span>{errors.length} 个错误 · {warnings.length} 个警告</span>
                </div>
                {errors.map((error, index) => <p className="mcp-fill-issue is-error" key={`error-${index}`}>{displayValue(error)}</p>)}
                {warnings.map((warning, index) => <p className="mcp-fill-issue is-warning" key={`warning-${index}`}>{displayValue(warning)}</p>)}
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>写入目标</h3>
                {(manifest.requestedWrites || []).length === 0 ? <p className="mcp-fill-muted">未声明写入目标</p> : (manifest.requestedWrites || []).map((write, index) => (
                  <div className="mcp-fill-write-target" key={`${write.storageDomain}-${write.targetId}-${index}`}>
                    <strong>{write.storageDomain || selected.domain}</strong><code>{write.targetId || manifest.target?.id}</code>
                  </div>
                ))}
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>证据</h3>
                {(manifest.evidence || []).length === 0 ? <p className="mcp-fill-muted">没有附加证据</p> : (manifest.evidence || []).map((item, index) => (
                  <article className="mcp-fill-evidence" key={`${item.label}-${index}`}>
                    <strong>{item.label || `证据 ${index + 1}`}</strong>
                    <p>{item.text || '—'}</p>
                    {item.source ? <small>{item.source}</small> : null}
                  </article>
                ))}
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>基础身份</h3>
                <dl className="mcp-fill-identity-list">
                  <div><dt>Target</dt><dd>{manifest.target?.id || '—'}</dd></div>
                  <div><dt>Base revision</dt><dd>{manifest.baseSnapshot?.revision ?? selected.baseRevision}</dd></div>
                  <div><dt>Snapshot</dt><dd title={manifest.baseSnapshot?.snapshotId}>{shortIdentity(manifest.baseSnapshot?.snapshotId)}</dd></div>
                  <div><dt>Content hash</dt><dd title={manifest.baseSnapshot?.contentHash || selected.baseContentHash}>{shortIdentity(manifest.baseSnapshot?.contentHash || selected.baseContentHash)}</dd></div>
                  <div><dt>Manifest digest</dt><dd title={selected.manifestDigest}>{shortIdentity(selected.manifestDigest)}</dd></div>
                </dl>
              </section>

              <details className="mcp-fill-raw">
                <summary>标准化内容</summary>
                <pre>{displayValue(manifest.normalizedDraft ?? selected.normalized)}</pre>
              </details>
            </div>
          )}
        </aside>
      </div>

      <footer className="mcp-fill-statusbar">
        <span>本页面是 Web 产品页，不是 MCP 协议界面</span>
        <span>Codex 只能读取、校验并创建提案</span>
        <span>PID {runtime?.pid || '—'} · {runtime?.running ? 'ready' : 'offline'}</span>
      </footer>

      {selected && dialog && modalCopy ? (
        <div className="mcp-fill-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
          <section className="mcp-fill-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-fill-dialog-title">
            <span className={`mcp-fill-dialog-eyebrow is-${dialog}`}>{modalCopy.eyebrow}</span>
            <h2 id="mcp-fill-dialog-title">{modalCopy.title}</h2>
            <p>{modalCopy.body}</p>
            <dl>
              <div><dt>领域</dt><dd>{DOMAIN_LABELS[selected.domain]}</dd></div>
              <div><dt>字段变化</dt><dd>{diff.length}</dd></div>
              <div><dt>Proposal revision</dt><dd>r{selected.revision}</dd></div>
            </dl>
            <div className="mcp-fill-dialog-actions">
              <button type="button" onClick={() => setDialog(null)} disabled={Boolean(busy)}>取消</button>
              <button
                type="button"
                className={`is-${dialog}`}
                onClick={(event) => void runAction(event)}
                disabled={Boolean(busy)}
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
