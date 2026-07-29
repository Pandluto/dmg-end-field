# Legacy Fill MCP extraction 文档索引

这组文档保留标准 MCP 接入和 MCP 填表页面的当前合同。实施清单与 T0–T9 阶段证据由 Git 历史保存，不继续放在 1.8 LTS 文档树中。

## 当前结论

- Codex 或其他标准 MCP client 直接连接独立 `legacy-fill-service` 的 `17323/mcp`。
- MCP 只负责读取、校验和创建/查看提案，不具备 approve、reject、save 或产品存储写入能力。
- 用户在主 Web 应用的 `/#/mcp-fill` 页面查看领域化结果，并选择 **拒绝** 或 **确认并写入**。
- Electron 只在后台负责进程监管和受保护 Host bridge，不创建 MCP 填表产品窗口。
- Legacy REST 继续通过 `17321` 兼容代理访问同一 core/repository。

## 阅读顺序

1. [spec.md](./spec.md)：目标、边界和验收标准。
2. [../../development/legacy-fill-mcp.md](../../development/legacy-fill-mcp.md)：日常开发、连接和验证方式。
3. [../../migrations/legacy-fill-external-tools.md](../../migrations/legacy-fill-external-tools.md)：外部历史填表工具的迁移与归档策略。

## 历史材料

冻结清单、任务状态和阶段验收可从基线提交 `073132d55d9253cb45c366b3beb93425f5330557` 恢复。当前仍保留 Legacy REST 兼容代理；是否移除由后续代码清理单独决定。

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
```
