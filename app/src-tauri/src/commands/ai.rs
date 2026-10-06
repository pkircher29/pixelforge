//! AI commands (`ai_*`). Owned by the `ai-rust` wave; this scaffold ships one stub.

use pf_ai::{Capabilities, ProviderId};
use serde::Serialize;

use crate::error::CommandResult;

/// One row of the provider picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    /// Stable id (`open_ai`, `x_ai`, `gemini`).
    pub id: ProviderId,
    /// Short label used in layer names (`ChatGPT`, `Grok`, `Gemini`).
    pub label: String,
    /// Vendor name for settings (`OpenAI`, `xAI`, `Google`).
    pub vendor: String,
    /// What the provider can do.
    pub capabilities: Capabilities,
    /// Whether an API key is present in the key store.
    pub configured: bool,
}

/// List every provider Pixelforge knows about, with its capability matrix.
///
/// Until the provider registry lands, capabilities are the conservative defaults and
/// `configured` is always `false`.
#[tauri::command]
pub fn ai_list_providers() -> CommandResult<Vec<ProviderInfo>> {
    Ok(ProviderId::ALL
        .into_iter()
        .map(|id| ProviderInfo {
            id,
            label: id.label().to_owned(),
            vendor: id.vendor().to_owned(),
            capabilities: Capabilities::default(),
            configured: false,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_all_three_providers() {
        let rows = ai_list_providers().expect("ok");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].id, ProviderId::OpenAi);
        assert!(rows.iter().all(|r| !r.configured));
    }
}
