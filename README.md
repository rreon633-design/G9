# G9

**Files, streams, live TV. One player.**

G9 is a desktop media player (Windows, Linux, macOS) built with a **Rust / Tauri** core and a **vanilla HTML/CSS/JS** UI. It plays local files and live playlists **you supply**.

> G9 does not provide channels, playlists, or provider credentials. Only add sources you are allowed to use.

## Status

v0.1.0 — Phase 0/2 foundation:

- Open local files and HTTP(S) URLs
- Import M3U/M3U8 (paste, file, or URL)
- Channel list, groups, search, favourites, number-pad zap
- SQLite store (WAL)
- Hostile-playlist sanitiser (`#EXTVLCOPT` stripped, `file:` blocked on remote lists)
- GitHub Actions CI + tagged GitHub Releases

Not in this build: timeshift, multi-view, Stalker portals, scripting.

## Quick start (developers)

```bash
# Rust stable + Node 20
# Linux: libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
npm install
npm run dev          # tauri dev
```

```bash
cargo test --workspace
bash scripts/ci-local.sh
```

## Usage

1. **Open file** — MP4/WebM and other formats the webview can decode.
2. **Add playlist** — paste an M3U, pick a file, or fetch a URL.
3. **Load demo clips** (Settings) — Creative Commons samples, not TV channels.
4. Keys: `Space` play/pause · `↑/↓` zap · number pad · `F` fullscreen · `D` diagnostics · `/` search.

## Repository

```
crates/g9-core    shared types
crates/g9-iptv    M3U parser + URL sanitiser
crates/g9-store   SQLite
src-tauri/        Tauri 2 app (commands, HTTP fetch)
ui/               HTML, CSS, vanilla JS only
.github/workflows CI + Release
```

## CI / Release

Push to `main` runs tests and a Tauri build on Ubuntu, Windows, and macOS.

Push a tag `v0.1.0` to draft a GitHub Release with installers.

This sandbox cannot push to GitHub (no GitHub app connected). Create an empty repo, then:

```bash
git remote add origin git@github.com:<you>/g9.git
git push -u origin main
git tag v0.1.0
git push origin v0.1.0
```

## License

Apache-2.0 OR MIT. libmpv is **not** bundled in v0.1 (playback is the OS webview). That keeps the app license flexible.
