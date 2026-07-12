# Task 7-1：完成 Spec 7 的 DEF OpenCode 本地特色化前后端联合开发

## 状态

已完成（2026-07-12）。实现与验收证据见 [`verification.md`](./verification.md)。

Task 7-1 是 Spec 7 的唯一总实施任务，不是前置盘点或第一阶段任务。允许按检查点分批编码、验证和提交，但任务完成必须意味着 [`spec.md`](./spec.md) 的职责隔离、三类工具、节点代码工作区、原生交互、前端裁剪、节点变更、历史、主题和整体验收全部完成。

不得将未完成内容推给未定义的 Task 7-2、Task 7-3 或“后续优化”。确需改变范围时必须先修改 Spec 7 并由用户确认。

## 总目标

将当前“DEF 外壳 + 通用 OpenCode”收敛为一套真正属于 DEF 的共享原生前端：

```text
Workbench AI mode
  → locked def-workbench
  → 当前主界面上下文
  → def-node-code 自由节点代码修改
  → def-node-crud 生命周期/审批/use
  → def-data-resource 可信业务数据

/AI CLI
  → 独立 DEF agent/profile/session/history/directory
  → 数据资源、填表、资料处理
  → 仅在自己的任务中使用节点工作区

Shared DEF OpenCode UI
  → 单一新建会话入口
  → 节点变更 review
  → 原生 question/permission/tool/timeline
  → DEF feature matrix
  → 黑白蓝线稿 theme adapter
```

## 完成定义

以下九个实施部分必须全部完成：

1. 修复 Workbench 与 `/AI CLI` 的 agent、职责和上下文隔离。
2. 将 `def-node-code` 落实为可靠的节点代码工作区协议。
3. 完成 codec、校验、semantic diff、risk、revision 与原子 use。
4. 使用 OpenCode 原生 question/permission 完成 DEF tool 交互与审批。
5. 建立共享 host bootstrap profile 与单一 feature matrix。
6. 删除宿主重复入口并裁剪 OpenCode 通用综合功能。
7. 将原生“更改”改造成 Work Node“节点变更”。
8. 完成 session—Work Node—checkout 历史和黑白蓝线稿主题。
9. 完成真实浏览器、黑盒、安全、冲突、恢复和构建验收。

---

## 第一部分：修复两个宿主的职责隔离

### 1.1 Workbench agent 锁定

- [x] 审计 native session create、restore、switch、send、retry、continue、compact、fork session 和 permission continuation 的 agent 来源。
- [x] Workbench host 在所有入口强制绑定 `def-workbench`。
- [x] 后端校验 `host=workbench`、session metadata 和 `agent=def-workbench` 一致。
- [x] 清理或迁移可能将 Workbench 恢复成 `Def-operator` 的 OpenCode/localStorage 状态。
- [x] Workbench 不显示通用 agent 选择器，也不能通过命令、快捷键或 URL 切换 agent。
- [x] `/AI CLI` 使用自己的 agent/profile，不继承 Workbench agent。
- [x] 全局 `default_agent` 不再成为 Workbench 消息发送的隐式回退。

### 1.2 Workbench prompt 与 skill

- [x] 为 Workbench 建立明确的排轴/节点修改 skill，不再绑定语义偏离的 `rest-search`。
- [x] system prompt 明确“排轴”是三类工具组合能力，不是一把专用 tool。
- [x] 明确“先看看/先不要应用”停在 rebuild/validate/diff。
- [x] 明确“应用/就这样”才进入 approval/use。
- [x] 禁止回答“没有排轴工具，只能辅助用户手动排轴”。
- [x] 禁止把自由节点修改重新翻译成按钮级 REST command 或 Patch DSL。
- [x] `/AI CLI` prompt 保持数据资源、填表、资料处理职责，与 Workbench 文案和默认行为分离。

### 1.3 Workbench context contract

- [x] 定义带 schema version、source 和 updatedAt 的 Workbench context。
- [x] 提供 HEAD、checkout ref、active Work Node 和 pending node 状态。
- [x] 提供选中干员、技能按钮、staff、组别、格位和顺序摘要。
- [x] 提供 Buff、目标、抗性、异常和伤害摘要。
- [x] 将当前被丢弃的 `selectedCharacters`、`skillButtons` 和 Work Node change callback接入真实上下文链路。
- [x] 使用有界只读 native tool、host endpoint 或 session attachment 按需读取，不永久塞入巨型 system prompt。
- [x] context 更新后按 host + session 精确通知，不串到 `/AI CLI`。

### 1.4 职责黑盒基线

- [x] Workbench 对“你可以排轴吗”明确回答可以，并说明预览/应用边界。
- [x] Workbench 对真实排轴请求进入节点代码修改流程。
- [x] `/AI CLI` 面对同一问题保持自己的数据/资料职责，不声称继承当前主界面轴。
- [x] 两个宿主同时运行时消息、agent、context、tool call 和 approval 无串线。

---

## 第二部分：建立 `def-node-code` 节点代码工作区

### 2.1 文件角色与目录

- [x] 将 node workspace 从 session 配置目录中明确分层。
- [x] 提供只读 `manifest`，记录 node/session/host/agent/schema/revision/hash。
- [x] 提供 repository base 的只读投影。
- [x] 提供模型可修改的规范化 `working/**` 业务源。
- [x] 提供 checkout 与可信资源的只读 `context/**`。
- [x] 提供 codec 生成的 payload、validation、diff、risk 等只读 `generated/**`。
- [x] materialize 使用临时目录 + rename 或等价方式原子生成，避免半成品工作区。
- [x] 一个活跃代码工作区只绑定一个 node；dirty 时 bind 其他 node 不得静默覆盖。

### 2.2 规范化 source model

- [x] 盘点 `TimelineSnapshotPayload` 中业务输入、重复镜像、派生缓存和运行时快照。
- [x] 按钮业务事实在 editable source 中只保存一次。
- [x] 明确 staff、slot、skill、Buff reference 的稳定结构和 schema version。
- [x] 从 editable source 自动生成 `occupiedNodes`、nodeIndex、nodeNumber、position、skillButtonTable 与 timelineData 镜像。
- [x] 将可重建的 computed/display cache 移出 editable truth。
- [x] 将真正的 operator/weapon/equipment 等用户输入抽取为明确 source，或记录本轮只读边界。
- [x] 对暂未建模字段建立保真透传和 raw fallback，不允许静默丢失。
- [x] 保持稳定 id，避免格式化或重建时无故生成新按钮/Buff id。

### 2.3 原生代码工具

- [x] `read` 仅能读取当前 node workspace 允许区域。
- [x] `edit/apply_patch` 只能写入 `working/**`。
- [x] `glob/grep` 只能搜索当前 node workspace。
- [x] base/context/generated/manifest 的写入由实际 path guard/permission 拒绝。
- [x] session 配置、plugin、其他 node、项目源码、用户目录和外网继续不可访问。
- [x] OpenCode tool discovery 将原生文件工具明确归入 `def-node-code`。
- [x] tool card 显示 DEF 业务名称、目标文件和当前 node，不只显示通用文件工具名。

### 2.4 工作区级 canonical bindings

- [x] 注册 materialize 能力到 `def-node-code`。
- [x] 注册 workspace status 能力，返回 node/revision/dirty/validation/conflict。
- [x] 注册 rebuild 能力，替代“整个 JSON 原样 sync”语义。
- [x] 注册 revision conflict/rebase 能力；首轮若不能自动 rebase，必须返回完整证据和安全选择。
- [x] 注册 discard 未同步代码修改能力，并使用原生确认。
- [x] 保证 fork/bind/list/create/delete/diff/approval/use/restore 仍归 `def-node-crud`。
- [x] 保证数据查询和填表事实仍归 `def-data-resource`。
- [x] registry、native definitions、route map 和诊断列表从同一事实源派生。

---

## 第三部分：完成 codec、校验、diff、risk 与 use

### 3.1 materialize codec

- [x] 从 repository 读取并校验 base/working payload。
- [x] 计算 node revision、base hash 和 working hash。
- [x] 解码为规范化 editable source。
- [x] 提取只读 checkout/context/resource 信息。
- [x] 生成 manifest 与初始 reports。
- [x] 无修改 materialize 不触碰 repository 或 checkout。

### 3.2 rebuild codec

- [x] 只读取 manifest 声明的 editable source。
- [x] 解析 syntax 和 schema，错误定位到文件与 JSON pointer/行列。
- [x] 重建重复镜像和派生结构。
- [x] 从 repository 安全合并保留字段，不信任工作区 base/generated 文件。
- [x] 执行 compare-and-swap 更新 node working revision。
- [x] 刷新 generated payload/validation/diff/risk。
- [x] rebuild 全程不触碰 current checkout。

### 3.3 round-trip 与未知字段

- [x] 建立 `decode(payload) → encode(source)` 业务等价检查。
- [x] 记录排序、缺省值、规范化和派生缓存重算造成的允许差异。
- [x] 对未知字段建立保真检查。
- [x] 未知字段丢失或无法解释的变化阻止 use。
- [x] schema version 变化具备明确迁移或失败路径。

### 3.4 分层 validation

- [x] syntax validation。
- [x] schema validation。
- [x] invariant validation。
- [x] resource reference validation。
- [x] calculation/rebuild validation。
- [x] read-only/policy validation。
- [x] revision/concurrency validation。
- [x] 校验 occupiedNodes、格位冲突、staff/selectedCharacters、按钮镜像、Buff 双向引用和删除后悬空引用。
- [x] 校验可信干员、技能、Buff、武器、装备 id。
- [x] 校验计算结果不存在 NaN/Infinity 或不可重建状态。
- [x] issue 返回 code、severity、file、path、用户说明和可选修复建议。

### 3.5 semantic diff

- [x] 展示干员选择和顺序变化。
- [x] 展示按钮新增、删除、移动、换技能。
- [x] 展示 Buff 绑定与 Buff 内容变化。
- [x] 展示 hit/倍率、武器、装备、角色输入变化。
- [x] 展示目标、抗性和异常变化。
- [x] 提供无法归类字段的 raw fallback diff。
- [x] diff hash 稳定绑定 node revision，用于 approval。

### 3.6 risk 与并发

- [x] 每次 rebuild 重新计算 riskFlags，不沿用旧节点风险。
- [x] 识别批量删除/移动、角色替换、大范围变化、未知资源、自定义倍率和 HEAD 分叉。
- [x] 识别未知字段丢失或异常影响范围。
- [x] 两个 session 同时修改同一 node 时，旧 revision rebuild 被拒绝。
- [x] 冲突结果提供重新读取、rebase 或另 fork 的原生交互选项。

### 3.7 approval 与原子 use

- [x] use 前重新校验 node revision、validation、diff/risk hash 和 approval。
- [x] 只有 use 能改变 current checkout。
- [x] repository commit、checkout command 与 renderer applied 分别记录。
- [x] command pending 或 renderer 未确认时不声称应用成功。
- [x] approval 拒绝、use 失败和 renderer 失败时 checkout 保持或恢复一致状态。
- [x] restore 使用相同 revision/approval/renderer 证据链。

---

## 第四部分：复用 OpenCode 原生询问、确认与审批

### 4.1 native question

- [x] 对缺失输入、目标消歧和有限选择调用 OpenCode native question。
- [x] 能由 Workbench context 或数据资源可靠解析的信息不重复询问。
- [x] question 选项展示业务名称和影响，不泄露内部 REST/tool protocol。
- [x] question event 按 host + session 路由。

### 4.2 native permission/ask

- [x] use 使用原生 permission/`context.ask`。
- [x] restore 使用原生 permission/`context.ask`。
- [x] delete 使用原生 permission/`context.ask`。
- [x] discard/rebase 等需要确认的工作区操作使用原生 permission/`context.ask`。
- [x] permission 卡展示 node、业务 diff、风险和动作后果，不只显示 tool id。
- [x] 被 feature matrix 禁止的工具不能借 permission 获得额外能力。

### 4.3 DEF approval archive

- [x] 原生交互前创建绑定 node/session/revision/diff/risk hash 的 DEF approval record。
- [x] approve/reject/answer 后写回同一治理记录。
- [x] OpenCode 原生 UI 与 DEF archive 不产生双重弹窗。
- [x] 拒绝记录为 rejected，保留节点和工作区，checkout 不变。
- [x] diff/revision 变化后旧批准失效并重新请求。
- [x] retry/continue 不复用过期批准。
- [x] 两个宿主 approval 无串线。

---

## 第五部分：建立共享 host profile 与 feature matrix

### 5.1 bootstrap contract

- [x] 定义 host id、locked/default agent、session、directory、context endpoint。
- [x] 定义 active node、feature matrix、theme id、storage schema version。
- [x] 定义 permitted model/profile 和 tool exposure 摘要。
- [x] sidecar native session create 返回完整 bootstrap。
- [x] session metadata 持久化并可在 runtime 重启后恢复 bootstrap。
- [x] React props、OpenCode UI、message transport 和 tool permission共同校验 profile。

### 5.2 单一 feature matrix

- [x] 定义 session create/list/archive。
- [x] 定义 node review/files/approval。
- [x] 定义 model select、provider manage、server manage、project manage。
- [x] 定义 terminal、Git、share、appearance 和 shortcuts。
- [x] 组件从 feature matrix 派生。
- [x] command palette 与 slash commands 从 feature matrix 派生。
- [x] 快捷键注册从 feature matrix 派生。
- [x] 路由守卫从 feature matrix 派生。
- [x] 不在多个组件散落独立 `host === ...` 事实源。

### 5.3 storage migration

- [x] host/profile/session/theme/feature storage 有 schema version。
- [x] Workbench 与 `/AI CLI` 按 host + origin 隔离。
- [x] 迁移旧默认 server 17445、错误 agent 和旧 session 格式。
- [x] profile 不匹配或 session/node 失效时安全重建。
- [x] 防止错误状态进入重复 reload/404/notification error 循环。

---

## 第六部分：删除重复入口并裁剪原生综合功能

### 6.1 宿主旧按钮

- [x] 删除 `DefOpenCodeView` 宿主“新建会话”。
- [x] 删除 `DefOpenCodeView` 宿主“工作节点”。
- [x] 保留低权重宿主“返回”，并移入统一导航层。
- [x] 清理对应 CSS、props、callback 和死代码。
- [x] 主界面已有 Work Node 树继续承担全局节点历史与 checkout 管理。

### 6.2 唯一新建会话入口

- [x] 保留 OpenCode 原生 `+`/new session 入口。
- [x] 所有原生新建入口调用 DEF host-aware session factory。
- [x] Workbench 新建始终生成 `def-workbench`。
- [x] `/AI CLI` 新建始终生成自己的 profile。
- [x] session fork/compact 后的新 session 同样继承 host。
- [x] 文案按宿主显示“新建排轴会话”或“新建 AI CLI 会话”。

### 6.3 删除综合入口

- [x] 删除 `DEV`/debug bar。
- [x] 删除添加模型和管理模型。
- [x] 删除 provider/API Key 管理。
- [x] 删除 server 切换、添加和默认 server 配置。
- [x] 删除 project/workspace 选择。
- [x] 删除 Git/branch/worktree 管理。
- [x] 删除通用 terminal/PTY。
- [x] 删除 share/unshare。
- [x] 删除相关 settings 页面/行。
- [x] 删除相关 command palette、slash commands 和快捷键。
- [x] 禁止相关直达路由。
- [x] 后端权限继续 deny，前端删除不放宽安全边界。

### 6.4 model 与 agent

- [x] Workbench 隐藏并锁定 model/agent。
- [x] `/AI CLI` 首轮同样使用受控 model/profile，不开放通用 provider。
- [x] 若保留技术模型名，仅作为低权重状态信息，不作为可切换入口。
- [x] 后续白名单选择能力必须从 DEF host config派生，不恢复 OpenCode 通用管理。

### 6.5 embedded build profile

- [x] 构建脚本显式设置 DEF embedded profile/channel。
- [x] marker/manifest 记录 profile、upstream version 与适配版本。
- [x] 不再依赖 OpenCode 开发 channel 默认启用 new layout/DEV。
- [x] 保持与 vendored runtime/UI 版本锁一致。

---

## 第七部分：将原生“更改”改造成“节点变更”

### 7.1 数据适配器

- [x] 保留原生 review panel、文件 diff、折叠、滚动和行级呈现。
- [x] 数据源从 Git/branch/turn diff 切换为绑定 Work Node generated reports。
- [x] 删除 create Git、uncommitted changes 和 branch 文案/动作。
- [x] 未绑定节点时显示 DEF 中性空状态。
- [x] `/AI CLI` 只在自己的 session 绑定节点后显示节点变更。

### 7.2 三层证据

- [x] 用户层摘要描述角色、技能、格位和 Buff 等可理解结果。
- [x] 领域层展示完整 semantic diff。
- [x] 代码层展示 editable source diff。
- [x] raw fallback diff 可展开查看。
- [x] validation、risk、revision、dirty、approval 和 applied 状态同屏可见。
- [x] 节点变更提供审批证据，但不复制另一套 approval modal。

### 7.3 与 Work Node 树联动

- [x] rebuild 后刷新主界面 Work Node 树状态。
- [x] use/restore 后更新 HEAD/checkout 与节点状态。
- [x] 主界面切换节点不会静默重绑 dirty session。
- [x] OpenCode node status 与 repository/renderer 事实一致。

---

## 第八部分：业务历史与黑白蓝线稿主题

### 8.1 session—Work Node—checkout 历史

- [x] session summary 持久化 host、agent、directory、node id、parent 和 revision。
- [x] 显示 draft、validated、pending approval、applied、rejected、missing 状态。
- [x] 标识相对当前 HEAD 是否陈旧。
- [x] 恢复时提供继续原节点、只读查看或基于当前 HEAD 新 fork。
- [x] 切换/恢复会话不自动 checkout。
- [x] 会话标题由首个有效意图或节点摘要生成，不使用裸 ISO 时间戳。
- [x] `/AI CLI` 历史不继承 Workbench 节点状态。

### 8.2 theme adapter

- [x] 在共享 OpenCode UI 内建立单一 DEF theme adapter。
- [x] 使用项目现有 theme token，不从 iframe 外层穿透 CSS。
- [x] 使用白/浅蓝灰纸面和黑/深蓝灰 1px 线框。
- [x] 使用项目蓝色作为有限强调。
- [x] 控件直角或极小圆角。
- [x] 减少阴影、大色块和通用 SaaS 卡片感。
- [x] selected、running、warning、error、approval 状态在黑白蓝体系中仍可区分。
- [x] Workbench 与 `/AI CLI` 复用同一主题代码。

### 8.3 外壳与文案

- [x] 消除深色宿主 header + 原生 tabs 的双顶栏。
- [x] 返回导航不抢占主要视觉焦点。
- [x] 中文业务文案优先。
- [x] placeholder 按宿主本地化。
- [x] tool card 显示 DEF 业务名，技术 id 放在详情。
- [x] 模型名和运行时版本降级为诊断信息。
- [x] 不破坏原生 timeline、tool、reasoning、diff、permission、stop/retry/continue 和错误恢复。

---

## 第九部分：整体验收

### 9.1 `def-node-code` 专项场景

- [x] 只修改规范化 source 中一个按钮 slot，codec 自动同步所有镜像。
- [x] 跨组移动、批量调整、换技能和组合 Buff 不需要专用按钮级 tool。
- [x] 修改 base/context/generated/manifest 被真实拒绝。
- [x] 修改项目源码、其他 node/session 和用户目录被拒绝。
- [x] 删除 Buff 后留下引用会得到精确 validation issue。
- [x] 修改 Buff 内容、倍率或配置输入出现在 semantic diff。
- [x] 两个 session 编辑同一 node 时旧 revision 被拒绝。
- [x] 未建模字段 round-trip 不丢失；无法保真时 use 被阻止。

### 9.2 三类工具组合黑盒

- [x] 按 `docs/testing/def-agent-blackbox.md` 使用真实 Workbench agent入口。
- [x] 完成“查可信 Buff → fork → native code edit → rebuild → validate → diff → 暂不应用”。
- [x] 完成“查询干员/技能/武器/装备 → 组合修改节点”。
- [x] 记录真实 tool call，确认三类 family边界正确。
- [x] 确认没有退回 webfetch + REST prompt、按钮 command 或 Patch DSL 主路径。
- [x] 首响应、完成时间、node/revision/diff 和 checkoutTouched 均有证据。

### 9.3 原生交互验收

- [x] 触发一次 native question 并完成回答续跑。
- [x] 触发一次 use native permission 并批准。
- [x] 触发一次 use/restore/delete/discard 中的拒绝路径。
- [x] 验证 approval archive 与原生 UI 是同一次交互，不重复弹窗。
- [x] 修改 diff 后旧批准失效。
- [x] 两个宿主同时等待交互时事件不串线。

### 9.4 前端真实手测

- [x] Workbench 只存在一个新建会话入口。
- [x] 宿主“工作节点”消失，主界面 Work Node 树仍可用。
- [x] `DEV`、添加模型、provider、server、project、Git、terminal、share 在 UI 不可见。
- [x] 使用命令面板、slash commands、快捷键和直达 URL 验证上述功能不可达。
- [x] “节点变更”展示 Work Node diff，不出现 Git/branch/create Git。
- [x] Workbench 和 `/AI CLI` 同时打开并保持独立 session/profile/history/context。
- [x] 视觉符合黑白蓝线稿风格且原生交互完整。
- [x] 浏览器 console 无新增 error。

### 9.5 历史、冲突和恢复

- [x] 恢复 draft/validated/pending/applied/rejected session。
- [x] 恢复 node missing 或 revision stale session。
- [x] 验证恢复会话不自动 checkout。
- [x] 重启 sidecar/runtime 后恢复正确 host/agent/directory/node profile。
- [x] 失效 session 自动重建，不进入 404 循环。
- [x] 默认 server 不回退到 17445，不出现 notification server error。
- [x] storage schema migration 可重复运行且不会串宿主。

### 9.6 构建与必要测试

- [x] 运行 `npm run build`。
- [x] 构建 vendored OpenCode UI并验证 embedded profile marker。
- [x] 运行与 Work Node repository/REST/backup/migration 相关的现有 smoke。
- [x] 增加确有必要的 codec round-trip、path guard、revision conflict、host isolation 和 approval expiry 测试。
- [x] 不扩展与 Spec 7 无关的测试。
- [x] 验证 `npm run electron:dev` 常驻流程可用，不无故停止或重启已有主服务。

## 删除与兼容清单

- [x] 删除宿主新建会话逻辑及 CSS。
- [x] 删除宿主工作节点跳转逻辑及 CSS。
- [x] 清理 Workbench 未使用的 props 或将其接入 context contract。
- [x] 清理 `rest-search` 作为 Workbench skill 的错误绑定。
- [x] 清理 OpenCode 通用模型/server/project/Git/terminal/share 前端注册。
- [x] 旧 REST tools 仅保留明确兼容调用与 native plugin 内部 transport，不返回模型 prompt 主路径。
- [x] 旧 `working-payload.json` 单文件协议若保留迁移期兼容，必须标记 deprecated、只读导入或通过 codec 转换，不得继续作为最终事实源。
- [x] 所有删除项先确认替代能力、调用证据和 route/profile 映射。

## 自动提交检查点

按项目约定，每个完整修复或实施检查点自动提交。建议至少形成以下可独立回滚的提交边界：

1. Workbench agent/context 职责修复；
2. node workspace + path guard；
3. normalized source + codec；
4. validation/diff/risk/revision；
5. native question/permission + approval archive；
6. host profile + feature matrix；
7. 删除重复入口与综合功能；
8. node review + history；
9. theme adapter；
10. 黑盒、浏览器与最终验收记录。

不得为了提交边界将未完成内容声明为 Task 7-1 已完成。

## 最终验收标准

- [x] [`spec.md`](./spec.md) 的全部验收标准均完成。
- [x] 三类工具仍是唯一正式分类，无第四类或重新混合的按钮级体系。
- [x] `def-node-code` 已成为可自由编辑、可重建、可校验、可审查、可并发保护的节点代码工作区协议。
- [x] Workbench 的排轴职责和当前主界面上下文真实接通。
- [x] `/AI CLI` 的职责、会话和历史保持独立。
- [x] 所有需要询问/确认/审批的 DEF tool 使用 OpenCode 原生交互并持久化 DEF 治理证据。
- [x] 宿主旧按钮与 OpenCode 通用综合入口完成清理且无旁路。
- [x] “节点变更”正确承载 Work Node review。
- [x] session—Work Node—checkout 历史可恢复且不静默 checkout。
- [x] 黑白蓝线稿主题完成，同时保留原生 OpenCode 核心交互。
- [x] 构建、黑盒、安全、冲突、恢复和真实浏览器手测全部通过。
