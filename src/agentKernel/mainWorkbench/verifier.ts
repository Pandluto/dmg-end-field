import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';
import { isMainWorkbenchMutatingPrompt } from './goalModel';

export type MainWorkbenchCommandEvidence = {
  id?: string;
  source?: string;
  createdAt?: number;
  batchId?: string;
  batchIndex?: number;
  batchSize?: number;
  status?: string;
  error?: string;
  command?: MainWorkbenchCommand;
  result?: unknown;
};

export type MainWorkbenchTurnVerification =
  | { ok: true }
  | { ok: false; status: 'error'; message: string };

function isSubstantiveWorkbenchCommand(command: MainWorkbenchCommand | undefined) {
  if (!command) return false;
  return command.op !== 'saveTimelineSnapshot' && command.op !== 'refreshSnapshot';
}

function getExpectedCommandOps(prompt: string): MainWorkbenchCommand['op'][] | null {
  if (/base|基线|原始|回到.*节点|恢复.*节点|回退.*节点|撤回.*节点|restore|rollback|undo/i.test(prompt)
    && /节点|node|工作节点|work\s*node/i.test(prompt)) {
    return ['restoreAiTimelineWorkNodeBase'];
  }
  if (/撤|移除|删除|去掉|remove|delete|drop|undo/i.test(prompt)) {
    return ['removeSkillButton', 'removeBuff', 'restoreTimelineSnapshot'];
  }
  if (/创建|新建|create|copy|复制|申请|工作节点|work\s*node/i.test(prompt) && /节点|node|副本|copy|复制|申请|work/i.test(prompt)) {
    return ['createAiTimelineWorkNodeFromCurrent'];
  }
  if (/diff|差异|对比|比较|变更|readiness|ready/i.test(prompt) && /节点|node|工作节点|work/i.test(prompt)) {
    return ['diffAiTimelineWorkNode'];
  }
  if (/patch|修改副本|修改.*节点|更新.*节点|工作节点.*改|work\s*node.*edit/i.test(prompt)) {
    return ['patchAiTimelineWorkNode'];
  }
  if (/checkout|apply|应用|套用|迁出|检出|工作节点|work\s*node/i.test(prompt)) {
    return ['checkoutAiTimelineWorkNode'];
  }
  if (/Buff|buff|增益|bonus/i.test(prompt) && /加|添加|add|attach|apply/i.test(prompt)) {
    return ['addBuff'];
  }
  if (/按钮|技能|button|skill/i.test(prompt) && /加|添加|释放|放|add|cast|use|place|create/i.test(prompt)) {
    return ['addSkillButton'];
  }
  if (/装备|武器|穿|配|gear|equipment|weapon|equip|wear|configure/i.test(prompt)) {
    return ['setOperatorWeapon', 'setOperatorEquipment'];
  }
  if (/计算|重算|伤害|calculate|recalculate|damage/i.test(prompt)) {
    return ['calculateDamage'];
  }
  return null;
}

function hasPromptRequiredCommand(prompt: string, evidence: MainWorkbenchCommandEvidence[]) {
  const commands = evidence
    .filter((item) => item.status === 'done')
    .map((item) => item.command)
    .filter(Boolean) as MainWorkbenchCommand[];
  if (!commands.some(isSubstantiveWorkbenchCommand)) return false;
  const expectedOps = getExpectedCommandOps(prompt);
  if (!expectedOps) return true;
  return commands.some((command) => expectedOps.includes(command.op));
}

function summarizeBatchEvidence(evidence: MainWorkbenchCommandEvidence[]) {
  const batches = new Map<string, MainWorkbenchCommandEvidence[]>();
  for (const item of evidence) {
    if (!item.batchId) continue;
    batches.set(item.batchId, [...(batches.get(item.batchId) || []), item]);
  }
  return [...batches.entries()].map(([batchId, commands]) => {
    const pending = commands.filter((command) => command.status === 'pending').length;
    const running = commands.filter((command) => command.status === 'running').length;
    const done = commands.filter((command) => command.status === 'done').length;
    const error = commands.filter((command) => command.status === 'error').length;
    const declaredSize = commands.find((command) => typeof command.batchSize === 'number')?.batchSize;
    return {
      batchId,
      total: declaredSize || commands.length,
      observed: commands.length,
      pending,
      running,
      done,
      error,
      failedCommand: commands.find((command) => command.status === 'error') || null,
      unsettledCommand: commands.find((command) => command.status === 'pending' || command.status === 'running') || null,
    };
  });
}

function formatBatchSummary(batch: ReturnType<typeof summarizeBatchEvidence>[number]) {
  return `批次 ${batch.batchId}：total=${batch.total}，observed=${batch.observed}，done=${batch.done}，error=${batch.error}，pending=${batch.pending}，running=${batch.running}`;
}

export function verifyMainWorkbenchTurn(input: {
  prompt: string;
  evidence: MainWorkbenchCommandEvidence[];
}): MainWorkbenchTurnVerification {
  if (!isMainWorkbenchMutatingPrompt(input.prompt)) return { ok: true };

  const batchSummaries = summarizeBatchEvidence(input.evidence);
  const failedBatch = batchSummaries.find((batch) => batch.error > 0);
  if (failedBatch) {
    return {
      ok: false,
      status: 'error',
      message: `${formatBatchSummary(failedBatch)}。失败命令：${failedBatch.failedCommand?.command?.op || failedBatch.failedCommand?.id || 'unknown'}；原因：${failedBatch.failedCommand?.error || '未知错误'}。`,
    };
  }

  const unsettledBatch = batchSummaries.find((batch) => batch.pending > 0 || batch.running > 0);
  if (unsettledBatch) {
    return {
      ok: false,
      status: 'error',
      message: `${formatBatchSummary(unsettledBatch)}。批量命令仍未全部完成，请稍后重试或读取批次摘要。`,
    };
  }

  const failedCommand = input.evidence.find((command) => command.status === 'error');
  if (failedCommand) {
    return {
      ok: false,
      status: 'error',
      message: `本轮命令执行失败：${failedCommand.error || failedCommand.id || '未知错误'}。`,
    };
  }

  const unsettledCommand = input.evidence.find((command) => command.status === 'pending' || command.status === 'running');
  if (unsettledCommand) {
    return {
      ok: false,
      status: 'error',
      message: `本轮命令仍未完成：${unsettledCommand.command?.op || unsettledCommand.id || 'unknown'}。请稍后重试或查看命令队列。`,
    };
  }

  if (!hasPromptRequiredCommand(input.prompt, input.evidence)) {
    const expectedOps = getExpectedCommandOps(input.prompt);
    const actualOps = [...new Set(input.evidence
      .map((item) => item.command?.op)
      .filter(Boolean) as MainWorkbenchCommand['op'][])]
      .join('、') || '无';
    const expectedText = expectedOps?.join('、') || '实质命令';
    return {
      ok: false,
      status: 'error',
      message: `本轮没有检测到符合请求的实际主界面命令，期望 ${expectedText}，实际 ${actualOps}。当前状态未按请求改动。请重试或拆成更小的一步。`,
    };
  }

  return { ok: true };
}
