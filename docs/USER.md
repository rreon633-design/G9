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

- The **seek bar** is a plain scrub bar — no thumbnail preview.
- Audio-only files open in **music mode**: title, duration and a level meter instead of a black screen.
- **CC** searches online subtitles and applies the best match; open the subtitle browser to
  click a line and seek to it.
- **i** opens Media info (centred card).
- The **volume pill** on the right: speaker icon mutes, the slider shows a live percentage, the
  mouse wheel nudges it, and Settings → Equalizer adds EQ, presets and boost.
- If a source is refused by the engine, one **Press to play** button retries it.
- **Settings → View → Playlist** is the file queue — it plays the next file when one ends.
- **PiP** pops the picture out; **always-on-top** pins the window.
- **360°** turns on look-around for equirectangular footage (drag to look).
- **Sleep timer** stops playback after N minutes; answer *OK* to the follow-up to also schedule a
  Windows shutdown, or use **Cancel PC shutdown** in Settings.
- **Transcript** shows the same captions as scrolling text, follows playback and seeks when you click a line.
- **Shader effect** applies a WebGL look (Sharpen / Vivid / Mono / Night, or your own `.frag` files).
- **Open in new window** runs a second, independent player window — handy for a second screen.

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

## FFmpeg

G9 does not bundle FFmpeg. Open **Settings → FFmpeg engine** and press **Download FFmpeg** once
(~100 MB, static Windows build). Convert / Save, extract audio, remux / repair, chapters, inspect,
RTMP out and embedded subtitle extraction then use that copy; if you prefer, put `ffmpeg` and
`ffprobe` on PATH and G9 will use them instead. **Remove** deletes the managed copy.

## Saving frames and recording

- **Save frame** (camera icon or `S`) asks where to write a JPEG — default folder is your Pictures.
  If the source is copy-protected and the frame cannot be read, G9 falls back to FFmpeg when the
  file is local.
- **Record what is playing** records the picture and the sound to WebM; press again to stop and
  choose where to save. **Record webcam** does the same from the camera.
- Desktop/window capture is not part of G9: the webview has no screen-capture API.

## Shaders

Built-in: Sharpen, Vivid, Mono, Night. For your own, drop `*.frag` files into the shaders folder
(the panel prints its path). Shaders need a local file or a CORS-allowed stream to sample the
video frame.

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
