# Spec 9 Implementation Map

## 状态

`PREPARED_NOT_DISPATCHABLE`

这份文件已经完成源码盘点和首轮分包设计。
它还不是编码分发凭证。

当前已知提交：

| 名称 | SHA | 结论 |
| --- | --- | --- |
| 规格预检父提交 | `70cdcd185da9b633c4ca3e4409d03b923cd80c0e` | Spec 9 分包方案的上一版文档提交 |
| 源码盘点基线 | `0a01c19fd67bb27f603d4cc596601bfbe394a4f3` | 本文符号、调用方和旧测试的盘点对象 |
| Session ownership 修复候选 | `c66875086fdae28ce80f64a065a450d02462015c` | 自动合同 PASS；人工 Windows 验收仍待最终结论 |
| `SOURCE_BASELINE_COMMIT` | `TBD` | 必须同时包含最新 Spec 9 与已验收修复 |
| `DISPATCH_COMMIT` | `TBD` | W0 在最终源基线上复核本文后产生 |

只要后两个 SHA 仍为 `TBD`，W1–W4 就不得开工。
当前文档提交也不得被误记为 `DISPATCH_COMMIT`。

## 一、真正的开工门

W0 必须按顺序完成：

1. 取得 `c668750` 的人工验收结论。
2. 若未通过，先合入它的后续修复。
3. 建立同时包含最新 Spec 9 和已验收修复的干净集成分支。
4. 把该点写为唯一 `SOURCE_BASELINE_COMMIT`。
5. 在该提交重新跑本文件第九节的基线命令。
6. 复核符号位置、文件锁和保护区。
7. 把本文状态改为 `READY_TO_DISPATCH`。
8. 提交最后一次 map 更新，并把新提交写为 `DISPATCH_COMMIT`。
9. W1–W4 全部从这个精确 SHA 建分支。

任一步失败都停在 W0。
不能先派一个智能体“试着写”。

## 二、当前链路与目标链路

### 2.1 当前模型编排

```text
def_data_operator_build_guide
  → 必要时 def_data_operator_build_profile
  → def_data_native_catalog_materialize
  → 未指定套装时 def_data_equipment_set_fit_shortlist
  → def_data_equipment_3plus1_facts
  → def_data_equipment_3plus1_plan
```

Guide fallback token、Profile capability、artifact id 和 source revision
都用于保护模型跨多次 Tool 调用搬运的数据。

### 2.2 目标模型调用

```text
Agent
  → def_data_equipment_3plus1_recommend
  → READY | NEEDS_INPUT | UNRESOLVED | typed Tool error
```

新 Service 在一次可信调用内读取 Guide、Profile 和 catalog。
它不铸造旧 token、capability 或 artifact。

## 三、Tool 身份与兼容结论

### 3.1 新能力固定身份

| 层 | 值 |
| --- | --- |
| Model Tool | `def_data_equipment_3plus1_recommend` |
| OpenCode export | `data_equipment_3plus1_recommend` |
| Sidecar route | `def.equipment.3plus1.recommend` |
| Canonical target | `def.data.resource.equipment_3plus1_recommend` |
| Scope | `session-private` |
| Risk | `read` |
| Approval | `none` |

### 3.2 旧 3+1 primitive

| Model Tool | OpenCode export | Sidecar route | Canonical target |
| --- | --- | --- | --- |
| `def_data_equipment_set_fit_shortlist` | `data_equipment_set_fit_shortlist` | `def.equipment.set_fit.shortlist` | `def.data.resource.equipment_set_fit_shortlist` |
| `def_data_equipment_3plus1_facts` | `data_equipment_3plus1_facts` | `def.equipment.3plus1.facts` | `def.data.resource.equipment_3plus1_facts` |
| `def_data_equipment_3plus1_plan` | `data_equipment_3plus1_plan` | `def.equipment.3plus1.plan` | `def.data.resource.equipment_3plus1_plan` |

本 Task 的结论是 `COMPATIBILITY_RETAINED`，不是 `internalized`。

原因不是猜测。
`agent/harness/baseline/stable-v0/**` 和已有 candidate package
仍引用这些名称。
Session 只固定 Harness，运行时代码只是 observed，并未被 pin。
提前删除 native target 或 export 会让旧 package 失去可调用能力。

W2 因此必须：

- 增加新 recommend 的 definition、target 和 export；
- 保留上表三个旧 definition、native target、export 和 route；
- 缩短旧 description，只标明 legacy compatibility；
- 不给旧入口增加别名、能力或新教学；
- 保持 authenticated registered native session 边界；
- 用 Tool surface contract 证明新旧身份没有互相吞并。

退出旧入口必须另开 activation 后任务，并同时满足：

1. 新 candidate 已由用户批准并 activation；
2. 不再支持引用旧名称的 Session/Harness，或已有迁移策略；
3. Tool reference contract 能区分 active 与历史 package；
4. 旧 Sidecar 合同已有最终保留或删除决定。

## 四、真实消费者盘点

| 位置 | 分类 | 本 Task 的处理 |
| --- | --- | --- |
| `agent/runtime/def-opencode-adapter/index.cjs` | 当前生产教学 | W3 在候选实现分支删除精确旧链 |
| `agent/runtime/def/skills/timeline-workbench/SKILL.md` | 当前生产教学 | W3 改为一次 recommend 与 typed state 解释 |
| `agent/harness/baseline/stable-v0/**` | immutable 运行时消费者 | 永久不改；因此旧 Tool 暂时保留 |
| `agent/harness/examples/candidate-v1/**` | 已有历史 candidate | 不改；不作为 Spec 9 candidate |
| `agent/harness/scenarios/equipment-3plus1-topology-v1.json` | 行为 Scenario | W3 改为每轮一次 recommend |
| `agent/harness/scenarios/equipment-3plus1-set-selection-v1.json` | 行为 Scenario | W3 改为每轮一次 recommend |
| `agent/harness/scenarios/operator-config-correction-review-v1.json` | 真实 3+1 correction Scenario | W3 原地迁移；不新建同义 Scenario |
| `scripts/def-harness-turn-routing-contract-test.mjs` | 通用失败路由 fixture | 保留旧 facts 名称作为兼容事件，不算生产 owner |
| `scripts/def-native-catalog-bridge-contract-test.mjs` | 旧 route 合同 | W1 保持原行为并改为复用 Domain |
| `agent/runtime/def-tools/opencode/def.js` | 模型适配 | W2 增加 recommend；旧 export 保留兼容 |
| `agent/runtime/def-tools/registry.mjs` | Tool 注册与暴露 | W2 增加 recommend；旧 target 保留兼容 |
| `agent/runtime/def-tools/definitions.mjs` | Sidecar 权威合同 | W2 增加 recommend；旧 definition 保留兼容 |
| `scripts/ai-cli-rest-server.mjs` | 当前 composition root 与领域算法副本 | W1 迁出算法，保留兼容 route adapter |

`user-correction-replan-v1.json` 是选人目录纠正。
它不是 3+1 Scenario，必须保持不变。

## 五、符号迁移

### 5.1 稳定值与共享 catalog 值

| 当前位置 | 新位置 | 迁移后旧调用方 |
| --- | --- | --- |
| `canonicalizeDefNativeCatalogValue` | `stable-json.mjs#canonicalizeDefStableValue` | equipment、weapon、Profile 统一导入 |
| `serializeDefNativeCatalogValue` | `stable-json.mjs#serializeDefStableValue` | 同上 |
| `hashDefNativeCatalogValue` | `stable-json.mjs#hashDefStableValue` | REST 只在公开边界补 `sha256:` |
| `nativeCatalogText` | `native-catalog-value.mjs#normalizeDefCatalogIdentity` | equipment Domain、legacy artifact 与 weapon adapter |
| `nativeCatalogSafeBusinessValue` | `native-catalog-value.mjs#projectDefCatalogSafeValue` | equipment Domain 与 REST weapon adapter |

`hashDefStableValue()` 必须保持当前 64 位小写十六进制输出。
Catalog revision、weapon revision 和 Profile hash 的既有字节结果必须回归一致。
`normalizeDefCatalogIdentity()` 必须保持当前 NFKC、字符清理、燃尽别名和套装后缀语义。
`projectDefCatalogSafeValue()` 必须保持 blocked key 集合与十层递归上限，
且不向调用方开放深度或 allowlist 覆盖参数。

### 5.2 Catalog 与实体解析

| 当前位置 | 新位置/导出 | 迁移策略 |
| --- | --- | --- |
| `readDefEquipmentLibrarySource` | REST port `readEquipmentLibrarySource` | 保留为只读 composition adapter |
| `readDefNativeGearSetAliasIndex` | REST port `readGearSetAliasIndex` | 保留为只读 composition adapter |
| `nativeEquipmentSlots` | `equipment-3plus1-domain.mjs` 私有 helper | 从 REST 移走 |
| `projectDefNativeEquipment` | Domain 私有 projection | 从 REST 移走 |
| `projectDefNativeGearSet` | Domain 私有 projection | 从 REST 移走 |
| `buildDefNativeCatalogSnapshot('equipment')` | `buildDefEquipmentCatalogSnapshot` | equipment 分支迁入 Domain |
| `buildDefNativeCatalogSnapshot('weapon')` | REST 中的 weapon wrapper | 保留；导入两个共享 utility |
| `resolveDefNativeEquipmentGearSet` | `resolveDefEquipmentGearSet` | alias index 改为显式参数 |
| 当前无统一 equipment resolver | `resolveDefEquipmentEntity` | 只从同一 snapshot 精确解析 required/excluded/compare |
| `buildDefNativeCatalogArtifact` | REST legacy adapter | equipment 调用 Domain snapshot；weapon 走保留 wrapper |

当前 `buildDefNativeCatalogSnapshot()` 同时处理 equipment 和 weapon。
W1 不得把整个函数搬进 3+1 Domain。
也不得让 weapon 反向导入 equipment Domain。

### 5.3 3+1 Domain

| 当前符号 | 新导出或归属 | 旧 route 适配 |
| --- | --- | --- |
| `buildDefEquipmentCatalogSource` | Domain snapshot/identity validation + REST revision adapter | 保留旧 sourceRevision 校验 |
| `buildDefEquipmentThreePlusOneSource` | Domain set resolver + REST capability adapter | 保留旧 capability 边界 |
| `buildDefEquipmentThreePlusOneTopologySummary` | Domain 私有 helper | facts/shortlist/plan 共用 |
| `buildDefEquipmentThreePlusOneFacts` | `buildDefEquipmentThreePlusOneFacts` | 旧 facts route 直接调用 |
| `normalizeDefEquipmentThreePlusOneProfile` | Domain 私有 input/profile normalizer | 旧 capability 在 REST 验证后传入 |
| `collectDefEquipmentTypedEffects` | Domain 私有 helper | 不在 REST 留副本 |
| `rankDefEquipmentFactsByProfile` | Domain 私有 helper | facts/set/plan 共用 |
| `buildDefEquipmentSetFitShortlist` | `buildDefEquipmentSetFitShortlist` | 旧 shortlist route 直接调用 |
| `defEquipmentSelectionAllowsDuplicates` | Domain 私有 helper | planner 共用 |
| `enumerateDefEquipmentSelections` | Domain 私有 helper | planner 共用 |
| `compareDefEquipmentThreePlusOneCandidates` | Domain 私有 comparator | planner 共用 |
| `isCloseDefEquipmentThreePlusOneAlternative` | Domain 私有 helper | planner 共用 |
| `buildDefEquipmentThreePlusOnePlan` | `buildDefEquipmentThreePlusOnePlan` | 旧 plan route 直接调用 |

旧 route 可以保留 token、capability、artifact 与 revision adapter。
它们不得保留第二份 topology、ranking 或 solver。

### 5.4 Guide 与 Profile

| 当前符号 | 新位置/导出 | 迁移后用途 |
| --- | --- | --- |
| `compactNonOverlappingOperatorBuildGroups` | `operator-build-evidence.mjs` 私有 helper | Guide compile 与 partial merge 共用 |
| `compactGuidePlannerProfile` | `compileGuidePlannerProfile` | Service 与旧 Guide route 共用 |
| `operatorRequiresCombatConvention` | 同名公开导出 | Service 与旧 Profile route 共用 |
| `mergePartialGuidePlannerProfile` | 同名公开导出，改为纯参数 | Service 与旧 Profile route 共用 |
| `hashDefOperatorBuildPlannerProfile` | `hashDefStableValue` adapter | 旧 capability hash 与新 evidence hash |
| `loadOperatorBuildGuideReferences` | REST port `loadGuideReferences` | 保留只读 adapter |
| `discoverDefOperatorBuildGuide` | REST legacy orchestration | 旧 Tool 继续使用 token/capability |
| `deriveDefOperatorBuildProfile` | REST legacy orchestration | 旧 Tool 继续使用 token/capability |

新 Service 直接调用 `discoverOperatorBuildGuides()`、exact section reader、
`compileGuidePlannerProfile()`、`deriveOperatorBuildProfile()` 和
`mergePartialGuidePlannerProfile()`。
它不调用两个 legacy orchestration 函数。

## 六、首轮文件锁

| 包 | 唯一可写范围 | 明确禁止 |
| --- | --- | --- |
| W1 Core + Service | `scripts/def-core/stable-json.mjs`、`native-catalog-value.mjs`、`equipment-3plus1-domain.mjs`、`equipment-3plus1-recommendation.mjs`、限定的 `operator-build-evidence.mjs`、限定的 REST、三个 W1 测试 | Tool surface、Prompt、Skill、Harness、Scenario、package、Work Node/approval/session 代码 |
| W2 Tool Surface | `definitions.mjs`、`registry.mjs`、`opencode/def.js` 的 evidence 区、W2 合同测试 | REST、Domain、Prompt、Harness、node/approval/materialize mutation export |
| W3 Runtime + Harness | Base Prompt 的 3+1 段、timeline-workbench Skill、全新 Spec 9 candidate、三个现有 3+1 Scenario、一个新 unresolved Scenario、两份结构测试、黑盒文档 | stable package、Tool、Service、Registry、AgentRelease、Session/Harness binding |
| W4 Teacher Audit | 开发侧 audit Skill、rubric、handoff、owner 样例 | 产品 Runtime Skill、Harness、Tool、Service、Prompt |

W1–W4 没有共享写文件。
W5 才能写 `package.json`、registration contract、本文最终状态与 `verification.md`。

## 七、Session ownership 修复保护区

最终基线若包含 `c668750`，下列区域视为不可回退：

| 文件 | 保护内容 | 约束 |
| --- | --- | --- |
| `agent/runtime/def-tools/opencode/def.js` | `workspaceId` 传递、`readBoundWorkspaceId()`、`node_bind`、`node_delete` | W2 只编辑 evidence Tool 区 |
| `scripts/ai-cli-rest-server.mjs` | session-owned node mirror、workspace gate、owner filter、delete postcondition | W1 只编辑 3+1 与 Guide/Profile 区 |
| `electron/timeline-repository.cjs` | schema v4 与 session owner table | 所有 Spec 9 包只读 |
| `scripts/def-worknode-session-delete-contract-test.mjs` | same-session delete 合同 | 所有首轮包只读；W5 回归 |
| `package.json` | `test:def-worknode-session-delete` | 只有 W5 可编辑，且不得删除 |

若 cherry-pick 出现上述文件冲突，不允许用整文件版本覆盖。
应停止并返回 `contractFindings`。

## 八、首轮固定握手

| 连接点 | 固定值 |
| --- | --- |
| Service module | `scripts/def-core/equipment-3plus1-recommendation.mjs` |
| Service entry | `createDefEquipment3Plus1RecommendationService(ports).recommend({ sessionId, turnId, input })` |
| Sidecar route | `def.equipment.3plus1.recommend` |
| Model Tool | `def_data_equipment_3plus1_recommend` |
| Canonical target | `def.data.resource.equipment_3plus1_recommend` |
| Success contract | `DefEquipmentThreePlusOneRecommendationV1` |
| Error contract | `DefEquipmentThreePlusOneRecommendationErrorV1` |
| Business states | `READY / NEEDS_INPUT / UNRESOLVED` |
| Candidate | `def-equipment-3plus1-composite@9.1.0-candidate.1` |

任何包发现这些连接点不可实现时，停止扩面并返回 `contractFindings`。
不能临时创造第二个 route、Schema 或 adapter。

## 九、已知基线结果

源码盘点基线为 `0a01c19`。
当前 Spec 分支在运行这些命令时只有文档提交，产品代码与该基线一致。

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run test:def-operator-build-planning` | PASS | combat conventions、Guide/Profile、native catalog 与旧 3+1 primitive 全通过 |
| `npm run test:def-model-instruction-tools` | PASS | 114 个 instruction source；41 个 callable DEF Tool |
| `npm run test:def-harness-guide-first` | PASS | 旧 guide-first 与 3+1 教学基线通过 |
| `npm run test:def-harness-scenario-verification` | PASS | turn/order/conditional/state 验证通过 |
| `npm run test:def-harness-turn-routing` | PASS | turn-level routing 通过 |
| `npm run interop:check` | PASS | Interop 静态检查通过 |
| `npm run harness:check` | PASS | Registry、AgentRelease、Tool reference、Prompt 与 Scenario 聚合检查通过 |
| `npm run test:def-native-catalog` | ENVIRONMENT_BLOCKED | Node bridge 断言 PASS；Bun artifact 阶段因当前 worktree 缺少 `zod` package 停止，不记为产品 FAIL |
| `npm run test:def-worknode-session-delete` | BASELINE_MISSING | `0a01c19` 尚无该 script，不能记为产品失败 |
| 同一命令在 `c668750` | PASS | 自动 same-session delete approval contract 通过 |
| Windows 真实 UI 手测 | PENDING | 之前测试路径被用户打断并要求纠正；尚不能验收修复 |

W0 在最终 `SOURCE_BASELINE_COMMIT` 至少重跑：

```text
npm run test:def-worknode-session-delete
npm run test:def-operator-build-planning
npm run test:def-model-instruction-tools
npm run test:def-harness-guide-first
npm run test:def-harness-scenario-verification
npm run test:def-harness-turn-routing
npm run interop:check
git diff --check
```

缺少 script、环境阻塞、断言失败必须分别记录。

## 十、每包独立开工判据

### W1

- 能看到最终修复后的 REST 文件。
- 新 Service 测试使用内存 ports，不依赖 W2。
- 旧 route 合同仍可单独运行。
- 不需要 Tool registry 才能验证 Domain。

### W2

- 新静态 Tool surface 测试不启动 REST。
- 新 recommend 与三个 legacy Tool 身份同时断言。
- 保留旧 target/export，因此现有 Tool reference contract 可独立通过。
- 不等待 W1 返回 Schema 名称；全部名称已由 Spec 冻结。

### W3

- 使用现有 `operator-config-correction-review-v1.json`，不再造重复 Scenario。
- 独立结构测试只验证 candidate 目标，不要求 W2 已修改 registry。
- 不运行完整 `harness:check` 作为本包硬门。
- 不修改 stable pointer，不 promotion。

### W4

- 三个固定 Finding 分别路由到 Tool Contract、Domain Service、Runtime Skill。
- 输出只改开发侧 Skill。
- 不依赖 W1–W3 的代码。

## 十一、集成与 activation 边界

W5 只做合并、registration contract、聚合命令和证据记录。
它不重写 W1–W4 的语义。

W6 从 W5 精确提交建立隔离测试 worktree，
只测试显式绑定新 candidate 的 fresh Session。
它不修改代码，也不 promotion。

W6 完成后，结果只能是：

- `READY_FOR_ACTIVATION_DECISION`；
- `NOT_READY`；
- `BLOCKED`。

不得直接写成“已经上线”。
Promotion、正式默认运行时切换和 legacy primitive 退休
都需要用户新的明确决定。

## 十二、分发信封

W1–W4 的提示词必须逐项写入：

```text
packageId:
sourceBaselineCommit:
dispatchCommit:
branch:
allowedFiles:
forbiddenRegions:
fixedHandshake:
independentTests:
deliveryEnvelope:
```

最终回传固定为：

```text
packageId:
sourceBaselineCommit:
dispatchCommit:
commit:
changedFiles:
tests:
  pass:
  fail:
  blocked:
contractFindings:
integrationNotes:
```

缺少 `sourceBaselineCommit` 或 `dispatchCommit` 的交付不进入 W5。
