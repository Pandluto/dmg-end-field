# YZ 知识运行时接入与 Agent 提升深挖（2026-07-13）

## 研究结论

原始证据、claim-first 双阶段蒸馏、Rotation Graph 与质检发布方案见 [`research-yz-distillation-pipeline-20260713.md`](./research-yz-distillation-pipeline-20260713.md)。本文主要处理蒸馏产物如何进入产品运行时。

进一步审计表明，当前最大问题不是 YZ 蒸馏内容不够，而是**攻略正文尚未形成可证明的运行时消费链路**。

`game-knowledge` 已能被 OpenCode 发现，system prompt 也注入了 `src/data/gameKnowledge.json` 中的部分别名；但加载 skill 时，原生 `skill` tool 只返回 `SKILL.md` 正文和最多 10 个 reference 文件路径样本。Workbench 的 `read` 权限只允许 session 内的 `node/**`、context、README 和 AGENTS，且 `external_directory` 为 deny。攻略正文位于项目目录，不能据此认定模型可以读取。

因此当前真实能力更接近：

```text
模型知道存在 game-knowledge
  + 知道 10 篇攻略的大致标题
  + system prompt 中有部分结构化别名
  - 不一定能读取任何攻略正文
  - 11 个 reference 中至少 1 个可能不出现在 sampled file list
```

这意味着“已加入 10 篇 YZ 攻略”是内容资产结论，不是产品 Agent 能力结论。在修通知识正文的受控读取前，不宜开始大规模 prompt 调优或效果归因。

## 一、运行时证据链审计

### 1. skill 可以被发现

Adapter 将 `agent/runtime/def/skills` 配置为 OpenCode `skills.paths`。OpenCode 会扫描 `SKILL.md`，并把 name、description、location 组成 `available_skills` 提示模型按需调用 `skill`。

因此 `game-knowledge` 的名称和描述可以进入模型上下文，skill 触发基础存在。

### 2. skill 加载不等于 references 加载

OpenCode `SkillTool` 的输出包含：

- 完整 `SKILL.md` content；
- skill base directory；
- `ripgrep.find(..., limit: 10)` 得到的非 `SKILL.md` 文件路径样本。

它不会自动读取这些文件正文，也不会根据用户问题选择最相关文件。当前目录有 11 个 reference（10 篇攻略 + glossary），超过采样上限。文件排序又没有在 DEF 层定义，不能保证 glossary 或目标攻略一定出现在 file list。

### 3. Workbench 无法自然追读项目目录

Workbench permission 当前为：

- `read` 默认 deny；
- 只允许 session 内 `node/**`、`.def-workbench-context.json`、`README.md`、`AGENTS.md`；
- `external_directory` deny；
- 不允许 bash、webfetch、任意项目读取。

这些限制对节点安全是正确的，但也意味着 skill 返回绝对路径后，模型不能把“看到路径”当成“读到内容”。不能为了 YZ 直接放开整个 skillsRoot，否则会破坏 Spec 7 的最小权限边界。

### 4. system prompt 只有别名摘要

`buildGameKnowledgePromptLines()` 读取的是 `src/data/gameKnowledge.json`，目前仅把干员别名和装备套装别名展开进 Workbench system prompt。它没有加载攻略循环、场景判断、阵容替换或装备取舍。

这部分可以提高“42”“小羊”等词的识别，但无法支撑“照秋栗那套排一下”之类任务。

## 二、三种接入方案比较

### 方案 A：把全部攻略塞入 system prompt

不推荐。

优点是实现最简单、模型一定看得到；缺点是 1,917 行 reference 会永久占用每轮上下文，增加成本、稀释工具指令，并让版本更新和效果归因更加困难。与 Spec 7 后续研究的“缩短 system prompt”方向冲突。

### 方案 B：复制全部 references 到每个 session

可作为短期验证方案，不适合作为最终架构。

创建 session 时可将只读知识快照复制到 `knowledge/`，并在 read allowlist 增加该目录。它保持 session 隔离，也能迅速验证 YZ 正文是否带来效果。

主要问题：

- 每个 session 重复复制约 1,917 行资料；
- 旧 session 与新知识版本的关系不清晰；
- glob/grep/read 会把检索策略交给模型，结果不稳定；
- 若未来扩展多个博主，session 体积和候选噪声线性增长；
- 需要额外确保知识目录完全只读，且不能混入可执行文件或项目源码。

适用范围：只用于快速黑盒消融，证明“有正文”相对“只有 skill 摘要”的边际价值。

### 方案 C：受控 `def_knowledge_*` typed resource（推荐）

新增知识资源读取能力，但它属于现有 `def-data-resource` 工具族，不新增第四类工具。

最小工具面可以只有两把：

```text
def_knowledge_search(query, operators?, scenario?, version?, limit?)
def_knowledge_get(cardId, sections?)
```

`search` 返回小型候选卡片：id、标题、来源、版本、阵容、场景、摘要、匹配理由；`get` 只返回选中卡片的指定章节。工具内部只读取经过构建的知识索引，不接受文件路径，不暴露项目目录。

优势：

- 与 Workbench 文件权限完全隔离；
- 返回有界、可记录、可测试；
- 能明确知道 Agent 读了哪份资料；
- 可以按版本、角色、冷/热启动、对单/对群过滤；
- 多博主扩展时可以保留来源和冲突，不需要改 prompt；
- 适合 AI CLI 与 Workbench 共用，同时继续由 host tool allowlist 控制。

成本是需要建立知识卡 schema 和索引构建流程，但这正是让蒸馏资产产品化所需的确定性层。

## 三、推荐知识卡 schema

攻略 Markdown 可以继续作为人工可读源，构建时生成 JSON 索引。建议 schema：

```json
{
  "schemaVersion": 1,
  "id": "yz-laevatain-wulfgard-ardelia-qiuli-v1.2",
  "source": {
    "creator": "YZ",
    "contentType": "video-distillation",
    "title": "...",
    "publishedAt": null,
    "distilledAt": "2026-07-13"
  },
  "gameVersion": "1.2",
  "team": {
    "core": ["莱万汀", "狼卫", "艾尔黛拉"],
    "flex": ["秋栗"]
  },
  "tags": ["火队", "对群", "冷启动", "热启动", "进阶轴"],
  "requirements": ["狼卫潜能条件待正文核对"],
  "sections": {
    "summary": "...",
    "rotationCold": [],
    "rotationHot": [],
    "decisions": [],
    "substitutions": [],
    "equipmentAdvice": [],
    "risks": []
  },
  "confidence": "community-guide",
  "unresolvedTerms": []
}
```

关键不在字段数量，而在四个可判定信息：版本、适用条件、决策分支、替换边界。只有固定步骤没有条件，Agent 只能机械背轴，无法适配用户当前阵容。

## 四、知识检索不能只依赖向量相似度

现有资料规模很小，优先使用可解释的混合路由：

1. glossary 先把别名、谐音、ASR 错误归一化；
2. 精确匹配队伍成员、主 C、玩法标签和版本；
3. 再对标题、摘要和 sections 做文本召回；
4. 返回匹配理由与缺失条件；
5. 模型最多选择 1~2 张卡读取正文。

例如“42 火队，对群，没安塔尔”应优先命中秋栗版，因为 `莱万汀/42`、`火队`、`对群`、`秋栗` 是结构化条件；不能只因两篇标题都包含“传统火队”而随机选取。

当前仅 10 篇攻略，不需要先引入向量数据库。JSON 索引 + 归一化倒排即可满足可解释、可测试和低维护成本。资料规模明显扩大后再评估 embedding。

## 五、知识与节点修改的交接协议

知识工具只提供建议证据，不直接生成或写入节点 payload。推荐流程：

```text
def_workbench_context
  → def_knowledge_search
  → def_knowledge_get（最多 1~2 张）
  → def_data_* 核对官方资源和当前版本事实
  → 向用户解释适用条件，或进入 timeline-workbench mutation
  → def_node_fork → read/edit → def_node_sync_validate → diff/use
```

需要明确三类冲突处理：

1. **攻略 vs 实时数据**：typed resource 优先，指出攻略版本风险；
2. **攻略阵容 vs 当前选择**：不自动替换用户角色，先给替代策略或询问关键缺口；
3. **攻略轴 vs 当前格位**：节点 codec/validation 优先，不能为照搬攻略破坏当前轴不变量。

攻略中的自然语言动作也不能直接当成稳定节点坐标。比如“第二波狼卫连携后开大”需要结合当前 normalized timeline 转换为实际按钮与 slot，必要时询问，而不是把视频顺序号当 `nodeIndex`。

## 六、Agent 指南的进一步收敛

### system prompt

只增加一条路由原则即可：涉及玩法、配队、循环、养成或玩家术语时加载 `game-knowledge`；若需要正文，通过受控知识工具读取。不要把攻略目录和工具参数表写进 system prompt。

### `game-knowledge/SKILL.md`

从“直接 consult references 文件”改为：

- 何时调用 `def_knowledge_search/get`；
- 如何先归一化用户术语；
- 如何区分社区建议与运行时事实；
- 如何把建议交给 `timeline-workbench` 实施；
- 如何表达来源、版本与不确定性。

### `timeline-workbench/SKILL.md`

不复制攻略规则，只增加组合任务交接：知识建议必须先被解析成当前轴上的具体业务变化，再进入节点编辑；无法确定映射时询问最小业务问题。

### session `AGENTS.md`

保持不变或只加版本号。它不应承担知识检索教程。

## 七、最小可行验证切片

在正式实现知识索引前，建议先做一个很小的验证切片：

1. 只选“莱万汀 + 狼卫 + 小羊 + 秋栗/安塔尔”两篇高度相近资料；
2. 人工整理两张带条件和差异的攻略卡；
3. 用受控 stub 或只读 typed tool 暴露 search/get；
4. 不修改 system prompt 其他部分；
5. 按黑盒规则测试纯咨询、对比判断、建议并预览三类任务。

推荐自然语言用例：

- `42 火队第四个人带秋栗还是安塔尔`；
- `我主要打群怪，按更合适的那个给个思路`；
- `照这个思路把当前轴调一下，先看看`；
- `狼卫不是满潜还能这么排吗`；
- `三动火是三件什么`。

这一切片能同时验证：别名归一化、结构化条件路由、攻略差异判断、事实核对和节点交接，而不需要先处理全部 10 篇资料。

## 八、观测与判分

除了原黑盒记录，知识场景必须记录：

- `knowledgeIndexVersion`；
- search query 的归一化结果；
- 返回 card ids、匹配分与匹配理由；
- 实际读取的 sections；
- 使用的来源/游戏版本；
- 是否发生攻略与实时 tool 冲突，以及最终采用哪一方；
- 最终回答中的建议是否可追溯到读取卡片；
- 建议转节点修改时，哪些知识动作成功映射为当前按钮/slot。

关键失败类型：

- `skill-not-loaded`：需要知识但未加载；
- `reference-unreachable`：知道文件但无法读取；
- `wrong-card`：召回错误阵容/版本；
- `stale-advice-as-fact`：把社区旧建议当实时事实；
- `unsupported-synthesis`：回答包含卡片和 tools 都没有的结论；
- `knowledge-to-node-mismatch`：建议正确但节点实现错误；
- `over-retrieval`：读取过多无关资料导致成本和冲突增加。

## 九、优先级修正

基于本次运行时发现，前一份研究的实施顺序应调整为：

1. **P0：修通并审计知识正文的受控读取链路**；
2. **P0：建立 prompt/skill/reference/tool 的 turn 级可观测性**；
3. **P1：用两张火队攻略卡做最小黑盒消融**；
4. **P1：确认收益后再批量卡片化其余 8 篇**；
5. **P1：随后做 system prompt 与 timeline skill 去重**；
6. **P2：评估更多博主和更复杂检索技术**。

先去重 prompt 再修正文访问，可能得到“提示更干净但攻略仍不可用”的假改进；先扩充更多博主则只会增加不可消费的文件。

## 最终判断

YZ 蒸馏具有明确的产品价值，但当前实现还停留在“内容已入仓、skill 可发现”的阶段。真正能提升项目效果的关键工程点是：把攻略变成带版本和条件的受控知识资源，让 Agent 能按需读取、可观测地引用，并通过现有 timeline skill 与 typed tools 将建议安全映射到当前 Work Node。

最小正确方向不是开放项目文件读取，也不是把 1,917 行内容塞进 system prompt，而是把知识读取正式纳入 `def-data-resource`，用小型结构化索引建立可验证的检索与交接闭环。
