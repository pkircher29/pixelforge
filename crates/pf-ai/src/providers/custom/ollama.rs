//! Ollama as a **prompt helper**, never an image generator (docs/ai-research.md
//! section 4.3): the documented API (`/api/generate`, `/api/chat`) only *accepts* images
//! (`images: [base64]`) for vision models; the experimental image generation announced
//! in 2026-01 is macOS-only, CLI-only and has no documented REST shape. So this backend
//! reports no generation capabilities and implements [`OllamaAssist::assist`] on top of
//! `POST /api/chat`.

use async_trait::async_trait;
use serde::Deserialize;

use super::Ctx;
use crate::custom::ProbeResult;
use crate::error::Error;
use crate::http;
use crate::provider::ImageProvider;
use crate::types::{
    Capabilities, EditRequest, GenerateRequest, ImageBytes, ImageResult, ProviderId,
};

/// Ollama backend (assist only).
#[derive(Debug, Clone)]
pub struct OllamaAssist {
    ctx: Ctx,
}

/// Model family / name fragments that indicate vision input support.
const VISION_HINTS: [&str; 9] = [
    "clip", "mllama", "qwen2vl", "qwen25vl", "qwen3vl", "gemma3", "llava", "vision", "-vl",
];

impl OllamaAssist {
    /// Wrap a context.
    pub fn new(ctx: Ctx) -> Self {
        Self { ctx }
    }

    /// `GET /api/tags` (+ best-effort `GET /api/version`).
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        let req = self.ctx.client().get(self.ctx.url("/api/tags"));
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let tags: Tags = resp.json().await?;
        let mut models = Vec::with_capacity(tags.models.len());
        let mut vision = 0usize;
        for m in &tags.models {
            let families = m.details.families.join(",").to_ascii_lowercase();
            let name = m.name.to_ascii_lowercase();
            let is_vision = VISION_HINTS
                .iter()
                .any(|h| families.contains(h) || name.contains(h));
            if is_vision {
                vision += 1;
            }
            models.push(m.name.clone());
        }
        // Vision models first so the picker's default is useful.
        models.sort_by_key(|n| {
            let l = n.to_ascii_lowercase();
            !VISION_HINTS.iter().any(|h| l.contains(h))
        });
        let version = match self
            .ctx
            .client()
            .get(self.ctx.url("/api/version"))
            .send()
            .await
        {
            Ok(r) => r
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v["version"].as_str().map(str::to_owned)),
            Err(_) => None,
        };
        Ok(ProbeResult {
            reachable: true,
            detected_caps: Some(Capabilities::default()),
            message: format!(
                "Ollama{} is running with {} model{} ({vision} vision-capable). Ollama has no image generation API; use it to improve prompts.",
                version.as_deref().map(|v| format!(" {v}")).unwrap_or_default(),
                models.len(),
                if models.len() == 1 { "" } else { "s" }
            ),
            version,
            models,
            auth_failed: false,
        })
    }

    /// Rewrite `text` (optionally describing `image`) into a better image prompt.
    pub async fn assist(&self, image: Option<ImageBytes>, text: &str) -> Result<String, Error> {
        let model = self.ctx.model(None);
        if model.is_empty() {
            return Err(Error::InvalidRequest(
                "Ollama: pick a (vision) model for prompt assist, e.g. llava or qwen2.5vl"
                    .to_owned(),
            ));
        }
        let text = text.trim();
        let content = match (image.is_some(), text.is_empty()) {
            (true, true) => "Describe this image as a single-paragraph prompt for an image generation model: subject, style, lighting, composition, colours. Reply with the prompt only.".to_owned(),
            (true, false) => format!("You write prompts for image generation models. The attached image is the current picture. Rewrite the user's request into one vivid, specific prompt (max 80 words) that keeps the image's style, lighting and composition. Reply with the prompt only.\n\nRequest: {text}"),
            (false, true) => return Err(Error::InvalidRequest("nothing to improve: type a prompt or open an image".to_owned())),
            (false, false) => format!("You write prompts for image generation models. Rewrite the user's prompt into one vivid, specific prompt (max 80 words): subject, style, lighting, composition, colours. Reply with the prompt only.\n\nPrompt: {text}"),
        };
        let mut message = serde_json::json!({ "role": "user", "content": content });
        if let Some(img) = &image {
            message["images"] = serde_json::json!([http::b64_encode(&img.data)]);
        }
        let body = serde_json::json!({
            "model": model,
            "stream": false,
            "messages": [message],
            "options": { "temperature": 0.4 },
        });
        let req = self
            .ctx
            .client()
            .post(self.ctx.url("/api/chat"))
            .json(&body);
        let resp = self.ctx.bearer(req).send().await?;
        let resp = http::ensure_success(&self.ctx.id(), resp).await?;
        let chat: ChatResponse = resp.json().await?;
        let out = chat
            .message
            .content
            .trim()
            .trim_matches('"')
            .trim()
            .to_owned();
        if out.is_empty() {
            return Err(Error::InvalidResponse(
                "Ollama returned an empty message".to_owned(),
            ));
        }
        Ok(out)
    }
}

#[async_trait]
impl ImageProvider for OllamaAssist {
    fn id(&self) -> ProviderId {
        self.ctx.id()
    }

    /// Always "nothing": Ollama cannot produce images through its API.
    fn capabilities(&self) -> Capabilities {
        Capabilities::default()
    }

    async fn generate(&self, _req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        Err(Error::Unsupported {
            provider: self.id(),
            capability:
                "image generation (Ollama's API has no image output; use it for prompt assist)",
        })
    }

    async fn edit(&self, _req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        Err(Error::Unsupported {
            provider: self.id(),
            capability:
                "image editing (Ollama's API has no image output; use it for prompt assist)",
        })
    }

    async fn test_key(&self) -> Result<(), Error> {
        self.probe().await.map(|_| ())
    }
}

#[derive(Debug, Deserialize)]
struct Tags {
    #[serde(default)]
    models: Vec<TagModel>,
}

#[derive(Debug, Deserialize)]
struct TagModel {
    #[serde(default)]
    name: String,
    #[serde(default)]
    details: TagDetails,
}

#[derive(Debug, Default, Deserialize)]
struct TagDetails {
    #[serde(default)]
    families: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    #[serde(default)]
    message: ChatMessage,
}

#[derive(Debug, Default, Deserialize)]
struct ChatMessage {
    #[serde(default)]
    content: String,
}
