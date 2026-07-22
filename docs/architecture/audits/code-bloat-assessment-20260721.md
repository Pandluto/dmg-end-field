# 项目代码臃肿度评估（2026-07-21）

## 结论

当前项目的综合臃肿程度为 **高**，但问题不是单一的“代码太多”，而是三类成本叠加：

1. **仓库与历史体积严重臃肿**：当前 `HEAD` 的 91.8% 内容由完整 vendored OpenCode 源树和 Share Data 快照组成；Git 可达历史还保留过整套 Windows 发布目录、多个数据快照版本和旧临时产物。
2. **自研代码存在明显巨石模块**：非 vendor 代码约 12.4 万行，28 个文件超过 1,000 行，13 个文件超过 2,000 行；Electron 主进程、AI CLI REST sidecar 和多个编辑页承担了过多职责。
3. **发布体积很大但相当部分是产品架构固定成本**：Electron、内置 OpenCode binary 和 OpenCode UI 是主要来源，不能简单按“无用内容”删除。真正值得优先处理的是 production sidecar、前端按路由拆包、依赖角色和构建清单，而不是手工删除 runtime asset。

同时，复制粘贴并不是主要矛盾。覆盖约 9.2 万行的 clone 检测只发现 0.37% 重复行；当前更需要治理的是仓库边界、运行时边界和大文件职责。

## 评估基线

- 分支：`codex/code-bloat-audit-20260721`
- 基线提交：`e090404 fix(ai): serialize OpenCode runtime startup`
- 项目版本：`1.8.2`
- 统计口径：仓库体积读取 `HEAD` 的 Git tree，不把工作区既有的两个 Share Data 删除和两个未跟踪文件计入基线。
- 发布包口径：`release/` 是 2026-07-13 的 `1.7.1` 样本，早于当前 `package.json` 和依赖变更，只用于解释构成，不作为 `1.8.2` 的最终体积结论。

## 分维度判断

| 维度 | 程度 | 核心判断 |
| --- | --- | --- |
| Git 当前树 | 严重 | vendor 与数据快照占 91.8%，业务源码只占很小部分 |
| Git 历史 | 严重 | 历史发布目录和多版数据快照长期留在对象库中 |
| 源码模块化 | 高 | 多个 2,000–9,000 行文件，主进程与 sidecar 职责聚合 |
| 前端装载 | 中高 | 10 个页面全部静态导入，当前只有一个主 JS bundle |
| 依赖/构建 | 中高 | Vite 已进入生产依赖以支撑运行时加载，sidecar 尚未独立 bundle |
| 重复代码 | 低 | clone 检测重复行 0.37%，不应成为第一轮重点 |
| 发布包 | 中高 | 体积大，但 Electron/OpenCode 占主导，需按架构成本看待 |

## 1. Git 当前树：91.8% 不是本项目业务源码

`HEAD` 共跟踪 6,847 个文件、143,520,178 bytes（136.9 MiB）。

| 范围 | 文件数 | bytes | 占比 |
| --- | ---: | ---: | ---: |
| `agent/vendor/` | 6,010 | 95,542,475 | 66.6% |
| `data/sharedata/` | 6 | 36,205,170 | 25.2% |
| `public/data/` | 144 | 2,936,506 | 2.0% |
| `src/components/` | 92 | 2,058,787 | 1.4% |
| `docs/specs/` | 132 | 1,508,317 | 1.1% |
| `scripts/` | 74 | 890,085 | 0.6% |
| `electron/` | 11 | 886,185 | 0.6% |

两个最明显的问题：

- `agent/vendor/opencode` 把上游完整 monorepo、网站素材、测试 fixture、字体、图标和宣传视频一起纳入了主仓库。两个宣传视频合计约 27.3 MB，另有 3.9 MB base64 图片 fixture、3.1 MB models fixture 等内容；这些不进入最终应用，却进入每次 clone 和大多数 Git 操作。
- `data/sharedata` 在 `HEAD` 中保留五个 3.1–11.3 MB 的完整 JSON 快照。它们是可发布数据/用户归档，不适合作为高频变更的源码文件进入主 Git 历史。

如果 vendor 源树和完整 Share Data 包改为可复现的外部输入，当前树可从约 136.9 MiB 降到约 11.2 MiB 量级；这只是结构估算，不包含迁移元数据和必要小型 fixture。

## 2. Git 历史：当前 `.git` 负担主要来自已删除大文件

`git count-objects -vH` 显示对象存储约 674.8 MiB（loose 387.97 MiB + pack 286.80 MiB）。所有 refs 下唯一可达 blob 的逻辑体积为 839,213,072 bytes。

| 历史路径根 | 唯一 blob 数 | 逻辑 blob bytes | 说明 |
| --- | ---: | ---: | --- |
| `release-latest/` | 76 | 386,893,917 | 曾提交完整 Windows 发布目录 |
| `data/` | 38 | 138,601,268 | 多代 Share/Local Data 完整快照 |
| `agent/` | 7,147 | 131,558,387 | 主要是 vendored OpenCode |
| `src/` | 2,027 | 65,699,340 | 正常代码演进历史 |

最大的历史 blob 是 `release-latest/win-unpacked/...exe`，单文件 201,233,408 bytes；另有一个 79,928,424 bytes 的 portable exe，以及 Chromium/Electron DLL 与资源包。虽然 `release-latest/` 现在已经被 `.gitignore` 忽略，但删除工作区文件并不会清除历史对象。

因此，只做当前目录清理不能显著改善 clone 体积。需要在停止继续提交大包之后，单独计划一次协作式历史重写；这会改变 commit id，必须冻结合并并通知所有协作者，不能在普通重构中顺手执行。

## 3. 自研代码：体量可接受，聚合方式不可持续

按 `.ts/.tsx/.js/.mjs/.cjs/.css` 统计：

| 范围 | 文件数 | 行数 |
| --- | ---: | ---: |
| 全部 | 3,353 | 649,038 |
| `agent/vendor/` | 3,027 | 524,818 |
| 非 vendor | 326 | 124,220 |
| `src/` | 218 | 84,630 |
| `scripts/` | 74 | 16,855 |
| `electron/` | 8 | 11,012 |
| 自研 `agent/` | 18 | 8,992 |

非 vendor 文件中，58 个超过 500 行、28 个超过 1,000 行、13 个超过 2,000 行。最大的热点如下：

| 文件 | 行数 | 判断 |
| --- | ---: | --- |
| `scripts/ai-cli-rest-server.mjs` | 9,025 | 路由、协议、服务编排、兼容逻辑集中；约 273 个函数级声明 |
| `electron/main.cjs` | 6,282 | 启动、IPC、窗口、sidecar、数据和生命周期集中；约 267 个函数级声明 |
| `src/components/BuffDraftPage.tsx` | 4,726 | 页面、领域转换、交互和持久化聚合；约 73 个函数级声明 |
| `src/components/CanvasBoard/index.tsx` | 4,474 | 画布编排和大量状态耦合；约 51 次 React hook 调用 |
| `src/components/WeaponDraftPage.tsx` | 3,520 | 巨型编辑页 |
| `src/components/EquipmentSheetPage.tsx` | 3,120 | 巨型编辑页 |
| `electron/data-management-service.cjs` | 2,602 | 本地数据服务聚合 |
| `src/components/OperatorConfigPage.tsx` | 2,556 | 配置编排聚合 |
| `src/components/CanvasBoard/SkillButton.tsx` | 2,499 | 领域计算与 UI 交织 |

这里的首要风险不是磁盘大小，而是：

- 修改需要理解过大的上下文，review 和回归范围扩大；
- UI、存储、领域转换和 transport 容易形成隐式耦合；
- 巨型 CJS/MJS 文件缺少可由类型系统强制的模块边界；
- 后续 Agent/DEF/legacy-fill 兼容需求会继续向中心文件追加分支。

项目还并行维护约 4,862 行 `src/legacyFill*`、4,514 行 `src/aiCli`、1,509 行 legacy-fill scripts 和 3,285 行 DEF scripts。这些目前仍被运行时和验证链使用，不能直接认定为死代码，但已经构成明显的兼容面维护成本。

## 4. 重复：有局部问题，但不是体量主因

使用 `jscpd 4.0.5`，排除 vendor、测试文件、node_modules 和构建后的 OpenCode UI，并把最大文件阈值提高到 12,000 行后：

- 分析 340 个文件、92,209 行；
- 发现 9 个 clone；
- 重复 338 行，占 0.37%；
- 重复 token 占 0.27%。

值得收敛的局部重复主要在 operator/buff/weapon 领域转换、storage 片段和两份 packaged smoke 启动逻辑。它们更像“领域真相分散”的信号，而不是大量复制代码。

对大于 10 KB 的跟踪文件做 SHA-256 精确重复检查，共发现约 2.35 MB 可重复内容，主要是：

- vendored OpenCode 的重复字体：约 1.94 MB；
- `docs/guides/agent-notes/web/dist/app-icon.png` 与 `electron/assets/icon.png`：334 KB；
- 文档站 source/dist 中的 `viewer.js`、`styles.css` 等生成副本。

这些项目可以通过生成流程和 asset 引用治理，但收益远小于 vendor、Share Data 和历史发布包治理。

## 5. 前端：单入口静态装载所有页面

当前 `dist/assets` 只有一个主 JS 和一个主 CSS：

| 资产 | 原始大小 | gzip -9 | Brotli |
| --- | ---: | ---: | ---: |
| `index-C3YUDAXg.js` | 2,517,993 | 741,370 | 578,491 |
| `index-B03HxIQR.css` | 349,244 | 54,198 | 44,592 |

`src/App.tsx` 静态导入 10 个业务页面，没有 `React.lazy`；项目中也没有面向页面的动态 import。即使用户只打开一个工作台，所有编辑器、报表、AI CLI 和 Excel 导出相关前端代码仍进入同一个初始 chunk。

这不会明显改变安装包总量，但会增加首次解析/执行成本，并把所有页面形成一个共同变更域。优先按路由拆分页面、把 Excel 导出等低频重依赖放入动态 chunk，比继续压缩当前单 bundle 更有效。

Madge 从 `src/main.tsx` 处理 185 个模块时发现两个循环依赖：

1. `TimelineSkillDetailWorkbench.tsx` ↔ `TimelineHitTuningPanel.tsx`
2. `TimelineSkillDetailWorkbench.tsx` ↔ `TimelineStatusPanel.tsx`

两个子面板只是反向导入父组件声明的类型，适合把共享类型移动到独立 model/types 文件，属于低风险快速修复。

## 6. 依赖和脚本：正确性成本正在转化为生产体积

当前 `package.json` 有 9 个直接 dependencies、11 个 devDependencies、73 个 scripts；lockfile 有 718 个 package entry，其中 362 个被标记为非 dev/devOptional。73 个 scripts 中有 26 个 `test:*`、12 个 `smoke:*` 和 10 个含 `build` 的入口。

脚本数量本身不是坏事，DEF/Harness/数据发布确实需要独立合同与 smoke；问题在于这些入口都集中在根 `package.json`，且很多测试基础设施继续围绕超大 sidecar/main 文件搭建，增加了理解和变更成本。后续可按 `scripts/def`、`scripts/data`、`scripts/release` 分组，并让根 scripts 只保留稳定编排入口。

更关键的是 `vite` 当前位于 production dependencies，同时 `build.files` 已包含 `src/**`。这与此前 [`opencode-package-scope-size-audit-20260713.md`](./opencode-package-scope-size-audit-20260713.md) 中记录的 production sidecar 缺口一致：当前选择是把 Vite 和 TypeScript 源码带进生产路径，以满足 `scripts/ai-cli-rest-server.mjs` 的运行时 `ssrLoadModule()`，而不是先生成独立 production sidecar bundle。

这解决了“生产缺少运行前提”的方向性问题，但会让 Vite、Rollup、esbuild、PostCSS 等构建工具链进入生产闭包。正确的收敛路径仍是：

```text
sidecar TypeScript source
  -> 构建期生成 production bundle
  -> Electron 只启动 bundle
  -> Vite 回到 devDependency
  -> build.files 不再为 sidecar 携带整套 src
```

当前本地 `node_modules` 与 lockfile 不一致：缺少 `@modelcontextprotocol/sdk`、`zod`，Electron 与 Vite 版本也落后于声明。因此本轮没有用现有安装目录重建 `1.8.2` 发布包，避免给出伪精确的当前包体数字。

## 7. 发布包：大，但不能把固定成本误判为废代码

现有 2026-07-13 样本：

| 项目 | 大小 |
| --- | ---: |
| portable exe | 110,848,529 bytes（105.7 MiB） |
| `win-unpacked/` | 464,621,391 bytes（443.1 MiB） |
| Electron 主 exe | 201,233,408 bytes |
| 单个 OpenCode binary | 138,089,472 bytes |
| `app.asar` | 70,860,973 bytes |
| OpenCode UI（解包统计） | 28,806,508 bytes |
| production `node_modules`（解包统计） | 34,631,536 bytes |
| 其中 `exceljs` | 21,569,562 bytes |

Electron 主 exe 与 OpenCode binary 合计已经占展开体的大部分；这是“内置浏览器 + 本地 Agent runtime”的产品选择，不是普通 tree-shaking 能消除的成本。OpenCode UI 还包含按需加载的编辑器/语法高亮 chunk，不能根据文件名批量手删。

可优化部分是：

- 完成 production sidecar bundle，避免把开发服务器/构建链变成运行时；
- 在新依赖状态下重新做一次干净构建并记录包体构成；
- 前端路由拆包，并评估 Excel 导出动态加载；
- 如果确实要继续削减 OpenCode UI，必须从上游 build 配置裁剪语言/字体集合，并做 diff、Markdown、tool card 回归。

现有样本的 `app.asar` 中没有 Vite、Rollup、esbuild、Zod 或 MCP SDK，因此它不能说明当前 `1.8.2` 新生产依赖加入后的最终包体。

## 建议顺序

### P0：先阻止仓库继续膨胀

1. Share Data 完整包改走 release asset、对象存储或专用数据仓库；主仓库只保留小型、稳定、脱敏 fixture 和 manifest/checksum。
2. vendored OpenCode 改为“上游 commit/tag + patch 集 + 可复现构建脚本”，或独立 vendor 仓库/submodule；主仓库不再携带上游网站、宣传媒体和测试 fixture。
3. 为 `release/`、`release-latest/`、data package 和 runtime binary 增加 repository check，阻止大文件重新进入 Git。
4. 上述入口稳定后，再单独执行协调式 history rewrite，清理历史 `release-latest/`、旧 data snapshot、临时二进制和不再需要的 vendor blob。

### P1：拆解两个服务中心和四个巨型页面

1. `electron/main.cjs` 按 bootstrap/window、IPC registration、runtime lifecycle、data services 拆分；主文件只保留装配。
2. `ai-cli-rest-server.mjs` 按 route/controller、protocol/serialization、workspace/repository、legacy compatibility 拆分。
3. Buff/Weapon/Equipment/Canvas 页面把领域 model、持久化 adapter、表单 sections、计算 selector 和 React hooks 分离；先设“新文件不超过 800–1,000 行”的增量门槛，不做一次性重写。
4. 把两个循环依赖中的共享类型移到独立文件。

### P1：降低初始装载和生产构建耦合

1. 对 `App.tsx` 的业务页面做 route-level lazy import，生成可验证的多个 chunk。
2. 把 Excel 导出和其他低频重功能移到动态 import。
3. 建立 production sidecar bundle，再把 Vite 从 production dependencies 移回 devDependencies。
4. 用干净 `npm ci` 后的 `1.8.2` 构建重新测量 portable、unpacked、asar、runtime 和各 node_modules 子树。

### P2：收敛兼容面与生成物

1. 给 legacyFill → DEF/typed tools 定义明确的兼容终点和删除条件，避免两套入口无限并行演进。
2. 让文档站 `dist/` 在发布时生成，或至少避免重复提交相同 icon/viewer/style。
3. 将 73 个根 scripts 收敛为少量稳定入口，其余逻辑进入按领域命名的脚本模块。

## 建议跟踪指标

后续每轮瘦身应分开记录，避免把不同问题混在一个“总大小”中：

- `HEAD` tracked files/bytes，以及 vendor/data/source 各自占比；
- clone 后 `.git` 大小和 fresh clone 传输量；
- 非 vendor 代码行数、`>1000` 与 `>2000` 行文件数；
- 循环依赖数；
- 页面初始 JS raw/gzip 和异步 chunk 数；
- direct production dependencies 与实际打包 node_modules；
- portable 下载体积、unpacked 安装体积、Electron/OpenCode/runtime/app 各自体积。

第一阶段最有价值的目标不是“删掉多少业务代码”，而是把 **vendor、数据发布物、Git 历史、生产 sidecar 和页面装载边界** 从主业务代码中分离。完成这些之后，再讨论领域级去重和细粒度重构，收益会更可测，也更安全。

## 复现命令

本轮主要使用：

```powershell
git -c core.quotepath=false ls-tree -r -l HEAD
git count-objects -vH
git rev-list --objects --all | git cat-file --batch-check='%(objectname) %(objecttype) %(objectsize) %(rest)'
npx --yes jscpd@4.0.5 src electron agent/runtime agent/server scripts --ignore "**/*.test.*,**/vendor/**,**/node_modules/**,**/opencode-ui/**" --min-lines 20 --min-tokens 100 --max-lines 12000 --reporters console
npx --yes madge@8.0.0 --extensions ts,tsx --ts-config tsconfig.json --circular src/main.tsx
```

行数和目录体积由 PowerShell 对 Git tracked files 分组统计；发布包通过 `@electron/asar 3.4.1` 解包到 `.runtime/code-bloat-audit/` 后统计，该目录被现有 `.gitignore` 排除。
