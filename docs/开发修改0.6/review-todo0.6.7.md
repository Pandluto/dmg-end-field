[任务理解]

- 本轮不是继续改伤害公式，也不是接 `L9 / M3` 真实逻辑。
- 本轮只做一件事：**把 `OperatorConfigPanel` 的技能显示层改成 runtime template 驱动，让官方角色和本地角色都走统一模板链。**
- `L9 / M3` 这轮只保留滑块 UI 占位，不接任何真实倍率切换，不接计算，不改模板。

[当前结论]

- 当前阻塞点在 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx)。
- 这个面板现在已经是伤害链上游，因为 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\SkillButton.tsx) 会消费它写出的：
  - `characterConfig.panelSnapshot`
  - `characterConfig.infoSnap`
- 但它的技能区仍然是旧模型：
  - 读 `max.json`
  - 固定 `A/B/E/Q`
  - 不认 `runtimeSkillId`
  - 不认本地角色真实技能列表
- 主修复点不是 `SkillButton.tsx`，不是 `DamageTab.tsx`，不是 `buffService.ts`。
- 主修复点就是：**`OperatorConfigPanel.tsx` 的技能列表来源与技能卡渲染入口。**

[必须改]

1. 统一 `OperatorConfigPanel` 的技能数据来源，改成 runtime template
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\utils\storage.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\utils\storage.ts)
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\core\templates\operatorTemplate.ts)
   - 当前问题：
     - 面板现在通过 `characterMaxData?.skills` 构造：
       - `normalAttack`
       - `skill`
       - `chainSkill`
       - `ultimate`
     - 这条链只适配官方固定四槽，不适配本地角色 runtime skills。
   - 当前调用链：
     - `SkillSandbox` 双击头像
     - `CanvasBoard -> OperatorConfigPanel`
     - `OperatorConfigPanel` 读取 `characterMaxData.skills`
     - 生成 `skillEntries`
   - 修正要求：
     - 在 `OperatorConfigPanel.tsx` 内新增一个统一模板读取入口，例如：
       - `const runtimeTemplate = getRuntimeOperatorTemplateById(resolvedActiveCharacterId)`
     - 技能区不再从 `characterMaxData.skills` 取技能列表。
     - 新的技能列表必须从：
       - `runtimeTemplate.skills`
       派生。
     - 每个技能卡至少带上：
       - `id`
       - `displayName`
       - `buttonType`
       - `hits.length`
     - 角色不存在 runtime template 时：
       - 技能区显示空态或“未找到技能模板”
       - 不要 fallback 回旧 `characterMaxData.skills`
   - 验证方式：
     - 官方角色打开配置面板时，技能区来自 `def.operator-runtime.template-map.v1`
     - 本地角色打开配置面板时，也能渲染真实技能列表
     - 不再依赖 `characterMaxData.skills` 组织技能卡

2. 删除 `OperatorConfigPanel` 内固定 `A/B/E/Q` 技能卡入口，替换成模板驱动渲染
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx)
   - 当前问题：
     - 当前有：
       - `type SkillPanelKey = 'A' | 'B' | 'E' | 'Q'`
       - `DEFAULT_SKILL_LEVEL_MODE_MAP`
       - `skillEntries = [{ key:'A' ...}, { key:'B' ...}, ...]`
     - 这是旧技能 UI 壳。
   - 修正要求：
     - 保留 `SkillPanelKey` 类型只作为老面板状态兼容用途，不再作为技能区真实来源。
     - 新增模板驱动列表，例如：
       - `runtimeSkillEntries = runtimeTemplate.skills.map(...)`
     - 技能区 JSX 改成遍历 `runtimeSkillEntries`
     - 技能卡片显示内容至少改成：
       - 技能名
       - `buttonType`
       - `hit` 数
     - 本地角色技能数 > 4 时，允许完整渲染，不要强行截成 `A/B/E/Q`
   - 验证方式：
     - 本地角色如果有 5 个以上技能，面板能完整显示
     - 同类多技能不会被错误压回一个 `Q`

3. 冻结 `L9 / M3` 逻辑，只保留 UI 占位，不接真实计算
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\types\storage.ts)
   - 当前问题：
     - 当前面板里已有：
       - `skillLevelModeMap`
       - `DEFAULT_SKILL_LEVEL_MODE_MAP`
     - 但 runtime template 里没有真实 `L9 / M3` 级别真相源。
   - 修正要求：
     - 技能卡上可以继续保留 `L9 / M3` 滑块或标签 UI。
     - 但必须冻结逻辑：
       - 不改 `runtimeTemplate`
       - 不改 `panelSnapshot`
       - 不改 `infoSnap`
       - 不改 `SkillButton` 伤害计算输入
       - 不改 `def.operator-runtime.template-map.v1`
     - 官方角色：
       - 滑块显示但只作为占位 UI
     - 本地角色：
       - 滑块隐藏，或显示不可交互固定态
       - 不允许伪造 `L9 / M3`
   - 验证方式：
     - 操作滑块不会影响任何伤害数值
     - `SkillButton` 弹窗数值前后不变
     - session 里的 `characterConfigMap` 不因为滑块切换写出技能倍率变化

4. `OperatorConfigPanel` 保留角色级面板计算，不要改 `panelSnapshot / infoSnap` 主结构
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\utils\storage.ts)
   - 当前问题：
     - 当前面板虽然技能区旧，但 `panelSnapshot` / `infoSnap` 已经被伤害弹窗消费。
   - 修正要求：
     - 这轮只改技能显示来源，不改：
       - `panelSnapshot`
       - `infoSnapshot`
       - `infoSnap`
       - `characterConfigMap`
       - `weaponStateKey`
     - `setCharacterConfigMap(...)` 回写 effect 不要扩散重构。
     - 角色面板计算公式保持原样。
   - 验证方式：
     - 改完后 `SkillButton` 弹窗仍能正常读取：
       - `characterConfig.panelSnapshot`
       - `characterConfig.infoSnap`
     - 不引入新的 `NaN` 或 panel 丢失

5. 继续保留 `max.json` 作为角色面板基础属性来源，但不再作为技能卡来源
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx)
   - 当前问题：
     - `characterMaxData` 现在同时承担：
       - 面板基础属性
       - 技能列表
     - 技能列表这部分必须退出主链。
   - 修正要求：
     - 继续保留 `fetch /data/characters/<name>/<name>max.json`
       只用于：
       - `profession`
       - `element`
       - `mainStat`
       - `subStat`
       - `level90` 基础属性
       - 武器相关联的旧面板计算
     - 明确切掉它对 `skills` 的消费：
       - `const skills = characterMaxData?.skills`
       - `skillEntries = [...]`
       这套逻辑退出技能卡渲染主链
   - 验证方式：
     - 角色面板属性仍正常显示
     - 技能区来源改成 runtime template
     - 本地角色不再因为没有 `max.json.skills` 而空白

6. 给本地角色配置面板补 runtime template 兜底，不允许空白无技能
   - 文件：
     - [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\context\AppContext.tsx)
   - 当前问题：
     - 本地角色当前可能没有 `max.json` 技能描述，但 runtime template 已存在。
   - 修正要求：
     - 配置面板技能区先读 runtime template。
     - 若 runtime template 缺失：
       - 明确显示“未找到运行时技能模板”
       - 不要再从 `characterMaxData.skills` 硬推
     - 同时确认 `AppContext` 当前已在角色选择链路中为已选角色构建 `def.operator-runtime.template-map.v1`
   - 验证方式：
     - 已选本地角色打开配置面板时，技能区有内容
     - 本地角色技能名、hit 数与伤害弹窗一致

[不要动]

- 不要改 `SkillButton.tsx` 伤害计算主链
- 不要改 `calculateSkillButtonDamageV2(...)`
- 不要改 `buildSkillDamageModalViewModel(...)`
- 不要改 `buffService.ts` 写入顺序
- 不要改 `DamageTab.tsx`
- 不要把 `panelSnapshot / infoSnap` 改成 skill 级缓存
- 不要开发 `L9 / M3` 实际倍率切换逻辑
- 不要改 timeline 拖拽、吸附、复制、位置恢复

[给 Trae 的执行指令]

1. 先只改 [C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx](C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\components\CanvasBoard\components\OperatorConfigPanel.tsx)。
2. 第一刀先切技能来源：
   - 删掉技能区对 `characterMaxData.skills` 的依赖
   - 改成读取 `getRuntimeOperatorTemplateById(resolvedActiveCharacterId)`
3. 第二刀改技能区数据结构：
   - 删除固定 `skillEntries = [A/B/E/Q]` 作为真实渲染来源
   - 新增 `runtimeSkillEntries = runtimeTemplate.skills.map(...)`
   - JSX 遍历 `runtimeSkillEntries`
4. 第三刀冻结 `L9 / M3`：
   - UI 保留
   - 不接计算
   - 不写回倍率
   - 本地角色隐藏或禁用
5. 第四刀确认面板数值链不回退：
   - `panelSnapshot`
   - `infoSnapshot`
   - `infoSnap`
   - `setCharacterConfigMap`
   这些都不要扩散改
6. 完成后提交给我这 5 个结果：
   - `OperatorConfigPanel.tsx` 里旧 `skills/skillEntries` 被替换的代码点
   - 新的 `runtimeTemplate -> runtimeSkillEntries` 代码点
   - 本地角色配置面板技能区的实际显示结果
   - `L9 / M3` UI 冻结后的实际行为
   - `npm run build` 结果
