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

            # A video call between the first two, over the same room.
            call_started = time.time()
            for context, page, name in clients[:2]:
                await page.evaluate("() => window.G9Social.startCall(true)")
            connected = True
            for context, page, name in clients[:2]:
                try:
                    await page.wait_for_function(
                        """() => {
                            const call = window.G9Social.state.call;
                            if (!call) return false;
                            const peers = Array.from(call.peers.values());
                            return peers.length > 0 && peers.every((p) =>
                                p.pc && (p.pc.connectionState === 'connected' || p.pc.iceConnectionState === 'connected'));
                        }""",
                        timeout=20000,
                    )
                except Exception:
                    connected = False
                    failures.append(f"{name} never reached a connected peer connection")
            metrics["call_connected_seconds"] = round(time.time() - call_started, 2)
            print(f"video call connected in {metrics['call_connected_seconds']}s")

            if connected:
                await asyncio.sleep(1.2)
                for context, page, name in clients[:2]:
                    video = await page.evaluate(
                        """() => {
                            const videos = Array.from(document.querySelectorAll('.call-tile video'));
                            return videos.map((v) => ({ w: v.videoWidth, h: v.videoHeight, live: !!v.srcObject }));
                        }"""
                    )
                    remote = [v for v in video if v["w"] > 0]
                    if not remote:
                        failures.append(f"{name} has no decoded video in the call ({json.dumps(video)})")

                # Leaving is announced: the other side drops the peer and its media.
                await clients[0][1].evaluate("() => window.G9Social.endCall()")
                try:
                    await clients[1][1].wait_for_function(
                        "() => window.G9Social.state.call && window.G9Social.state.call.peers.size === 0",
                        timeout=8000,
                    )
                except Exception:
                    failures.append("the other side kept the peer after the call ended")

            # Both sides leave; both are out and the thread remembers the call.
            for context, page, name in clients[:2]:
                await page.evaluate("() => window.G9Social.endCall()")
            for context, page, name in clients[:2]:
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
