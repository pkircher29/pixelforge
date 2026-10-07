# Pixelforge v0.3 — Plan

> Builds on `PLAN.md` (architecture, IPC, AI) and `PLAN-v2.md` (Photoshop fidelity). Both stay
> authoritative; read all three. v0.2.1 status: the full PS shell, layer system, tool set, panels,
> custom/local AI, shootout, and subscription sign-in (ChatGPT; Grok awaiting xAI client ID) are shipped.
>
> **v0.3 theme: "a Photoshop user can do real work in it."** Fix every rough edge QA found,
> close the biggest feature gaps (Curves, PSD export, smart objects, guides, transforms), make
> big files fast (tiled layers), and verify on every OS with real providers.

---

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
