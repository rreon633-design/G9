# G9 — Fun Mode: complete plan

> Movies, series, anime, manga/manhwa/manhua in one place, inside G9, next to the files and
> live TV it already plays.
> Status: **v0.8.0 shipped** (2026-10-25) — §8 phase 1 is done: the `g9-sources` crate,
> the Fun Mode wall/details/sources UI, search, browse, playback into the existing player and the
> MangaDex reader. **v0.10.0 shipped the library and discovery half** (My List, Watching, watched /
> following / hidden flags, merged search, filters, more-like-this, cast pages, autoplay-next, sleep
> timer, mini player, backup and the first-run wizard). Torrents move to v0.11.0 and the opt-in
> community scrapers to v0.13.0;
> §13's open questions are unchanged for those phases.

---

## 0. The one-page version

| | |
|---|---|
| **What** | A new full-screen **Fun Mode**: browse shelves of movies / series / anime, search, open a title, pick an episode and a source, play it with G9's existing player; plus a **reader** for manga / manhwa / manhua. |
| **How** | A provider layer in Rust (`g9-sources`) that turns any source into a uniform `Stream` (url + kind + headers + subtitles). Sources are **Stremio addons**, **RSS/Nyaa-compatible feeds**, **yt-dlp**, **MangaDex**, and — if you choose — **opt-in community scrapers** for AnimePahe / AnimeHeaven / TokyoInsider. |
| **Two pieces that make it actually work** | 1) a **local media proxy** in G9, because a WebView `<video>` cannot send `Referer`/`User-Agent`/cookies and most provider links need exactly that; 2) **embedded torrent streaming** (`librqbit`) for magnet results. |
| **Effort** | 6 releases, `v0.8.0 … v0.13.0`; roughly 1,200–1,600 lines of Rust and 1,800–2,400 lines of vanilla JS/CSS, spread over the phases in §8. |
| **Risk** | Site scrapers rot, Cloudflare blocks, and bundled piracy sources carry legal exposure. The plan isolates all of that behind one switch, so G9 stays shippable at every step. |

**Non-negotiables carried over from the existing app:** Tauri 2 + Rust backend, **vanilla HTML/CSS/JS
only**, dark cinema look, **no sidebars** (overlays and top bars), every visible control works, no PiP,
and `G9 ships no content`.

---

## 1. Policy first (because it decides the architecture)

G9's own rule since 0.1 is *“G9 ships no channels; users bring legal sources.”* Fun Mode can keep that
rule and still do everything you asked, if the **content sources are things the user adds**, not
things the installer ships. Concretely there are three tiers, and the plan supports all three:

| Tier | What it is | Ships with G9? | Legal exposure |
|---|---|---|---|
| **A. Protocols** | Stremio addon client, Nyaa-format RSS reader, `yt-dlp` resolver, MangaDex client | Yes, always | None — these are neutral clients, like a browser |
| **B. User sources** | Any addon URL, any RSS feed URL, any site you paste into the `yt-dlp` box | No — user pastes | None for G9 |
| **C. Bundled site scrapers** | AnimePahe/Kwik, AnimeHeaven, TokyoInsider, MovieBox | **Only behind an opt-in toggle** you can decline | Non-trivial — these sites host unlicensed content |

My recommendation, and what §8 schedules by default: **build A and B completely (that alone gives
you movies, series, anime and manga), and put C in its own crate, disabled, with a first-run notice.**
You flip it on in Settings if you want it; the build and the release stay clean either way. If you'd
rather ship C enabled, that is a one-line default change — but say so explicitly, because it changes
what G9 is.

Nothing in this plan bundles a catalogue, a credential, an indexer list, or a provider logo.

---

## 2. Architecture

```
┌──────────────────────────── ui/ (vanilla JS) ────────────────────────────┐
│  #fun   wall · shelves · details sheet · source picker · episode list     │
│  #reader  paged / vertical / spread manga reader                          │
└───────────────▲──────────────────────────────────▲───────────────────────┘
                │ invoke(...) events               │ <video src=http://127.0.0.1:…>
┌───────────────┴───────────────┐   ┌──────────────┴───────────────────────┐
│ src-tauri/commands_fun.rs     │   │ g9-net: local media proxy            │
│  fun_addons / fun_catalog /   │   │  token → (url, headers, expiry)      │
│  fun_details / fun_streams /  │   │  m3u8 rewriting · Range · no open    │
│  fun_progress / fun_search    │   │  proxy · SSRF guards                 │
└───────────────┬───────────────┘   └──────────────▲───────────────────────┘
                │                                  │ bytes
┌───────────────▼───────────────┐   ┌──────────────┴───────────────────────┐
│ g9-sources (new crate)        │   │ g9-torrent (librqbit)                │
│  trait Provider               │   │  magnet → session → /torrents/…/stream│
│  addons · rss · ytdlp · manga │   │  sequential · buffer stats · limits   │
│  community (feature-gated)    │   └──────────────────────────────────────┘
└───────────────┬───────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────────────┐
│ g9-store (SQLite): addons · cache · progress · recent   + existing tables│
└─────────────────────────────────────────────────────────────────────────┘
```

**Why a proxy is unavoidable.** In WebView2, media requests from `<video>` carry no custom headers,
so Kwik/AnimePahe-style links (`Referer` required) and CloudFront-signed links (cookie required)
return 403 no matter what Rust does. Fetching them in Rust and piping them through `127.0.0.1`
solves it once for every provider, and also gives byte accounting for the buffer bar, hides signed
URLs from the DOM, and makes torrent streaming and manga images uniform. G9 gained the ability to
send a header-gated stream the day this lands — including for the IPTV case you hit before.

---

## 3. The provider layer (`crates/g9-sources`)

One trait, four capabilities. Every source — addon, RSS, yt-dlp, MangaDex, community scraper —
implements the same shape, so the UI is written once.

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    fn id(&self) -> &str;                       // "stremio:torrentio", "rss:nyaa", "mangadex"
    fn caps(&self) -> Caps;                     // search · catalogs · details · streams · pages
    async fn catalogs(&self) -> Vec<Catalog>;   // shelves this provider offers
    async fn catalog(&self, c: &CatalogId, skip: u32) -> Result<Vec<Item>>;
    async fn search(&self, q: &str) -> Result<Vec<Item>>;
    async fn details(&self, id: &ItemId) -> Result<Details>;   // episodes or chapters
    async fn streams(&self, id: &ItemId, ep: Option<&EpisodeId>) -> Result<Vec<Stream>>;
    async fn pages(&self, id: &ItemId, ch: &ChapterId) -> Result<Vec<Page>>;  // manga
}
```

```rust
pub struct Stream {
    pub url: String,
    pub kind: StreamKind,          // Hls | Dash | Mp4 | Magnet
    pub label: String,             // "1080p · HEVC · 240 MB · 38 seeds"
    pub quality: Option<u16>,
    pub size: Option<u64>,
    pub headers: HeaderSet,        // Referer, User-Agent, Cookie  → straight into the proxy
    pub subtitles: Vec<Subtitle>,  // url or embedded track index
    pub provider: String,
}
```

Rules the layer enforces so the UI never has to:

- **Ordering**: best stream first (quality, then size, then seeds); the player auto-falls back down
  the list when one 403s or times out, and says which source it landed on.
- **Isolation**: one provider failing never blanks the wall; failures surface as a small
  “Source unavailable” chip on that row only (short, no URLs — same rule as subtitle errors).
- **Timeouts & retries**: 15 s connect, 30 s total, 2 retries with jitter; per-host minimum interval
  (500 ms addons, 2 s community sites) so nothing gets rate-limited or hammered.
- **No secrets in logs**; addon URLs may embed a config token, so they are redacted everywhere except
  the Settings field that owns them.

### 3.1 Sources, ranked by value per unit of work

| # | Source | Yields | Effort | Rot risk | Ship |
|---|---|---|---|---|---|
| 1 | **Stremio addon protocol** (`/manifest.json`, `/catalog`, `/meta`, `/stream`, `/subtitles`) | HTTP/HLS streams and magnets, from any addon the user installs | **S** | Low — public, stable protocol | A |
| 2 | **RSS / Nyaa-format feed** (user-supplied feed URL; works with `nyaa.si/?page=rss&q=…&c=1_2&f=0`) | magnets + seeders | **S** | Low (RSS is stable) | A |
| 3 | **yt-dlp resolver** — reuse the binary G9 already installs (0.5) | direct `http`/`hls` urls + the `http_headers` each format needs, read from `-J` | **S** | Medium (extractors change, but yt-dlp updates itself) | A |
| 4 | **MangaDex API** for manga / manhwa / manhua | chapter pages (images), covers, tags | **M** | Low (official API, honour rate limits) | A |
| 5 | **Local files** — CBZ/CBR folders, “read what I downloaded” | images | **S** | none | A |
| 6 | AnimePahe + Kwik unpacker | `.m3u8` behind `Referer` | **M–L** | High (Cloudflare + domain churn) | C, opt-in |
| 7 | TokyoInsider | direct mp4/mkv | **M** | Medium | C, opt-in |
| 8 | AnimeHeaven | mp4 / embeds | **M** | High (Cloudflare) | C, opt-in |
| 9 | MovieBox (signed CloudFront, `rmp-serde` payloads) | DASH/mp4 | **L** | Very high | Not planned; revisit only on demand |

Details that make 2 and 3 cheap:

- **yt-dlp `-J` already reports the headers**: every format carries `http_headers`; taking
  `Referer`/`User-Agent` from there and handing them to the proxy makes yt-dlp-resolved links play
  even on referer-gated CDNs. No new scraper needed for those sites.
- **Nyaa RSS** gives `<title>`, `<link>` (magnet), `<nyaa:seeders>`, `<nyaa:size>`, `<pubDate>` in one
  XML document; parsed with a 60-line scanner (same style as the XMLTV parser), no new dependency.
- **MovieBox-TUI / Senpwai / weeb-cli / HyperionBox** are good *behaviour references* for tier C.
  Their licences need checking before any code is copied (MovieBox-TUI is a TUI, Senpwai is
  Dart/Flutter, weeb-cli is Python) — the plan is to **re-implement the four flows in Rust** rather
  than port, because a 200-line reqwest + regex module per site is smaller than any wrapper.

### 3.2 The Kwik unpacker (tier C, the only genuinely fiddly part)

Kwik serves `eval(function(p,a,c,k,e,d){…}('…',62,NN,'…'.split('|'),0,{}))`. The plan: a small
**P.A.C.K.E.R. de-obfuscator** in Rust (~80 lines, deterministic, unit-tested against three captured
samples), then a regex for `source\s*=\s*['"](https?://[^'"]+\.m3u8[^'"]*)`. Resulting stream gets
`Referer: https://kwik.cx`, which the proxy applies. Fallback: if the payload shape changes, that
provider reports “unavailable” and everything else keeps working.

---

## 4. Local media proxy (`g9-net`)

| Concern | Decision |
|---|---|
| Binding | `127.0.0.1:0` (random port), only while a stream is open; dies with the app |
| Addressing | `http://127.0.0.1:PORT/m/{session}/{hex-encoded target}` — not an open proxy; targets only exist because a resolver put them there |
| Session | per-playback token, 20 min TTL, max 64 targets, dies on stop |
| Headers | injected per session (`Referer`, `User-Agent`, `Cookie`, `Origin`), never copied from the client |
| Methods | `GET`, `HEAD`; `Range` passthrough with `206` + `Content-Range` so seeking works |
| HLS | playlist text is fetched in Rust, every URI rewritten through the proxy: variants, segments, `#EXT-X-KEY:URI=`, `#EXT-X-MAP:URI=`, `#EXT-X-MEDIA:`; relative paths resolved against the playlist |
| Guards | http/https only; no loopback/private/link-local targets (SSRF); 8 MB header cap; 5 redirects max; 16 concurrent requests per session; 4 GB per session cap |
| Manga | same proxy with `Accept: image/*`, 24 h disk cache keyed by URL hash (cleared with the rest of Fun Mode’s cache) |
| Logging | one line per session open/close with host only — no paths, no query strings (they carry tokens) |

Tests: token rejection, range slicing, redirect with headers preserved, m3u8 rewrite of a master +
child playlist, `EXT-X-KEY` rewrite, SSRF refusal, concurrency cap. All offline, against a local
hyper server serving fixtures.

---

## 5. Torrent streaming (`g9-torrent`)

**Embed `librqbit`** (same engine as the `rqbit` CLI) rather than shipping a second binary: it exposes
an `HttpApi` with `/torrents/{id}/stream/{file}` that supports `Range` and blocks until pieces
arrive — exactly a local HTTP video source, which the proxy can wrap like any other.

Flow: magnet → `Session::add_torrent` with `only_files` picked from the file list (largest video +
subtitle files) → wait for metadata (DHT + trackers, 45 s budget) → open
`http://127.0.0.1:PORT/torrents/{id}/stream/{file}` → proxy → player.

| Behaviour | Choice |
|---|---|
| Start gate | show “Buffering 12% · 8 peers”, begin playback once ~16 MB ahead is available |
| Buffer bar | poll `stats/v1` every 1 s; a thin second bar under the seek bar shows availability |
| Seeking | native `Range` support in librqbit; if not buffered, spinner then resume |
| Embedded subtitles | `.mkv` text subs extracted with the managed FFmpeg to WebVTT on demand (PGS/VobSub cannot be rendered by WebView — the UI says so, honestly) |
| Disk | downloads to `Videos\G9\torrents`; “keep after watching” off by default; “delete when I close” on |
| Privacy | one-time dialog: *BitTorrent exposes your IP to peers*; DHT on, seeding stops at completion, upload cap default 100 KB/s |
| Safety | file names sanitised (no `..`, no absolute paths), executables never auto-opened, 4 GB/session guard |

Test without the network: create a torrent from a temp file, seed it from a second session on
`127.0.0.1`, stream it back, compare bytes.

---

## 6. Reader (manga / manhwa / manhua)

| Piece | Plan |
|---|---|
| Sources | MangaDex (official API, per-locale chapter list), local CBZ/CBR, and any addon that exposes `pages` |
| Modes | **vertical** (webtoon, continuous, default for manhwa), **paged** LTR (manga default is RTL → toggle), **double spread** for wide screens |
| Feel | fit-width / fit-height / free zoom (wheel, `+`/`-`, pinch), drag to pan, dark stage, page counter `12 / 180`, thin progress rule |
| Preload | 3 pages ahead, 1 behind; off-screen bitmaps dropped over 24 pages so a 200-page manhwa stays under ~300 MB |
| Navigation | `←/→` page, `Space` next, `,`/`.` chapter, `F` fullscreen, `Esc` back; same D-pad logic as the TV wall, so a remote works |
| Progress | stored per series (`fun_progress.page`), “Continue reading” shelf on the Fun Mode wall |
| Local CBZ | read with the existing `zip` crate (already a dependency); CBR needs unrar, so it is listed as “convert with FFmpeg” instead of silently failing |

---

## 7. Data model (SQLite migration v3)

```sql
CREATE TABLE fun_addons (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL,          -- stremio | rss | ytdlp | mangadex | community
  name TEXT NOT NULL, url TEXT,                        -- url may carry a config token: redacted in logs
  enabled INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0,
  manifest TEXT, checked_at TEXT
);
CREATE TABLE fun_cache (                               -- TTL cache, pruned on open
  key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE fun_progress (                            -- "continue watching / reading"
  provider TEXT NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL,
  episode_id TEXT, page INTEGER, position REAL, duration REAL,
  updated_at TEXT NOT NULL, PRIMARY KEY (provider, item_id)
);
CREATE TABLE fun_recent (
  id INTEGER PRIMARY KEY, provider TEXT, item_id TEXT, title TEXT, kind TEXT,
  poster TEXT, played_at TEXT NOT NULL
);
```

Cache TTLs: catalog 10 min, meta 1 h, streams 5 min, images 24 h; total disk cap 250 MB with LRU
eviction. No passwords, no cookies, no credentials are persisted.

---

## 8. Roadmap

Each release is independently shippable and leaves G9 working. CI gates are the same as today plus
new ones.

### v0.8.0 — Fun Mode shell + tier-A sources + proxy  ⟵ the big one
- `g9-sources` crate: `Provider` trait, **Stremio addon client**, **RSS/Nyaa provider**, **yt-dlp
  provider**, registry + `fun_*` commands.
- `g9-net` proxy v1 (plain http/HLS through it, headers, Range) .
- `g9-store` v3 tables.
- UI: `#fun` wall with mode tabs (**Movies · Series · Anime · Manga**), search, shelves from addons,
  details sheet, episode list, **source picker**, play through the proxy.
- Settings → **Fun Mode**: add/remove addons and RSS feeds, paste a URL to resolve with yt-dlp.
- **Acceptance:** add an addon, browse two catalogs, search, open a title, see episodes, pick a
  stream, watch it; a deliberately broken addon shows a chip and nothing else fails. Offline tests
  for manifest parsing, RSS parsing, yt-dlp `-J` mapping, m3u8 rewriting.

### v0.9.0 — Playback depth
- HLS master/variant rewriting, `EXT-X-KEY`, byte-range playlists.
- Source fallback + “Playing from …” toast; per-title quality memory.
- Subtitles from addons (`/subtitles`) merged with G9's existing online search.
- **Continue watching** row, resume inside an episode, autoplay next episode with a 10 s card.
- Download button in the details sheet → existing `dl_*` jobs (yt-dlp where possible, proxy stream as
  fallback).

### v0.10.0 — Library & discovery  ⟵ shipped 2026-10-25
- `fun_lib` (schema v4) behind My List / Following / Watched / Hidden, and a Watching tab that
  resumes the exact episode.
- Real progress (8 s tick, 90 % marks watched), merged search with recents/scope/typo tolerance,
  filters on See all, more-like-this, cast + person pages, right-click menu, keyboard nav.
- Autoplay next episode with a 10 s card and a *Still watching?* check; sleep timer; quality cap
  that actually picks the stream; mini player bar; settings hub; backup/restore JSON; `g9://`
  title links; first-run wizard.
- **Acceptance:** mark two titles, watch one past 90 %, close the app; on reopen My List and
  Watching are intact and the episode resumes. Search merges duplicate titles from two sources
  into one card with a source count.

### v0.11.0 — Torrents
- `g9-torrent` with librqbit embedded, buffer bar, file picker, peer stats, privacy dialog, caps.
- Magnet results from tier-A sources become playable, with the same UI as any other stream.
- MKV text-subtitle extraction through managed FFmpeg.
- **Acceptance:** local seed→stream test in CI; a magnet plays after the buffer gate; seeking inside
  the buffered window is instant.

### v0.12.0 — Reader
- `#reader` with vertical / paged / spread modes, zoom & pan, preload budgets, chapter navigation.
- MangaDex provider (search, tags, chapter list, pages, honouring their rate limits) + local CBZ.
- Reading progress, “Continue reading”, mark-as-read, per-series zoom memory.
- **Acceptance:** read a 3-chapter run end to end, restart the app and land on the same page; a
  200-page chapter never exceeds the bitmap budget.

### v0.13.0 — Community providers (opt-in, tier C)
- New crate `g9-sources-community`: AnimePahe (+ Kwik unpacker), TokyoInsider, AnimeHeaven.
- Gated by **Settings → Fun Mode → Community providers** (off by default, first-run notice, per-site
  toggles). Each provider has a **health check** row (“reachable / blocked / changed”) so a broken
  site is visible instead of mysterious.
- Per-host rate limits and a shared circuit breaker: 3 failures in 10 min disables that provider for
  the session.

### v0.14.0 — Discovery polish
- Cross-provider search results merged into one list with per-source badges.
- Genre / year / quality / language filters, sort, and “more like this” from tags.
- Addon health page, cache controls (“clear Fun Mode cache”), export/import of the Fun Mode config.
- Accessibility pass: focus rings, screen-reader labels, reduced-motion.

---

## 9. Testing & CI

| Layer | How |
|---|---|
| Parsers (RSS, manifest, yt-dlp JSON, MangaDex, community HTML, Kwik packer) | **Offline fixtures** committed under `crates/g9-sources/tests/fixtures/`; every parser has at least one “the site changed” fixture that must degrade, not panic |
| Proxy | Local hyper server; token/range/redirect/SSRF/m3u8 tests; no network |
| Torrent | Two local sessions (seed + stream) in one test; byte-exact comparison |
| Commands | `cargo test -p g9` with a temp app dir |
| UI | New `domtest/smoke6.js`: wall → shelf → details → episodes → source picker → play (stubbed `invoke`), plus `smoke7.js` for the reader; both assert no exceptions |
| Visual | Headless-Chromium screenshots of Fun Mode wall, details sheet, reader (the technique used for TV mode in 0.6/0.7) |
| Release | unchanged: `v0.8.0` … tags → Windows-only workflow |

---

## 10. Budgets and limits (so “huge” stays fast)

- 60 items per shelf page, loaded on scroll; 8 shelves max in flight.
- Provider call budget per screen: 6 calls, 2.5 s each; late results paint in, never block.
- Fun Mode memory ceiling ~250 MB (covers bitmaps included), disk cache 250 MB LRU.
- Torrent: 16 MB buffer gate, 100 KB/s upload cap, 4 GB per session.
- Proxy: 16 parallel requests, 4 GB per session.
- Every limit is visible in Settings → Fun Mode (one line each), so it is never a mystery.

---

## 11. Failure modes, and what the user sees

| Case | Behaviour |
|---|---|
| Addon down / 500 | Row shows “Source unavailable”; wall keeps everything else |
| No streams for a title | Sheet says “No sources for this episode” with a **Try again** that re-resolves |
| Stream 403 / dies mid-play | Auto-advance to the next source, toast: “Playing from Backup · 720p” |
| Cloudflare block (tier C) | Provider chip shows “blocked”; Settings suggests pasting the page into the yt-dlp box instead |
| No peers after 45 s | Torrent card becomes an error card with **Retry**; nothing else breaks |
| Guide/EPG irrelevant | Fun Mode doesn't touch it; TV Mode unaffected |
| User has no addons | Empty state explains the three ways to add a source, with a copy-paste example addon URL |

---

## 12. Risks

| Risk | Weight | Mitigation |
|---|---|---|
| **Tier-C scrapers rot** | High | Opt-in, isolated crate, health chips, circuit breaker, small modules (~200–400 lines each) so fixing one site is an afternoon |
| **Cloudflare / JS challenges** | High for AnimeHeaven | Not solvable without TLS-impersonation (`rquest`) or a headless browser — G9 has neither and I would not add one silently. Plan: use yt-dlp's extractors first, and say plainly when a site is blocked |
| **Legal exposure of bundled scrapers** | Medium–High | Tier C off by default; no bundled catalogues or credentials; policy text kept in UI and docs |
| **Proxy turned into an open relay** | Medium | Session tokens, target allow-list, SSRF guards, loopback-only binding, TTL |
| **Torrent privacy / malware** | Medium | One-time warning, no auto-open of executables, filename saniting, upload cap, delete-on-close default |
| **Disk blow-up** | Low | Caps everywhere, LRU cache, torrent cleanup |
| **Build weight** (librqbit + sources) | Low–Medium | Feature flags: `fun-torrent`, `fun-community`; measured before merge (current installer is 3.5 MB; expect ~+1.5–2 MB) |

---

## 13. What I need from you before writing code

1. **Tier C policy** — ship the AnimePahe / AnimeHeaven / TokyoInsider scrapers (a) never, (b) opt-in
   behind a Settings toggle *(my recommendation)*, or (c) enabled by default?
2. **Torrents** — in from the start (v0.10 as planned), or leave them out and keep Fun Mode to
   HTTP/HLS + reader?
3. **Manga sources** — MangaDex + local CBZ only, or also a manga section fed by addons you install?
4. **First release scope** — I'd rather ship `v0.8.0` as *wall + details + play + addon manager* than
   a half-built everything. Agree, or do you want the reader in the first drop?

Once those are answered, v0.8.0 starts with `crates/g9-sources` (trait + Stremio client + RSS + yt-dlp)
and `g9-net` (proxy), and the wall comes after those compile and test.

---

## 14. Non-goals

- No bundled catalogues, playlists, credentials, indexers, or provider logos.
- No headless browser / Chromium in the app (breaks the “small, no Chromium” promise).
- No TypeScript, bundler or frontend npm packages — the UI stays vanilla, as it has been.
- No casting, no cloud sync, no accounts (unchanged from earlier deferrals).
- No re-encoding of provider streams; what the source serves is what plays.
