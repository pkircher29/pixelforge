//! Concrete [`ImageProvider`] implementations and the registry factory.

pub mod custom;
pub mod gemini;
pub mod openai;
pub mod xai;

use std::sync::Arc;

use crate::error::Error;
use crate::provider::ImageProvider;
use crate::types::{AuthMethod, ProviderId};

pub use gemini::{GeminiProvider, GeminiSizeField};
pub use openai::OpenAiProvider;
pub use xai::XaiProvider;

/// Shared handle used by the job queue and the Tauri layer.
pub type SharedProvider = Arc<dyn ImageProvider>;

/// A custom id has no built-in implementation; callers must go through
/// [`crate::custom::build_custom_provider`] with its registry entry.
fn not_builtin(id: &ProviderId) -> Error {
    Error::InvalidRequest(format!(
        "{} is a custom provider; build it from its registry entry",
        id.as_str()
    ))
}

/// Construct the built-in provider for `id` with the given credentials.
pub fn build_provider(id: &ProviderId, auth: AuthMethod) -> Result<SharedProvider, Error> {
    Ok(match id {
        ProviderId::OpenAi => Arc::new(OpenAiProvider::new(auth)?),
        ProviderId::XAi => Arc::new(XaiProvider::new(auth)?),
        ProviderId::Gemini => Arc::new(GeminiProvider::new(auth)?),
        ProviderId::Custom(_) => return Err(not_builtin(id)),
    })
}

/// Name of the environment variable that overrides the provider's base URL
/// (`PF_AI_BASE_URL_OPENAI`, `PF_AI_BASE_URL_XAI`, `PF_AI_BASE_URL_GEMINI`).
///
/// Development aid: point a provider at `scripts/fake-ai-server.mjs` (or a proxy)
/// without touching the key store. Empty values are ignored. Custom providers have
/// no override (their base URL is user-configured anyway): `None`.
pub fn base_url_env_var(id: &ProviderId) -> Option<&'static str> {
    match id {
        ProviderId::OpenAi => Some("PF_AI_BASE_URL_OPENAI"),
        ProviderId::XAi => Some("PF_AI_BASE_URL_XAI"),
        ProviderId::Gemini => Some("PF_AI_BASE_URL_GEMINI"),
        ProviderId::Custom(_) => None,
    }
}

/// The base URL override for `id` from the environment, if any (trimmed, non-empty).
pub fn base_url_override(id: &ProviderId) -> Option<String> {
    std::env::var(base_url_env_var(id)?)
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

/// [`build_provider`], honouring the `PF_AI_BASE_URL_*` environment override.
pub fn build_provider_from_env(id: &ProviderId, auth: AuthMethod) -> Result<SharedProvider, Error> {
    match base_url_override(id) {
        Some(url) => {
            tracing::info!(provider = ?id, %url, "using base URL override from environment");
            build_provider_with_base_url(id, auth, &url)
        }
        None => build_provider(id, auth),
    }
}

/// Like [`build_provider`] but pointed at a custom base URL (tests, proxies).
pub fn build_provider_with_base_url(
    id: &ProviderId,
    auth: AuthMethod,
    base_url: &str,
) -> Result<SharedProvider, Error> {
    Ok(match id {
        ProviderId::OpenAi => Arc::new(OpenAiProvider::new(auth)?.with_base_url(base_url)),
        ProviderId::XAi => Arc::new(XaiProvider::new(auth)?.with_base_url(base_url)),
        ProviderId::Gemini => Arc::new(GeminiProvider::new(auth)?.with_base_url(base_url)),
        ProviderId::Custom(_) => return Err(not_builtin(id)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretString;

    #[test]
    fn factory_builds_each_provider() {
        for id in ProviderId::BUILTIN {
            let p =
                build_provider(&id, AuthMethod::ApiKey(SecretString::new("k"))).expect("builds");
            assert_eq!(p.id(), id);
            assert!(p.capabilities().generate);
        }
        let err = match build_provider(
            &ProviderId::custom("x"),
            AuthMethod::ApiKey(SecretString::new("k")),
        ) {
            Ok(_) => panic!("custom ids are not built here"),
            Err(e) => e,
        };
        assert_eq!(err.code(), "ai_invalid_request");
    }

    #[test]
    fn env_var_names_are_distinct_and_from_env_builds() {
        let names: Vec<&str> = ProviderId::BUILTIN
            .iter()
            .filter_map(base_url_env_var)
            .collect();
        assert_eq!(names.len(), 3);
        assert!(names.iter().all(|n| n.starts_with("PF_AI_BASE_URL_")));
        assert_ne!(names[0], names[1]);
        assert_ne!(names[1], names[2]);
        assert_eq!(base_url_env_var(&ProviderId::custom("x")), None);
        // Without the variable set the override is None and the factory still builds.
        for id in ProviderId::BUILTIN {
            let p = build_provider_from_env(&id, AuthMethod::ApiKey(SecretString::new("k")))
                .expect("builds");
            assert_eq!(p.id(), id);
        }
    }
}
