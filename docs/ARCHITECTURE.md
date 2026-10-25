# G9 architecture

```
ui/  HTML + CSS + JS
        │  window.__TAURI__.core.invoke  /  event.listen
        ▼
src-tauri  (crate g9)
        │
   ┌────┼──────────┬──────────┬─────────┬──────────┐
   ▼    ▼          ▼          ▼         ▼          ▼
g9-iptv  g9-store  subs.rs   dlna.rs   tools.rs   fun.rs
                   ipc.rs    fetch.rs             │
                                                   ▼
                                              g9-sources
                                        (addons · rss · ytdlp
                                         · mangadex parsers)
```

## Rules

- **UI has no business logic** beyond presentation and playback.
- **Media bytes** are loaded by the webview (`<video>`), not by reqwest.
- **Playlist / logo / Xtream JSON** go through `fetch.rs` (rustls, size cap, no `file:` scheme).
- **No frontend frameworks, no TypeScript, no bundler.** `ui/` is `frontendDist` as-is.
- Playback is **WebView2** on Windows (DXVA / D3D11). G9 is not mpv/FFmpeg, and does not
  pretend to be: features that need `libplacebo`, `libdvdnav`, a cast stack or a cloud
  account are documented as not implemented in `FEATURE-LIST.md` instead of stubbed.

## Crates

| Crate | Role |
|---|---|
| `g9-core` | Version, content policy, DTOs, errors, download format ladder |
| `g9-iptv` | Streaming M3U parse, injection strip, dangerous URL filter, XMLTV now/next |
| `g9-sources` | Fun Mode source layer: Stremio addon protocol, RSS magnets, yt-dlp `-J`, MangaDex. Pure parsing — no network, no catalogue |
| `g9-store` | SQLite WAL, sources, channels (country/language/quality), history, settings |
| `g9` (`src-tauri`) | Window, commands, subtitles, DLNA, IPC, optional ffmpeg |

## `src-tauri` modules

| Module | Role |
|---|---|
| `commands.rs` | Tauri command surface (playlist import, subs, DLNA, ffmpeg, translate, update check, open link) |
| `files.rs` | Frame/recording writes, plus `list_folder`, `read_text` and the `.m3u8` queue reader/writer |
| `update.rs` | GitHub release check and the version comparison behind *Check for updates* |
| `state.rs` | `AppState`: store handle, DB path, HTTP client |
| `subs.rs` | Sidecar / TheSubDB / OpenSubtitles / Podnapisi / ffmpeg-embedded / Whisper CLI |
| `dlna.rs` | SSDP MediaServer discover + ContentDirectory browse |
| `ipc.rs` | JSON lines on `127.0.0.1:18765` |
| `tools.rs` | ffmpeg convert/extract/remux/RTMP, ffprobe, MyMemory translate |
| `fetch.rs` | HTTP(S) playlist / RSS / guide fetch (gzip-aware) |
| `ffmpeg.rs` | Managed FFmpeg: download + unpack into app data, resolve `ffmpeg` / `ffprobe` before PATH |
| `windows.rs` | Extra player windows (`player-*`), Windows shutdown timer, user shader files |
| `dl.rs` | Web-video jobs: managed yt-dlp, child processes, progress, pause/resume, persisted state, notifications |
| `epg.rs` | XMLTV guide cache: id + display-name matching, now/next, gzipped copy on disk |
| `xtream.rs` | Xtream Codes portal → M3U, then the normal import path |

## Playback path

| Input | Path |
|---|---|
| MP4 / WebM / most OS-decodable files | `<video src>` / asset protocol |
| HLS (`.m3u8`) | native webview where supported, else MSE MPEG-TS loader in `ui/app.js` |
| IPTV (`.m3u`) | `g9-iptv` parse → `g9-store` → TV Mode grid or live sheet (+ `epg.rs` now/next) → `<video>` |
| DLNA item | SSDP discover → SOAP `Browse` → resolved HTTP URL → `<video>` |
| SMB / UNC | `Open path` → `file://` asset scope → `<video>` |
| 360° equirectangular | WebGL texture on `<canvas id="view360">`, drag to look |
| Subtitles | WebVTT `<track>` overlay (ASS/SSA flattened to timed text) |
| Visualizer | Web Audio `AnalyserNode` → `<canvas id="viz">` |

## Optional external binaries

G9 never bundles FFmpeg or Whisper. `ffmpeg.rs` can **download** a static FFmpeg build into
`<app data>/ffmpeg` on request; otherwise G9 uses PATH. Binaries are spawned **hidden**
(`CREATE_NO_WINDOW`) for:

| Binary | Used by |
|---|---|
| `ffmpeg` (managed or PATH) | convert / extract / remux / RTMP / embedded subtitle extraction |
| `ffprobe` (managed or PATH) | chapters, inspect (Diagnostics) |
| `whisper` / `whisper-cli` | Generate captions (opt-in, never during normal subtitle search) |
| `yt-dlp` (managed or PATH) | welcome-screen downloads; spawned hidden, `--newline` progress on stdout |

## CI / CD

| Workflow | Runner | Purpose |
|---|---|---|
| `ci.yml` → `rust` | ubuntu-24.04 | fmt, clippy, tests for the three library crates |
| `ci.yml` → `windows-app` | windows-latest | `cargo check -p g9` — the crate Ubuntu cannot build |
| `ci.yml` → `frontend` | ubuntu-24.04 | vanilla-UI guard (no TS, no npm UI deps) |
| `release.yml` | windows-latest | on `v*`: release tests, NSIS + MSI + portable zip, GitHub Release |

Release artifacts come only from tags; `main` never publishes.

A later phase could add libmpv behind the same commands without changing the playlist store —
that would be a different product, and the only way to get shaders, NVDEC, and disc menus.

## Fun Mode

`fun.rs` is the only place that does HTTP for Fun Mode; `g9-sources` is the only place that
parses. A shelf is `catalog → parse_catalogs → Item`s; a stream is `stream route → parse_streams →
Stream`, best first. `Stream` carries the headers a CDN needs, so a future local proxy can serve
referer-gated links without the webview ever seeing them. Progress rows (`fun_progress`) are
written on every play and on every chapter open, which is what Continue watching reads.
