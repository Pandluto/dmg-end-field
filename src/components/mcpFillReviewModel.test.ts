import assert from 'node:assert/strict';
import {
  canConfirmProposal,
  displayDiffPath,
  filterReviewProposals,
  formatReviewValue,
  proposalChangeSummary,
  proposalValidation,
  selectVisibleProposal,
} from './mcpFillReviewModel.ts';
import type { LegacyFillReviewProposal, McpFillRuntimeState } from '../legacyFillHost/runtime.ts';

function proposal(input: Partial<LegacyFillReviewProposal> = {}): LegacyFillReviewProposal {
  return {
    proposalId: 'proposal-1',
    ownerNamespace: 'codex:test',
    domain: 'buff',
    revision: 1,
    manifestDigest: 'sha256:manifest',
    normalized: { id: 'buff-1', name: '测试 Buff' },
    baseRevision: 1,
    baseContentHash: 'sha256:base',
    summary: '更新测试 Buff',
    lifecycleStatus: 'pending',
    approvalStatus: 'Wait',
    saveStatus: 'Wait',
    staleBase: false,
    staleReason: '',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    review: {
      target: { id: 'buff-1', displayName: '测试 Buff', existsInBase: true },
      validation: { valid: true, errors: [], warnings: [{ code: 'note', message: '检查描述' }] },
      diff: [{ path: '/items/item-1/effects/effect-1/value', kind: 'replace', before: 0.1, after: 0.2 }],
    },
    ...input,
  };
}

const readyRuntime = { running: true, ready: true } as McpFillRuntimeState;
const pending = proposal();
const rejected = proposal({ proposalId: 'proposal-2', lifecycleStatus: 'rejected', updatedAt: '2026-08-05T00:00:00.000Z' });

assert.deepEqual(filterReviewProposals([rejected, pending], 'active', '').map((item) => item.proposalId), ['proposal-1']);
assert.deepEqual(filterReviewProposals([rejected, pending], 'all', '测试 buff').map((item) => item.proposalId), ['proposal-1', 'proposal-2']);
assert.equal(selectVisibleProposal(rejected, [pending]), pending);
assert.equal(proposalValidation(pending).warnings[0].message, '检查描述');
assert.equal(canConfirmProposal(pending, readyRuntime), true);
assert.equal(canConfirmProposal(proposal({ staleBase: true }), readyRuntime), false);
assert.equal(canConfirmProposal(proposal({ review: { validation: { valid: false, errors: ['字段错误'] } } }), readyRuntime), false);
assert.equal(canConfirmProposal(pending, { running: true, ready: false } as McpFillRuntimeState), false);
assert.equal(displayDiffPath('/items/item-1/effects/effect-1/value'), '条目 / item-1 / 效果 / effect-1 / 数值');
assert.equal(formatReviewValue(false), '否');
assert.equal(proposalChangeSummary(pending).counts.replace, 1);

console.log('MCP Fill review model contract: PASS');
