# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
