export const MAIN_WORKBENCH_SUPPORTED_OPS = [
  'selectCharacters',
  'openView',
  'clearTimeline',
  'openWorkbenchPage',
  'addSkillButton',
  'removeSkillButton',
  'addBuff',
  'removeBuff',
  'setTargetResistance',
  'calculateDamage',
  'saveTimelineSnapshot',
  'restoreTimelineSnapshot',
  'listTimelineSnapshots',
  'createAiTimelineWorkNodeFromCurrent',
  'diffAiTimelineWorkNode',
  'patchAiTimelineWorkNode',
  'checkoutAiTimelineWorkNode',
  'restoreAiTimelineWorkNodeBase',
  'refreshOperatorConfig',
  'setOperatorWeapon',
  'setOperatorEquipment',
  'refreshSnapshot',
];

const SUPPORTED_OP_SET = new Set(MAIN_WORKBENCH_SUPPORTED_OPS);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasAnyString(value, keys) {
  return keys.some((key) => typeof value?.[key] === 'string' && String(value[key]).trim().length > 0);
}

export function isMainWorkbenchCommandOp(op) {
  return typeof op === 'string' && SUPPORTED_OP_SET.has(op);
}

export function normalizeMainWorkbenchCommand(command) {
  if (!isRecord(command)) return command;
  if (command.op !== 'removeBuff') return command;
  if (typeof command.buffDisplayName === 'string' && command.buffDisplayName.trim() && typeof command.displayName !== 'string') {
    return {
      ...command,
      displayName: command.buffDisplayName.trim(),
    };
  }
  return command;
}

export function validateMainWorkbenchCommand(command) {
  if (!isRecord(command)) {
    return { ok: false, code: 'invalid-main-workbench-command', message: 'Command must be an object.' };
  }
  if (!isMainWorkbenchCommandOp(command.op)) {
    return {
      ok: false,
      code: 'invalid-main-workbench-command-op',
      message: `Unsupported main workbench command op: ${String(command.op || 'unknown')}.`,
    };
  }

  if (command.op === 'addBuff' && !isRecord(command.buff)) {
    return { ok: false, code: 'invalid-main-workbench-add-buff', message: 'addBuff requires buff.' };
  }
  if (command.op === 'removeBuff' && !hasAnyString(command, ['buffId', 'displayName', 'name', 'buffDisplayName']) && command.all !== true) {
    return {
      ok: false,
      code: 'invalid-main-workbench-remove-buff',
      message: 'removeBuff requires buffId/displayName/name/buffDisplayName, or all:true.',
    };
  }
  if (command.op === 'setTargetResistance' && (!hasAnyString(command, ['buttonId']) || !isRecord(command.targetResistance))) {
    return {
      ok: false,
      code: 'invalid-main-workbench-target-resistance',
      message: 'setTargetResistance requires buttonId and targetResistance.',
    };
  }
  if (command.op === 'setOperatorWeapon' && !hasAnyString(command, ['weaponName'])) {
    return {
      ok: false,
      code: 'invalid-main-workbench-operator-weapon',
      message: 'setOperatorWeapon requires weaponName.',
    };
  }
  if (command.op === 'setOperatorEquipment') {
    const hasDirectEquipment = hasAnyString(command, ['equipmentId', 'equipmentName', 'gearSetId', 'gearSetName']);
    const hasEquipmentList = Array.isArray(command.equipments) && command.equipments.length > 0;
    if (!hasDirectEquipment && !hasEquipmentList) {
      return {
        ok: false,
        code: 'invalid-main-workbench-operator-equipment',
        message: 'setOperatorEquipment requires equipment, gear set, or equipments.',
      };
    }
  }
  if (command.op === 'checkoutAiTimelineWorkNode' && !hasAnyString(command, ['nodeId'])) {
    return {
      ok: false,
      code: 'invalid-main-workbench-checkout-worknode',
      message: 'checkoutAiTimelineWorkNode requires nodeId.',
    };
  }
  if (command.op === 'restoreAiTimelineWorkNodeBase' && !hasAnyString(command, ['nodeId'])) {
    return {
      ok: false,
      code: 'invalid-main-workbench-restore-worknode-base',
      message: 'restoreAiTimelineWorkNodeBase requires nodeId.',
    };
  }
  if (command.op === 'diffAiTimelineWorkNode' && !hasAnyString(command, ['nodeId'])) {
    return {
      ok: false,
      code: 'invalid-main-workbench-diff-worknode',
      message: 'diffAiTimelineWorkNode requires nodeId.',
    };
  }
  if (command.op === 'patchAiTimelineWorkNode') {
    if (!hasAnyString(command, ['nodeId'])) {
      return {
        ok: false,
        code: 'invalid-main-workbench-patch-worknode',
        message: 'patchAiTimelineWorkNode requires nodeId.',
      };
    }
    if (!Array.isArray(command.patch) || command.patch.length === 0) {
      return {
        ok: false,
        code: 'invalid-main-workbench-patch-worknode',
        message: 'patchAiTimelineWorkNode requires non-empty patch array.',
      };
    }
  }

  return { ok: true, command: normalizeMainWorkbenchCommand(command) };
}

export function validateMainWorkbenchCommands(commands) {
  if (!Array.isArray(commands)) {
    return { ok: false, code: 'invalid-main-workbench-command-list', message: 'Commands must be an array.' };
  }
  for (const command of commands) {
    const validation = validateMainWorkbenchCommand(command);
    if (!validation.ok) return validation;
  }
  return { ok: true, command: normalizeMainWorkbenchCommand(commands[0]) };
}
