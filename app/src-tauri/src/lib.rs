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
            commands::ai::ai_submit_generate,
            commands::ai::ai_submit_edit,
            commands::ai::ai_job_status,
            commands::ai::ai_cancel,
            commands::ai::ai_take_result,
            commands::ai::ai_test_key,
            commands::ai::ai_custom_kinds,
            commands::ai::ai_custom_list,
            commands::ai::ai_custom_add,
            commands::ai::ai_custom_update,
            commands::ai::ai_custom_remove,
            commands::ai::ai_custom_probe,
            commands::ai::ai_prompt_assist,
            commands::ai::ai_hub_search,
            commands::ai::ai_comfy_templates,
            commands::io::io_ping,
            commands::io::io_open,
            commands::io::io_decode,
            commands::io::io_open_pfproj,
            commands::io::io_save_pfproj,
            commands::io::io_export,
            commands::io::io_encode,
            commands::io::io_thumbnail,
            commands::io::io_recent_list,
            commands::io::io_recent_add,
            commands::io::io_recent_remove,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_get_key_status,
            commands::settings::settings_set_key,
            commands::settings::settings_delete_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pixelforge");
}
