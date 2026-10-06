//! xAI Grok Imagine (`/v1/images/generations` and `/v1/images/edits`, both JSON).
//!
//! Facts from docs/ai-research.md section 2: OpenAI-compatible JSON, `response_format`
//! must be `"b64_json"` to avoid expiring URLs, inputs are `image: {type:"image_url",
//! url:"data:…"}` or `images: [...]` (max 5, referenced as `<IMAGE_n>`), each <= 20 MiB
//! and PNG/JPEG only. **No mask field** - the UI emulates masks.

use async_trait::async_trait;
use serde::Deserialize;

use crate::capabilities::{capabilities_for, nearest_aspect_ratio, XAI_ASPECT_RATIOS, XAI_MODEL};
use crate::error::Error;
use crate::http;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{
    AuthMethod, Capabilities, EditRequest, GenerateRequest, ImageBytes, ImageResult, ImageSize,
    ProviderId,
};

/// Production base URL.
pub const DEFAULT_BASE_URL: &str = "https://api.x.ai";
const GENERATIONS_PATH: &str = "/v1/images/generations";
const EDITS_PATH: &str = "/v1/images/edits";
const MODELS_PATH: &str = "/v1/models";

/// Input image cap (20 MiB).
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// xAI provider handle.
#[derive(Debug, Clone)]
pub struct XaiProvider {
    client: reqwest::Client,
    auth: AuthMethod,
    base_url: String,
}

impl XaiProvider {
    /// Create a provider with the production base URL.
    pub fn new(auth: AuthMethod) -> Result<Self, Error> {
        Ok(Self {
            client: http::client()?,
            auth,
            base_url: DEFAULT_BASE_URL.to_owned(),
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

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
    }

    fn check_image(img: &ImageBytes, what: &str) -> Result<(), Error> {
        if img.len() > MAX_IMAGE_BYTES {
            return Err(Error::InvalidRequest(format!(
                "{what} is {} bytes; xAI accepts images up to 20 MiB",
                img.len()
            )));
        }
        match http::sniff_mime(&img.data) {
            Some("image/png" | "image/jpeg") => Ok(()),
            _ => Err(Error::InvalidRequest(format!(
                "{what} must be PNG or JPEG for xAI"
            ))),
        }
    }

    fn image_object(img: &ImageBytes) -> serde_json::Value {
        serde_json::json!({
            "type": "image_url",
            "url": http::data_url(&http::input_mime(img), &img.data),
        })
    }

    fn apply_size(body: &mut serde_json::Value, size: Option<ImageSize>) {
        let Some(size) = size else { return };
        if let Some(ratio) = nearest_aspect_ratio(size, XAI_ASPECT_RATIOS) {
            body["aspect_ratio"] = serde_json::Value::String(ratio);
        }
        body["resolution"] = serde_json::Value::String(resolution_for(size).to_owned());
    }

    async fn post(
        &self,
        path: &str,
        body: &serde_json::Value,
        model: &str,
        n: u8,
    ) -> Result<Vec<ImageResult>, Error> {
        let resp = self
            .client
            .post(self.url(path))
            .header(reqwest::header::AUTHORIZATION, http::bearer(&self.auth))
            .json(body)
            .send()
            .await?;
        let resp = http::ensure_success(self.id(), resp).await?;
        let parsed: ImagesResponse = resp.json().await?;
        parsed.into_results(model, n)
    }

    /// JSON body for an edit with `image` (single) or `images` (multi, `<IMAGE_n>` tokens).
    fn edit_body(
        prompt: &str,
        model: &str,
        n: u8,
        images: &[&ImageBytes],
        size: Option<ImageSize>,
        quality: Option<&str>,
    ) -> serde_json::Value {
        let mut body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "n": n,
            "response_format": "b64_json",
        });
        if images.len() == 1 {
            body["image"] = Self::image_object(images[0]);
        } else {
            body["images"] =
                serde_json::Value::Array(images.iter().map(|i| Self::image_object(i)).collect());
        }
        Self::apply_size(&mut body, size);
        if let Some(q) = quality {
            body["quality"] = serde_json::Value::String(q.to_owned());
        }
        body
    }
}

/// `resolution` tier for a requested size (2K is xAI's maximum).
pub fn resolution_for(size: ImageSize) -> &'static str {
    match size.width.max(size.height) {
        0..=1024 => "1k",
        1025..=1536 => "1.5k",
        _ => "2k",
    }
}

/// Flat per-image price (docs/ai-research.md): 2.0 $0.04, image $0.02, quality $0.05.
/// Edits are "billed for both the input image and the generated output image"; the
/// exact input charge is not published, so this is the output price only.
pub fn price_per_image(model: &str) -> f64 {
    if model.ends_with("-quality") {
        0.05
    } else if model == "grok-imagine-image" {
        0.02
    } else {
        0.04
    }
}

#[async_trait]
impl ImageProvider for XaiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::XAi
    }

    fn capabilities(&self) -> Capabilities {
        capabilities_for(ProviderId::XAi)
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(self.id(), &self.capabilities(), &req)?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        let model = req.model.clone().unwrap_or_else(|| XAI_MODEL.to_owned());

        if !req.reference_images.is_empty() {
            for (i, img) in req.reference_images.iter().enumerate() {
                Self::check_image(img, &format!("reference image {i}"))?;
            }
            let images: Vec<&ImageBytes> = req.reference_images.iter().collect();
            let body = Self::edit_body(
                &prompt,
                &model,
                req.n,
                &images,
                req.size,
                req.quality.as_deref(),
            );
            return self.post(EDITS_PATH, &body, &model, req.n).await;
        }

        let mut body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "n": req.n,
            "response_format": "b64_json",
        });
        Self::apply_size(&mut body, req.size);
        if let Some(q) = &req.quality {
            body["quality"] = serde_json::Value::String(q.clone());
        }
        self.post(GENERATIONS_PATH, &body, &model, req.n).await
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(self.id(), &self.capabilities(), &req)?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        let model = req.model.clone().unwrap_or_else(|| XAI_MODEL.to_owned());
        Self::check_image(&req.image, "input image")?;
        for (i, img) in req.reference_images.iter().enumerate() {
            Self::check_image(img, &format!("reference image {}", i + 1))?;
        }
        let mut images: Vec<&ImageBytes> = vec![&req.image];
        images.extend(req.reference_images.iter());
        let body = Self::edit_body(
            &prompt,
            &model,
            req.n,
            &images,
            req.size,
            req.quality.as_deref(),
        );
        self.post(EDITS_PATH, &body, &model, req.n).await
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

/// Response: `data[].{b64_json | url, mime_type}`, `model`, `usage{...}`.
#[derive(Debug, Deserialize)]
struct ImagesResponse {
    #[serde(default)]
    data: Vec<ImageDatum>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImageDatum {
    #[serde(default)]
    b64_json: Option<String>,
    #[serde(default)]
    revised_prompt: Option<String>,
}

impl ImagesResponse {
    fn into_results(self, requested_model: &str, _n: u8) -> Result<Vec<ImageResult>, Error> {
        if self.data.is_empty() {
            return Err(Error::InvalidResponse("no images in response".to_owned()));
        }
        let model = self.model.unwrap_or_else(|| requested_model.to_owned());
        let cost = price_per_image(&model);
        self.data
            .into_iter()
            .map(|d| {
                let b64 = d.b64_json.ok_or_else(|| {
                    Error::InvalidResponse(
                        "image without b64_json (did the request set response_format?)".to_owned(),
                    )
                })?;
                let (image, width, height) = http::normalize_to_png(http::b64_decode(&b64)?)?;
                Ok(ImageResult {
                    image,
                    width,
                    height,
                    provider: ProviderId::XAi,
                    model: model.clone(),
                    revised_prompt: d.revised_prompt,
                    cost_usd: Some(cost),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolution_tiers_and_prices() {
        assert_eq!(resolution_for(ImageSize::new(1024, 768)), "1k");
        assert_eq!(resolution_for(ImageSize::new(1536, 1024)), "1.5k");
        assert_eq!(resolution_for(ImageSize::new(2048, 2048)), "2k");
        assert!((price_per_image(XAI_MODEL) - 0.04).abs() < f64::EPSILON);
        assert!((price_per_image("grok-imagine-image") - 0.02).abs() < f64::EPSILON);
        assert!((price_per_image("grok-imagine-image-quality") - 0.05).abs() < f64::EPSILON);
    }
}
