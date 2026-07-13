# YZ.md 合理加载与角色卡方案研究（2026-07-13）

## 用户倾向与研究范围

本轮以“做出角色卡”为优先方向，研究 `YZ.md` 应如何被拆分、索引和加载到 DEF Agent。

这里的“角色卡”定义为**角色中心的社区玩法知识卡**，不是替换 `public/data/characters/**` 中的官方角色数据，也不是用于角色扮演的人设 prompt。它回答的是：这个角色在玩家攻略里怎么定位、怎么操作、怎么配装、和谁搭配、在什么条件下选择不同方案。

角色卡如何成为面向玩家的完整产品入口、与 Workbench/Agent 形成闭环的产品形态研究见 [`research-product-form-character-cards-20260713.md`](./research-product-form-character-cards-20260713.md)。

## 结论

角色卡是合理的主入口，但不能成为唯一知识形态。

最合适的结构是：

```text
角色卡 = 图节点
队伍/阵容卡 = 多个角色之间的边
Rotation Card = 某个阵容在特定条件下的执行路径
Claim/Evidence = 所有结论的证据底座
```

运行时不直接加载完整 `YZ.md`。推荐三级加载：

1. 常驻极小术语索引；
2. 根据用户提及角色和当前 Workbench 选择，加载 1~4 张角色卡摘要；
3. 只有涉及阵容判断或实际排轴时，再读取匹配的 Team/Rotation Card 和必要 evidence。

这既符合“以角色为入口”的产品直觉，也避免把跨角色循环强行复制进每张角色卡。

## 一、为什么不直接加载 YZ.md

当前 `YZ.md` 约 80 KB、2,000 行左右，内容包括：

- `game-knowledge` skill 本身；
- glossary；
- 10 篇整理后的攻略；
- 多处重复的装备、潜能、冷却和配队规则。

直接放入 system prompt 或每轮上下文有四个问题：

1. **检索噪声**：用户只问莱万汀，却同时看到弭弗、卡缪等大量无关信息；
2. **注意力竞争**：工具规则、动态 checkout 和用户当前画布会被攻略长文稀释；
3. **重复冲突**：同一装备/冷却规则在多篇文章出现，模型可能随机采用某个版本；
4. **不可观测**：无法判断模型实际依据了哪篇、哪一段，也难做效果归因。

80 KB 在模型上下文容量上未必“放不下”，但“放得下”不等于“适合每轮加载”。即使 provider 支持 prompt cache，它只能降低重复传输/计算成本，不能消除注意力噪声与知识冲突。

因此 `YZ.md` 更适合作为迁移期内容包或人工阅读入口，不应成为运行时唯一事实源。

## 二、三种加载形式比较

| 形式 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| 整体加载 `YZ.md` | 实现最快，内容全 | 上下文重、冲突多、不可追踪 | 仅用于一次性离线蒸馏，不用于产品运行时 |
| 按视频/攻略文件加载 | 保留作者叙事和完整轴 | 用户通常先说角色，不知道视频标题；跨视频比较困难 | 作为 evidence/detail 层保留 |
| 按角色卡加载 | 符合用户入口，召回简单，能聚合多视频 | 容易复制跨角色知识，单卡无法表达完整队伍循环 | 作为主入口，配合 Team/Rotation Card |

推荐不是三选一，而是“角色卡入口 + 队伍卡关系 + 视频证据详情”。

## 三、角色卡应该存什么

角色卡只保存角色中心、跨队伍相对稳定的社区知识，以及指向其他卡片的关系。

### 推荐结构

```yaml
schemaVersion: 1
id: operator-community-laevatain
operator:
  id: 莱万汀的稳定 DEF id
  name: 莱万汀
aliases: [42, 四二, 史尔特尔, 蓝文汀]
communityRole:
  primary: 灼热主 C
  secondary: [熔火循环, 强化战技爆发]
  playstyleTags: [需要队友挂火, 冷热启动差异明显]
mechanicSummary:
  - statement: 通过吸收灼热附着积累熔火
    claims: [claim-id]
decisionRules:
  - when: 主要对群
    recommendation: 优先查看秋栗火队关系卡
    cardRefs: [team-card-id]
  - when: 主要对单
    recommendation: 优先查看安塔尔火队关系卡
    cardRefs: [team-card-id]
operationPatterns:
  - name: 强化战技爆发窗口
    summary: ...
    rotationRefs: [rotation-id]
buildPrinciples:
  - goal: 先满足当前循环的充能条件，再转输出
    buildRefs: [build-rule-id]
synergies:
  - operator: 狼卫
    relation: 提供灼热附着并参与连携循环
    teamRefs: [team-card-id]
substitutionBoundaries:
  corePartners: []
  flexiblePartners: []
risks:
  - 攻略版本与当前数据不一致时以 DEF typed resources 为准
sources: [source-id]
review:
  status: reviewed
  indexVersion: 1
```

### 角色卡应包含

- 玩家别名和 ASR 变体；
- 社区定位与操作手感标签；
- 角色自己的关键机制解释；
- 跨阵容仍成立的操作原则；
- 配装目标与选择原则，不复制完整装备表；
- 与其他角色的协同关系；
- 对应 Team/Rotation/Build Card 引用；
- 来源、版本覆盖范围与审阅状态。

### 角色卡不应包含

- 官方技能完整倍率表：已有角色数据与 typed resources；
- 每个阵容的完整步骤：应在 Rotation Card；
- 队友的详细配装：应在队友卡或 Team Build Card；
- Workbench button id、slot、nodeIndex：属于当前运行时；
- 未核验的精确数值作为稳定结论；
- 10 篇视频的拼接摘要。

## 四、角色卡不能替代队伍卡

攻略中最重要的知识往往是关系知识：

- 秋栗与安塔尔对莱万汀火队的不同价值；
- 洁尔佩塔与佩丽卡的连携冷却同步；
- 弭弗、陈千语、黎风、骏卫的四碎八猛循环；
- 狼卫潜能对具体火队轴的影响。

如果全部写进角色卡，会产生两个问题：

1. 同一条队伍规则在四张角色卡重复；
2. 更新循环时无法确定哪张卡是主版本。

因此 Team Card 表达角色之间的关系：

```yaml
id: team-laevatain-wulfgard-ardelia-qiuli
members:
  core: [莱万汀, 狼卫, 艾尔黛拉]
  flex: [秋栗]
bestFor: [对群, 快启动]
tradeoffs: [相对安塔尔方案的差异]
requirements: []
rotationRefs:
  cold: rotation-id
  hot: rotation-id
memberCardRefs: [...]
```

角色卡只写：“莱万汀在对群条件下可路由到这张 Team Card”。

## 五、加载策略

### L0：常驻 Terminology Router

始终只加载极小索引：

- alias → operator id；
- ASR correction candidates；
- 阵容俗语 → tag；
- 卡片目录的 id、标题、角色和标签。

它不包含攻略正文，目标是把“42、小羊、三动火、轮椅”等输入归一化并找到候选卡。

建议控制在数百行结构化数据以内，并通过 `def_knowledge_search` 而非继续展开进长 system prompt。

### L1：角色卡摘要

触发条件：

- 用户明确提到角色；
- 当前 Workbench 已选角色且问题明显涉及现有阵容；
- 用户使用的别名能唯一映射到角色。

默认最多加载：

- 纯角色咨询：1 张；
- 当前四人队伍判断：最多 4 张，但先返回摘要字段；
- 无关的已选角色不因“存在于画布”自动加载全文。

每张摘要建议控制在约 300~600 中文字，包含定位、关键机制、决策路由和引用 id，不包含完整 Rotation Graph。

### L2：Team/Decision Card

触发条件：

- 用户问配队、替换、对比、适用场景；
- 角色卡中的 decision rule 指向候选；
- 当前四人阵容与某张 Team Card 高度匹配。

一次返回 1~3 张候选摘要，必须包含匹配理由和缺失条件。模型选择最多 1~2 张读取详情。

### L3：Rotation/Build Detail

触发条件：

- 用户问具体循环、冷/热启动、操作顺序或装备阈值；
- 用户要求“照这个排一下”；
- Team Card 已确定。

只读取目标分支，例如 `rotationCold`，不返回同卡全部装备和背景说明。

### L4：Evidence

只在这些情况读取证据片段：

- 用户问“为什么/来源是什么”；
- 卡片冲突或版本不清；
- 高风险数值需要核验；
- 自动质检或研究评测。

普通回答不应把视频转录全文塞给模型。

## 六、根据用户请求决定加载量

| 用户请求 | 加载内容 |
| --- | --- |
| `42 是谁` | Terminology 结果，不读角色卡全文 |
| `42 怎么玩` | 莱万汀角色卡 |
| `42 配谁` | 莱万汀角色卡 + 2~3 个 Team Card 摘要 |
| `秋栗和安塔尔哪个好` | 两张角色卡摘要 + 对比 Decision Card |
| `42 狼卫小羊秋栗怎么排` | 4 张角色摘要可选；核心是匹配 Team Card + Rotation Card |
| `照这个轴改一下` | 当前 context + 已选 Rotation 分支 + timeline skill |
| `为什么要 211.76%` | 对应 Build Rule + 高风险 claim/evidence |

关键是按意图加载，不是检测到角色名后机械注入整张卡。

## 七、与现有官方角色 Markdown 的关系

`public/data/characters/莱万汀/莱万汀.md` 等文件保存基础信息、成长、天赋、潜能和技能倍率，属于数据/展示层。YZ 角色卡保存玩家攻略判断，属于社区知识层。

两者不能合并成同一个文件：

- 官方数据更新频率、来源和验证方式不同；
- 社区知识具有版本、作者、主观性和适用条件；
- Agent 查询时需要明确事实优先级；
- 合并后很难判断某一段是官方值还是博主建议。

建议通过稳定 operator id 关联：

```text
官方角色数据 ← operatorId → 社区角色卡
                         ↘ Team / Rotation / Build Cards
```

Agent 输出数值/技能事实先查 official typed resource；输出打法和选择建议再查社区角色卡。

## 八、YZ.md 的合理保留形式

### 推荐定位：源包索引，不参与直接加载

可以保留 `YZ.md` 作为人工入口，但应逐步改成目录型文档：

- 来源列表；
- 已蒸馏角色卡；
- 已蒸馏队伍/循环卡；
- 未解决术语和冲突；
- index version 与更新时间；
- 指向实际 cards/evidence 的链接。

不再把 skill、glossary 和所有攻略正文复制进同一文件。

### 迁移期快速方案

若暂时不实现 typed knowledge tools，可离线按一级标题切分 `YZ.md`：

1. skill/glossary 单独拆出；
2. 每篇攻略建立 source id；
3. 用简单脚本生成“角色 → 相关文章章节”索引；
4. session 只复制命中的 1~2 个只读片段；
5. 记录片段 hash 和来源标题。

它比全文加载合理，但只应作为角色卡正式构建前的验证桥梁。

## 九、角色卡生成方式

角色卡不建议直接从 `YZ.md` 全文一次生成。推荐：

```text
所有与角色相关的 atomic claims
  + 相关 Team/Rotation/Build refs
  + 官方 entity resolver 结果
  → 角色卡合成
```

合成规则：

1. 同一机制只引用公共 claim，不复制长解释；
2. 相互冲突的结论同时保留 conditions/conflicts；
3. 队伍特有规则只生成 cardRef；
4. 精确数值默认不进摘要，除非 runtime-verified；
5. 摘要强调“角色定位 + 如何判断”，不复述所有视频；
6. 每一条强结论必须有 claim ids；
7. 卡片生成后做反向覆盖检查：原 claims 中哪些未被使用，避免模型静默漏掉反例。

## 十、首批角色卡建议

从现有资料覆盖看，适合先做：

1. 莱万汀：两篇传统火队 + 卡缪火队，能验证对单/对群和多阵容路由；
2. 狼卫：跨多套火队出现，能验证公共机制与队伍特例分离；
3. 艾尔黛拉：别名“小羊”高频，能验证术语路由；
4. 秋栗、安塔尔：适合形成一张对比 Decision Card；
5. 弭弗：资料最多，可在模板稳定后验证复杂角色卡扩展性。

不建议先从弭弗开始做模板。弭弗横跨传统物理、混伤、生存、碎冰和多套配装，容易在第一版角色卡里塞入过多内容，掩盖边界问题。

## 十一、莱万汀角色卡最小试点

### 产物

- `operator-community-laevatain` 角色卡；
- `operator-community-wulfgard`、`ardelia` 的轻量关联卡；
- 秋栗/安塔尔对比 Decision Card；
- 秋栗版、安塔尔版两个 Team Card；
- 各自冷启动 Rotation Card；
- 指向原 source/claims 的证据链。

### 测试问题

- `42 怎么玩`；
- `42 打群怪第四个带谁`；
- `安塔尔和秋栗差在哪`；
- `狼卫没五潜还能用秋栗轴吗`；
- `我现在 42 狼卫小羊秋栗，给个冷启动思路`；
- `照这个思路在当前轴上排一下，先看看`。

### 成功标准

- 简单角色问题只加载 1 张角色卡；
- 对比问题能路由到 Decision Card，不拼接两篇全文；
- 排轴问题只加载目标 Rotation 分支；
- 官方事实和社区建议来源不混淆；
- 角色卡不复制完整队伍循环；
- 每个建议可追溯到 claim/source；
- 最终节点修改仍由 timeline skill 和 typed tools 完成。

## 十二、推荐目录

在上一份 claim-first 蒸馏目录基础上增加角色入口：

```text
game-knowledge/
  sources/
  claims/
  cards/
    operators/
      laevatain.yaml
      wulfgard.yaml
      ardelia.yaml
    teams/
    decisions/
    rotations/
    builds/
  glossary/
  dist/
    card-catalog.json
    operator-card-index.json
    knowledge-index.json
```

`operator-card-index.json` 只保存 operator/alias 到 card id 的路由；角色卡详情和 Rotation Graph 按需读取。

## 最终建议

采用角色卡是合理方向，但应把它定义为社区知识的“角色首页”，而不是把 `YZ.md` 按角色重新复制一遍。

最佳加载形态是：

> 术语索引常驻，角色卡按人加载，队伍卡按关系加载，Rotation/Build 按任务加载，原始视频证据只在核验时加载。

近期以莱万汀为第一张完整角色卡，以秋栗/安塔尔对比为第一条关系边。这个试点能同时验证角色入口、条件路由、跨卡引用、版本证据和向 Workbench 排轴的交接，而且复杂度低于直接从弭弗全资料开始。
