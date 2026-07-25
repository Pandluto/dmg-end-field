import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { marked } from "marked"

const previewDir = path.dirname(fileURLToPath(import.meta.url))
const worktree = path.resolve(previewDir, "../../../..")
const notesDir = path.join(worktree, "docs/guides/agent-notes")
const outputDir = path.join(previewDir, "dist")

const pages = [
  ["README.md", "阅读入口"],
  ["00-chat-to-agent.md", "从聊天到 Agent"],
  ["01-tool-use.md", "Tool Use"],
  ["02-harness.md", "Harness"],
  ["03-permission-and-hooks.md", "Permission 与 Hook"],
  ["04-context-skill-memory.md", "上下文、Skill 与 Memory"],
  ["05-plan-task-subagent.md", "Plan、Task 与 Subagent"],
  ["06-def-and-opencode.md", "概念怎样落到 DEF"],
  ["07-state-persistence-recovery.md", "状态、持久化与恢复"],
  ["08-developer-skill.md", "开发者自己的 Skill"],
  ["09-workbench-state-machine.md", "AI 进入 Workbench 以后，谁才算“当前”"],
  ["10-mcp-as-another-solution.md", "MCP 如何开放能力"],
]

const escapeHtml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const navigation = (activeFile) => pages.map(([file, label], index) => `
  <a class="nav-item${file === activeFile ? " active" : ""}" href="${file.replace(/\.md$/, ".html")}">
    <span>${index === 0 ? "◎" : String(index).padStart(2, "0")}</span>${escapeHtml(label)}
  </a>`).join("")

const shell = ({ file, title, content }) => {
  const isHarnessPage = file === "02-harness.md"
  const articleLabel = file === "10-mcp-as-another-solution.md"
    ? "10 / MODEL CONTEXT PROTOCOL"
    : isHarnessPage
      ? "DEV NOTE 03 / HARNESS"
      : `${file.replace(/\.md$/, "").toUpperCase()} / DEF AGENT RUNTIME`
  const annotationAssets = isHarnessPage ? `
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/syabro/neat-annotations@83199c8c7420b85f775c770c5ee481df69b840bc/neat-annotations.css" />` : ""

  return `<!doctype html>
<html lang="zh-CN" class="notes-document">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)} · Agent 开发随记</title>${annotationAssets}
  <script>
    (() => {
      const root = document.documentElement
      const requestedTheme = new URLSearchParams(window.location.search).get("theme")
      let storedTheme = null
      try {
        storedTheme = window.localStorage.getItem("agent-notes-theme")
      } catch {}
      const validTheme = (value) => value === "light" || value === "dark"
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      root.dataset.theme = validTheme(requestedTheme)
        ? requestedTheme
        : validTheme(storedTheme)
          ? storedTheme
          : systemTheme
      root.dataset.themeSource = validTheme(requestedTheme)
        ? "query"
        : validTheme(storedTheme)
          ? "stored"
          : "system"
    })()
  </script>
  <link rel="stylesheet" href="styles.css?v=20260725-3" />
  <script src="viewer.js?v=20260725-1" defer></script>
</head>
<body class="notes-page">
  <div class="page-glow glow-one"></div>
  <div class="page-glow glow-two"></div>
  <button class="menu-button" aria-label="打开目录" onclick="document.body.classList.toggle('menu-open')">目录</button>
  <header class="site-header">
    <a class="brand" href="index.html">
      <img src="app-icon.png" alt="终末地伤害工作台图标" />
      <span>终末地伤害工作台</span>
    </a>
    <span class="header-section">AGENT NOTES / READING EDITION</span>
    <div class="header-actions">
      <button class="theme-toggle" type="button" aria-label="切换明暗模式">
        <span class="theme-icon" aria-hidden="true">夜</span>
        <span class="theme-label">暗色</span>
      </button>
      <a class="header-link" href="https://github.com/Pandluto/dmg-end-field" target="_blank" rel="noreferrer">GitHub 源码 <span>↗</span></a>
    </div>
  </header>
  <aside class="sidebar">
    <div class="sidebar-head"><small><i></i> READING ROUTE</small><strong>Agent 开发随记</strong><p>从模型回答问题，一路读到工具、权限、状态、Skill 和 MCP。</p></div>
    <nav>${navigation(file)}</nav>
    <p class="sidebar-foot"><b>MARKDOWN SOURCE</b><br />正文由仓库中的 Markdown 生成</p>
  </aside>
  <main>
    <div class="article-meta">
      <div class="article-kicker"><span></span> ${escapeHtml(articleLabel)}</div>
      <div class="glossary-hint"><b>?</b> 点击带点线的名词，可看简明解释</div>
    </div>
    <article class="markdown-body">${content}</article>
    <footer><span>终末地伤害工作台</span><span>LOCAL · TRACEABLE · ASSISTED</span></footer>
  </main>
</body>
</html>`
}

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

for (const [file, navTitle] of pages) {
  const sourcePath = path.join(notesDir, file)
  const markdown = await readFile(sourcePath, "utf8")
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? navTitle
  let content = await marked.parse(markdown, { gfm: true })

  if (file === "02-harness.md") {
    content = content
      .replace(
        "<blockquote>\n<p><strong>Harness 是模型的工作台。</strong></p>\n</blockquote>",
        `<blockquote class="annotation-quote annotation-quote--intro">
<p><strong><span class="ann ann-n ann-blue" data-note="先建立直觉">Harness 是模型的工作台。</span></strong></p>
</blockquote>`,
      )
      .replace(
        "可版本化、由运行时强制的整体，同时保留模型在边界内的自主推理能力。",
        `可版本化、<span class="ann ann-n ann-red ann-runtime" data-note="强制关键边界，不强制唯一解法">由运行时强制</span>的整体，同时保留模型在边界内的自主推理能力。`,
      )
      .replace(
        "不是单独一份 Prompt，也不是一组 Tools。",
        `<span class="pen-mark pen-underline pen-red">不是单独一份 Prompt，也不是一组 Tools</span>。`,
      )
      .replace(
        "Tool 是强制性的能力，Skill 是非强制性的目录，Workflow 是强制串联 Tools；Harness 对模型的效果，则是非强制，但强参考。",
        `Tool 是<span class="ann ann-sw ann-green ann-schema" data-note="Schema / Typed Tools 约束下">强制性的能力</span>，Skill 是非强制性的目录，Workflow 是强制串联 Tools；Harness 对模型的效果，则是<span class="ann ann-nw ann-amber ann-method" data-note="这里说的是方法层">非强制，但强参考</span>。`,
      )
      .replace(
        "PSM 没有智能；“怎样解一道题”是写不能死的",
        `PSM 没有智能；“怎样解一道题”是<span class="ann ann-n ann-red ann-psm" data-note="方法 ≠ 固定流程">写不能死</span>的`,
      )
      .replace(
        "合法的走法并不只有一条",
        `<span class="pen-mark pen-underline pen-green">合法的走法并不只有一条</span>`,
      )
      .replace(
        "持续复用领域知识、问题求解方法和 Tools",
        `<span class="pen-mark pen-underline pen-green">持续复用领域知识、问题求解方法和 Tools</span>`,
      )
      .replace(
        "不要再把所有材料一次塞满",
        `<span class="pen-mark pen-underline pen-red">不要再把所有材料一次塞满</span>`,
      )
      .replace(
        "有些 Context 从任务开始就需要；有些只在准备调用某个 Tool 时有用；还有一些，必须等 Tool Result 回来以后才成立。",
        `有些 Context <span class="pen-mark pen-underline pen-blue">从任务开始</span>就需要；有些只在<span class="pen-mark pen-underline pen-amber">准备调用某个 Tool</span>时有用；还有一些，必须等<span class="pen-mark pen-underline pen-green">Tool Result 回来以后</span>才成立。`,
      )
      .replace(
        "<p><strong>Harness 使用知识，但不复制知识。</strong></p>",
        `<p class="annotation-line"><strong>Harness 使用知识，但<span class="ann ann-n ann-green" data-note="不重复维护另一份权威副本">不复制知识</span>。</strong></p>`,
      )
      .replace(
        "<p>到了这里，Context 已经不只是一大段“背景资料”。它开始有自己的<strong>来源、用途和运行位置</strong>。</p>",
        `<p class="annotation-line">到了这里，Context 已经不只是一大段“背景资料”。它开始有自己的<strong><span class="ann ann-n ann-purple" data-note="材料按需进入 Context">来源、用途和运行位置</span></strong>。</p>`,
      )
      .replace(
        "<p>Typed Tools 让 Agent 的“手”相对稳定下来，之后长期变化的是它在不同位置拿到的 Context：方法、知识、Tool 的用途、Tool Result 的解释和审查规则都会继续更新。</p>",
        `<p class="annotation-line">Typed Tools 让 Agent 的<span class="ann ann-n ann-blue" data-note="稳定的是 Schema 与调用契约">“手”相对稳定下来</span>，之后长期变化的是它在不同位置拿到的 Context：方法、知识、Tool 的用途、Tool Result 的解释和审查规则都会继续更新。</p>`,
      )
  }

  content = content.replaceAll(/href="\.\/([^"#]+)\.md(#[^"]*)?"/g, (_, target, hash = "") =>
    `href="${target}.html${hash}"`)
  content = content.replaceAll('href="web/README.html"', 'href="index.html"')
  content = content.replaceAll(/href="\.\.\/\.\.\/architecture\/README\.md"/g,
    'href="https://github.com/Pandluto/dmg-end-field/blob/main/docs/architecture/README.md" target="_blank" rel="noreferrer"')
  content = content.replaceAll(/href="\.\.\/\.\.\/([^"#]+)\.md(#[^"]*)?"/g, (_, target, hash = "") =>
    `href="https://github.com/Pandluto/dmg-end-field/blob/main/docs/${target}.md${hash}" target="_blank" rel="noreferrer"`)

  await writeFile(path.join(outputDir, file.replace(/\.md$/, ".html")), shell({ file, title, content }))
}

await writeFile(path.join(outputDir, "10-harness.html"), `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="robots" content="noindex" />
  <link rel="canonical" href="02-harness.html" />
  <title>Harness · Agent 开发随记</title>
</head>
<body>
  <script>location.replace("02-harness.html" + location.search + location.hash)</script>
  <a href="02-harness.html">Harness 已移动到 Tool Use 后一章</a>
</body>
</html>`)

await writeFile(path.join(outputDir, "index.html"), await readFile(path.join(outputDir, "README.html"), "utf8"))
await writeFile(path.join(outputDir, "styles.css"), await readFile(path.join(previewDir, "styles.css"), "utf8"))
await writeFile(path.join(outputDir, "viewer.js"), await readFile(path.join(previewDir, "viewer.js"), "utf8"))
await copyFile(path.join(worktree, "electron/assets/icon.png"), path.join(outputDir, "app-icon.png"))

console.log(`Rendered ${pages.length} pages to ${outputDir}`)
