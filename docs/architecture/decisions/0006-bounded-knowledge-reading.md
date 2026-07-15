# ADR-0006：知识采用 allowlist 两阶段读取

- Status: Accepted
- Date: 2026-07-15

## Context

通用短文本截断会漏掉攻略段落；开放文件系统又会扩大数据泄漏和无关探索，模型还可能反复逐人查找。

## Decision

知识工具先搜索 allowlisted references 并返回 section ID，再按精确 reference/section 读取连续 Markdown，同时返回 `truncated`、`nextSection` 和可用目录。团队级查询优先批量 resource，只有明确缺失时允许一次定向补查。

## Consequences

知识调用更短且可审计，路径穿越与未知 reference 稳定拒绝；新增知识必须进入索引和合同检查，不能临时读取任意项目文件。

## Evidence

`scripts/def-game-knowledge-contract-check.mjs`、`scripts/ai-cli-rest-server.mjs`、Spec 8-1-3 verification。
