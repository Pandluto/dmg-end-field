# DEF 数据工具 - 当前真相手册

> 本文件是本目录唯一应被信任的操作手册。
> 历史案例、问题记录、临时脚本都只能作为补充证据，不能高于主项目实际协议。

## 单一事实源

需要核对真实协议时，以下顺序优先级最高：

1. `C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\aiCli\*FillAdapter.ts`
2. `C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\aiCli\aiCliRestAdapter.ts`
3. `GET /api/ai-cli/spec`
4. 本文件
5. `golden-examples.md` 与历史问题记录

## 系统边界

- Agent CLI 只负责 `current / library / fill / proposal`。
- 官方 `source` 数据不属于 Agent CLI；不要再依赖 `operator.data.show`、`equipment.data.show`、`/api/weapon/data/*` 这类旧入口。
- 读取当前工作数据优先用：
  - `GET /api/operator/current`
  - `GET /api/operator/library`
  - `GET /api/weapon/current`
  - `GET /api/weapon/library`
  - `GET /api/equipment/current`
  - `GET /api/equipment/library`

## 调用方式

### 首选：结构化 REST 端点

复杂 fill 流程优先使用专用 REST 端点，而不是自己拼 `command` 字符串。

- `POST /api/operator/fill/check`
- `POST /api/operator/fill/apply`
- `POST /api/weapon/fill/check`
- `POST /api/weapon/fill/apply`
- `POST /api/equipment/fill/check`
- `POST /api/equipment/fill/apply`
- `GET /api/operator/fill/template`
- `GET /api/weapon/fill/template`
- `GET /api/equipment/fill/template`

请求体统一形态：

```json
{
  "protocolVersion": 1,
  "requestId": "req-id",
  "draft": {}
}
```

### 次选：`/api/ai-cli/run`

- 只有在必须复用 CLI 命令时，才使用 `POST /api/ai-cli/run`
- `body.command` 是内部命令入口，不应再当成外部集成的首选接口

## Proposal 状态机

这是最容易被搞错的地方：

1. `fill.check` 只校验，不写库
2. `fill.apply` 只创建 proposal，不写库
3. proposal 审批和保存必须在 Web CLI (`/ai-cli`) 中完成
4. REST 不允许执行 `proposal.approve`、`proposal.save`、`y`、`n`

### 正确流程

1. `POST /api/*/fill/check`
2. `POST /api/*/fill/apply`
3. 记录返回的 `proposal.id`
4. 去 Web CLI 审批保存
5. 审批后重新读取 `library/current` 验证结果

## 写操作权限

- 写操作必须带 `?client=web-cli`
- REST 默认客户端是只读的
- 出现 `403` 时，先检查 client 参数，不要先怀疑 schema

## 分类与字段真相

### Weapon / Equipment Buff Category

- 只使用 `passive` 或 `condition`
- 不再使用 `positive`

### Operator Buff Category

- 正式可用值：`passive`、`condition`、`countable`
- `positive` 只是历史兼容输入，不能再作为新数据输出

### `countable` 的正确定位

- `countable` 是 Operator 域的正式能力
- 它不是“所有叠层都必须使用”的协议铁律
- “>=5 层建议用 countable，<=4 层可手拆”只是当前高命中策略，不是系统硬边界

### Type 白名单

- 不确定的 type 宁可不填，不要猜
- 先看 `*.fill.task` 或 `*.fill/template` 返回的受支持字段
- “描述像”不等于 type 对

## 经验规则 vs 协议规则

必须严格区分：

- 协议规则：由 adapter / validator / spec 决定
- 填写策略：为了提高命中率的经验总结

以下内容属于“策略”，不能再写成“系统必然如此”：

- 叠层达到多少层时优先用 `countable`
- 装备数据是否优先按公式生成
- 某些命名格式是否更容易通过人工审核

## 当前仍需警惕的问题

- `operator.fill` 的 attributes 仍有过“check 通过但入库后被清零”的历史问题
- 对 attributes、skills、buffs 的提交，不能只看 `check/apply` 成功，必须在审批后重新读库确认

## 最小操作准则

每次提交前都做：

1. 先读 `current` 或 `library`
2. 再读 `fill/template` 或 `fill.task`
3. 用结构化 `fill.check`
4. 再 `fill.apply`
5. 记录 `proposal.id`
6. 去 Web CLI 审批
7. 审批后重新查询库，确认写入结果

## 项目路径

- 本目录：`C:\Users\zsk86\Desktop\agent填表数据工具`
- Electron 应用：`C:\Users\zsk86\Desktop\dmg\dmg-end-field`
- REST 服务脚本：`scripts/ai-cli-rest-server.mjs`
- 路由适配器：`src/aiCli/aiCliRestAdapter.ts`

## 参考文件

- `golden-examples.md`：正确样例集合，只能作为例子，不是协议定义
- `issues.md`：问题记录与归档，不是当前接口真相
