# `app/src/lib/filters/transform` — Free Transform & Auto-Trim

Interactive affine layer transformation (`Edit > Free Transform`, `Ctrl+T`) and transparent/corner-pixel auto-trimming (`Image > Trim`).

## Key Files

| File | Role |
|---|---|
| `session.svelte.ts` | `transformSession` reactive store managing the active Free Transform bounding box, pivot point, translation, scale, rotation, skew, live preview, commit (`Enter`), cancel (`Escape`), and `Transform > Again` (`Ctrl+Shift+T`). Supports raster, shape, and text layers. |
| `affine.ts`, `affine.worker.ts` | 2x3 affine matrix math (`invertAffine`, `composeAffine`, `transformBounds`) and bilinear/nearest-neighbor inverse-mapped raster resampling (`resampleAffine`). |
| `commands.ts` | Undoable commands applying an affine transform to raster layers (and linked layers/masks), shape paths, or text layers. |
| `trim.ts` | Computes the cropped canvas `Rect` (`trimRect`) by stripping edges matching either full transparency (`basis: "transparent"`) or the top-left/bottom-right corner color. |
