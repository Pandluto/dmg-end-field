# review-todo0.5.11：持久化恢复与 UI 自动保存同步修正

[任务理解]
- 本轮只修复“timeline 已恢复/已保存，但 UI 没有同步恢复完整按钮形态”的问题。
- 主阻塞点在 `src/components/CanvasBoard/index.tsx` 的 `restoredButtons` 重建逻辑：持久化按钮被恢复到 AppState 后，因为 `isFromSandbox=false` 被 `CanvasArea.renderSkillButtons()` 过滤掉。
- 次阻塞点是恢复字段不完整：`skillIconUrl`、`element` 没有重新注入，导致按钮即使显示也无法恢复成拖入时的完整 UI。
- 分层遗留点在 `src/hooks/useTimelineData.ts`：autosave / normalize-save 仍直接调用 `setStorageJson(STORAGE_KEYS.TIMELINE_DATA, ...)`，应收口到 `saveTimelineDataService()`。

[当前结论]
- 当前持久化写入链路基本能写入 `ddd.timeline.data.v1`，但刷新恢复到 UI 的链路未闭合。
- 本轮主修复点：`CanvasBoard/index.tsx` 的 timeline -> AppState 恢复映射。
- 本轮不要重写缓存结构，不要改吸附算法，不要改 skill-button / buff-list 主从结构。

[必须改]
1. `src/components/CanvasBoard/index.tsx`：修复恢复按钮不渲染
   - 问题：`restoredButtons.push()` 中写死 `isFromSandbox: false`。
   - 调用链：`CanvasBoard.restoreTimelineData()` -> `dispatch({ type: 'ADD_SKILL_BUTTON', button })` -> `CanvasArea.renderSkillButtons()` -> `.filter((button) => button.isFromSandbox)`。
   - 原因：`CanvasArea.renderSkillButtons()` 只渲染 `isFromSandbox=true` 的按钮，导致恢复到 AppState 的持久化按钮被 UI 过滤。
   - 修正要求：从 timeline 恢复出的技能按钮必须设置 `isFromSandbox: true`。
   - 验证方式：拖入一个技能按钮 -> 刷新页面 -> 按钮必须仍显示在对应谱线/节点位置。

2. `src/components/CanvasBoard/index.tsx`：恢复 `skillIconUrl` 和 `element`
   - 问题：恢复映射只写 `id / characterName / skillType / position / staffIndex / lineIndex / nodeIndex / nodeNumber`，缺少 UI 形态字段。
   - 影响：修复 `isFromSandbox` 后，按钮仍可能缺图标、缺元素色，和从技能沙盒拖入时的按钮表现不一致。
   - 修正要求：
     - 根据 `btn.characterName` 和 `btn.skillType` 重新计算 `skillIconUrl`，优先复用现有技能图标解析函数，不允许复制一套新路径拼接逻辑。
     - 根据 `selectedCharacters.find(character => character.name === btn.characterName)` 注入 `element`。
     - `characterId` 优先使用匹配到的 `character.id`；匹配失败时再 fallback 到 `btn.characterName`。
   - 验证方式：刷新后按钮头像/技能图标、元素色、选中态样式仍与刷新前一致。

3. `src/types/index.ts`：给 `SkillButtonData` 补 `lineIndex`
   - 问题：`SkillButtonData` 当前只有 `staffIndex`，没有 `lineIndex`；恢复时只能靠 `characterName` 从 `selectedCharacters` 反推。
   - 原因：`staffIndex` 是第几组表格，`lineIndex` 是组内第几条谱线，二者不是同一字段。
   - 修正要求：
     - 在 `SkillButtonData` 中新增 `lineIndex: number`。
     - 确保新增按钮、移动按钮、跨组移动按钮写入 timeline 时都同步写入 `lineIndex`。
     - 旧数据兼容：读取旧 timeline 时如果缺 `lineIndex`，允许继续按 `characterName` 反推 fallback。
   - 验证方式：刷新前后按钮所在谱线不变；跨组拖动后刷新，按钮仍在目标组目标谱线。

4. `src/hooks/useTimelineData.ts`：autosave / normalize-save 收口到 service
   - 问题：文件仍直接 import `STORAGE_KEYS` 和 `setStorageJson`，在 autosave 和 normalize-save 中绕过 `timelineService`。
   - 具体位置：
     - autosave：`setStorageJson(STORAGE_KEYS.TIMELINE_DATA, dataToSave)`
     - normalize-save：`setStorageJson(STORAGE_KEYS.TIMELINE_DATA, normalized)`
   - 修正要求：
     - autosave 改为 `saveTimelineDataService(dataToSave)`。
     - normalize 后保存改为 `saveTimelineDataService(normalized)`。
     - 移除 `STORAGE_KEYS`、`setStorageJson` import。
   - 验证方式：`npm run build` 通过；保存日志仍触发；刷新后 timeline 恢复不回退。

[可选优化]
- 后续可把 timeline -> AppState 的恢复映射抽为纯函数，例如 `restoreSkillButtonsFromTimeline()`，但本轮不做，避免扩散。

[不要动]
- 不要改 `ddd.skill-button.v1` / `ddd.all-buff-list.v1` / `ddd.candidate-buff-list.v1` 主从结构。
- 不要改 Buff 添加、删除、清空逻辑。
- 不要改吸附算法、表格尺寸、节点坐标、拖拽视觉。
- 不要重写 `CanvasArea.renderSkillButtons()` 的过滤规则，除非能证明 `isFromSandbox` 语义需要整体废弃；本轮不做该级别改动。
- 不要把候选 Buff 或计算结果写入 `ddd.timeline.data.v1`。

[验收标准 AC]
- AC1：刷新页面后，已保存到 `ddd.timeline.data.v1` 的技能按钮必须重新显示在 UI 上。
- AC2：刷新后按钮的 `skillIconUrl`、元素色、技能类型展示与刷新前一致。
- AC3：刷新后按钮所在组、所在谱线、所在节点不变。
- AC4：跨组拖动按钮后刷新，按钮仍在目标组目标谱线。
- AC5：`SkillButtonData` 持久结构包含 `lineIndex`，旧数据缺失 `lineIndex` 时不崩溃。
- AC6：`useTimelineData.ts` 不再直接 import `STORAGE_KEYS` / `setStorageJson`。
- AC7：`npm run build` 通过。

[回归检查项]
- 拖入 A/B/E/Q 任一技能按钮，刷新页面，确认按钮仍显示。
- 拖入带图标的技能按钮，刷新页面，确认图标仍加载。
- 拖入不同元素干员的技能按钮，刷新页面，确认元素色不丢。
- 将第 1 组按钮拖到第 2/3 组谱线，刷新页面，确认位置不回退。
- 删除按钮后刷新，确认已删除按钮不恢复。
- 添加 Buff 后刷新，确认已选 Buff 仍由 `ddd.skill-button.v1.selectedBuff` 和 `ddd.all-buff-list.v1` 恢复，不从 timeline 反推。

[给 Trae 的执行指令]
1. 先修 `CanvasBoard/index.tsx` 的恢复映射：`isFromSandbox=true`、补 `skillIconUrl`、补 `element`、`characterId` 优先用匹配到的角色 id。
2. 再给 `SkillButtonData` 补 `lineIndex`，并检查新增/移动/跨组移动写入 timeline 的所有入口，保证写入字段同步。
3. 最后收口 `useTimelineData.ts` 的 autosave / normalize-save，统一调用 `saveTimelineDataService()`。
4. 每一步完成后跑 `npm run build`。
5. 最终报告必须包含：修改文件、关键字段恢复结果、旧数据兼容说明、刷新恢复手测结果。
