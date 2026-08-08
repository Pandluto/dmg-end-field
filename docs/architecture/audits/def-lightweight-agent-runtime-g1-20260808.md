# DEF 轻量 Agent Runtime · G1 门禁记录

日期：2026-08-08  
分支：`codex/v1.8-lts-desktop-shell`

## 结论

G1 通过。P0、P1、PS、P2、P3、P4 均已在各自写集内完成，必要功能测试通过，独立复核未留下正常产品路径的 Blocker 或 High。Wave 2 可以基于以下提交继续开发。

| 包 | 最终提交 | 必要验证 | 结论 |
| --- | --- | --- | --- |
| P0 · Pi Golden Oracle | `55b086b7`、`f3b6a29c` | Trace schema + golden fixture 28/28 | 通过 |
| P1 · Provider Transport | `a8c29585` | SSE、retry、driver 26/26 | 通过 |
| PS · Provider Profile | `56897576` | Profile 定向测试 | 通过 |
| P2 · Agent Loop | `7a301079` | Agent loop 87/87；并发与持久化功能 probe 2/2 | 通过 |
| P3 · Session Log | `4063879e`、`94f96182` | Session 52/52；真实 P2 marker 落盘 | 通过 |
| P4 · Conversation Projection/Store | `c2382095` | Contract 7/7、Projector 16/16、Store 8/8 | 通过 |

## 已锁定的联调约束

- Runtime start/event/terminal 只有 durable commit 成功后才进入可见状态。
- Session 首版保持线性历史；Controller marker 通过 `SessionLog.appendControllerRunMarker()` 绑定当前 durable leaf。
- Tool result 与下一份 projection 作为一次 settlement 返回；普通 Tool 可以原子复用当前 projection。
- Host Tool/Interaction 状态拥有最终权威；同一 cursor 的 live state 与 fresh replay 必须一致。
- `agent/vendor/` 不属于本轮提交范围，后续任务不得暂存或修改。

## 仓库门禁

- `npm run typecheck:agent`：通过。
- `npm run check:repo`：通过。
- 各包写集：无越界提交。

