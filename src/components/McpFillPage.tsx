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
import { BuffResultPreview } from './mcpFillResults/BuffResultPreview';
import { EquipmentResultPreview } from './mcpFillResults/EquipmentResultPreview';
import { OperatorResultPreview } from './mcpFillResults/OperatorResultPreview';
import { WeaponResultPreview } from './mcpFillResults/WeaponResultPreview';
import './McpFillPage.css';
import './mcpFillResults/McpFillResultPreview.css';

type ReviewManifest = {
  target?: { id?: string; displayName?: string; existsInBase?: boolean };
  normalizedDraft?: unknown;
  validation?: { valid?: boolean; errors?: unknown[]; warnings?: unknown[] };
};

type QueueFilter = 'active' | 'all';
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
  { id: 'all', label: '全部' },
];

function renderResultPreview(domain: LegacyFillReviewProposal['domain'], value: unknown) {
  if (domain === 'weapon') return <WeaponResultPreview value={value} />;
  if (domain === 'operator') return <OperatorResultPreview value={value} />;
  if (domain === 'buff') return <BuffResultPreview value={value} />;
  return <EquipmentResultPreview value={value} />;
}

export function isMcpFillPath(pathname: string) {
  return pathname === APP_ROUTE_PATHS.mcpFill || pathname === APP_ROUTE_PATHS.legacyFillReview;
}

function manifestOf(proposal: LegacyFillReviewProposal | null): ReviewManifest {
  return (proposal?.review || {}) as ReviewManifest;
}

function belongsToFilter(proposal: LegacyFillReviewProposal, filter: QueueFilter) {
  if (filter === 'active') return ['pending', 'claimed', 'approved'].includes(proposal.lifecycleStatus);
  return true;
}

function displayTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function actionCopy(action: ReviewAction, proposal: LegacyFillReviewProposal) {
  const target = manifestOf(proposal).target?.displayName || manifestOf(proposal).target?.id || proposal.summary;
  if (action === 'confirm') return {
    eyebrow: '确认变更',
    title: `确认并写入“${target}”？`,
    body: '系统会再次确认资料没有变化，再写入并核对结果。若资料已更新，本次写入会自动停止。',
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
  const [filter, setFilter] = useState<QueueFilter>('all');
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
  const errorCount = manifest.validation?.errors?.length || 0;
  const warningCount = manifest.validation?.warnings?.length || 0;

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
      setFilter('all');
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
            <p>Codex 提案 · 网页确认 · 安全写入</p>
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

      {notice ? <div className={`mcp-fill-notice is-${notice.tone}`} role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)}>关闭</button></div> : null}

      <div className="mcp-fill-workspace">
        <aside className="mcp-fill-explorer">
          <div className="mcp-fill-pane-title">
            <div><span>提案</span><small>{counts.active} 待处理</small></div>
          </div>
          <label className="mcp-fill-queue-search">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提案" aria-label="搜索提案" />
          </label>
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
                  <span className="mcp-fill-proposal-copy">
                    <strong>{itemManifest.target?.displayName || itemManifest.target?.id || proposal.summary}</strong>
                    <small>{DOMAIN_LABELS[proposal.domain]} · {STATUS_LABELS[proposal.lifecycleStatus]} · {displayTime(proposal.updatedAt)}</small>
                  </span>
                  <i className={`mcp-fill-status-dot is-${proposal.lifecycleStatus}`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="mcp-fill-diff-pane">
          <div className="mcp-fill-pane-title">
            <div><span>处理结果</span><small>{selected ? STATUS_LABELS[selected.lifecycleStatus] : '未选择'}</small></div>
          </div>
          {!selected ? <div className="mcp-fill-center-empty"><strong>选择一份提案</strong><span>查看整理后的产品结果，再确认或拒绝。</span></div> : (
            <>
              <div className="mcp-fill-result-scroll">
                {renderResultPreview(selected.domain, manifest.normalizedDraft ?? selected.normalized)}
              </div>
              <footer className="mcp-fill-actionbar">
                <div>
                  <strong className={manifest.validation?.valid ? 'is-safe' : 'is-warning'}>
                    {manifest.validation?.valid ? '内容检查通过' : `${errorCount} 个错误 · ${warningCount} 个警告`}
                  </strong>
                  <span>{selected.staleBase ? '资料已经变化，请重新生成提案' : '确认时会再次检查资料版本'}</span>
                </div>
                <div className="mcp-fill-actions">
                  <button type="button" className="is-reject" onClick={() => setDialog('reject')} disabled={Boolean(busy) || !canReview}>拒绝</button>
                  <button type="button" className="is-confirm" onClick={() => setDialog('confirm')} disabled={Boolean(busy) || !canReview}>确认并写入</button>
                </div>
              </footer>
            </>
          )}
        </section>

      </div>

      {selected && dialog && modalCopy ? (
        <div className="mcp-fill-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
          <section className="mcp-fill-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-fill-dialog-title">
            <span className={`mcp-fill-dialog-eyebrow is-${dialog}`}>{modalCopy.eyebrow}</span>
            <h2 id="mcp-fill-dialog-title">{modalCopy.title}</h2>
            <p>{modalCopy.body}</p>
            <dl>
              <div><dt>领域</dt><dd>{DOMAIN_LABELS[selected.domain]}</dd></div>
              <div><dt>处理结果</dt><dd>已整理</dd></div>
              <div><dt>提案版本</dt><dd>r{selected.revision}</dd></div>
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
