# U0 Session Surface UI Spike Evidence

日期：2026-08-08
范围：仅为 P8 选型建立证据；原型源码留在 `/tmp/agent-session-surface-ui-spike`，不进入产品提交。

## 决策

P8 选择 **React mechanical port**，保留 OpenCode v1.17.11 的 Session Surface DOM、`data-slot`、class/CSS 和消息顺序，只做 Solid → React 的运行时适配。

Solid 的最小 bundle 明显更小，但两套原型在相同 fixture 下的 canonical DOM/data-slot/CSS 结构一致，固定视口截图未见主体布局、间距或主题视觉差异。Solid 的体量优势不足以抵消在当前 React 产品中长期维护第二框架、编译器、运行时和 tsconfig/Vite 边界的成本；因此不保留 Solid micro-bundle。

## 来源与边界

- 锁定来源：OpenCode `v1.17.11`，上游 commit `67aec2212010d67775c35e696d8b8b54902eb338`；本地锁文件为 [`native-ui-lock.json`](../../../agent/engines/opencode/native-ui-lock.json)。
- 可复核的本地 git 来源：commit `7f06b1d3` 的 `agent/vendor/opencode/packages/session-ui`，其中 `package.json` 版本为 `1.17.11`，同目录 vendor 根有 MIT `LICENSE`。
- 取样源文件：`session-turn.tsx`、`message-part.tsx`、`basic-tool.tsx`、`tool-status-title.tsx`，以及对应的 `Collapsible`、`TextShimmer`、`TextReveal`、`Icon` CSS/primitive 片段。
- 不联网，不做 OpenCode 全仓或浏览器矩阵调研；不改生产 UI、agent、vendor 或其他任务文件。

P4 fixture 固定复用了 `agent/host/testing/conversation-fixtures.ts` 的 ID、顺序和内容：一个 user text、一个 assistant Turn，依次包含 text、reasoning、generic tool、compaction，以及 Host-owned interaction。generic tool 为 `fixture.tool`，输入 `{ value: "fixture" }`，覆盖 `pending → running → completed`，另加 `error` 对照。

## 可复现命令

原型在 `/tmp` 运行，以下命令不写入仓库：

```sh
SPIKE=/tmp/agent-session-surface-ui-spike
REPO=/Users/sailstellar/Documents/coding/dmg-end-field

cd "$SPIKE/solid"
node "$REPO/node_modules/typescript/bin/tsc" --noEmit --pretty false
node "$REPO/node_modules/vite/bin/vite.js" build --config vite.config.mjs

cd "$SPIKE/react"
node "$REPO/node_modules/typescript/bin/tsc" --noEmit --pretty false
node "$REPO/node_modules/vite/bin/vite.js" build --config vite.config.mjs

cd "$REPO"
npm run build:web
```

最小交互复核使用本地 Vite server（`127.0.0.1:5183` Solid、`127.0.0.1:5184` React），IAB 固定 viewport `1100×800`：切换四个 tool 状态、点击 completed tool accordion、切换 `apple-midnight` theme，并读取 `data-component="session-turn"` 的 canonical DOM。

## 体量与构建

数值为最终 Vite 输出；gzip 为各输出文件分别压缩后的字节数。当前 `npm run build:web` 的生产基线取 `dist/assets` 全部 JS/CSS。

| 指标 | Solid micro-bundle | React mechanical port |
|---|---:|---:|
| JS raw | 17,863 B | 148,720 B |
| JS gzip | 6,767 B | 47,697 B |
| CSS raw | 10,857 B | 10,857 B |
| CSS gzip | 2,625 B | 2,625 B |
| UI bundle raw（JS+CSS） | **28,720 B** | **159,577 B** |
| UI bundle gzip（JS+CSS） | **9,392 B** | **50,322 B** |
| Vite transformed modules | 9 | 29 |

生产基线为 JS raw `2,487,049 B`、JS gzip `764,989 B`，CSS raw `648,550 B`、CSS gzip `107,139 B`。因此这次独立 surface 输出相对现有 JS+CSS 基线（raw `3,135,599 B`、gzip `872,128 B`）的可预估增量为：Solid `0.92% raw / 1.08% gzip`，React `5.09% raw / 5.77% gzip`。React 相对 Solid 多 `130,857 B raw / 40,930 B gzip`，主要是 React/ReactDOM runtime；CSS 完全相同。

两者 `tsc --noEmit` 均通过。临时配置行数为：Solid `vite.config.mjs 13`、`tsconfig.json 13`；React `vite.config.mjs 13`、`tsconfig.json 14`。Solid 额外需要 Solid 1.9.10、`vite-plugin-solid` 2.11.10、`jsxImportSource: "solid-js"` 和 Solid JSX 编译链；React 复用当前产品的 React 18 / React JSX 编译链，无第二框架依赖。

## Primitive、主题与维护成本

- 最小 fixture 实际渲染 3 个 OpenCode primitive source slice：`Collapsible`、`TextShimmer`，以及 `Collapsible` 内部的 `Icon`。
- P8 core 保留 4 个 slice，另含流式 reasoning 用的 `TextReveal`；两种原型的数量相同。Solid 是保留/裁剪 Solid primitive，React 是同一 DOM/CSS 的 React 等价适配，不引入第二套视觉 primitive。
- 两边共用同一份 OpenCode-derived CSS，主题只通过现有 DEF theme vars 映射到 OpenCode `--v2-*` tokens；`apple-midnight` 切换后 surface box 仍为 `x=170,y=59,w=760,h=721`，文本色变为 `rgb(245,245,247)`，无 layout shift。
- React 的额外 bundle 成本是可量化的，但它避免了永久的 Solid runtime/compiler、第二套响应式语义和独立框架升级路径。对于 P8 后续的 Turn/text/reasoning/tool/interaction renderer，React 与当前 store、Host event 和构建边界一致，维护成本更低。

## DOM/CSS/行为证据

两套原型使用同一 `shared/opencode-session-surface.css`、同一 P4 fixture 和同一 `data-component`/`data-slot` 命名。对运行态 `session-turn` 子树做属性排序后的 canonical DOM 比较结果为 `equal: true`；原始 `outerHTML` 长度均为 `2484`，差异仅为属性序列化顺序，不是结构或样式差异。

固定截图（running tool、`1100×800`，JPEG 原始截图；未做像素级安全测试）:

- [Solid running](assets/agent-session-surface-ui-spike/solid-running.jpg)
- [React running](assets/agent-session-surface-ui-spike/react-running.jpg)

两边均确认：

- user text、assistant Turn、text、reasoning、compaction 和 interaction 均出现且顺序一致；
- `pending` / `running` 使用 shimmer，`completed` 显示 `value=fixture` 并可展开 `ok: true`，`error` 显示 `fixture.tool · fixture tool failed`；
- interaction 保持 `interaction-fixture`，显示 question 和 Host resolution；
- 固定截图中唯一有意不同的是 harness 外部标签 `P4 fixture · Solid` / `P4 fixture · React`，`session-turn` surface 本体未重新设计。

## P8 精确迁移规则

1. 在 `src/agentSessionSurface/**` 建立 React renderer；使用独立 P8 Vite entry，但不把 Solid、`vite-plugin-solid` 或新 agent 边界加入产品 `tsconfig`。
2. 以 OpenCode v1.17.11 的 `SessionTurn`、`message-part`、`basic-tool`、`tool-status-title` 为起点，只保留 Session Surface 需要的 source slices；保留 MIT `LICENSE` 和 provenance 注释/记录，注明上述 tag、commit、local source commit。
3. Solid → React 只做机械语义翻译：`Show/For/Switch/Match/Dynamic` → React conditional/map；`createSignal/createMemo/createEffect` → React state/memo/effect；保留原有 DOM、`data-component`、`data-slot`、class、属性语义和 CSS，不新增视觉 wrapper/token。
4. 保持 `Turn → user message → assistant parts` 层级；按 assistant part 顺序渲染，绝不按工具完成时间重排。状态映射固定为：tool-call start=`pending`，Host accepted=`running`，success=`completed`，failure=`error`。
5. interaction 只由 DEF Host/Conversation store 驱动：requested 渲染 pending interaction，resolved 更新/移除；不得引入 OpenCode permission/question API client、global session cache 或 SDK client。
6. 必须保留 text、reasoning、generic tool 四状态、interaction、compaction、auto-scroll、copy、stop、retry、theme vars；不得带入 workspace/file browser、terminal/LSP/VCS/worktree、provider/model、todo/task/subagent 等全应用 UI。
7. 不触碰 `AgentMode`、`Host`、`Conversation`、`Runtime` 的边界；只接入现有 `ConversationSnapshot`/`BrowserConversationStore` 适配层和现有 Host events。
8. P8 验收最低矩阵就是本 spike：同一 P4 fixture 的 text/reasoning/tool `pending → running → completed`、error 对照、interaction、compaction、theme toggle；canonical DOM/data-slot 与本证据固定 baseline 一致，并保留固定截图。

## 结论与限制

本 spike 只回答框架选型，不实现 P8 生产迁移。React 的 bundle 代价已明确记录；在结构和视觉忠实度没有可见收益差异的前提下，长期维护性决定选择 React。未做大量浏览器矩阵、像素级 diff 或完整 OpenCode 全应用移植验证，符合 U0 有界验证目标。
