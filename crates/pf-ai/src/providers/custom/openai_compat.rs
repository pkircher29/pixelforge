//! Any server that speaks OpenAI's `/v1/images/*` (docs/ai-research.md section 4.1):
//! LocalAI, vLLM-Omni, hosted OpenAI look-alikes. LM Studio probes but has no image
//! endpoint. `/v1/images/edits` is multipart like OpenAI and only used when the user
//! enabled instruct / mask editing for the entry.

use async_trait::async_trait;
use reqwest::multipart::{Form, Part};
use serde::Deserialize;

use super::Ctx;
use crate::custom::ProbeResult;
use crate::error::Error;
use crate::http;
use crate::mask;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{
    Capabilities, EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult, ImageSize,
    ProviderId,
};

/// OpenAI-compatible backend.
#[derive(Debug, Clone)]
pub struct OpenAiCompatProvider {
    ctx: Ctx,
}

impl OpenAiCompatProvider {
    /// Wrap a context.
    pub fn new(ctx: Ctx) -> Self {
        Self { ctx }
    }

    /// `{base}/v1{path}`; a base that already ends in `/v1` is not doubled.
    fn v1(&self, path: &str) -> String {
        let base = self.ctx.base();
        let base = base.strip_suffix("/v1").unwrap_or(&base);
        format!("{base}/v1{path}")
    }

    fn apply_extras(&self, body: &mut serde_json::Value) {
        // Only forward knobs the user set explicitly: unknown fields are ignored by the
        // servers we know, but a wrong default (steps=20 on a turbo model) is not.
        let extra = &self.ctx.cfg.extra;
        let sd = self.ctx.sd();
        if extra.get("steps").is_some() {
            body["num_inference_steps"] = serde_json::Value::from(sd.steps);
            body["step"] = serde_json::Value::from(sd.steps); // LocalAI's name
        }
        if extra.get("cfg").is_some() {
            body["guidance_scale"] = serde_json::Value::from(sd.cfg);
        }
        if let Some(seed) = sd.seed {
            body["seed"] = serde_json::Value::from(seed);
        }
    }

    async fn post_json(
        &self,
        body: &serde_json::Value,
        model: &str,
    ) -> Result<Vec<ImageResult>, Error> {
        let req = self
            .ctx
            .client()
            .post(self.v1("/images/generations"))
            .json(body);
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let parsed: ImagesResponse = resp.json().await?;
        self.results_from(parsed, model).await
    }

    async fn post_form(&self, form: Form, model: &str) -> Result<Vec<ImageResult>, Error> {
        let req = self
            .ctx
            .client()
            .post(self.v1("/images/edits"))
            .multipart(form);
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let parsed: ImagesResponse = resp.json().await?;
        self.results_from(parsed, model).await
    }

    async fn results_from(
        &self,
        parsed: ImagesResponse,
        model: &str,
    ) -> Result<Vec<ImageResult>, Error> {
        if parsed.data.is_empty() {
            return Err(Error::InvalidResponse("no images in response".to_owned()));
        }
        let mut out = Vec::with_capacity(parsed.data.len());
        for d in parsed.data {
            let bytes = if let Some(b64) = d.b64_json {
                http::b64_decode(&b64)?
            } else if let Some(url) = d.url {
                self.ctx.fetch_image(&url).await?
            } else {
                return Err(Error::InvalidResponse(
                    "image entry has neither b64_json nor url".to_owned(),
                ));
            };
            let mut r = self.ctx.result(bytes, model)?;
            r.revised_prompt = d.revised_prompt;
            out.push(r);
        }
        Ok(out)
    }

    fn file_part(img: &ImageBytes, name: &str) -> Result<Part, Error> {
        let mime = http::input_mime(img);
        Part::bytes(img.data.clone())
            .file_name(format!("{name}.png"))
            .mime_str(&mime)
            .map_err(|e| Error::InvalidRequest(format!("bad image MIME: {e}")))
    }

    fn edit_form(
        &self,
        prompt: &str,
        model: &str,
        n: u8,
        size: Option<ImageSize>,
        image: &ImageBytes,
        mask: Option<&ImageBytes>,
    ) -> Result<Form, Error> {
        let mut form = Form::new()
            .text("prompt", prompt.to_owned())
            .text("n", n.to_string())
            .text("response_format", "b64_json")
            .part("image", Self::file_part(image, "image")?);
        if !model.is_empty() {
            form = form.text("model", model.to_owned());
        }
        if let Some(s) = size {
            form = form.text("size", s.to_string());
        }
        if let Some(m) = mask {
            // OpenAI's convention: RGBA PNG, alpha = 0 where the image may change.
            let (w, h) = http::dimensions(&image.data)?;
            let png = mask::to_openai_mask(&m.data, w, h)?;
            let part = Part::bytes(png)
                .file_name("mask.png")
                .mime_str("image/png")
                .map_err(|e| Error::InvalidRequest(format!("bad mask MIME: {e}")))?;
            form = form.part("mask", part);
        }
        Ok(form)
    }

    /// `GET /v1/models` -> model ids.
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        let req = self.ctx.client().get(self.v1("/models"));
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let v: serde_json::Value = resp.json().await?;
        let models: Vec<String> = v["data"]
            .as_array()
            .or_else(|| v["models"].as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let mut caps = self.ctx.cfg.kind.default_capabilities();
        caps.models = models.clone();
        Ok(ProbeResult {
            detected_caps: Some(caps),
            ..ProbeResult::ok(
                format!(
                    "Server answered /v1/models with {} model{}. Image generation is only confirmed by running it (LM Studio has no image endpoint).",
                    models.len(),
                    if models.len() == 1 { "" } else { "s" }
                ),
                models,
            )
        })
    }
}

#[async_trait]
impl ImageProvider for OpenAiCompatProvider {
    fn id(&self) -> ProviderId {
        self.ctx.id()
    }

    fn capabilities(&self) -> Capabilities {
        self.ctx.cfg.capabilities.clone()
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(&self.id(), &self.capabilities(), &req)?;
        let model = self.ctx.model(req.model.as_deref());
        if !req.reference_images.is_empty() {
            if !self.capabilities().instruct_edit {
                return Err(Error::Unsupported {
                    provider: self.id(),
                    capability: "reference images (enable instruct edit for this provider)",
                });
            }
            let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
            let form = self.edit_form(
                &prompt,
                &model,
                req.n,
                req.size,
                &req.reference_images[0],
                None,
            )?;
            return self.post_form(form, &model).await;
        }
        let mut body = serde_json::json!({
            "prompt": req.prompt,
            "n": req.n,
            "response_format": "b64_json",
        });
        if !model.is_empty() {
            body["model"] = serde_json::Value::String(model.clone());
        }
        if let Some(size) = req.size {
            body["size"] = serde_json::Value::String(size.to_string());
        }
        if let Some(neg) = req
            .negative_prompt
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
        {
            body["negative_prompt"] = serde_json::Value::String(neg.to_owned());
        }
        self.apply_extras(&mut body);
        self.post_json(&body, &model).await
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        let model = self.ctx.model(req.model.as_deref());
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        let mask = if req.mode == EditMode::Mask {
            req.mask.as_ref()
        } else {
            None
        };
        let form = self.edit_form(&prompt, &model, req.n, req.size, &req.image, mask)?;
        self.post_form(form, &model).await
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
struct ImagesResponse {
    #[serde(default)]
    data: Vec<ImageDatum>,
}

#[derive(Debug, Deserialize)]
struct ImageDatum {
    #[serde(default)]
    b64_json: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    revised_prompt: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::custom::{CustomKind, CustomProvider};

    #[test]
    fn v1_path_is_not_doubled() {
        let mut cfg = CustomProvider::new("l", "LocalAI", CustomKind::OpenAiCompat);
        cfg.base_url = "http://localhost:8080/v1/".into();
        let p = OpenAiCompatProvider::new(Ctx::new(cfg, None).expect("ctx"));
        assert_eq!(p.v1("/models"), "http://localhost:8080/v1/models");
        let mut cfg = CustomProvider::new("l", "LocalAI", CustomKind::OpenAiCompat);
        cfg.base_url = "http://localhost:8080".into();
        let p = OpenAiCompatProvider::new(Ctx::new(cfg, None).expect("ctx"));
        assert_eq!(
            p.v1("/images/generations"),
            "http://localhost:8080/v1/images/generations"
        );
    }
}
