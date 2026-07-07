import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';
import { isMainWorkbenchMutatingPrompt } from './goalModel';

export type MainWorkbenchCommandEvidence = {
  id?: string;
  source?: string;
  createdAt?: number;
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
  if (/撤|移除|删除|去掉|remove|delete|drop|undo/i.test(prompt)) {
    return ['removeSkillButton', 'removeBuff', 'restoreTimelineSnapshot'];
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

export function verifyMainWorkbenchTurn(input: {
  prompt: string;
  evidence: MainWorkbenchCommandEvidence[];
}): MainWorkbenchTurnVerification {
  if (!isMainWorkbenchMutatingPrompt(input.prompt)) return { ok: true };

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
