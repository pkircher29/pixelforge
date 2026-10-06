//! Hugging Face Inference Providers (`hf-inference` router) and dedicated Inference
//! Endpoints (docs/ai-research.md section 4.2).
//!
//! * text-to-image: `POST {base}/models/{model}` with `{ inputs, parameters }`, answer is
//!   raw image bytes (some providers behind the router answer `{data:[{b64_json}]}` or
//!   `{output:[url]}`, which we also accept);
//! * image-to-image: same URL, `inputs` = base64 input image, `parameters.prompt`;
//! * no pixel mask: `mask_edit` is always emulated by the webview.
//!
//! A `base_url` that is not on `huggingface.co` is treated as a dedicated endpoint and
//! POSTed to directly.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::Ctx;
use crate::custom::ProbeResult;
use crate::error::Error;
use crate::http;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{
    Capabilities, EditRequest, GenerateRequest, ImageResult, ImageSize, ProviderId,
};

/// The Hub API (model info + search). Overridable with `extra.hubUrl` (tests / mirrors).
pub const HUB_URL: &str = "https://huggingface.co";

/// Hugging Face backend.
#[derive(Debug, Clone)]
pub struct HfProvider {
    ctx: Ctx,
}

/// One Hub search hit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubModel {
    /// Repo id (`owner/name`).
    pub id: String,
    /// `text-to-image`, `image-to-image`, ...
    #[serde(default)]
    pub pipeline_tag: Option<String>,
    /// Download count (30 days).
    #[serde(default)]
    pub downloads: u64,
    /// Likes.
    #[serde(default)]
    pub likes: u64,
    /// Gated repos need an accepted license.
    #[serde(default)]
    pub gated: bool,
}

#[derive(Debug, Deserialize)]
struct HubModelRaw {
    #[serde(default, alias = "modelId")]
    id: String,
    #[serde(default)]
    pipeline_tag: Option<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    gated: serde_json::Value,
}

impl From<HubModelRaw> for HubModel {
    fn from(r: HubModelRaw) -> Self {
        let gated = match r.gated {
            serde_json::Value::Bool(b) => b,
            serde_json::Value::String(s) => !s.is_empty() && s != "false",
            _ => false,
        };
        HubModel {
            id: r.id,
            pipeline_tag: r.pipeline_tag,
            downloads: r.downloads,
            likes: r.likes,
            gated,
        }
    }
}

impl HfProvider {
    /// Wrap a context.
    pub fn new(ctx: Ctx) -> Self {
        Self { ctx }
    }

    fn hub_url(&self) -> String {
        self.ctx
            .cfg
            .extra_str("hubUrl")
            .map(|s| s.trim_end_matches('/').to_owned())
            .unwrap_or_else(|| HUB_URL.to_owned())
    }

    /// `true` when `base_url` is the serverless router (then `/models/{model}` is appended).
    fn is_router(&self) -> bool {
        self.ctx.base().contains("huggingface.co")
    }

    fn endpoint(&self, model: &str) -> Result<String, Error> {
        if self.is_router() {
            if model.is_empty() {
                return Err(Error::InvalidRequest(
                    "Hugging Face: choose a model (repo id such as stabilityai/stable-diffusion-xl-base-1.0)".to_owned(),
                ));
            }
            Ok(format!("{}/models/{model}", self.ctx.base()))
        } else {
            Ok(self.ctx.base())
        }
    }

    fn parameters(&self, negative: Option<&str>, size: Option<ImageSize>) -> serde_json::Value {
        let mut p = serde_json::Map::new();
        if let Some(n) = negative.map(str::trim).filter(|n| !n.is_empty()) {
            p.insert("negative_prompt".into(), n.into());
        }
        if let Some(s) = size {
            p.insert("width".into(), s.width.into());
            p.insert("height".into(), s.height.into());
        }
        let extra = &self.ctx.cfg.extra;
        let sd = self.ctx.sd();
        if extra.get("steps").is_some() {
            p.insert("num_inference_steps".into(), sd.steps.into());
        }
        if extra.get("cfg").is_some() {
            p.insert("guidance_scale".into(), sd.cfg.into());
        }
        if let Some(seed) = sd.seed {
            p.insert("seed".into(), seed.into());
        }
        serde_json::Value::Object(p)
    }

    async fn post(&self, url: &str, body: &serde_json::Value) -> Result<Vec<u8>, Error> {
        let req = self
            .ctx
            .client()
            .post(url)
            .header("x-use-cache", "false")
            .header("x-wait-for-model", "true")
            .header(
                reqwest::header::ACCEPT,
                "image/png, image/jpeg, application/json",
            )
            .json(body);
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let bytes = resp.bytes().await?.to_vec();
        self.extract_image(bytes).await
    }

    /// Raw image bytes, or one of the JSON shapes other router providers answer with.
    async fn extract_image(&self, bytes: Vec<u8>) -> Result<Vec<u8>, Error> {
        if http::sniff_mime(&bytes).is_some() {
            return Ok(bytes);
        }
        let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
            Error::InvalidResponse(format!(
                "Hugging Face answered with neither an image nor JSON ({} bytes)",
                bytes.len()
            ))
        })?;
        if let Some(b64) = v["data"][0]["b64_json"].as_str() {
            return http::b64_decode(b64);
        }
        if let Some(b64) = v["image"].as_str() {
            return http::b64_decode(b64);
        }
        if let Some(first) = v["images"][0].as_str() {
            return http::b64_decode(first);
        }
        if let Some(url) = v["images"][0]["url"]
            .as_str()
            .or_else(|| v["output"][0].as_str())
            .or_else(|| v["output"].as_str())
        {
            return self.ctx.fetch_image(url).await;
        }
        let msg = v["error"]
            .as_str()
            .or_else(|| v["error"]["message"].as_str())
            .unwrap_or("unrecognised JSON body");
        Err(Error::InvalidResponse(format!("Hugging Face: {msg}")))
    }

    /// `GET {hub}/api/models/{model}` for the router, `GET base` for a dedicated endpoint.
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        if !self.is_router() {
            let req = self.ctx.client().get(self.ctx.base());
            let resp = self.ctx.bearer(req).send().await?;
            let status = resp.status();
            let reachable = true;
            let auth_failed = matches!(status.as_u16(), 401 | 403);
            return Ok(ProbeResult {
                reachable,
                models: vec![self.ctx.cfg.model.clone()]
                    .into_iter()
                    .filter(|m| !m.is_empty())
                    .collect(),
                detected_caps: None,
                message: format!("Endpoint answered HTTP {}.", status.as_u16()),
                version: None,
                auth_failed,
            });
        }
        let model = self.ctx.cfg.model.trim();
        if model.is_empty() {
            return Ok(ProbeResult {
                reachable: true,
                models: Vec::new(),
                detected_caps: None,
                message: "Pick a model from the Hub search first.".to_owned(),
                version: None,
                auth_failed: false,
            });
        }
        let info = hub_model(
            self.ctx.client(),
            &self.hub_url(),
            model,
            self.ctx.auth.as_ref(),
        )
        .await?;
        let tag = info.pipeline_tag.clone().unwrap_or_default();
        let mut caps = self.ctx.cfg.kind.default_capabilities();
        caps.generate = tag == "text-to-image";
        caps.instruct_edit = tag == "image-to-image";
        caps.models = vec![info.id.clone()];
        let message = match tag.as_str() {
            "text-to-image" => format!("{} is a text-to-image model (generate).", info.id),
            "image-to-image" => format!("{} is an image-to-image model (instruct edit).", info.id),
            "" => format!(
                "{} has no pipeline tag; it may not run on hf-inference.",
                info.id
            ),
            other => format!(
                "{} is tagged {other}, not an image generation pipeline.",
                info.id
            ),
        };
        let message = if info.gated {
            format!("{message} The repo is gated: accept its license on the Hub first.")
        } else {
            message
        };
        Ok(ProbeResult {
            reachable: true,
            models: vec![info.id],
            detected_caps: Some(caps),
            message,
            version: None,
            auth_failed: false,
        })
    }
}

/// `GET {hub}/api/models/{repo}`.
pub async fn hub_model(
    client: &reqwest::Client,
    hub: &str,
    repo: &str,
    token: Option<&crate::secret::SecretString>,
) -> Result<HubModel, Error> {
    let mut req = client.get(format!("{hub}/api/models/{repo}"));
    if let Some(t) = token {
        req = req.header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", t.expose()),
        );
    }
    let resp = req.send().await?;
    let resp = http::ensure_success(&ProviderId::custom("hugging-face"), resp).await?;
    let raw: HubModelRaw = resp.json().await?;
    Ok(raw.into())
}

/// `GET {hub}/api/models?pipeline_tag=&search=&sort=downloads&direction=-1&limit=`.
pub async fn hub_search(
    client: &reqwest::Client,
    hub: &str,
    query: &str,
    pipeline_tag: &str,
    limit: u32,
) -> Result<Vec<HubModel>, Error> {
    let mut params: Vec<(&str, String)> = vec![
        ("sort", "downloads".to_owned()),
        ("direction", "-1".to_owned()),
        ("limit", limit.clamp(1, 50).to_string()),
    ];
    if !pipeline_tag.is_empty() {
        params.push(("pipeline_tag", pipeline_tag.to_owned()));
    }
    if !query.trim().is_empty() {
        params.push(("search", query.trim().to_owned()));
    }
    let resp = client
        .get(format!("{hub}/api/models"))
        .query(&params)
        .send()
        .await?;
    let resp = http::ensure_success(&ProviderId::custom("hugging-face"), resp).await?;
    let raw: Vec<HubModelRaw> = resp.json().await?;
    Ok(raw.into_iter().map(HubModel::from).collect())
}

/// [`hub_search`] against the public Hub with the crate's default client.
pub async fn hub_search_default(
    query: &str,
    pipeline_tag: &str,
    limit: u32,
) -> Result<Vec<HubModel>, Error> {
    let client = http::client()?;
    hub_search(&client, HUB_URL, query, pipeline_tag, limit).await
}

#[async_trait]
impl ImageProvider for HfProvider {
    fn id(&self) -> ProviderId {
        self.ctx.id()
    }

    fn capabilities(&self) -> Capabilities {
        self.ctx.cfg.capabilities.clone()
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(&self.id(), &self.capabilities(), &req)?;
        if !req.reference_images.is_empty() {
            return Err(Error::Unsupported {
                provider: self.id(),
                capability: "reference images",
            });
        }
        let model = self.ctx.model(req.model.as_deref());
        let url = self.endpoint(&model)?;
        let body = serde_json::json!({
            "inputs": req.prompt,
            "parameters": self.parameters(req.negative_prompt.as_deref(), req.size),
        });
        // hf-inference returns one image per call.
        let mut out = Vec::with_capacity(usize::from(req.n));
        for _ in 0..req.n.max(1) {
            let bytes = self.post(&url, &body).await?;
            out.push(self.ctx.result(bytes, &model)?);
        }
        Ok(out)
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        let model = self.ctx.model(req.model.as_deref());
        let url = self.endpoint(&model)?;
        let mut params = self.parameters(req.negative_prompt.as_deref(), None);
        params["prompt"] = serde_json::Value::String(req.prompt.clone());
        if let Some(s) = req.size {
            params["target_size"] = serde_json::json!({ "width": s.width, "height": s.height });
        }
        let body = serde_json::json!({
            "inputs": http::b64_encode(&req.image.data),
            "parameters": params,
        });
        let mut out = Vec::with_capacity(usize::from(req.n));
        for _ in 0..req.n.max(1) {
            let bytes = self.post(&url, &body).await?;
            out.push(self.ctx.result(bytes, &model)?);
        }
        Ok(out)
    }

    async fn test_key(&self) -> Result<(), Error> {
        let r = self.probe().await?;
        if r.auth_failed {
            return Err(Error::Auth(r.message));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::custom::{CustomKind, CustomProvider};

    #[test]
    fn router_vs_endpoint_urls() {
        let mut cfg = CustomProvider::new("hf", "HF", CustomKind::HuggingFace);
        cfg.model = "stabilityai/sdxl".into();
        let p = HfProvider::new(Ctx::new(cfg.clone(), None).expect("ctx"));
        assert!(p.is_router());
        assert_eq!(
            p.endpoint("stabilityai/sdxl").expect("url"),
            "https://router.huggingface.co/hf-inference/models/stabilityai/sdxl"
        );
        assert!(p.endpoint("").is_err());
        cfg.base_url = "https://abc123.us-east-1.aws.endpoints.huggingface.cloud/".into();
        let p = HfProvider::new(Ctx::new(cfg, None).expect("ctx"));
        assert!(!p.is_router());
        assert_eq!(
            p.endpoint("").expect("url"),
            "https://abc123.us-east-1.aws.endpoints.huggingface.cloud"
        );
    }

    #[test]
    fn hub_model_gated_field_shapes() {
        let a: HubModelRaw = serde_json::from_str(r#"{"id":"x/y","gated":"auto"}"#).expect("de");
        assert!(HubModel::from(a).gated);
        let b: HubModelRaw =
            serde_json::from_str(r#"{"modelId":"x/y","gated":false,"downloads":3}"#).expect("de");
        let b = HubModel::from(b);
        assert!(!b.gated);
        assert_eq!(b.id, "x/y");
        assert_eq!(b.downloads, 3);
    }
}
