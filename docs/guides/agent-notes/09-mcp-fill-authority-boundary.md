# MCP 进入填表流程以后，谁握有写入权

最早的 AI 填表能力和 DEF local core 共享同一个 REST 服务。角色、武器、装备和 Buff 的校验逻辑依赖浏览器代码，提案也由旧 AI CLI 页面读取和处理。

这套流程可以运行，但很难回答几个越来越重要的问题：外部 Codex 应该连接谁，标准 MCP 到底开放哪些能力，提案是谁创建的，以及谁有资格把它写进产品数据。

这次开发没有给旧 REST 简单套一层 MCP。真正的工作，是先拆开计算、传输、提案和产品写入，再让每一层只拥有完成职责所需的权限。

## MCP 不是另一个 Agent

`MCP（Model Context Protocol）` 是客户端与能力服务之间的标准连接协议。它规定怎样发现资源、调用工具和返回结构化结果，但不替客户端思考，也不会自动获得桌面应用的全部权限。

在当前项目中，几个名称对应如下：

| 名称 | 当前含义 |
| --- | --- |
| MCP Client | Codex 或其他标准 MCP 客户端，负责发起读取、校验和创建提案。 |
| MCP Server | 独立运行的 `legacy-fill-service`，提供受限的 Resources 和 Tools。 |
| Streamable HTTP | MCP 的主要本地传输，入口是 `127.0.0.1:17323/mcp`。 |
| STDIO Facade | 从私有配置读取连接信息，再把标准输入输出转到同一个服务的本地适配器。 |
| Resource | 版本化、只读的模板、策略、示例或提案状态。 |
| Tool | 一次有明确输入和输出的操作，例如读取当前数据、校验草稿或创建提案。 |

MCP Client 和 DEF OpenCode 也是两条平行链。DEF OpenCode 仍通过自己的 Session、Harness 和 Typed Tools 操作 Workbench；它没有注册、代理或调用这个 MCP Server。MCP 抽离完成后，DEF 只作为零回归对象接受检查。

```text
Codex / 标准 MCP Client        DEF OpenCode
          ↓                        ↓
legacy-fill-service           DEF Sidecar + Typed Tools
          ↓                        ↓
填表提案与只读快照             Work Node / Timeline
```

两边都可能使用模型和工具，但身份、状态、权限与数据链路不能混用。

## 先把浏览器逻辑变成纯 Core

旧填表逻辑长期放在 `src/aiCli` 下，部分模块会直接接触 `localStorage`、浏览器类型或页面状态。如果 MCP Server 直接导入这些代码，它就会同时继承浏览器环境假设和产品写入路径。

因此第一步是抽出 `legacy-fill-core`。它只负责四个领域的模板、规范化与校验：

```text
明确输入
  → schema / template
  → normalize
  → validate
  → 结构化结果或结构化错误
```

Core 不启动服务、不读取任意文件、不接触 localStorage，也不决定是否保存。浏览器旧调用方和独立服务都可以复用同一份领域逻辑，但各自的数据来源和权限仍由外层控制。

这一区分解释了两个容易混淆的名称：

- `legacy-fill-core` 是无宿主的领域逻辑；
- `legacy-fill-service` 是持有 MCP transport、只读快照和 Proposal Repository 的本地服务。

名字里都带 `legacy-fill`，不是说新实现仍把旧结构原样保留，而是标明它迁移的是历史 AI 填表能力，并与 DEF core 保持清楚边界。

## MCP 可以创建提案，不能作出决定

当前 MCP 只开放七个 allowlisted tools：读取当前数据、搜索资料库、取得模板、校验草稿，以及创建、列出和查看提案。

| Tool 名称 | 它实际做什么 |
| --- | --- |
| `fill_get_current` | 读取 Host 已发布的当前领域快照。 |
| `fill_search_library` | 在允许的领域资料中搜索候选。 |
| `fill_get_template` | 取得由 Core 生成的当前版本模板。 |
| `fill_validate` | 规范化并校验客户端明确提交的草稿。 |
| `proposal_create` | 把已校验内容写入所属 owner 的提案库。 |
| `proposal_list` | 列出当前 owner 可见的提案。 |
| `proposal_inspect` | 查看一份提案的审核内容与状态。 |

明确不存在的 MCP 能力包括：

- approve、reject 或 save；
- localStorage、now-storage 或任意产品存储写入；
- 任意文件读取或脚本执行；
- DEF Tool、Work Node、Timeline 或原生 Permission；
- Host 内部 writer 和批准接口。

这里的 `Proposal（提案）` 是一份已经通过 Core 校验、可以交给用户检查的候选结果。创建提案只说明“这份内容符合结构要求并已进入审核队列”，不说明用户同意，更不说明产品已经改变。

```text
MCP read / validate
        ↓
Proposal Create
        ↓
等待产品用户审核
```

每个鉴权客户端会映射到稳定的 `ownerNamespace`。它用于隔离不同 MCP Client 的提案；MCP transport session id 只负责一次连接，不能被拿来冒充提案 owner。DEF Session、Timeline 或 Workbench 身份也不会进入这个命名空间。

`Proposal Repository` 是提案的独立 SQLite 事实源；`Review Manifest` 则固定一次审核实际包含的领域、基线、候选内容和摘要。一个负责保存状态，一个负责回答“用户眼前审核的究竟是哪份内容”。

## 用户面对的是产品页，不是协议检查器

最初的 Host review 里程碑曾使用独立 Electron 审核窗口。随后产品入口收敛到主 Web 应用的 `/#/mcp-fill`，用户名称是 **MCP 填表**；旧 `/#/legacy-fill-review` 只保留为兼容别名，不再创建一套 Electron 产品窗口。

页面左侧是可搜索的提案队列，右侧按武器、干员、Buff 或装备显示对应的产品结果。它不会把 normalized payload、revision digest、owner namespace、进程 PID 或 Host token 当作主要内容展示。

用户只看到两个决定：

- **拒绝**：结束提案，不改变产品数据；
- **确认并写入**：经过一次确认，执行受保护的产品写入和结果核对。

内部仍有 claim、approval、save-begin、write、reread、save-result 等阶段。把它们合成一次用户动作，是为了让交互简单；阶段本身没有被省略，因为审计、失败恢复和权限校验仍需要知道写入进行到哪里。

## 真正的写入权留在 Host

MCP Server 能证明提案来自谁、内容是什么，却不能证明主 Web 中的用户已经决定写入。真正的权限边界由受保护的 Web Host bridge 承担。

用户确认时，主 Web renderer 向 Host 申请一个短时、一次性的 `Action Capability（操作通行证）`。它不只是“允许保存”，还精确绑定：

```text
proposal id
+ review session
+ current revision
+ review manifest digest
```

任一身份或版本变化，旧 capability 都会失效。这样可以避免用户看到并确认 A，系统却因为队列刷新或迟到请求写入 B。

`Event.isTrusted` 只能辅助判断事件来自真实浏览器交互，不能作为服务器证明。Host 真正信任的是受保护 renderer transport、review 绑定和一次性 capability，而不是客户端传来一句“用户点过确认”。

写入完成后也不能只相信 writer 返回成功。Host 会重新读取目标领域，检查 Postcondition，再发布新的只读快照 revision，并记录 save-result。MCP 下一次读取时看到的是 Host 发布后的新事实，而不是它自己刚才提交的草稿。

## Revision、Digest 与 CAS 各自保护什么

这一链路反复出现三个相近的名称：

| 名称 | 保护的对象 |
| --- | --- |
| Revision | 提案或产品快照处于哪一版。 |
| Digest | 本次审核内容的稳定摘要，防止内容变了但名字没变。 |
| CAS | 只有当前版本仍等于预期版本时，才允许状态迁移或写入。 |

例如页面打开提案版本 2，用户确认前服务端已经把它更新到版本 3，那么版本 2 的 action capability 不能继续使用。CAS 拒绝这次旧写入，页面必须重新读取，让用户看到新的内容后再决定。

这与 Workbench 中批准绑定 Session、父节点和候选版本是同一个原则：批准必须指向明确且未变化的对象。

## 写成功但回执丢了怎么办

产品写入可能已经成功，随后快照发布或 save-result 审计却因为页面关闭、服务重启或连接中断而失败。此时直接重写一遍，会制造重复副作用；直接标记失败，又会让提案记录与产品事实不一致。

主 Web 因此保留一个持久化 `Outbox（待投递记录）`：

```text
领域写入成功
  → 保存待发布结果
  → 尝试更新快照与审计
  → 中断时保留 Outbox
  → 下次授权页面启动后 reconciliation
```

恢复时先重新读取产品事实，再补齐快照和审计，而不是盲目再次执行 writer。它延续了前一篇手记中的同一条经验：响应丢失不等于操作没有发生。

## 兼容代理为什么还在

历史调用方仍通过 `17321` REST 访问填表能力。当前实现把这些路由变成访问同一 Core 和 Proposal Repository 的 compatibility proxy，避免新旧链路形成双写事实源。

这条代理仍存在，不代表它是推荐的新入口。新外部工作流应直接使用 MCP；旧 REST 只有在后续发布窗口获得明确产品确认后才会退役。`DEF local core` 的重命名也被单独门控，避免在能力拆分的同时制造无关迁移风险。

当前几个对用户和开发者都重要的名称可以这样记：

| 名称 | 应该怎样理解 |
| --- | --- |
| MCP 填表 | 主 Web 中的用户审核与写入产品入口。 |
| Legacy Fill MCP | 这组历史填表能力独立化后的开发主题和服务链。 |
| `legacy-fill-core` | 浏览器无关的领域模板、规范化和校验。 |
| `legacy-fill-service` | 独立 MCP、只读快照和提案存储服务。 |
| Host bridge | 产品内部受保护的审核和写入边界。 |
| Compatibility proxy | 暂时承接旧 REST 调用方的兼容入口。 |
| DEF OpenCode | 平行的 Workbench Agent Runtime，不是 MCP Host。 |

## 结语

把一个功能接成 MCP，真正困难的部分通常不是让工具列表出现在客户端，而是决定哪些能力可以标准化开放，哪些决定必须留在产品内部。

当前链路中，MCP 负责读、校验和准备提案；用户在 MCP 填表页面作出决定；Host 负责受控写入、回读和审计；Core 只维护领域规则；DEF OpenCode 继续走自己的 Agent 与 Work Node 链路。

这些名字一旦各自指向稳定职责，系统才能同时做到可接入、可审核，也不会因为“支持 MCP”就把产品写入权一起交出去。

实现、连接和验收细节仍以 [Legacy Fill MCP 文档索引](../../specs/legacy-ai-cli-mcp-extraction/README.md) 与 [日常开发说明](../../development/legacy-fill-mcp.md) 为准。
