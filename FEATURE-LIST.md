# G9 feature list

G9 is a **Windows cinema player** (Tauri 2 + WebView2 + vanilla HTML/CSS/JS).  
It is **not** mpv, VLC, or PotPlayer: playback is the OS web engine, not FFmpeg/`libplacebo`. Features that need those engines are listed as **out of scope** on purpose.

Last updated: 2026-10-25 · source: `main`

---

## In the app

### Playback
- Local files (Open file, Open path / SMB UNC)
- Direct HTTP(S) URL / stream
- IPTV: user-supplied M3U / M3U8 playlists
- HLS: native WebView or a small MSE fallback
- Demo-free: you bring legal sources
- Hardware decode: **WebView2 DXVA / D3D11** (automatic; no NVDEC toggle)
- Resume last position, EQ, and subtitle delay per file
- Repeat, shuffle, A–B loop
- Speed 0.25×–2× with **pitch lock** (`preservesPitch`)
- Frame step (`,` / `.`)
- Bookmarks (`M`)
- TV Mode (large type, living-room chrome)
- System media keys (Media Session / SMTC)
- JSON IPC on `127.0.0.1:18765` (one JSON object per line)
- File **playlist queue** (View → Playlist; plays next on end)
- **Chapters** (ffprobe, if on PATH)
- **Picture-in-picture**
- **Always on top**
- Background audio while minimized (WebView keeps decoding)
- Touch **gestures**: horizontal seek, vertical volume
- **Sleep timer**

### Picture
- Hover **scrub preview**
- **Storyboard** strip on the seek bar
- CSS filters: brightness, contrast, saturation
- Save frame (JPEG)
- Export **GIF** (A–B range, or ~2.4s around now)
- Screen / webcam recording (MediaRecorder → WebM)
- **360° look-around** for equirectangular video (WebGL, drag)
- **Region** screen capture (draw a rectangle, then record)
- Audio **visualizer** (spectrum)
- **Scene poster** (3×2 stills)

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

### Audio
- Mute + volume on the transport
- 6-band EQ, Bass / Voice / Movie, boost to 200%
- Audio-description track pick (when the file tags one)

### Library & live
- Live TV sheet from your playlists
- Favourites, groups, search
- Library (recent files / channels)
- DLNA / UPnP MediaServer browse + play
- Podcast RSS subscribe + episode play

### Tools (need **ffmpeg on PATH**)
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

---

## Keyboard

| Key | Action |
|---|---|
| Space | Play / pause |
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

### Not in the app at all

| # | You asked for | Notes |
|---|---|---|
| 1 | **whisper-rs** on-device ASR (bundled model, auto captions when search fails) | Only optional `whisper` / `whisper-cli` **if already on PATH**. No model in the installer. |
| 2 | **MurmurAI** / self-hosted Whisper sidecar | Not shipped. |
| 3 | Unofficial OpenSubtitles “unlimited” scraper / quota-bypass API | Refused (ToS / quota dodge). |
| 4 | **TVSubtitles.net** HTML scrape | Not shipped. |
| 5 | Custom **GLSL shaders** (Anime4K, FSRCNNX, user `.glsl` folder) | Needs mpv/`libplacebo`. |
| 6 | **NVIDIA RTX Video HDR** | Needs NVAPI. |
| 7 | **NVIDIA RTX Super Resolution** | Needs NVAPI. |
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
| 22 | Downloadable **skins / themes** marketplace | Cinema chrome is fixed. |
| 23 | VLC-style **skin editor** | Not shipped. |
| 24 | **Multi-window** / several videos at once | One window + PiP only. |
| 25 | Independent **pitch shifter** (tempo unchanged, ±octave) | Speed+`preservesPitch` is the opposite trick. Needs Rubber Band. |
| 26 | **MilkDrop** / plugin visualizers | Only a simple spectrum. |
| 27 | **Album cover downloads** (MusicBrainz / iTunes) | Not shipped. |
| 28 | TMDB/OMDb **posters, cast, ratings** media library | Library is recents only. |
| 29 | Folder **indexer** with artwork | Not shipped. |
| 30 | Full **NAS / SMB file manager** | UNC path prompt only. |
| 31 | **libass** karaoke, signs, \pos, \move, fonts | ASS/SSA is flattened to timed text. |
| 32 | QuickSync / **NVDEC** / VideoToolbox **decoder picker** | WebView2 DXVA only, no vendor toggle. |
| 33 | Bundled **FFmpeg sidecar** | Convert/repair/RTMP/chapters/probe only if **ffmpeg/ffprobe are already on PATH**. |
| 34 | OS **shutdown** after timer | Sleep timer **pauses G9**, does not power off Windows. |
| 35 | Dedicated buttons for **transcripts** and **sign-language** tracks | Only generic AD-track pick. |
| 36 | Gyro / headset **VR** navigation | 360 is mouse-drag WebGL only. |
| 37 | `tauri-plugin-cast` / DIAL Chromecast | Not wired. |
| 38 | Settings export as PotPlayer **`.reg`** | JSON only. |

### Partial vs what you specified

| You asked for | What G9 actually has |
|---|---|
| Always-on Netflix-style storyboard **plus** hover preview | Hover preview **and** a 12-thumb strip — not a dense continuous filmstrip. |
| Full HW decode paths (DXVA **and** NVDEC **and** QSV **and** VT) | DXVA via WebView2 only. |
| Advanced ASS/SSA styling | Size, colour, position, outline; no karaoke/libass. |
| Screen recorder with **region + FPS + encoder profiles** | Region / screen / webcam → WebM via MediaRecorder. No bitrate/FPS UI. |
| Universal transcoder (all codecs/containers) | ffmpeg PATH: mp4 / webm / mp3 + audio extract + remux. |
| Real-time filters (sharpen, motion blur, spatial blur, noise) | CSS brightness / contrast / saturation. |
| Codec inspection **and** live CPU/GPU/decode stats | Info dialog + dropped frames; ffprobe dump if on PATH. No live GPU meter. |
| Subtitle **search UI** (preview many providers, pick one) | One-click “best match” chain; cue list after apply. No provider picker. |
| Live TV from a **tuner**, not just M3U | M3U/IPTV/DLNA only. |
| 360° with dedicated VR controls | Equirectangular look-around, drag only. |
| Timed **PC shutdown** | Pause-after-N-minutes. |
| Full screen-reader a11y (every control announced, captions/AD/transcript/sign as separate actions) | ARIA application/toolbar + labels + skip link. Not a complete a11y audit. |

---

## Status of requested lists

**Cinema / first 12** — shipped except bundled Whisper and NVDEC vendor switches.

**“9 more”** — IPC, a11y (basic), AD tracks, record, region record: shipped. Shaders, RTX, OpenCodec, DVB: **not implemented**.

**“12 more vs VLC”** — recorder, IPTV, podcasts, filters (CSS), frame-step, bookmarks, URL, speed+pitch-lock, extract/repair/convert (ffmpeg PATH), 360 look-around: shipped. Independent pitch-shift, disc menus, codec plugins: **not implemented**.

**“23 long-tail”** — playlist, chapters (ffprobe), visualizer, PiP, background audio, cue browser, line-repeat, inspect, poster, sleep (pause), settings JSON, gestures, RTMP (ffmpeg PATH): shipped. Disc menus, cast-out, cloud, Plex/Jellyfin/Emby, skins, multi-window, album art/TMDB library: **not implemented**.
