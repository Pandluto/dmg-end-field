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
type ReviewDiffEntry = { path?: string; kind?: string; before?: unknown; after?: unknown };

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

const FIELD_LABELS: Record<string, string> = {
  id: '资料 ID',
  name: '名称',
  description: '说明',
  rarity: '稀有度',
  imgUrl: '图片',
  skills: '技能',
  effects: '效果',
  levels: '等级数据',
  attackGrowth: '攻击成长',
  statType: '属性类型',
  gearSets: '装备套装',
  items: '条目',
  value: '数值',
  condition: '生效条件',
  type: '武器类型',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fieldLabel(value: string) {
  const key = value.replace(/^\/+/, '').split('/').filter(Boolean).at(-1) || '全部内容';
  return FIELD_LABELS[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function changeLabel(kind: string | undefined) {
  if (kind === 'add') return '新增';
  if (kind === 'remove') return '删除';
  return '修改';
}

function compactValue(value: unknown, key = ''): string {
  if (value === undefined) return '无';
  if (value === null) return '未设置';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value || '未填写';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length ? `${value.length} 项` : '空列表';
  if (!isRecord(value)) return String(value);
  const keys = Object.keys(value);
  if (!keys.length) return '暂无内容';
  const name = typeof value.name === 'string' ? value.name : '';
  const counts = ['skills', 'effects', 'levels', 'items', 'gearSets']
    .map((childKey) => isRecord(value[childKey]) ? `${Object.keys(value[childKey]).length} 个${FIELD_LABELS[childKey] || childKey}` : '')
    .filter(Boolean);
  if (name) return [name, ...counts].join(' · ');
  return `${keys.length} 项${FIELD_LABELS[key] ? ` ${FIELD_LABELS[key]}` : '内容'}`;
}

function splitReadableDiff(entries: ReviewDiffEntry[]) {
  return entries.flatMap((entry) => {
    if ((entry.path || '/') !== '/' || (!isRecord(entry.before) && !isRecord(entry.after))) return [entry];
    const before = isRecord(entry.before) ? entry.before : {};
    const after = isRecord(entry.after) ? entry.after : {};
    return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => ({
        path: `/${key}`,
        kind: !(key in before) ? 'add' : !(key in after) ? 'remove' : 'replace',
        before: before[key],
        after: after[key],
      }));
  });
}

function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (!isRecord(value) && !Array.isArray(value)) {
    return <span className={`mcp-fill-readable-value ${value === undefined || value === null ? 'is-empty' : ''}`}>{compactValue(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="mcp-fill-readable-value is-empty">空列表</span>;
    return <div className="mcp-fill-value-chips">{value.slice(0, 8).map((item, index) => <span key={index}>{compactValue(item)}</span>)}</div>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span className="mcp-fill-readable-value is-empty">暂无内容</span>;
  return (
    <div className={`mcp-fill-structured-value is-depth-${Math.min(depth, 2)}`}>
      {entries.slice(0, depth === 0 ? 10 : 6).map(([key, child]) => {
        const nested = isRecord(child) || Array.isArray(child);
        return (
          <div className="mcp-fill-structured-row" key={key}>
            <span>{fieldLabel(key)}</span>
            {nested && depth < 2 ? (
              <details>
                <summary>{compactValue(child, key)}</summary>
                <StructuredValue value={child} depth={depth + 1} />
              </details>
            ) : <strong>{compactValue(child, key)}</strong>}
          </div>
        );
      })}
      {entries.length > (depth === 0 ? 10 : 6) ? <small>另有 {entries.length - (depth === 0 ? 10 : 6)} 项</small> : null}
    </div>
  );
}

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
  const readableDiff = useMemo(() => splitReadableDiff(diff), [diff]);
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
            <div><span>内容变化</span><small>{selected ? `${readableDiff.length} 个字段` : '未选择'}</small></div>
          </div>
          {!selected ? <div className="mcp-fill-center-empty"><strong>选择一份提案</strong><span>查看 Codex 生成的结构化变更，并由产品 Host 确认或拒绝。</span></div> : (
            <>
              <div className="mcp-fill-document-header">
                <div>
                  <span>{DOMAIN_LABELS[selected.domain]} · Codex 提案</span>
                  <h2>{manifest.target?.displayName || manifest.target?.id || selected.summary}</h2>
                  <p>{selected.summary}</p>
                </div>
                <div className={`mcp-fill-status-badge is-${selected.lifecycleStatus}`}>
                  {STATUS_LABELS[selected.lifecycleStatus]}
                </div>
              </div>
              <div className="mcp-fill-diff-table-wrap">
                {readableDiff.length === 0 ? <div className="mcp-fill-center-empty"><strong>没有内容变化</strong><span>这份提案与当前资料一致。</span></div> : (
                  <table className="mcp-fill-diff-table">
                    <thead><tr><th>变化字段</th><th>现在的内容</th><th>准备写入</th></tr></thead>
                    <tbody>
                      {readableDiff.map((entry, index) => (
                        <tr key={`${entry.path}-${index}`}>
                          <td>
                            <span className={`mcp-fill-change-kind is-${entry.kind || 'replace'}`}>{changeLabel(entry.kind)}</span>
                            <strong title={entry.path || '/'}>{fieldLabel(entry.path || '/')}</strong>
                          </td>
                          <td><StructuredValue value={entry.before} /></td>
                          <td><StructuredValue value={entry.after} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <footer className="mcp-fill-actionbar">
                <div>
                  <span>写入保护</span>
                  <strong className="mcp-fill-safe-copy">版本与内容已绑定</strong>
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
          <div className="mcp-fill-pane-title"><div><span>审查详情</span><small>写入前确认</small></div></div>
          {!selected ? <div className="mcp-fill-empty">选择提案后显示校验、证据与写入边界。</div> : (
            <div className="mcp-fill-inspector-scroll">
              <section className="mcp-fill-inspector-section">
                <h3>处理状态</h3>
                <dl className="mcp-fill-property-grid">
                  <div><dt>当前状态</dt><dd>{STATUS_LABELS[selected.lifecycleStatus]}</dd></div>
                  <div><dt>写入结果</dt><dd>{selected.saveStatus === 'Yes' ? '已写入' : selected.saveStatus === 'No' ? '未写入' : '等待确认'}</dd></div>
                  <div><dt>提案版本</dt><dd>r{selected.revision}</dd></div>
                  <div><dt>内容格式</dt><dd>v{manifest.schemaVersion || 1}</dd></div>
                </dl>
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>内容检查</h3>
                <div className={`mcp-fill-validation ${manifest.validation?.valid ? 'is-valid' : 'is-invalid'}`}>
                  <strong>{manifest.validation?.valid ? '内容格式正确' : '内容需要修正'}</strong>
                  <span>{errors.length} 个错误 · {warnings.length} 个警告</span>
                </div>
                {errors.map((error, index) => <p className="mcp-fill-issue is-error" key={`error-${index}`}>{displayValue(error)}</p>)}
                {warnings.map((warning, index) => <p className="mcp-fill-issue is-warning" key={`warning-${index}`}>{displayValue(warning)}</p>)}
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>将写到哪里</h3>
                {(manifest.requestedWrites || []).length === 0 ? <p className="mcp-fill-muted">未声明写入目标</p> : (manifest.requestedWrites || []).map((write, index) => (
                  <div className="mcp-fill-write-target" key={`${write.storageDomain}-${write.targetId}-${index}`}>
                    <strong>{DOMAIN_LABELS[selected.domain]}资料库</strong><span>{write.targetId || manifest.target?.id}</span>
                  </div>
                ))}
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>提案依据</h3>
                {(manifest.evidence || []).length === 0 ? <p className="mcp-fill-muted">没有附加证据</p> : (manifest.evidence || []).map((item, index) => (
                  <article className="mcp-fill-evidence" key={`${item.label}-${index}`}>
                    <strong>{item.label || `证据 ${index + 1}`}</strong>
                    <p>{item.text || '—'}</p>
                    {item.source ? <small>{item.source}</small> : null}
                  </article>
                ))}
              </section>

              <section className="mcp-fill-inspector-section">
                <h3>写入安全检查</h3>
                <div className={`mcp-fill-safety-card ${selected.staleBase ? 'is-stale' : 'is-safe'}`}>
                  <strong>{selected.staleBase ? '资料已经变化，不能直接写入' : '资料版本一致，可以安全处理'}</strong>
                  <span>提案基于资料版本 r{manifest.baseSnapshot?.revision ?? selected.baseRevision}；真正写入前还会再检查一次。</span>
                </div>
                <details className="mcp-fill-technical-details">
                  <summary>查看技术校验信息</summary>
                  <dl className="mcp-fill-identity-list">
                    <div><dt>写入对象</dt><dd>{manifest.target?.id || '—'}</dd></div>
                    <div><dt>基础快照</dt><dd title={manifest.baseSnapshot?.snapshotId}>{shortIdentity(manifest.baseSnapshot?.snapshotId)}</dd></div>
                    <div><dt>内容指纹</dt><dd title={manifest.baseSnapshot?.contentHash || selected.baseContentHash}>{shortIdentity(manifest.baseSnapshot?.contentHash || selected.baseContentHash)}</dd></div>
                    <div><dt>提案校验码</dt><dd title={selected.manifestDigest}>{shortIdentity(selected.manifestDigest)}</dd></div>
                  </dl>
                </details>
              </section>

              <section className="mcp-fill-inspector-section mcp-fill-normalized">
                <h3>整理后的提案内容</h3>
                <p className="mcp-fill-muted">这是系统准备写入的内容摘要，可展开分组查看。</p>
                <StructuredValue value={manifest.normalizedDraft ?? selected.normalized} />
              </section>
            </div>
          )}
        </aside>
      </div>

      <footer className="mcp-fill-statusbar">
        <span>本页面是 Web 产品页，不是 MCP 协议界面</span>
        <span>Codex 只能读取、校验并创建提案</span>
        <span>{runtime?.running ? '本地服务已连接' : '本地服务未连接'}</span>
      </footer>

      {selected && dialog && modalCopy ? (
        <div className="mcp-fill-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
          <section className="mcp-fill-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-fill-dialog-title">
            <span className={`mcp-fill-dialog-eyebrow is-${dialog}`}>{modalCopy.eyebrow}</span>
            <h2 id="mcp-fill-dialog-title">{modalCopy.title}</h2>
            <p>{modalCopy.body}</p>
            <dl>
              <div><dt>领域</dt><dd>{DOMAIN_LABELS[selected.domain]}</dd></div>
              <div><dt>字段变化</dt><dd>{readableDiff.length}</dd></div>
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
