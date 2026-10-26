#!/usr/bin/env python3
"""
g9_check.py - test every stream in an M3U playlist and sort them into
working / dead, then (optionally) show which working channels are NOT yet
in your own playlist.

Needs only Python 3.8+ (standard library). Run it on YOUR machine/network
(Indian ISP), because many Indian streams are geo-restricted.

Examples
  # 1. Test the whole iptv-org India source list
  python g9_check.py --playlist https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u

  # 2. Telugu-only, and show what is missing from your own playlist
  python g9_check.py --playlist https://raw.githubusercontent.com/iptv-org/iptv/master/streams/in.m3u \
                     --telugu --mine my_g9_playlist.m3u

  # 3. Test several playlists at once
  python g9_check.py --playlist A.m3u --playlist B.m3u --workers 40

Outputs (in ./g9_out by default)
  working.m3u      only streams that passed (import this into G9)
  new_to_add.m3u   working channels that are not in --mine (if given)
  failed.csv       every failure with the reason
  report.txt       summary
"""
import argparse, csv, os, re, sys, time, urllib.request, urllib.error, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"

# Name / id keywords used by --telugu (matched case-insensitively)
TELUGU_KW = [
    "telugu", "tv9 telugu", "ntv", "etv", "sakshi", "tv5 news", "tv5news", "star maa", "maa ",
    "gemini", "zee cinemalu", "10tv", "10 tv", "v6", "t news", "tnews", "hmtv", "mahaa", "99tv",
    "6tv", "6 tv", "prime9", "studio n", "raj news telugu", "inews", "i news", "abn", "svbc",
    "bhakthi", "bhakti", "dd saptagiri", "dd yadagiri", "big tv", "teluguone", "telugu one",
    "pmc telugu", "aastha telugu", "vanitha", "mojo", "chhaya chitram", "star sports 2 telugu",
    "wow kidz", "raj musix telugu", "zee telugu", "andhra", "telangana",
]

# Hosts that usually mean an unofficial re-stream of a paid channel, or a
# short-lived token link. They are flagged, not removed - your call.
SUSPECT_HOSTS = ("smartplaytv.in", "tangotv.in", "pishow.tv", "yuppcdn", "yuppmedtaorire",
                 "yuppnimresmum", "yuppparoriglin", "yuppnimrestreammum", "vgcdn.net",
                 "nellaiiptv", "jmp2.uk", "amazeyourself")


def read_text(src):
    if re.match(r"^https?://", src):
        req = urllib.request.Request(src, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    with open(src, encoding="utf-8", errors="replace") as f:
        return f.read()


def parse_m3u(text):
    out, cur = [], None
    for raw in text.replace("\r", "").split("\n"):
        line = raw.strip()
        if line.startswith("#EXTINF"):
            tid = re.search(r'tvg-id="([^"]*)"', line)
            grp = re.search(r'group-title="([^"]*)"', line)
            logo = re.search(r'tvg-logo="([^"]*)"', line)
            name = line.split(",", 1)[1].strip() if "," in line else ""
            cur = {"id": tid.group(1) if tid else "", "name": name,
                   "group": grp.group(1) if grp else "", "logo": logo.group(1) if logo else "",
                   "opts": [], "headers": {}}
        elif line.startswith("#EXTVLCOPT") and cur is not None:
            cur["opts"].append(line)
            m = re.match(r"#EXTVLCOPT:http-(referrer|referer)=(.*)", line, re.I)
            if m: cur["headers"]["Referer"] = m.group(2)
            m = re.match(r"#EXTVLCOPT:http-user-agent=(.*)", line, re.I)
            if m: cur["headers"]["User-Agent"] = m.group(1)
        elif line and not line.startswith("#") and cur is not None:
            cur["url"] = line
            out.append(cur)
            cur = None
    return out


def norm(s):
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\(.*?\)|\[.*?\]", "", s.lower()))


def fetch(url, headers, timeout, nbytes=65536):
    h = {"User-Agent": UA, "Accept": "*/*"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read(nbytes), r.geturl()


def printable(url):
    """True when a URL is plain ASCII with no control characters."""
    return all(32 <= ord(c) < 127 for c in url)


def probe(entry, timeout):
    """Return (status, reason). status in OK / FAIL."""
    url, hdr = entry["url"], entry["headers"]
    try:
        code, body, final = fetch(url, hdr, timeout)
        txt = body.decode("utf-8", "replace")
        # some token-protected hosts answer 200 with binary junk; do not try to
        # parse that as a playlist - a control character in a URL is not a stream
        if b"#EXTM3U" not in body[:2048]:
            # could be a raw .ts / .m3u8-less stream: accept if bytes flow
            if body and entry["url"].lower().split("?")[0].endswith((".ts", ".mp4", ".flv")):
                return "OK", "raw stream"
            return "FAIL", "not an HLS playlist"
        # master playlist -> follow first variant
        if "#EXT-X-STREAM-INF" in txt:
            lines = [l.strip() for l in txt.split("\n")]
            for i, l in enumerate(lines):
                if l.startswith("#EXT-X-STREAM-INF"):
                    for nxt in lines[i + 1:]:
                        if nxt and not nxt.startswith("#") and printable(nxt):
                            url = urllib.parse.urljoin(final, nxt)
                            break
                    break
            code, body, final = fetch(url, hdr, timeout)
            txt = body.decode("utf-8", "replace")
        # media playlist -> must contain a segment and it must download
        segs = [l.strip() for l in txt.split("\n")
                if l.strip() and not l.startswith("#") and printable(l.strip())]
        if not segs:
            return "FAIL", "playlist has no segments (offline?)"
        seg = urllib.parse.urljoin(final, segs[-1])
        c2, b2, _ = fetch(seg, hdr, timeout, nbytes=4096)
        if not b2:
            return "FAIL", "segment empty"
        return "OK", "plays"
    except urllib.error.HTTPError as e:
        reason = {401: "401 auth/expired token", 403: "403 blocked/geo/expired token",
                  404: "404 gone", 451: "451 geo-blocked"}.get(e.code, f"HTTP {e.code}")
        return "FAIL", reason
    except urllib.error.URLError as e:
        return "FAIL", f"network: {getattr(e, 'reason', e)}"
    except Exception as e:  # timeouts, ssl, resets
        return "FAIL", f"{type(e).__name__}: {e}"


def is_telugu(e):
    hay = (e["name"] + " " + e["id"]).lower()
    return any(k in hay for k in TELUGU_KW)


def write_m3u(path, entries):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("#EXTM3U\n")
        for e in entries:
            attrs = f'tvg-id="{e["id"]}"'
            if e["logo"]: attrs += f' tvg-logo="{e["logo"]}"'
            if e["group"]: attrs += f' group-title="{e["group"]}"'
            f.write(f'#EXTINF:-1 {attrs},{e["name"]}\n')
            for o in e["opts"]: f.write(o + "\n")
            f.write(e["url"] + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--playlist", action="append", required=True, help="URL or file (repeatable)")
    ap.add_argument("--mine", help="your current G9 playlist, to find channels you don't have yet")
    ap.add_argument("--telugu", action="store_true", help="only test Telugu-related channels")
    ap.add_argument("--filter", help="only test entries whose name/id contains this text")
    ap.add_argument("--workers", type=int, default=30)
    ap.add_argument("--timeout", type=int, default=12)
    ap.add_argument("--out", default="g9_out")
    a = ap.parse_args()

    entries = []
    for src in a.playlist:
        try:
            entries += parse_m3u(read_text(src))
        except Exception as ex:
            print(f"! could not read {src}: {ex}", file=sys.stderr)
    seen, uniq = set(), []
    for e in entries:  # de-dupe identical URLs
        if e["url"] not in seen:
            seen.add(e["url"]); uniq.append(e)
    entries = uniq
    if a.telugu: entries = [e for e in entries if is_telugu(e)]
    if a.filter: entries = [e for e in entries if a.filter.lower() in (e["name"] + e["id"]).lower()]
    print(f"Testing {len(entries)} streams with {a.workers} workers ...")

    os.makedirs(a.out, exist_ok=True)
    ok, bad, t0 = [], [], time.time()
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(probe, e, a.timeout): e for e in entries}
        for n, fu in enumerate(as_completed(futs), 1):
            e = futs[fu]
            st, why = fu.result()
            e["why"] = why
            (ok if st == "OK" else bad).append(e)
            if n % 25 == 0 or n == len(entries):
                print(f"  {n}/{len(entries)}  ok={len(ok)} fail={len(bad)}", end="\r")
    print()

    # best working stream per channel first
    ok.sort(key=lambda e: (e["name"].lower()))
    write_m3u(os.path.join(a.out, "working.m3u"), ok)
    with open(os.path.join(a.out, "failed.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["channel", "tvg_id", "reason", "suspect_host", "url"])
        for e in sorted(bad, key=lambda e: e["name"].lower()):
            sus = "yes" if any(h in e["url"] for h in SUSPECT_HOSTS) else ""
            w.writerow([e["name"], e["id"], e["why"], sus, e["url"]])

    new = []
    if a.mine:
        mine = parse_m3u(read_text(a.mine))
        have_ids = {m["id"] for m in mine if m["id"]}
        have_names = {norm(m["name"]) for m in mine}
        done = set()
        for e in ok:
            key = e["id"] or norm(e["name"])
            if key in done: continue
            if (e["id"] and e["id"] in have_ids) or norm(e["name"]) in have_names: continue
            done.add(key); new.append(e)
        write_m3u(os.path.join(a.out, "new_to_add.m3u"), new)

    ok_ch = {e["id"] or norm(e["name"]) for e in ok}
    dead_only = {e["id"] or norm(e["name"]) for e in bad} - ok_ch
    rep = [f"Tested {len(entries)} streams in {time.time()-t0:.0f}s",
           f"Working streams : {len(ok)}  ({len(ok_ch)} distinct channels)",
           f"Failed streams  : {len(bad)}",
           f"Channels with NO working stream: {len(dead_only)}"]
    if a.mine: rep.append(f"Working channels not in your playlist: {len(new)}")
    open(os.path.join(a.out, "report.txt"), "w").write("\n".join(rep) + "\n")
    print("\n".join(rep)); print(f"Files written to {os.path.abspath(a.out)}/")


if __name__ == "__main__":
    main()
