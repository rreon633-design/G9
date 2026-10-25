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

## Status of requested lists

**Cinema / first 12** — shipped except bundled Whisper and NVDEC vendor switches.

**“9 more”** — IPC, a11y, AD tracks, record, region record: shipped. Shaders, RTX, OpenCodec, DVB: out of scope. Live translation: current-cue + batch translate, not on-device ASR+MT.

**“12 more vs VLC”** — recorder, IPTV, podcasts, filters, frame-step, bookmarks, URL, speed+pitch-lock, extract/repair/convert (ffmpeg PATH), 360 look-around: shipped. Independent pitch-shift, DVB, codec plugins: out of scope.
