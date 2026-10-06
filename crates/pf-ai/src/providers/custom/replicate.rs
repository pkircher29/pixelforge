//! Replicate predictions API (docs/ai-research.md section 4.6): `POST
//! /v1/models/{owner}/{name}/predictions` (official models) or `POST /v1/predictions`
//! with `version` (`extra.version`), `Prefer: wait`, then poll `GET /v1/predictions/{id}`
//! until `succeeded` / `failed` / `canceled` and download the output URL(s).
//!
//! Model inputs are not standardised: `prompt`, `negative_prompt`, `width`, `height`,
//! `num_outputs`, `seed` cover FLUX / SDXL style models; the input image goes under
//! `extra.imageField` (default `image`), a mask under `mask` when the user enabled
//! mask editing for an inpainting model.

use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;

use super::Ctx;
use crate::custom::ProbeResult;
use crate::error::Error;
use crate::http;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{Capabilities, EditMode, EditRequest, GenerateRequest, ImageResult, ProviderId};

/// Replicate backend.
#[derive(Debug, Clone)]
pub struct ReplicateProvider {
    ctx: Ctx,
    poll_interval: Duration,
}

impl ReplicateProvider {
    /// Wrap a context.
    pub fn new(ctx: Ctx) -> Self {
        Self {
            ctx,
            poll_interval: Duration::from_millis(1000),
        }
    }

    /// Poll faster (tests).
    pub fn with_poll_interval(mut self, d: Duration) -> Self {
        self.poll_interval = d;
        self
    }

    fn model(&self, req_model: Option<&str>) -> Result<String, Error> {
        let m = self.ctx.model(req_model);
        if m.is_empty() || !m.contains('/') {
            return Err(Error::InvalidRequest(
                "Replicate: model must be owner/name (e.g. black-forest-labs/flux-schnell)"
                    .to_owned(),
            ));
        }
        Ok(m)
    }

    fn input(
        &self,
        prompt: &str,
        negative: Option<&str>,
        size: Option<crate::types::ImageSize>,
        n: u8,
    ) -> serde_json::Value {
        let mut input = serde_json::json!({ "prompt": prompt, "num_outputs": n.max(1) });
        if let Some(neg) = negative.map(str::trim).filter(|s| !s.is_empty()) {
            input["negative_prompt"] = serde_json::Value::String(neg.to_owned());
        }
        if let Some(s) = size {
            input["width"] = serde_json::Value::from(s.width);
            input["height"] = serde_json::Value::from(s.height);
        }
        let sd = self.ctx.sd();
        if let Some(seed) = sd.seed {
            input["seed"] = serde_json::Value::from(seed);
        }
        if self.ctx.cfg.extra.get("steps").is_some() {
            input["num_inference_steps"] = serde_json::Value::from(sd.steps);
        }
        if self.ctx.cfg.extra.get("cfg").is_some() {
            input["guidance_scale"] = serde_json::Value::from(sd.cfg);
        }
        if let Some(obj) = self.ctx.cfg.extra.get("input").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                input[k] = v.clone();
            }
        }
        input
    }

    async fn predict(
        &self,
        model: &str,
        input: serde_json::Value,
    ) -> Result<Vec<ImageResult>, Error> {
        let (url, body) = match self.ctx.cfg.extra_str("version") {
            Some(version) => (
                self.ctx.url("/v1/predictions"),
                serde_json::json!({ "version": version, "input": input }),
            ),
            None => (
                self.ctx.url(&format!("/v1/models/{model}/predictions")),
                serde_json::json!({ "input": input }),
            ),
        };
        let req = self
            .ctx
            .client()
            .post(url)
            .header("Prefer", "wait")
            .json(&body);
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let mut pred: Prediction = resp.json().await?;
        let poll_url = pred
            .urls
            .get
            .clone()
            .unwrap_or_else(|| self.ctx.url(&format!("/v1/predictions/{}", pred.id)));
        while matches!(pred.status.as_str(), "starting" | "processing" | "") {
            tokio::time::sleep(self.poll_interval).await;
            let req = self.ctx.client().get(&poll_url);
            let resp = self.ctx.bearer(req).send().await?;
            let resp = http::ensure_success(&self.ctx.id(), resp).await?;
            pred = resp.json().await?;
        }
        match pred.status.as_str() {
            "succeeded" => {}
            "canceled" => return Err(Error::Cancelled),
            other => {
                let msg = pred
                    .error
                    .clone()
                    .unwrap_or_else(|| format!("prediction {other}"));
                return Err(Error::BadRequest {
                    provider: self.ctx.id(),
                    message: format!("Replicate: {msg}"),
                });
            }
        }
        let urls: Vec<String> = match &pred.output {
            serde_json::Value::String(s) => vec![s.clone()],
            serde_json::Value::Array(a) => a
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            serde_json::Value::Object(o) => o
                .values()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .filter(|s| s.starts_with("http") || s.starts_with("data:"))
                .collect(),
            _ => Vec::new(),
        };
        if urls.is_empty() {
            return Err(Error::InvalidResponse(
                "Replicate prediction has no output image".to_owned(),
            ));
        }
        let mut out = Vec::with_capacity(urls.len());
        for u in urls {
            let bytes = self.ctx.fetch_image(&u).await?;
            out.push(self.ctx.result(bytes, model)?);
        }
        Ok(out)
    }

    /// `GET /v1/models/{owner}/{name}`.
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        let model = self.model(None)?;
        let req = self
            .ctx
            .client()
            .get(self.ctx.url(&format!("/v1/models/{model}")));
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let v: serde_json::Value = resp.json().await?;
        let version = v["latest_version"]["id"].as_str().map(str::to_owned);
        let mut caps = self.ctx.cfg.kind.default_capabilities();
        caps.models = vec![model.clone()];
        Ok(ProbeResult {
            reachable: true,
            detected_caps: Some(caps),
            message: format!(
                "{model} exists{}.",
                version
                    .as_deref()
                    .map(|id| format!(", latest version {}", &id[..id.len().min(12)]))
                    .unwrap_or_default()
            ),
            version,
            models: vec![model],
            auth_failed: false,
        })
    }
}

#[async_trait]
impl ImageProvider for ReplicateProvider {
    fn id(&self) -> ProviderId {
        self.ctx.id()
    }

    fn capabilities(&self) -> Capabilities {
        self.ctx.cfg.capabilities.clone()
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(&self.id(), &self.capabilities(), &req)?;
        let model = self.model(req.model.as_deref())?;
        let mut input = self.input(&req.prompt, req.negative_prompt.as_deref(), req.size, req.n);
        if let Some(first) = req.reference_images.first() {
            let field = self
                .ctx
                .cfg
                .extra_str("imageField")
                .unwrap_or("image")
                .to_owned();
            input[field] =
                serde_json::Value::String(http::data_url(&http::input_mime(first), &first.data));
        }
        self.predict(&model, input).await
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        let model = self.model(req.model.as_deref())?;
        let mut input = self.input(&req.prompt, req.negative_prompt.as_deref(), req.size, req.n);
        let field = self
            .ctx
            .cfg
            .extra_str("imageField")
            .unwrap_or("image")
            .to_owned();
        input[field] = serde_json::Value::String(http::data_url(
            &http::input_mime(&req.image),
            &req.image.data,
        ));
        if req.mode == EditMode::Mask {
            let m = req
                .mask
                .as_ref()
                .ok_or_else(|| Error::InvalidRequest("mask edit without a mask".to_owned()))?;
            let (w, h) = http::dimensions(&req.image.data)?;
            let png = crate::mask::to_a1111_mask(&m.data, w, h)?;
            input["mask"] = serde_json::Value::String(http::data_url("image/png", &png));
        }
        self.predict(&model, input).await
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
struct Prediction {
    #[serde(default)]
    id: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    output: serde_json::Value,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    urls: PredictionUrls,
}

#[derive(Debug, Default, Deserialize)]
struct PredictionUrls {
    #[serde(default)]
    get: Option<String>,
}
