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

export type DefOperationCapability = {
  readonly contract: 'DefOperationCapabilityV1';
  readonly businessId: DefHarnessBusinessId;
  readonly operation: DefHarnessOperationId;
  readonly status: DefOperationCapabilityStatus;
  readonly mutatesProduct: boolean;
  readonly reason: string;
  readonly replacement: string | null;
  readonly evidencePolicy: 'browser-1.8-facts-only';
  readonly legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact';
};

type CapabilitySeed = Omit<
  DefOperationCapability,
  'contract' | 'businessId' | 'operation' | 'evidencePolicy' | 'legacyGuidePolicy'
>;

const AVAILABLE_READ: CapabilitySeed = {
  status: 'available',
  mutatesProduct: false,
  reason: '该操作可由当前浏览器 1.8 产品事实确定性完成。',
  replacement: null,
};

const AVAILABLE_WRITE: CapabilitySeed = {
  status: 'available',
  mutatesProduct: true,
  reason: '该操作通过受审阅的 Work Node 或原子产品命令完成。',
  replacement: null,
};

function seed(
  status: DefOperationCapabilityStatus,
  reason: string,
  replacement: string | null,
  mutatesProduct = false,
): CapabilitySeed {
  return { status, reason, replacement, mutatesProduct };
}

const ENTRIES = {
  selection: {
    inspect: AVAILABLE_READ,
    search: AVAILABLE_READ,
    add: AVAILABLE_WRITE,
    remove: AVAILABLE_WRITE,
    replace: AVAILABLE_WRITE,
    reorder: AVAILABLE_WRITE,
    analyze: seed('fact-only', '只分析当前 roster 与 1.8 目录事实；不提供无依据的最优队伍结论。', 'selection.inspect + catalog facts'),
    apply: AVAILABLE_WRITE,
  },
  loadout: {
    inspect: AVAILABLE_READ,
    evaluate: seed('evidence-unavailable', '可以检查配置完整性和兼容性，但 1.8 浏览器事实中没有经验证的强度评价依据。', 'loadout.inspect + loadout.resolve'),
    resolve: AVAILABLE_READ,
    recommend: seed('evidence-unavailable', '1.8 浏览器事实中没有经验证的 build-guide，不能给出主观最佳配装。', 'loadout.resolve'),
    recommend_named_set: seed('fact-only', '只规划指定套装的合法 3+1 结构，不声明适配度或强度排名。', 'gearTopologyPlan'),
    recommend_discovered_set: seed('fact-only', '只枚举目录中结构合法的 3+1 候选，不声明适配度或强度排名。', 'discoverGearTopologies'),
    recommend_weapon: seed('fact-only', '只列出武器类型兼容项，不生成推荐分数或排名。', 'compatibleWeapons'),
    recommend_equipment: seed('retired', '旧稳定 v4 已退役该兼容别名；继续暴露会把目录事实误表述为主观推荐。', 'loadout.resolve'),
    compare: seed('fact-only', '只比较双方可核验字段；没有依据时不裁定强弱。', 'compareLoadoutFacts'),
    preview: AVAILABLE_READ,
    apply: AVAILABLE_WRITE,
    restore: seed('retired', '旧稳定 v4 明确不支持 loadout-only restore；整 Work Node 恢复会越权覆盖 Timeline、Buff 或队伍。', null),
  },
  timeline: {
    current: AVAILABLE_READ,
    inspect: AVAILABLE_READ,
    add: AVAILABLE_WRITE,
    remove: AVAILABLE_WRITE,
    move: AVAILABLE_WRITE,
    replace: AVAILABLE_WRITE,
    copy: AVAILABLE_WRITE,
    validate: AVAILABLE_READ,
    preview: AVAILABLE_READ,
    apply: AVAILABLE_WRITE,
    restore: AVAILABLE_WRITE,
  },
  buff: {
    inspect: AVAILABLE_READ,
    resolve: AVAILABLE_READ,
    source: AVAILABLE_READ,
    add: AVAILABLE_WRITE,
    remove: AVAILABLE_WRITE,
    replace: AVAILABLE_WRITE,
    batch: AVAILABLE_WRITE,
    stack: AVAILABLE_WRITE,
    coverage: AVAILABLE_READ,
    apply: AVAILABLE_WRITE,
    restore: AVAILABLE_WRITE,
  },
  calculation: {
    calculate: AVAILABLE_READ,
    aggregate: AVAILABLE_READ,
    compare: AVAILABLE_READ,
    attribute: AVAILABLE_READ,
    diagnose: AVAILABLE_READ,
    export: AVAILABLE_READ,
    explain: AVAILABLE_READ,
    skill_fact: AVAILABLE_READ,
  },
} as const satisfies Readonly<Partial<Record<DefHarnessBusinessId, Readonly<Partial<Record<DefHarnessOperationId, CapabilitySeed>>>>>>;

export const DEF_OPERATION_CAPABILITY_COUNT = Object.values(ENTRIES)
  .reduce((count, operations) => count + Object.keys(operations).length, 0);

export function readDefOperationCapability(
  businessId: DefHarnessBusinessId,
  operation: DefHarnessOperationId,
): DefOperationCapability | null {
  const operations = ENTRIES[businessId as keyof typeof ENTRIES] as
    | Readonly<Partial<Record<DefHarnessOperationId, CapabilitySeed>>>
    | undefined;
  const entry = operations?.[operation];
  if (!entry) return null;
  return {
    contract: 'DefOperationCapabilityV1',
    businessId,
    operation,
    ...entry,
    evidencePolicy: 'browser-1.8-facts-only',
    legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact',
  };
}

export function listDefOperationCapabilities(): readonly DefOperationCapability[] {
  return Object.entries(ENTRIES).flatMap(([businessId, operations]) => (
    Object.keys(operations).map((operation) => readDefOperationCapability(
      businessId as DefHarnessBusinessId,
      operation as DefHarnessOperationId,
    )!)
  ));
}

export function operationCapabilityJson(
  businessId: DefHarnessBusinessId,
  operation: DefHarnessOperationId,
): JsonObject {
  const capability = readDefOperationCapability(businessId, operation);
  return capability ? { ...capability } : {
    contract: 'DefOperationCapabilityV1',
    businessId,
    operation,
    status: 'retired',
    mutatesProduct: false,
    reason: '该业务 operation 不在当前 1.8 能力目录中。',
    replacement: null,
    evidencePolicy: 'browser-1.8-facts-only',
    legacyGuidePolicy: 'legacy-1.2-guide-not-treated-as-1.8-fact',
  };
}
