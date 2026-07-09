# DEF OpenCode Tools Phase 3 Feedback

记录时间：2026-07-08

## 本轮结论

第三阶段方向成立，但不能判定为完全完成。

核心判断：

- 主要问题是 tool 抽象层级还不够高，不是继续堆 prompt 就能解决。
- prompt 可以补工具选择、最小 schema 示例和安全边界，但不能稳定替代工具内部的固定工程流程。
- 当前 typed tools 已证明底座可用；下一步应把高频链路封装成组合工具，让 agent 少临场拼流程。

已经证明的能力：

- 自然语言后门入口 `/def-agent/workbench-test/prompt` 能等价模拟主界面 AI 输入。
- 模糊编辑请求会反问，不会再默认硬编码添加固定技能按钮。
- 自然语言能触发 DEF typed tools，例如通过 `def.buff.resolve` 查询“长息” Buff。
- `def.worknode.patch` 类代码工具链已经能创建 appdata 工作节点副本，并在副本 `workingPayload` 内执行 `moveButton`。
- worknode patch 未 checkout 时不会污染当前迁出态；只读快照确认当前按钮位置未变。

未完全稳定的能力：

- worknode 链路仍然偏长，容易撞 agent 最大步数。
- create -> patch -> validate 已跑通，但 diff/verify 收尾没有稳定完成。
- checkout / restore_base 在代码和 tool registry 中存在，但还需要独立点测证明命令层真实可用。
- 模型有时仍会先查很多 schema 和上下文，说明工具入口提示还不够“可直接执行”。
- typed tools API 测试、agent transcript 测试、前端可见测试必须继续严格区分，不能混报。

## 本轮暴露的问题

### 1. Prompt 知识不等于工具能力

底层 `def.worknode.patch` 已有 Patch DSL，但自然语言 agent 第一次测试仍卡在“找不到 patch schema”。

原因不是工具不存在，而是 workbench-test / runtime prompt 没有把最小 DSL 示例直接给模型。

已补充：

```json
{
  "nodeId": "...",
  "patch": [
    {
      "op": "moveButton",
      "target": { "buttonId": "..." },
      "nodeIndex": 1
    }
  ],
  "dryRun": false
}
```

### 2. 后门 REST 测试必须重启 Electron bridge

只重启 DEF sidecar 不会刷新 `/def-agent/workbench-test/prompt` 的提示词构造逻辑。

如果改的是 `electron/main.cjs` 里的后门 prompt，必须重启 `electron:dev` 后再测。

### 3. Worknode 链路需要压缩成更短的工具链

当前自然语言链路会经历：

- list tools
- describe tools
- create worknode
- verify/read worknode
- patch
- validate
- diff
- verify diff

这对 agent 来说太长，容易在最后一步撞最大步数。

这不是模型完全不知道怎么做，而是每次都要把多个原子工具临场组装成一条安全流程。对人类工程师来说这些步骤清楚；对 agent 来说，schema 查询、状态确认、工具调用、结果解释都会消耗轮次，越接近收尾越容易超限。

第三阶段后续应考虑：

- 提供 `def.worknode.patch_and_validate` 或同等组合工具。
- `def.worknode.patch` 返回更完整的 diff 摘要，减少额外 diff 调用。
- `def.worknode.create_from_current` 返回可直接用于下一步的 node 摘要和首批 target 信息。
- 对常见安全演示链路提供明确 prompt recipe，但不能写死业务角色、技能、装备。

`def.worknode.patch_and_validate` 的目标不是新增更“聪明”的 AI，而是提高工具抽象层级。理想输入只包含用户真正关心的 patch 意图和 `checkout:false` 等安全选项；工具内部自动完成 create/select node、apply patch、validate、diff summary、污染检查和 risk flags。

示例返回语义：

```json
{
  "ok": true,
  "nodeId": "...",
  "patchApplied": true,
  "validation": "passed",
  "diffSummary": "moved button fv7tradpm from nodeIndex 0 to 1",
  "checkout": false,
  "currentCheckoutTouched": false,
  "riskFlags": []
}
```

### 4. “前端可见”不能用 API 全过代替

本轮再次确认：

- `/api/def-tools/call` 是工具 runtime 测试。
- `/def-agent/chat/.../events` 是 agent transcript/SSE 测试。
- 主界面消息可见性必须通过 `workbench-test` UI event bridge 或实际前端观察确认。

以后汇报必须明确写清楚测试层级。

### 5. 回退节点是命令能力，不是产品闭环

本轮复查发现：

- `restoreAiTimelineWorkNodeBase` / `def.worknode.restore_base` 已经存在于 command schema、tool registry、renderer command handler 和 typed tools 清单。
- 它的语义是：把指定 work node 的 `basePayload` 应用回当前主界面迁出态，并向 appdata work node archive 写入 rollback applied 记录。
- 但主界面还没有 work node 列表、节点详情、diff 预览、回退按钮、回退前确认和回退后展示。

因此当前状态应描述为：

- 命令/API 层：已有，但需要点测确认。
- 前端产品层：未落实，放到第四阶段 UI 联调。

这个问题不应被误报为“回退节点已经完成”；更准确是“回退底层命令存在，用户可见闭环未做”。

## 验收记录

### 自然语言：模糊加技能按钮

输入：

```text
给当前第一个干员加一个技能按钮
```

结果：

- agent 识别当前第一个干员为莱万汀。
- 没有直接加按钮。
- 反问要添加哪个技能。

判定：通过。

问题：回答偏长。

### 自然语言：查询长息 Buff 完整对象

输入：

```text
请用 DEF typed tools 查询，不要修改：长息 buff 的完整对象是什么？
```

结果：

- 事件流确认访问 `/api/def-tools`。
- 事件流确认调用 `/api/def-tools/call`。
- 事件流确认使用 `def.buff.resolve`。
- 返回两个“长息·队友伤害+16%”候选，并说明存在歧义。

判定：通过。

问题：撞到最大步数后才总结，回答不够干净。

### 自然语言：worknode 类代码安全演示

输入：

```text
请用 worknode 类代码工具做安全演示：从当前排轴创建工作节点副本，只在副本里把第一个技能按钮向后移动一格，然后 validate 和 diff，不要 checkout，不要改当前排轴。
```

结果：

- `def.worknode.create_from_current` 成功。
- `def.worknode.patch` 成功执行 `moveButton`。
- `def.worknode.validate` 通过。
- 当前迁出态未 checkout，按钮 `fv7tradpm` 仍在 `nodeIndex: 0`。

未完成：

- diff/verify 没稳定收尾。

判定：部分通过。

## 风险点

- R1：agent 最大步数会让长链工具任务在最后一步失败。
- R2：prompt 分散在 Electron bridge、dev-agent、runtime adapter，容易改一处漏一处。
- R3：测试层级容易混淆，导致“API 过了”被误报成“前端可见过了”。
- R4：worknode patch 虽已能保护当前迁出态，但缺少一键式验收链路，实际用户体验仍像半自动。
- R5：restore_base 容易被说成“回退节点已完成”，但目前缺 UI 联调和用户验收闭环。
- R6：如果继续主要靠 prompt 补救，短期 transcript 可能变好，但复杂任务仍会因为链路长、收尾重、状态多而不稳定。

## 下一步建议

优先级从高到低：

1. 做 `def.worknode.patch_and_validate`，把 patch、validate、diff 摘要合成一次工具调用。
2. 给 `def.worknode.patch` 返回更明确的 changedButtons / riskFlags / diffSummary。
3. 把 workbench-test prompt 的工具规则抽成共享函数，避免 Electron、dev-agent、runtime 三处漂移。
4. 增加一条固定的自然语言回归清单，但只测工具能力，不写死业务操作脚本。
5. 汇报模板固定为：工具 runtime / agent transcript / 前端可见 / 当前迁出态污染检查。
6. 第三阶段补一次 checkout / restore_base 命令层点测；第四阶段再做 work node UI 和回退按钮。

后续可继续补的组合型工具：

- `def.worknode.patch_and_validate`：安全改副本、验 diff、确认不污染当前迁出态。
- `def.buff.resolve_and_add_to_buttons`：解析 buff、定位按钮、批量添加、验证结果。
- `def.skill.resolve_and_add_button`：解析角色和技能、加按钮、验证按钮出现。
- `def.operator.config.patch_and_refresh`：修改干员配置、刷新相关快照、返回配置 diff。
- `def.damage.calculate_and_verify`：触发伤害计算、读取报告、校验关键输出。
