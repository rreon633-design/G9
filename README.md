# G9

**Files, streams, live TV. One player.**

Desktop cinema player: **Rust / Tauri 2** core, **vanilla HTML/CSS/JS** UI (no React, Vite, or frontend npm libraries). You supply the files and playlists.

> G9 does not provide channels, playlists, or provider credentials.

## Windows release (v0.2.0)

Optimized **Windows 10/11 64-bit** builds are published from GitHub Actions when a `v*` tag is pushed:

- NSIS setup (per-user, LZMA, no admin)
- MSI
- Portable `G9.exe` zip

Download: [Releases](https://github.com/rreon633-design/G9/releases)

WebView2 is used for playback (already on Windows 11; the installer fetches it on older PCs if missing). No Chromium is bundled — that keeps the app small. Hardware decode is **DXVA / D3D11** via WebView2.

## Docs

| Doc | What |
|---|---|
| [FEATURE-LIST.md](FEATURE-LIST.md) | What ships, keyboard/IPC, and what was requested but not implemented |
| [docs/USER.md](docs/USER.md) | First run, keys, privacy |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Build, test, tag a release |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Crates and playback path |
| [docs/SECURITY.md](docs/SECURITY.md) | Untrusted playlists, IPC, subtitles |

## Develop

```bash
npm install          # @tauri-apps/cli only
npm run dev
cargo test -p g9-core -p g9-iptv -p g9-store
```

Frontend is `ui/index.html`, `ui/styles.css`, `ui/app.js`, `ui/gif.js`.

CI: `.github/workflows/ci.yml` (Ubuntu tests on crates + vanilla UI check).  
Release: `.github/workflows/release.yml` (Windows x64 on `v*` tags).

## License

Apache-2.0 OR MIT.
