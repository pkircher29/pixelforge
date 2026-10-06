//! ComfyUI over its HTTP API (docs/ai-research.md section 4.4): upload inputs with
//! `POST /upload/image`, queue an API-format workflow with `POST /prompt`, poll
//! `GET /history/{prompt_id}` and download each output with `GET /view`.
//!
//! Three workflows ship with the crate (`crates/pf-ai/workflows/*.json`) and are
//! rendered with `{{placeholder}}` substitution ([`render_workflow`]); the user can paste
//! their own API-format workflow into `extra.workflow` (generate), `extra.workflowImg2img`
//! and `extra.workflowInpaint`, using the same placeholders.

use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::multipart::{Form, Part};
use serde_json::Value;

use super::{dims, size_or_default, Ctx};
use crate::custom::ProbeResult;
use crate::error::Error;
use crate::http;
use crate::mask;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::types::{
    Capabilities, EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult, ProviderId,
};

/// Bundled text-to-image workflow.
pub const TXT2IMG_TEMPLATE: &str = include_str!("../../../workflows/txt2img.json");
/// Bundled image-to-image workflow.
pub const IMG2IMG_TEMPLATE: &str = include_str!("../../../workflows/img2img.json");
/// Bundled inpainting workflow (mask white = repaint).
pub const INPAINT_TEMPLATE: &str = include_str!("../../../workflows/inpaint.json");

/// Which bundled workflow a request needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowKind {
    /// Prompt -> image.
    Txt2Img,
    /// Image + prompt -> image.
    Img2Img,
    /// Image + mask + prompt -> image.
    Inpaint,
}

impl WorkflowKind {
    /// The bundled template source.
    pub fn template_source(self) -> &'static str {
        match self {
            WorkflowKind::Txt2Img => TXT2IMG_TEMPLATE,
            WorkflowKind::Img2Img => IMG2IMG_TEMPLATE,
            WorkflowKind::Inpaint => INPAINT_TEMPLATE,
        }
    }

    /// Parsed bundled template.
    pub fn template(self) -> Value {
        serde_json::from_str(self.template_source()).expect("bundled workflow is valid JSON")
    }

    /// `extra` key holding a user override.
    pub fn extra_key(self) -> &'static str {
        match self {
            WorkflowKind::Txt2Img => "workflow",
            WorkflowKind::Img2Img => "workflowImg2img",
            WorkflowKind::Inpaint => "workflowInpaint",
        }
    }
}

/// Placeholders every workflow may use.
pub const PLACEHOLDERS: [&str; 14] = [
    "prompt",
    "negative",
    "image",
    "mask",
    "width",
    "height",
    "seed",
    "steps",
    "cfg",
    "checkpoint",
    "denoise",
    "sampler",
    "scheduler",
    "batch",
];

/// Substitute `{{name}}` placeholders. A string that is *exactly* one placeholder takes
/// the variable's JSON value (so `"seed": "{{seed}}"` becomes a number); placeholders
/// inside longer strings are replaced textually.
pub fn render_workflow(template: &Value, vars: &HashMap<&str, Value>) -> Value {
    match template {
        Value::String(s) => {
            if let Some(name) = s.strip_prefix("{{").and_then(|r| r.strip_suffix("}}")) {
                if let Some(v) = vars.get(name.trim()) {
                    return v.clone();
                }
            }
            if !s.contains("{{") {
                return template.clone();
            }
            let mut out = s.clone();
            for (k, v) in vars {
                let needle = format!("{{{{{k}}}}}");
                if out.contains(&needle) {
                    let text = match v {
                        Value::String(t) => t.clone(),
                        other => other.to_string(),
                    };
                    out = out.replace(&needle, &text);
                }
            }
            Value::String(out)
        }
        Value::Array(items) => {
            Value::Array(items.iter().map(|i| render_workflow(i, vars)).collect())
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), render_workflow(v, vars)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Placeholders still present after rendering (a user workflow that wants an image we
/// did not supply, for example).
pub fn unresolved_placeholders(workflow: &Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::String(s) => {
                let mut rest = s.as_str();
                while let Some(start) = rest.find("{{") {
                    let Some(end) = rest[start..].find("}}") else {
                        break;
                    };
                    out.push(rest[start + 2..start + end].trim().to_owned());
                    rest = &rest[start + end + 2..];
                }
            }
            Value::Array(a) => a.iter().for_each(|i| walk(i, out)),
            Value::Object(m) => m.values().for_each(|i| walk(i, out)),
            _ => {}
        }
    }
    walk(workflow, &mut out);
    out.sort();
    out.dedup();
    out
}

/// ComfyUI backend.
#[derive(Debug, Clone)]
pub struct ComfyProvider {
    ctx: Ctx,
    poll_interval: Duration,
}

impl ComfyProvider {
    /// Wrap a context.
    pub fn new(ctx: Ctx) -> Self {
        Self {
            ctx,
            poll_interval: Duration::from_millis(500),
        }
    }

    /// Poll faster (tests).
    pub fn with_poll_interval(mut self, d: Duration) -> Self {
        self.poll_interval = d;
        self
    }

    /// The workflow for `kind`: the user's override from `extra` (object or JSON string),
    /// else the bundled template.
    pub fn workflow_template(&self, kind: WorkflowKind) -> Result<Value, Error> {
        match self.ctx.cfg.extra.get(kind.extra_key()) {
            Some(Value::Object(o)) if !o.is_empty() => Ok(Value::Object(o.clone())),
            Some(Value::String(s)) if !s.trim().is_empty() => {
                serde_json::from_str(s).map_err(|e| {
                    Error::InvalidRequest(format!("custom ComfyUI workflow is not valid JSON: {e}"))
                })
            }
            _ => Ok(kind.template()),
        }
    }

    fn checkpoint(&self) -> Result<String, Error> {
        let sd = self.ctx.sd();
        let ckpt = sd
            .checkpoint
            .clone()
            .unwrap_or_else(|| self.ctx.cfg.model.trim().to_owned());
        if ckpt.is_empty() {
            return Err(Error::InvalidRequest(
                "ComfyUI: choose a checkpoint (Fetch models lists them)".to_owned(),
            ));
        }
        Ok(ckpt)
    }

    #[allow(clippy::too_many_arguments)]
    fn vars(
        &self,
        prompt: &str,
        negative: Option<&str>,
        width: u32,
        height: u32,
        n: u8,
        denoise_default: f64,
        image: Option<&str>,
        mask: Option<&str>,
    ) -> Result<HashMap<&'static str, Value>, Error> {
        let sd = self.ctx.sd();
        let mut v: HashMap<&'static str, Value> = HashMap::new();
        v.insert("prompt", Value::String(prompt.to_owned()));
        v.insert("negative", Value::String(negative.unwrap_or("").to_owned()));
        v.insert("width", Value::from(width));
        v.insert("height", Value::from(height));
        v.insert("seed", Value::from(sd.seed_or_random()));
        v.insert("steps", Value::from(sd.steps));
        v.insert("cfg", Value::from(sd.cfg));
        v.insert("checkpoint", Value::String(self.checkpoint()?));
        v.insert(
            "denoise",
            Value::from(sd.denoise.unwrap_or(denoise_default)),
        );
        v.insert("sampler", Value::String(sd.sampler));
        v.insert("scheduler", Value::String(sd.scheduler));
        v.insert("batch", Value::from(n.max(1)));
        v.insert("image", Value::String(image.unwrap_or("").to_owned()));
        v.insert("mask", Value::String(mask.unwrap_or("").to_owned()));
        Ok(v)
    }

    /// `POST /upload/image` -> the server-side file name for `LoadImage`.
    pub async fn upload(&self, name: &str, bytes: Vec<u8>) -> Result<String, Error> {
        let part = Part::bytes(bytes)
            .file_name(name.to_owned())
            .mime_str("image/png")
            .map_err(|e| Error::InvalidRequest(format!("bad upload MIME: {e}")))?;
        let form = Form::new()
            .part("image", part)
            .text("overwrite", "true")
            .text("type", "input");
        let req = self
            .ctx
            .client()
            .post(self.ctx.url("/upload/image"))
            .multipart(form);
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let v: Value = resp.json().await?;
        let stored = v["name"].as_str().ok_or_else(|| {
            Error::InvalidResponse("ComfyUI /upload/image returned no name".to_owned())
        })?;
        let subfolder = v["subfolder"].as_str().unwrap_or("");
        Ok(if subfolder.is_empty() {
            stored.to_owned()
        } else {
            format!("{subfolder}/{stored}")
        })
    }

    /// Queue a rendered workflow and wait for its outputs.
    pub async fn run_workflow(
        &self,
        workflow: Value,
        model: &str,
    ) -> Result<Vec<ImageResult>, Error> {
        let missing = unresolved_placeholders(&workflow);
        if !missing.is_empty() {
            return Err(Error::InvalidRequest(format!(
                "ComfyUI workflow still has unfilled placeholders: {}",
                missing.join(", ")
            )));
        }
        let client_id = uuid::Uuid::new_v4().simple().to_string();
        let body = serde_json::json!({ "prompt": workflow, "client_id": client_id });
        let req = self.ctx.client().post(self.ctx.url("/prompt")).json(&body);
        let resp = self.ctx.bearer(req).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let msg = v["error"]["message"]
                .as_str()
                .or_else(|| v["error"].as_str())
                .unwrap_or(&text);
            let node_errors = v["node_errors"]
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(node, e)| {
                            let detail = e["errors"][0]["message"]
                                .as_str()
                                .or_else(|| e["errors"][0]["details"].as_str())
                                .unwrap_or("invalid input");
                            format!("node {node}: {detail}")
                        })
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_default();
            let message = if node_errors.is_empty() {
                msg.to_owned()
            } else {
                format!("{msg} ({node_errors})")
            };
            return Err(if status.as_u16() == 400 {
                Error::BadRequest {
                    provider: self.ctx.id(),
                    message,
                }
            } else {
                Error::Http {
                    status: status.as_u16(),
                    body: message,
                }
            });
        }
        let v: Value = serde_json::from_str(&text)?;
        let prompt_id = v["prompt_id"]
            .as_str()
            .ok_or_else(|| {
                Error::InvalidResponse("ComfyUI /prompt returned no prompt_id".to_owned())
            })?
            .to_owned();
        tracing::info!(prompt_id, "ComfyUI prompt queued");

        let outputs = loop {
            tokio::time::sleep(self.poll_interval).await;
            let resp = self
                .ctx
                .client()
                .get(self.ctx.url(&format!("/history/{prompt_id}")))
                .send()
                .await?;
            let resp = http::ensure_success(&self.ctx.id(), resp).await?;
            let hist: Value = resp.json().await?;
            let Some(entry) = hist.get(&prompt_id) else {
                continue;
            };
            let status_str = entry["status"]["status_str"].as_str().unwrap_or("");
            if status_str == "error" {
                let detail = entry["status"]["messages"]
                    .as_array()
                    .and_then(|m| {
                        m.iter().find_map(|item| {
                            (item[0].as_str() == Some("execution_error"))
                                .then(|| item[1]["exception_message"].as_str().map(str::to_owned))
                                .flatten()
                        })
                    })
                    .unwrap_or_else(|| "workflow execution failed".to_owned());
                return Err(Error::BadRequest {
                    provider: self.ctx.id(),
                    message: format!("ComfyUI: {detail}"),
                });
            }
            let completed = entry["status"]["completed"].as_bool().unwrap_or(false)
                || entry
                    .get("outputs")
                    .is_some_and(|o| o.as_object().is_some_and(|m| !m.is_empty()));
            if completed {
                break entry["outputs"].clone();
            }
        };

        let mut results = Vec::new();
        if let Some(nodes) = outputs.as_object() {
            for node in nodes.values() {
                let Some(images) = node["images"].as_array() else {
                    continue;
                };
                for img in images {
                    if img["type"].as_str().is_some_and(|t| t != "output") {
                        continue;
                    }
                    let filename = img["filename"].as_str().unwrap_or_default();
                    let subfolder = img["subfolder"].as_str().unwrap_or_default();
                    let ty = img["type"].as_str().unwrap_or("output");
                    let resp = self
                        .ctx
                        .client()
                        .get(self.ctx.url("/view"))
                        .query(&[
                            ("filename", filename),
                            ("subfolder", subfolder),
                            ("type", ty),
                        ])
                        .send()
                        .await?;
                    let resp = http::ensure_success(&self.ctx.id(), resp).await?;
                    let bytes = resp.bytes().await?.to_vec();
                    results.push(self.ctx.result(bytes, model)?);
                }
            }
        }
        if results.is_empty() {
            return Err(Error::InvalidResponse(
                "ComfyUI finished without producing an output image (is there a SaveImage node?)"
                    .to_owned(),
            ));
        }
        Ok(results)
    }

    /// `GET /system_stats` + `GET /object_info/CheckpointLoaderSimple`.
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        let req = self.ctx.client().get(self.ctx.url("/system_stats"));
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let stats: Value = resp.json().await?;
        let version = stats["system"]["comfyui_version"]
            .as_str()
            .map(str::to_owned);
        let device = stats["devices"][0]["name"]
            .as_str()
            .unwrap_or("unknown device")
            .to_owned();
        let vram_gb = stats["devices"][0]["vram_total"].as_f64().map(|b| b / 1e9);

        let req = self
            .ctx
            .client()
            .get(self.ctx.url("/object_info/CheckpointLoaderSimple"));
        let models: Vec<String> = match self.ctx.bearer(req).send().await {
            Ok(r) if r.status().is_success() => r
                .json::<Value>()
                .await
                .ok()
                .and_then(|v| {
                    v["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        let mut caps = self.ctx.cfg.kind.default_capabilities();
        caps.models = models.clone();
        Ok(ProbeResult {
            reachable: true,
            detected_caps: Some(caps),
            message: format!(
                "ComfyUI {} on {device}{}, {} checkpoint{}.",
                version.as_deref().unwrap_or("(unknown version)"),
                vram_gb
                    .map(|g| format!(" ({g:.1} GB VRAM)"))
                    .unwrap_or_default(),
                models.len(),
                if models.len() == 1 { "" } else { "s" }
            ),
            version,
            models,
            auth_failed: false,
        })
    }
}

#[async_trait]
impl ImageProvider for ComfyProvider {
    fn id(&self) -> ProviderId {
        self.ctx.id()
    }

    fn capabilities(&self) -> Capabilities {
        self.ctx.cfg.capabilities.clone()
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(&self.id(), &self.capabilities(), &req)?;
        let model = self.checkpoint()?;
        if let Some(first) = req.reference_images.first() {
            // Reference images drive an img2img pass.
            let name = self
                .upload("pixelforge-ref.png", first.data.clone())
                .await?;
            let d = dims(first)?;
            let vars = self.vars(
                &req.prompt,
                req.negative_prompt.as_deref(),
                d.width,
                d.height,
                req.n,
                0.75,
                Some(&name),
                None,
            )?;
            let wf = render_workflow(&self.workflow_template(WorkflowKind::Img2Img)?, &vars);
            return self.run_workflow(wf, &model).await;
        }
        let size = size_or_default(req.size, 1024);
        let vars = self.vars(
            &req.prompt,
            req.negative_prompt.as_deref(),
            size.width,
            size.height,
            req.n,
            1.0,
            None,
            None,
        )?;
        let wf = render_workflow(&self.workflow_template(WorkflowKind::Txt2Img)?, &vars);
        self.run_workflow(wf, &model).await
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        let model = self.checkpoint()?;
        let d = dims(&req.image)?;
        let image = self
            .upload("pixelforge-input.png", req.image.data.clone())
            .await?;
        let (kind, mask_name, denoise) = if req.mode == EditMode::Mask {
            let m = req
                .mask
                .as_ref()
                .ok_or_else(|| Error::InvalidRequest("mask edit without a mask".to_owned()))?;
            let png = mask::to_a1111_mask(&m.data, d.width, d.height)?;
            let name = self.upload("pixelforge-mask.png", png).await?;
            (WorkflowKind::Inpaint, Some(name), 1.0)
        } else {
            (WorkflowKind::Img2Img, None, 0.75)
        };
        let vars = self.vars(
            &req.prompt,
            req.negative_prompt.as_deref(),
            d.width,
            d.height,
            req.n,
            denoise,
            Some(&image),
            mask_name.as_deref(),
        )?;
        let wf = render_workflow(&self.workflow_template(kind)?, &vars);
        self.run_workflow(wf, &model).await
    }

    async fn test_key(&self) -> Result<(), Error> {
        self.probe().await.map(|_| ())
    }
}

/// Keep the unused-import lint honest when the inpaint path is compiled out of tests.
#[allow(dead_code)]
fn _uses(_: &ImageBytes) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars() -> HashMap<&'static str, Value> {
        let mut v = HashMap::new();
        v.insert("prompt", Value::String("a \"quoted\" fox".into()));
        v.insert("negative", Value::String("".into()));
        v.insert("seed", Value::from(42u64));
        v.insert("steps", Value::from(30u32));
        v.insert("cfg", Value::from(6.5));
        v.insert("width", Value::from(640u32));
        v.insert("height", Value::from(480u32));
        v.insert("batch", Value::from(2u8));
        v.insert("checkpoint", Value::String("sd.safetensors".into()));
        v.insert("denoise", Value::from(1.0));
        v.insert("sampler", Value::String("euler".into()));
        v.insert("scheduler", Value::String("karras".into()));
        v.insert("image", Value::String("in.png".into()));
        v.insert("mask", Value::String("m.png".into()));
        v
    }

    #[test]
    fn bundled_templates_render_with_typed_numbers() {
        for kind in [
            WorkflowKind::Txt2Img,
            WorkflowKind::Img2Img,
            WorkflowKind::Inpaint,
        ] {
            let t = kind.template();
            assert!(
                !unresolved_placeholders(&t).is_empty(),
                "{kind:?} has placeholders"
            );
            let r = render_workflow(&t, &vars());
            assert!(
                unresolved_placeholders(&r).is_empty(),
                "{kind:?} fully rendered: {r}"
            );
            // KSampler numeric inputs must be numbers, not strings.
            let ks = r
                .as_object()
                .expect("obj")
                .values()
                .find(|n| n["class_type"] == "KSampler")
                .expect("has a KSampler");
            assert_eq!(ks["inputs"]["seed"], 42);
            assert_eq!(ks["inputs"]["steps"], 30);
            assert_eq!(ks["inputs"]["cfg"], 6.5);
            assert_eq!(ks["inputs"]["sampler_name"], "euler");
            let clip = r
                .as_object()
                .expect("obj")
                .values()
                .find(|n| {
                    n["class_type"] == "CLIPTextEncode"
                        && n["inputs"]["text"]
                            .as_str()
                            .is_some_and(|t| t.contains("fox"))
                })
                .expect("positive prompt node");
            assert_eq!(clip["inputs"]["text"], "a \"quoted\" fox");
            let ckpt = r
                .as_object()
                .expect("obj")
                .values()
                .find(|n| n["class_type"] == "CheckpointLoaderSimple")
                .expect("ckpt");
            assert_eq!(ckpt["inputs"]["ckpt_name"], "sd.safetensors");
        }
        let t = WorkflowKind::Txt2Img.template();
        let r = render_workflow(&t, &vars());
        let latent = r
            .as_object()
            .expect("obj")
            .values()
            .find(|n| n["class_type"] == "EmptyLatentImage")
            .expect("latent");
        assert_eq!(latent["inputs"]["width"], 640);
        assert_eq!(latent["inputs"]["batch_size"], 2);
        let r = render_workflow(&WorkflowKind::Inpaint.template(), &vars());
        let loads: Vec<&Value> = r
            .as_object()
            .expect("obj")
            .values()
            .filter(|n| n["class_type"] == "LoadImage")
            .collect();
        assert_eq!(loads.len(), 2);
        assert!(loads.iter().any(|n| n["inputs"]["image"] == "m.png"));
    }

    #[test]
    fn placeholders_inside_longer_strings_are_textual() {
        let t = serde_json::json!({ "1": { "inputs": { "text": "masterpiece, {{prompt}}, seed {{seed}}", "filename_prefix": "pf-{{batch}}" } } });
        let r = render_workflow(&t, &vars());
        assert_eq!(
            r["1"]["inputs"]["text"],
            "masterpiece, a \"quoted\" fox, seed 42"
        );
        assert_eq!(r["1"]["inputs"]["filename_prefix"], "pf-2");
        let t = serde_json::json!({ "1": { "inputs": { "x": "{{unknown}}", "y": "keep {{alsoUnknown}}" } } });
        let r = render_workflow(&t, &vars());
        assert_eq!(unresolved_placeholders(&r), vec!["alsoUnknown", "unknown"]);
    }
}
