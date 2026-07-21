# 核心大文件瘦身研究（2026-07-21）

## 本轮范围

本轮只研究核心文件的可维护性瘦身，不把以下内容列为主要目标：

- Git 历史、Share Data 和 vendor 仓库体积；
- vendored OpenCode 源码；
- Electron/OpenCode binary 带来的安装包固定成本；
- 为了减少行数而机械地把代码平移到新的“大杂烩”文件。

目标是让核心入口只负责装配，让领域逻辑、transport、状态控制和视图渲染形成可验证的单向边界，同时保持现有路由、IPC、storage schema、审批协议和 UI 行为不变。

## 隔离基线

- 独立分支：`codex/core-file-slimming-research-20260721`
- 独立 worktree：`.codex-temp-core-file-slimming-20260721`
- 基线：`b2185b8 docs(audit): assess project code bloat`
- 原工作区的 Share Data 删除和未跟踪数据文件没有进入本 worktree。

该目录是物理独立 Git worktree，不与原工作区共享 index 或未提交文件；后续实现也应继续在该目录和分支完成。

## 核心判断

当前大文件可以分成三类，不能用同一种方式拆：

1. **进程/服务入口型**：`electron/main.cjs`、`scripts/ai-cli-rest-server.mjs`。主要问题是全局单例、路由、协议和领域操作聚在同一入口，需要 composition context、route family 和显式 ports。
2. **状态控制器型**：`CanvasBoard/index.tsx`、`CanvasBoard/SkillButton.tsx`。主要问题是单个 React 组件拥有过多 state/effect/callback，需要按业务能力抽 controller hooks 和纯视图。
3. **编辑器页面型**：Buff、Weapon、Equipment、OperatorConfig。主要问题是类型、normalize、workbook projection、分享、explorer、公式编辑和 JSX 混在同一文件；应先搬纯函数和页面局部组件，再讨论跨页面抽象。

第一轮不建议从最大的 AI REST 文件开刀。它的安全协议最密集，并且已有多项合同测试直接读取源码字符串；先用低风险页面拆分建立模式，再进入 transport/permission 边界更稳妥。

## 现状指标

| 文件 | 主体规模 | 状态/结构信号 | 首要切口 |
| --- | ---: | --- | --- |
| `scripts/ai-cli-rest-server.mjs` | 约 9,400 行；710 个函数节点 | 27 个 import、348 个顶层声明 | typed domain、repository route、tool dispatch |
| `electron/main.cjs` | 约 6,843 行 | `startBridgeServer` 955 行、70+ HTTP route | bridge route family、runtime supervisor、IPC registrar |
| `BuffDraftPage.tsx` | 约 5,063 行 | 两个完整页面组件共存 | 删除无调用旧页、拆 model/workbook/sheet |
| `CanvasBoard/index.tsx` | `CanvasBoard` 4,225 行 | 37 state、13 effect、11 ref | Workbench command controller、archive actions |
| `WeaponDraftPage.tsx` | 主组件 2,448 行 | 31 state、50 callback、11 effect | model、formula/editor、share、explorer |
| `SkillButton.tsx` | 主组件 2,453 行 | 23 state、29 memo、34 callback、11 effect | buff controls、damage VM、damage detail view |
| `EquipmentSheetPage.tsx` | 主组件 1,853 行 | 30 state、43 callback、9 effect | equipment domain、formula/editor、share、explorer |
| `OperatorConfigPage.tsx` | 前置 model 约 1,437 行；组件 1,272 行 | 与 Equipment 页重复领域类型/normalize | shared equipment domain、page view sections |

这些计数是职责密度信号，不是质量评分。真正的验收标准是依赖方向和行为边界，而不是单纯达到某个行数。

## 2026-07-21 实施结果

- 删除不可达的旧 Buff 表单编辑器。
- 删除伤害表 XLSX 导出入口、专用导出器和 `exceljs` 运行时依赖。
- Buff 工作表改为直接从业务行数据生成 UI 单元格，不再创建临时工作簿。
- Weapon、Buff、Equipment 三个页面拆为稳定入口、状态控制器、渲染视图和领域模型；原入口文件均缩为 8 行兼容 facade。
- 第二轮将公式编辑器、单元格编辑器与资源树 JSX 从 controller 移回 view，再将公式 binding、分享导入导出、资源树拖拽和 Equipment 图片选择器按完整职责抽到独立模块。当前 controller 为 Weapon 964 行、Buff 1,002 行、Equipment 972 行，三者均已进入约 1,000 行的目标区间。
- 用户确认长期未维护的 Damage Sheet 已不再需要，因此整体删除 `DamageSheetPage`、`/damage-sheet` 路由、画布“表格”按钮及 AI 页面枚举；独立的“计算伤害”/PPT 报表保留。
- 原 `DamageSheetPage.css` 中被 Weapon、Buff、Equipment 和 Image Manager 复用的工作表外壳已解耦为 `WorkbookSheet.css`，各消费页显式引用；伤害表专用样式随功能删除。
- `OperatorDraftPage.tsx` 从 2,280 行降到 1,330 行：领域类型、规范化与排序规则进入 534 行的 `operatorDraftPageModel.ts`，本地草稿库及分享流程进入 461 行的 `useOperatorDraftLibrary.ts`，Markdown 与路径选择字段进入 135 行的 `OperatorDraftFields.tsx`。页面仍负责编辑器状态和视图装配；草稿 Hook 仅接收编辑器写入端口，并按 library、dialogs、share、preferences、actions 返回结构化接口，没有建立跨编辑器的万能 Hook。
- `BuffBatchEditWorkbench.tsx` 从 1,997 行降到 784 行：按钮/时间线投影和 Buff 筛选规则进入 340 行的 `buffBatchEditModel.ts`，模式切换、框选、批量增删与候选 Buff 状态进入 983 行的 `useBuffBatchEditWorkbench.ts`，单个技能按钮视图进入 87 行的 `BuffEditSkillButton.tsx`。主文件只组合工作台视图，控制器按 layout、buttons、filters、modes、candidate、catalog 六组接口输出。
- `equipmentSheetPageModel.tsx` 从 1,411 行降到 442 行并继续作为兼容出口：工作表单元格写入、行投影和菜单视图留在页面模型；装备库 schema、兼容规范化、数值预设、持久化与不可变更新集中到 747 行的 `equipmentSheetDataModel.ts`；277 行的 `equipmentSheetTypes.ts` 作为控制器、公式、分享和图片选择器共用的单一类型合同。
- `buffDraftPageModel.tsx` 中稳定的 Buff 类型目录、标签/搜索词、数值展示集合和额外伤害段默认值抽入 228 行的 `buffDraftCatalog.ts`；原模型继续转导出全部目录符号，控制器、视图、公式与分享模块无需改导入路径。页面模型降至约 1,050 行，保留草稿规范化、持久化、撤销和工作表投影职责。
- `weaponDraftPageModel.tsx` 中固定的技能键、等级键、技能词条选项、Buff 类型标签和自动映射抽入 155 行的 `weaponDraftCatalog.ts`；原模型继续转导出全部目录符号，现有视图、公式、拖拽和控制器导入合同不变。页面模型降至约 1,040 行，保留草稿 schema、兼容规范化、插值、图片解析和工作表投影职责。

## 1. Buff 编辑器：最适合作为第一刀

`BuffDraftPage.tsx` 实际包含三段：

| 范围 | 规模 | 内容 |
| --- | ---: | --- |
| 文件前置 | 约 1,602 行 | 类型、normalize、分享模型、ExcelJS workbook projection、纯 UI helper |
| `BuffDraftPage` | 1,415 行 | 旧表单式编辑器 |
| `BuffDraftSheetPage` | 2,045 行 | 当前 `/buff-sheet` 工作表式页面 |

仓库内没有 `BuffDraftPage` 的调用方；`App.tsx` 只导入并渲染 `BuffDraftSheetPage`，路由也只有 `/buff-sheet`。旧组件因为被 `export`，不会被 `noUnusedLocals` 报错，但在当前产品入口中不可达。

这给出一个高收益、低耦合的第一批改动：

1. 再做一次产品入口确认后删除无调用的 `BuffDraftPage` 及其旧页专用 helper/state/JSX。
2. 保留 `BuffDraftPage.tsx` 作为兼容 facade，只 re-export `BuffDraftSheetPage` 和 `isBuffSheetPath`，避免修改 `App.tsx` 的导入合同。
3. 将共享 model/normalize/reorder/share 类型移到 `components/BuffDraft/model.ts`。
4. 将 workbook view 改为不依赖第三方工作簿对象的纯业务数据 projection。
5. 将当前页面移到 `components/BuffDraft/BuffDraftSheetPage.tsx`，再逐步拆 formula bar、explorer 和 dialogs。

注意：`BuffDraftPage.css` 同时被 Weapon 和 Equipment 页面引用，不能随旧组件整体删除。当前 CSS 中大约有 11 个 `.buff-draft-*`、54 个 `.buff-sheet-*` 和 16 个 `.operator-draft-*` selector，需按实际 DOM 使用情况清理，并把跨编辑器样式改为明确的 workbook/editor 样式模块。

删除旧组件会真实减少约 1,400 行源代码；其余“拆文件”主要改善认知负担，不应宣称为总 LOC 大幅下降。

## 2. Weapon / Equipment / OperatorConfig：先抽领域，再抽通用 UI

### Weapon

`WeaponDraftSheetPage` 之前已有约 1,285 行类型和纯 helper，主组件内部又同时维护：

- library/draft 与 image asset 状态；
- 公式 binding 和 inline editing；
- explorer collapse/drag/reorder；
- 分享导入导出；
- context menu；
- buff drawer；
- workbook 渲染。

建议先拆为页面局部模块：

```text
components/WeaponDraft/
  model.ts
  workbook.ts
  formulaBinding.ts
  useWeaponDraftLibrary.ts
  useWeaponExplorer.ts
  WeaponFormulaEditor.tsx
  WeaponExplorer.tsx
  WeaponDraftSheetPage.tsx
```

不要第一步就建立“万能 Workbook Hook”。先移动 Weapon 自己的逻辑并保持签名；等 Buff/Weapon/Equipment 三页都形成相同的局部接口后，再提炼公共 primitive。

### Equipment 与 OperatorConfig

两页各自声明 Equipment library、gear set、piece、effect 类型和 normalize/hydrate 逻辑。`normalizeEquipmentLibrary` 在两个文件中分别存在，虽然实现并非逐字相同，但它们描述的是同一份持久化事实。

这里比抽 JSX 更优先的是建立共享领域入口：

```text
core/domain/equipmentLibrary.ts
  types
  normalizeEquipmentLibrary
  normalizeEquipmentEffect
  selection helpers

core/services/equipmentLibraryProjection.ts
  library -> operator config piece
  library -> calculator input
```

`EquipmentSheetPage` 应负责编辑，`OperatorConfigPage` 应消费投影；后者不再复制一份装备库 schema 和兼容规则。这样既瘦文件，也减少“编辑页能读、配置页读不一致”的实质风险。

### 可复用 UI 的收敛顺序

三页都有相似的 formula editor、JSON share dialog、explorer collapse/drag 和 context menu。建议采用两步法：

1. 先移动到各自目录，保持原实现和领域类型；
2. 比较三份局部接口后，只抽稳定 primitive，例如 `JsonShareDialog`、`usePointerTreeDrag`、`WorkbookFormulaBar`。

禁止把所有页面状态塞进一个 `useWorkbookEditor()`；那只会把巨石文件变成巨石 hook。

## 3. SkillButton：现有拆分方向正确，继续分控制器和视图

`CanvasBoard/SkillButton.tsx` 周围已经有良好边界：

- `useSkillButtonAnomaly.ts`
- `skillButtonAnomalyDamage.ts`
- `skillButton.shared.ts`
- `SkillButtonAnomalyPanels.tsx`
- `TimelineSkillDetailWorkbench.tsx`

剩余 2,453 行主组件仍同时负责：

- Buff 搜索、启停、层数与持久化；
- 普通 hit 和异常段选择；
- damage result/view model 构建；
- 拖拽、点击与图标状态；
- 约 349 行的伤害详情 JSX。

建议边界：

```text
useSkillButtonBuffControls.ts
  搜索、source filter、手工启停、stack、持久化

useSkillButtonDamageViewModel.ts
  panel base、normal/anomaly result、active segment、summary

SkillButtonDamageDetail.tsx
  纯 props 渲染 hit cards、formula zones、展开状态

SkillButton.tsx
  button shell、drag/click、组合上述 controller/view
```

目标不是让一个 hook 返回几十个无结构字段。每个 controller 应返回一个小型 state + actions 对象，并只暴露视图真正需要的内容。

## 4. CanvasBoard：把 Renderer command bus 从画布 UI 中拿出去

`CanvasBoard` 的 4,225 行主体可以按行段清楚分成：

- 画布/UI 模式和 checkout hydration；
- 约 1,000–2,878 行的 Main Workbench command 解析、operator config、按钮和 Work Node 操作；
- 约 2,880–3,300 行的 command polling、投影和恢复 effects；
- 画布复制、右键、人员行操作；
- 约 3,671–4,160 行的 archive/snapshot/share/import/export 操作；
- 最终 UI 组合。

优先拆两个 controller：

```text
useMainWorkbenchCanvasCommands.ts
  command polling
  operator/weapon/equipment command handlers
  skill button command handlers
  Work Node create/patch/checkout/verify
  projection publication

useTimelineArchiveActions.ts
  snapshot/archive/workspace list
  convert/apply/export/transfer/delete
  share import/export
```

`useMainWorkbenchCanvasCommands` 不应直接接收整个 `CanvasBoard` 闭包。先定义显式 port：

```ts
interface CanvasCommandPort {
  readProjection(): TimelineSnapshotPayload;
  commitProjection(next: TimelineSnapshotPayload): void;
  resolveCharacter(idOrName: string): Character | null;
  publishResult(result: MainWorkbenchCommandResult): Promise<void>;
  refreshVisibleRuntime(): Promise<void>;
}
```

具体签名可在实现时调整，但必须保持“command controller 依赖 port，CanvasBoard 实现 port”的方向，避免 hook 反向读取整个组件状态。

当前合同测试直接在 `CanvasBoard/index.tsx` 中匹配 checkout、visibility 和 operator-config 代码片段。拆分时这些断言需要迁到新 controller 模块或改成行为合同，否则移动代码会产生假回归。

## 5. Electron main：先拆 bridge router，再拆服务

`electron/main.cjs` 的自然职责簇已经很清晰：

| 大致范围 | 职责 |
| --- | --- |
| 1–1,100 | app/window/tray、HTTP helper、runtime health |
| 1,102–2,056 | `startBridgeServer`，70+ HTTP route |
| 2,379–3,837 | image/data release 下载、校验、应用 |
| 3,888–4,200 | AI CLI、legacy fill、DEF Agent 进程生命周期 |
| 4,242–5,150 | image roots/cache/asset CRUD |
| 5,150–6,843 | data paths、timeline/work node compatibility、IPC registrations |

推荐结构：

```text
electron/
  main.cjs                       # app lifecycle + composition only
  desktop-shell.cjs              # window/tray/scale
  runtime-supervisor.cjs         # child process start/stop/health/env
  bridge/
    server.cjs
    http.cjs
    shell-routes.cjs
    runtime-routes.cjs
    data-routes.cjs
    image-routes.cjs
    legacy-fill-routes.cjs
  image-release-service.cjs
  image-asset-service.cjs
  desktop-ipc.cjs
```

`startBridgeServer` 应变成：创建 server、按顺序调用 route family、统一 404/500；route family 通过依赖对象拿 service，而不是 require `main.cjs` 的全局变量。

必须保持的安全顺序：

- renderer/native capability 检查先于受保护 route；
- `ensureWorkbenchRendererCapability()` 先于 `startBridgeServer()`；
- governance token 只由 composition root 创建并注入；
- IPC channel 名、HTTP path 和 response shape 不变；
- runtime 进程仍保持单例启动和统一退出。

## 6. AI CLI REST：按 typed domain 拆，不按“工具函数”拆

该文件不是一个普通 REST server，而是多个安全域叠加：

| 大致范围 | 顶层函数数 | 领域 |
| --- | ---: | --- |
| 1–1,000 | 48 | capability/session、HTTP helper、Work Node diff/validation |
| 1,001–2,192 | 约 30 | Workbench current gate、Work Node/Timeline REST |
| 2,194–2,400 | 约 10 | Agent script sandbox |
| 2,400–4,100 | 约 70 | native catalog、equipment、weapon、knowledge read |
| 4,100–5,100 | 约 20 | team loadout plan/prepare/apply |
| 5,100–6,100 | 约 20 | Work Node patch/sync/validation |
| 6,100–7,000 | 约 30 | governance、approval、tool definitions、command verification |
| 7,000–8,300 | 约 25 | operator config atomic flows、postconditions |
| 8,276–8,736 | 1 | 461 行 `executeDefTool` dispatch |
| 8,738–9,400 | 约 10 | tool/main-workbench routes、server/bootstrap |

现有 `scripts/def-core/` 已经有 runtime composition、request router、transport state、runtime state 和 tool registry，这是正确方向，但主文件仍自己持有绝大多数 domain handler 和 ephemeral map。

第一步应建立进程级 composition context：

```text
AiCliRestContext
  config/paths
  repositories
  ephemeral capability stores
  transport state
  clock/id/hash adapters
  renderer command port
```

所有 route/tool module 接收同一个 context；能力 token、prepared plan、reviewed proposal 等 map 必须仍是单进程单例，不能在每个模块各建一份。

建议模块：

```text
scripts/ai-cli-rest/
  context.mjs
  http.mjs
  server.mjs
  workbench-current.mjs
  timeline-routes.mjs
  agent-script-routes.mjs
  native-catalog-domain.mjs
  knowledge-domain.mjs
  team-loadout-domain.mjs
  worknode-domain.mjs
  operator-config-domain.mjs
  approval-domain.mjs
  tool-handlers.mjs
  tool-router.mjs
```

`executeDefTool` 应从 461 行 if/else 链变成 handler registry，但 invocation policy 必须仍在统一 dispatcher 中先执行：

```text
definition lookup
  -> invocation policy/current-workspace gate
  -> handler lookup
  -> handler(context, authorizedInput)
  -> uniform protocol response
```

definition、policy 和 handler 注册应在 composition 时做完整性检查，避免 definition 已暴露但 handler 缺失，或 private continuation 意外变成公开 route。

## 7. 现有测试是拆分约束，不是充分保护

至少 9 个验证脚本直接读取以下大文件源码并做字符串/切片断言：

- `scripts/ai-cli-rest-server.mjs`
- `electron/main.cjs`
- `src/components/CanvasBoard/index.tsx`
- `src/components/CanvasBoard/SkillButton.tsx`

其中包括 approval capability、atomic team apply、operator config proposal、projection visibility、interop token、legacy fill host route 等关键安全合同。

拆分前需要把这些断言分类：

1. **可直接 import 的纯合同**：改为从新模块导出并调用，不再匹配源码。
2. **必须保持的结构约束**：读取新模块而非强制所有实现留在入口文件。
3. **真正的端到端行为**：继续通过启动 sidecar/Electron bridge 的合同测试验证。

不建议为了让旧断言通过而在入口文件保留无效字符串或注释。这会制造“测试绿但合同已迁移”的假象。

## 推荐实施顺序

### Phase A：低风险叶子瘦身

1. 删除无调用的旧 `BuffDraftPage`，保留 facade。
2. 拆 Buff/Weapon/Equipment 的纯 model、normalize、workbook projection。
3. 把 SkillButton 的伤害详情 JSX 提取为纯视图。
4. 将 Equipment library schema/normalize 收敛到 core domain，OperatorConfig 只消费投影。

### Phase B：Renderer controllers

1. `useTimelineArchiveActions` 从 CanvasBoard 拆出。
2. `useMainWorkbenchCanvasCommands` 以显式 port 拆出。
3. `useSkillButtonBuffControls` 与 `useSkillButtonDamageViewModel` 拆出。
4. 再评估 Buff/Weapon/Equipment 的 share/formula/explorer 公共 primitive。

### Phase C：Electron composition

1. 抽 HTTP primitives 和 bridge server shell。
2. 按 data/runtime/image/legacy-fill 拆 route family。
3. 抽 runtime supervisor 和 image services。
4. 将 IPC registration 移到 `desktop-ipc.cjs`，`main.cjs` 只装配和管理 app lifecycle。

### Phase D：AI REST typed domains

1. 先迁移直接读取源码的合同测试。
2. 建立单例 context/composition。
3. 先搬纯 native catalog/knowledge projection。
4. 再搬 Work Node、team loadout、operator config domain。
5. 最后把 `executeDefTool` 改成 policy-first handler registry，并把 entry 收缩为 server bootstrap。

每个步骤应独立提交、可回滚，不同时做行为调整、命名升级和模块搬迁。

## 建议目标线

这些数字是防止形成新巨石的 guardrail，不是单独的验收标准：

| 入口/模块 | 建议目标 |
| --- | ---: |
| `electron/main.cjs` | 400–700 行 |
| `ai-cli-rest-server.mjs` | 200–400 行 |
| 单个 backend domain/route module | 尽量低于 800–1,000 行 |
| `CanvasBoard` 主组件 | 1,000–1,400 行 |
| `SkillButton` 主组件 | 700–900 行 |
| 单个编辑器 page component | 800–1,200 行 |
| facade 文件 | 50–200 行 |

如果一个新 module 需要导入 30 个依赖、接受 20 个 setter 或返回 40 个字段，即使低于行数目标也视为拆分失败。

## 验证策略

本轮仅研究，没有修改运行时代码，也没有新增测试。后续编码优先复用现有合同：

- 前端纯搬迁：`npm run typecheck`、`npm run build:web`；
- Canvas/Work Node：`test:def-workbench-projection-bridge`、`test:def-operator-config-atomic`、相关 timeline smoke；
- Electron bridge：`test:def-interop-snapshot-auth`、legacy-fill contracts、data-management/timeline smoke；
- AI REST：`test:def-core-router`、workbench binding/current gate/tool policy、native catalog、operator config、team atomic/rollback/reconciliation；
- 最终集成：`npm run check` 和桌面真实 UI 验收。

仅当搬出的新边界缺少现有行为保护时再补小型合同测试；不为机械搬文件批量制造 snapshot 测试。

## 建议的第一个 coding slice

建议下一步只做一件事：**清理无调用的旧 `BuffDraftPage`，并把当前 Buff Sheet 保持原样移动到独立目录，通过 facade 维持原 import**。

该 slice 的价值：

- 直接删除约 1,400 行不可达 UI；
- 不触碰 DEF、Electron、Canvas 状态机或持久化协议；
- 可以验证当前 worktree、提交和回归流程；
- 为后续 Weapon/Equipment 编辑器拆分建立目录和 facade 模式。

完成后再决定进入 SkillButton 纯视图，还是继续拆 Buff Sheet 的 model/workbook；不建议在第一个提交同时建立跨页面通用框架。
