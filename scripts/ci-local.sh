#!/usr/bin/env bash
# Mirrors .github/workflows/ci.yml as closely as this machine allows.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

echo "== vanilla UI =="
test -f ui/index.html
test -f ui/styles.css
test -f ui/app.js
if grep -RInE 'from ["'"'"']react|from ["'"'"']vue|\.tsx?' ui; then
  echo "frontend must stay HTML/CSS/vanilla JS"
  exit 1
fi

echo "== social domtests =="
if [[ ! -d domtest/node_modules ]]; then (cd domtest && npm install jsdom); fi
node domtest/smoke12.js
node domtest/smoke13.js

echo "== rustfmt =="
cargo fmt --all

echo "== clippy =="
cargo clippy --workspace --all-targets -- -D warnings

echo "== tests =="
cargo test --workspace

echo "== tauri build (debug) =="
if [[ ! -d node_modules ]]; then npm install; fi
npx tauri build --debug

echo "CI local: OK"
