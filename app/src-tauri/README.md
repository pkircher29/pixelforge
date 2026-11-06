# `app/src-tauri` — Tauri 2 Desktop Host

Rust crate (`pixelforge` / `pixelforge_lib`) providing the native desktop window, Tauri plugin registration (`dialog`, `fs`, `clipboard-manager`, `opener`, `window-state`), process-wide `AppState`, and IPC command handlers. Enforces `#![forbid(unsafe_code)]`.

## Key Files

| Path | Role |
|---|---|
| `Cargo.toml` | Package manifest linking `pf-ai`, `pf-io`, and Tauri 2 plugins. |
| `build.rs` | Standard `tauri_build::build()` build script (embeds `../dist`). |
| `tauri.conf.json` | Cross-platform Tauri configuration (`com.pixelforge.app`, frameless window `decorations: false`, strict CSP, bundle targets). |
| `tauri.macos.conf.json` | macOS-specific overlay (`decorations: true`, `titleBarStyle: "Overlay"` for native traffic-light window controls). |
| `capabilities/default.json` | Tauri v2 capability permissions for the `main` window. |
| `icons/` | Application icons across Windows (`.ico`, AppX Square logos), macOS (`.icns`), and Linux (`.png`). |
| `src/` | Rust source modules (`main.rs`, `lib.rs`, `state.rs`, `error.rs`, and `commands/`). |
