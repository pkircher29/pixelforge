//! # pf-ai
//!
//! Provider abstraction for AI image generation and editing in Pixelforge.
//!
//! Three hosted providers sit behind one [`ImageProvider`] trait so the editor can
//! chain them on a single document: OpenAI (ChatGPT image models), xAI (Grok) and
//! Google (Gemini). The trait is object safe (`Box<dyn ImageProvider>` /
//! `Arc<dyn ImageProvider>`) via `async_trait`, so the Tauri layer holds a registry of
//! providers keyed by [`ProviderId`] and dispatches without knowing the concrete type.
//!
//! This crate owns:
//!
//! * the request / response shapes ([`GenerateRequest`], [`EditRequest`], [`ImageResult`]),
//! * the per-provider [`Capabilities`] matrix ([`all_capabilities`]) used by the UI to
//!   grey out features and by the webview to decide when to emulate a mask,
//! * the three providers in [`providers`] (`reqwest`, rustls, base64 everywhere),
//! * [`mask`] helpers (crop to mask bbox / composite back / OpenAI mask normalisation),
//! * [`keystore`]: OS keychain with an obfuscated-file fallback,
//! * [`jobs`]: the Tokio job queue with cancellation, timeouts and broadcast events,
//! * [`ipc`]: the raw-bytes wire format used by the Tauri commands,
//! * [`AuthMethod`] (BYOK API keys now, OAuth later) and the redacting [`SecretString`],
//! * the [`Error`] type that the Tauri commands translate into `{ code, message }`.
//!
//! Provider facts come from `docs/ai-research.md` (verified 2026-10-06).

#![forbid(unsafe_code)]

pub mod capabilities;
pub mod custom;
pub mod error;
mod http;
pub mod ipc;
pub mod jobs;
pub mod keystore;
pub mod mask;
pub mod oauth;
pub mod provider;
pub mod providers;
pub mod secret;
pub mod types;

pub use capabilities::{all_capabilities, capabilities_for};
pub use custom::{CustomKind, CustomProvider, CustomRegistry, ProbeResult};
pub use error::{AiError, Error};
pub use jobs::{JobConfig, JobEvent, JobEventKind, JobId, JobKind, JobManager, JobSpec, JobStatus};
pub use keystore::{AutoKeyStore, FileStore, KeyStore, KeyringStore};
pub use mask::{composite_back, crop_to_mask_bbox, to_openai_mask, Rect};
pub use provider::{validate_edit, validate_generate, BoxedProvider, ImageProvider};
pub use providers::custom::{build_custom_provider, probe as probe_custom, prompt_assist};
pub use providers::{
    base_url_env_var, base_url_override, build_provider, build_provider_from_env,
    build_provider_with_base_url, SharedProvider,
};
pub use secret::SecretString;
pub use types::{
    AuthMethod, Capabilities, EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult,
    ImageResultMeta, ImageSize, ProviderId,
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
        for id in ProviderId::BUILTIN {
            let json = serde_json::to_string(&id).expect("serialize");
            let back: ProviderId = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(id, back);
        }
        assert_eq!(
            serde_json::to_string(&ProviderId::OpenAi).expect("serialize"),
            "\"open_ai\""
        );
        let custom = ProviderId::custom("my-comfy");
        let json = serde_json::to_string(&custom).expect("serialize");
        assert_eq!(json, "\"custom:my-comfy\"");
        let back: ProviderId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, custom);
        assert_eq!(back.custom_id(), Some("my-comfy"));
        assert!(serde_json::from_str::<ProviderId>("\"custom:\"").is_err());
        assert!(serde_json::from_str::<ProviderId>("\"nope\"").is_err());
        // Custom ids work as JSON object keys (key status maps).
        let mut m = std::collections::HashMap::new();
        m.insert(custom.clone(), true);
        let v = serde_json::to_value(&m).expect("map");
        assert_eq!(v["custom:my-comfy"], true);
    }
}
