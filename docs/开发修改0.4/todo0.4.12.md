# todo0.4.12 - 缓存模型重构

## 任务理解
- 目标：将 `skillbutton / buff` 持久化模型收口成两个总表缓存
- 最终结构：
  - `timeline.data`：只保存排轴引用和位置
  - `skill-button` 总表：存放所有 button
  - `buff-list` 总表：存放所有 buff
  - button 的 `selectedBuff` 只保存 `buffId` 引用

---

## 实现步骤

### Step 1: 定义类型和 Storage Key 规范

**1.1 修改 `src/types/storage.ts`**
- [ ] 扩展 `SkillButtonBuff` 类型，补全字段：
  - 已有：id, name, displayName, sourceName, level, type, value
  - 新增：description, source, condition
- [ ] 新增 `PersistedSkillButton` 类型：
```typescript
export interface PersistedSkillButton {
  id: string;
  characterName: string;
  skillType: string; // A/B/E/Q
  staffIndex: number;
  nodeIndex: number;
  nodeNumber: number;
  position: { x: number; y: number };
  selectedBuff: string[]; // Buff ID 引用列表
  createdAt?: number;
  updatedAt?: number;
}
```

**1.2 修改 `src/constants/storage-keys.ts`**
- [ ] 新增 key：
  - `SKILL_BUTTON_TABLE` = 'def.skill-button.v1'
- [ ] 确认已有：
  - `ALL_BUFF_LIST` = 'def.all-buff-list.v1'

---

### Step 2: 新增 Storage 总表读写接口

**2.1 修改 `src/utils/storage.ts`**
- [ ] 新增 `skill-button` 总表接口：
  - `getSkillButtonTable(): Record<string, PersistedSkillButton>`
  - `setSkillButtonTable(table): void`
  - `getSkillButtonById(buttonId): PersistedSkillButton | null`
  - `upsertSkillButton(button): void`
  - `removeSkillButtonById(buttonId): void`
- [ ] 新增 `buff-list` 总表接口：
  - `getAllBuffList(): SkillButtonBuff[]`
  - `setAllBuffList(list): void`
  - `getBuffById(buffId): SkillButtonBuff | null`
  - `upsertBuff(buff): void`
  - `removeBuffById(buffId): void`
- [ ] 标记废弃：
  - `getSkillButtonBuffMap` / `setSkillButtonBuffMap` 仅迁移时读取

---

### Step 3: 调整 `useTimelineData.ts`

**3.1 修改 `src/hooks/useTimelineData.ts`**
- [ ] `SkillButtonData` 移除 `buffIds` 字段
- [ ] `addSkillButton` 回调：
  - 更新 `timeline.data`（保留排轴引用）
  - 同时创建 `PersistedSkillButton` 并写入 `skill-button` 总表
- [ ] `removeSkillButton` 回调：
  - 从 `timeline.data` 移除引用
  - 同时 `removeSkillButtonById` 删除独立缓存
- [ ] `updateSkillButtonPosition` 回调：
  - 更新 `timeline.data` 中的位置
  - 同时更新 `skill-button` 总表中的 button
- [ ] `moveSkillButtonToStaff` 回调：
  - 更新 `timeline.data` 中的 staffIndex/nodeIndex
  - 同时更新 `skill-button` 总表中的 button
- [ ] 移除 `updateButtonBuffIds`
- [ ] 新增 `updateSelectedBuffList(buttonId, buffIds)`：
  - 读取现有 `PersistedSkillButton`
  - 更新 `selectedBuff`
  - 写回 `skill-button` 总表

---

### Step 4: 重写 `useSkillButtonBuffs.ts`

**4.1 修改 `src/hooks/useSkillButtonBuffs.ts`**
- [ ] `getButtonBuffs(buttonId)` 改为：
  1. 读取 `skill-button` 总表获取 `selectedBuff`
  2. 根据 buffIds 从 `buff-list` 总表解引用
  3. 返回完整 Buff 列表
- [ ] `addBuff(buttonId, buffData)` 改为：
  1. 生成稳定 buffId
  2. `upsertBuff(buff)` 写入 `buff-list` 总表
  3. 更新 button 的 `selectedBuff`（追加 buffId）
- [ ] `removeBuff(buttonId, buffId)` 改为：
  1. 从 button 的 `selectedBuff` 移除 buffId
  2. 检查 buffId 是否还被其他 button 引用
  3. 无引用则 `removeBuffById` 清理
- [ ] 移除或改写 `syncBuffsFromTimeline()`

---

### Step 5: 修改 DamageTab.tsx 和 SkillButton.tsx

**5.1 修改 `src/components/SidePanel/components/DamageTab.tsx`**
- [ ] `addBuffToSkillButton` 改为：
  - 生成完整 Buff 对象（包含 description, source, condition, level）
  - 调用新的 `addBuff` 接口
  - 不再使用旧的 `addSkillButtonBuff`

**5.2 修改 `src/components/CanvasBoard/SkillButton.tsx`**
- [ ] `loadBuffList` 改为调用新的 `getButtonBuffs`
- [ ] `removeBuff` 改为调用新的 `removeBuff` 接口

---

### Step 6: 旧缓存迁移

**6.1 新增迁移逻辑 `src/utils/migrateStorage.ts`**
- [ ] 创建迁移函数 `migrateOldBuffStorage()`：
  - 读取 `def.skill-button-buffs.v1`（旧格式）
  - 读取 `def.timeline.data.v1` 中的 `buttons[].buffIds`
  - 迁移到 `def.skill-button.v1` 总表
  - 迁移到 `def.all-buff-list.v1` 总表
  - button 的 `selectedBuff` 只回填 buffId
  - 幂等：旧 key 不存在时直接跳过
  - 迁移完成后清空旧 key

**6.2 在 `CanvasBoard/index.tsx` 调用迁移**
- [ ] 在 `loadTimelineData()` 之后，恢复按钮之前调用迁移

---

### Step 7: 清理旧结构

**7.1 标记废弃**
- [ ] `SKILL_BUTTON_BUFFS` key 仅迁移时读取
- [ ] `getSkillButtonBuffMap` / `setSkillButtonBuffMap` 标注废弃

---

## 验收标准 (AC)

- [ ] AC1: `timeline.data` 中不再保存 button 完整配置和 Buff 实体
- [ ] AC2: 所有 button 统一保存在 `skill-button` 总表中
- [ ] AC3: 所有 buff 统一保存在 `buff-list` 总表中
- [ ] AC4: `skill-button` 总表中每个 button 的 `selectedBuff` 只保存 `buffId`
- [ ] AC5: `SkillButton` 弹窗不再依赖 `def.skill-button-buffs.v1`
- [ ] AC6: 刷新后按钮位置和已选 Buff 正常恢复
- [ ] AC7: 跨谱线移动后 button `id` 和 `selectedBuff` 不丢
- [ ] AC8: 删除按钮时相关缓存正确清理
- [ ] AC9: 旧缓存自动迁移，不产生脏数据
- [ ] AC10: `npm run build` 通过

---

## 回归检查

- [ ] 第二个干员拖技能不崩
- [ ] debounce 自动保存正常
- [ ] 跨线移动不丢 Buff
- [ ] 刷新恢复按钮正常
- [ ] 右键删除、锁定、弹窗正常
- [ ] DamageTab 刷新 Buff 列表正常

