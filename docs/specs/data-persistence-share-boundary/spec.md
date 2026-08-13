# 数据层持久化与分享边界 · Web LTS 合同

## 状态

已实现（2026-08-14 依据代码现状补写）。覆盖 slimming 分支 equipment/weapon/buff/operator-draft 的数据层重构提交（durable repository、share boundary、drag policy、canonical image 引用等）。

## 目标

四类官方资料库（干员、武器、装备、Buff）的编辑数据在浏览器中遵循统一的持久化与分享契约：草稿与库分离、读取必归一化、分享通过显式文件边界，且与服务器资源通道的官方库键保持一致。

## 存储键（localStorage，经持久存储适配层投影到 SQLite）

| 库 | 草稿键 | 库键 |
| --- | --- | --- |
| 武器 | `def.weapon-sheet.draft.v1` | `def.weapon-sheet.library.v1` |
| Buff | `def.buff-editor.draft.v1` | `def.buff-editor.library.v1` |
| 装备 | `def.equipment-sheet.draft.v1` | `def.equipment-sheet.library.v1` |
| 干员 | —（库即草稿集合） | `def.operator-editor.library.v1` |

官方库四键即资源通道 `OFFICIAL_LIBRARY_KEYS`，资源打包只提取这四键。

## Repository 契约

- 每个库提供 `createXxxRepository(storage)`：`loadDraft`、`loadLibrary`、`saveDraft`/（`saveLibrary`）。
- **读取必归一化**：JSON 解析后经 `normalizeXxx`（默认值补齐、路径规范化、百分比迁移仅一次）；解析失败或结构损坏回退空库/默认草稿，不抛错。
- 草稿与库分离：`draft` 是当前编辑态，`library` 是已命名条目集合。
- 装备库特殊规则：`saveLibrary` 同时写 draft 与 library 两键（同一序列化）；读取时 library 为空则回退 draft；`saveLibraryRevision` 在写入后比较当前库引用，返回 `current` / `superseded`，供"编辑期间被其他标签页/操作覆盖"的并发防护。
- 持久化适配层（`persistentStorage`）把 Storage API 投影到 SQLite；装备保存通过 `flush()` 落盘，失败不伪装成功。

## 分享边界（utils/draftShare.ts）

- 统一分享文件格式：`DraftLibraryShareFile`（`type`、`exportedAt`、`label`、`payload`）。
- 各库类型标记：`equipment-library-share.v1`、`weapon-library-share.v1`、`buff-library-share.v1` 等；解析时类型不符即拒绝（导入错误文案区分"无效文件"与"空 payload"）。
- 导出范围：`current`（当前条目）或 `all`（整库）；文件名 `<label>-<yyyy-MM-dd HH-mm-ss>.json`，非法文件名字符被替换。
- 导入只接受本类型 payload，逐条归一化后并入库；不导入路径信息，只导入数据条目。
- 分享文件是跨浏览器流转的显式边界；完整数据库备份仍由设置页负责。

## 规范引用与数据形状

- 图片引用：编辑数据保存规范相对路径（`assets/images/...`）；旧 `user-images/`、`public/images/`、绝对 URL 在归一化时被重映射或清除（canonical image references）。
- 装备库（`operatorEquipmentLibrary.ts`）：三件套 Buff（`EquipmentThreePieceBuff`，含 positive/passive/condition/countable 类别、valueMode fixed/derived、maxStacks、multiplier、extraHitConfig）与装备效果（effect1-3、Lv0-3）作为计算输入直接供给面板计算器。
- 干员库（`localOperatorAdapter` + `operatorDraftPersistence`）：模板适配为运行时干员模板；`def.operator-editor.library.v1` 同时是资源打包与配置页/计算链的共享数据源。

## 与 UI 的边界

- 编辑器只调用 repository 与 share 模块，不直接读 localStorage（explorer drag policy、编辑事务、持久化均抽离为独立模块）。
- 分享导入导出弹窗与 Sheet-Weapon 对齐；保存行为单一路径（`Ctrl+S` 手动保存，页面无自动保存）。

## 验证

- 各模块 `*.test.ts`（model/persistence/share/drag policy/editing）；`npm test` 覆盖。
- 资源打包校验（`resource:build`）确保官方四库可完整重建为规范数据包。
