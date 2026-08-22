#!/usr/bin/env bash
set -euo pipefail

repo_root="${DMG_REPO_ROOT:-}"
output_dir="${1:-}"

if [[ -z "$repo_root" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi

if [[ -z "$repo_root" || ! -e "$repo_root/.git" || ! -f "$repo_root/package.json" ]]; then
  echo "Run this helper from inside the DMG Endfield Git worktree, or set DMG_REPO_ROOT to that worktree." >&2
  exit 1
fi

if [[ -z "$output_dir" ]]; then
  output_dir="$(mktemp -d /tmp/dmg-domestic-deploy.XXXXXX)"
else
  mkdir -p "$output_dir"
  output_dir="$(cd "$output_dir" && pwd)"
fi

cd "$repo_root"

source_branch="$(git branch --show-current)"
if [[ "$source_branch" != "codex/v1.8-lts-slimming" && "${DMG_ALLOW_NON_SLIMMING_BUILD:-}" != "1" ]]; then
  echo "Refusing domestic Web build from $source_branch; switch to codex/v1.8-lts-slimming." >&2
  echo "Set DMG_ALLOW_NON_SLIMMING_BUILD=1 only when the user explicitly authorized another source branch." >&2
  exit 1
fi

npm run typecheck
npm run build:local
npm run check:offline-shell
npm run check:offline-workspace

commit_sha="$(git rev-parse HEAD)"
short_sha="$(git rev-parse --short=8 HEAD)"
archive_path="$output_dir/dmg-static-$short_sha.tar.gz"

if [[ -e "$archive_path" ]]; then
  echo "Refusing to overwrite existing archive: $archive_path" >&2
  exit 1
fi

COPYFILE_DISABLE=1 tar --no-xattrs -C dist -czf "$archive_path" .

if command -v shasum >/dev/null 2>&1; then
  archive_sha256="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
else
  archive_sha256="$(sha256sum "$archive_path" | awk '{print $1}')"
fi

file_count="$(find dist -type f | wc -l | tr -d ' ')"
version_manifest="$(tr -d '\n' < dist/version.json)"

printf 'ARCHIVE=%s\n' "$archive_path"
printf 'SHA256=%s\n' "$archive_sha256"
printf 'FILES=%s\n' "$file_count"
printf 'COMMIT=%s\n' "$commit_sha"
printf 'VERSION_MANIFEST=%s\n' "$version_manifest"
