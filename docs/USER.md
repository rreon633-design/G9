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

## The chrome

Top bar: **Media · Settings · TV Mode**. About G9 lives inside Settings, not on the bar.
The chrome fades while you watch; move the mouse to bring it back. There are no sidebars —
everything opens as an overlay card over the picture.

**TV Mode** enlarges the type and spacing for a living-room screen. `Esc` leaves it.

## Playback

- Hover the **seek bar** for a frame preview; the **storyboard** strip jumps to a scene.
- **CC** searches online subtitles and applies the best match; open the subtitle browser to
  click a line and seek to it.
- **i** opens Media info (centred card).
- Speaker icon mutes. Settings → Equalizer for EQ and boost.
- **Settings → View → Playlist** is the file queue — it plays the next file when one ends.
- **PiP** pops the picture out; **always-on-top** pins the window.
- **360°** turns on look-around for equirectangular footage (drag to look).
- **Sleep timer** stops playback after N minutes (G9 pauses; it does not shut down Windows).

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

Convert / Save, extract audio, remux / repair, chapters, inspect, and RTMP out call **ffmpeg** /
**ffprobe** if they exist. G9 does not bundle FFmpeg and the buttons will tell you when the
binary is missing.

## Remote control (IPC)

Any local script can drive playback over a loopback socket, one JSON object per line:

```json
{"cmd":"play"}
{"cmd":"pause"}
{"cmd":"toggle"}
{"cmd":"seek","to":42}
{"cmd":"skip","dt":10}
```

Port **18765** on `127.0.0.1` only.

## Data & privacy

Play history and settings stay on your machine (`g9.db` in the OS app-data directory, plus
`localStorage` for player UI state). No account, no telemetry. Settings can be exported and
imported as JSON.

Network calls happen only when you ask for them: playlist / RSS URLs you add, online subtitle
search, DLNA discovery on your LAN, and caption translation (MyMemory). Nothing is uploaded
in the background.
