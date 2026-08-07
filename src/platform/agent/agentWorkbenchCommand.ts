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
  if (operation === 'calculateDamage') {
    exact(value, ['op', 'buttonId']);
    return {
      op: 'calculateDamage',
      ...(optionalString(value.buttonId, 'buttonId', 200) ? { buttonId: value.buttonId as string } : {}),
    };
  }
  invalid(`Agent command operation is not allowlisted: ${operation}`);
}

function parseAgentProductCatalogCommand(value: JsonObject): AgentProductCatalogCommand {
  const action = enumValue(
    value.action,
    'action',
    ['query', 'compatibleWeapons', 'gearTopologyFacts', 'gearTopologyPlan', 'buildGuide'] as const,
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
