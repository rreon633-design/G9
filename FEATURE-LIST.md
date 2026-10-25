# G9 feature list

G9 is a **Windows cinema player** (Tauri 2 + WebView2 + vanilla HTML/CSS/JS).  
It is **not** mpv, VLC, or PotPlayer: playback is the OS web engine, not FFmpeg/`libplacebo`. Features that need those engines are listed as **out of scope** on purpose.

Last updated: 2026-10-25 · release **v0.9.0** · source: `main`  
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

### Picture
- CSS filters: brightness, contrast, saturation
- Save frame (JPEG)
- **Record what is playing** — video plus sound to WebM (a second click stops), or record the webcam
- **360° look-around** for equirectangular video (WebGL, drag)
- Audio **visualizer** (spectrum)
- **Scene poster** (3×2 stills)
- **Shader effects** — built-in Sharpen / Vivid / Mono / Night plus your own `.frag` files in the shaders folder (WebGL, over the video frame)

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

## Fun Mode (v0.8.0)

| Feature | State |
|---|---|
| Netflix-shaped wall (hero, Continue watching, ranked Top 10, rails) | shipped |
| Movies · Web series · Anime · Drama · Manga/Manhwa/Manhua tabs | shipped |
| Live search across every enabled source | shipped |
| See all → grid with quality / newest / rating sort | shipped |
| Details sheet: synopsis, source chips, episode & chapter lists, My List, Download | shipped |
| Sources dialog: add/remove/toggle addons, feeds and MangaDex | shipped |
| Stremio addon client (manifest, catalog, meta, stream, subtitles) | shipped |
| RSS magnet feeds (Nyaa-style namespaces, seeders, size) | shipped |
| yt-dlp resolver (`-J` → streams + required headers) | shipped |
| MangaDex reader (search, chapters, pages, reading progress) | shipped |
| Playback preferences (quality, subtitles, autoplay, fallback) | shipped |
| Torrent streaming for magnet results | planned, v0.10.0 |
| Community site scrapers (AnimePahe, AnimeHeaven, TokyoInsider) | opt-in, v0.12.0 |
