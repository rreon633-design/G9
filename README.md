# G9

**Files, streams, live TV. One player.**

[![CI](https://github.com/rreon633-design/G9/actions/workflows/ci.yml/badge.svg)](https://github.com/rreon633-design/G9/actions/workflows/ci.yml)
[![Release](https://github.com/rreon633-design/G9/actions/workflows/release.yml/badge.svg)](https://github.com/rreon633-design/G9/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/rreon633-design/G9?include_prereleases)](https://github.com/rreon633-design/G9/releases/latest)

Desktop cinema player: **Rust / Tauri 2** core, **vanilla HTML/CSS/JS** UI (no React, TypeScript,
Vite, or frontend npm libraries). You supply the files, streams, and playlists.

> G9 is a player. It ships **no channels**, playlists, or provider credentials.

## Windows release (v0.17.0)

Optimized **Windows 10 / 11 64-bit** builds are published by GitHub Actions when a `v*` tag is pushed:

| File | What |
|---|---|
| `G9_0.17.0_x64-setup.exe` | NSIS installer — per-user, LZMA, no admin |
| `G9_0.17.0_x64_en-US.msi` | MSI for managed deployment |
| `G9-windows-x64-portable.zip` | Portable `G9.exe`, no install |

Download: **[Releases](https://github.com/rreon633-design/G9/releases)**

Playback is WebView2 (`<video>`), with **DXVA / D3D11** hardware decode. WebView2 is already on
Windows 11; the installer fetches it on older PCs. No Chromium is bundled, which keeps the
download small.

## What it does

- **Dark and light themes, and every colour in between** — the accent is yours (eight presets
  or any colour), and so are the corner radius, density, overlay text size, interface font,
  animation, translucency and icon weight. Auto follows the Windows app theme live. A profile
  name and avatar, a notification centre that keeps what a toast said, and three start-screen
  widgets (clock, continue watching, library) that can each be switched off

- **Social — chat, voice and video, one link away.** A sidebar docked to the right (`Ctrl+Shift+S`)
  that you keep open while you watch: the player narrows to make room, so the transport and the
  volume stay under your cursor. The rail lists rooms, who is in them right now, saved contacts
  and unread counts, and it opens as a drawer over the transcript. Create a room and
  share the **link or the QR** — that is the whole invite. Every frame is sealed with
  AES-256-GCM before it leaves the app, the room key travels in the link's fragment so the hub
  never sees it, and voice or video starts from the room itself with mute, camera and a clean
  leave. Calls are tuned for latency rather than resolution — 10 ms Opus packets, H.264 for
  hardware decode, a quality ladder that steps down as the room fills, live round-trip and
  per-tile telemetry on screen, automatic reconnect with queued messages, and ICE restarts
  instead of dropped calls. Conversations live in SQLite, so closing G9 loses nothing.
  `g9-hub` — a small relay you run anywhere — is the only server, and no two devices ever need
  the same network.

- **Fun Mode** — movies, web series, anime, drama, manga / manhwa / manhua on one Netflix-shaped
  wall. It opens **already populated** from the Internet Archive's public-domain film collections
  (no account, no key), then reads **sources you add**: any Stremio addon, any RSS feed of magnet
  links, the managed yt-dlp resolver, and MangaDex for the reader. Nothing licensed is bundled, and
  a source you remove stays removed. It keeps **My List**, a **Watching** tab that resumes the
  exact episode, watched / following / not-interested flags, merged search across every source,
  genre-year-quality filters,
  more-like-this and cast pages, autoplay-next, a sleep timer and a mini player, per-title stream
  picking, addon subtitles, reader modes, watch-time stats and a cross-title queue. Sources keep
  their own headers and report their health; addon shelves page and filter through the addon
  itself. Magnet playback is not in yet
- **GPU picture pipeline** — brightness, contrast, saturation, sharpening and a deband /
  dither stage run as WebGL2 shader passes over the frame itself, one upload per presented
  frame and paced by the video's own `requestVideoFrameCallback`. Sharpening is a real
  contrast-adaptive unsharp, not a CSS contrast bump; deband smooths 8-bit steps in skies and
  dark gradients and leaves real edges alone. With every control at default nothing is drawn
  at all, and without WebGL it falls back to CSS filters
- **Video downloader** — paste a link to a video page (YouTube, Instagram, Facebook and other
  sites), pick a quality and size, and let it run in the background; pause, resume, play, reveal
  or delete from the Downloads panel. Needs a managed `yt-dlp`, installed with one click
- **TV Mode** — a YouTube-style channel browser: logo grid, search, **Country / Language /
  Quality** filters, sorting, now/next on every card, a **now-playing bar**, a **RECENT** row,
  paging for huge playlists, **what's on** per channel, and full keyboard/remote control
- **IPTV guide** — XMLTV now/next under each channel, Xtream Codes portals, gzip guides
- **Windows "Open with"** for video, audio and playlist files — double-click plays in G9
- **Split screen**: snap left/right or `Ctrl+Alt+←/→`, responsive down to small windows
- **Everyday basics** — drag a file, folder, subtitle or link onto the window; open a folder into
  the queue; save and reload the queue as a real `.m3u8`; fit / fill / stretch / zoom, rotate and
  mirror the picture; 0.25×–4× speed; `0`–`9` seeks; `?` for every shortcut; window size, position
  and maximized state remembered; a subtitle picker; a stream-stats overlay; **Check for updates**
  in About; and a dropped live stream that retries three times before saying so
- Local files, HTTP(S) streams, HLS, UNC / SMB paths
- IPTV from an M3U **you are allowed to use**; live sheet with favourites, groups, search
- **One-click public indexes** in *Add playlist / IPTV…* — Sports, India, News, Movies,
  Documentary, Music, Kids and All countries from the open [iptv-org](https://github.com/iptv-org/iptv)
  lists. A chip fills the URL; **Import** is still yours to press, and the URL is editable. G9
  ships no channels and no credentials — a link that dies is a link whose owner stopped
  streaming. Merge several sources by importing each one, or by joining the `#EXTM3U` files into
  one master `.m3u` and importing that once
- **`scripts/g9_check.py`** — tests a whole playlist for real (manifest, then a segment download)
  and writes `working.m3u` with only what answered, plus `failed.csv` saying why each one died.
  What the public indexes actually contain, and what has quietly gone: **[docs/STREAMS.md](docs/STREAMS.md)**
- Online subtitles (OpenSubtitles hash + title, TheSubDB, Podnapisi) with a **picker** or
  auto-apply; sidecar SRT/VTT/ASS; subtitle browser; live cue translation
- Chapters, playlist queue, always-on-top, 360° look-around, transcript pane (no PiP by design)
- EQ / boost, speed 0.25–4× with pitch lock, A–B loop, bookmarks, sleep timer
- Frame save, record-what-is-playing, webcam recording, scene poster
- DLNA browse, podcast RSS
- Optional **ffmpeg on PATH**: convert / extract / remux / RTMP / embedded subs
- JSON IPC on `127.0.0.1:18765`
- **Managed FFmpeg**: one click in Settings downloads a static FFmpeg/ffprobe into app data (nothing bundled)
- **Extra player windows**, **transcript pane**, **WebGL shader effects**, **PC shutdown timer**

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

Frontend is `ui/index.html`, `ui/styles.css`, `ui/app.js` — copied as `frontendDist`.

## CI / CD

| Workflow | Trigger | Jobs |
|---|---|---|
| `.github/workflows/ci.yml` | push / PR | Ubuntu: fmt, clippy, test `g9-core` `g9-iptv` `g9-store` · Windows: `cargo check` of the app crate · vanilla-UI guard |
| `.github/workflows/release.yml` | `v*` tag, dispatch | Windows x64: tests, `tauri build` (NSIS + MSI + portable zip), GitHub Release |

The app crate cannot compile on Ubuntu (no WebKit), so CI compiles it on **windows-latest** —
a Windows-only compile error fails CI before it can reach a release tag.

## License

Apache-2.0 OR MIT.
