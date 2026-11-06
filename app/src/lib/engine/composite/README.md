# `app/src/lib/engine/composite` — WebGL2 & Canvas 2D Compositors

Real-time layer compositing, viewport rendering, pixel grid, and marching-ants selection outlines.

## Key Files

| File | Role |
|---|---|
| `index.ts` | `createCompositor(canvas)` factory (prefers `GlCompositor`, falls back to `CanvasCompositor` when WebGL2 is unavailable) and `Compositor` interface. |
| `GlCompositor.ts` | WebGL2 compositor: maintains per-layer RGBA8 textures, re-uploads only dirty rectangles (`DirtyTracker`), executes per-blend-mode fragment shaders, handles group isolation (`passThrough: false`), clipping masks (`clipToBelow`), layer masks, Quick Mask / channel views, checkerboard background, and viewport pan/zoom/rotation. |
| `CanvasCompositor.ts` | CPU/Canvas 2D fallback compositor sharing the same `Compositor` interface and `StyleCache` for environments without WebGL2 (such as jsdom unit tests). |
| `shaders.ts` | WebGL2 vertex and fragment shader sources for layer blending, checkerboard background, pixel grid, and marching ants. |
| `gl.ts` | Low-level WebGL2 shader compilation, program linking, texture creation (`UNPACK_ALIGNMENT = 1` for arbitrary widths), and framebuffer helpers. |
| `dirty.ts` | `DirtyTracker` accumulating per-layer dirty `Rect` regions between frames. |
| `ants.ts` | Extracts selection contour edges (`buildMarchingAntsSegments`) for animated marching-ants rendering. |
