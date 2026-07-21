# Research 8-2-3：受控本地资料到 OpenCode 原生检索的桥接

## 结论

本轮建立的不是第二个“专用搜索工具”，而是一条可控的 **native retrieval bridge**：服务端从当前权威 local storage 原子读取装备或武器库，按确定性规则物化为 session-private 的只读 JSON 资料；随后由 OpenCode 自己反复调用原生 `read` / `grep` 检索。

专用 typed retrieval（实体别名、ASR、语义排序、属性过滤、组合评分）留到下一轮。它将来与 native 路径并列，不反向替代本轮 bridge。

## 已有能力与缺口

| 项目 | 现状 | 对本轮的含义 |
| --- | --- | --- |
| 装备/武器事实源 | `scripts/ai-cli-rest-server.mjs` 从当前 local storage 读取装备和武器库 | 可作为 bridge 的唯一源，不读取分享数据或项目资料 |
| 当前 typed equipment search | 对名称/id/部位/套装做整句 exact/substring/fuzzy；effect labels 不参与搜索索引 | 不能承担“力量”等多字段全文检索，也不应在本轮继续扩展成专用搜索器 |
| OpenCode 原生工具 | Agent permission 下 `read`、`grep`、`glob` 已为 node-code agent 开启；`bash`、`external_directory` 均拒绝 | 可以让 Agent 在自己的 session 目录反复查 JSON；必须限制新资料目录，禁止通向真实 local storage |
| Native file boundary | 当前 agent 只显式允许读取 `node/**`；`grep` 是全局 allow，但离开 session directory 会命中 `external_directory=deny` | bridge 必须额外允许且仅物化到 session 内的 `retrieval/**`；不改变编辑或外部目录权限 |
| Work Node 资料 | `node/generated/**` 是 Work Node 派生文件 | bridge 不得借用该目录，避免把只读游戏资料与节点真相混淆 |

## 用户指定的双模式路线

```text
R0 / 本轮：Native retrieval bridge
  当前 local storage → session/retrieval artifact → OpenCode 原生 read/grep

R1 / 下一轮：专用 typed retrieval runtime
  实体/ASR/别名解析 + 结构化属性过滤 + 组合器 + 可解释排序
```

R0 的职责是给 Agent 完整、可反复搜索的真实资料，不替模型做推荐。R1 的职责才是高召回实体理解与可验证推理。两者最终可以由一个 router 选择，但本轮不能假装已完成 R1。

## Artifact 选择规则

“完整”指完整的**相关逻辑集合**，不是截断的搜索结果，也不是把浏览器所有 local storage 的 UI 缓存暴露给模型。

| 用户初始检索意图 | artifact mode | 内容 |
| --- | --- | --- |
| `潮涌套` / 精确套装 | `entity-full` | 潮涌套的完整原始规范化 JSON：全部装备、效果、三件套效果和 stable id；不带其他套装 |
| 精确单件/武器 | `entity-full` | 该实体完整规范化 JSON |
| `力量` / `寒冷` / `配件` 等关键词 | `substring-minimal` | 所有包含该规范化子串的最小装备/武器 JSON 行；每条带 id、名称、套装、部位、可用槽位、匹配字段、相关 fixedStat/effects |
| 无法由确定性子串选中的模糊词 | `domain-full-fallback` | 当前领域全库完整 JSONL，交由原生 `grep` 多轮探索；manifest 必须明确该 fallback |

精确套装优先于属性关键词。例如“潮涌 力量”先给完整潮涌 JSON；模型在同一个资料文件内继续 grep `力量`，不能只拿一条被服务端预筛过的潮涌装备。

## 安全与正确性模型

```text
renderer local storage (current revision)
  → server: whitelist projection + canonical serialization + hash
  → native materialize tool: atomic write into session/retrieval/<artifactId>/
  → OpenCode read/grep only inside that directory
  → read-only recommendation / existing exact typed validation before any future mutation
```

- 物化不是浏览器导出，不写 local storage、SQLite、Work Node 或 Share Data。
- 每份 artifact 有 `artifactId`、domain、source revision、SHA-256、创建时间、TTL、record count、selection mode 和来源键；内容写临时文件后原子 rename。
- artifact 不可编辑。Agent 的 `edit` 始终只可写 `node/working/**`，不能写 `retrieval/**`。
- 每份 artifact 属于单一 OpenCode native session；重建同一 domain 时创建新 revision artifact，旧 artifact 只读并在 session cleanup/TTL 时删除。
- 原生 grep 的结果只是阅读证据。若后续要应用装备，仍必须走现有 exact candidate / approval / postcondition 链路；本轮不得把 grep 命中直接升级为 mutation authority。

## 原生工具调用协议

1. Harness 判断本轮是装备或武器的探索/推荐请求，先调用 `def_data_native_catalog_materialize` 一次。
2. 工具返回唯一 artifact root、manifest path、允许的原生操作和当前 revision；Agent 必须先 read manifest。
3. Agent 可在 artifact root 内重复 `grep` 和 `read`，例如搜索属性、部位、套装效果或 stable id；不得通过同义词重复 materialize。
4. 资料不足时，回答“当前 artifact 未提供”或重建一个不同 domain 的 artifact；不得把无命中解释为游戏中不存在。
5. 用户要求应用时，native artifact 只能帮助选择，后续仍重新取得 exact trusted candidate 并走既有审批链路。

这是一条显式可观测的推理过程：每次资料物化和每次原生检索都应出现在 v1 trace 中；不要求暴露模型的隐藏思维链。

## 本轮不解决的问题

- 拼音、别名、ASR 错词的高质量实体解析；R0 仅保留现有确定性规范化与 fallback，R1 再建设 lexicon/alias index。
- “力量/意志/寒冷伤害”对某个干员的最佳权重、主副属性推荐或伤害收益排序。
- 3+1 的完整组合器与自动推荐。artifact 应保留双配件事实，组合与排序属于下一轮专用 runtime。
- 全量攻略 section 的 native materialization。R0 先覆盖装备/武器，因为其 JSON schema 稳定、用户明确需要反复搜索；攻略仍沿用 allowlisted typed section 边界。
- vendor OpenCode 改造、bash、外部目录、原始 local storage 或项目文件访问。

## 成功与失败判定

成功不是“模型最后答对了一次”，而是：

- `潮涌套` artifact 可完整读到四件物品及两件配件；
- `力量` artifact 包含当前库中所有字符串匹配的最小 records，漏项/多项有自动断言；
- Agent 原生 `grep/read` 的 path 仅在 session retrieval root；
- local storage 更新后，新 artifact 具有不同 revision/hash；
- 无写入、无 approval、无 checkout/Work Node 变化；
- v1 能同时记录 materialization 和 native calls。

如果原生工具由于权限模型不能精确限制到 artifact root，必须记录为 blocker 并选择最小 adapter guard；不能为了“能 grep”开放 project、外部目录或 raw storage。
