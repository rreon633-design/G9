# Developing G9

## Prerequisites

- Rust stable (1.77+)
- Node 20 (only for `@tauri-apps/cli`)
- Windows 10/11 for real playback tests (WebView2)
- Linux packages, debug only: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf`
- Optional: `ffmpeg` / `ffprobe` on PATH (convert, repair, chapters, inspect, RTMP, embedded subs)
- Optional: `whisper` / `whisper-cli` on PATH (Generate captions)
- Optional: no FFmpeg needed for development — **Settings → FFmpeg engine** downloads one at runtime

## Commands

| Command | What |
|---|---|
| `npm install` | CLI only — no frontend npm libraries |
| `npm run dev` | `tauri dev` |
| `cargo test -p g9-core -p g9-iptv -p g9-store -p g9-sources` | the crates GitHub CI runs |
| `cargo test -p g9` | the desktop crate: 33 tests (fun, dl, epg, ffmpeg, args) |
| `node domtest/smoke6.js` | Fun Mode: wall → sheet → play, sources, search, browse, reader |
| `node domtest/smoke7.js` | v0.9.0 basics: picture, speed, drop, playlists, picker, update, reconnect |
| `node domtest/smoke8.js` | v0.10.0 library: My List, Watching, flags, filters, merged search, menu, keys, timer, mini player, hub, wizard, `g9://` |
| `node domtest/smoke9.js` | v0.12.0 sources: health, Test, per-source headers, addon filters, paging |
| `node domtest/smoke10.js` | v0.13.0 GPU pipeline: plan function, pass chain, one upload per frame, flip-at-upload, rVFC pacing, CSS fallback |
| `node domtest/smoke11.js` | v0.14.0 appearance: themes, accent maths, personalisation hooks, profile, notification gating, widgets, reset |
| `cargo fmt --all` | format |
| `cargo clippy -p g9-core -p g9-iptv -p g9-store -p g9-sources --all-targets -- -D warnings` | lint (CI) |
| `cargo check -p g9` | fast compile check of the app crate (needs WebKit on Linux, works on Windows) |
| `bash scripts/ci-local.sh` | local gates incl. `tauri build --debug` (needs GTK) |
| `python3 scripts/shoot-ui.py` | screenshots of both themes and every new panel into `preview/ui` (needs playwright) |

## Frontend

Edit files in `ui/` and reload the Tauri window. **Do not** add React, Vue, Svelte,
TypeScript, Vite, or frontend npm libraries (`hls.js` included — HLS is native or the
small MSE loader already in `ui/app.js`).

Tauri APIs are used through `window.__TAURI__` (`withGlobalTauri: true`).

Colours and shape come from the token set in `ui/styles.css` — see
[`UI-DESIGN.md`](UI-DESIGN.md). Do not hard-code a hex value in a component: add a token, or
a `[data-*]` override, and let `ui/theme.js` set it. `ui/theme.js` loads in `<head>` so the
first paint is already in the saved theme.

CI asserts `ui/index.html`, `ui/styles.css`, `ui/app.js` exist and that no
`ui/main.ts` appears.

## Tests of note

- `g9-iptv` strips `#EXTVLCOPT` / `#KODIPROP` and drops `file:` on remote playlists.
- `g9-iptv` parses 100k generated channels in under 10s.
- `g9-store` upserts sources and searches by name.

## CI

`.github/workflows/ci.yml` runs on every push:

| Job | Runner | What |
|---|---|---|
| `rust` | ubuntu-24.04 | `fmt --check`, `clippy -D warnings`, `test` on `g9-core` `g9-iptv` `g9-store` |
| `windows-app` | windows-latest | `cargo check -p g9 --all-targets` (the app crate) |
| `frontend` | ubuntu-24.04 | vanilla-UI guard |

Ubuntu **cannot** compile crate `g9` (no WebKit on the runner), which is why the app crate is
compiled on Windows in CI and not only at release time. If a compile error is Windows-only,
the failing job prints it as a GitHub Actions **annotation**.

## Release (Windows only)

1. Bump the version in **all** of these (they must match):
   - `Cargo.toml` → `[workspace.package] version`
   - `Cargo.lock` → the four `g9*` packages
   - `package.json`, `package-lock.json`
   - `src-tauri/tauri.conf.json`
   - `CHANGELOG.md`, `README.md`, `FEATURE-LIST.md`, `docs/DEVELOPMENT.md`
   - the `## [x.y.z]` heading in `CHANGELOG.md` — it *is* the release page body (see below)

   Nothing about the release text is edited anywhere else: `scripts/release-notes.sh` turns the
   `CHANGELOG.md` section into the Notes on the GitHub Release, and `.github/workflows/release-notes.yml`
   re-syncs that body from `main`. Check it locally with
   `bash scripts/release-notes.sh 0.8.0 CHANGELOG.md /tmp/notes.md`.
2. Commit and push `main`; wait for **CI** to be green (including `windows-app`).
3. Tag and push:

```bash
git -c user.name='G9' -c user.email='g9@local' tag -a v0.4.0 -m "G9 v0.4.0 Windows"
git push origin v0.4.0
```

4. **Release Windows** builds on `windows-latest`:
   `cargo test --release` → `npx tauri build --bundles nsis,msi` → portable zip → GitHub Release
   whose body is `release-notes.md`, generated from `CHANGELOG.md` at the tag.

### If a release run fails

The workflow tees the build to `build.log` and, on failure, emits `::error` **annotations**
(compiler errors are visible on the run page without downloading logs).

Fix on `main`, then move the tag — a tag whose release never published can be re-pointed:

```bash
git push --delete origin v0.4.0
git tag -d v0.4.0
git -c user.name='G9' -c user.email='g9@local' tag -a v0.4.0 -m "G9 v0.4.0 Windows"
git push origin v0.4.0
```

Never re-point a tag whose release **did** publish; bump the patch version instead.

A wrong or stale release **body** never needs a tag move: fix `CHANGELOG.md` on `main`, and
**Release notes** rewrites the published page on the next push.

### File associations

`src-tauri/tauri.conf.json` → `bundle.fileAssociations` is what puts G9 in Explorer's *Open with*
list. Those registry entries are written by the **installer** (NSIS/MSI); the portable zip cannot
register anything. The file a launch was started with is read from `argv` by
`src-tauri/src/args.rs` and handed to the UI through the `startup_file` command.

### Repository setting

**Settings → Actions → General → Workflow permissions → Read and write** is required so
`GITHUB_TOKEN` can create the release (`403` otherwise).

## House rules

- Vanilla frontend only; no sidebar rails; overlays only.
- Every button must work. Do not ship a control that opens nothing.
- Do not claim features the WebView engine cannot do — keep the out-of-scope table honest.
- G9 ships no content. `extras/demo.m3u` is optional test material, never auto-loaded.
