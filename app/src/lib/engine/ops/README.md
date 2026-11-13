# `app/src/lib/engine/ops` — Adjustments, Filters, Layer Styles, Fills, Vectors & Text

Pure-TypeScript pixel, vector, and typography operations used by both the non-destructive document engine (adjustment layers, fill layers, shape layers, text layers, layer styles) and destructive filter commands (`app/src/lib/filters`).

## Key Files

| File | Responsibility |
|---|---|
| `index.ts` | Barrel re-exporting all operations, registries, and types. |
| `types.ts` | `OpDef`, `ParamDef`, `ParamValues`, `GlslPass`, and `CpuPixelFn` contracts for adjustments and filters. |
| `registry.ts` | Central registry of `ADJUSTMENT_OPS` (Brightness/Contrast, Levels, Hue/Saturation, Color Balance, Invert, Desaturate, Threshold, Posterize) and `FILTER_OPS` (Gaussian Blur, Motion Blur, Sharpen, Unsharp Mask, Add Noise, Pixelate) (`opById`, `registerOp`). |
| `brightnessContrast.ts`, `levels.ts`, `hueSaturation.ts`, `colorBalance.ts`, `simple.ts` | Color adjustment algorithms (CPU pixel functions + GLSL shader passes). |
| `blur.ts`, `sharpen.ts`, `noise.ts`, `pixelate.ts` | Spatial filter algorithms (separable Gaussian blur, directional motion blur, unsharp mask, seeded noise, mosaic pixelation). |
| `cpu.ts`, `glsl.ts`, `color.ts`, `histogram.ts`, `random.ts` | Shared CPU raster execution loop (selection-masked), GLSL fragment shader wrappers, RGB/HSL conversion math, 256-bin luminance/RGB histograms, and deterministic PRNG. |
| `effects.ts` | Photoshop layer style renderer (`renderLayerStyle`, `effectExtent`): Drop Shadow, Inner Shadow, Outer Glow, Inner Glow, Bevel & Emboss, Color Overlay, Gradient Overlay, and Stroke in Photoshop's compositing order. |
| `fill.ts` | Solid color, 5-style gradient (`linear`, `radial`, `angle`, `reflected`, `diamond`), and repeating RGBA pattern fill renderers (`renderFill`, `renderGradient`, `renderPattern`). |
| `vector.ts` | Cubic Bezier path geometry, subpath flattening, winding/even-odd scanline coverage (`pathCoverage`, `fillPathToRaster`), stroke outlines (`strokePathToRaster`), marching-squares mask-to-path tracing (`selectionToPath`), and anchor hit-testing. |
| `text.ts` | Offscreen Canvas 2D horizontal/vertical typography layout and rasterization (`rasterizeText`, `textBounds`, `textLines`). |
| `distance.ts` | Linear-time 2D squared Euclidean distance transform (`distanceTransformSquared`) and morphological dilation/erosion/blur used by layer styles and strokes. |
| `matting.ts` | Layer edge matting operations (`defringe`, `removeMatte` for black/white matte removal). |
