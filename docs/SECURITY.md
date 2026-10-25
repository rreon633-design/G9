# Security

G9 treats playlists, EPG files, subtitles, streams and remote XML as untrusted input. The app
has no network listener except a loopback control socket, no account, and no telemetry.

## Playlist rules

- `#EXTVLCOPT`, `#KODIPROP`, and similar option-injection lines are counted and discarded.
- Remote playlists cannot reference `file:`, `unix:`, `data:`, `javascript:`, `smb:`, …
- Playlist download: HTTP(S) only, 5 redirects, 64 MB cap, 30 s timeout, rustls.
- Userinfo in playlist URLs is rejected (do not put Xtream passwords in the URL).
- Credentials are not stored in SQLite (no password column).

## Subtitles

- Download hosts are allow-listed (OpenSubtitles, TheSubDB, Podnapisi).
- Payload size is capped; ZIP payloads are read in memory, never extracted to disk.
- Subtitle text is rendered as a text track, never as HTML.
- There is **no** unofficial quota-bypass scraper and **no** shipped API key.

## DLNA

- SSDP `M-SEARCH` goes out on the LAN only; responses are parsed as XML with tag extraction,
  not a full entity-expanding parser.
- `http://` device descriptions are fetched with a 8 s timeout and no redirects to other schemes.

## IPC

JSON control listens on **127.0.0.1:18765** only. Non-loopback peers are dropped before a line
is read. Do not expose or port-forward this port, and do not run G9 as a service.

## Optional binaries

If `ffmpeg` / `ffprobe` / `whisper` are on PATH, G9 may spawn them on the current file path,
hidden, with no shell. Do not put an untrusted directory ahead of the real binaries on PATH.

## Untrusted media

Playback goes through WebView2's decoder. G9's CSP allows `media-src` / `img-src` from
`http:`, `https:`, `blob:` and the asset protocol so streams and posters work, but
`script-src` is `self` only — remote content can never run script in the app.

## Caption translation

“Translate captions” sends cue text to MyMemory over HTTPS. Do not put secrets in subtitle files.

## Diagnostics

The diagnostics overlay may show the current URL. Redact tokens before pasting into an issue.
`Inspect` prints `ffprobe` metadata for the current file — metadata can contain file paths.

## Reporting

Open a GitHub issue with the `security` label. Do not attach live provider credentials,
deploy keys, or full playlists.
