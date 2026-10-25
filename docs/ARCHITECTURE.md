# G9 architecture

```
ui/  HTML + CSS + JS  (+ gif.js)
        │  window.__TAURI__.core.invoke  /  event.listen
        ▼
src-tauri  (crate g9)
        │
   ┌────┼──────────┬──────────┬─────────┐
   ▼    ▼          ▼          ▼         ▼
g9-iptv  g9-store  subs.rs   dlna.rs   tools.rs
                   ipc.rs    fetch.rs
```

## Rules

- **UI has no business logic** beyond presentation and playback.
- **Media bytes** are loaded by the webview (`<video>`), not by reqwest.
- **Playlist / logo / Xtream JSON** go through `fetch.rs` (rustls, size cap, no `file:` scheme).
- **No frontend frameworks, no TypeScript, no bundler.** `ui/` is `frontendDist`.
- Playback is **WebView2** on Windows (DXVA). G9 is not mpv/FFmpeg.

## Crates

| Crate | Role |
|---|---|
| `g9-core` | Version, content policy, DTOs, errors |
| `g9-iptv` | Streaming M3U parse, injection strip, dangerous URL filter |
| `g9-store` | SQLite WAL, sources, channels, history, settings |
| `g9` (`src-tauri`) | Window, commands, subtitles, DLNA, IPC, optional ffmpeg |

## `src-tauri` modules

| Module | Role |
|---|---|
| `commands.rs` | Tauri command surface |
| `subs.rs` | Sidecar / TheSubDB / OpenSubtitles / Podnapisi / ffmpeg-embedded / Whisper CLI |
| `dlna.rs` | SSDP MediaServer discover + ContentDirectory browse |
| `ipc.rs` | JSON lines on `127.0.0.1:18765` |
| `tools.rs` | ffmpeg convert/extract/remux/RTMP, ffprobe, MyMemory translate |
| `fetch.rs` | HTTP(S) playlist / RSS fetch |

## Playback

- MP4 / WebM / many others the OS decoder accepts, via `<video src>`
- HLS: native where the webview supports it; else a small MSE MPEG-TS loader in `ui/app.js`
- Captions: WebVTT overlay (ASS/SSA flattened to timed text)

A later phase could add libmpv behind the same commands without changing the playlist store — that would be a different product for shaders, NVDEC, and disc menus.
