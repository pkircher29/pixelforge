# Pixelforge v0.2 — Photoshop-fidelity overhaul

> Paul's verdict on v0.1.0: "needs much better layer functions, transparency, etc. Missing way too many
> tools. Looks nothing like Photoshop. Super amateur. Do better."
>
> v0.2 goal: a user who knows Photoshop 7–CC sits down and **everything is where they expect it, looks
> how they expect it, and the layer system behaves like Photoshop's.** This file extends `PLAN.md`
> (which stays authoritative for architecture, IPC, AI). Read both.

---

## 0. Non-negotiable design direction

**Look like Photoshop CC's dark UI, not a "cool dark app".** Remove every neon glow, glass blur, gradient
border and purple accent. The reference is Adobe's medium-dark theme:

| Token | Value | Use |
|---|---|---|
| `--ps-app` | `#323232` | window chrome, menu bar, options bar, toolbar |
| `--ps-panel` | `#2b2b2b`? no → `#323232` panels, `#3c3c3c` panel headers/tabs active | panels |
| `--ps-canvas-bg` | `#282828` | pasteboard around the document |
| `--ps-input` | `#262626` | text inputs, dropdowns, list backgrounds |
| `--ps-border-dark` | `#1e1e1e` | outer borders, separators |
| `--ps-border-light` | `#474747` | inner 1px highlights, dividers |
| `--ps-row-selected` | `#5a5a5a` (`#4b4b4b` inactive) | selected layer row |
| `--ps-text` | `#e6e6e6` | primary text |
| `--ps-text-dim` | `#a0a0a0` | labels, disabled `#6b6b6b` |
| `--ps-accent` | `#1473e6` | focus rings, active tab underline, checkboxes, primary buttons |
| `--ps-ants` | `#000/#fff` 1px alternating | marching ants |
| Checkerboard | `#ffffff` / `#cbcbcb`, 8px | transparency grid (user-selectable in Prefs: small/medium/large, light/medium/dark) |

Typography: `"Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif` at **11px** for panel UI,
12px menus, 10px labels; numbers `tabular-nums`. Radii **2px** (buttons), 0 on panels. No shadows except
menus/dialogs (`0 4px 12px rgba(0,0,0,.6)`). Transitions ≤ 80 ms. Hover = `+6%` lightness. Every control
is **compact**: 22px tall rows, 18px tall inputs, 16px icons, 4px gutters. Density is the point.

**Icons:** a hand-drawn SVG set that reads as Photoshop's glyphs (single-weight 1.5px white strokes/fills at
16×16, optically centered), one Svelte component per icon in `lib/ui/icons/`. No Lucide in the toolbar,
panels, options bar, or layers panel (Lucide may remain only in the command palette/dialog chrome until
replaced). Every tool, every layers-panel button, every panel-tab menu glyph, lock glyphs, eye, chain
link, fx, mask, adjustment half-circle, folder, trash, new-page — all custom.

**Layout (exactly PS):**
```
┌ Title bar (app logo · menus File Edit Image Layer Type Select Filter View Window Help · doc title · ─ ☐ ✕)
├ Options bar (tool icon ▾ preset · tool controls … · workspace switcher)
├─┬─────────────────────────────────────────────────────────┬──────────────────┐
│T│ Doc tabs  [Untitled-1 @ 66.7% (Layer 1, RGB/8) *] [+]    │ Panel column(s)  │
│o├─────────────────────────────────────────────────────────┤ ┌Color┬Swatches┐ │
│o│                                                         │ ├Properties─────┤ │
│l│   pasteboard #282828, document centered, drop shadow    │ ├Layers┬Channels┬Paths┤
│s│                                                         │ │ …             │ │
│ │                                                         │ ├History┬AI┬AI Hist┤
├─┴─────────────────────────────────────────────────────────┴──────────────────┤
│ 66.7% ▸ │ Doc: 5.93M/5.93M ▸ │ (status hint)                                  │
└────────────────────────────────────────────────────────────────────────────┘
```
Toolbar: single column, 28px wide buttons, flyout triangle in the corner for grouped tools, **long-press or
right-click opens the flyout** listing each tool with icon, name and shortcut key; the last-used tool in a
group becomes the visible one. Below the tools: foreground/background swatches with default (D) and swap (X)
mini-glyphs, Quick Mask toggle (Q), screen-mode button (F). An "Edit Toolbar…" entry at the bottom is v2.
Panels: tabbed groups; a tab strip with PS's "≡" panel menu at the right of each group; panels collapse to
icon strip (double-click the strip); groups resizable vertically by drag; panel column 280px by default.

---

## 1. Layer system (engine) — the "much better layer functions / transparency" ask

Extend `Layer` (engine) — all additive, serialized into `.pfproj` manifest (format 2, reader accepts 1):

```ts
interface LayerBase {
  …existing…
  mask: Raster | null;           // already slotted — NOW RENDERED. Grayscale stored in R; 255 = reveal
  maskEnabled: boolean;          // Shift-click thumbnail disables (red X)
  maskLinked: boolean;           // chain icon — move tool moves both
  clipToBelow: boolean;          // clipping mask (Alt-click between layers / Ctrl+Alt+G)
  fillOpacity: number;           // 0..1, "Fill" — affects pixels but not effects
  lock: { transparent: boolean; pixels: boolean; position: boolean; all: boolean };
  effects: LayerEffects | null;  // layer styles, see below
  linkedTo: LayerId[];           // layer linking (move together)
  color: LayerColor | null;      // PS row tint (red/orange/yellow/green/blue/violet/gray)
}
type LayerKind = 'raster' | 'group' | 'adjustment' | 'fill' | 'shape' | 'text';
interface AdjustmentLayer  { kind:'adjustment'; op: string /* filters OpDef id */; params: Record<string,unknown> }  // non-destructive, affects everything below (or clipped)
interface FillLayer        { kind:'fill'; fill: SolidFill | GradientFill | PatternFill }
interface ShapeLayer       { kind:'shape'; path: Path; fill: SolidFill | GradientFill | null; stroke: Stroke | null; raster: Raster /* cached rasterization */ }
interface TextLayer        { kind:'text'; text: TextSpec; raster: Raster /* cached */ }   // editable type layer
interface LayerEffects { dropShadow?, innerShadow?, outerGlow?, innerGlow?, bevelEmboss?, satin?: never, colorOverlay?, gradientOverlay?, stroke?  }  // PS Layer Style subset, each with enabled + PS's parameters (blend mode, opacity, angle, distance, spread, size, color, position inside/outside/center…)
```

Compositor (GL + CPU parity, **tests on CPU**): per layer → (1) source pixels (raster / cached raster for
shape & text / solid/gradient fill / "below" composite for adjustment) → (2) apply **effects** in PS order
(inner effects composite over fill at fillOpacity; drop shadow/outer glow below; stroke; overlays) →
(3) multiply by **mask** (if enabled) and by the **clip base's alpha** if `clipToBelow` → (4) blend at
`opacity`. Adjustment layers: composite everything below into a scratch buffer, run the op (reuse
`lib/filters` ops — move the pure op implementations into `lib/engine/ops/` so engine doesn't depend on
UI; filters re-export), masked. Group pass-through vs isolated blend: implement PS "Pass Through" default.

Channels: `Document.alphaChannels: AlphaChannel[] { id, name, mask: Raster(gray), color, opacity }`;
Select ▸ Save Selection / Load Selection; Channels panel shows R, G, B, (composite) + alpha channels +
active layer mask; click to view a channel (grayscale render), eye toggles, Ctrl-click = load as selection.
Quick Mask mode (Q): selection ↔ editable red-overlay channel, paint with brush.

Paths: `Document.paths: Path[]` — bezier subpaths (anchor, in/out handles, closed), Work Path semantics;
`Path → selection`, `selection → work path` (marching squares + simplification), `stroke path with tool`,
`fill path`. Shape layers store a Path and re-rasterize on edit (anti-aliased scanline fill + stroke via
polyline offset — implement in engine `ops/vector.ts`).

Locks enforced in the engine commands: `lock.transparent` → paint ops multiply by existing alpha;
`lock.pixels` → paint/filters refuse (toast); `lock.position` → move refuses; `lock.all` → everything.

Transparency extras: "Lock transparent pixels" (above), Layer ▸ Matting ▸ Defringe/Remove Black/White
Matte, Layer ▸ Layer Mask ▸ Reveal All / Hide All / Reveal Selection / Hide Selection / Delete / Apply /
Disable, Layer ▸ Create Clipping Mask, Select ▸ Color Range (basic), Preferences ▸ Transparency & Gamut.

History: snapshots (History panel camera button) + History Brush source selector.

---

## 1b. Custom & local AI providers (Paul: "custom AI's from Hugging Face or Ollama… and local models too")

Users must be able to add **any number of custom providers** beside ChatGPT/Grok/Gemini, each appearing as a
chip in the AI panel with its own capability flags. Provider *types* (Rust `pf-ai::providers::custom`):

| Type | Endpoint shape | Capabilities (verify against current docs before coding) |
|---|---|---|
| **OpenAI-compatible** | user base URL + `/v1/images/generations`, `/v1/images/edits` (multipart) | generate; edit/mask if the server implements it (LocalAI does; LM Studio / vLLM mostly generate-only). Covers any hosted vendor that mimics OpenAI too. |
| **Hugging Face Inference** | `https://router.huggingface.co/hf-inference/models/{model}` (text-to-image returns image bytes; image-to-image accepts image + `parameters.prompt`); user token; also support **HF Inference Endpoints** (dedicated URL) and a model picker that searches the Hub (`/api/models?pipeline_tag=text-to-image&search=`) | generate; instruct/img2img where the pipeline supports it; no pixel mask (emulate) |
| **Ollama** | `http://localhost:11434` — verify whether current Ollama supports image *generation* models or only vision-LLM input. If generation is unsupported, still add Ollama as a **"prompt helper"** (describe/expand prompts from the image using a vision model, e.g. llava/qwen-vl) and say so honestly in the UI | prompt assist (+ generate only if the API has it) |
| **ComfyUI** | `http://127.0.0.1:8188` — `POST /prompt` with a workflow JSON, poll `/history/{id}`, fetch `/view`. Ship 3 bundled workflow templates (txt2img, img2img, inpaint with mask — SD1.5/SDXL/Flux-agnostic node names where possible) with `{{prompt}}`, `{{image}}`, `{{mask}}`, `{{width}}`… placeholders; user can paste their own exported API-format workflow and map placeholders | generate, instruct (img2img), **native mask** (inpaint) |
| **Stable Diffusion WebUI (A1111 / Forge)** | `/sdapi/v1/txt2img`, `/sdapi/v1/img2img` with `mask` (base64 PNG, white = inpaint), `inpainting_fill`, `denoising_strength`; `/sdapi/v1/sd-models` to list checkpoints | generate, instruct, **native mask** |
| **Replicate / fal.ai** (bonus, hosted "less mainstream" models) | Replicate `POST /v1/predictions` with `version`/`model` + poll; fal `https://fal.run/{model}` sync | generate/img2img per model; mask where the model takes one |

Provider registry: `settings.customProviders: CustomProvider[] { id, name, type, baseUrl, model, auth: {key?}, caps: Capabilities (auto-probed where possible, editable), extra: Record<string,unknown> (workflow JSON, checkpoint, sampler, steps, cfg, seed, negative prompt support…) }` — stored in app config (keys in the keychain under `custom:<id>`). Tauri commands: `ai_custom_list/add/update/remove/probe` (probe = hit the list-models/health endpoint and report reachable + models). The `ImageProvider` trait is unchanged; `build_provider` grows a `ProviderId::Custom(id)` arm.

UI: Settings ▸ **AI Providers** (replaces "AI API Keys"): left list (built-ins + custom), right form per type with "Test connection", "Fetch models", per-type help text with install links (Ollama, ComfyUI, A1111, HF token). AI panel: chips become a scrollable row / dropdown when > 4 providers; capability-driven mode badge works the same; a provider without mask support uses the existing emulation path. Local providers show a 🖥 glyph; no cost estimate. Everything else (jobs, history, re-run with another provider) works unchanged because it's all behind the trait.

Research first (same rule as v0.1: verify endpoints from official docs, cite in `docs/ai-research.md` §4 "Custom providers").

### 1c. Multi-model shootout (Paul: "one text prompt and all the models return images; keep one, some, or all")

Command `ai.shootout` "Generate with all models…" (menu AI, Ctrl+Shift+Alt+M) and a **"Run on all ▸"** split-button
next to Run in the AI panel. Flow: one prompt (+ negative, size, n per model) → fan out one job per
*enabled* provider (built-in + custom; a checklist lets the user exclude some; remembered) → a **Results
gallery** dialog (`lib/ui/dialogs/AiShootout.svelte`): grid of cards, one column per provider, rows per
variant; each card shows the image (zoomable on hover/click → lightbox with A/B flip between any two),
provider/model, elapsed, cost, and a checkbox; per-column "select all"; footer: **Keep as layers** (each kept
image → its own layer named `<Provider>: <prompt>`, stacked, all hidden except the top? no — all visible,
top-most selected), **Keep as new documents**, **Keep & re-run unselected** (re-roll only the ones you
didn't like), Discard. Works for all three modes (generate / mask / instruct): in mask/instruct mode every
provider gets the same composite + mask, so the gallery becomes a direct "which model did the edit best"
comparison with the original shown as the first column. Jobs stream in as they finish (cards fill in;
failures show the typed error in the card with a retry). The AI History records the shootout as one entry
with per-provider sub-results and which were kept. Owned by `ai-custom` (`lib/ai/shootout.ts`, the dialog,
command, history schema bump); `panels-v2` wires the split-button into the restyled panel.

---

## 2. Tools — full Photoshop CC single-column toolbar

| Slot | Tools (flyout order) | Key |
|---|---|---|
| 1 | Move, Artboard (skip — reserve) | V |
| 2 | Rectangular Marquee, Elliptical Marquee, Single Row Marquee, Single Column Marquee | M |
| 3 | Lasso, Polygonal Lasso, Magnetic Lasso | L |
| 4 | Quick Selection (brush-based grow via color similarity), Magic Wand | W |
| 5 | Crop, Perspective Crop (skip), Slice (skip) | C |
| 6 | Eyedropper, Color Sampler (4 persistent samples → Info panel), Ruler (measure → Info), Note (skip) | I |
| 7 | Spot Healing Brush, Healing Brush, Patch, Content-Aware Move (skip), Red Eye | J |
| 8 | Brush, Pencil, Color Replacement, Mixer Brush (skip) | B |
| 9 | Clone Stamp, Pattern Stamp | S |
| 10 | History Brush, Art History Brush (skip) | Y |
| 11 | Eraser, Background Eraser, Magic Eraser | E |
| 12 | Gradient, Paint Bucket | G |
| 13 | Blur, Sharpen, Smudge | — |
| 14 | Dodge, Burn, Sponge | O |
| 15 | Pen, Freeform Pen, Curvature Pen (skip), Add Anchor, Delete Anchor, Convert Point | P |
| 16 | Horizontal Type, Vertical Type, Horizontal Type Mask, Vertical Type Mask | T |
| 17 | Path Selection, Direct Selection | A |
| 18 | Rectangle, Rounded Rectangle, Ellipse, Polygon, Line, Custom Shape (ships with ~24 PS-like shapes) | U |
| 19 | Hand, Rotate View | H / R |
| 20 | Zoom | Z |
| — | Foreground/Background, Default (D), Swap (X), Quick Mask (Q), Screen Mode (F) | |

Healing: Spot = clone from auto-chosen nearby texture + luminance/color matching to destination
(Poisson-lite: match mean/variance of destination ring). Healing Brush = clone + same blending.
Patch = selection drag → same blend. Quick Selection = brush strokes grow a region via flood on color
distance in Lab with edge refinement; Magnetic Lasso = snaps to Sobel edges within a width.
Blur/Sharpen/Smudge/Dodge/Burn/Sponge = brush-engine tools applying local ops with strength/exposure/flow
and range (shadows/midtones/highlights). Pen = full bezier editing with rubber-band preview, Alt to break
handles, Ctrl temporarily Direct Selection; paths render as 1px overlay with anchors. Shapes create Shape
layers (Shape / Path / Pixels mode in options bar like PS) with fill + stroke (solid/gradient, width, align,
dash). Type = editable Text layers (double-click to re-edit), options bar with font family (system fonts
enumerated via `queryLocalFonts` if available else curated list), size, AA, alignment, color, warp (skip);
Character/Paragraph panels basic.

Brush engine upgrade (`lib/tools/brush-engine.ts`): tip shapes (round hard/soft, **custom tips from PNG**),
Brush Settings panel (size, hardness, spacing, angle, roundness, size jitter, scatter, opacity/flow jitter,
smoothing %), brush presets panel with ~30 defaults (PS-style thumbnails of the stroke), pressure
mapping for size/opacity (pointer events), brush cursor = outline circle (not a crosshair).
Gradient editor dialog (stops, midpoints, opacity stops, presets ≈ PS defaults set), gradient types
linear/radial/angle/reflected/diamond, reverse/dither/transparency.

---

## 3. Panels (Window menu, PS defaults)

Color (RGB sliders + hue cube/strip picker like PS "Hue Cube"), Swatches (PS default swatch grid, add/delete,
groups), Properties (context-sensitive: layer transform/mask density+feather / adjustment-layer controls
with live sliders, pixel layer info, document when nothing), Layers (PS-exact, see §1 and §4), Channels,
Paths, History (with snapshots + history brush source column), Navigator (thumbnail + red view box + zoom
slider), Info (RGB under cursor, 2nd readout CMYK-ish or HSB, cursor XY, selection W/H, color samplers,
doc size), Brush Settings, Brushes (presets), Character, Paragraph, Actions (skip), AI, AI History
(restyled to PS idiom: flat, dense, no chips). Panel menus (≡) carry the PS commands for that panel.

Layers panel, exactly: filter row (`Kind ▾ [pixel][adjust][type][shape][smart]` toggle icons, switch),
`Normal ▾  Opacity: 100% ▾`, `Lock: [⊞][✎][✥][⊡][🔒]  Fill: 100% ▾`, rows (eye · [layer thumb]·[chain]·[mask thumb] ·
name · fx▾ · lock glyph), adjustment layers show the half-circle icon thumb + mask thumb, groups with
disclosure, clipped layers indented with the ↳ arrow, effects expandable list under the row ("Effects / Drop
Shadow / Stroke" with eyes), bottom bar `[link][fx][mask][◐ adj][folder][new][trash]`, drag-reorder with
insertion line + drop-into-group, Alt-drag duplicate, Ctrl-click thumbnail → selection from alpha,
Shift-click mask → disable, Alt-click mask → view mask, Alt-click eye → solo, double-click thumbnail →
Layer Style dialog, double-click name → rename, right-click → PS context menu. Layer thumbnails are
**document-aspect, 40px rows with 36px thumbs** (PS "Medium"), checkerboard behind transparency, white
hairline border, mask thumb with black/white.

Layer Style dialog: PS layout — left list with checkboxes (Blending Options, Bevel & Emboss, Stroke, Inner
Shadow, Inner Glow, Satin(skip), Color Overlay, Gradient Overlay, Pattern Overlay(skip), Outer Glow, Drop
Shadow), right pane with each effect's PS controls, live preview on canvas, Styles presets (a dozen PS-like),
"Make Default"/"Reset to Default", OK/Cancel/New Style.

---

## 4. Waves (disjoint ownership; same rules as PLAN.md §4)

| Wave | Agent | Owns | Exit |
|---|---|---|---|
| 5 | `engine-v2` | `lib/engine/**` (+ move pure ops from `lib/filters/ops` into `lib/engine/ops` and leave re-exports), `docs/pfproj-format.md` (format 2), `lib/io/convert.ts` (serialize new fields) | masks/clipping/locks/fill/effects/adjustment/fill/shape/text layers, channels, paths, quick mask, snapshots — CPU+GL, ≥ 80 new tests, demo page |
| 5 | `ai-custom` | `crates/pf-ai/**`, `app/src-tauri/src/commands/{ai,settings}.rs`, `lib/ai/providers*.ts`, `lib/ai/client.ts`, `lib/ui/dialogs/AiProviders*.svelte` (replaces ApiKeysDialog), `docs/ai-research.md` §4, `docs/ipc.md` AI section | §1b: 5 custom provider types behind the trait, registry + probe commands, AI Providers dialog, chips scale; wiremock tests per type; fake servers in `scripts/` for each |
| 5 | `ps-shell` | `app.css`, `lib/ui/icons/**`, `lib/ui/{TitleBar,MenuBar,MenuList,Toolbar,OptionsBar,Dock,DocTabs,StatusBar,CommandPalette,ContextMenu,Toast,Welcome}.svelte`, `lib/ui/dialogs/{Dialog,DialogHost,Preferences*}.svelte`, `App.svelte`, `lib/stores/ui.svelte.ts`, `lib/tools/types.ts` (add flyout `group` + `groupOrder`, `presets`) | PS look, custom icon set (≥ 90 glyphs), flyout toolbar, tabbed panel groups w/ panel menus + collapse-to-icons, options bar presets, PS status bar, Preferences (Interface/Transparency/Cursors). Screenshot compared side-by-side with a PS reference layout. |
| 6 | `layers-v2` | `lib/ui/panels/{Layers*,Channels*,Paths*,Properties*}.svelte`, `lib/ui/dialogs/LayerStyle*.svelte`, `lib/ui/commands/layer.ts`, `Layer` menu | §3 Layers/Channels/Paths/Properties + Layer Style dialog, all layer menu commands |
| 6 | `tools-v2` | `lib/tools/**` (except `types.ts` shape — extend only), `lib/ui/dialogs/{Gradient*,Brush*}.svelte`, `lib/ui/panels/{Brush*,Character*,Paragraph*}.svelte`, `lib/ui/commands/select.ts` | every tool in §2, brush engine, gradient editor, type layers editing |
| 6 | `panels-v2` | `lib/ui/panels/{Color,Swatches,Navigator,Info,History,Ai*}.svelte`, `lib/ai/**` (restyle only), `lib/ui/commands/{view,edit}.ts` | §3 remaining panels, history snapshots UI, AI panels in PS idiom |
| 7 | `integration-qa-v2` | all | live QA of every tool/panel/layer feature, side-by-side screenshots vs PS layout, perf, CI green, `v0.2.0` draft |

Agents coordinate through the registry (`lib/ui/registry.svelte.ts`) — `ps-shell` extends `PanelDef` with
`group: string` (tab group id) and `menu?: CommandDef[]` (panel ≡ menu) and `ToolDef` with `group`.
Everyone reads `PLAN.md` + this file + `docs/ipc.md` first.
