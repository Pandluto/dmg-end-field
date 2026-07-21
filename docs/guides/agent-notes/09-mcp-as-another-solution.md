# MCP：把填表能力开放给 AI

项目已有填表能力。问题是，外部 Codex 用不了。MCP 负责开放能力，项目负责守住写入。

## 外部 AI 怎么拿到这个能力？

外部 AI 要使用能力，需要 Host、Client 和 Server 配合。

<div class="participant-map" role="img" aria-label="MCP Host、Client 与 Server 的关系">
  <div class="host-participant">
    <small>MCP HOST · CODEX</small>
    <div><span><b>模型</b><em>决定调用什么</em></span><i><small>Function Calling</small>→</i><span><b>MCP Client</b><em>负责连接</em></span></div>
  </div>
  <div class="mcp-link"><small>MCP</small><b>→</b></div>
  <div class="server-participant"><small>MCP SERVER</small><strong>填表服务</strong><em>提供能力</em></div>
</div>

<aside class="qa-note">
  <span class="qa-mark">Q</span>
  <div><strong>Host、Client、Server 分别负责什么？</strong><p>Host 管理模型和用户交互。Client 负责连接一个 Server。Server 负责提供能力。</p></div>
</aside>

<aside class="qa-note">
  <span class="qa-mark">Q</span>
  <div><strong>MCP 和 Function Calling 有什么区别？</strong><p>Function Calling 表达模型想调用什么。MCP 负责发现能力，并把调用送到外部 Server。</p></div>
</aside>

<div class="capability-strip" role="img" aria-label="项目能力被包装成 Tool 并注册到 MCP Server">
  <div><small>项目内部</small><strong>填表能力</strong></div>
  <b>→</b>
  <div><small>对外描述</small><strong>Tool + Schema</strong></div>
  <b>→</b>
  <div class="accent"><small>能力入口</small><strong>MCP Server</strong></div>
</div>

Tool 说明能做什么。

<aside class="qa-note">
  <span class="qa-mark">Q</span>
  <div><strong>Schema 有什么作用？</strong><p>Schema 描述字段、类型和约束。模型用它组织参数，Server 用它校验参数。</p></div>
</aside>

<aside class="qa-note">
  <span class="qa-mark">Q</span>
  <div><strong>MCP 为什么需要初始化和能力协商？</strong><p>Client 和 Server 支持的版本可能不同。双方先确认版本和能力，再开始调用。</p></div>
</aside>

<div class="message-flow" role="img" aria-label="MCP Client 发现和调用 Tool 的过程">
  <div class="message-head"><strong>MCP Client</strong><strong>MCP Server</strong></div>
  <div class="message-phase">初始化</div>
  <div class="message-row"><span>1 · 发送版本与 Client 能力</span><i>→</i></div>
  <div class="message-row reverse"><span>2 · 返回版本与 Server 能力</span><i>←</i></div>
  <div class="message-phase">发现与调用</div>
  <div class="message-row"><span>3 · 询问有哪些 Tool</span><i>→</i></div>
  <div class="message-row reverse"><span>4 · 返回 Tool 与 Schema</span><i>←</i></div>
  <div class="message-row"><span>5 · 提交 Tool 名称与参数</span><i>→</i></div>
  <div class="message-row reverse"><span>6 · 返回执行结果</span><i>←</i></div>
</div>

### 消息怎么到达 Server？

MCP 消息统一写成 JSON-RPC。Transport 负责把消息送到 Server。

<div class="transport-map" role="img" aria-label="JSON-RPC 消息可以通过 STDIO 或 Streamable HTTP 传输">
  <div class="transport-message"><small>消息格式</small><strong>JSON-RPC</strong></div>
  <i class="transport-down">↓</i>
  <span class="transport-choice">选择 Transport</span>
  <div class="transport-branches">
    <div class="transport-branch">
      <small>本地子进程</small>
      <strong>STDIO</strong>
      <p>消息走标准输入和输出。</p>
    </div>
    <div class="transport-branch">
      <small>独立服务</small>
      <strong>Streamable HTTP</strong>
      <p>消息走 HTTP 请求和响应。</p>
      <span class="sse-note"><b>SSE</b>需要连续返回时，保持响应流。</span>
    </div>
  </div>
</div>

SSE 属于 Streamable HTTP。它不是第三种 Transport。

<aside class="qa-note">
  <span class="qa-mark">Q</span>
  <div><strong>本地和远程 MCP Server 怎样认证和授权？</strong><p>STDIO 的凭据通常来自启动环境。HTTP 通常使用 OAuth。认证确认是谁，授权限制能访问什么。</p></div>
</aside>

#### 本项目怎么接？

填表能力只运行一套 Streamable HTTP 服务。

<aside class="qa-note">
  <span class="qa-mark">Q</span>
  <div><strong>STDIO Facade 解决了什么问题？</strong><p>它让只支持 STDIO 的 Client 也能连接。它把消息转给同一套 HTTP 服务，不再实现业务逻辑。</p></div>
</aside>

<div class="project-transport-paths" role="img" aria-label="本项目的 HTTP 与 STDIO 连接路径">
  <div><strong>HTTP Client</strong><i>→</i><span>Streamable HTTP 填表服务</span></div>
  <div><strong>STDIO Client</strong><i>→</i><span>STDIO Facade</span><i>→</i><span>Streamable HTTP 填表服务</span></div>
</div>

MCP 没有重写填表逻辑。它只是让已有能力可以被发现和调用。

## 拿到以后，怎样保证它不出事？

Tool 能被调用，不等于 AI 可以直接保存。AI 每次修改只能先交一份草稿。

<div class="approval-flow" role="img" aria-label="AI 提交草稿，用户确认，项目保存并重新读取">
  <div class="approval-node"><small>AI</small><strong>提交草稿</strong><em>Proposal</em></div>
  <i>→</i>
  <div class="approval-node user"><small>用户</small><strong>确认内容</strong><em>不同意就结束</em></div>
  <i>→</i>
  <div class="approval-node"><small>项目</small><strong>正式保存</strong></div>
  <i>→</i>
  <div class="approval-node verify"><small>确认结果</small><strong>重新读取</strong></div>
</div>

这条链路只守三条规则：

- 用户没确认，不保存。
- 草稿变了，重新确认。
- 保存完成，再读一遍。

MCP 开放调用入口。真正的写入权仍在项目里。
