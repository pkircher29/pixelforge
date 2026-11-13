# `app/src/lib` — Frontend Modules & Engine Library

Aliases to `$lib` in Vite/TypeScript. Contains the pure-TypeScript image engine, interactive tools, adjustments/filters, AI and IO IPC clients, Svelte 5 runes stores, and UI components.

## Subdirectories & Files

| Path | Responsibility |
|---|---|
| `shortcuts.ts` | Cross-platform keyboard accelerator parser, matcher (`CmdOrCtrl`, macOS symbol formatting), and global `keydown`/`keyup` dispatcher (`installShortcuts`). |
| `engine/` | Pure-TypeScript document, layer, raster, selection, channel, path, undo history, viewport, layer-style/vector/text ops, and WebGL2/Canvas2D compositors (zero Svelte imports). |
| `stores/` | Svelte 5 runes stores (`doc.svelte.ts`, `tool.svelte.ts`, `settings.svelte.ts`, `ui.svelte.ts`, `toast.svelte.ts`). |
| `tools/` | Interactive canvas tools (Move, Marquee, Lasso, Quick Selection, Magic Wand, Crop, Eyedropper/Sampler/Ruler, Healing/Patch/Red Eye, Brush/Pencil/Color Replacement, Stamp/History Brush, Erasers, Gradient/Bucket, Blur/Sharpen/Smudge/Dodge/Burn/Sponge, Pen/Path, Type, Shapes, Hand/Rotate/Zoom, Transform Selection). |
| `filters/` | Destructive & adjustment-layer image operations, WebGL2/CPU execution pipeline, affine Free Transform (`Ctrl+T`), and filter dialogs. |
| `ai/` | AI provider picker, job queue store, mask-emulation crop/composite pipeline, multi-model shootout, prompt assist, subscription OAuth client, diff overlay, and `.pfproj` AI history. |
| `io/` | Binary IPC frame codec (`frame.ts`), `.pfproj` v2 <-> engine `Document` converter (`convert.ts`), file open/save/export wrappers (`files.ts`), and clipboard integration (`clipboard.ts`). |
| `ui/` | Photoshop CC shell components, dockable panels, modal dialogs, menus, custom controls, and vector icon set. |
