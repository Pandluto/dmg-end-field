# 安全边界与威胁模型

## 保护对象

- 当前 Workbench transcript、干员配置、排轴与本机数据；
- 能产生副作用的 typed mutation tools；
- Harness Registry、candidate/promotion 证据；
- 本地文件系统与 OpenCode provider 凭据；
- 发布包与版本标签的完整性。

## 信任边界

| 边界 | 当前控制 |
| --- | --- |
| 浏览器页面 → interop bridge | 仅 loopback、受控 Origin、短期 bearer；观察接口与 mutation 接口同样受保护 |
| Interop → native session | stable session/turn/clientTurn correlation、幂等 reservation、SSE session 过滤 |
| Agent → 产品数据 | allowlisted typed resources；不开放任意 project/external filesystem |
| Agent → mutation | prepare capability、原生 permission `ask`、plan hash、revision CAS、postcondition |
| Harness candidate → stable | 不可变 hash、独立 regression、人工 promotion、可 rollback |
| Git tag → 发布包 | tag/package version 一致、CI 先行、跨平台构建、SHA-256、Draft Release 人工发布 |

## 失败策略

- snapshot、binding、revision、permission 或 postcondition 不确定时 fail-closed。
- 网络响应不确定时按 correlation 合流，不重新执行副作用。
- terminal state 不可逆；`stop` 不能覆盖 provider error/timeout。
- 工具目录、知识 reference 和文件路径采用 allowlist，未知项与路径穿越稳定拒绝。
- 多人 mutation 内部串行并 fail-stop；不得由模型并发重试制造重复提交。

## 仍需治理的风险

- Electron 已从 35 升至 39.8.10 以退出 2026-07-15 审计到的 high advisory 范围；仍需跟随受支持分支持续升级。Dependabot 只覆盖根 npm 与 Actions，上游 vendor 需要单独同步审计。
- `exceljs@4.4.0` 当前上游链包含已知 moderate `uuid` advisory；现有使用不向 `uuid` 的 buffer API 传入不可信输入，且 npm 给出的自动修复是破坏性降级到 ExcelJS 3，因此暂时接受并跟踪，而不是用 `--force` 制造兼容性倒退。
- GitHub CI 产出的 macOS DMG 默认不签名、不公证，Windows portable 也未代码签名，因此只能进入 Draft Release；公开发布前必须人工标注分发属性或接入签名密钥。
- 本地桌面黑盒尚未隔离到一次性 runner，测试数据和 transcript 必须在提交前脱敏。

安全问题应按根目录 [SECURITY.md](../../SECURITY.md) 报告，不要把敏感会话、token 或 provider 信息放入公开 issue。
