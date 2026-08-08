# DEF 轻量 Agent Runtime · G2 门禁记录

日期：2026-08-08  
分支：`codex/v1.8-lts-desktop-shell`

## 结论

G2 通过。Context/Compaction 与 Host Tool Bridge 已完成必要功能复核，可以进入 Runtime Session 组装。

| 包 | 最终提交 | 必要验证 | 结论 |
| --- | --- | --- | --- |
| P5 · Context/Compaction | `aa6c4584`、`0a12de42` | P5 12/12；P3 52/52 | 连续压缩只继承 latest summary、retained tail 和新历史；通过 |
| P6 · Host Tool Bridge | `3a732d31`、`49ebf7e0` | P6 15/15；P2 87/87 | 普通结果复用当前 projection，显式 phase 更新才递增；通过 |

## P7 必须保持的接口语义

- 每轮产品上下文即时获取，不写入 durable conversation。
- 第二次及后续压缩不得复活已由旧 summary 取代的原始历史，普通截断优先保留最新事实。
- Tool result 与 next projection 一次 settlement；普通 Tool 可以保持当前 revision。
- P7 只能组装 P2、P3、P5、P6，不得复制或旁路它们的状态机。

## 仓库门禁

- `npm run typecheck:agent`：通过。
- `npm run check:repo`：通过。
- P5/P6 写集：无越界提交。

