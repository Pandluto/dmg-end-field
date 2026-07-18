const glossary = [
  ["Agent", ["Agent"], "基础概念", "让模型能够连续观察、调用工具并根据结果继续行动的完整运行系统。", "DEF 复用 OpenCode 的会话与循环，再接入自己的领域工具和产品边界。", "模型负责生成下一步；Agent 还包括 Runtime、状态、工具和权限。"],
  ["Runtime", ["Runtime"], "运行机制", "托住模型执行的外层程序，负责会话、循环、工具执行、取消、重试与状态更新。", "OpenCode Runtime 承担通用 Agent 能力，DEF Adapter 补入产品上下文。", "它不是模型本身，也不是单纯的聊天界面。"],
  ["Session", ["Session"], "会话状态", "一段可持续的 Agent 会话，保存消息、工具调用、结果与相关状态。", "DEF Session 还会绑定 Work Node、Checkout 与 Harness 坐标。", "Session 是整段会话；Turn 是其中一次用户输入到最终回复。"],
  ["Turn", ["Turn"], "会话状态", "从一次用户输入开始，到 Agent 给出最终回复为止的一轮处理。", "一个 Turn 内可以发生多次模型生成和多次工具调用。", "Turn 不是一次模型 API 请求；Agent Loop 可能在其中往返很多次。"],
  ["Agent Loop", ["Agent Loop"], "核心流程", "模型提出下一步，程序执行工具，再把结果交还模型，直到满足停止条件的循环。", "DEF 沿用 OpenCode 的循环，并在其中接入领域工具、审批和产品校验。", "它不只是 while true；还需要终止、错误、取消和步骤上限。"],
  ["Tool Use", ["Tool Use"], "工具调用", "模型用结构化请求选择一个外部能力，Runtime 执行后再把结果送回模型。", "读取配装、查询时间线和准备 Work Node 修改，都通过工具进入产品边界。", "模型只是提出调用，真正执行的是程序中的 handler。"],
  ["Typed Tool", ["Typed Tool", "Typed Tools"], "工具调用", "用明确 Schema 约束名称、参数与返回结构的工具。", "DEF 只向产品 Agent 暴露角色、装备、伤害和排轴等领域工具。", "类型保证输入形状，不保证调用已经获准，也不保证业务结果正确。"],
  ["Schema", ["Schema"], "工具调用", "描述工具参数名称、类型、必填项和结构约束的机器可验证规则。", "Runtime 在执行 DEF 工具前先按 Schema 验证模型提交的输入。", "Schema 管格式；Permission 管能不能做；Postcondition 管是否真的做成。"],
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
  ["Postcondition", ["Postcondition"], "安全修改", "操作执行后必须成立、并需要重新读取事实确认的结果条件。", "DEF 会核对 Commit、Checkout 和真实界面，而不是只看接口返回值。", "参数校验发生在执行前；Postcondition 验证发生在执行后。"],
  ["Worker", ["Worker"], "运行机制", "实际承载 Session、Agent Loop 和内存中等待状态的本地执行进程。", "Sidecar 创建并管理 OpenCode Worker；退出后内存中的审批等待也会消失。", "恢复 Worker 身份与记录，不等于恢复崩溃前的调用栈。"],
  ["Tool Part", ["Tool Part"], "运行状态", "Message 中记录单次工具调用输入、状态和结果的结构化部分。", "它会经历 pending、running、completed 或 error，并持久化到会话记录。", "数据库里的 running 记录不是可继续执行的函数检查点。"],
  ["callID", ["callID"], "运行状态", "一次工具调用的关联标识，用来把异步结果放回正确的调用位置。", "同一轮出现多个工具时，OpenCode 用它区分各自的 Part 与结果。", "它标识工具调用，不标识整轮用户请求。"],
  ["Abort", ["Abort", "abort"], "错误恢复", "中止仍在运行的请求，并清理 Runtime 中未完成的执行现场。", "未结束的 Tool Part 会被标记为中断或错误，避免界面永远运行中。", "Abort 不是产品事务回滚，已经发生的副作用仍需核对。"],
  ["clientTurnId", ["clientTurnId"], "错误恢复", "客户端为一次 Turn 分配的稳定身份，用于查询是否已经被服务端接收。", "Prompt 响应不确定时，先查 Transcript 中是否已有该 Turn，再决定是否重发。", "它避免重复投递用户请求，不负责关联单个 Tool Call。"],
  ["Transcript", ["Transcript"], "错误恢复", "按顺序保存的会话消息、工具事件与结果记录。", "外部联调协议用它确认 Prompt 是否进入 Session，以及 Agent 最终做了什么。", "Transcript 是历史证据，不是当前产品状态。"],
  ["Harness", ["Harness"], "DEF 概念", "把角色、规则、工作流、工具指南、知识路由和响应策略组合成的运行包。", "新 Session 绑定确定的 Harness 内容 hash，候选升级不会中途改变旧会话。", "它调整 Agent 的运行方式，不是重新训练模型权重。"]
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
  const sections = [["是什么", entry.meaning], ["在 DEF 里", entry.project], ["别混淆", entry.contrast]]
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
