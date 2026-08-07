import type { JsonObject, JsonValue } from '../../../agent/core/contracts/json.ts';
import type { SkillButtonType } from '../../types';
import type {
  AgentProductCatalogCommand,
  MainWorkbenchCommand,
} from '../../utils/mainWorkbenchControl';

const SKILL_TYPES = new Set<SkillButtonType>(['A', 'B', 'E', 'Q', 'Dot']);
const RESISTANCE_KEYS = new Set([
  'physicalResistance',
  'fireResistance',
  'electricResistance',
  'iceResistance',
  'natureResistance',
]);
const BUFF_FIELDS = [
  'schemaVersion', 'id', 'name', 'displayName', 'sourceName', 'level', 'type', 'value',
  'description', 'source', 'condition', 'category', 'ownerBuffDomain', 'ownerCharacterId',
  'ownerBuffGroup', 'maxStacks', 'multiplier', 'refCount', 'target', 'effectKind',
  'extraHitConfig', 'valueMode', 'derivedValue',
] as const;

export class AgentWorkbenchCommandError extends Error {
  readonly code = 'AGENT_COMMAND_SCHEMA_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AgentWorkbenchCommandError';
  }
}

export function parseAgentWorkbenchCommand(value: JsonObject): MainWorkbenchCommand {
  const operation = string(value.op, 'op', 100);
  if (operation === 'queryAgentProductCatalog') {
    return parseAgentProductCatalogCommand(value);
  }
  if (operation === 'prepareOperatorConfigProposal') {
    exact(value, ['op', 'request', 'label', 'description']);
    return {
      op: 'prepareOperatorConfigProposal',
      request: parseOperatorConfigRequest(record(value.request, 'request')),
      label: string(value.label, 'label', 120),
      description: string(value.description, 'description', 500),
    };
  }
  if (operation === 'applyPreparedOperatorConfigProposal') {
    exact(value, [
      'op', 'parentNodeId', 'parentRevision', 'nodeId', 'nodeRevision',
      'proposalDigest', 'finalConfig', 'approval',
    ]);
    const approval = record(value.approval, 'approval');
    exact(approval, ['mode', 'approvedBy', 'rationale']);
    if (approval.mode !== 'manual' || approval.approvedBy !== 'user') {
      invalid('applyPreparedOperatorConfigProposal requires an exact manual user approval marker');
    }
    const proposalDigest = string(value.proposalDigest, 'proposalDigest', 200);
    if (!/^sha256:[0-9a-f]{16,128}$/u.test(proposalDigest)) {
      invalid('proposalDigest must be a sha256-prefixed hexadecimal digest');
    }
    return {
      op: 'applyPreparedOperatorConfigProposal',
      parentNodeId: string(value.parentNodeId, 'parentNodeId', 200),
      parentRevision: integer(value.parentRevision, 'parentRevision', 0, Number.MAX_SAFE_INTEGER),
      nodeId: string(value.nodeId, 'nodeId', 200),
      nodeRevision: integer(value.nodeRevision, 'nodeRevision', 0, Number.MAX_SAFE_INTEGER),
      proposalDigest,
      finalConfig: parseOperatorConfigFinalConfig(record(value.finalConfig, 'finalConfig')),
      approval: {
        mode: 'manual',
        approvedBy: 'user',
        ...(optionalString(approval.rationale, 'approval.rationale', 400)
          ? { rationale: approval.rationale as string }
          : {}),
      },
    };
  }
  if (operation === 'selectCharacters') {
    exact(value, ['op', 'characterIds', 'characterNames', 'nodeTitle', 'nodeDescription', 'openCanvas', 'approval']);
    const characterIds = optionalStringArray(value.characterIds, 'characterIds', 4, 160);
    const characterNames = optionalStringArray(value.characterNames, 'characterNames', 4, 160);
    if (!characterIds?.length && !characterNames?.length) invalid('selectCharacters requires characterIds or characterNames');
    const nodeTitle = string(value.nodeTitle, 'nodeTitle', 80);
    if (/^\[ai\]/iu.test(nodeTitle)) invalid('nodeTitle must not use the [ai] fixed prefix');
    const nodeDescription = string(value.nodeDescription, 'nodeDescription', 400);
    const approval = record(value.approval, 'approval');
    exact(approval, ['mode', 'approvedBy', 'rationale']);
    if (approval.mode !== 'manual' || approval.approvedBy !== 'user') {
      invalid('selectCharacters requires an exact manual user approval marker');
    }
    return {
      op: 'selectCharacters',
      ...(characterIds ? { characterIds } : {}),
      ...(characterNames ? { characterNames } : {}),
      nodeTitle,
      nodeDescription,
      ...(value.openCanvas === undefined ? {} : { openCanvas: boolean(value.openCanvas, 'openCanvas') }),
      approval: {
        mode: 'manual',
        approvedBy: 'user',
        ...(optionalString(approval.rationale, 'approval.rationale', 400)
          ? { rationale: approval.rationale as string }
          : {}),
      },
    };
  }
  if (operation === 'addSkillButton') {
    exact(value, [
      'op', 'characterId', 'characterName', 'skillType', 'runtimeSkillId',
      'skillDisplayName', 'staffIndex', 'nodeIndex', 'select',
    ]);
    const characterName = string(value.characterName, 'characterName', 160);
    return {
      op: 'addSkillButton',
      characterName,
      ...(optionalString(value.characterId, 'characterId', 160) ? { characterId: value.characterId as string } : {}),
      ...(value.skillType === undefined ? {} : { skillType: skillType(value.skillType) }),
      ...(optionalString(value.runtimeSkillId, 'runtimeSkillId', 200) ? { runtimeSkillId: value.runtimeSkillId as string } : {}),
      ...(optionalString(value.skillDisplayName, 'skillDisplayName', 200)
        ? { skillDisplayName: value.skillDisplayName as string }
        : {}),
      ...(value.staffIndex === undefined ? {} : { staffIndex: integer(value.staffIndex, 'staffIndex', 0, 100) }),
      ...(value.nodeIndex === undefined ? {} : { nodeIndex: integer(value.nodeIndex, 'nodeIndex', 0, 10_000) }),
      ...(value.select === undefined ? {} : { select: boolean(value.select, 'select') }),
    };
  }
  if (operation === 'removeSkillButton') {
    exact(value, ['op', 'buttonId', 'characterId', 'characterName', 'skillType', 'nodeIndex', 'latest']);
    const result: Extract<MainWorkbenchCommand, { op: 'removeSkillButton' }> = {
      op: 'removeSkillButton',
      ...(optionalString(value.buttonId, 'buttonId', 200) ? { buttonId: value.buttonId as string } : {}),
      ...(optionalString(value.characterId, 'characterId', 160) ? { characterId: value.characterId as string } : {}),
      ...(optionalString(value.characterName, 'characterName', 160) ? { characterName: value.characterName as string } : {}),
      ...(value.skillType === undefined ? {} : { skillType: skillType(value.skillType) }),
      ...(value.nodeIndex === undefined ? {} : { nodeIndex: integer(value.nodeIndex, 'nodeIndex', 0, 10_000) }),
      ...(value.latest === undefined ? {} : { latest: boolean(value.latest, 'latest') }),
    };
    if (!result.buttonId && !result.characterId && !result.characterName) {
      invalid('removeSkillButton requires an exact target');
    }
    return result;
  }
  if (operation === 'addBuff') {
    exact(value, ['op', 'buttonId', 'buff', 'select']);
    const buff = parseBuff(record(value.buff, 'buff'));
    return {
      op: 'addBuff',
      buttonId: string(value.buttonId, 'buttonId', 200),
      buff,
      ...(value.select === undefined ? {} : { select: boolean(value.select, 'select') }),
    };
  }
  if (operation === 'removeBuff') {
    exact(value, ['op', 'buttonId', 'buffId', 'name', 'displayName', 'latest', 'count', 'all']);
    const result: Extract<MainWorkbenchCommand, { op: 'removeBuff' }> = {
      op: 'removeBuff',
      buttonId: string(value.buttonId, 'buttonId', 200),
      ...(optionalString(value.buffId, 'buffId', 200) ? { buffId: value.buffId as string } : {}),
      ...(optionalString(value.name, 'name', 200) ? { name: value.name as string } : {}),
      ...(optionalString(value.displayName, 'displayName', 200) ? { displayName: value.displayName as string } : {}),
      ...(value.latest === undefined ? {} : { latest: boolean(value.latest, 'latest') }),
      ...(value.count === undefined ? {} : { count: integer(value.count, 'count', 1, 100) }),
      ...(value.all === undefined ? {} : { all: boolean(value.all, 'all') }),
    };
    if (!result.buffId && !result.name && !result.displayName && !result.latest) {
      invalid('removeBuff requires an exact Buff target');
    }
    return result;
  }
  if (operation === 'setTargetResistance') {
    exact(value, ['op', 'buttonId', 'targetResistance']);
    const source = record(value.targetResistance, 'targetResistance');
    if (Object.keys(source).length === 0) invalid('targetResistance requires at least one resistance field');
    const targetResistance: Record<string, number> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (!RESISTANCE_KEYS.has(key) || typeof entry !== 'number' || !Number.isFinite(entry) || entry < -10_000 || entry > 10_000) {
        invalid(`targetResistance.${key || '<empty>'} is invalid`);
      }
      targetResistance[key] = entry;
    }
    return {
      op: 'setTargetResistance',
      buttonId: string(value.buttonId, 'buttonId', 200),
      targetResistance,
    };
  }
  if (operation === 'applyApprovedWorkNodePatch') {
    exact(value, ['op', 'patch', 'label', 'description']);
    if (!Array.isArray(value.patch) || value.patch.length < 1 || value.patch.length > 64) {
      invalid('applyApprovedWorkNodePatch requires 1-64 patch operations');
    }
    const patch = value.patch.map((entry, index) => record(entry, `patch[${index}]`));
    return {
      op: 'applyApprovedWorkNodePatch',
      patch: patch as Extract<MainWorkbenchCommand, { op: 'applyApprovedWorkNodePatch' }>['patch'],
      ...(optionalString(value.label, 'label', 120) ? { label: value.label as string } : {}),
      ...(optionalString(value.description, 'description', 500) ? { description: value.description as string } : {}),
    };
  }
  if (operation === 'listAiTimelineWorkNodes') {
    exact(value, ['op', 'timelineId']);
    return {
      op: 'listAiTimelineWorkNodes',
      ...(optionalString(value.timelineId, 'timelineId', 200) ? { timelineId: value.timelineId as string } : {}),
    };
  }
  if (operation === 'readAiTimelineWorkNode') {
    exact(value, ['op', 'nodeId', 'includePayload']);
    return {
      op: 'readAiTimelineWorkNode',
      nodeId: string(value.nodeId, 'nodeId', 200),
      ...(value.includePayload === undefined ? {} : { includePayload: boolean(value.includePayload, 'includePayload') }),
    };
  }
  if (operation === 'diffAiTimelineWorkNode') {
    exact(value, ['op', 'nodeId']);
    return { op: 'diffAiTimelineWorkNode', nodeId: string(value.nodeId, 'nodeId', 200) };
  }
  if (operation === 'validateAiTimelineWorkNode') {
    exact(value, ['op', 'nodeId', 'repairStatus']);
    if (value.repairStatus === true) invalid('Agent validation cannot repair Work Node status');
    return {
      op: 'validateAiTimelineWorkNode',
      nodeId: string(value.nodeId, 'nodeId', 200),
      // The agent-facing route is always read-only.  Do not leave the
      // renderer's historical default (repairStatus !== false) reachable.
      repairStatus: false,
    };
  }
  if (operation === 'deleteAiTimelineWorkNode') {
    exact(value, ['op', 'nodeId']);
    return { op: 'deleteAiTimelineWorkNode', nodeId: string(value.nodeId, 'nodeId', 200) };
  }
  if (operation === 'checkoutAiTimelineWorkNode') {
    exact(value, ['op', 'nodeId', 'commitId', 'reload', 'approval']);
    if (value.reload === true) invalid('Agent Work Node checkout must not request a reload');
    const approval = parseManualUserApproval(value.approval, 'checkoutAiTimelineWorkNode');
    return {
      op: 'checkoutAiTimelineWorkNode',
      nodeId: string(value.nodeId, 'nodeId', 200),
      ...(optionalString(value.commitId, 'commitId', 200) ? { commitId: value.commitId as string } : {}),
      reload: false,
      approval,
    };
  }
  if (operation === 'restoreAiTimelineWorkNodeBase') {
    exact(value, ['op', 'nodeId', 'reload', 'approval']);
    if (value.reload === true) invalid('Agent Work Node restore must not request a reload');
    const approval = parseManualUserApproval(value.approval, 'restoreAiTimelineWorkNodeBase');
    return {
      op: 'restoreAiTimelineWorkNodeBase',
      nodeId: string(value.nodeId, 'nodeId', 200),
      reload: false,
      approval,
    };
  }
  if (operation === 'calculateDamage') {
    exact(value, ['op', 'buttonId']);
    return {
      op: 'calculateDamage',
      ...(optionalString(value.buttonId, 'buttonId', 200) ? { buttonId: value.buttonId as string } : {}),
    };
  }
  invalid(`Agent command operation is not allowlisted: ${operation}`);
}

const OPERATOR_CONFIG_FIELDS = [
  'op', 'characterId', 'characterName', 'weaponName', 'weaponLevel',
  'weaponSkillLevels', 'level', 'potential', 'skillLevels', 'operatorSkillLevels',
  'slotKey', 'part', 'equipmentId', 'equipmentName', 'gearSetId', 'gearSetName',
  'fillSlots', 'entryLevel', 'entryLevels', 'equipmentEntryLevel',
  'equipmentEntryLevels', 'equipments',
] as const;

function parseOperatorConfigRequest(value: JsonObject): Extract<MainWorkbenchCommand, { op: 'setOperatorConfig' }> {
  exact(value, OPERATOR_CONFIG_FIELDS);
  if (value.op !== 'setOperatorConfig') invalid('request.op must be setOperatorConfig');
  const characterId = optionalString(value.characterId, 'request.characterId', 160);
  const characterName = optionalString(value.characterName, 'request.characterName', 160);
  if (!characterId && !characterName) invalid('request requires characterId or characterName');
  return {
    op: 'setOperatorConfig',
    ...(characterId ? { characterId } : {}),
    ...(characterName ? { characterName } : {}),
    ...(optionalString(value.weaponName, 'request.weaponName', 200) ? { weaponName: value.weaponName as string } : {}),
    ...(value.weaponLevel === undefined ? {} : { weaponLevel: scalar(value.weaponLevel, 'request.weaponLevel', 80) }),
    ...(value.weaponSkillLevels === undefined ? {} : { weaponSkillLevels: parseNumericSkillLevels(record(value.weaponSkillLevels, 'request.weaponSkillLevels')) }),
    ...(value.level === undefined ? {} : { level: scalar(value.level, 'request.level', 80) }),
    ...(optionalString(value.potential, 'request.potential', 40) ? { potential: value.potential as string } : {}),
    ...(value.skillLevels === undefined ? {} : { skillLevels: parseNumericSkillLevels(record(value.skillLevels, 'request.skillLevels')) }),
    ...(value.operatorSkillLevels === undefined ? {} : { operatorSkillLevels: parseOperatorSkillLevels(record(value.operatorSkillLevels, 'request.operatorSkillLevels')) }),
    ...(value.slotKey === undefined ? {} : { slotKey: enumValue(value.slotKey, 'request.slotKey', ['armor', 'accessory2', 'accessory1', 'glove'] as const) }),
    ...(value.part === undefined ? {} : { part: enumValue(value.part, 'request.part', ['护甲', '护手', '配件'] as const) }),
    ...(optionalString(value.equipmentId, 'request.equipmentId', 200) ? { equipmentId: value.equipmentId as string } : {}),
    ...(optionalString(value.equipmentName, 'request.equipmentName', 200) ? { equipmentName: value.equipmentName as string } : {}),
    ...(optionalString(value.gearSetId, 'request.gearSetId', 200) ? { gearSetId: value.gearSetId as string } : {}),
    ...(optionalString(value.gearSetName, 'request.gearSetName', 200) ? { gearSetName: value.gearSetName as string } : {}),
    ...(value.fillSlots === undefined ? {} : { fillSlots: boolean(value.fillSlots, 'request.fillSlots') }),
    ...(value.entryLevel === undefined ? {} : { entryLevel: scalar(value.entryLevel, 'request.entryLevel', 40) }),
    ...(value.entryLevels === undefined ? {} : { entryLevels: parseEntryLevels(value.entryLevels, 'request.entryLevels') }),
    ...(value.equipmentEntryLevel === undefined ? {} : { equipmentEntryLevel: scalar(value.equipmentEntryLevel, 'request.equipmentEntryLevel', 40) }),
    ...(value.equipmentEntryLevels === undefined ? {} : { equipmentEntryLevels: parseEntryLevels(value.equipmentEntryLevels, 'request.equipmentEntryLevels') }),
    ...(value.equipments === undefined ? {} : { equipments: parseEquipmentSelections(value.equipments, 'request.equipments') }),
  };
}

function parseNumericSkillLevels(value: JsonObject): { skill1?: number; skill2?: number; skill3?: number } {
  exact(value, ['skill1', 'skill2', 'skill3']);
  return {
    ...(value.skill1 === undefined ? {} : { skill1: integer(value.skill1, 'skill1', 0, 100) }),
    ...(value.skill2 === undefined ? {} : { skill2: integer(value.skill2, 'skill2', 0, 100) }),
    ...(value.skill3 === undefined ? {} : { skill3: integer(value.skill3, 'skill3', 0, 100) }),
  };
}

function parseOperatorSkillLevels(value: JsonObject): { A?: 'L9' | 'M3'; B?: 'L9' | 'M3'; E?: 'L9' | 'M3'; Q?: 'L9' | 'M3' } {
  exact(value, ['A', 'B', 'E', 'Q']);
  return {
    ...(value.A === undefined ? {} : { A: enumValue(value.A, 'operatorSkillLevels.A', ['L9', 'M3'] as const) }),
    ...(value.B === undefined ? {} : { B: enumValue(value.B, 'operatorSkillLevels.B', ['L9', 'M3'] as const) }),
    ...(value.E === undefined ? {} : { E: enumValue(value.E, 'operatorSkillLevels.E', ['L9', 'M3'] as const) }),
    ...(value.Q === undefined ? {} : { Q: enumValue(value.Q, 'operatorSkillLevels.Q', ['L9', 'M3'] as const) }),
  };
}

function parseEntryLevels(value: JsonValue, label: string): Array<number | string> | Record<string, number | string> {
  if (Array.isArray(value)) {
    if (value.length > 8) invalid(`${label} may contain at most 8 levels`);
    return value.map((entry, index) => scalar(entry, `${label}[${index}]`, 40));
  }
  const source = record(value, label);
  if (Object.keys(source).length > 16) invalid(`${label} may contain at most 16 entries`);
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => [
    string(key, `${label}.${key}`, 80),
    scalar(entry, `${label}.${key}`, 40),
  ]));
}

function parseEquipmentSelections(value: JsonValue, label: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    invalid(`${label} must contain 1-4 equipment selections`);
  }
  return value.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    exact(item, [
      'slotKey', 'part', 'equipmentId', 'equipmentName', 'gearSetId', 'gearSetName',
      'fillSlots', 'entryLevel', 'entryLevels',
    ]);
    return {
      ...(item.slotKey === undefined ? {} : { slotKey: enumValue(item.slotKey, `${label}[${index}].slotKey`, ['armor', 'accessory2', 'accessory1', 'glove'] as const) }),
      ...(item.part === undefined ? {} : { part: enumValue(item.part, `${label}[${index}].part`, ['护甲', '护手', '配件'] as const) }),
      ...(optionalString(item.equipmentId, `${label}[${index}].equipmentId`, 200) ? { equipmentId: item.equipmentId as string } : {}),
      ...(optionalString(item.equipmentName, `${label}[${index}].equipmentName`, 200) ? { equipmentName: item.equipmentName as string } : {}),
      ...(optionalString(item.gearSetId, `${label}[${index}].gearSetId`, 200) ? { gearSetId: item.gearSetId as string } : {}),
      ...(optionalString(item.gearSetName, `${label}[${index}].gearSetName`, 200) ? { gearSetName: item.gearSetName as string } : {}),
      ...(item.fillSlots === undefined ? {} : { fillSlots: boolean(item.fillSlots, `${label}[${index}].fillSlots`) }),
      ...(item.entryLevel === undefined ? {} : { entryLevel: scalar(item.entryLevel, `${label}[${index}].entryLevel`, 40) }),
      ...(item.entryLevels === undefined ? {} : { entryLevels: parseEntryLevels(item.entryLevels, `${label}[${index}].entryLevels`) }),
    };
  });
}

function parseOperatorConfigFinalConfig(value: JsonObject): Record<string, unknown> {
  exact(value, ['characterId', 'characterName', 'weapon', 'equipment', 'operatorSkillLevels']);
  const weapon = record(value.weapon, 'finalConfig.weapon');
  exact(weapon, ['id', 'name', 'level', 'potential', 'skillLevels']);
  const skillLevels = weapon.skillLevels === undefined ? undefined : parseNumericSkillLevels(record(weapon.skillLevels, 'finalConfig.weapon.skillLevels'));
  const equipment = value.equipment;
  if (!Array.isArray(equipment) || equipment.length > 4) invalid('finalConfig.equipment must contain at most 4 entries');
  const equipmentResult = equipment.map((entry, index) => {
    const item = record(entry, `finalConfig.equipment[${index}]`);
    exact(item, ['slotKey', 'equipmentId', 'name', 'effects']);
    const effects = item.effects;
    if (!Array.isArray(effects) || effects.length > 32) invalid(`finalConfig.equipment[${index}].effects must contain at most 32 entries`);
    return {
      slotKey: string(item.slotKey, `finalConfig.equipment[${index}].slotKey`, 80),
      equipmentId: string(item.equipmentId, `finalConfig.equipment[${index}].equipmentId`, 200),
      name: string(item.name, `finalConfig.equipment[${index}].name`, 200),
      effects: effects.map((effect, effectIndex) => {
        const itemEffect = record(effect, `finalConfig.equipment[${index}].effects[${effectIndex}]`);
        exact(itemEffect, ['effectId', 'label', 'level', 'value']);
        return {
          effectId: string(itemEffect.effectId, `finalConfig.equipment[${index}].effects[${effectIndex}].effectId`, 200),
          label: string(itemEffect.label, `finalConfig.equipment[${index}].effects[${effectIndex}].label`, 300),
          level: itemEffect.level === null ? null : scalar(itemEffect.level, `finalConfig.equipment[${index}].effects[${effectIndex}].level`, 40),
          value: itemEffect.value === null ? null : finiteNumber(itemEffect.value, `finalConfig.equipment[${index}].effects[${effectIndex}].value`, -1e12, 1e12),
        };
      }),
    };
  });
  return {
    characterId: string(value.characterId, 'finalConfig.characterId', 160),
    characterName: string(value.characterName, 'finalConfig.characterName', 160),
    weapon: {
      id: string(weapon.id, 'finalConfig.weapon.id', 200),
      name: string(weapon.name, 'finalConfig.weapon.name', 200),
      level: weapon.level === null ? null : scalar(weapon.level, 'finalConfig.weapon.level', 80),
      potential: weapon.potential === null ? null : scalar(weapon.potential, 'finalConfig.weapon.potential', 80),
      ...(skillLevels ? { skillLevels } : {}),
    },
    equipment: equipmentResult,
    operatorSkillLevels: parseFinalOperatorSkillLevels(record(value.operatorSkillLevels, 'finalConfig.operatorSkillLevels')),
  };
}

function parseManualUserApproval(value: JsonValue | undefined, operation: string) {
  const approval = record(value, `${operation}.approval`);
  exact(approval, ['mode', 'approvedBy', 'rationale']);
  if (approval.mode !== 'manual' || approval.approvedBy !== 'user') {
    invalid(`${operation} requires an exact manual user approval marker`);
  }
  return {
    mode: 'manual' as const,
    approvedBy: 'user' as const,
    ...(optionalString(approval.rationale, `${operation}.approval.rationale`, 400)
      ? { rationale: approval.rationale as string }
      : {}),
  };
}

function parseFinalOperatorSkillLevels(value: JsonObject): Record<string, string | number | null> {
  exact(value, ['A', 'B', 'E', 'Q', 'Dot']);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    entry === null ? null : enumValue(entry, `finalConfig.operatorSkillLevels.${key}`, ['L9', 'M3'] as const),
  ]));
}

function parseAgentProductCatalogCommand(value: JsonObject): AgentProductCatalogCommand {
  const action = enumValue(
    value.action,
    'action',
    [
      'query',
      'compatibleWeapons',
      'gearTopologyFacts',
      'gearTopologyPlan',
      'discoverGearTopologies',
      'skillFact',
      'buildGuide',
    ] as const,
  );
  if (action === 'query') {
    exact(value, ['op', 'action', 'domain', 'query', 'limit']);
    return {
      op: 'queryAgentProductCatalog',
      action,
      domain: enumValue(
        value.domain,
        'domain',
        ['operators', 'skills', 'weapons', 'equipment', 'gearSets'] as const,
      ),
      ...(optionalString(value.query, 'query', 160) ? { query: value.query as string } : {}),
      ...(value.limit === undefined ? {} : { limit: integer(value.limit, 'limit', 1, 256) }),
    };
  }
  if (action === 'compatibleWeapons') {
    exact(value, ['op', 'action', 'operatorQuery', 'weaponQuery', 'limit']);
    return {
      op: 'queryAgentProductCatalog',
      action,
      operatorQuery: string(value.operatorQuery, 'operatorQuery', 160),
      ...(optionalString(value.weaponQuery, 'weaponQuery', 160) ? { weaponQuery: value.weaponQuery as string } : {}),
      ...(value.limit === undefined ? {} : { limit: integer(value.limit, 'limit', 1, 256) }),
    };
  }
  if (action === 'gearTopologyFacts') {
    exact(value, ['op', 'action', 'setQuery', 'allowDuplicateCompatibleAccessories']);
    return {
      op: 'queryAgentProductCatalog',
      action,
      setQuery: string(value.setQuery, 'setQuery', 160),
      ...(value.allowDuplicateCompatibleAccessories === undefined ? {} : {
        allowDuplicateCompatibleAccessories: boolean(
          value.allowDuplicateCompatibleAccessories,
          'allowDuplicateCompatibleAccessories',
        ),
      }),
    };
  }
  if (action === 'gearTopologyPlan') {
    exact(value, ['op', 'action', 'setQuery', 'limit', 'allowDuplicateCompatibleAccessories']);
    return {
      op: 'queryAgentProductCatalog',
      action,
      setQuery: string(value.setQuery, 'setQuery', 160),
      ...(value.limit === undefined ? {} : { limit: integer(value.limit, 'limit', 1, 256) }),
      ...(value.allowDuplicateCompatibleAccessories === undefined ? {} : {
        allowDuplicateCompatibleAccessories: boolean(
          value.allowDuplicateCompatibleAccessories,
          'allowDuplicateCompatibleAccessories',
        ),
      }),
    };
  }
  if (action === 'discoverGearTopologies') {
    exact(value, [
      'op',
      'action',
      'limit',
      'combinationsPerSet',
      'allowDuplicateCompatibleAccessories',
    ]);
    return {
      op: 'queryAgentProductCatalog',
      action,
      ...(value.limit === undefined ? {} : { limit: integer(value.limit, 'limit', 1, 256) }),
      ...(value.combinationsPerSet === undefined ? {} : {
        combinationsPerSet: integer(value.combinationsPerSet, 'combinationsPerSet', 1, 256),
      }),
      ...(value.allowDuplicateCompatibleAccessories === undefined ? {} : {
        allowDuplicateCompatibleAccessories: boolean(
          value.allowDuplicateCompatibleAccessories,
          'allowDuplicateCompatibleAccessories',
        ),
      }),
    };
  }
  if (action === 'skillFact') {
    exact(value, ['op', 'action', 'operatorQuery', 'skillQuery', 'hitQuery']);
    return {
      op: 'queryAgentProductCatalog',
      action,
      operatorQuery: string(value.operatorQuery, 'operatorQuery', 160),
      skillQuery: string(value.skillQuery, 'skillQuery', 160),
      ...(optionalString(value.hitQuery, 'hitQuery', 160) ? { hitQuery: value.hitQuery as string } : {}),
    };
  }
  exact(value, ['op', 'action', 'operatorQuery']);
  return {
    op: 'queryAgentProductCatalog',
    action,
    operatorQuery: string(value.operatorQuery, 'operatorQuery', 160),
  };
}

function parseBuff(value: JsonObject): Extract<MainWorkbenchCommand, { op: 'addBuff' }>['buff'] {
  exact(value, BUFF_FIELDS);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2) {
    invalid('buff.schemaVersion must be 2');
  }
  const result: Record<string, unknown> = {
    name: string(value.name, 'buff.name', 200),
    displayName: string(value.displayName, 'buff.displayName', 200),
    sourceName: string(value.sourceName, 'buff.sourceName', 200),
  };
  if (value.schemaVersion === 2) result.schemaVersion = 2;
  for (const [field, maximum] of [
    ['id', 200], ['level', 120], ['type', 200], ['description', 2_000], ['source', 200],
    ['condition', 1_000], ['ownerCharacterId', 200],
  ] as const) {
    const parsed = optionalString(value[field], `buff.${field}`, maximum);
    if (parsed !== undefined) result[field] = parsed;
  }
  if (value.value !== undefined) result.value = finiteNumber(value.value, 'buff.value', -1e12, 1e12);
  if (value.refCount !== undefined) result.refCount = integer(value.refCount, 'buff.refCount', 0, 1_000_000);
  if (value.maxStacks !== undefined) result.maxStacks = integer(value.maxStacks, 'buff.maxStacks', 1, 10_000);
  assignEnum(result, 'category', value.category, ['condition', 'countable', 'passive']);
  assignEnum(result, 'ownerBuffDomain', value.ownerBuffDomain, ['operator', 'weapon', 'equipment']);
  assignEnum(result, 'ownerBuffGroup', value.ownerBuffGroup, ['talent', 'potential', 'skill', 'weaponSkill', 'threePiece']);
  assignEnum(result, 'effectKind', value.effectKind, ['modifier', 'extraHit']);
  assignEnum(result, 'valueMode', value.valueMode, ['fixed', 'derived']);

  if (value.multiplier !== undefined) {
    const multiplier = record(value.multiplier, 'buff.multiplier');
    exact(multiplier, ['coefficient']);
    result.multiplier = {
      coefficient: finiteNumber(multiplier.coefficient, 'buff.multiplier.coefficient', -1e6, 1e6),
    };
  }
  if (value.target !== undefined) result.target = parseBuffTarget(record(value.target, 'buff.target'));
  if (value.extraHitConfig !== undefined) {
    result.extraHitConfig = parseExtraHitConfig(record(value.extraHitConfig, 'buff.extraHitConfig'));
  }
  if (value.derivedValue !== undefined) {
    const derived = record(value.derivedValue, 'buff.derivedValue');
    exact(derived, ['source', 'perPointValue']);
    result.derivedValue = {
      source: enumValue(
        derived.source,
        'buff.derivedValue.source',
        ['hp', 'atk', 'strength', 'agility', 'intelligence', 'will', 'sourceSkill'],
      ),
      perPointValue: finiteNumber(derived.perPointValue, 'buff.derivedValue.perPointValue', -1e6, 1e6),
    };
  }
  if (result.effectKind === 'extraHit' && !result.extraHitConfig) {
    invalid('buff.extraHitConfig is required when effectKind is extraHit');
  }
  if (result.effectKind !== 'extraHit' && result.extraHitConfig) {
    invalid('buff.extraHitConfig is only valid when effectKind is extraHit');
  }
  if (result.valueMode === 'derived' && !result.derivedValue) {
    invalid('buff.derivedValue is required when valueMode is derived');
  }
  if (result.valueMode !== 'derived' && result.derivedValue) {
    invalid('buff.derivedValue is only valid when valueMode is derived');
  }
  return result as Extract<MainWorkbenchCommand, { op: 'addBuff' }>['buff'];
}

function parseBuffTarget(value: JsonObject): JsonObject {
  const mode = enumValue(value.mode, 'buff.target.mode', ['all', 'damageKey', 'skillType', 'element']);
  if (mode === 'all') {
    exact(value, ['mode']);
    return { mode };
  }
  if (mode === 'damageKey') {
    exact(value, ['mode', 'key']);
    return { mode, key: string(value.key, 'buff.target.key', 200) };
  }
  if (mode === 'skillType') {
    exact(value, ['mode', 'skillType']);
    return { mode, skillType: skillType(value.skillType) };
  }
  exact(value, ['mode', 'element']);
  return {
    mode,
    element: enumValue(value.element, 'buff.target.element', ['physical', 'fire', 'ice', 'electric', 'nature']),
  };
}

function parseExtraHitConfig(value: JsonObject): JsonObject {
  exact(value, [
    'key', 'damageType', 'skillType', 'baseMultiplier', 'imbalanceValue', 'cooldownSeconds', 'trigger',
  ]);
  return {
    key: string(value.key, 'buff.extraHitConfig.key', 200),
    damageType: enumValue(
      value.damageType,
      'buff.extraHitConfig.damageType',
      ['physical', 'magic', 'fire', 'electric', 'ice', 'nature'],
    ),
    skillType: enumValue(value.skillType, 'buff.extraHitConfig.skillType', ['', 'A', 'B', 'E', 'Q', 'Dot']),
    baseMultiplier: finiteNumber(value.baseMultiplier, 'buff.extraHitConfig.baseMultiplier', 0, 1e6),
    imbalanceValue: finiteNumber(value.imbalanceValue, 'buff.extraHitConfig.imbalanceValue', 0, 1e9),
    cooldownSeconds: finiteNumber(value.cooldownSeconds, 'buff.extraHitConfig.cooldownSeconds', 0, 1e9),
    trigger: enumValue(value.trigger, 'buff.extraHitConfig.trigger', ['physicalAbnormal']),
  };
}

function record(value: JsonValue | undefined, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as JsonObject;
}

function exact(value: JsonObject, allowed: readonly string[]): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) invalid(`Unexpected command fields: ${extras.join(', ')}`);
}

function string(value: JsonValue | undefined, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    invalid(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function optionalString(value: JsonValue | undefined, label: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : string(value, label, maxLength);
}

function optionalStringArray(
  value: JsonValue | undefined,
  label: string,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    invalid(`${label} must contain 1-${maxItems} strings`);
  }
  const entries = value.map((entry, index) => string(entry, `${label}[${index}]`, maxLength));
  if (new Set(entries).size !== entries.length) invalid(`${label} cannot contain duplicates`);
  return entries;
}

function integer(value: JsonValue | undefined, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function finiteNumber(
  value: JsonValue | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${label} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function scalar(value: JsonValue | undefined, label: string, maxStringLength: number): number | string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      invalid(`${label} must be a finite safe number`);
    }
    return value;
  }
  return string(value, label, maxStringLength);
}

function enumValue<const Value extends string>(
  value: JsonValue | undefined,
  label: string,
  allowed: readonly Value[],
): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) {
    invalid(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as Value;
}

function assignEnum<const Value extends string>(
  target: Record<string, unknown>,
  field: string,
  value: JsonValue | undefined,
  allowed: readonly Value[],
): void {
  if (value !== undefined) target[field] = enumValue(value, `buff.${field}`, allowed);
}

function boolean(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label} must be boolean`);
  return value;
}

function skillType(value: JsonValue | undefined): SkillButtonType {
  if (typeof value !== 'string' || !SKILL_TYPES.has(value as SkillButtonType)) invalid('skillType is invalid');
  return value as SkillButtonType;
}

function invalid(message: string): never {
  throw new AgentWorkbenchCommandError(message);
}
