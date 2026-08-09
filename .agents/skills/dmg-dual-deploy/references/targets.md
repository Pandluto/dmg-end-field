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
- Current base URL: `http://150.158.133.176`
- Current desktop route: `http://150.158.133.176/`
- Current mobile route: `http://150.158.133.176/mobile`
- Static root: `/var/www/dmg-static`
- Staged release: `/var/www/dmg-static.release-<short-sha>`
- Rollback release: `/var/www/dmg-static.prev-<timestamp>-<short-sha>`
- Upload path: `/tmp/dmg-static-<short-sha>.tar.gz`

Current topology:

```text
Internet :80 -> Caddy -> 127.0.0.1:8080 -> Nginx -> /var/www/dmg-static
```

The domestic desktop route cannot provide the full workspace while it remains plain HTTP because public-IP HTTP is not a secure context. Its HTTP 200 response is only a shell response, not a functional desktop acceptance result. The domestic mobile route is the usable domestic entry during this period.

No SSH password, private key, token, or certificate belongs in this file.

## Domestic cache contract

- `index.html`, SPA fallbacks, `version.json`, `sw.js`, `manifest.webmanifest`, `web-data-manifest.json`, and `web-image-manifest.json`: `no-store` or equivalent no-cache/revalidation behavior.
- Hashed JS, CSS, Worker, and WASM under `/assets/`: one-year immutable caching.
- `/assets/images/`: `max-age=0, must-revalidate`; do not inherit the immutable `/assets/` rule.
- `/data/`: `max-age=0, must-revalidate` so current data can replace fixed paths.
- Versioned package parts under `/packages/`: immutable caching.
- `sw.js`: include `Service-Worker-Allowed: /`.

## Domestic HTTPS migration

After the domestic domain filing is complete:

1. Replace the public domestic URLs in this file with the final domain.
2. Configure the domain in Caddy and validate automatic HTTPS before redirecting HTTP.
3. Verify `window.isSecureContext`, Web Crypto, Service Worker, OPFS, and SQLite startup in current desktop Chrome or Edge.
4. Verify both desktop and mobile routes over HTTPS.
5. Only then remove the domestic desktop limitation from announcements and deployment handoffs.
