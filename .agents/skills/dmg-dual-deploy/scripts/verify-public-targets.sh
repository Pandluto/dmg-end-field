#!/usr/bin/env bash
set -euo pipefail

domestic_base="${DOMESTIC_BASE_URL:-http://150.158.133.176}"
overseas_base="${OVERSEAS_BASE_URL:-https://dmgendfield.online}"
expected_domestic="${EXPECTED_DOMESTIC_SHELL_VERSION:-}"
expected_overseas="${EXPECTED_OVERSEAS_SHELL_VERSION:-}"

status_for() {
  local route="$1"
  local url="$2"
  if [[ "$route" == "domestic" ]]; then
    curl --noproxy '*' -L -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url"
  else
    curl -L -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url"
  fi
}

body_for() {
  local route="$1"
  local url="$2"
  if [[ "$route" == "domestic" ]]; then
    curl --noproxy '*' -L -fsS --max-time 15 "$url"
  else
    curl -L -fsS --max-time 15 "$url"
  fi
}

require_200() {
  local route="$1"
  local label="$2"
  local url="$3"
  local status
  status="$(status_for "$route" "$url")"
  if [[ "$status" != "200" ]]; then
    echo "$label failed: HTTP $status ($url)" >&2
    exit 1
  fi
  printf '%s=200\n' "$label"
}

shell_version() {
  node -e "let value=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(String(JSON.parse(value).shellVersion || '')));"
}

require_200 domestic DOMESTIC_DESKTOP "$domestic_base/"
require_200 domestic DOMESTIC_MOBILE "$domestic_base/mobile"
require_200 domestic DOMESTIC_SERVICE_WORKER "$domestic_base/sw.js"
require_200 overseas OVERSEAS_DESKTOP "$overseas_base/"
require_200 overseas OVERSEAS_MOBILE "$overseas_base/mobile"
require_200 overseas OVERSEAS_MANIFEST "$overseas_base/manifest.webmanifest"
require_200 overseas OVERSEAS_SERVICE_WORKER "$overseas_base/sw.js"

domestic_shell="$(body_for domestic "$domestic_base/version.json" | shell_version)"
overseas_shell="$(body_for overseas "$overseas_base/version.json" | shell_version)"

if [[ -n "$expected_domestic" && "$domestic_shell" != "$expected_domestic" ]]; then
  echo "Domestic shell mismatch: expected $expected_domestic, got $domestic_shell" >&2
  exit 1
fi

if [[ -n "$expected_overseas" && "$overseas_shell" != "$expected_overseas" ]]; then
  echo "Overseas shell mismatch: expected $expected_overseas, got $overseas_shell" >&2
  exit 1
fi

printf 'DOMESTIC_SHELL_VERSION=%s\n' "$domestic_shell"
printf 'OVERSEAS_SHELL_VERSION=%s\n' "$overseas_shell"
printf 'DEPLOYMENT_TARGETS_OK\n'
