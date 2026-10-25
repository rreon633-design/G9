# Developing G9

## Prerequisites

- Rust stable (1.77+)
- Node 20 (only for `@tauri-apps/cli`)
- Linux packages (local debug only): `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf`
- Optional: `ffmpeg` / `ffprobe` on PATH for convert, repair, chapters, inspect, RTMP, embedded subs

## Commands

| Command | What |
|---|---|
| `npm install` | CLI only — no frontend npm libraries |
| `npm run dev` | `tauri dev` |
| `cargo test -p g9-core -p g9-iptv -p g9-store` | same crates as GitHub CI |
| `cargo fmt --all` | format |
| `cargo clippy -p g9-core -p g9-iptv -p g9-store --all-targets -- -D warnings` | lint (CI) |
| `bash scripts/ci-local.sh` | extra local gates (may need GTK to clippy crate `g9`) |

## Frontend

Edit files in `ui/` and reload the Tauri window. Do not add React, Vue, Svelte, TypeScript, Vite, or frontend npm libraries.

Tauri APIs are used through `window.__TAURI__` (`withGlobalTauri: true`).

CI checks that `ui/index.html`, `ui/styles.css`, `ui/app.js`, and `ui/gif.js` exist and that there is no `ui/main.ts`.

## Tests of note

- `g9-iptv` strips `#EXTVLCOPT` / `#KODIPROP` and drops `file:` on remote playlists.
- `g9-iptv` parses 100k generated channels in under 10s.
- `g9-store` upserts sources and searches by name.

Ubuntu CI **does not** compile crate `g9` (no WebKit on the runner). Windows **release** builds the full Tauri app.

## Release (Windows only)

1. Bump `Cargo.toml` workspace version, `src-tauri/tauri.conf.json`, `package.json`.
2. Commit and push `main`.
3. Tag and push:

```bash
git tag -a v0.2.0 -m "G9 v0.2.0 Windows"
git push origin v0.2.0
```

Workflow **Release Windows** (`.github/workflows/release.yml`) builds NSIS, MSI, and a portable zip on `windows-latest`, then publishes a GitHub Release.

Repo setting required: **Settings → Actions → General → Workflow permissions → Read and write**.
