# DEF OpenCode Adapter

This runtime adapter embeds upstream OpenCode source from:

- Repository: https://github.com/anomalyco/opencode
- Vendored path: `agent/vendor/opencode`
- Upstream branch at import time: `dev`
- License: MIT, preserved in `agent/vendor/opencode/LICENSE`

The adapter does not call an external `opencode` executable from PATH. It starts the
vendored source entrypoint with Bun:

```text
bun run --conditions=browser packages/opencode/src/index.ts serve
```

Runtime responsibilities:

- inject DEF Shell 05 Agent DeepSeek provider config through `OPENCODE_CONFIG_CONTENT`
- pass DeepSeek thinking mode through OpenCode agent request options
- register DEF native skills through OpenCode `skills.paths`
- retain a temporary `akedatabase-fill-tool` boundary notice for historical DEF prompts; it exposes no fill protocol or MCP route
- create OpenCode sessions through `/session`
- send user prompts through `/session/:sessionID/message`
- subscribe to real OpenCode events through `/event`
- stop generation through `/session/:sessionID/abort`
- map OpenCode parts/events into the `/ai-cli` GUI loop model

Native skill sources:

- `agent/runtime/def/skills`
- temporary boundary notice: `agent/runtime/def/skills/akedatabase-fill-tool/SKILL.md`

Legacy Fill MCP is a parallel Codex/standard-client service. This adapter does not register, host, proxy, configure, or call it.

`agent/runtime/opencode-core/index.cjs` is now only a compatibility shim.
