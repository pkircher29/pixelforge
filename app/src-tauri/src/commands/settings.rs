//! Settings commands (`settings_*`): general preferences in `settings.json` and API keys
//! in the OS keychain (file fallback). See `docs/ipc.md` for the contract.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use pf_ai::{AutoKeyStore, KeyStore, ProviderId, SecretString};
use tauri::{AppHandle, Manager, State};

use crate::error::{CommandError, CommandResult};
use crate::state::{AppState, Settings};

/// File name of the general preferences inside the app config directory.
pub const SETTINGS_FILE: &str = "settings.json";

/// The per-user config directory (`%APPDATA%\com.pixelforge.app` on Windows, ...).
pub fn config_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path().app_config_dir().map_err(|e| {
        CommandError::new(
            "config_dir",
            format!("cannot resolve the app config directory: {e}"),
        )
    })
}

fn settings_path(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(config_dir(app)?.join(SETTINGS_FILE))
}

/// Read `settings.json` into memory once per process.
fn ensure_loaded(app: &AppHandle, state: &AppState) -> CommandResult<()> {
    if state.settings_loaded.load(Ordering::Acquire) {
        return Ok(());
    }
    let path = settings_path(app)?;
    let loaded = match std::fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice::<Settings>(&bytes) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!("ignoring unreadable {}: {e}", path.display());
                None
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let mut guard = state
        .settings
        .lock()
        .map_err(|_| CommandError::poisoned("settings"))?;
    if let Some(s) = loaded {
        *guard = s;
    }
    state.settings_loaded.store(true, Ordering::Release);
    Ok(())
}

/// Write atomically (temp file + rename) so a crash never leaves a half-written file.
fn persist(app: &AppHandle, settings: &Settings) -> CommandResult<()> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(settings)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Return the current settings (loaded from disk on first call).
#[tauri::command]
pub fn settings_get(app: AppHandle, state: State<'_, AppState>) -> CommandResult<Settings> {
    ensure_loaded(&app, &state)?;
    let guard = state
        .settings
        .lock()
        .map_err(|_| CommandError::poisoned("settings"))?;
    Ok(guard.clone())
}

/// Replace the settings wholesale and persist them. Returns what was stored.
#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> CommandResult<Settings> {
    ensure_loaded(&app, &state)?;
    persist(&app, &settings)?;
    let mut guard = state
        .settings
        .lock()
        .map_err(|_| CommandError::poisoned("settings"))?;
    *guard = settings;
    Ok(guard.clone())
}

// ---------------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------------

/// The process-wide key store.
pub(crate) fn key_store(app: &AppHandle, state: &AppState) -> CommandResult<Arc<AutoKeyStore>> {
    Ok(state.key_store(&config_dir(app)?))
}

/// Fetch the key for `provider` off the async runtime, or `ai_not_configured`.
pub(crate) async fn load_key(
    store: Arc<AutoKeyStore>,
    provider: ProviderId,
) -> CommandResult<SecretString> {
    let key = tauri::async_runtime::spawn_blocking(move || store.get(provider)).await??;
    key.filter(|k| !k.is_empty())
        .ok_or_else(|| pf_ai::Error::NotConfigured(provider).into())
}

/// Reject obviously broken keys (paste errors) before they hit the keychain.
pub(crate) fn validate_key(raw: &str) -> CommandResult<SecretString> {
    let key = raw.trim();
    if key.is_empty() {
        return Err(CommandError::new(
            "settings_key_empty",
            "the API key is empty",
        ));
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(CommandError::new(
            "settings_key_invalid",
            "the API key contains whitespace or control characters; check the paste",
        ));
    }
    if key.len() > 4096 {
        return Err(CommandError::new(
            "settings_key_invalid",
            "the API key is implausibly long",
        ));
    }
    Ok(SecretString::new(key))
}

/// `{ "open_ai": true, "x_ai": false, "gemini": true }`.
#[tauri::command]
pub async fn settings_get_key_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<HashMap<ProviderId, bool>> {
    let store = key_store(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = HashMap::with_capacity(ProviderId::ALL.len());
        for id in ProviderId::ALL {
            // A keychain hiccup on one provider should not hide the others.
            let has = store.has(id).unwrap_or_else(|e| {
                tracing::warn!("key status for {id}: {e}");
                false
            });
            out.insert(id, has);
        }
        out
    })
    .await
    .map_err(CommandError::from)
}

/// Store (or replace) a provider's API key. The value never crosses back to the UI.
#[tauri::command]
pub async fn settings_set_key(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
    key: String,
) -> CommandResult<()> {
    let secret = validate_key(&key)?;
    let store = key_store(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || store.set(provider, &secret)).await??;
    tracing::info!("stored API key for {provider}");
    Ok(())
}

/// Remove a provider's API key.
#[tauri::command]
pub async fn settings_delete_key(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
) -> CommandResult<()> {
    let store = key_store(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || store.delete(provider)).await??;
    tracing::info!("deleted API key for {provider}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_validation() {
        assert_eq!(
            validate_key("  sk-abc  ").expect("trimmed").expose(),
            "sk-abc"
        );
        assert_eq!(
            validate_key("").expect_err("empty").code,
            "settings_key_empty"
        );
        assert_eq!(
            validate_key("sk-a b").expect_err("space").code,
            "settings_key_invalid"
        );
        assert_eq!(
            validate_key("sk-a\nb").expect_err("newline").code,
            "settings_key_invalid"
        );
        assert_eq!(
            validate_key(&"x".repeat(5000)).expect_err("long").code,
            "settings_key_invalid"
        );
    }

    #[test]
    fn key_status_map_serializes_with_provider_ids_as_keys() {
        let mut m = HashMap::new();
        m.insert(ProviderId::OpenAi, true);
        m.insert(ProviderId::Gemini, false);
        let v = serde_json::to_value(&m).expect("serialize");
        assert_eq!(v["open_ai"], true);
        assert_eq!(v["gemini"], false);
    }
}
