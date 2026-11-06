# `app` — Pixelforge Frontend & Tauri Desktop Package

Workspace package (`@pixelforge/app`) containing the Svelte 5 / TypeScript / WebGL2 webview application (`src/`) and the Tauri 2 Rust desktop host (`src-tauri/`).

## Scripts

Run from the repository root (`npm run <script>`) or inside `app/`:
- `npm run dev` — Start the Vite dev server on `http://localhost:1420`.
- `npm run build` — Build production webview assets into `app/dist/` (required before running `cargo test` or `cargo clippy` directly).
- `npm run check` — Run `svelte-check --tsconfig ./tsconfig.json`.
- `npm test` — Run the Vitest unit and integration test suite (`vitest run`).
- `npm run tauri` — Invoke the Tauri 2 CLI (`tauri dev`, `tauri build`).

## Directory Structure

| Path | Role |
|---|---|
| `index.html` | HTML shell mounting `#app` via `src/main.ts`. |
| `src/` | Svelte 5 UI, runes stores, pure-TypeScript document/compositor engine, tools, filters, IO/AI IPC clients, and Vitest test suite. |
| `src-tauri/` | Tauri 2 Rust binary/library crate (`pixelforge` / `pixelforge_lib`), IPC command handlers, application state, and bundle configuration. |
