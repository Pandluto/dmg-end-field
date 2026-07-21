# Task 8-2-3：物化受控资料并启用 OpenCode 原生检索

## 状态

待实施。按 [Spec 8-2-3](./spec8-2-3.md) 完成装备/武器资料的 native retrieval bridge。本任务不实现专用 typed retrieval runtime、ASR/别名引擎或自动配装。

## 目标

让 DEF OpenCode 在一个 native session 内，能够先把当前 local storage 的完整相关装备/武器 JSON 安全物化到 `retrieval/**`，再自行用 OpenCode 原生 `read` / `grep` 做多轮检索；全过程保持只读、可追踪、不可越界。

## Task A：冻结当前边界与基线

- [ ] 记录当前 data source：装备库 key、draft fallback、武器库 key、session directory 和 native permission config。
- [ ] 记录当前 `def_data_equipment` 的名称/属性索引缺口，但不在本任务内改造成专用搜索器。
- [ ] 记录 current native agent 的 `read`、`grep`、`glob`、`edit`、`external_directory` 权限及 session-root guard。
- [ ] 准备最小 fixture：一个含两件配件的潮涌类套装、跨多个套装的“力量”匹配记录，以及至少一件武器。
- [ ] 保护现有 `data/sharedata` 用户改动，不修改 vendor OpenCode。

## Task B：定义 canonical artifact schema

- [ ] 定义 `DefNativeCatalogArtifactV1`、manifest、selection mode、file manifest、source revision/hash、TTL 和 structured error schema。
- [ ] 定义 equipment full projection：完整 gear set / exact item 的必要业务字段。
- [ ] 定义 substring minimal JSONL record：id、name、domain、part/type、gear set、slots、相关 fixedStat/effects、matchedFields。
- [ ] 定义 weapon 的同构 projection，不复制 UI/session 草稿字段。
- [ ] 为 projection 写 stable canonical serializer，避免对象键序改变造成错误 revision。
- [ ] 明确 artifact 文件为 immutable：不含任何 edit capability，不能成为 Work Node input/generated truth。

## Task C：服务端 snapshot 与确定性选择

- [ ] 在同一读取边界内捕获当前 local storage source、序列化并计算 revision/hash。
- [ ] 实现 exact set / exact entity / substring minimal / domain full fallback 四种 selection mode。
- [ ] `潮涌套`/`潮涌` 识别为同一套装；返回完整套装，不因额外属性词丢失其余件。
- [ ] 属性关键词对 id、name、part/type、set、fixedStat、effect label/typeKey 做规范化子串匹配；返回所有匹配及 matchedFields。
- [ ] 无匹配时输出当前请求 domain 的完整 fallback，不伪造“没有游戏资料”。
- [ ] source 缺失、格式非法或无法生成 stable artifact 时返回 fail-closed structured error。

## Task D：native materialize tool 与原子文件生命周期

- [ ] 增加 `def_data_native_catalog_materialize(domain, query)` 的 native session exposure；它只负责 materialize，不替 Agent 搜索或推荐。
- [ ] 将 artifact 写进调用 session 的 `retrieval/<artifactId>/`，绝不写入项目、raw storage、node/working、node/generated 或 Share Data。
- [ ] 临时文件 + hash + manifest 成功后再原子 rename；失败清理半成品。
- [ ] 返回 artifact root、manifest path、source revision/hash、selection mode、文件 hashes、TTL 和允许原生操作。
- [ ] 支持相同 session/source revision 的安全 reuse；revision 或 TTL 改变后创建新 artifact。
- [ ] 在 session cleanup 删除该 session retrieval artifacts；不得删除其他 session 目录。

## Task E：原生权限与 Harness 接入

- [ ] 让 agent 对 `retrieval/**` 有 read 权限，仍无 edit/write 权限。
- [ ] 验证原生 grep/read 保持在 session root；外部目录守卫拒绝 `../`、绝对源码目录、raw local storage、Share Data 和其他 session。
- [ ] 如果 upstream permission 不能表达 artifact path scope，在 DEF host 增加最小 path guard；不改 vendor、不开放 bash、不允许 external_directory。
- [ ] 更新 workbench Harness：装备/武器探索先 materialize 一次、read manifest、再 native grep/read；相同 domain/query 不重复 materialize。
- [ ] 更新提示词例外：retrieval artifact 是唯一允许的非 Work Node native 资料目录；禁止 glob/grep runtime Skill、项目或任意 local data。
- [ ] 明确 native artifact 是只读推荐证据，申请配置仍回到 existing exact typed candidate + approval/postcondition。

## Task F：聚焦验证

- [ ] 单元/合同：full set artifact 含完整 4 件及两配件；无其他套装泄漏。
- [ ] 单元/合同：`力量` expected ids/fields 与同一 snapshot 的 oracle 完全一致；empty query 不产生意外全库泄漏，只有明确 fallback 才允许 full domain。
- [ ] 单元/合同：weapon domain、hash/key-order stability、source revision change、TTL/reuse、partial-write cleanup。
- [ ] 安全合同：artifact edit 拒绝；外部路径、其他 session、raw storage、project、Share Data 拒绝；无 mutation/queue/approval/checkout/node 变化。
- [ ] v1/Interop：记录 materialize、native manifest read、至少两次 native grep/read、最终只读回答；失败工具如实标记。
- [ ] 全新 native session 按 `docs/testing/def-agent-blackbox.md` 的 Mac Desktop Interop Route 回归：潮涌完整集、力量子串集、武器集和 fallback。
- [ ] 跑与改动成比例的聚焦检查、`npm run interop:check`、`npm run harness:check`（适用时）和 `git diff --check`。

## 完成条件

- [ ] 所有 Spec 8-2-3 验收项有代码或黑盒证据。
- [ ] 不把 package check、工具注册或截图伪装成 native retrieval 行为通过。
- [ ] 不 promotion Harness；如需要新增 candidate，保持 immutable 并由人工决定 promotion。
- [ ] 更新 `verification8-2-3.md`，分别记录合同、v1、Mac UI 与已知局限。
- [ ] 完成后自动提交，不 push。
