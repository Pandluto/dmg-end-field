# Agent 笔记网页

本目录把上一级 Markdown 笔记生成成可浏览的静态页面，并在常见 Agent 名词上补充可点击的简明解释。网页只是阅读层，正文仍以上一级 `.md` 文件为准。

```bash
bun install --ignore-scripts
bun run build
python3 -m http.server 4175 --bind 127.0.0.1 --directory dist
```

浏览器打开 `http://127.0.0.1:4175/` 即可。Markdown 更新后重新执行 `bun run build`，并一并提交 `dist/`。
