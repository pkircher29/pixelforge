# Pixelforge

**Open-source, cross-platform raster image editor with first-class, chainable AI.**

Pixelforge is a Photoshop 7/8-style editor (layers, blend modes, selections, brushes,
adjustments, filters, free transform) built with Tauri 2, Svelte 5 and Rust. Pixels live
in the webview and are composited with WebGL2; Rust handles codecs, the project format,
PSD import, AI providers and OS integration.

MIT licensed. Windows, macOS and Linux.

## The pitch: chain three AI providers on one document

Most "AI image editors" lock you into one model. Pixelforge treats ChatGPT (OpenAI),
Grok (xAI) and Gemini (Google) as interchangeable **providers** behind one
`ImageProvider` trait, and every AI call takes the *current composite* of your document
as input. That makes chaining natural:

> Grok generates a base image -> you rough it in with the brush and a selection ->
> Gemini refines just the selected area -> ChatGPT adds the thing you forgot.

Every AI result lands on a **new layer** (never destructive), named after the provider
and prompt, so you can mask, blend, or throw it away. Providers without a native mask
endpoint get **mask emulation**: Pixelforge crops the composite to the selection's
bounding box, sends it with your instruction, and composites the result back only
inside the soft mask. The workflow is identical no matter which model you pick.

An **AI History** panel records every job (provider, model, prompt, thumbnails, cost,
duration) and lets you re-run it with a different provider or an edited prompt.

## Screenshots

_Coming soon - the UI shell is being built. Screenshots of the editor and the AI panel
will live in `docs/img/` once the shell wave lands._

## Status

Early scaffold. See [PLAN.md](PLAN.md) for the full build plan and
[CHANGELOG.md](CHANGELOG.md) for what has landed. Not yet usable as an editor.

## Bring your own keys (BYOK)

Pixelforge does not proxy AI calls through any server. You paste your own API keys
(OpenAI, xAI, Google AI Studio) into **Settings > AI**, and they are stored in your
OS keychain (Windows Credential Manager, macOS Keychain, Secret Service on Linux).
Keys never leave your machine except in requests to the provider you chose. You pay the
provider directly at their published rates; Pixelforge shows a cost estimate per job.

## Building from source

Prerequisites on every platform:

- Rust stable (1.85+; `rustup` recommended - `rust-toolchain.toml` pins stable)
- Node.js 20+ and npm (this repo uses npm workspaces; **not** pnpm/yarn)
- Tauri CLI: either `cargo install tauri-cli --version "^2"` (gives `cargo tauri`) or
  just use the npm-installed `@tauri-apps/cli` via `npm run tauri`

### Windows

1. Install the [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   (Desktop development with C++) and the WebView2 runtime (preinstalled on Windows 11).
2. Use the **MSVC** Rust toolchain. `rust-toolchain.toml` pins `stable`, which rustup
   resolves against your *default host*; if that is `x86_64-pc-windows-gnu` the build
   picks the GNU toolchain and fails in C dependencies (`ring`). Check with `rustup show`
   and fix with `rustup set default-host x86_64-pc-windows-msvc`, or set
   `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc` in your shell.
3. `npm install`
3. `npm run tauri dev` (first Rust compile takes a few minutes)
4. Installer: `npm run tauri build` -> `target/release/bundle/{msi,nsis}/`

### macOS

1. `xcode-select --install`
2. `npm install`
3. `npm run tauri dev`
4. App bundle / DMG: `npm run tauri build` -> `target/release/bundle/{macos,dmg}/`

### Linux (Debian / Ubuntu)

Tauri 2 needs webkit2gtk **4.1**:

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
npm install
npm run tauri dev
```

Fedora: `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel`.
Arch: `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg`.

Installers: `npm run tauri build` -> `target/release/bundle/{deb,rpm,appimage}/`.

### Useful scripts (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server only (front end in a browser, no Tauri APIs) |
| `npm run tauri dev` | Full desktop app with hot reload |
| `npm run check` | `svelte-check` (TypeScript strict) |
| `npm test` | vitest |
| `npm run build` | Vite production build to `app/dist` |
| `cargo test --workspace` | Rust tests (`pf-ai`, `pf-io`, app shell) |
| `cargo clippy --workspace -- -D warnings` | Lints (CI enforces zero warnings) |

Note: `tauri::generate_context!()` embeds `app/dist`, so run `npm run build` once before
a plain `cargo build` / `cargo test` of the workspace. `npm run tauri dev` handles this
for you.

## Window chrome

Pixelforge draws its own dark title bar. On Windows and Linux the window is created with
`decorations: false` (see `app/src-tauri/tauri.conf.json`) and the bar is a
`data-tauri-drag-region`; minimize / maximize / close are driven from the front end with
`@tauri-apps/api/window` (`getCurrentWindow().minimize()` etc.), granted by the
`core:window:allow-*` permissions in `app/src-tauri/capabilities/default.json`.

On macOS the native traffic lights are kept: `app/src-tauri/tauri.macos.conf.json` is
merged over the main config at build time and sets `decorations: true`,
`titleBarStyle: "Overlay"` and `hiddenTitle: true`. The custom bar hides its own
buttons there and leaves room on the left for the traffic lights.

## Repository layout

See [docs/architecture.md](docs/architecture.md) and [PLAN.md](PLAN.md) section 1.

```
crates/pf-ai    AI provider trait + implementations, job queue, key store (Rust)
crates/pf-io    codecs, PSD import, .pfproj project format, thumbnails (Rust)
app/src-tauri   Tauri shell: commands, state, plugins (Rust)
app/src         Svelte 5 UI, TypeScript engine (document, raster, selection, history, WebGL2 compositor)
```

## License

MIT - see [LICENSE](LICENSE). Copyright (c) 2026 Paul Kircher.
