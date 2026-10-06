//! Request / response shapes shared by every provider (PLAN.md section 2.2).

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::secret::SecretString;

/// Which hosted provider a request goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    /// OpenAI (ChatGPT image models, e.g. `gpt-image-1`).
    OpenAi,
    /// xAI (Grok image models).
    XAi,
    /// Google (Gemini image models via AI Studio).
    Gemini,
}

impl ProviderId {
    /// Every provider, in UI display order.
    pub const ALL: [ProviderId; 3] = [ProviderId::OpenAi, ProviderId::XAi, ProviderId::Gemini];

    /// Short, user-facing label used for layer names (`"<Provider>: <prompt>"`).
    pub fn label(self) -> &'static str {
        match self {
            ProviderId::OpenAi => "ChatGPT",
            ProviderId::XAi => "Grok",
            ProviderId::Gemini => "Gemini",
        }
    }

    /// Longer label for settings / pickers.
    pub fn vendor(self) -> &'static str {
        match self {
            ProviderId::OpenAi => "OpenAI",
            ProviderId::XAi => "xAI",
            ProviderId::Gemini => "Google",
        }
    }

    /// Stable identifier matching the serde representation (`open_ai`, `x_ai`, `gemini`).
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderId::OpenAi => "open_ai",
            ProviderId::XAi => "x_ai",
            ProviderId::Gemini => "gemini",
        }
    }
}

impl fmt::Display for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

/// Output size in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ImageSize {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

impl ImageSize {
    /// Construct a size.
    pub const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }

    /// Square helper.
    pub const fn square(edge: u32) -> Self {
        Self::new(edge, edge)
    }

    /// Total pixel count.
    pub fn pixels(self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }

    /// Width / height ratio (`NaN` safe: a zero height yields `0.0`).
    pub fn aspect(self) -> f64 {
        if self.height == 0 {
            0.0
        } else {
            f64::from(self.width) / f64::from(self.height)
        }
    }
}

impl fmt::Display for ImageSize {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}x{}", self.width, self.height)
    }
}

/// What a provider can do. The UI greys out unsupported modes; the webview decides
/// whether to emulate a mask (crop -> send -> composite back) based on `mask_edit`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// Text -> image.
    pub generate: bool,
    /// Image + mask + prompt -> image (native inpainting endpoint).
    pub mask_edit: bool,
    /// Image + instruction -> image (no mask).
    pub instruct_edit: bool,
    /// Accepts more than one reference image per request.
    pub multi_ref: bool,
    /// Output sizes the provider accepts. Empty means "any size up to `max_px`".
    pub sizes: Vec<ImageSize>,
    /// Longest edge (in pixels) the provider accepts or produces.
    pub max_px: u32,
    /// Maximum number of variants (`n`) per request.
    pub max_variants: u8,
    /// Model identifiers the UI may offer; the first one is the default.
    pub models: Vec<String>,
}

impl Default for Capabilities {
    /// A conservative "nothing known yet" matrix.
    fn default() -> Self {
        Self {
            generate: false,
            mask_edit: false,
            instruct_edit: false,
            multi_ref: false,
            sizes: Vec::new(),
            max_px: 0,
            max_variants: 1,
            models: Vec::new(),
        }
    }
}

/// How we authenticate against a provider.
///
/// Only [`AuthMethod::ApiKey`] is used in v1 (BYOK keys from the OS keychain). The
/// OAuth variant exists so call sites do not change when a provider officially supports
/// third-party OAuth for its image APIs.
#[derive(Debug, Clone)]
pub enum AuthMethod {
    /// Bearer / `x-api-key` style static key.
    ApiKey(SecretString),
    /// OAuth 2 tokens.
    OAuth {
        /// Access token sent as `Authorization: Bearer`.
        access: SecretString,
        /// Refresh token, if the grant issued one.
        refresh: Option<SecretString>,
        /// Unix timestamp (seconds) when `access` expires.
        expires_at: u64,
    },
}

impl AuthMethod {
    /// The credential that goes on the wire right now.
    pub fn token(&self) -> &SecretString {
        match self {
            AuthMethod::ApiKey(key) => key,
            AuthMethod::OAuth { access, .. } => access,
        }
    }

    /// `true` for OAuth tokens whose expiry is at or before `now_unix_secs`.
    pub fn is_expired(&self, now_unix_secs: u64) -> bool {
        match self {
            AuthMethod::ApiKey(_) => false,
            AuthMethod::OAuth { expires_at, .. } => *expires_at <= now_unix_secs,
        }
    }
}

/// Encoded image bytes (PNG unless `mime` says otherwise).
///
/// Intentionally not `Serialize`: images cross IPC as raw bytes, never base64 JSON.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct ImageBytes {
    /// Encoded file contents.
    pub data: Vec<u8>,
    /// MIME type, e.g. `image/png`.
    pub mime: String,
}

impl ImageBytes {
    /// Wrap PNG bytes.
    pub fn png(data: Vec<u8>) -> Self {
        Self {
            data,
            mime: "image/png".to_owned(),
        }
    }

    /// Byte length.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// `true` when there are no bytes.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

impl fmt::Debug for ImageBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ImageBytes({} bytes, {})", self.data.len(), self.mime)
    }
}

/// Which kind of edit an [`EditRequest`] asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditMode {
    /// Selection becomes a mask; only masked pixels may change.
    Mask,
    /// Whole-image instruction, no mask.
    Instruct,
}

/// Text -> image.
#[derive(Debug, Clone)]
pub struct GenerateRequest {
    /// The prompt.
    pub prompt: String,
    /// Things to avoid (ignored by providers without negative prompts).
    pub negative_prompt: Option<String>,
    /// Requested output size; `None` lets the provider pick its default.
    pub size: Option<ImageSize>,
    /// Number of variants to produce (1..=`Capabilities::max_variants`).
    pub n: u8,
    /// Model override; `None` uses the provider's default model.
    pub model: Option<String>,
    /// Seed for reproducibility where supported.
    pub seed: Option<u64>,
    /// Optional style / subject reference images (requires `multi_ref` for more than one).
    pub reference_images: Vec<ImageBytes>,
}

impl Default for GenerateRequest {
    fn default() -> Self {
        Self {
            prompt: String::new(),
            negative_prompt: None,
            size: None,
            n: 1,
            model: None,
            seed: None,
            reference_images: Vec::new(),
        }
    }
}

/// Image (+ optional mask) + prompt -> image.
#[derive(Debug, Clone)]
pub struct EditRequest {
    /// Mask or instruct.
    pub mode: EditMode,
    /// The instruction / prompt.
    pub prompt: String,
    /// Things to avoid.
    pub negative_prompt: Option<String>,
    /// Current composite of the document (or the mask-bbox crop when emulating).
    pub image: ImageBytes,
    /// 8-bit PNG where white = editable. `None` for [`EditMode::Instruct`].
    pub mask: Option<ImageBytes>,
    /// Extra reference images.
    pub reference_images: Vec<ImageBytes>,
    /// Requested output size; `None` means "same as `image`".
    pub size: Option<ImageSize>,
    /// Number of variants.
    pub n: u8,
    /// Model override.
    pub model: Option<String>,
    /// Seed where supported.
    pub seed: Option<u64>,
}

impl EditRequest {
    /// Instruct-edit request with sensible defaults.
    pub fn instruct(prompt: impl Into<String>, image: ImageBytes) -> Self {
        Self {
            mode: EditMode::Instruct,
            prompt: prompt.into(),
            negative_prompt: None,
            image,
            mask: None,
            reference_images: Vec::new(),
            size: None,
            n: 1,
            model: None,
            seed: None,
        }
    }

    /// Mask-edit request with sensible defaults.
    pub fn masked(prompt: impl Into<String>, image: ImageBytes, mask: ImageBytes) -> Self {
        Self {
            mode: EditMode::Mask,
            mask: Some(mask),
            ..Self::instruct(prompt, image)
        }
    }
}

/// One generated / edited image.
#[derive(Debug, Clone)]
pub struct ImageResult {
    /// Encoded result (PNG).
    pub image: ImageBytes,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Provider that produced it.
    pub provider: ProviderId,
    /// Model that produced it.
    pub model: String,
    /// Provider-side rewritten prompt, when returned.
    pub revised_prompt: Option<String>,
    /// Estimated cost in USD, when known.
    pub cost_usd: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_size_helpers() {
        let s = ImageSize::new(1024, 512);
        assert_eq!(s.pixels(), 524_288);
        assert!((s.aspect() - 2.0).abs() < f64::EPSILON);
        assert_eq!(s.to_string(), "1024x512");
        assert_eq!(ImageSize::new(10, 0).aspect(), 0.0);
    }

    #[test]
    fn auth_method_expiry_and_redaction() {
        let key = AuthMethod::ApiKey(SecretString::new("k"));
        assert!(!key.is_expired(u64::MAX));
        let oauth = AuthMethod::OAuth {
            access: SecretString::new("ya29.TOPSECRET-TOKEN"),
            refresh: Some(SecretString::new("1//REFRESH-SECRET")),
            expires_at: 100,
        };
        assert!(oauth.is_expired(100));
        assert!(!oauth.is_expired(99));
        let dbg = format!("{oauth:?}");
        assert!(!dbg.contains("TOPSECRET"));
        assert!(!dbg.contains("REFRESH-SECRET"));
        assert!(dbg.contains("[REDACTED]"));
    }

    #[test]
    fn edit_request_constructors_set_mode() {
        let img = ImageBytes::png(vec![1, 2, 3]);
        let a = EditRequest::instruct("make it blue", img.clone());
        assert_eq!(a.mode, EditMode::Instruct);
        assert!(a.mask.is_none());
        let b = EditRequest::masked("make it blue", img.clone(), img);
        assert_eq!(b.mode, EditMode::Mask);
        assert_eq!(b.mask.as_ref().map(ImageBytes::len), Some(3));
        assert_eq!(GenerateRequest::default().n, 1);
    }
}
