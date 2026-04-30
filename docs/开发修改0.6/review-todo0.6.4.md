[Review 结论]

- 不可接受。当前实现有一个直接阻塞的 P0：`SkillButtonComponent` 在 render 阶段 `setState`，导致弹窗一打开就无限重渲染。
- 除了这个崩溃点，还有两个结构性回退：
  1. 本地多技能身份又被压回 `buttonType`，`runtimeSkillId` 没用上
  2. Buff 新增了 `target`，但去重签名没带 `target`，不同作用域的 Buff 会被错误合并

[问题列表]

1. P0：`SkillButtonComponent` 在 render 阶段执行 `setDamageResult(result)`，打开弹窗直接无限重渲染
   - 文件：
     - [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:493)
     - [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:508)
   - 函数：
     - `SkillButtonComponent`
   - 调用链：
     - 双击按钮
     - `isModalOpen = true`
     - modal render
     - render 内 IIFE 调 `calculateSkillButtonDamage(...)`
     - 紧接着 `setDamageResult(result)`
     - state 变化再次触发 render
     - 再次 `setDamageResult(result)`
     - React 抛 `Too many re-renders`
   - 原因：
     - `setDamageResult(result)` 写在 JSX 渲染分支里，不在 `useEffect` / `useMemo` 外围计算里
   - 影响：
     - 官方角色、本地角色只要打开伤害弹窗都会崩
     - 当前这轮 hit 主导改造无法使用
   - 修正要求：
     - 直接删除 `damageResult` state，改成 `useMemo` 计算：
       - 依赖 `runtimeHits / buffList / panelData / infoSnap`
     - 或者把结果写入 `useEffect`，但这里没必要存 state
     - 最小改法：`const damageResult = useMemo(() => ..., [deps])`
   - 验证方式：
     - 双击任意按钮打开弹窗，不再触发 `Too many re-renders`

2. P1：运行时模板技能解析仍只按 `buttonType === skillType` 查找，本地两个同类技能会串技能
   - 文件：
     - [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:136)
     - [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:145)
   - 函数：
     - `loadRuntimeSkillData()`
   - 调用链：
     - `getRuntimeOperatorTemplateById(button.characterId)`
     - `template.skills.find(s => s.buttonType === skillType)`
   - 原因：
     - 这轮本来应该用 `button.runtimeSkillId` 解析具体技能身份
     - 但现在仍然只按 `A/B/E/Q` 查
   - 影响：
     - 本地角色如果有两个 `Q` 或两个 `A`
     - 伤害弹窗会永远命中第一个同类技能
     - 你前面辛苦打通的 `runtimeSkillId / skillDisplayName / customHits` 主链在弹窗里失效
   - 修正要求：
     - 查找顺序必须改成：
       1. 有 `button.runtimeSkillId` 时：`template.skills.find(s => s.id === button.runtimeSkillId)`
       2. 没有 `runtimeSkillId` 才 fallback 到 `buttonType === skillType`
   - 验证方式：
     - 本地角色两个 `Q` 技能分别拖入画布，打开弹窗时命中各自技能，不串

3. P1：`SkillButtonBuff.target` 已新增，但 Buff 去重签名没带 `target`，不同 hit 作用域会被错误合并
   - 文件：
     - [src/types/storage.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/types/storage.ts:116)
     - [src/core/services/buffService.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/buffService.ts:20)
     - [src/core/services/buffService.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/buffService.ts:111)
   - 函数：
     - `getBuffIdentityKey()`
     - `findExistingBuffId()`
     - `addBuffToButton()`
   - 调用链：
     - 添加 Buff
     - `getBuffIdentityKey(buff)`
     - `findExistingBuffId(buff)`
     - 复用已有 buffId / 按钮内判重
   - 原因：
     - `SkillButtonBuff` 新增了 `target`
     - 但 `getBuffIdentityKey()` 仍只拼：
       - `name/displayName/sourceName/level/type/value/condition/source`
     - 没有把 `target` 编入签名
   - 影响：
     - 例如：
       - `multiplierBonus +0.4 target=hit2`
       - `multiplierBonus +0.4 target=hit3`
     - 会被当成同一个 Buff 实体复用
     - 结果是 per-hit Buff 模型从持久化层就被污染
   - 修正要求：
     - `getBuffIdentityKey()` 必须把 `target` 编入签名
     - 推荐序列化为稳定字符串，例如：
       - `JSON.stringify(target ?? { mode: 'all' })`
     - `findExistingBuffId()` 和按钮内判重要自动继承这条修正
   - 验证方式：
     - `hit2` 和 `hit3` 两个同数值但不同 target 的 Buff 能同时存在，不会互相复用

4. P1：当前“Hit 详情”虽切成三段式，但“展开计算过程”仍然错误地绑定 `firstHit`
   - 文件：
     - [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:511)
     - [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx:571)
   - 函数：
     - `SkillButtonComponent`
   - 原因：
     - 当前代码取：
       - `const firstHit = hitResults[0]`
       - 展开区全部展示 `firstHit.elementDmgBonus / firstHit.damageBonusRate / firstHit.fragileRate ...`
     - 这和“点击某个 hit 看某个 hit 详情”的目标冲突
   - 影响：
     - 用户点击 `hit2`
     - 上面的详情区可能是 `hit2`
     - 下面展开计算过程仍显示 `hit1`
     - UI 语义错乱，结果不可信
   - 修正要求：
     - 展开区必须改成基于当前选中的 hit：
       - `const activeHit = selectedHitIndex !== null ? hitResults[selectedHitIndex] : null`
     - 全部公式展示、各区倍率、Buff 区都绑定 `activeHit`
   - 验证方式：
     - 点击不同 hit，展开计算过程跟着切换，不再固定显示第一段

[风险列表]

- `selectedHitIndex` 当前在弹窗打开时被 `setSelectedHitIndex(null)` 清空，没有默认选中第一段。功能不崩，但首次打开详情区为空，体验会偏空。
- `loadRuntimeSkillData()` 当前把 `runtimeHits` 存成局部 state；如果后续模板表或 `button.runtimeSkillId` 变化，建议也改成派生值，减少状态分叉。
- CSS 只是“新增 class 待补样式”，这轮不是阻塞，但 UI 会和设计文档差距较大。

[回归检查项]

- 官方角色打开弹窗：
  - 不崩
  - 不出现 `Too many re-renders`
- 本地角色两个同为 `Q` 的技能都拖入画布：
  - 两个弹窗各自命中自己的技能，不串
- 添加两个数值相同但 target 不同的 Buff：
  - `target=hit2`
  - `target=hit3`
  - 两者都能存在，刷新后不合并
- 点击 `hit1` / `hit2`：
  - 详情区和展开公式区都随之切换
- `npm run build` 通过后，必须手测弹窗打开路径，构建通过不能代替这条验证

[给 Trae 的修正 TODO]

1. 先修 [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)
   - 删除 render 内的 `setDamageResult(result)`
   - 改成 `useMemo` 计算 `damageResult`
2. 再修同文件的 `loadRuntimeSkillData()`
   - 优先按 `button.runtimeSkillId` 查 `template.skills`
   - 没有 `runtimeSkillId` 才 fallback 到 `buttonType`
3. 再修 [src/core/services/buffService.ts](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/core/services/buffService.ts)
   - `getBuffIdentityKey()` 把 `target` 纳入签名
   - 验证按钮内判重和全局实体复用都继承修正
4. 再回到 [src/components/CanvasBoard/SkillButton.tsx](/C:/Users/zsk86/Desktop/dmg/dmg-end-field/src/components/CanvasBoard/SkillButton.tsx)
   - 把“展开计算过程”从 `firstHit` 改成当前选中的 `activeHit`
5. 完成后必须回报：
   - 删除了哪一处 render 内 `setState`
   - `runtimeSkillId` 命中逻辑
   - `target` 纳入 Buff identity 的具体实现
   - `hit2/hit3` 不同 target Buff 的验证结果