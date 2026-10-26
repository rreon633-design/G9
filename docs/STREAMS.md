# Public stream indexes, and checking which links still play

G9 ships **no channels**. The import sheet offers links to open, community-maintained indexes
([iptv-org](https://github.com/iptv-org/iptv)) — you click one, press **Import**, and G9 reads the
`.m3u` you chose. Nothing is bundled, nothing is scraped, no credentials are included, and whether
a stream is legal for you to watch is your call, not the player's.

This page records **what those indexes actually contain** and how to find out which of their links
still work, because public streams die constantly and a dead playlist looks exactly like a
working one until you press play.

---

## 1. The site playlists are a filtered subset of the source lists

| What | Where | Size (2026-10-26) |
|---|---|---|
| The shortcut the app offers | `https://iptv-org.github.io/iptv/countries/in.m3u` | a curated subset |
| The raw source list behind it | `https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u` | **1,301 streams / 794 channels** |

That is the whole reason "the channel is in iptv-org but not in the app's India preset" happens:
the published playlist is filtered, and the source file is not. If a channel matters to you,
import the **raw source file** as its own playlist and let G9's live sheet sort it — or run the
checker below and import only what answers.

## 2. `scripts/g9_check.py`

Standard-library Python 3.8+, no dependencies. It reads any number of M3U files or URLs, follows a
master playlist to its first variant, **downloads a media segment**, and only then calls a stream
working. That is stricter than a ping, which is the point: a 200 on a manifest means nothing if the
segments are 404 or the token expired.

```bash
# every Telugu-related stream in the raw India list, and what you do not have yet
python scripts/g9_check.py \
    --playlist https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u \
    --telugu --mine my_playlist.m3u

# the whole India list, 40 at a time
python scripts/g9_check.py \
    --playlist https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u --workers 40
```

Outputs land in `g9_out/`:

| File | What it is |
|---|---|
| `working.m3u` | only streams that passed — import this one into G9 |
| `new_to_add.m3u` | working channels not already in `--mine` (matched by `tvg-id`, then by name) |
| `failed.csv` | every failure with the reason (`404 gone`, `403 blocked/geo/expired token`, `not an HLS playlist`, `no segments`, `TimeoutError`) and a `suspect_host` flag |
| `report.txt` | the summary counts |

Run it **on the machine and network you will watch on**: most Indian streams are geo-restricted, so
a list tested from a datacenter in Europe tells you about Europe. Run it again every week or two —
this is a snapshot, not a guarantee.

## 3. What the 2026-10-26 run found

Filter `--telugu` over the raw India list: **166 streams, 139 working, 27 failed, 83 distinct
channels alive, 16 channels with no working stream at all** (22 s wall clock). Tested from a
non-Indian IP, so treat geo-blocked results as "unknown", not "dead".

**Working, and the interesting part — which host they come from** (58 distinct hosts alive):

| Hosts | Working streams | Reading |
|---|---|---|
| `mumbai-edge.smartplaytv.in` | 21 | reseller edge server — probably unofficial |
| `*.tangotv.in` (`mumt03-07`, `streams`) | 23 | reseller — probably unofficial |
| `cdn.pishow.tv` | 11 | reseller — probably unofficial |
| `yupp*.akamaized.net` (`hdnts=` tokens) | 14 | token links issued Jan 2025; `exp` is 2028 but two of them already answer with binary junk instead of HLS |
| `*.cloudfront.net` (Amagi, ETV) | 12 | ETV Comedy / Josh / Beats / Music / News and similar — the most plausible "own CDN" group |
| `nic.in`, `mslivestream` and the rest | the remainder | public broadcasters, most likely legitimate |

Reselling by the first three rows is an **inference from hostnames**, not a fact: whoever runs them
may or may not have the rights. Availability is the practical argument against relying on them —
they were also where the 404s clustered.

Channels alive in this run included **TV9 Telugu, NTV, TV5, V6, 10 TV, Sakshi, HMTV, ABN Andhra
Jyoti, T News, Prime9, Mahaa News, Mojo TV, Raj News Telugu, Raj Musix Telugu, Zee Telugu HD, Zee
Telugu News, Star Maa HD, Star Maa Movies HD, Star Sports 2 Telugu HD, ETV Comedy / Josh / Beats /
Music / News, SVBC 1–4, Bhakthi TV, Telugu One, Vanitha TV, PMC Telugu, WOW Kidz** and more.

**Dead in this run — every advertised stream failed:**

| Channel | Why |
|---|---|
| ETV Andhra Pradesh, ETV Telangana, ETV Cinema (HD), ETV Plus (HD), ETV Telugu HD, ETV Life, ETV Bal Bharat | `*.cloudfront.net` hostnames no longer resolve (NXDOMAIN — not a geo-block) *and* the `smartplaytv` mirrors return 404 |
| Sun Gemini | all entries failed |
| Dharsan TV | `403` on an Akamai edge |
| Bhakthi Siri, Win TV, Prarthana Bhawan TV, Sun TV HD | timeouts / gone |

So the "the ETV cloudfront links are the channel's own CDN, trust them more" guess does **not** hold
for the channels people actually want: those hostnames are retired. It is the ETV *Amagi* feeds
(Comedy, Josh, Beats, Music, News) that answer, not the main ETV AP / Telangana feeds.

**Not in the file at all** (confirmed by name search, so a variant could still have slipped past):
**DD Saptagiri, DD Yadagiri, Studio N, Bharat Today, Zee Cinemalu, Kushi TV.** If you want them,
they have to come from another source list — and for **Kushi TV** the answer is probably not:
it is Telugu on Measat 3d (4080 V, MPEG-4 SD) and carried **Irdeto**-encrypted, so a free public
stream of it is not something to expect. G9 will play it if you have a legitimate source; it will
not pretend one exists.

## 4. Merging several sources into one playlist

Two ways, both fine:

1. **Import each source separately.** G9 keeps a playlist per source, and the live sheet groups and
   filters across all of them. Simplest, and a dead source is easy to delete.
2. **Merge into one master file.** Concatenate the `#EXTINF` blocks (dedupe by URL), keep a single
   leading `#EXTM3U`, then import that one file:

   ```bash
   python scripts/g9_check.py --playlist A.m3u --playlist B.m3u --out g9_merged
   # g9_merged/working.m3u is already merged, deduped and only what answered
   ```

The checker's `working.m3u` **is** the merged playlist: it de-duplicates by URL and drops anything
that did not answer, so the file you import is the file that played.

> Availability, carriage and legality are the source owner's, not G9's. If a link stops working,
> nothing is broken in the player — the stream behind it stopped.
