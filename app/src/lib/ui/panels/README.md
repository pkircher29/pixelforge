# `app/src/lib/ui/panels` — Dockable Workspace Panels

Svelte 5 components, view models, and runes stores for Pixelforge's 15 dockable panels.

## Panel Inventory

| Panel | Component | Backing Store / Model |
|---|---|---|
| **Layers** | `LayersPanel.svelte`, `LayerThumb.svelte`, `LayersPanelOptionsDialog.svelte` | `Layers.store.svelte.ts`, `Layers.model.ts`, `layer-reorder.ts`, `thumbnail.ts` |
| **Channels** | `ChannelsPanel.svelte`, `ChannelsOptionsDialog.svelte` | `Channels.model.ts`, `Channels.commands.ts` |
| **Paths** | `PathsPanel.svelte`, `PathsMakeSelectionDialog.svelte` | `Paths.model.ts`, `Paths.commands.ts` |
| **Properties** | `PropertiesPanel.svelte` | `Properties.model.ts` (live adjustment-layer, fill-layer, shape-layer, type-layer, mask, and document properties) |
| **Color** | `ColorPanel.svelte`, `ColorCube.svelte` | `Color.store.svelte.ts`, `color-model.ts` (HSB/RGB sliders + hue cube) |
| **Swatches** | `SwatchesPanel.svelte` | `Swatches.store.svelte.ts`, `Swatches.io.ts`, `swatch-defaults.ts` |
| **Navigator** | `NavigatorPanel.svelte` | `Navigator.store.svelte.ts`, `navigator-math.ts` (GPU composite thumbnail + pan/zoom box) |
| **Info** | `InfoPanel.svelte` | `Info.store.svelte.ts`, `info-model.ts` (cursor RGB/HSB/X/Y/W/H + up to 4 color samplers + ruler readout) |
| **History** | `HistoryPanel.svelte`, `HistorySnapshotDialog.svelte`, `HistoryOptionsDialog.svelte` | `History.store.svelte.ts`, `History.model.ts`, `History.commands.ts` (undo states, snapshots, History Brush source) |
| **Brush Settings & Brushes** | `BrushSettingsPanel.svelte`, `BrushesPanel.svelte` | `$lib/tools/brush-store.svelte.ts` (tip shape, spacing, scattering, shape dynamics, presets) |
| **Character & Paragraph** | `CharacterPanel.svelte`, `ParagraphPanel.svelte` | `$lib/tools/type-session.svelte.ts` (font family, size, leading, tracking, bold/italic, alignment) |
| **AI & AI History** | `AiPanel.svelte`, `AiHistoryPanel.svelte` | `$lib/ai/ui.svelte.ts`, `$lib/ai/*` |

## Registration

- `register.ts` and `register-panels-v2.ts` register all core panels and their `≡` panel menus with `$lib/ui/registry.svelte.ts`.
- `$lib/ai/register.ts` registers the `AI` and `AI History` panels.
