# @verric/desktop — Tauri desktop app

A native desktop shell (Tauri 2) around the Verric studio. It's a **thin client over a running Verric server**: start the server (Docker or `pnpm --filter @verric/web dev`/`start`), launch the desktop app, and it opens the studio at `http://localhost:3000` in a native window.

This matches Verric's local-first model — the engine, DB, and `/api/*` routes run in the self-hosted server; the desktop app is just native chrome (and a shorter onramp than "install Docker").

## Why a thin client (not a bundled SPA)

The studio is a Next.js **server** app (SSR + `/api` routes + SQLite), not a static SPA, so it can't be frozen into static files inside the bundle. The desktop app therefore points its webview at the local server (`frontendDist`/`devUrl` = `http://localhost:3000`). Run the server alongside it.

## Prerequisites

- **Rust + cargo** — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y` (user-local, no sudo)
- **System WebView/GTK libs** (Linux): `webkit2gtk-4.1`, `gtk3`, `libsoup-3`. On Arch/CachyOS: `sudo pacman -S webkit2gtk-4.1 gtk3 libsoup3`. On Debian/Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev`. (macOS/Windows ship their own WebView.)
- Node 22+ and pnpm 11+ (already required by the workspace)

## Develop

```bash
pnpm --filter @verric/desktop dev
```

Runs `pnpm --filter @verric/web dev` (via `beforeDevCommand`) and opens the Tauri window against it.

## Build native installers

```bash
# Linux .deb
pnpm --filter @verric/desktop tauri:build -- --bundles deb

# Linux AppImage (portable). In sandboxes without FUSE, prefix with the
# extract-and-run flag so the bundler tooling doesn't need to FUSE-mount:
APPIMAGE_EXTRACT_AND_RUN=1 pnpm --filter @verric/desktop tauri:build -- --bundles appimage

# Windows (.msi) — run on Windows; macOS (.dmg/.app) — run on macOS
pnpm --filter @verric/desktop tauri:build
```

Outputs land under `apps/desktop/src-tauri/target/release/bundle/`.

### Verified builds

This scaffold has been built end-to-end on Linux (CachyOS, Rust 1.96, webkit2gtk-4.1):

- `bundle/deb/Verric_0.1.0_amd64.deb` (~2.8 MB)
- `bundle/appimage/Verric_0.1.0_amd64.AppImage` (~101 MB — bundles WebKit + GTK)
- native binary `target/release/verric-desktop` (~9 MB ELF)

> The workspace `pnpm build` does **not** compile the desktop app (it no-ops with a message), so CI stays fast and doesn't require a Rust toolchain on every builder. Use `tauri:build` explicitly on a host with `cargo`.

## Icons

`src-tauri/icons/` holds the generated icon set (committed). Regenerate from a 1024×1024 source PNG with:

```bash
pnpm --filter @verric/desktop exec tauri icon ./path/to/source.png
```
