//! Settings commands (`settings_*`). Owned by the `ai-rust` wave; this scaffold ships one stub.

use tauri::State;

use crate::error::{CommandError, CommandResult};
use crate::state::{AppState, Settings};

/// Return the current settings.
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> CommandResult<Settings> {
    let guard = state
        .settings
        .lock()
        .map_err(|_| CommandError::poisoned("settings"))?;
    Ok(guard.clone())
}
