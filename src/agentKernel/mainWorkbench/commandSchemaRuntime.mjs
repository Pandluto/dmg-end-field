export const MAIN_WORKBENCH_SUPPORTED_OPS = [
  'selectCharacters',
  'openView',
  'clearTimeline',
  'openWorkbenchPage',
  'addSkillButton',
  'removeSkillButton',
  'addBuff',
  'addBuffToButtons',
  'removeBuff',
  'setTargetResistance',
  'calculateDamage',
  'saveTimelineSnapshot',
  'restoreTimelineSnapshot',
  'listTimelineSnapshots',
  'createAiTimelineWorkNodeFromCurrent',
  'diffAiTimelineWorkNode',
  'patchAiTimelineWorkNode',
  'patchAndValidateAiTimelineWorkNode',
  'checkoutAiTimelineWorkNode',
  'restoreAiTimelineWorkNodeBase',
  'refreshOperatorConfig',
  'setOperatorWeapon',
  'setOperatorEquipment',
  'setOperatorConfig',
  'previewOperatorConfig',
  'applyPreparedOperatorConfig',
  'finalizePreparedOperatorConfig',
  'restoreAtomicTeamParent',
  'refreshSnapshot',
];

const SUPPORTED_OP_SET = new Set(MAIN_WORKBENCH_SUPPORTED_OPS);
const SUPPORTED_WORKBENCH_PAGES = new Set([
  'home',
  'selection',
  'canvas',
  'operatorConfig',
  'weaponSheet',
  'equipmentSheet',
  'damageSheet',
  'damageReportPpt',
]);

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
  if (command.op === 'addSkillButton') {
    const legacyGroupIndex = Number(command.lineIndex);
    if (command.staffIndex === undefined && Number.isInteger(legacyGroupIndex)) {
      const { lineIndex: _legacyLineIndex, ...rest } = command;
      void _legacyLineIndex;
      return { ...rest, staffIndex: legacyGroupIndex };
    }
    return command;
  }
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

  if (command.op === 'openWorkbenchPage' && !SUPPORTED_WORKBENCH_PAGES.has(command.page)) {
    return {
      ok: false,
      code: 'invalid-main-workbench-page',
      message: `Unsupported main workbench page: ${String(command.page || 'unknown')}.`,
    };
  }

  if (command.op === 'selectCharacters') {
    const requested = [
      ...(Array.isArray(command.characterIds) ? command.characterIds : []),
      ...(Array.isArray(command.characterNames) ? command.characterNames : []),
    ].filter((value) => typeof value === 'string' && value.trim());
    if (requested.length === 0 || requested.length > 4) {
      return { ok: false, code: 'invalid-main-workbench-selection', message: 'selectCharacters requires one to four exact character ids or names.' };
    }
    if (!hasAnyString(command, ['nodeTitle', 'nodeDescription'])
      || typeof command.nodeTitle !== 'string' || typeof command.nodeDescription !== 'string'
      || command.nodeTitle.trim().length < 2 || command.nodeDescription.trim().length < 8
      || /^\[ai\]/i.test(command.nodeTitle.trim())) {
      return { ok: false, code: 'invalid-main-workbench-selection-metadata', message: 'AI selectCharacters requires an Agent-written nodeTitle and nodeDescription without an [ai] prefix.' };
    }
    if (command.approval?.mode !== 'manual' || command.approval?.approvedBy !== 'user') {
      return { ok: false, code: 'approval-capability-required', message: 'AI selectCharacters requires a native manual user approval.' };
    }
  }

  if (command.op === 'addBuff' && !isRecord(command.buff)) {
    return { ok: false, code: 'invalid-main-workbench-add-buff', message: 'addBuff requires buff.' };
  }
  if (command.op === 'addSkillButton' && command.nodeIndex !== undefined
    && (!Number.isInteger(command.nodeIndex) || command.nodeIndex < 0 || command.nodeIndex > 14)) {
    return {
      ok: false,
      code: 'invalid-main-workbench-node-index',
      message: 'addSkillButton nodeIndex must be an integer from 0 to 14 (user-facing position 1 to 15).',
    };
  }
  if (command.op === 'addSkillButton' && command.staffIndex !== undefined
    && (!Number.isInteger(command.staffIndex) || command.staffIndex < 0)) {
    return {
      ok: false,
      code: 'invalid-main-workbench-staff-index',
      message: 'addSkillButton staffIndex must be a zero-based non-negative timeline group index.',
    };
  }
  if (command.op === 'addBuffToButtons') {
    if (!isRecord(command.buff)) {
      return { ok: false, code: 'invalid-main-workbench-add-buff-to-buttons', message: 'addBuffToButtons requires buff.' };
    }
    if (!Array.isArray(command.buttonIds) || command.buttonIds.length === 0 || !command.buttonIds.every((id) => typeof id === 'string' && id.trim())) {
      return {
        ok: false,
        code: 'invalid-main-workbench-add-buff-to-buttons',
        message: 'addBuffToButtons requires non-empty buttonIds.',
      };
    }
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
  if ((command.op === 'setOperatorWeapon' || command.op === 'setOperatorEquipment' || command.op === 'setOperatorConfig')
    && !hasAnyString(command, ['characterId', 'characterName'])) {
    return {
      ok: false,
      code: 'missing-main-workbench-operator-target',
      message: `${command.op} requires an exact characterId or characterName.`,
    };
  }
  if (command.op === 'setOperatorEquipment' || command.op === 'setOperatorConfig') {
    const hasDirectEquipment = hasAnyString(command, ['equipmentId', 'equipmentName', 'gearSetId', 'gearSetName']);
    const hasEquipmentList = Array.isArray(command.equipments) && command.equipments.length > 0;
    const hasWeapon = hasAnyString(command, ['weaponName']);
    if (!hasDirectEquipment && !hasEquipmentList && !hasWeapon) {
      return {
        ok: false,
        code: 'invalid-main-workbench-operator-equipment',
        message: `${command.op} requires a weapon, equipment, gear set, or equipments.`,
      };
    }
    if (command.op === 'setOperatorConfig') {
      const weaponLevel = command.weaponLevel ?? command.level;
      if (weaponLevel !== undefined && (!Number.isInteger(Number(weaponLevel)) || Number(weaponLevel) < 1 || Number(weaponLevel) > 90)) {
        return { ok: false, code: 'invalid-main-workbench-weapon-level', message: 'weaponLevel must be an integer from 1 to 90.' };
      }
      const weaponSkills = command.weaponSkillLevels ?? command.skillLevels ?? {};
      for (const [key, value] of Object.entries(weaponSkills)) {
        const max = key === 'skill3' ? 4 : 9;
        if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > max) {
          return { ok: false, code: 'invalid-main-workbench-weapon-skill-level', message: `${key} must be an integer from 1 to ${max}.` };
        }
      }
      for (const [key, value] of Object.entries(command.operatorSkillLevels || {})) {
        if (!['A', 'B', 'E', 'Q'].includes(key) || !['L9', 'M3'].includes(value)) {
          return { ok: false, code: 'invalid-main-workbench-operator-skill-level', message: 'operatorSkillLevels only accepts A/B/E/Q with L9 or M3.' };
        }
      }
    }
  }
  if (command.op === 'previewOperatorConfig') {
    if (!isRecord(command.request) || command.request.op !== 'setOperatorConfig') {
      return { ok: false, code: 'invalid-main-workbench-preview-operator-config', message: 'previewOperatorConfig requires one setOperatorConfig request.' };
    }
    return validateMainWorkbenchCommand(command.request);
  }
  if (command.op === 'applyPreparedOperatorConfig') {
    if (!hasAnyString(command, ['parentNodeId', 'nodeId'])
      || !Number.isFinite(Number(command.parentRevision))
      || !Number.isFinite(Number(command.nodeRevision))) {
      return { ok: false, code: 'invalid-main-workbench-apply-prepared-operator-config', message: 'applyPreparedOperatorConfig requires node ids and revisions.' };
    }
  }
  if (command.op === 'restoreAtomicTeamParent') {
    if (!hasAnyString(command, ['parentNodeId', 'expectedTimelineId', 'expectedCheckoutNodeId', 'candidateNodeId'])
      || !Number.isFinite(Number(command.parentRevision))
      || !Number.isFinite(Number(command.candidateRevision))) {
      return { ok: false, code: 'invalid-main-workbench-restore-atomic-team-parent', message: 'restoreAtomicTeamParent requires exact parent, candidate, timeline, checkout, and revisions.' };
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
  if (command.op === 'patchAndValidateAiTimelineWorkNode') {
    if (!Array.isArray(command.patch) || command.patch.length === 0) {
      return {
        ok: false,
        code: 'invalid-main-workbench-patch-and-validate-worknode',
        message: 'patchAndValidateAiTimelineWorkNode requires non-empty patch array.',
      };
    }
    if (command.checkout === true) {
      return {
        ok: false,
        code: 'invalid-main-workbench-patch-and-validate-checkout',
        message: 'patchAndValidateAiTimelineWorkNode does not support checkout:true.',
      };
    }
  }
  if (command.op === 'finalizePreparedOperatorConfig' && (!hasAnyString(command, ['nodeId']) || !hasAnyString(command, ['commitId']))) {
    return {
      ok: false,
      code: 'invalid-main-workbench-finalize-operator-config',
      message: 'finalizePreparedOperatorConfig requires nodeId and commitId.',
    };
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
