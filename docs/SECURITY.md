# Security

G9 treats playlists, EPG files, subtitles, and streams as untrusted input.

## Playlist rules

- `#EXTVLCOPT`, `#KODIPROP`, and similar option-injection lines are counted and discarded.
- Remote playlists cannot reference `file:`, `unix:`, `data:`, `javascript:`, `smb:`, …
- Playlist download: HTTP(S) only, 5 redirects, 64 MB cap, 30s timeout, rustls.
- Userinfo in playlist URLs is rejected (do not put Xtream passwords in the URL).
- Credentials are not stored in SQLite (no password column).

## Subtitles

- Download hosts are allow-listed (OpenSubtitles, TheSubDB, Podnapisi).
- Payload size is capped.
- There is **no** unofficial quota-bypass scraper and **no** shipped API key.

## IPC

JSON control listens on **127.0.0.1:18765** only. Non-loopback peers are dropped. Do not expose this port.

## Optional binaries

If `ffmpeg` / `ffprobe` / `whisper` are on PATH, G9 may spawn them on the current file path. Do not point G9 at untrusted binaries named `ffmpeg`.

## Caption translation

“Translate captions” calls MyMemory over HTTPS with cue text. Do not put secrets in subtitle files.

## Diagnostics

Do not paste playlists that contain tokens into issues. The diagnostics overlay may show the current URL — redact before sharing.

## Reporting

Open a GitHub issue with the `security` label. Do not attach live provider credentials.
