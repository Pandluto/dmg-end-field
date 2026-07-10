import type { MainWorkbenchSnapshot } from '../../utils/mainWorkbenchControl';

export type MainWorkbenchGoalKind =
  | 'buffSummary'
  | 'buffDetail'
  | 'equipmentSummary'
  | 'buttonSummary'
  | 'topDamage'
  | 'damageSummary'
  | 'selectionSummary'
  | 'unknown';

export type MainWorkbenchGoal = {
  kind: MainWorkbenchGoalKind;
  prompt: string;
  characterNames: string[];
  mutating: boolean;
};

function hasTimelineMoveAction(text: string) {
  return /\u79fb\u52a8|\u524d\u79fb|\u540e\u79fb|\u5f80\u524d\u79fb|\u5f80\u540e\u79fb|\u6316\u4e00\u683c|move/i.test(text);
}

function hasWorkbenchMutationAction(text: string) {
  return /(给|帮|设置|穿上|换|选择|选上|去掉|移除|删除|增加|添加|释放|计算|保存|恢复|回退|清空|重算|改|配|放|撤|扩到|保留|再加|set|equip|wear|switch|select|remove|delete|drop|add|cast|use|calculate|save|restore|rollback|clear|recalculate|change|configure|expand|keep)/i.test(text);
}

function hasBuffMutationAction(text: string) {
  return /(加Buff|加 buff|添加.*Buff|添加.*buff|移除.*Buff|移除.*buff|删除.*Buff|删除.*buff|去掉.*Buff|去掉.*buff|改.*Buff|改.*buff|add.*Buff|add.*buff|remove.*Buff|remove.*buff|delete.*Buff|delete.*buff|apply.*Buff|apply.*buff)/i.test(text);
}

export function isMainWorkbenchReadOnlyLikePrompt(text: string) {
  return /(当前|现在|目前|看一下|看看|有哪些|多少|状态|什么|查询|核对|确认|告诉我|current|now|status|what|which|how many|check|confirm)/i.test(text);
}

function hasExplicitMutationKeyword(text: string) {
  return /(设置|穿上|换|选择|选上|去掉|移除|删除|增加|添加|释放|计算|保存|恢复|回退|清空|重算|改|配|放|撤|扩到|再加|set|equip|wear|switch|select|remove|delete|drop|add|cast|use|calculate|save|restore|rollback|clear|recalculate|change|configure|expand)/i.test(text);
}

export function isMainWorkbenchMutatingPrompt(prompt: string | undefined) {
  const text = prompt || '';
  if (/不要改|不要变更|不需要改|do not change|don't change|no changes/i.test(text) &&
    !/(加|添加|移除|删除|设置|穿上|换|释放|计算|恢复|回退|清空|重算|add|remove|delete|set|equip|wear|switch|cast|calculate|restore|rollback|clear|recalculate)/i.test(text)) {
    return false;
  }
  if (isMainWorkbenchReadOnlyLikePrompt(text) && !hasExplicitMutationKeyword(text) && !hasBuffMutationAction(text) && !hasTimelineMoveAction(text)) {
    return false;
  }
  return hasWorkbenchMutationAction(text) || hasBuffMutationAction(text) || hasTimelineMoveAction(text);
}

export function shouldCreateMainWorkbenchRollback(prompt: string | undefined) {
  const text = prompt || '';
  if (!isMainWorkbenchMutatingPrompt(text)) return false;
  if (/回退点|可回退|保存快照|备份|restore point|rollback point|backup/i.test(text)) return true;
  if (/清空|恢复|回退|撤回|批量|全部|所有|四个人|4个人|队伍|替换.*和|换成|clear|restore|rollback|batch|all|team|squad|replace/i.test(text)) return true;
  if (/(每个|各|多个|同时).*(技能|按钮|Buff|buff|装备|武器)/i.test(text)) return true;
  return false;
}

export function isReadOnlyMainWorkbenchSnapshotPrompt(prompt: string) {
  const text = prompt.trim();
  if (!/(看一下|看看|当前|现在|目前|什么|哪些|多少|状态|穿的|穿了|装备|武器|按钮|伤害|current|now|status|summary|what|which|how many|gear|equipment|weapon|button|skill|damage|report)/i.test(text)) {
    return false;
  }
  return !isMainWorkbenchMutatingPrompt(text);
}

function inferMentionedCharacters(prompt: string, snapshot?: MainWorkbenchSnapshot | null) {
  if (!snapshot) return [];
  return snapshot.selectedCharacters
    .filter((character) => prompt.includes(character.name))
    .map((character) => character.name);
}

export function inferMainWorkbenchGoal(prompt: string | undefined, snapshot?: MainWorkbenchSnapshot | null): MainWorkbenchGoal {
  const text = prompt || '';
  const characterNames = inferMentionedCharacters(text, snapshot);
  const mutating = isMainWorkbenchMutatingPrompt(text);
  let kind: MainWorkbenchGoalKind = 'unknown';

  if (/buff|Buff|增益/.test(text)) {
    kind = /每个|逐个|按钮|详细|明细|全部|展开|detail|each|button|all/i.test(text) ? 'buffDetail' : 'buffSummary';
  } else if (/(最高|最大|最多|最强|top|highest|max)/i.test(text) && /伤害|damage|技能/.test(text)) {
    kind = 'topDamage';
  } else if (/穿|装备|武器|gear|equipment|weapon|equip|wear/i.test(text)) {
    kind = 'equipmentSummary';
  } else if (/按钮|技能|button|skill/i.test(text)) {
    kind = 'buttonSummary';
  } else if (/伤害|damage/i.test(text)) {
    kind = 'damageSummary';
  } else if (/(当前|现在|目前|状态|已选|队伍|干员|current|now|status|selected|team|squad)/i.test(text)) {
    kind = 'selectionSummary';
  }

  return { kind, prompt: text, characterNames, mutating };
}
