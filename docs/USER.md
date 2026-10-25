# Using G9

G9 is a player, not a TV service. You bring files or a playlist you are allowed to use.

## First run

- **Media → Open file…** for a local video.
- **Open URL…** for an HTTP(S) stream.
- **Open path / SMB…** for a UNC path (`\\server\share\video.mp4`).
- **Add playlist / IPTV…** to paste or import an M3U you are allowed to use, or an **Xtream
  Codes** portal (server, username, password) if your provider gives you those instead
- **Find DLNA servers…** to browse a LAN MediaServer.
- **Subscribe to podcast…** for an RSS feed.

There is no bundled channel pack and no “demo clips” menu.

## From Windows Explorer

After installing with the G9 installer, **right-click a video, audio or playlist file → Open with
→ G9** (or pick G9 once and use *Always*). Double-clicking a file associated with G9 opens it
straight away. The portable zip registers nothing — use *Media → Open file* there.

**Media info → Show in folder** reveals the playing file in Explorer.

## Window and layout

- **Snap**: the two small buttons next to maximise put G9 on the left/right half. `Ctrl+Alt+←/→`
  does the same, `Ctrl+Alt+↑` maximises. Windows' own `Win+←/→` also works.
- The interface folds down for small windows: the volume slider collapses to the mute button,
  secondary transport buttons move into Settings, and dialogs go full width.
- **Settings** is the gear button (or Settings → Preferences): a centred dialog with Display,
  Engine (FFmpeg, About) and your playlists, plus Export / Import.

## The chrome

Top bar: **Media · Settings · TV Mode**. About G9 lives inside Settings, not on the bar.
The chrome fades while you watch; move the mouse to bring it back. There are no sidebars —
everything opens as an overlay card over the picture.

**TV Mode** opens the channel browser (see [Live TV](#live-tv)), enlarges the type and spacing
for a living-room screen. `Esc` closes the browser; the button turns into **Exit TV**.

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
- **Always-on-top** pins the window; there is no picture-in-picture.
- **360°** turns on look-around for equirectangular footage (drag to look).
- **Sleep timer** stops playback after N minutes; answer *OK* to the follow-up to also schedule a
  Windows shutdown, or use **Cancel PC shutdown** in Settings.
- **Transcript** shows the same captions as scrolling text, follows playback and seeks when you click a line.
- **Shader effect** applies a WebGL look (Sharpen / Vivid / Mono / Night, or your own `.frag` files).
- **Open in new window** runs a second, independent player window — handy for a second screen.

## Live TV

Press **TV Mode** and G9 opens the channel browser: a wall of channel cards with logos, the group
and country, and **now / next** from the guide. It tunes the last channel you watched straight
away — that is what you hear behind the wall — and a **Channels** pill stays on the screen while you
watch, so you can come back at any time. `Esc` closes the browser.

- A **now-playing bar** stays at the bottom of the wall showing what is on the screen behind it
  (logo, channel, current programme) with **Play/Pause** and **Watch**.
- **RECENT** lists the channels you watched last — one click goes back.
- **Search** the box at the top for a channel, group, country or language.
- **Chips** filter: Favourites, **Country**, **Language**, **Quality** (4K / FHD / HD / SD), and
  **Sort** by channel order, name, country, quality or group. Each value shows how many channels
  have it; **Clear filters** resets everything.
- Click a card (or press Enter on it) to watch. The star on a card toggles a favourite; the `⋯`
  on a card shows **what's on next** for that channel, with a **NOW** marker on the current show.
- **Guide** in the wall loads the guide your playlist points at (or one you paste) and shows how
  many channels it covers.
- Big playlists load a page at a time — the header says *showing 120 of 5,000* and **Show more**
  fetches the next page. Filters and sorting run in the database, so thousands of channels stay
  quick.
- **Keyboard and remote:** arrow keys walk the wall, Enter tunes the focused channel, number keys
  jump to a channel number, `F` favourites the focused channel, `/` jumps to search, `G` reloads
  the guide, and `Esc` backs out one level (open popover first, then the wall).

Windowed mode keeps the older list: **Live** in the top bar. It groups channels, searches them and
keeps favourites on top.

### The guide

- If your playlist points at an XMLTV guide (`url-tvg`), press **Load guide** once and every
  channel gets **now / next**. No guide address in the playlist? G9 asks for one — paste an `.xml`
  or a gzipped `.xml.gz`.
- The parsed guide is kept between launches and now/next refreshes itself while a list is open.

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

## Downloading videos

The welcome screen has a link box. Paste the address of a video page — YouTube, Instagram,
Facebook, or any other site the downloader knows — and press **Check**. G9 reads the page and
lists the qualities it offers (4K down to 360p, plus audio-only) with an estimated size next to
each. Pick one and press **Download**.

- Files land in **Videos → G9** under your user folder.
- Downloads keep running while you watch something else, and Windows shows a notification when
  one finishes.
- **Downloads** (welcome screen, Media menu, or Settings → Video downloads) lists every job with
  percent, size, speed and time left. Each row has **Play**, **Pause/Resume**, **Folder** and
  **Delete**.
- Paused or interrupted jobs continue from their partial files; a job that was still running when
  G9 closed comes back **paused** — press Resume.
- **Delete** asks whether to take the file with it. Deleting keeps G9's list tidy either way.

The downloader itself (`yt-dlp`) is not bundled. The first time you try, G9 offers **Install
downloader**: one click, about 30 MB, into G9's own app data folder. A `yt-dlp` already on PATH is
used instead if you have one.

The first download also prepares the **FFmpeg engine** (~100 MB, once), because modern sites send
video and audio separately and something has to join them — the panel says *Installing the media
engine…* while it does. If a job fails, the row says why and offers **Retry**, which continues from
what was already downloaded.

Only download material you have the rights to. G9 does not host, ship, or point at any video.

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
