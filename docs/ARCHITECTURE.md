# G9 architecture

```
ui/ (HTML + CSS + JS)
        │  window.__TAURI__.core.invoke
        ▼
src-tauri commands
        │
   ┌────┼────────────┐
   ▼    ▼            ▼
g9-iptv  g9-store   reqwest (playlists/EPG only)
```

## Rules

- **UI has no business logic** beyond presentation and playback.
- **Media bytes** are loaded by the webview (`<video>`), not by reqwest.
- **Playlist / logo / Xtream JSON** go through `g9` fetch (rustls, size cap, no `file:` scheme).
- **No frontend frameworks, no TypeScript, no bundler.** `ui/` is copied as `frontendDist`.

## Crates

| Crate | Role |
|---|---|
| `g9-core` | Version, content policy, DTOs, errors |
| `g9-iptv` | Streaming M3U parse, injection strip, dangerous URL filter |
| `g9-store` | SQLite WAL, sources, channels, history, settings |
| `g9` (src-tauri) | Tauri window, commands, HTTP playlist fetch |

## Playback

v0.1 uses the OS webview decoder:

- MP4 / WebM via `<video src>`
- HLS: native on WebKit; elsewhere a small MSE MPEG-TS loader in `ui/app.js`

A later phase can add libmpv behind the same commands without changing the playlist store.
