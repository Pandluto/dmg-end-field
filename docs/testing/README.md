# 测试入口

## 确定性检查

```bash
npm run check
```

它依次执行：

- 仓库与 manifest/hash 合同；
- high 级依赖审计；
- TypeScript 检查；
- 现有单元/合同测试；
- Timeline bundle smoke；
- Web/PWA production build。

## 必须使用真实浏览器的边界

以下能力不能只靠 Node 测试证明：

- OPFS 数据库刷新后持久化；
- 首次下载、解压、Cache Storage 与图片真实显示；
- Web Locks/BroadcastChannel 的双标签页占用与接管；
- 文件选择器导入图片或 SQLite；
- Service Worker 控制后的离线启动。

浏览器验收至少记录 URL、浏览器、操作、可见后置状态和控制台错误。功能专项的详细证据写入对应维护记录，不在本目录堆积一次性截图或日志。
