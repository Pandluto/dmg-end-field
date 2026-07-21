const glossary = [
  ["Agent", ["Agent"], "基础概念", "让模型能够连续观察、调用工具并根据结果继续行动的完整运行系统。", "DEF 复用 OpenCode 的会话与循环，再接入自己的领域工具和产品边界。", "模型负责生成下一步；Agent 还包括 Runtime、状态、工具和权限。"],
  ["Runtime", ["Runtime"], "运行机制", "托住模型执行的外层程序，负责会话、循环、工具执行、取消、重试与状态更新。", "OpenCode Runtime 承担通用 Agent 能力，DEF Adapter 补入产品上下文。", "它不是模型本身，也不是单纯的聊天界面。"],
  ["Session", ["Session"], "会话状态", "一段可持续的 Agent 会话，保存消息、工具调用、结果与相关状态。", "DEF Session 还会绑定 Work Node、Checkout 与 Harness 坐标。", "Session 是整段会话；Turn 是其中一次用户输入到最终回复。"],
  ["Turn", ["Turn"], "会话状态", "从一次用户输入开始，到 Agent 给出最终回复为止的一轮处理。", "一个 Turn 内可以发生多次模型生成和多次工具调用。", "Turn 不是一次模型 API 请求；Agent Loop 可能在其中往返很多次。"],
  ["Agent Loop", ["Agent Loop"], "核心流程", "模型提出下一步，程序执行工具，再把结果交还模型，直到满足停止条件的循环。", "DEF 沿用 OpenCode 的循环，并在其中接入领域工具、审批和产品校验。", "它不只是 while true；还需要终止、错误、取消和步骤上限。"],
  ["Tool Use", ["Tool Use"], "工具调用", "模型用结构化请求选择一个外部能力，Runtime 执行后再把结果送回模型。", "读取配装、查询时间线和准备 Work Node 修改，都通过工具进入产品边界。", "模型只是提出调用，真正执行的是程序中的 handler。"],
  ["Tool", ["Tool"], "工具调用", "一项带名称、说明和参数规则的可调用能力。", "填表服务把读取、校验和创建提案等操作开放成 Tool。", "Tool 描述怎样调用；真正执行的仍是项目业务代码。"],
  ["Typed Tool", ["Typed Tool", "Typed Tools"], "工具调用", "用明确 Schema 约束名称、参数与返回结构的工具。", "DEF 只向产品 Agent 暴露角色、装备、伤害和排轴等领域工具。", "类型保证输入形状，不保证调用已经获准，也不保证业务结果正确。"],
  ["Schema", ["Schema"], "工具调用", "描述参数名称、类型、必填项和结构约束的规则。", "MCP Server 用它检查 Client 提交的 Tool 参数。", "Schema 只检查参数，不代表用户已经批准操作。"],
  ["Handler", ["handler", "Handler"], "工具调用", "工具在程序里的真实实现函数，接收已验证参数并执行读取或修改。", "模型看见工具描述，但不会直接看到或执行 handler 源码。", "工具定义告诉模型怎样调用；handler 决定程序实际上做什么。"],
  ["Tool Result", ["Tool Result"], "工具调用", "工具执行后的结构化结果，会重新进入 Session 供模型继续判断。", "DEF 工具结果包含产品事实、风险或校验证据，而不只是自然语言成功提示。", "返回成功不是 Postcondition；仍可能需要重读产品状态。"],
  ["Registry", ["Registry"], "工具调用", "保存可注册能力及其元数据的目录，Runtime 再按当前场景筛选实际暴露项。", "DEF 工具进入注册表后，仍要经过 Agent、Session 与权限范围筛选。", "注册表示系统知道它，不等于每一轮模型都能调用它。"],
  ["Permission", ["Permission"], "权限", "对一次具体调用作出允许、拒绝或询问用户的运行时决定。", "高影响 DEF 修改通过 OpenCode 原生 Permission 暂停并等待用户选择。", "工具暴露决定有没有能力；Permission 决定这一次能不能继续。"],
  ["Approval", ["Approval"], "权限", "用户或外部授权方对明确操作内容给出的批准。", "用户看到 Work Node 的差异与风险后，才决定是否允许 Apply。", "模型不能在自己的回复中宣布用户已经同意。"],
  ["Hook", ["Hook"], "运行机制", "在模型请求、工具执行前后等固定位置插入额外逻辑的扩展点。", "可以记录调用、补上下文或触发检查；授权语义仍由 Permission 表达。", "Hook 是介入位置，不天然等于权限系统。"],
  ["Prepare", ["Prepare"], "安全修改", "先生成可检查的修改草稿、差异和风险，而不立刻改变当前产品状态。", "DEF 把准备结果放进 Work Node，并生成后续 Apply 所需的受控凭证。", "Prepare 是预览与绑定；Apply 才是正式应用。"],
  ["Apply", ["Apply"], "安全修改", "把已经准备并获准的修改正式应用到指定产品目标。", "执行前核对 Session、节点版本和内容，执行后再检查真实产品状态。", "Apply 接口返回成功，仍不自动等于用户眼前已经正确改变。"],
  ["Context", ["Context"], "上下文", "模型本次请求真正能看到的消息、规则、工具结果和动态材料。", "DEF 每轮组合稳定规则、当前任务、产品坐标和按需知识。", "Session 保存发生过什么；Context 只表示这一刻送给模型什么。"],
  ["System Prompt", ["System Prompt"], "上下文", "给模型设定身份、基本规则、能力边界和通用行为要求的高优先级输入。", "稳定前缀尽量保持不变，当前任务和动态知识在后面按需拼装。", "它能引导行为，却不能替代代码权限和产品事实校验。"],
  ["Context Window", ["Context Window"], "上下文", "模型单次请求能够接收和生成的 Token 总容量。", "长会话接近上限时，需要压缩旧对话和大段工具输出。", "窗口大小不是长期记忆容量，也不是数据库容量。"],
  ["Compaction", ["Compaction"], "上下文", "把较早对话总结、裁剪或替换，给当前推理腾出空间的过程。", "完整 Session 仍可留存，但不再把所有原文送进每一轮请求。", "Compaction 改的是模型输入，不等于删除历史记录。"],
  ["Prompt Cache", ["Prompt Cache"], "上下文", "复用连续请求中相同提示前缀，以降低延迟或推理成本的缓存。", "稳定的基础规则和通用工具说明更容易命中缓存。", "它是性能优化，不负责跨会话记忆。"],
  ["Skill", ["Skill"], "知识路由", "按任务场景发现并加载的工作方法，包含流程、边界和可选资源。", "开发 Skill 与 DEF 产品 Skill 分目录维护，权限也完全不同。", "Skill 指导怎样做，不会自动获得新的工具权限。"],
  ["Knowledge", ["Knowledge"], "知识路由", "角色机制、武器属性、项目结构等可以按需读取的外部事实。", "DEF 的游戏资料与开发参考按身份和任务路由加载。", "Knowledge 是可查事实；Skill 是工作方法；Memory 是跨时间保留的信息。"],
  ["Memory", ["Memory"], "知识路由", "跨会话仍值得保留的用户偏好、反馈或项目状态。", "只保存稳定且以后仍有用的信息，不把每次工具输出都当记忆。", "Memory 不等于当前 Context，也不等于完整 Session 历史。"],
  ["Plan", ["Plan"], "任务组织", "描述任务顺序、依赖和阶段目标的执行路线。", "DEF 当前没有把复杂 Plan 作为主要产品入口，主链仍是单 Session 工具循环。", "Plan 说明准备怎么走，不负责亲自执行每一步。"],
  ["Todo", ["Todo"], "任务组织", "展示任务项及其待办、进行中或完成状态的进度清单。", "它可以帮助长任务避免遗漏，但并不自动形成独立执行单元。", "Todo 记录状态；Task 划定可交付工作边界。"],
  ["Task", ["Task"], "任务组织", "拥有明确输入、目标和返回结果的一块可独立交付工作。", "只有边界清楚的检查或研究，才适合从主 Session 拆出去。", "任务多不等于应该并行；共享状态过多时，拆分会增加同步成本。"],
  ["Subagent", ["Subagent"], "任务组织", "在独立上下文中接收一项 Task，并把结论返回父 Agent 的执行者。", "DEF 当前收窄了产品侧 Subagent 能力，主要工作仍在单 Session 完成。", "独立上下文不代表权限自动扩大。"],
  ["Context Isolation", ["Context Isolation"], "任务组织", "让不同执行者只拿到完成各自任务所需的上下文，减少相互污染。", "父 Agent 筛选输入，子 Agent 只回传结论，不必复制完整消息历史。", "它隔离信息，不天然隔离或扩大工具权限。"],
  ["Work Node", ["Work Node"], "DEF 概念", "承载一次候选修改的隔离草稿节点，保存基线、工作内容和校验证据。", "高影响修改先进入节点，用户审查后再决定 Checkout、Apply 或放弃。", "Work Node 不是 Git worktree，也不是当前界面状态本身。"],
  ["Checkout", ["Checkout"], "DEF 概念", "指向当前应用目标或选中节点的产品坐标。", "Session 在继续执行前刷新 Checkout，避免旧对话操作错误节点。", "Checkout 是引用和切换动作，不是 Work Node 本身。"],
  ["Sidecar", ["Sidecar"], "DEF 概念", "伴随主程序运行的适配进程或服务，用来连接通用 Runtime 与产品能力。", "它管理 OpenCode Worker、注入 DEF 上下文，并接入领域工具。", "Sidecar 负责连接，不复制另一套产品事实源。"],
  ["Postcondition", ["Postcondition", "回读验证"], "安全修改", "操作执行后需要重新读取事实确认的结果条件。", "填表写入后，Host 会重新读取产品数据。", "参数校验发生在执行前；回读验证发生在执行后。"],
  ["Worker", ["Worker"], "运行机制", "实际承载 Session、Agent Loop 和内存中等待状态的本地执行进程。", "Sidecar 创建并管理 OpenCode Worker；退出后内存中的审批等待也会消失。", "恢复 Worker 身份与记录，不等于恢复崩溃前的调用栈。"],
  ["Tool Part", ["Tool Part"], "运行状态", "Message 中记录单次工具调用输入、状态和结果的结构化部分。", "它会经历 pending、running、completed 或 error，并持久化到会话记录。", "数据库里的 running 记录不是可继续执行的函数检查点。"],
  ["callID", ["callID"], "运行状态", "一次工具调用的关联标识，用来把异步结果放回正确的调用位置。", "同一轮出现多个工具时，OpenCode 用它区分各自的 Part 与结果。", "它标识工具调用，不标识整轮用户请求。"],
  ["Abort", ["Abort", "abort"], "错误恢复", "中止仍在运行的请求，并清理 Runtime 中未完成的执行现场。", "未结束的 Tool Part 会被标记为中断或错误，避免界面永远运行中。", "Abort 不是产品事务回滚，已经发生的副作用仍需核对。"],
  ["clientTurnId", ["clientTurnId"], "错误恢复", "客户端为一次 Turn 分配的稳定身份，用于查询是否已经被服务端接收。", "Prompt 响应不确定时，先查 Transcript 中是否已有该 Turn，再决定是否重发。", "它避免重复投递用户请求，不负责关联单个 Tool Call。"],
  ["Transcript", ["Transcript"], "错误恢复", "按顺序保存的会话消息、工具事件与结果记录。", "外部联调协议用它确认 Prompt 是否进入 Session，以及 Agent 最终做了什么。", "Transcript 是历史证据，不是当前产品状态。"],
  ["Harness", ["Harness"], "DEF 概念", "把角色、规则、工作流、工具指南、知识路由和响应策略组合成的运行包。", "新 Session 绑定确定的 Harness 内容 hash，候选升级不会中途改变旧会话。", "它调整 Agent 的运行方式，不是重新训练模型权重。"],
  ["State Machine", ["state machine", "State Machine"], "运行机制", "把系统可处于的阶段及允许迁移明确下来，避免只凭一个开关继续执行。", "DEF 用它约束 AI 模式进入、工具执行、超时核对与恢复的顺序。", "它不是一定要安装的库；也不是把所有层状态塞进一个枚举。"],
  ["Token", ["token", "Token"], "权限", "由系统签发、可验证范围与有效期的临时通行证。", "DEF 分别用内部访问令牌、会话归属和批准通行证保护不同边界。", "这里的 Token 不是模型生成文字时消耗的 token。"],
  ["Cache", ["cache", "Cache"], "运行机制", "为了更快读取而保留的可重新生成副本。", "DEF 的页面工作副本缓存正在显示和编辑的队伍，但正式依据仍是 SQLite 当前节点。", "缓存可以过期，不能承担数据身份或正式写入权限。"],
  ["Cache Invalidation", ["cache invalidation", "Cache Invalidation"], "运行机制", "当缓存对应的数据身份改变时，明确让旧副本失效的规则。", "切换 timeline、当前节点或正式工作区状态后，DEF 必须重新从当前正式节点加载页面工作副本。", "它不是定时刷新，更不是用旧页面内容覆盖正式节点。"],
  ["SSE", ["SSE"], "HTTP 流式响应", "服务器通过 HTTP 响应流连续向客户端发送事件。", "Streamable HTTP 可以用它返回多条 MCP 消息。", "SSE 承载消息流，不替代 JSON-RPC，也不是第三种标准 Transport。"],
  ["Reconciliation", ["reconciliation", "Reconciliation"], "错误恢复", "超时或中断后按准确身份继续查明最终状态的后续核对过程。", "DEF 依 commandId、会话归属、timeline 和节点版本核对迟到命令是否真的写出候选结果。", "它不是盲目重试，更不能把未确定状态说成零变化。"],
  ["Working Projection", ["working projection", "Working Projection"], "DEF 概念", "React 页面内存中正在展示和编辑的队伍、技能、Buff 与配装。", "它必须与 SQLite 当前正式节点收敛后，AI 才能读取或修改同一棵工作树。", "它是页面工作副本，不是 SQLite 正式节点，也不是 AI 会话归属。"],
  ["Session Binding", ["session binding", "Session Binding"], "DEF 概念", "AI 会话与一条正式 timeline 的不可漂移归属关系。", "它限制 AI 只能读取和操作所属正式工作区的 Work Node 树。", "它不是当前页面缓存，也不能在 session 存续期间静默改绑。"],
  ["Throughput", ["throughput", "Throughput"], "运行机制", "单位时间内系统处理请求或命令的能力，以及高并发时的排队压力。", "DEF 更关心同一会话、同一 timeline 的迟到命令不会撞到用户的新操作。", "它不只是服务很多用户的性能指标，也关乎单个桌面会话的并发安全。"],
  ["Sliding Window", ["sliding window", "Sliding Window"], "运行机制", "只统计最近一小段时间内事件的限流、去重或计数方法。", "DEF 可以按会话和 timeline 管理重复读取、重复批准和频繁 SSE 重连。", "它是并发保护手段，不替代正式节点、会话归属和权限校验。"],
  ["MCP", ["MCP"], "标准协议", "让客户端发现能力、调用工具并接收结果的标准协议。", "本项目用它把填表能力开放给外部 Codex。", "MCP 负责连接能力，不负责批准和正式写入。"],
  ["MCP Client", ["MCP Client", "MCP client", "Client"], "标准协议", "连接 MCP Server、读取资源并发起工具调用的客户端。", "Codex 或其他标准客户端只能读取、校验和创建填表提案。", "客户端发起提案，不等于用户已经批准或保存。"],
  ["MCP Server", ["MCP Server", "MCP server", "Server"], "标准协议", "按照 MCP 约定开放 Tool 和 Resource 的能力服务。", "本项目的 Server 只开放填表所需的能力。", "Server 开放什么，Client 才能发现和调用什么。"],
  ["JSON-RPC", ["JSON-RPC"], "消息格式", "用统一字段表达请求、响应、错误和通知的消息格式。", "MCP Client 与 Server 用它表达发现和调用。", "它规定消息长什么样，不规定消息走哪条通道。"],
  ["Transport", ["Transport"], "传输", "在 Client 与 Server 之间搬运 MCP 消息的通信方式。", "本项目提供 Streamable HTTP，并用 STDIO Facade 兼容标准输入输出客户端。", "Transport 负责传递，不决定 Tool 的权限。"],
  ["Streamable HTTP", ["Streamable HTTP"], "传输", "通过 HTTP 请求和可持续响应承载 MCP 消息的传输方式。", "Legacy Fill MCP 的权威本地入口是 127.0.0.1:17323/mcp。", "它定义连接方式，不决定工具权限和产品授权。"],
  ["STDIO", ["STDIO"], "传输", "通过标准输入和标准输出收发 MCP 消息的本地传输方式。", "本项目用它兼容只支持本地进程连接的 Client。", "STDIO 是标准 Transport，不是填表业务实现。"],
  ["STDIO Facade", ["STDIO Facade"], "传输适配", "接收 STDIO 消息，再转发到另一种传输入口的适配程序。", "本项目用它把 STDIO Client 接到同一套 Streamable HTTP 填表服务。", "Facade 只转换传输方式，不是第二套 MCP Server。"],
  ["Resource", ["Resource", "Resources"], "标准协议", "由 MCP Server 提供、适合读取的命名内容或版本化材料。", "填表服务用它提供模板、策略、示例和 owner 范围内的提案状态。", "Resource 侧重读取；Tool 表达一次带参数的操作。"],
  ["Proposal", ["Proposal", "proposal"], "审核", "经过结构校验、等待用户检查和决定的候选结果。", "MCP 可以创建提案，但不能批准、拒绝或写入产品。", "提案创建成功不表示产品数据已经改变。"],
  ["MCP Host", ["MCP Host", "Host"], "标准协议", "用户直接使用的 AI 应用，负责管理模型、连接和交互。", "Codex 是 Host，并为填表 Server 创建 MCP Client。", "Host 不是 Server；MCP Client 是 Host 内部的连接组件。"],
  ["Function Calling", ["Function Calling"], "模型调用", "模型用结构化结果表达自己想调用哪个函数。", "模型决定使用填表 Tool 后，由 Host 把调用交给 MCP Client。", "它表达调用意图；MCP 负责发现能力并把调用送到 Server。"],
  ["OAuth", ["OAuth"], "授权", "让 Client 代表用户取得受限访问令牌的授权框架。", "远程 Streamable HTTP Server 可以用它限制访问身份和范围。", "OAuth 保护连接访问，不代表用户批准了某次业务写入。"],
  ["Proposal Repository", ["Proposal Repository"], "审核", "独立保存提案内容、版本、状态和审计记录的事实源。", "legacy-fill-service 使用 SQLite Repository 隔离并持久化各 owner 的提案。", "它不保存 DEF Work Node，也不是产品领域数据本身。"],
  ["Review Manifest", ["Review Manifest"], "审核", "固定一次审核实际对应的领域、基线、候选内容和摘要。", "Host capability 会绑定 manifest digest，避免审核内容变化后继续沿用旧批准。", "它描述审核对象，不负责自行授予写入权限。"],
  ["Action Capability", ["Action Capability", "action capability"], "权限", "绑定明确对象、版本和有效期的一次性操作通行证。", "MCP 填表页面确认时，它绑定 proposal、review session、revision 和 manifest digest。", "它比笼统的登录态更窄，也不能被 MCP Client 自行签发。"],
  ["Revision", ["Revision", "revision"], "并发控制", "表示提案或产品快照当前处于哪一版的递增身份。", "Host 用它拒绝页面基于旧提案发起的迟到写入。", "Revision 标识版本；Digest 标识内容摘要。"],
  ["Digest", ["Digest", "digest"], "并发控制", "由内容计算出的稳定摘要，用于检查审核对象是否被替换或改变。", "Review manifest digest 会被绑定进一次性写入 capability。", "它用于内容身份校验，不是加密产品数据。"],
  ["CAS", ["CAS"], "并发控制", "Compare-And-Set；只有当前版本仍等于预期版本时才执行更新。", "提案状态和 Host 写入用它阻止旧页面覆盖新 revision。", "CAS 防止竞态，不替代用户 Approval 和写后 Postcondition。"],
  ["Idempotency", ["幂等机制", "幂等"], "重复保护", "同一个操作重复到达时，只产生一次业务结果的约束。", "Proposal 创建和 Host 写入用它识别重试。", "幂等不是拒绝所有重复输入，而是识别同一次请求。"],
  ["Audit", ["审计记录", "审计"], "结果证据", "记录谁在何时对哪份内容执行了什么操作。", "MCP 填表链会记录提案、批准版本、写入与回读结果。", "审计用于追溯，不替代权限检查和回读验证。"],
  ["Outbox", ["Outbox"], "错误恢复", "在本地持久化尚未成功发布或确认的结果，供稍后继续投递。", "产品写入已成功但快照或审计中断时，MCP 填表页面用它恢复一致性。", "Outbox 用于补齐记录，不应盲目重做已经发生的领域写入。"]
].map(([term, aliases, kind, meaning, project, contrast]) => ({ term, aliases, kind, meaning, project, contrast }))

const entryByAlias = new Map()
for (const entry of glossary) {
  for (const alias of entry.aliases) entryByAlias.set(alias, entry)
}

const aliases = [...entryByAlias.keys()].sort((a, b) => b.length - a.length)
const escapePattern = (value) => value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")
const termPattern = new RegExp(aliases.map(escapePattern).join("|"), "g")
const excludedTags = new Set(["A", "BUTTON", "CODE", "PRE", "SCRIPT", "STYLE", "H1", "H2", "H3"])
const seen = new Set()
const article = document.querySelector(".markdown-body")

if (article) {
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || excludedTags.has(parent.tagName) || parent.closest(".glossary-term")) return NodeFilter.FILTER_REJECT
      termPattern.lastIndex = 0
      return termPattern.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })

  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)

  for (const node of nodes) {
    termPattern.lastIndex = 0
    const text = node.nodeValue
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let match

    while ((match = termPattern.exec(text))) {
      const entry = entryByAlias.get(match[0])
      if (!entry || seen.has(entry.term)) continue
      fragment.append(text.slice(cursor, match.index))
      const button = document.createElement("button")
      button.type = "button"
      button.className = "glossary-term"
      button.dataset.term = entry.term
      button.textContent = match[0]
      button.setAttribute("aria-haspopup", "dialog")
      button.setAttribute("aria-expanded", "false")
      button.setAttribute("aria-label", match[0] + "，查看名词解释")
      fragment.append(button)
      seen.add(entry.term)
      cursor = match.index + match[0].length
    }

    if (cursor > 0) {
      fragment.append(text.slice(cursor))
      node.replaceWith(fragment)
    }
  }
}

let popover
let activeTrigger

function closeGlossary(returnFocus = false) {
  if (!popover) return
  popover.remove()
  popover = undefined
  if (activeTrigger) {
    activeTrigger.setAttribute("aria-expanded", "false")
    if (returnFocus) activeTrigger.focus()
  }
  activeTrigger = undefined
}

function positionPopover(trigger) {
  const rect = trigger.getBoundingClientRect()
  if (window.innerWidth < 680) {
    popover.style.left = "12px"
    popover.style.right = "12px"
    popover.style.top = "auto"
    popover.style.bottom = "12px"
    return
  }
  popover.style.right = "auto"
  popover.style.bottom = "auto"
  const width = popover.offsetWidth
  const height = popover.offsetHeight
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  let top = rect.bottom + 10
  if (top + height > window.innerHeight - 12) top = rect.top - height - 10
  if (top < 12) top = 12
  popover.style.left = left + "px"
  popover.style.top = top + "px"
}

function openGlossary(trigger) {
  const entry = glossary.find((item) => item.term === trigger.dataset.term)
  if (!entry) return
  closeGlossary()
  activeTrigger = trigger
  trigger.setAttribute("aria-expanded", "true")

  popover = document.createElement("section")
  popover.className = "glossary-popover"
  popover.setAttribute("role", "dialog")
  popover.setAttribute("aria-modal", "false")
  popover.setAttribute("aria-label", entry.term + " 名词解释")

  const head = document.createElement("div")
  head.className = "glossary-head"
  const heading = document.createElement("div")
  const kind = document.createElement("small")
  const name = document.createElement("strong")
  kind.textContent = entry.kind + " / QUICK NOTE"
  name.textContent = entry.term
  heading.append(kind, name)

  const close = document.createElement("button")
  close.type = "button"
  close.className = "glossary-close"
  close.setAttribute("aria-label", "关闭名词解释")
  close.textContent = "×"
  close.addEventListener("click", () => closeGlossary(true))
  head.append(heading, close)

  const body = document.createElement("div")
  body.className = "glossary-body"
  const sections = [["是什么", entry.meaning], ["在本项目", entry.project], ["别混淆", entry.contrast]]
  for (const [label, value] of sections) {
    const row = document.createElement("div")
    const title = document.createElement("b")
    const content = document.createElement("p")
    title.textContent = label
    content.textContent = value
    row.append(title, content)
    body.append(row)
  }

  popover.append(head, body)
  document.body.append(popover)
  positionPopover(trigger)
  close.focus({ preventScroll: true })
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest(".glossary-term")
  if (trigger) {
    event.stopPropagation()
    if (trigger === activeTrigger) closeGlossary(true)
    else openGlossary(trigger)
    return
  }
  if (popover && !popover.contains(event.target)) closeGlossary()
})

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeGlossary(true)
})

window.addEventListener("resize", () => closeGlossary())
document.addEventListener("scroll", (event) => {
  if (popover && !popover.contains(event.target)) closeGlossary()
}, true)
