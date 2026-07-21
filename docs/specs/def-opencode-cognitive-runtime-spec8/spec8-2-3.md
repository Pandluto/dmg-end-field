# Spec 8-2-3：DEF 受控本地资料原生检索桥接

## 状态

待实施。本规格是 Spec 8-2 的第三批数据工具工作：把当前 local storage 中 schema 稳定的装备/武器资料，以 session-private、只读、可验证的 JSON artifact 交给 OpenCode 原生工具检索。

关联研究：[Research 8-2-3](./research8-2-3-native-retrieval-bridge.md)。

关联任务：[Task 8-2-3](./task8-2-3.md)。

## 一句话定调

**本轮不另造专用装备搜索器；让 Agent 在受控的、完整相关 JSON artifact 中使用 OpenCode 原生 `read` / `grep` 反复检索，同时保持 local storage、Work Node、审批和 mutation 边界不变。**

## 背景

现有 `def_data_equipment` 适合精确资源解析，却不能可靠处理“力量”“寒冷伤害”“某套装内继续比较”等多字段探索；其 current search index 也没有把 effect labels 纳入搜索字段。会话 `ad1f7576-2e7d-4d50-a513-1e978e82db0d` 因此在“力量”等组合自然语言中得到空结果，并促使 Agent 用无证据文字补全。

装备与武器库的 schema 是可控的 JSON，且这类资料通常需要模型做多轮、同一资料内的检索。用户指定先建设 native path：不是把完整资料直接注入 prompt，而是给 Agent 一个 session-local 的资料视图，让它自行调用已经具备的原生文件检索工具。

## 范围

### 本轮进入范围

1. 当前装备库和武器库的原子、只读、规范化资料投影。
2. native materialize tool：只负责按确定性规则创建 artifact，不做语义搜索、推荐或 mutation。
3. OpenCode native `read` / `grep` 对 session `retrieval/**` 的受控访问。
4. Harness 对 native materialize → manifest → 原生检索的明确路由和停止规则。
5. artifact revision/hash、TTL、清理、不可编辑、v1 trace 和只读后置条件。
6. 装备套装 full JSON、属性子串 minimal JSON、无确定性命中时领域 full fallback 的合同。
7. 聚焦自动测试和全新 native session 的黑盒验证。

### 明确不进入范围

- 新的专用 typed retrieval / recommendation tool；它在下一轮单独设计。
- ASR/拼音/别名/语义向量/全文排序的专用检索器。
- 3+1 组合器、属性评分器、自动配装推荐或伤害收益结论。
- 攻略全文 materialization；游戏攻略仍使用现有 allowlisted typed section reader。
- vendor OpenCode 改造、bash、外部目录访问、项目源码访问或 raw local storage 暴露。
- 任意装备/武器配置 mutation、审批协议或 Work Node checkout 语义变更。

## 架构

```text
                 ┌───────────────────────────────────────┐
                 │ current renderer local storage          │
                 │ equipment / weapon authoritative source │
                 └──────────────────┬────────────────────┘
                                    │ atomic snapshot
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│ native materialize bridge                                               │
│ deterministic entity/substring selection · whitelist projection · hash │
└──────────────────┬────────────────────────────────────────────────────┘
                   ▼
  session/retrieval/<artifactId>/
  ├── manifest.json
  ├── entity.full.json OR records.jsonl
  └── README.md
                   │
                   ▼
       OpenCode native read / grep
                   │
                   ▼
  read-only answer; future apply must re-enter existing exact typed flow
```

### Artifact 目录

artifact 路径是 native session directory 内的 `retrieval/<artifactId>/`，不属于 `node/**`，不能作为 Work Node source 或 generated payload 使用。

`manifest.json` 至少含：

```json
{
  "contract": "DefNativeCatalogArtifactV1",
  "artifactId": "opaque-session-local-id",
  "domain": "equipment",
  "selectionMode": "entity-full",
  "query": "潮涌套",
  "source": {
    "storageKey": "def.equipment-sheet.library.v1",
    "revision": "sha256:...",
    "capturedAt": 0
  },
  "files": [{"path": "entity.full.json", "sha256": "...", "records": 4}],
  "expiresAt": 0,
  "readOnly": true,
  "nativeAccessRoot": "retrieval/<artifactId>"
}
```

根目录、source key 与 revision 必须由 bridge 生成；模型不得自行填写或伪造。

### 资料投影

只保留装备/武器业务事实：stable id、名称、part/type、套装、fixed stat、effects、三件套效果、图标必要引用和可用 slot。不得保留 UI 草稿、选中状态、聊天、session、SQLite、Share Data、命令队列或未经请求的 local storage key。

`entity-full` 保持一个逻辑实体的完整业务 JSON。`substring-minimal` 每个 JSONL record 只保留身份、部位/类型、套装、可用 slot、命中的具体字段和值；不得把其余不相关对象夹带进来。

### 确定性选择规则

1. 先按 NFKC、空白/连接符清理和既有安全 alias 表识别 exact gear set、weapon 或 equipment；`潮涌套` 与 `潮涌` 归入同一个 set identity。
2. exact set 命中：输出该套全部规范化 JSON，不因额外属性词裁剪装备。
3. exact single entity 命中：输出该单件完整 JSON。
4. 其余输入按规范化子串匹配 id、name、part/type、gear set、fixed stat label/typeKey、effect label/typeKey；输出所有匹配的 minimal records 和每条 matched fields。
5. 无确定性命中时，只对请求 domain 输出 full fallback JSONL，manifest 标记 `domain-full-fallback`；不得把“未命中”解释为游戏不存在。

本轮不接受 LLM 自己提供的别名扩展、排序或规则推断；它们属于后续专用检索 runtime。

## 工具合同

新增仅供 native session 使用的 data materializer，例如：

```text
def_data_native_catalog_materialize({
  domain: "equipment" | "weapon",
  query: string
}) → DefNativeCatalogArtifactV1
```

它的职责是：

- 从当前权威同源库捕获一个快照；
- 使用上述确定性规则选择 full / minimal / fallback artifact；
- 先写临时文件、计算 hashes，再原子 rename；
- 把 artifact metadata、root、允许原生操作、revision、TTL 返回给 Agent；
- 发出可在 v1 trace 中审计的 tool record。

它不返回大段 catalog 作为 tool output，不替 Agent 调 `grep`，不做推荐，不改状态，也不通过 renderer command queue。

## 权限与 Harness

### 原生权限

- `read` 仅加入 `retrieval/**` 的只读许可；原有 `node/**` 许可保持语义不变。
- `grep` / `glob` 只能用于 session directory；`external_directory`、bash、edit/write 到 retrieval 仍拒绝。
- 因 upstream grep permission 当前按 pattern 而非 path 允许，实施前必须证明 session-root/external-directory guard 阻断 `../`、绝对项目路径和任意 raw storage；若不能证明，添加最小宿主侧 path guard，而不是开启外部目录或修改 vendor。
- artifact root 不得被加入 edit allowlist。

### Harness 路由

当用户询问装备/武器的筛选、比较、属性或套装资料时：

1. 调用 materializer 一次；
2. read `manifest.json`；
3. 在 `nativeAccessRoot` 内原生 `grep/read`；
4. 给出基于实际资料行的只读说明。

同一 domain + query 在同一 turn 不得反复 materialize；Agent 可以反复 native grep。没有资料证据时必须说明 artifact 的 scope/mode，而不是编造属性、收益或弃件理由。用户要求应用时，必须回到已有 exact typed candidate、审批和 postcondition 路径。

## 一致性与生命周期

- local storage 读取、canonical serialization 与 revision hash 在一次 materialization 内完成；源变化只能影响下一份 artifact。
- artifact 从不回写源；同 session 同 query 的 reuse 必须校验 revision/hash，过期或源 revision 改变则新建 artifact。
- artifact 在 native session 删除、TTL 到期或显式 session cleanup 时删除；cleanup 只能作用于该 session 的 `retrieval/**`。
- source 缺失、JSON 不合法、写入失败、hash 不匹配、路径不在 session root：全部 fail closed，返回结构化错误，不留下半成品目录。

## 验收标准

- [ ] `潮涌套` 生成 one set full artifact，完整含 4 件、两件配件、三件套效果和 stable ids，无其他套装。
- [ ] `力量` 生成所有匹配字段的 minimal records；自动 oracle 从同一 captured snapshot 计算 expected ids/fields。
- [ ] 装备与武器均有同构路径；不依赖 selected team 或 Work Node checkout。
- [ ] Agent 能在一份 artifact 内实际调用原生 `read/grep` 多次；v1 trace 记录 materialize、read、grep。
- [ ] 绝对路径、`../`、项目源码、raw local storage、Share Data、其他 session retrieval root 均拒绝。
- [ ] artifact 不可编辑；只读路径无 command queue、approval、checkout、Work Node 或 local storage 写入。
- [ ] 源 revision 改变后新 artifact hash/revision 改变；旧 artifact 不被静默当作 current。
- [ ] 全新 native session 按 Mac Desktop Interop Route 黑盒验证上述行为；失败 run 如实记录，不 promotion Harness。

## 后续移交

native bridge 验收通过后，下一轮才创建专用 retrieval runtime Spec：实体别名/ASR、结构化属性 query、攻略 metadata index、3+1 枚举与可解释排序。它可使用本轮的 canonical artifact schema，但不得要求 Agent 再去读取 raw storage。
