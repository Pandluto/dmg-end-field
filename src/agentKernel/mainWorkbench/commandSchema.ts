import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';

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
  'checkoutAiTimelineWorkNode',
  'refreshOperatorConfig',
  'setOperatorWeapon',
  'setOperatorEquipment',
  'refreshSnapshot',
] as const satisfies readonly MainWorkbenchCommand['op'][];

const SUPPORTED_OP_SET = new Set<string>(MAIN_WORKBENCH_SUPPORTED_OPS);

export type MainWorkbenchCommandValidation =
  | { ok: true; command: MainWorkbenchCommand }
  | { ok: false; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasAnyString(value: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => typeof value[key] === 'string' && String(value[key]).trim().length > 0);
}

export function isMainWorkbenchCommandOp(op: unknown): op is MainWorkbenchCommand['op'] {
  return typeof op === 'string' && SUPPORTED_OP_SET.has(op);
}

export function validateMainWorkbenchCommand(command: unknown): MainWorkbenchCommandValidation {
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

  return { ok: true, command: command as MainWorkbenchCommand };
}

export function validateMainWorkbenchCommands(commands: unknown[]): MainWorkbenchCommandValidation {
  for (const command of commands) {
    const validation = validateMainWorkbenchCommand(command);
    if (!validation.ok) return validation;
  }
  return { ok: true, command: commands[0] as MainWorkbenchCommand };
}
