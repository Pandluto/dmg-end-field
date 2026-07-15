# AI Buff Fill Demo

这版 demo 先落三样东西：

- 映射词典：[src/aiCli/buffFill/catalog.ts](../../../src/aiCli/buffFill/catalog.ts)
- Buff Fill JSON Schema：[src/aiCli/buffFill/schema.ts](../../../src/aiCli/buffFill/schema.ts)
- 本地验证器：[src/aiCli/buffFill/validator.ts](../../../src/aiCli/buffFill/validator.ts)

## 目标

这套 demo 不让模型直接自由生成最终 `BuffDraft`。

模型先返回一个受限的 `BuffFillAiDraft`：

- `items` 和 `effects` 用数组，减少模型拼 key 的负担
- 每条 effect 必须带 `evidenceText`
- `modifier.type` 只能从白名单枚举里选
- `extraHit` 只能走固定 trigger 和 damageType 范围

程序再把它转成现有编辑器使用的 `BuffDraft`。

## 当前接法

给模型的上下文至少要包含两部分：

1. 结构约束：`createBuffFillAiDraftSchema()`
2. 语义约束：`buildBuffTypeCatalogPromptSection()`

最小接法示意：

```ts
import { buildBuffTypeCatalogPromptSection } from '../src/aiCli/buffFill/catalog';
import { createBuffFillAiDraftSchema } from '../src/aiCli/buffFill/schema';

const outputSchema = createBuffFillAiDraftSchema();
const catalogSection = buildBuffTypeCatalogPromptSection();

const prompt = [
  '你是 Buff 填表助手。',
  '只能在白名单内映射，不要发明新 type。',
  catalogSection,
  '',
  '待整理文本：',
  sourceText,
].join('\n');
```

如果模型返回结果后需要落表，先做两步：

```ts
import { validateBuffFillAiDraft, convertBuffFillAiDraftToBuffDraft } from '../src/aiCli/buffFill/validator';

const result = validateBuffFillAiDraft(modelOutput);
if (!result.ok) {
  throw new Error(result.errors.join('\n'));
}

const draft = convertBuffFillAiDraftToBuffDraft(modelOutput);
```

## 这版 validator 在拦什么

- 根结构不是对象
- `items` / `effects` 不是数组
- `effectKind` 不是 `modifier | extraHit`
- `modifier.type` 不在白名单
- `extraHit` 没有空 `type`
- `extraHit` 不是固定 trigger
- `extraHit` 的证据文本里没有明显额外段信号词

## 当前边界

这还是一个最小 demo，不包括：

- 自动重试
- 模糊映射打分策略
- 多阶段抽取
- 回归样本跑批

但它已经够你做第一轮受约束模型接入实验，先验证：

- 白名单词典是否够用
- schema 是否够严
- validator 拦截是否符合预期
