//! Process-wide state shared by commands via `tauri::State<AppState>`.

use std::fmt;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

use pf_ai::{AutoKeyStore, JobManager, KeyStore, ProviderId};
use serde::{Deserialize, Serialize};

/// User settings, persisted as `settings.json` in the app config directory by the
/// `settings_*` commands. Unknown keys round-trip through `extra` so other modules
/// (and newer builds) can stash preferences without a schema change here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// UI theme id. Only `"dark"` exists in v1.
    pub theme: String,
    /// Provider pre-selected in the AI panel.
    pub default_provider: Option<ProviderId>,
    /// Undo memory budget in megabytes (PLAN.md section 0: default 1 GB).
    pub history_budget_mb: u32,
    /// Recently opened files, most recent first.
    pub recent_files: Vec<String>,
    /// Any other preference the UI wants to keep (free-form JSON).
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".to_owned(),
            default_provider: None,
            history_budget_mb: 1024,
            recent_files: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

/// Everything the Rust side keeps between commands.
///
/// Deliberately small: the document lives in the webview. The AI job queue and the
/// key store live here; both are created lazily/cheaply so `AppState::default()` stays
/// free of I/O (the key store needs the config dir, which needs an `AppHandle`).
pub struct AppState {
    /// Current settings (see `commands::settings`).
    pub settings: Mutex<Settings>,
    /// `true` once `settings.json` has been read into `settings`.
    pub settings_loaded: AtomicBool,
    /// AI job queue (bounded concurrency, timeouts, cancel, events).
    pub jobs: JobManager,
    /// API-key store, initialised on first use with the app config directory.
    pub keys: OnceLock<Arc<AutoKeyStore>>,
    /// `true` once the `ai://job/<id>` event forwarder task is running.
    pub ai_forwarder_started: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(Settings::default()),
            settings_loaded: AtomicBool::new(false),
            jobs: JobManager::default(),
            keys: OnceLock::new(),
            ai_forwarder_started: AtomicBool::new(false),
        }
    }
}

impl fmt::Debug for AppState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AppState")
            .field("settings", &self.settings)
            .field("jobs", &self.jobs)
            .field(
                "keys",
                &self
                    .keys
                    .get()
                    .map(|k| k.backend())
                    .unwrap_or("uninitialised"),
            )
            .finish()
    }
}

impl AppState {
    /// The key store, created on first call. `PF_KEYSTORE=file` forces the obfuscated
    /// file backend (useful on headless Linux and in tests).
    pub fn key_store(&self, config_dir: &Path) -> Arc<AutoKeyStore> {
        Arc::clone(self.keys.get_or_init(|| {
            let store = AutoKeyStore::new(config_dir);
            let store =
                if std::env::var("PF_KEYSTORE").is_ok_and(|v| v.eq_ignore_ascii_case("file")) {
                    store.force_file()
                } else {
                    store
                };
            Arc::new(store)
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_and_json_shape() {
        let s = Settings::default();
        assert_eq!(s.theme, "dark");
        let json = serde_json::to_value(&s).expect("serialize");
        assert_eq!(json["historyBudgetMb"], 1024);
        let back: Settings = serde_json::from_str("{}").expect("defaults fill in");
        assert_eq!(back, s);
    }

    #[test]
    fn settings_keep_unknown_keys() {
        let back: Settings =
            serde_json::from_str(r#"{"theme":"dark","brushSize":42}"#).expect("parses");
        assert_eq!(back.extra["brushSize"], 42);
        let json = serde_json::to_value(&back).expect("serialize");
        assert_eq!(json["brushSize"], 42);
    }

    #[test]
    fn state_default_has_idle_queue_and_lazy_keys() {
        let state = AppState::default();
        assert!(state.jobs.is_empty());
        assert!(state.keys.get().is_none());
        assert!(format!("{state:?}").contains("uninitialised"));
        let dir = tempfile::tempdir().expect("tempdir");
        let a = state.key_store(dir.path());
        let b = state.key_store(dir.path());
        assert!(Arc::ptr_eq(&a, &b));
    }
}
