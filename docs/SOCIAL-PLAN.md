# G9 Social — chat, voice and video calls · v2 plan

**Supersedes:** the first draft of this document. Where v2 and v1 disagree (sidebar, device
count, joining by link, transport ladder), **v2 wins**.

**0.17.0 shipped the sidebar**: social is docked to the right of the player (288–720 px,
remembered) and the player narrows to make room; the room list is a drawer over the transcript;
the docked call is one 16:9 card per row with Expand for the full grid. It also fixed the reason
"Create a room" failed on a fresh install — `social_hub_start` starts a local hub and rooms are
created against the LAN share URL, never loopback — and made every failure a sentence.

**Status.** §10 is the release ladder. **0.15.0 shipped the loop** — workspace, link/QR rooms,
sealed chat, mesh voice and video, clean leave and reopen — with nine devices proven against a
real hub. **0.16.0 shipped the speed and the honesty**: hub-side call roster (one round trip to
the first offer), 10 ms Opus with FEC and DTX, H.264 preference, a room-size quality ladder,
live RTT and per-tile telemetry, socket reconnect with a flushed outbox, and ICE restarts.

The rest of this document is the plan for **0.18.0 → 0.19.0**; nothing below has been quietly
dropped, and where the shipped code took a simpler path first, §10 says so. The one number still
out of reach is the one §5 exists for: nine people all sending video needs the SFU, and mesh
tops out around five or six senders.

Codebase it is written against: `main` @ `v0.14.0` — Tauri 2.12.5, wry 0.57.1, tokio 1.54,
rusqlite 0.32, reqwest 0.12, Rust edition 2021. Standing constraints that still apply: vanilla
HTML/CSS/JS in `ui/`, Rust crates in the workspace, Windows x64 release, no bundled content,
**everything visible must work**.

---

## 0. The four new requirements, and what each one forces

| Requirement | What it forces | Where it lands |
|---|---|---|
| **At least 9 devices** | Mesh is dead at 9. A server-side **SFU is mandatory**, from the first call release that allows 3+ people. Also: a *room* of 9 participants **and** one person on up to 9 devices both have to work, and both are "9 devices" | §5 (SFU), §7 (multi-device), §9 (capacity math) |
| **Sidebar UI** | The social workspace becomes its own surface with a persistent left rail. It does **not** touch the player chrome — the v0.9 "no sidebars" rule was about overlays over the picture, and that still holds | §8 |
| **QR + single link to join** | A signed, expiring, revocable **invite capability** that carries the hub address, works for contacts, rooms and device-linking alike, plus QR generation and camera/screenshot scanning, plus `g9://` deep links and a browser fallback page | §6 |
| **Independent of WiFi / Bluetooth / any particular network** | **No LAN discovery, no mDNS, no Bluetooth, no "same WiFi" assumption anywhere.** Every path runs over a hub on 443, with a transport ladder down to *media over WebSocket* for networks that block UDP entirely, and store-and-forward for when both sides are never online together | §4 |

The sentence that ties them together: *if you can open a web page on that network, G9 Social
works on it — with one link, and the same quality of experience for the ninth person as for the
second.*

---

## 1. Acceptance numbers

These replace the v1 targets. Each is measurable and each becomes a test.

### Calls

| Target | 2 participants | 9 participants |
|---|---|---|
| Room join, hub in region | ≤ 1.2 s accept→first frame | ≤ 2.5 s for the 9th joiner |
| Mouth-to-ear audio | ≤ 150 ms one-way, p95 | ≤ 180 ms p95 |
| Active-speaker tile | 720p30 | 720p30 (spotlight) |
| Other tiles | — | 360p15 floor, 540p30 typical |
| Room egress from hub | ~1.5 Mbps | ≤ 45 Mbps at 9-way 720p, ≤ 18 Mbps at 9-way 360p |
| Hub CPU at 9-way video | — | ≤ 60 % of 4 vCPU |
| Quality ladder | 720p30 → 540p30 → 360p24 → 180p15 → audio | per participant, independent, driven by that participant's own estimate |
| Network drop 10 s | back ≤ 3 s, call intact | back ≤ 5 s, other participants unaffected |
| Packet loss | no artefact at 5 % | no artefact at 5 % |

### Everything else

| Target | Number |
|---|---|
| Chat local render (optimistic) | ≤ 16 ms |
| Chat send → recipient render, same region, hub online | ≤ 400 ms p95 |
| Chat send → delivered when recipient offline | queued, delivered on reconnect, shown as *queued* the whole time |
| Join a room by QR/link | ≤ 2 taps / ≤ 1.5 s after scan, including key delivery |
| Thread scroll | 10 000 messages at 60 fps (virtualised) |
| Memory, 1:1 video / 9-way video | +60 MB / +180 MB ceiling |
| Idle (no call, no socket traffic) | 0 % of a core |
| Link redemption while inviter is **offline** | must work (pre-sealed room key) — §6.4 |

### Quality floors in the worst network mode

The WSS-only fallback (§4, L3) must be **honest, not silent**: audio only, video capped at
360p15, an extra ~120 ms, and a badge that says *relayed · reduced* — never a call that looks
fine and sounds broken.

---

## 2. How the requirements change the architecture at a glance

```
                         ┌──────────── G9 Social workspace (sidebar) ────────────┐
                         │ rail │ thread / room / call                     │
                         └───┬───────────────────────────────────────────────┘
                             │ invoke()                      RTCPeerConnection
┌────────────────────────────┴──────────────────────────────────────────────────────┐
│ G9 desktop                                                                         │
│  crates/g9-social   identity · Olm/Megolm · outbox · invites · devices · store      │
│  ui/*.js            sidebar, thread, call UI   +   e2ee-frame worker                │
└────────────────────────────┬──────────────────────────────────────────────────────┘
                             │ WebSocket 443 (control, ciphertext envelopes)
                             │ WebRTC (media, E2E-encrypted frames)
┌────────────────────────────┴──────────────────────────────────────────────────────┐
│ G9 Hub — one Rust binary, self-hosted, any VPS or a home machine behind Cloudflare   │
│  auth · envelope router · mailbox(store&forward) · invites · presence               │
│  SFU (str0m) for 3..32 participants        ws-media fallback (UDP-blocked networks)  │
└────────────────────────────┬──────────────────────────────────────────────────────┘
                             │ optional, only when a direct path is impossible
                        coturn (TURN/TURNS, 443)
```

Three things changed from v1 and they matter:

1. The relay is now a **Hub** with a media role, because 9 people cannot be a mesh.
2. The client keeps **one link for everything** — invite, contact, device-link — and the link
   carries **which hub** to talk to, so there is no single central service and no account.
3. Every network assumption was removed. If a path exists, the ladder in §4 finds it.

---

## 3. Identity — no account, and up to 9 devices

### 3.1 Keys

Generated on first run in `%APPDATA%\G9\social\`, wrapped with Windows DPAPI:

- **Ed25519 identity key** — who you are; signs device lists and invites.
- **X25519 device key** — one per install (this PC). Revocable.
- **Olm account** (`vodozemac`) — the ratchet used to deliver keys between devices.

Your public identity is a **G9 ID**: `g9:` + base32 of the first 26 chars of
`SHA-256(identity public key)`. It reads like a Signal safety number, so it can be spoken aloud.
A **contact card** is `{g9_id, name, avatar, devices[], signature}` — self-signed, so it can be
mailed, pasted or QR-dropped without a directory.

### 3.2 Devices

| Rule | Value |
|---|---|
| Devices per identity | **9** (hard cap, `MAX_DEVICES`) |
| Device states | `pending` (linked but unverified), `verified` (SAS-matched), `revoked` |
| What a device holds | its own Olm account; Megolm sessions only for threads it has been sent |
| Read position | per device; the thread shows the **newest** read position across your devices |
| Fan-out | a thread message is encrypted once per **Megolm** session; session keys are delivered per device with **Olm** (10 devices × 1 envelope, not 10 copies of the message) |

Adding device #2..#9 is done with the same link/QR machinery as everything else: **Link a
device** shows a QR on the old device, the new device scans it, both show a short numeric SAS,
and only after the SAS matches does the new device receive the Olm keys. That SAS step is why
a stolen link cannot silently become your tenth device.

Losing a device is a real flow, not a footnote: **Revoke** publishes a new signed device list,
rotates every Megolm session the lost device held, and tells the other side to re-verify.

### 3.3 Why not Matrix/libp2p (re-stated, shortened)

Matrix would give federation and a mature client SDK for 105 K SLoC and a homeserver per user;
libp2p would give P2P with no delivery story when both sides are offline. Neither fits a
4.9 MB media player. We keep **`vodozemac`** — the audited Olm/Megolm crate Element itself ships
(Apache-2.0, Least Authority audit [1](https://docs.rs/crate/vodozemac/latest/source/README.md)) —
so the crypto core is not ours, and a Matrix dialect stays possible later.

---

## 4. Independence: the transport ladder

This is the section that answers "different networks, without WiFi or Bluetooth, and etc.".
There is **no discovery layer to break**: no mDNS, no Bluetooth, no "find devices on my
network". A G9 Social client needs exactly one thing — a **hub address on port 443** — and it
gets that from the invite link, the QR code, or the first-run wizard.

### 4.1 The ladder

| Level | Path | When it is used | Added latency | Media quality |
|---|---|---|---|---|
| **L0** | Direct P2P, ICE host candidate | same network, no NAT weirdness | 0 | full |
| **L1** | Direct P2P, server-reflexive (STUN) | ordinary home NAT | ~0–10 ms | full |
| **L2** | TURN over UDP 3478 | symmetric NAT / CGNAT | +10–30 ms | full |
| **L3** | TURN over **TLS 443** | firewalls that block UDP | +20–50 ms | full |
| **L4** | **Media over WSS** — SFU relays frames inside a TLS WebSocket (`/v1/ws-media`) | networks that block *all* UDP **and** TURN | +80–150 ms | audio always; video ≤ 360p15 |
| **L5** | Store-and-forward only | never both online at once | — | text, voice notes, files — delivered later |

The client tries L0→L3 through ICE automatically (that is standard WebRTC). L4 is **ours**: if
ICE ends in `failed` or if `getStats()` shows zero bytes for 4 s, the call re-establishes over
the WSS media socket — same E2EE, worse latency, and the badge says so. L5 is the mailbox.

### 4.2 Network scenarios, answered one by one

| Scenario | Does it work? | How |
|---|---|---|
| Two PCs, same house, same WiFi | yes | L0/L1 direct, hub only for signalling |
| Same house, **hub on the LAN and no internet** | yes | hub runs on a laptop/NAS; the invite link points at `wss://192.168.x.x:443` with a self-signed cert the link pins |
| Two PCs on **different ISPs** | yes | L1/L2/L3, usually direct |
| **Mobile data / CGNAT** (phone hotspot, 4G/5G) | yes | L2/L3 relay; hub reachable on 443 |
| **Hotel / airport WiFi** (UDP blocked, captive portal) | yes | L3 TURNS:443, or L4 WSS media; text always |
| **Corporate network** (deep packet inspection, only 443 out) | yes | L4 WSS media (looks like HTTPS), audio guaranteed, video reduced |
| **WiFi off, Bluetooth off, Ethernet only** | yes | nothing in the design depends on them — TCP/443 is enough |
| **No internet at all, both offline** | compose and queue | L5; messages decrypt and appear when either side reconnects |
| **No common network ever** (e.g. two air-gapped sites) | messaging via **link** | the invite link/QR can be carried by SMS, email, or paper; delivery happens whenever either side reaches a hub |
| **One side behind a hub it cannot reach** | degraded, honestly | the UI names the unreachable hub and offers *change hub*; queue keeps growing with a visible count |

### 4.3 What "no WiFi/Bluetooth" costs

Nothing in quality. It costs **one TCP:443 connection**. That is the entire dependency, and it
is the same dependency as loading a web page — which is the strongest possible statement of
"works in any case" for a desktop app.

---

## 5. Calls at 9 devices

### 5.1 Topology rules

| Participants | Topology | Why |
|---|---|---|
| 2 | **mesh** — direct P2P, hub carries signalling only | cheapest, lowest latency, no server media cost |
| 3 | mesh *or* SFU (measure at runtime; default SFU) | 3 mesh links is 3 uplinks; fine on LAN, wasteful on mobile |
| 4–32 | **SFU** | one uplink per participant, server does the fan-out |

A room of 9 at 720p is 9 uplinks of ~1.2 Mbps and 9 × 8 forwarded streams. That is a normal
afternoon for an SFU and impossible for a mesh.

### 5.2 SFU (in the hub, `str0m`)

`str0m` is Sans-I/O Rust (MIT OR Apache-2.0), built for exactly this: a state machine you drive
from your own tokio loop, no hidden runtime [2](https://crates.io/crates/str0m). The hub's
`sfu` module: rooms → participants → publications → layers.

- **Simulcast** 3 layers from every publisher: 180p15 / 360p30 / 720p30.
- **Per-subscriber layer choice** each second, from that subscriber's REMB/TWCC estimate and its
  `getStats()` reported available bitrate, with **hysteresis** (change up only after 3 s above
  threshold, down immediately) so tiles do not shimmer.
- **Audio** always forwarded; **speaker detection** from the level extension with 400 ms
  hysteresis (Jitsi's number — it is the one that feels right).
- **Key-frame requests** on layer switch and on new subscriber, so a tile never starts black.
- **Room caps**: 9 video / 32 audio / 32 chat, enforced in the hub and explained in the link
  preview ("9 seats, 4 left").

**Fallback if `str0m` is not ready in time:** LiveKit server behind the same hub API
(Apache-2.0; a 4 vCPU node carries ~200 audio or ~100 video participants
[3](https://fazliev.com/blog/livekit-production-guide)). The client contract below is deliberately
LiveKit-shaped — rooms, participants, track publications — so this is a server swap, not a
rewrite.

### 5.3 Client contract (frozen before implementation)

```
G9Call.join(roomId, {audio, video, screen})   → Promise<callId>
G9Call.leave() / mute(kind, on) / setDevice(kind, id) / pin(participantId)
G9Call.on("participant", "track", "speaking", "quality", "state", cb)
G9Call.state() → { phase, participants[], self{}, net: {path, rtt, loss, mbps}, ladder }
```

`phase` is exactly the v1 state machine (idle→dialing→ringing→connecting→connected⇄degraded→
ended, plus `reconnecting`), unchanged, because that is what the tests drive.

### 5.4 Quality ladder per participant

```
available bitrate → target layer → resolution cap
> 1.6 Mbps    → top      → 720p30
> 900 kbps    → middle   → 540p30
> 380 kbps    → middle   → 360p30
> 180 kbps    → bottom   → 360p15
> 90 kbps     → audio only tile (avatar + meter)
< 60 kbps     → audio-only "focus mode": one video at a time, others frozen thumbnails
```

The badge always tells the truth: `direct · 720p30`, `relayed TURN · 540p`, `WSS · audio`.
Nobody should ever wonder why a call looks bad.

### 5.5 Client-side CPU at 9 tiles

Nine `<video>` elements at 360p through the WebView2 compositor is affordable; nine at 720p is
not. Rules: at most **one** 720p decoder (the spotlight), the rest at 360p; tiles below the fold
are not subscribed at all (virtualised grid); `contentHint = "motion"` for camera, `"detail"`
for screen; hardware decode is whatever WebView2 chooses — we measure `getStats().decoderImplementation`
and report it in the call record.

---

## 6. Joining: one link, one QR

### 6.1 One link does three things

```
g9://join?h=<hub>&i=<invite>#<secret>          ← opens G9 (deep link)
https://<hub>/j/<invite>#<secret>              ← opens the browser fallback page
```

The **fragment** (`#secret`) never leaves the device: browsers do not send it, and the point of
the design is that the hub never learns it (see 6.4). The same link works for:

| Kind | What redemption does |
|---|---|
| `contact` | adds a contact card, offers verification (SAS/QR) |
| `room` | joins a thread *and* its next call, up to the seat limit |
| `device` | pairs a new device to your identity (then SAS) |

**Windows delivery**: `tauri-plugin-deep-link` with scheme `g9` [4](https://v2.tauri.app/plugin/deep-linking/),
registered by the NSIS installer **and** at runtime via `register_all()` (the NSIS bug is real —
runtime registration is the belt and braces [5](https://github.com/tauri-apps/tauri/issues/10095)),
plus `tauri-plugin-single-instance` with the `deep-link` feature so a link opens a tab in the
running app instead of a second instance. If G9 is not installed, the `https://` form shows a
one-page fallback: *"Open in G9 · copy the link · download G9"* — no account, no signup.

**QR**: same string, rendered as SVG by the `qrcode` crate (MIT OR Apache-2.0
[6](https://github.com/kennytm/qrcode-rust)) **in Rust**, shown in the sidebar as a 240 px card
with the six-word fingerprint under it. Scanning: camera frames at 5 fps, 640×480, decoded by
`rqrr` (a pure-Rust QR decoder) over IPC — with **scan from image file** and **paste the link**
as first-class alternatives, because a desktop without a webcam is not an error state.

### 6.2 Invite anatomy

```
invite = {
  v: 1,
  hub: "wss://hub.example:443",
  kind: "room" | "contact" | "device",
  room: "<thread id>",
  issuer: "g9:ABCD…",           // G9 ID, ed25519-signed
  seats: 9, used: 0,
  expires_at: 1761…,            // default 24 h for rooms, 10 min for device links
  epoch: 3,                     // which Megolm epoch the sealed key belongs to
  sig: "…"                      // issuer signature over all of the above
}
```

Everything except the fragment secret is signed and therefore tamper-evident: an edited seat
count or expiry is rejected by the client, and the hub refuses unsigned or expired invites.

### 6.3 Redemption flow (inviter online or offline)

```
Joiner                          Hub                            Inviter (may be offline)
  │ scan / paste link             │                                     │
  │ parse invite, verify sig      │                                     │
  │ show preview: hub, issuer,    │                                     │
  │   safety number, seats, expiry│                                     │
  │  ──── user taps Join ────▶    │                                     │
  │ POST /v1/invite/redeem        │  seat check, rate limit, epoch check │
  │   {invite, eph_pub, mac}      │  ─── deliver redeem ───────────────▶ │
  │                               │  ◀── sealed Megolm key ────────────── │
  │ ◀── sealed key (opaque) ───── │                                     │
  │ open with eph_priv → Megolm   │                                     │
  │ derive frame keys, join room  │                                     │
```

- `mac = HMAC(secret, eph_pub)` proves the joiner holds the link's fragment.
- The sealed key is `X25519(eph_pub, issuer_key)` + AES-GCM over the Megolm session key, so the
  **hub sees ciphertext it cannot open** — it is a delivery boy, not a key holder.
- **Offline inviter**: when the link is created, the inviter also pre-seals the current epoch's
  room key to a key derived from the fragment and leaves that blob with the hub. A joiner can
  therefore join a room **while the inviter's PC is off**. When anyone leaves or a device is
  revoked, the epoch rotates and old links stop granting media keys — deliberately, and the
  preview says "this link is valid until the room's next reset".

### 6.4 Honest limits of a bearer link

A link is a **capability**: whoever has it can claim a seat until it is revoked, expires or the
room is full. That is the trade-off the requirement asks for, and it is the same trade-off Zoom
and Teams make. What we add on top: server-side seat cap, 24 h default expiry, per-hub rate
limiting, **Revoke all links** in the room menu, a visible list of who joined by link, and a
warning in the UI when you copy a link (`Anyone with this link can join — 4 seats left`).

---

## 7. Chat

### 7.1 Shape

- Threads, 1..32 people. Every message is a Megolm envelope; the hub sees sender, recipient,
  size and time — never content.
- At-least-once delivery with idempotency `(session_id, seq)`, explicit `ack` and `read`
  envelopes, so the ticks mean *sent → delivered → read* and never lie.
- Edits and deletions are new envelopes (`edited`, `redacted`) that supersede; history stays
  verifiable and a deletion leaves a tombstone.
- Typing and presence are ephemeral socket events: never stored, never queued.
- Attachments: content-encrypted blobs, key wrapped in the message. Default path is
  **device-to-device**; the hub's blob store is opt-in, off, 48 h TTL.
- Search: SQLite **FTS5** over decrypted plaintext in a separate DB file, so it can be wiped on
  its own.
- Voice notes: `MediaRecorder` → Opus → waveform peaks computed from decoded PCM by the FFmpeg
  G9 already manages; sent like any other attachment.
- **Multi-device fan-out**: one Megolm session per thread, Olm-delivered per device. A message
  read on the phone is read on the PC within one round trip (read position is the max across
  your devices).

### 7.2 The hub is dumb on purpose

`/v1/ws` moves signed envelopes. It does not parse `payload`, does not know thread names, does
not resolve contacts. That is what keeps a self-hosted hub auditable in an afternoon and the
protocol versionable (v1 is additive-only: unknown `kind`s are delivered and ignored).

---

## 8. UI — sidebar, and how it coexists with the player

### 8.1 The rule, restated so it does not get relitigated

The player keeps **overlays only**: no rail over the film, nothing permanent on the picture.
**G9 Social is a workspace**, opened with `Ctrl+Shift+S` or the chat bubble in the title bar, and
inside that workspace a sidebar is the right answer. Two surfaces, two rules, no conflict.

### 8.2 Sidebar spec

```
┌──────────────────────── G9 Social ─────────────────────────────┐
│ ⬤ G9   [search threads…            ⌘K]  [ + New ]  [ ⟳ ]       │  top strip
├──────────────┬─────────────────────────────────────────────────┤
│ Chats     12 │  Avani Mehra                              🔒 ✓   │
│ Rooms      3 │  9 people · 4 online · call 720p                │
│ Contacts  28 │ ─────────────────────────────────────────────── │
│ Calls        │  messages (virtualised, day separators)         │
│ Invites   •  │                                                 │
│              │  ─────────────────────────────────────────────── │
│ ────────     │  [attach] [mic] [emoji]  message…        [send] │
│ ⬤ You        │                                                 │
└──────────────┴─────────────────────────────────────────────────┘
```

- **Width** 264 px, collapsible to 64 px (icon rail), drag-resizable, stored in the appearance
  settings from v0.14.0 so it persists and syncs with density.
- **Sections**: Chats, Rooms, Contacts, Calls, Invites — each a scrollable list with unread
  badges, presence dots, and a per-section "new" affordance (+ for threads, QR for invites).
- **Rows** carry: avatar (photo, initials, or gradient from the G9 ID), name, last-message
  preview, relative time, unread pill, muted icon, and a lock when the thread is verified.
- **Bottom of the rail**: your avatar → the profile card from v0.14.0 (theme, appearance,
  notifications, **Social settings**, device list).
- **Tokens only**: the rail is `--surface-2`, the selected row `--accent-soft`, hairlines
  `--line`. Light/dark, accent, density, text size, icon weight and motion all come free from
  v0.14.0 — no new token set, and the smoke11 contract keeps it that way.
- **Keyboard**: `Ctrl+Shift+S` open/close · `Ctrl+K` quick switcher · `↑/↓` in lists ·
  `Enter` open · `Esc` back one level · `Ctrl+N` new thread · full tab order, visible focus
  rings (already in `styles.css`).
- **TV Mode**: the rail becomes a focusable column with the same items and 10-foot type.
- **Empty states** that teach: no contacts → "Add someone with a link or QR"; no rooms → "Start
  a room — up to 9 on video".

### 8.3 In-call surfaces

An overlay over the picture, built from the existing transport vocabulary (circular buttons, the
same radius and accent tokens):

- 9-tile grid, auto-spotlight on the speaker with 400 ms hysteresis; screen share takes the
  spotlight and pushes the grid to a strip.
- Per-tile: name, mic meter, quality dot, pin, and "mute for me".
- Bottom bar: mic, camera, screen, reactions, participants, ladder badge, hang up — one row,
  always six or fewer targets.
- Collapse to a **picture-in-picture-style corner tile** while a film plays (our own, not OS
  PiP — the v0.9 "no PiP" rule was about the player's own video and stays intact).
- Join preview before you enter: camera/mic meters, "9 seats, 4 free", who is already there.

---

## 9. Capacity math for 9 (and for the hub)

Per participant, video on, simulcast:

| Layer | Resolution | Bitrate |
|---|---|---|
| low | 180p15 | ~120 kbps |
| mid | 360p30 | ~350 kbps |
| high | 720p30 | ~1.2 Mbps |

Upload: 1.2 Mbps (all three layers). Downlink at 9 participants: the SFU sends the high layer
to the spotlight viewers and mid/low to the rest, so worst case ≈ 8 × 600 kbps ≈ **4.8 Mbps**;
best case (all tiles mid) ≈ 8 × 350 kbps ≈ **2.8 Mbps**.

Hub at one 9-way room, all video: ingress ≈ **10.8 Mbps**, egress ≈ **25–45 Mbps**, CPU on
`str0m` ≈ **0.2–0.6 of a core** (str0m forwards packets without decoding), memory ≈ 150 MB.
So: **a 4 vCPU / 4 GB / 1 Gbps node carries ~6–8 simultaneous 9-way video rooms**, or roughly
5× that in audio-only rooms. Numbers to be confirmed by the soak test in §11, not assumed.

Client at 9 tiles: one 720p decoder + eight 360p decoders + Opus × 9 ≈ **15–20 % of a modern
laptop CPU**, peak memory ceiling +180 MB.

---

## 10. Security and privacy posture

| Property | How |
|---|---|
| Message content | Megolm E2EE; hub stores ciphertext it cannot read |
| Call media | SFrame (AES-GCM per frame) via `RTCRtpScriptTransform` in a worker — Baseline since Oct 2025 [7](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpScriptTransform); legacy `createEncodedStreams` path kept as fallback [8](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_Encoded_Transforms) |
| Hub trust | never holds media keys; invites are sealed to the joiner's ephemeral key |
| Identity | Ed25519 self-signed device lists; SAS + QR verification; safety numbers |
| Invites | signed, expiring, revocable, seat-capped, rate-limited; bearer-link limit stated in §6.4 |
| Keys at rest | DPAPI-wrapped; file ACL 0600; no key ever in `localStorage` |
| WebView permissions | Rust grants **Microphone + Camera only**, **own origin only**, persisted at startup so a stale "Block" cannot brick the app [9](https://github.com/augusto-dmh/fala/pull/161); everything else keeps wry's default [10](https://github.com/MaciejWlodarski/gwar/pull/131). Tauri 2.12.5 is already past the 2.12 floor where this signal exists |
| Abuse | no directory, no public rooms, no search-by-ID, mailbox TTL 30 d, blob store off, 32-seat cap |
| What the hub sees | who↔who, when, how many bytes, IP addresses. Nothing else. Written in About → Social, not buried in a doc |

---

## 11. Testing — how "9 devices" gets proven

The existing habit (playwright + jsdom + a pixel-metric pipeline) extends naturally.

| Test | What it does |
|---|---|
| `cargo test -p g9-social` | ratchet round-trips, replay rejection, epoch rotation on revoke, invite signature/expiry/seat-cap, Olm fan-out to 9 devices, outbox durability across restart |
| `cargo test -p g9-hub` | routing, mailbox TTL, rate limits, seat accounting, WS-media framing |
| `domtest/smoke12.js` | bridge contract: identity, contact card, invite parse/preview/redeem, device list |
| `domtest/smoke13.js` | chat: optimistic send, ticks, edit/redact, offline→online, FTS, 10 k scroll timing, unread maths |
| `domtest/smoke14.js` | 1:1 call state machine, all transitions, ICE restart, ladder mapping, permission-denied copy, WSS fallback trigger |
| `domtest/smoke15.js` | 9-way room in jsdom against a fake hub: join order, layer choice, spotlight hysteresis, seat cap |
| **`scripts/soak-9devices.py`** | **the real proof**: 9 headless Chromium instances join one room on a local hub, with CDP network emulation (1 %/5 % loss, 80 ms RTT) one at a time; records join time, fps, bitrate, hub CPU, client RSS. Fails the build if any number misses §1 |
| `scripts/chaos-hub.py` | kills the socket for 10 s mid-call, blocks UDP to force TURN, then forces WSS-only; asserts recovery ≤ 3 s and that the badge reports the truth |
| `scripts/soak-9devices.py --audio-only --participants 32` | the audio ceiling |

Every release ships with its test, as with every release so far.

---

## 12. Releases

| Release | Contents | Gate |
|---|---|---|
| **0.15.0 — Foundation** | `crates/g9-social` (identity, Olm/Megolm, outbox, devices, invites), `crates/g9-hub` binary (`/v1/hello`, `/v1/ws`, `/v1/invite/*`, mailbox), SQLite v6, contact cards, QR encode/decode, `g9://` deep link + single instance. **No UI beyond a debug panel** | Rust tests; smoke12; hub runs from `cargo run` and from a container |
| **0.16.0 — Workspace + chat** | Sidebar workspace shell, threads 1..32, composer, ticks, attachments (device-to-device), voice notes, search, typing, presence, edit/redact, unread badges, notification-centre integration, **invite by QR/link with preview**, device list + linking | smoke13; invite redemption incl. **inviter offline**; 10 k-device scroll is not this release |
| **0.17.0 — Sidebar (shipped)** | Social docked right (288–720 px, remembered), player narrows to make room, room list as a drawer over the transcript, docked 16:9 call tiles + Expand grid, `social_hub_start` (works with nothing installed), share-URL rooms, failures as sentences, **public playlist indexes** in the import sheet | smoke13 §17; 9-device e2e; 2-browser UI chat |
| **0.18.0 — Calls 1:1** | Voice + video mesh, device pickers with meters, screen share, mute/cam, quality ladder + honest badge, call log, SFrame E2EE, permission handler, TURN config, **transport ladder L0–L4** | smoke14; chaos-hub (drop, UDP-block, WSS-only); recorded glass-to-glass and mouth-to-ear numbers in the release notes |
| **0.19.0 — Rooms up to 9** | `str0m` SFU in the hub, rooms, simulcast, layer choice, spotlight, pinning, grid + strip, seat caps, **9-device soak** | smoke15 + `soak-9devices.py` green at 9 video / 32 audio |
| **0.20.0 — Polish & operators** | Reactions, hand raise, background blur (budget permitting), call-in-thread, TV Mode call UI, recovery UX, hub operator docs (systemd unit, container, coturn recipe, backup/restore), About → Social transparency page | full chaos suite, 1-hour soak, memory ceilings, docs review |

**Version floor:** `rust-version` 1.77 → **1.85** (`vodozemac` 0.10 and `str0m` 0.24 both need it).
Windows-only release, so this costs nothing.

Each release stays independently shippable: 0.16 gives a working chat with no calls; 0.17 gives
calls with no rooms; nothing is half-built at a tag.

---

## 13. Building blocks (keep or read, never copy)

| Job | Use | License |
|---|---|---|
| E2E chat crypto | `vodozemac` | Apache-2.0 (audited) |
| SFU | `str0m` (fallback: LiveKit server) | MIT OR Apache-2.0 / Apache-2.0 |
| ICE/DTLS/SRTP alt | `webrtc` / `rtc` 0.21 | MIT OR Apache-2.0 |
| TURN | `coturn` (TURNS:443 for the nasty networks) | BSD-3 |
| Hub HTTP/WS | `axum` + `tokio-tungstenite` | MIT |
| QR encode / decode | `qrcode` / `rqrr` | MIT OR Apache-2.0 |
| Deep links | `tauri-plugin-deep-link` + `tauri-plugin-single-instance` | MIT OR Apache-2.0 |
| Signatures/KDF | `ed25519-dalek`, `x25519-dalek`, `sha2`, `hkdf`, `hmac` | BSD-3 / Apache-2.0 |
| Storage | `rusqlite` (already present) + FTS5 | MIT |
| Keys at rest | Windows DPAPI via `keyring` | MIT/Apache-2.0 |

Read for design, never paste (licences): **Signal Desktop** (AGPL) for pre-key bundles and
verification copy, **Briar** (GPL) for offline-first semantics, **Jitsi** (Apache-2.0, safe) for
dominant-speaker hysteresis and bandwidth menus, **Element/matrix-rust-sdk** (Apache-2.0) for
device-list and session-rotation UX, **natter** for a Rust SFU that speaks LiveKit's protocol.

---

## 14. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| SFU in `str0m` takes longer than one release | high | mesh ships first (0.17) and covers 1:1; LiveKit is a server swap behind the frozen client contract; 9-way slips to 0.18 with no other release blocked |
| WebView2 denies camera/mic on a machine with a stale grant | medium | persist the grant at startup before page load; explicit Windows-settings fix path; a diagnostics panel naming the exact failed permission |
| SFrame E2EE costs CPU on weak laptops | medium | AES-GCM in a worker; measure per call; if the budget is blown the UI **offers** to drop E2E for that call and says so |
| WSS-media fallback is the only path on some networks | medium | designed for it (audio always, video ≤360p15, honest badge); tested in chaos-hub |
| Bearer links leak | medium | seat cap, 24 h expiry, revoke-all, per-hub rate limits, visible warning, joiner list |
| 9-device fan-out gets heavy | low | one Megolm session per thread, Olm only for keys; cap at 9 devices with an explicit message |
| Sidebar makes the app feel like two apps | medium | one shortcut, one title-bar bubble, the player untouched; call tile collapses into the film rather than replacing it |
| Scope creep | high | the numbers in §1 are the guardrail; each release has a gate and ships alone |

---

## 15. Open questions — sharper than last time

1. **Who runs the hub by default?** The design removes the hard dependency (links carry the hub
   address, so self-hosting works and no central service is required). The only product question
   left is the first-run default: *(a)* "run a hub on this PC for my home/office and invite from
   it", *(b)* "paste a hub address, mine is on a VPS", or *(c)* "join your friend's hub by link".
   My recommendation is **all three on one screen**, with (a) pre-selected.
2. **Room size for v1** — 9 video / 32 chat as planned, or do you want 9 to be the ceiling for
   chat too (simpler sharing rules)?
3. **Device cap** — 9 per identity is in the plan. Should a 10th device be refused, or allowed to
   replace the oldest after a prompt?

Nothing is blocked on these; implementation order and the architecture hold either way.
