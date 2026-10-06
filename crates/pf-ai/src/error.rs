//! Error type shared by every provider and the job queue.

use crate::types::ProviderId;

/// Errors produced by `pf-ai`.
///
/// [`Error::code`] yields a stable snake_case identifier that crosses IPC as the
/// `code` half of `{ code, message }` (PLAN.md section 4, rule 3).
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The provider has no credentials configured.
    #[error("{0} is not configured: add an API key in Settings > AI")]
    NotConfigured(ProviderId),

    /// The provider cannot perform the requested operation (see [`crate::Capabilities`]).
    #[error("{provider} does not support {capability}")]
    Unsupported {
        /// Provider that was asked.
        provider: ProviderId,
        /// Human readable capability name, e.g. `"mask edit"`.
        capability: &'static str,
    },

    /// The request was malformed before it was sent (empty prompt, bad size, ...).
    #[error("invalid request: {0}")]
    InvalidRequest(String),

    /// Credentials were rejected (HTTP 401 / 403).
    #[error("authentication failed: {0}")]
    Auth(String),

    /// The provider asked us to slow down (HTTP 429).
    #[error("rate limited by provider")]
    RateLimited {
        /// Seconds to wait before retrying, when the provider told us.
        retry_after_secs: Option<u64>,
    },

    /// The provider refused the content (safety / policy filters) without telling us why.
    #[error("request rejected by provider: {0}")]
    Rejected(String),

    /// The provider's moderation layer blocked the prompt or an input image.
    #[error(
        "blocked by {provider} moderation{}: {message}",
        fmt_categories(categories)
    )]
    Moderation {
        /// Provider that blocked the request.
        provider: ProviderId,
        /// Category labels the provider reported (may be empty).
        categories: Vec<String>,
        /// Provider's own message.
        message: String,
    },

    /// The provider rejected the request as malformed (HTTP 400 / 422).
    #[error("{provider} rejected the request: {message}")]
    BadRequest {
        /// Provider that answered.
        provider: ProviderId,
        /// Provider's own message (secrets scrubbed).
        message: String,
    },

    /// The job exceeded its deadline.
    #[error("job timed out after {secs} s")]
    Timeout {
        /// Deadline that was exceeded.
        secs: u64,
    },

    /// Local image decoding / encoding failure (mask helpers, result normalisation).
    #[error("image error: {0}")]
    Image(String),

    /// Any other non-success HTTP status.
    #[error("provider returned HTTP {status}: {body}")]
    Http {
        /// HTTP status code.
        status: u16,
        /// Trimmed response body for diagnostics.
        body: String,
    },

    /// Transport-level failure (DNS, TLS, timeout, connection reset).
    #[error("network error: {0}")]
    Transport(#[from] reqwest::Error),

    /// The provider answered 2xx but the payload did not match what we expect.
    #[error("invalid response from provider: {0}")]
    InvalidResponse(String),

    /// The job was cancelled by the user before it finished.
    #[error("job cancelled")]
    Cancelled,

    /// Secret storage (keychain) failure.
    #[error("key store error: {0}")]
    KeyStore(String),

    /// Local I/O failure.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON (de)serialization failure.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Alias matching the name used in `PLAN.md` section 2.2.
pub type AiError = Error;

impl Error {
    /// Stable machine-readable code for IPC and telemetry.
    pub fn code(&self) -> &'static str {
        match self {
            Error::NotConfigured(_) => "ai_not_configured",
            Error::Unsupported { .. } => "ai_unsupported",
            Error::InvalidRequest(_) => "ai_invalid_request",
            Error::Auth(_) => "ai_auth",
            Error::RateLimited { .. } => "ai_rate_limited",
            Error::Rejected(_) => "ai_rejected",
            Error::Moderation { .. } => "ai_moderation_blocked",
            Error::BadRequest { .. } => "ai_bad_request",
            Error::Timeout { .. } => "ai_timeout",
            Error::Image(_) => "ai_image",
            Error::Http { .. } => "ai_http",
            Error::Transport(_) => "ai_transport",
            Error::InvalidResponse(_) => "ai_invalid_response",
            Error::Cancelled => "ai_cancelled",
            Error::KeyStore(_) => "ai_key_store",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
        }
    }

    /// Whether retrying the same request later could plausibly succeed.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Error::RateLimited { .. }
                | Error::Transport(_)
                | Error::Timeout { .. }
                | Error::Http {
                    status: 500..=599,
                    ..
                }
        )
    }
}

impl From<image::ImageError> for Error {
    fn from(err: image::ImageError) -> Self {
        Error::Image(err.to_string())
    }
}

fn fmt_categories(categories: &[String]) -> String {
    if categories.is_empty() {
        String::new()
    } else {
        format!(" ({})", categories.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_snake_case_and_retryability_matches_intent() {
        let e = Error::RateLimited {
            retry_after_secs: Some(3),
        };
        assert_eq!(e.code(), "ai_rate_limited");
        assert!(e.is_retryable());

        let e = Error::Unsupported {
            provider: ProviderId::Gemini,
            capability: "mask edit",
        };
        assert_eq!(e.code(), "ai_unsupported");
        assert!(!e.is_retryable());
        assert_eq!(e.to_string(), "Gemini does not support mask edit");

        for code in [
            Error::Cancelled.code(),
            Error::NotConfigured(ProviderId::XAi).code(),
            Error::Timeout { secs: 1 }.code(),
        ] {
            assert!(code.chars().all(|c| c.is_ascii_lowercase() || c == '_'));
        }

        let m = Error::Moderation {
            provider: ProviderId::OpenAi,
            categories: vec!["violence".into(), "sexual".into()],
            message: "blocked".into(),
        };
        assert_eq!(m.code(), "ai_moderation_blocked");
        assert_eq!(
            m.to_string(),
            "blocked by ChatGPT moderation (violence, sexual): blocked"
        );
        let m = Error::Moderation {
            provider: ProviderId::Gemini,
            categories: vec![],
            message: "blocked".into(),
        };
        assert_eq!(m.to_string(), "blocked by Gemini moderation: blocked");
    }
}
