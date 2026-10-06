//! Pixelforge desktop shell.
//!
//! Registers the Tauri plugins, the shared [`state::AppState`] and the `commands::*`
//! IPC surface. Pixel data never lives here (see `docs/architecture.md`): the commands
//! are thin adapters over `pf-ai` and `pf-io` that move raw bytes in and out of the
//! webview and translate errors into `{ code, message }`.

#![forbid(unsafe_code)]

pub mod commands;
pub mod error;
pub mod state;

pub use error::{CommandError, CommandResult};
pub use state::AppState;

/// Build and run the Tauri application.
///
/// Called from `main.rs` (desktop) and, in the future, from the mobile entry points.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_list_providers,
            commands::io::io_ping,
            commands::settings::settings_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pixelforge");
}
