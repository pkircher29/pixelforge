# `app/src/lib/filters/ui` — Filter Dialog Controls & Rotate Canvas Dialog

UI primitives and modal host used by `app/src/lib/filters`.

## Key Files

| File | Role |
|---|---|
| `dialogHost.ts` | Imperative modal opener/closer (`openDialog`, `closeDialog`) mounting filter dialogs onto `document.body`. |
| `Modal.svelte` | Lightweight modal container for filter dialogs. |
| `Slider.svelte` | Labeled numeric range slider used in filter parameter forms. |
| `Histogram.svelte` | 256-bin luminance/RGB canvas histogram display used in `Levels` and `AdjustDialog`. |
| `RotateCanvasDialog.svelte` | `Image > Image Rotation > Arbitrary…` modal dialog (`-360°..360°`, clockwise/counter-clockwise). |
