# Agent Notes

- 默认不写测试，除非本次代码改动确实非常需要测试覆盖。
- 默认不使用 superpowers；只有在编写 specs / tasks 且确实必要时才使用。
- 开启新一轮 spec / tasks 时，必须先等待用户提供标题、目标或具体内容；如果用户没有给出规格内容，只能创建空壳或询问补充，不能自行编写需求、范围、验收标准或任务拆分。
- 测 DEF agent / typed tools 能力时，按 `docs/testing/def-agent-blackbox.md` 执行；Mac 桌面联调使用其中的“Mac Desktop Interop Route”，通过 `DefCodexInteropProtocol v1` 读取 turn、工具、问题和失败，再用 Computer Use 确认当前真实 UI。旧 `/def-agent/workbench-test/prompt` 只作兼容，不是新测试入口；`AGENTS.md` 只记录工作习惯，详细测试口径放测试文档里。
- 自动提交时机：research / spec+task 完成时、task 对应 coding 完成时、每次修复完成时，都要自动提交。
- `npm run electron:dev` 是最常用的常驻开发指令，一般长时间挂载；已运行时不要主动关闭或重启。若任务需要主界面但 3030 未监听，可以主动启动它；若遇到阻塞，先一次性杀掉常用端口相关进程，再重启即可。
