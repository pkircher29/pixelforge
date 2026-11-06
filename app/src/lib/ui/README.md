# `app/src/lib/ui` — Photoshop CC Shell, Panels, Dialogs, Menus & Icons

User interface components, command/panel registry, menus, dockable panel system, modal dialogs, and vector icon set.

## Key Files & Subdirectories

| Path | Responsibility |
|---|---|
| `TitleBar.svelte`, `MenuBar.svelte`, `MenuList.svelte`, `menu.ts`, `doc-title.ts` | Custom frameless window title bar (`data-tauri-drag-region`), native window controls, and Photoshop-ordered hierarchical menu bar (`File`, `Edit`, `Image`, `Layer`, `Type`, `Select`, `Filter`, `AI`, `View`, `Window`, `Help`). |
| `Toolbar.svelte`, `OptionsBar.svelte` | Single-column 20-slot Photoshop CC toolbar with right-click/long-press fly-outs, foreground/background color swatches, Quick Mask toggle, and context-sensitive tool options bar. |
| `DocTabs.svelte`, `CanvasView.svelte`, `Welcome.svelte`, `rulers.ts` | Document tab strip, interactive WebGL2/Canvas2D viewport surface with rulers/guides/overlays, and empty-state welcome screen. |
| `Dock.svelte` | Right-hand collapsible multi-tab panel dock with panel `≡` menus and `Essentials` workspace layout. |
| `StatusBar.svelte`, `status-info.ts` | Bottom status bar with zoom scrubby control and document info popover (dimensions, memory usage, active tool hint). |
| `CommandPalette.svelte`, `fuzzy.ts` | `Ctrl+K` fuzzy-searchable command palette reaching every registered menu item, tool, and panel command. |
| `ContextMenu.svelte`, `context-menu.svelte.ts`, `Toast.svelte` | Custom context menu host and toast notification overlay. |
| `registry.svelte.ts`, `shell-commands.ts` | Reactive command and panel registry (`registerCommand`, `registerCommands`, `registerPanel`, `getCommands`, `getPanels`). |
| `canvas/` | `canvasHost` (`host.svelte.ts`) routing pointer/keyboard events to the active tool, `fit.ts` viewport fitting math, and `checkerboard.ts`. |
| `commands/` | Shell command definitions for `File`, `Edit`, `Image`, `Layer`, `Select`, `View`, and `Help > Open Sample Document` (`sample.ts`). |
| `controls/` | Reusable Photoshop-styled UI controls (`Popover.svelte`, `PsSelect.svelte`, `ScrubbyNumber.svelte`, `Segmented.svelte`). |
| `dialogs/` | Modal dialog framework (`Dialog.svelte`, `DialogHost.svelte`, `dialogs.svelte.ts`) and 25+ application dialogs (`NewDocDialog`, `ExportDialog`, `LayerStyleDialog`, `AiProvidersDialog`, `AiShootoutDialog`, `ColorPickerDialog`, `GradientEditorDialog`, `PreferencesDialog`, etc.). |
| `icons/` | Custom single-weight SVG icon set (`icons.ts`, `Icon.svelte`, `ContactSheet.svelte`). |
| `panels/` | All 15 dockable panels (`LayersPanel`, `ChannelsPanel`, `PathsPanel`, `PropertiesPanel`, `ColorPanel`, `SwatchesPanel`, `NavigatorPanel`, `InfoPanel`, `HistoryPanel`, `BrushSettingsPanel`, `BrushesPanel`, `CharacterPanel`, `ParagraphPanel`, `AiPanel`, `AiHistoryPanel`) and their backing stores/models. |
