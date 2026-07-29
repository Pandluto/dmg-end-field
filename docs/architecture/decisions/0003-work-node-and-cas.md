# ADR-0003：mutation 使用 child Work Node 与 revision CAS

- Status: Accepted
- Recorded: 2026-07-15
- Decision period: Retrospective record of the Spec 8-1-3 implementation; see Evidence for the original artifacts.

## Context

直接修改 live 配置无法可靠预览、拒绝和恢复，并会在并发/过期状态下覆盖用户修改。

## Decision

工作台在当前 checkout 下创建 child Work Node，并用 `contentRevision` CAS 保护提交，避免基于过期快照覆盖用户已经保存的修改。

## Consequences

过期写入会被拒绝；实现需要明确处理 revision 冲突，并由用户决定刷新还是保留当前编辑。

## Evidence

`electron/timeline-repository.cjs`、`src/utils/mainWorkbenchControl.ts` 和 Work Node SQLite smoke。
