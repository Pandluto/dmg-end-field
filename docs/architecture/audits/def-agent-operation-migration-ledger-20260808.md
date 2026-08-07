# DEF Agent 50 项业务行为迁移台账

> 基线：旧稳定实现 `bcea5f12`；当前起始审计快照：`2aa4892c` 加 2026-08-08 未提交修复。
>
> 目的：这份台账按“真实产品行为”验收，不以 Harness 中存在 operation 名称作为完成依据。状态会随本轮修复更新。

## 状态口径

- `保留`：1.8 产品数据足以确定性实现，必须有真实行为测试。
- `收敛`：保留用户意图名，但底层复用规范 Typed Tool。
- `证据不可用`：可以返回目录事实，但不得给出“最优、强度、适配度、排名”等无 1.8 依据的结论。
- `退役`：旧版已明确不支持，或继续暴露会产生越权/误导；必须返回结构化退役结果且页面零改动。

## Selection（8）

| Operation | 旧稳定行为 | 起始审计缺口 | 最终处理 | 必须通过的行为测试 |
|---|---|---|---|---|
| `inspect` | 精确返回有序 roster、稳定 ID、绑定 | 缺 operation 级端到端 | 保留 | 空队伍、1/4 人、顺序与 binding 精确一致 |
| `search` | 只查干员目录，报告歧义/截断/空结果 | 通用 query 未锁定 operators | 收敛到固定 operator facts 查询 | 同名、模糊、截断、空目录 |
| `add` | 解析稳定 ID 后加一人，审批、CAS、保序 | 未强制目录解析；后置条件会排序 | 保留 | 中间位置新增；歧义拒绝；失败回滚 |
| `remove` | 精确删除，其他成员和位置不变 | 完整 roster 覆盖但保序不可证明 | 保留 | 删除首/中/尾，其他成员逐位不变 |
| `replace` | 精确替换，保留无关位置 | 新旧对象未独立解析 | 保留 | 替换第二人，其他三人逐位不变 |
| `reorder` | 只换顺序，不增删 | 排序后比较会误判未重排为成功 | 保留并修 ordered postcondition | 同集合反转；未生效必须失败并回滚 |
| `analyze` | 依据 roster 与可靠事实分析 | 没有结构化事实边界 | 保留事实分析；主观搭配标证据不可用 | 不得凭职业编造“最优队伍” |
| `apply` | 应用精确最终 roster，审批并验证 | 同样受解析和排序误判影响 | 收敛到有序 selection apply | 四人顺序、重复 ID、错误结果回滚 |

## Loadout（12）

| Operation | 旧稳定行为 | 起始审计缺口 | 最终处理 | 必须通过的行为测试 |
|---|---|---|---|---|
| `inspect` | 读取武器、装备、套装效果、技能等级 | 已有真实投影，缺复杂用例 | 保留 | 多干员、缺武器、缺配置、多套装效果 |
| `evaluate` | 依赖 guide/profile 评价配置 | 1.8 无可靠攻略证据 | 事实完整性保留；主观评价证据不可用 | 不读 1.2 攻略、不生成评分 |
| `resolve` | 解析实体与兼容性 | 装备槽位兼容输出不完整 | 保留 | 精确/歧义名称、错误武器类型/槽位 |
| `recommend` | 基于可靠 guide 推荐配置 | 1.8 无可靠 guide | 证据不可用 | 不输出“最佳装备/武器” |
| `recommend_named_set` | 解析指定套装并生成 3+1 | 能证明结构，不能证明适配或排名 | 收敛为指定套装拓扑规划 | 组合数、槽位、重复饰品规则 |
| `recommend_discovered_set` | 发现、筛选、排名全部套装 | Catalog 声称排名，底层要求 setQuery 且不排名 | 只枚举合法结构；适配/排名证据不可用 | 无 setQuery 可枚举，绝不输出强度顺序 |
| `recommend_weapon` | 基于目标和 guide 推荐武器 | 只能证明武器类型兼容 | 收敛为兼容武器列表；推荐证据不可用 | 过滤正确且无 score/rank |
| `recommend_equipment` | v4 已作为兼容别名退役 | 当前误复活为可执行 operation | 退役 | 返回 retired；页面与 checkout 零改动 |
| `compare` | 比较当前和候选配置 | 没有双方结构化输入 | 保留纯事实字段比较；主观胜负证据不可用 | 两套配置逐字段 diff，无无依据胜负 |
| `preview` | 创建隔离候选、diff，等待后续确认 | 候选真实，缺跨 Turn 确认 | 保留 | preview 不 checkout；digest/revision/finalConfig 固定 |
| `apply` | 只确认上一轮未变化的 proposal | 当前可能同一流程立即 preview+apply | 保留，强制跨 Turn reviewed token | 候选变化后旧确认失效；原候选成功 |
| `restore` | v4 明确不支持 loadout-only restore | 当前错误使用整 Work Node 恢复 | 退役，直至有 loadout-only 逆向补丁 | 返回 unsupported；timeline/Buff/selection 零改动 |

## Timeline（11）

| Operation | 旧稳定行为 | 起始审计缺口 | 最终处理 | 必须通过的行为测试 |
|---|---|---|---|---|
| `current` | 返回权威 current Work Node 身份/label | 当前偏 timeline 摘要 | 保留并补 node identity/lineage | 根/子节点 checkout 身份精确 |
| `inspect` | 一次读取精确按钮/Buff 坐标 | 多余 node read 可能制造失败 | 收敛到绑定 snapshot read | 全量/指定/空时间轴；无隐式选节点 |
| `add` | 可信技能解析后创建隔离候选 | 可接受模型伪造技能字段 | 保留，强制 catalog resolution | 错误干员技能拒绝；正确技能字段一致 |
| `remove` | 精确批量删除，整批原子 | 已有真实行为，缺批量端到端 | 保留 | 两按钮成功；任一 ID 错误则全不变 |
| `move` | 只改坐标，附加状态不变 | 实现真实，缺专测 | 保留 | 跨行移动，技能/Buff/stack/抗性不变 |
| `replace` | 可信新技能替换，保留位置/附加状态 | 未校验技能归属 | 保留，强制 catalog resolution | 替换后 Buff/层数/位置/抗性不变 |
| `copy` | 只复制技能身份与结构 | 当前错误复制 Buff/层数/抗性 | 保留并修字段白名单 | 带复杂状态源按钮复制后目标状态为空 |
| `validate` | validate 指定 revision 并返回 semantic diff | 缺 diff 阶段 | 保留 | 无效节点列 violations；有效节点返回 diff 且不 checkout |
| `preview` | 从请求创建隔离候选并停在确认态 | 当前只 diff 已存在 node | 收敛到 proposePatch | preview 不 checkout；返回 revision/diffDigest/scope |
| `apply` | 只应用已审阅且未变化候选 | 未强制 revision/diffDigest | 收敛到 applyReviewed | 审阅后改节点，旧批准必须失效 |
| `restore` | 只允许 timeline-owned base diff | 当前整 payload 恢复 | 收敛到 scoped restore | 混入 Buff/loadout/selection 变化必须拒绝 |

## Buff（11）

| Operation | 旧稳定行为 | 起始审计缺口 | 最终处理 | 必须通过的行为测试 |
|---|---|---|---|---|
| `inspect` | 完整 Buff、层数、条件、来源、目标 | Typed Resource 丢大量字段 | 保留并升级快照契约 | 与页面 payload 逐字段一致 |
| `resolve` | 从绑定快照精确解析，歧义拒绝 | 候选来源和字段不全 | 保留，使用完整只读索引 | 同名、多来源、空结果、截断 |
| `source` | 追踪 owner/condition/stack/source | 只有 sourceKinds/labels | 收敛到完整 Buff facts | 装备/套装/自定义/按钮来源 |
| `add` | 解析完整 Buff 后原子添加 | 模型可自行拼不完整对象 | 保留，强制 resolver token/完整摘要 | 缺字段拒绝；实体/refCount/附件一致 |
| `remove` | 按稳定 ID/数量精确移除 | 基本等价，name/latest 仍可歧义 | 保留并收紧歧义 | 一层/全部/多同名拒绝 |
| `replace` | 原子替换并按策略保留状态 | 当前由 remove+attach 拼接，无保留规则 | 收敛为原生 replaceBuff | 替换后层数/条件/目标符合策略 |
| `batch` | 全部目标一次解析、一次提交 | 缺整批 fail-fast 证据 | 保留 | 10 项成功；第 6 项非法则 10 项全不变 |
| `stack` | 读取 current/max/trigger 后只改层数 | Agent 读不到 current/max | 保留并补 stack contract | 0/1/max/超限/不可叠层 |
| `coverage` | 按按钮、来源、条件、层数、目标统计 | 当前只能粗略统计 | 保留确定性 coverage | 同 Buff 多技能、多条件分别统计 |
| `apply` | 应用已审阅的 Buff-only candidate | 未绑定 revision/diff/scope | 收敛到 applyReviewed(scope=buff) | 混入按钮移动必须拒绝 |
| `restore` | 只恢复 Buff-owned base diff | 当前整 payload 恢复 | 收敛到 scoped restore | 混入 timeline/loadout 变化必须拒绝 |

## Calculation（8）

| Operation | 旧稳定行为 | 起始审计缺口 | 最终处理 | 必须通过的行为测试 |
|---|---|---|---|---|
| `calculate` | 读取产品生成报告，不在 Agent 重算 | 已有真实报告 | 保留 | 复杂样本与页面逐项一致 |
| `aggregate` | 汇总总伤害/角色/按钮贡献 | 数据已有，缺视图专测 | 保留 | 总和、小计、share 一致 |
| `compare` | 当前报告与 baseline capsule 比较 | 只有 operation 名称，无第二份报告 | 保留并补双报告契约 | 公式/scope 不兼容拒绝；同口径输出差值 |
| `attribute` | 按 hit/Buff/乘区/抗性归因 | 报告有数据，缺行为测试 | 保留 | 指定 hit 的贡献与报告逐项一致 |
| `diagnose` | 区分缺输入/过期/公式失败 | 只有通用 unavailable | 保留并补结构化 diagnostics | 非 Canvas、无按钮、过期、计算异常分别编码 |
| `export` | 回复内输出有界表格/JSON，不写文件 | 数据足够，缺确定投影 | 保留 | 行数上限、字段顺序、JSON 可解析 |
| `explain` | 只依据报告公式项解释 | 缺“不得重算”测试 | 保留 | 修改 fixture 后解释只随报告变化 |
| `skill_fact` | 精确解析 operator/skill/hit | 通用 query 结构不足 | 保留并补精确 action | 同名、多 hit、错误归属、倍率/元素字段 |

## 规范底层能力

旧稳定版的 50 个 operation 仍是用户意图层。当前另加一项不计入旧版
能力对齐数的管理操作 `timeline.delete_node`：它先读取并展示完整子树，再把目标
revision、节点数与子树摘要绑定进人工审批；SQLite 删除事务会逐节点复核
`contentRevision + updatedAt`，审批后新增、移动或修改任一后代都会使整次删除失败。

底层应收敛为以下可测试能力，不恢复旧版大量重复 Tool：

1. `def.user.ask`
2. `def.workbench.read`
3. `def.catalog.queryFacts`
4. `def.selection.apply`
5. `def.worknode.proposePatch`
6. `def.worknode.inspect`
7. `def.worknode.applyReviewed`
8. `def.worknode.restoreScoped`
9. `def.worknode.delete`
10. `def.loadout.preview`
11. `def.loadout.applyPrepared`
12. `def.damage.report`
13. `def.capability.status`（仅返回退役/证据不可用边界，永不写产品）

## 结案规则

- 每个“保留/收敛”项至少一条真实产品行为测试；路由壳测试不计入。
- Mutation 必须满足：隔离候选 → validate/diff → 用户批准同一 revision/digest/scope → 原子应用 → 精确可见后置条件；失败回滚。
- 提问必须绑定原业务并在回答后续跑，不能降级成 `conversation.respond`。
- 退役或证据不可用必须结构化返回，不得创建 Work Node、不得修改页面、不得偷偷使用旧 1.2 攻略。
- 最终还要通过 TypeScript、完整单测、构建、Interop 黑盒和 Mac Desktop Interop Route 实测。
