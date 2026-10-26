# G9 UI and appearance

How the interface is built, and what the personalisation controls actually change.
Written against the code as it stands in **v0.14.0**.

## The rules

1. **Vanilla only.** HTML, CSS and plain JavaScript. No framework, no build step, no
   front-end dependency. `ui/theme.js` is one file the browser runs as it is.
2. **Overlays, never sidebars.** The picture is the page; chrome floats over it and fades
   out when the mouse stops.
3. **Tokens, not colours.** A component may only use `var(--…)`. The one exception is the
   scrim behind the title bar and the transport, which is dark in every theme because it
   sits on top of the film and its job is to make white glyphs readable.
4. **Nothing is drawn that is not needed.** With every picture control at its default the
   pipeline draws no frame at all; with every widget switched off the strip disappears.

## The token set

All of `ui/styles.css` is built from these. They live in `:root`, and
`[data-theme="light"]` overrides the values, never the layout.

| Group | Tokens | What they do |
|---|---|---|
| Surface | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--bg-rgb`, `--surface-rgb` | Page, panels, insets. The `-rgb` triplets exist so a wash can be written `rgba(var(--surface-rgb), 0.7)` and follow the theme |
| Ink | `--ink`, `--ink-soft`, `--muted`, `--muted-2`, `--ink-rgb` | Text in four weights. `--ink-rgb` is the tint borders are drawn with: white in dark, near-black in light |
| Accent | `--accent`, `--accent-rgb`, `--accent-soft`, `--accent-ink` | The user's colour, its wash, and the ink that reads on top of it (computed from luminance, so amber accents get dark glyphs) |
| Line | `--line`, `--line-strong` | Hairlines and dividers |
| Status | `--ok`, `--warn`, `--danger` | Health dots, errors |
| Type | `--font`, `--mono`, `--scale` | The interface font (subtitles keep their own), and the overlay text size |
| Shape | `--radius`, `--radius-sm`, `--radius-lg`, `--radius-pill`, `--pad`, `--gap` | Corners, padding, spacing |
| Depth | `--shadow-1`, `--shadow-2`, `--blur`, `--ring` | Panels, dialogs, glass, focus ring |

Personalisation writes attributes on `<html>`: `data-theme` (`dark` | `light`),
`data-font`, `data-density`, `data-icons`, `data-motion`, `data-glass`. Each has exactly one
small rule in `styles.css`; the slider values (`--accent-rgb`, `--radius`, `--scale`) are set
as inline custom properties by `ui/theme.js`.

## Appearance engine

`ui/theme.js` runs in `<head>`, before the body parses, so the first paint is already in the
saved theme — a light theme never flashes dark. It then finishes on `DOMContentLoaded` when
the nodes exist.

```
G9Theme.get()                 → the current settings, a copy
G9Theme.set(patch, {paint})   → merge, persist, repaint
G9Theme.reset()               → back to the defaults
G9Theme.apply() / applyVars() → repaint (DOM / documentElement only)
G9Theme.open() / close()      → the Appearance sheet
G9Theme.settingsGroup()       → the block Settings renders, bindSettings(root) wires it
G9Theme.resolvedTheme()       → what "Auto" resolves to right now
```

Settings live under `g9-appearance` in `localStorage`; the notification history under
`g9-notifications`. Both are per-machine and never leave it — there is no account and no
upload. Unknown or malformed values fall back to the default rather than breaking the look:
an accent that is not a colour becomes the G9 blue, a scale outside 0.85–1.25 is clamped.

## Themes

| Theme | What it is |
|---|---|
| **Dark** | The cinema default. `#07080b` page, `#0e1016` panels, white hairlines at 8% |
| **Light** | Daytime. `#e8ecf4` page, white panels, near-black hairlines. The title bar goes white; the info card and buttons draw their own surface instead of borrowing the page colour |
| **Auto** | Follows the Windows app theme, live: `matchMedia("(prefers-color-scheme: light)")` with a change listener, no restart |

Chrome over the picture — the transport, the toast strip, the OSD — stays dark in both
themes. A white bar across a dark film is a glare panel, and white glyphs are what the eye
expects on video.

## Personalisation

| Control | Range | Effect |
|---|---|---|
| Accent | 8 presets + any colour | Buttons, seek bar, focus ring, notification dot, the logo tile, the play button |
| Name | text | Profile chip, avatar initials, Fun Mode's avatar |
| Avatar | image up to 900 KB, stored as a data URI | Same places; "Clear" returns to initials |
| Corners | 0–20 px | `--radius`, with `-sm` and `-lg` derived from it |
| Density | Compact / Cozy / Roomy | `--pad` and `--gap` in menus and sheets |
| Text size | 90–115 % | `zoom` on overlays only — never the picture, so the video is untouched |
| Font | Geist / Segoe UI / Georgia / JetBrains Mono | `--font`; subtitles keep their own face |
| Animation | on/off | No transitions or animations at all (also honoured automatically under `prefers-reduced-motion`) |
| Translucency | on/off | `backdrop-filter` on menus, panels, widgets |
| Icon weight | Light / Regular / Bold | `stroke-width` of every icon at once |
| Widgets | clock, continue-watching, library | The three cards under the start screen |

## Start-screen widgets

They exist to make an empty player useful rather than blank: **Now** (local time and date),
**Continue watching** (what the player is on, with a progress bar, from `G9Bridge.nowPlaying()`),
and **Library** (titles played and channels, from `G9Bridge.stats()`). Each can be switched
off; with all three off the strip removes itself.

## Notifications

Every toast the player already raises is mirrored into a notification centre, so something
that was on screen for three seconds can be read again:

- **Categories** — error, download, playback, info, each with its own icon colour.
- **Filters** — toasts, the centre itself, downloads, playback and errors can be switched
  independently. A switched-off category is not stored at all, not stored and hidden.
- **Badge** — unread count on the bell, `9+` past nine; opening the centre marks what is in
  it read after a moment, so a glance does not erase it accidentally.
- **History** — 60 entries, newest first, with a relative timestamp.

```
G9Notify.push({title, body, cat})   → record one
G9Notify.capture(text)              → what toast() calls; false when toasts are off
G9Notify.list() / unread() / readAll() / clear() / paint()
```

## Where the controls live

- **Avatar (top bar)** → a card with the current person, a Dark/Light/Auto switch, and links
  to Appearance, Notifications and Settings.
- **Bell (top bar)** → the notification centre.
- **Settings → Appearance** → the whole sheet; the same sheet opens from the avatar card.
- **Settings → Notifications** → the centre, plus the summary of what is saved.

## Checking it

- `node domtest/smoke11.js` — themes, accent maths, every personalisation hook, profile,
  notification gating, widgets, both entry points, reset, auto resolution. Works on any
  platform because it stubs WebGL and the Tauri bridge.
- `preview/shoot_theme.py` — real Chromium screenshots of both themes, the sheet, the
  centre, the profile card, Fun Mode and TV Mode. Run with the static server on :8123.

## The one sidebar: the social workspace

Social is the exception, and only social. A conversation list is not chrome over a picture — it
is the page. So `#social` is its own surface (`Ctrl+Shift+S`) with a persistent 264 px rail:
rooms, people in the room right now, saved contacts, unread counts, a filter box, and your
identity at the foot. Everything else in G9 is unchanged: the player still has no sidebar, and
the rail never appears over video.

The call overlay inside it is a *cinema* surface: `#0a0c11` in every theme, because a call is
picture, and light chrome around a dark picture is how a video call starts to look cheap.

### The call surface, and what it shows

The call overlay is its own dark surface in every theme (`#0a0c11`), with a head that never lies
about itself: **the call type and room**, the **clock**, the **live round trip to the hub**
(measured from the hub's echo every 2.5 s), and the **sending tier** for this room size. Each
peer tile carries its own chip on hover — peer RTT, received resolution, bitrate, and a `weak`
mark past 250 ms or 60 ms of jitter. The loudest inbound audio level outlines that tile.

The bottom bar is three controls and one statement: **Mute**, **Camera**, **Leave**, and
`encrypted · mesh` — the last one being the honest description of how the call is carried.
