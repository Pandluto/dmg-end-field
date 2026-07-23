# Spec 9-2 实现与验收记录

日期：2026-07-23

分支：`codex/def-opencode-spec9-2-implementation`

当前实现提交：`d9dfc214`

## 结论

| 层次 | 结果 | 说明 |
| --- | --- | --- |
| 解耦 | 通过 | 旧整包 Harness、总 Skill 和巨型业务 Prompt 已退出正式 Workbench 主链路 |
| Harness Manager | 通过 | Router、事务、阶段推进、逐请求 Tool 投影、版本固定、单业务热重载和撤销均已实现 |
| 五业务 V1 | 通过 | selection、loadout、timeline、buff、calculation 均有真实 definition、Revision、阶段和 Tool 引用 |
| 原子边界 | 通过 | semantic write-scope、CAS、串行提交、下游 disposition 和业务级上下文投影由代码约束 |
| 自动验证 | 通过 | Manager 合同、项目回归、类型、构建、知识和仓库检查均通过 |
| 只读黑盒与真实 UI | 通过 | 五业务均走正式 Interop；最新回合在真实 DEF iframe 可见 |
| 写操作最终验收 | **未完成** | 尚未在隔离工作区完成五业务 mutation、native approval、跨业务计划和真实热重载 UI 矩阵 |

所以当前状态是：**Task 1—14 完成，Task 15 部分完成；不能把整轮写成全部验收通过。**

## 实现提交

| 施工段 | 提交 |
| --- | --- |
| 旧规则盘点与唯一入口 | `aef9e4e2`、`f1ce4fce`、`e7ca057b` |
| Registry、Router、事务、动态 Tool、写域 | `72db96ac`、`8652d5bc`、`43508415`、`a43a1060`、`bd2ad6a8` |
| 五业务 V1 | `0a0a0115`、`ef53f1a2`、`5176aef7`、`f12f2121`、`5e6bf0b3` |
| 正式切换与运行时边界 | `65373e24`、`109eb902` |
| 接手审计修复 | `59923a03`、`3b9b50fb`、`d9dfc214` |

接手审计修复了四类真实问题：

1. route/business/clarify 阶段原先允许模型在必需 Tool 前提前结束；
2. DeepSeek thinking 与强制 Tool 冲突，且 provider 可能复用上一阶段的旧 Tool 名；
3. 模型可能为整条排轴查询虚构角色、技能或坐标过滤条件；
4. `def_workbench_context` 会向当前业务泄露完整 Workbench 快照，削弱上下文原子性。

## 自动验证

| 命令 | 结果 |
| --- | --- |
| `npm run test:def-harness-manager` | 通过：44 个 Manager 测试及全部聚合合同 |
| `npm run typecheck` | 通过 |
| `npm test` | 通过 |
| `npm run build:web` | 通过；仅保留既有 chunk/dynamic-import 警告 |
| `npm run check:repo` | 通过：`tracked=6916 syntax=132 docs=21 images=524` |
| `npm run check:knowledge` | 通过 |
| `npm run build:opencode-runtime` | 通过；darwin-arm64 runtime SHA-256 为 `0c9f8b137a8af45accfdb3fc8ebccc7c74ff56a03a0c9f141a89abc4ba7bdda1` |
| 四个关键 JS/CJS `node --check` 与 `git diff --check` | 通过 |

`data/sharedata/**` 在接手前后的聚合 SHA-256 均为：

```text
e9adde7b0bd194092f2ed62de890c8a49172d2f38fe50f1b5a3009798215cf56
```

## 黑盒证据

| 业务 | Interop 证据 | 观察结果 |
| --- | --- | --- |
| selection | Session `ses_0714aa6edffeVMH6FMDuGUjIBc`，run `1c5aa394-1f3b-4033-bf63-1c395239d7d6` | `route → context → done`；真实 UI 显示赛希、汤汤、佩丽卡、意志·诀 |
| loadout | Session `ses_0715679a5ffevRbKMLB86Ov0fX`，run `30f93fd7-03f2-4a1d-9042-44a169dcfc4a` | 不完整 loadout 正确报告为“已保存配置不可用”，没有虚构成裸装或默认配置 |
| timeline | Session `ses_0714aa6edffeVMH6FMDuGUjIBc`，run `7a861d9a-e176-443b-b993-89684b8cf5cd`，turn `41754b45-a08a-4935-8a41-21906aec1d27` | `route → context → buttons → done`；按钮 Tool 实际输入为 `{}`，完成耗时约 9.4 秒，真实 UI 显示 0 个按钮 |
| buff | Session `ses_0714f0c10ffeaCW2dhaI0JDFhr`，run `5135a905-45fc-4603-b9ee-c9b33f28e735`，turn `22ead3be-cc03-45d6-bd2f-d71605365b58` | 整条时间轴只读取一次按钮列表，不再按角色拆分，也不扩张到其他 Work Node |
| calculation | 同上，turn `7910e697-0c23-4e6f-81b5-e093d34e7aeb` | `route → context → data_damage → done`；空报告只说明无计算按钮，不再推断所有干员缺配装 |

最新 timeline 回合还确认：

- Context 只保留 timeline 所需的 checkout、队伍和按钮状态；
- 不再暴露 damage report、operator config、skill catalog 或完整 Work Node 列表；
- 用户没有明确角色、技能或 `@N-L` 时，运行时删除模型附加的过滤条件；
- Computer Use 在真实 `DEF · 排轴助手` iframe 中看到了用户消息、三个 Tool 调用和最终回答。

此前四个只读业务的 Interop 运行游标在 sidecar 重启后失效，因此这里只保留了
Session/run/turn 和定性结果，不能把它们冒充为完整性能记录。

## Task 15 剩余验收

以下内容必须在独立、可清理的 SQLite/Workbench 测试工作区执行，不能直接拿用户
当前正式排轴充当测试夹具：

1. selection 的新增、换人、删人、native approval、真实页面和下游失效；
2. loadout 的预览、纠正、后续确认、原 proposal 固定和配置页 postcondition；
3. timeline 的添加、移动、删除、Work Node、审批和恢复；
4. buff 的单体与批量写入、写域隔离和可见 postcondition；
5. calculation 在上游 mutation 后的 recompute、版本和归因；
6. “换人后配装并计算”的跨业务顺序、每步新方案版本和中途停止；
7. 同 Session 的 loadout V1→V2 热重载、旧事务固定、新事务换版、revoke 和并发候选拒绝；
8. 为每个回合保存首响应、完成时间、Tool、question、failure、前后 state 和清理结果。

完成以上矩阵后，才能勾选 Task 15 并把本 Spec 标记为全部交付。
