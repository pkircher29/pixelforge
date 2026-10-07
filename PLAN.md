# Pixelforge — Build Plan

> Open-source (MIT), cross-platform (Windows / macOS / Linux) raster image editor in the spirit of
> Photoshop 7/8, with first-class multi-provider AI (ChatGPT / Grok / Gemini) that can be chained on
> one document. Tauri 2 + Svelte 5 + TypeScript front end, Rust back end. Repo: `pkircher29/pixelforge`.

This file is the single source of truth for every sub-agent. Read it fully before touching code.

---

## 0. Decisions already made (do not re-litigate)

| Topic | Decision |
|---|---|
| Stack | Tauri 2.x, Svelte 5 (runes), TypeScript, Vite 6, Rust 2021 stable (1.95). npm, **not** pnpm. |
| Repo | `E:\GITHUB\pixelforge`, public GitHub `pkircher29/pixelforge`, MIT license. |
| Pixels live in | **The webview** (TypeScript typed arrays + WebGL2). Rust never holds the live document. Rust = file codecs, project format, PSD import, AI providers, secrets, OS integration. Reason: brush/selection/compositing must be 60 fps with zero IPC; WebGL2 shaders are the fastest option available inside Tauri anyway. |
| Pixel format | RGBA8, **straight (non-premultiplied)** alpha in storage; compositor premultiplies in-shader. Layer buffers are full-canvas `Uint8ClampedArray` for v1 (tiling is a v2 optimization — keep `Raster` behind an interface so it can change). |
| Max canvas v1 | 8192×8192. Warn above 4096² on low-VRAM. |
| Project file | `.pfproj` = ZIP: `manifest.json` (doc + layer tree + AI history) + `layers/<id>.png` + `thumb.png`. Written/read in Rust. |
| Import | PNG, JPEG, WebP, GIF (first frame), BMP, TIFF, **PSD (read-only, flattened layers → our layers)**. |
| Export | PNG, JPEG (quality), WebP, `.pfproj`. PSD export is v2. |
| AI auth | BYOK API keys in the OS keychain (`keyring` crate) in v1. Research verdict (`docs/ai-research.md`, verified 2026-10-06): Google explicitly forbids subscription use of the API; xAI's subscription OAuth is undocumented/partner-only; OpenAI "Sign in with ChatGPT" is officially open to local open-source apps but its plan token is documented for the Responses API only, image eligibility unverified. So: keys for all three now; `AuthMethod::OAuth` stays in the trait; OpenAI SIWC is a v1.1 task gated on an empirical check. Never ship reverse-engineered auth. **Update (branch `feat/oauth-siwc`, research §5):** SIWC implemented (sign-in + Improve prompt; OpenAI now documents image generation as unsupported for plan tokens, so images stay on keys); xAI device flow implemented but needs an xAI-issued client ID (config only); Gemini: none. |
| AI models (default) | OpenAI `gpt-image-2.5-sunburst` (edits) / `gpt-image-2.5-flare` (generate); xAI `grok-imagine-image-2.0`; Gemini `gemini-3.1-flash-image` (default) + `gemini-3-pro-image` (quality). Only OpenAI has a native pixel mask (alpha=0 = edit); xAI/Gemini use **mask emulation** (§2.2). Always request base64. |
| AI results | **Always a new layer**, never destructive. Layer is named `<Provider>: <first 40 chars of prompt>` and positioned at the mask's bounding box (or 0,0 for full-image). |
| Undo | Command pattern with unlimited history, capped by memory budget (default 1 GB of layer snapshots; oldest evicted). Per-command snapshots store only the layers they changed. |
| Theme | Dark-first, glassy/neon ("super cool"), custom title bar (`decorations: false` on Win/Linux, native traffic lights on macOS via `titleBarStyle: Overlay`). Light theme is v2. |
| Command palette | `Ctrl/Cmd+K` — every menu item, tool, and AI action is reachable from it. |

---

## 1. Repository layout

```
pixelforge/
├── Cargo.toml                 # workspace: crates/* + app/src-tauri
├── rust-toolchain.toml        # stable
├── package.json               # root: workspaces ["app"], scripts proxy to app
├── LICENSE (MIT) · README.md · PLAN.md · CHANGELOG.md · .gitignore
├── .github/workflows/
│   ├── ci.yml                 # fmt, clippy, cargo test, vitest, svelte-check — ubuntu/windows/macos matrix
│   └── release.yml            # tauri-action builds installers on tag v*
├── docs/
│   ├── ai-research.md         # provider capability report (research agent output)
│   ├── architecture.md        # how engine/compositor/IPC fit together
│   └── pfproj-format.md       # file format spec
├── crates/
│   ├── pf-ai/                 # Provider trait + OpenAI/xAI/Gemini impls + job queue + key store
│   └── pf-io/                 # codecs (image crate), PSD import (psd crate), .pfproj zip, thumbnails
└── app/
    ├── package.json · vite.config.ts · svelte.config.js · tsconfig.json
    ├── src-tauri/
    │   ├── Cargo.toml · tauri.conf.json · capabilities/default.json · build.rs
    │   ├── icons/
    │   └── src/
    │       ├── main.rs · lib.rs
    │       ├── commands/ai.rs · commands/io.rs · commands/settings.rs
    │       └── state.rs
    └── src/
        ├── main.ts · App.svelte · app.css
        ├── lib/
        │   ├── engine/            # pure TS, no Svelte, 100% unit-testable
        │   │   ├── document.ts    # Document, Layer, LayerGroup, blend modes enum
        │   │   ├── raster.ts      # Raster (RGBA8 buffer), rect ops, copy/blit
        │   │   ├── selection.ts   # Selection = soft 8-bit mask + bbox; boolean ops; feather
        │   │   ├── history.ts     # Command, History (undo/redo, memory cap)
        │   │   ├── commands/      # concrete commands (PaintStroke, AddLayer, Transform, ...)
        │   │   ├── viewport.ts    # pan/zoom/rotation math, screen<->doc coords
        │   │   └── composite/     # WebGL2 compositor: blend-mode shaders, layer cache, selection marching-ants
        │   ├── tools/             # one file per tool, implements Tool interface
        │   ├── filters/           # adjustments + filters as GLSL fragment shaders + CPU fallbacks
        │   ├── ai/                # AI client (invoke wrappers), job queue store, mask emulation, history
        │   ├── io/                # open/save wrappers around Tauri commands, recent files
        │   ├── stores/            # Svelte 5 rune stores: doc, tool, ui, settings
        │   ├── ui/                # components: TitleBar, Toolbar, Canvas, panels/*, dialogs/*, CommandPalette
        │   └── shortcuts.ts
        └── tests/                 # vitest
```

---

## 2. Feature scope

### 2.1 v1 "Photoshop 7-ish" core
**Document**: new (presets + custom size, bg white/transparent/color), open, save, save-as, export, close; multiple docs in tabs; recent files; drag-drop open; paste from clipboard as new layer / new doc; copy selection to clipboard.

**Layers panel**: add / delete / duplicate / reorder (drag) / rename / visibility / lock / opacity / blend modes (Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light, Soft Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity) / merge down / merge visible / flatten / layer groups (v1: flat list with groups as folders, no nested groups beyond 1 level). Layer masks are v1.1 — keep a `mask?: Raster` slot on Layer now.

**Tools** (left toolbar, single-key shortcuts match Photoshop): Move (V), Rect/Ellipse Marquee (M), Lasso/Polygon Lasso (L), Magic Wand (W, tolerance + contiguous), Crop (C), Eyedropper (I), Brush (B, size/hardness/opacity/flow, pressure if available), Eraser (E), Paint Bucket (G, tolerance) + Gradient (G, linear/radial), Clone Stamp (S), Text (T — v1: single-line raster text via canvas 2D `fillText`, rasterized on commit), Zoom (Z), Hand (H / Space). Transform: Free Transform (Ctrl+T: scale/rotate/move with handles, commit on Enter), Flip H/V, Rotate 90/180.

**Selection ops**: all, deselect, inverse, feather, expand/contract, add/subtract/intersect modifiers (Shift/Alt), marching ants overlay, select-by-layer-alpha.

**Adjustments** (Image ▸ Adjustments, live preview dialog, apply to current layer): Brightness/Contrast, Levels, Curves (v1.1), Hue/Saturation/Lightness, Color Balance, Invert, Desaturate, Threshold, Posterize. **Filters**: Gaussian Blur, Motion Blur, Sharpen/Unsharp Mask, Add Noise, Pixelate. All are WebGL2 fragment shaders with a CPU fallback.

**Image**: Image Size (resample bilinear/bicubic), Canvas Size (anchor grid), Rotate canvas, Trim.

**Navigation**: smooth zoom (scroll, Ctrl+/-, fit, 100%), pan (space-drag, middle-drag), rotate view (R, v1.1), pixel grid at ≥800%, rulers (v1.1).

**History panel**: list of commands, click to jump.

### 2.2 v1 AI (all four selected by Paul)
1. **Generate** — prompt → image onto new layer (or new document). Provider picker, size/aspect, n variants (shown as thumbnails, pick one or all → layers).
2. **Mask edit (inpaint)** — active selection becomes the mask. Composite visible → send with mask + prompt → result pasted as new layer clipped to mask bbox, feathered edge blend.
3. **Instruct edit (no mask)** — send full composite + instruction. Result as new layer; "Diff overlay" toggle highlights changed pixels (per-pixel ΔE threshold) so the user sees what the model touched.
4. **AI history panel** — every job recorded: provider, model, mode, prompt, negative prompt, reference images, mask thumbnail, input composite thumbnail, result thumbnail, cost estimate, duration, status. Actions: **Re-run with another provider**, **Edit prompt & re-run**, **Reveal result layer**. Stored in `manifest.json` inside `.pfproj` (thumbnails only, not full inputs).

**The chaining story** ("Grok generates → I rough-edit → Gemini refines → ChatGPT adds something"): every AI call takes the *current composite* as input, so the chain works naturally. Per-provider capability gaps are bridged with **mask emulation**: if a provider has no native mask endpoint, Pixelforge crops the composite to the mask bbox (+ padding), sends it with the instruction, then composites the result back only inside the soft mask. This keeps the UX identical across providers.

**Provider abstraction (Rust, `pf-ai`)**:
```rust
pub trait ImageProvider: Send + Sync {
    fn id(&self) -> ProviderId;                    // OpenAi | XAi | Gemini
    fn capabilities(&self) -> Capabilities;        // generate, mask_edit, instruct_edit, multi_ref, sizes, max_px
    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, AiError>;
    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, AiError>;   // mask optional
}
pub enum AuthMethod { ApiKey(SecretString), OAuth { access: SecretString, refresh: Option<SecretString>, expires_at: u64 } }
```
Jobs run on a Tokio queue; progress/cancel via Tauri events (`ai://job/<id>`). Images cross IPC as **raw bytes** (`tauri::ipc::Response` / `ArrayBuffer`), never base64 JSON. Keys via `keyring` crate; fallback to encrypted file (`age`-style with machine key) if no keychain (headless Linux).

### 2.3 Explicitly deferred (v2+)
Layer masks UI, adjustment layers, smart objects, paths/pen tool, vector shapes, text layers (editable), PSD export, plugins, local model providers (ComfyUI / Stable Diffusion — the `ImageProvider` trait is designed to accommodate), light theme, i18n, touch/pen gestures beyond pressure.

---

## 3. Architecture notes

- **Compositor**: each layer is a WebGL2 texture (RGBA8, re-uploaded only on dirty rect). Final composite drawn with a per-blend-mode fragment shader chain into a framebuffer, then to the canvas with viewport transform. Target: 4096² doc, 20 layers, 60 fps pan/zoom on integrated GPU. Brush strokes paint directly into the layer's `Raster` then upload dirty rect.
- **Tools** implement `interface Tool { onPointerDown/Move/Up(e: ToolEvent), cursor, options: ToolOption[], overlay?(ctx) }`. Tool options render in a top options bar auto-generated from the `options` schema.
- **Commands**: `interface Command { label; do(doc); undo(doc); mergeWith?(next) }`. Paint strokes snapshot the dirty-rect region of the affected layer only.
- **IPC**: `invoke('io_open', {path}) → { width, height, layers: [{name, blob: ArrayBuffer...}] }` using Tauri 2 raw responses. Save sends layer PNGs encoded in the webview (`canvas.toBlob` is fine) → Rust zips. AI: webview sends composite PNG bytes + mask PNG bytes + params → Rust returns result PNG bytes.
- **Stores**: Svelte 5 runes (`$state`, `$derived`) in `lib/stores/*.svelte.ts`. Engine classes are plain TS; stores wrap them and bump a version counter on change.
- **Tests**: vitest for engine (blend math, selection ops, history), cargo tests for `pf-io` (round-trip `.pfproj`, PSD fixture) and `pf-ai` (request-shape tests against recorded fixtures with `wiremock`). No live API calls in CI.
- **Performance budget**: cold start < 1.5 s, open a 12 MP JPEG < 500 ms, brush latency < 16 ms at 200 px soft brush.

---

## 4. Execution plan — waves of sub-agents

Agents work in **disjoint directories** within a wave. Each agent: reads this file, implements, writes tests, runs `npm run check && npm test` and/or `cargo test`, builds, and **commits on its own branch-less main** with a clear message (repo is single-developer; sequential waves avoid conflicts). An agent that must touch a shared file (e.g. `App.svelte`, `lib.rs`) lists the change in its report so the integration agent can reconcile.

| Wave | Agent | Owns | Deliverable / exit test |
|---|---|---|---|
| 1 | `scaffold` | everything (first commit) | Workspace + Tauri app opens a window with a placeholder canvas; CI yml; README; LICENSE; GitHub repo created & pushed. `cargo tauri dev` works. |
| 2 | `engine` | `app/src/lib/engine/**`, `app/src/tests/engine/**` | Document/Layer/Raster/Selection/History/Viewport + WebGL2 compositor with all 16 blend modes; vitest ≥ 40 tests green; a demo page renders 3 layers with blend modes. |
| 2 | `ai-rust` | `crates/pf-ai/**`, `app/src-tauri/src/commands/ai.rs`, `settings.rs` | 3 providers behind `ImageProvider`, capability matrix, job queue, key store, Tauri commands + events; wiremock tests; `docs/ai-research.md` consulted. |
| 2 | `io-rust` | `crates/pf-io/**`, `app/src-tauri/src/commands/io.rs`, `docs/pfproj-format.md` | open/save/export all formats, PSD import, `.pfproj` round-trip test, thumbnails, raw-bytes IPC. |
| 3 | `ui-shell-tools` | `app/src/lib/ui/**`, `lib/tools/**`, `lib/stores/**`, `shortcuts.ts`, `App.svelte`, `app.css` | Full shell (title bar, menus, toolbar, options bar, canvas, layers/history/properties panels, command palette, dialogs), all §2.1 tools working on the engine, theme. |
| 3 | `ai-panel` | `app/src/lib/ai/**`, `lib/ui/panels/Ai*.svelte`, `lib/ui/dialogs/ApiKeys*.svelte` | AI panel (generate/mask/instruct), job queue UI, mask emulation, diff overlay, AI History panel w/ re-run, Settings ▸ AI keys. |
| 3 | `adjust-filters` | `app/src/lib/filters/**`, `lib/ui/dialogs/Adjust*.svelte`, Image-size/Canvas-size/Transform | All §2.1 adjustments + filters as GLSL with live preview; Free Transform; image/canvas size. |
| 4 | `integration-qa` | whole repo | Wire everything, fix build, run app, screenshot every panel via CDP, exercise each tool & AI mode (with Paul's keys if provided — otherwise mock), fix bugs, make CI green on all 3 OSes, tag `v0.1.0`. |

Rules for every agent:
1. Windows host, PowerShell. Repo lives on `E:`. Don't write outside `E:\GITHUB\pixelforge` except scratch.
2. `npm`, not pnpm. `cargo tauri dev` for the app. Keep `cargo clippy -- -D warnings` clean.
3. No `any` in TS. No `unwrap()` outside tests. Errors cross IPC as `{ code, message }`.
4. Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`) — no legacy `export let` / stores API in components.
5. Don't add dependencies for things the platform does (no lodash, no moment). Allowed: `@tauri-apps/*` plugins, `lucide-svelte` for icons, `psd` + `image` + `zip` + `keyring` + `reqwest` + `tokio` + `serde` + `thiserror` + `wiremock` in Rust.
6. Commit when your exit test passes. Commit message style: `engine: add WebGL2 compositor with 16 blend modes`.
7. Report back: what you built, what you tested, what you could NOT verify, any shared files you touched.
