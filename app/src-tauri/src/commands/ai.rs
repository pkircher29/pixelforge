//! AI commands (`ai_*`). Thin adapters over `pf-ai`: providers (built-in and custom), the
//! job queue, raw-bytes IPC. The full contract (argument shapes, wire format, events) is
//! in `docs/ipc.md`.
//!
//! Summary:
//!
//! | command | args | returns |
//! |---|---|---|
//! | `ai_list_providers` | - | `ProviderInfo[]` (built-ins + custom) |
//! | `ai_submit_generate` | `{ params: GenerateParams }` (JSON) | `JobId` (string) |
//! | `ai_submit_edit` | raw body: binary frame (see `pf_ai::ipc`) | `JobId` |
//! | `ai_job_status` | `{ job }` | `JobStatus` |
//! | `ai_cancel` | `{ job }` | `bool` (was it still running / queued) |
//! | `ai_take_result` | `{ job }` | raw body: binary frame (`ArrayBuffer` in JS) |
//! | `ai_test_key` | `{ provider }` | `()` |
//! | `ai_custom_kinds` | - | `CustomKindInfo[]` |
//! | `ai_custom_list` | - | `CustomProvider[]` |
//! | `ai_custom_add` | `{ provider, auth? }` | `CustomProvider[]` |
//! | `ai_custom_update` | `{ provider, auth?, clearAuth? }` | `CustomProvider[]` |
//! | `ai_custom_remove` | `{ id }` | `CustomProvider[]` |
//! | `ai_custom_probe` | `{ provider, auth? }` | `ProbeResult` |
//! | `ai_prompt_assist` | raw body: frame `{ provider, text }` + optional image blob | `string` |
//! | `ai_hub_search` | `{ query, pipelineTag?, limit? }` | `HubModel[]` |
//!
//! Events: every `pf_ai::JobEvent` is emitted twice, on `ai://job/<id>` and on the
//! catch-all `ai://jobs` (listen to the latter *before* invoking submit so the `queued`
//! / `started` events of a fast job are not missed).

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use pf_ai::ipc::{decode_edit_body, decode_frame, encode_results, GenerateParams};
use pf_ai::providers::custom::hf::{hub_search_default, HubModel};
use pf_ai::{
    build_custom_provider, build_provider_from_env, capabilities_for, probe_custom, prompt_assist,
    AuthMethod, Capabilities, CustomKind, CustomProvider, CustomRegistry, ImageBytes, JobEvent,
    JobId, JobKind, JobSpec, JobStatus, KeyStore, ProbeResult, ProviderId, SecretString,
    SharedProvider,
};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::broadcast::error::RecvError;

use std::collections::HashMap;

use crate::commands::oauth::{
    auth_pref, auth_rows, session_for, subscription_provider, AuthMode, AuthRow,
};
use crate::commands::settings::{
    custom_registry, key_store, load_key, load_key_opt, settings_snapshot, validate_key,
};
use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

/// Event topic prefix; the job id is appended (`ai://job/<id>`).
pub const JOB_EVENT_PREFIX: &str = "ai://job/";
/// Catch-all topic that receives every job event.
pub const JOBS_EVENT: &str = "ai://jobs";

/// Allowed range for a per-job timeout override.
const MIN_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_TIMEOUT: Duration = Duration::from_secs(3600);

/// One row of the provider picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    /// Stable id (`open_ai`, `x_ai`, `gemini`, `custom:<id>`).
    pub id: ProviderId,
    /// Short label used in layer names (`ChatGPT`, `Grok`, `Gemini`, or the custom name).
    pub name: String,
    /// Vendor name for settings (`OpenAI`, `xAI`, `Google`, or the custom kind label).
    pub vendor: String,
    /// What the provider can do.
    pub capabilities: Capabilities,
    /// Whether an API key / token is present in the key store.
    pub has_key: bool,
    /// Which backend answered (`keyring` / `file`).
    pub key_backend: String,
    /// Model used when the request does not name one (generate).
    pub default_model: String,
    /// Model used for edits when the request does not name one.
    pub edit_model: String,
    /// Every model the UI may offer.
    pub models: Vec<String>,
    /// `builtin` or a `CustomKind` wire name (`openai_compat`, `comfy_ui`, ...).
    pub kind: String,
    /// Runs on this machine / the LAN (no cost, 🖥 glyph).
    pub local: bool,
    /// Icon hint: `cloud`, `local`, `hub`, `assist`.
    pub icon: String,
    /// The provider can rewrite prompts (Ollama vision chat) but not make images.
    pub prompt_assist: bool,
    /// A secret is optional for this provider (local servers).
    pub key_optional: bool,
    /// Offered auth modes: `["api_key"]`, or `["api_key", "subscription"]` (ChatGPT, Grok).
    pub auth_modes: Vec<&'static str>,
    /// The mode requests use right now.
    pub auth_active: AuthMode,
    /// Signed-in subscription account, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountInfo>,
}

/// Signed-in account shown next to the provider.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    /// E-mail from the ID token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Plan name, where the vendor documents it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
}

/// Pure builder for the built-in rows (unit-testable without Tauri).
pub fn provider_rows(
    has_key: impl Fn(&ProviderId) -> bool,
    backend: &str,
    auth: &HashMap<ProviderId, AuthRow>,
) -> Vec<ProviderInfo> {
    ProviderId::BUILTIN
        .into_iter()
        .map(|id| {
            let capabilities = capabilities_for(&id);
            let default_model = capabilities.default_model().unwrap_or_default().to_owned();
            let edit_model = match id {
                ProviderId::OpenAi => pf_ai::capabilities::OPENAI_EDIT_MODEL.to_owned(),
                _ => default_model.clone(),
            };
            let row = auth.get(&id).cloned().unwrap_or_default();
            let on_plan = row.active == AuthMode::Subscription;
            let account = row.account.map(|(email, plan)| AccountInfo { email, plan });
            ProviderInfo {
                // ChatGPT on the plan rewrites prompts (text Responses are allowed).
                prompt_assist: id == ProviderId::OpenAi && on_plan && account.is_some(),
                auth_modes: if row.modes.is_empty() {
                    vec!["api_key"]
                } else {
                    row.modes
                },
                auth_active: row.active,
                account,
                name: id.label().into_owned(),
                vendor: id.vendor().to_owned(),
                has_key: has_key(&id),
                key_backend: backend.to_owned(),
                default_model,
                edit_model,
                models: capabilities.models.clone(),
                capabilities,
                kind: "builtin".to_owned(),
                local: false,
                icon: "cloud".to_owned(),
                key_optional: false,
                id,
            }
        })
        .collect()
}

/// Rows for the registered custom providers.
pub fn custom_rows(
    customs: &[CustomProvider],
    has_key: impl Fn(&ProviderId) -> bool,
    backend: &str,
) -> Vec<ProviderInfo> {
    customs
        .iter()
        .map(|c| {
            let id = c.provider_id();
            let mut models: Vec<String> = Vec::new();
            if !c.model.trim().is_empty() {
                models.push(c.model.trim().to_owned());
            }
            if let Some(list) = c.extra.get("models").and_then(|v| v.as_array()) {
                for m in list.iter().filter_map(|v| v.as_str()) {
                    if !models.iter().any(|x| x == m) {
                        models.push(m.to_owned());
                    }
                }
            }
            let mut capabilities = c.capabilities.clone();
            capabilities.models = models.clone();
            ProviderInfo {
                name: c.name.clone(),
                vendor: c.kind.label().to_owned(),
                has_key: has_key(&id),
                key_backend: backend.to_owned(),
                default_model: c.model.trim().to_owned(),
                edit_model: c.model.trim().to_owned(),
                models,
                capabilities,
                kind: c.kind.as_str().to_owned(),
                local: c.is_local(),
                icon: c.icon().to_owned(),
                prompt_assist: c.kind.prompt_assist(),
                key_optional: !c.kind.requires_auth(),
                auth_modes: vec!["api_key"],
                auth_active: AuthMode::ApiKey,
                account: None,
                id,
            }
        })
        .collect()
}

/// List every provider (built-in + custom) with its capability matrix and key status.
#[tauri::command]
pub async fn ai_list_providers(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProviderInfo>> {
    let store = key_store(&app, &state)?;
    let registry = custom_registry(&app, &state)?;
    let settings = settings_snapshot(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let has = |id: &ProviderId| store.has(id).unwrap_or(false);
        let auth = auth_rows(store.as_ref(), &settings);
        let mut rows = provider_rows(has, store.backend(), &auth);
        match registry.load() {
            Ok(customs) => rows.extend(custom_rows(&customs, has, store.backend())),
            Err(e) => tracing::warn!("custom provider registry unreadable: {e}"),
        }
        rows
    })
    .await
    .map_err(CommandError::from)
}

/// Start forwarding `JobEvent`s to the webview (idempotent).
fn ensure_forwarder(app: &AppHandle, state: &AppState) {
    if state.ai_forwarder_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let mut rx = state.jobs.subscribe();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => emit_job_event(&app, &ev),
                Err(RecvError::Lagged(n)) => tracing::warn!("dropped {n} AI job events (slow UI)"),
                Err(RecvError::Closed) => break,
            }
        }
    });
}

fn emit_job_event(app: &AppHandle, ev: &JobEvent) {
    let topic = format!("{JOB_EVENT_PREFIX}{}", ev.job);
    if let Err(e) = app.emit(&topic, ev) {
        tracing::warn!("emit {topic}: {e}");
    }
    if let Err(e) = app.emit(JOBS_EVENT, ev) {
        tracing::warn!("emit {JOBS_EVENT}: {e}");
    }
}

fn timeout_override(secs: Option<u64>) -> Option<Duration> {
    secs.map(|s| Duration::from_secs(s).clamp(MIN_TIMEOUT, MAX_TIMEOUT))
}

/// Look up a custom registry entry off the async runtime.
async fn custom_entry(registry: Arc<CustomRegistry>, id: &str) -> CommandResult<CustomProvider> {
    let id = id.to_owned();
    let found = tauri::async_runtime::spawn_blocking(move || registry.get(&id)).await??;
    found.ok_or_else(|| {
        CommandError::new(
            "ai_not_configured",
            "that custom provider no longer exists; add it again in AI Providers",
        )
    })
}

/// Resolve credentials and build the provider for `id` (built-in or custom).
async fn resolve_provider(
    app: &AppHandle,
    state: &AppState,
    id: &ProviderId,
) -> CommandResult<SharedProvider> {
    let store = key_store(app, state)?;
    match id {
        ProviderId::Custom(cid) => {
            let cfg = custom_entry(custom_registry(app, state)?, cid).await?;
            let auth = load_key_opt(store, id.clone()).await?;
            if auth.is_none() && cfg.kind.requires_auth() {
                return Err(pf_ai::Error::NotConfigured(id.clone()).into());
            }
            Ok(build_custom_provider(&cfg, auth)?)
        }
        builtin => {
            // Subscription mode (ChatGPT / Grok sign-in) never falls back silently.
            if let Some(p) = subscription_provider(app, state, builtin).await? {
                return Ok(p);
            }
            let key = load_key(store, builtin.clone()).await?;
            // `PF_AI_BASE_URL_*` (dev: scripts/fake-ai-server.mjs) redirects the provider.
            Ok(build_provider_from_env(builtin, AuthMethod::ApiKey(key))?)
        }
    }
}

/// Resolve the provider and enqueue.
async fn submit(
    app: &AppHandle,
    state: &AppState,
    provider: ProviderId,
    kind: JobKind,
    timeout: Option<Duration>,
) -> CommandResult<JobId> {
    let provider = resolve_provider(app, state, &provider).await?;
    ensure_forwarder(app, state);
    let id = state.jobs.submit(JobSpec {
        provider,
        kind,
        timeout,
    });
    tracing::info!(job = %id, "AI job submitted");
    Ok(id)
}

/// Text -> image. JSON args: `{ params: GenerateParams }`.
#[tauri::command]
pub async fn ai_submit_generate(
    app: AppHandle,
    state: State<'_, AppState>,
    params: GenerateParams,
) -> CommandResult<JobId> {
    let provider = params.provider.clone();
    let timeout = timeout_override(params.timeout_secs);
    submit(
        &app,
        &state,
        provider,
        JobKind::Generate(params.into()),
        timeout,
    )
    .await
}

/// Image (+ mask) + prompt -> image. Raw body only: the shared binary frame
/// (`pf_ai::ipc::encode_edit_body`, same layout as `pf_io::frame`):
///
/// ```text
/// u32le header_len | EditParams JSON + "blobs": [len...] | blob0 | blob1 | ...
/// ```
///
/// Blob order: composite image, then the mask iff `params.mask`, then `params.refs`
/// reference images. From JS: `invoke('ai_submit_edit', body /* Uint8Array */)`.
#[tauri::command]
pub async fn ai_submit_edit(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> CommandResult<JobId> {
    let body = raw_body(&request, "ai_submit_edit")?;
    let envelope = decode_edit_body(body)?;
    let provider = envelope.params.provider.clone();
    let timeout = timeout_override(envelope.params.timeout_secs);
    submit(
        &app,
        &state,
        provider,
        JobKind::Edit(envelope.into_request()),
        timeout,
    )
    .await
}

fn raw_body<'a>(request: &'a Request<'_>, command: &str) -> CommandResult<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(CommandError::new(
            "ai_invalid_request",
            format!("{command} expects a raw binary body (see docs/ipc.md), not JSON"),
        )),
    }
}

/// Current status of a job (`{ state: "queued" | "running" | "completed" | "failed" | "cancelled", ... }`).
#[tauri::command]
pub fn ai_job_status(state: State<'_, AppState>, job: JobId) -> CommandResult<JobStatus> {
    state
        .jobs
        .status(&job)
        .ok_or_else(|| CommandError::new("ai_unknown_job", format!("unknown AI job {job}")))
}

/// Cancel a queued or running job. `false` when it was already finished / unknown.
#[tauri::command]
pub fn ai_cancel(state: State<'_, AppState>, job: JobId) -> CommandResult<bool> {
    Ok(state.jobs.cancel(&job))
}

/// Hand the finished images to the webview as one binary frame
/// (`pf_ai::ipc::encode_results`):
///
/// ```text
/// u32le header_len | { "results": [ImageResultMeta...], "blobs": [len...] } | PNG0 | PNG1 | ...
/// ```
///
/// Bytes are moved out of the queue, so a second call for the same job fails with
/// `ai_no_result`.
#[tauri::command]
pub fn ai_take_result(state: State<'_, AppState>, job: JobId) -> CommandResult<Response> {
    let results = state.jobs.take_result(&job).ok_or_else(|| {
        let why = match state.jobs.status(&job) {
            None => "unknown job",
            Some(JobStatus::Queued | JobStatus::Running) => "job has not finished",
            Some(JobStatus::Completed { .. }) => "result was already taken",
            Some(JobStatus::Failed { .. }) => "job failed",
            Some(JobStatus::Cancelled) => "job was cancelled",
        };
        CommandError::new("ai_no_result", format!("no result for AI job {job}: {why}"))
    })?;
    Ok(Response::new(encode_results(&results)?))
}

/// Verify the stored key with the cheapest authenticated call (list models / probe).
#[tauri::command]
pub async fn ai_test_key(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
) -> CommandResult<()> {
    let p = resolve_provider(&app, &state, &provider).await?;
    p.test_key().await?;
    Ok(())
}

// ---------------------------------------------------------------------------------
// Custom providers
// ---------------------------------------------------------------------------------

/// Static description of one custom provider kind, for the "+ Add" menu and the form.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomKindInfo {
    /// Wire name (`openai_compat`, ...).
    pub kind: CustomKind,
    /// Short label.
    pub label: String,
    /// One-line description.
    pub description: String,
    /// Pre-filled base URL.
    pub default_base_url: String,
    /// Install / token help link.
    pub help_url: String,
    /// A secret is mandatory.
    pub requires_auth: bool,
    /// Prompt assist instead of image generation.
    pub prompt_assist: bool,
    /// Capability defaults.
    pub default_capabilities: Capabilities,
}

/// Every custom kind with its defaults.
pub fn kind_infos() -> Vec<CustomKindInfo> {
    CustomKind::ALL
        .into_iter()
        .map(|k| CustomKindInfo {
            kind: k,
            label: k.label().to_owned(),
            description: k.description().to_owned(),
            default_base_url: k.default_base_url().to_owned(),
            help_url: k.help_url().to_owned(),
            requires_auth: k.requires_auth(),
            prompt_assist: k.prompt_assist(),
            default_capabilities: k.default_capabilities(),
        })
        .collect()
}

/// The custom kinds (static data).
#[tauri::command]
pub fn ai_custom_kinds() -> CommandResult<Vec<CustomKindInfo>> {
    Ok(kind_infos())
}

/// All registered custom providers (secrets never included).
#[tauri::command]
pub async fn ai_custom_list(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<CustomProvider>> {
    let registry = custom_registry(&app, &state)?;
    let list = tauri::async_runtime::spawn_blocking(move || registry.load()).await??;
    Ok(list)
}

/// Store the secret for a custom entry (when given) and return whether one is stored.
async fn apply_auth(
    store: Arc<pf_ai::AutoKeyStore>,
    id: &ProviderId,
    auth: Option<String>,
    clear: bool,
) -> CommandResult<bool> {
    let id = id.clone();
    if clear {
        let i = id.clone();
        tauri::async_runtime::spawn_blocking(move || store.delete(&i)).await??;
        return Ok(false);
    }
    match auth.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        Some(raw) => {
            let secret = validate_key(raw)?;
            let i = id.clone();
            tauri::async_runtime::spawn_blocking(move || store.set(&i, &secret)).await??;
            Ok(true)
        }
        None => Ok(tauri::async_runtime::spawn_blocking(move || store.has(&id)).await??),
    }
}

/// Add a custom provider. `auth` (API key / token / `user:pass`) goes to the key store.
#[tauri::command]
pub async fn ai_custom_add(
    app: AppHandle,
    state: State<'_, AppState>,
    mut provider: CustomProvider,
    auth: Option<String>,
) -> CommandResult<Vec<CustomProvider>> {
    provider.validate()?;
    let store = key_store(&app, &state)?;
    let registry = custom_registry(&app, &state)?;
    provider.has_auth = apply_auth(store, &provider.provider_id(), auth, false).await?;
    let list = tauri::async_runtime::spawn_blocking(move || registry.add(provider)).await??;
    Ok(list)
}

/// Update a custom provider. `auth` replaces the stored secret when non-empty;
/// `clear_auth` removes it; otherwise the stored secret is kept.
#[tauri::command]
pub async fn ai_custom_update(
    app: AppHandle,
    state: State<'_, AppState>,
    mut provider: CustomProvider,
    auth: Option<String>,
    clear_auth: Option<bool>,
) -> CommandResult<Vec<CustomProvider>> {
    provider.validate()?;
    let store = key_store(&app, &state)?;
    let registry = custom_registry(&app, &state)?;
    provider.has_auth = apply_auth(
        store,
        &provider.provider_id(),
        auth,
        clear_auth.unwrap_or(false),
    )
    .await?;
    let list = tauri::async_runtime::spawn_blocking(move || registry.update(provider)).await??;
    Ok(list)
}

/// Remove a custom provider and its secret.
#[tauri::command]
pub async fn ai_custom_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<CustomProvider>> {
    let store = key_store(&app, &state)?;
    let registry = custom_registry(&app, &state)?;
    let pid = ProviderId::custom(id.clone());
    if let Err(e) = tauri::async_runtime::spawn_blocking(move || store.delete(&pid)).await? {
        tracing::warn!("could not delete secret for custom:{id}: {e}");
    }
    let list = tauri::async_runtime::spawn_blocking(move || registry.remove(&id)).await??;
    Ok(list)
}

/// Probe an entry *as given* (unsaved form values are fine). `auth` overrides the stored
/// secret for this probe only; when absent the stored one (if any) is used.
#[tauri::command]
pub async fn ai_custom_probe(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: CustomProvider,
    auth: Option<String>,
) -> CommandResult<ProbeResult> {
    provider.validate()?;
    let secret = match auth.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        Some(raw) => Some(SecretString::new(raw)),
        None => load_key_opt(key_store(&app, &state)?, provider.provider_id()).await?,
    };
    Ok(probe_custom(&provider, secret).await?)
}

/// Header of the `ai_prompt_assist` frame.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssistHeader {
    provider: ProviderId,
    #[serde(default)]
    text: String,
}

/// Rewrite a prompt with a vision chat model (Ollama). Raw body: frame with header
/// `{ provider, text }` and at most one blob (a PNG/JPEG of the current composite).
#[tauri::command]
pub async fn ai_prompt_assist(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> CommandResult<String> {
    let body = raw_body(&request, "ai_prompt_assist")?;
    let frame = decode_frame(body)?;
    let header: AssistHeader =
        serde_json::from_value(serde_json::Value::Object(frame.header.clone()))?;
    let image = frame
        .blobs
        .first()
        .filter(|b| !b.is_empty())
        .map(|b| ImageBytes::png(b.to_vec()));
    if header.provider == ProviderId::OpenAi {
        let settings = settings_snapshot(&app, &state)?;
        if auth_pref(&settings, &ProviderId::OpenAi).mode != AuthMode::Subscription {
            return Err(CommandError::new(
                "ai_unsupported",
                "Improve prompt with ChatGPT needs \"ChatGPT subscription\" sign-in (AI Providers)",
            ));
        }
        let session = session_for(&app, &state, &ProviderId::OpenAi).await?;
        let t = session.snapshot().await;
        let model = pf_ai::oauth::openai_siwc::pick_model(&t.models, None).ok_or_else(|| {
            CommandError::new(
                "ai_plan_not_eligible",
                "Your ChatGPT plan lists no models Pixelforge may call",
            )
        })?;
        let cfg = pf_ai::oauth::openai_siwc::SiwcConfig::from_env();
        return Ok(pf_ai::oauth::openai_siwc::prompt_assist(
            &session,
            &cfg,
            &model,
            &header.text,
            image.as_ref(),
        )
        .await?);
    }
    let ProviderId::Custom(cid) = &header.provider else {
        return Err(CommandError::new(
            "ai_unsupported",
            "prompt assist needs a custom provider of kind Ollama, or ChatGPT on a subscription",
        ));
    };
    let cfg = custom_entry(custom_registry(&app, &state)?, cid).await?;
    let auth = load_key_opt(key_store(&app, &state)?, header.provider.clone()).await?;
    Ok(prompt_assist(&cfg, auth, image, &header.text).await?)
}

/// The bundled ComfyUI workflow templates (`{ txt2img, img2img, inpaint }` as JSON text)
/// for the "Load template" buttons in the AI Providers dialog.
#[tauri::command]
pub fn ai_comfy_templates() -> CommandResult<std::collections::HashMap<&'static str, &'static str>>
{
    use pf_ai::providers::custom::comfy::WorkflowKind;
    Ok(std::collections::HashMap::from([
        ("txt2img", WorkflowKind::Txt2Img.template_source()),
        ("img2img", WorkflowKind::Img2Img.template_source()),
        ("inpaint", WorkflowKind::Inpaint.template_source()),
    ]))
}

/// Search the Hugging Face Hub for image models.
#[tauri::command]
pub async fn ai_hub_search(
    query: String,
    pipeline_tag: Option<String>,
    limit: Option<u32>,
) -> CommandResult<Vec<HubModel>> {
    let tag = pipeline_tag.unwrap_or_else(|| "text-to-image".to_owned());
    Ok(hub_search_default(&query, &tag, limit.unwrap_or(20)).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_list_all_three_providers_with_capabilities() {
        let mut auth = HashMap::new();
        auth.insert(
            ProviderId::OpenAi,
            AuthRow {
                modes: vec!["api_key", "subscription"],
                active: AuthMode::Subscription,
                account: Some((Some("me@example.com".into()), None)),
            },
        );
        let rows = provider_rows(|id| *id == ProviderId::XAi, "file", &auth);
        assert_eq!(rows.len(), 3);
        assert!(
            rows[0].prompt_assist,
            "ChatGPT on the plan improves prompts"
        );
        let j0 = serde_json::to_value(&rows[0]).expect("serialize");
        assert_eq!(
            j0["authModes"],
            serde_json::json!(["api_key", "subscription"])
        );
        assert_eq!(j0["authActive"], "subscription");
        assert_eq!(j0["account"]["email"], "me@example.com");
        assert!(!rows[1].prompt_assist);
        assert_eq!(rows[2].auth_modes, vec!["api_key"]);
        assert_eq!(rows[0].id, ProviderId::OpenAi);
        assert_eq!(rows[0].default_model, "gpt-image-2.5-flare");
        assert_eq!(rows[0].edit_model, "gpt-image-2.5-sunburst");
        assert!(rows[0].capabilities.mask_edit);
        assert!(!rows[0].has_key);
        assert!(rows[1].has_key);
        assert_eq!(rows[1].edit_model, "grok-imagine-image-2.0");
        assert!(!rows[2].capabilities.mask_edit);
        assert_eq!(rows[2].key_backend, "file");
        let json = serde_json::to_value(&rows[2]).expect("serialize");
        assert_eq!(json["id"], "gemini");
        assert_eq!(json["name"], "Gemini");
        assert_eq!(json["hasKey"], false);
        assert_eq!(json["kind"], "builtin");
        assert_eq!(json["local"], false);
        assert_eq!(json["capabilities"]["maxRefs"], 14);
    }

    #[test]
    fn custom_rows_carry_kind_locality_and_models() {
        let mut comfy = CustomProvider::new("comfy", "My ComfyUI", CustomKind::ComfyUi);
        comfy.model = "sd_xl.safetensors".into();
        comfy.extra = serde_json::json!({ "models": ["sd_xl.safetensors", "v1-5.ckpt"] });
        let mut hf = CustomProvider::new("hf", "HF", CustomKind::HuggingFace);
        hf.model = "black-forest-labs/FLUX.1-dev".into();
        let ollama = CustomProvider::new("ollama", "Ollama", CustomKind::Ollama);
        let rows = custom_rows(
            &[comfy, hf, ollama],
            |id| id.custom_id() == Some("hf"),
            "keyring",
        );
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].id, ProviderId::custom("comfy"));
        assert_eq!(rows[0].kind, "comfy_ui");
        assert!(rows[0].local && rows[0].key_optional && !rows[0].has_key);
        assert_eq!(rows[0].models, vec!["sd_xl.safetensors", "v1-5.ckpt"]);
        assert!(rows[0].capabilities.mask_edit);
        assert_eq!(rows[1].icon, "hub");
        assert!(rows[1].has_key && !rows[1].key_optional && !rows[1].local);
        assert!(rows[2].prompt_assist && !rows[2].capabilities.generate);
        let json = serde_json::to_value(&rows[0]).expect("serialize");
        assert_eq!(json["id"], "custom:comfy");
        assert_eq!(json["vendor"], "ComfyUI");
        assert_eq!(json["promptAssist"], false);
        assert_eq!(kind_infos().len(), 6);
        assert_eq!(
            serde_json::to_value(&kind_infos()[0]).expect("ser")["kind"],
            "openai_compat"
        );
    }

    #[test]
    fn timeout_override_is_clamped() {
        assert_eq!(timeout_override(None), None);
        assert_eq!(timeout_override(Some(1)), Some(MIN_TIMEOUT));
        assert_eq!(timeout_override(Some(300)), Some(Duration::from_secs(300)));
        assert_eq!(timeout_override(Some(99_999)), Some(MAX_TIMEOUT));
    }
}
