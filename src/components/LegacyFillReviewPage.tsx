import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  claimLegacyFillReview,
  decideLegacyFillReview,
  listLegacyFillReviewProposals,
  saveLegacyFillReview,
  type LegacyFillReviewProposal,
} from '../legacyFillHost/runtime';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import './LegacyFillReviewPage.css';

type ReviewManifest = {
  manifestVersion?: number;
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

export function isLegacyFillReviewPath(pathname: string) {
  return pathname === APP_ROUTE_PATHS.legacyFillReview;
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function LegacyFillReviewPage() {
  const [proposals, setProposals] = useState<LegacyFillReviewProposal[]>([]);
  const [selected, setSelected] = useState<LegacyFillReviewProposal | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const manifest = (selected?.review || {}) as ReviewManifest;

  const refresh = useCallback(async () => {
    try {
      const values = await listLegacyFillReviewProposals();
      setProposals(values);
      setSelected((current) => current ? values.find((value) => value.proposalId === current.proposalId) || current : current);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const reviewable = useMemo(() => selected && ['pending', 'claimed', 'approved'].includes(selected.lifecycleStatus), [selected]);

  const claim = async (proposal: LegacyFillReviewProposal) => {
    setBusy('claim');
    try {
      const result = await claimLegacyFillReview(proposal);
      setSelected(result.proposal);
      setMessage('已在产品 Host 中锁定本次审查。确认内容后可批准或拒绝。');
      await refresh();
      setSelected(result.proposal);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const decide = async (event: ReactMouseEvent<HTMLButtonElement>, decision: 'approved' | 'rejected') => {
    if (!selected) return;
    setBusy(decision);
    try {
      const actionToken = event.currentTarget.dataset.legacyFillActionToken || '';
      const proposal = await decideLegacyFillReview(event.nativeEvent, actionToken, selected.proposalId, decision);
      setSelected(proposal);
      setMessage(decision === 'approved' ? '审核已批准。请再次检查 digest 后单独点击“保存到产品库”。' : '已拒绝；产品库没有变化。');
      await refresh();
      setSelected(proposal);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  const save = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!selected) return;
    setBusy('save');
    try {
      const actionToken = event.currentTarget.dataset.legacyFillActionToken || '';
      const result = await saveLegacyFillReview(event.nativeEvent, actionToken, selected.proposalId);
      setSelected(result.proposal);
      setMessage(result.ok ? '保存成功：Host 已重读目标、验证 postcondition 并发布新 revision。' : result.code === 'proposal-base-stale' ? '当前产品库 revision 已变化，保存被拒绝。请重新生成或 rebase proposal。' : `保存失败：${result.code}`);
      await refresh();
      setSelected(result.proposal);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(''); }
  };

  return (
    <main className="legacy-fill-review-page">
      <header className="legacy-fill-review-header">
        <div>
          <p className="legacy-fill-review-eyebrow">Electron Host authority</p>
          <h1>填表 Proposal 审查</h1>
          <p>MCP 只能创建 proposal。批准、拒绝与最终保存只发生在此产品页面。</p>
        </div>
        <div className="legacy-fill-review-header-actions">
          <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)}>刷新</button>
          <button type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>返回主界面</button>
        </div>
      </header>

      {message ? <div className="legacy-fill-review-message" role="status">{message}</div> : null}

      <div className="legacy-fill-review-layout">
        <aside className="legacy-fill-review-list" aria-label="Legacy Fill proposals">
          <h2>Proposal</h2>
          {proposals.length === 0 ? <p className="legacy-fill-review-empty">暂无 proposal。</p> : proposals.map((proposal) => (
            <button
              key={proposal.proposalId}
              type="button"
              className={selected?.proposalId === proposal.proposalId ? 'is-active' : ''}
              onClick={() => setSelected(proposal)}
            >
              <span>{proposal.domain} · {proposal.summary}</span>
              <small>{proposal.lifecycleStatus} · r{proposal.revision}</small>
            </button>
          ))}
        </aside>

        <section className="legacy-fill-review-detail">
          {!selected ? <div className="legacy-fill-review-placeholder">从左侧选择 proposal 查看完整 manifest。</div> : (
            <>
              <div className="legacy-fill-review-title-row">
                <div>
                  <p>{selected.domain.toUpperCase()} · {selected.ownerNamespace}</p>
                  <h2>{manifest.target?.displayName || manifest.target?.id || selected.summary}</h2>
                </div>
                <div className="legacy-fill-review-badges">
                  <span>review: {manifest.review?.status || selected.approvalStatus}</span>
                  <span>persistence: {manifest.persistence?.status || selected.saveStatus}</span>
                  <span>proposal r{selected.revision}</span>
                </div>
              </div>

              <section className="legacy-fill-review-card identity-card">
                <h3>绑定身份</h3>
                <dl>
                  <div><dt>Target</dt><dd>{manifest.target?.id || '—'} {manifest.target?.existsInBase ? '(replace)' : '(add)'}</dd></div>
                  <div><dt>Base revision</dt><dd>{manifest.baseSnapshot?.revision ?? selected.baseRevision}</dd></div>
                  <div><dt>Snapshot</dt><dd>{manifest.baseSnapshot?.snapshotId || '—'}</dd></div>
                  <div><dt>Content hash</dt><dd>{manifest.baseSnapshot?.contentHash || selected.baseContentHash}</dd></div>
                  <div><dt>Manifest digest</dt><dd>{selected.manifestDigest}</dd></div>
                </dl>
              </section>

              <section className="legacy-fill-review-card">
                <h3>Requested writes</h3>
                <pre>{json(manifest.requestedWrites || [])}</pre>
              </section>

              <section className="legacy-fill-review-card">
                <h3>逐字段 Diff ({manifest.diff?.length || 0})</h3>
                <div className="legacy-fill-review-diff">
                  {(manifest.diff || []).map((entry, index) => (
                    <article key={`${entry.path}-${index}`}>
                      <strong>{entry.kind} · {entry.path}</strong>
                      {Object.prototype.hasOwnProperty.call(entry, 'before') ? <pre className="before">before: {json(entry.before)}</pre> : null}
                      {Object.prototype.hasOwnProperty.call(entry, 'after') ? <pre className="after">after: {json(entry.after)}</pre> : null}
                    </article>
                  ))}
                </div>
              </section>

              <section className="legacy-fill-review-card two-column">
                <div>
                  <h3>Validation / warnings</h3>
                  <p>valid: {String(manifest.validation?.valid)} · digest: {manifest.validation?.digest}</p>
                  <pre>{json({ errors: manifest.validation?.errors || [], warnings: manifest.validation?.warnings || [] })}</pre>
                </div>
                <div>
                  <h3>Evidence</h3>
                  <pre>{json(manifest.evidence || [])}</pre>
                </div>
              </section>

              <section className="legacy-fill-review-card">
                <h3>Normalized draft</h3>
                <pre>{json(manifest.normalizedDraft ?? selected.normalized)}</pre>
              </section>

              <footer className="legacy-fill-review-actions">
                <button type="button" onClick={() => void claim(selected)} disabled={Boolean(busy) || !reviewable}>加载并锁定审查</button>
                <button type="button" className="approve" data-legacy-fill-user-action="approve" onClick={(event) => void decide(event, 'approved')} disabled={Boolean(busy) || selected.approvalStatus === 'Yes'}>批准</button>
                <button type="button" className="reject" data-legacy-fill-user-action="reject" onClick={(event) => void decide(event, 'rejected')} disabled={Boolean(busy) || selected.approvalStatus === 'No'}>拒绝</button>
                <button type="button" className="save" data-legacy-fill-user-action="save" onClick={(event) => void save(event)} disabled={Boolean(busy) || selected.approvalStatus !== 'Yes' || selected.saveStatus === 'Yes' || selected.lifecycleStatus === 'stale'}>保存到产品库</button>
              </footer>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
