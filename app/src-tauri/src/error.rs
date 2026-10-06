//! The one error shape that crosses IPC: `{ code, message }` (PLAN.md section 4, rule 3).

use std::fmt;

use serde::Serialize;

/// Serializable error returned by every `#[tauri::command]`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    /// Stable snake_case identifier the UI can switch on (`"ai_rate_limited"`, ...).
    pub code: String,
    /// Human-readable description, safe to show in a toast.
    pub message: String,
}

impl CommandError {
    /// Construct from a code and message.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    /// Shared app state mutex was poisoned by a panicking thread.
    pub fn poisoned(what: &str) -> Self {
        Self::new(
            "state_poisoned",
            format!("{what} is unavailable (lock poisoned)"),
        )
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}

impl From<pf_ai::Error> for CommandError {
    fn from(err: pf_ai::Error) -> Self {
        Self::new(err.code(), err.to_string())
    }
}

impl From<pf_io::Error> for CommandError {
    fn from(err: pf_io::Error) -> Self {
        Self::new(err.code(), err.to_string())
    }
}

impl From<std::io::Error> for CommandError {
    fn from(err: std::io::Error) -> Self {
        Self::new("io", err.to_string())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(err: serde_json::Error) -> Self {
        Self::new("json", err.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(err: tauri::Error) -> Self {
        Self::new("tauri", err.to_string())
    }
}

/// Result alias for commands.
pub type CommandResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_and_message() {
        let err: CommandError = pf_ai::Error::Cancelled.into();
        let json = serde_json::to_value(&err).expect("serialize");
        assert_eq!(json["code"], "ai_cancelled");
        assert_eq!(json["message"], "job cancelled");
        assert_eq!(err.to_string(), "[ai_cancelled] job cancelled");
    }
}
