# Using G9

G9 is a player, not a TV service. You bring files or a playlist you are allowed to use.

## First run

- **Media → Open file…** for a local video.
- **Open URL…** for an HTTP(S) stream.
- **Open path / SMB…** for a UNC path (`\\server\share\video.mp4`).
- **Add playlist / IPTV…** to paste or import an M3U you are allowed to use.
- **Find DLNA servers…** to browse a LAN MediaServer.
- **Subscribe to podcast…** for an RSS feed.

There is no bundled channel pack and no “demo clips” menu.

## Playback

The cinema chrome (Media · Settings · TV Mode) hides while you watch. Move the mouse to show it.

- Hover the **seek bar** for a frame preview; the **storyboard** strip jumps to a scene.
- **CC** searches online subtitles and applies the best match.
- **i** opens Media info.
- Speaker icon mutes. Settings → Equalizer for boost / EQ.
- View → **Playlist** is the file queue (plays the next item when one ends).

## Keys

| Key | Action |
|---|---|
| Space | Play / pause |
| ← → | ±10 seconds |
| ↑ ↓ | Previous / next live channel |
| F | Fullscreen |
| A | A–B loop |
| S | Save frame |
| E | Equalizer |
| M | Bookmark |
| , . | Frame back / forward |
| [ ] or Z X | Subtitle delay |
| D | Diagnostics |
| Esc | Close overlays / exit TV Mode |

Swipe on a touch screen: horizontal seek, vertical volume.

## Optional tools (ffmpeg on PATH)

Convert / Save, extract audio, remux/repair, chapters, inspect, and RTMP out call **ffmpeg** / **ffprobe** if they exist. G9 does not bundle FFmpeg.

## Privacy

Play history and settings stay on your machine (`g9.db` and `localStorage`). No account, no telemetry. Caption translation uses MyMemory over HTTPS. JSON IPC listens on **127.0.0.1:18765** only.
