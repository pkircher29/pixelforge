# `app/src/lib/ui/icons` — Custom Single-Weight Vector Icon Set

Custom SVG icon definitions and rendering components for tools, panels, layer badges, and UI controls.

## Key Files

| File | Role |
|---|---|
| `icons.ts` | Dictionary of named SVG path/element definitions (`ICONS`, `IconName`, `hasIcon`, `iconPaths`) covering all 20 toolbar groups, sub-tools, panel tabs, and layer controls. |
| `Icon.svelte` | Renders a named glyph from `icons.ts` at a configurable pixel size and stroke weight. |
| `ContactSheet.svelte` | Dev-mode visual catalog (`http://localhost:1420/?icons`) rendering every registered icon for QA inspection. |
| `index.ts` | Barrel re-exporting `Icon.svelte` and `icons.ts` helpers. |
