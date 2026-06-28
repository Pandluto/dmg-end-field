---
name: rest-search
description: Search or inspect DEF app state through the local REST bridge without writing storage.
slash: false
---

# rest-search

Use this skill when the user wants to search or inspect DEF app state through the local REST bridge.

Rules:

- Prefer read-only endpoints.
- Do not write app storage directly.
- Use `ai-cli-rest` as the source of app-owned truth.
- Summarize results for shallow users; hide raw protocol details unless needed.
