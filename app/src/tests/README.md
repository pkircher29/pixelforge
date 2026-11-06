# `app/src/tests` — Vitest Frontend Test Suite

Unit and integration tests for the Pixelforge webview engine, tools, filters, IO conversion, AI pipeline, panels, and UI shell. Executed via `npm test` (`vitest run`).

## Test Suites

| Path | Coverage |
|---|---|
| `engine/` | `Raster`, `Rect`, `Selection`, all 16 blend modes (`blend.test.ts`), `Document` & format-2 layers (`document.test.ts`, `layers-v2.test.ts`), `LayerEffects` & `StyleCache` (`effects.test.ts`, `doc-style-cache.test.ts`), alpha channels & Quick Mask (`channels.test.ts`), Bezier paths (`paths.test.ts`), `History` & snapshots (`history.test.ts`, `snapshots.test.ts`), WebGL2/Canvas2D compositors (`composite.test.ts`, `gl-v2.test.ts`), `.pfproj` v2 serialization (`serialize-v2.test.ts`), type layer naming (`type-name.test.ts`), and `Viewport` (`viewport.test.ts`). |
| `tools/` | Brush engine & presets (`brush-engine.test.ts`), crop & straighten (`crop-straighten.test.ts`), healing & retouch tools (`heal-retouch.test.ts`), selection tools (`selection-tools.test.ts`), type/gradient/measure tools (`text-gradient-measure.test.ts`), and vector pen/shape tools (`vector.test.ts`). |
| `filters/` | Affine Free Transform (`affine.test.ts`), filter application (`apply.test.ts`), canvas size/rotation (`canvas.test.ts`), GLSL shader generation (`glsl.test.ts`), histograms (`histogram.test.ts`), and adjustment/filter ops (`ops.test.ts`). |
| `ai/` | IPC client & binary framing (`client.test.ts`), diff overlay (`diff.test.ts`), error mapping & pricing (`errors-pricing.test.ts`), `.pfproj` AI history (`history.test.ts`), job store (`jobs.test.ts`), mask emulation modes (`modes.test.ts`), OAuth store/UI (`oauth.test.ts`), provider picker (`picker.test.ts`, `providers.test.ts`), end-to-end AI run pipeline (`run.test.ts`), and multi-model shootout (`shootout.test.ts`). |
| `layers/` | Channels & paths (`channels-paths.test.ts`), Layer menu commands (`layer-menu.test.ts`), Layer Style dialog model (`layer-style.test.ts`), Properties panel (`properties.test.ts`), layer drag-reorder (`reorder.test.ts`), Layers panel rows (`rows.test.ts`), and layer selection (`selection.test.ts`). |
| `panels/` | Color model (`color-model.test.ts`), Fill/Stroke dialogs (`fill-stroke.test.ts`), History panel (`history.test.ts`), Info panel (`info.test.ts`), Navigator math (`navigator.test.ts`), Swatches (`swatches.test.ts`), and View menu (`view-menu.test.ts`). |
| `ui/` | Vector icon set (`icons.test.ts`), menu bar structure (`menu.test.ts`), scrubby sliders (`scrubby.test.ts`), window title/status bar (`status-title.test.ts`), toolbar slot groups (`tool-groups.test.ts`), and workspace layout (`workspace.test.ts`). |
| `fit.test.ts`, `io.test.ts`, `menu.test.ts`, `shortcuts.test.ts`, `stores.test.ts`, `tools.test.ts` | Top-level integration tests for viewport fitting, `.pfproj` / IPC frame round-trips, menu commands, keyboard accelerators, Svelte 5 stores, and tool switching. |
