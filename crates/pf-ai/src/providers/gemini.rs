//! Google Gemini image models via `generateContent`.
//!
//! Facts from docs/ai-research.md section 3: `POST /v1beta/models/{model}:generateContent`
//! with `x-goog-api-key`; `contents[0].parts` = text + `inline_data` images; output in
//! `candidates[0].content.parts[].inlineData.{mimeType,data}` (camelCase); inline request
//! total <= 20 MB; **no mask parameter**; up to 14 reference images (3.1 Flash).
//!
//! The docs disagree on where the size goes: the API reference says
//! `generationConfig.imageConfig{aspectRatio,imageSize}`, the legacy guide says
//! `generationConfig.responseFormat.image{...}`. We send `imageConfig` by default and
//! expose [`GeminiSizeField::ResponseFormat`] (also via `PF_GEMINI_SIZE_FIELD=responseFormat`)
//! as the switch. TODO(live-verify): confirm against a real key and delete the loser.

use async_trait::async_trait;
use serde::Deserialize;

use crate::capabilities::{
    capabilities_for, nearest_aspect_ratio, GEMINI_ASPECT_RATIOS, GEMINI_MODEL,
};
use crate::error::Error;
use crate::http;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{
    AuthMethod, Capabilities, EditRequest, GenerateRequest, ImageBytes, ImageResult, ImageSize,
    ProviderId,
};

/// Production base URL.
pub const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com";
/// Header carrying the API key.
pub const API_KEY_HEADER: &str = "x-goog-api-key";

/// Inline request cap (20 MB). Above this the Files API would be needed (not in v1).
pub const MAX_INLINE_BYTES: usize = 20 * 1000 * 1000;

/// Where the size / aspect config is placed in `generationConfig`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GeminiSizeField {
    /// `generationConfig.imageConfig {aspectRatio, imageSize}` (API reference). Default.
    #[default]
    ImageConfig,
    /// `generationConfig.responseFormat.image {aspectRatio, imageSize}` (legacy guide).
    ResponseFormat,
}

impl GeminiSizeField {
    /// Read `PF_GEMINI_SIZE_FIELD` (`imageConfig` | `responseFormat`); default on anything else.
    pub fn from_env() -> Self {
        match std::env::var("PF_GEMINI_SIZE_FIELD")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "responseformat" | "response_format" => Self::ResponseFormat,
            _ => Self::ImageConfig,
        }
    }
}

/// Gemini provider handle.
#[derive(Debug, Clone)]
pub struct GeminiProvider {
    client: reqwest::Client,
    auth: AuthMethod,
    base_url: String,
    size_field: GeminiSizeField,
}

impl GeminiProvider {
    /// Create a provider with the production base URL and the env-selected size field.
    pub fn new(auth: AuthMethod) -> Result<Self, Error> {
        Ok(Self {
            client: http::client()?,
            auth,
            base_url: DEFAULT_BASE_URL.to_owned(),
            size_field: GeminiSizeField::from_env(),
        })
    }

    /// Point at another host (wiremock, proxy).
    pub fn with_base_url(mut self, base_url: &str) -> Self {
        self.base_url = base_url.trim_end_matches('/').to_owned();
        self
    }

    /// Swap the HTTP client.
    pub fn with_client(mut self, client: reqwest::Client) -> Self {
        self.client = client;
        self
    }

    /// Choose where the size config goes (see module docs).
    pub fn with_size_field(mut self, field: GeminiSizeField) -> Self {
        self.size_field = field;
        self
    }

    fn generate_url(&self, model: &str) -> String {
        format!("{}/v1beta/models/{model}:generateContent", self.base_url)
    }

    fn check_inline_budget(prompt: &str, images: &[&ImageBytes]) -> Result<(), Error> {
        // base64 inflates by 4/3; add a little slack for JSON framing.
        let total: usize = images
            .iter()
            .map(|i| i.len().div_ceil(3) * 4)
            .sum::<usize>()
            + prompt.len()
            + 1024;
        if total > MAX_INLINE_BYTES {
            return Err(Error::InvalidRequest(format!(
                "inline request would be ~{total} bytes; Gemini accepts up to 20 MB inline"
            )));
        }
        for (i, img) in images.iter().enumerate() {
            match http::sniff_mime(&img.data) {
                Some("image/png" | "image/jpeg" | "image/webp") => {}
                _ => {
                    return Err(Error::InvalidRequest(format!(
                        "input image {i} must be PNG, JPEG or WebP for Gemini"
                    )))
                }
            }
        }
        Ok(())
    }

    fn request_body(
        &self,
        prompt: &str,
        images: &[&ImageBytes],
        size: Option<ImageSize>,
    ) -> serde_json::Value {
        let mut parts = vec![serde_json::json!({ "text": prompt })];
        for img in images {
            parts.push(serde_json::json!({
                "inline_data": {
                    "mime_type": http::input_mime(img),
                    "data": http::b64_encode(&img.data),
                }
            }));
        }
        let mut generation_config = serde_json::json!({ "responseModalities": ["IMAGE"] });
        if let Some(size) = size {
            let mut cfg = serde_json::json!({ "imageSize": image_size_for(size) });
            if let Some(ratio) = nearest_aspect_ratio(size, GEMINI_ASPECT_RATIOS) {
                cfg["aspectRatio"] = serde_json::Value::String(ratio);
            }
            match self.size_field {
                GeminiSizeField::ImageConfig => generation_config["imageConfig"] = cfg,
                GeminiSizeField::ResponseFormat => {
                    generation_config["responseFormat"] = serde_json::json!({ "image": cfg });
                }
            }
        }
        serde_json::json!({
            "contents": [{ "parts": parts }],
            "generationConfig": generation_config,
        })
    }

    /// One `generateContent` call = one image. `n` variants are `n` sequential calls.
    async fn run(
        &self,
        prompt: &str,
        images: &[&ImageBytes],
        size: Option<ImageSize>,
        model: &str,
        n: u8,
    ) -> Result<Vec<ImageResult>, Error> {
        Self::check_inline_budget(prompt, images)?;
        let body = self.request_body(prompt, images, size);
        let cost = price_for(model, size);
        let mut results = Vec::with_capacity(usize::from(n));
        for _ in 0..n.max(1) {
            let resp = self
                .client
                .post(self.generate_url(model))
                .header(API_KEY_HEADER, self.auth.token().expose())
                .json(&body)
                .send()
                .await?;
            let resp = http::ensure_success(self.id(), resp).await?;
            let parsed: GenerateContentResponse = resp.json().await?;
            results.push(parsed.into_result(model, cost)?);
        }
        Ok(results)
    }
}

/// `imageSize` tier for a requested size (uppercase `K` is mandatory).
pub fn image_size_for(size: ImageSize) -> &'static str {
    match size.width.max(size.height) {
        0..=512 => "512",
        513..=1024 => "1K",
        1025..=2048 => "2K",
        _ => "4K",
    }
}

/// Per-image price (docs/ai-research.md): 3.1 Flash $0.045/0.067/0.101/0.151 for
/// 0.5K/1K/2K/4K; 3.1 Flash Lite $0.0336; 3 Pro $0.134 (1K/2K) / $0.24 (4K).
pub fn price_for(model: &str, size: Option<ImageSize>) -> Option<f64> {
    let tier = size.map(image_size_for).unwrap_or("1K");
    if model.contains("lite") {
        Some(0.0336)
    } else if model.contains("pro") {
        Some(if tier == "4K" { 0.24 } else { 0.134 })
    } else if model.contains("flash") {
        Some(match tier {
            "512" => 0.045,
            "1K" => 0.067,
            "2K" => 0.101,
            _ => 0.151,
        })
    } else {
        None
    }
}

#[async_trait]
impl ImageProvider for GeminiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }

    fn capabilities(&self) -> Capabilities {
        capabilities_for(ProviderId::Gemini)
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(self.id(), &self.capabilities(), &req)?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        let model = req.model.clone().unwrap_or_else(|| GEMINI_MODEL.to_owned());
        let images: Vec<&ImageBytes> = req.reference_images.iter().collect();
        self.run(&prompt, &images, req.size, &model, req.n).await
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(self.id(), &self.capabilities(), &req)?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        let model = req.model.clone().unwrap_or_else(|| GEMINI_MODEL.to_owned());
        let mut images: Vec<&ImageBytes> = vec![&req.image];
        images.extend(req.reference_images.iter());
        self.run(&prompt, &images, req.size, &model, req.n).await
    }

    async fn test_key(&self) -> Result<(), Error> {
        let resp = self
            .client
            .get(format!("{}/v1beta/models", self.base_url))
            .query(&[("pageSize", "1")])
            .header(API_KEY_HEADER, self.auth.token().expose())
            .send()
            .await?;
        http::ensure_success(self.id(), resp).await.map(|_| ())
    }
}

/// `generateContent` response (camelCase on the way out).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentResponse {
    #[serde(default)]
    candidates: Vec<Candidate>,
    #[serde(default)]
    prompt_feedback: Option<PromptFeedback>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    #[serde(default)]
    content: Option<Content>,
    #[serde(default)]
    finish_reason: Option<String>,
    #[serde(default)]
    safety_ratings: Vec<SafetyRating>,
}

#[derive(Debug, Deserialize)]
struct Content {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Part {
    #[serde(default)]
    inline_data: Option<InlineData>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InlineData {
    #[serde(default)]
    mime_type: Option<String>,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptFeedback {
    #[serde(default)]
    block_reason: Option<String>,
    #[serde(default)]
    safety_ratings: Vec<SafetyRating>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafetyRating {
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    blocked: Option<bool>,
}

const BLOCKING_FINISH_REASONS: [&str; 5] = [
    "SAFETY",
    "IMAGE_SAFETY",
    "PROHIBITED_CONTENT",
    "BLOCKLIST",
    "SPII",
];

fn blocked_categories(ratings: &[SafetyRating]) -> Vec<String> {
    ratings
        .iter()
        .filter(|r| r.blocked.unwrap_or(false))
        .filter_map(|r| r.category.clone())
        .collect()
}

impl GenerateContentResponse {
    fn into_result(self, model: &str, cost: Option<f64>) -> Result<ImageResult, Error> {
        if let Some(fb) = &self.prompt_feedback {
            if let Some(reason) = &fb.block_reason {
                return Err(Error::Moderation {
                    provider: ProviderId::Gemini,
                    categories: blocked_categories(&fb.safety_ratings),
                    message: format!("prompt blocked ({reason})"),
                });
            }
        }
        let Some(candidate) = self.candidates.into_iter().next() else {
            return Err(Error::InvalidResponse(
                "no candidates in response".to_owned(),
            ));
        };
        let mut text = None;
        if let Some(content) = candidate.content {
            for part in content.parts {
                if let Some(inline) = part.inline_data {
                    let raw = http::b64_decode(&inline.data)?;
                    let (image, width, height) = http::normalize_to_png(raw)?;
                    let _ = inline.mime_type; // always normalised to PNG
                    return Ok(ImageResult {
                        image,
                        width,
                        height,
                        provider: ProviderId::Gemini,
                        model: model.to_owned(),
                        revised_prompt: None,
                        cost_usd: cost,
                    });
                }
                if text.is_none() {
                    text = part.text;
                }
            }
        }
        let reason = candidate.finish_reason.unwrap_or_default();
        if BLOCKING_FINISH_REASONS.contains(&reason.as_str()) {
            return Err(Error::Moderation {
                provider: ProviderId::Gemini,
                categories: blocked_categories(&candidate.safety_ratings),
                message: format!("response blocked ({reason})"),
            });
        }
        Err(Error::InvalidResponse(match text {
            Some(t) => format!(
                "model returned text instead of an image: {}",
                http::truncate(&t, 300)
            ),
            None => format!("no image part in response (finishReason={reason:?})"),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_tiers_and_prices() {
        assert_eq!(image_size_for(ImageSize::new(512, 512)), "512");
        assert_eq!(image_size_for(ImageSize::new(1024, 768)), "1K");
        assert_eq!(image_size_for(ImageSize::new(2048, 1024)), "2K");
        assert_eq!(image_size_for(ImageSize::new(4096, 4096)), "4K");
        assert_eq!(price_for(GEMINI_MODEL, None), Some(0.067));
        assert_eq!(
            price_for(GEMINI_MODEL, Some(ImageSize::square(4096))),
            Some(0.151)
        );
        assert_eq!(
            price_for("gemini-3-pro-image", Some(ImageSize::square(4096))),
            Some(0.24)
        );
        assert_eq!(price_for("gemini-3.1-flash-lite-image", None), Some(0.0336));
        assert_eq!(price_for("unknown", None), None);
    }

    #[test]
    fn size_field_switch_changes_body_shape() {
        let auth = AuthMethod::ApiKey(crate::SecretString::new("k"));
        let p = GeminiProvider::new(auth).expect("builds");
        let body = p
            .clone()
            .with_size_field(GeminiSizeField::ImageConfig)
            .request_body("hi", &[], Some(ImageSize::new(1024, 1024)));
        assert_eq!(body["generationConfig"]["imageConfig"]["imageSize"], "1K");
        assert_eq!(
            body["generationConfig"]["imageConfig"]["aspectRatio"],
            "1:1"
        );
        assert_eq!(body["generationConfig"]["responseModalities"][0], "IMAGE");
        let body = p
            .with_size_field(GeminiSizeField::ResponseFormat)
            .request_body("hi", &[], Some(ImageSize::new(1024, 1024)));
        assert_eq!(
            body["generationConfig"]["responseFormat"]["image"]["imageSize"],
            "1K"
        );
        assert!(body["generationConfig"].get("imageConfig").is_none());
    }

    #[test]
    fn blocked_response_maps_to_moderation() {
        let json = r#"{"promptFeedback":{"blockReason":"SAFETY","safetyRatings":[{"category":"HARM_CATEGORY_DANGEROUS_CONTENT","probability":"HIGH","blocked":true}]}}"#;
        let parsed: GenerateContentResponse = serde_json::from_str(json).expect("parses");
        match parsed.into_result("m", None) {
            Err(Error::Moderation { categories, .. }) => {
                assert_eq!(categories, vec!["HARM_CATEGORY_DANGEROUS_CONTENT"]);
            }
            other => panic!("unexpected {other:?}"),
        }
        let json = r#"{"candidates":[{"content":{"parts":[{"text":"I can't do that"}]},"finishReason":"STOP"}]}"#;
        let parsed: GenerateContentResponse = serde_json::from_str(json).expect("parses");
        assert!(
            matches!(parsed.into_result("m", None), Err(Error::InvalidResponse(m)) if m.contains("can't"))
        );
    }
}
