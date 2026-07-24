# Harness 篇章重写交接报告

> - 日期：2026-07-24
> - 分支：`codex/temp-main-mcp-docs-20260721`
> - 远端基线：`8d8a91fc`
> - 正文结果提交：`752df1b0`
> - 性质：开发手记写作交接，不是 Harness 的新 Spec

## 一、当前结果

本轮完成了《Agent 开发随记》中 Harness 篇章的重新整理。

- 正文：[篇章 11：Harness](../guides/agent-notes/10-harness.md)
- 访谈原始记录：[Harness 篇章访谈记录](../guides/agent-notes/drafts/10-harness-interview-notes.md)
- 阅读页生成结果：`docs/guides/agent-notes/web/dist/10-harness.html`
- OpenAI Sites 打包目录：`docs/guides/agent-notes/site`

文件名仍是 `10-harness.md`，正文标题仍是“篇章 11：Harness”。不要为了统一编号擅自改标题；这是本轮沿用的既有命名。

最终正文的叙事顺序是：

1. 用普通配装请求说明“有 Tools 不等于会做事”；
2. 给出 Harness 的宽泛理解和项目内严格定义；
3. 用一张表带过 Prompt、Context、Tool、Skill、Workflow 的关系；
4. 只用证明题和 PSM 搭一座理解桥；
5. 说明垂直领域中反复出现的是工作条件，不是固定路线；
6. 从 Prompt 规则散落的问题，引出 Context 的来源与运行位置；
7. 将“原子化 Harness”改写为可注册的 Context Source；
8. 用 Tool Registry 类比 Context Registry；
9. 说明 Tool 前后 Context 的准确时序；
10. 将自训练留给后续独立篇章。

## 二、这篇文章应该怎样写

用户要求的是**开发手记散记**。

它应当有顺序，但保留随手记录的感觉；有概念和重点，但话要少。读者不需要先懂 Agent 工程，正文必须说人话。

写作要求已经确认：

- 不使用 `3+1` 作为案例；
- 不使用“雪狼破军”等专名，配装例子保持普通；
- 非重点材料放进 `<details>`；
- 重点词句使用加粗；
- 首次出现的英文工程名词补中文解释；
- Runtime、Agent、Workflow、Skill 等常见词不必机械加括号；
- PSM 只用于帮助理解，不展开成另一套理论；
- 自训练不在本篇展开。

写法参考是 Joye 的[入门教学文章](https://www.joyehuang.me/blog/20260517---agentonboardingguide/post)。参考的是它由浅入深、短句推进的表达方式，不是照搬内容或章节结构。

## 三、不能再改错的概念边界

### 1. Harness 是主概念

项目内严格定义来自用户：

> **本项目中的 Harness，是围绕一类业务问题建立的完整 Agent 求解环境。它将领域知识、问题求解方法、上下文、能力边界、执行状态与完成验证组织为可版本化、由运行时强制的整体，同时保留模型在边界内的自主推理能力。**

这篇文章只解释这个整体怎样被组织，不负责展开 Runtime、缓存、状态机或完整业务合同。

### 2. “非强制，但强参考”必须保留

用户已经给出足够凝练的表述，不要再替换成新的口号：

> **Tool 是强制性的能力，Skill 是非强制性的目录，Workflow 是强制串联 Tools；Harness 对模型的效果，则是非强制，但强参考。**

Harness 不能与 Tool、Skill、Workflow 当成同层组件直接比较。这里只比较它们最终怎样影响模型。

### 3. PSM 只是理解桥

PSM 不等于 Harness，也不是智能体。

正文保留的核心句已经由用户确认：

> **PSM 不是 Harness，也没有智能；它只是借“怎样解一道题”这个熟悉视角，让读者看见 Harness 需要为智能体组织和管理题目、方法与临场判断。**

不要再为证明题、配装、领域知识、Tools 和模型判断制作一张固定映射表。那会把 Harness 重新写成由作者预先穷举的 Workflow。

### 4. 不回答 Runtime 强制什么

此前版本自行扩写过：

- Runtime 的强制边界；
- 缓存和状态机；
- 事务保存；
- 完成验证；
- 模型偏离推荐步骤以后怎样判定成功。

这些内容已经被用户明确否定为本篇任务。

Runtime 在这里就是 Harness 实际运作的地方。不要给这个词另造定义，也不要把文章重新带回 Runtime 专题。

### 5. 配装例子不承担完整交付合同

本篇只需要普通 Tools Loop：

```text
当前 Context
→ 模型判断
→ 需要 Tool，就调用
→ Tool Result 回到 Context
→ 模型继续判断
→ 不再需要 Tool，给出答案
```

不要继续定义“配装 Harness 最终向用户交付什么”“怎样才算完整业务成功”或“Tool 成功以后还要检查什么”。这些不是本篇需要回答的问题。

### 6. 没有“五业务原子 Harness”

“五业务原子 Harness”是此前写作者自行拆出的概念，不是用户观点，也不是 Spec 9-2 的既定结论。

原子的数量不固定。不要恢复以下说法：

- 固定五个 Business Harness；
- 按选人、配装、排轴、BUFF、计算定义原子数量；
- 每个原子必须承担完整业务合同；
- 五项业务来自用户或 Spec 9-2。

### 7. Harness 是整体，Context Source 是原子

用户最后确认的方向是：

> **Harness 是整体；Context Source 是可以注册、增加、组合并绑定运行位置的原子。**

Context Source 需要说明：

- 它提供什么 Context；
- 什么情况下需要；
- 来源和呈现内容是什么；
- 进入 Agent Loop 的哪个位置；
- 状态变化后怎样更新或移除。

这与 Tool 注册的类比是本篇后半段的工程抓手：

| Tool Registry | Context Registry |
| --- | --- |
| 登记能力 | 登记 Context |
| 声明输入、输出和调用路由 | 声明来源、用途和运行位置 |
| Tool 执行后返回结果 | 状态变化后更新或移除 Context |

### 8. Tool 前后 Context 的时序

Context 不会异步插进正在执行的 Tool。

准确时序是：

```text
Context Sources
→ 在模型调用前组装
→ 模型决定是否调用 Tool
→ Tool 执行并返回结果
→ Context Sources 根据新状态刷新
→ 在下一次模型调用前重新组装
```

因此：

- “Tool 调用前的 Context”在产生 Tool Call 的模型回合开始前已经可见；
- “怎样调用 Tool”的方法 Context 也在这个位置提供参考；
- “Tool 调用后的 Context”在 Tool Result 落定后、下一次模型调用前进入。

硬能力仍然属于 Tool。Context Source 提供强参考，Tool Schema 和 Handler 决定程序真正怎样执行。

## 四、工程证据

### OpenCode 当前术语

以下名称不是为了文章临时发明的：

- `Context Source`
- `System Context Registry`
- `Safe Provider-Turn Boundary`

主要证据：

- `agent/vendor/opencode/CONTEXT.md`
- `agent/vendor/opencode/packages/core/src/system-context/registry.ts`

`CONTEXT.md` 将 Context Source 定义为拥有稳定 key、可独立读取、比较和渲染的类型化 Context 值。System Context Registry 负责注册和稳定组合；Context 变化只在 Safe Provider-Turn Boundary 进入模型回合。

### 项目此前使用的术语

提交 `4be107fd` 中出现过：

- `contextSources`
- `Bound Context Source`
- `bindPhaseContextSources()`

Bound Context Source 强调 Context 绑定到具体阶段，而不是永久堆在全局 Prompt。

### 外部理论参照

- [AI Harness Engineering](https://arxiv.org/abs/2605.13357)：用于说明广义 Harness 位于模型与环境之间；
- [PSM 资料](https://www.cs.vu.nl/~guus/papers/Schreiber07a.pdf)：只用于解释问题求解方法；
- [Harness Handbook](https://ruhan-wang.github.io/Harness-Handbook/)：Behavior Map 提供“行为与实现位置”的类比；
- [HarnessX](https://arxiv.org/abs/2606.14249)：提供可组合 Harness 原语的相近思路。

需要保持措辞精确：`Context Source` 和具体 Registry 结构来自 OpenCode 与本项目，不能写成所有论文都采用的统一术语。

## 五、本轮删除和保留了什么

### 已删除

- Runtime 强制边界的整段展开；
- 配装事务、版本冻结和完成验证；
- 配装 Harness 的完整交付承诺；
- “方法不强制，边界和后果强制”这一作者自拟口号；
- 五个 Business Harness 及其固定业务表；
- Manager 跨业务编排；
- 固定业务原子的版本生命周期；
- 自训练实操。

### 已保留

- 普通配装例子；
- Harness 工作台的直观解释；
- 项目内严格定义；
- Tool、Skill、Workflow 与 Harness 的关系表；
- “非强制，但强参考”；
- PSM 的单句认知桥；
- 垂直领域中反复出现的工作条件；
- 领域知识与真实产品事实的区别；
- Prompt 和 Tool Description 中规则重复的项目经历；
- Harness Handbook 的 Behavior Map；
- Context Source、Registry 和运行位置；
- 自训练作为下一篇预告。

## 六、文件与提交

本分支相对远端基线 `8d8a91fc` 的相关文件：

| 文件 | 状态 |
| --- | --- |
| `docs/guides/agent-notes/10-harness.md` | Harness 正文已重写 |
| `docs/guides/agent-notes/drafts/10-harness-interview-notes.md` | 新增访谈与纠错记录 |
| `docs/guides/agent-notes/web/dist/10-harness.html` | 已按正文重新生成 |
| `docs/guides/agent-notes/web/styles.css` | 阅读页样式调整 |
| `docs/guides/agent-notes/web/dist/styles.css` | 已同步生成样式 |
| `docs/history/2026-07-24-harness-chapter-handoff.md` | 本交接报告 |
| `docs/history/README.md` | 历史资料索引已登记 |

关键提交：

| 提交 | 内容 |
| --- | --- |
| `844b1a06` | 建立 Harness 访谈记录 |
| `a90a04fe` | 记录“非强制，但强参考” |
| `f9de2b7f` | 将自训练移出本篇 |
| `47aec0e3` | 重写垂直领域 Harness |
| `491b7730` | 简化常见术语标注 |
| `8d0f85a8` | 记录 Runtime、交付合同和五业务纠正 |
| `3a40559a` | 找回 Context Source 工程术语 |
| `752df1b0` | 按 Context Source 主线重写正文 |

中间提交保留了写作演变，不代表其中每一版结论仍然有效。判断当前观点时，以最终正文和访谈记录第七、八轮的纠正为准。

## 七、生成、预览与验证

重新生成阅读页：

```sh
node docs/guides/agent-notes/web/generate.mjs
```

重新打包 OpenAI Sites：

```sh
cd docs/guides/agent-notes/site
npm run build
```

本地预览：

```sh
python3 -m http.server 4175 --directory docs/guides/agent-notes/web/dist
```

然后打开：

```text
http://127.0.0.1:4175/10-harness.html
```

本轮已完成：

- Markdown 差异检查；
- 阅读页生成；
- Sites 静态打包；
- 本地 HTTP `200` 检查；
- 浏览器顶部、Context 原子段落和运行位置段落的视觉检查。

这是纯文档改动，没有新增代码测试。

## 八、托管状态

OpenAI Sites 项目配置已经存在：

```text
docs/guides/agent-notes/site/.openai/hosting.json
project_id: appgprj_6a6234e65ed48191bdb1034d5760ea8c
```

本轮重新生成了站点源文件并完成本地打包，但没有执行新的生产部署。后续如需更新托管页面，应复用上述 `project_id`，不要创建新的 Sites 项目。

## 九、下一位接手者的工作方式

继续修改前，先读：

1. 当前正文；
2. 访谈记录开头的来源警告；
3. 第七轮“删掉不属于本篇的问题”；
4. 第八轮“原子不是业务 Harness，而是绑定运行位置的 Context”。

遇到判断不清时：

- 用户有原话：优先使用原话；
- 有项目术语：使用项目术语并给出证据位置；
- 只是写作者推导：明确标记为推导，不要包装成用户观点；
- 不属于本篇：删掉，不用为了显得完整而继续展开。

后续最自然的独立主题是“运行经验怎样改进 Context Sources，并形成自训练”。这不属于本篇；在用户给出标题、目标或具体内容以前，不应自行开始新的 Spec 或任务拆分。
