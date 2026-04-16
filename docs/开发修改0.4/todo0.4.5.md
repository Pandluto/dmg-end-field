# todo0.4.5

[任务理解]
- 当前 `SidePanel` 的伤害加成 Buff 只能通过点击“陈列区”条目添加到当前选中的技能按钮。
- 目标是新增一条交互路径：用户长按“陈列区”的 Buff，并拖到“已选 Buff 区”时，也能完成添加 Buff。

[约束]
- 技术约束
  - 只改 Buff 交互，不改现有 Buff 数据结构。
  - 继续复用当前 `selected skill button` 和 `addSkillButtonBuff` 这套持久化逻辑，不允许新造一套 Buff 存储。
  - 不依赖浏览器原生 HTML5 `dragstart/drop` 默认行为，优先用当前 React 事件体系做可控拖拽。
- 不可破坏部分
  - 现有单击添加 Buff 的逻辑必须保留。
  - 现有双击查看 Buff 详情的逻辑必须保留。
  - 没有选中技能按钮时，拖拽添加不能写入脏数据。
  - 已存在同名 Buff 时，拖拽添加不能重复加入。
- 风格/架构要求
  - “拖拽添加 Buff” 和“点击添加 Buff”必须最终走同一个添加函数。
  - 长按判定、拖拽中的悬浮态、放置命中判断必须放在 `DamageTab.tsx` 内统一管理，不要把交互逻辑散到多个文件。
  - 不要把拖拽状态写入 `sessionStorage`。

[TODO 列表]
1. 在 `src/components/SidePanel/components/DamageTab.tsx` 中为“陈列区 Buff 条目”补充长按拖拽交互状态，至少包含：
   - 当前是否处于长按准备阶段
   - 当前是否进入拖拽状态
   - 当前被拖拽的 Buff 数据
   - 当前拖拽位置
2. 在 `DamageTab.tsx` 中实现长按判定逻辑：
   - `mousedown` / `pointerdown` 后启动定时器
   - 达到阈值后才进入拖拽态
   - 在阈值前释放则仍按原有点击/双击逻辑处理
   - 长按进入拖拽后，必须取消原有点击/双击触发
3. 在 `DamageTab.tsx` 中为“已选 Buff 区”定义明确的 drop target 引用和命中判断逻辑，只有拖入该区域并释放时才执行添加 Buff。
4. 在 `DamageTab.tsx` 中把“拖拽添加 Buff”统一接到现有 `addBuffToSkillButton(buff)`，禁止复制出第二套新增 Buff 的逻辑。
5. 在 `DamageTab.tsx` 中为拖拽过程补充最小可用 UI 反馈，至少包含：
   - 被拖拽 Buff 的视觉态
   - “已选 Buff 区”在可放置时的高亮态
   - 放置成功后的状态清理
6. 在 `DamageTab.tsx` 中补全拖拽失败/取消路径：
   - 鼠标释放在无效区域时不添加
   - 鼠标移出或取消拖拽时正确清理状态
   - 没有选中技能按钮时禁止进入有效放置结果
7. 检查 `src/components/CanvasBoard/SkillButton.tsx` 当前监听 `skillbutton-buff-added` 的刷新逻辑，确保拖拽添加和点击添加一样会触发弹窗 Buff 列表刷新；如当前事件已复用，则不要改这里的业务逻辑。
8. 为 `DamageTab.tsx` 配套补充必要样式类，确保拖拽中的 Buff 和 drop target 有明显区分；样式改动只允许落在该组件关联样式文件中，不要全局污染。
9. 跑构建，并手动验证“单击添加 / 双击查看详情 / 长按拖到已选 Buff 区添加”三条交互互不冲突。

[验收标准 AC]
- AC1: 在 `DamageTab` 的 Buff 陈列区，长按任一 Buff 后可进入拖拽状态，短按不会误触发拖拽。
- AC2: 将 Buff 拖到“已选 Buff 区”并释放后，Buff 成功添加到当前选中的技能按钮。
- AC3: 将 Buff 拖到非目标区域后释放，不会添加 Buff，拖拽状态会正确清理。
- AC4: 单击 Buff 仍然是“添加 Buff”，双击 Buff 仍然是“打开详情弹窗”，这两条旧交互不被拖拽逻辑破坏。
- AC5: 当没有选中技能按钮时，拖拽释放不会写入 Buff，并且界面不会报错。
- AC6: 已存在同名 Buff 时，拖拽添加不会重复插入。
- AC7: 通过拖拽成功添加后，`SkillButton` 弹窗中的已选 Buff 列表能实时刷新。
- AC8: `npm run build` 通过。

[给 Cursor 的执行指令]
- 需要修改的文件（如果已知）
  - `src/components/SidePanel/components/DamageTab.tsx`
  - `src/components/SidePanel/components/DamageTab.css` 或该组件对应样式文件
  - 如需确认事件联动，只允许只读检查 `src/components/CanvasBoard/SkillButton.tsx`
- 实现顺序
  1. 先在 `DamageTab.tsx` 找到“陈列区 Buff 条目”和“已选 Buff 区”的 DOM 结构
  2. 先补长按判定，再补拖拽过程状态
  3. 再接 drop target 命中与 `addBuffToSkillButton`
  4. 最后补样式反馈和边界清理
  5. 跑构建并手测
- 必须实现的逻辑
  - 长按进入拖拽，短按不进入
  - 拖到“已选 Buff 区”释放才添加
  - 统一复用 `addBuffToSkillButton`
  - 成功添加后继续触发 `skillbutton-buff-added`
- 不能动的部分
  - 不要改 Buff 存储结构
  - 不要改 `useSkillButtonBuffs.ts` 的存储协议
  - 不要把“查看详情”改成拖拽手势
- 测试要求
  - 手测单击添加 Buff
  - 手测双击打开详情
  - 手测长按拖到“已选 Buff 区”添加成功
  - 手测拖到无效区域不添加
  - 手测无选中技能按钮时拖拽不会报错
  - 执行 `npm run build`
