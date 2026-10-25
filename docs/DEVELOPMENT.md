# Developing G9

## Prerequisites

- Rust stable (1.77+)
- Node 20 (only for `@tauri-apps/cli`)
- Linux packages: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf`

## Commands

| Command | What |
|---|---|
| `npm install` | CLI only — no frontend npm libraries |
| `npm run dev` | `tauri dev` |
| `cargo test --workspace` | parser + store tests |
| `cargo fmt --all` | format |
| `cargo clippy --workspace --all-targets -- -D warnings` | lint |
| `bash scripts/ci-local.sh` | same gates as GitHub Actions |

## Frontend

Edit files in `ui/` and reload the Tauri window. Do not add React, Vue, Svelte, TypeScript, or Vite.

Tauri APIs are used through `window.__TAURI__` (`withGlobalTauri: true`).

## Tests of note

- `g9-iptv` strips `#EXTVLCOPT` / `#KODIPROP` and drops `file:` on remote playlists.
- `g9-iptv` parses 100k generated channels in under 10s.
- `g9-store` upserts sources and searches by name.

## Release

```bash
git tag v0.1.2
git push origin v0.1.2
```

GitHub Actions workflow `Release` drafts installers.
