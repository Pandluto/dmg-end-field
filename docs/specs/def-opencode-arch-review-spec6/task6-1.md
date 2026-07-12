# Task 6-1：完成 Spec 6 的 DEF OpenCode 原生工具与原生前端回归

## 状态

已完成。实现与逐项验收证据见 `verification.md`。

Task 6-1 是 Spec 6 的唯一总实施任务，不是第一阶段或前置盘点任务。任务完成的含义是 `spec.md` 中定义的工具架构、节点代码修改、三类工具注册、OpenCode 原生前端复用、双宿主独立会话、旧实现清理和整体验收全部完成。

任务内部允许按检查点分批编码和提交，但不再把剩余内容推到 Task 6-2、Task 6-3 或未定义的后续阶段。

## 总目标

将当前“OpenCode 会话运行时 + prompt 指挥 webfetch + 自研 REST tools + 两套自研聊天前端”的实现，收敛为：

```text
一套可复用的 OpenCode 原生前端子界面
  ├─ Workbench AI mode：独立职责、独立 session
  └─ /AI CLI：独立职责、独立 session
                ↓
        OpenCode 原生 agent loop
                ↓
        唯一 DEF Tool Registry
          ├─ def-node-code
          ├─ def-node-crud
          └─ def-data-resource
                ↓
子节点工作区 → 修改 → validate → diff → approval → use
```

现有自研 tools 先完整盘点和映射，再统一注册和迁移。删除对象是重复事实源、重复前端和重复编排，不是已经存在且仍有业务价值的能力。

## 完成定义

以下七个实施部分全部完成，Task 6-1 才能标记完成：

1. 现有工具盘点、三类归档、唯一注册和旧新对照路由。
2. 隔离子节点代码工作区与 OpenCode 原生代码工具注册。
3. `def-node-crud` 节点生命周期和审批/use 闭环。
4. `def-data-resource` 干员、武器、装备、技能、Buff 等数据能力收敛。
5. 一套共享的 OpenCode 原生前端/TUI 子界面。
6. Workbench AI mode 与 `/AI CLI` 两个宿主替换及独立会话职责。
7. 旧工具入口、prompt 协议、Kernel registry 和两套自研前端的清理与整体验收。

---

## 第一部分：盘点现有工具并建立唯一注册源

### 1.1 自动盘点

- [ ] 从实际 definitions、handler 分派、REST/IPC 路由、adapter prompt、测试 prompt 和 UI prompt 中枚举所有现存工具。
- [ ] 记录每个工具的名称、schema、handler、scope、risk、approval、verification、旧路由、调用方和运行状态。
- [ ] 检测已注册无 handler、有 handler 未注册、prompt 提及但不存在、路由存在但文案否认、同名不同义等漂移。
- [ ] 研究文档中的工具数量只作为历史记录，实际代码扫描结果才是本任务基线。
- [ ] 不遗漏低频、测试入口、治理、验证和兼容工具。

### 1.2 三类归档

- [ ] 每个现有工具必须且只能归入 `def-node-code`、`def-node-crud`、`def-data-resource` 之一。
- [ ] 标记每个旧工具为 `canonical`、`alias`、`absorbed`、`specialized` 或 `deprecated-candidate`。
- [ ] 对具有独立副作用或审批语义的旧工具保留专用 handler，不因追求数量少而丢失能力。
- [ ] 对重复编排工具明确由哪个 canonical tool 或原生代码流程吸收。
- [ ] 未确认替代能力和调用证据前，不删除旧工具。

### 1.3 唯一 DEF Tool Registry

- [ ] 建立唯一注册模块，至少声明 canonical id、family、description、schema、handler/native binding、workspace scope、risk、approval、verification、legacy aliases、宿主 exposure 和 migration status。
- [ ] OpenCode tool definitions 从该注册表派生。
- [ ] REST/IPC transport 路由从该注册表派生。
- [ ] 开发诊断清单和旧新对照表从该注册表派生。
- [ ] Kernel、REST、adapter prompt 和 UI prompt 不再分别维护工具事实。
- [ ] 注册阶段检测重复 id、悬空 alias、悬空 handler、无归属工具和错误 exposure。

### 1.4 对照路由

- [ ] 提供只读开发诊断接口，例如 `GET /api/def-tools/route-map`。
- [ ] 返回 registry version、三类工具、canonical id、旧工具名、旧路由、handler/native binding、migration status 和诊断错误。
- [ ] 迁移期旧路由通过 alias/adapter 到达同一 canonical handler，不复制业务逻辑。
- [ ] 对照路由不进入正常 agent prompt，不作为模型业务工具。

---

## 第二部分：恢复 `def-node-code` 原生节点代码修改

### 2.1 子节点代码工作区

- [ ] 从当前节点或指定父节点复制产生可写子节点，父节点保持不可变。
- [ ] 为每个子节点生成稳定、可读、可 diff、可 schema 校验的代码式工作目录。
- [ ] 工作目录中的文件可以重建完整节点 payload，不依赖 prompt 中的隐式状态。
- [ ] session、node id、parent id、工作目录和当前 revision 建立可追踪绑定。
- [ ] 修改期间不写当前 checkout、不覆盖父节点、不访问其他分支节点目录。
- [ ] 中断或失败后保留可诊断草稿，不产生半应用的当前状态。

### 2.2 注册 OpenCode 原生代码工具

- [ ] 恢复并注册节点工作区所需的 OpenCode 原生 `read`、`edit`、`apply_patch`。
- [ ] 经验证确有必要时，增加仅限节点目录的 `glob` / `grep`。
- [ ] 将这些能力以 DEF 工具身份或明确的 DEF native binding 归入 `def-node-code`。
- [ ] filesystem scope 必须限制在当前子节点工作目录，不能读取或修改项目源码及任意用户目录。
- [ ] 不恢复不受限 `bash`、项目级 `write`、`task` 或 web search；如后续必须使用，应在 Task 6-1 内追加明确风险审计和范围限制。
- [ ] OpenCode 事件中必须出现真实原生 tool call，不再通过 `webfetch` 伪装代码工具。

### 2.3 自由修改与既有能力兼容

- [ ] Agent 可以直接修改节点文件表达新增、删除、移动、批量复制、Buff、装备和组合变化。
- [ ] 现有 Patch DSL 可作为兼容 helper，但不得成为自由代码修改的能力上限。
- [ ] `patch_and_validate`、`copy_staff_line_and_verify` 等现有组合能力映射到代码工作流或保留为 specialized handler。
- [ ] 旧工具迁移不能要求模型把完成后的节点修改重新翻译成按钮级 command queue。

---

## 第三部分：完成 `def-node-crud` 生命周期闭环

### 3.1 简单增删改查

- [ ] 统一 fork/copy/create/list/read/update/delete 的 schema、handler 和返回结构。
- [ ] 继续使用现有 SQLite Work Node 权威树、parent、HEAD、revision 和子树删除约束。
- [ ] 简单结构化修改允许使用 CRUD 工具；复杂或组合修改转入 `def-node-code`。
- [ ] CRUD 工具不得绕过节点工作区直接进行未审计的当前 checkout 修改。

### 3.2 校验、差异与审批

- [ ] validate 从子节点工作目录重建 payload 并执行 schema、引用和业务一致性校验。
- [ ] diff 比较父/基线节点与子节点，而不是只比较命令是否执行。
- [ ] approval 绑定 node id、session id、diff、risk 和校验证据。
- [ ] OpenCode 原生 permission/question/approval 交互与 DEF 节点审批记录对齐。
- [ ] 审批失败或需要人工确认时，子节点继续保持独立，不污染当前 checkout。

### 3.3 直接使用子节点

- [ ] 审批通过后可以直接 `use` 子节点，不需要把修改重新执行一遍。
- [ ] `use` 是节点编辑链路中触碰当前 checkout 的唯一正式入口。
- [ ] use 成功后更新权威 HEAD、revision、节点状态和可见证据。
- [ ] use 失败时 HEAD 与当前 checkout 保持原状。
- [ ] restore 使用明确节点基线并留下操作证据。

---

## 第四部分：收敛 `def-data-resource`

### 4.1 能力保留

- [ ] 完整保留并盘点干员、武器、装备、套装、技能、Buff、配置填表和伤害相关能力。
- [ ] 合并重复 resolver/search/list，但保留消歧、可信来源和结构化摘要能力。
- [ ] 数据资源工具不得退化为 prompt 中的硬编码知识或模型自由猜测。
- [ ] 数据资源读取与节点文件修改职责分离：资源工具提供可信数据，节点代码工具写入节点。

### 4.2 原生注册与宿主暴露

- [ ] 数据资源工具通过统一 registry 注册为 OpenCode 原生可调用工具。
- [ ] 每个工具明确对 Workbench、`/AI CLI` 或 both 暴露。
- [ ] Workbench 只得到当前节点任务所需的数据资源能力。
- [ ] `/AI CLI` 保留更完整的资料处理、填表和独立 Agent 能力。
- [ ] 权限和返回大小保持有界，避免重新依赖全库 `webfetch`。

---

## 第五部分：建设一套共享 OpenCode 原生前端子界面

### 5.1 工程边界

- [ ] 建立一套共享子界面，例如 `DefOpenCodeView`，供两个宿主复用。
- [ ] 抽出共享 session timeline、stream、tool cards、reasoning、diff、approval、错误和 session 恢复逻辑。
- [ ] Workbench 与 `/AI CLI` 禁止各复制一份组件、hook、事件归并或 transcript 恢复代码。
- [ ] 宿主差异通过明确 props/context/host adapter 注入，不在共享组件中散落 pathname 和页面条件判断。
- [ ] 共享 UI 不持有跨宿主全局 active session。

### 5.2 上游代码移植与来源管理

- [ ] 优先从 vendored OpenCode 的 `packages/app`、`packages/session-ui`、`packages/ui`、`packages/tui` 复制、移植或包装原生实现。
- [ ] 为移植代码记录 upstream version、commit、源文件和本地适配说明。
- [ ] 维持可比较边界，后续可以审查上游更新，而不是形成无来源的第二次魔改。
- [ ] 不以现有 `MainWorkbenchAiPanel` 或 `AiCliPage` 的自研聊天呈现为模板重画一遍。

### 5.3 原生前端/TUI 还原范围

- [ ] 还原会话消息时间线和流式生命周期。
- [ ] 还原 reasoning/思考过程的展开、折叠和状态。
- [ ] 还原 tool call、tool result、read/edit/apply_patch 和失败状态卡片。
- [ ] 还原文件查看、修改 diff 和节点工作目录上下文。
- [ ] 还原 permission、question 和 approval 交互。
- [ ] 还原 stop、retry、continue、取消和错误恢复。
- [ ] 还原 session 创建、列表、切换、恢复和运行状态。
- [ ] 尽可能保持 OpenCode 原生快捷键、焦点行为、键盘操作和 TUI 节奏。
- [ ] 将还原度作为功能验收，不仅比较颜色、圆角和布局。

### 5.4 暂不强制恢复的区域

- [ ] 通用 provider/API Key 设置继续由 DEF 宿主管理，除非原生 session UI 必须使用。
- [ ] 通用项目首页、Git 管理和不受限终端不作为首轮必需能力。
- [ ] 未恢复区域必须是职责裁剪，不得因为技术困难用自研低配替代品冒充原生还原。

---

## 第六部分：替换两个宿主并保持独立会话

### 6.1 Workbench AI mode

- [ ] 用共享 `DefOpenCodeView` 替换现有 AI 模式中的 def-opencode 对话主体。
- [ ] 绑定独立 Workbench session controller、agent profile、session key、history 和节点工作目录。
- [ ] 默认围绕当前 Work Node 执行节点代码修改、CRUD、审批和 use。
- [ ] 与时间轴、Work Node 树、当前 HEAD 和 checkout 状态联动。
- [ ] 不继承 `/AI CLI` 当前会话、历史或未完成任务。

### 6.2 `/AI CLI`

- [ ] 用同一个共享 `DefOpenCodeView` 替换 `/AI CLI` 中现有 def-opencode 对话主体。
- [ ] 绑定独立 AI CLI session controller、agent profile、session key、history 和工作目录。
- [ ] 重点承载数据资源、填表、资料处理和独立 Agent 工作。
- [ ] 不继承 Workbench 当前节点会话或 transcript。

### 6.3 复用与隔离验收

- [ ] 两个宿主引用同一个共享子界面入口，不存在两份前端实现。
- [ ] 同时打开两个宿主时，可以各自拥有独立运行中的 session。
- [ ] 停止、重试、切换或恢复一侧 session 不影响另一侧。
- [ ] 两侧可以共享同一 OpenCode runtime/server 和统一工具 registry，但不能共享 active session state。
- [ ] session event 必须按宿主和 session id 精确路由，不能串消息、串 tool call 或串审批。

---

## 第七部分：删除旧架构并完成整体验收

### 7.1 工具旧事实源清理

- [ ] 删除 `MAIN_WORKBENCH_TOOL_REGISTRY` 或将仍需兼容的内容完全改为从统一 registry 派生。
- [ ] 删除 `buildDefToolDefinitions()` 中独立手写的工具清单和 scope 一刀切 metadata。
- [ ] 删除 adapter、Electron、dev-agent、UI prompt 中的工具名、URL、JSON body 和 legacy long flow 清单。
- [ ] 正常 agent 执行不再依赖模型调用 `/api/def-tools/call` 的 `webfetch` 协议。
- [ ] 原有 REST 路由仅在有明确兼容调用方时保留，并从统一 registry/handler 派生。
- [ ] 完成调用方迁移后，按对照表逐项删除确认无用的 alias 和 deprecated route。

### 7.2 旧前端清理

- [ ] 删除 `MainWorkbenchAiPanel` 中被共享原生子界面取代的消息、stream、tool activity 和 transcript 逻辑。
- [ ] 删除 `AiCliPage` 中对应的重复 def-opencode 会话实现。
- [ ] 保留各宿主必要的布局、业务上下文和 host adapter，不保留第二套聊天内核。
- [ ] 删除为旧前端兜底而存在的重复 session recall、消息折叠和 tool card 拼装代码。

### 7.3 权限与安全验收

- [ ] 节点代码工具只能访问当前子节点工作区。
- [ ] 数据资源工具只能访问声明的数据服务和有界结果。
- [ ] 未授权 shell、项目源码读写、外部网络和其他节点目录继续被拒绝。
- [ ] approval/use 前不能触碰当前 checkout。
- [ ] 两个宿主的权限集可不同，但都从统一 registry 和 host profile 派生。

### 7.4 功能验收

- [ ] 从当前节点 fork 子节点，使用原生 read/edit/apply_patch 完成一个现有 DSL 未预设的组合修改。
- [ ] validate 和 diff 正确展示代码式修改产生的节点差异。
- [ ] 审批后直接 use 子节点，当前 checkout 与 HEAD 正确更新。
- [ ] 审批拒绝或 use 失败时当前状态不变。
- [ ] 干员、武器、装备、技能、Buff 数据资源可以在 agent loop 中被调用并写入子节点。
- [ ] 旧高频业务操作在新架构下能力不退化。
- [ ] Workbench 和 `/AI CLI` 同时运行独立会话，无消息、目录、审批或历史串线。

### 7.5 原生前端/TUI 对照验收

- [ ] 建立上游原生界面与本地共享子界面的来源/功能对照清单。
- [ ] 对照会话时间线、tool card、reasoning、diff、approval、session 切换、键盘操作和错误恢复。
- [ ] 记录必要的 DEF 差异及原因；无法解释的行为差异视为未完成。
- [ ] 在 AI mode 和 `/AI CLI` 两个宿主分别完成可视化手测。

### 7.6 构建与测试

- [ ] 运行 `npm run build`。
- [ ] 按 `docs/testing/def-agent-blackbox.md` 完成 DEF agent 黑盒验收。
- [ ] 增加确有必要的 registry 一致性、workspace 越界、session 隔离和 use 原子性验证；不扩展无关测试。
- [ ] 验证现有 Electron 开发常驻流程不因共享前端和 OpenCode runtime 调整而失效。

## 文件边界要求

建议形成以下职责边界，实际命名可按代码结构调整：

```text
agent/runtime/def-tools/
  registry.*              唯一工具注册源
  families.*              三类工具族
  legacy-adapter.*        旧名称和旧输入兼容
  opencode-adapter.*      OpenCode 原生 tool registration

agent/runtime/def-node-workspace/
  workspace.*             子节点目录生命周期
  codec.*                 节点 payload 与文件互转
  validation.*            重建、校验和 diff

src/components/def-opencode/
  DefOpenCodeView.*       两个宿主共用的唯一子界面
  session-controller.*    可实例化、无跨宿主全局 active session
  host-adapter.*          Workbench / AI CLI 上下文边界
  upstream/               有来源记录的 OpenCode UI/TUI 移植代码
```

不得把共享前端重新堆回 `MainWorkbenchAiPanel.tsx` 或 `AiCliPage.tsx`，也不得把统一工具清单重新内嵌进 `ai-cli-rest-server.mjs`。

## Task 6-1 最终验收标准

- [ ] Spec 6 的所有验收标准均完成。
- [ ] 三类工具成为唯一正式分类，现有自研工具无无证据丢失。
- [ ] OpenCode 原生代码工具可以安全、自由地修改隔离子节点。
- [ ] 复制节点、代码修改、校验、diff、审批、直接使用子节点形成完整闭环。
- [ ] 数据资源工具完成统一注册并能与节点修改组合。
- [ ] AI mode 与 `/AI CLI` 使用同一套原生前端/TUI 子界面实现。
- [ ] 两个宿主职责不同且会话完全独立。
- [ ] 旧工具事实源、webfetch 工具协议和两套自研聊天内核完成清理。
- [ ] 构建、黑盒、session 隔离、workspace 安全和原生前端对照验收全部通过。
