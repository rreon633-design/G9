# G9

**Files, streams, live TV. One player.**

[![CI](https://github.com/rreon633-design/G9/actions/workflows/ci.yml/badge.svg)](https://github.com/rreon633-design/G9/actions/workflows/ci.yml)
[![Release](https://github.com/rreon633-design/G9/actions/workflows/release.yml/badge.svg)](https://github.com/rreon633-design/G9/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/rreon633-design/G9?include_prereleases)](https://github.com/rreon633-design/G9/releases/latest)

Desktop cinema player: **Rust / Tauri 2** core, **vanilla HTML/CSS/JS** UI (no React, TypeScript,
Vite, or frontend npm libraries). You supply the files, streams, and playlists.

> G9 is a player. It ships **no channels**, playlists, or provider credentials.

## Windows release (v0.2.0)

Optimized **Windows 10 / 11 64-bit** builds are published by GitHub Actions when a `v*` tag is pushed:

| File | What |
|---|---|
| `G9_0.2.0_x64-setup.exe` | NSIS installer — per-user, LZMA, no admin |
| `G9_0.2.0_x64_en-US.msi` | MSI for managed deployment |
| `G9-windows-x64-portable.zip` | Portable `G9.exe`, no install |

Download: **[Releases](https://github.com/rreon633-design/G9/releases)**

Playback is WebView2 (`<video>`), with **DXVA / D3D11** hardware decode. WebView2 is already on
Windows 11; the installer fetches it on older PCs. No Chromium is bundled, which keeps the
download small.

## What it does

- Local files, HTTP(S) streams, HLS, UNC / SMB paths
- IPTV from an M3U **you are allowed to use**; live sheet with favourites, groups, search
- Online subtitles (OpenSubtitles hash + title, TheSubDB, Podnapisi) with auto-apply; sidecar
  SRT/VTT/ASS; subtitle browser; live cue translation
- Scrub preview, storyboard, chapters, playlist queue, PiP, always-on-top, 360° look-around
- EQ / boost, speed 0.25–2× with pitch lock, A–B loop, bookmarks, sleep timer
- GIF export, frame save, region + screen + webcam recording, scene poster
- DLNA browse, podcast RSS
- Optional **ffmpeg on PATH**: convert / extract / remux / RTMP / embedded subs
- JSON IPC on `127.0.0.1:18765`

Full shipped list, keyboard map and IPC examples: **[FEATURE-LIST.md](FEATURE-LIST.md)** — which
also lists every requested feature that is **not** in G9 and why.

## Docs

| Doc | What |
|---|---|
| [FEATURE-LIST.md](FEATURE-LIST.md) | What ships, keyboard / IPC, and the not-implemented gap list |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [docs/USER.md](docs/USER.md) | First run, playback, keys, privacy |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Build, test, release checklist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Crates, modules, playback path, CI |
| [docs/SECURITY.md](docs/SECURITY.md) | Untrusted playlists, subtitles, IPC, spawned binaries |

## Develop

```bash
npm install          # @tauri-apps/cli only
npm run dev
cargo test -p g9-core -p g9-iptv -p g9-store
```

Frontend is `ui/index.html`, `ui/styles.css`, `ui/app.js`, `ui/gif.js` — copied as `frontendDist`.

## CI / CD

| Workflow | Trigger | Jobs |
|---|---|---|
| `.github/workflows/ci.yml` | push / PR | Ubuntu: fmt, clippy, test `g9-core` `g9-iptv` `g9-store` · Windows: `cargo check` of the app crate · vanilla-UI guard |
| `.github/workflows/release.yml` | `v*` tag, dispatch | Windows x64: tests, `tauri build` (NSIS + MSI + portable zip), GitHub Release |

The app crate cannot compile on Ubuntu (no WebKit), so CI compiles it on **windows-latest** —
a Windows-only compile error fails CI before it can reach a release tag.

## License

Apache-2.0 OR MIT.
