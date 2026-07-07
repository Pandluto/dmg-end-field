function countRiskFlags(riskFlags, severity) {
  return (Array.isArray(riskFlags) ? riskFlags : []).filter((risk) => risk?.severity === severity).length;
}

function countDiffChanges(diff) {
  const summary = diff?.summary || {};
  return [
    summary.addedButtonCount,
    summary.removedButtonCount,
    summary.changedButtonCount,
    summary.addedBuffCount,
    summary.removedBuffCount,
    diff?.selectedCharactersChanged ? 1 : 0,
  ].reduce((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0);
}

function formatChangeReason(diff) {
  const summary = diff?.summary || {};
  const parts = [];
  if (summary.addedButtonCount) parts.push(`新增技能按钮 ${summary.addedButtonCount} 个`);
  if (summary.removedButtonCount) parts.push(`删除技能按钮 ${summary.removedButtonCount} 个`);
  if (summary.changedButtonCount) parts.push(`修改技能按钮 ${summary.changedButtonCount} 个`);
  if (summary.addedBuffCount) parts.push(`新增 Buff ${summary.addedBuffCount} 个`);
  if (summary.removedBuffCount) parts.push(`删除 Buff ${summary.removedBuffCount} 个`);
  if (diff?.selectedCharactersChanged) parts.push('出战干员变化');
  return parts.length ? parts.join('，') : 'base 与 working 没有结构化差异';
}

export function buildAiTimelineCheckoutDecision(input = {}) {
  const approvalPolicy = ['auto-low-risk', 'ask-on-risk', 'manual'].includes(input.approvalPolicy)
    ? input.approvalPolicy
    : 'auto-low-risk';
  const riskFlags = Array.isArray(input.riskFlags) ? input.riskFlags : [];
  const blockerCount = countRiskFlags(riskFlags, 'blocker');
  const warningCount = countRiskFlags(riskFlags, 'warning');
  const infoCount = countRiskFlags(riskFlags, 'info');
  const changeCount = countDiffChanges(input.diff);
  const reasons = [
    `approvalPolicy=${approvalPolicy}`,
    `riskFlags: blocker=${blockerCount}, warning=${warningCount}, info=${infoCount}`,
    formatChangeReason(input.diff),
  ];

  if (blockerCount > 0) {
    return {
      status: 'blocked',
      approvalMode: 'manual',
      canAutoApprove: false,
      requiresManualApproval: true,
      blockerCount,
      warningCount,
      rationale: `存在 ${blockerCount} 个 blocker 风险，AI 不应自动 checkout；需要明确 manual approval 后才能继续。`,
      reasons,
    };
  }

  if (approvalPolicy === 'manual') {
    return {
      status: 'needs-manual-approval',
      approvalMode: 'manual',
      canAutoApprove: false,
      requiresManualApproval: true,
      blockerCount,
      warningCount,
      rationale: '该 work node 的 approvalPolicy=manual，需要用户或受信任入口显式批准后 checkout。',
      reasons,
    };
  }

  if (approvalPolicy === 'ask-on-risk' && warningCount > 0) {
    return {
      status: 'needs-manual-approval',
      approvalMode: 'manual',
      canAutoApprove: false,
      requiresManualApproval: true,
      blockerCount,
      warningCount,
      rationale: `approvalPolicy=ask-on-risk 且存在 ${warningCount} 个 warning，建议人工确认后 checkout。`,
      reasons,
    };
  }

  return {
    status: 'auto',
    approvalMode: 'auto',
    canAutoApprove: true,
    requiresManualApproval: false,
    blockerCount,
    warningCount,
    rationale: changeCount > 0
      ? `未发现 blocker，策略允许自动通过；本次 working 相比 base 有 ${changeCount} 项结构化变化。`
      : '未发现 blocker，策略允许自动通过；working 与 base 暂无结构化变化。',
    reasons,
  };
}
