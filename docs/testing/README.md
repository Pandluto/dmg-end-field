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

## 当前专项

- [DEF Agent 黑盒 / Mac Desktop Interop](./def-agent-blackbox.md)：当前 Agent Host/Native UI/Event API 下的授权、Turn、Event Journal、question/approval、失败和会话状态入口。
- [可复用回归测试包](./reusable-regression-suite.md)：统一说明纯合同、单分支浏览器回归和双分支同测的稳定入口、参数与扩展规则。
- [合成满乘区 SQLite 双跑样本](./synthetic-full-multiplier-regression.md)：记录测试专用干员、武器、四件装备、三件套、技能定向 Buff、硬编码公式金值和真实 SQLite 双跑口径。
- [1.8 LTS Slim 补测闭环](./v1.8-lts-slimming-test-closure.md)：逐域记录本轮新增测试、双跑口径、已确认风险与仍需平台终验的边界。
- [1.8 LTS 瘦身测试基线](./v1.8-lts-slimming-baseline.md)：记录共同基线上的确定性结果、现有缺口、分批行为门禁与 AI 实施约束。
- [1.8 LTS 瘦身工作账本](../maintenance/v1.8-lts-slimming-worklog.md)：记录旧 slim 逐提交证据、LTS 补丁保护点和迁移状态。
