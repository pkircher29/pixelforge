# `app/src/lib/ui/canvas` — Canvas Viewport Host & Fit Helpers

Coordinates pointer, wheel, and keyboard interaction between `CanvasView.svelte`, the active `Viewport`, and the active `Tool`.

## Key Files

| File | Role |
|---|---|
| `host.svelte.ts` | `canvasHost` singleton: routes pointer down/move/up, spacebar temporary-hand panning, wheel zoom/scroll, tool shortcut keys (`handleToolKey`), and tool overlays (`activeTool`, `activateTool`, `cancelTool`). |
| `fit.ts` | Pure viewport-fit calculations (`fitZoom`, `centerPan`) used when opening or resizing documents. |
| `checkerboard.ts` | Transparency checkerboard tile colors and size presets (Small, Medium, Large, None; Light, Medium, Dark) driven by Preferences. |
