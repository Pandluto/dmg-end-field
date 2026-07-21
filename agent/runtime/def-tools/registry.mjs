export const DEF_TOOL_FAMILY = Object.freeze({
  NODE_CODE: 'def-node-code',
  NODE_CRUD: 'def-node-crud',
  DATA_RESOURCE: 'def-data-resource',
});

export const DEF_WORKSPACE_SCOPE = Object.freeze({
  PUBLIC: 'public',
  SESSION_PRIVATE: 'session-private',
  WORKBENCH_CURRENT: 'workbench-current',
  WORKNODE_TREE: 'worknode-tree',
  INTERNAL_GOVERNANCE: 'internal-governance',
});

export const DEF_PROJECTION_ACCESS = Object.freeze({
  NONE: 'none',
  PUBLIC_ONLY: 'public-only',
  MIXED_CURRENT_PUBLIC: 'mixed-current-public',
  CURRENT_READ: 'current-read',
  CURRENT_WRITE: 'current-write',
});

const INTERNAL_GOVERNANCE_TOOLS = new Set([
  'def.workbench.bind_session_axis',
  'def.workbench.unbind_session_axis',
  'def.workbench.assert_session_axis',
  'def.workbench.assert_timeline_admission',
  'def.native_catalog.register_session',
]);

const PUBLIC_TOOLS = new Set([
  'def.tool.list',
  'def.tool.describe',
  'def.operator.catalog.search',
  'def.knowledge.game.search',
  'def.knowledge.game.section.read',
  'def.weapon.resolve',
]);

const SESSION_PRIVATE_TOOLS = new Set([
  'def.user.ask',
  'def.user.record_answer',
  'def.approval.request',
  'def.approval.record_decision',
  'def.team.loadout.plan.remember_guide',
  'def.operator.build.guide',
  'def.operator.build.profile',
  'def.knowledge.combat_conventions.resolve',
  'def.weapon.fit.plan',
  'def.native_catalog.materialize',
  'def.equipment.3plus1.facts',
  'def.equipment.3plus1.plan',
]);

const PRIVATE_CURRENT_CONTINUATIONS = new Set([
  'def.operator.config.prepare',
  'def.operator.config.apply_prepared',
  'def.operator.config.discard_prepared',
  'def.team.loadout.plan.apply.prepare',
  'def.team.loadout.plan.apply.discard',
]);

const MIXED_CURRENT_PUBLIC_TOOLS = new Set([
  'def.buff.resolve',
  'def.buff.search_candidates',
  'def.equipment.resolve',
  'def.gear.resolve',
]);

export function resolveDefToolAccessPolicy(name, tool = {}) {
  if (INTERNAL_GOVERNANCE_TOOLS.has(name)) {
    return Object.freeze({
      workspaceScope: DEF_WORKSPACE_SCOPE.INTERNAL_GOVERNANCE,
      projectionAccess: DEF_PROJECTION_ACCESS.NONE,
      allowedHosts: [],
      exposure: [],
      requiresCheckout: false,
      internalOnly: true,
    });
  }
  if (PUBLIC_TOOLS.has(name)) {
    return Object.freeze({
      workspaceScope: DEF_WORKSPACE_SCOPE.PUBLIC,
      projectionAccess: DEF_PROJECTION_ACCESS.PUBLIC_ONLY,
      allowedHosts: ['workbench', 'ai-cli'],
      exposure: ['workbench', 'ai-cli'],
      requiresCheckout: false,
      internalOnly: false,
    });
  }
  if (SESSION_PRIVATE_TOOLS.has(name)) {
    return Object.freeze({
      workspaceScope: DEF_WORKSPACE_SCOPE.SESSION_PRIVATE,
      projectionAccess: DEF_PROJECTION_ACCESS.NONE,
      allowedHosts: ['workbench', 'ai-cli'],
      exposure: ['workbench', 'ai-cli'],
      requiresCheckout: false,
      internalOnly: false,
    });
  }
  if (MIXED_CURRENT_PUBLIC_TOOLS.has(name)) {
    return Object.freeze({
      workspaceScope: DEF_WORKSPACE_SCOPE.WORKBENCH_CURRENT,
      projectionAccess: DEF_PROJECTION_ACCESS.MIXED_CURRENT_PUBLIC,
      allowedHosts: ['workbench', 'ai-cli'],
      exposure: ['workbench', 'ai-cli'],
      requiresCheckout: false,
      internalOnly: false,
    });
  }
  const workNodeTree = tool.scope === 'appdata-work-node'
    || name.startsWith('def.worknode.')
    || NODE_CODE_TOOLS.has(name);
  if (workNodeTree) {
    return Object.freeze({
      workspaceScope: DEF_WORKSPACE_SCOPE.WORKNODE_TREE,
      projectionAccess: tool.riskLevel === 'read' ? DEF_PROJECTION_ACCESS.CURRENT_READ : DEF_PROJECTION_ACCESS.CURRENT_WRITE,
      allowedHosts: ['workbench'],
      exposure: ['workbench'],
      requiresCheckout: true,
      internalOnly: false,
    });
  }
  const privateCurrentWrite = PRIVATE_CURRENT_CONTINUATIONS.has(name);
  const currentWrite = tool.scope === 'current-checkout'
    || Boolean(tool.commandOp)
    || privateCurrentWrite;
  return Object.freeze({
    workspaceScope: DEF_WORKSPACE_SCOPE.WORKBENCH_CURRENT,
    projectionAccess: privateCurrentWrite || (currentWrite && tool.riskLevel !== 'read')
      ? DEF_PROJECTION_ACCESS.CURRENT_WRITE
      : DEF_PROJECTION_ACCESS.CURRENT_READ,
    allowedHosts: ['workbench'],
    exposure: ['workbench'],
    requiresCheckout: currentWrite,
    internalOnly: false,
  });
}

const NODE_CODE_TOOLS = new Set([
  'def.buff.add_to_buttons',
  'def.worknode.patch',
  'def.worknode.sync_workspace',
  'def.worknode.patch_and_validate',
  'def.worknode.copy_staff_line_and_verify',
]);

const DATA_RESOURCE_TOOLS = new Set([
  'def.buff.resolve',
  'def.buff.search_candidates',
  'def.skill.resolve',
  'def.character.resolve',
  'def.operator.catalog.search',
  'def.operator.build.guide',
  'def.operator.build.profile',
  'def.knowledge.game.search',
  'def.knowledge.game.section.read',
  'def.equipment.resolve',
  'def.weapon.resolve',
  'def.native_catalog.materialize',
  'def.equipment.3plus1.facts',
  'def.equipment.3plus1.plan',
  'def.gear.resolve',
  'def.workbench.list_characters',
  'def.team.loadouts.read',
  'def.loadout.candidates.read',
  'def.team.loadout.plan.prepare',
  'def.workbench.damage_report',
  'def.damage.calculate',
  'def.damage.calculate_and_verify',
  'def.verify.damage_recalculated',
  'def.operator.config.read',
]);

const CANONICAL_TARGETS = Object.freeze({
  'def.worknode.create_from_current': 'def.node.crud.fork',
  'def.worknode.read': 'def.node.crud.read',
  'def.worknode.validate': 'def.node.crud.validate',
  'def.worknode.diff': 'def.node.crud.diff',
  'def.worknode.checkout': 'def.node.crud.use',
  'def.worknode.checkout_and_verify': 'def.node.crud.use',
  'def.worknode.restore_base': 'def.node.crud.restore',
  'def.worknode.restore_base_and_verify': 'def.node.crud.restore',
  'def.worknode.patch': 'def.node.code.apply_patch',
  'def.worknode.sync_workspace': 'def.node.code.apply_patch',
  'def.worknode.patch_and_validate': 'def.node.code.apply_patch',
  'def.worknode.copy_staff_line_and_verify': 'def.node.code.apply_patch',
  'def.buff.add_to_buttons': 'def.node.code.apply_patch',
  'def.user.ask': 'def.node.crud.request_approval',
  'def.user.record_answer': 'def.node.crud.record_approval',
  'def.approval.request': 'def.node.crud.request_approval',
  'def.approval.record_decision': 'def.node.crud.record_approval',
});

export const DEF_NATIVE_TARGETS = Object.freeze([
  { id: 'def.node.code.read', family: DEF_TOOL_FAMILY.NODE_CODE, source: 'opencode-native', nativeBinding: 'read', status: 'implemented', workspaceScope: 'child-node' },
  { id: 'def.node.code.edit', family: DEF_TOOL_FAMILY.NODE_CODE, source: 'opencode-native', nativeBinding: 'edit', status: 'implemented', workspaceScope: 'child-node' },
  { id: 'def.node.code.apply_patch', family: DEF_TOOL_FAMILY.NODE_CODE, source: 'opencode-native', nativeBinding: 'apply_patch', status: 'implemented', workspaceScope: 'child-node' },
  { id: 'def.node.code.materialize', family: DEF_TOOL_FAMILY.NODE_CODE, source: 'def-native', nativeBinding: 'def_node_code_materialize', status: 'implemented', workspaceScope: 'child-node' },
  { id: 'def.node.code.status', family: DEF_TOOL_FAMILY.NODE_CODE, source: 'def-native', nativeBinding: 'def_node_code_status', status: 'implemented', workspaceScope: 'child-node' },
  { id: 'def.node.code.rebuild', family: DEF_TOOL_FAMILY.NODE_CODE, source: 'def-native', nativeBinding: 'def_node_code_rebuild', status: 'implemented', workspaceScope: 'child-node' },
  { id: 'def.node.code.discard', family: DEF_TOOL_FAMILY.NODE_CODE, source: 'def-native', nativeBinding: 'def_node_code_discard', status: 'implemented', workspaceScope: 'child-node' },
  { id: 'def.node.crud.fork', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_fork', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.list', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_list', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.read', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_bind', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.context', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_workbench_context', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
  { id: 'def.node.crud.current', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_workbench_current_node', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
  { id: 'def.node.crud.buttons', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_workbench_buttons', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
  { id: 'def.node.crud.buff_ranking', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_workbench_buff_ranking', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
  { id: 'def.node.crud.update', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_sync_validate', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.delete', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_delete', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.validate', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_sync_validate', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.diff', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_diff', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.request_approval', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_use', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.record_approval', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_use', status: 'implemented', workspaceScope: 'node-store' },
  { id: 'def.node.crud.use', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_use', status: 'implemented', workspaceScope: 'current-checkout' },
  { id: 'def.node.crud.restore', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_node_restore', status: 'implemented', workspaceScope: 'current-checkout' },
  { id: 'def.data.resource.operator', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_operator', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.team_loadouts', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_team_loadouts', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.loadout_candidates', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_loadout_candidates', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.team_loadout_plan', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_team_loadout_plan', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.team.loadout.plan.revise', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_team_loadout_plan_revise', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
  { id: 'def.team.loadout.plan.apply', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_team_loadout_plan_apply', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
  { id: 'def.data.resource.operator_catalog', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_operator_catalog', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.operator_build_guide', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_operator_build_guide', status: 'implemented', workspaceScope: 'session-private' },
  { id: 'def.data.resource.operator_build_profile', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_operator_build_profile', status: 'implemented', workspaceScope: 'session-private' },
  { id: 'def.data.resource.combat_conventions', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_combat_conventions', status: 'implemented', workspaceScope: 'session-private' },
  { id: 'def.data.resource.game_knowledge', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_game_knowledge', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.game_knowledge_section', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_game_knowledge_section', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.weapon', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_weapon', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.weapon_fit_plan', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_weapon_fit_plan', status: 'implemented', workspaceScope: 'session-private' },
  { id: 'def.data.resource.equipment', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_equipment', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.native_catalog_materialize', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_native_catalog_materialize', status: 'implemented', workspaceScope: 'session-private' },
  { id: 'def.data.resource.equipment_3plus1_facts', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_equipment_3plus1_facts', status: 'implemented', workspaceScope: 'session-private' },
  { id: 'def.data.resource.equipment_3plus1_plan', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_equipment_3plus1_plan', status: 'implemented', workspaceScope: 'session-private' },
  { id: 'def.data.resource.skill', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_skill', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.buff', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_buff', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.data.resource.damage', family: DEF_TOOL_FAMILY.DATA_RESOURCE, source: 'def-native', nativeBinding: 'def_data_damage', status: 'implemented', workspaceScope: 'data-resource' },
  { id: 'def.operator.config.preview', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_operator_config_preview', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
  { id: 'def.operator.config.patch', family: DEF_TOOL_FAMILY.NODE_CRUD, source: 'def-native', nativeBinding: 'def_operator_config_patch', status: 'implemented', workspaceScope: 'current-checkout', exposure: ['workbench'] },
]);

function familyFor(id) {
  if (NODE_CODE_TOOLS.has(id)) return DEF_TOOL_FAMILY.NODE_CODE;
  if (DATA_RESOURCE_TOOLS.has(id)) return DEF_TOOL_FAMILY.DATA_RESOURCE;
  return DEF_TOOL_FAMILY.NODE_CRUD;
}

function dataTargetFor(id) {
  if (/native.*catalog|catalog.*native/.test(id)) return 'def.data.resource.native_catalog_materialize';
  if (/operator.*build.*guide|build.*guide.*operator/.test(id)) return 'def.data.resource.operator_build_guide';
  if (/operator.*build.*profile|build.*profile.*operator/.test(id)) return 'def.data.resource.operator_build_profile';
  if (/combat.*convention|convention.*combat/.test(id)) return 'def.data.resource.combat_conventions';
  if (/(?:equipment.*3plus1.*plan|3plus1.*plan.*equipment)/.test(id)) return 'def.data.resource.equipment_3plus1_plan';
  if (/equipment.*3plus1|3plus1.*equipment/.test(id)) return 'def.data.resource.equipment_3plus1_facts';
  if (/loadout.*candidate|candidate.*loadout/.test(id)) return 'def.data.resource.loadout_candidates';
  if (/loadout.*plan|plan.*loadout/.test(id)) return 'def.data.resource.team_loadout_plan';
  if (/team.*loadout|loadout.*team/.test(id)) return 'def.data.resource.team_loadouts';
  if (/knowledge.*section|section.*knowledge/.test(id)) return 'def.data.resource.game_knowledge_section';
  if (/knowledge/.test(id)) return 'def.data.resource.game_knowledge';
  if (/operator.*catalog|catalog.*operator/.test(id)) return 'def.data.resource.operator_catalog';
  if (/character|operator/.test(id)) return 'def.data.resource.operator';
  if (/weapon.*fit.*plan|fit.*plan.*weapon/.test(id)) return 'def.data.resource.weapon_fit_plan';
  if (/weapon/.test(id)) return 'def.data.resource.weapon';
  if (/equipment|gear/.test(id)) return 'def.data.resource.equipment';
  if (/skill/.test(id)) return 'def.data.resource.skill';
  if (/buff/.test(id)) return 'def.data.resource.buff';
  if (/damage/.test(id)) return 'def.data.resource.damage';
  return undefined;
}

function defaultCanonicalTarget(tool) {
  if (CANONICAL_TARGETS[tool.name]) return CANONICAL_TARGETS[tool.name];
  if (familyFor(tool.name) === DEF_TOOL_FAMILY.DATA_RESOURCE) return dataTargetFor(tool.name);
  if (tool.name.startsWith('def.verify.')) return 'def.node.crud.validate';
  if (tool.name.startsWith('def.tool.')) return 'def.node.crud.read';
  if (tool.name.startsWith('def.workbench.') || tool.name.startsWith('def.buff.') || tool.name.startsWith('def.target.')) {
    return tool.riskLevel === 'read' ? 'def.node.crud.read' : 'def.node.crud.update';
  }
  return tool.name;
}

function migrationStatus(tool, canonicalTarget) {
  if (canonicalTarget === tool.name) return 'canonical';
  if (NODE_CODE_TOOLS.has(tool.name)) return 'absorbed';
  if (tool.name.includes('_and_verify') || tool.name.startsWith('def.verify.')) return 'absorbed';
  return 'alias';
}

export function createDefToolRegistry(definitions) {
  const records = definitions.map((tool) => {
    const canonicalTarget = defaultCanonicalTarget(tool);
    const access = resolveDefToolAccessPolicy(tool.name, tool);
    return Object.freeze({
      ...tool,
      id: tool.name,
      family: familyFor(tool.name),
      source: 'legacy-adapter',
      schema: tool.inputSchema || { type: 'object' },
      handler: `executeDefTool:${tool.name}`,
      ...access,
      canonicalTarget,
      legacyAliases: [tool.name],
      legacyRoutes: [
        '/api/def-tools/call',
        `/api/def-tools/${encodeURIComponent(tool.name)}/call`,
      ],
      migrationStatus: migrationStatus(tool, canonicalTarget),
    });
  });
  assertDefToolRegistry(records);
  return Object.freeze(records);
}

export function assertDefToolRegistry(records) {
  const ids = new Set();
  const errors = [];
  for (const record of records) {
    if (!record?.id) errors.push('tool without id');
    if (ids.has(record.id)) errors.push(`duplicate tool id: ${record.id}`);
    ids.add(record.id);
    if (!Object.values(DEF_TOOL_FAMILY).includes(record.family)) errors.push(`tool without valid family: ${record.id}`);
    if (!record.canonicalTarget) errors.push(`tool without canonical target: ${record.id}`);
    if (!record.handler && !record.nativeBinding) errors.push(`tool without handler/native binding: ${record.id}`);
    if (!record.schema) errors.push(`tool without schema: ${record.id}`);
    if (!Array.isArray(record.legacyAliases) || record.legacyAliases.length === 0) errors.push(`tool without legacy alias: ${record.id}`);
    if (!Object.values(DEF_WORKSPACE_SCOPE).includes(record.workspaceScope)) errors.push(`tool without valid workspace scope: ${record.id}`);
    if (!Object.values(DEF_PROJECTION_ACCESS).includes(record.projectionAccess)) errors.push(`tool without valid projection access: ${record.id}`);
    if (!Array.isArray(record.allowedHosts) || record.allowedHosts.some((host) => !['workbench', 'ai-cli'].includes(host))) errors.push(`tool with invalid allowed hosts: ${record.id}`);
    if (!Array.isArray(record.exposure) || record.exposure.some((host) => !['workbench', 'ai-cli'].includes(host))) errors.push(`tool with invalid exposure: ${record.id}`);
    if ((record.projectionAccess === DEF_PROJECTION_ACCESS.CURRENT_READ || record.projectionAccess === DEF_PROJECTION_ACCESS.CURRENT_WRITE)
      && record.workspaceScope !== DEF_WORKSPACE_SCOPE.WORKBENCH_CURRENT
      && record.workspaceScope !== DEF_WORKSPACE_SCOPE.WORKNODE_TREE) errors.push(`current projection tool without current/tree scope: ${record.id}`);
    if (record.commandOp && record.riskLevel !== 'read' && record.projectionAccess !== DEF_PROJECTION_ACCESS.CURRENT_WRITE) errors.push(`mutation command tool without current-write access: ${record.id}`);
    if (record.internalOnly && record.exposure.length) errors.push(`internal tool exposed to model hosts: ${record.id}`);
    if (record.status === 'implemented' && !record.description) errors.push(`implemented tool without description: ${record.id}`);
  }
  if (errors.length) throw new Error(`Invalid DEF tool registry:\n${errors.join('\n')}`);
  return true;
}

export function buildDefToolRouteMap(records) {
  assertDefToolRegistry(records);
  const families = Object.values(DEF_TOOL_FAMILY).map((family) => ({
    id: family,
    legacyTools: records
      .filter((tool) => tool.family === family && tool.exposure.length > 0)
      .map((tool) => ({
        id: tool.id,
        description: tool.description,
        canonicalTarget: tool.canonicalTarget,
        schema: tool.schema,
        handler: tool.handler,
        workspaceScope: tool.workspaceScope,
        projectionAccess: tool.projectionAccess,
        allowedHosts: tool.allowedHosts,
        requiresCheckout: tool.requiresCheckout,
        riskLevel: tool.riskLevel,
        approval: tool.approval,
        verification: tool.verification,
        exposure: tool.exposure,
        legacyAliases: tool.legacyAliases,
        migrationStatus: tool.migrationStatus,
        legacyRoutes: tool.legacyRoutes,
        status: tool.status,
      })),
    nativeTargets: DEF_NATIVE_TARGETS.filter((tool) => tool.family === family),
  }));
  return {
    registryVersion: 1,
    families,
    diagnostics: {
      ok: true,
      legacyToolCount: records.length,
      modelExposedLegacyToolCount: records.filter((tool) => tool.exposure.length > 0).length,
      internalToolCount: records.filter((tool) => tool.internalOnly).length,
      nativeTargetCount: DEF_NATIVE_TARGETS.length,
      unclassified: [],
    },
  };
}
