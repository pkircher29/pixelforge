//! Stable Diffusion WebUI (AUTOMATIC1111) / Forge `/sdapi/v1` (docs/ai-research.md
//! section 4.5): `txt2img`, `img2img` with `init_images`, and inpainting through
//! `img2img` + `mask` (white = repaint, `inpainting_mask_invert = 0`), which is also
//! Pixelforge's convention. The secret, when given as `user:pass`, becomes HTTP basic
//! auth (`--api-auth`); anything else is sent as a bearer token.

use async_trait::async_trait;
use base64::Engine as _;
use serde::Deserialize;

use super::{dims, size_or_default, Ctx};
use crate::custom::ProbeResult;
use crate::error::Error;
use crate::http;
use crate::mask;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{Capabilities, EditMode, EditRequest, GenerateRequest, ImageResult, ProviderId};

/// A1111 / Forge backend.
#[derive(Debug, Clone)]
pub struct A1111Provider {
    ctx: Ctx,
}

impl A1111Provider {
    /// Wrap a context.
    pub fn new(ctx: Ctx) -> Self {
        Self { ctx }
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.ctx.auth {
            Some(secret) if secret.expose().contains(':') => req.header(
                reqwest::header::AUTHORIZATION,
                format!(
                    "Basic {}",
                    base64::engine::general_purpose::STANDARD.encode(secret.expose())
                ),
            ),
            _ => self.ctx.bearer(req),
        }
    }

    fn checkpoint(&self) -> Option<String> {
        self.ctx
            .sd()
            .checkpoint
            .or_else(|| Some(self.ctx.cfg.model.trim().to_owned()).filter(|m| !m.is_empty()))
    }

    fn common_body(
        &self,
        req_prompt: &str,
        negative: Option<&str>,
        n: u8,
        width: u32,
        height: u32,
    ) -> serde_json::Value {
        let sd = self.ctx.sd();
        let mut body = serde_json::json!({
            "prompt": req_prompt,
            "negative_prompt": negative.unwrap_or(""),
            "steps": sd.steps,
            "cfg_scale": sd.cfg,
            "width": width,
            "height": height,
            "sampler_name": sd.sampler,
            "seed": sd.seed.map_or(-1i64, |s| i64::try_from(s).unwrap_or(-1)),
            "batch_size": n.max(1),
            "n_iter": 1,
            "send_images": true,
            "save_images": false,
        });
        if self.ctx.cfg.extra.get("scheduler").is_some() {
            body["scheduler"] = serde_json::Value::String(sd.scheduler);
        }
        if let Some(ckpt) = self.checkpoint() {
            body["override_settings"] = serde_json::json!({ "sd_model_checkpoint": ckpt });
            body["override_settings_restore_afterwards"] = serde_json::Value::Bool(false);
        }
        body
    }

    async fn post(
        &self,
        path: &str,
        body: &serde_json::Value,
        model: &str,
    ) -> Result<Vec<ImageResult>, Error> {
        let req = self.ctx.client().post(self.ctx.url(path)).json(body);
        let resp = self.auth(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let parsed: SdResponse = resp.json().await?;
        if parsed.images.is_empty() {
            return Err(Error::InvalidResponse(
                "WebUI returned no images".to_owned(),
            ));
        }
        parsed
            .images
            .iter()
            .map(|b64| {
                // Some builds prefix a data URL.
                let payload = b64.split_once(",").map_or(b64.as_str(), |(_, p)| p);
                self.ctx.result_b64(payload, model)
            })
            .collect()
    }

    /// `GET /sdapi/v1/sd-models` (+ current checkpoint from `/sdapi/v1/options`).
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        let req = self.ctx.client().get(self.ctx.url("/sdapi/v1/sd-models"));
        let resp = self.auth(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let list: Vec<SdModel> = resp.json().await?;
        let models: Vec<String> = list.into_iter().map(|m| m.title).collect();
        let current = match self
            .auth(self.ctx.client().get(self.ctx.url("/sdapi/v1/options")))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v["sd_model_checkpoint"].as_str().map(str::to_owned)),
            _ => None,
        };
        let mut caps = self.ctx.cfg.kind.default_capabilities();
        caps.models = models.clone();
        Ok(ProbeResult {
            reachable: true,
            detected_caps: Some(caps),
            message: format!(
                "WebUI API is up with {} checkpoint{}{}.",
                models.len(),
                if models.len() == 1 { "" } else { "s" },
                current
                    .as_deref()
                    .map(|c| format!(", current: {c}"))
                    .unwrap_or_default()
            ),
            version: None,
            models,
            auth_failed: false,
        })
    }
}

#[async_trait]
impl ImageProvider for A1111Provider {
    fn id(&self) -> ProviderId {
        self.ctx.id()
    }

    fn capabilities(&self) -> Capabilities {
        self.ctx.cfg.capabilities.clone()
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(&self.id(), &self.capabilities(), &req)?;
        let model = self.checkpoint().unwrap_or_default();
        if let Some(first) = req.reference_images.first() {
            let d = dims(first)?;
            let mut body = self.common_body(
                &req.prompt,
                req.negative_prompt.as_deref(),
                req.n,
                d.width,
                d.height,
            );
            body["init_images"] = serde_json::json!([http::b64_encode(&first.data)]);
            body["denoising_strength"] =
                serde_json::Value::from(self.ctx.sd().denoise.unwrap_or(0.75));
            return self.post("/sdapi/v1/img2img", &body, &model).await;
        }
        let size = size_or_default(req.size, 1024);
        let body = self.common_body(
            &req.prompt,
            req.negative_prompt.as_deref(),
            req.n,
            size.width,
            size.height,
        );
        self.post("/sdapi/v1/txt2img", &body, &model).await
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        let model = self.checkpoint().unwrap_or_default();
        let d = dims(&req.image)?;
        let sd = self.ctx.sd();
        let mut body = self.common_body(
            &req.prompt,
            req.negative_prompt.as_deref(),
            req.n,
            d.width,
            d.height,
        );
        body["init_images"] = serde_json::json!([http::b64_encode(&req.image.data)]);
        if req.mode == EditMode::Mask {
            let m = req
                .mask
                .as_ref()
                .ok_or_else(|| Error::InvalidRequest("mask edit without a mask".to_owned()))?;
            let png = mask::to_a1111_mask(&m.data, d.width, d.height)?;
            body["mask"] = serde_json::Value::String(http::b64_encode(&png));
            body["mask_blur"] = serde_json::Value::from(sd.mask_blur);
            body["inpainting_fill"] = serde_json::Value::from(sd.inpainting_fill);
            body["inpaint_full_res"] = serde_json::Value::Bool(sd.inpaint_full_res);
            body["inpaint_full_res_padding"] = serde_json::Value::from(32);
            body["inpainting_mask_invert"] = serde_json::Value::from(0);
            body["denoising_strength"] = serde_json::Value::from(sd.denoise.unwrap_or(1.0));
        } else {
            body["denoising_strength"] = serde_json::Value::from(sd.denoise.unwrap_or(0.75));
        }
        self.post("/sdapi/v1/img2img", &body, &model).await
    }

    async fn test_key(&self) -> Result<(), Error> {
        let r = self.probe().await?;
        if r.auth_failed {
            return Err(Error::Auth(r.message));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct SdResponse {
    #[serde(default)]
    images: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SdModel {
    #[serde(default)]
    title: String,
}
