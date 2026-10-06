//! Process-wide state shared by commands via `tauri::State<AppState>`.

use std::sync::Mutex;

use pf_ai::ProviderId;
use serde::{Deserialize, Serialize};

/// User settings (persisted by the `settings` commands; this scaffold keeps them in memory).
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".to_owned(),
            default_provider: None,
            history_budget_mb: 1024,
            recent_files: Vec::new(),
        }
    }
}

/// Everything the Rust side keeps between commands.
///
/// Deliberately small: the document lives in the webview. Later waves add the AI job
/// queue handle and the provider registry here.
#[derive(Debug, Default)]
pub struct AppState {
    /// Current settings.
    pub settings: Mutex<Settings>,
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
}
