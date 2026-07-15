# 架构演进与技术债务

## 已形成的主线

| 阶段 | 结果 |
| --- | --- |
| 原生接线 | 保留 OpenCode iframe，建立 v1 turn/events/transcript/questions/state 观察面 |
| Harness 基建 | 不可变 package、Registry、stable/candidate/rollback、session pinning |
| 教学闭环 | 真实失败会话 → 审计 → candidate → native replay → 人工 promotion |
| 产品写入 | typed prepare、原生审批、child Work Node、revision CAS、postcondition |
| 知识路由 | allowlisted search → exact section read，团队批量查询代替逐人循环 |
| 工程治理 | 统一质量门、CI、跨平台 Draft Release、架构事实源和 ADR |

## 优先债务

### P1：发布链首次生产验收

触发一个真实版本 tag，修正 hosted runner 上的 vendored OpenCode/native packaging 差异，完成两个平台安装 smoke。只有完成后，CD 才从“代码已落地”变为“生产验证”。

### P1：拆分超大运行时模块

按边界渐进拆分 `electron/main.cjs` 和 `scripts/ai-cli-rest-server.mjs`：

1. process supervisor / health；
2. interop transport；
3. snapshot and repository adapters；
4. operator/loadout/knowledge typed domains；
5. permission and commit protocol。

每次只移动一个边界并保持合同检查，避免大爆炸重写。

### P1：可重复桌面验收环境

把 native blackbox 需要的 fixture、provider stub/recording、UI consumer 生命周期和数据清理变成独立 runner。目标不是把 Computer Use 全塞进每个 PR，而是提供可定期运行的 nightly/manual workflow。

### P2：Harness judge 完整化

补齐 hidden regression 数据隔离、独立 promotion-decision artifact、相邻能力覆盖和失败聚类。在证据稳定前继续人工 promotion，不做自动修改 stable。

### P2：依赖与 vendor 治理

建立 OpenCode 上游 revision、patch 列表、同步周期和变更验证；跟踪 Electron 高风险 advisory 与 ExcelJS/uuid 上游状态。避免对 vendored workspace 运行无边界的自动升级。

### P2：发布包与前端体积

当前 Web 主 chunk 约 2.5 MB（gzip 约 739 KB），并且为保证 sidecar 正确运行，安装包暂时携带 `src/**` 与 Vite runtime。后续应按页面拆分主 chunk，并把 sidecar 所需 TS 预构建为独立 bundle，收窄 electron-builder 输入；优化前以实际可运行优先，不用忽略 warning 或删源码制造假小包。

### P2：对外工程材料

README、展示页、截图、演示数据和许可证范围需要单独完成。README 应从本目录链接到真实架构与验证证据，而不是堆砌未经验证的能力宣称。

## 面试审查口径

可以明确宣称：架构边界、写入安全、Harness 版本化、本地质量门和 Draft CD 已有实现与事实源。

不能提前宣称：自动训练模型、全自动安全 promotion、云端桌面 E2E、已签名跨平台公开发布。能够准确说出这些边界，比用“全自动”包装未验证链路更经得住追问。
