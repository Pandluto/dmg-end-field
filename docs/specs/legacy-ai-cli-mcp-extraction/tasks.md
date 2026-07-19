# Legacy AI CLI 独立化与 MCP 升级 Tasks

> 状态：T0–T9 已完成并通过最终受控装载；T10/T11 按规格等待显式产品退役确认，不属于当前兼容保留发布窗口。
> 对应规格：`docs/specs/legacy-ai-cli-mcp-extraction/spec.md`。
> 实施原则：每个 Task 独立提交；关键阶段未通过 DEF OpenCode 黑盒退出条件时不得进入下一阶段。

## 1. 全局实施规则

### 1.1 所有任务都必须遵守

- 不修改现有 Spec 的完成状态；
- 不做大爆炸重写；
- 不在同一提交中同时改变 DEF core transport、legacy proposal writer 和 Host UI；
- 保留用户 worktree 中与本阶段无关的改动；
- 默认不为纯机械抽取补大量测试；
- schema、安全边界、proposal 状态机、revision/CAS、idempotency、compatibility proxy 必须有针对性合同验证；
- 涉及 DEF agent/typed tools 的验证必须遵守 `docs/testing/def-agent-blackbox.md`；
- 新黑盒用 `DefCodexInteropProtocol v1`，Mac 桌面以协议记录为权威、Computer Use 只确认真实 UI；
- 不把端口存活、`/health`、API 单测或 repository smoke 单独视为 DEF Agent 验收；
- Electron 开发实例已运行时不得主动关闭或重启；只有验证文档规定的明确阻塞才允许受控处理；
- 每个 Task coding 完成、每次修复完成后自动提交。

### 1.2 Task 分类

| 分类 | Tasks | 含义 |
| --- | --- | --- |
| 冻结/护栏 | T0 | 不切行为，建立现状与验收事实 |
| 只做抽取 | T1、T2 | 建立 DEF 与 fill core 模块边界，保持行为 |
| 存储/进程 | T3、T4、T5 | proposal DB、Host gateway、独立 daemon |
| 兼容迁移 | T6 | 旧 REST 变成单写代理 |
| 引入 MCP | T7 | resources/tools/transports |
| Host 产品闭环 | T8 | 真实用户审批与最终保存 |
| 调用方迁移 | T9 | 外部目录与 AKEDatabase Skill |
| 退役/命名 | T10、T11 | 必须在显式产品确认后执行 |

### 1.3 推荐提交顺序

```text
T0 -> T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8 -> T9
                                              |
                                              +-> 产品确认后 T10 -> T11
```

T1 与 T2 都是行为保持型抽取，但仍建议先建立 DEF core seam，再动 `src/aiCli`，避免 legacy 抽取时把 DEF fallback 一起带走。

## T0：冻结 endpoint、状态、调用方与 DEF baseline

**类型：冻结/护栏。建议提交：** `test: freeze legacy fill and DEF core contracts`

### 修改范围

- 新增只读 inventory 文档或 machine-readable manifest；
- 补充最小 legacy wire fixtures/contract runner；
- 补充 DEF registry/route-map baseline 与测试记录；
- 记录 `/ai-cli`、SSE、`importExternalProposals` 的真实生产调用点；
- 审计 `/Users/sailstellar/Desktop/agent填表数据工具`，但不改该目录。

### 实施项

- [x] 固定 legacy endpoint 清单：AI CLI、四领域 current/library/template/check/apply、proposal list/show、Agent records/events/scripts。
- [x] 固定 storage key、proposal Wait/Yes/No 两段状态、REST 禁止命令与 pending proposal 限制。
- [x] 为四领域至少各保存一个 current/library/template/check/apply wire fixture；fixture 必须清除个人数据和绝对路径。
- [x] 固定 `17321` DEF routes、tool registry、route map、tool schema hash、health 必需字段。
- [x] 枚举 Electron、dev-agent、DEF sidecar、OpenCode plugin、renderer、smoke/contract script 对 `17321` 的调用。
- [x] 明确记录当前 `/ai-cli` 是原生 OpenCode iframe；验证是否仍有任何真实 Host UI 能调用旧 `runAiCliCommand` approve/save。
- [x] 记录外部工具目录 78 个文件的迁移分类、硬编码 REST 调用方和发布排除清单。
- [x] 记录当前 now-storage ↔ browser sync 方向和 library 变化事件。

### 禁止范围

- 不改任何 route 行为；
- 不切换 storage；
- 不重启常驻 Electron 只为收集静态清单；
- 不把历史个人 JSON 纳入 fixture；
- 不宣称旧 Y/Y UI 可用，除非真实 UI 验证已经证明。

### 验证方法

- legacy contract runner 能对冻结实现重放且记录结构化结果；
- `git diff` 只包含 inventory/fixtures/必要测试辅助；
- DEF baseline 按 `docs/testing/def-agent-blackbox.md` 完成 Required Record：prompt、session id、首答/完成时间、tool calls、当前状态变化、pending command、最终摘要、判断；
- 至少完成一个自然只读 turn 和一个会触发 typed tool 的自然 turn，不能在 prompt 中写测试意图或预期 tool 名。

### DEF 零变化退出条件

- v1 status/authorize/turn/events/transcript/questions/state 链路可用；
- 当前 tool registry/route-map、native session create/recover、session/axis binding 建立可比较 baseline；
- 不以 `17321` 监听或 API fixture 通过替代上述证据。

### 回滚点

T0 不切生产行为。若 fixture 引入敏感/个人数据，删除该 fixture 并重新从最小合成输入生成；不得清理用户真实数据作为“回滚”。

## T1：从单体提取 DEF core composition，保持 `17321` 不变

**类型：只做抽取。建议提交：** `refactor: extract DEF local core handlers`

### 修改范围

- `scripts/ai-cli-rest-server.mjs`；
- 新的 DEF core server/kernel/handler modules；
- 必要的 DEF contract tests；
- 不触碰 legacy fill 行为代码，除非只为调用抽取后的 composition。

### 实施项

- [x] 将 Timeline Repository、Work Node store、data management、approval capability、tool registry、current gate、command/result/SSE state 的 composition 提取为显式模块。
- [x] 将 `/api/def-tools/*`、`/api/main-workbench/*`、`/api/timeline-*`、`/api/ai-timeline-worknodes*` handler 从顶层 HTTP 分发中抽出。
- [x] 让原脚本继续作为相同的 Node entrypoint，继续监听相同 host/port。
- [x] 保持 `DEF_INTERNAL_GOVERNANCE_TOKEN`、raw transport header、CORS/origin、structured error 语义。
- [x] 保持 Electron、sidecar 与 plugin 无需改 URL/env 即可运行。
- [x] 为 handler 增加显式依赖注入，禁止新模块反向 import legacy fill adapter。
- [x] 在最终受控装载窗口完成 T1 自然话术黑盒复核；普通抽取验证不重启当前常驻开发实例。

### 禁止范围

- 不改 tool definition、tool 名、schema、policy、approval 或 host exposure；
- 不改 Repository schema、DB 路径和 migration；
- 不改 Electron startup/prewarm；
- 不移除 Vite/legacy fallback；
- 不重命名脚本、service 或 `AI_CLI_REST_*` env；
- 不顺便整理业务逻辑或错误文案。

### 验证方法

- T0 DEF registry/route-map/tool schema hash 差异为零；
- 运行现有 binding、current gate、tool policy、raw route、approval capability、projection、team CAS/rollback、Work Node/Timeline 相关 contract/smoke；
- 运行适量 build/typecheck，不扩大为无关全量测试；
- 按黑盒文档执行自然话术：一个 current read、一个低风险 mutation、一个需 native permission 的 case；记录真实 tool result 与 postcondition。

### DEF 零变化退出条件

- runtime 预热、native session create/recover、timeline admission、session/axis binding、current checkout 均与 T0 baseline 一致；
- native permission card 与 approval capability 的批准、拒绝、stale 至少覆盖相关变更风险；
- command enqueue 之外还必须看到 renderer result 与 postcondition；
- Timeline/Work Node SQLite 计数和 lifecycle 无意外迁移。

### 回滚点

原 `ai-cli-rest-server.mjs` composition 调用保留为可恢复入口。若出现行为差异，整 Task 回滚到旧内联 composition；不得通过改测试 baseline 掩盖差异。

## T2：抽取 `legacy-fill-core`，保持旧 REST 与 writer 行为

**类型：只做抽取。建议提交：** `refactor: extract browser-neutral legacy fill core`

### 修改范围

- `src/aiCli` 中四领域 schema/validator/normalizer；
- 新的 `legacy-fill-core` 目录；
- 旧 browser adapter 的薄包装；
- 必要的合成 fixture contract。

### 实施项

- [x] 提取 Buff、Weapon、Operator、Equipment 的 domain type、schema、normalizer、validator。
- [x] 将 read/current/library 和 apply/save 从同一 adapter interface 拆为 pure domain adapter 与 storage/Host adapter。
- [x] 提取 proposal type、base identity、review manifest 和 deterministic digest。
- [x] schema/template 从同一 core 生成，删除新增手抄 schema 的可能性。
- [x] 保留旧 localStorage writer adapter，使旧 REST fixture 行为不变。
- [x] 纯 core import 在没有 `window` 的 Node 进程中成功。
- [x] 将 prompt `?raw`、浏览器事件、sessionStorage 选择态留在 core 之外。

### 禁止范围

- 不改旧 storage key；
- 不改 validator 允许/拒绝规则和 normalized payload；
- 不改 proposal 状态或 REST response；
- 不引入 MCP SDK；
- 不将 `aiCliCommandService.ts` 整体复制进 core；
- 不为机械移动新增大批细粒度测试。

### 验证方法

- T0 四领域 check/apply fixtures 对比：normalized payload、errors/warnings、proposal summary 不变；
- core 在 Node 中无 `window`/Electron/Vite 即可导入；
- 静态检查 core 不包含 `localStorage`、`sessionStorage`、Electron、DEF、HTTP/MCP import；
- 安全合同覆盖 manifest digest 和错误路径；
- 重跑 T1 的 DEF registry diff 与一个自然黑盒 turn，证明 legacy 抽取未改变 DEF path。

### DEF 零变化退出条件

- `17321` 启动/预热不回退；
- `/api/def-tools/call` 与 native typed tool 行为保持；
- 当前 checkout 和 Timeline Repository 没有因移除 `window` shim 的局部改动受影响。

### 回滚点

旧 adapter 可恢复为直接实现；新 core 在未切 consumer 前无独立数据 migration。出现 normalization 差异时回滚整个领域的抽取，不允许在 compatibility layer 静默修形。

## T3：建立 proposal SQLite、storage ports、revision/CAS 与 audit

**类型：存储基础。建议提交：** `feat: add isolated legacy fill proposal repository`

### 修改范围

- `legacy-fill-core` storage port；
- 独立 `legacy-fill.sqlite3` repository/migration；
- proposal/idempotency/CAS 合同验证；
- 只读 snapshot repository 接口。

### 实施项

- [x] 建立 `fill_snapshots`、`fill_proposals`、`fill_proposal_events`、`fill_idempotency_keys`、`fill_schema_meta`。
- [x] 开启 foreign keys、WAL、busy timeout，并让 migration 单事务执行。
- [x] 定义 owner namespace、proposal revision、expectedRevision CAS。
- [x] 实现同 owner + idempotency key + request digest 的重复返回；同 key 不同 digest conflict。
- [x] 实现 append-only audit 与 deterministic manifest digest。
- [x] 实现 stale base 标记，不执行 product write。
- [x] 数据库路径与 Timeline Repository、Work Node DB 完全分离。
- [x] 提供备份/恢复或可审计 export，为后续 migration 回滚使用。

### 禁止范围

- 不直接打开或修改 Timeline Repository SQLite；
- 不写 browser localStorage/now-storage；
- 不允许外部 client 直接访问 DB；
- 不实现 approve/save MCP tool；
- 不切换旧 REST proposal writer。

### 验证方法

- 合同覆盖 restart persistence、CAS success/conflict、transaction rollback、idempotency duplicate/conflict、owner isolation、audit order；
- 两个 repository connection/模拟 client 的并发创建不产生重复 proposal；
- DB migration 失败不留下半表/半行；
- 静态证明没有 DEF DB import/path；
- 重跑 DEF Repository smoke 与 T1 黑盒最小集。

### DEF 零变化退出条件

- Timeline Repository schema/version/数据计数不因 proposal DB 初始化改变；
- Work Node CAS 和 approval capability 仍使用原 DB/state；
- native session 和 current checkout 不含 proposal owner 信息。

### 回滚点

此阶段 proposal DB 尚未成为生产 writer，可删除新建的空/测试 DB 或停用 feature flag；真实 migration 后只能从备份/forward migration 恢复，禁止直接删用户 proposal。

## T4：实现 Host gateway 的只读 snapshot 与受限写 port

**类型：Host 边界。建议提交：** `feat: add legacy fill host gateway contracts`

### 修改范围

- Electron/renderer 之间的 fill 专用 gateway；
- Host snapshot publisher；
- 四领域受限 writer adapter；
- library revision/change event；
- 合同测试，不切旧产品 UI。

### 实施项

- [x] 从真实已加载产品状态生成 `LegacyFillSnapshotV1`。
- [x] 每领域记录 schemaVersion、revision、contentHash、current/library。
- [x] 定义 Host-only claim/decision/apply internal API，不暴露给普通 MCP transport。
- [x] 四领域 writer 只接受合法 proposal target，不接受任意 storage key/value。
- [x] 保存前校验 proposal revision、manifest digest 和 base library revision。
- [x] 保存后重新读取目标条目，比较 normalized postcondition。
- [x] postcondition 通过后发布 `library.changed` 与新 snapshot/revision。
- [x] now-storage `forceApply` 导入完成后使旧 proposal stale；一般 browser → now-storage 方向不变。

### 禁止范围

- 不把通用 localStorage setter 暴露到 IPC/HTTP；
- 不让 Host gateway 接受 DEF session/axis/token；
- 不改变 Timeline workspace 的 SQLite ownership；
- 不切换旧 proposal 审批 UI；
- 不顺带把全部产品库迁到 SQLite。

### 验证方法

- snapshot hash/revision 在无变化时稳定、有变化时单调更新；
- stale revision、digest mismatch、错误 target、writer failure、reread mismatch 全部 fail-closed；
- 成功写只修改预期领域 key/entry，并产生一次 change event；
- now-storage force apply 后旧 proposal 无法保存；
- DEF current snapshot 与 fill product snapshot 不互相覆盖；
- 执行 T1/T3 DEF 回归和自然黑盒。

### DEF 零变化退出条件

- Workbench current snapshot、checkout projection、command queue/result 未接入 fill gateway；
- session/axis binding 与 approval capability 没有复用 Host fill review id；
- v1 state 中 Timeline/current identity 与 baseline 一致。

### 回滚点

Host gateway 此时保持 shadow/feature-disabled；回滚为旧领域 writer。若已经发布 snapshot，可丢弃 snapshot cache，但不能改真实 product library。

## T5：启动单实例 `legacy-fill-service`，建立独立状态域

**类型：进程拆分。建议提交：** `feat: run legacy fill as an isolated local service`

### 修改范围

- 独立 Node entrypoint/bundle；
- Electron process orchestration、health、shutdown；
- Host snapshot/internal gateway client；
- 打包清单与 packaged smoke。

### 实施项

- [x] 建立不依赖 Vite/`src/**` 动态 SSR 的生产入口。
- [x] Electron 单实例启动和回收服务，定义独立 port discovery/registry。
- [x] 仅注入 fill service 所需路径/token；不注入 `DEF_INTERNAL_GOVERNANCE_TOKEN`。
- [x] Host 启动后发布最新 snapshot；服务暂不接管旧 REST writer。
- [x] legacy service 故障不得阻止 `17321`、sidecar、OpenCode 预热。
- [x] health 明确报告 DB/schema/snapshot readiness，不冒充 DEF readiness。
- [x] packaged build 只带 core/service/curated resources，不带桌面工具目录。

### 禁止范围

- 不修改 `17321` 和 DEF startup order；
- 不让 DEF sidecar 自动启动 legacy fill service；
- 不复用 DEF runtime workspace、session directory 或 token；
- 不启用 MCP tools；
- 不切 legacy REST。

### 验证方法

- service 可独立启动/退出/重启，proposal DB 和 snapshot 恢复正确；
- Electron 退出回收 service；service crash 时 DEF 仍能创建 native session 和调用 tool；
- packaged-sidecar smoke 与新的 fill-service packaged smoke 都通过；
- 安装包清单不含 `__pycache__`、个人 JSON、绝对路径残留；
- 完整执行 `docs/testing/def-agent-blackbox.md` 的 startup/native session/current read case。

### DEF 零变化退出条件

- Electron 预热日志仍证明 DEF rest → sidecar → OpenCode 的原顺序；
- legacy service 未就绪时 v1 status/turn、native session recover 和 typed tools 正常；
- 不以两个 health 都是 200 作为黑盒完成证据。

### 回滚点

移除/关闭 Electron 的 legacy service feature flag；不影响 `17321`。保留 proposal DB 以便重新启用，不在回滚时删除用户数据。

## T6：将 legacy REST 改为新 service 的单写兼容代理

**类型：兼容迁移。建议提交：** `refactor: proxy legacy fill REST to isolated service`

### 修改范围

- `17321` legacy route fallback 或独立 compatibility adapter；
- legacy response/request mapping；
- originVersion/idempotency 映射；
- proxy contract tests 和 feature flag。

### 实施项

- [x] domain current/library/template/check/apply 先逐类切到新 service。
- [x] `/api/ai-cli/spec` 只作为兼容生成文档，不再是新事实源。
- [x] proposal list/show 映射到新 repository；`clear` 仅在 compatibility REST 中将调用者 legacy owner 下的 pending proposal 记为取消/拒绝，不进入 MCP，也不获得批准/保存能力。
- [x] 每个 apply request 只由新 proposal repository 写一次。
- [x] requestId/client 迁移为 owner/idempotency 时保持可追溯映射。
- [x] 旧 response shape、status code 与 error code 在兼容窗口内保持。
- [x] legacy service 不可用时明确返回 unavailable；禁止先写旧 store 再补写新 DB。

### 禁止范围

- 不代理 `/api/def-tools/*`、Workbench、Timeline 或 Work Node；
- 不允许新旧 proposal 双写；
- 不把 REST client 伪装为 Host 审批者；
- 不移除 legacy route；
- 不改 DEF error mapping。

### 验证方法

- T0 legacy wire fixtures 全量对比；
- 证明同 request 重试只生成一个 proposal；
- 证明 proxy timeout/retry 不产生双写；
- 证明 REST 仍拒绝 approve/save/Y/N；
- 负向证明 `/api/def-tools/call` 不会到达 legacy service；
- 执行全部相关 DEF contract + 黑盒 current mutation/native permission case。

### DEF 零变化退出条件

- DEF route-map/schema hash 与 T0 相同；
- tool call latency/terminal state 无显著异常；
- command/result/postcondition 和 approval capability 完整；
- Timeline/Work Node 数据无 legacy proposal 行或 audit。

### 回滚点

feature flag 将 legacy route 指回冻结实现，且必须先停止新 writer；按 `originVersion` 保留已创建 proposal，不做逆向双写。回滚演练需证明旧实现不会重复导入新 DB proposal。

## T7：实现 MCP resources、tools、Streamable HTTP 与 STDIO facade

**类型：引入 MCP。建议提交：** `feat: expose legacy fill proposals through MCP`

### 修改范围

- 官方 MCP TypeScript SDK `v1.x` 生产稳定版本；
- Streamable HTTP server；
- STDIO facade；
- resources/tools schema；
- MCP security/negative contract tests。

### 实施项

- [x] 实现 spec 中 8 类 versioned resources。
- [x] 实现 `fill_get_current`、`fill_search_library`、`fill_get_template`、`fill_validate`。
- [x] 实现 `proposal_create`、`proposal_list`、`proposal_inspect`。
- [x] 所有 tool 定义 input/output schema、structured errors、size/page limits。
- [x] Streamable HTTP 使用单实例 proposal DB 和 Host snapshot。
- [x] STDIO facade 只转发到 daemon；stdout 仅 MCP，日志到 stderr。
- [x] loopback bind、Origin/Host validation、每 client auth、token redaction。
- [x] transport session 与 owner namespace 分离。
- [x] 文档明确不依赖 MCP Tasks、sampling、elicitation。
- [x] SDK 版本锁定；v2 升级另开任务，不与首轮切流合并。

### 禁止范围

- 不注册 approve/reject/save/unsave/direct-write/script/file/DEF tools；
- 不允许任意 resource path；
- 不读取 `DEF_INTERNAL_GOVERNANCE_TOKEN`；
- 不为每个 STDIO client 启动独立状态 DB；
- 不让 MCP 直接调用 Host writer internal endpoint。

### 验证方法

- tools/list 与 resources/list 允许清单精确匹配；
- JSON Schema 正反例、structured output、分页、body limit；
- 两个 HTTP client 和一个 STDIO client 看到共享状态；owner 隔离有效；
- DNS rebinding/非法 Origin/Host/无 token 被拒绝；
- 反射/猜测 tool 名无法调用 approve/save；
- 连续调用所有允许 tools 后 product library hash 不变；
- service restart 后 proposal/idempotency/audit 不丢失；
- 完整 DEF 黑盒回归，证明新 MCP server 不影响 native tools。

### DEF 零变化退出条件

- MCP token 与 DEF token 物理、配置和日志上隔离；
- DEF native tool registry 不出现 legacy MCP tools；
- OpenCode permission 和 Work Node mutation 仍只走 DEF core；
- Interop/Harness correlation 与 terminal states 正常。

### 回滚点

关闭 MCP listeners/facade，不关闭 legacy service proposal DB；legacy REST proxy 可继续工作。SDK/transport 回滚不得回滚 proposal schema，必要时用 forward-compatible adapter。

## T8：实现 Host proposal 审查、用户确认与最终保存

**类型：Host 产品闭环。建议提交：** `feat: add host-owned legacy fill review and save`

### 修改范围

- 产品 proposal review UI；
- Electron Host claim/decision/apply；
- manifest renderer；
- write/reread/postcondition/library event；
- UI 与安全合同验证。

### 实施项

- [x] UI 展示 target、base revision、normalized draft、逐字段 diff、validation、warnings、evidence、requested writes、digest。
- [x] 只有受保护的主 Web renderer 可访问 approve/reject/save bridge；产品 handler 要求真实 UI 事件，服务端 capability 绑定 proposal/session/revision/digest。
- [x] 首版按产品决定保留两步审核/保存或合并 UI；底层仍分别记录 review/persistence。
- [x] 用户动作绑定 proposal revision、manifest digest 与当前 library revision。
- [x] stale 时禁止保存并提示重新生成/rebase，不让模型自动覆盖。
- [x] Host writer 写入后重读，postcondition 失败标记 failed 并保留审计。
- [x] 成功后发布 revision/change event，相关页面立即重读。
- [x] 不再要求用户在聊天中键入 Y/Y；旧 proposal origin 在兼容窗口仍可识别。

### 禁止范围

- 不把审批按钮放进 MCP client UI 作为等价 Host authority；
- 不让 REST 文本命令触发 user action；
- 不显示自由文本 summary 而隐藏完整 diff；
- 不把 DEF native permission capability 用作 fill save token；
- 不触碰 Workbench mutation。

### 验证方法

- pending → approve → save、reject、stale、CAS conflict、writer failure、postcondition failure 全路径；
- 用户看到的 manifest digest 与 Host apply 的 digest 一致；
- 未确认时 product library hash 不变；
- 保存成功只改目标领域，revision/event/reread 一致；
- 模拟 MCP/REST 重试不能复用旧确认写入新内容；
- Computer Use 验证真实 review UI 可见；DEF Agent 验收仍按黑盒文档，不把 fill UI 测试混作 DEF 测试。

### DEF 零变化退出条件

- Host fill review 不出现在 OpenCode native permission/questions store；
- DEF approval capability、session axis、Timeline audit 无 fill proposal 记录；
- Workbench AI 自然话术和 typed mutation 完整通过。

### 回滚点

关闭新 review UI/writer，保留 proposal 为 pending/failed；已成功保存的数据按产品现有编辑/undo/备份机制处理，禁止通过数据库删 proposal 假装回滚 product library。

## T9：迁移外部工具目录与 AKEDatabase Skill

**类型：调用方迁移。建议提交：** `docs: route AKEDatabase fill workflows through MCP`

### 修改范围

- `agent/runtime/def/skills/akedatabase-fill-tool`；
- curated guides/fixtures/resources；
- 外部工具目录的迁移说明或归档计划；
- MCP client 配置示例。

### 实施项

- [x] 将 `CLAUDE.md` 协议部分替换为由 core/MCP schema 生成的引用。
- [x] 筛选填写策略，明确标注 strategy 而非 protocol。
- [x] 将 `golden-examples.md` 拆为按 schema version 验证的 fixtures/resources。
- [x] 将 AKEDatabase Skill 缩为 MCP 路由说明；若无额外价值，提交独立移除提案。
- [x] 给 `common_http.py` 和硬编码 REST caller 提供 MCP 替代说明。
- [x] 历史 Python/MJS/JSON 默认归档，不作为发布运行时。
- [x] 发布 allowlist 排除缓存、临时请求、个人草稿、Windows 绝对路径、异常文件名。
- [x] 完成调用方清单，标记 migrated/archived/blocked/owner。

### 禁止范围

- 不把整个 `/Users/sailstellar/Desktop/agent填表数据工具` 复制进仓库或安装包；
- 不把历史脚本包装为 MCP `script_run`；
- 不保留 `CLAUDE.md`、Skill、schema 三份协议；
- 不把 `.agents/skills/**` 开发 Skill 与产品 runtime Skill 混放；
- 不在此 Task 删除 legacy REST 兼容代理。

### 验证方法

- 每个 curated golden fixture 通过绑定版本 validator；
- resources 中无绝对路径、个人 library dump、token、缓存；
- Skill 只描述 resource/tool 路由，不复制字段 schema；
- 至少一个原 Python 工作流用 MCP read → validate → proposal_create → Host review 完成迁移演示；
- DEF OpenCode 黑盒回归，特别确认产品 runtime Skill 变更不影响 workbench Harness/typed tools。

### DEF 零变化退出条件

- `timeline-workbench` Skill/Harness 未引用 legacy fill resources；
- native tool registry 和 DEF knowledge allowlist 不因 AKEDatabase Skill 简化而漂移；
- Interop/Harness baseline 通过。

### 回滚点

恢复上一个版本的 Skill 路由说明；curated resources 使用版本号并可并存。外部历史目录保持原样，归档动作必须可恢复且由用户另行确认。

## T10：在产品确认后移除 legacy REST fallback 与旧 Y/Y

**类型：退役；需要显式产品确认。建议提交：** `refactor: retire legacy AI CLI proposal flow`

### 前置条件

- [ ] 调用方清单中无 active legacy REST client；
- [ ] 至少一个发布窗口已验证 MCP + Host review；
- [ ] proposal export/retention/rollback 策略已批准；
- [ ] 用户明确确认旧 `/ai-cli` proposal/Y/Y 的产品迁移策略；
- [ ] DEF 全矩阵最近一次为通过。

### 修改范围

- legacy domain REST compatibility routes；
- `/api/ai-cli/run/spec`、Agent records/events/scripts；
- 旧 proposal command state machine 与无调用 UI/import code；
- 兼容文档与 smoke。

### 实施项

- [ ] 先发布 deprecation telemetry/明确错误，再删除 endpoint。
- [ ] 移除旧 approve/save/Y/N command 与 Web CLI handoff 文案。
- [ ] 移除 temporary Agent scripts API 和运行目录入口。
- [ ] 移除 Vite SSR 对 `src/aiCli` legacy module 的运行时依赖。
- [ ] 保留数据 migration/export，不丢旧 proposal 审计。
- [ ] 确认 `17321` 只剩 DEF core 与必要内部兼容 transport。

### 禁止范围

- 不删除 `/api/def-tools/*`、Workbench、Timeline、Work Node；
- 不因为名称中有 `ai-cli` 就删除 native host/session 支持；
- 不在无用户确认时执行；
- 不修改现有 Spec 的完成状态。

### 验证方法

- legacy caller scan 为零或只剩明确归档 fixture；
- MCP/Host 完整流程和数据迁移通过；
- packaged build 不再需要 Vite SSR legacy adapter；
- 执行 DEF 零行为变化矩阵全部行，而非抽样。

### 回滚点

一个发布窗口内保留可恢复 compatibility package/feature flag；回滚只恢复 proxy，不恢复双写和模型审批。旧 proposal DB 通过 reader adapter 可见。

## T11：最后重命名 `AI CLI REST` 为 DEF local core service

**类型：可选命名/清理；需要 T10 完成。建议提交：** `refactor: rename AI CLI REST to DEF local core`

### 修改范围

- script/service/env/health label；
- Electron、dev-agent、sidecar、plugin、packaging、docs；
- 一期兼容 alias。

### 实施项

- [ ] 选择真实反映职责的服务名和脚本路径。
- [ ] `AI_CLI_REST_*` env 提供有期限 alias，记录 deprecation。
- [ ] 保持 `17321` 或按单独端口迁移规格执行；本 Task 默认不改端口。
- [ ] 更新 health/status UI 文案，不改变 readiness 语义。
- [ ] 更新打包清单、sidecar fallback 和所有 smoke/contract path。

### 禁止范围

- 不同时重构 handler 或 Repository；
- 不改变 DEF API；
- 不把 legacy fill service 再命名回 DEF core；
- 不无兼容期删除旧 env/script alias。

### 验证方法

- 全仓旧名调用扫描只剩兼容 alias/历史文档；
- Electron startup、sidecar fallback、OpenCode plugin、packaged runtime 全路径；
- DEF 零行为变化矩阵全部通过。

### 回滚点

恢复旧脚本名/env/health label alias；数据和端口不迁移，因此回滚不触碰 SQLite。

## 2. 每个关键阶段的统一 DEF 回归清单

T1、T2、T3、T4、T5、T6、T7、T8、T9 的提交前至少执行与风险成比例的以下检查；T6、T7、T8、T10、T11 必须执行全矩阵：

- [x] runtime 启动与预热；
- [x] native session create/recover；
- [x] Workbench timeline admission；
- [x] session/axis binding；
- [x] current checkout context；
- [x] tool registry/route-map/schema parity；
- [x] native typed tool read；
- [x] 低风险 current mutation + command/result/postcondition；
- [x] native permission + approval capability；
- [x] Work Node fork/materialize/sync/validate/diff/use/restore（涉及核心/transport 阶段必须全做）；
- [x] Timeline Repository/SQLite restart/lifecycle；
- [x] Interop/Harness v1 events/transcript/questions/state；
- [x] 真实 iframe UI 可见性；
- [x] Required Record 完整，黑盒 prompt 不泄漏测试意图。

若 case blocked/stall/repeated tool activity，按 `docs/testing/def-agent-blackbox.md` 先收集 session events、transcript、questions 和 state，不重复发送相同 prompt，不删除正常 native session。

## 3. 完成定义

本实施计划最终完成需要同时满足：

- legacy fill 有独立 pure core、daemon、proposal SQLite、MCP 与 Host gateway；
- MCP 只能读、校验、创建、列出和审查 proposal；
- 真实用户审批和最终保存只能发生在 Host；
- 外部工具目录与 AKEDatabase Skill 不再维护重复协议；
- legacy REST/Y/Y 的退役经过用户显式确认；
- `17321` 的 DEF core 行为、native typed tools、Timeline/Work Node/CAS、permission、Interop/Harness 全部通过零变化矩阵；
- 每个阶段有独立 commit 和可执行回滚点。
