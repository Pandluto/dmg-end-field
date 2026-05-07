[任务理解]

- 本轮不是继续扩模板层，而是**取缔当前“全量构建 `def.operator-runtime.template-map.v1`”的做法**。
- 目标是把 `sessionStorage['def.operator-runtime.template-map.v1']` 收紧成：**当前运行时已选角色模板表**。
- 这次改动很精细，核心不是“功能能跑”，而是**职责边界收紧、写入时机正确、恢复链不回退**。
- 当前根因已明确：`AppContext.loadCharacters()` 启动时把全部官方角色和全部本地角色都塞进模板表，职责过重，数据流边界错误。

[当前结论]

- 当前实现方向需要收回。
- 主修复点在 [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx)，不是 `SkillSandbox`，不是 `timelineService`。
- 这轮不要改 UI，不要扩散到画布和伤害计算。
- 这轮只做三件事：
  1. 取缔全量模板表构建
  2. 改成按“当前已选角色”定向构建
  3. 保证刷新恢复、选择、取消选择三条链一致

[必须改]

1. 取缔 [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx:291) 这段“全量官方 + 全量本地模板表构建”
   - 问题：
     - 当前 `loadCharacters()` 在启动时执行：
       - `officialTemplates = characters.map(...)`
       - `localDraftMap = loadLocalOperatorDraftMap()`
       - `localTemplates = Object.values(localDraftMap).map(...)`
       - 合并后 `setRuntimeOperatorTemplateMap(runtimeTemplateMap)`
   - 原因：
     - 把“运行时消费缓存”做成了“全角色镜像仓库”
   - 修正要求：
     - 整段全量构建逻辑从 `loadCharacters()` 中删除
     - 启动阶段只保留：
       - 官方角色列表加载
       - `loadedCharacters` 赋值
       - 为刷新恢复准备 `restorableCharacterMap`
     - 不允许在无已选角色时就写全量模板表
   - 验证方式：
     - 初次进入 selection 页面，未选择任何角色时：
       - `sessionStorage['def.operator-runtime.template-map.v1']` 应为空或不存在
       - 不能包含整个官方角色库

2. 在 [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx) 内新增公共模板表重建函数
   - 问题：
     - 当前没有“按已选角色重建模板表”的公共入口
   - 原因：
     - 选择、取消选择、刷新恢复三条路径没有共用一个模板同步函数
   - 修正要求：
     - 在 `AppProvider` 内新增一个明确的 helper，例如：
       - `rebuildSelectedRuntimeTemplateMap(selectedCharacters: Character[]): void`
     - 职责：
       - 输入：当前已选 `Character[]`
       - 输出：只包含这些角色的 `RuntimeOperatorTemplateMap`
       - 官方角色：调用 `buildRuntimeOperatorTemplateFromOfficialCharacter(character)`
       - 本地角色：不要再从 `def.operator-editor.library.v1` 全量扫表，优先从当前 `Character` 身份恢复
         - 方案 A：给本地 `Character` 走 `adaptRuntimeTemplateToLegacyCharacter` 逆向来源太绕，不建议
         - 方案 B：当前已选本地角色仍然可通过 `loadLocalOperatorDraftMap()[character.id]` 定向取 draft 再建模板
       - 最终写入：
         - `setRuntimeOperatorTemplateMap(nextMap)`
     - 这条函数必须成为唯一写入口
   - 验证方式：
     - 选 2 人时模板表只写 2 人
     - 取消到 1 人时模板表同步只剩 1 人

3. 刷新恢复链改为“恢复成功后定向构建模板表”
   - 文件：
     - [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx:322)
   - 问题：
     - 当前恢复链只恢复 `selectedCharacters` 和 `view`
     - 模板表现在还是靠前面的全量构建顶着
   - 原因：
     - 你一旦删掉全量构建，恢复后如果不补建模板表，后续沙盒/画布统一模板消费会断
   - 修正要求：
     - 在这段逻辑里：
       - `restoredCharacters.length === expectedCount`
       - `dispatch({ type: 'SET_SELECTED_CHARACTERS', characters: restoredCharacters })`
       - `dispatch({ type: 'SET_VIEW', view: 'canvas' })`
     - 之后紧接着调用：
       - `rebuildSelectedRuntimeTemplateMap(restoredCharacters)`
     - 如果恢复失败：
       - 不写模板表
       - 可显式清空模板表，避免 session 中残留旧选择
   - 验证方式：
     - 官方+本地混选刷新恢复后：
       - 模板表只包含恢复成功的选中角色
       - 不包含未选官方角色

4. 选中角色时同步构建模板表
   - 文件：
     - [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx:344)
   - 问题：
     - 当前 `useEffect(() => setSelectedCharacterIds(...), [state.selectedCharacters])` 只同步了选中 ID
     - 没有同步模板表
   - 原因：
     - 现在模板表职责要收紧到“当前已选角色”，这条 effect 必须一起负责
   - 修正要求：
     - 在现有 `selectedCharactersHydratedRef` 守卫逻辑中：
       - 保留 `setSelectedCharacterIds(...)`
       - 紧接着调用 `rebuildSelectedRuntimeTemplateMap(state.selectedCharacters)`
     - 这样：
       - 手动选中角色
       - 手动取消角色
       - 恢复后后续状态变化
       都会统一同步模板表
   - 验证方式：
     - 手动选中 1 个官方角色后，模板表只有这 1 个
     - 再加 1 个本地角色后，模板表变成这 2 个
     - 取消 1 个后，模板表同步删掉

5. 空选中态必须清空模板表
   - 文件：
     - [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx)
     - [src/utils/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/utils/storage.ts:692)
   - 问题：
     - 如果模板表只表示当前已选角色，那么 `selectedCharacters = []` 时不能保留旧数据
   - 原因：
     - 否则会出现“未选角色但 session 里还有旧模板”的残留状态
   - 修正要求：
     - `rebuildSelectedRuntimeTemplateMap([])` 必须写入空对象 `{}``
     - 不要保留旧值
   - 验证方式：
     - 清空所有已选角色后：
       - `def.operator-runtime.template-map.v1` 为空对象或被清空
       - 不能残留上一次的角色模板

6. 本地角色模板构建必须按 `character.id` 定向取 draft，不允许全量扫描本地库后全塞进模板表
   - 文件：
     - [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx)
     - [src/core/services/localOperatorAdapter.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/localOperatorAdapter.ts:18)
   - 问题：
     - 当前 `loadLocalOperatorDraftMap()` 是全量读取本地库
     - 这在“恢复 map”阶段是可接受的，但在“模板表写入”阶段不能直接把全部都写进去
   - 原因：
     - 模板表职责已收紧为“已选角色模板表”
   - 修正要求：
     - 可以读取整张本地 draft map 用于查找
     - 但最终只允许为 `selectedCharacters` 中 `librarySource === 'local'` 的角色按 id 定向构建模板
   - 验证方式：
     - 本地库有 10 个角色，当前只选 1 个本地角色时，模板表里只出现这 1 个

7. 恢复失败分支建议显式清空模板表
   - 文件：
     - [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx:334)
   - 问题：
     - 如果上一个 session 留下了旧模板表，而当前恢复失败，不清空会残留脏模板
   - 原因：
     - 这张表现在代表“当前已选角色”，恢复失败时应视为当前会话没有有效选中模板上下文
   - 修正要求：
     - 在 `console.warn('[AppContext] 角色恢复失败', ...)` 分支前或后，明确：
       - `setRuntimeOperatorTemplateMap({})`
   - 验证方式：
     - 刻意删除一个本地已选角色后刷新
       - 页面回到 selection
       - 模板表为空
       - 不残留旧角色模板

8. 不要动 [src/constants/storage-keys.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/constants/storage-keys.ts:26) 的 key 名
   - 问题：
     - 现在不是重命名 key 的时机
   - 原因：
     - 先收职责边界，再决定是否语义化重命名
   - 修正要求：
     - `RUNTIME_OPERATOR_TEMPLATE_MAP` key 先保持不变
     - 只改内容和写入时机
   - 验证方式：
     - 相关读写函数继续可用，不扩散改动面

[可选优化]

- 可选 1：
  - 给 `rebuildSelectedRuntimeTemplateMap()` 加一条 `console.log`
  - 打印当前写入了哪些 `character.id`
  - 仅用于过渡期调试，后续可删
- 可选 2：
  - 后续再考虑是否把 `buildOfficialSandboxSkills()` 切到 `buildSandboxSkillsFromRuntimeTemplate()`
  - 本轮不是必须项

[不要动]

- 不要改 `SelectionPanel` 左右栏逻辑
- 不要改 `SkillSandbox` 渲染逻辑
- 不要改 `timelineService`、`SkillButton`、伤害弹窗
- 不要把官方角色写进 `def.operator-editor.library.v1`
- 不要把 `def.operator-runtime.template-map.v1` 当永久真相源
- 不要顺手重命名 storage key
- 不要回退“官方模板直接从 `character.skills` 构建”的修复

[验收标准 AC]

- AC1：首次进入 selection 页面、未选任何角色时，`sessionStorage['def.operator-runtime.template-map.v1']` 为空或不存在，不包含整个官方库
- AC2：手动选择 1 个官方角色后，模板表只包含这 1 个角色
- AC3：再选择 1 个本地角色后，模板表只包含这 2 个角色
- AC4：取消其中 1 个角色后，模板表同步移除该角色，只保留剩余已选角色
- AC5：官方+本地混选后刷新浏览器，恢复成功时模板表只重建已选角色
- AC6：如果恢复失败（例如本地已选角色已从 `def.operator-editor.library.v1` 删除），页面回到 selection，且模板表为空
- AC7：`loadedCharacters` 仍只表示官方角色库，不混入本地角色
- AC8：`npm run build` 通过

[回归检查项]

- 路径 1：官方 only
  - 选 1 个官方角色
  - 看模板表内容
  - 刷新
  - 看模板表和页面状态
- 路径 2：本地 only
  - 选 1 个本地角色
  - 看模板表内容
  - 刷新
  - 看模板表和页面状态
- 路径 3：官方 + 本地
  - 选 1 官方 + 1 本地
  - 看模板表只含 2 个角色
  - 刷新后仍只含 2 个角色
- 路径 4：恢复失败
  - 先选 1 个本地角色进入 canvas
  - 手动删掉 `def.operator-editor.library.v1` 里对应 id
  - 刷新
  - 确认页面回 selection，模板表为空
- 路径 5：取消选择
  - 连选 2 个角色
  - 取消 1 个
  - 模板表同步减少

[给 Trae 的执行指令]

1. 先改 [src/context/AppContext.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/context/AppContext.tsx)
   - 删除 `loadCharacters()` 中当前那段全量构建 `runtimeTemplateMap` 的逻辑
2. 在 `AppProvider` 内新增唯一公共入口：
   - `rebuildSelectedRuntimeTemplateMap(selectedCharacters: Character[])`
3. 该函数内部按 `character.id` 与 `librarySource` 定向构建模板：
   - `official` -> `buildRuntimeOperatorTemplateFromOfficialCharacter(character)`
   - `local` -> 从 `loadLocalOperatorDraftMap()[character.id]` 定向取 draft 后 `buildRuntimeOperatorTemplateFromDraft(draft)`
4. 保证空选中态调用该函数时写入 `{}``
5. 在两条链上接入这个函数：
   - 刷新恢复成功后
   - `state.selectedCharacters` 变化后
6. 恢复失败分支显式清空模板表
7. 保持 `loadedCharacters` 官方专用，禁止混入本地角色
8. 跑 `npm run build`
9. 完成后必须回报：
   - `loadCharacters()` 删掉了哪些全量构建代码
   - `rebuildSelectedRuntimeTemplateMap()` 的完整职责
   - 选择 / 取消 / 刷新恢复 / 恢复失败 四条路径的模板表结果
   - `sessionStorage['def.operator-runtime.template-map.v1']` 在未选角色时的实际状态
