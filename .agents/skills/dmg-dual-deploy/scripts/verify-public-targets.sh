#!/usr/bin/env bash
set -euo pipefail

domestic_base="${DOMESTIC_BASE_URL:-https://dmgendfield.cloud}"
overseas_base="${OVERSEAS_BASE_URL:-https://dmgendfield.online}"
overseas_provider_base="${OVERSEAS_PROVIDER_BASE_URL:-https://dmgendfield-online.hf233666.chatgpt.site}"
expected_domestic="${EXPECTED_DOMESTIC_SHELL_VERSION:-}"
expected_retirement="${EXPECTED_OVERSEAS_RETIREMENT_SHELL_VERSION:-}"

status_for() {
  local route="$1"
  local url="$2"
  if [[ "$route" == "domestic" ]]; then
    curl --noproxy '*' -L -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url"
  else
    curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url"
  fi
}

body_for() {
  local route="$1"
  local url="$2"
  if [[ "$route" == "domestic" ]]; then
    curl --noproxy '*' -L -fsS --max-time 15 "$url"
  else
    curl -fsS --max-time 15 "$url"
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

require_308() {
  local label="$1"
  local url="$2"
  local expected_location="$3"
  local result status location
  result="$(curl -sS -o /dev/null -w '%{http_code}\n%{redirect_url}' --max-time 15 "$url")"
  status="${result%%$'\n'*}"
  location="${result#*$'\n'}"
  if [[ "$status" != "308" || "$location" != "$expected_location" ]]; then
    echo "$label failed: HTTP $status, Location $location (expected $expected_location)" >&2
    exit 1
  fi
  printf '%s=308 -> %s\n' "$label" "$location"
}

shell_version() {
  node -e "let value=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(String(JSON.parse(value).shellVersion || '')));"
}

verify_retirement_origin() {
  local label="$1"
  local base="$2"
  require_308 "${label}_DESKTOP" "$base/" "$domestic_base/"
  require_308 "${label}_MOBILE" "$base/mobile?from=overseas" "$domestic_base/mobile?from=overseas"
  require_308 "${label}_SHARE" "$base/share/AbCdEfGhIjKlMn01?source=qr" "$domestic_base/share/AbCdEfGhIjKlMn01?source=qr"
  require_308 "${label}_RESOURCE" "$base/resources/stable.json" "$domestic_base/resources/stable.json"
  require_200 overseas "${label}_SERVICE_WORKER" "$base/sw.js"
  require_200 overseas "${label}_VERSION" "$base/version.json"
  require_200 overseas "${label}_SHARE_API" "$base/api/mobile-shares/health"
}

require_200 domestic DOMESTIC_DESKTOP "$domestic_base/"
require_200 domestic DOMESTIC_MOBILE "$domestic_base/mobile"
require_200 domestic DOMESTIC_SERVICE_WORKER "$domestic_base/sw.js"
require_200 domestic DOMESTIC_SHARE_API "$domestic_base/api/mobile-shares/health"

verify_retirement_origin OVERSEAS_CUSTOM "$overseas_base"
verify_retirement_origin OVERSEAS_PROVIDER "$overseas_provider_base"

domestic_shell="$(body_for domestic "$domestic_base/version.json" | shell_version)"
retirement_shell="$(body_for overseas "$overseas_base/version.json" | shell_version)"

if [[ -n "$expected_domestic" && "$domestic_shell" != "$expected_domestic" ]]; then
  echo "Domestic shell mismatch: expected $expected_domestic, got $domestic_shell" >&2
  exit 1
fi

if [[ -n "$expected_retirement" && "$retirement_shell" != "$expected_retirement" ]]; then
  echo "Overseas retirement shell mismatch: expected $expected_retirement, got $retirement_shell" >&2
  exit 1
fi

printf 'DOMESTIC_SHELL_VERSION=%s\n' "$domestic_shell"
printf 'OVERSEAS_RETIREMENT_SHELL_VERSION=%s\n' "$retirement_shell"
printf 'DEPLOYMENT_TARGETS_OK\n'
