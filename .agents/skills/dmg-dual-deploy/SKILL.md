---
name: dmg-dual-deploy
description: "Publish the DMG Endfield web app to both production routes: the overseas OpenAI Sites project and custom domain, plus the domestic Caddy/Nginx static server. Use when the user asks to deploy, publish, go live, redeploy, refresh production, or push a web build online. A general deployment updates both routes by default; do not use this skill for GitHub Release or data-package publishing unless website deployment is also requested."
---

# DMG Dual Deploy

Treat one production release as one source commit deployed to both overseas and domestic routes. Only deploy one route when the user explicitly says to deploy only that route.

Before acting, read [references/targets.md](references/targets.md). It contains the production URLs, server layout, protocol limitations, and cache contract.

## Preserve these invariants

- Deploy from `codex/v1.8-lts-slimming` unless the user explicitly names another source branch.
- Record the current commit and both live versions before changing either target.
- Use the same committed source SHA for both deployments. Commit and push intended source changes before publishing.
- Preserve unrelated worktree changes and untracked files. Stage only files belonging to the requested change.
- Never place SSH passwords, source credentials, tokens, or certificates in commands, logs, Git configuration, the skill, or repository files.
- Do not create a second Sites project. Reuse `.openai/hosting.json` and its existing `project_id`.
- Do not report completion until both requested targets are deployed and verified.
- Keep a rollback path on both targets. Never delete the active release or previous server release before verification succeeds.
- Do not claim that the domestic desktop app works merely because `/` returns HTTP 200. OPFS, Service Worker, and Web Crypto require HTTPS or localhost.

## 1. Lock the source release

1. Inspect `git status --short`, the current branch, upstream, and `git log -1`.
2. Confirm the intended changes are committed. Run checks proportional to the code change before committing.
3. Push the source branch and capture the full and eight-character commit SHA.
4. Recheck that no uncommitted source change would make the two artifacts differ.

If the worktree contains unrelated user changes, leave them untouched. A deploy request does not authorize folding them into the release.

## 2. Build and preserve both artifacts before publishing

### Overseas Sites artifact

1. Read and follow the available `sites-building` and `sites-hosting` skills. This repository contains `.openai/hosting.json`, so the Sites workflow is mandatory for the overseas target.
2. Run `npm run build:sites`.
3. Run `node scripts/check-atomic-service-worker.mjs dist/client`.
4. Capture `dist/client/version.json`, especially `releaseVersion` and `shellVersion`.
5. Package the validated Sites output with the Sites plugin's `package-site.sh` helper before another build overwrites `dist/`.

### Domestic static artifact

Run:

```bash
.agents/skills/dmg-dual-deploy/scripts/build-domestic-archive.sh
```

The script performs the local production build, validates the offline shell and workspace, creates a static archive outside the repository, and prints its SHA-256, file count, commit, and version manifest. Preserve that output for upload verification.

Both artifacts must come from the same Git commit. If a build changes tracked source files, resolve and commit that change, then rebuild both artifacts.

## 3. Publish the overseas target

Follow `sites-hosting` using the existing Sites project.

1. Reuse or obtain a short-lived source write credential without persisting it in Git or a remote URL.
2. Push the exact validated source commit.
3. Save one Sites version with the captured commit SHA and packaged archive.
4. Deploy that version and poll its deployment status until it succeeds or fails.
5. Preserve the previously active Sites version ID for rollback.
6. Verify both the returned Sites URL and the custom domain. The custom domain is the user-facing result.

Do not rebuild between packaging and saving the Sites version unless source changed; if source changed, restart the dual build from step 1.

## 4. Publish the domestic target

Use interactive SSH or an already authenticated session. If authentication is unavailable, ask for access without echoing a secret into a shell command.

1. Check disk space, service health, current `version.json`, and the exact release/backup paths.
2. Upload the archive to an explicit `/tmp/dmg-static-<sha>.tar.gz` path.
3. Compute SHA-256 on the server and require an exact match before extraction.
4. Extract into `/var/www/dmg-static.release-<sha>`, then verify file count and `version.json`.
5. Set directories to `0755`, files to `0644`, and ownership to `root:root`.
6. Copy only missing files from the previous `assets/` directory into the staged release so clients holding the previous HTML can still request its hashed chunks. Never overwrite new release files.
7. Verify Nginx configuration with `nginx -t`. Keep Nginx on `127.0.0.1:8080` and expose only Caddy publicly.
8. Rename the current release to a timestamped `/var/www/dmg-static.prev-<timestamp>-<sha>` backup, then move the staged release to `/var/www/dmg-static`. If the second rename fails, restore the backup immediately.
9. Reload Nginx. Restart it only when a listener change cannot take effect through reload.
10. Verify Caddy and Nginx are active, the new `version.json` is served, and port 8080 is not reachable publicly.
11. Remove only the explicit temporary upload and test files after verification. Keep previous release directories unless the user authorizes cleanup.

Until the domestic domain is filed and activated, keep Caddy on HTTP port 80 and do not invent or enable HTTPS. After the domain is ready, configure HTTPS first and verify secure-context browser APIs before announcing domestic desktop support.

## 5. Verify the release matrix

Run the public verifier with the shell versions captured from each build:

```bash
EXPECTED_DOMESTIC_SHELL_VERSION=<domestic-shell> \
EXPECTED_OVERSEAS_SHELL_VERSION=<overseas-shell> \
  .agents/skills/dmg-dual-deploy/scripts/verify-public-targets.sh
```

Also confirm:

- overseas `/` and `/mobile` are HTTPS and return the new version;
- overseas `manifest.webmanifest` and `sw.js` are reachable for the desktop PWA;
- domestic `/mobile` returns the new version over the currently configured protocol;
- entry HTML, `version.json`, manifests, and `sw.js` do not retain stale cache headers;
- hashed build assets are immutable, while data and authored images revalidate;
- no warning-or-higher Nginx/Caddy journal entries appeared during the switch.

Run interactive browser or offline-PWA QA only when the user requests browser testing or the release specifically changes authentication, OPFS, Service Worker, caching, or startup behavior.

## 6. Handle partial failure

- Prefer a safe roll-forward while the cause is understood and the unchanged target remains healthy.
- If one route updated and the other cannot be completed, restore the updated route to its recorded previous version unless the user explicitly accepts a split release.
- For Sites, redeploy the recorded previous version.
- For the domestic server, move the failed release aside, restore the recorded `dmg-static.prev-*` directory, validate, and reload Nginx.
- Report which target failed, which version remains live on each route, and whether rollback succeeded.

## 7. Handoff

Keep the final report concise. Include:

- source commit;
- overseas desktop and mobile URLs;
- domestic desktop and mobile URLs, with the current desktop protocol limitation if applicable;
- deployed `releaseVersion` and both shell versions;
- validation result and retained rollback points.
