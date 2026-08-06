# DEF Harness Phase 3 验证记录

## 当前结论

Phase 3 代码、自动化合同、Mac 目录包和包内容边界均已完成。OpenCode/Pi 仍是明确占位，本阶段没有恢复真实模型、聊天入口、写操作、旧 REST 或 Node 业务 SQLite。

由于开发版 `npm run electron:dev` 按约定持续占用 `31457/17323`，本轮没有为重复执行 packaged launch smoke 而停止它。需要在这些固定端口空闲时补跑一次 `npm run electron:smoke:packaged:mac`，才能关闭最后一项环境验收；这不影响本阶段代码提交，但 `electron:check`/`electron:verify:mac` 暂不记为完整通过。

## 已实现纵向链路

| Business | Pinned lineage | Tool sequence | Browser fact source |
| --- | --- | --- | --- |
| selection | `selection@v1` | `def.node.crud.context` | 当前 `MainWorkbenchSnapshot` |
| loadout | `loadout@v4` | `def.data.resource.team_loadouts` | 当前 `operatorConfigs` |
| timeline | `timeline@v13` | `def.node.crud.current` | 当前 checkout 与 `skillButtons` |
| buff | `buff@v1` | `def.data.resource.buff` | 按钮、装备和套装效果 |
| calculation | `calculation@v1` | `def.node.crud.context` → `def.data.resource.damage` | 产品已生成的 damage report |

所有链路都从 route-only projection 开始；每个 phase 只开放一个只读 Tool，terminal projection 为空。Revision、content hash、phase、Tool projection 和 Browser snapshot binding 均固定在当前 Turn transaction。

## 自动化证据

- `npm run test:agent-harness`：通过；覆盖 Catalog/图/hash/不可变副本、五业务 golden result、旧 Revision Tool sequence parity、非法 operation、跨业务二次路由、未投影 mutation、Tool 输入、损坏 snapshot、缺失 damage report、prepare/commit 和 terminal 后调用。
- `agent/host/harness-blackbox.test.ts`：通过；五条 Fake Engine Turn 完整结束，并覆盖 projection revision、Event Journal、过期 binding、consumer lost、并发 Engine start、越权 Tool 零 ProductGateway 读取、abort/Tool result 竞态、Engine 原子拒绝和 Harness 提前终止。
- 最终修复后 `npm run check`：通过；包含整仓 typecheck、全部 Web/SQLite/计算测试、Agent Core/Host/Harness、Electron supervisor、Slim build 和离线工作区检查。
- `npm run check:repo`：通过；Agent 文件精确白名单、core 依赖边界、外部包禁入，以及 OpenCode/Pi、旧 REST、Node 业务 SQLite 静态禁入。
- `test:legacy-fill`、Electron static host/resource worker/data release/image release/runtime boundaries：全部通过。
- bundled Host 直接启动：通过；随机私有端口 health 为 ready，Engine 保持 `pending`，随后有序 shutdown。
- `npm run electron:build:dir`：通过；生成 Mac arm64 目录包。
- `npm run electron:smoke:package`：通过；包内包含 Phase 3 Harness/Tool 标记，且不含旧端口或 Node SQLite runtime。

## 独立审查

Sol Max 两轮共指出 6 个 P1：Engine 过早 terminal、abort/Tool result 竞态、loadout 排序修改 snapshot、占位伤害报告被误当成真实结果、错误 phase 的已登记 Tool 在拒绝前读取 ProductGateway、Manager 在 Engine 原子接受前提前推进状态。六项均已修复并加入合同或黑盒回归测试。

最终复审结论：无未关闭 P0/P1，审查者未修改文件。

## 仍保持的边界

- Browser SQLite 仍是唯一业务事实源；Agent Tool 只通过 `ProductGateway.getSnapshot` 读取。
- calculation Tool 不包含公式，只回传产品生成的 typed damage report。
- mutation/proposal/approval Tool 数量为零。
- Electron 不理解业务 Tool 或 Harness phase。
- 普通 Slim、MCP 填表和隐藏 AI 路由没有新增入口。
- 下一阶段的 OpenCode adapter 只能实现 `AgentEngine`，不能重新拥有 Session、Harness、Tool、ProductGateway 或 UI 协议。

## 待关闭项目

- 在开发版固定端口空闲后运行 `npm run electron:smoke:packaged:mac`。
