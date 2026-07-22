# Task 9-1：收口 3+1 职责并接通训练返修

## 状态

待实施。

本 Task 是 [Spec 9](./spec.md) 的唯一实施任务。
允许按检查点分批编码、验证和提交。

规格基线为 `codex/merge-main-code-bloat-20260722@0a01c19`。
实际开工时必须从包含本 Spec/Task 的最新已同意集成提交分支，并在 `verification.md` 记录准确 baseline。

Task 完成必须同时交付：

1. 真实职责清单；
2. 一个复合 3+1 只读 Tool；
3. Service 内部的确定阶段；
4. 旧 Prompt、Skill、Harness 和 Tool description 规则删除；
5. 开发侧审计 Skill 的 owner 路由；
6. 合同、Scenario 与桌面黑盒证据。

## 一、开工边界

### 1.1 开工前必读

- `AGENTS.md`；
- `docs/testing/def-agent-blackbox.md`；
- 本目录的 `research.md` 与 `spec.md`；
- `docs/architecture/audits/def-agent-training-root-cause-20260721.md`；
- `docs/architecture/audits/def-agent-architecture-conflict-map-20260722.md`；
- `.agents/skills/harness-audit-assistant/SKILL.md` 及其两份 reference；
- 当前 3+1 Tool、Service、Harness、Skill 和 Scenario 实现。

### 1.2 Git 与数据边界

- 从已合并的干净基线创建独立 `codex/` 分支；
- 先记录 `git status --short --branch`；
- 保护用户已有改动；
- 不读取、修改或清理用户正式 SQLite；
- 不复用历史失败 session；
- 不向旧 Harness Registry package 原地写入；
- 不修改 `agent/vendor/opencode`；
- 不 push；
- 每个完成的 coding/fix checkpoint 按 `AGENTS.md` 自动提交。

### 1.3 本 Task 不做

- 不建设通用 orchestrator、Task Runtime 或 DSL；
- 不修改 mutation gateway；
- 不扩展到武器、攻略团队或 timeline authoring；
- 不处理独立 MCP；
- 不自动 promotion Harness；
- 不用 Prompt 兼容旧 3+1 链路。

## 二、完成定义

以下条件缺一不可：

- [ ] Workbench 中的自然语言 3+1 请求只需要一次 `def_data_equipment_3plus1_recommend`；
- [ ] guide/profile/catalog/set/facts/plan 在 Service 内部完成；
- [ ] 指定套装和未指定套装均支持；
- [ ] `READY / NEEDS_INPUT / UNRESOLVED` 有稳定合同；
- [ ] 失败包含 `failureStage / retryable / nextAction`；
- [ ] correction 不复用旧 capability、artifact 或 plan；
- [ ] 3+1 全程只读，前后产品状态一致；
- [ ] 原子 3+1 Tool 的保留或退出有调用方证据；
- [ ] Base Prompt 不再教授 3+1 内部顺序；
- [ ] Runtime Skill 只保留识别与解释；
- [ ] 新 Harness package 不复制内部顺序；
- [ ] Tool description 不保存算法；
- [ ] 审计报告必须选择唯一主要 owner；
- [ ] 原问题、相邻只读能力和 mutation 安全边界均有验证；
- [ ] `verification.md` 如实记录通过、失败、阻塞和未覆盖；
- [ ] 代码与文档已经自动提交，未 push。

## 三、Checkpoint A：冻结现状与职责清单

### A1. 记录当前调用链

- [ ] 用 `rg` 列出 3+1 规则在以下位置的全部副本：
  - `agent/runtime/def-opencode-adapter/index.cjs`；
  - `agent/runtime/def/skills/timeline-workbench/SKILL.md`；
  - `agent/harness/baseline/stable-v0/**`；
  - 现有 candidate/example Harness；
  - `agent/runtime/def-tools/definitions.mjs`；
  - `agent/runtime/def-tools/opencode/def.js`；
  - `agent/runtime/def-tools/registry.mjs`；
  - `agent/runtime/def-opencode-adapter/agent-release.cjs`；
  - `scripts/ai-cli-rest-server.mjs`；
  - `scripts/def-core/**`；
  - `agent/harness/scenarios/**`；
  - `docs/testing/def-agent-blackbox.md`。
- [ ] 区分运行时副本、测试断言和说明文档；测试断言不算生产 owner。
- [ ] 记录每个现有 Tool 的模型可见名称、Sidecar route、输入、输出、风险、scope 和 handler。
- [ ] 记录 3+1 当前全部模型可见调用次数与 token/capability 传递点。

### A2. 盘点真实消费者

- [ ] 搜索以下 Tool 的所有生产、测试和文档调用方：
  - `def_data_equipment_set_fit_shortlist`；
  - `def_data_equipment_3plus1_facts`；
  - `def_data_equipment_3plus1_plan`。
- [ ] 对每个调用方标记 `production / test / documentation / none`。
- [ ] 只有测试或旧 3+1 文本引用时，计划取消 Workbench model exposure。
- [ ] 若存在独立生产消费者，记录保留原因与退出条件；不得凭猜测隐藏。

### A3. 固化 owner

- [ ] 以 `spec.md` 第三节为唯一职责表；若真实结构不同，先更新规格并说明原因。
- [ ] 为 3+1 写出下面七条 owner 记录：
  - 干员与攻略/Profile：Service 调用 Knowledge；
  - catalog snapshot/revision：Service；
  - 套装解析/筛选：Service；
  - topology/duplicate policy：Service；
  - 排序、缺失、歧义：Service；
  - 模型输入/输出合同：Tool；
  - 任务识别与用户解释：Runtime Skill。
- [ ] 明确 Base Prompt、Harness 和 Host 不拥有上述算法。

### A4. 基线证据

- [ ] 保存现有合同测试结果。
- [ ] 保存 `equipment-3plus1-topology-v1` 与 `equipment-3plus1-set-selection-v1` 当前期望。
- [ ] 记录当前模型可见 3+1 Tool 链长度。
- [ ] 记录只读前后 checkout、pending approval 与 state hash。

### A5. 写出实施映射

- [ ] 新建本目录下的 `implementation-map.md`。
- [ ] 为下列现有私有函数记录 `现位置 → 新模块/导出 → 旧调用方`：
  - catalog canonicalize/hash/project/snapshot；
  - set 与 equipment stable-id resolution；
  - topology/facts；
  - set-fit shortlist；
  - 3+1 planner；
  - Guide Profile compile、convention-required 判定与 partial Profile merge。
- [ ] 明确 `discoverDefOperatorBuildGuide` 与 `deriveDefOperatorBuildProfile` 的旧 token/capability 路径只服务保留的原子 Tool。
- [ ] 明确复合 Service 直接消费冻结的可信对象，不使用模型中转 token、capability 或 artifact。
- [ ] 为每个高冲突文件指定一个实施工作包 owner。

### A 完成口径

- [ ] 任何实施者都能从清单中指出一条规则当前在哪里、迁移到哪里、旧副本怎样退出。
- [ ] 不因开始编码而丢失旧调用方或兼容边界。

## 四、Checkpoint B：建立复合 Tool 合同

### B1. Tool 注册

- [ ] 按下面的固定映射登记模型可见能力：

  ```text
  modelVisibleName: def_data_equipment_3plus1_recommend
  sidecarRoute: def.equipment.3plus1.recommend
  family: def-data-resource
  canonicalTarget: def.data.resource.equipment_3plus1_recommend
  scope: session-private
  riskLevel: read
  approval: none
  allowedHosts: workbench, ai-cli
  ```

- [ ] 在 `definitions.mjs` 增加权威 Sidecar definition。
- [ ] 在 `registry.mjs` 同时更新：
  - `SESSION_PRIVATE_TOOLS`；
  - `DATA_RESOURCE_TOOLS`；
  - `DEF_NATIVE_TARGETS`；
  - `dataTargetFor()`，且 recommend 匹配必须位于宽泛 3plus1 匹配之前。
- [ ] 在 `buildDefToolDefinitions()` 增加显式输入 Schema。
- [ ] 在 `applyDefToolInvocationPolicy()` 加入 authenticated native session 边界。
- [ ] Sidecar dispatcher 只调用 Recommendation Service 并映射 typed error。
- [ ] `registry.mjs`、OpenCode export 和 Sidecar route 必须一一对应。
- [ ] 模型 Schema 与 route Schema 做 identity 或明确 adapter mapping 合同测试。
- [ ] description 只说明能力、输入、终态和只读边界。
- [ ] description 不列内部 Tool 顺序。

### B2. 输入 Schema

- [ ] 实现 `DefEquipment3Plus1RecommendationInputV1`：
  - `operatorQuery`：NFKC/trim 后 1–160 字符，必填；
  - `setQuery`：1–160 字符，可选；
  - `requiredEquipmentQueries`：最多 4 项；
  - `excludedEquipmentQueries`：最多 8 项；
  - `compareEquipmentQueries`：最多 8 项；每项为 `{ query, slot? }`，只比较、不强制选入；
  - compare slot 只能为 armor、glove、accessory1、accessory2；
  - 每项装备 query 1–160 字符；三个数组规范化去重后合计最多 16 项；
  - `duplicateAccessoryPolicy`：`catalog-default / allow / forbid`，默认 catalog-default；
  - `minimumSetPieces`：3 或 4，默认 3；
  - `shortlistLimit`：1–3，默认 3；
  - `priorPlanDigest`：可选，格式为 `sha256:<64 lowercase hex>`。
- [ ] 字符串统一做 NFKC、trim 与连续空白折叠。
- [ ] required/excluded 按 query 去重；compare 按 query+slot 去重；跨语义数组的相同查询保留。
- [ ] root、constraints、compare item 均设 `additionalProperties=false`；整数拒绝小数与字符串数字。
- [ ] required 与 excluded 在解析成同一个 stable id 后返回 `400` 输入错误。
- [ ] required 必须出现在每个方案中；excluded 必须从全部槽位排除。
- [ ] compare 不进入候选过滤、评分或排序。
- [ ] compare 指定 slot 时只比较第一 READY plan 的该槽；未指定时为每个兼容槽生成 comparison。
- [ ] required/excluded 歧义进入 `NEEDS_INPUT`；无可信实体进入 `UNRESOLVED`。
- [ ] compare 无可信实体只产生 unresolved comparison，不单独阻塞合法方案。
- [ ] `allow` 不得扩大 catalog 槽位兼容性；`forbid` 过滤重复 stable id。
- [ ] 用户约束不得放宽 catalog、槽位或套装合法性。
- [ ] 不增加任意 JSON、隐藏 prompt 或自由表达式字段。
- [ ] 不增加自由文本 `goal`；V1 内部 canonical goal 固定为 `damage`，support/utility 仍走结构化角色分支。

### B3. 输出 Schema

- [ ] 实现 `EvidenceEnvelope<DefEquipment3Plus1RecommendationV1>`。
- [ ] 成功合同固定为 `DefEquipmentThreePlusOneRecommendationV1`，`protocolVersion=1`。
- [ ] 只允许 `READY / NEEDS_INPUT / UNRESOLVED` 三个业务状态。
- [ ] `READY` 包含 operator、profile evidence/profileHash、catalog revision、selected set、1–3 个 plans 和 `planDigest`。
- [ ] selected set 包含其 three-piece effect 的 matchKeys 与 rankingBasis。
- [ ] 每个 plan 包含稳定 `planId`，并恰好包含 armor、glove、accessory1、accessory2 四项。
- [ ] 每件装备包含 `stableId`、name、slot、set id、match keys 与 ranking basis。
- [ ] 被用户点名质疑的装备进入 `comparisons`，并返回 selected / not-selected / unresolved 与证据。
- [ ] 每条 comparison 包含原 query 与 slot；候选不存在时 candidate/slot 均为 null。
- [ ] not-selected 包含该槽当前 `selectedStableId`。
- [ ] comparison reasons 使用稳定 code，不只返回自然语言。
- [ ] `NEEDS_INPUT` 为 `result=null`，只返回一个最小问题及有界候选。
- [ ] ambiguity/nextQuestion 最多返回 8 个候选，并保留 candidateCount 与 truncated。
- [ ] `UNRESOLVED` 为 `result=null`，保留 missing、ambiguities 和 source refs，不生成伪方案。
- [ ] 多歧义时按 operator、set、required、excluded 的固定优先级提一个问题。
- [ ] comparison unresolved 时允许 READY，但 `completeness=partial`。
- [ ] 系统错误使用 Tool error，不伪装为业务终态。
- [ ] Tool error 合同固定为 `DefEquipmentThreePlusOneRecommendationErrorV1`。
- [ ] `failureStage` 与 `nextAction` 只能使用 Spec 9 枚举。
- [ ] HTTP 映射固定为 input=400、auth/session=403、stale/identity=409、unexpected=500。
- [ ] catalog 捕获后的错误必须携带 source revision。

### B4. correction 合同

- [ ] 每次推荐计算稳定 `requestDigest` 和 `planDigest`。
- [ ] Digest 使用 object key 排序、忽略 undefined、保留 array 顺序的 canonical JSON，再执行 SHA-256。
- [ ] `requestDigest` 覆盖规范化外部输入与默认值；不包含 priorPlanDigest、session/turn id、Profile 或 catalog。
- [ ] `planDigest` 只在 READY 时生成，覆盖 requestDigest、resolved ids、Profile evidence hash、catalog revision 与最终稳定 plans。
- [ ] `planId` 只覆盖 selected set id 与固定槽位顺序的 stable ids。
- [ ] correction 使用完整替换输入，而不是自然语言 patch。
- [ ] 有 `priorPlanDigest` 时返回 `supersedesPlanDigest`。
- [ ] `priorPlanDigest` 只做格式和谱系标记，不参与评分、不读取旧 plan。
- [ ] Service 总是重新读取当前可信 evidence 和 catalog revision。
- [ ] 不复用上一轮 planner capability、artifact、候选或排名。
- [ ] 新 catalog revision 下不能把旧 plan 说成当前结果。

### B 完成口径

- [ ] Tool 合同可以脱离 Prompt 独立解释。
- [ ] 输入、输出和失败均有自动合同测试。

## 五、Checkpoint C：把确定流程收进 Service

### C1. 建立领域 Service

- [ ] 新建 `scripts/def-core/stable-json.mjs`，承接当前 generic canonicalize/serialize/hash；equipment、weapon、Profile 共同复用。
- [ ] 新建 `scripts/def-core/equipment-3plus1-domain.mjs`，承接 catalog、解析、拓扑、约束、排名与 Digest 纯函数。
- [ ] 新建 `scripts/def-core/equipment-3plus1-recommendation.mjs`，承接阶段、状态、Envelope 与 error。
- [ ] Domain exports 与 ports 的名称、参数完全按 Spec 9 第 6.5.2 节实现。
- [ ] 公开入口固定为 `createDefEquipment3Plus1RecommendationService(ports).recommend({ sessionId, turnId, input })`。
- [ ] `ports` 只允许读取 operator catalog、guide references、exact guide section、combat conventions、equipment library source 与 gear-set aliases。
- [ ] `operator-build-evidence.mjs` 继续拥有 Profile 推导，并按 Spec 导出 Guide compile、convention 判定与 partial merge；推荐模块不得复制。
- [ ] 对新的 recommend 路径，`scripts/ai-cli-rest-server.mjs` 只保留 port wiring、route、认证、调用与 HTTP error 映射。
- [ ] 本 Task 不顺带迁移无关旧 Tool；但已迁出的 3+1 领域函数不得在 REST 留副本。
- [ ] 不把现有函数复制成第二套算法；移动或复用 helper。
- [ ] Service API 显式接收 session/turn identity 和有界输入。
- [ ] Service 不接收 provider message、Prompt 或回答风格。
- [ ] Service 合同测试使用内存 fixture ports，不读取正式产品数据。

### C2. 内部阶段

- [ ] `resolve-operator`：精确 identity；歧义进入 `NEEDS_INPUT`。
- [ ] `resolve-profile`：执行 GUIDE_FOUND / PARTIAL / NOT_FOUND 分支。
- [ ] `capture-catalog`：一次性捕获不可变 equipment snapshot 与 revision。
- [ ] `resolve-constraints`：将 required/excluded/compare 解析成 stable id。
- [ ] `resolve-set`：指定套装精确解析；未指定时完整筛选候选。
- [ ] `validate-facts`：校验槽位、套装数量、重复配件与 catalog identity。
- [ ] `solve-plan`：生成有界计划、match keys、ranking basis、missing 与 ambiguities。
- [ ] `build-evidence`：生成 Evidence Envelope 与 digest。
- [ ] 每个阶段有明确输入、输出和 failure stage。

### C3. 确定性规则

- [ ] 所有阶段消费同一个 catalog revision。
- [ ] 3+1 表示四个物理槽位中至少三次目标套装归属。
- [ ] 允许 catalog policy 认可的同一配件占两个配件槽。
- [ ] 四件同套方案合法。
- [ ] 散件只有严格改善已验证 profile match 时才胜出。
- [ ] set effect fit 先于 piece coverage；不能从 `fixedStat` 推导干员主副属性。
- [ ] 不合并不同 effect type key。
- [ ] 未证明的元素、触发或伤害收益保持 unresolved。
- [ ] 固定 `minimumMatchesPerPiece=2`，不新增模型输入。
- [ ] set 与 plan comparator 使用 Spec 9 第 6.5.4 节顺序。
- [ ] 未指定套装时，只把当前 constraints 下至少有一个合法拓扑的套装标为 eligible。
- [ ] set 业务分数完全并列时返回 `NEEDS_INPUT`；stable id 只保证候选顺序。
- [ ] plan 业务分数完全并列时保留并列 plans，标记 `top-ranking-tie`，并使 completeness=partial。
- [ ] 保留现有 search-space limit 与 output-size limit；如需改变，先改 Spec 并提供基线差异。

### C4. 只读与状态

- [ ] Service 不调用 Work Node、operator config patch、approval 或 mutation route。
- [ ] Service 不写用户 SQLite、checkout 或 local storage。
- [ ] 调用前后记录 state hash、checkout、pending command 和 pending approval。
- [ ] 任一变化均使测试失败。

### C5. 原子能力收口

- [ ] 复合 Service 直接调用领域函数，不调用模型 Tool export。
- [ ] 复合 Service 内部不铸造或传递 fallback token、planner profile capability、artifact id。
- [ ] 冻结 Profile 与 catalog snapshot 只存在于当前调用内。
- [ ] Session/turn identity 只用于认证、隔离和审计，不进入排名与 Digest。
- [ ] 保留的旧原子 Tool 继续执行原有 token/capability 防篡改合同。
- [ ] 根据 A2 结果，将旧 3+1-only exports 改为 internal 或删除 model exposure。
- [ ] 保留的 primitive 必须有独立消费者、owner 和退出条件。
- [ ] 不新增 guide/profile/catalog/facts/plan 的第二组模型 Tool。

### C 完成口径

- [ ] 指定套装与未指定套装都可通过一次 Service 调用完成。
- [ ] Service 单独测试时不需要 Agent、Prompt 或 Harness。

## 六、Checkpoint D：删除运行时重复规则

### D1. Base Prompt

- [ ] 从 `buildAgentPrompt('workbench')` 删除 ATTRIBUTE-FIRST 3+1 的精确链路。
- [ ] 删除 capability、artifact、facts、planner 的传递教学。
- [ ] 不在 Base Prompt 新增复合 Tool 的长说明。
- [ ] 保留最小身份、语言和全局交互边界。

### D2. Runtime Skill

- [ ] 将 `timeline-workbench/SKILL.md` 的 3+1 大段流程替换为短规则：
  - 识别 operator-specific 3+1；
  - 调用 `def_data_equipment_3plus1_recommend`；
  - 按 typed state 解释；
  - 推荐不等于应用。
- [ ] 删除内部 token、artifact、revision、topology 和 solver 教学。
- [ ] 保留精确装备事实、source-only guide、weapon fit 等相邻能力的现有边界。

### D3. Harness

- [ ] 不修改已注册 package 内容。
- [ ] 从当前同意的 stable 内容构建新目录 `agent/harness/examples/spec9-3plus1-composite-v1/`。
- [ ] manifest 固定为：
  - `harnessId=def-equipment-3plus1-composite`；
  - `version=9.1.0-candidate.1`；
  - `sourceCommit` 写入 `implementation-map.md` 中冻结的准确 baseline commit。
- [ ] candidate 的实际构建/注册 commit 另记入 `verification.md`，不让 manifest 自引用。
- [ ] 新 package 先 build/register 为 immutable candidate，保存完整 `{ harnessId, version, contentHash }` ref。
- [ ] 一个 package 只表达“使用复合 3+1 能力”这一项变更。
- [ ] routing/workflow/tool-guidance 不再复制内部阶段。
- [ ] response policy 只规定如何表达 READY、缺失、歧义和未应用状态。
- [ ] 新 Session 只能通过完整 candidate ref 显式绑定，不能依赖目录名猜版本。
- [ ] 不自动 promotion；记录人工决策门。

### D4. Tool description 与测试文档

- [ ] 缩短旧 3+1 primitive description；若 internal，则不再作为模型教学文本。
- [ ] 更新 `docs/testing/def-agent-blackbox.md` 的 3+1 路径为一次复合 Tool 调用。
- [ ] 更新 Scenario required/forbidden tools 和 call-count 断言。
- [ ] 删除“教学句子必须存在”一类旧断言，改为合同与行为断言。

### D5. 结构检查

- [ ] 增加聚焦检查，确保 Base Prompt 与 Harness 不再出现旧 3+1 精确链路。
- [ ] 检查不能误伤 native catalog 的其他合法用途。
- [ ] 所有模型可见 `def_*` 名称继续通过 Tool reference contract。

### D 完成口径

- [ ] 新能力增加后，运行时业务教学文本实际减少。
- [ ] 产品不存在复合路径与旧模型编排路径并行教学。

## 七、Checkpoint E：让审计返修使用同一 owner

### E1. 更新开发侧 Skill

- [ ] 更新 `.agents/skills/harness-audit-assistant/SKILL.md`。
- [ ] 强制审计前读取 Spec 9 的职责表。
- [ ] 默认只读边界保持不变。
- [ ] 不把开发 Skill 复制进产品 Runtime Skill。

### E2. 更新审计量表

- [ ] 为每个 Finding 增加：
  - violated contract；
  - primary owner；
  - owner evidence；
  - allowed edit locations；
  - forbidden duplicate locations；
  - duplicate rules to remove；
  - original regression；
  - adjacent/safety regression。
- [ ] `ENVIRONMENT` 继续与产品失败分开。
- [ ] 确定性 Tool/Service 错误不得路由为 Harness 补丁。
- [ ] 证据不足时 owner 标为假设，不生成肯定修法。

### E3. 更新返修交接模板

- [ ] 开工提示词只授权修改 primary owner 和必要接口适配。
- [ ] 明确禁止在 Prompt、Skill、Harness、Tool description 多处复制同一规则。
- [ ] 要求修复时删除已失去职责的旧规则。
- [ ] 要求用新 Session 验证，不向失败 Session 重复投递。

### E4. 三个路由样例

- [ ] Tool 合同承诺字段但 typed result 缺失，Agent 随后猜测：Tool Contract 为主要 owner；若合同诚实报告数据源缺失，则另判 Knowledge Finding。
- [ ] 精确 node id 在审批前 `blocked-session-mismatch`：Domain Service 的 node ownership 校验为主要 owner；Host 只作为待证接口假设，不是 Harness。
- [ ] Tool/Service 完整，多个 fresh session 仍无法识别任务：Runtime Skill owner。
- [ ] 三个样例都生成不同、受限的返修范围。

### E 完成口径

- [ ] 另一位 Codex 只读同一份证据时，可以得到相同主要 owner。
- [ ] 返修提示词不再默认要求“同时加强 Harness、Tool 和 Prompt”。

## 八、Checkpoint F：聚焦自动验证

### F1. Service 合同矩阵

- [ ] `GUIDE_FOUND` 指定套装成功。
- [ ] `GUIDE_FOUND` 不调用 fallback。
- [ ] `PARTIAL_GUIDE_FOUND` 只补缺口，不覆盖 Guide 已证明 group。
- [ ] `GUIDE_NOT_FOUND` 只使用结构化 operator evidence 与必要 reviewed conventions。
- [ ] fallback 为 `INSUFFICIENT_OPERATOR_EVIDENCE` 时返回 `UNRESOLVED`。
- [ ] Profile 少于两个互不重叠 preference groups 时返回 `UNRESOLVED`，不进入 planner。
- [ ] 未指定套装由完整 catalog 选择。
- [ ] set 业务分数完全并列时返回 `NEEDS_INPUT`，stable id 只控制候选顺序。
- [ ] plan 业务分数完全并列时返回多个 READY plans、`top-ranking-tie` 与 partial completeness。
- [ ] 并列计划超过 shortlistLimit 时保留 candidateCount/truncated，不伪称唯一最佳。
- [ ] 套装不存在且无可信候选时返回 `UNRESOLVED`；存在近似候选时返回 `NEEDS_INPUT`；catalog 损坏才返回 Tool error。
- [ ] 名称歧义返回 `NEEDS_INPUT` 和一个问题。
- [ ] 多个歧义只按固定优先级返回一个问题。
- [ ] catalog identity 冲突 fail closed。
- [ ] required item 每个方案都包含；excluded item 在所有槽位都不存在。
- [ ] 未指定套装时跳过被 constraints 排空的套装，并继续选择其他合法套装。
- [ ] required/excluded 解析为同一 stable id 时返回 400。
- [ ] required/excluded 不存在时 UNRESOLVED；compare 不存在时 comparison unresolved 且不改变排序。
- [ ] 双配件合法。
- [ ] duplicate policy=catalog-default 与当前 catalog policy 一致。
- [ ] duplicate policy=allow 不扩大槽位兼容性。
- [ ] duplicate policy=forbid 生效。
- [ ] 四件同套合法。
- [ ] 散件只有严格改善时入选。
- [ ] correction 重新计算并返回 supersedes digest。
- [ ] 相同业务输入下，priorPlanDigest 只改变 supersedesPlanDigest；requestDigest、planId、planDigest、候选与排序均不变。
- [ ] 相同输入与证据在不同 Session 得到相同 Digest。
- [ ] “为什么不用某件装备”返回有证据的 comparison，不把质疑当作强制应用。
- [ ] `{ query: "悬河供氧栓", slot: "accessory2" }` 只比较 accessory2，不丢失“配件二”语义。
- [ ] 新 revision 不复用旧 plan。
- [ ] shortlist 最多三个。
- [ ] 全部路径状态不变。

### F2. Tool/route 合同

- [ ] model export、registry、route、handler 一致。
- [ ] 未认证或未注册 native session fail closed。
- [ ] input size、枚举、required/excluded 冲突被拒绝。
- [ ] error stage 和 nextAction 不丢失。
- [ ] internal primitive 不向 Workbench 意外暴露。

### F3. 运行指纹

- [ ] Tool/Service/Skill/Harness 变化反映到 `AgentReleaseV1` 对应 hash。
- [ ] 回归 artifact 保存 runtime commit、releaseHash、Harness ref、model 与 scenario version。
- [ ] 旧 session 只作为历史证据，不作为修复后 PASS。

### F4. 建议命令

按实际改动选择，至少运行：

```text
npm run test:def-equipment-3plus1-recommendation
npm run test:def-operator-build-planning
npm run test:def-harness-guide-first
npm run test:def-harness-turn-routing
npm run harness:check
npm run interop:check
git diff --check
```

- [ ] 新建 `scripts/def-equipment-3plus1-recommendation-contract-test.mjs`，覆盖 Service、状态、约束、Digest 和只读不变量。
- [ ] 新建 `scripts/def-equipment-3plus1-tool-surface-contract-test.mjs`，覆盖 definitions、registry、native target 与 OpenCode export；P3 可独立通过。
- [ ] 新建 `scripts/def-equipment-3plus1-registration-contract-test.mjs`，在集成分支覆盖 authenticated policy、Sidecar schema、dispatcher 与 Service wiring。
- [ ] `package.json` 新增 `test:def-equipment-3plus1-recommendation`，串行运行上述三个 hermetic contract test。
- [ ] 将新 package script 接入 `test:def-operator-build-planning` 或 `check`，只保留一个权威聚合入口。
- [ ] 影响 architecture gate 时接入 `test:def-architecture-contracts` 或 `npm run check`。
- [ ] 不把桌面实时依赖测试强塞进普通 hermetic 单测。

### F 完成口径

- [ ] 自动检查证明合同、安全与结构边界。
- [ ] 失败命令和环境阻塞如实写入 verification。

## 九、Checkpoint G：真实 Agent 与桌面黑盒

### G1. 测试环境

- [ ] 按 `docs/testing/def-agent-blackbox.md` 使用正式 Interop 路径。
- [ ] 使用隔离工作树、隔离 fixture 和全新 native session。
- [ ] 记录正确的 `AgentReleaseV1` 与 Harness candidate ref。
- [ ] Interop 记录 turn/tool/question/error/final state。
- [ ] Computer Use 只确认真实 UI，不替代协议证据。

### G2. 必测自然语言

- [ ] 指定套装：`为别礼挑选一套装备，3 潮涌+1，需要主副属性都对。`
- [ ] 未指定套装：`为汤汤挑一套 3+1 装备，优先适配她的输出机制，不指定套装。`
- [ ] correction：先问 `给别礼规划一套 3 潮涌+1，先给我确认方案，不要应用。`，再问 `配件二为什么不用第二个悬河供氧栓？`
- [ ] unresolved：`为别礼配 3 潮涌+1；如果资料不能证明寒冷伤害会触发潮涌第二段，就明确说不能证明。`

### G3. Trace 判据

- [ ] 每轮只出现一次 `def_data_equipment_3plus1_recommend`。
- [ ] 不出现旧 guide/profile/materialize/shortlist/facts/plan 模型编排。
- [ ] 不出现 generic knowledge、legacy equipment、Work Node 或 mutation fallback。
- [ ] Tool card、最终回答和 Interop typed result 一致。
- [ ] 没有 question 时不得声称已提问。
- [ ] 没有 approval、commit 或 postcondition 时不得声称已应用。

### G4. 结果判据

- [ ] stable id、slot、set membership 与 match keys 完整。
- [ ] 双配件和四件同套按 typed result 表达。
- [ ] missing/ambiguity 不被自然语言抹掉。
- [ ] 未证明的触发、元素和伤害收益保持 unresolved。
- [ ] checkout、SQLite state、pending command、approval 均不变。
- [ ] 记录首字时间、完成时间、Tool 次数与最终状态。

### G5. 相邻回归

- [ ] 精确装备事实仍走窄 typed Tool。
- [ ] source-only guide 仍只读准确 section。
- [ ] weapon fit 原路径保持。
- [ ] operator config preview 不产生写入。
- [ ] 一项现有 mutation 审批合同只跑自动安全回归，不在本 Task 手改正式数据。

### G 完成口径

- [ ] 指定、未指定、纠正、unresolved 四类真实会话均有独立结论。
- [ ] 单次 PASS 不掩盖未覆盖分支。

## 十、Checkpoint H：文档、决策与提交

### H1. Verification

- [ ] 新建 `verification.md`。
- [ ] 记录 baseline commit、实现 commits、AgentRelease、Harness ref 与 Scenario version。
- [ ] 分别记录合同测试、Interop、Computer Use 和状态证据。
- [ ] 每项标记 PASS / FAIL / BLOCKED / NOT RUN。
- [ ] 记录旧 primitive 的保留/退出结果。
- [ ] 记录删除了哪些 Prompt、Skill、Harness 和 description 规则。

### H2. Harness 决策

- [ ] 生成 candidate 的 regression 结果。
- [ ] PASS_TO_PASS 与 safety 未完成时禁止 promotion。
- [ ] Task 不自动修改 stable pointer。
- [ ] 需要 activation 时，向用户提供 candidate ref、收益、退化和回滚目标，等待明确决定。

### H3. 最终检查

- [ ] `git status --short --branch` 只包含本 Task 文件。
- [ ] `git diff --check` 通过。
- [ ] 没有密钥、真实 transcript、`.runtime` 或本地 SQLite 进入提交。
- [ ] 没有无关格式化、vendor 改动或 MCP 改动。
- [ ] Spec、Task、testing doc、Scenario 与代码一致。

### H4. 自动提交

- [ ] 每个已完成 fix/coding checkpoint 自动提交。
- [ ] 最终文档与 verification 自动提交。
- [ ] 最终汇报 commits、测试、未覆盖和是否等待 Harness activation。
- [ ] 不 push。

## 十一、并行实施图

本节用于后续分发子 Agent 或独立分支。
它只拆交付边界，不改变 owner。

Checkpoint A 与 `implementation-map.md` 是并行开工门。
它完成后，P1–P6 可以按容量并行。

| 包 | 建议分支 | 独占文件范围 | 产物 | 依赖 |
| --- | --- | --- | --- | --- |
| P0 Freeze | `codex/spec9-implementation-freeze` | 只读盘点与 `implementation-map.md` | baseline、调用方、迁移表、高冲突 owner | 已同意集成 baseline |
| P1 Domain extraction | `codex/spec9-equipment-domain` | `scripts/def-core/stable-json.mjs`、`equipment-3plus1-domain.mjs`、`operator-build-evidence.mjs` 的必要导出、REST 中旧领域函数迁移 | 纯函数、共享 hash、旧 primitive 复用、无算法副本 | P0 |
| P2 Recommendation Service | `codex/spec9-recommendation-service` | `scripts/def-core/equipment-3plus1-recommendation.mjs`、Service contract test | 阶段、状态、Envelope、Digest、fixture ports | P0；按 P1 固定导出编码 |
| P3 Tool surface | `codex/spec9-recommendation-tool` | `definitions.mjs`、`registry.mjs`、`opencode/def.js`、tool-surface contract test | 模型 Tool、Schema、policy/target 映射 | P0；使用固定 V1 合同 |
| P4 Runtime teaching cleanup | `codex/spec9-runtime-teaching` | Base Prompt、`timeline-workbench/SKILL.md` | 删除旧链路，只保留识别和解释 | P0；不依赖代码合并 |
| P5 Harness candidate | `codex/spec9-harness-candidate` | 新 candidate 目录、3+1 Scenario、Harness 合同断言 | immutable candidate 与 trace 断言 | P0；不 promotion |
| P6 Teacher audit | `codex/spec9-teacher-audit` | `.agents/skills/harness-audit-assistant/**` | owner 路由、量表、handoff 样例 | P0 |
| P7 Integration | `codex/spec9-integration` | 合并后 REST 最终 wiring、registration contract test、`package.json`、testing doc、`implementation-map.md` 最终状态、`verification.md` | 无冲突集成、聚合命令、全量证据 | P1–P6 |
| P8 Blackbox | 集成分支上执行 | 不修改生产代码；只补 verification/artifact | Interop、Computer Use、状态证据 | P7 |

### 11.1 固定接口，允许并行

P1 与 P2 可以在 P0 后并行，但不得各自发明接口。
共同使用 Spec 9 已冻结的：

- domain module 名称；
- Recommendation Service 入口；
- port 种类；
- 输入、输出、状态、error 与 Digest；
- 现有 comparator 和限制不变。

P2 可先用 fixture domain/ports 完成状态机测试。
合并时必须替换为 P1 的真实导出，不能保留第二套 fixture 实现到生产路径。

P3 不编辑 `ai-cli-rest-server.mjs`。
它只完成模型面、definition 和 registry。
Sidecar dispatcher 的最终 import/call 由 P7 在 P1、P2 合并后接线。

### 11.2 高冲突文件规则

- `scripts/ai-cli-rest-server.mjs`：P1 完成迁移前只归 P1；之后只归 P7；
- `package.json`：只归 P7；其他包只在交付说明中提出 script 需求；
- `spec.md`、`task9-1.md`：只归集成负责人；子任务发现合同问题时提交 Finding，不自行改规格；
- `agent/harness/baseline/stable-v0/**`：任何包都不得修改；
- 同一个 Scenario 或 contract test 不分给两个包同时编辑。

### 11.3 分支交付合同

每个包必须：

1. 从 P7 指定的同一个 baseline 建分支；
2. 只改表中授权文件；
3. 记录依赖的 Spec 小节；
4. 运行本包可独立运行的检查；
5. 自动提交，不 push；
6. 汇报 commit、文件、测试、未覆盖和集成注意事项。

若合同与真实代码冲突，停止扩大修改。
只提交证据或已证实的安全抽取，并由集成负责人先更新 Spec。

### 11.4 集成顺序

建议集成顺序：

```text
P0 freeze
  → P1 domain
  → P2 service
  → P3 tool surface
  → P4 / P5 / P6（次序可互换）
  → P7 wiring + package scripts + hermetic regression
  → P8 fresh-session blackbox
```

P7 不得用冲突解决顺手改写各包算法。
需要语义变化时回到 primary owner 分支修复并重新提交。

## 十二、停止条件

出现以下任一情况时停止扩大实现：

- 复合 Tool 上线后旧运行时规则无法删除；
- Service 仍需要 Agent 传递内部 capability 或 artifact；
- 指定与未指定套装不能共享同一领域边界；
- 为完成 3+1 必须先引入通用 DSL；
- 新架构增加的运行时文本多于删除文本；
- 无法证明只读前后产品状态一致；
- Harness candidate 与 Judge 同时修改，无法归因；
- AgentRelease 无法说明真实运行组合；
- 测试环境阻塞被误记为产品 PASS 或 FAIL。

触发停止条件后，只提交已证实的安全修复和证据。
不要继续靠 Prompt 补齐。

## 十三、最终交付格式

实施者最终必须用人话回答：

1. 原来哪条规则有多个 owner；
2. 现在唯一 owner 是谁；
3. 新复合 Tool 的输入、终态和只读边界；
4. 删除了哪些旧规则；
5. 自动测试证明了什么；
6. 真实 Agent 和 UI 证明了什么；
7. 哪些 primitive 仍保留，为什么；
8. Harness candidate 是否仍等待人工 activation；
9. 提交 hash；
10. 仍未解决的问题。
