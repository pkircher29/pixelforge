# `app/src-tauri/src` — Tauri Shell Core & State

Rust entry points and shared state for the Pixelforge desktop application.

## Key Files

| File / Directory | Role |
|---|---|
| `main.rs` | Binary entry point (`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`) calling `pixelforge_lib::run()`. |
| `lib.rs` | Registers Tauri plugins (`dialog`, `fs`, `clipboard_manager`, `opener`, desktop `window_state`), manages `AppState`, and registers all 38 `#[tauri::command]` handlers. |
| `state.rs` | `AppState` (lazy `AutoKeyStore` and `CustomRegistry`, `JobManager`, `Settings` mutex, `oauth_pending`, `oauth_sessions`) and `Settings` schema (`settings.json` with forward-compatible `extra` map). |
| `error.rs` | `CommandError` (`{ code, message }`) and `CommandResult<T>` conversions from `pf_ai::Error`, `pf_io::Error`, `std::io::Error`, `serde_json::Error`, and `tauri::Error`. |
| `commands/` | Tauri IPC command modules (`ai.rs`, `io.rs`, `oauth.rs`, `settings.rs`). |
