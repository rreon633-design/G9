# G9

**Files, streams, live TV. One player.**

Desktop player with a **Rust / Tauri** core and a **vanilla HTML/CSS/JS** UI. You supply the files and playlists.

> G9 does not provide channels, playlists, or provider credentials.

## Windows release (v0.1.2)

Optimized **Windows 10/11 64-bit** builds are published from GitHub Actions when a `v*` tag is pushed:

- NSIS setup (per-user, LZMA, no admin)
- MSI
- Portable `G9.exe` zip

Download: [Releases](https://github.com/rreon633-design/G9/releases)

WebView2 is used for playback (already on Windows 11; the installer fetches it on older PCs if missing). No Chromium is bundled — that keeps the app small.

## Develop

```bash
npm install
npm run dev
cargo test --workspace
```

Frontend is only `ui/index.html`, `ui/styles.css`, `ui/app.js` (plus `ui/gif.js`).

See [FEATURE-LIST.md](FEATURE-LIST.md) for what ships and what this WebView engine cannot do.

## License

Apache-2.0 OR MIT.
