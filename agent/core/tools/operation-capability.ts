import type {
  DefHarnessBusinessId,
  DefHarnessOperationId,
  JsonObject,
} from '../contracts/index.ts';

export type DefOperationCapabilityStatus =
  | 'available'
  | 'fact-only'
  | 'evidence-unavailable'
  | 'retired';

export type DefOperationCapabilityRoute = {
  readonly kind: 'tool' | 'command' | 'workflow' | 'pending';
  /** Stable canonical Tool/command/workflow name; never a prose description. */
  readonly name: string;
  /** Bounded action or phase selector when the route is a multi-action Tool. */
  readonly action?: string;
};

export type DefOperationCapability = {
  readonly contract: 'DefOperationCapabilityV1';
  readonly businessId: DefHarnessBusinessId;
  readonly operation: DefHarnessOperationId;
  readonly status: DefOperationCapabilityStatus;
  /** True only when this operation exposes a live product write. */
  readonly mutatesProduct: boolean;
  /** Operation-specific evidence boundary, not a generic success claim. */
  readonly reason: string;
  /** Backward-compatible stable operation id for a safe alternative. */
  readonly replacement: string | null;
  /** Actual route(s) that implement the declared status. */
  readonly implementationRoute: readonly DefOperationCapabilityRoute[];
  /** Route(s) the caller can use when this operation is limited or retired. */
  readonly replacementRoute: readonly DefOperationCapabilityRoute[];
  readonly evidencePolicy: 'browser-1.8-facts-only';
  readonly legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact';
};

type CapabilitySeed = Omit<
  DefOperationCapability,
  'contract' | 'businessId' | 'operation' | 'evidencePolicy' | 'legacyGuidePolicy'
>;

const TOOL = {
  context: 'def.node.crud.context',
  loadouts: 'def.data.resource.team_loadouts',
  current: 'def.node.crud.current',
  buff: 'def.data.resource.buff',
  damage: 'def.data.resource.damage',
  capability: 'def.capability.status',
  catalog: 'def.data.catalog.query',
  selectionApply: 'def.team.selection.apply',
  addSkill: 'def.workbench.add_skill_button',
  removeSkill: 'def.workbench.remove_skill_button',
  addBuff: 'def.buff.add_to_button',
  removeBuff: 'def.buff.remove_from_button',
  patch: 'def.worknode.patch_and_validate',
  worknodeList: 'def.worknode.list',
  worknodeRead: 'def.worknode.read',
  worknodeDiff: 'def.worknode.diff',
  worknodeValidate: 'def.worknode.validate',
  worknodeDelete: 'def.worknode.delete',
  worknodeUse: 'def.worknode.use',
  worknodeRestore: 'def.worknode.restore',
  loadoutPreview: 'def.loadout.preview',
  loadoutApplyPrepared: 'def.loadout.apply_prepared',
} as const;

const COMMAND = {
  loadoutPreview: 'prepareOperatorConfigProposal',
  loadoutApply: 'applyPreparedOperatorConfigProposal',
  preparedPatch: 'prepareReviewedWorkNodeProposal',
  checkout: 'checkoutAiTimelineWorkNode',
  deleteWorkNode: 'deleteAiTimelineWorkNode',
} as const;

function tool(name: string, action?: string): DefOperationCapabilityRoute {
  return action === undefined ? { kind: 'tool', name } : { kind: 'tool', name, action };
}

function command(name: string, action?: string): DefOperationCapabilityRoute {
  return action === undefined ? { kind: 'command', name } : { kind: 'command', name, action };
}

function available(
  reason: string,
  implementationRoute: readonly DefOperationCapabilityRoute[],
  mutatesProduct = false,
): CapabilitySeed {
  return {
    status: 'available',
    mutatesProduct,
    reason,
    replacement: null,
    implementationRoute,
    replacementRoute: [],
  };
}

function limited(
  status: Exclude<DefOperationCapabilityStatus, 'available'>,
  reason: string,
  replacement: string,
  implementationRoute: readonly DefOperationCapabilityRoute[],
  replacementRoute: readonly DefOperationCapabilityRoute[],
): CapabilitySeed {
  return {
    status,
    mutatesProduct: false,
    reason,
    replacement,
    implementationRoute,
    replacementRoute,
  };
}

const ENTRIES = {
  selection: {
    inspect: available(
      '读取当前绑定快照中的已选干员与顺序，来源是浏览器产品上下文。',
      [tool(TOOL.context)],
    ),
    search: available(
      '通过浏览器 1.8 operator catalog 查询干员事实；空队伍不会被当成目录为空。',
      [tool(TOOL.catalog, 'query')],
    ),
    add: available(
      '将解析后的最终队伍交给选队伍 Tool，由受审阅 Selection Work Node 创建候选并在审批后检出。',
      [tool(TOOL.selectionApply), command(COMMAND.preparedPatch, 'selection.add')],
      true,
    ),
    remove: available(
      '将移除后的精确最终队伍交给 selectCharacters，其他成员与顺序由产品后置条件校验。',
      [tool(TOOL.selectionApply), command(COMMAND.preparedPatch, 'selection.remove')],
      true,
    ),
    replace: available(
      '将同时解析出入成员后的精确队伍交给 selectCharacters，并要求用户审批。',
      [tool(TOOL.selectionApply), command(COMMAND.preparedPatch, 'selection.replace')],
      true,
    ),
    reorder: available(
      'selectCharacters 接受有序最终队伍，产品后置条件会保留成员集合并核对新顺序。',
      [tool(TOOL.selectionApply), command(COMMAND.preparedPatch, 'selection.reorder')],
      true,
    ),
    analyze: limited(
      'fact-only',
      '当前 buildGuide 只能返回目录事实和证据边界，不能证明最优队伍、强度或排名。',
      'selection.search',
      [tool(TOOL.catalog, 'buildGuide')],
      [tool(TOOL.context), tool(TOOL.catalog, 'query')],
    ),
    apply: available(
      '将用户确认的精确最终队伍交给 selectCharacters，并验证队伍快照与工作节点后置条件。',
      [tool(TOOL.selectionApply), command(COMMAND.preparedPatch, 'selection.apply')],
      true,
    ),
  },
  loadout: {
    inspect: available(
      '读取每名已选干员的武器、装备、套装效果和技能等级，并保留缺失配置事实。',
      [tool(TOOL.loadouts, 'current')],
    ),
    evaluate: available(
      '由 Host 注入绑定的 DefTeamLoadoutsV1 当前配装，并按浏览器 1.8 canonical fact-key 覆盖进行确定性评价；结果明确不是伤害模拟。',
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'evaluateLoadout')],
    ),
    resolve: available(
      '先读取当前配装，再用浏览器 1.8 catalog 解析武器、装备和套装身份，不生成主观推荐。',
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'query')],
    ),
    recommend: available(
      '按当前 1.8 干员、技能、武器和装备类型键生成有证据路径的确定性覆盖排名，并保留 PARTIAL/TIED 边界。',
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'recommendLoadout')],
    ),
    recommend_named_set: available(
      '枚举指定套装所有合法 3+1 结构，并按当前干员的 canonical fact-key 覆盖进行确定性排名。',
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'recommendNamedSet')],
    ),
    recommend_discovered_set: available(
      '遍历当前目录中的合法 3+1 套装并按确定性类型键覆盖排名，同时公开遍历上限和是否穷尽。',
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'recommendDiscoveredSets')],
    ),
    recommend_weapon: available(
      '只对武器类型精确相符的 1.8 目录项进行 canonical fact-key 覆盖排名，未知或歧义身份不会获得分数。',
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'recommendWeapons')],
    ),
    recommend_equipment: limited(
      'retired',
      '旧 v4 的 equipment 推荐别名已退役；现行能力不能把目录事实包装成装备推荐。',
      'loadout.resolve',
      [],
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'query')],
    ),
    compare: available(
      '以同一 Host 注入的当前配装为基线，只接受稳定武器/装备 ID 候选，并比较双方确定性类型键覆盖。',
      [tool(TOOL.loadouts, 'current'), tool(TOOL.catalog, 'compareLoadoutCandidates')],
    ),
    preview: available(
      '用 exact operator config 创建隔离 Work Node 预览；它不改变当前 live checkout。',
      [tool(TOOL.loadoutPreview), command(COMMAND.loadoutPreview)],
    ),
    apply: available(
      '只应用同一已持久化 proposal 的 parent、node、revision 和 digest，并由产品验证后置条件。',
      [tool(TOOL.loadoutApplyPrepared), command(COMMAND.loadoutApply)],
      true,
    ),
    restore: limited(
      'retired',
      'loadout-only restore 会覆盖无关 Timeline、Buff 和队伍状态，当前没有安全的独立恢复语义。',
      'loadout.preview+loadout.apply',
      [],
      [tool(TOOL.loadoutPreview), tool(TOOL.loadoutApplyPrepared)],
    ),
  },
  timeline: {
    current: available(
      '读取当前排轴 checkout、timeline 身份和稳定技能按钮坐标，不创建草稿。',
      [tool(TOOL.current)],
    ),
    inspect: available(
      '读取当前排轴并按明确 nodeId 查询 Work Node 列表和内容，不隐式切换 checkout。',
      [tool(TOOL.current), tool(TOOL.worknodeList), tool(TOOL.worknodeRead)],
    ),
    add: available(
      '先由 skillFact 确认技能身份，再通过 add_skill_button 和受审阅 patch 节点写入。',
      [tool(TOOL.addSkill), command(COMMAND.preparedPatch, 'timeline.add')],
      true,
    ),
    remove: available(
      '通过 remove_skill_button 生成完整稳定按钮删除集，再经受审阅 patch 节点写入。',
      [tool(TOOL.removeSkill), command(COMMAND.preparedPatch, 'timeline.remove')],
      true,
    ),
    move: available(
      '由 patch_and_validate 的 moveButton 变更完成隔离校验，并核对精确坐标后置条件。',
      [tool(TOOL.patch), command(COMMAND.preparedPatch, 'timeline.patch')],
      true,
    ),
    replace: available(
      '由 trusted skillFact 提供身份，再通过 patch_and_validate 的 replaceButton 保留未请求字段。',
      [tool(TOOL.patch), command(COMMAND.preparedPatch, 'timeline.patch')],
      true,
    ),
    copy: available(
      '通过 patch_and_validate 的 copyButton 在隔离节点中复制按钮并校验目标坐标。',
      [tool(TOOL.patch), command(COMMAND.preparedPatch, 'timeline.patch')],
      true,
    ),
    validate: available(
      '由 worknode.validate 对明确 Work Node 执行只读 schema 校验，不改 live checkout。',
      [tool(TOOL.worknodeRead), tool(TOOL.worknodeValidate)],
    ),
    delete_node: available(
      '先读取完整子树并绑定目标 revision、节点数和子树摘要；审批后仅删除该精确且未被 checkout 的 Work Node 子树，数据库事务会再次校验全部节点版本。',
      [tool(TOOL.worknodeRead), tool(TOOL.worknodeDelete), command(COMMAND.deleteWorkNode)],
      true,
    ),
    preview: available(
      '由 worknode.diff 读取隔离候选节点的语义差异；结果不冒充 live checkout 预览。',
      [tool(TOOL.worknodeDiff)],
    ),
    apply: available(
      '由 worknode.use 在审批后 checkout 明确且已校验的 Work Node，并验证可见排轴后置条件。',
      [tool(TOOL.worknodeUse), command(COMMAND.checkout)],
      true,
    ),
    restore: available(
      '由 def.worknode.restore 创建只包含 timeline.structure 语义范围的受审阅候选，审批后通过 prepared Work Node 命令应用。',
      [tool(TOOL.worknodeRestore), command(COMMAND.preparedPatch, 'timeline.restore')],
      true,
    ),
  },
  buff: {
    inspect: available(
      '读取当前按钮的 Buff 覆盖、层数、禁用段、来源和证据状态。',
      [tool(TOOL.current), tool(TOOL.buff, 'coverage')],
    ),
    resolve: available(
      '只解析绑定快照中存在的 Buff 事实，并显式保留歧义或证据不可用状态。',
      [tool(TOOL.current), tool(TOOL.buff, 'resolve')],
    ),
    source: available(
      '按精确按钮和 query 追溯 Buff owner、来源、条件及层数语义，不猜测歧义候选。',
      [tool(TOOL.current), tool(TOOL.buff, 'source')],
    ),
    add: available(
      '先用 Buff resolve 绑定事实，再由 add_to_button 通过受审阅 patch 节点挂载。',
      [tool(TOOL.addBuff), command(COMMAND.preparedPatch, 'buff.add')],
      true,
    ),
    remove: available(
      '由 remove_from_button 解析唯一 Buff 身份和层数，再通过受审阅节点删除。',
      [tool(TOOL.removeBuff), command(COMMAND.preparedPatch, 'buff.remove')],
      true,
    ),
    replace: available(
      '先解析替换 Buff，再由 patch_and_validate 的 replaceBuff 保留未请求的层数和目标语义。',
      [tool(TOOL.patch), command(COMMAND.preparedPatch, 'buff.replace')],
      true,
    ),
    batch: available(
      '通过 patch_and_validate 将完整 Buff 批次作为一个隔离事务校验和提交。',
      [tool(TOOL.patch), command(COMMAND.preparedPatch, 'buff.batch')],
      true,
    ),
    stack: available(
      '通过 patch_and_validate 的 setBuffStack 只改变明确 Buff 的层数，并验证结果。',
      [tool(TOOL.patch), command(COMMAND.preparedPatch, 'buff.stack')],
      true,
    ),
    coverage: available(
      '由 Buff coverage 返回按按钮、来源、条件、目标和有效层数组织的绑定快照事实。',
      [tool(TOOL.current), tool(TOOL.buff, 'coverage')],
    ),
    apply: available(
      '由 worknode.use 在审批后 checkout 已审阅 Buff Work Node，并校验附件和 checkout。',
      [tool(TOOL.worknodeUse), command(COMMAND.checkout)],
      true,
    ),
    restore: available(
      '由 def.worknode.restore 创建只包含 buff.attachments 或 buff.resistance 的受审阅候选，审批后通过 prepared Work Node 命令应用。',
      [tool(TOOL.worknodeRestore), command(COMMAND.preparedPatch, 'buff.restore')],
      true,
    ),
  },
  calculation: {
    calculate: available(
      '读取浏览器生成的当前 DefDamageReport，不在 Harness 中重算公式。',
      [tool(TOOL.context), tool(TOOL.damage, 'current')],
    ),
    aggregate: available(
      '读取产品生成的聚合伤害结果，并保留按钮和干员归因。',
      [tool(TOOL.context), tool(TOOL.damage, 'aggregate')],
    ),
    compare: available(
      '对兼容的两个 DefDamageReport capsule 读取确定性字段差异，不裁定主观优劣。',
      [tool(TOOL.context), tool(TOOL.damage, 'compare')],
    ),
    attribute: available(
      '读取产品报告中的 hit、抗性、Buff 和乘区归因，不在 Harness 重建计算。',
      [tool(TOOL.context), tool(TOOL.damage, 'attribute')],
    ),
    diagnose: available(
      '区分产品报告缺失、格式错误和可读状态，不修补或写入计算公式。',
      [tool(TOOL.context), tool(TOOL.damage, 'diagnose')],
    ),
    export: available(
      '将当前绑定的 typed damage report 导出为受限 JSON/table 结果，不创建无追踪文件。',
      [tool(TOOL.context), tool(TOOL.damage, 'export')],
    ),
    explain: available(
      '解释产品报告中已有的数值、抗性和乘区，不补造未被报告证明的字段。',
      [tool(TOOL.context), tool(TOOL.damage, 'explain')],
    ),
    skill_fact: available(
      '从 operator-scoped catalog 读取可信技能和 hit fact，保留 READY、AMBIGUOUS 等状态。',
      [tool(TOOL.catalog, 'skillFact')],
    ),
  },
} as const satisfies Readonly<Partial<Record<DefHarnessBusinessId, Readonly<Partial<Record<DefHarnessOperationId, CapabilitySeed>>>>>>;

const STATUS_ORDER = ['available', 'fact-only', 'evidence-unavailable', 'retired'] as const;

function countStatuses(): Record<DefOperationCapabilityStatus, number> {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<DefOperationCapabilityStatus, number>;
  for (const operations of Object.values(ENTRIES)) {
    for (const entry of Object.values(operations)) {
      counts[entry.status] += 1;
    }
  }
  return counts;
}

export const DEF_OPERATION_CAPABILITY_COUNT = Object.values(ENTRIES)
  .reduce((count, operations) => count + Object.keys(operations).length, 0);

/** Stable audit result for 50 parity operations plus one safe admin route. */
export const DEF_OPERATION_CAPABILITY_STATUS_COUNTS: Readonly<Record<DefOperationCapabilityStatus, number>> = Object.freeze(countStatuses());

function materialize(
  businessId: DefHarnessBusinessId,
  operation: DefHarnessOperationId,
  entry: CapabilitySeed,
): DefOperationCapability {
  return {
    contract: 'DefOperationCapabilityV1',
    businessId,
    operation,
    ...entry,
    evidencePolicy: 'browser-1.8-facts-only',
    legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact',
  };
}

export function readDefOperationCapability(
  businessId: DefHarnessBusinessId,
  operation: DefHarnessOperationId,
): DefOperationCapability | null {
  const operations = ENTRIES[businessId as keyof typeof ENTRIES] as
    | Readonly<Partial<Record<DefHarnessOperationId, CapabilitySeed>>>
    | undefined;
  const entry = operations?.[operation];
  return entry ? materialize(businessId, operation, entry) : null;
}

export function listDefOperationCapabilities(): readonly DefOperationCapability[] {
  return Object.entries(ENTRIES).flatMap(([businessId, operations]) => (
    Object.entries(operations).map(([operation, entry]) => materialize(
      businessId as DefHarnessBusinessId,
      operation as DefHarnessOperationId,
      entry,
    ))
  ));
}

export function operationCapabilityJson(
  businessId: DefHarnessBusinessId,
  operation: DefHarnessOperationId,
): JsonObject {
  const capability = readDefOperationCapability(businessId, operation);
  if (capability) return { ...capability } as unknown as JsonObject;
  return {
    contract: 'DefOperationCapabilityV1',
    businessId,
    operation,
    status: 'retired',
    mutatesProduct: false,
    reason: '该业务 operation 不在当前 1.8 能力目录中，因此没有可写实现；只能查询 capability.status。',
    replacement: 'capability.status',
    implementationRoute: [],
    replacementRoute: [tool(TOOL.capability)],
    evidencePolicy: 'browser-1.8-facts-only',
    legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact',
  } as unknown as JsonObject;
}
