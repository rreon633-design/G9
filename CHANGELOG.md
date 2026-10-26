# Changelog

All notable changes to G9. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
G9 uses `MAJOR.MINOR.PATCH` and the Windows installers are always built from a `v*` tag.

## [Unreleased]

### Tools — checking which public links still play

- **`scripts/g9_check.py`** — standard-library Python 3.8+, no dependencies. Reads any number of
  M3U files or URLs, follows a master playlist to its first variant, **downloads a media segment**,
  and only then calls a stream alive. Writes `working.m3u` (exactly what passed, already deduped by
  URL — the file you import), `new_to_add.m3u` (`--mine` diffs it against your playlist),
  `failed.csv` (reason per failure, plus a `suspect_host` flag) and `report.txt`.
  `--telugu`, `--filter`, `--workers`, `--timeout`, `--out`.
- **[docs/STREAMS.md](docs/STREAMS.md)** — what the public indexes actually contain, why the site
  playlist is a filtered subset of the source list, the 2026-10-26 Telugu audit (166 streams, 139
  alive, 83 channels, 16 dead outright), which hosts the survivors live on, and the honest reading
  of each group.
- Naming the dead rather than pretending: the ETV main feeds (`ETV AP / Telangana / Cinema / Plus`)
  are gone at the hostname level (NXDOMAIN, not a geo-block); **DD Saptagiri, DD Yadagiri, Studio N,
  Bharat Today, Zee Cinemalu and Kushi TV are not in the source list at all**, and Kushi TV is
  Irdeto-encrypted on Measat 3d, so a free stream of it is not to be expected.

The shipped app is unchanged by this entry — the checker is a repo tool, so the 0.17.0 installers
are still the 0.17.0 binaries.

## [0.17.0] — 2026-10-26

Social stops being a takeover and becomes a **sidebar you keep open while you watch**, chat works
on an install where nothing is running yet, and the playlist sheet now carries the public
indexes that were asked for — as links, never as bundled channels.

### Social lives in a sidebar

- **Chat and the call are docked to the right**, `380 px` by default and resizable by its grip
  (`288–720 px`, remembered between runs). The player does not sit underneath it: the app
  narrows to `calc(100% - sidebar)`, so the transport, the volume and the seek bar stay visible
  and usable while you talk. Only the social surface gets a sidebar; the player chrome is still
  overlays only.
- **The room drawer floats over the transcript** instead of pushing it down — one click on the
  rail button opens the list of rooms (with who is in them and unread counts), picking one
  closes it again.
- **The camera tiles are 16:9 cards inside the dock**, one per row, and the call head never
  wraps: the peer count, the latency, the sending tier and the Expand button fit on one line at
  `288 px`. Expand still gives the full grid (`1 / 2 / 3` columns by call size, self view as a
  corner picture-in-picture) and Shrink brings it back to the dock.
- **Fixed a class of bug, not an instance:** the panel used to rebuild its own DOM every time it
  was opened, which silently detached the close button, the room drawer, the filter and the
  resize grip — the panel worked once and then went dead. `mount()` is now idempotent and the
  shell is wired once (`wireShell()`), so close → reopen → drawer → close works indefinitely.
- **Fixed the global `video` rule leaking into the call**: `video { position:absolute; inset:0 }`
  is right for the player and wrong for a call tile, so the tile media now resets to
  `position:static` with `object-fit:cover`. The frame geometry was already correct — the pixels
  were simply being painted at the wrong size.

### Chat that works with nothing else running

- **Room creation starts its own hub.** "Create a room" on a fresh install used to fail with
  `Failed to fetch` because there was no hub to talk to. Now `social_hub_start` probes `/health`,
  spawns `g9-hub` on the requested port (falling back to a free one), and returns the room URL.
  Rooms are then created against the **share URL** — the LAN address a guest can actually reach,
  never `127.0.0.1`.
- **Failures are sentences now.** No hub, a dead hub and a refused invite each say what happened
  and what to do ("no hub answered at … — press Start hub", "the host's hub is not answering;
  the invite is still valid"), instead of an unhandled fetch error.

### Public playlist indexes in the import sheet

- **Eight one-click presets** in *Add playlist / IPTV…*: **Sports**, **India**, News, Movies,
  Documentary, Music, Kids and All countries, from the open [iptv-org](https://github.com/iptv-org/iptv)
  indexes (`categories/sports.m3u`, `countries/in.m3u`, …). Choosing one fills the name and the
  URL field and marks the chip; **Import** still has to be pressed, so nothing is fetched by
  clicking, and the URL stays editable.
- **The sheet says what it is**: *"G9 ships no channels. These are open indexes of publicly
  listed streams; a link that stops working is a link whose owner stopped streaming it."* The
  sports index lists 800-odd free-to-air feeds — it has no Sky, DAZN, ESPN or other paid
  carriage, and availability changes weekly. **Kushi TV** is Telugu on Measat 3d (4080 V,
  MPEG-4 SD, **Irdeto**-encrypted); there is no reliable free stream of it, and G9 will not
  pretend otherwise. The National Geographic feeds that circulate as bare `.m3u8` links can be
  pasted into the same URL field — they are single channels, not a playlist.
- **Merging is the documented pattern**: import each source as its own playlist, or concatenate
  several `#EXTM3U` files into one master `.m3u` (dedupe by URL) and import that once — one
  playlist, one channel list, every group in the TV sheet.

### Under the hood

- `Cargo.toml` now declares `g9-hub` in `[workspace.dependencies]` — the app crate inherited a
  workspace dependency the workspace never declared, which broke `cargo fmt`, `clippy` and any
  non-Tauri workspace build from a clean checkout.
- Ninth smoke suite extended: the sidebar width, the drawer opening, closing and surviving a
  close/reopen, the close button, and the preset chips (one marked at a time, second replaces
  first, nothing fetched by choosing).

## [0.16.0] — 2026-10-26

Social, second release: the same loop, made quick and honest about its own speed. A three-way
video call now connects in about a third of a second, a nine-person call stops trying to send
720p to nine people, every tile shows the latency it is actually getting, and a dropped room
comes back by itself carrying whatever you typed in the meantime.

### Faster — measured, not claimed

- **The call no longer waits for the room to answer.** `g9-hub` now keeps the call roster and
  answers a `call join` with it in the same round trip, so the first offer goes out the moment
  the camera opens instead of after a broadcast-and-wait. In the nine-device run:
  **call connected in 0.29 s** (was 0.21 s for two, 40 s in the bug we fixed in 0.15.0),
  **full mesh of five in 1.18 s**, chat to eight devices in **0.03 s**.
- **ICE starts gathering before it is needed** (`iceCandidatePoolSize: 4`), and every
  connection is `max-bundle` with RTCP muxing, so a call is one port and one round trip.
- **Opus is configured for speech, not streaming**: 10 ms packets instead of 20 (half the time
  between mouth and ear), in-band FEC, DTX, mono, and a bitrate that matches the call size.
- **H.264 is preferred over VP8/VP9/AV1** where the browser allows it, because Windows decodes
  H.264 in hardware — a nine-person call stops competing with the player for CPU.
- **A quality ladder by room size**: 720p30 for two people, 540p30 for up to four, 360p24 up to
  six, 240p15 above that — applied to the sender via `setParameters`, so the encoder never
  produces bits the uplink cannot carry.
- **Receiver tuning**: `playoutDelayHint: 0`, a 40 ms audio / 80 ms video jitter target, and
  `contentHint = "speech"` so the browser's pacer treats voice as something that must not wait.

### Visible

- **Live latency in the call head** (`22 ms`) and the workspace strip — a real round trip to
  the hub, not a guess, measured every 2.5 s from the hub's echo.
- **Per-tile telemetry on hover**: peer round trip, received resolution, bitrate in, and a
  "weak" warning past 250 ms or 60 ms of jitter.
- **Active-speaker detection** from the inbound audio level, so the loudest tile is outlined.
- **The sending tier is shown** (`540p`) — you can see the call adapt when the sixth person joins.

### Reliable

- **The room reconnects itself.** A dropped socket retries with backoff (twelve attempts, up to
  8 s apart), re-states the call to the hub, re-offers to everyone still in it, and says
  "Reconnecting · attempt 2" instead of "Disconnected — press Reconnect".
- **Chat written while the socket is down is queued and flushed on the way back**, shown as
  *queued* the whole time. Control frames are never queued — a stale offer is worse than none.
- **A dropped peer connection restarts ICE** instead of ending the call, up to four attempts,
  with the answering side able to request the restart.
- **Arrivals during capture are no longer lost.** If someone joins the call while your camera is
  still opening, the arrival is buffered and replayed — this was a silent half-connected call.
- **A malformed frame can no longer throw out of the socket handler** (base64-validated, length
  checked) — one bad frame used to be able to kill a transcript.
- **Closing the workspace leaves the call**, so the camera is never left running without
  controls on screen. Switching rooms does the same.
- **An invite dialog never sits over a live call**, and it is dismissed when a call starts.

### Verified

- `cargo test --workspace --exclude g9` — **104 tests**, including four new hub tests: the
  roster arriving in the same answer, leave and a dropped socket both announced, ping echoing
  its sequence number, and the roster surviving a reconnect.
- `node domtest/smoke13.js` — **new gate**: the SDP tuner, the four-step ladder, ICE pool and
  bundle policy, roster-first call setup, sender caps and codec order, self-muted tiles, ICE
  restart, live RTT and per-peer stats, reconnect with a flushed outbox, and capture-time
  arrivals.
- `node domtest/smoke12.js` — still green (the 0.15.0 gate).
- `python3 scripts/e2e-social.py --devices 9 --mesh 5` — nine browsers against a real hub:
  room 0.23 s, chat fan-out 0.03 s, two-way video **0.32 s**, five-way mesh **1.18 s**, peak
  peer RTT 7 ms, zero loss, then everyone leaves and the room empties.

### Known limits, stated plainly

- Calls are still **mesh**: each device connects to every other, so a nine-way *video* call means
  72 encodes. The ladder keeps that survivable up to about five or six video senders; past that
  the SFU in `docs/SOCIAL-PLAN.md` §5 is the answer, and it is the next release.
- A public STUN service is the default. Networks that block UDP need a TURN server, which
  `G9Social.setIceServers([...])` accepts and remembers; a Settings field for it lands with the
  SFU release.
- The E2E script runs nine devices but a five-way mesh by default (`--mesh N`), because the
  sandbox it is developed in saturates above that; a desktop reaches nine.

## [0.15.0] — 2026-10-25

Social, first release: a workspace of your own where a room is one link away — type, talk,
see each other, leave cleanly, come back to everything you said.

This is the first of the five social releases in `docs/SOCIAL-PLAN.md`. It ships the part that
has to be perfect before anything else is worth adding: **the loop**. Open, create or paste a
link, chat, call, leave, reopen — no accounts, no pairing, no IP addresses, no "same Wi-Fi".

### Added

- **Social workspace** (`Ctrl+Shift+S`, or the chat button in the top bar). Its own surface with
  a left rail — the one deliberate exception to G9's no-sidebar rule, because it is a
  conversation list, not player chrome. Rooms, live people in the room, saved contacts, unread
  counts, a filter box, and your own identity at the foot of the rail.
- **A room is a single link.** Create a room, and G9 mints a signed, expiring invite that
  carries the hub address, the room, the seat count and a **32-byte room key in the fragment** —
  the fragment never reaches the server, so the hub cannot read a single message. The same
  link is drawn as a **QR code** (rendered in Rust, `qrcode` crate, SVG) for a phone or a
  second screen: scan, open, you are in. Re-inviting never invalidates a link already shared.
- **Chat that is sealed before it leaves the machine.** AES-256-GCM per frame, AAD binds room,
  sender and kind, so a frame cannot be replayed into another room or another sender. Keys come
  from Rust; plaintext never crosses the IPC boundary in either direction on the way out.
- **Voice and video calls**, mesh, with the whole call surface built for the ninth device and
  the second one: adaptive tiles (peer fills the stage, you in the corner), a running clock, mute,
  camera on/off mid-call, leave, and a transcript entry that records the call and how long it ran.
- **Leaving is not a crash.** `Leave` stops every track, closes every peer connection, tells the
  room, drops the tiles and writes "Call ended · 2:41" into the thread. Rejoining works, and the
  conversation is exactly where you left it.
- **`g9-hub`** — a small axum relay you can run anywhere (VPS, container, a Raspberry Pi):
  `/health`, nonce + signed handshake (Ed25519, no passwords), room create/join with seats,
  signed invites, and a WebSocket fan-out. CORS is open on the REST surface because every caller
  is a webview on another origin, and nothing is authenticated by cookie.
- **`g9-social`** — the protocol crate: identity, room keys, frame sealing, invites, and a local
  SQLite store (threads, messages, contacts, devices) so nothing is lost when the app closes.
- **Reconnects that keep their place.** Announcements that arrive while your microphone is still
  opening are buffered and replayed; a call that misses a handshake re-announces and re-offers
  for fifteen seconds instead of silently sitting in "waiting"; simultaneous presses on both
  ends resolve without glare.

### Fixed

- Two people pressing call at the same time could deadlock, or one side could try to offer while
  answering another offer and fail with an m-line ordering error. Offers are now single-flight,
  the collision is resolved by yielding, and a missed announcement is retried.
- Pressing **Invite** while already in a room no longer re-enters the room. It used to drop the
  socket — which would have ended an active call for no reason.

### Verified

- `cargo test --workspace --exclude g9` — 100 tests, including 26 for `g9-social` and 10
  integration tests for `g9-hub`.
- `node domtest/smoke12.js` — the social gate: the Rust AES-GCM vector opens in JS, create → invite
  → QR → join, an optimistic message that goes out sealed, a peer reply that renders and is
  acknowledged, a tampered frame that never becomes a bubble, a call offered and answered with
  tiles, and leave/reopen.
- `python3 scripts/e2e-social.py --devices 9` — nine real Chromium contexts against a real
  `g9-hub`: room ready in 0.23 s, one message to eight devices in 0.04 s, video connected in
  0.21 s, then everyone leaves and the room empties.
- Windows x64: `cargo check -p g9 --all-targets` in CI is the compile gate for the Tauri layer.

### Known limits, stated plainly

- Calls are **mesh**: fine for 2–4 people. A nine-person *video* call needs the SFU from
  `docs/SOCIAL-PLAN.md` §5 — that is the next release, not this one. Nine devices can join one
  room, chat, and hold two-way calls; they cannot all send video to each other yet.
- The reflex camera / QR scanning, the TURN fallback and chat while offline (store-and-forward)
  are later releases, in that order.

## [0.14.0] — 2026-10-25

The interface learned to be yours: a light theme that is a real theme and not an inversion,
an accent colour, a profile, a notification centre that remembers what a toast said three
seconds ago, and a start screen that is worth looking at.

### Added

- **Light theme, and Auto.** Both are value-only overrides on one token set, so every panel,
  menu, sheet, Fun Mode and TV Mode follows. Auto tracks the Windows app theme live. The
  saved theme is applied in `<head>`, before the first paint, so a light theme never flashes
  dark on start-up.
- **Appearance & personalisation** (Settings, or the avatar): accent colour — eight presets
  or any colour, with the ink on top of it chosen from its luminance — corner radius 0–20 px,
  density, overlay text size 90–115 %, interface font (Geist, Segoe UI, Georgia, JetBrains
  Mono), animation on/off, translucency on/off, and icon weight.
- **Profile.** A name and an optional avatar (stored locally as a data URI), shown in the top
  bar, the profile card and Fun Mode's avatar.
- **Notification centre.** Every toast is mirrored into a bell menu with categories, relative
  times, an unread badge, mark-all-read, clear, and independent switches for toasts, history,
  downloads, playback and errors. 60 entries, kept locally.
- **Start-screen widgets** — Now (clock and date), Continue watching (with a progress bar) and
  Library (titles played, channels). Each can be switched off; all three off removes the strip.
- `ui/theme.js` (`G9Theme`, `G9Notify`) and `docs/UI-DESIGN.md`, which documents the token set
  and every control.

### Changed

- **The CSS was rebuilt on tokens.** Surfaces, ink, hairlines, accent tints and status colours
  are variables in one block; a theme is a second block of values. Fun Mode and TV Mode, which
  carried their own dark greys, now read from the same tokens.
- Accent-coloured controls (the logo tile, the play button) take their glyph colour from the
  accent itself, so an amber or mint accent no longer has a white-on-light-blue play button.
- The Settings sheet gains an Appearance and a Notifications row, and the sheet and the engine
  can no longer disagree about the current theme because the row is generated by the engine.
- Chrome over the picture — transport, toasts, OSD — stays dark in both themes on purpose: a
  white bar across a film is a glare panel. The scrims are now dark in every theme, which is
  what fixes the transport glyphs disappearing on the light theme.

### Verified

`domtest/smoke11.js` walks themes, the accent maths (including an invalid colour), every
personalisation hook, the profile, notification gating, the widgets, both entry points, reset
and Auto resolution. `preview/shoot_theme.py` photographs both themes, the appearance sheet,
the notification centre, the profile card, Fun Mode, TV Mode and the start screen in Chromium.
The v0.13.0 GPU pixel test still passes unchanged. No Rust changes; the 97-test suite is
untouched.

## [0.13.0] — 2026-10-25

The picture moved onto the GPU. Brightness, contrast, saturation, sharpening and a new
deband stage are now shader passes over a WebGL2 canvas — and with every control at its
default, nothing is drawn at all.

### Added

- **A real picture pipeline.** Grade and sharpen share one fragment pass, deband and
  dither a second; offscreen targets let them chain with one video upload per presented
  frame. WebGL2 preferred, WebGL1 runs the same shaders.
- **Sharpening that sharpens.** Contrast-adaptive unsharp over a 5-tap neighbourhood,
  applied to the graded image, weighted 0–8 on the slider. The old CSS `contrast()` trick
  is gone.
- **Deband & dither.** A nine-tap ring whose radius scales with the frame turns shallow
  8-bit steps into a ramp; one bit of ordered noise dithers what is left so it does not
  read as a smooth digital gradient. Edges are left alone — flatness is measured per pixel.
- **Frame-paced presentation.** Renders from `requestVideoFrameCallback` (rAF where it does
  not exist), so the pipeline draws once per frame the browser actually presents. Fit, zoom,
  rotate and mirror are mirrored onto the canvas.
- **Honest state.** Picture reads `GPU · grade + sharpen → deband`, `CPU fallback` or off;
  Settings › Diagnostics gains "Picture pipeline" and "Presented" rows. Settings persist
  under `g9-picture-fx`.

### Fixed

- **Two-pass chains came out upside down.** The vertex stage flipped the texture coordinate,
  which is correct for the direct pass and wrong for every pass that reads an offscreen
  target. The video is now flipped once, at upload.
- Off means off: no canvas, no leftover CSS filter, the untouched `<video>`.
- A stream that cannot be uploaded to a texture (cross-origin, protected) falls back to CSS
  filters once, with a short toast, instead of throwing on every frame.

### Verified

Chromium with WebGL2, on a synthetic 8-bit banded clip: banding drops from 8.1% of pixels to
none, edge rise at sharpening 6 goes up 18% without clipping, the frame stays the right way up
and in the right place through every pass chain, and the off state is pixel-identical to the
plain video. `domtest/smoke10.js` covers the plan, the chain, one upload per frame and both
fallbacks. No Rust changes; the 97-test suite is untouched.

## [0.12.0] — 2026-10-25

Sources became something you can actually run more than one of — and the wall no longer
asks a new install to configure anything before it opens.

### Added

- **Per-source request headers.** Any source can carry its own `Accept-Language`,
  `User-Agent` and free-form headers (`Cookie`, `Referer`, …), edited from Sources. The
  request cache is keyed on the header set, so a source asked in two languages does not
  hand back the other body.
- **Source health.** Every wall refresh times each source and remembers the result. Sources
  shows `120 ms`, `1.8 s — slow` or the reason it failed, and **Test** probes one on demand.
- **Addon-declared filters.** *See all* on an addon shelf now reads the manifest and offers
  exactly the genres and years that addon declares; picking one re-queries the addon instead
  of filtering only the forty titles already on the wall.
- **Catalog paging.** *Load more* asks the addon for the next page with `skip`, and keeps the
  chosen genre and year when it does.
- `fun_catalog_filters`, `fun_source_headers` and `fun_source_test`; `stremio::catalog_facets`
  and `stremio::filter_extra` with tests.

### Changed

- **No setup before the first wall.** A fresh install seeds two keyless providers — Internet
  Archive and MangaDex — so Fun Mode opens populated. Nothing is added when sources already
  exist, and starters you removed stay removed (`fun.seeded`).
- The first-run tour no longer gates the wall: it appears only when there is genuinely no
  source, and says the built-ins are already on.

### Fixed

- The Sources sheet could not show that a source had failed, and the source list reported
  every entry as having no headers.

## [0.11.0] — 2026-10-25

Fun Mode now opens with something to watch on a machine that has never been configured,
and the wall acts like a place you keep things instead of a shop window.

### Added

- **A source on first run, with no account and no key.** A fresh install seeds the Internet
  Archive's public-domain film collections — feature films, classic TV, noir, sci-fi and
  animation — so the wall is never an empty demo. Remove it in Sources and it stays removed.
- **Stream picking.** Every stream a source offers is listed under the title with its size,
  its estimate in Mbps, and its seeds; the one you pick is remembered for that show.
- **Subtitles from the source itself.** Addons that publish their own subtitle tracks are
  offered before any online search, matched to your subtitle language.
- **Episode tools** on long seasons: a season switcher, a search box, sort by number or air
  date, and a *Random* button.
- **Reader modes** — scroll or paged — plus chapter navigation and **night reading**, which
  dims the page without dimming the interface.
- **Real reading resume.** The page you stopped on is saved and reopened.
- **Watch time.** A totals screen in the hub: hours this month, and hours by kind.
- **A queue** that survives a restart: *Add to queue* on any title, and when an episode ends
  the next thing you queued starts.
- **Like / not for me** on a title, which reorders the *Because you watched* row.
- **Catalog paging** for addon shelves: *Load more* asks the addon for the next page.
- **Cross-source resume.** The same show kept from two sources remembers one position.
- **First-run tour** (three short cards) and a **Playback** panel that now says what it does.
- **Context menu** on any card: play, list, queue, mark watched, hide, copy link.
- `fun_catalog`, `fun_subtitles` and `fun_subtitle_text` commands; `g9_sources::archive`.

### Changed

- Library cards de-duplicate by title, so the same show saved from two sources is one card.
- `g9.fun.recents`, reading mode and stream picks live on the device and are cleared with
  *Clear cache* in Settings.
- The debug-seed commands from the 0.10 development cycle are gone.

## [0.10.1] — 2026-10-25

Two switches in the Playback sheet were shipped in 0.8.0 and never did anything. They do now.

### Fixed

- **Fallback to next source** — when a stream 403s or stalls, the player now asks Fun Mode before
  it gives up, and Fun Mode moves to the next stream that fits your quality cap (saying which
  source it is trying). With the preference off, you get the same short error as before.
- **Subtitles preference** — *Auto / Hindi / English / Off* now reaches the real subtitle search
  (it was hard-wired to `en`) and turns auto-attach off when set to *Off*.

### Changed

- `FEATURE-LIST.md` now carries the full status of the 57-feature brief: **24 shipped** in 0.10.0,
  **33 open**, each with the reason it needs a subsystem G9 does not have yet and the release it
  is planned for.

## [0.10.0] — 2026-10-25

Fun Mode becomes something you can run a series in: it remembers what you watch, what you
keep, what you never want to see again, and it can find things across every source at once.

### Added

- **My List, in the database** — the `+` on any title (or the right-click menu) writes to SQLite,
  and a **My List** tab keeps it, sorted by when you added it, A–Z, or newest.
- **A Watching tab that actually resumes** — position is written every 8 s while Fun Mode plays,
  so *Continue watching* opens the episode you were on and seeks to the second you stopped.
  Titles past 90 % are marked watched on their own.
- **Watched, Following and Not interested** — three flags per title, drawn on the card
  (✓ watched, • following) and reversible; hidden titles leave a one-click **Undo** note
  under the wall.
- **Following rail** — everything you followed, with new episodes surfaced as a shelf.
- **Merged search** — the same film from three addons becomes one card that says *3 sources*;
  results fall back to what you added when a source is quiet, and forgive a typo.
- **Search that remembers** — recent searches, and a **What I added** scope that never leaves
  your library.
- **Filters on See all** — genre, year and quality, with a live *“n of m titles”* count.
- **More like this** — genre and cast overlap, from your own sources.
- **Cast row + person page** — the Stremio `cast` field is now parsed, and tapping a name shows
  everything else they are in.
- **Genre chips** on the title page open a genre browse.
- **Keyboard on the wall** — arrow keys walk the cards, `Enter` opens one.
- **Right-click a card** — open, play, My List, watched, follow, more like this, copy link,
  not interested.
- **Autoplay next episode** — a 10 s *Up next* card, cancellable, and a *Still watching?*
  check after three in a row.
- **Quality cap (data saver)** — the playback setting now really chooses the stream, and an
  audio-language preference picks the matching labelled source first.
- **Sleep timer** — 30/60/90 min from Playback, with a countdown chip in the nav that pauses
  the player when it runs out.
- **Mini player bar** — the stream stays visible as a LIVE/PLAYING chip with pause, resume,
  stop and a jump back to the player.
- **Fun Mode settings hub** — Playback, My List & history, Sources and Data in one sheet.
- **Backup and restore** — sources, progress and every flag as JSON (copy out, paste back;
  restore merges, never deletes).
- **`g9://` title links** — *Copy link* on any title, and an opener in Data; the same string
  works from the address bar or a script.
- **First-run wizard** — three steps: what G9 does, add your first source, pick a data cap.
- **Refresh chip**, **episode thumbnails** when a source supplies them, and a **cache-clear**
  button that empties the in-memory source cache.

### Changed

- The avatar button now opens the settings hub rather than a lone prefs list.
- `g9-sources` parses `cast` from Stremio meta (12 names, string or `{name}` entries).
- The library lives in schema **v4** (`fun_lib`); the migration is additive.

## [0.9.1] — 2026-10-25

### Fixed

- The eight speed presets overflowed the Speed panel and clipped **4×**; they now wrap into a
  two-row grid.

## [0.9.0] — 2026-10-25

The everyday basics: the controls a player is expected to have before it has anything clever.

### Added

- **Picture fit, zoom, rotate and mirror** — Fit / Fill / Stretch / 125% / 150% in the Picture
  panel, plus **Rotate 90°** and **Mirror** for phone footage; `Shift+F` cycles the fit,
  `Shift+R` rotates, `Shift+H` mirrors. Remembered between sessions.
- **Drag & drop** — drop a video to play it, several to queue them, a **folder** to queue
  everything in it, a `.srt` / `.vtt` / `.ass` / `.ssa` to attach subtitles, or a link to stream it.
- **Open folder…** — queue every video in a folder, sorted the way Explorer sorts (`Ep 2` before `Ep 10`).
- **Playlists the player can keep** — *Save the queue as a playlist…* writes a real `.m3u8`;
  *Open a playlist…* fills the queue from one and starts playing.
- **Subtitle picker** — the CC button and *Find subtitles…* list the results (release, language,
  rating) and you choose; **Best match** and **From a file…** are one click away. Provider names
  are never shown.
- **Stream stats** (`I`) — resolution, fit, speed, buffer, dropped frames, volume, retries.
- **Keyboard sheet** (`?`) — every binding in one place, including the new ones.
- **Seek keys** — `0`–`9` jump to 0–90%, `Home` / `End` to the ends, `+` / `−` nudge the speed.
- **Playback up to 4×** with 0.5× / 0.75× / 1× / 1.25× / 1.5× / 2× / 3× / 4× presets, remembered.
- **Double-click fullscreen** and single-click play/pause on the picture (chrome clicks are ignored).
- **Window memory** — size, position and maximized state come back on the next launch.
- **Check for updates** in About — asks GitHub for the newest release and offers **Download**.
- **Live stream reconnect** — a dropped HTTP(S)/HLS stream is retried three times (1s, 3s, 8s)
  with the status line counting attempts and playback resuming where it stopped; when the
  attempts are spent G9 says **Stream unavailable · press play to try again**, and Play reloads it.

### Changed

- Release pages are generated: `scripts/release-notes.sh` builds the GitHub Release body from the
  matching `CHANGELOG.md` section, and a **Release notes** workflow re-syncs it from `main`, so the
  page can no longer advertise the previous version's bullets.
- The CC button opens the picker instead of silently applying the first result.
- `speed` no longer stops at 2×; the slider goes to 4×.
- Picture panel: **Reset colour** and **Reset picture** are separate, so clearing the rotation no
  longer wipes the brightness/contrast/saturation settings.

### Fixed

- The drag overlay could sit invisible over the whole window and swallow clicks (`.drop-hint`
  set `display:grid`, which beat the `hidden` attribute).
- A permanently broken stream used to leave "Reconnecting…" on screen forever.

### Commands

- New: `list_folder`, `playlist_save`, `playlist_load`, `read_text`, `apply_subtitle`,
  `update_check`, `open_url`.

## [0.8.0] — 2026-10-25

Fun Mode: movies, series, anime and manga on one wall, built only from sources you add.

### Added

- **Fun Mode** — a new top-bar mode next to TV Mode. A Netflix-shaped wall: a featured hero,
  **Continue watching**, a ranked **Top 10**, and one rail per shelf, with live search, a
  **See all** grid that sorts by quality / newest / rating, and a details sheet carrying the
  synopsis, source chips, episode or chapter lists and My List / Download.
- **`g9-sources` crate** — the source layer, parsed offline and unit-tested:
  - **Stremio addons** (`manifest.json`, `catalog`, `meta`, `stream`, `subtitles`): paste any
    addon URL and its catalogs appear as shelves.
  - **RSS feeds of magnets** — Nyaa-style feeds (seeders, size, category, release titles) or any
    RSS feed whose items link a magnet.
  - **yt-dlp resolver** — the managed engine now also answers "resolve this page": `-J` formats
    become playable streams with the `http_headers` the CDN wants.
  - **MangaDex** — official API for manga, manhwa and manhua: search, chapter lists, page images.
- **Reader** — full-screen, continuous paged reading for MangaDex chapters, with reading progress
  saved per title.
- **`fun_*` commands** — `fun_sources`, `fun_source_add`, `fun_source_remove`, `fun_source_toggle`,
  `fun_home`, `fun_search`, `fun_details`, `fun_streams`, `fun_resolve`, `fun_pages`,
  `fun_progress_save`, `fun_progress_list`, `fun_progress_remove`.
- **Schema v3** — `fun_sources` and `fun_progress` tables (resume points, recents, chapter marks).

### Notes

- **Nothing is bundled.** No catalogue, no playlist, no credential: the wall starts as a short
  "add a source" explainer and fills up from what you add. MangaDex is off until you switch it on.
- Failures stay one short line and never name the source or print a URL.
- Magnet links are recognised and labelled but do not play yet — torrent streaming is the next
  release (`v0.10.0` in `docs/FUN-MODE-PLAN.md`).
- Every control in the mode is wired: verified by `domtest/smoke6.js`, which drives the wall →
  sheet → episode → player, the sources dialog, search, browse sorting, tabs and the reader.


## [0.7.0] — 2026-10-25

GIF out, TV mode in.

### Removed

- **GIF export is gone** — the toolbar button, the Media → Tools entry and `ui/gif.js` are removed,
  and CI no longer expects the encoder. Save frame, recording and webcam recording stay.

### Added

- **Now-playing bar in the channel wall.** While browsing, a bar at the bottom shows the channel
  that is actually playing — logo, name, country · group · language, and its current programme —
  with **Play/Pause** and **Watch** (back to full screen).
- **RECENT row** — the channels you actually watched, newest first, straight from history. Hidden
  while a filter is on.
- **What's on** — the `⋯` on a channel card opens the next programmes for that channel with
  times and a **NOW** marker; click a row to tune. (`epg_upcoming` command.)
- **Guide button** in the wall: loads the guide the playlist points at, or asks for an address,
  and shows how many channels it covers.
- **Paging** — the wall asks for 120 channels at a time and offers **Show more**, so a
  5,000-channel playlist paints instantly. The header says *showing 120 of 5,000*.
  (`channel_total` command shares the filter builder with `list_channels`.)
- **Keyboard and remote control** — arrows walk the wall (2-D, so left/right stays in the row),
  Enter tunes the focused channel, digits jump to a channel number, `F` toggles the favourite,
  `/` jumps to search, `G` reloads the guide. `Esc` now backs out one level: popover first,
  then the wall.

### Fixed

- **One-line XMLTV programmes were dropped.** `<programme …><title>X</title></programme>` on a
  single line lost every entry but the last, because the parser only closed a programme when
  `</programme>` started a line. Multi-entry guides (now/next and what's on) now list correctly;
  covered by a test.
- `scrollIntoView` is guarded, so keyboard focus works in engines without it.
- Dismissing a Save dialog no longer falls back to a browser download (save results are now
  `path` / `cancelled` / `unsupported`).

## [0.6.0] — 2026-10-25

A download that downloads, and a TV mode you can browse.

### Fixed

- **Downloads failed on every video.** YouTube (and most sites now) publish video and audio as
  separate streams, and G9's no-FFmpeg fallback asked for a single muxed file that no longer
  exists — `Requested format is not available`. G9 now **installs its managed FFmpeg on first
  use** (the same one Settings → FFmpeg manages) and always merges, with the progress shown in the
  Downloads panel. Verified end to end against YouTube: 360p/720p mp4 with both streams, plus
  audio-only.
- **The reason was hidden.** A failed job showed only “download stopped”, because the child exits
  before its stderr is drained. The last line is now kept with the job and shown, shortened and
  freed of extractor noise (`That video offers no downloadable format`, `This site wants a sign-in
  for that video`, …).
- **No way to try again.** Failed and stopped jobs get a **Retry** button that resumes from the
  partial file instead of starting over.
- Four-way DASH connections (`-N 4`) so long videos do not crawl.

### Added

- **TV Mode is a channel browser.** Full-screen, YouTube-shaped: logo cards, a search box,
  **Favourites / Country / Language / Quality** chips with counts, and sorting by channel order,
  name, country, quality or group. Every card shows now/next from the guide. Cards that are
  playing are outlined; the star on a card toggles favourites.
- **It tunes itself.** Entering TV Mode (or starting G9 in it) starts the last channel you watched,
  or the first one in the list. A **Channels** pill stays on screen while watching to bring the
  browser back; `Esc` closes it.
- **Channels carry the metadata the filters need.** The M3U parser keeps `tvg-country`,
  `tvg-language` and derives `4K / FHD / HD / SD` from the name; the SQLite schema migrates to
  v2 with `country`, `language` and `quality`, indexed for filtering.
- Filtering lives in SQL (`list_channels` takes country/language/quality/sort), with a
  `channel_facets` command for the chip counts, so a 5,000-channel playlist stays responsive.

### Changed

- Media → Live opens the channel browser while TV Mode is on, and the old list sheet still serves
  windowed mode.

## [0.5.0] — 2026-10-25

Downloads and live guides.

### Added

- **Download videos from the web** — the welcome screen now takes a link to a video page.
  G9 asks the page what it has, lists each quality with an estimated size (4K down to 360p, plus
  audio-only), and downloads the one you pick into `Videos\G9`. YouTube, Instagram, Facebook and
  the other sites `yt-dlp` understands are all fair game; only download what you have the rights to.
- **Downloads panel** — runs in the background while you watch something else, shows percent,
  transferred size, speed and time left, and gives each job **Play**, **Pause/Resume**,
  **Folder** and **Delete**. Deleting can take the file with it. Finished jobs raise a Windows
  notification. Unfinished jobs resume from their `.part` files, and a job that was running when
  G9 closed comes back paused instead of silently restarting.
- **Managed downloader** — Settings → Video downloads (or the prompt on the welcome card) installs
  `yt-dlp.exe` into the app data folder with one click; a copy on `PATH` is used if present, and
  a managed FFmpeg (0.3.0) is preferred for merging high-quality video and audio.
- **IPTV guide (XMLTV)** — the live sheet loads the guide a playlist points at (`url-tvg`) or one
  you paste, then shows **now / next** under every channel. Guides are gzipped in place, so a
  `.xml.gz` works, and the parsed guide is kept between launches. Now/next refreshes every minute
  while the list is open. Channels match on `tvg-id` and fall back to the display name, so
  playlists without ids still work.
- **Xtream Codes** — a portal URL, username and password import the same way an M3U does; G9
  builds the playlist from the portal, so groups, logos and channel numbers all come through.

### Changed

- The welcome screen is a launcher now: link box, downloads, and the note that G9 ships nothing.

### Fixed

- Settings gained a **Video downloads** row so the downloader is reachable while something plays.
- `--print` in the downloader would have implied `--simulate`; the job now downloads, reports
  progress against the real total, and cleans up its `.part` files on delete.

## [0.4.0] — 2026-10-25

Desktop-integration and layout pass.

### Added

- **Windows "Open with"** — the installer registers G9 as a Viewer for video (mp4, mkv, webm,
  m4v, mov, avi, ts, m2ts, mpg, mpeg, wmv, flv), audio (mp3, m4a, aac, flac, wav, ogg, opus,
  wma) and playlist (m3u, m3u8) files. G9 also reads the file it was launched with, so a
  double-click opens and plays it. `Show in folder` in Media info reveals the current file.
  *(Reinstall with this version's installer — associations come from the NSIS/MSI bundle, not
  the portable zip.)*
- **Split screen / snap** — snap left/right from the two new caption buttons (appear on hover),
  or `Ctrl+Alt+←/→` for halves and `Ctrl+Alt+↑` for full screen. Windows' own `Win+←/→` keeps
  working because the window is resizable.
- **Responsive layout** — breakpoints at 1180 / 1000 / 860 / 700 px and a short-window rule:
  the volume slider collapses to the mute button, secondary transport buttons fold away, panels
  and dialogs become full-width, the title overlay shrinks instead of clipping.
- Settings is now a **centred dialog** in the same family as Media info (Display / Engine /
  Playlists + Export / Import), not a sliding panel.

### Fixed

- **GIF export was corrupt.** The LZW stage bumped its code width one code too early, so every
  frame with more than a handful of colours produced a stream decoders reject. Rewritten to the
  compress/GIFCOMPR ordering; verified against Pillow (multi-frame, noisy content). Palette now
  uses 4×4 ordered dithering, and GIFs save through the same file dialog as frames/recordings
  instead of a browser download.
- **The alert dialog** now has an icon, separated actions, a default-choice highlight,
  Tab/Enter/Escape handling and a warning variant — it no longer looks like a browser popup.
  (Native `tauri.localhost says` boxes were gone as of 0.3.1; every prompt is in-app.)
- **No native browser chrome inside the app**: WebView2's media controls, context menu, scroll
  bars, text selection and drag ghosts are suppressed; the visualizer no longer draws under the
  transport bar.

### Removed

- Picture-in-picture button (and the code behind it) from Settings, as requested.

## [0.3.1] — 2026-10-25

Fixes for playback sound, captures, and the seek bar.

### Fixed

- **No sound on some files.** The equaliser chain built a Web Audio graph as soon as a file
  opened; a suspended context then muted the element permanently. The graph is now built only
  when you touch EQ / boost / visualizer, resumes on any gesture, and always reaches the speakers.
- **Autoplay refused by the engine** no longer fails silently: WebView2 starts with
  `--autoplay-policy=no-user-gesture-required`, a failure shows a one-tap **Press to play** gate,
  and a source whose audio codec the engine cannot decode says so instead of playing silently.
- **Screenshots now save files.** Save frame asks for a location (Pictures by default) and writes
  through the backend; if the canvas is protected, a local file falls back to FFmpeg.
- **Screen recording works.** MediaRecorder was recording the desktop through an API WebView2 does
  not implement. It now records the playback stream (picture + sound) or the webcam, and streams
  the WebM to disk in 512 KB chunks instead of one giant blob download.
- **Subtitle errors** are one short line — "No subtitles found" — and no longer list which services
  were tried, URLs, or API details. Provider names are logged only to the console.
- Toast messages are smaller and clamped to a single line.

### Changed

- **Removed the seek-bar preview**: no storyboard strip, no hover thumbnail, no second decoder.
  The bar is a plain scrub bar again.
- Volume is a pill with mute, slider, live percentage, wheel and keyboard support.
- Audio-only files open in **music mode** with a title, duration and level meter.
- Open-file dialog also accepts mp3, m4a, aac, flac, wav, ogg, opus, wma.

### Removed

- Region screen recording (needed desktop capture, which WebView2 does not expose).

## [0.3.0] — 2026-10-25

Closing part of the gap list without turning G9 into a second media core.

### Added

- **Managed FFmpeg** (`Settings → FFmpeg engine`): one click downloads a static Windows build of
  `ffmpeg` + `ffprobe` (~100 MB) into app data, with progress. Every tool — convert, extract,
  remux/repair, chapters, inspect, RTMP, embedded subtitles — prefers that copy and falls back to
  PATH. Nothing is bundled in the installer; **Remove** deletes it.
- **Extra player windows** (`Open in new window`): a second independent window with its own file,
  queue and state; close it like any window.
- **Transcript pane**: the loaded captions as scrollable text, highlight follows playback, click a
  line to seek. Works with searched, sidecar and generated captions.
- **WebGL shader effects**: Sharpen / Vivid / Mono / Night over the video frame, plus any `*.frag`
  dropped into `<app data>/shaders`.
- **PC shutdown timer**: the sleep timer can also schedule a Windows shutdown (`shutdown /s`), with
  `Cancel PC shutdown` in Settings.

### Changed

- `tools.rs` / `subs.rs` no longer hard-code `ffmpeg` / `ffprobe`: both go through `ffmpeg.rs`
- New capability window pattern `player-*` so extra windows may call the same commands
- Popup windows hide the menu bar and poster

### Docs

- `FEATURE-LIST.md`: four items moved out of the gap list; GLSL is now "partial" (WebGL effects,
  not Anime4K/FSRCNNX); managed FFmpeg and the shutdown timer are documented
- `docs/USER.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `README.md` updated for 0.3.0

### Still not in this release

On-device whisper models, libass karaoke, Chromecast/AirPlay **out**, Plex/Jellyfin/Emby clients,
cloud drives, watch sync, skins marketplace, disc menus, DVB tuners, NVDEC/QSV picker. See the gap
list in `FEATURE-LIST.md` — each has a reason, not a stub.

## [0.2.0] — 2026-10-25

The "webview can do more than you think" release. Playback is still WebView2 `<video>`;
nothing here pretends to be mpv.

### Added

**Playback**
- File playlist queue (View → Playlist); plays the next file when one ends
- Chapters from `ffprobe` (if on PATH) with jump-to-chapter
- Picture-in-picture, always-on-top
- Sleep timer, pause-after-N-minutes
- Keyboard frame step (`,` / `.`) and bookmarks (`M`)
- Touch gestures: horizontal seek, vertical volume
- Background audio while minimized

**Picture**
- Hover scrub preview and storyboard strip on the seek bar
- 360° look-around for equirectangular video (WebGL, drag)
- Export GIF (A–B range or ~2.4 s around now), save frame
- Region screen capture and webcam recording (MediaRecorder → WebM)
- Spectrum visualizer, scene poster (3×2 stills)

**Subtitles**
- TheSubDB and Podnapisi alongside OpenSubtitles; embedded track via `ffmpeg`
- Subtitle browser (click a line to seek) and pause-after-each-line
- Live translation of the current cue while playing

**Library / live**
- DLNA / UPnP MediaServer discover + browse
- Podcast RSS subscribe and episode play
- Live TV sheet, favourites, groups, search

**Tools (ffmpeg / ffprobe on PATH)**
- Convert / Save (MP4 / WebM / MP3), extract audio, remux / repair
- Inspect (ffprobe JSON in Diagnostics), RTMP broadcast

**Chrome**
- Cinema chrome: Media · Settings · TV Mode · About G9 (About lives inside Settings)
- Settings export / import (JSON)
- JSON IPC on `127.0.0.1:18765`
- Diagnostics with dropped-frame counter

### Changed

- Settings menu no longer scrolls; Playback was removed from the top bar
- Mute moved to the transport; play/pause fills blue
- Media info is a centred rectangle, not a vertical list
- "Load demo clips" removed — G9 ships no sample channel pack
- Version stamped in every package file, so installers are named `G9_0.2.0_*`

### Fixed

- Windows release build: `reqwest` was compiled without the `json` feature, so
  `Translate captions` (`tools.rs`) did not compile off Linux — every `v0.2.0` release run
  failed until the feature was enabled
- CI now compiles the app crate on **windows-latest**, so a Windows-only compile error fails
  CI instead of a release tag
- Installer filenames carry the real version (`G9_0.2.0_*`)

### Docs

- `FEATURE-LIST.md` now separates **shipped** from **requested but not implemented**
- Added `docs/USER.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/SECURITY.md`, `CHANGELOG.md`

### Not in this release

Bundled Whisper / Argos models, GLSL/Anime4K, RTX HDR/SR, OpenCodec, DVB, disc menus,
Chromecast/AirPlay **output**, cloud drives, watch sync, Plex/Jellyfin/Emby clients, skins,
multi-window, independent pitch shift. See the gap list in `FEATURE-LIST.md`.

## [0.1.2] — 2026-10-25

### Added
- Online subtitle search (OpenSubtitles: moviehash + title) with auto-apply of the best match
- Media info dialog
- Cinema chrome pass: menu bar, title overlay, circular transport, blue seek
- Settings consolidation and TV Mode
- About G9 dialog

### Fixed
- Installers are now named with the real version (`G9_0.1.2_*`, was `G9_0.1.0_*`)
- Mute/unmute moved next to the transport; Settings scrollbar hidden

## [0.1.1] — 2026-10-24

### Added
- First automated Windows release artifacts: NSIS setup, MSI, portable `G9.exe` zip

### Fixed
- Release workflow could not create a GitHub Release (`403`) until workflow permissions
  were set to *Read and write*

## [0.1.0] — 2026-10-24

### Added
- Tauri 2 shell, vanilla `ui/` (HTML/CSS/JS only)
- `g9-core` (version, policy, DTOs), `g9-iptv` (M3U parser, injection strip),
  `g9-store` (SQLite: sources, channels, history, settings)
- Local files, URL / HLS, M3U / IPTV import, Live TV sheet
- Diagnostics overlay, keyboard map

[0.7.0]: https://github.com/rreon633-design/G9/releases/tag/v0.7.0
[0.6.0]: https://github.com/rreon633-design/G9/releases/tag/v0.6.0
[0.5.0]: https://github.com/rreon633-design/G9/releases/tag/v0.5.0
[0.4.0]: https://github.com/rreon633-design/G9/releases/tag/v0.4.0
[0.3.1]: https://github.com/rreon633-design/G9/releases/tag/v0.3.1
[0.3.0]: https://github.com/rreon633-design/G9/releases/tag/v0.3.0
[0.2.0]: https://github.com/rreon633-design/G9/releases/tag/v0.2.0
[0.1.2]: https://github.com/rreon633-design/G9/releases/tag/v0.1.2
[0.1.1]: https://github.com/rreon633-design/G9/releases/tag/v0.1.1
[0.1.0]: https://github.com/rreon633-design/G9/releases/tag/v0.1.0
