# 可复用回归测试包

这套测试不只服务于 1.8 Slim。它把已经积累的测试资产分成三个稳定层级，并允许替换端口、分支和 worktree。以后维护 LTS、继续瘦身或迁移到新版本时，应扩展这套合同，不要另复制一份测试树。

## 三层测试资产

| 层级 | 稳定入口 | 主要证据 | 适用场景 |
| --- | --- | --- | --- |
| 纯逻辑与存储合同 | `npm test` | `src/**/*.test.ts(x)`；由 `scripts/run-ts-test.mjs` 自动发现 | 日常模型重构、错误回归、存储边界 |
| 当前分支浏览器回归 | `npm run test:regression` | `tests/e2e/lts-slimming.spec.ts` | 页面、SQLite 刷新恢复、分享、实时主题、深层编辑和完整业务流程 |
| 基线/候选双跑 | `npm run test:regression:dual` | `tests/e2e/lts-dual-run.spec.ts` | 同文件操作两侧、跨分支迁移、确认保留功能没有漂移 |

`npm run test:regression` 会依次执行 typecheck、全部 Node 合同和当前分支浏览器回归。生产发布仍需另外执行 `npm run check`；双跑需要两棵工作树，因此不隐式塞进普通 `check`。

截至 2026-08-04，Slim 有 52 份相邻源码测试和 4 份浏览器 spec/helper。当前补测覆盖矩阵、真实结果与未自动化边界见 [1.8 LTS Slim 补测闭环](./v1.8-lts-slimming-test-closure.md)。

## 专用满乘区回归样本

`skillDamageFullMultiplier.fixture.test.ts` 与 `skillDamageFullMultiplierData.test.ts` 提供不依赖用户存档的硬编码公式合同；`syntheticRegressionArchiveHarness.ts` 再把同一份测试专用干员、武器、四件装备、三件套和 Timeline archive 走完 Local Data → SQLite → 刷新恢复 → 伤害报告流程。双跑会让 3030 与 3040 分别执行该流程，同时要求两侧相等且各自命中独立 golden。

完整技能/Buff 矩阵和维护规则见 [合成满乘区 SQLite 双跑样本](./synthetic-full-multiplier-regression.md)。以后新增乘区或 Buff 形态应扩展这一个样本，不复制用户存档或另建只能单侧运行的测试。

## 默认运行方式

当前 1.8 约定保持不变：

```bash
# 当前候选分支：默认复用或启动 127.0.0.1:3040
npm run test:regression

# 同一份黑盒合同：3030=v1.8-LTS，3040=当前 slim
npm run test:regression:dual
```

双跑会在进入 Playwright 前核对两个监听进程的真实 cwd、Git worktree、branch 和 HEAD。端口接反、旧进程、错误分支或错误提交都必须直接红灯，不能产生假通过。

## 换分支或端口

### 单分支浏览器回归

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `E2E_BASE_URL` | `http://127.0.0.1:3040` | 指向待测候选服务 |
| `E2E_SERVER_COMMAND` | `npm run dev:e2e` | 目标未启动时由 Playwright 执行的启动命令 |
| `E2E_SKIP_WEB_SERVER` | 未设置 | 设为 `1` 时只连接已有服务，不自动启动 |
| `E2E_ACCESS_PASSWORD` | `zmd` | 当前 Web 访问密码 |
| `E2E_EXPECTED_OPERATOR_COUNT` | `30` | 首次安装页预期干员数 |
| `E2E_EXPECTED_WEAPON_COUNT` | `75` | 首次安装页预期武器数 |
| `E2E_EXPECTED_IMAGE_COUNT` | `559` | 首次安装页预期图片资源数 |
| `E2E_EXPECTED_VERSION_LABEL` | `Web LTS 1.8` | 安装完成后的版本标签 |

例如复用一个已经运行在 3050 的候选分支：

```bash
E2E_BASE_URL=http://127.0.0.1:3050 \
E2E_SKIP_WEB_SERVER=1 \
npm run test:regression
```

### 双分支回归

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `LTS_DUAL_BASE_URL` | `http://127.0.0.1:3030` | 基线服务 URL |
| `SLIM_DUAL_BASE_URL` | `http://127.0.0.1:3040` | 候选服务 URL |
| `LTS_DUAL_LTS_BRANCH` | `v1.8-LTS` | 基线期望分支 |
| `LTS_DUAL_SLIM_BRANCH` | `codex/v1.8-lts-slimming` | 候选期望分支 |
| `LTS_DUAL_WORKTREE` | 自动寻找基线分支 | 基线 worktree 绝对路径 |
| `SLIM_DUAL_WORKTREE` | 当前测试仓库 | 候选 worktree 绝对路径 |
| `LTS_DUAL_BASELINE_LABEL` | `v1.8-LTS` | 测试报告中的基线名称 |
| `LTS_DUAL_CANDIDATE_LABEL` | `v1.8-slim` | 测试报告中的候选名称 |
| `LTS_DUAL_BASELINE_LEGACY_DAMAGE_SHEET` | `true` | 基线是否应保留旧 Damage/XLSX/入口组 |
| `LTS_DUAL_CANDIDATE_LEGACY_DAMAGE_SHEET` | `false` | 候选是否应保留旧 Damage/XLSX/入口组 |
| `LTS_DUAL_BASELINE_LEGACY_THREE_PIECE_TYPE_EDITOR` | `true` | 基线是否应保留三件套旧 type 下拉 |
| `LTS_DUAL_CANDIDATE_LEGACY_THREE_PIECE_TYPE_EDITOR` | `false` | 候选是否应保留三件套旧 type 下拉 |

迁移到其他版本时只替换参数，不复制 runner 或 spec：

```bash
LTS_DUAL_LTS_BRANCH=v1.9-LTS \
LTS_DUAL_SLIM_BRANCH=codex/v1.9-lts-slimming \
LTS_DUAL_WORKTREE=/absolute/path/to/v1.9-lts \
SLIM_DUAL_WORKTREE=/absolute/path/to/v1.9-slim \
LTS_DUAL_BASELINE_LABEL=v1.9-LTS \
LTS_DUAL_CANDIDATE_LABEL=v1.9-slim \
LTS_DUAL_BASELINE_LEGACY_DAMAGE_SHEET=0 \
LTS_DUAL_BASELINE_LEGACY_THREE_PIECE_TYPE_EDITOR=0 \
E2E_EXPECTED_OPERATOR_COUNT=30 \
E2E_EXPECTED_WEAPON_COUNT=75 \
E2E_EXPECTED_IMAGE_COUNT=559 \
E2E_EXPECTED_VERSION_LABEL='Web LTS 1.9' \
npm run test:regression:dual
```

上例假设 1.9 基线已经退役两组 1.8 legacy 能力；候选默认同样不应存在。双跑 runner 自己负责服务就绪与身份检查，并明确禁止 Playwright 配置再启动第二个候选服务，所以自定义端口也不会偷偷回落到 3040。

## 维护规则

1. 无逻辑瘦身优先扩展 `CommonObservation`，让两侧执行同一个动作、返回同一种结构并做严格深比较。
2. 已确认的产品差异只能进入显式 capability 断言；不能用宽松选择器、忽略字段或两份测试掩盖差异。
3. 缺陷修复不要求继续复制基线中的错误行为。应先增加独立失败合同，再保留双跑验证未受影响的公共功能。
4. 纯模型、公式、normalize、存储事务和错误分类放在临近实现的 `*.test.ts`；跨页面真实流程才进入 Playwright。
5. E2E 必须使用隔离 browser context 和临时数据，不能读取开发者 Chrome、真实 OPFS 或用户缓存。
6. 每次增加覆盖，都同步更新本文件的边界说明；测试通过不能被描述成覆盖了未执行的平台场景。
7. 基线缺少某个可操作对象时，不得用条件跳过后仍把它标成 `PASS-DUAL`；应在候选 E2E 直接验证，并在双跑中只比较两侧真正共有的行为。

本次 SQLite 转换缺陷就是第 3 条的样例：`timelineArchiveConversionFlow.test.ts` 固定“写入成功后激活并重载”以及转换/激活错误分界；真实 3040 流程验证洛茜 A 技能与新 SQLite 当前工作区在重载后立即可见。

## 仍需独立平台终验

以下场景不能由当前 Node、单页 E2E 或双跑冒充已经覆盖：

- SQLite 文件选择器的完整导入/导出往返与损坏文件恢复；
- 双标签 Web Locks/BroadcastChannel 占用、接管和并发写入；
- 生产 Service Worker 控制后的真实断网冷启动与失败更新回滚；
- 操作系统级文件选择器、下载落盘及 Electron/桌面壳差异。
- 同一真实 profile 的 LTS → Slim 原位升级与既定回滚流程；
- 所有主题、页面与窗口尺寸的像素级视觉穷举。

这些能力完成自动化后，应作为第四层“平台终验”加入本入口，而不是塞入允许差异白名单。
