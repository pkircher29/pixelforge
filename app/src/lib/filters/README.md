# `app/src/lib/filters` — Filter & Transform Pipeline

Connects the pure operations in `$lib/engine` (`$lib/engine/ops`) to the interactive UI: live-preview modal dialogs, WebGL2/CPU execution against the active layer (respecting selections and transparency locks), Free Transform (`Ctrl+T`), and canvas trimming.

## Key Files & Subdirectories

| Path | Role |
|---|---|
| `register.ts` | Registers `Image > Adjustments`, `Filter`, `Edit > Free Transform`, `Image > Image Size…`, `Image > Canvas Size…`, `Image > Trim`, `Image > Image Rotation > Arbitrary…`, and layer flip/rotate commands; mounts `TransformOverlay`. |
| `index.ts` | Public barrel re-exporting filter operations from `$lib/engine`, `applyOp`, `applyOpToActiveLayer`, `lastFilter`, `transformSession`, `trimRect`, and `TransformOverlay`. |
| `apply.ts`, `applyToLayer.ts` | Applies an `OpDef` to a `Raster` or the active document layer (`applyOpToActiveLayer`), recording an undoable `PaintCommand` and updating `lastFilter`. |
| `gpu.ts` | WebGL2 multi-pass shader filter runner with automatic fallback to the CPU implementation in `$lib/engine`. |
| `lastFilter.ts` | Tracks the most recently executed filter and its parameters for `Filter > Last Filter` (`Ctrl+F`). |
| `transform/` | Interactive Free Transform session (`session.svelte.ts`), bilinear/nearest affine resampling (`affine.ts`, `affine.worker.ts`), transform commands (`commands.ts`), and transparent/corner-color auto-trim (`trim.ts`). |
| `ui/` | Filter UI controls (`Histogram.svelte`, `Slider.svelte`). |
| `demo/` | Standalone development filter playground (`FiltersDemo.svelte`, `Playground.svelte`, `index.html`, `main.ts`). |
