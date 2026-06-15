[OPEN] image-bridge-miss

# 背景

- 现象：图像列表和路径表看起来已对齐，但界面图片仍不显示。
- 用户怀疑：桥接和显示层仍有问题，希望直接验证桥接 URL 是否能拿到图片。
- 范围：Electron 本地 bridge `/user-images/*`、前端生成的图片 URL、当前激活版本目录内的真实文件。

# 可证伪假设

1. 前端生成的图片 URL 不是当前 bridge 实际监听的地址或路径。
2. bridge `/user-images/*` 能收到请求，但 `resolveUserImageFileByRequestPath()` 解析到了错误文件或空路径。
3. 当前版本目录里文件实际不存在，导致 bridge 返回 404，看起来像“显示层问题”。
4. bridge 能返回 200，但 `Content-Type`、编码或文件名处理异常，导致浏览器不展示。
5. 前端展示组件最终没有使用 bridge URL，而是回退到了一个旧的静态路径。

# 当前计划

1. 读取 bridge 常量和 URL 生成逻辑。
2. 启动或复用本地 bridge 服务。
3. 用真实样本 URL 发请求，记录 HTTP 状态和返回头。
4. 对照当前版本目录中的真实文件路径，确认问题落点。

# 证据记录

- 待补充

# 结论

- 待补充
