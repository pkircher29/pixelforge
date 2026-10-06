//! HTTP plumbing shared by the three providers: client construction, auth header,
//! error mapping, base64 / data-URL helpers and result normalisation to PNG.

use std::io::Cursor;
use std::time::Duration;

use base64::Engine as _;
use image::ImageReader;
use reqwest::header::{HeaderMap, RETRY_AFTER};

use crate::error::Error;
use crate::types::{AuthMethod, ImageBytes, ProviderId};

/// `User-Agent` sent with every request.
pub(crate) const USER_AGENT: &str = concat!("pixelforge/", env!("CARGO_PKG_VERSION"));

/// Per-request transport timeout. The job queue applies its own (shorter) deadline.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

/// Longest provider error body we keep in an [`Error`].
const MAX_ERROR_BODY: usize = 4000;

/// Build the shared HTTP client.
pub(crate) fn client() -> Result<reqwest::Client, Error> {
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()?)
}

/// `Bearer <token>` header value.
pub(crate) fn bearer(auth: &AuthMethod) -> String {
    format!("Bearer {}", auth.token().expose())
}

/// Return the response unchanged on 2xx; otherwise consume it into a typed [`Error`].
pub(crate) async fn ensure_success(
    provider: &ProviderId,
    resp: reqwest::Response,
) -> Result<reqwest::Response, Error> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let retry_after = parse_retry_after(resp.headers());
    let raw = resp.text().await.unwrap_or_default();
    Err(map_error(provider, status.as_u16(), retry_after, &raw))
}

/// Map a non-2xx status + body to the typed error (pure, so it is unit-testable).
pub(crate) fn map_error(
    provider: &ProviderId,
    status: u16,
    retry_after: Option<u64>,
    raw_body: &str,
) -> Error {
    let body = scrub(truncate(raw_body, MAX_ERROR_BODY));
    let info = ProviderErrorInfo::parse(&body);
    let message = info.message.clone().unwrap_or_else(|| body.clone());
    match status {
        401 | 403 => Error::Auth(format!("{provider} rejected the API key: {message}")),
        429 => Error::RateLimited {
            retry_after_secs: retry_after,
        },
        400 | 422 => {
            if info.is_moderation() {
                Error::Moderation {
                    provider: provider.clone(),
                    categories: info.categories,
                    message,
                }
            } else {
                Error::BadRequest {
                    provider: provider.clone(),
                    message,
                }
            }
        }
        _ => Error::Http { status, body },
    }
}

/// What we could extract from a provider's JSON error body.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct ProviderErrorInfo {
    /// Human-readable message.
    pub message: Option<String>,
    /// Machine code (`moderation_blocked`, `invalid_request_error`, ...).
    pub code: Option<String>,
    /// gRPC-style status (Gemini: `INVALID_ARGUMENT`, `PERMISSION_DENIED`, ...).
    pub status: Option<String>,
    /// Moderation categories, when reported.
    pub categories: Vec<String>,
}

impl ProviderErrorInfo {
    /// Best-effort parse of the three providers' error shapes:
    /// OpenAI `{error:{message,code,type,moderation_details:{categories}}}`,
    /// xAI `{error:"...", code:"..."}` or OpenAI-style, Gemini `{error:{code,message,status}}`.
    pub fn parse(body: &str) -> Self {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else {
            return Self::default();
        };
        let err = &v["error"];
        let message = err["message"]
            .as_str()
            .or_else(|| err.as_str())
            .or_else(|| v["message"].as_str())
            .or_else(|| v["detail"].as_str())
            .map(str::to_owned);
        let code = err["code"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| err["code"].as_i64().map(|c| c.to_string()))
            .or_else(|| v["code"].as_str().map(str::to_owned))
            .or_else(|| err["type"].as_str().map(str::to_owned));
        let status = err["status"].as_str().map(str::to_owned);
        let cats = &err["moderation_details"]["categories"];
        let categories = if let Some(arr) = cats.as_array() {
            arr.iter()
                .filter_map(|c| {
                    c.as_str()
                        .map(str::to_owned)
                        .or_else(|| c["category"].as_str().map(str::to_owned))
                        .or_else(|| c["name"].as_str().map(str::to_owned))
                })
                .collect()
        } else if let Some(obj) = cats.as_object() {
            obj.keys().cloned().collect()
        } else {
            Vec::new()
        };
        Self {
            message,
            code,
            status,
            categories,
        }
    }

    /// Heuristic: does this look like a safety / moderation refusal?
    pub fn is_moderation(&self) -> bool {
        if !self.categories.is_empty() {
            return true;
        }
        let code = self
            .code
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if code.contains("moderation") || code.contains("content_policy") || code.contains("safety")
        {
            return true;
        }
        let msg = self
            .message
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        msg.contains("moderation")
            || msg.contains("content policy")
            || msg.contains("safety system")
            || msg.contains("prohibited")
            || msg.contains("blocked")
    }
}

/// `Retry-After` in seconds (only the delta-seconds form; HTTP-dates are ignored).
pub(crate) fn parse_retry_after(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

/// Cut a string at a char boundary.
pub(crate) fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Redact anything that looks like an API key or bearer token in provider error text.
///
/// Providers do not echo keys, but the body is shown to the user and written to logs,
/// so be paranoid: `sk-…`, `xai-…`, `AIza…` and `Bearer …` runs are replaced.
pub(crate) fn scrub(body: &str) -> String {
    const PREFIXES: [&str; 4] = ["Bearer ", "sk-", "xai-", "AIza"];
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    'outer: while !rest.is_empty() {
        for p in PREFIXES {
            if let Some(stripped) = rest.strip_prefix(p) {
                let run = stripped
                    .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ',')
                    .unwrap_or(stripped.len());
                // Only treat it as a secret when the run is long enough to be one.
                if run >= 16 {
                    out.push_str("[REDACTED]");
                    rest = &stripped[run..];
                    continue 'outer;
                }
            }
        }
        let Some(c) = rest.chars().next() else { break };
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// Standard base64 (with padding) encode.
pub(crate) fn b64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Decode base64 (standard alphabet, padding optional).
pub(crate) fn b64_decode(s: &str) -> Result<Vec<u8>, Error> {
    let trimmed = s.trim();
    base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(trimmed))
        .map_err(|e| Error::InvalidResponse(format!("bad base64 image payload: {e}")))
}

/// `data:<mime>;base64,<payload>`.
pub(crate) fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", b64_encode(bytes))
}

/// Guess the MIME type of encoded image bytes from magic numbers.
pub(crate) fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else {
        None
    }
}

/// Effective MIME for an input image: the declared one unless sniffing disagrees.
pub(crate) fn input_mime(img: &ImageBytes) -> String {
    sniff_mime(&img.data)
        .map(str::to_owned)
        .unwrap_or_else(|| img.mime.clone())
}

/// Read `(width, height)` from an encoded image header without decoding pixels.
pub(crate) fn dimensions(bytes: &[u8]) -> Result<(u32, u32), Error> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| Error::Image(format!("unrecognised image data: {e}")))?;
    Ok(reader.into_dimensions()?)
}

/// Normalise a provider result to PNG, returning the bytes and dimensions.
///
/// PNG input is passed through untouched (only the header is read). Anything else is
/// decoded and re-encoded, so every [`crate::ImageResult`] is a PNG as documented.
pub(crate) fn normalize_to_png(bytes: Vec<u8>) -> Result<(ImageBytes, u32, u32), Error> {
    if sniff_mime(&bytes) == Some("image/png") {
        let (w, h) = dimensions(&bytes)?;
        return Ok((ImageBytes::png(bytes), w, h));
    }
    let img = image::load_from_memory(&bytes)?;
    let (w, h) = (img.width(), img.height());
    let mut out = Cursor::new(Vec::with_capacity(bytes.len()));
    img.write_to(&mut out, image::ImageFormat::Png)?;
    Ok((ImageBytes::png(out.into_inner()), w, h))
}

/// Providers have no negative-prompt field; fold it into the prompt text.
pub(crate) fn effective_prompt(prompt: &str, negative: Option<&str>) -> String {
    match negative.map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => format!("{prompt}\n\nDo not include: {n}"),
        None => prompt.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_mapping_by_status() {
        let e = map_error(
            &ProviderId::OpenAi,
            401,
            None,
            r#"{"error":{"message":"bad key"}}"#,
        );
        assert!(matches!(e, Error::Auth(m) if m.contains("bad key")));

        let e = map_error(&ProviderId::XAi, 429, Some(7), "slow down");
        assert!(matches!(
            e,
            Error::RateLimited {
                retry_after_secs: Some(7)
            }
        ));

        let e = map_error(
            &ProviderId::OpenAi,
            400,
            None,
            r#"{"error":{"code":"moderation_blocked","message":"nope","moderation_details":{"moderation_stage":"input","categories":["violence"]}}}"#,
        );
        match e {
            Error::Moderation { categories, .. } => assert_eq!(categories, vec!["violence"]),
            other => panic!("expected moderation, got {other:?}"),
        }

        let e = map_error(
            &ProviderId::Gemini,
            400,
            None,
            r#"{"error":{"code":400,"message":"imageSize invalid","status":"INVALID_ARGUMENT"}}"#,
        );
        assert!(matches!(e, Error::BadRequest { message, .. } if message.contains("imageSize")));

        let e = map_error(&ProviderId::Gemini, 503, None, "overloaded");
        assert!(matches!(e, Error::Http { status: 503, .. }));
        assert!(e.is_retryable());
    }

    #[test]
    fn xai_string_error_shape() {
        let info = ProviderErrorInfo::parse(
            r#"{"code":"invalid_argument","error":"Content moderation: prompt rejected"}"#,
        );
        assert_eq!(info.code.as_deref(), Some("invalid_argument"));
        assert!(info.is_moderation());
        let info = ProviderErrorInfo::parse("not json");
        assert_eq!(info, ProviderErrorInfo::default());
        assert!(!info.is_moderation());
    }

    #[test]
    fn scrub_redacts_key_like_runs() {
        let s = scrub("key sk-abcdefghijklmnopqrstuvwxyz0123 was bad; Bearer AAAAAAAAAAAAAAAAAAAAAAAA rejected, short sk-1 ok");
        assert!(!s.contains("sk-abcdef"));
        assert!(!s.contains("AAAAAAAA"));
        assert!(s.contains("[REDACTED] was bad"));
        assert!(s.contains("short sk-1 ok"));
    }

    #[test]
    fn base64_and_sniffing() {
        let png = b"\x89PNG\r\n\x1a\n....";
        assert_eq!(sniff_mime(png), Some("image/png"));
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff_mime(b"RIFF....WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_mime(b"nope"), None);
        let enc = b64_encode(b"hello");
        assert_eq!(b64_decode(&enc).expect("decodes"), b"hello");
        assert_eq!(b64_decode("aGVsbG8").expect("no pad ok"), b"hello");
        assert!(b64_decode("!!!").is_err());
        assert!(data_url("image/png", b"\x00").starts_with("data:image/png;base64,"));
    }

    #[test]
    fn truncate_respects_char_boundaries() {
        let s = "héllo";
        assert_eq!(truncate(s, 2), "h");
        assert_eq!(truncate(s, 3), "hé");
        assert_eq!(truncate(s, 100), s);
    }

    #[test]
    fn negative_prompt_folds_in() {
        assert_eq!(effective_prompt("a cat", None), "a cat");
        assert_eq!(effective_prompt("a cat", Some("  ")), "a cat");
        assert_eq!(
            effective_prompt("a cat", Some("dogs")),
            "a cat\n\nDo not include: dogs"
        );
    }
}
