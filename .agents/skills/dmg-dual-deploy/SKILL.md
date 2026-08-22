---
name: dmg-dual-deploy
description: "Publish the active DMG Endfield web app or resource package to the domestic Caddy/Nginx server, and maintain the retired overseas OpenAI Sites redirect when explicitly requested. Use for deployments, production updates, resource releases, or repairs to the overseas retirement redirect and legacy share API."
---

# DMG Production Deploy

Treat `https://dmgendfield.cloud` as the only maintained application. The former overseas application is retired: both `https://dmgendfield.online` and its provider fallback preserve the incoming path and query while redirecting UI/static traffic to the domestic domain.

This personal skill is the cross-workspace entry point. When the active repository also contains `.agents/skills/dmg-dual-deploy/SKILL.md`, read that project-local copy and treat it as authoritative for repository-specific commands and current infrastructure details. The production policy remains domestic-only unless the user explicitly requests an overseas retirement or compatibility repair.

The overseas `/api/mobile-shares` endpoint remains a compatibility service for historic D1/R2 records and old QR codes. `/sw.js` and `/version.json` remain local migration endpoints so installed overseas PWAs can replace their cached shell. Do not replace those three routes with a blanket redirect.

Normal application and resource releases update the domestic server only. Deploy Sites only when the user explicitly requests an overseas redirect or compatibility repair. GitHub Release is not a production resource channel.

Before acting, read [references/targets.md](references/targets.md). It contains the current URLs, server layout, redirect contract, and cache rules.

## Route by branch

This repository intentionally keeps two specialized 1.8 branches. Read `docs/architecture/lts-branch-contract.md` before moving code between them.

- `codex/v1.8-lts-desktop-shell` owns Electron, MCP, DEF Agent, desktop data authoring, and creation/verification of the unified resource ZIP. It is not the website deployment source.
- `codex/v1.8-lts-slimming` owns the maintained Web application, resource materialization, and domestic production deployment.
- Never merge either branch wholesale into the other. Port only shared domain, SQLite, export-schema, interaction, and resource-protocol changes, with focused validation on the destination branch.
- If a deploy request starts on Desktop Shell, finish and commit the desktop change or produce the verified resource ZIP, then use a clean Slimming worktree for materialization/build/deployment. Do not copy Electron, MCP, Agent, or desktop packaging internals into Slimming.
- If the user asks only to generate or verify a package, stop after the verified local artifact; that request does not authorize Git push or production deployment.

## Preserve these invariants

- Deploy from `codex/v1.8-lts-slimming` unless the user explicitly names another source branch.
- The domestic archive helper refuses other branches by default. Set `DMG_ALLOW_NON_SLIMMING_BUILD=1` only after recording the user's explicit alternate-branch authorization.
- Record the current commit and every target being changed before publishing.
- Commit and push intended source changes before publishing an artifact.
- Preserve unrelated worktree changes and untracked files. Stage only files belonging to the requested change.
- Never place SSH passwords, source credentials, tokens, or certificates in commands, logs, Git configuration, the skill, or repository files.
- Reuse the Sites `project_id` in `.openai/hosting.json`; never create a replacement project for the retirement route.
- Keep rollback points. Never delete the active Sites version, the overseas D1/R2 data, the current domestic release, or its backup during deployment.
- Do not report completion until each requested target and the unchanged production contract have been verified.
- A domestic desktop release is accepted only through the filed HTTPS domain; HTTP IP checks do not prove OPFS, Service Worker, or Web Crypto support.

## 1. Lock the source release

1. Inspect `git status --short`, the current branch, upstream, and `git log -1`.
2. Confirm intended changes are committed. Run checks proportional to the change before committing.
3. Push the source branch and capture the full and eight-character commit SHA.
4. Recheck that no uncommitted source change would make the artifact differ from the pushed commit.

If the worktree contains unrelated user changes, leave them untouched. A deploy request does not authorize folding them into the release.

## 2. Build and publish the domestic application

Run:

```bash
.agents/skills/dmg-dual-deploy/scripts/build-domestic-archive.sh
```

Prefer the project-local helper above. If it is unavailable, run this skill's `scripts/build-domestic-archive.sh` from inside the DMG repository; the personal helper resolves the repository from the current Git worktree.

The script builds the current resource state, validates the offline shell and workspace, creates an archive outside the repository, and prints its SHA-256, file count, source commit, and version manifest.

Use interactive SSH or an already authenticated session. If authentication is unavailable, ask for access without echoing a secret into a shell command.

If the source commit changes `server/mobile-share-server.mjs` or `ops/mobile-share/`, also follow `ops/mobile-share/README.md`: stage the new service file separately, preserve the previous one, refresh systemd/Nginx as required, and require the share health endpoint to pass through ports 8787, 8080, and the public route. Never replace the SQLite database.

1. Check disk space, service health, current `version.json`, and exact release/backup paths.
2. Upload to an explicit `/tmp/dmg-static-<sha>.tar.gz` path and require the remote SHA-256 to match.
3. Extract into `/var/www/dmg-static.release-<sha>`, verify file count and `version.json`, then set directories to `0755`, files to `0644`, and ownership to `root:root`.
4. Copy only missing files from the previous `assets/` directory into the staged release so clients holding prior HTML can still load hashed chunks. Never overwrite new files.
5. Require `nginx -t` to pass. Keep Nginx on `127.0.0.1:8080`; only Caddy is public.
6. Rename the current release to a timestamped `/var/www/dmg-static.prev-<timestamp>-<sha>` backup, then move the staged release into `/var/www/dmg-static`. Restore the backup immediately if the second rename fails.
7. Reload Nginx, verify Caddy/Nginx/service health and public HTTPS routes, and confirm port 8080 remains private.
8. Remove only explicit temporary uploads and test files. Keep previous release directories unless the user authorizes cleanup.

## 3. Publish a resource package

Desktop Shell may generate and verify the resource ZIP from a complete `def.localdata.archive.v1` Share Data plus the image directory. An operator-library share or other partial editor export is not a valid release input. Resource versions must use the actual package-generation time in China Standard Time as `YYYYMMDD.HHmmss.<content-hash>`; Share Data `exportedAt` is source metadata only.

Materialize the verified ZIP into `public/` only in a clean `codex/v1.8-lts-slimming` worktree. The Desktop Shell branch retains the producer and verifier but must not become the domestic website release source.

Commit and push the materialized resource state, then build and deploy the domestic artifact using section 2. Do not rebuild or publish the full application to the retired overseas Sites project. The overseas resource URLs already redirect to the same path on the domestic origin.

## 4. Repair or update the overseas retirement route

Only run this section when the user explicitly requests an overseas change. Read and follow the available `sites-building` and `sites-hosting` skills because this repository contains `.openai/hosting.json`.

1. Record the current live Sites version ID and commit SHA for rollback.
2. Verify the Worker routing contract with the targeted Sites routing test and typecheck.
3. Run `npm run build:sites`. It validates the full application build first, then removes every directly served client/resource file so all retired URLs must enter the Worker. Require `SITES_RETIREMENT_BUILD_OK`.
4. Package the validated retirement output using the Sites plugin `package-site.sh` helper.
5. Obtain a short-lived source write credential without persisting it in Git or a remote URL, and push the exact validated commit.
6. Save one version to the existing Sites project, deploy it, and poll until success or failure.
7. Verify the custom domain and provider fallback:
   - `/`, `/mobile`, `/share/:id`, resource URLs, and static URLs return `308` to the identical path and query on `https://dmgendfield.cloud`;
   - `/sw.js` and `/version.json` return `200` with `no-store` and the retirement shell version;
   - `/api/mobile-shares/health` returns `200`, and historic shares remain readable;
   - no route can redirect to an attacker-controlled host through a leading `//` path.

Preserve the prior Sites version and all D1/R2 data. This deployment retires the UI, not the compatibility database.

## 5. Verify production

Run:

```bash
EXPECTED_DOMESTIC_SHELL_VERSION=<domestic-shell> \
EXPECTED_OVERSEAS_RETIREMENT_SHELL_VERSION=<retirement-shell> \
  .agents/skills/dmg-dual-deploy/scripts/verify-public-targets.sh
```

Prefer the project-local verification helper. If it is unavailable, run this skill's `scripts/verify-public-targets.sh`.

For a normal domestic release, the overseas value verifies that the retirement route remained intact; it is not a second app release. Also confirm no warning-or-higher Nginx/Caddy journal entries appeared during a domestic switch.

Use interactive browser or offline-PWA QA only when requested or when the release changes authentication, OPFS, Service Worker, caching, startup behavior, or the retirement migration worker.

## 6. Handle failure

- Prefer a safe roll-forward while the cause is understood and unchanged production routes remain healthy.
- Roll back only the target that changed.
- For Sites, redeploy the recorded prior version; do not alter D1/R2.
- For domestic, restore the recorded `dmg-static.prev-*` directory, validate, and reload Nginx.
- Report the failed target, the live version, and whether rollback succeeded.

## 7. Handoff

Keep the final report concise. Include the source commit, domestic desktop/mobile URLs, domestic release and shell versions, overseas retirement Sites version when changed, verification results, preserved compatibility behavior, and rollback points.
