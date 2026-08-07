import type { EngineToolProjectionInput, JsonObject } from '../../core/contracts/index.ts';
import { OpenCodeEngineError } from './errors.ts';

export const OPENCODE_TOOL_BINDINGS = [
  ['def.harness.route', 'def_harness_route'],
  ['def.node.crud.context', 'def_node_crud_context'],
  ['def.data.resource.team_loadouts', 'def_data_resource_team_loadouts'],
  ['def.node.crud.current', 'def_node_crud_current'],
  ['def.data.resource.buff', 'def_data_resource_buff'],
  ['def.data.resource.damage', 'def_data_resource_damage'],
  ['def.capability.status', 'def_capability_status'],
  ['def.user.ask', 'def_user_ask'],
  ['def.data.catalog.query', 'def_data_catalog_query'],
  ['def.worknode.list', 'def_worknode_list'],
  ['def.worknode.read', 'def_worknode_read'],
  ['def.worknode.diff', 'def_worknode_diff'],
  ['def.worknode.validate', 'def_worknode_validate'],
  ['def.worknode.delete', 'def_worknode_delete'],
  ['def.worknode.use', 'def_worknode_use'],
  ['def.worknode.restore', 'def_worknode_restore'],
  ['def.loadout.preview', 'def_loadout_preview'],
  ['def.loadout.apply_prepared', 'def_loadout_apply_prepared'],
  ['def.team.selection.apply', 'def_team_selection_apply'],
  ['def.workbench.add_skill_button', 'def_workbench_add_skill_button'],
  ['def.workbench.remove_skill_button', 'def_workbench_remove_skill_button'],
  ['def.buff.add_to_button', 'def_buff_add_to_button'],
  ['def.buff.remove_from_button', 'def_buff_remove_from_button'],
  ['def.target.set_resistance', 'def_target_set_resistance'],
  ['def.worknode.patch_and_validate', 'def_worknode_patch_and_validate'],
  ['def.damage.calculate_and_verify', 'def_damage_calculate_and_verify'],
] as const;

export type DefCanonicalToolName = typeof OPENCODE_TOOL_BINDINGS[number][0];
export type OpenCodeSafeToolName = typeof OPENCODE_TOOL_BINDINGS[number][1];

const canonicalToSafe = new Map<string, OpenCodeSafeToolName>(OPENCODE_TOOL_BINDINGS);
const safeToCanonical = new Map<string, DefCanonicalToolName>(
  OPENCODE_TOOL_BINDINGS.map(([canonical, safe]) => [safe, canonical]),
);

export function toOpenCodeSafeToolName(name: string): OpenCodeSafeToolName {
  const safe = canonicalToSafe.get(name);
  if (!safe) {
    throw new OpenCodeEngineError('OPENCODE_TOOL_UNSUPPORTED', `Unsupported DEF Tool binding: ${name}`);
  }
  return safe;
}

export function toDefCanonicalToolName(name: string): DefCanonicalToolName {
  const canonical = safeToCanonical.get(name);
  if (!canonical) {
    throw new OpenCodeEngineError('OPENCODE_TOOL_UNSUPPORTED', `Unsupported OpenCode Tool binding: ${name}`);
  }
  return canonical;
}

export function projectSafeToolNames(input: EngineToolProjectionInput): readonly OpenCodeSafeToolName[] {
  const names = projectOpenCodeTools(input).map((tool) => tool.safeName);
  if (new Set(names).size !== names.length) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode Tool projection contains duplicates');
  }
  if (names.length > 1) {
    throw new OpenCodeEngineError(
      'OPENCODE_BRIDGE_INVALID',
      'Phase 4 OpenCode projection must contain at most one Tool',
    );
  }
  return names;
}

export interface ProjectedOpenCodeTool {
  readonly canonicalName: DefCanonicalToolName;
  readonly safeName: OpenCodeSafeToolName;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly risk: 'read' | 'propose' | 'mutate';
}

export function projectOpenCodeTools(input: EngineToolProjectionInput): readonly ProjectedOpenCodeTool[] {
  return input.tools.map((descriptor) => {
    const safeName = toOpenCodeSafeToolName(descriptor.name);
    if (!['read', 'propose', 'mutate'].includes(descriptor.risk)) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', `OpenCode Tool ${descriptor.name} has an unsupported risk`);
    }
    if (
      descriptor.inputSchema.type !== 'object'
      || descriptor.inputSchema.additionalProperties !== false
      || !descriptor.inputSchema.properties
      || typeof descriptor.inputSchema.properties !== 'object'
      || Array.isArray(descriptor.inputSchema.properties)
    ) {
      throw new OpenCodeEngineError(
        'OPENCODE_BRIDGE_INVALID',
        `OpenCode Tool ${descriptor.name} must use a closed object schema`,
      );
    }
    return {
      canonicalName: descriptor.name as DefCanonicalToolName,
      safeName,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      risk: descriptor.risk,
    };
  });
}
