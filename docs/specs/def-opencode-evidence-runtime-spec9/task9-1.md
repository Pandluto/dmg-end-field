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
  - `agent/runtime/def-tools/opencode/def.js`；
  - `agent/runtime/def-tools/registry.mjs`；
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

### A 完成口径

- [ ] 任何实施者都能从清单中指出一条规则当前在哪里、迁移到哪里、旧副本怎样退出。
- [ ] 不因开始编码而丢失旧调用方或兼容边界。

## 四、Checkpoint B：建立复合 Tool 合同

### B1. Tool 注册

- [ ] 在唯一 DEF Tool 目录登记模型可见能力：

  ```text
  modelVisibleName: def_data_equipment_3plus1_recommend
  sidecarRoute: def.equipment.3plus1.recommend
  family: def-data-resource
  scope: session-private / read-only
  risk: read-only
  exposure: workbench
  ```

- [ ] `registry.mjs`、OpenCode export 和 Sidecar route 必须一一对应。
- [ ] 模型 Schema 与 route Schema 做 identity 或明确 adapter mapping 合同测试。
- [ ] description 只说明能力、输入、终态和只读边界。
- [ ] description 不列内部 Tool 顺序。

### B2. 输入 Schema

- [ ] 实现 `DefEquipment3Plus1RecommendationInputV1`：
  - `operatorQuery` 必填；
  - `setQuery` 可选；
  - `requiredEquipmentQueries` 有界；
  - `excludedEquipmentQueries` 有界；
  - `compareEquipmentQueries` 有界，只比较、不强制选入；
  - `duplicateAccessoryPolicy` 为受控枚举；
  - `minimumSetPieces` 只能为 3 或 4；
  - `shortlistLimit` 为 1–3；
  - `priorPlanDigest` 可选。
- [ ] 限制字符串和数组长度，拒绝空查询和无界输入。
- [ ] required 与 excluded 冲突时返回输入错误。
- [ ] 用户约束不得放宽 catalog、槽位或套装合法性。
- [ ] 不增加任意 JSON、隐藏 prompt 或自由表达式字段。

### B3. 输出 Schema

- [ ] 实现 `EvidenceEnvelope<DefEquipment3Plus1RecommendationV1>`。
- [ ] 只允许 `READY / NEEDS_INPUT / UNRESOLVED` 三个业务状态。
- [ ] `READY` 包含 operator、profile evidence、catalog revision、selected set、1–3 个 plans 和 `planDigest`。
- [ ] 每件装备包含 stable id、name、slot、set id、match keys 与 ranking basis。
- [ ] 被用户点名质疑的装备进入 `comparisons`，并返回 selected / not-selected / unresolved 与证据。
- [ ] `NEEDS_INPUT` 只返回一个最小问题及有界候选。
- [ ] `UNRESOLVED` 保留 missing、ambiguities 和 source refs，不生成伪方案。
- [ ] 系统错误使用 Tool error，不伪装为业务终态。
- [ ] Tool error 包含 `failureStage / retryable / nextAction`。

### B4. correction 合同

- [ ] 每次推荐计算稳定 `requestDigest` 和 `planDigest`。
- [ ] correction 使用完整替换输入，而不是自然语言 patch。
- [ ] 有 `priorPlanDigest` 时返回 `supersedesPlanDigest`。
- [ ] Service 总是重新读取当前可信 evidence 和 catalog revision。
- [ ] 不复用上一轮 planner capability、artifact、候选或排名。
- [ ] 新 catalog revision 下不能把旧 plan 说成当前结果。

### B 完成口径

- [ ] Tool 合同可以脱离 Prompt 独立解释。
- [ ] 输入、输出和失败均有自动合同测试。

## 五、Checkpoint C：把确定流程收进 Service

### C1. 建立领域 Service

- [ ] 新建或抽取 `scripts/def-core/equipment-3plus1-recommendation.mjs`。
- [ ] `scripts/ai-cli-rest-server.mjs` 只保留 route、认证、调用与 HTTP error 映射。
- [ ] 不把现有函数复制成第二套算法；移动或复用 helper。
- [ ] Service API 显式接收 session/turn identity 和有界输入。
- [ ] Service 不接收 provider message、Prompt 或回答风格。

### C2. 内部阶段

- [ ] `resolve-operator`：精确 identity；歧义进入 `NEEDS_INPUT`。
- [ ] `resolve-profile`：执行 GUIDE_FOUND / PARTIAL / NOT_FOUND 分支。
- [ ] `capture-catalog`：一次性捕获不可变 equipment snapshot 与 revision。
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

### C4. 只读与状态

- [ ] Service 不调用 Work Node、operator config patch、approval 或 mutation route。
- [ ] Service 不写用户 SQLite、checkout 或 local storage。
- [ ] 调用前后记录 state hash、checkout、pending command 和 pending approval。
- [ ] 任一变化均使测试失败。

### C5. 原子能力收口

- [ ] 复合 Service 直接调用领域函数，不调用模型 Tool export。
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
- [ ] 创建新的 immutable Harness package/version，来源可审计。
- [ ] 一个 package 只表达“使用复合 3+1 能力”这一项变更。
- [ ] routing/workflow/tool-guidance 不再复制内部阶段。
- [ ] response policy 只规定如何表达 READY、缺失、歧义和未应用状态。
- [ ] 建立 candidate ref，供新 Session 显式测试。
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
- [ ] `PARTIAL_GUIDE_FOUND` 只补授权缺口。
- [ ] `GUIDE_NOT_FOUND` 使用可信 fallback。
- [ ] 未指定套装由完整 catalog 选择。
- [ ] 套装不存在且无可信候选时返回 `UNRESOLVED`；存在近似候选时返回 `NEEDS_INPUT`；catalog 损坏才返回 Tool error。
- [ ] 名称歧义返回 `NEEDS_INPUT` 和一个问题。
- [ ] catalog identity 冲突 fail closed。
- [ ] 双配件合法。
- [ ] duplicate policy=forbid 生效。
- [ ] 四件同套合法。
- [ ] 散件只有严格改善时入选。
- [ ] correction 重新计算并返回 supersedes digest。
- [ ] “为什么不用某件装备”返回有证据的 comparison，不把质疑当作强制应用。
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
npm run test:def-operator-build-planning
npm run test:def-harness-guide-first
npm run test:def-harness-turn-routing
npm run harness:check
npm run interop:check
git diff --check
```

- [ ] 新增的 Service contract test 接入合适的 package script。
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

## 十一、停止条件

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

## 十二、最终交付格式

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
