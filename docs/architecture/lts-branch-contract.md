# 1.8 LTS 分支合同

## 为什么保留两个分支

1.8 LTS 的桌面数据制作能力和线上瘦身应用共享业务模型，但运行边界不同，不能再合并成一个长期分支。

截至 2026-08-22，`v1.8-LTS`（`920a6f94`）是审计锚点；Desktop Shell 与 Slimming 的实际最近共同提交是 `622d4cf1`。后续比较应先重新计算 `git merge-base`，不能把这里记录的哈希当成永久移动指针。

| 分支 | 长期职责 | 不应承担 |
| --- | --- | --- |
| `v1.8-LTS` | 共同祖先、回归基线、历史定位 | 日常开发、发包、生产部署 |
| `codex/v1.8-lts-desktop-shell` | Electron Shell、MCP、DEF Agent、桌面数据制作、统一资源 ZIP 生成与校验 | 国内网站部署、移动端、海外退役 Worker |
| `codex/v1.8-lts-slimming` | Web/PWA、移动端、通知、资源物化、国内 `.cloud` 生产部署 | Electron、MCP、DEF Agent、桌面安装包 |

## 同步边界

下列内容属于共同合同，应在两个活跃分支之间按需重放：

- 干员、武器、装备、Buff 和排轴的领域模型与序列化 schema；
- 浏览器 SQLite、Work Node、checkout、存档导出/恢复的安全语义；
- 不依赖专属运行时的交互修复；
- `def.localdata.archive.v1` 与 `dmg.resource-release.v1` 的生产、校验协议；
- 能证明上述合同的聚焦测试。

下列内容保持分支专属：

- Desktop：`electron/`、`agent/`、Agent UI/Host、MCP 服务、打包宿主和桌面 smoke；
- Slimming：移动工作台、通知中心、资源通道消费者/物化、国内部署、海外退役兼容层；
- 同名文件中嵌入的专属事务逻辑。此时只能移植行为，不能整文件覆盖。

## 正确的同步方法

1. 记录当前分支、工作树状态、双方远端指针和 `git merge-base`。
2. 从提交历史筛选共同修复，逐个检查其路径与行为；不要用分支总 diff 当作合并清单。
3. 简单、无冲突的独立提交可以 cherry-pick；已经被目标分支扩展的文件应手工重放最小行为。
4. 只运行与风险相称的类型检查、协议测试和 smoke。
5. 在目标分支单独提交，并明确记录来源行为；除非用户要求，不自动推送或部署。

禁止使用整分支 merge 来“追平”。Desktop 的 Agent 事务层和 Slimming 的线上产品层都曾在共同文件中独立演进，整块合并会静默删除另一侧能力。

## 数据与发布链路

```text
Desktop/MCP 编辑资料
        ↓
导出完整 def.localdata.archive.v1 Share Data
        ↓
Desktop Shell 生成并校验 dmg.resource-release.v1 ZIP
        ↓
Slimming 分支校验、物化到 public/
        ↓
dmgendfield.cloud 国内服务器
```

- `operator-library-share.v1` 等员工增量文件要先导入资料编辑器并合并，再导出完整 Share Data；它们不能直接发布。
- 资源版本来自实际打包时的北京时间和内容根哈希。来源文件的 `exportedAt` 只用于追溯。
- Desktop 产出的统一 ZIP 是跨分支交接物；Desktop 源码本身不是网站部署源。
- 海外 `.online` 应用已退役，普通应用或资源发布不得重建海外完整站点，也不得上传 GitHub Release。

## 1.8.6 已同步的共同内容

- 切换队伍或新建存档前保存当前 SQLite 工作区；
- 显式创建独立 SQLite 存档；
- 配置页返回 Canvas 时保护 runtime 修改，不被旧 checkout 覆盖；
- Timeline Button Buff 镜像可保存；
- Work Node 路径省略、框选、红色选中优先级与另存为悬停交互；
- Desktop 统一国内资源 ZIP 生产与反向校验。

以后修改这些合同，应先判断另一活跃分支是否需要对应补丁，并在提交或维护记录中注明同步状态。
