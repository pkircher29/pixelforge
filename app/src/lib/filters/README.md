# `app/src/lib/filters` — Filter & Transform Pipeline

Connects the pure operations in `$lib/engine/ops` to the interactive UI: live-preview modal dialogs, WebGL2/CPU execution against the active layer (respecting selections and transparency locks), Free Transform (`Ctrl+T`), and canvas trimming.

## Key Files & Subdirectories

| Path | Role |
|---|---|
| `register.ts` | Registers `Image > Adjustments`, `Filter`, `Edit > Free Transform`, `Image > Image Size…`, `Image > Canvas Size…`, `Image > Trim`, `Image > Image Rotation > Arbitrary…`, and layer flip/rotate commands; mounts `TransformOverlay`. |
| `types.ts`, `ops/` | Filter operation descriptors, default parameter helpers (`defaultParams`), and command-id mapping (`commandIdFor`). |
| `apply.ts`, `applyToLayer.ts` | Applies an `OpDef` to a `Raster` or the active document layer (`applyOpToActiveLayer`), recording an undoable `PaintCommand` and updating `lastFilter`. |
| `gpu.ts`, `cpu.ts` | WebGL2 multi-pass shader filter runner with transparent fallback to the CPU implementation in `$lib/engine/ops`. |
| `lastFilter.ts` | Tracks the most recently executed filter and its parameters for `Filter > Last Filter` (`Ctrl+F`). |
| `raw.ts` | Returns a view of the active document stripped of transient AI diff overlays (`rawDoc`). |
| `histogram.ts`, `random.ts` | Re-exports histogram and PRNG utilities from `$lib/engine/ops`. |
| `transform/` | Interactive Free Transform session (`session.svelte.ts`), bilinear/nearest affine resampling (`affine.ts`, `affine.worker.ts`), transform commands (`commands.ts`), and transparent/corner-color auto-trim (`trim.ts`). |
| `ui/` | Filter modal host (`dialogHost.ts`, `Modal.svelte`), `Histogram.svelte`, `Slider.svelte`, and `RotateCanvasDialog.svelte`. |
| `demo/` | Standalone filter playground (`FiltersDemo.svelte`, `Playground.svelte`). |
