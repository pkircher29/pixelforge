//! # pf-ai
//!
//! Provider abstraction for AI image generation and editing in Pixelforge.
//!
//! Three hosted providers sit behind one [`ImageProvider`] trait so the editor can
//! chain them on a single document: OpenAI (ChatGPT image models), xAI (Grok) and
//! Google (Gemini). The trait is object safe (`Box<dyn ImageProvider>`) via
//! `async_trait`, so the Tauri layer can hold a registry of providers keyed by
//! [`ProviderId`] and dispatch without knowing the concrete type.
//!
//! This crate owns:
//!
//! * the request / response shapes ([`GenerateRequest`], [`EditRequest`], [`ImageResult`]),
//! * the per-provider [`Capabilities`] matrix used by the UI to grey out features and by
//!   the webview to decide when to emulate a mask,
//! * [`AuthMethod`] (BYOK API keys now, OAuth later) and the redacting [`SecretString`],
//! * the [`Error`] type that the Tauri commands translate into `{ code, message }`.
//!
//! Provider implementations, the Tokio job queue and the keyring-backed key store are
//! added by the `ai-rust` wave (see `PLAN.md` section 4). Nothing in this crate performs
//! network I/O yet.

#![forbid(unsafe_code)]

pub mod error;
pub mod provider;
pub mod secret;
pub mod types;

pub use error::{AiError, Error};
pub use provider::{validate_edit, validate_generate, BoxedProvider, ImageProvider};
pub use secret::SecretString;
pub use types::{
    AuthMethod, Capabilities, EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult,
    ImageSize, ProviderId,
};

/// Crate version, re-exported for diagnostics / the About dialog.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!VERSION.is_empty());
    }

    #[test]
    fn provider_ids_round_trip_through_serde() {
        for id in ProviderId::ALL {
            let json = serde_json::to_string(&id).expect("serialize");
            let back: ProviderId = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(id, back);
        }
        assert_eq!(
            serde_json::to_string(&ProviderId::OpenAi).expect("serialize"),
            "\"open_ai\""
        );
    }
}
