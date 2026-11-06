# `app/src/lib/engine` — Pure-TypeScript Document & Compositor Engine

Core raster, vector, typography, layer-style, selection, channel, undo-history, and WebGL2 compositing engine. Contains **zero Svelte imports** so every module can be unit-tested directly under Vitest.

## Key Files & Subdirectories

| Path | Role |
|---|---|
| `index.ts` | Public barrel exporting all engine types, document helpers, commands, compositors, and ops. |
| `types.ts` | Domain model contracts: `Document`, `Layer` (`RasterLayer`, `GroupLayer`, `AdjustmentLayer`, `FillLayer`, `ShapeLayer`, `TextLayer`), `LayerEffects`, `BlendMode` (16 modes), `AlphaChannel`, `Path`, `QuickMask`, `Command`. |
| `document.ts` | Document & layer lifecycle (`createDocument`, `create*Layer`, `findLayer`, `addLayer`, `removeLayer`, `duplicateLayer`, `moveLayer`, `mergeDown`, `mergeVisible`, `flatten`, `groupLayers`, `compositeToRaster`, `rerasterizeShape`, `rerasterizeText`). |
| `raster.ts` | `Raster` class (straight-alpha RGBA8 `Uint8ClampedArray` pixel buffer with clone, crop, blit, resize, flip, rotate, and pixel accessors). |
| `rect.ts` | Immutable integer rectangle (`Rect`) and `Point` geometry helpers (`make`, `ofSize`, `intersect`, `union`, `isEmpty`, `clamp`). |
| `selection.ts` | 8-bit grayscale `Selection` mask (`0..255`) with boolean operations (`replace`, `add`, `subtract`, `intersect`), feather, expand/contract/border, invert, and bounding-box tracking. |
| `blend.ts` | All 16 Photoshop blend modes in both CPU (`blendRgb`, `compositeStraight`) and GLSL fragment shader (`BLEND_GLSL`) forms. |
| `layer-source.ts` | Resolves a layer's pixel source (`layerRaster`, `fillLayerRaster`), applies layer masks, and caches rendered `LayerEffects` via `StyleCache` (`docStyleCache`). |
| `locks.ts` | Enforces layer lock flags (`transparent`, `pixels`, `position`, `all`) and parent group locks (`isLayerEditable`, `assertEditable`, `applyTransparencyLock`). |
| `channels.ts` | Alpha channel management (`saveSelectionAsChannel`, `loadChannelAsSelection`), Quick Mask mode (`enterQuickMask`, `exitQuickMask`), and single-channel view rendering. |
| `history.ts` | Command-pattern undo/redo stack (`History`, `SnapshotCommand`) with command merging and a configurable byte budget (default 1 GB, oldest evicted). |
| `snapshot.ts` | Full-document state capture and restoration (`captureDocState`, `restoreDocState`) for History panel snapshots and the History Brush tool. |
| `viewport.ts` | Canvas pan, zoom (`MIN_ZOOM`..`MAX_ZOOM`, `ZOOM_STEPS`), rotation, and screen <-> document coordinate transforms (`Viewport`). |
| `commands/` | Undoable `Command` implementations for layers, paint strokes, selections, channels, canvas resizing/rotation, merging, and transforms. |
| `composite/` | WebGL2 hardware-accelerated layer compositor (`GlCompositor`) with dirty-rect texture uploads, Canvas 2D fallback (`CanvasCompositor`), and marching-ants renderer (`ants.ts`). |
| `ops/` | CPU and GLSL image adjustments/filters, Photoshop layer styles (`effects.ts`), solid/gradient/pattern fills (`fill.ts`), Bezier vector paths (`vector.ts`), text rasterization (`text.ts`), defringe/matting (`matting.ts`), and Euclidean distance transforms (`distance.ts`). |
| `demo/` | Standalone engine demo harness (`Demo.svelte`, `demo.ts`). |
