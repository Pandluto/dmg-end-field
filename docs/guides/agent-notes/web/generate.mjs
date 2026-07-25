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
  ["02-permission-and-hooks.md", "Permission 与 Hook"],
  ["03-context-skill-memory.md", "上下文、Skill 与 Memory"],
  ["04-plan-task-subagent.md", "Plan、Task 与 Subagent"],
  ["05-def-and-opencode.md", "概念怎样落到 DEF"],
  ["06-state-persistence-recovery.md", "状态、持久化与恢复"],
  ["07-developer-skill.md", "开发者自己的 Skill"],
  ["08-workbench-state-machine.md", "AI 进入 Workbench 以后，谁才算“当前”"],
  ["09-mcp-as-another-solution.md", "MCP 如何开放能力"],
  ["10-harness.md", "Harness"],
]

const escapeHtml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const navigation = (activeFile) => pages.map(([file, label], index) => `
  <a class="nav-item${file === activeFile ? " active" : ""}" href="${file.replace(/\.md$/, ".html")}">
    <span>${index === 0 ? "◎" : String(index).padStart(2, "0")}</span>${escapeHtml(label)}
  </a>`).join("")

const shell = ({ file, title, content }) => {
  const isHarnessPage = file === "10-harness.md"
  const articleLabel = file === "09-mcp-as-another-solution.md"
    ? "09 / MODEL CONTEXT PROTOCOL"
    : isHarnessPage
      ? "DEV NOTE 11 / HARNESS"
      : `${file.replace(/\.md$/, "").toUpperCase()} / DEF AGENT RUNTIME`
  const annotationAssets = isHarnessPage ? `
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/syabro/neat-annotations@83199c8c7420b85f775c770c5ee481df69b840bc/neat-annotations.css" />` : ""

  return `<!doctype html>
<html lang="zh-CN"${isHarnessPage ? ' class="harness-document"' : ""}>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)} · Agent 开发随记</title>${annotationAssets}
  <link rel="stylesheet" href="styles.css?v=20260724-6" />
  <script src="viewer.js?v=20260721-11" defer></script>
</head>
<body${isHarnessPage ? ' class="harness-page"' : ""}>
  <div class="page-glow glow-one"></div>
  <div class="page-glow glow-two"></div>
  <button class="menu-button" aria-label="打开目录" onclick="document.body.classList.toggle('menu-open')">目录</button>
  <header class="site-header">
    <a class="brand" href="index.html">
      <img src="app-icon.png" alt="终末地伤害工作台图标" />
      <span>终末地伤害工作台</span>
    </a>
    <span class="header-section">AGENT NOTES / READING EDITION</span>
    <a class="header-link" href="https://github.com/Pandluto/dmg-end-field" target="_blank" rel="noreferrer">GitHub 源码 <span>↗</span></a>
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

  if (file === "10-harness.md") {
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
        "Tool 是强制性的能力，Skill 是非强制性的目录，Workflow 是强制串联 Tools；Harness 对模型的效果，则是非强制，但强参考。",
        `Tool 是<span class="ann ann-n ann-green" data-note="Schema / Typed Tools 约束下">强制性的能力</span>，Skill 是非强制性的目录，Workflow 是强制串联 Tools；Harness 对模型的效果，则是<span class="ann ann-s ann-amber ann-method" data-note="这里说的是方法层">非强制，但强参考</span>。`,
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

await writeFile(path.join(outputDir, "index.html"), await readFile(path.join(outputDir, "README.html"), "utf8"))
await writeFile(path.join(outputDir, "styles.css"), await readFile(path.join(previewDir, "styles.css"), "utf8"))
await writeFile(path.join(outputDir, "viewer.js"), await readFile(path.join(previewDir, "viewer.js"), "utf8"))
await copyFile(path.join(worktree, "electron/assets/icon.png"), path.join(outputDir, "app-icon.png"))

console.log(`Rendered ${pages.length} pages to ${outputDir}`)
