#!/usr/bin/env bash
# Build the GitHub Release description for a version out of CHANGELOG.md.
#
#   scripts/release-notes.sh [version] [changelog] [output]
#
# version defaults to the workspace Cargo.toml, changelog to CHANGELOG.md and
# output to stdout. Keeping the text in one place means a release page can never
# drift away from the changelog again (v0.8.0 shipped with a v0.7.0 blurb
# because the bullets were pasted into the workflow YAML).
set -euo pipefail

cd "$(dirname "$0")/.."

version="${1:-}"
changelog="${2:-CHANGELOG.md}"
[ -n "$version" ] || version=$(sed -nE 's/^version *= *"([^"]+)".*/\1/p' Cargo.toml | head -1)
[ -f "$changelog" ] || { echo "release-notes: no $changelog" >&2; exit 1; }
[ -n "$version" ] || { echo "release-notes: no version" >&2; exit 1; }

notes=$(mktemp)
trap 'rm -f "$notes"' EXIT

# The "## [0.8.0] — date" section, demoted to h3 for the release page.
awk -v want="[$version]" '
  /^## \[/ {
    if (on) exit
    if (index($0, want) > 0) { on = 1; sub(/^## \[/, "### "); sub(/\]/, ""); print; next }
  }
  on { print }
' "$changelog" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' >"$notes"

if [ ! -s "$notes" ]; then
  echo "release-notes: CHANGELOG.md has no [$version] section" >&2
  exit 1
fi

out="${3:-/dev/stdout}"

{
  echo "**Windows 10 / 11 64-bit (x64)** — optimized (LTO, stripped, small)."
  echo
  echo "| File | What |"
  echo "|---|---|"
  echo '| `G9_'"$version"'_x64-setup.exe` | NSIS installer (per-user, LZMA, no admin) |'
  echo '| `G9_'"$version"'_x64_en-US.msi` | MSI, for managed installs |'
  echo '| `G9-windows-x64-portable.zip` | Portable `G9.exe`, unzip and run |'
  echo
  cat "$notes"
  echo
  echo "Full list: [CHANGELOG.md](https://github.com/rreon633-design/G9/blob/main/CHANGELOG.md)"
  echo "Everything G9 can do: [FEATURE-LIST.md](https://github.com/rreon633-design/G9/blob/main/FEATURE-LIST.md)"
  echo
  echo "G9 is a player. It ships **no channels** and **no catalogues** — add your own legal sources."
  echo
  echo "WebView2 is downloaded automatically if missing (already present on Windows 11)."
} >"$out"

[ "$out" = /dev/stdout ] || echo "release-notes: wrote $out ($(wc -c <"$out") bytes for $version)" >&2
