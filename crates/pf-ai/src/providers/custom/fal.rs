//! fal.ai queue API. See docs/fal-provider.md for endpoint contracts and limits.
use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::{json, Value};

use super::Ctx;
use crate::custom::ProbeResult;
use crate::error::Error;
use crate::http;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::secret::SecretString;
use crate::types::{
    Capabilities, EditMode, EditRequest, GenerateRequest, ImageResult, ImageSize, ProviderId,
};

/// Queued image generation and editing. No automatic resubmission of paid jobs.
#[derive(Debug, Clone)]
pub struct FalProvider {
    ctx: Ctx,
    poll_interval: Duration,
}

impl FalProvider {
    pub fn new(ctx: Ctx) -> Result<Self, Error> {
        // Queue URLs carry authentication; do not follow arbitrary redirects.
        let client = Client::builder()
            .user_agent(http::USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(300))
            .build()?;
        Ok(Self {
            ctx: ctx.with_client(client),
            poll_interval: Duration::from_secs(1),
        })
    }

    pub fn with_poll_interval(mut self, interval: Duration) -> Self {
        self.poll_interval = interval;
        self
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder, Error> {
        let key = self
            .ctx
            .auth
            .as_ref()
            .ok_or_else(|| Error::NotConfigured(self.ctx.id()))?;
        Ok(req.header(
            reqwest::header::AUTHORIZATION,
            format!("Key {}", key.expose()),
        ))
    }

    fn model(&self, requested: Option<&str>, edit: bool) -> Result<String, Error> {
        let mut model = self.ctx.model(requested);
        if edit && model == self.ctx.cfg.model.trim() {
            if let Some(m) = self.ctx.cfg.extra_str("editModel") {
                model = m.to_owned();
            }
        }
        if model.split('/').count() < 2
            || !model.split('/').all(|part| {
                !part.is_empty()
                    && part != "."
                    && part != ".."
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            })
        {
            return Err(Error::InvalidRequest(
                "fal.ai: enter an endpoint ID such as fal-ai/flux/dev".into(),
            ));
        }
        Ok(model)
    }

    fn input(
        &self,
        prompt: &str,
        negative: Option<&str>,
        size: Option<ImageSize>,
        n: u8,
        seed: Option<u64>,
    ) -> Value {
        let mut input = self
            .ctx
            .cfg
            .extra
            .get("input")
            .filter(|v| v.is_object())
            .cloned()
            .unwrap_or_else(|| json!({}));
        input["prompt"] = http::effective_prompt(prompt, negative).into();
        input["num_images"] = n.max(1).into();
        if let Some(size) = size {
            input["image_size"] = json!({ "width": size.width, "height": size.height });
        }
        let sd = self.ctx.sd();
        if let Some(seed) = seed.or(sd.seed) {
            input["seed"] = seed.into();
        }
        if self.ctx.cfg.extra.get("steps").is_some() {
            input["num_inference_steps"] = sd.steps.into();
        }
        if self.ctx.cfg.extra.get("cfg").is_some() {
            input["guidance_scale"] = sd.cfg.into();
        }
        input
    }

    fn queue_url(&self, raw: &str) -> Result<Url, Error> {
        let base = Url::parse(&self.ctx.base())
            .map_err(|_| Error::InvalidRequest("Invalid fal.ai base URL".into()))?;
        let url = Url::parse(raw)
            .map_err(|_| Error::InvalidResponse("fal.ai returned an invalid queue URL".into()))?;
        if url.origin() != base.origin()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(Error::InvalidResponse(
                "fal.ai returned a queue URL outside the configured server".into(),
            ));
        }
        Ok(url)
    }

    async fn predict(&self, model: &str, input: Value) -> Result<Vec<ImageResult>, Error> {
        let response = self
            .auth(
                self.ctx
                    .client()
                    .post(self.ctx.url(&format!("/{model}")))
                    .json(&input),
            )?
            .send()
            .await?;
        let submitted: Submitted = http::ensure_success(&self.id(), response)
            .await?
            .json()
            .await?;
        let cancel_url = self.queue_url(&submitted.cancel_url)?;
        let mut cancel = RemoteCancel(Some((
            self.ctx.client().clone(),
            cancel_url,
            self.ctx.auth.clone().expect("auth checked"),
        )));
        let status_url = self.queue_url(&submitted.status_url)?;
        let response_url = self.queue_url(&submitted.response_url)?;
        loop {
            let response = self
                .auth(self.ctx.client().get(status_url.clone()))?
                .send()
                .await?;
            let status: QueueStatus = http::ensure_success(&self.id(), response)
                .await?
                .json()
                .await?;
            match status.status.as_str() {
                "IN_QUEUE" | "IN_PROGRESS" => tokio::time::sleep(self.poll_interval).await,
                "COMPLETED" => {
                    cancel.0 = None;
                    break;
                }
                "CANCELLED" | "CANCELED" => {
                    cancel.0 = None;
                    return Err(Error::Cancelled);
                }
                _ => {
                    return Err(Error::InvalidResponse(
                        "fal.ai returned an unknown queue status".into(),
                    ))
                }
            }
        }
        // COMPLETED can mean success or failure: retrieving the result provides the
        // authoritative HTTP error (422 validation, 429 quota, etc.).
        let response = self
            .auth(self.ctx.client().get(response_url))?
            .send()
            .await?;
        let output: Output = http::ensure_success(&self.id(), response)
            .await?
            .json()
            .await?;
        if output.images.is_empty() {
            return Err(Error::InvalidResponse("fal.ai returned no images".into()));
        }
        let mut results = Vec::with_capacity(output.images.len());
        for image in output.images {
            // Result downloads are unauthenticated, including cross-host CDN URLs.
            let bytes = self.ctx.fetch_image(&image.url).await?;
            results.push(self.ctx.result(bytes, model)?);
        }
        Ok(results)
    }

    /// Authenticated read-only pricing lookup; never starts an image request.
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        let model = self.model(None, false)?;
        let base = if self.ctx.base() == "https://queue.fal.run" {
            "https://api.fal.ai".to_owned()
        } else {
            self.ctx.base()
        };
        let response = self
            .auth(
                self.ctx
                    .client()
                    .get(format!("{base}/v1/models/pricing"))
                    .query(&[("endpoint_id", &model)]),
            )?
            .send()
            .await?;
        let result: Value = http::ensure_success(&self.id(), response)
            .await?
            .json()
            .await?;
        if !result["prices"].as_array().is_some_and(|rows| {
            rows.iter()
                .any(|row| row["endpoint_id"].as_str() == Some(&model))
        }) {
            return Err(Error::InvalidResponse(
                "fal.ai returned no pricing metadata for this endpoint".into(),
            ));
        }
        Ok(ProbeResult { reachable: true, auth_failed: false, models: vec![model], version: None,
            detected_caps: None, message: "Authenticated pricing lookup succeeded. Image generation, quota and billing have not been tested.".into() })
    }
}

/// Dropping a job future (Cancel / timeout) also asks fal to cancel the remote job.
/// Best effort: an already-running model can still finish or incur charges.
struct RemoteCancel(Option<(Client, Url, SecretString)>);
impl Drop for RemoteCancel {
    fn drop(&mut self) {
        if let (Some((client, url, key)), Ok(runtime)) =
            (self.0.take(), tokio::runtime::Handle::try_current())
        {
            runtime.spawn(async move {
                let _ = client
                    .put(url)
                    .header(
                        reqwest::header::AUTHORIZATION,
                        format!("Key {}", key.expose()),
                    )
                    .timeout(Duration::from_secs(10))
                    .send()
                    .await;
            });
        }
    }
}

#[async_trait]
impl ImageProvider for FalProvider {
    fn id(&self) -> ProviderId {
        self.ctx.id()
    }
    fn capabilities(&self) -> Capabilities {
        self.ctx.cfg.capabilities.clone()
    }
    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(&self.id(), &self.capabilities(), &req)?;
        let model = self.model(req.model.as_deref(), !req.reference_images.is_empty())?;
        let mut input = self.input(
            &req.prompt,
            req.negative_prompt.as_deref(),
            req.size,
            req.n,
            req.seed,
        );
        if let Some(image) = req.reference_images.first() {
            input["image_url"] = http::data_url(&http::input_mime(image), &image.data).into();
        }
        self.predict(&model, input).await
    }
    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        let model = self.model(req.model.as_deref(), true)?;
        let mut input = self.input(
            &req.prompt,
            req.negative_prompt.as_deref(),
            req.size,
            req.n,
            req.seed,
        );
        input["image_url"] = http::data_url(&http::input_mime(&req.image), &req.image.data).into();
        if let Some(strength) = self.ctx.sd().denoise {
            input["strength"] = strength.into();
        }
        if req.mode == EditMode::Mask {
            let mask = req
                .mask
                .as_ref()
                .ok_or_else(|| Error::InvalidRequest("Mask edit requires a mask".into()))?;
            let (w, h) = http::dimensions(&req.image.data)?;
            input["mask_url"] =
                http::data_url("image/png", &crate::mask::to_a1111_mask(&mask.data, w, h)?).into();
        }
        self.predict(&model, input).await
    }
    async fn test_key(&self) -> Result<(), Error> {
        self.probe().await.map(|_| ())
    }
}

#[derive(Deserialize)]
struct Submitted {
    status_url: String,
    response_url: String,
    cancel_url: String,
}
#[derive(Deserialize)]
struct QueueStatus {
    status: String,
}
#[derive(Deserialize)]
struct Output {
    images: Vec<OutputImage>,
}
#[derive(Deserialize)]
struct OutputImage {
    url: String,
}
