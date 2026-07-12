# Spec 6 / Task 6-1 验收记录

验收日期：2026-07-12

## 架构结果

- 唯一 registry：`agent/runtime/def-tools/registry.mjs`。
- 三个正式 family：`def-node-code`、`def-node-crud`、`def-data-resource`。
- 兼容工具：50 个；全部有唯一 family、schema、handler、scope、risk、approval、exposure、alias 和 migration status。
- canonical target：20 个；3 个 node-code、11 个 node-crud、6 个 data-resource，全部为 implemented。
- OpenCode 原生发现：`read`、`edit`、`apply_patch`、`glob`、`grep` 及 14 个 `def_*` 工具。
- 对照接口：`GET /api/def-tools/route-map`。旧 REST 入口仅作为 native plugin 内部 transport 和显式兼容调用保留，不进入模型 prompt。

## 节点代码闭环

黑盒请求：`把第一组第一个按钮移动到第3格，先不要应用`

- session：`ses_0ab3e8c6dffenz0KEIkGOvYRHO`
- 首响应：16261 ms；完成：48618 ms。
- 真实调用：`def_node_fork` → native `read/edit` → `def_node_sync_validate` → `def_node_diff`。
- 修改：同一按钮在 `timelineData`、`skillButtonTable` 和 `occupiedNodes` 中同步从 index 0 移到 index 2；没有翻译回 Patch DSL。
- validate：通过；diff：changed button = 1；`currentCheckoutTouched=false`。
- 当前 checkout 同一按钮仍为 index 0；pending command = 0。

跨族黑盒请求：`把长息·队友伤害+16%加到第一组第一个按钮，先不要应用`

- session：`ses_0ab3200fbffeQ08SDU4mF3MjqV`
- 首响应：15368 ms；完成：47484 ms。
- 调用：`def_node_fork`、`def_data_buff`、native `read/edit`、`def_node_sync_validate`。
- 可信资源 id：`buff-1782353553953-wykcdfiei`；写入子节点后验证通过；未应用。

成功 use：使用无差异子节点，renderer 实际消费 `checkoutAiTimelineWorkNode` command。

- command 从 pending 到 done；生成 commit；`checkoutApplied=true`。
- `currentCheckoutTouched=true`；snapshot、按钮数和 staff 分布验证通过。
- use 前后首按钮位置和按钮总数一致，说明直接使用的是节点 payload，不是重新执行编辑步骤。

拒绝路径：manual approval 子节点的 native permission 被测试用户拒绝。

- 审批档案状态：`rejected`。
- checkout 前后首按钮位置均为 0。
- pending command 前后均为 0。
- 被拒绝的独立子节点未污染 checkout，测试节点随后删除。

CRUD 验收：fork 后 list 可见；native approval 后 delete 成功；再次 list 不存在。当前 checkout 节点由 repository protection 保护。

## 数据资源与返回边界

六类 native resource 均真实调用成功：operator、weapon、equipment、skill、Buff、damage。

空查询返回体大小约为：operator 1.5 KB、weapon 0.8 KB、equipment 16 KB、skill 2.5 KB、Buff 14.7 KB、damage 2.8 KB。数组、对象深度和字符串均有界；damage 返回摘要，不再返回完整 246 KB 报告。

## 权限与隔离

- 每个 session 的目录为 `.../sessions/<host>/<uuid>`，并写入 `.def-session.json`；工作节点另写 `.def-node.json`。
- Workbench 与 AI CLI 的 agent、session id、目录、浏览器 origin 和 local storage 独立。
- native permission：`bash/task/webfetch/websearch/external_directory` denied；node workspace 中 `read/edit/glob/grep` allowed；use/delete/restore ask。
- 越界黑盒请求：`看看项目根目录 package.json 的 version 是多少`。
- native `read` 返回 error；最终回答明确 external directory 被拒绝；没有泄露项目版本。
- sidecar/runtime 重启后，同一 session 通过 `.def-session.json` 的精确目录恢复成功。

## 原生前端

- 上游来源见 `src/components/def-opencode/UPSTREAM.md`。
- `packages/app` 原样构建，sidecar 同源托管并代理 OpenCode JSON/SSE；没有 React 仿制聊天内核。
- 两个宿主都只引用 `DefOpenCodeView`。旧 `AiCliPage` 和 `MainWorkbenchAiPanel` 的消息、stream、tool card、history 内核已删除约 5000 行。
- 原生页面具有 session timeline、composer、tool/reasoning/diff/review、permission、stop/retry、session switching、keyboard UI。

Chrome 可视验收：

- Workbench AI mode：显示 `DEF 节点工作台`，iframe 进入 `def-workbench` 的隔离 session；console error = 0。
- `/ai-cli`：显示 `DEF /AI CLI`，iframe 进入 `def-operator` 的隔离 session；console error = 0。
- AI CLI 点击“新建会话”后，仅 AI CLI iframe 的 session id 和目录变化；Workbench iframe 完全不变。
- 两侧分别使用 `127.0.0.1:17322` 与 `localhost:17322`，共享同一 OpenCode runtime，但不共享 active session state。

## 启动、兼容和构建

- 首次进入会依次确保 DEF handler 17321、sidecar 17322、OpenCode runtime 17445 就绪，然后创建宿主 session。
- UI 与 runtime 均由同一 vendored OpenCode v1.17.11 构建，修复了旧 binary/API 与 1.17.11 UI 错配导致的 `.map/.filter is not a function`。
- `npm run build`：通过。
- `npm run smoke:work-node-sqlite`：四项 Work Node SQLite、REST、备份恢复与迁移 smoke 全部通过。
- `npm run smoke:ai-cli-rest`：未计为通过。常驻 Electron 已占用 17322，隔离 HTTP 端口重跑又与常驻 31457 WebSocket 桥冲突；未为迎合 smoke 停止正在使用的开发服务。该旧兼容 smoke 的并行安全性不作为原生 OpenCode 用户路径的替代证据。
- `npm run build:opencode-runtime`：通过，Windows runtime checksum 已写入 manifest。
- `npm run electron:dev`：3030 监听并完成两个真实宿主 Chrome 验收。
- 黑盒入口严格使用 `POST /def-agent/workbench-test/prompt`；没有用直接 smoke 替代 agent 行为。

## 上游差异

本轮 version lock 为 OpenCode v1.17.11，tag commit `67aec2212010d67775c35e696d8b8b54902eb338`。验收时最新 tag 为 v1.17.18，commit `b1fc8113948b518835c2a39ece49553cffe9b30c`；GitHub compare 显示相差 456 commits / 1200 files。当前没有混用最新版 UI 和旧 runtime；后续升级必须同步更新 vendor、runtime、UI 并重跑本记录中的兼容验收。
