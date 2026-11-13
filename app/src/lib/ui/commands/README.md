# `app/src/lib/ui/commands` — Shell Menu & Keyboard Commands

Registers Pixelforge's top-level menu bar and keyboard-shortcut commands with `$lib/ui/registry.svelte.ts`.

## Key Files

| File | Menu / Domain |
|---|---|
| `index.ts` | Imports all command modules and re-exports `openPaths`, `closeDocument`, `newDocument`, `syncRecentCommands`, and `syncWindowPanelCommands`. |
| `file.ts` | `File` menu: New, Open, Open Recent (`syncRecentCommands`), Save, Save As, Export, Close, Close All. |
| `edit.ts` | `Edit` menu: Undo, Redo, Cut, Copy, Copy Merged, Paste, Paste in Place, Paste Into, Clear, Fill, Stroke, Preferences, Keyboard Shortcuts. |
| `layer.ts` | `Layer` menu & Layers panel `≡` menu (`LAYERS_PANEL_MENU_IDS`): New Layer, New Group, New Fill/Adjustment Layer, Duplicate, Delete, Rename, Layer Style, Layer Mask, Clipping Mask (`Ctrl+Alt+G`), Rasterize, Arrange, Group/Ungroup, Hide/Show, Lock, Link, Merge Down/Visible, Flatten, Matting (Defringe, Remove Black/White Matte). |
| `select.ts` | `Select` menu: All, Deselect, Reselect, Inverse, All Layers, Deselect Layers, Color Range, Modify (Border, Smooth, Expand, Contract, Feather), Transform Selection, Edit in Quick Mask Mode (`Q`), Load/Save Selection. |
| `view.ts`, `view-extras.svelte.ts`, `ViewExtrasOverlay.svelte` | `View`, `Image > Image Rotation`, `Window`, and `Help` menus: Zoom In/Out, Fit on Screen, 100%, Print Size, Flip/Rotate Canvas, Screen Mode (`F`), Extras (`Ctrl+H`), Show (Grid, Guides, Selection Edges), Rulers (`Ctrl+R`), Snap, Lock/Clear/New Guides, Workspace (`Reset Essentials`), panel toggles, and About Pixelforge. |
| `canvas-ops.ts`, `fill-stroke.ts` | Helper implementations for canvas rotation/flipping and Edit > Fill / Stroke execution. |
| `sample.ts` | `Help > Open Sample Document`: constructs the multi-layer showcase document (`buildSampleDocument`). |
