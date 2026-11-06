# `app/src/lib/filters/ops` — Filter Registry Re-Exports

Thin wrappers and re-exports over `$lib/engine/ops` used by the `app/src/lib/filters` module, adding menu command ID helpers (`commandIdFor`).

## Key Files

| File | Role |
|---|---|
| `index.ts` | Exports `ADJUSTMENT_OPS`, `FILTER_OPS`, `ALL_OPS`, `opById`, `registerOp`, and `commandIdFor(op)`. |
| `brightnessContrast.ts`, `levels.ts`, `hueSaturation.ts`, `colorBalance.ts`, `simple.ts`, `blur.ts`, `sharpen.ts`, `noise.ts`, `pixelate.ts`, `color.ts` | Re-export the corresponding operation definitions and math helpers from `$lib/engine/ops`. |
