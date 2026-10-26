# G9 feature list

G9 is a **Windows cinema player** (Tauri 2 + WebView2 + vanilla HTML/CSS/JS).  
It is **not** mpv, VLC, or PotPlayer: playback is the OS web engine, not FFmpeg/`libplacebo`. Features that need those engines are listed as **out of scope** on purpose.

Last updated: 2026-10-25 · release **v0.14.0** · source: `main`  
History: [CHANGELOG.md](CHANGELOG.md) · Gap list: [Listed by you — not implemented](#listed-by-you--not-implemented)

---

## In the app

### Downloads
- Paste a link from the welcome screen — YouTube, Instagram, Facebook and any site `yt-dlp` knows
- Quality and size ladder from the page itself (4K → 360p, plus audio-only), with estimated sizes
- Background jobs: progress, speed, ETA, Windows notification on completion
- FFmpeg engine installed on first use (merging is mandatory for modern sites); retry a failed job
- Pause / resume, resume across restarts, play, reveal in Explorer, delete (with or without the file)
- Managed `yt-dlp` install (app data), `PATH` copy honoured, managed FFmpeg used for merging

### Playback
- **Picture fit / fill / stretch / zoom, rotate and mirror** (`Shift+F`, `Shift+R`, `Shift+H`)
- **Drag & drop**: video, several videos, folder, subtitle file, or a link
- **Open folder…** into the queue; **save / open playlists** as `.m3u8`
- **Single-click play/pause, double-click fullscreen**
- **Live-stream reconnect**: 3 tries (1s, 3s, 8s), resumes where it stopped, then says so
- **Stream stats** (`I`) and a **keyboard sheet** (`?`)
- **Window size / position / maximized remembered**
- **Check for updates** in About
- Local files (Open file, Open path / SMB UNC)
- Direct HTTP(S) URL / stream
- IPTV: user-supplied M3U / M3U8 playlists
- **Public playlist indexes** (v0.17.0) — eight chips in *Add playlist / IPTV…* (Sports, India,
  News, Movies, Documentary, Music, Kids, All countries) that fill the URL from the open
  [iptv-org](https://github.com/iptv-org/iptv) lists. Choosing one fetches nothing; **Import**
  still has to be pressed. G9 ships no channels, no credentials and no scraped premium feeds —
  the sheet says so in as many words. The sports index lists 800-odd free-to-air feeds and has
  no Sky / DAZN / ESPN; Kushi TV is Irdeto-encrypted on Measat 3d and has no reliable free
  stream. Merge several sources by importing each, or by joining their `#EXTM3U` files into one
  master `.m3u` (dedupe by URL) and importing that once
- **`scripts/g9_check.py`** — offline-friendly playlist auditor (Python 3.8+, stdlib): follows a
  master playlist to a variant, downloads a segment, and only then calls a stream alive. Writes
  `working.m3u` (import this), `new_to_add.m3u` (`--mine`), `failed.csv` with the reason per stream
  and a `suspect_host` flag, `report.txt`. `--telugu` / `--filter` / `--workers` / `--timeout`.
  Findings and the honest host-by-host reading: `docs/STREAMS.md`
- **TV Mode channel browser** (YouTube-shaped): logo grid, search, Country / Language / Quality
  chips with counts, sort by order / name / country / quality / group, now/next per card
- TV Mode tunes the last watched channel on entry and keeps a **Channels** pill while watching
- **Now-playing bar** in the wall (logo, channel, current programme, Play/Pause, Watch)
- **RECENT** row of watched channels; **what's on** popover per card with times and a NOW marker
- **Guide** button in the wall, and paging (120 at a time) for playlists of thousands
- Keyboard / remote: arrows, Enter, digits to jump, F favourites, / search, G guide
- Channel metadata: `tvg-country`, `tvg-language`, `4K / FHD / HD / SD`, stored and indexed in SQLite
- IPTV guide: XMLTV now/next per channel, `url-tvg` discovery or a pasted address, gzip, kept on disk
- Xtream Codes portal import (server, user, password)
- HLS: native WebView or a small MSE fallback
- Demo-free: you bring legal sources
- Hardware decode: **WebView2 DXVA / D3D11** (automatic; no NVDEC toggle)
- Resume last position, EQ, and subtitle delay per file
- Repeat, shuffle, A–B loop
- Speed 0.25×–4× with **pitch lock** (`preservesPitch`), presets and `+` / `−`
- Frame step (`,` / `.`)
- Bookmarks (`M`)
- TV Mode (large type, living-room chrome)
- System media keys (Media Session / SMTC)
- JSON IPC on `127.0.0.1:18765` (one JSON object per line)
- File **playlist queue** (Settings → View → Playlist; plays next on end)
- **Music mode** — audio-only files get a record stage with title, duration and a level meter instead of a black rectangle
- **Chapters** (ffprobe, if on PATH)
- **Always on top**
- **Windows "Open with"** — G9 is registered as a Viewer for video, audio and playlist files and plays the file it was launched with
- **Split screen / snap** — caption buttons or `Ctrl+Alt+←/→/↑`
- Background audio while minimized (WebView keeps decoding)
- Touch **gestures**: horizontal seek, vertical volume
- **Sleep timer** (pause G9, or schedule a Windows shutdown)
- **Extra player windows** (a second independent window, its own file and state)

### Appearance & interface (v0.14.0)
- **Dark, light and Auto** themes (Auto follows the Windows app theme live), applied before
  the first paint so nothing flashes
- **Accent colour** — eight presets or any colour; the ink on top is picked from its luminance
- **Personalisation** — corner radius, density, overlay text size, interface font (Geist,
  Segoe UI, Georgia, JetBrains Mono), animation on/off, translucency on/off, icon weight
- **Profile** — name and local avatar, shown in the top bar, the profile card and Fun Mode
- **Notification centre** — every toast kept in a bell menu with categories, unread badge,
  mark-read, clear, and independent switches for toasts / history / downloads / playback / errors
- **Start-screen widgets** — Now, Continue watching (with progress), Library; each switchable
- **Token-based stylesheet** — one token set, one override block per theme; Fun Mode and
  TV Mode read from the same tokens
- Focus rings on every control and automatic `prefers-reduced-motion` support

### Social (v0.15.0)
- **A sidebar, not a takeover** (v0.17.0) — `Ctrl+Shift+S` docks social to the right at 380 px
  (resizable 288–720 px, remembered). The player narrows to make room, so the transport, volume
  and seek bar stay visible and usable while you talk. The room list opens as a drawer **over**
  the transcript, not pushing it down. The player chrome itself still has no sidebars.
- **Workspace rail** — rooms, who is in the room now, saved contacts, unread counts, a filter
  box, and your identity at the foot.
- **Chat works on a fresh install** (v0.17.0) — "Create a room" starts its own `g9-hub` if none
  answers (`social_hub_start`: health probe, free-port fallback), and rooms are created against
  the LAN **share URL**, never loopback. Failures are sentences ("no hub answered at … — press
  Start hub"), never `Failed to fetch`.
- **Docked call tiles are 16:9 cards** (v0.17.0), one per row, with the Expand button still
  giving the full grid (1 / 2 / 3 columns by call size, self view as a corner PiP).
- **A room is one link** — a signed, expiring invite carrying the hub, the room, the seats and
  the room key in the URL fragment, drawn as a **QR code** too. Re-inviting never locks out
  anyone who already has a link.
- **Sealed chat** — AES-256-GCM per frame, AAD binds room, sender and kind; the key is imported
  from the link and never leaves the machine, and the hub only ever sees ciphertext.
- **Voice and video calls** — mesh with mute, camera on/off mid-call, a running clock, the peer on
  the stage and you in the corner; `Leave` stops every track, tells the room, and writes
  "Call ended · 2:41" into the thread.
- **Nothing is lost** — threads, messages, contacts and devices live in SQLite; reopen and the
  conversation is where you left it.
- **No accounts, no pairing, no same-Wi-Fi** — Ed25519 handshake against a nonce, and `g9-hub`,
  a small relay you run anywhere reachable over HTTPS.
- **Low latency by construction** — the hub answers a call join with the roster in the same
  round trip (no broadcast-and-wait), ICE gathers before it is needed, Opus runs 10 ms packets
  with FEC and DTX, H.264 is preferred so Windows decodes in hardware, and the encoder is capped
  by a room-size ladder: 720p30 for two, 540p30 to four, 360p24 to six, 240p15 above.
- **Honest numbers on screen** — real round trip to the hub, per-tile peer RTT / resolution /
  bitrate on hover, a "weak" warning past 250 ms, and the sending tier shown in the call head.
- **Recovers by itself** — socket reconnect with backoff and a flushed outbox, ICE restart
  instead of a dropped call, arrivals buffered while the camera opens, and closing the workspace
  releases the camera.
- Not yet, stated plainly: mesh tops out around four people for video — a nine-person *video*
  call needs the SFU from `docs/SOCIAL-PLAN.md` §5, which is the next release. Camera-based QR
  scanning, TURN fallback and chat while both sides are offline follow it.

### Picture
- **GPU picture pipeline** (v0.13.0) — brightness, contrast, saturation, sharpening and
  deband run as WebGL2 shader passes over the video frame, one video upload per presented
  frame, paced by `requestVideoFrameCallback`
- **Real sharpening** — contrast-adaptive 5-tap unsharp, 0–8 slider, no halos on edges
- **Deband & dither** — nine-tap ring at a frame-scaled radius plus ordered dither; kills the
  stepping in skies and dark gradients, leaves real edges alone
- **Honest state** — the Picture panel says `GPU · grade + sharpen → deband`, `CPU fallback`
  or off; every setting is persisted (`g9-picture-fx`)
- CSS filters remain the fallback when WebGL cannot take the frame (old WebView2, cross-origin
  or protected media)
- Save frame (JPEG)
- **Record what is playing** — video plus sound to WebM (a second click stops), or record the webcam
- **360° look-around** for equirectangular video (WebGL, drag)
- Audio **visualizer** (spectrum)
- **Scene poster** (3×2 stills)
- **Shader effects** — your own `.frag` files in the shaders folder, composed *after* the
  grade and deband passes; a shader that will not compile is dropped with a toast, never a
  black picture

### Subtitles
- Sidecar `.srt` / `.vtt` / `.ass` / `.ssa`
- OpenSubtitles (hash + title)
- TheSubDB (file hash)
- Podnapisi (public XML search)
- Embedded track via `ffmpeg` if on PATH
- Optional **Whisper CLI** if `whisper` / `whisper-cli` is on PATH (Generate captions)
- Auto-apply best match (CC)
- Delay ±100 ms (`[` `]` / Z X)
- Size, colour, vertical position, outline
- Translate existing captions (MyMemory)
- Live translate of the current cue while playing
- **Subtitle browser** (click a line to seek)
- **Pause after each line** (language-learning)
- **Transcript pane** — the same cues as scrollable text, highlights and follows playback, click a line to seek

### Audio
- Volume pill: mute, slider, live percentage, mouse wheel, keyboard nudges
- Autoplay unlocked by the engine, with a one-tap **play gate** if a source is refused
- **Music mode** for audio-only files (course of the transport stays available)
- 6-band EQ, Bass / Voice / Movie, boost to 200%
- Audio-description track pick (when the file tags one)

### Library & live
- Live TV sheet from your playlists
- Favourites, groups, search
- Library (recent files / channels)
- DLNA / UPnP MediaServer browse + play
- Podcast RSS subscribe + episode play

### Tools (need FFmpeg)
FFmpeg is **not bundled**. **Settings → FFmpeg engine** downloads a static build once into app data
(~100 MB) and every tool prefers it; otherwise `ffmpeg` / `ffprobe` on PATH is used.

- Extract audio (MP3)
- Repair / remux (copy codecs, ignore errors)
- Convert / Save (MP4 / WebM / MP3)
- **Inspect** (ffprobe JSON in Diagnostics)
- **RTMP broadcast** (copy to `rtmp://…`)

### Chrome
- Frameless cinema UI: Media · Settings · TV Mode
- About G9 dialog
- Diagnostics
- ARIA application/toolbar roles, labelled controls
- **Export / import settings** (JSON)
- **Responsive layout** — folds down to small windows and short screens
- **Settings as a centred dialog** (Display · Engine · Playlists)
- **PC shutdown timer** (Windows `shutdown /s`) next to the sleep timer, plus Cancel

---

## Keyboard

| Key | Action |
|---|---|
| Space | Play / pause |
| 0 – 9 | Jump to 0 – 90% |
| Home / End | Start / end |
| + / − | Speed up / down |
| I | Stream stats |
| ? | Keyboard sheet |
| Shift + F / R / H | Cycle fit / rotate / mirror |
| ← → | ±10s |
| ↑ ↓ | Previous / next channel |
| F | Fullscreen |
| A | A–B loop |
| S | Save frame |
| E | Equalizer |
| M | Bookmark |
| , . | Frame back / forward |
| [ ] or Z X | Subtitle delay |
| D | Diagnostics |
| Esc | Close overlays / exit TV |

IPC examples (localhost only):

```json
{"cmd":"play"}
{"cmd":"pause"}
{"cmd":"toggle"}
{"cmd":"seek","to":42}
{"cmd":"skip","dt":10}
```

---

## Out of scope (wrong engine)

These are standard in VLC / PotPlayer / mpv. They are **not** coming to G9 while playback is HTML `<video>`:

| Feature | Why not |
|---|---|
| Custom GLSL / Anime4K / FSRCNNX | Needs `libplacebo` / mpv, not WebView |
| NVIDIA RTX Video HDR / Super Resolution | NVAPI + their decoder path |
| Bundled Whisper / Argos on-device models | Tens–hundreds of MB; breaks “lightweight Windows” |
| OpenCodec / user codec DLLs | Security + not how WebView decodes |
| DVB-T/S/C tuner cards | Hardware demuxers in FFmpeg/mpv |
| Full libass karaoke / signs | Would need native libass |
| True independent pitch shifter (tempo unchanged) | Needs Rubber Band / SoundTouch |
| Full NAS file manager | UNC path open only |
| DVD / Blu-ray / VCD **menus** | Needs libdvdnav, not HTML video |
| Chromecast / AirPlay **output** | Needs a cast stack, not WebView sink |
| Cloud Drive / Dropbox OAuth | No bundled cloud accounts |
| Cross-device watch sync | No G9 cloud account |
| Plex / Jellyfin / Emby client | Separate product; play their HTTP URLs |
| Downloadable **skins** marketplace | Cinema chrome is fixed |
| Multi-process extra player windows | One window + PiP |

G9 will not grow a second media core unless you explicitly switch the product to mpv/FFmpeg.

---

## Listed by you — **not implemented**

Every item below was requested in this project and is **not** in G9 (or only a thin substitute). This is the gap list.

Four items left this list in **v0.3.0**: multi-window, bundled FFmpeg (now a managed download), the PC
shutdown timer, and the transcript pane. GLSL is now **partial** — shader effects run in WebGL, but a
libplacebo-grade Anime4K/FSRCNNX chain does not. The rest are engine-level or account-level features.

### Not in the app at all

| # | You asked for | Notes |
|---|---|---|
| 1 | **whisper-rs** on-device ASR (bundled model, auto captions when search fails) | Only optional `whisper` / `whisper-cli` **if already on PATH**. No model in the installer. |
| 2 | **MurmurAI** / self-hosted Whisper sidecar | Not shipped. |
| 3 | Unofficial OpenSubtitles “unlimited” scraper / quota-bypass API | Refused (ToS / quota dodge). |
| 4 | **TVSubtitles.net** HTML scrape | Not shipped. |
| 5 | Full **libass** karaoke, signs, \\pos, \\move, fonts | ASS/SSA is flattened to timed text. WebGL shader effects are not subtitle rendering. |
| 6 | **NVIDIA RTX Video HDR** | Needs NVAPI + their decoder path. |
| 7 | **NVIDIA RTX Super Resolution** | Needs NVAPI + their decoder path. |
| 8 | Live captions via **Whisper + Argos** (or other on-device MT) | Only MyMemory on existing cues. |
| 9 | **OpenCodec** / user-droppable codec DLLs | Not how WebView decodes. |
| 10 | **DVB-T / DVB-S / DVB-C** tuner cards | Needs FFmpeg hardware demuxers. |
| 11 | **DVD menus** (`libdvdnav`) | Not HTML video. |
| 12 | **Blu-ray** structure / menus / keys | Not HTML video. |
| 13 | **VCD** menus | Not HTML video. |
| 14 | **Chromecast output** (cast G9’s picture to a TV) | DLNA in G9 is **browse/play from** a server, not cast **out**. |
| 15 | **AirPlay output** | Not shipped. |
| 16 | **DLNA/DMP renderer** (G9 as the TV sink) | Not shipped. |
| 17 | Google Drive / Dropbox / OneDrive **OAuth library** | No cloud accounts. |
| 18 | Cross-device **watch-history sync** | No G9 cloud account. |
| 19 | **Plex** client (library, artwork, watched) | Play their HTTP URL only. |
| 20 | **Jellyfin** client | Same. |
| 21 | **Emby** client | Same. |
| 22 | Downloadable **skins / themes** marketplace | Cinema chrome is fixed (one dark theme, TV Mode type scale). |
| 23 | VLC-style **skin editor** | Not shipped. |
| 24 | Independent **pitch shifter** (tempo unchanged, ±octave) | Speed+`preservesPitch` is the opposite trick. Needs Rubber Band. |
| 25 | **MilkDrop** / plugin visualizers | Only a simple spectrum. |
| 26 | **Album cover downloads** (MusicBrainz / iTunes) | Not shipped. |
| 27 | TMDB/OMDb **posters, cast, ratings** media library | Library is recents only. |
| 28 | Folder **indexer** with artwork | Not shipped. |
| 29 | Full **NAS / SMB file manager** | UNC path prompt only. |
| 30 | QuickSync / **NVDEC** / VideoToolbox **decoder picker** | WebView2 DXVA only, no vendor toggle. |
| 31 | Bundled **FFmpeg inside the installer** | Managed **download** (Settings → FFmpeg engine) instead: tools use that copy, then PATH. Nothing is bundled. |
| 32 | Dedicated buttons for **sign-language** tracks | Only a generic audio-description track pick. |
| 33 | Gyro / headset **VR** navigation | 360 is mouse-drag WebGL only; WebView2 has no reliable WebXR. |
| 34 | `tauri-plugin-cast` / DIAL Chromecast | Not wired. |
| 35 | Settings export as PotPlayer **`.reg`** | JSON only. |

### Partial vs what you specified

| You asked for | What G9 actually has |
|---|---|
| Netflix-style storyboard **plus** hover preview | **Removed on request** in 0.3.1 — the seek bar is a plain scrub bar again. |
| Full HW decode paths (DXVA **and** NVDEC **and** QSV **and** VT) | DXVA via WebView2 only. |
| Advanced ASS/SSA styling | Size, colour, position, outline; no karaoke/libass. |
| Screen recorder with **region + FPS + encoder profiles** | Records **playback** (picture + sound) or the webcam to WebM. No desktop/window capture (WebView2 has no screen-capture API), no region selection, no bitrate UI. |
| Universal transcoder (all codecs/containers) | FFmpeg (managed download or PATH): mp4 / webm / mp3 + extract + remux. |
| Real-time filters (sharpen, motion blur, spatial blur, noise) | CSS brightness / contrast / saturation, plus **WebGL shader effects** (built-in Sharpen / Vivid / Mono / Night and your own `.frag`). No Anime4K / FSRCNNX / temporal filters. |
| Codec inspection **and** live CPU/GPU/decode stats | Info dialog + dropped frames; ffprobe dump if FFmpeg is installed. No live GPU meter. |
| Subtitle **search UI** (preview many providers, pick one) | One-click “best match” chain; cue list after apply. No provider picker. |
| Live TV from a **tuner**, not just M3U | M3U/IPTV/DLNA only. |
| 360° with dedicated VR controls | Equirectangular look-around, drag only. |
| Full screen-reader a11y (every control announced, captions/AD/transcript/sign as separate actions) | ARIA application/toolbar + labels + skip link, and a **transcript pane**. Not a complete a11y audit, no sign-language track. |

## Status of requested lists

**Cinema / first 12** — shipped except bundled Whisper and NVDEC vendor switches.

**“9 more”** — IPC, a11y (basic), AD tracks, record: shipped. Shaders, RTX, OpenCodec, DVB: **not implemented**.

**“12 more vs VLC”** — recorder, IPTV, podcasts, filters (CSS), frame-step, bookmarks, URL, speed+pitch-lock, extract/repair/convert (ffmpeg PATH), 360 look-around: shipped. Independent pitch-shift, disc menus, codec plugins: **not implemented**.

**“23 long-tail”** — playlist, chapters (ffprobe), visualizer, PiP, background audio, cue browser, line-repeat, inspect, poster, sleep, settings JSON, gestures, RTMP: shipped. **v0.3.0** adds multi-window, a downloaded FFmpeg, a transcript pane, WebGL shader effects and a PC shutdown timer. Disc menus, cast-out, cloud, Plex/Jellyfin/Emby, skins, album art/TMDB library: **not implemented**.

## Sources you control (v0.12.0)

- Per-source request headers (Accept-Language, User-Agent, any `Key: value`), edited in Sources
- Source health: last round trip, "slow" above 1.5 s, the reason a source failed, and a Test button
- Addon-declared genre/year filters on *See all*, sent to the addon rather than applied locally
- Catalog paging with *Load more*, keeping the selected filters
- A fresh install seeds Internet Archive + MangaDex, so Fun Mode never opens empty

## Fun Mode — second list (v0.11.0)

Nineteen more Fun Mode features, all inside the player or the wall. **All nineteen shipped**:
seventeen in 0.11.0, the last two in 0.12.0.

| # | Feature | Status |
|---|---|---|
| 1 | Stream picker table, remembered per title | **Shipped** — `fun_streams` list under the sheet, `g9.fun.picks` |
| 2 | Source's own subtitles before any online search | **Shipped** — `fun_subtitles`, `fun_subtitle_text`, bridge `applySubtitle` |
| 3 | Multi-source title merge | **Shipped** — `dedupe()` by title + year, "N sources" on the card |
| 4 | Cross-source resume | **Shipped** — `crossSourceResume()` matches by normalised title |
| 5 | Season switcher + episode sort/search/random | **Shipped** — `episodeTools` / `paintEpisodeList` |
| 6 | Reader modes (scroll / paged, fit) | **Shipped** — persisted in `g9.fun.reader` |
| 7 | Chapter navigation | **Shipped** — ‹ Chapter / Chapter › in the reader |
| 8 | Real reading resume (page) | **Shipped** — `page` on `fun_progress_save`, reopened on load |
| 9 | Night reading | **Shipped** — dims the pages, not the chrome |
| 10 | Library de-duplication by title | **Shipped** — in `libItems()` |
| 11 | Watch-time stats | **Shipped** — *Watch time* tile in the hub |
| 12 | Cross-title queue | **Shipped** — `g9.fun.queue`, started when an episode ends |
| 13 | Search inside a series | **Shipped** — episode search box |
| 14 | Catalog paging | **Shipped** — `fun_catalog`, *Load more* in browse |
| 15 | Filters the addon declares itself | **Shipped (0.12.0)** — `stremio::catalog_facets`, `fun_catalog_filters`, chips in *See all* |
| 16 | Surprise me | **Shipped** — *Random* on long seasons and the wall |
| 17 | Thumbs → recommendations | **Shipped** — `g9.fun.likes`, reorders *Because you watched* |
| 18 | Per-source `Accept-Language` | **Shipped (0.12.0)** — per-source headers, `fun_source_headers`, cache keyed on them |
| 19 | Pre-play GB + Mbps estimate | **Shipped** — on every stream row |

## Fun Mode (v0.10.0)

### Shipped

| Feature | State |
|---|---|
| Netflix-shaped wall (hero, Continue watching, ranked Top 10, rails) | shipped · 0.8.0 |
| Movies · Web series · Anime · Drama · Manga tabs | shipped · 0.8.0 |
| Live search across every enabled source | shipped · 0.8.0 |
| See all → grid with quality / newest / rating sort | shipped · 0.8.0 |
| Details sheet: synopsis, source chips, episode & chapter lists, My List, Download | shipped · 0.8.0 |
| Sources dialog: add/remove/toggle addons, feeds and MangaDex | shipped · 0.8.0 |
| Stremio addon client (manifest, catalog, meta, stream, subtitles) | shipped · 0.8.0 |
| RSS magnet feeds (Nyaa-style namespaces, seeders, size) | shipped · 0.8.0 |
| yt-dlp resolver (`-J` → streams + required headers) | shipped · 0.8.0 |
| MangaDex reader (search, chapters, pages, reading progress) | shipped · 0.8.0 |
| Playback preferences (quality, subtitles, autoplay, fallback) | shipped · 0.8.0 |
| **Autoplay next episode + 10 s "Up next" card** | shipped · 0.10.0 |
| **Per-episode resume** (position every 8 s, seeks back on open) | shipped · 0.10.0 |
| **Watching page** (Continue watching tab) | shipped · 0.10.0 |
| **Filters on See all** (genre / year / quality, live counts) | shipped · 0.10.0 |
| **Merged search, dedupe, per-card source badges** | shipped · 0.10.0 |
| **"More like this"** (genre + cast overlap) | shipped · 0.10.0 |
| **Cast row + person pages** | shipped · 0.10.0 |
| **Keyboard navigation on the wall** | shipped · 0.10.0 |
| **My List in SQLite + My List tab** (schema v4) | shipped · 0.10.0 |
| **Watched / unwatched marks, auto at 90 %** | shipped · 0.10.0 |
| **"Not interested" + Undo** | shipped · 0.10.0 |
| **Quality cap / data saver** (picks the stream) | shipped · 0.10.0 |
| **Audio language preference** (matches stream labels) | shipped · 0.10.0 |
| **Subtitle preference** (auto / language / off → the real picker) | shipped · 0.10.0 |
| **Source fallback on error** (next stream, cap-aware) | shipped · 0.10.0 |
| **Sleep timer + "Still watching?"** | shipped · 0.10.0 |
| **Live playback badge** (mini bar) | shipped · 0.10.0 |
| **Sort in My List + Watching** | shipped · 0.10.0 |
| **Backup / restore JSON** (merge restore) | shipped · 0.10.0 |
| **"New this week"** rail | shipped · 0.10.0 |
| **Refresh chip** + **cache clear** | shipped · 0.10.0 |
| **Fuller title page** (cast, genres, thumbs, more-like-this) | shipped · 0.10.0 |
| **Search recents, "What I added" scope, typo tolerance** | shipped · 0.10.0 |
| **In-app mini player** (pause / resume / stop) | shipped · 0.10.0 |
| **Resume chip + progress bar on cards** | shipped · 0.10.0 |
| **Episode stills, air date, runtime** | shipped · 0.10.0 |
| **Follow series + card badge + Following rail** | shipped · 0.10.0 |
| **"Because you watched"** rail | shipped · 0.10.0 |
| **Genre browse** from a title's genre chips | shipped · 0.10.0 |
| **Card right-click menu** | shipped · 0.10.0 |
| **Settings hub** (Playback / Library / Sources / Data) | shipped · 0.10.0 |
| **First-run wizard** | shipped · 0.10.0 |
| **`g9://` title links** (copy + open in-app) | shipped · 0.10.0 |
| **Keyboard + ARIA labels** on the new controls | shipped (partial) · 0.10.0 |

### Not implemented

The 57-feature brief was taken in one go; **33 of those 57 are still open**. Nothing below is
half-built: each needs a subsystem G9 does not have yet, so it stays listed rather than faked.

| Feature | Why it is not in yet | Target |
|---|---|---|
| **Magnet playback** (torrent streaming) | needs the embedded librqbit engine + buffer gate | 0.11.0 |
| **Offline cache + offline playback** | needs a disk cache, a store table and a download manager for streams | 0.11.0 |
| **Season / volume download** | needs per-episode job fan-out on top of that cache | 0.11.0 |
| **Swap source mid-play** | depends on the torrent engine for the magnet half | 0.11.0 |
| **Next / previous episode in the transport bar** | player transport is queue-shaped, not episode-shaped | 0.11.0 |
| **Skip intro / recap** | needs chapter markers or an intro database per title | 0.11.0 |
| **Per-title subtitle offset memory** | delay is global today; needs a per-title row | 0.11.0 |
| **Source health / priority ordering** | needs per-source probe results stored per addon | 0.11.0 |
| **Source diagnostics (timings, failures)** | needs the same probe data surfaced in Settings | 0.11.0 |
| **Rate-limit budget per addon** | needs a token bucket shared by every request | 0.11.0 |
| **Addon collection import** | Stremio collection JSON → sources, with duplicate rules | 0.11.0 |
| **Local folder as a source** | needs a scanner + metadata/artwork matching | 0.11.0 |
| **Profiles + Kids** | needs a profile column on every store table | 0.12.0 |
| **PIN lock** | depends on profiles | 0.12.0 |
| **Content-rating filter** | depends on profiles + rating metadata | 0.12.0 |
| **Collections** | needs a new store table and rail management | 0.12.0 |
| **Reorder / pin rails** | needs a per-user rail order (`fun_lib`-style row) | 0.12.0 |
| **Poster / artwork override** | needs a per-title image column + picker | 0.12.0 |
| **Muted trailer / hover previews** | needs a muted second player + asset policy | 0.12.0 |
| **Filter inside My List + Watching** | sort shipped; filter needs facet data on saved rows | 0.12.0 |
| **Prefetch, skeletons, virtualised rails** | wall is fully painted today; needs a windowing rewrite | 0.12.0 |
| **"Recently added" rail** | My List sorted by *Added* covers the use case | 0.12.0 |
| **Per-catalog genre rails** | needs a genre query per catalog in every provider | 0.12.0 |
| **Airing calendar** | needs episode air dates from a metadata source | 0.12.0 |
| **Full genre landing pages** | genre chips open a filter today; a page needs rails per genre | 0.12.0 |
| **Send to new window / TV Mode** | needs a handoff channel between windows | 0.12.0 |
| **OS deep links + jump list** | needs `g9://` registered in the installer and a Windows jump list | after the GPU roadmap |
| **Accessibility pass (full)** | labels and keyboard shipped; no audit, high-contrast or reduced-motion yet | after the GPU roadmap |
| **Community site scrapers (AnimePahe, AnimeHeaven, TokyoInsider)** | opt-in tier-C providers, deliberately last | after the GPU roadmap |

Count: **24 shipped outright + 1 partial** of the 57 in v0.10.0, **17 of the 57** waiting on the
torrent/cache work (0.11.0), **12** on profiles and library metadata (0.12.0), **3** on Windows
shell integration and the a11y audit (slipped past 0.13.0 — the GPU roadmap took that release).
The other 32 shipped features in the table above predate the brief.

### GPU and rendering (separate 12-feature plan)

[`docs/GPU-QUALITY-PLAN.md`](docs/GPU-QUALITY-PLAN.md) tracks these; **3 shipped, 9 open**.

| # | Feature | State |
|---|---|---|
| 1 | WebGL2 pipeline as the default renderer | shipped · 0.13.0 |
| 3 | Real sharpening with a slider | shipped · 0.13.0 |
| 4 | Deband + ordered dither | shipped · 0.13.0 |
| 8 | Frame-paced presentation (`requestVideoFrameCallback`) | shipped · 0.13.0 |
| 2 | FSR 1.0 upscaling (EASU + RCAS) | 0.14.0 |
| 9 | Hardware-decode assurance + honest GPU panel | 0.14.0 |
| 10 | Adaptive performance governor | 0.14.0 |
| 6 | Colour pipeline + HDR→SDR tone map | 0.15.0 |
| 7 | 3D LUT grading (`.cube`) | 0.15.0 |
| 11 | Judder handling for 23.976/24p | 0.15.0 |
| 5 | Temporal denoise | 0.16.0 |
| 12 | GPU overlay compositing | 0.16.0 |
