# Spec 7 专项预研究：`def-节点代码修改` 如何落实

## 一、研究结论

`def-节点代码修改` 不能只等于“把整个节点导出成 `working-payload.json`，允许模型随便 edit，再把 JSON 原样写回”。当前实现证明了 OpenCode 原生代码工具能够跑通，但仍缺少适合长期使用的代码工作区、双向 codec、只读边界、完整校验、语义 diff、并发保护和前端审查模型。

建议把第一类工具正式定义为一套“节点代码工作区协议”：

```text
Work Node repository truth
  → materialize codec
  → isolated node code workspace
  → native read / edit / apply_patch
  → rebuild codec
  → schema + invariant + resource validation
  → semantic diff + risk analysis
  → approval
  → atomic use
```

原生 `read/edit/apply_patch` 是编辑器；codec、validator、diff、risk、approval 和 use 才让这种自由编辑成为可靠的 DEF 节点修改能力。

## 二、当前已经实现了什么

当前实现路径如下：

1. `def_node_fork` 从当前 checkout 创建 SQLite Work Node；
2. session 工作目录生成 `.def-node.json`、`base-payload.json`、`working-payload.json` 和 `README.md`；
3. Workbench agent 获得 OpenCode 原生 `read/edit/apply_patch/glob/grep`；
4. 模型修改 `working-payload.json`；
5. `def_node_sync_validate` 将整个 JSON 送到 `def.worknode.sync_workspace`；
6. REST handler 替换 `node.workingPayload`，运行基础校验并计算 diff；
7. `def_node_use` 经过 permission/approval 后执行 checkout。

这一实现已验证模型可以完成跨字段排轴修改，而不是退回 Patch DSL。但它更接近原型协议，不宜直接作为 Spec 7 的最终代码工具模型。

## 三、当前实现的具体缺口

### 3.1 单个巨型 payload 不适合代码编辑

`TimelineSnapshotPayload` 同时包含：

- `selectedCharacters`；
- `timelineData`；
- `skillButtonTable`；
- `allBuffList`；
- `anomalyStateSnapshots`；
- `characterInputMap`；
- `characterComputedMap`；
- `characterDisplayCacheMap`；
- `operatorConfigPageCache`。

其中既有用户可编辑的业务事实，也有计算缓存、显示缓存和运行时快照。全部暴露在一个 JSON 中会带来三个问题：

1. 模型很难判断哪些字段应改、哪些应从其他事实重建；
2. 小型排轴操作会读取和重写大量无关数据；
3. 派生缓存可能被错误修改并伪装成真实业务输入。

### 3.2 同一业务事实存在重复镜像

一个技能按钮至少同时存在于：

- `timelineData.staffLines[].buttons[]`；
- `timelineData.staffLines[].occupiedNodes[]`；
- `skillButtonTable[id]`。

当前代码式修改要求模型自行同步这些镜像。此前“移动第一组第一个按钮”必须同时修改多个位置才能通过校验，这不是自由编辑应承担的偶然细节，而是 codec 应负责的派生关系。

同理，按钮 Buff 同时涉及 `skillButtonTable[].selectedBuff`、timeline button 的 `buffIds` 和 `allBuffList`。如果继续暴露原始存储结构，模型每次编辑都在手工维护数据库级不变量。

### 3.3 `base-payload.json` 还不是真正只读

当前 README 和 system prompt 声明 base immutable，但 OpenCode 原生 `edit/apply_patch` 对整个 session 目录开放。`base-payload.json` 与 working 文件位于同一可写目录，没有文件权限或工具权限层的拒绝规则。

这意味着“不可修改基线”目前主要依赖模型服从提示词。真正的证据基线必须由 repository 持有；工作区内即使提供 base 文件，也应是只读投影，sync/use 永远不得信任工作区回传的 base 内容。

### 3.4 校验覆盖不足

当前 validator 主要检查：

- 顶层数组/对象是否存在；
- timeline button 与 table button 是否互相存在；
- button 是否重复；
- staffIndex 是否一致；
- selected Buff 引用是否存在。

尚未充分覆盖：

- `occupiedNodes` 与实际按钮是否一致；
- `nodeIndex/nodeNumber/position` 的换算与边界；
- 同一 staff 的格位冲突；
- selectedCharacters 与 staffLines/按钮角色是否一致；
- timeline button 与 table button 的全部镜像字段；
- `buffIds` 与 `selectedBuff` 一致性；
- 技能 id、干员 id、Buff id 是否来自可信数据资源；
- 自定义 hit、异常、抗性、配置缓存之间的引用；
- 删除角色/按钮/Buff 后的悬空数据；
- payload schema/version 迁移；
- 业务计算是否能够重建并得到有限数值。

### 3.5 diff 只覆盖少数字段

当前语义 diff 重点比较按钮的角色、技能类型、显示名、staffIndex、nodeIndex、selected Buff，以及 Buff 的新增删除。大量变化可能不进入可读审查：

- position/nodeNumber；
- customHits；
- Buff 内部效果数值变化；
- operator/weapon/equipment 输入变化；
- anomaly、resistance 和计算输入变化；
- 缓存或无关大对象被整体替换。

如果 diff 没覆盖，approval 就没有足够证据，前端“节点变更”也会漏报。

### 3.6 风险分析可能使用旧状态

`sync_workspace` 替换 working payload 后沿用节点已有 `riskFlags`，再结合有限 diff 生成 checkout decision。代码式自由编辑产生的新风险不一定重新计算，例如批量删除、角色替换、可信资源引用变化或大范围缓存修改。

代码编辑每次 sync 都必须重新计算 risk，不能复用编辑前的风险标记。

### 3.7 缺少并发和陈旧基线保护

当前工作区同步基本是 last-write-wins：`.def-node.json` 记录 node id/session id，但没有要求携带 base hash、working revision 或 repository version。若同一节点被另一个会话修改，旧 session 仍可能覆盖新 working payload。

必须增加 optimistic concurrency：materialize 时记录 `nodeRevision/baseHash/workingHash`，sync 时进行 compare-and-swap。冲突时生成 rebase/重新 fork 建议，不能静默覆盖。

### 3.8 会话目录与节点目录没有清晰分层

当前 session 根目录同时放 agent 配置、OpenCode tool、节点绑定和 payload。一个 session 重新 bind 其他节点时会覆盖同名文件，历史文件与当前绑定关系不够直观。

需要显式 node workspace root，并保证一个活跃编辑上下文只绑定一个 node；切换节点应关闭旧 workspace 或创建新的 session/node workspace，不应悄悄覆盖。

## 四、建议的节点代码工作区

### 4.1 推荐文件结构

建议从“原始 payload 单文件”升级为“规范化可编辑源 + 只读投影 + 生成物”：

```text
session-root/
  .def-session.json                 # host/session/agent/profile，只读
  node/
    manifest.json                   # node id、parent、revision、base hash、schema version
    base/
      snapshot.json                 # repository 基线只读投影，仅供比较
    working/
      selection.json                # 已选干员及顺序
      timeline.json                 # staff 与按钮的规范化唯一事实
      buffs/
        <buff-id>.json              # 当前节点使用/定义的 Buff
      operator-inputs.json          # 真正可编辑的配置输入，若本轮允许
    context/
      resources.json                # 本轮已解析的可信资源引用，只读
      current-checkout.json          # 当前 checkout 摘要，只读
    generated/
      payload.json                  # codec 重建的完整 payload，不直接编辑
      validation.json               # 最近一次校验结果
      diff.json                     # 最近一次语义 diff
      risk.json                     # 最近一次风险分析
```

首轮不一定拆出所有文件，但必须确立三种文件角色：

- editable source：模型可以修改的规范化业务事实；
- read-only context/base：只能读取的证据和资源；
- generated output：由 codec 生成，不接受模型作为事实写回。

### 4.2 `timeline.json` 应消除重复事实

建议每个按钮只保留一次，例如：

```json
{
  "schemaVersion": 1,
  "staff": [
    {
      "characterId": "...",
      "characterName": "...",
      "buttons": [
        {
          "id": "...",
          "skillId": "...",
          "skillType": "E",
          "slot": 2,
          "buffIds": ["..."]
        }
      ]
    }
  ]
}
```

`occupiedNodes`、`nodeNumber`、坐标 position、skillButtonTable 和 timelineData 的存储镜像由 codec 统一生成。这样模型执行“移到第 3 格”只改 `slot: 2`，仍然是自由代码编辑，而不是调用移动按钮 DSL。

### 4.3 不应把全部派生缓存设为可编辑源

`characterComputedMap`、`characterDisplayCacheMap`、部分 `operatorConfigPageCache` 和运行时异常快照具有派生或缓存性质。研究建议：

- 可重建的缓存不进入 editable source；
- use 前由现有业务 service 重算；
- 确实属于用户输入的字段抽取到明确 input 文件；
- 无法重建且必须保真的字段由 codec 透传，但默认只读，除非后续有明确业务需求。

这不是限制自由编辑，而是区分“业务源代码”和“构建产物”。

## 五、双向 codec 的职责

### 5.1 materialize

从 repository node 生成工作区时：

1. 校验 node 与 base payload 本身可读；
2. 计算 base hash、working hash 和 node revision；
3. 将原始 payload 解码为规范化 editable source；
4. 提取只读 context 与资源引用；
5. 写入 manifest；
6. 原子写入临时目录后 rename，避免半成品工作区。

### 5.2 rebuild

sync 时：

1. 只读取 manifest 声明的 editable source；
2. JSON/JSONC 语法解析；
3. 根据规范化 source 重新生成所有重复镜像；
4. 将保留字段从 repository working/base 安全合并，而不是信任 generated 文件；
5. 运行 schema/invariant/resource/calculation validation；
6. 生成完整 payload、semantic diff 和 risk；
7. compare-and-swap 更新 repository working payload；
8. 刷新 generated reports，不触碰 checkout。

### 5.3 codec round-trip 要求

没有修改时必须满足：

```text
decode(payload) → encode(source) ≈ payload
```

允许差异只能是明确记录的规范化项，例如排序、缺省值补齐和派生缓存重算。任何未解释字段丢失都应阻止 use。

## 六、第一类工具的正式接口

第一类不需要为每个业务动作增加工具，但需要少量工作区级工具支撑原生编辑：

### 6.1 原生编辑工具

- `read`：读取 editable source、base/context 和 generated reports；
- `edit`：只允许修改 editable source；
- `apply_patch`：只允许修改 editable source；
- `glob/grep`：仅在当前 node workspace 内搜索。

这些工具在 registry 中归入 `def-node-code`，并由 host/session profile 决定是否暴露。

### 6.2 工作区协议工具

建议明确以下 canonical binding；它们仍属于第一类的工作区支撑，不替代自由编辑：

- `def_node_code_materialize`：从已 fork/bind 节点生成代码工作区；
- `def_node_code_status`：返回绑定节点、revision、dirty、最近校验与冲突状态；
- `def_node_code_rebuild`：从 editable source 重建 payload并校验；
- `def_node_code_rebase`：在明确冲突时把编辑迁移到新基线，首轮可只返回人工处理证据；
- `def_node_code_discard`：丢弃工作区未同步修改并从 repository 重新 materialize，必须确认。

fork/list/delete/diff/approval/use/restore 仍属于第二类 `def-node-crud`。数据搜索、解析和填表事实仍属于第三类 `def-data-resource`。

### 6.3 为什么需要 `rebuild` 而不是继续叫 `sync_validate`

当前 `sync_validate` 容易让人理解为“把整个 working JSON 原样覆盖到 repository”。新协议的关键是 codec 重建，因此 tool/result 应明确显示：

- 读取了哪些 editable files；
- 生成了哪个 schema version；
- 是否发生规范化；
- validation/diff/risk 结果；
- repository revision 是否更新；
- checkout 始终未触碰。

## 七、权限与隔离落实

### 7.1 允许范围

Workbench 的 native file tools 只允许访问当前 session 绑定的 node workspace。即使 session 根目录还有 `.opencode/tools` 或其他文件，也不应默认成为编辑范围。

### 7.2 写权限矩阵

| 路径 | read | edit/apply_patch |
| --- | --- | --- |
| `working/**` | 允许 | 允许 |
| `base/**` | 允许 | 拒绝 |
| `context/**` | 允许 | 拒绝 |
| `generated/**` | 允许 | 拒绝 |
| `manifest.json` | 允许 | 拒绝 |
| session 配置、plugin、其他 node | 拒绝或内部只读 | 拒绝 |
| 项目源码、用户目录、外网 | 拒绝 | 拒绝 |

该矩阵必须由实际 tool permission/path guard 实现，不能只写在 AGENTS.md 或 system prompt。

### 7.3 repository 仍是最终信任边界

即使工作区文件被外部程序修改，rebuild 也只接受：

- manifest 对应的 node/session；
- 未过期 revision；
- 可解析且通过完整校验的 editable source；
- 未越权引用的可信资源；
- 未修改的 repository base hash。

工作区文件本身不直接获得 checkout 权限。

## 八、校验、diff 与风险模型

### 8.1 分层校验

建议按顺序输出，不把所有错误混成一句字符串：

1. syntax：JSON/JSONC 可解析；
2. schema：字段类型、枚举和必需项；
3. invariant：格位、镜像、唯一性、引用完整性；
4. resource：干员/技能/Buff/装备 id 可解析；
5. calculation：可重建配置与伤害结果，无 NaN/Infinity；
6. policy：是否修改只读或禁止字段；
7. concurrency：revision/base hash 是否仍匹配。

每个 issue 至少包含 code、severity、editable file path、JSON pointer、用户可读说明和可选修复建议。

### 8.2 语义 diff

“节点变更”至少应展示：

- 干员选择和顺序；
- 按钮新增、删除、移动、换技能；
- Buff 绑定变化与 Buff 内容变化；
- 技能 hit/倍率输入变化；
- 武器装备与角色输入变化；
- 目标/抗性/异常相关变化；
- 无法归类的原始字段变化。

最后一项很重要：若 codec 仍出现未建模字段变化，必须在 raw fallback diff 中可见，不能静默漏掉。

### 8.3 每次 rebuild 重新计算风险

风险不能沿用 fork 时的旧 `riskFlags`。建议至少识别：

- 批量删除/移动；
- 角色替换；
- 大量按钮或 Buff 变化；
- 引用未知数据；
- 修改计算输入或自定义倍率；
- 与当前 checkout/HEAD 已分叉；
- 规范化过程中丢失未知字段；
- 校验虽通过但影响范围异常大。

## 九、与前端“节点变更”的联合

前端不应只显示原生文件 patch，也不应只显示后端摘要。建议同屏提供三层证据：

1. 用户层：例如“莱万汀 E 从第 1 格移动到第 3 格”；
2. 领域层：按钮/Buff/角色/伤害输入的 semantic diff；
3. 代码层：实际 editable source diff，可展开查看。

顶部状态应明确：

```text
当前节点 / 基线 revision / 工作区 dirty
校验通过或失败 / 风险等级 / 是否等待审批 / 是否已应用
```

permission 卡片继续负责 approval；“节点变更”提供审批证据。use 成功后标记 applied，但不删除工作区和历史 diff。

## 十、与数据资源工具的组合

数据资源工具返回可信 id 和有限结构，代码工具把这些引用写入 editable source。例如：

```text
用户：把长息加到第一组第一个按钮，先不要应用
  → def-data-resource 解析“长息”并返回可信 Buff id/摘要
  → def-node-crud fork 当前节点
  → def-node-code read timeline/buff source
  → native edit/apply_patch 写入可信 Buff 引用
  → code rebuild + validate + diff
  → 停在待审，不 use
```

数据资源工具不直接修改节点；代码工具也不凭空创造官方资源 id。用户明确创建自定义数据时，应通过相应数据资源/填表流程生成可追踪实体，再写入节点引用。

## 十一、失败与恢复路径

- syntax 失败：保留文件，返回精确行列，不更新 repository；
- validation 失败：保留工作区与报告，不更新可 use 状态；
- resource 失败：列出无法解析引用，不自动替换；
- revision 冲突：停止 sync，提供重新读取、rebase 或另 fork 选项；
- approval 拒绝：节点和文件保留，checkout 不变；
- use 失败：repository commit 与 renderer checkout 必须可区分，不能声称已应用；
- session 恢复：校验 node 是否存在、revision 是否匹配，失效时只读展示历史或重新 fork；
- discard：只丢弃工作区未同步修改，不删除 Work Node，除非另走第二类 delete。

## 十二、分阶段落地建议

### 第一阶段：补齐当前单文件协议的安全性

- 真正禁止修改 base/manifest；
- 增加 node revision/base hash/working hash；
- sync 时重新计算完整 diff/risk；
- 扩充 invariant/resource validation；
- 前端明确显示当前 node、dirty、validation 与 applied 状态；
- Workbench 强制使用 `def-workbench` 并识别排轴意图。

### 第二阶段：引入规范化 editable source 与 codec

- 从巨型 payload 中抽出 selection、timeline、Buff、可编辑配置输入；
- 自动生成 skillButtonTable、occupiedNodes、position 等镜像；
- 缓存与运行时快照转为 generated/read-only；
- 建立 round-trip 和未知字段保真检查。

### 第三阶段：完善 review 与冲突处理

- 原生 Changes 改造成三层“节点变更”；
- 增加 revision conflict/rebase；
- session/Work Node/checkout 历史联合恢复；
- 对代码编辑、数据资源引用和 use 做完整黑盒验收。

## 十三、专项验收建议

1. 只改 `timeline.json` 中一个按钮的 slot，codec 自动同步所有存储镜像并通过校验；
2. 跨组移动、批量调整和组合 Buff 修改不需要专用按钮级 tool；
3. 修改 `base/**`、`generated/**`、manifest、项目源码或其他 session 被真实权限拒绝；
4. 删除 Buff 后留下引用会被 validator 精确定位；
5. 修改 Buff 内部效果会出现在 semantic diff，而不是只显示 Buff 数量不变；
6. 两个 session 同时编辑同一 node 时，旧 revision sync 被拒绝；
7. 数据资源解析得到的可信 id 可以通过代码编辑写入并验证；伪造 id 被拒绝；
8. approval 前 current checkout 不变，拒绝后仍不变；
9. use 成功后 repository commit、renderer checkout 和前端 applied 状态一致；
10. 未建模字段在 round-trip 中不丢失，若无法保真则阻止 use；
11. Workbench 对“排轴”自然进入代码式节点修改，而 `/AI CLI` 不继承该节点；
12. 用户可从“节点变更”同时看懂业务变化、领域 diff 和代码 diff。

