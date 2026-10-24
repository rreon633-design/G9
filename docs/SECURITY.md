# Security

G9 treats playlists, EPG files, subtitles, and streams as untrusted input.

## Playlist rules (v0.1)

- `#EXTVLCOPT`, `#KODIPROP`, and similar option-injection lines are counted and discarded.
- Remote playlists cannot reference `file:`, `unix:`, `data:`, `javascript:`, `smb:`, …
- Playlist download: HTTP(S) only, 5 redirects, 64 MB cap, 30s timeout, rustls.
- Userinfo in playlist URLs is rejected (do not put Xtream passwords in the URL).
- Credentials are not stored in SQLite (no password column).

## Diagnostics

Do not paste playlists that contain tokens into issues. The diagnostics overlay shows the current URL — redact before sharing.

## Reporting

Open a GitHub issue with the `security` label. Do not attach live provider credentials.
