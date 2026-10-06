//! Concrete [`ImageProvider`] implementations and the registry factory.

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

/// Construct the provider for `id` with the given credentials.
pub fn build_provider(id: ProviderId, auth: AuthMethod) -> Result<SharedProvider, Error> {
    Ok(match id {
        ProviderId::OpenAi => Arc::new(OpenAiProvider::new(auth)?),
        ProviderId::XAi => Arc::new(XaiProvider::new(auth)?),
        ProviderId::Gemini => Arc::new(GeminiProvider::new(auth)?),
    })
}

/// Like [`build_provider`] but pointed at a custom base URL (tests, proxies).
pub fn build_provider_with_base_url(
    id: ProviderId,
    auth: AuthMethod,
    base_url: &str,
) -> Result<SharedProvider, Error> {
    Ok(match id {
        ProviderId::OpenAi => Arc::new(OpenAiProvider::new(auth)?.with_base_url(base_url)),
        ProviderId::XAi => Arc::new(XaiProvider::new(auth)?.with_base_url(base_url)),
        ProviderId::Gemini => Arc::new(GeminiProvider::new(auth)?.with_base_url(base_url)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretString;

    #[test]
    fn factory_builds_each_provider() {
        for id in ProviderId::ALL {
            let p = build_provider(id, AuthMethod::ApiKey(SecretString::new("k"))).expect("builds");
            assert_eq!(p.id(), id);
            assert!(p.capabilities().generate);
        }
    }
}
