# DEF OpenCode UI provenance

- Upstream repository: `anomalyco/opencode`
- Vendored release: `v1.17.11`
- Upstream tag commit: `67aec2212010d67775c35e696d8b8b54902eb338`
- Source snapshot: `agent/vendor/opencode`
- UI sources: `packages/app`, `packages/session-ui`, `packages/ui`
- Runtime sources: `packages/opencode`, `packages/core`, `packages/server`, `packages/sdk`

`scripts/build-opencode-ui.mjs` builds the vendored `packages/app` unchanged as a standalone native UI bundle. `agent/server/def-agent-server.cjs` serves that bundle and reverse-proxies OpenCode HTTP/SSE on the same origin. React hosts only provide a toolbar and iframe boundary through `DefOpenCodeView`; they do not reimplement timeline, tool cards, reasoning, diff, permission, retry, stop, session switching, keyboard handling, or error recovery.

DEF-specific adaptations are outside upstream UI sources:

- host-specific session creation and isolated directories;
- `127.0.0.1` versus `localhost` origins for independent browser state;
- sidecar/runtime/DEF-handler bootstrap;
- native DEF plugin registration and permission profiles;
- work-node approval and checkout governance.

At the 2026-07-12 audit, the latest upstream tag was `v1.17.18` (`b1fc8113948b518835c2a39ece49553cffe9b30c`), seven patch releases and 456 upstream commits after the vendored snapshot. The current implementation intentionally stays version-locked: UI and runtime are both rebuilt from the same `v1.17.11` snapshot. Upgrading requires a separate synchronized vendor/runtime/UI compatibility pass, not copying only the latest frontend.
