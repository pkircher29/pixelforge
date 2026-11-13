# `app/src/lib/tools/ui` — Tool Options Bar Pickers & Modals

Svelte 5 popovers, pickers, overlays, and dialogs mounted from the tool Options Bar (`OptionsBar.svelte`) or `Select` / `Type` menus.

## Key Files

| File | Role |
|---|---|
| `BrushPicker.svelte`, `brush-thumb.ts` | Brush preset selector, size/hardness sliders, and live stroke-preview thumbnail renderer. |
| `GradientPicker.svelte`, `gradient-draw.ts` | Gradient preset dropdown and canvas preview swatch; opens `GradientEditorDialog` on click. |
| `ShapePicker.svelte` | Custom shape (`~24` vector shapes) grid picker for the Custom Shape tool. |
| `PatternPicker.svelte` | Repeating pattern tile picker for the Pattern Stamp tool and Fill dialogs. |
| `FontPicker.svelte`, `TypeEditor.svelte`, `type-target.svelte.ts` | Font family selector and on-canvas interactive text-editing overlay for `TypeTool`. |
| `FillPicker.svelte` | Solid / gradient / none fill & stroke swatch popover for vector shape tools. |
| `AlignButtons.svelte` | Layer alignment and distribution buttons shown in the Move tool options bar. |
| `MeasureReadout.svelte` | Options-bar readout (`X`, `Y`, `W`, `H`, `A`, `D1`, `D2`, `Clear`, `Straighten Layer`) for `RulerTool`. |
| `CustomOption.svelte` | Dynamic host mounting custom options-bar widgets declared by a `Tool`. |
| `ColorRangeDialog.svelte`, `SelectionChannelDialog.svelte` | Modal dialogs for `Select > Color Range…` and `Select > Load/Save Selection…`. |
