# Legacy Fill MCP extraction 文档索引

这组文档记录 Legacy AI CLI 独立化、标准 MCP 接入和 MCP 填表 Web 产品页。当前事实以本页、开发指南和最新产品验证为准；T0–T9 文件保留阶段性证据，不代表最终 UI 形态。

## 当前结论

- Codex 或其他标准 MCP client 直接连接独立 `legacy-fill-service` 的 `17323/mcp`。
- MCP 只负责读取、校验和创建/查看提案，不具备 approve、reject、save 或产品存储写入能力。
- 用户在主 Web 应用的 `/#/mcp-fill` 页面查看领域化结果，并选择 **拒绝** 或 **确认并写入**。
- Electron 只在后台负责进程监管和受保护 Host bridge，不创建 MCP 填表产品窗口。
- Legacy REST 继续通过 `17321` 兼容代理访问同一 core/repository。
- DEF OpenCode 是完全平行的运行时，只作为本次拆分的零回归验证对象。

## 阅读顺序

1. [spec.md](./spec.md)：目标、边界和验收标准。
2. [tasks.md](./tasks.md)：唯一任务清单和完成状态。
3. [verification-final-20260719.md](./verification-final-20260719.md)：实现、打包和整体回归结论。
4. [verification-mcp-fill-product-ui-20260719.md](./verification-mcp-fill-product-ui-20260719.md)：最终 Web 产品页、交互、安全边界和 Computer Use 证据。
5. [../../development/legacy-fill-mcp.md](../../development/legacy-fill-mcp.md)：日常开发、连接和验证方式。
6. [../../migrations/legacy-fill-external-tools.md](../../migrations/legacy-fill-external-tools.md)：外部历史填表工具的迁移与归档策略。

## 证据文件分工

- [inventory.md](./inventory.md) 是实施前冻结清单。
- `verification-t0-*` 至 `verification-t9-*` 是各任务完成当时的阶段证据。
- T8 的独立 Electron review window 是阶段性实现，后来已由 `/#/mcp-fill` Web 产品页取代；兼容 URL 和 bridge 只负责跳转到新路由。
- T10/T11 仍为后续显式门控任务：当前不移除 Legacy REST 兼容代理，也不重命名 DEF local core service。

## 当前运行边界

```text
Codex / standard MCP client
  -> 17323/mcp
  -> read / validate / proposal only

Main Web app /#/mcp-fill
  -> protected Web Host bridge
  -> review-bound one-use action capability
  -> restricted product writer + reread + audit

Legacy REST caller
  -> 17321 compatibility proxy
  -> the same legacy-fill-service/core/repository

DEF OpenCode
  -> separate 17321 DEF core / 17322 sidecar / native sessions
  -> no MCP registration, token, proposal, approval, or storage sharing
```
