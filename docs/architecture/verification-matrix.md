# 验证矩阵

“通过”必须说明通过了哪一层。静态检查、包结构检查、真实 Agent replay 和 UI 验收不能互相替代。

| 层级 | 命令/入口 | CI | Release | 人工桌面 | 证明什么 |
| --- | --- | --- | --- | --- | --- |
| 仓库契约 | `npm run check:repo` | 是 | 是 | 可选 | 锁文件、打包输入、路径可移植性、JS 语法 |
| 全依赖审计 | `npm run audit:dependencies` | 是 | 是 | 可选 | 包括 Electron 构建运行时在内，无已知 high/critical advisory；moderate 单独登记与评估 |
| 生产类型 | `npm run typecheck` | 是 | 是 | 可选 | 非测试 TypeScript 严格检查 |
| 单元/合同 | `npm test` | 是 | 是 | 可选 | 计算、AI CLI、timeline/worktree codec 行为 |
| Harness 基建 | `npm run harness:check` | 是 | 是 | 可选 | 不可变包、Registry、选择与安全边界 |
| 知识合同 | `npm run check:knowledge` | 是 | 是 | 可选 | allowlist search → exact section read |
| Web 构建 | `npm run build:web` | 是 | 是 | 可选 | 前端可生产构建 |
| 数据管理服务 | `npm run smoke:data-management` | 否 | 否 | 开发时 | SQLite 用户库、迁移、数据包与存档服务的基础行为 |
| 完整数据包发布 | `npm run smoke:data-release-builder` | 否 | 否 | 发布数据前 | 选择 Local/Share Data、生成 manifest/ZIP、hash 与安全文件集合 |
| 数据应用与存档转换 | `npm run smoke:local-data-archive-flow` | 否 | 否 | 发布数据前 | 下载落入 Share Data、显式应用、共享存档写回和 SQLite 转换边界 |
| OpenCode UI/runtime | `electron:build*` | 否 | 是 | 可选 | vendored UI、core binary 与安装包组成 |
| 安装包 runtime | `npm run smoke:packaged-sidecar` | 否 | 是 | 可选 | Electron 共用的 sidecar 环境编排、asar 内源码、unpacked esbuild、OpenCode core 与可写 userData 路径可真实启动 |
| Interop 聚焦检查 | `npm run interop:check` | 否 | 否 | 是 | 本地 bridge/session/tool 观察协议 |
| Pure Blackbox | v1 + 新 native session | 否 | 否 | 是 | 真实自然语言 turn 与 native tool 链 |
| 可见 UI | Computer Use | 否 | 否 | 是 | 同一 Workbench iframe 中用户可见结果 |
| Mutation | permission + postcondition + 重进 | 否 | 否 | 是 | 拒绝零变化、批准持久化、无重复副作用 |

## 合并门

所有 push/PR 必须通过 `npm run check`。对运行时、typed tool、Harness 或 persistence 的行为改动，还必须按 `docs/testing/def-agent-blackbox.md` 留下对应 Spec 的人工证据；CI 绿灯不代表这类变更已经完成。

## 发布门

tag 触发工作流后，只有 version 校验、质量门和 Windows/macOS 打包均成功才创建 Draft Release。Draft 至少完成安装启动、AI 模式、一个只读 turn 和一个拒绝型 permission smoke 后，才可人工发布。

数据包不由 tag 工作流自动生成。每次对外发布数据包前，应运行数据包相关 smoke，并在桌面 Shell 验收“下载只进入 Share Data”与“应用数据后才改变前台数据/导入共享存档”。
