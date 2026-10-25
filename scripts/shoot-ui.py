#!/usr/bin/env python3
"""Screenshot the appearance work in a real browser: both themes, the
appearance sheet, the notification centre, the profile card and Settings."""
"""Screenshots of the appearance work, for eyeballing a change before a release.

    python3 -m http.server 8123 --directory ..     # from scripts/
    python3 scripts/shoot-ui.py

Needs playwright:  pip install playwright && python3 -m playwright install chromium
Images land in preview/ui beside the repository root.
"""
import asyncio
import json
import os
import pathlib

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(os.environ.get("G9_SHOTS", ROOT / "preview" / "ui"))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get("G9_BASE", "http://127.0.0.1:8123")

STUBS = """
window.__TAURI__ = {
  core: {
    convertFileSrc: (p) => p,
    invoke: function (cmd, args) {
      args = args || {};
      if (cmd === 'app_info') return Promise.resolve({name:'G9', version:'0.14.0', content_policy:''});
      if (cmd === 'stats') return Promise.resolve({sources:2,channels:184,favourites:3,history:12});
      if (cmd === 'fun_home') return Promise.resolve({demo:false,errors:[],shelves:[],sources:[]});
      if (cmd === 'ffmpeg_status') return Promise.resolve({available:true,managed:true,version:'6.1'});
      if (cmd === 'list_history') return Promise.resolve([
        {title:'Arrival',url:'https://cdn.example/arrival.mp4',kind:'f',played_at:'2026-10-24 21:10'}
      ]);
      return Promise.resolve([]);
    }
  },
  event: { listen: () => Promise.resolve(() => {}) },
  window: { getCurrent: () => ({ minimize(){}, toggleMaximize(){}, close(){}, startDragging(){}, setAlwaysOnTop(){} }) }
};
window.__TAURI__.core.convertFileSrc = (p) => p;
try { localStorage.setItem('g9.fun.wizard', '1'); } catch (e) {}
"""


async def shot(page, name, clip=None):
    await page.wait_for_timeout(320)
    await page.screenshot(path=str(OUT / name), clip=clip)


async def main():
    issues = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = await browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page.on("pageerror", lambda e: issues.append(f"pageerror: {e}"))
        page.on("console", lambda m: issues.append(f"console {m.type}: {m.text}") if m.type == "error" else None)
        await page.add_init_script(STUBS)
        await page.goto(BASE + "/g9/ui/index.html")
        await page.wait_for_timeout(900)

        print("theme:", json.dumps(await page.evaluate("() => ({ theme: document.documentElement.dataset.theme, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() })")))

        await shot(page, "01-start-dark.png")

        # appearance sheet
        await page.click("#profile-btn")
        await page.click('#profile-pop [data-open="appearance"]')
        await shot(page, "02-appearance-dark.png")

        # light theme from the sheet
        await page.click('#appear-body [data-theme-pick="light"]')
        await shot(page, "03-appearance-light.png")
        await page.click("#appear-done")
        await shot(page, "04-start-light.png")

        # a notification centre with something in it
        await page.evaluate("""() => {
            G9Notify.push({title:'Arrival.mp4 finished downloading', body:'Saved to Videos · 1.4 GB', cat:'download'});
            G9Notify.push({title:'Stream dropped · reconnecting', body:'Switched to the backup stream', cat:'playback'});
            G9Notify.push({title:'No space left on the download drive', cat:'error'});
            G9Notify.push({title:'Picture: GPU · grade + sharpen → deband', cat:'playback'});
        }""")
        await page.click("#notif-btn")
        await shot(page, "05-notifications-light.png")

        # profile card
        await page.click("#profile-btn")
        await shot(page, "06-profile-light.png")
        await page.keyboard.press("Escape")

        # settings, still light
        await page.click("#btn-gear")
        await shot(page, "07-settings-light.png")
        await page.keyboard.press("Escape")

        # back to dark, notifications again
        await page.evaluate("() => G9Theme.set({ theme: 'dark' })")
        await page.wait_for_timeout(250)
        await page.click("#notif-btn")
        await shot(page, "08-notifications-dark.png")
        await page.keyboard.press("Escape")

        # an accent change and a bigger radius, to prove the tokens move
        await page.evaluate("() => G9Theme.set({ accent: '#8b5cf6', radius: 16 })")
        await shot(page, "09-start-violet.png")

        # and the light theme with a different font, for the type section
        await page.evaluate("() => G9Theme.set({ theme: 'light', accent: '#22c8a8', font: 'serif', radius: 8 })")
        await shot(page, "10-start-light-serif.png")

        print("issues:", json.dumps(issues))
        await browser.close()


asyncio.run(main())
