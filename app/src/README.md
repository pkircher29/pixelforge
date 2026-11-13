# `app/src` — Svelte 5 Webview Application Root

Root source directory for the Pixelforge webview frontend.

## Key Files & Subdirectories

| Path | Role |
|---|---|
| `main.ts` | Mounts `App.svelte` onto `#app` and disables the browser context menu in production builds. |
| `App.svelte` | Top-level application layout (`TitleBar`, `Toolbar`, `OptionsBar`, `DocTabs`, `CanvasView`, `Dock`, `StatusBar`, `CommandPalette`, `ContextMenu`, `DialogHost`, `Toast`), keyboard shortcut installer, Tauri file drag-and-drop listener, and `?icons` contact-sheet route in dev mode (`http://localhost:1420/?icons`). |
| `app.css` | Global CSS reset and Photoshop CC medium-dark / light theme custom properties (`--ps-*`, typography, layout dimensions). |
| `vite-env.d.ts` | Vite client TypeScript ambient declarations. |
| `lib/` | Core engine, tools, filters, AI/IO IPC clients, runes stores, and UI components. |
| `tests/` | Vitest unit and integration test suites mirroring `lib/`. |
