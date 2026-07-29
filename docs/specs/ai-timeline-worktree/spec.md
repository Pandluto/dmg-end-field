# Timeline Worktree · Web LTS 合同

## 状态

已实现。该规格只描述 1.8 Web LTS 中仍需保持的业务合同，不包含旧 REST、Electron、AppData 或迁移入口。

## 目标

同一排轴文档可以保存多个可审计方案节点，在不直接覆盖当前画布的前提下进行修改、比较、批准、提交、checkout 和回滚。

## 数据模型

- Document：排轴工作区身份、名称、临时状态和更新时间。
- Snapshot：不可变的用户恢复点。
- Work Node：父节点、分支、base payload、working payload、状态、风险与 `contentRevision`。
- Patch：对 working payload 的结构化修改及其 diff。
- Commit：批准后的不可变应用记录。
- Checkout Ref：当前文档指向的 snapshot、work node 或 commit。
- Audit Event：创建、更新、批准、应用和回滚事件。

所有对象保存在浏览器 SQLite 中，并通过外键和事务绑定到同一 document。

## 写入合同

1. mutation 先创建或读取 child Work Node，不直接修改 live 画布。
2. 更新节点必须携带期望 `contentRevision`；不一致时拒绝过期写入。
3. patch 后必须执行 payload validator，并生成结构化 diff 与风险标记。
4. blocker、manual policy 或 ask-on-risk 警告要求明确人工批准。
5. commit 只表示记录完成；renderer 成功 apply 后才记录 checkout applied。
6. checkout、rollback 与当前工作区投影在可验证的顺序中执行，失败不得伪造已应用状态。
7. 首次持久保存临时文档时，必须通过应用内模态框命名。

## 导入导出

- snapshot、branch 和 document 三种 bundle 范围使用 v2 manifest 与 payload hash。
- 导入创建新 document，不覆盖当前工作区。
- 父节点不能逃逸 bundle；本机绝对路径必须被清理或拒绝。
- 完整数据库备份由设置页负责，不以 bundle 替代。

## 验证

- `src/agentKernel/timelineWorktree/*.test.ts`
- `npm run smoke:timeline-bundle`
- 真实浏览器创建临时排轴、命名、保存 Work Node、checkout、刷新后恢复。
