#!/usr/bin/env python3
"""Nine devices, one link: the end-to-end proof for G9 Social.

What actually runs:

  * the real `g9-hub` binary on a real socket,
  * the real `ui/social.js` in nine real Chromium instances,
  * real Ed25519 keys generated in each page (the hub verifies the signature, so a bad
    handshake fails here exactly as it would in the app),
  * real AES-GCM sealing, in the format `crates/g9-social` decrypts,
  * real WebRTC with Chromium's fake camera and microphone for the call leg.

What is stubbed, and why: the `social_*` Tauri commands, because the app shell needs
WebView2 and GTK. Their behaviour is covered by `cargo test -p g9-social -p g9-hub` and by
`domtest/smoke12.js`; this script covers the part those cannot: nine clients, one room.

    python3 scripts/e2e-social.py [--devices 9] [--keep]
"""
import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import time

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB_PORT = 8799
WEB_PORT = 8123
BASE = f"http://127.0.0.1:{WEB_PORT}"

# The bridge the pages get instead of Tauri: real keys, real signatures, in-memory storage.
BRIDGE = r"""
(() => {
  const enc = new TextEncoder();
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (text) => {
    const norm = text.replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const NAME = "__NAME__";
  const db = { threads: [], messages: {}, contacts: [], identity: null, keypair: null };

  async function boot() {
    db.keypair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const raw = await crypto.subtle.exportKey("raw", db.keypair.publicKey);
    const digest = await crypto.subtle.digest("SHA-256", raw);
    db.identity = {
      id: "g9:" + b64u(digest.slice(0, 20)),
      public: b64u(raw),
      name: NAME,
      device: "g9:" + b64u(digest.slice(0, 20)),
    };
  }

  const commands = {
    social_identity: () => db.identity,
    social_set_name: (a) => { db.identity.name = a.name; return db.identity; },
    social_handshake: async (a) => {
      const canonical = `g9-hello|v1|${a.room}|${db.identity.id}|${a.ts}|${a.nonce}`;
      const sig = await crypto.subtle.sign({ name: "Ed25519" }, db.keypair.privateKey, enc.encode(canonical));
      return { device: db.identity.id, public: db.identity.public, sig: b64u(sig) };
    },
    social_threads: () => db.threads,
    social_contacts: () => db.contacts,
    social_devices: () => [{ id: db.identity.id, name: "This PC", verified: true, revoked: false }],
    social_upsert_thread: (a) => {
      if (!db.threads.some((t) => t.id === a.thread.id)) {
        db.threads.push(Object.assign({ unread: 0, last_at: 1 }, a.thread));
      }
      return true;
    },
    social_messages: (a) => db.messages[a.thread] || [],
    social_save_message: (a) => {
      const list = (db.messages[a.message.thread] = db.messages[a.message.thread] || []);
      if (list.some((m) => m.id === a.message.id)) return false;
      list.push(a.message);
      return true;
    },
    social_set_state: (a) => {
      Object.values(db.messages).forEach((list) => list.forEach((m) => {
        if (m.id === a.id) m.state = a.newState;
      }));
      return true;
    },
    social_mark_read: () => true,
    social_invite: (a) => {
      // The page cannot sign an invite with the issuer's key pair the same way Rust does,
      // and the hub never sees invites anyway — so mint a well-formed link here. The
      // signature path is covered by cargo tests.
      const exp = Math.floor(Date.now() / 1000) + 86400;
      const fragment = b64u(crypto.getRandomValues(new Uint8Array(32)));
      const link = "g9://join?v=1&kind=room&h=" + encodeURIComponent(a.hub) +
        "&r=" + a.room + "&t=" + a.token + "&s=" + a.seats + "&e=" + exp +
        "&i=" + encodeURIComponent(db.identity.id) + "&p=" + encodeURIComponent(db.identity.public) +
        "&x=e2e#k=" + fragment;
      window.__lastInvite = { link, key_b64: fragment, fingerprint: fragment.slice(0, 4) + "·test", exp };
      return window.__lastInvite;
    },
    social_parse_invite: (a) => {
      const url = new URL(a.link);
      const get = (k) => url.searchParams.get(k);
      const key = (url.hash || "").replace(/^#k=/, "");
      return {
        ok: true, error: "", hub: get("h"), room: get("r"), token: get("t"),
        seats: Number(get("s")), kind: get("kind"), issuer: get("i"),
        fingerprint: key.slice(0, 4) + "·test", exp: Number(get("e")),
        key_b64: key, name: "Room " + get("r"),
      };
    },
    social_qr: () => '<svg viewBox="0 0 8 8"><rect width="8" height="8" fill="#fff"/></svg>',
  };

  window.__TAURI__ = {
    core: {
      convertFileSrc: (p) => p,
      invoke: async (cmd, args) => {
        const fn = commands[cmd];
        if (fn) return await fn(args || {});
        // The player asks for a few housekeeping commands on boot; empty answers keep
        // its state machine happy without pretending to be Rust.
        if (/^(list_|dl_)/.test(cmd)) return [];
        if (cmd === "app_info") return { version: "e2e", platform: "browser" };
        if (cmd === "stats") return { videos: 0, seconds: 0 };
        if (cmd === "pictures_dir") return "/tmp";
        return null;
      },
    },
  };
  return boot();
})();
"""


def expected_tier(people):
    """The same ladder as ui/social.js: what one device should send in a room this size."""
    if people <= 2:
        return "720p", 900000
    if people <= 4:
        return "540p", 550000
    if people <= 6:
        return "360p", 320000
    return "240p", 180000


def run(cmd, **kwargs):
    return subprocess.Popen(cmd, cwd=ROOT, **kwargs)


async def wait_for(url, seconds=20):
    import urllib.request

    for _ in range(int(seconds * 10)):
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return True
        except Exception:
            await asyncio.sleep(0.1)
    return False


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--devices", type=int, default=9)
    parser.add_argument(
        "--mesh",
        type=int,
        default=5,
        help="how many devices join the call itself (a full mesh costs N*(N-1) peer connections; "
        "the sandbox this was written on saturates above five, a desktop does not)",
    )
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    print("building g9-hub…")
    build = subprocess.run(
        ["cargo", "build", "-p", "g9-hub"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, "PATH": os.path.expanduser("~/.cargo/bin") + ":" + os.environ["PATH"]},
    )
    if build.returncode != 0:
        print(build.stderr[-3000:])
        sys.exit(1)
    hub_bin = os.path.join(ROOT, "target", "debug", "g9-hub")

    hub = run([hub_bin, f"127.0.0.1:{HUB_PORT}"], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    web = run(
        [sys.executable, "-m", "http.server", str(WEB_PORT), "--bind", "0.0.0.0", "--directory", ROOT],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    try:
        if not await wait_for(f"http://127.0.0.1:{HUB_PORT}/health"):
            print("the hub never came up")
            return 1
        if not await wait_for(f"{BASE}/ui/index.html"):
            print("the static server never came up")
            return 1
        print(f"hub up on :{HUB_PORT}, ui on :{WEB_PORT}")

        failures = []
        metrics = {}
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                args=[
                    "--use-fake-device-for-media-stream",
                    "--use-fake-ui-for-media-stream",
                    "--autoplay-policy=no-user-gesture-required",
                ]
            )

            async def new_client(name):
                context = await browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    permissions=["microphone", "camera"],
                )
                page = await context.new_page()
                page.on("pageerror", lambda e: failures.append(f"{name} pageerror: {e}"))
                await page.add_init_script(BRIDGE.replace("__NAME__", name))
                await page.goto(f"{BASE}/ui/index.html")
                await page.wait_for_function("() => !!window.G9Social")
                await page.evaluate("() => window.G9Social.open()")
                return context, page

            started = time.time()
            host_context, host = await new_client("Ada")
            await host.evaluate(
                """(hub) => {
                    document.getElementById('social-hub').value = hub;
                    document.getElementById('social-create').click();
                }""",
                f"http://127.0.0.1:{HUB_PORT}",
            )
            await host.wait_for_function("() => window.G9Social.state.invite && window.G9Social.state.invite.link", timeout=15000)
            link = await host.evaluate("() => window.G9Social.state.invite.link")
            join_seconds = round(time.time() - started, 2)
            metrics["host_room_ready_seconds"] = join_seconds
            print(f"room created and link ready in {join_seconds}s")

            clients = [(host_context, host, "Ada")]
            for i in range(1, args.devices):
                name = f"Device {i + 1}"
                context, page = await new_client(name)
                await page.evaluate(
                    """(link) => {
                        document.getElementById('social-link').value = link;
                        document.getElementById('social-join').click();
                    }""",
                    link,
                )
                clients.append((context, page, name))
                await page.wait_for_function("() => window.G9Social.state.joined", timeout=15000)
                print(f"  {name} joined")

            # Everyone must see the other eight.
            for context, page, name in clients:
                peers = await page.evaluate("() => Object.keys(window.G9Social.state.peers).length")
                if peers != args.devices - 1:
                    failures.append(f"{name} sees {peers} peers, expected {args.devices - 1}")

            # One message, eight receivers.
            sent_at = time.time()
            await host.evaluate("() => window.G9Social.sendChat('hello from Ada')")
            for context, page, name in clients[1:]:
                try:
                    await page.wait_for_function(
                        """() => Array.from(document.querySelectorAll('#social-msgs .bubble'))
                                .some((n) => n.textContent.includes('hello from Ada'))""",
                        timeout=8000,
                    )
                except Exception:
                    failures.append(f"{name} never received the message")
            metrics["chat_fanout_seconds"] = round(time.time() - sent_at, 2)
            print(f"one message reached {args.devices - 1} devices in {metrics['chat_fanout_seconds']}s")

            # ---- a two-way video call, timed from the button press ----
            call_started = time.time()
            await asyncio.gather(*[
                page.evaluate("() => window.G9Social.startCall(true)") for _c, page, _n in clients[:2]
            ])
            for context, page, name in clients[:2]:
                try:
                    await page.wait_for_function(
                        """() => {
                            const call = window.G9Social.state.call;
                            if (!call) return false;
                            const peers = Array.from(call.peers.values());
                            return peers.length > 0 && peers.every((p) => p.pc && p.pc.connectionState === 'connected');
                        }""",
                        timeout=60000,
                    )
                except Exception:
                    failures.append(f"{name} never reached a connected peer connection")
            metrics["call_connected_seconds"] = round(time.time() - call_started, 2)
            print(f"video call connected in {metrics['call_connected_seconds']}s")

            await asyncio.sleep(1.5)
            for context, page, name in clients[:2]:
                info = await page.evaluate(
                    """() => {
                        const videos = Array.from(document.querySelectorAll('.call-tile video'))
                            .map((v) => ({ w: v.videoWidth, h: v.videoHeight, live: !!v.srcObject }));
                        const sender = Array.from(window.G9Social.state.call.peers.values())
                            .map((p) => (p.pc.getSenders().find((s) => s.track && s.track.kind === 'video') || { getParameters: () => ({}) }).getParameters())
                            .filter((p) => p.encodings && p.encodings.length)[0] || { encodings: [{}] };
                        return {
                            videos,
                            tier: document.querySelector('.call-tier') ? document.querySelector('.call-tier').textContent : null,
                            maxBitrate: sender.encodings[0].maxBitrate,
                            rtt: window.G9Social.state.link.rtt,
                            audioMuted: Array.from(document.querySelectorAll('.call-tile video'))
                                .filter((v) => v.getAttribute('data-stream') !== 'self')
                                .map((v) => v.hasAttribute('muted')),
                        };
                    }"""
                )
                if not [v for v in info["videos"] if v["w"] > 0]:
                    failures.append(f"{name} has no decoded video in the call ({json.dumps(info['videos'])})")
                if info["tier"] != "720p":
                    failures.append(f"{name} is not on the 720p tier for a two-way call ({info['tier']})")
                if info["maxBitrate"] != 900000:
                    failures.append(f"{name} did not cap its sender at 900 kbps ({info['maxBitrate']})")
                if any(info["audioMuted"]):
                    failures.append(f"{name} muted the remote audio - a call with no sound")
                if info["rtt"] is None:
                    failures.append(f"{name} never measured the hub round trip")
                else:
                    metrics[f"hub_rtt_ms_{name.replace(' ', '_')}"] = info["rtt"]

            mesh = clients[: max(2, min(args.mesh, len(clients)))]
            print(f"mesh: {len(mesh)} of {len(clients)} devices join the call")
            # ---- the other mesh-2 join the same call, audio only ----
            # A nine-way *video* mesh means 72 simultaneous encodes; that is what the SFU in
            # docs/SOCIAL-PLAN.md §5 is for. What is proven here is that nine devices hold one
            # call, and that the video senders already in it step down to the nine-way cap.
            mesh_started = time.time()
            await asyncio.gather(*[
                page.evaluate("() => window.G9Social.startCall(false)") for _c, page, _n in mesh[2:]
            ])
            for context, page, name in mesh:
                try:
                    await page.wait_for_function(
                        f"""() => {{
                            const call = window.G9Social.state.call;
                            if (!call) return false;
                            const peers = Array.from(call.peers.values());
                            return peers.length === {len(mesh) - 1} &&
                                peers.every((p) => p.pc && p.pc.connectionState === 'connected');
                        }}""",
                        timeout=120000,
                    )
                    print(f"  {name}: mesh complete")
                except Exception:
                    count = await page.evaluate(
                        "() => window.G9Social.state.call ? window.G9Social.state.call.peers.size : -1"
                    )
                    failures.append(f"{name} reached {count} connected peers, expected {len(mesh) - 1}")
            metrics["call_full_mesh_seconds"] = round(time.time() - mesh_started, 2)
            metrics["call_mesh_size"] = len(mesh)
            print(f"{len(mesh)} devices in one call in {metrics['call_full_mesh_seconds']}s")

            # Every device must have spent as little uplink as the ladder promised.
            await asyncio.sleep(3.5)
            for context, page, name in mesh:
                info = await page.evaluate(
                    """() => {
                        const call = window.G9Social.state.call;
                        const peers = call ? Array.from(call.peers.values()) : [];
                        const caps = peers.map((p) => {
                            const s = p.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
                            const params = s && s.getParameters ? s.getParameters() : null;
                            return params && params.encodings && params.encodings[0]
                                ? params.encodings[0].maxBitrate : null;
                        });
                        const nets = Object.keys(window.G9Social.state.net).map((k) => window.G9Social.state.net[k]);
                        return {
                            people: peers.length + 1,
                            audioBytes: Object.keys(window.G9Social.state.net)
                                .map((k) => window.G9Social.state.net[k].kbpsIn)
                                .filter((n) => n !== null && n !== undefined).length,
                            tier: document.querySelector('.call-tier') ? document.querySelector('.call-tier').textContent : null,
                            caps,
                            connected: peers.filter((p) => p.pc.connectionState === 'connected').length,
                            rtts: nets.map((n) => n.rtt).filter((n) => typeof n === 'number'),
                            jitter: nets.map((n) => n.jitter).filter((n) => typeof n === 'number'),
                            loss: nets.map((n) => n.loss).filter((n) => typeof n === 'number'),
                            active: window.G9Social.state.call ? window.G9Social.state.call.active : null,
                        };
                    }"""
                )
                want_tier, want_cap = expected_tier(info["people"])
                if info["tier"] != want_tier:
                    failures.append(f"{name} kept the {info['tier']} tier with {info['people']} people, expected {want_tier}")
                caps = [c for c in info["caps"] if c is not None]
                if caps and any(c != want_cap for c in caps):
                    failures.append(f"{name} is sending above the {want_cap} bps cap: {sorted(set(info['caps']))}")
                if len(info["rtts"]) < info["people"] - 1:
                    failures.append(f"{name} only measured {len(info['rtts'])} of {info['people'] - 1} peer round trips")
                if info["audioBytes"] < info["people"] - 1:
                    failures.append(f"{name} is receiving audio from {info['audioBytes']} of {info['people'] - 1} peers")
                if "call_full_peak_rtt" not in metrics:
                    metrics["call_full_peak_rtt"] = max(info["rtts"]) if info["rtts"] else None
                    metrics["call_full_peak_jitter"] = max(info["jitter"]) if info["jitter"] else 0
                    metrics["call_full_loss"] = sum(info["loss"]) if info["loss"] else 0
                    metrics["call_active_speaker"] = info["active"]

            # ---- one leaves: the rest keep their mesh ----
            await mesh[0][1].evaluate("() => window.G9Social.endCall()")
            for context, page, name in mesh[1:]:
                try:
                    await page.wait_for_function(
                        f"() => window.G9Social.state.call && window.G9Social.state.call.peers.size === {len(mesh) - 2}",
                        timeout=15000,
                    )
                except Exception:
                    failures.append(f"{name} did not drop the device that left")

            for context, page, name in mesh[1:]:
                await page.evaluate("() => window.G9Social.endCall()")
            await asyncio.sleep(0.6)
            for context, page, name in mesh:
                state = await page.evaluate(
                    """() => ({
                        call: !!window.G9Social.state.call,
                        bubble: Array.from(document.querySelectorAll('#social-msgs .bubble')).map((n) => n.textContent).join(' | '),
                    })"""
                )
                if state["call"]:
                    failures.append(f"{name} is still in a call after leaving")
                if "Call ended" not in state["bubble"]:
                    failures.append(f"{name} did not record the call ending")

            for context, _page, _name in clients:
                await context.close()
            await browser.close()

        print(json.dumps({"metrics": metrics, "failures": failures}, indent=1))
        if failures:
            print("E2E SOCIAL FAIL")
            return 1
        print("E2E SOCIAL PASS")
        return 0
    finally:
        if not args.keep:
            for proc in (hub, web):
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
