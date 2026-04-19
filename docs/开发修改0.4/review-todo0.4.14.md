# review-todo0.4.14

[任务理解]
- 本轮单独修复“Buff 添加主链路失效”。
- 已确认现象：
  - 拖拽 Buff 到已选 Buff 区释放失效
  - 单击候选 Buff 添加也失效
- 代码研究后，问题不是两个入口分别坏了，而是两个入口都汇聚到同一个坏掉的添加函数。

[Review 结论]
- 当前根因已经明确：
  - `DamageTab.addBuffToSkillButton()` 是单击添加和拖拽释放添加的共同终点。
  - 它调用 `addSkillButtonBuff()`。
  - `addSkillButtonBuff()` 在普通导出函数里直接调用 `useSkillButtonBuffs()`。
  - 这违反 React Hooks 规则，会触发 `Invalid hook call`，导致两个添加入口同时失效。
- 本轮不要优先去改拖拽 UI 或 drop-zone 判断。
- 第一优先级是修复 `addSkillButtonBuff()` 的非法 Hook 调用，让公共添加入口恢复可用。

[问题列表]
1. P0: `src/hooks/useSkillButtonBuffs.ts`
   - 位置：`addSkillButtonBuff()`，约 `245-247` 行。
   - 问题：
     - 普通函数内直接调用 `useSkillButtonBuffs()`。
     - 这是非法 Hook 调用。
     - `DamageTab` 点击添加和拖拽释放都会走到这里，因此两个入口都会失败。
   - 结论：
     - 这是本轮真正阻塞点。

2. P1: `src/components/SidePanel/components/DamageTab.tsx`
   - 位置：`handleBuffClick()`，约 `308-315` 行。
   - 问题：
     - 单击候选 Buff 后，会在 200ms 后调用 `addBuffToSkillButton()`。
     - `addBuffToSkillButton()` 随后调用已损坏的 `addSkillButtonBuff()`。
   - 结论：
     - 单击添加失效不是点击事件本身坏了，而是点击链路最终进入了非法 Hook 调用。

3. P1: `src/components/SidePanel/components/DamageTab.tsx`
   - 位置：`handleMouseUp()`，约 `429-433` 行。
   - 问题：
     - 拖拽释放只判断鼠标释放点是否在 `.skill-button-modal` 内。
     - 判断通过后同样调用 `addBuffToSkillButton()`。
     - 因此拖拽释放和单击添加共用同一个坏掉的添加入口。
   - 结论：
     - 拖拽添加失效不是优先级最高的 drop-zone 问题。
     - 只修拖拽 UI 不会恢复功能。

[补充风险]
- `DamageTab.addBuffToSkillButton()` 里先生成了一个 `buffId`。
- `useSkillButtonBuffs.addBuff()` 内部又重新生成另一个 `buffId`。
- 这会导致事件里派发的 `buffId` 可能不是实际落表 id。
- 当前 UI 主要靠 `buttonId` 重新读取，所以这个问题不一定是主阻塞，但后续会造成同步错位风险。
- 修本轮时应顺手对齐：Buff id 只能由一个地方生成，事件派发的 `buffId` 必须等于实际落表 id。

[约束]
- 本轮只修“添加 Buff 主链路失效”，不要扩散到缓存大结构重写。
- 不要先去改拖拽视觉、拖拽区域样式或额外 drop-zone，除非公共添加入口修复后仍验证出拖拽区域判断有问题。
- 不要继续在普通函数里调用 Hook。
- 不要用只改 UI state 的方式伪造添加成功，必须真实写入：
  - `skill-button` 总表里的当前 button `selectedBuff`
  - `buff-list` 总表里的 Buff 实体
- 修复后必须同时恢复：
  - 单击添加
  - 拖拽释放添加

[TODO 列表]
1. 修复 `addSkillButtonBuff()` 的非法 Hook 调用
   - 修改文件：
     - `src/hooks/useSkillButtonBuffs.ts`
   - 要求：
     - `addSkillButtonBuff()` 必须改成纯函数/helper 实现。
     - 不能调用 `useSkillButtonBuffs()`。
     - 纯函数内部应直接完成：
       - 读取 `getSkillButtonById(buttonId)`
       - 做重复判断
       - 写入/更新 `buff-list`
       - 更新 button 的 `selectedBuff`
       - 返回真实成功状态和实际 `buffId`

2. 对齐 Hook 内 `addBuff()` 和独立 helper 的逻辑
   - 修改文件：
     - `src/hooks/useSkillButtonBuffs.ts`
   - 要求：
     - 不允许 Hook 版和独立函数版各写一套不一致逻辑。
     - 建议抽出一个纯 helper，例如：
       - `addBuffToButton(buttonId, buff)`
     - `useSkillButtonBuffs().addBuff()` 和 `addSkillButtonBuff()` 都调用这个 helper。
     - 去重、id 生成、写表、返回值必须一致。

3. 修正 Buff id 双重生成问题
   - 修改文件：
     - `src/components/SidePanel/components/DamageTab.tsx`
     - `src/hooks/useSkillButtonBuffs.ts`
   - 要求：
     - Buff id 只能由一个地方生成。
     - 如果 `DamageTab` 传入的是候选 Buff 数据，则不要提前生成最终 id。
     - 如果保留 `DamageTab` 生成 id，则 `useSkillButtonBuffs` 不得再次生成新 id。
     - `skillbutton-buff-added` 事件中派发的 `buffId` 必须等于实际写入 `buff-list` 的 id。

4. 确认单击添加链路恢复
   - 修改文件：
     - `src/components/SidePanel/components/DamageTab.tsx`
   - 要求：
     - `handleBuffClick()` 单击路径仍调用 `addBuffToSkillButton()`。
     - `addBuffToSkillButton()` 返回成功后派发 `skillbutton-buff-added`。
     - 弹窗内已选 Buff 区应立即通过事件刷新。

5. 确认拖拽释放链路恢复
   - 修改文件：
     - `src/components/SidePanel/components/DamageTab.tsx`
   - 要求：
     - `handleMouseUp()` 中释放在 `.skill-button-modal` 内时仍调用同一个 `addBuffToSkillButton()`。
     - 公共添加入口修复后，拖拽释放应自动恢复。
     - 只有在公共入口修复后仍失败，才继续检查 `.skill-button-modal` 命中范围。

[实现顺序]
1. 先抽纯 helper，消除 `addSkillButtonBuff()` 内的 Hook 调用。
2. 再让 Hook 版 `addBuff()` 和独立函数 `addSkillButtonBuff()` 共用同一个 helper。
3. 再修正 Buff id 只生成一次。
4. 再验证单击添加。
5. 再验证拖拽释放添加。

[验收标准 AC]
- AC1: `addSkillButtonBuff()` 内不再调用任何 Hook。
- AC2: 单击候选 Buff 后，已选 Buff 区立即出现新增项。
- AC3: 拖拽 Buff 到技能按钮弹窗区域释放后，已选 Buff 区立即出现新增项。
- AC4: 两种添加方式都真实更新当前 button 的 `selectedBuff`。
- AC5: 两种添加方式都真实写入或复用 `buff-list` 中的 Buff 实体。
- AC6: 事件派发的 `buffId` 与实际落表 `buffId` 一致。
- AC7: 关闭并重新打开技能按钮弹窗后，刚添加的 Buff 仍可见。
- AC8: 刷新页面后，刚添加的 Buff 仍能恢复。
- AC9: `npm run build` 通过。

[回归检查项]
- 打开技能按钮弹窗后，当前 button 是否正确写入 `SELECTED_SKILL_BUTTON`。
- 单击候选 Buff 是否成功添加。
- 拖拽候选 Buff 到弹窗内释放是否成功添加。
- 添加后 `skill-button` 总表中当前 button 的 `selectedBuff` 是否新增对应 `buffId`。
- 添加后 `buff-list` 总表中是否存在同一个 `buffId` 的完整 Buff 实体。
- 重复添加同一 Buff 是否不会制造孤儿 Buff。
- `0.4.13` 中的 `ALL_BUFF_LIST` 主表污染问题不要被回退。

[给 Trae 的执行指令]
- 本轮不要再泛化排查，根因已经定位到公共添加函数。
- 第一修复点是 `src/hooks/useSkillButtonBuffs.ts` 里的 `addSkillButtonBuff()`。
- 不要先改拖拽 UI。拖拽和单击都走同一个坏入口，公共入口修好后再验证拖拽。
- 完成后必须提交：
  - `addSkillButtonBuff()` 非法 Hook 调用的修复说明
  - Hook 版添加和独立函数添加是否共用同一 helper 的说明
  - Buff id 生成位置说明
  - 构建结果
  - 手测结果
    1. 单击添加 Buff
    2. 拖拽释放添加 Buff
    3. 关闭重开弹窗
    4. 刷新恢复
