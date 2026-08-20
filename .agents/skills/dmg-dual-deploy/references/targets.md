# Production targets

Update this file whenever a domain, host, path, protocol, or deployment provider changes.

## Source and builds

- Default release branch: `codex/v1.8-lts-slimming`
- Maintained application build: `npm run build:local`
- Domestic static root: `dist`
- Overseas retirement build: `npm run build:sites`
- Sites project metadata: `.openai/hosting.json`

## Retired overseas Sites route

- Former user-facing origin: `https://dmgendfield.online`
- Provider fallback origin: `https://dmgendfield-online.hf233666.chatgpt.site`
- Replacement origin: `https://dmgendfield.cloud`
- Sites project ID: reuse the value in `.openai/hosting.json`

The overseas origin no longer serves or receives normal application/resource releases. The retirement Worker applies on both hostnames:

- all UI, navigation, asset, manifest, and resource paths return `308` to the same pathname and query on `https://dmgendfield.cloud`;
- `/sw.js` stays on the overseas origin and installs a no-cache migration Worker so previously installed PWAs stop serving the cached overseas shell;
- `/version.json` stays on the overseas origin and advertises the retirement shell;
- `/api/mobile-shares` stays on the overseas origin as a compatibility API for historic D1/R2 records and old QR codes.

Fragments are client-side only; browsers inherit the original fragment across an HTTP redirect whose `Location` has no fragment. The redirect target must always be assembled from the fixed domestic origin by assigning pathname and query separately, never by resolving an incoming `//...` pathname as a URL.

Do not delete the custom domain, Sites project, D1 database, R2 bucket, or prior live version. A normal domestic release must leave this retirement route untouched.

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

## Domestic resource and cache contract

The domestic origin is the only maintained resource channel. Former overseas resource URLs redirect path-for-path to it.

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
