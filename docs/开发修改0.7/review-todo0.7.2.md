[任务理解]

- 本轮要修的是主界面技能按钮右键 `编辑 -> 改为` 这条交互。
- 旧版本把“改为”写死成 `A / B / E / Q`，这只适合官方四技能角色，不适合现在的本地自定义干员。
- 现在本地干员来自 `/draft`，技能数已经不再固定 4 个，右键编辑必须改成“读取当前角色真实技能列表”，而不是固定四选项。
- 本轮不是改伤害公式，不是改弹窗 UI，而是改**右键编辑菜单的数据源和切换真相**。

[当前结论]

- 当前实现不可接受，阻塞原因不是右键菜单样式，而是“改为”菜单的数据模型仍是旧四槽模型。
- 主修复点在：
  - `src/components/CanvasBoard/index.tsx`
  - `src/components/CanvasBoard/components/CanvasArea.tsx`
  - `src/hooks/useTimelineData.ts`
  - `src/core/services/timelineService.ts`
- 参考真相源在：
  - `src/components/CanvasBoard/SkillSandbox.tsx`
  - `src/core/services/localOperatorAdapter.ts`
  - `src/core/services/operatorTemplateAdapter.ts`
  - `src/core/services/skillDamageTemplateResolver.ts`
- 不要优先去动：
  - `SkillButton.tsx` 内部伤害计算器
  - `buffService`
  - `/draft` 页面结构

[必须改]

1. 文件 / 函数 / 字段
   - 文件：
     - `src/components/CanvasBoard/components/CanvasArea.tsx`
     - `src/components/CanvasBoard/SkillButton.tsx`
   - 问题：
     - 右键 `改为` 菜单当前仍按 `A / B / E / Q` 固定渲染。
   - 原因：
     - `CanvasAreaProps.onChangeSkillType` 仍然是：
       - `(buttonId: string, nextSkillType: 'A' | 'B' | 'E' | 'Q') => void`
     - `SkillButtonComponent` 的右键菜单因此只能传固定 `SkillType`，不能传“某个具体技能”。
   - 修正要求：
     - 不再把菜单模型定义成固定 `nextSkillType`
     - 改成传“目标技能项” payload，至少包含：
       - `buttonId`
       - `nextSkillType`
       - `nextRuntimeSkillId`
       - `nextSkillDisplayName`
       - `nextSkillIconUrl`
       - `nextCustomHits`
     - `SkillButtonComponent` 的右键菜单项要从外部传入的“可选技能列表”渲染，而不是写死四个类型
   - 验证方式：
     - 官方角色右键菜单仍显示 4 个技能
     - 本地角色右键菜单显示该角色全部技能，不限 4 个

2. 文件 / 函数 / 字段
   - 文件：
     - `src/components/CanvasBoard/index.tsx`
   - 函数：
     - `handleChangeSkillType()`
   - 问题：
     - 当前 `handleChangeSkillType()` 只接受 `nextSkillType`
     - 并且只更新：
       - `skillType`
       - `skillIconUrl`
   - 原因：
     - 新版本按钮真相不再靠 `skillType` 唯一定位技能。
     - 当前按钮真正依赖的是：
       - `runtimeSkillId`
       - `skillDisplayName`
       - `customHits`
       - `skillIconUrl`
     - 这些字段最初来自 `SkillSandbox` 拖拽链。
   - 修正要求：
     - `handleChangeSkillType()` 改名也可以，但职责必须变成“切换到目标技能项”
     - 它必须先解析当前按钮所属角色的真实技能列表
     - 技能列表来源优先级：
       1. `state.selectedCharacters` 中对应角色的 `sandboxSkills`
       2. 若为空，再 fallback 到 runtime template skills
     - 找到目标 skill 后，构造完整 payload 并下发给 timeline/update 链
     - 不能再用 `resolveSkillIconUrl(characterName, nextSkillType)` 当主来源
   - 验证方式：
     - 本地角色如果有第 5 个技能，右键选中后按钮会切到第 5 个技能，而不是硬套成 A/B/E/Q 之一

3. 文件 / 函数 / 字段
   - 文件：
     - `src/components/CanvasBoard/SkillSandbox.tsx`
     - `src/core/services/localOperatorAdapter.ts`
     - `src/core/services/operatorTemplateAdapter.ts`
   - 问题：
     - 右键编辑菜单必须和技能沙盒看到的技能列表一致。
   - 原因：
     - `SkillSandbox` 已经通过 `character.sandboxSkills` 支持本地角色多技能：
       - `getCharacterSandboxSkills(character)`
     - 右键菜单如果不复用这套来源，就会出现：
       - 沙盒里看得到 6 个技能
       - 右键里却只能切 4 个
   - 修正要求：
     - `CanvasBoard` 构建右键菜单时，必须和 `SkillSandbox` 同源
     - 本地角色用 `sandboxSkills`
     - 官方角色也优先看 `sandboxSkills`，因为官方现在也会构造统一 skill 列表
   - 验证方式：
     - 同一角色在沙盒中看到的技能数，与右键编辑菜单完全一致

4. 文件 / 函数 / 字段
   - 文件：
     - `src/hooks/useTimelineData.ts`
   - 函数：
     - `updateSkillButtonType()`
   - 问题：
     - hook 层还停留在旧签名：
       - `buttonId + nextSkillType`
   - 原因：
     - service 层因此无法更新完整技能真相。
   - 修正要求：
     - hook 层参数改成完整技能 payload，而不是单个 `nextSkillType`
     - hook 只负责把 payload 原样下传给 `timelineService.updateSkillButtonType()`
     - 不要在 hook 里做第二份技能解析
   - 验证方式：
     - 切换技能后，hook 返回的 `updatedButton` 已包含新：
       - `runtimeSkillId`
       - `skillDisplayName`
       - `skillIconUrl`
       - `customHits`

5. 文件 / 函数 / 字段
   - 文件：
     - `src/core/services/timelineService.ts`
   - 函数：
     - `updateSkillButtonType()`
   - 缓存 key / 主从结构：
     - `ddd.timeline.data`
     - `ddd.skill-button.v1`
   - 问题：
     - service 当前只改：
       - `skillType`
     - 没改：
       - `runtimeSkillId`
       - `skillDisplayName`
       - `skillIconUrl`
       - `customHits`
   - 原因：
     - timeline.data 和 skill-button 总表仍按旧模型保存。
   - 修正要求：
     - `updateSkillButtonType()` 改为接收完整 skill payload
     - 必须同步更新两份真相：
       1. `timelineData.staffLines[].buttons[]`
       2. `PersistedSkillButton`
     - 写入字段至少包括：
       - `skillType`
       - `runtimeSkillId`
       - `skillDisplayName`
       - `skillIconUrl`
       - `customHits`
   - 验证方式：
     - 切换技能后，读取 `getSkillButtonById(buttonId)`，上述字段全部已更新
     - 刷新页面恢复后仍保持同一技能

6. 文件 / 函数 / 字段
   - 文件：
     - `src/core/services/skillDamageTemplateResolver.ts`
   - 函数：
     - `resolveSkillDamageTemplate()`
   - 问题：
     - 这不是主修复文件，但它会直接暴露当前 bug。
   - 原因：
     - resolver 现在优先按：
       - `button.runtimeSkillId`
       - `button.customHits`
     - 只有找不到才 fallback 到 `button.skillType`
     - 所以如果右键切换后没同步 `runtimeSkillId / customHits`，技能伤害一定还是旧技能。
   - 修正要求：
     - 本轮不要改这个文件的核心逻辑。
     - 以它为验收基准：切换后必须让 resolver 命中新技能。
   - 验证方式：
     - 切换技能后打开技能伤害弹窗，hit 列表、显示名、倍率全部来自目标技能

7. 文件 / 函数 / 字段
   - 文件：
     - `src/components/CanvasBoard/index.tsx`
   - 函数：
     - `handleCopySkillButton()`
     - `handlePlaceCopiedButton()`
   - 问题：
     - 复制按钮链会复制当前 runtime 按钮的：
       - `runtimeSkillId`
       - `skillDisplayName`
       - `customHits`
   - 原因：
     - 复制链本身没错，但它会放大技能切换真相不完整的问题。
   - 修正要求：
     - 本轮不要重写复制链。
     - 修完编辑按钮后，复制链必须自动受益。
   - 验证方式：
     - 先右键切到某个本地自定义技能，再复制按钮
     - 复制出的新按钮必须保持同样的技能真相

[可选优化]

- 菜单文案可以显示成：
  - `按钮类型标签 / 技能显示名`
  例如：
  - `A / 普通攻击`
  - `X / 自定义技能 05`
- 但这不是主链路要求，没有就不做。

[不要动]

- 不要再把右键菜单扩成固定更多个 `A/B/E/Q` 变体。
- 不要把本地角色重新压回四技能模型。
- 不要改 `SkillButton.tsx` 的伤害计算公式来掩盖这个问题。
- 不要改 `/draft` 页面结构来规避主界面编辑适配。
- 不要新增第二套按钮技能真相存储。

[验收标准 AC]

- 官方角色右键编辑仍可正常切换现有技能
- 本地角色右键编辑菜单能显示全部自定义技能，不限 4 个
- 选择任意目标技能后，按钮同时更新：
  - 图标
  - 技能显示名
  - `runtimeSkillId`
  - `customHits`
- 打开技能伤害弹窗时：
  - hit 数
  - hit 名称
  - 倍率
  必须全部匹配目标技能
- 刷新页面后不回退
- 复制按钮后不回退
- `npm run build` 通过
- 手测必须只在 IDE / 本地浏览器内完成，不依赖外部平台

[回归检查项]

- 官方角色：
  1. 拖一个技能按钮到主界面
  2. 右键打开 `编辑 -> 改为`
  3. 切到另一个官方技能
  4. 打开技能伤害弹窗，确认模板切换正确
  5. 刷新页面再验一次

- 本地角色：
  1. 准备一个拥有超过 4 个技能的本地角色
  2. 拖一个技能按钮到主界面
  3. 右键打开 `编辑 -> 改为`
  4. 确认菜单显示全部技能
  5. 切到其中一个非传统四槽技能
  6. 打开技能伤害弹窗，确认模板切换正确
  7. 刷新页面再验一次

- 复制链：
  1. 先右键切到某个本地自定义技能
  2. 再复制该按钮
  3. 打开原按钮和复制按钮的技能伤害弹窗
  4. 两者都必须保持切换后的技能真相

[给 Trae 的执行指令]

1. 先改 `src/components/CanvasBoard/index.tsx`
   - 把 `handleChangeSkillType()` 重构成“切换到目标技能项”
   - 数据源统一从当前角色的 `sandboxSkills` 取，不要自己拼 `A/B/E/Q`

2. 再改 `src/components/CanvasBoard/components/CanvasArea.tsx` 和 `src/components/CanvasBoard/SkillButton.tsx`
   - 右键菜单项改成动态技能列表
   - 事件参数改成完整 skill payload，不再只传 `nextSkillType`

3. 再改 `src/hooks/useTimelineData.ts`
   - 扩 `updateSkillButtonType()` 签名
   - 只转发 payload，不要自己重复解析技能

4. 再改 `src/core/services/timelineService.ts`
   - 同步更新 `timeline.data` 和 `ddd.skill-button.v1`
   - 把完整技能真相字段一起写回

5. 完成后必须提交：
   - 受影响文件清单
   - 右键菜单新数据源说明
   - 官方角色 / 本地角色 / 复制链 三条手测结果
   - `npm run build` 结果
