# `app/src/lib/tools` — Interactive Canvas Tools & Brush Engine

Implementation of all Photoshop CC toolbar tools, the sampled-tip/dynamics brush engine, vector pen/shape tools, type sessions, and selection algorithms.

## Key Files & Subdirectories

| Path | Responsibility |
|---|---|
| `index.ts` | `TOOLS`, `HIDDEN_TOOLS`, `TOOL_GROUPS` (20 Photoshop CC toolbar slots), `toolbarSlots`, `getTool`, and `toolForKey` (single-key selection + `Shift+key` group cycling). |
| `types.ts` | `Tool`, `ToolContext`, `ToolEvent`, `ToolOption`, `ToolPreset`, and `SelectionMode` contracts. |
| `register.ts` | Registers `Type` menu commands, path fill/stroke commands (`path.fillDialog`, `path.strokeWithTool`), and selection-modification dialogs. |
| `move.ts` | `MoveTool` (`V`): layer/group/linked-layer translation, auto-select, and alignment helpers. |
| `marquee.ts`, `lasso.ts`, `magnetic-lasso.ts`, `quick-select.ts`, `wand.ts`, `selection-mod.ts`, `select-ops.ts`, `transform-selection.ts` | Selection tools (`M`, `L`, `W`), edge-following magnetic lasso (`edge-map.ts`), region-growing quick selection (`region-grow.ts`), color-range selection, and `Select > Transform Selection`. |
| `crop.ts` | `CropTool` (`C`) with aspect presets and horizon-line `Straighten` auto-crop. |
| `eyedropper.ts`, `measure.ts` | `EyedropperTool`, `ColorSamplerTool` (up to 4 persistent sample points in Info panel), and `RulerTool` (`I`) with `Straighten Layer`. |
| `healing.ts`, `heal.ts` | `SpotHealingTool`, `HealingBrushTool`, `PatchTool`, and `RedEyeTool` (`J`) using Laplacian/Poisson-style boundary blending. |
| `brush.ts`, `brush-base.ts`, `brush-engine.ts`, `brush-tips.ts`, `brush-presets.ts`, `brush-store.svelte.ts`, `color-replacement.ts` | `BrushTool`, `PencilTool`, and `ColorReplacementTool` (`B`) backed by a full dab/spacing/scattering/shape-dynamics/sampled-tip brush engine with ~30 presets. |
| `stamp.ts`, `patterns.ts` | `CloneStampTool` and `PatternStampTool` (`S`), plus `HistoryBrushTool` (`Y`) painting from the active History snapshot. |
| `erasers.ts` | `EraserTool`, `BackgroundEraserTool`, and `MagicEraserTool` (`E`). |
| `gradient.ts`, `gradient-model.ts`, `gradient-paint.ts`, `gradient-presets.ts`, `bucket.ts` | `GradientTool` (5 styles: linear, radial, angle, reflected, diamond) and `BucketTool` (`G`). |
| `retouch.ts`, `retouch-math.ts` | Local retouch brushes: `BlurTool`, `SharpenTool`, `SmudgeTool`, `DodgeBurnTool` (`dodge` / `burn`), and `SpongeTool` (`O`). |
| `pen.ts`, `path-select.ts`, `path-edit.ts`, `path-ops.ts`, `path-overlay.ts`, `work-path.ts` | `PenToolImpl`, `FreeformPenTool`, `AnchorEditTool` (`P`), `PathSelectionTool` / `DirectSelectionTool` (`A`), and live SVG path overlay rendering. |
| `type.ts`, `type-session.svelte.ts`, `text-session.ts`, `fonts.ts` | Horizontal/vertical editable `TypeTool` and type mask tools (`T`). |
| `shapes.ts`, `shape-geom.ts`, `custom-shapes.ts` | `ShapeTool` (`U`: Rectangle, Rounded Rectangle, Ellipse, Polygon, Line, and ~24 Custom Shapes in shape-layer, path, or pixel modes). |
| `navigate.ts` | `HandTool`, `RotateViewTool` (`H`), and `ZoomTool` (`Z`). |
| `paint-target.ts`, `rng.ts`, `util.ts` | Shared paint-target resolution (layer vs. layer mask vs. Quick Mask) and stroke utilities. |
| `paint/` | Low-level dab stamping (`dab.ts`), flood fill (`fill.ts`), polyline stroke interpolation (`stroke.ts`), and text helpers (`text.ts`). |
| `ui/` | Options-bar pickers and tool modals (`BrushPicker.svelte`, `GradientPicker.svelte`, `ShapePicker.svelte`, `PatternPicker.svelte`, `FontPicker.svelte`, `FillPicker.svelte`, `AlignButtons.svelte`, `TypeEditor.svelte`, `ColorRangeDialog.svelte`, `SelectionChannelDialog.svelte`). |
