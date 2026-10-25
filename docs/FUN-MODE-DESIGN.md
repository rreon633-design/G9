# Fun Mode — UI design spec (v0.8.0 target)

> Reference build: `design/fun-mode.html` (single file, vanilla HTML/CSS/JS, no network, no images).
> Screenshots: `preview/fun/01-hero.png` … `10-profile.png`, plus `size-small.png` / `size-wide.png`.
> This is the **look and behaviour** the Rust work in §3 of `FUN-MODE-PLAN.md` plugs into.

---

## 1. Design language

Cinema-dark, Netflix as the *grammar* rather than the skin — the palette, glow and typography stay G9's
blue-on-near-black, not Netflix red.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#07080b` | page |
| `--panel` / `--panel-2` | `#0e1016` / `#141824` | cards, rails |
| `--txt` / `--mut` / `--mut-2` | `#eef1f7` / `#98a1b2` / `#6d7686` | text tiers |
| `--acc` / `--acc-2` | `#4c9dff` / `#8b5cf6` | active tab, progress, play button, wordmark |
| `--ok` / `--warn` | `#3ddc97` / `#ffb454` | score, healthy source / degraded source |
| Radii | 8 / 10 / 14 px | card · control · dialog |
| Motion | 120–240 ms, `cubic-bezier(.2,.7,.3,1)` | hover lift, dialog rise, rail scroll |

Type: Segoe UI Variable (already the app's system stack), 800 weight for titles, −0.5 to −2 px tracking on
display sizes, 9.5–11 px + 1.2 px tracking for all-caps labels. No webfonts.

Artwork rule: **G9 ships no images.** Cards draw their poster from the provider's image URL when it exists;
until then they render a deterministic gradient + initials plate derived from the title (what the mock shows).

---

## 2. Structure

```
#nav        logo · FUN chip · Home/Movies/Series/Anime/Drama/Manga · search · Sources · profile
#hero       full-bleed featured title + floating poster card + dots (auto-rotates 11 s, pauses on dialog)
#rows       Continue watching · Top 10 (ranked) · Movies · Web series · Anime · Drama & serials
            · Manga/Manhwa/Manhua (portrait) · New episodes this week
#browse-view “See all” → grid + sort (best quality / newest / top rated)
#search-view live search overlay: title, genre, "manhwa", "anime"
dialogs     details · sources · playback prefs (all centered rectangles, Esc closes top-most)
#toast      one line, 2.6 s, never an error dump
```

Every row is a horizontal rail: 300×169 cards (16:9) for video, 322×181 for episode cards with a still,
172×258 (2:3) for manga. Rails hide their scrollbar, show arrow buttons only on hover, and snap by 85 % of
viewport width.

---

## 3. Components

| Component | Detail |
|---|---|
| **Card** | hover: `scale(1.045)` + ring + shadow, art `scale(1.07)`, circular play button fades in. Top-left state badge (`NEW`, `NEW SEASON`, `TOP 10`, `S2 E6`), top-right quality (`4K`, `1080p`, `720p`, `MANHWA`). Bottom scrim carries title + `year · runtime ★score`. |
| **Progress card** | 3 px blue bar across the card bottom + "41m left" / "S2 E9" note — Continue watching and New episodes. |
| **Ranked card** | 124 px outlined numeral behind the card, blue for 1–3, grey for 4–10; the badge that would repeat "TOP 10" is suppressed. |
| **Manga card** | portrait, `214 ch · Manhwa ★9.1` + genre chip; progress bar for the series being read. |
| **Hero** | gradient stage, oversized ghost initials, floating 2:3 poster (rotates through 4 featured titles), `★ score · year · runtime · 16+ · genres`, two-line synopsis, **Play / Read** (white, primary) + **More info** (glass). |
| **Details dialog** | 940 px wide, art header fading into the body; title, score line, Play/Read + List/Download/Rate circle buttons; synopsis + cast; **SOURCES** chips with health dots (`Addon · 4K HDR`, `Addon · 1080p`, `Magnet · 38 seeds` / `MangaDex · official API`, `Local · CBZ folder`); then either the episode list, the chapter list, or (movies) a 3-column info grid: director, writers, audio tracks, subtitles, file, runtime; then **More like this**. |
| **Episode row** | number · 104×59 still · title · `S2 E1 · Aired 12 Oct` · `78% watched` · duration. Click plays that episode and closes the sheet. |
| **Sources dialog** | six rows with switches: Stremio addons, RSS/Nyaa feeds, yt-dlp resolver, MangaDex, Local library, **Community providers (off)**. Add-by-URL field + honest footnote. This is the UI for the tier-A/B/C policy in the plan. |
| **Playback prefs** (profile button) | preferred quality · subtitles · autoplay next · fallback to next source. Persisted in `localStorage` in the mock; `fun_settings` row in the app. |

---

## 4. Behaviour / states

- **Search** — type ≥1 char; overlay counts results (`5 results for manhwa`); genres and "manhwa/manhua/anime"
  are searchable; empty state suggests adding a source. `/` focuses the field, Esc clears.
- **Tabs** — filter the wall to a single row family and toast the change; Home restores all rows.
- **Esc stack** — dialog → browse view → search → nothing. Same one-level-back rule as TV Mode.
- **Every control does something** (or is absent): Play, More info, See all, sorts, add-source, toggles, rate,
  list, download, episode rows, hero dots, profile segments. Verified by the screenshot harness (no console
  errors, no dead handlers).
- **Failure states** (to be wired in v0.8): a provider that fails shows a chip with a warn dot on that row
  only; a title with no streams keeps its sheet but replaces Play with *No sources for this episode · Try again*.
  Errors stay one short line, never a URL.
- **Keyboard / remote** — arrow keys move within a rail, ↑/↓ between rails, Enter opens the card, Esc backs out.
  (Mock covers the visual states; the nav logic lands with `ui/fun.js` like `tvOnKey` did.)
- **Reduced motion** — `prefers-reduced-motion` disables the poster float; hover transforms stay (cheap).

---

## 5. How it lands in the app

No new dependencies, no build step — the same three files the app already ships, plus one module:

```
ui/index.html   + <section id="fun"> skeleton + <script src="./fun.js">
ui/styles.css   + §FUN block (tokens already exist; ~230 lines)
ui/fun.js       the wall, rails, dialogs, reader entry, wired to invoke():
                fun_catalog · fun_search · fun_details · fun_streams · fun_addons · fun_progress
ui/reader.js    v0.11 — paged / vertical / spread reader
```

DOM ids reserved for tests (same convention as TV Mode's `#tv-*`):

`#fun` `#fun-nav` `#fun-tabs` `#fun-q` `#fun-sources` `#fun-hero` `#fun-rows` `#fun-row-*`
`#fun-browse` `#fun-browse-grid` `#fun-search` `#fun-search-grid` `#fun-sheet`
`#fun-ep-*` `#fun-src-*` `#fun-toast` `#reader` `#reader-page` `#reader-progress`

Smoke test plan: `domtest/smoke6.js` drives wall → rail → sheet → episode → play with a stubbed `invoke`,
asserts 0 exceptions, and checks that **every** `[data-act]` in Fun Mode has a handler — the rule that kept
TV Mode honest.

---

## 6. What the mock does *not* decide

Still gated on your answers from the plan (§13): whether the **Community providers** row ships enabled,
whether **torrents** appear as a source chip in v0.8 or v0.10, and whether the first drop includes the
**reader**. The mock shows all four categories because the layout needs to hold them — the switches and
chips are already the right place to hide what isn't built.
