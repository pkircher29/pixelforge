//! OpenAI image API (`/v1/images/generations` JSON, `/v1/images/edits` multipart).
//!
//! Facts from docs/ai-research.md section 1: GPT-image models always return
//! `b64_json`; the mask is an RGBA PNG at the image's exact size where **alpha = 0
//! means "edit here"**, must be < 4 MB; up to 16 `image[]` files < 50 MB each; prompt
//! up to 32k chars; custom sizes are multiples of 16, aspect <= 3:1, max edge 3840 px,
//! 655,360-8,294,400 total pixels.

use async_trait::async_trait;
use reqwest::multipart::{Form, Part};
use serde::Deserialize;

use crate::capabilities::{
    capabilities_for, OPENAI_EDIT_MODEL, OPENAI_GENERATE_MODEL, OPENAI_PRESET_SIZES,
};
use crate::error::Error;
use crate::http;
use crate::mask;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{
    AuthMethod, Capabilities, EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult,
    ImageSize, ProviderId,
};

/// Production base URL.
pub const DEFAULT_BASE_URL: &str = "https://api.openai.com";
const GENERATIONS_PATH: &str = "/v1/images/generations";
const EDITS_PATH: &str = "/v1/images/edits";
const MODELS_PATH: &str = "/v1/models";

/// Each `image[]` file must be < 50 MB.
pub const MAX_IMAGE_BYTES: usize = 50 * 1024 * 1024;
/// The mask PNG must be < 4 MB.
pub const MAX_MASK_BYTES: usize = 4 * 1024 * 1024;
/// Prompt length cap.
pub const MAX_PROMPT_CHARS: usize = 32_000;

/// OpenAI provider handle.
#[derive(Debug, Clone)]
pub struct OpenAiProvider {
    client: reqwest::Client,
    auth: AuthMethod,
    base_url: String,
}

impl OpenAiProvider {
    /// Create a provider with the production base URL.
    pub fn new(auth: AuthMethod) -> Result<Self, Error> {
        Ok(Self {
            client: http::client()?,
            auth,
            base_url: DEFAULT_BASE_URL.to_owned(),
        })
    }

    /// Point at another host (wiremock, proxy). Trailing slashes are trimmed.
    pub fn with_base_url(mut self, base_url: &str) -> Self {
        self.base_url = base_url.trim_end_matches('/').to_owned();
        self
    }

    /// Swap the HTTP client.
    pub fn with_client(mut self, client: reqwest::Client) -> Self {
        self.client = client;
        self
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
    }

    fn check_prompt(prompt: &str) -> Result<(), Error> {
        if prompt.chars().count() > MAX_PROMPT_CHARS {
            return Err(Error::InvalidRequest(format!(
                "prompt exceeds {MAX_PROMPT_CHARS} characters"
            )));
        }
        Ok(())
    }

    fn check_image(img: &ImageBytes, what: &str) -> Result<(), Error> {
        if img.len() >= MAX_IMAGE_BYTES {
            return Err(Error::InvalidRequest(format!(
                "{what} is {} bytes; OpenAI accepts images under 50 MB",
                img.len()
            )));
        }
        match http::sniff_mime(&img.data) {
            Some("image/png" | "image/jpeg" | "image/webp") => Ok(()),
            _ => Err(Error::InvalidRequest(format!(
                "{what} must be PNG, JPEG or WebP"
            ))),
        }
    }

    /// Multipart edit call shared by `edit` and `generate`-with-references.
    async fn post_edit(&self, form: Form, model: &str, n: u8) -> Result<Vec<ImageResult>, Error> {
        let resp = self
            .client
            .post(self.url(EDITS_PATH))
            .header(reqwest::header::AUTHORIZATION, http::bearer(&self.auth))
            .multipart(form)
            .send()
            .await?;
        let resp = http::ensure_success(ProviderId::OpenAi, resp).await?;
        let body: ImagesResponse = resp.json().await?;
        body.into_results(model, n)
    }

    fn common_form(
        prompt: &str,
        model: &str,
        n: u8,
        size: Option<ImageSize>,
        quality: Option<&str>,
        transparent: bool,
    ) -> Result<Form, Error> {
        let mut form = Form::new()
            .text("model", model.to_owned())
            .text("prompt", prompt.to_owned())
            .text("n", n.to_string())
            .text("output_format", "png")
            .text("size", size_param(size)?);
        if let Some(q) = quality {
            form = form.text("quality", q.to_owned());
        }
        if transparent {
            form = form.text("background", "transparent");
        }
        Ok(form)
    }

    fn file_part(img: &ImageBytes, index: usize) -> Result<Part, Error> {
        let mime = http::input_mime(img);
        let ext = match mime.as_str() {
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            _ => "png",
        };
        Part::bytes(img.data.clone())
            .file_name(format!("image{index}.{ext}"))
            .mime_str(&mime)
            .map_err(|e| Error::InvalidRequest(format!("bad image MIME: {e}")))
    }
}

/// `size` field: `auto` when unset, else a validated `WIDTHxHEIGHT`.
fn size_param(size: Option<ImageSize>) -> Result<String, Error> {
    match size {
        None => Ok("auto".to_owned()),
        Some(s) => {
            validate_openai_size(s)?;
            Ok(s.to_string())
        }
    }
}

/// OpenAI size rules: one of the presets, or a custom size that is a multiple of 16,
/// aspect <= 3:1, max edge 3840 px and 655,360-8,294,400 total pixels.
pub fn validate_openai_size(size: ImageSize) -> Result<(), Error> {
    if OPENAI_PRESET_SIZES.contains(&size) {
        return Ok(());
    }
    let bad = |why: &str| Err(Error::InvalidRequest(format!("{size}: {why}")));
    if !size.width.is_multiple_of(16) || !size.height.is_multiple_of(16) {
        return bad("custom OpenAI sizes must be multiples of 16");
    }
    if size.width > 3840 || size.height > 3840 {
        return bad("OpenAI's maximum edge is 3840 px");
    }
    let aspect = size.aspect();
    if !(1.0 / 3.0..=3.0).contains(&aspect) {
        return bad("OpenAI's aspect ratio limit is 3:1");
    }
    let px = size.pixels();
    if !(655_360..=8_294_400).contains(&px) {
        return bad("OpenAI accepts 655,360-8,294,400 total pixels");
    }
    Ok(())
}

#[async_trait]
impl ImageProvider for OpenAiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAi
    }

    fn capabilities(&self) -> Capabilities {
        capabilities_for(ProviderId::OpenAi)
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(self.id(), &self.capabilities(), &req)?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        Self::check_prompt(&prompt)?;

        // The generations endpoint takes no input images: references go through /edits.
        if !req.reference_images.is_empty() {
            let model = req
                .model
                .clone()
                .unwrap_or_else(|| OPENAI_EDIT_MODEL.to_owned());
            let mut form = Self::common_form(
                &prompt,
                &model,
                req.n,
                req.size,
                req.quality.as_deref(),
                req.transparent,
            )?;
            for (i, img) in req.reference_images.iter().enumerate() {
                Self::check_image(img, &format!("reference image {i}"))?;
                form = form.part("image[]", Self::file_part(img, i)?);
            }
            return self.post_edit(form, &model, req.n).await;
        }

        let model = req
            .model
            .clone()
            .unwrap_or_else(|| OPENAI_GENERATE_MODEL.to_owned());
        let mut body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "n": req.n,
            "size": size_param(req.size)?,
            "output_format": "png",
        });
        if let Some(q) = &req.quality {
            body["quality"] = serde_json::Value::String(q.clone());
        }
        if req.transparent {
            body["background"] = serde_json::Value::String("transparent".to_owned());
        }
        let resp = self
            .client
            .post(self.url(GENERATIONS_PATH))
            .header(reqwest::header::AUTHORIZATION, http::bearer(&self.auth))
            .json(&body)
            .send()
            .await?;
        let resp = http::ensure_success(self.id(), resp).await?;
        let parsed: ImagesResponse = resp.json().await?;
        parsed.into_results(&model, req.n)
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(self.id(), &self.capabilities(), &req)?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        Self::check_prompt(&prompt)?;
        Self::check_image(&req.image, "input image")?;
        let model = req
            .model
            .clone()
            .unwrap_or_else(|| OPENAI_EDIT_MODEL.to_owned());

        let mut form = Self::common_form(
            &prompt,
            &model,
            req.n,
            req.size,
            req.quality.as_deref(),
            req.transparent,
        )?;
        form = form.part("image[]", Self::file_part(&req.image, 0)?);
        for (i, img) in req.reference_images.iter().enumerate() {
            Self::check_image(img, &format!("reference image {}", i + 1))?;
            form = form.part("image[]", Self::file_part(img, i + 1)?);
        }

        if req.mode == EditMode::Mask {
            let user_mask = req
                .mask
                .as_ref()
                .ok_or_else(|| Error::InvalidRequest("mask edit without a mask".to_owned()))?;
            let (w, h) = http::dimensions(&req.image.data)?;
            // Pixelforge masks are "white = editable"; OpenAI wants alpha = 0 = editable.
            let mask_png = mask::to_openai_mask(&user_mask.data, w, h)?;
            if mask_png.len() >= MAX_MASK_BYTES {
                return Err(Error::InvalidRequest(format!(
                    "mask PNG is {} bytes; OpenAI accepts masks under 4 MB",
                    mask_png.len()
                )));
            }
            let part = Part::bytes(mask_png)
                .file_name("mask.png")
                .mime_str("image/png")
                .map_err(|e| Error::InvalidRequest(format!("bad mask MIME: {e}")))?;
            form = form.part("mask", part);
        }

        self.post_edit(form, &model, req.n).await
    }

    async fn test_key(&self) -> Result<(), Error> {
        let resp = self
            .client
            .get(self.url(MODELS_PATH))
            .header(reqwest::header::AUTHORIZATION, http::bearer(&self.auth))
            .send()
            .await?;
        http::ensure_success(self.id(), resp).await.map(|_| ())
    }
}

/// Verbatim response shape (docs/ai-research.md section 1).
#[derive(Debug, Deserialize)]
struct ImagesResponse {
    #[serde(default)]
    data: Vec<ImageDatum>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct ImageDatum {
    #[serde(default)]
    b64_json: Option<String>,
    #[serde(default)]
    revised_prompt: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    input_tokens_details: Option<InputTokensDetails>,
    #[serde(default)]
    output_tokens: u64,
}

#[derive(Debug, Deserialize, Default)]
struct InputTokensDetails {
    #[serde(default)]
    image_tokens: u64,
    #[serde(default)]
    text_tokens: u64,
}

impl ImagesResponse {
    fn into_results(self, model: &str, n: u8) -> Result<Vec<ImageResult>, Error> {
        if self.data.is_empty() {
            return Err(Error::InvalidResponse("no images in response".to_owned()));
        }
        let per_image_cost = self
            .usage
            .as_ref()
            .map(|u| usage_cost_usd(u, model) / f64::from(n.max(1)));
        self.data
            .into_iter()
            .map(|d| {
                let b64 = d
                    .b64_json
                    .ok_or_else(|| Error::InvalidResponse("image without b64_json".to_owned()))?;
                let (image, width, height) = http::normalize_to_png(http::b64_decode(&b64)?)?;
                Ok(ImageResult {
                    image,
                    width,
                    height,
                    provider: ProviderId::OpenAi,
                    model: model.to_owned(),
                    revised_prompt: d.revised_prompt,
                    cost_usd: per_image_cost,
                })
            })
            .collect()
    }
}

/// Token pricing per docs/ai-research.md: $5/M text in, $8/M image in, image out $30/M
/// (2.5 / 2), $32/M (1.5), $40/M (1), $8/M (mini).
fn usage_cost_usd(u: &Usage, model: &str) -> f64 {
    let out_rate = if model.contains("mini") {
        8.0
    } else if model.contains("gpt-image-1.5") {
        32.0
    } else if model.contains("gpt-image-1") {
        40.0
    } else {
        30.0
    };
    let (text_in, image_in) = match &u.input_tokens_details {
        Some(d) => (d.text_tokens, d.image_tokens),
        None => (u.input_tokens, 0),
    };
    (text_in as f64 * 5.0 + image_in as f64 * 8.0 + u.output_tokens as f64 * out_rate) / 1e6
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_rules() {
        assert!(validate_openai_size(ImageSize::new(1024, 1024)).is_ok());
        assert!(validate_openai_size(ImageSize::new(1536, 1024)).is_ok());
        assert!(validate_openai_size(ImageSize::new(2048, 1152)).is_ok());
        assert!(validate_openai_size(ImageSize::new(1000, 1000)).is_err()); // not /16
        assert!(validate_openai_size(ImageSize::new(4096, 2048)).is_err()); // edge
        assert!(validate_openai_size(ImageSize::new(3840, 1024)).is_err()); // 3.75:1
        assert!(validate_openai_size(ImageSize::new(512, 512)).is_err()); // too few px
        assert_eq!(size_param(None).expect("auto"), "auto");
        assert_eq!(
            size_param(Some(ImageSize::new(1024, 1536))).expect("preset"),
            "1024x1536"
        );
    }

    #[test]
    fn cost_from_usage() {
        let u = Usage {
            input_tokens: 100,
            input_tokens_details: Some(InputTokensDetails {
                image_tokens: 0,
                text_tokens: 100,
            }),
            output_tokens: 1000,
        };
        let c = usage_cost_usd(&u, "gpt-image-2.5-flare");
        assert!((c - (100.0 * 5.0 + 1000.0 * 30.0) / 1e6).abs() < 1e-12);
        assert!(usage_cost_usd(&u, "gpt-image-1-mini") < c);
    }
}
