# Pixelforge architecture

Short companion to [PLAN.md](../PLAN.md) sections 1 and 3. PLAN.md wins if they disagree.

## The one big decision: pixels live in the webview

The live document (layers, selection, history) is **TypeScript** state inside the Tauri
webview, composited with **WebGL2**. Rust never holds the live document.

Why:

- Brush strokes, marching ants, selection ops and layer compositing must run at 60 fps.
  Any design that keeps pixels in Rust pays an IPC round-trip (serialize + copy across
  the webview boundary) on every interaction. Even with raw-bytes IPC that is far too slow
  for a 4096x4096 document.
- WebGL2 fragment shaders are the fastest compositing primitive available inside a Tauri
  webview on all three platforms, and they are the same code path everywhere.
- Rust is still the right tool for everything that is *not* interactive: file codecs,
  the `.pfproj` zip format, PSD import, HTTP calls to AI providers, secrets in the OS
  keychain, dialogs and clipboard.

Consequences:

- `app/src/lib/engine/**` is pure TypeScript with no Svelte imports, so it is fully unit
  testable with vitest.
- `Raster` (RGBA8, straight alpha, full-canvas `Uint8ClampedArray` for v1) sits behind an
  interface so tiling can be introduced later without touching tools.
- Images cross IPC as raw bytes (`tauri::ipc::Response` -> `ArrayBuffer`), never
  base64 JSON.

## Layers of the system

```
+-----------------------------------------------------------------------+
|  Svelte 5 UI (app/src/lib/ui)   title bar, toolbar, panels, dialogs   |
|  Stores (lib/stores/*.svelte.ts) runes wrapping engine objects        |
|  Tools (lib/tools)   Tool interface: onPointerDown/Move/Up, options   |
|  Engine (lib/engine)  Document, Layer, Raster, Selection, History,    |
|                       Viewport, WebGL2 compositor (blend shaders)     |
|  AI client (lib/ai)   invoke wrappers, job queue store, mask emulation|
|  IO client (lib/io)   open/save wrappers, recent files               |
+------------------------------ IPC (invoke / events) -------------------+
|  app/src-tauri   commands/ai.rs  commands/io.rs  commands/settings.rs |
|                  state.rs (AppState), plugins (dialog, fs, clipboard, |
|                  opener, window-state)                                |
+-----------------------------------------------------------------------+
|  crates/pf-ai    ImageProvider trait, OpenAI / xAI / Gemini impls,    |
|                  Tokio job queue, keyring-backed key store            |
|  crates/pf-io    image codecs, PSD import, .pfproj zip, thumbnails    |
+-----------------------------------------------------------------------+
```

## Compositor

Each layer is a WebGL2 RGBA8 texture, re-uploaded only for its dirty rectangle. The
final image is produced by a chain of per-blend-mode fragment shaders into a
framebuffer, then drawn to the canvas with the viewport transform (pan / zoom / rotate).
Straight alpha is stored; the shader premultiplies. Target: 4096x4096, 20 layers, 60 fps
on an integrated GPU.

The scaffold's `CanvasView` already draws its checkerboard through a WebGL2 fragment
shader to prove the context is available inside the Tauri webview on each platform.

## Commands and history

`interface Command { label; do(doc); undo(doc); mergeWith?(next) }`. Paint strokes
snapshot only the dirty rect of the affected layer. History is unlimited but capped by a
memory budget (default 1 GB of snapshots, oldest evicted).

## AI pipeline

```
selection (soft mask)  +  composite PNG  +  prompt
        |                       |
        v                       v
   lib/ai (webview) -- invoke ai_* with raw bytes --> commands/ai.rs
                                                         |
                                                   pf_ai::ImageProvider
                                                   (OpenAI | xAI | Gemini)
                                                         |
   new layer  <-- result PNG bytes + metadata  <---------+
   (clipped to mask bbox, feathered)        events: ai://job/<id>
```

Capability gaps are bridged in the webview with mask emulation (crop to mask bbox,
send, composite back inside the mask), so the user experience is identical across
providers. Every job is recorded in the AI History panel and persisted (thumbnails only)
in `manifest.json` inside the `.pfproj`.

## Errors across IPC

Every Tauri command returns `Result<T, CommandError>` where `CommandError` serializes as
`{ code, message }`. `pf_ai::Error` and `pf_io::Error` convert into it; `code` is a
stable snake_case string the UI can switch on.

## Tests

- vitest: engine math (blend modes, selection ops, history, viewport), UI helpers.
- cargo test: `pf-io` round-trips and PSD fixtures, `pf-ai` request shapes against
  `wiremock` fixtures. No live API calls in CI.
- CI runs on ubuntu / windows / macos: fmt, clippy (`-D warnings`), cargo test,
  svelte-check, vitest, vite build.
