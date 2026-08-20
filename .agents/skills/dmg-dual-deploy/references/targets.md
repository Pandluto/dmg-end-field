# Production targets

Update this file whenever a domain, host, path, protocol, or deployment provider changes.

## Source and builds

- Default release branch: `codex/v1.8-lts-slimming`
- Overseas build: `npm run build:sites`
- Overseas client shell: `dist/client`
- Domestic build: `npm run build:local`
- Domestic static root: `dist`
- Sites project metadata: `.openai/hosting.json`

## Overseas Sites

- User-facing base URL: `https://dmgendfield.online`
- Desktop route: `https://dmgendfield.online/`
- Mobile route: `https://dmgendfield.online/mobile`
- Provider fallback URL: `https://dmgendfield-online.hf233666.chatgpt.site/`
- The overseas desktop route is the complete PWA. After the first successful online load and resource installation, it supports offline use.
- The mobile route is an online, simplified portrait interface and should continue reading the current online data/image version.

Reuse the `project_id` already stored in `.openai/hosting.json`. Never replace it merely to fix a deployment.

## Domestic server

- Public IP: `150.158.133.176`
- SSH user: `ubuntu`
- User-facing base URL: `https://dmgendfield.cloud`
- Desktop route: `https://dmgendfield.cloud/`
- Mobile route: `https://dmgendfield.cloud/mobile`
- Legacy IP fallback: `http://150.158.133.176`
- Static root: `/var/www/dmg-static`
- Staged release: `/var/www/dmg-static.release-<short-sha>`
- Rollback release: `/var/www/dmg-static.prev-<timestamp>-<short-sha>`
- Upload path: `/tmp/dmg-static-<short-sha>.tar.gz`

Current topology:

```text
Internet :80/:443 -> Caddy -> 127.0.0.1:8080 -> Nginx -> /var/www/dmg-static
                                                          -> /api/mobile-shares -> 127.0.0.1:8787
```

Domestic mobile tactical sharing uses:

- service source: `server/mobile-share-server.mjs`;
- service root: `/opt/dmg-end-field-share`;
- SQLite database: `/var/lib/dmg-end-field/mobile-shares.sqlite`;
- systemd unit and Nginx snippet: `ops/mobile-share/`.

When a release changes the share service or its Nginx/systemd configuration, deploy and verify that sidecar as part of the same domestic release. Preserve the previous service file and never replace or remove the SQLite database during a code rollout.

The domestic desktop route is accepted only through the filed HTTPS domain. The raw-IP HTTP fallback may be retained for recovery checks, but it is not a functional desktop acceptance result because it is not a secure context.

No SSH password, private key, token, or certificate belongs in this file.

## Domestic cache contract

- `index.html`, SPA fallbacks, `version.json`, `sw.js`, `manifest.webmanifest`, `resources/stable.json`, `web-data-manifest.json`, and `web-image-manifest.json`: `no-store` or equivalent no-cache/revalidation behavior.
- Hashed JS, CSS, Worker, and WASM under `/assets/`: one-year immutable caching.
- `/assets/images/`: `max-age=0, must-revalidate`; do not inherit the immutable `/assets/` rule.
- `/data/`: `max-age=0, must-revalidate` so current data can replace fixed paths.
- Versioned data, manifests, and package parts under `/resources/releases/`: immutable caching.
- `sw.js`: include `Service-Worker-Allowed: /`.

## Domestic HTTPS contract

1. Keep `dmgendfield.cloud` configured in Caddy with automatic certificate renewal and HTTP-to-HTTPS redirects.
2. Keep TCP ports 80 and 443 reachable through the cloud security group; keep Nginx private on `127.0.0.1:8080`.
3. Verify `window.isSecureContext`, Web Crypto, Service Worker, OPFS, and SQLite startup in current desktop Chrome or Edge after infrastructure or shell changes.
4. Verify both desktop and mobile routes over HTTPS before announcing a domestic release.
