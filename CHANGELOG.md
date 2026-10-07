# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-07

Photoshop-fidelity overhaul: the UI, tools and layer system now behave like Photoshop CC,
plus custom / local AI providers and the multi-model shootout.

### Added
- **Photoshop CC look**: medium-dark theme tokens, custom icon set, single-column
  toolbar with 20 grouped slots and fly-outs (right-click / long-press), PS tool keys
  (letter = group's tool, Shift+letter cycles), per-tool options bar with presets,
  tabbed panel groups with ≡ menus, collapse-to-icons, Essentials workspace + reset,
  rulers, status-bar popover, Preferences (Interface, Transparency & Gamut, Cursors, ...),
  optional light theme.
- **Layer system**: layer masks, clipping masks, Fill opacity, transparency / pixel /
  position / all locks (enforced), linking, color labels, adjustment layers, fill layers
  (solid / gradient / pattern), shape layers, editable type layers, group pass-through,
  layer styles (Drop / Inner Shadow, Outer / Inner Glow, Bevel & Emboss, Stroke, Color /
  Gradient Overlay) with a PS-layout Layer Style dialog and presets; alpha channels,
  Quick Mask, paths (work path, selection <-> path, fill / stroke path), history
  snapshots; `.pfproj` format 2 (reads format 1).
- **Panels**: PS-exact Layers, Channels, Paths, Properties (context-sensitive), Color
  (hue cube) + Color Picker, Swatches, Navigator, Info (color samplers, ruler), History,
  Brush Settings, Brushes, Character, Paragraph.
- **Tools**: single row / column marquee, polygonal / magnetic lasso, Quick Selection,
  crop straighten, color sampler, ruler, Spot Healing / Healing / Patch / Red Eye, Pencil,
  Color Replacement, Pattern Stamp, History Brush, Background / Magic Eraser, Blur /
  Sharpen / Smudge, Dodge / Burn / Sponge, Pen family, Path / Direct Selection, vertical
  type and type masks, six shape tools with ~24 custom shapes, Rotate View; brush engine
  with custom sampled tips, scattering, dynamics and ~30 presets; Gradient Editor with 5
  gradient types.
- **Custom & local AI providers** (Edit ▸ AI Providers…): OpenAI-compatible, Hugging Face
  (router or Inference Endpoint), ComfyUI (bundled workflows or your own), Stable
  Diffusion WebUI / Forge, Replicate, and Ollama as an honest "Improve prompt" helper
  (Ollama has no image-generation API). Test connection, fetch models, capability probe.
- **AI shootout** (Ctrl+Shift+Alt+M): one prompt to every enabled provider in generate,
  mask or instruct mode; streaming gallery with the original, keep as layers / new
  documents / keep & re-roll the rest; recorded as one AI History entry.
- Help ▸ Open Sample Document; `scripts/fake-local-ai.mjs` fakes every custom kind.

### Fixed (integration QA)
- Layers-panel thumbnails default to Layer Bounds; Navigator thumbnail reads the GPU
  composite (was blank and froze the UI for ~2 s on styled documents); CPU composites
  share the compositor's layer-style cache (Info / eyedropper / wand ~2 s -> <1 ms).
- Free Transform works on shape and type layers and fits the content bounds.
- Quick Mask, channel views and clip textures were blank when the document width was not
  a multiple of 4 (single-channel texture row alignment).
- Dropdowns inside dialogs no longer open clipped inside the dialog; dialogs select their
  first field; Window ▸ Workspace ▸ Reset Essentials was shadowed by a duplicate command.
- Menus in Photoshop order and naming (File, Image ▸ Image Rotation, Window panels A–Z),
  blend modes in PS's grouped order, US spelling.
- Ctrl+2..6 switch channels (Ctrl+2 no longer zooms); Eraser paints the background color
  on the Background layer; Straighten crops to the largest clean rectangle; type layer
  names follow their text; cancelling a new fill layer removes it; an open pen path is
  never committed into another document; toolbar color swatches open the PS Color
  Picker; Paths ≡ Fill / Stroke Path open their dialogs; shootout gallery updates live.
## [0.1.0] - 2026-10-06

First usable release: a Photoshop 7-style editor with chainable AI on one document.

### Added
- **Engine** (TypeScript): document / layer / group model, straight-alpha RGBA8 rasters,
  soft 8-bit selections with boolean ops and feather, command-pattern history with a
  memory budget, viewport math, WebGL2 compositor with all 16 blend modes (Canvas 2D
  fallback), marching ants and pixel grid.
- **Shell**: custom dark title bar, menus, left toolbar with fly-outs, options bar,
  document tabs, dockable Layers / Properties / History / AI / AI History panels,
  command palette (Ctrl+K), toasts, context menu, keyboard shortcuts.
- **Tools**: Move, Rect / Ellipse Marquee, Lasso / Polygon Lasso, Magic Wand, Crop,
  Eyedropper, Brush, Eraser, Paint Bucket, Gradient, Clone Stamp, Text, Zoom, Hand;
  Shift / Alt selection modifiers.
- **Layers**: add / delete / duplicate / reorder / rename / visibility / lock / opacity /
  blend mode / merge down / merge visible / flatten / groups.
- **Adjustments & filters** with live preview: Brightness/Contrast, Levels,
  Hue/Saturation, Color Balance, Invert, Desaturate, Threshold, Posterize, Gaussian Blur,
  Motion Blur, Sharpen / Unsharp Mask, Add Noise, Pixelate.
- **Image**: Image Size, Canvas Size, rotate / flip canvas, Trim, Free Transform.
- **IO** (`pf-io`): open PNG / JPEG / WebP / GIF / BMP / TIFF / PSD (layers, groups,
  blend modes), `.pfproj` project format (ZIP + manifest, layers, selection, AI
  history, thumbnail), export PNG / JPEG / WebP, raw-bytes IPC, recent files,
  drag-drop, clipboard copy / paste.
- **AI** (`pf-ai`): `ImageProvider` trait with OpenAI (gpt-image), xAI (Grok Imagine)
  and Google (Gemini image) implementations, capability matrix, Tokio job queue with
  cancel / timeout / events, BYOK keys in the OS keychain (file fallback), typed error
  codes. UI: Generate / Mask edit (native on OpenAI, emulated elsewhere) / Instruct
  edit, reference images, variants, cost estimates, diff overlay, AI History with
  re-run / edit prompt / reveal.
- **Development**: `PF_AI_BASE_URL_{OPENAI,XAI,GEMINI}` overrides and
  `scripts/fake-ai-server.mjs` to exercise the whole AI pipeline offline.
- CI (fmt, clippy, cargo test, svelte-check, vitest) on Linux / Windows / macOS;
  release workflow building installers on `v*` tags.

### Known limitations
- No layer masks UI, adjustment layers, curves, editable text layers or PSD export yet.
- Subscription sign-in (ChatGPT / Grok / Gemini plans) is not supported; API keys only.
- Live provider calls were exercised only against the fake server in this release's QA.

[0.1.0]: https://github.com/pkircher29/pixelforge/releases/tag/v0.1.0
