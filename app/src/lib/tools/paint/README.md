# `app/src/lib/tools/paint` — Low-Level Paint & Stroke Primitives

Pure-TypeScript raster painting primitives shared by brush, pencil, eraser, stamp, retouch, bucket, and text tools.

## Key Files

| File | Role |
|---|---|
| `dab.ts` | Soft/hard circular and sampled-tip brush dab generation and alpha-blended stamping onto a `Raster`. |
| `stroke.ts` | Polyline stroke interpolation spacing dabs evenly along pointer movement segments. |
| `fill.ts` | Contiguous (4-connected flood fill) and non-contiguous tolerance-based color fill (`floodFill`). |
| `text.ts` | Text-layer/mask rasterization helpers bridging `$lib/engine/ops/text.ts` with the active tool target. |
