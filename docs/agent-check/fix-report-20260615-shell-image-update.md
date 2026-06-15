# Shell 图片更新与桥接显示修复报告

**修复日期**: 2026-06-15  
**修复人**: Executor Agent  
**范围**: Shell 图片更新、图片桥接显示、路径表刷新、开发态副作用清理  
**验证方式**: 本地静态检查 + 真实桥接 URL 验证 + `npm run build`

---

## 一、修复概览

| 优先级 | 问题 | 状态 | 主要修改文件 |
|--------|------|------|--------------|
| P0 | 已切换目标版本后仍无限提示“补基线” | ✅ 已修复 | `electron/main.cjs` |
| P0 | `/user-images/*` 桥接无法命中 release 图片，页面不显示 | ✅ 已修复 | `electron/main.cjs` |
| P1 | 图像管理显示层仍保留 `data/images` 旧语义 | ✅ 已修复 | `src/utils/imageFileService.ts`, `src/components/WeaponDraftPage.tsx`, `src/components/EquipmentSheetPage.tsx` |
| P1 | 路径表更新后内容仍偏旧，不能反映当前真实资源 | ✅ 已修复 | `electron/main.cjs` |
| P1 | 历史路径 `data/images/images/...` / `user-images/images/...` 不兼容 | ✅ 已修复 | `src/utils/assetResolver.ts`, `src/utils/imageFileService.ts` |
| P2 | 调试日志写入 `.dbg` 导致 Vite 开发态无限热刷新 | ✅ 已修复 | `vite.config.ts`, `electron/main.cjs`, `src/utils/imageBridge.ts` |

---

## 二、问题与修复

### 2.1 P0 — 图片更新检查无限要求补基线

**问题描述**  
Shell 日志已经出现“已切换到 `v1.6.x`”，但再次点击检查时，仍继续提示“补基线并切换”。

**根因分析**  
检查逻辑把“delta 包依赖基线”的判断，错误带入了“当前版本已经等于远端版本”的场景。  
也就是说，`hasUpdate` 已经不成立，但 `action` 仍可能保留成 `download-baseline`。

**修复方案**  
在 `checkForImageReleaseUpdates()` 中改为先判断是否真的还有更新，再决定是否保留 `deltaReadiness.action`：

```js
const hasUpdate = remoteManifest.assetVersion !== current.assetVersion || currentTargetIncomplete;
const action = currentTargetIncomplete
  ? 'repair-current'
  : (hasUpdate ? deltaReadiness.action : 'update');
```

**结果**  
- 已切换到目标版本后，再检查不会继续误报“补基线”
- 当前版本损坏时仍可走“修复素材”

---

### 2.2 P0 — 桥接 URL 返回 404，release 图片不显示

**问题描述**  
图像路径表和版本目录已经切到 `asset-releases/versions`，但界面图片仍不显示。

**运行时证据**  
实际验证过同一张图：

```text
http://127.0.0.1:31457/user-images/img-equipment/50式应龙护手·壹型.png  -> 404
http://127.0.0.1:31457/assets/images/img-equipment/50式应龙护手·壹型.png -> 200
```

这说明：
- 文件本身存在于当前激活版本目录
- 失败点在 `/user-images/*` 桥接解析，不在资源包

**根因分析**  
`resolveUserImageFileByRequestPath()` 之前用同一套相对路径同时做：
- 请求 URL 匹配
- 磁盘真实路径拼接

对 `release/user/legacy` 来源来说，这两层语义不同：
- URL 匹配需要去掉 `assets/images/`
- 磁盘拼接不能去掉 `images/`

**修复方案**  
将桥接解析拆成两套路径函数：

```js
const getRequestRelativePath = (entry) => { ... };
const getFileRelativePath = (entry) => { ... };
```

其中：
- `getRequestRelativePath()` 用于匹配 `/user-images/*`
- `getFileRelativePath()` 用于 `path.resolve(rootDirectory, ...)`

**结果**  
修复后，真实桥接 URL 已恢复为 `200`，release 图片可正常取到字节。

---

### 2.3 P1 — 前端显示层仍保留旧路径语义

**问题描述**  
虽然主目录和路径表已经切到 `asset-releases/versions`，但界面中仍出现 `data/images` 之类旧展示语义。

**修复方案**  
调整前端显示根与资源来源判断：

- `src/utils/imageFileService.ts`
  - `DISPLAY_ROOT` 从 `data/images` 改为 `asset-releases/versions`
  - `release` 资源纳入用户侧资源判断
- `src/components/WeaponDraftPage.tsx`
- `src/components/EquipmentSheetPage.tsx`
  - 将 `release` 与 `user/legacy` 一起按用户资源处理

**结果**  
- 前端路径展示和当前实际主目录一致
- `release` 不再被误当成 builtin

---

### 2.4 P1 — 路径表没有按当前真实资源自动刷新

**问题描述**  
更新、导入、删除之后，路径表虽然会刷新，但输出内容仍偏向旧数据，无法真实反映当前资源来源。

**根因分析**  
`syncImageManifest()` 之前写出的 `_manifest.json` 只保留了偏旧的扫描结果，不能完整反映当前扫描到的资源信息。

**修复方案**  
改为基于 `scanAllImageAssets()` 当前扫描结果全量重建路径表，写入：

- `relativePath`
- `canonicalPath`
- `publicUrl`
- `source`
- `rootDirectory`
- `rootPriority`
- `writable`

**结果**  
路径表会跟随当前扫描结果自动更新，能正确体现：
- `release`
- `user`
- `legacy`
- `builtin`

---

### 2.5 P1 — 历史旧路径不兼容，导致修完桥接后仍有图片不显示

**问题描述**  
即使桥接本身已经修好，历史记录里仍可能存在旧路径：

- `data/images/images/...`
- `user-images/images/...`

这些路径会被前端继续拼成错误的 `/user-images/images/...` 请求。

**修复方案**

1. `src/utils/assetResolver.ts`

对旧路径进行归一化：

```ts
let relPath = normalized.slice(matchedPrefix.length);
if (relPath.startsWith('images/')) {
  relPath = relPath.slice('images/'.length);
}
```

2. `src/utils/imageFileService.ts`

对旧 `canonicalPath` 做同样兼容：

```ts
const rel = entry.canonicalPath.slice('user-images/'.length);
return rel.startsWith('images/') ? rel.slice('images/'.length) : rel;
```

**结果**  
旧路径数据不需要手工批量迁移，也能被前端自动纠正到正确桥接 URL。

---

### 2.6 P2 — 调试日志写入 `.dbg` 导致开发态无限刷新

**问题描述**  
为定位桥接问题临时加入了调试日志打点，日志文件持续写入 `.dbg`，被 Vite watch 到后触发整页热刷新。

**影响**  
- 开发控制台持续出现：

```text
[vite] page reload .dbg/trae-debug-log-image-bridge-preview.ndjson
```

- 页面表现为无限刷新

**修复方案**  
1. 删除临时调试上报代码  
2. 停掉调试服务进程  
3. 在 `vite.config.ts` 中忽略 `.dbg/**`

```ts
watch: {
  ignored: ['**/data/localdata/**', '**/.dbg/**'],
},
```

4. 删除临时调试文件：
- `debug-image-bridge-preview.md`
- `.dbg/image-bridge-preview.env`
- `.dbg/trae-debug-log-image-bridge-preview.ndjson`

**结果**  
开发态无限热刷新问题已清除。

---

## 三、最终行为

本轮收口后，当前行为如下：

- Shell 图片更新检查不会在已切换目标版本后继续无限提示“补基线”
- `/user-images/*` 桥接可以正确命中 release 图片
- 图像管理与前端显示层已对齐 `asset-releases/versions` 语义
- 历史旧路径可自动兼容，不要求立即做批量迁移
- 路径表会按当前扫描结果自动重建
- 调试链路副作用已清理，不再刷爆 Vite

---

## 四、验证结果

### 4.1 静态验证

- `electron/main.cjs` 诊断通过
- `src/utils/assetResolver.ts` 诊断通过
- `src/utils/imageFileService.ts` 诊断通过
- `src/utils/imageBridge.ts` 诊断通过
- `vite.config.ts` 诊断通过

### 4.2 构建验证

```bash
npm run build
```

结果：✅ 通过

### 4.3 运行时验证

实际请求验证过桥接地址：

```text
http://127.0.0.1:31457/user-images/img-equipment/50式应龙护手·壹型.png
```

结果：✅ 可返回图片内容

---

## 五、后续建议

本轮已经把主要线上问题修通，但目录职责仍建议后续继续收口。

建议下一步只考虑两件事：

1. 彻底确认图片更新是否继续保留增量/基线模型  
2. 明确 `asset-releases`、`user-images`、`data/images` 的长期职责边界

如果后续继续收口，优先建议：

- 保持“每个版本一个完整目录”
- 检查逻辑只认“当前版本号 + 当前版本完整性”
- 不再把“补基线”暴露成长期用户态概念

---

## 六、关联文档

- [Shell 图片更新 Spec](file:///c:/Users/zsk86/Desktop/dmg/dmg-end-field/docs/specs/shell-image-update/spec.md)
- [ImageManager 架构说明](file:///c:/Users/zsk86/Desktop/dmg/dmg-end-field/docs/image-manager-architecture.md)
