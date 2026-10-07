# Pixelforge v0.3 — Plan

> Builds on `PLAN.md` (architecture, IPC, AI) and `PLAN-v2.md` (Photoshop fidelity). Both stay
> authoritative; read all three. v0.2.1 status: the full PS shell, layer system, tool set, panels,
> custom/local AI, shootout, and subscription sign-in (ChatGPT; Grok awaiting xAI client ID) are shipped.
>
> **v0.3 theme: "a Photoshop user can do real work in it."** Fix every rough edge QA found,
> close the biggest feature gaps (Curves, PSD export, smart objects, guides, transforms), make
> big files fast (tiled layers), and verify on every OS with real providers.

---

## Continuation status (2026-10-07)

Implemented on `feat/v03-oauth-polish`:
- Google OAuth for Gemini using a registered Desktop app, loopback PKCE, protected
  token/client-secret storage, refresh/revocation, and an explicit Cloud quota project.
  This is separately billed API access, not Google AI Pro / Ultra plan usage.
- Existing ChatGPT and Grok sign-in paths retained. ChatGPT plan image restrictions
  and the requirement for an xAI-issued Pixelforge client ID still apply.
- Polish item 13: Ctrl+F opens Search, Ctrl+K remains an alias, Last Filter uses Ctrl+Alt+F.
- Polish item 11, color-view portion: explicit RG/RB/GB display modes suppress the
  hidden color component in CPU and GL rendering. Hiding every color displays black
  instead of accidentally restoring RGB. Model/CPU tests and real WebGL display-pixel
  checks cover all three pairs and the empty view; 675 frontend tests pass. Browser
  Channels eye interaction passes without errors; screenshot:
  `docs/screenshots/two-channel-view.png`.
  Alpha eyes now tint the color view; selecting an alpha alone still shows grayscale.
  Overlays use each channel's color/opacity, with cached combined tint separate from
  document pixels. CPU Canvas and GL display checks agree, including color changes
  and painting invalidation. Channel shortcuts synchronize eye states. Browser flow
  verifies grayscale → RGB tint → hidden tint → grayscale without errors; screenshot:
  `docs/screenshots/alpha-overlay.png`. All 677 frontend tests, Svelte check and frontend
  build pass. Native/cross-OS verification remains open.
- Polish item 12: font permission requests start directly from the picker gesture;
  native `fonts_list` uses font-kit on a blocking worker to enumerate installed families.
  Successful discovery lists installed families instead of merging uninstalled fallback
  names. Failures remain retryable, and Refresh installed fonts picks up changes.
  Linux build workflows include Fontconfig/FreeType development packages. Frontend
  tests cover permission rejection, native fallback and refresh; all 673 tests and
  Svelte/Rust checks pass. The rebuilt Windows picker displays 87 installed families;
  search and refresh pass without page errors. Screenshot:
  `docs/screenshots/installed-fonts-native.png`. macOS/Linux runtime checks remain open.
- Polish item 14: `npm run build:release` builds frontend assets before the native app.
- Polish item 1: app-root tooltips flip/shift inside the viewport, wrap long labels,
  honor Show Tool Tips, and support focus/Escape with `aria-describedby` cleanup.
  Browser verification checked all 84 visible tooltip controls at 1000×720, including
  right/bottom edges; no page errors. Screenshot: `docs/screenshots/tooltips-edge-aware.png`.
  Svelte check and frontend build pass. Native/cross-OS checks remain part of Wave 11.
- Polish item 2: panel registrations declare minimum group heights; Navigator reserves
  180 px including its zoom row. Dock weights distribute the remaining space; crowded
  docks scroll. Browser checks cover expand, divider shrinking/growing, window resize,
  reload and collapse/reopen. Screenshot: `docs/screenshots/navigator-min-height.png`.
  This also fixes tooltip focusout during removal of a focused panel control.
- Polish item 3: custom brush cursors trace the tip alpha with marching squares using
  paint-engine size, angle, roundness and flip transforms. Bounded per-tip caches and
  a capped sampling resolution keep high-zoom outlines bounded. Tests cover contours
  at image edges, holes/islands, rotation/roundness, reuse and large-size scaling.
  Live browser verification shows the Triangle tip outline at 200 px with no errors;
  screenshot: `docs/screenshots/brush-outline.png`. All 666 frontend tests, Svelte check,
  and production frontend build pass. Native/cross-OS verification remains open.
- Polish item 4: shared `Swatch.svelte` and `ColorSwatchInput.svelte` show checkerboards
  under alpha in Properties, toolbar, Color/Swatches/Character, shape fill pickers,
  gradient previews, and color dialogs. The Color Picker exposes opacity and preserves
  alpha; foreground/background and saved/exported swatches retain it. Legacy palette
  files remain compatible. Svelte check passes; frontend suite: 662 tests. Browser and
  rebuilt Windows tests verify 50% previews, saving a swatch, picker reopening and no
  runtime errors. Screenshot: `docs/screenshots/swatch-alpha-native.png`.
- Polish item 5: `History.dropAfter(index)` permanently truncates states. Delete State
  uses it in linear mode; the persisted Allow Non-Linear History option retains later
  states when branching and deletes individual rows without changing later results.
  Branches use reversible command paths and remain under the history memory budget.
  Tests cover already-applied paint, layer deletion, repeated branch switching and
  independent snapshot/History Brush sources. Browser screenshots:
  `docs/screenshots/history-options.png`, `docs/screenshots/history-nonlinear.png`.
- Polish item 6, persistence and manager: Define Pattern / Define Brush Preset save
  metadata and RGBA pixels in native app-data `patterns/` / `brushes/` folders, restored
  at startup. Browser previews use IndexedDB. Preset Manager lists sampled brushes and
  patterns, renames and deletes them. Native storage uses bounded, validated records and
  temporary-file replacement; corrupt entries report errors without hiding valid assets.
  Three Rust storage tests pass. Browser reload and a full Windows process restart both
  preserve defined assets; rename/delete pass without runtime errors. Brushes-panel
  changes now use serialized asset writes. Presets sharing a sampled tip retain their
  independent settings; deleting one preserves the others, and deleting the asset
  removes all references. A Windows restart check verifies panel rename, shared-tip
  deletion, surviving preset restoration and manager cleanup. The 679-test frontend
  suite and all three targeted persistence tests (including a subsequent pending-save
  deletion regression), Svelte checks and native build pass. Screenshot:
  `docs/screenshots/preset-manager-native.png`. Cross-OS verification remains open.
- Polish item 7, character styles: All Caps, Small Caps, Underline and Strikethrough
  are editable style flags, with defaults for new type and project-file persistence.
  All Caps no longer rewrites the original text; synthetic small caps renders lowercase
  letters as 70% capitals. Displayed-glyph measurements drive rasterization, horizontal
  caret placement and selection, including uppercase expansions such as ß to SS.
  Type-mask previews share the renderer. Tests cover undo, mixed-case source retention,
  project round-trip, glyph advances and continuous decorations across spaces.
  All 683 frontend tests, Svelte checks and Windows native build pass. Browser and
  Windows canvas checks verify caps toggling restores exact original pixels and
  reopening preserves the source text. Screenshot: `docs/screenshots/text-character-styles.png`.
  Paragraph formatting now stores width, left/right/first-line indents, space before/
  after and four justification modes. Width 0 preserves point type; positive widths
  wrap at words with a glyph fallback for long words. Paragraph breaks remain in the
  original source; visual lines retain UTF-16 positions for caret placement, selection
  and Home/End/Up/Down navigation. Rendering and type-mask previews share that layout.
  All 687 frontend tests pass, including project round-trip, paragraph geometry,
  Unicode offsets, spacing, wrapping and justification; subsequent keyboard assertions
  pass in the targeted text suite. Browser checks verify visible last-line alignment,
  original source retention and visual-line keyboard movement. Svelte checks pass.
  The Windows native build and the same paragraph-control, visible-justification and
  wrapped-line navigation checks pass without runtime errors. Screenshot:
  `docs/screenshots/text-paragraph-formatting.png`.
- Polish item 9, drag portion: dragging a selected row moves the full selection in
  stack order, carries group children once, and excludes every moved row as a target.
  Multi-layer reparenting is one undoable move; pointer cancellation no longer commits.
  Alt-drag duplicates selected root blocks. Tests cover separated rows, group/child
  selections, self-drop rejection, group destinations and exact undo/redo. Browser
  verification covers nonadjacent multi-selection drag and undo/redo without errors;
  screenshot: `docs/screenshots/layers-multi-drag.png`.
  Group clipping now uses the children's combined isolated silhouette, with group mask,
  opacity and blend mode applied consistently. Group bases are accepted by the layer
  commands. The GL path uploads a CPU-composited group clipping unit on recomposition;
  ordinary groups stay on the GPU. Real WebGL pixels match CPU pixels exactly in eight
  checks (including child edits and visibility changes) via
  `app/src/tests/engine/group-clip-demo/index.html`. All 670 tests pass. Large-document
  performance and native/cross-OS verification remain open; this is not the tiled GPU gate.
- Polish item 10: Density and Feather are layer render parameters with undo, preserved
  in `.pfproj` and layer/structural snapshots. CPU and GL compositors share cached
  effective masks for pixels, groups, adjustments, effects and clipping. Painted mask
  bytes are untouched; Apply Mask explicitly bakes the rendered result. The frontend
  suite passes 660 tests. Browser pixel checks verify both settings affect the canvas
  and resetting them restores the original image exactly, including slider state after undo.
  The same pixel checks pass in the rebuilt Windows executable with no page errors;
  screenshot: `docs/screenshots/mask-params-native.png`.

Windows native verification (2026-10-07): rebuilt the debug executable and exercised
items 1, 2 and 5 through the real WebView: permanent deletion, retained branches,
single-state deletion, Navigator minimum height/zoom visibility and edge-aware tooltip.
No page errors; screenshot `docs/screenshots/polish-native.png`. Frontend suite: 653
passing tests, plus a passing branch-eviction regression added afterward; Svelte check
has no errors or warnings. Cross-OS and live-provider release gates remain open.

The remaining Wave 8–11 work and cross-OS/live-provider release gates below remain open.
See `docs/oauth-setup.md` for configuration and verification boundaries.

## 0. Decisions (do not re-litigate)

| Topic | Decision |
|---|---|
| Tiling | Layers become **sparse 256×256 tiles** behind the existing `IRaster` interface. Empty tiles aren't allocated. History snapshots store only touched tiles. GL compositor uploads per tile. |
| Memory target | 4000×3000, 30 layers, 200 undo steps: **< 1.5 GB** total (today ≈ 1 GB at 11 layers @1080p). |
| PSD export | Write layered PSD (8-bit RGB): raster layers, groups, masks, blend modes, opacity/fill, clipping, **text and shape layers as rasterized pixels with their names**, layer effects rasterized into the layer (option: "keep editable effects" writes `lfx2` for the 8 supported effects). Round-trip through our own importer and through `psd-tools`/Photopea in CI fixtures. |
| Smart objects | Embedded only (no linked files). A smart object holds a child `.pfproj` document; transforms are non-destructive (stored matrix, re-rendered from source); double-click opens the child in a new tab; saving the tab updates the parent. **Smart filters** = adjustment/filter ops stored on the smart object with a mask. |
| Guides | Stored in the document (`guides: {axis, pos}[]`), dragged from rulers, snapping to guides/canvas edges/layer bounds/selection when View ▸ Snap is on. |
| Curves | Full PS Curves: RGB + per-channel, up to 14 points, monotone cubic spline, eyedroppers (black/gray/white point), presets, histogram behind the graph, Auto. Works as an adjustment layer and destructively. |
| Shortcuts | User-editable keymap stored in settings (`keymap.json`), PS default set + import/export; conflicts shown inline. |
| Light theme | Ship PS "Light" and "Medium Gray" alongside the two dark themes; every component must read tokens only (lint rule). |
| i18n | Infrastructure only in v0.3 (string catalog + `t()`; English shipped). Translations are v0.4. |
| Release gate | v0.3.0 ships only after **real** installs on Windows, macOS and Ubuntu are launched and smoke-tested, and each built-in provider has a passing live call (Paul's keys). |

---

## 1. Polish backlog (from v0.2 QA — all must close)

Tiling implementation progress: `TiledRaster` now provides sparse 256×256 RGBA tiles
behind `IRaster`/`Raster`, copy-on-write clones, sparse pixel/fill/clear/crop operations,
alpha bounds and detached tile readback. Empty/cleared tiles hold no pixel buffer;
transparent pixels with nonzero RGB are preserved. The legacy writable `data` getter
explicitly materializes a contiguous buffer, preserving old callers' mutation contract.
Resampling and inherited transforms still take that compatibility path. Nine tests cover
tile edges, clipping, pixel equivalence, snapshot isolation, array compatibility and
200 retained snapshots across 30 empty 4000×3000 rasters with one-pixel edits. That
isolated test retains 50 MiB of unique pixel buffers; it is **not** an app memory
benchmark. Region readback, dense/sparse and sparse/sparse blits, opacity, replacement,
overlapping self-copy, imports and filled construction now preserve sparse storage.
Full-bounds captures share tiles; tests exercise actual PaintCommand capture/finish/
undo/redo on a tiled layer. New pixel layers now default to tiled storage. Edge tiles
allocate only valid pixels, so tiny history patches retain their expected byte cost.
CPU blending, clipping alpha and thumbnails preserve sparse sources. GL full uploads
reset the texture then transfer populated tiles; dirty uploads transfer only intersected
tile regions, including zero bytes when a tile was cleared. GPU textures are still
layer-sized. All 697 tests and Svelte checks pass. Real-browser CPU/GL checks verify
edge tiles, four-region boundary edits, tile deletion and full clears with pixel parity
and source storage remaining tiled; existing clipping/channel/overlay checks pass too.
The Windows native build passes; its fill/define-pattern/define-brush flow, shared-tip
rename/delete and full-process-restart persistence smoke test pass without runtime errors.
Project save frames now use detached readback without changing live storage; project
and image/PSD frame readers construct tiled pixel layers directly. Imports copy tile
rows without an extra full-canvas Raster copy. Tests cover byte-view offsets, edge
tiles, masks, transparent RGB and queued-save isolation for tiled and legacy layers.
All 700 tests, Svelte checks and the frontend build pass. Browser GPU checks confirm
project-frame reopen pixel parity with both live and restored sources remaining tiled.
The existing file/IPC format still requires contiguous transfer blobs, so save-time
peak allocation is not resolved by this change.
The shared BrushStroke engine now keeps coverage in sparse float tiles, reads only
the current dab region and writes changed pixels without expanding the live raster
or pre-stroke snapshot. Target effects read only the current region of their cache;
smudge uses bounded readback too. Seven added tests cover dense/tiled parity for
color, erase, source, target and smudge, selection and edge clipping, cancellation,
unchanged shared tiles and small-stroke allocation on a 4000×3000 canvas. All 707
tests, Svelte checks and the frontend build pass. Real-browser GL checks verify a
boundary-crossing stroke and cancellation while storage stays tiled, comparing alpha
and premultiplied color to account for RGBA8 GPU rounding. The Windows native build
passes; an isolated native window paints a stroke and restores exact canvas screenshot
pixels through undo and redo without page errors (`docs/screenshots/tiled-brush-native.png`).
Pointer leave now clears brush hover feedback through an optional tool lifecycle hook.
Browser checks confirm the outline disappears on leave, stays absent when brush size
changes outside the canvas, and returns on reentry. The rebuilt Windows app passes
the paint/undo/redo screenshot check with the pointer moved into the toolbar, where
the stale outline previously remained. Legacy healing coverage readback still allocates a full float array;
this is not completion of the application memory gate.
Legacy pixel writers, remaining bulk operations, sparse GPU allocation, workers, non-destructive
cropping and the full 1.5 GB benchmark gate remain open.

1. Tooltips clip at panel/window edges → one tooltip layer at app root with edge-aware placement (flip/shift).
2. Navigator group too short when expanded → per-group min height (Navigator ≥ 180 px incl. zoom row); dock respects mins when distributing.
3. Custom brush tips show a round cursor → cursor renders the actual tip outline (marching-squares of the tip alpha at current size/angle/roundness, cached).
4. Properties fill swatch ignores alpha → checkerboard behind all color swatches app-wide (shared `Swatch.svelte`).
5. Delete History State only steps back → engine `History.dropAfter(index)` and real non-linear history option (PS "Allow Non-Linear History").
6. Patterns from Define Pattern and tips from Define Brush Preset don't persist → saved to app data (`patterns/`, `brushes/`), managed in a Preset Manager dialog.
7. Character panel: underline, strikethrough, small caps, real all caps (style flag, not text rewrite); Paragraph: indents, space before/after, justification modes → `TextSpec` v2.
8. Crop "Delete Cropped Pixels" off → keep hidden pixels (needs tiling: layers may extend beyond the canvas).
9. Multi-select drag in Layers moves the whole selection; clipping to a group base.
10. Mask Density/Feather become non-destructive mask render params.
11. Channels: two-channel views and alpha-channel overlay tint like PS.
12. Fonts: request `queryLocalFonts` permission properly in the Tauri webview; fall back to a Rust-side font enumeration command (`font-kit`) so every installed font shows.
13. Search: match PS CC: Ctrl+F = Search (command palette; Ctrl+K stays as an alias), Last Filter moves to Ctrl+Alt+F.
14. Release builds: `cargo build --release` blank page → document + add an `npm run build:release` script.

## 2. Features

### 2.1 Engine
- **Tiled rasters** (§0) incl. layers larger than the canvas, sparse undo, per-tile GL upload, tile-parallel CPU ops in a Web Worker pool (`OffscreenCanvas`/SharedArrayBuffer where available).
- **Smart objects + smart filters** (§0).
- **Satin** and **Pattern Overlay** effects; multiple instances of Stroke/Drop Shadow/Inner Shadow/Color Overlay/Gradient Overlay (PS CC `+`).
- **Warped text** (PS warp styles: Arc, Arc Lower/Upper, Arch, Bulge, Shell, Flag, Wave, Fish, Rise, Fisheye, Inflate, Squeeze, Twist) as a mesh warp applied to the text raster, editable.
- **Transform**: Skew, Distort, Perspective (4-corner homography), Warp (4×4 bezier mesh) — on layers, selections, smart objects.
- **16-bit/channel documents** (stretch goal; gate behind Image ▸ Mode ▸ 16 Bits/Channel; tiling makes it feasible).

### 2.2 Adjustments & filters
- **Curves** (§0), **Vibrance**, **Black & White**, **Photo Filter**, **Channel Mixer**, **Selective Color**, **Gradient Map**, **Shadows/Highlights** (destructive), **Match Color** (basic).
- Filters: **Filter Gallery** subset (Poster Edges, Cutout, Watercolor-ish via GL), **Lens Correction** (distortion/vignette), **Liquify** (forward warp, reconstruct, pucker, bloat, freeze mask — GPU mesh), **High Pass**, **Median**, **Surface Blur**, **Lens Blur** (bokeh approximation), **Render ▸ Clouds**, **Distort ▸ Twirl/Polar/Ripple**.
- **Fade…** (Shift+Ctrl+F) for the last filter/paint op.

### 2.3 Tools
- Curvature Pen, Perspective Crop, Content-Aware Move (built on healing), Mixer Brush (wet-mix brush), Art History Brush (simplified), Note tool, Artboard (deferred again unless time).
- **Content-Aware Fill** (PatchMatch on GPU/worker; dialog with sampling area overlay) and **Edit ▸ Fill ▸ Content-Aware**.
- **Select and Mask / Refine Edge** workspace (edge-detection radius, smooth, feather, contrast, shift edge, decontaminate colors, view modes).
- **Select ▸ Subject / Sky** — via AI provider (segmentation with a local ONNX model shipped optionally, else via a vision-capable provider); clearly labeled.

### 2.4 AI
- **Generative Fill** UX in the contextual task bar (PS 2024+ idiom): select → prompt → 3 variants as a generative layer with variant switcher in Properties; built on the existing mask/emulation pipeline + shootout.
- **Generative Expand** (crop beyond canvas → AI fills the new area).
- **Remove tool** (brush over object → AI or local inpaint).
- **Local inpainting model** option (ONNX LaMa via `ort` crate) so Remove/Content-Aware works offline.
- fal.ai provider; per-provider seed/steps where supported; prompt library.
- Live verification harness: `cargo run -p pf-ai --example live -- --all` producing a report Paul can run with his keys.

### 2.5 Files
- **PSD export** (§0); **TIFF with layers** (stretch); **WebP/AVIF export**; **Save for Web** dialog (format, quality, size preview, 2-up compare).
- **Recent files thumbnails** on the Start screen; **autosave + crash recovery** (every N minutes to app data, restore prompt on launch).
- **Image ▸ Image Size** "Preserve Details" resample (Lanczos-3 + sharpen).

### 2.6 UX
- **Guides & snapping** (§0), **Smart Guides** while moving layers (distance readouts).
- **Contextual task bar** (PS 2023+): floating bar under the selection/active layer with the next likely actions.
- **Keyboard Shortcuts editor** and **Edit Toolbar…** (drag tools between groups/extras).
- **Workspaces**: save/load named workspaces; Photography / Painting / Graphic & Web presets.
- **Light + Medium Gray themes** (§0); **i18n infrastructure** (§0).
- **Touch & pen**: pinch zoom, two-finger pan/rotate, pen tilt → brush angle, eraser end of the pen.
- **Accessibility**: focus order, ARIA on panels/menus, high-contrast check.

---

## 3. Waves (disjoint ownership; same rules as PLAN.md §4 and PLAN-v2 §4)

Builds into `D:\cargo-target\pixelforge` (E: is nearly full). Agents work in git worktrees on feature
branches; the coordinator merges after each wave and runs the full gate.

| Wave | Agent | Owns | Exit |
|---|---|---|---|
| 8 | `polish` | §1 items 1–6, 9–14 (UI/store/history files) | every §1 item closed with a live screenshot; tests |
| 8 | `tiles` | `lib/engine/raster*`, `composite/**`, `history.ts`, worker pool | tiled rasters behind `IRaster`, layers beyond canvas (enables §1.8), memory target met (§0) with a measured benchmark; all existing tests green |
| 8 | `psd-export` | `crates/pf-io/src/psd_write*`, IO commands, File ▸ Save As PSD | §0 PSD export, fixtures round-trip, opens correctly in Photopea (screenshot) |
| 9 | `adjust-v3` | `lib/engine/ops/**` (new ops), filter dialogs, Curves UI | §2.2 incl. Curves, Liquify, Fade |
| 9 | `engine-v3` | smart objects, transforms, warp text, extra effects, TextSpec v2 (§1.7, §2.1) | smart objects round-trip in .pfproj and PSD (as rasterized), transforms on all targets |
| 9 | `tools-v3` | §2.3 tools, Select and Mask workspace, content-aware fill | each tool live-verified |
| 10 | `ai-v3` | §2.4 | Generative Fill/Expand/Remove UX, local LaMa option, live-check harness |
| 10 | `ux-v3` | guides/snapping, contextual task bar, shortcuts editor, edit toolbar, workspaces, themes, i18n infra, touch/pen, a11y, autosave (§2.5–2.6) | each item screenshot-verified; light theme audit of every panel |
| 11 | `qa-v3` | all | full QA in the real app on **Windows, macOS, Ubuntu** (VMs or Paul's machines), live provider calls with Paul's keys, perf numbers vs §0, CI green, `v0.3.0` draft |

## 4. What Paul needs to do for v0.3
- Provide API keys (OpenAI, xAI, Gemini) for the live-call gate, or run `--example live` himself.
- Try a real "Sign in with ChatGPT".
- Ask xAI for a Pixelforge OAuth client ID (support@x.ai / xAI API Discord #help).
- Provide or approve a macOS and an Ubuntu machine/VM for the install smoke test.
- Free space on E: (≈ 7 GB left) or approve moving the repo to D:.
