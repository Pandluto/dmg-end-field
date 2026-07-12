# Spec 7 / Task 7-1 验收记录

## 结论

Spec 7 已完成。Workbench AI mode 与 `/AI CLI` 复用同一套 DEF OpenCode 前端，但保持 host、agent、session、directory、history、context、node 与 approval 隔离；节点修改落实为原生代码工具操作规范化 Work Node 工作区，并由 codec、校验、语义 diff、风险、revision CAS 与原生审批构成闭环。

## 关键验收证据

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 三类工具 | 通过 | 运行时注册 51 项，全部且仅归入 `def-node-code`、`def-node-crud`、`def-data-resource`，未分类数为 0。`def.user.record_answer` 归入 `def-node-crud`。 |
| Workbench 职责 | 通过 | 黑盒会话 `ses_0aa07cd23ffeGYIDIj8B1PvYvE` 对“你可以排轴吗”明确回答可以；没有再声称缺少排轴工具。 |
| 代码式节点修改 | 通过 | 黑盒会话 `ses_0aa0242e2ffekkKRVOcfjVNRuT` 使用原生 read/edit 修改 `node/working`，将莱万汀“燃烬”从第 1 格移到第 3 格；首响应 8.585 秒，完成 35.623 秒；rebuild 后 0 个校验问题，且“先看看”未触碰 checkout。 |
| 上下文接入 | 通过 | Workbench snapshot 经 host bridge、sidecar 与 session attachment 写入会话；黑盒能读取当前角色、技能按钮与 checkout/节点关系。 |
| 规范化工作区 | 通过 | `node/base`、`node/context`、`node/generated` 与 manifest 只读，`node/working/{selection,timeline,buffs,inputs}.json` 可编辑；codec round-trip、镜像重建、未知字段保真及重复格位/悬空 Buff 校验通过。 |
| 并发与陈旧审批 | 通过 | 修改 draft 后复用旧审批返回 `approval-stale`，同时给出 expected/actual revision 与 working hash；没有覆盖当前 checkout。 |
| 原生 permission | 通过 | `def_node_use` 产生 OpenCode 原生 permission `per_f5600aaeb001DkjdpWJg2PyZYl`；卡片携带 node、revision、语义 diff、risk 与 consequence。拒绝后治理记录为 `rejected`，draft 保留、checkout 不变。 |
| 原生 question | 通过 | 占用格位歧义产生原生 question `que_f560c5bd70016DOg1C5I77OqTG`；经 sidecar 拒绝后，同一 request id 被写入 DEF 治理档案，关联 session、Work Node、中文问题及业务选项，状态为 `rejected`。 |
| `/AI CLI` 隔离 | 通过 | 会话 `ses_0a9f577feffeMnfiAANIEjrgXz` 创建为 `host=ai-cli`、`agent=def-operator`。发送时刻意传入错误的 `def-workbench`，持久化的 user/assistant message 仍均为 `def-operator`；目录位于独立 `sessions/ai-cli`。 |
| 功能裁剪 | 通过 | 宿主“新增会话/工作节点”移除，保留原生 DEF-aware `+`；DEV、模型/agent、provider、server、project、Git、terminal、share 与对应命令入口被 feature matrix 禁用。POST `/pty` 与 `/provider/test` 均返回 403 `disabled-by-def-feature-matrix`。 |
| 节点变更与历史 | 通过 | 原生 review 数据源替换为 Work Node generated reports，提供用户摘要、semantic diff、source diff、validation/risk/revision；tab 显示节点 dirty/validated 关系，恢复会话不自动 checkout。 |
| 视觉 | 通过 | 实际 Chrome 页面确认旧深色双顶栏、旧按钮、DEV 与模型选择器消失；共享 UI 使用黑白蓝线稿 theme adapter，原生 tabs、timeline、tool、diff、question/permission 结构保留。 |
| 首次启动/恢复 | 通过 | sidecar 可自启动/恢复 REST 与 OpenCode runtime；session binding 持久化 host profile，重启后 bootstrap 可恢复；旧 404 与 notification server 缺失链路不再复现。 |

## 自动化与构建

- `node --test agent/runtime/def-node-workspace/codec.test.mjs`：3/3 通过。
- `npm run smoke:work-node-sqlite`：SQLite、REST、backup/restore、timeline migration 四项通过。
- `npm run smoke:workbench-history`：通过；运行中已有 WebSocket 端口产生非失败警告。
- JavaScript syntax check：adapter、sidecar、Electron main、dev agent、REST server 全部通过。
- `npm run build`：OpenCode UI、TypeScript 与宿主 Vite 全部完成；仅有 chunk size / dynamic import 警告。
- `npm run smoke:ai-cli-rest` 未作为通过证据：已有 REST 服务占用测试端口，脚本因 PID 归属假设失败；同一服务的 health、工具注册、真实 AI CLI 会话与消息隔离已分别实测通过。

## Checkout 安全结果

所有“先看看”、审批拒绝、原生 question 拒绝和陈旧审批测试均未改变主 Workbench checkout。测试生成的 Work Node 保留为可审计 draft；只有通过当前 revision/hash 校验并经原生 permission 批准的 `use` 才能进入 renderer checkout 链。
