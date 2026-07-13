# YZ 博主知识蒸馏方案研究（2026-07-13）

## 目标

本研究只讨论“如何把博主视频/转录稳定蒸馏为 DEF Agent 可消费、可追溯、可更新的知识”，不展开知识工具的代码实现，也不编写下一阶段 spec/tasks。

目标不是把视频压缩成更短的 Markdown，而是生产三类可复用资产：

1. 能理解玩家怎么说的术语资产；
2. 能解释为什么这样配、这样打的决策资产；
3. 能在当前 Workbench 上安全落地的操作意图资产。

运行时接入另见 [`research-yz-runtime-deep-dive-20260713.md`](./research-yz-runtime-deep-dive-20260713.md)。

## 结论摘要

推荐采用“证据优先、两阶段蒸馏、五类知识对象、三层发布”的流水线：

```text
原始视频/字幕
  → 不可变 source + 时间戳证据
  → 第一阶段：保真清洗与 claim 抽取
  → 实体解析 + 数值/版本核验 + 冲突标注
  → 第二阶段：决策规则、Rotation Graph、替换边界合成
  → 人工审阅高风险项
  → 发布 glossary / knowledge cards / evidence excerpts
  → 构建可检索索引与黑盒评测集
```

核心原则：

- 不直接从长转录生成最终攻略卡；中间必须保留逐条 claim 和来源定位；
- ASR 纠错只生成“候选归一化”，不得覆盖原文；
- 数值、持续时间、倍率、潜能和版本条件属于高风险知识，必须单独核验；
- 固定轴要蒸馏成“动作 + 前置条件 + 产生状态 + 失败分支”，而不是步骤列表；
- 同一博主的新旧视频不互相覆盖，通过 `supersedes`、适用版本和冲突记录演进；
- 社区建议和 DEF 实时事实始终分层，蒸馏资产不得伪装为官方数据库。

## 一、现有材料的质量审计

### 1. 当前优点

现有 10 篇 reference 已经比原始口播更适合模型使用：

- 按阵容、冷/热启动、装备和技巧分节；
- 明确列出部分队伍定位、潜能条件和装备方案；
- 汇总了角色外号、装备误识别和常见 ASR 错误；
- 能看到“对单/对群”“轮椅/操作型”“核心不可换”等决策信息；
- 部分不确定名称已标注“待确认/待录入”。

这些适合作为第二阶段合成材料的雏形。

### 2. 当前缺口

`YZ.md` 实际是 `SKILL.md`、glossary 和各篇已整理攻略的串接，不是原始证据仓。现有文件普遍缺少：

- 视频 URL、BV/id、发布日期、转录获取时间；
- 每条结论对应的视频时间戳或原始字幕行号；
- 游戏版本的明确来源，部分只有标题中的“1.2”或正文“当前版本”；
- 原句、纠错后文本和蒸馏结论之间的映射；
- 数值由主播直接陈述、画面读取、人工计算还是蒸馏者推断；
- 同类视频之间哪些结论重复、修正或冲突。

因此无法可靠复核例如 `182.61%`、`211.76%`、`+30%`、`持续 25 秒`、`五潜` 等知识。它们可能正确，但当前数据结构无法证明。

### 3. 信息重复与漂移风险

相同规则会出现在 glossary、角色总攻略和多个配队攻略中。例如洁尔佩塔/佩丽卡的冷却配装规则、狼卫清波套、莱万汀充能条件可能被复制多次。若某一版本发生变化，需要人工搜索所有副本，容易产生同义不同值。

未来应把共通知识抽成独立 claim/rule，由攻略卡引用；不要继续复制同一段文字。

## 二、输入层：先建立不可变证据仓

每个视频建立独立 source manifest：

```yaml
schemaVersion: 1
sourceId: yz-bvxxxx
creator: YZ
platform: bilibili
url: https://...
title: ...
publishedAt: 2026-..
gameVersionClaimed: "1.2"
capturedAt: 2026-07-13
transcriptMethod: platform-subtitle | asr | manual
language: zh-CN
contentHash: sha256:...
```

同目录保留：

- `raw-transcript.jsonl`：带 start/end 时间戳的原始字幕，永不覆盖；
- `normalized-transcript.jsonl`：纠错后文本，保留指向 raw span；
- `source-notes.md`：画面信息、缺字幕段、作者口误和人工备注；
- 可选截图证据索引：只保存关键面板/轴画面的时间戳和 hash，不必把整段视频复制进仓库。

`contentHash` 用于判断同一字幕是否被平台或人工更新。重新转录时新增 revision，不覆盖旧证据。

## 三、第一阶段蒸馏：保真清洗与 claim 抽取

### 1. ASR 归一化采用双轨制

每个片段同时保留：

```json
{
  "raw": "三动火配生活的面板",
  "normalized": "3 件动火用套装，搭配生物辅助面板",
  "corrections": [
    { "from": "三动火", "to": "3 件动火用", "confidence": 0.96 },
    { "from": "生活的面板", "to": "生物辅助面板", "confidence": 0.72 }
  ],
  "sourceSpan": { "startMs": 123000, "endMs": 128000 }
}
```

低置信度纠错进入 review queue。不能直接把“晓勇”“兼程主导者”等疑似名称写成正式资源；应先通过 DEF resource resolver 核对，找不到则保持 `unresolvedTerm`。

### 2. 先抽取原子 claim，不直接写攻略

每个可判定陈述拆成单一 claim：

```json
{
  "claimId": "claim-...",
  "kind": "threshold",
  "subject": "黎风",
  "predicate": "终结技充能效率最低要求",
  "value": 211.76,
  "unit": "%",
  "conditions": ["零潜", "双大打法"],
  "scope": ["弭弗", "陈千语", "黎风", "骏卫"],
  "sourceId": "yz-bvxxxx",
  "sourceSpans": [{ "startMs": 0, "endMs": 0 }],
  "evidenceMode": "spoken | screen | calculated | inferred",
  "confidence": "unreviewed",
  "gameVersion": "unknown"
}
```

claim 必须是原子的。比如“秋栗更适合对群并且启动更快”应拆为“偏对群”和“启动更快”两条，分别记录条件和证据。

### 3. claim 风险分级

| 等级 | 类型 | 处理方式 |
| --- | --- | --- |
| L0 | 别名、口头表达、视频标题信息 | 自动抽取，可抽样复核 |
| L1 | 阵容定位、操作偏好、主观优缺点 | 保留来源措辞，标 community opinion |
| L2 | 动作顺序、触发条件、替换建议 | 至少检查上下文完整性与前置条件 |
| L3 | 数值、倍率、持续时间、冷却、阈值、潜能条件 | 必须与画面/DEF 数据/第二证据核验 |
| L4 | 能导致 Agent 写节点的具体映射 | 必须经过 schema 校验和最小 Workbench 演练 |

L3 未核验不得进入默认答案的确定事实层；可以作为“该攻略声称”返回，并带版本/不确定性。

## 四、五类知识对象

### 1. Terminology

覆盖昵称、缩写、ASR 错误和集合表达：

- `42 → 莱万汀`；
- `三动火 → count=3, gearSet=动火用`；
- `轮椅 → 低操作、容错高的阵容标签`。

术语对象要区分 alias、ASR correction 和 composition expression，避免把所有映射塞在一张 Markdown 表里。

### 2. Claim

最小事实/观点单元，带来源、版本、条件、风险和验证状态。公共数值或机制只保存一次，其他卡片通过 id 引用。

### 3. Decision Rule

表达“在什么条件下选什么”：

```json
{
  "when": ["莱万汀火队", "主要对群"],
  "recommend": "秋栗",
  "insteadOf": "安塔尔",
  "because": ["群体火附着", "启动更快"],
  "tradeoffs": ["安塔尔偏对单并提供长时间单体脆弱"],
  "evidenceClaims": ["claim-a", "claim-b"]
}
```

Decision Rule 是博主蒸馏最有价值的层，因为它让 Agent 能适配用户条件，而不只是复述固定答案。

### 4. Rotation Graph

固定步骤列表不足以表达循环、条件和失败恢复。建议把每套轴建模为有向图：

```json
{
  "rotationId": "...",
  "entryConditions": ["冷启动", "全员终结技未充满"],
  "nodes": [
    {
      "id": "r1",
      "actor": "安塔尔",
      "action": "战技",
      "requires": ["目标可挂脆弱"],
      "produces": ["单体脆弱"],
      "next": "r2"
    }
  ],
  "branches": [
    {
      "when": "莱万汀仍差一次连携充能",
      "goTo": "补连携分支"
    }
  ],
  "interruptions": ["Boss 转阶段", "目标位移", "技能打空"],
  "recoveryRules": []
}
```

其中 actor/action 是业务语义，不直接存 DEF button id 或 `nodeIndex`。运行时再结合当前画布和 data tools 映射。

### 5. Build Rule

装备建议表达成优先级和约束，而不是静态清单：

- 目标：满足充能阈值；
- 前提：潜能、武器、循环分支；
- 满足后：转向输出属性；
- 替代：资源不足时的可接受方案；
- 禁配：会破坏连携同步的组合。

这样可以避免 Agent 把特定账号面板照搬给所有用户。

## 五、第二阶段蒸馏：从 claims 合成知识卡

每张卡只针对一个明确决策面，例如：

- `莱万汀火队第四位：秋栗 vs 安塔尔`；
- `弭弗传统物理队：四碎八猛热启动`；
- `佩丽卡与洁尔佩塔：连携冷却配装约束`。

不要把“一个视频”机械等同于“一张卡”。一个总攻略可拆成多张卡；多个视频也可以共同支持一张对比卡。

知识卡推荐结构：

```yaml
id: decision-laevatain-flex-qiuli-vs-antal
kind: decision
title: 莱万汀传统火队第四位选择
appliesWhen:
  gameVersion: ["1.2"]
  coreTeam: [莱万汀, 狼卫, 艾尔黛拉]
summary: ...
options:
  - choice: 秋栗
    bestFor: [对群, 快启动]
    tradeoffs: [...]
  - choice: 安塔尔
    bestFor: [对单, 长时间单体脆弱]
    tradeoffs: [...]
claims: [claim-a, claim-b]
conflicts: []
review:
  status: reviewed
  reviewedAt: 2026-07-13
```

卡片摘要必须能从引用 claims 推导；不允许在合成阶段引入没有证据的新结论。

## 六、冲突与版本演进

### 1. 不做静默覆盖

同一主题出现新视频时：

- 新建 source 和 claims；
- 自动查找相同 subject/predicate/conditions；
- 相同值合并证据；
- 不同值生成 conflict；
- 只有明确版本替代关系时标记 `supersedes`。

### 2. 冲突类型

- `version-change`：游戏版本导致机制或数值变化；
- `account-condition`：潜能、武器或装备不同；
- `scenario-difference`：对单/对群、冷/热启动不同；
- `creator-revision`：博主后续修正旧说法；
- `asr-uncertainty`：实际只是转录不确定；
- `unresolved`：证据不足，保留双方。

Agent 查询时优先返回适用条件匹配的结论，而不是简单选择“最新”或多数票。

### 3. 时效策略

- 有明确游戏版本：按版本过滤；
- 只有“当前版本”：绑定视频发布时间和 capturedAt，标记弱版本证据；
- 无版本：默认 `unknown`，不可用于确定性数值回答；
- DEF 实时 tools 与攻略冲突：实时工具优先，攻略卡标记待复审。

## 七、质检流程

### 自动检查

- manifest、source span 和 hash 完整；
- entity 能否被 DEF resolver 识别；
- 百分比、秒数、潜能等高风险值是否有 evidence span；
- Rotation Graph 是否有 entry、终止或循环出口；
- 每个 Decision Rule 是否同时包含条件、推荐、原因和 tradeoff；
- 知识卡中的每句话是否至少由一个 claim 支持；
- 未确认术语是否误进入正式 entity 字段；
- 相同 predicate 是否存在未处理冲突；
- glossary 是否出现循环映射或同一 alias 对应多个正式名。

### 人工审阅

人工不需要重写全文，主要审：

1. L3/L4 高风险 claim；
2. ASR 低置信度纠错；
3. 新旧视频冲突；
4. “不可替换”“必须”“最高”等强结论；
5. Rotation Graph 的条件和失败分支；
6. 是否把主播主观偏好误写成官方机制。

### 发布门槛

| 状态 | 可用于什么 |
| --- | --- |
| draft | 仅内部检索和人工审阅 |
| evidence-linked | Agent 可引用为“攻略提到”，不能当确定事实 |
| reviewed | 可用于普通建议，仍需展示版本与条件 |
| runtime-verified | 已与当前 DEF 数据/Workbench 演练核对，可用于建议并实施 |
| stale | 默认不召回，除非用户明确询问旧版本 |

## 八、蒸馏 Agent 的推荐提示协议

蒸馏任务可以使用模型，但提示词必须要求输出证据对象，而不是直接写漂亮攻略。推荐分两次调用：

### Pass A：抽取

输入：单个带时间戳 transcript chunk、已有 glossary 和可用 entity resolver 结果。

输出：

- normalization candidates；
- atomic claims；
- action events；
- unresolved terms；
- source spans；
- 不做跨 chunk 总结。

### Pass B：合成

输入：同一主题下已验证 claims、冲突表和用户目标 schema。

输出：

- Decision Rules；
- Rotation Graph；
- Build Rules；
- 替换边界；
- 仍缺少的证据问题。

两次调用都禁止：

- 补全字幕里没有的技能名、数值或因果；
- 为了让流程完整而虚构中间步骤；
- 删除与主结论冲突的 claim；
- 把“推荐/感觉/大概”改写成确定事实。

## 九、增量蒸馏流程

每新增一个 YZ 视频：

1. 保存 source manifest 和原始转录；
2. 对 transcript 分块，每块保留 10~20 秒重叠，避免动作跨段丢失；
3. Pass A 抽取并进入 entity/数字核验；
4. 与现有 claims 做相同/冲突/替代匹配；
5. 只重建受影响的知识卡，不重写整个知识库；
6. 更新 glossary 但保留 alias 来源计数和首末出现时间；
7. 生成变更报告：新增、修正、冲突、stale；
8. 运行知识检索评测与相关 DEF 黑盒场景；
9. 审阅通过后发布新 index version。

这比“把新转录附加到 YZ.md，再让模型重新总结所有内容”更稳定，也能避免旧知识被无意改写。

## 十、最小试点

建议仍以秋栗/安塔尔两篇火队攻略为试点，但这次验证的是蒸馏流程本身：

### 试点产物

- 两份 source manifest；
- 带时间戳的原始/归一化 transcript；
- 约 20~40 条 atomic claims；
- 一张“秋栗 vs 安塔尔”Decision Card；
- 两张冷启动 Rotation Graph；
- 公共莱万汀/狼卫机制 claims；
- 冲突和未确认词列表；
- 5~10 个知识检索/黑盒问题。

### 试点判定

- 任一建议可在两步内回溯到原视频时间戳；
- 数值和潜能条件无无证据发布；
- 相同公共规则不在两张卡重复存储；
- 能根据“对群/对单、潜能、启动状态”选择不同结论；
- Rotation Graph 可以转换为业务动作序列，但不包含硬编码 Workbench id；
- 新视频到来时只更新相关 claims/cards。

## 十一、目录建议

研究阶段可采用：

```text
game-knowledge/
  sources/
    yz-bvxxxx/
      source.yaml
      raw-transcript.jsonl
      normalized-transcript.jsonl
      notes.md
  claims/
    yz-bvxxxx.jsonl
  cards/
    decisions/
    rotations/
    builds/
  glossary/
    terms.json
  conflicts/
    open.json
  dist/
    knowledge-index.json
    knowledge-index.meta.json
  evaluations/
    retrieval-cases.json
```

现有 Markdown references 可以继续保留为人工阅读视图，但应由 claims/cards 生成或明确标记为 legacy narrative，不再作为唯一事实源。

## 十二、方案取舍

### 不推荐：纯摘要蒸馏

成本低，但丢失条件、来源和冲突，最终只能回答“博主大概怎么说”。

### 不推荐：让模型直接生成完整结构化卡

一次调用方便，但模型会跨段补全、合并相近规则，并把不确定表达平滑成确定结论，难以审计。

### 推荐：claim-first 双阶段蒸馏

成本略高，却能支持版本更新、冲突处理、可追溯回答、运行时核验和增量重建。对 DEF 这种还要把建议转成节点修改的 Agent，证据与条件比文本流畅度更重要。

## 最终建议

把“蒸馏完成”的定义从“生成了一篇结构清楚的攻略 Markdown”改为：

> 原始证据已冻结，关键陈述已原子化并带来源，实体与高风险数值已分级核验，决策与循环已结构化，冲突和版本未被隐藏，产物可以被受控检索并在 Workbench 上验证。

近期先不要批量重做全部 10 篇。用秋栗/安塔尔两篇建立 claim-first 模板和审阅成本基线；如果试点能稳定回溯、检索和转节点，再迁移其余资料并扩展更多博主。
