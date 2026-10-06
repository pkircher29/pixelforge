//! User-defined ("custom") providers: the registry entry shape, its on-disk file and the
//! per-kind defaults. The backends live in [`crate::providers::custom`].
//!
//! A custom provider is identified by [`ProviderId::Custom`] (`custom:<id>` on the wire).
//! Its secret (API key / token / `user:pass` for A1111 basic auth) is **not** stored here:
//! it lives in the key store under the same `custom:<id>` user name, and only
//! [`CustomProvider::has_auth`] is persisted so the UI can show a status dot.
//!
//! Research: `docs/ai-research.md` section 4 (verified 2026-10-06).

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Error;
use crate::types::{Capabilities, ProviderId};

/// File name inside the app config directory.
pub const REGISTRY_FILE: &str = "ai-providers.json";

/// The provider *type*: which wire protocol the backend speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomKind {
    /// Any server that implements OpenAI's `/v1/images/*` (LocalAI, vLLM-Omni, hosted
    /// vendors). LM Studio probes fine but has no image endpoint.
    #[serde(rename = "openai_compat")]
    OpenAiCompat,
    /// Hugging Face Inference Providers router (`hf-inference`) or a dedicated Inference
    /// Endpoint URL.
    HuggingFace,
    /// Ollama: **prompt assist only** (vision chat); no documented image output API.
    Ollama,
    /// ComfyUI HTTP API with API-format workflows; native inpainting.
    ComfyUi,
    /// Stable Diffusion WebUI (AUTOMATIC1111) / Forge `/sdapi/v1`; native inpainting.
    A1111,
    /// Replicate predictions API (hosted, per-model inputs).
    Replicate,
}

impl CustomKind {
    /// Every kind, in "+ Add" menu order.
    pub const ALL: [CustomKind; 6] = [
        CustomKind::OpenAiCompat,
        CustomKind::HuggingFace,
        CustomKind::Ollama,
        CustomKind::ComfyUi,
        CustomKind::A1111,
        CustomKind::Replicate,
    ];

    /// Wire / registry string (`openai_compat`, ...).
    pub fn as_str(self) -> &'static str {
        match self {
            CustomKind::OpenAiCompat => "openai_compat",
            CustomKind::HuggingFace => "hugging_face",
            CustomKind::Ollama => "ollama",
            CustomKind::ComfyUi => "comfy_ui",
            CustomKind::A1111 => "a1111",
            CustomKind::Replicate => "replicate",
        }
    }

    /// Short label for the "+ Add" menu.
    pub fn label(self) -> &'static str {
        match self {
            CustomKind::OpenAiCompat => "OpenAI-compatible server",
            CustomKind::HuggingFace => "Hugging Face",
            CustomKind::Ollama => "Ollama",
            CustomKind::ComfyUi => "ComfyUI",
            CustomKind::A1111 => "Stable Diffusion WebUI / Forge",
            CustomKind::Replicate => "Replicate",
        }
    }

    /// One-line description for the "+ Add" menu.
    pub fn description(self) -> &'static str {
        match self {
            CustomKind::OpenAiCompat => {
                "OpenAI-compatible server (LocalAI, LM Studio, vLLM, or any vendor)"
            }
            CustomKind::HuggingFace => "Hugging Face (Inference API / Endpoint)",
            CustomKind::Ollama => "Ollama (local, prompt assist)",
            CustomKind::ComfyUi => "ComfyUI (local, full control, inpainting)",
            CustomKind::A1111 => "Stable Diffusion WebUI / Forge (local, inpainting)",
            CustomKind::Replicate => "Replicate (hosted, any public model)",
        }
    }

    /// Base URL pre-filled in the dialog.
    pub fn default_base_url(self) -> &'static str {
        match self {
            CustomKind::OpenAiCompat => "http://localhost:8080",
            CustomKind::HuggingFace => "https://router.huggingface.co/hf-inference",
            CustomKind::Ollama => "http://localhost:11434",
            CustomKind::ComfyUi => "http://127.0.0.1:8188",
            CustomKind::A1111 => "http://127.0.0.1:7860",
            CustomKind::Replicate => "https://api.replicate.com",
        }
    }

    /// Where to get the software / a token.
    pub fn help_url(self) -> &'static str {
        match self {
            CustomKind::OpenAiCompat => "https://localai.io/docs/features/image-generation/",
            CustomKind::HuggingFace => "https://huggingface.co/settings/tokens",
            CustomKind::Ollama => "https://ollama.com",
            CustomKind::ComfyUi => "https://github.com/comfyanonymous/ComfyUI",
            CustomKind::A1111 => "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
            CustomKind::Replicate => "https://replicate.com/account/api-tokens",
        }
    }

    /// Whether a secret is mandatory (`true`), optional (`false`).
    pub fn requires_auth(self) -> bool {
        matches!(self, CustomKind::HuggingFace | CustomKind::Replicate)
    }

    /// Kinds that normally run on the user's own machine.
    pub fn is_local_by_default(self) -> bool {
        matches!(
            self,
            CustomKind::Ollama | CustomKind::ComfyUi | CustomKind::A1111 | CustomKind::OpenAiCompat
        )
    }

    /// Can this kind act as a prompt helper (vision chat)?
    pub fn prompt_assist(self) -> bool {
        matches!(self, CustomKind::Ollama)
    }

    /// Capability defaults (docs/ai-research.md section 4.7). Editable by the user.
    pub fn default_capabilities(self) -> Capabilities {
        let sd = Capabilities {
            generate: true,
            mask_edit: true,
            instruct_edit: true,
            multi_ref: false,
            max_refs: 1,
            sizes: Vec::new(),
            custom_sizes: true,
            aspect_ratios: Vec::new(),
            resolutions: Vec::new(),
            max_px: 2048,
            max_variants: 4,
            transparent_bg: false,
            models: Vec::new(),
        };
        match self {
            CustomKind::OpenAiCompat => Capabilities {
                mask_edit: false,
                instruct_edit: false,
                max_px: 4096,
                max_variants: 4,
                ..sd
            },
            CustomKind::HuggingFace => Capabilities {
                mask_edit: false,
                instruct_edit: false,
                max_variants: 4,
                ..sd
            },
            CustomKind::Ollama => Capabilities::default(),
            CustomKind::ComfyUi | CustomKind::A1111 => sd,
            CustomKind::Replicate => Capabilities {
                mask_edit: false,
                instruct_edit: false,
                max_px: 4096,
                max_variants: 4,
                ..sd
            },
        }
    }
}

impl std::fmt::Display for CustomKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

/// One registry entry. `extra` is free-form JSON the backends read with defaults
/// (`steps`, `cfg`, `sampler`, `scheduler`, `denoise`, `seed`, `checkpoint`, `workflow`,
/// `maskBlur`, `inpaintingFill`, `inpaintFullRes`, `version`, `imageField`, `models`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProvider {
    /// Registry id: `[a-z0-9][a-z0-9-]*`, unique.
    pub id: String,
    /// Display name (layer names use it).
    pub name: String,
    /// Wire protocol.
    pub kind: CustomKind,
    /// Server / API root. Trailing slashes are ignored.
    pub base_url: String,
    /// Model, repo id, checkpoint title or `owner/name` depending on the kind.
    #[serde(default)]
    pub model: String,
    /// Capability matrix (defaults from the kind, user-editable).
    #[serde(default)]
    pub capabilities: Capabilities,
    /// Kind-specific knobs.
    #[serde(default = "empty_object")]
    pub extra: Value,
    /// A secret is stored in the key store under `custom:<id>`.
    #[serde(default)]
    pub has_auth: bool,
}

fn empty_object() -> Value {
    Value::Object(serde_json::Map::new())
}

impl CustomProvider {
    /// A new entry with the kind's defaults.
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: CustomKind) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind,
            base_url: kind.default_base_url().to_owned(),
            model: String::new(),
            capabilities: kind.default_capabilities(),
            extra: empty_object(),
            has_auth: false,
        }
    }

    /// The [`ProviderId`] this entry answers to.
    pub fn provider_id(&self) -> ProviderId {
        ProviderId::custom(self.id.clone())
    }

    /// Base URL without trailing slashes.
    pub fn base(&self) -> String {
        self.base_url.trim().trim_end_matches('/').to_owned()
    }

    /// Heuristic: does the base URL point at this machine or the LAN?
    pub fn is_local(&self) -> bool {
        let Ok(url) = reqwest::Url::parse(&self.base()) else {
            return self.kind.is_local_by_default();
        };
        match url.host_str() {
            Some(host) => is_local_host(host),
            None => self.kind.is_local_by_default(),
        }
    }

    /// Icon hint for the UI: `local`, `cloud`, `hub` (Hugging Face) or `assist` (Ollama).
    pub fn icon(&self) -> &'static str {
        match self.kind {
            CustomKind::Ollama => "assist",
            CustomKind::HuggingFace => "hub",
            _ if self.is_local() => "local",
            _ => "cloud",
        }
    }

    /// Read a string knob from `extra`.
    pub fn extra_str(&self, key: &str) -> Option<&str> {
        self.extra
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
    }

    /// Read a number knob from `extra`.
    pub fn extra_f64(&self, key: &str) -> Option<f64> {
        self.extra
            .get(key)
            .and_then(|v| v.as_f64().or_else(|| v.as_str()?.trim().parse().ok()))
    }

    /// Read a boolean knob from `extra`.
    pub fn extra_bool(&self, key: &str) -> Option<bool> {
        self.extra.get(key).and_then(Value::as_bool)
    }

    /// Reject entries the backends cannot use.
    pub fn validate(&self) -> Result<(), Error> {
        if !is_valid_id(&self.id) {
            return Err(Error::InvalidRequest(format!(
                "custom provider id {:?} must be lowercase letters, digits and dashes",
                self.id
            )));
        }
        if self.name.trim().is_empty() {
            return Err(Error::InvalidRequest(
                "custom provider needs a name".to_owned(),
            ));
        }
        let url = reqwest::Url::parse(&self.base())
            .map_err(|e| Error::InvalidRequest(format!("base URL {:?}: {e}", self.base_url)))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(Error::InvalidRequest(format!(
                "base URL {:?} must start with http:// or https://",
                self.base_url
            )));
        }
        if !self.extra.is_object() {
            return Err(Error::InvalidRequest(
                "extra must be a JSON object".to_owned(),
            ));
        }
        Ok(())
    }
}

/// `[a-z0-9][a-z0-9-]{0,63}`.
pub fn is_valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    id.len() <= 64 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Derive a registry id from a display name (`"My ComfyUI"` -> `my-comfyui`).
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let out = out.trim_end_matches('-').to_owned();
    if out.is_empty() {
        "provider".to_owned()
    } else {
        out.chars().take(64).collect()
    }
}

fn is_local_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']);
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") || host == "::1" {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            std::net::IpAddr::V6(v6) => v6.is_loopback(),
        };
    }
    !host.contains('.')
}

/// What a probe found out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    /// The server answered (even with an auth error).
    pub reachable: bool,
    /// Models / checkpoints / repos the server reports.
    pub models: Vec<String>,
    /// Capabilities the probe could infer (`None` when it cannot tell).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_caps: Option<Capabilities>,
    /// Human summary ("ComfyUI 0.3.40, 3 checkpoints").
    pub message: String,
    /// Server version when reported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The credentials were rejected (401/403).
    #[serde(default)]
    pub auth_failed: bool,
}

impl ProbeResult {
    /// A reachable server with the given models.
    pub fn ok(message: impl Into<String>, models: Vec<String>) -> Self {
        Self {
            reachable: true,
            models,
            detected_caps: None,
            message: message.into(),
            version: None,
            auth_failed: false,
        }
    }

    /// Turn a backend error into an unreachable / auth-failed result.
    pub fn from_error(err: &Error) -> Self {
        let auth_failed = matches!(err, Error::Auth(_));
        Self {
            reachable: !matches!(err, Error::Transport(_)),
            models: Vec::new(),
            detected_caps: None,
            message: err.to_string(),
            version: None,
            auth_failed,
        }
    }
}

// ---------------------------------------------------------------------------------
// Registry file
// ---------------------------------------------------------------------------------

#[derive(Debug, Default, Serialize, Deserialize)]
struct RegistryFile {
    #[serde(default = "RegistryFile::version")]
    version: u32,
    #[serde(default)]
    providers: Vec<CustomProvider>,
}

impl RegistryFile {
    fn version() -> u32 {
        1
    }
}

/// `ai-providers.json` in the app config directory.
#[derive(Debug, Clone)]
pub struct CustomRegistry {
    path: PathBuf,
}

impl CustomRegistry {
    /// Registry stored in `dir`.
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join(REGISTRY_FILE),
        }
    }

    /// Path of the JSON file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// All entries (empty when the file does not exist). Malformed entries fail the load
    /// loudly rather than silently dropping a provider.
    pub fn load(&self) -> Result<Vec<CustomProvider>, Error> {
        match fs::read(&self.path) {
            Ok(bytes) => {
                let file: RegistryFile = serde_json::from_slice(&bytes)?;
                Ok(file.providers)
            }
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }

    /// Replace the whole list (atomic write).
    pub fn save(&self, providers: &[CustomProvider]) -> Result<(), Error> {
        for p in providers {
            p.validate()?;
        }
        let mut seen = std::collections::HashSet::new();
        for p in providers {
            if !seen.insert(p.id.as_str()) {
                return Err(Error::InvalidRequest(format!(
                    "duplicate custom provider id {:?}",
                    p.id
                )));
            }
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = RegistryFile {
            version: RegistryFile::version(),
            providers: providers.to_vec(),
        };
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&file)?)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Find one entry.
    pub fn get(&self, id: &str) -> Result<Option<CustomProvider>, Error> {
        Ok(self.load()?.into_iter().find(|p| p.id == id))
    }

    /// Insert a new entry; fails when the id exists.
    pub fn add(&self, provider: CustomProvider) -> Result<Vec<CustomProvider>, Error> {
        let mut list = self.load()?;
        if list.iter().any(|p| p.id == provider.id) {
            return Err(Error::InvalidRequest(format!(
                "a custom provider with id {:?} already exists",
                provider.id
            )));
        }
        list.push(provider);
        self.save(&list)?;
        Ok(list)
    }

    /// Replace an existing entry (matched by id).
    pub fn update(&self, provider: CustomProvider) -> Result<Vec<CustomProvider>, Error> {
        let mut list = self.load()?;
        let Some(slot) = list.iter_mut().find(|p| p.id == provider.id) else {
            return Err(Error::InvalidRequest(format!(
                "no custom provider with id {:?}",
                provider.id
            )));
        };
        *slot = provider;
        self.save(&list)?;
        Ok(list)
    }

    /// Remove an entry (no error when absent).
    pub fn remove(&self, id: &str) -> Result<Vec<CustomProvider>, Error> {
        let mut list = self.load()?;
        list.retain(|p| p.id != id);
        self.save(&list)?;
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_slugs() {
        assert!(is_valid_id("my-comfy-1"));
        assert!(!is_valid_id("-bad"));
        assert!(!is_valid_id("Bad"));
        assert!(!is_valid_id(""));
        assert_eq!(slugify("My ComfyUI!"), "my-comfyui");
        assert_eq!(slugify("  "), "provider");
        assert_eq!(slugify("A--B"), "a-b");
    }

    #[test]
    fn locality_heuristic() {
        let mut p = CustomProvider::new("x", "X", CustomKind::ComfyUi);
        assert!(p.is_local());
        assert_eq!(p.icon(), "local");
        p.base_url = "https://comfy.example.com".into();
        assert!(!p.is_local());
        assert_eq!(p.icon(), "cloud");
        p.base_url = "http://192.168.1.50:8188/".into();
        assert!(p.is_local());
        p.base_url = "http://[::1]:8188".into();
        assert!(p.is_local());
        p.base_url = "http://mybox:8188".into();
        assert!(p.is_local());
        let hf = CustomProvider::new("h", "H", CustomKind::HuggingFace);
        assert_eq!(hf.icon(), "hub");
        let o = CustomProvider::new("o", "O", CustomKind::Ollama);
        assert_eq!(o.icon(), "assist");
        assert!(!o.capabilities.generate);
    }

    #[test]
    fn validation() {
        let mut p = CustomProvider::new("ok", "Ok", CustomKind::A1111);
        p.validate().expect("valid");
        p.base_url = "ftp://x".into();
        assert!(p.validate().is_err());
        p.base_url = "not a url".into();
        assert!(p.validate().is_err());
        p.base_url = "http://127.0.0.1:7860".into();
        p.name = " ".into();
        assert!(p.validate().is_err());
        p.name = "Ok".into();
        p.extra = Value::Null;
        assert!(p.validate().is_err());
    }

    #[test]
    fn registry_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let reg = CustomRegistry::new(dir.path());
        assert!(reg.load().expect("empty").is_empty());
        let mut a = CustomProvider::new("comfy", "My ComfyUI", CustomKind::ComfyUi);
        a.model = "sd_xl_base_1.0.safetensors".into();
        a.extra = serde_json::json!({ "steps": 25, "cfg": 6.5, "workflow": { "1": {} } });
        reg.add(a.clone()).expect("add");
        assert!(reg.add(a.clone()).is_err(), "duplicate id");
        let b = CustomProvider::new("hf", "HF", CustomKind::HuggingFace);
        reg.add(b).expect("add");
        let list = reg.load().expect("load");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0], a);
        assert_eq!(list[0].extra_f64("steps"), Some(25.0));
        let json = std::fs::read_to_string(reg.path()).expect("file");
        assert!(json.contains("\"kind\": \"comfy_ui\""));
        assert!(json.contains("\"baseUrl\""));
        a.name = "Renamed".into();
        a.has_auth = true;
        reg.update(a.clone()).expect("update");
        assert_eq!(
            reg.get("comfy").expect("get").expect("some").name,
            "Renamed"
        );
        assert!(reg
            .update(CustomProvider::new("nope", "N", CustomKind::Ollama))
            .is_err());
        reg.remove("hf").expect("remove");
        assert_eq!(reg.load().expect("load").len(), 1);
        reg.remove("hf").expect("remove twice is fine");
        let kinds: Vec<&str> = CustomKind::ALL.iter().map(|k| k.as_str()).collect();
        assert_eq!(kinds.len(), 6);
        assert_eq!(
            serde_json::to_string(&CustomKind::OpenAiCompat).expect("ser"),
            "\"openai_compat\""
        );
    }

    #[test]
    fn probe_result_from_errors() {
        let r = ProbeResult::from_error(&Error::Auth("nope".into()));
        assert!(r.reachable && r.auth_failed);
        let r = ProbeResult::from_error(&Error::Http {
            status: 404,
            body: "x".into(),
        });
        assert!(r.reachable && !r.auth_failed);
    }
}
