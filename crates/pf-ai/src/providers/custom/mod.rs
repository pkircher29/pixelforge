//! Backends for user-defined providers (`crate::custom`). Each kind implements
//! [`ImageProvider`] so the job queue and the Tauri layer treat them exactly like the
//! built-ins; [`probe`] and [`prompt_assist`] are the two extra entry points.

pub mod a1111;
pub mod comfy;
pub mod hf;
pub mod ollama;
pub mod openai_compat;
pub mod replicate;

use std::sync::Arc;

use serde_json::Value;

use crate::custom::{CustomKind, CustomProvider, ProbeResult};
use crate::error::Error;
use crate::http;
use crate::providers::SharedProvider;
use crate::secret::SecretString;
use crate::types::{ImageBytes, ImageResult, ImageSize, ProviderId};

/// Shared state every custom backend carries: the registry entry, the optional secret
/// and an HTTP client.
#[derive(Debug, Clone)]
pub struct Ctx {
    /// Registry entry.
    pub cfg: CustomProvider,
    /// API key / token / `user:pass` (A1111 basic auth), when configured.
    pub auth: Option<SecretString>,
    client: reqwest::Client,
}

impl Ctx {
    /// Build with the crate's default client.
    pub fn new(cfg: CustomProvider, auth: Option<SecretString>) -> Result<Self, Error> {
        cfg.validate()?;
        Ok(Self {
            cfg,
            auth: auth.filter(|a| !a.is_empty()),
            client: http::client()?,
        })
    }

    /// Swap the HTTP client (tests).
    pub fn with_client(mut self, client: reqwest::Client) -> Self {
        self.client = client;
        self
    }

    /// The HTTP client.
    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// `custom:<id>`.
    pub fn id(&self) -> ProviderId {
        self.cfg.provider_id()
    }

    /// Base URL without trailing slash.
    pub fn base(&self) -> String {
        self.cfg.base()
    }

    /// `{base}{path}`.
    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base())
    }

    /// Add `Authorization: Bearer <secret>` when a secret is configured.
    pub fn bearer(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.auth {
            Some(a) => req.header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", a.expose()),
            ),
            None => req,
        }
    }

    /// The model to use: the request override, else the registry entry's.
    pub fn model(&self, req_model: Option<&str>) -> String {
        req_model
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or(self.cfg.model.trim())
            .to_owned()
    }

    /// Local providers cost nothing; hosted custom providers have no price table.
    pub fn cost(&self) -> Option<f64> {
        if self.cfg.is_local() {
            Some(0.0)
        } else {
            None
        }
    }

    /// Stable-diffusion style knobs from `extra`.
    pub fn sd(&self) -> SdParams {
        SdParams::from_extra(&self.cfg.extra, self.cfg.kind)
    }

    /// Download bytes from a URL the provider returned (result images). `data:` URLs
    /// are decoded locally.
    pub async fn fetch_image(&self, url: &str) -> Result<Vec<u8>, Error> {
        if let Some(rest) = url.strip_prefix("data:") {
            let (_, payload) = rest.split_once(',').ok_or_else(|| {
                Error::InvalidResponse("malformed data URL in provider output".to_owned())
            })?;
            return http::b64_decode(payload);
        }
        let resp = self.client.get(url).send().await?;
        let resp = http::ensure_success(&self.id(), resp).await?;
        Ok(resp.bytes().await?.to_vec())
    }

    /// Wrap decoded bytes as a PNG [`ImageResult`].
    pub fn result(&self, bytes: Vec<u8>, model: &str) -> Result<ImageResult, Error> {
        let (image, width, height) = http::normalize_to_png(bytes)?;
        Ok(ImageResult {
            image,
            width,
            height,
            provider: self.id(),
            model: model.to_owned(),
            revised_prompt: None,
            cost_usd: self.cost(),
        })
    }

    /// Decode a base64 image payload into a result.
    pub fn result_b64(&self, b64: &str, model: &str) -> Result<ImageResult, Error> {
        self.result(http::b64_decode(b64)?, model)
    }
}

/// Knobs shared by the SD-style backends (ComfyUI, A1111, OpenAI-compat extensions, HF).
#[derive(Debug, Clone, PartialEq)]
pub struct SdParams {
    /// Sampling steps.
    pub steps: u32,
    /// CFG / guidance scale.
    pub cfg: f64,
    /// Sampler name (`euler`, `dpmpp_2m`, ...; A1111 uses `Euler a` style names).
    pub sampler: String,
    /// Scheduler (`normal`, `karras`, ...).
    pub scheduler: String,
    /// img2img denoising strength (`None` = kind default).
    pub denoise: Option<f64>,
    /// Fixed seed (`None` = random per request).
    pub seed: Option<u64>,
    /// Checkpoint override (`extra.checkpoint`, else the entry's `model`).
    pub checkpoint: Option<String>,
    /// A1111 `mask_blur`.
    pub mask_blur: u32,
    /// A1111 `inpainting_fill` (1 = original).
    pub inpainting_fill: u32,
    /// A1111 `inpaint_full_res` ("Only masked").
    pub inpaint_full_res: bool,
}

impl SdParams {
    /// Parse `extra` with defaults.
    pub fn from_extra(extra: &Value, kind: CustomKind) -> Self {
        let f = |k: &str| {
            extra
                .get(k)
                .and_then(|v| v.as_f64().or_else(|| v.as_str()?.trim().parse().ok()))
        };
        let s = |k: &str| {
            extra
                .get(k)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
        };
        Self {
            steps: f("steps").map_or(20, |v| v.max(1.0) as u32),
            cfg: f("cfg").unwrap_or(7.0),
            sampler: s("sampler").unwrap_or_else(|| {
                if kind == CustomKind::A1111 {
                    "Euler a".to_owned()
                } else {
                    "euler".to_owned()
                }
            }),
            scheduler: s("scheduler").unwrap_or_else(|| "normal".to_owned()),
            denoise: f("denoise"),
            seed: f("seed").filter(|v| *v >= 0.0).map(|v| v as u64),
            checkpoint: s("checkpoint"),
            mask_blur: f("maskBlur").map_or(4, |v| v.max(0.0) as u32),
            inpainting_fill: f("inpaintingFill").map_or(1, |v| v.clamp(0.0, 3.0) as u32),
            inpaint_full_res: extra
                .get("inpaintFullRes")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }
    }

    /// A seed: the fixed one or a fresh random value.
    pub fn seed_or_random(&self) -> u64 {
        self.seed.unwrap_or_else(|| {
            let u = uuid::Uuid::new_v4();
            let mut b = [0u8; 8];
            b.copy_from_slice(&u.as_bytes()[..8]);
            u64::from_le_bytes(b) & 0x7FFF_FFFF_FFFF
        })
    }
}

/// Requested size, or the kind's default square.
pub(crate) fn size_or_default(size: Option<ImageSize>, default_edge: u32) -> ImageSize {
    size.unwrap_or(ImageSize::square(default_edge))
}

/// Dimensions of an input image, or an `ai_image` error.
pub(crate) fn dims(img: &ImageBytes) -> Result<ImageSize, Error> {
    let (w, h) = http::dimensions(&img.data)?;
    Ok(ImageSize::new(w, h))
}

/// Build the backend for a registry entry.
pub fn build_custom_provider(
    cfg: &CustomProvider,
    auth: Option<SecretString>,
) -> Result<SharedProvider, Error> {
    let ctx = Ctx::new(cfg.clone(), auth)?;
    Ok(match cfg.kind {
        CustomKind::OpenAiCompat => Arc::new(openai_compat::OpenAiCompatProvider::new(ctx)),
        CustomKind::HuggingFace => Arc::new(hf::HfProvider::new(ctx)),
        CustomKind::Ollama => Arc::new(ollama::OllamaAssist::new(ctx)),
        CustomKind::ComfyUi => Arc::new(comfy::ComfyProvider::new(ctx)),
        CustomKind::A1111 => Arc::new(a1111::A1111Provider::new(ctx)),
        CustomKind::Replicate => Arc::new(replicate::ReplicateProvider::new(ctx)),
    })
}

/// Hit the kind's cheapest health / list-models endpoint. Never returns `Err` for a
/// server-side problem: that becomes `reachable: false` / `auth_failed` in the result.
/// Only an invalid entry is an error.
pub async fn probe(cfg: &CustomProvider, auth: Option<SecretString>) -> Result<ProbeResult, Error> {
    let ctx = Ctx::new(cfg.clone(), auth)?;
    let outcome = match cfg.kind {
        CustomKind::OpenAiCompat => openai_compat::OpenAiCompatProvider::new(ctx).probe().await,
        CustomKind::HuggingFace => hf::HfProvider::new(ctx).probe().await,
        CustomKind::Ollama => ollama::OllamaAssist::new(ctx).probe().await,
        CustomKind::ComfyUi => comfy::ComfyProvider::new(ctx).probe().await,
        CustomKind::A1111 => a1111::A1111Provider::new(ctx).probe().await,
        CustomKind::Replicate => replicate::ReplicateProvider::new(ctx).probe().await,
    };
    Ok(outcome.unwrap_or_else(|e| ProbeResult::from_error(&e)))
}

/// Ask a vision-capable chat model to improve a prompt (Ollama only today).
pub async fn prompt_assist(
    cfg: &CustomProvider,
    auth: Option<SecretString>,
    image: Option<ImageBytes>,
    text: &str,
) -> Result<String, Error> {
    if !cfg.kind.prompt_assist() {
        return Err(Error::Unsupported {
            provider: cfg.provider_id(),
            capability: "prompt assist",
        });
    }
    let ctx = Ctx::new(cfg.clone(), auth)?;
    ollama::OllamaAssist::new(ctx).assist(image, text).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sd_params_defaults_and_overrides() {
        let p = SdParams::from_extra(&Value::Null, CustomKind::ComfyUi);
        assert_eq!(p.steps, 20);
        assert_eq!(p.sampler, "euler");
        assert_eq!(p.inpainting_fill, 1);
        assert!(p.seed.is_none());
        let a = SdParams::from_extra(&Value::Null, CustomKind::A1111);
        assert_eq!(a.sampler, "Euler a");
        let p = SdParams::from_extra(
            &serde_json::json!({ "steps": "30", "cfg": 5, "seed": 42, "denoise": 0.5, "checkpoint": "x.safetensors", "inpaintFullRes": true, "inpaintingFill": 9 }),
            CustomKind::ComfyUi,
        );
        assert_eq!(p.steps, 30);
        assert_eq!(p.cfg, 5.0);
        assert_eq!(p.seed, Some(42));
        assert_eq!(p.seed_or_random(), 42);
        assert_eq!(p.denoise, Some(0.5));
        assert_eq!(p.checkpoint.as_deref(), Some("x.safetensors"));
        assert!(p.inpaint_full_res);
        assert_eq!(p.inpainting_fill, 3);
        let r = SdParams::from_extra(&Value::Null, CustomKind::ComfyUi);
        assert_ne!(r.seed_or_random(), r.seed_or_random());
    }

    #[test]
    fn ctx_model_and_cost() {
        let mut cfg = CustomProvider::new("c", "C", CustomKind::ComfyUi);
        cfg.model = "base.safetensors".into();
        let ctx = Ctx::new(cfg, None).expect("ctx");
        assert_eq!(ctx.model(None), "base.safetensors");
        assert_eq!(ctx.model(Some("  ")), "base.safetensors");
        assert_eq!(ctx.model(Some("other")), "other");
        assert_eq!(ctx.cost(), Some(0.0));
        assert_eq!(ctx.id(), ProviderId::custom("c"));
        let mut hosted = CustomProvider::new("r", "R", CustomKind::Replicate);
        hosted.base_url = "https://api.replicate.com/".into();
        let ctx = Ctx::new(hosted, Some(SecretString::new(""))).expect("ctx");
        assert!(ctx.auth.is_none(), "empty secrets are dropped");
        assert_eq!(ctx.cost(), None);
        assert_eq!(ctx.url("/v1/models"), "https://api.replicate.com/v1/models");
    }
}
