# review-todo0.6.1

## \[任务理解]

- 本轮不是继续补丁式修 `sandboxSkills`，而是把 **官方角色** 和 **本地角色** 统一到一套“运行时模板层”。
- 目标不是替换真相源。官方真相源仍是 `public/data/characters/*.json`，本地真相源仍是 `localStorage['def.operator-editor.library.v1']`。
- 当前主问题不是 UI 样式，而是 **软件层同时吃两套模型**：
  - 官方角色：`Character.skills.normalAttack/skill/chainSkill/ultimate`
  - 本地角色：`OperatorDraft.skills[skillKey]`
- 要落地的不是空泛“适配层”，而是复用 `/draft` 页面已经存在的模板结构与归一化逻辑，抽出公共 TS，并在 `sessionStorage` 增加一张 **运行时模板表**。

***

## \[当前代码事实]

### 1. 编辑器模板真相目前只活在 `OperatorDraftPage.tsx`

文件：[src/components/OperatorDraftPage.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/OperatorDraftPage.tsx)

当前事实：

- `OperatorDraft`、`SkillDraft`、`HitMetaDraft` 类型都定义在这个页面文件里，**没有抽出公共 TS**。
- 关键函数都在页面内部：
  - `createDefaultDraft()`
  - `createDefaultSkill()`
  - `createDefaultHit()`
  - `normalizeDraft()`
  - `parseImportedDraft()`
  - `buildOrderedDraft()`
- `/draft` 页已经支持三种输入源：
  - `loadReferenceOperatorDraft()`：参考官方角色导入
  - `def.operator-editor.library.v1`：本地角色导入
  - 粘贴 JSON：`parseImportedDraft()`

当前问题：

- 主应用完全无法复用这套逻辑。
- 这导致“编辑器模板”和“主应用运行时模型”各玩各的。

结论：

- **主修复点 1** 必须是：把模板归一化与导入逻辑从 `OperatorDraftPage.tsx` 抽离出去。

***

### 2. 官方角色当前仍是旧 `Character` 四槽模型

文件：[src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx)

当前事实：

- `loadCharacters()` 读取：
  - `/data/characters/operators-list.json`
  - `/data/characters/<name>/<name>.json`
- 加载后直接注入：
  - `id = character.name`
  - `avatarUrl`
  - `skillIconMap`
  - `librarySource = 'official'`
  - `sandboxSkills = buildOfficialSandboxSkills(character)`
- `buildOfficialSandboxSkills()` 只是把旧四槽技能转成：
  - `id`
  - `displayName`
  - `buttonType`
  - `iconUrl`
  - `hitCount`

当前问题：

- 官方角色没有进入统一模板结构，只是被“补了一个 `sandboxSkills` 字段”。
- 这意味着沙盒层虽然能用，后续伤害详情、技能身份、更多字段仍然不统一。

结论：

- **主修复点 2** 必须是：新增 `fromOfficialCharacter -> RuntimeOperatorTemplate`。

***

### 3. 本地角色当前通过 `localOperatorAdapter.ts` 被压成 `Character`

文件：[src/core/services/localOperatorAdapter.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/localOperatorAdapter.ts)

当前事实：

- 本地角色读取自：
  - `localStorage['def.operator-editor.library.v1']`
- `ImportedOperatorDraft` / `ImportedSkillDraft` 类型在这里又定义了一遍。
- `adaptImportedDraftToCharacter()` 做了两件事：
  1. 生成旧 `Character.skills.normalAttack/skill/chainSkill/ultimate`
  2. 生成 `sandboxSkills`

关键问题：

- 本地角色虽然保留了 `sandboxSkills` 的完整多技能信息，但仍然被包成旧 `Character`。
- 这导致它只能“看起来接上沙盒”，实际上还是被压到旧 `Character` 壳子里。
- `ImportedOperatorDraft` 与 `/draft` 页里的 `OperatorDraft` 结构重复定义，存在长期漂移风险。

结论：

- **主修复点 3** 必须是：`localOperatorAdapter.ts` 不能再自己维护一套平行 draft 类型。
- 它应该改成消费公共模板适配器。

***

### 4. 沙盒层现在是“统一入口，非统一真相”

文件：[src/components/CanvasBoard/SkillSandbox.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillSandbox.tsx)

当前事实：

- `SkillSandbox` 现在消费 `Character[] selectedCharacters`
- 它内部取技能来源的逻辑是：
  - 若 `character.sandboxSkills` 存在，则用之
  - 否则回退 `A/B/E/Q`
- 当前确实已经支持：
  - 官方四技能分页/显示
  - 本地多技能分页/显示

当前问题：

- `SkillSandbox` 还是依赖 `Character`
- `sandboxSkills` 只是挂在 `Character` 上的派生补丁
- 这说明“UI 统一了，数据模型没有统一”

结论：

- **主修复点 4** 不是再改沙盒样式，而是让沙盒未来直接吃 `RuntimeOperatorTemplate`。

***

### 5. 画布运行时按钮已经开始携带“统一技能身份”

文件：

- [src/types/index.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/index.ts)
- [src/components/CanvasBoard/hooks/useCanvasDrag.ts](/C:/Users/zsk86/Desktop\dmg\dmg-end-field/src/components/CanvasBoard/hooks/useCanvasDrag.ts)
- [src/core/services/timelineService.ts](/C:/Users/zsk86/Desktop\dmg\dmg-end-field/src/core/services/timelineService.ts)

当前事实：

- `SkillButton` 已新增：
  - `runtimeSkillId`
  - `skillDisplayName`
  - `customHits`
- `SkillButtonData` 已新增同名字段
- `PersistedSkillButton` 已新增同名字段
- `useCanvasDrag` 拖拽时会把 `sandboxSkill` 的身份带到运行时按钮
- `timelineService.addSkillButton()` 也会把这些字段写入 `def.skill-button.v1`

这是当前项目里最接近统一模板层的部分。

结论：

- 后面的统一模板层，必须与这条“运行时按钮身份字段”对齐，不能另起一套命名。

***

### 6. 伤害详情仍然强依赖官方四槽 JSON

文件：[src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop\dmg\dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)

当前事实：

- 伤害详情读取路径仍是：
  - `fetch(/data/characters/${characterName}/${characterName}max.json)`
- 然后用：
  - `skillType -> normalAttack/skill/chainSkill/ultimate`
- 计算器吃的也是：
  - `skillType`
  - `damage`
  - `panelData`
  - `buffList`

当前问题：

- 本地角色多技能/多 hit 的按钮，即便能拖进去、能保存恢复，详情也不是统一模板链。
- 这意味着“统一模板层”如果不落地到这里，官方/本地仍不是同一套软件链路。

结论：

- **主修复点 5** 不是立即重写伤害公式，而是先让 `SkillButton.tsx` 能从统一模板表取技能详情，而不是只认 `max.json`。

***

## \[当前结论]

### 结论 1：方向正确，但必须分阶段

正确方向：

1. 抽公共模板适配器
2. 新建运行时模板表
3. 官方和本地都产出同型模板
4. 先让沙盒/恢复/按钮读取这张模板表
5. 最后再切伤害详情

错误方向：

- 直接把官方角色写进 `def.operator-editor.library.v1`
- 让 `loadedCharacters` 变成官方+本地混合总表
- 直接把 `OperatorDraft` 作为全软件唯一类型，不区分编辑层和运行时层

***

### 结论 2：这次必须新增“运行时模板表”，但它不是新的真相源

推荐新 key：

- `def.operator-runtime.template-map.v1`

推荐存储位置：

- `sessionStorage`

原因：

- 官方角色来自静态 JSON，每次刷新可重建，不应写死到本地长期存储
- 本地角色来自 `def.operator-editor.library.v1`，才是持久真相
- 运行时模板表只是“官方 + 本地 -> 软件统一模板”的会话级派生缓存

***

## \[必须改]

### 1. 新建公共模板类型与适配器模块

建议文件：

- `src/core/templates/operatorTemplate.ts`
- `src/core/services/operatorTemplateAdapter.ts`

必须落实内容：

#### 1.1 `operatorTemplate.ts`

定义最少一组公共类型：

```ts
export interface RuntimeOperatorTemplateHit {
  key: string;
  displayName: string;
  multiplier: number;
  element: ElementType;
  skillType: SkillType;
}

export interface RuntimeOperatorTemplateSkill {
  id: string;
  displayName: string;
  buttonType: SkillType;
  iconUrl?: string;
  hitCount: number;
  hits: RuntimeOperatorTemplateHit[];
}

export interface RuntimeOperatorTemplate {
  id: string;
  name: string;
  avatarUrl?: string;
  rarity: number;
  profession: string;
  weapon: string;
  element: ElementType;
  mainStat: AbilityType | '';
  subStat: AbilityType | '';
  level: number;
  attributes: {
    strength: number;
    agility: number;
    intelligence: number;
    will: number;
    atk: number;
    hp: number;
  };
  source: 'official' | 'local';
  skills: RuntimeOperatorTemplateSkill[];
}
```

要求：

- 这个类型不能再依赖旧 `Character.skills.normalAttack/skill/chainSkill/ultimate`
- 也不能直接用页面内的 `OperatorDraft` 类型

#### 1.2 `operatorTemplateAdapter.ts`

至少抽出这几类函数：

- `normalizeOperatorDraft(draft)`
- `parseOperatorDraft(rawText)`
- `buildRuntimeOperatorTemplateFromDraft(draft)`
- `buildRuntimeOperatorTemplateFromOfficialCharacter(character)`

要求：

- `/draft` 页的 `normalizeDraft()`、`parseImportedDraft()` 必须迁出并复用
- `localOperatorAdapter.ts` 不允许继续维护平行 draft 类型

***

### 2. `/draft` 页改为消费公共模板适配器

文件：[src/components/OperatorDraftPage.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/OperatorDraftPage.tsx)

当前问题：

- 模板归一化逻辑封在页面组件内部，主应用无法共享

修正要求：

- 页面内删除自维护的：
  - `normalizeDraft()`
  - `parseImportedDraft()`
- 改为 import 公共适配器函数
- `OperatorDraftPage` 仍保留 UI 专属逻辑：
  - `selectedSkillKey`
  - `selectedHitKey`
  - `skillOrder`
  - drag/drop 排序

不要动：

- `/draft` 的布局
- `/draft` 的保存到本地流程
- `/draft` 的 JSON 文本导入入口

***

### 3. `localOperatorAdapter.ts` 改为复用公共模板适配器

文件：[src/core/services/localOperatorAdapter.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/localOperatorAdapter.ts)

当前问题：

- 这里重复定义 `ImportedOperatorDraft`
- 重复实现了从 draft 到 runtime 的一部分逻辑

修正要求：

- 删除本地重复的 draft 结构定义
- 直接读取 `def.operator-editor.library.v1`
- 解析成公共 `OperatorDraft`
- 通过公共适配器生成：
  - `RuntimeOperatorTemplate`
  - 旧 `Character` 兼容视图（如果当前某些 UI 还依赖 `Character`）

建议拆分职责：

- `loadLocalOperatorDraftMap()`
- `loadLocalOperatorTemplates()`
- `adaptRuntimeTemplateToLegacyCharacter(template)` 仅作为过渡兼容

注意：

- `adaptImportedDraftToCharacter()` 当前是过渡函数，不是最终真相函数
- 后续要逐步弱化，而不是继续堆字段

***

### 4. 新增运行时模板表存储层

文件：

- [src/constants/storage-keys.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/constants/storage-keys.ts)
- [src/utils/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/utils/storage.ts)

必须新增：

```ts
RUNTIME_OPERATOR_TEMPLATE_MAP: 'def.operator-runtime.template-map.v1'
```

并补存储函数：

- `getRuntimeOperatorTemplateMap()`
- `setRuntimeOperatorTemplateMap()`
- `getRuntimeOperatorTemplateById(characterId)`

要求：

- 使用 `sessionStorage`
- 结构为：
  - `Record<string, RuntimeOperatorTemplate>`
- 这张表不能替代官方 JSON 和本地库，只是运行时派生缓存

***

### 5. `AppContext.loadCharacters()` 统一构建模板表

文件：[src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx)

当前问题：

- `loadCharacters()` 只把官方角色转成旧 `Character`
- 本地角色仅在恢复时临时混到 `restorableCharacterMap`

修正要求：

#### 5.1 保持这件事不变

```ts
dispatch({ type: 'SET_LOADED_CHARACTERS', characters })
```

这里的 `characters` 仍然必须是 **纯官方角色**。

#### 5.2 新增模板表构建链

在 `loadCharacters()` 内部同时做：

- `officialTemplates = characters.map(buildRuntimeOperatorTemplateFromOfficialCharacter)`
- `localTemplates = loadLocalOperatorDraftMap() -> buildRuntimeOperatorTemplateFromDraft`
- 合并成：
  - `runtimeTemplateMap`
- 写入：
  - `setRuntimeOperatorTemplateMap(runtimeTemplateMap)`

#### 5.3 恢复链改为优先使用模板表辅助

恢复 `selectedCharacterIds` 时：

- 仍按 `character.id` 恢复，不按 `name`
- 当前若 `selectedCharacters` 还必须是 `Character[]`，则允许：
  - 官方角色：直接取官方 `Character`
  - 本地角色：由 `RuntimeOperatorTemplate -> LegacyCharacter` 转回兼容视图

注意：

- 当前阶段不要求 `selectedCharacters` 立刻变成 `RuntimeOperatorTemplate[]`
- 但必须为下一步迁移准备好模板表

***

### 6. `SkillSandbox` 改为下一阶段优先消费模板层，不再继续扩 `Character`

文件：[src/components/CanvasBoard/SkillSandbox.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillSandbox.tsx)

当前问题：

- 现在统一入口是：
  - `character.sandboxSkills`
- 这只是把模板信息塞回 `Character`

修正要求：

- 下一阶段把沙盒读取改为：
  - `selectedCharacters` 提供 `characterId`
  - 再从 `runtimeTemplateMap[characterId]` 取技能列表
- 当前文档阶段不要求一次性改完
- 但 Trae 在模板层落地时，必须把这个消费点明确列为下一阶段第一优先级

***

### 7. `SkillButton.tsx` 详情读取链要改成“两条路”

文件：[src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)

当前问题：

- 当前详情读取路径完全依赖官方：
  - `max.json`
  - `skillType -> normalAttack/skill/chainSkill/ultimate`

修正要求：

后续必须改成：

#### 官方角色：

- 仍可继续读取官方 `max.json`

#### 本地角色 / 统一模板角色：

- 若存在 `runtimeSkillId`
- 则从 `runtimeTemplateMap[characterId].skills` 中按 `runtimeSkillId` 取技能详情
- 不再假定只有四个技能槽

注意：

- 本轮文档不要求 Trae 立即重写伤害计算器
- 但必须在实现单里明确：
  - `SkillButton.tsx` 是统一模板层的必改消费方

***

## \[不要动]

- 不要把官方角色写回 `def.operator-editor.library.v1`
- 不要让 `loadedCharacters` 变成官方+本地混合表
- 不要把 `OperatorDraftPage.tsx` 页面状态也抽成全局状态
- 不要一口气重写 `skillButtonDamageCalculator.ts`
- 不要顺手改吸附、复制、Buff 引用计数链

***

## \[分阶段执行顺序]

### 阶段 1：抽模板层，不动 UI 消费

目标：

- 抽出公共模板类型
- 抽出官方/本地模板适配器
- 新增运行时模板表存储

产物：

- `operatorTemplate.ts`
- `operatorTemplateAdapter.ts`
- `storage-keys.ts` 新 key
- `storage.ts` 新读写函数

### 阶段 2：接入 `AppContext`

目标：

- 官方和本地都产出模板表
- 刷新恢复链使用模板表辅助

产物：

- `AppContext.loadCharacters()` 模板构建逻辑
- 恢复日志清晰化

### 阶段 3：切沙盒与按钮消费

目标：

- `SkillSandbox` 逐步从 `Character.sandboxSkills` 切到模板表
- `SkillButton` 详情读取增加模板路径

产物：

- `SkillSandbox.tsx` 消费改造
- `SkillButton.tsx` 双路径读取

### 阶段 4：最后再收公式层

目标：

- 让本地角色多技能、多 hit 真正进入统一伤害读取链

***

## \[验收标准 AC]

### 模板层 AC

- AC1：`/draft` 页与主应用共用同一套模板归一化逻辑
- AC2：官方角色和本地角色都能生成同型 `RuntimeOperatorTemplate`
- AC3：运行时模板表存在 `sessionStorage['def.operator-runtime.template-map.v1']`
- AC4：刷新后模板表可由真相源重建

### 官方/本地边界 AC

- AC5：`loadedCharacters` 仍只表示官方角色库
- AC6：`def.operator-editor.library.v1` 仍只表示本地角色库
- AC7：官方角色数量统计不被污染

### 主链路 AC

- AC8：官方 + 本地混选后刷新浏览器，仍能恢复到 `canvas`
- AC9：本地角色多技能沙盒显示仍正常
- AC10：画布按钮仍保留 `runtimeSkillId / skillDisplayName / customHits`

### 代码层 AC

- AC11：不再在多个文件重复定义 draft 结构
- AC12：`npm run build` 通过

***

## \[回归检查项]

1. `/draft`
   - 从参考官方角色导入
   - 从本地角色导入
   - 从 JSON 文本导入
   - 三条链都仍可生成正确模板
2. 选人页
   - 官方角色数量正确
   - 本地角色数量正确
   - 左右栏边界不混
3. 混选刷新恢复
   - 官方 only
   - 本地 only
   - 官方 + 本地
4. 沙盒
   - 官方四技能仍正常
   - 本地多技能分页仍正常
5. 画布
   - 拖拽新增
   - 刷新恢复
   - 复制按钮
   - 技能名称显示

***

## \[给 Trae 的执行指令]

1. 先抽公共模板层，不要直接动 UI。
2. 从 `OperatorDraftPage.tsx` 迁出：
   - draft 类型
   - `normalizeDraft`
   - `parseImportedDraft`
3. 新建：
   - `operatorTemplate.ts`
   - `operatorTemplateAdapter.ts`
4. `localOperatorAdapter.ts` 改为消费公共模板适配器，不再自定义平行 draft 类型。
5. 新增 `sessionStorage` 模板表 key 和读写函数。
6. `AppContext.loadCharacters()` 内统一构建官方模板 + 本地模板表，但 `loadedCharacters` 继续只放官方角色。
7. 本阶段完成后先提交一轮 review，不要立刻把所有消费层一次切完。
8. 回报时必须附：
   - 新增类型定义
   - 新增 storage key
   - 官方模板示例
   - 本地模板示例
   - 当前仍依赖旧 `Character` 的消费方清单


