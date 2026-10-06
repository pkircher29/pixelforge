//! AI commands (`ai_*`). Thin adapters over `pf-ai`: providers, the job queue, raw-bytes
//! IPC. The full contract (argument shapes, wire format, events) is in `docs/ipc.md`.
//!
//! Summary:
//!
//! | command | args | returns |
//! |---|---|---|
//! | `ai_list_providers` | - | `ProviderInfo[]` |
//! | `ai_submit_generate` | `{ params: GenerateParams }` (JSON) | `JobId` (string) |
//! | `ai_submit_edit` | raw body: binary frame (see `pf_ai::ipc`) | `JobId` |
//! | `ai_job_status` | `{ job }` | `JobStatus` |
//! | `ai_cancel` | `{ job }` | `bool` (was it still running / queued) |
//! | `ai_take_result` | `{ job }` | raw body: binary frame (`ArrayBuffer` in JS) |
//! | `ai_test_key` | `{ provider }` | `()` |
//!
//! Events: every `pf_ai::JobEvent` is emitted twice, on `ai://job/<id>` and on the
//! catch-all `ai://jobs` (listen to the latter *before* invoking submit so the `queued`
//! / `started` events of a fast job are not missed).

use std::sync::atomic::Ordering;
use std::time::Duration;

use pf_ai::ipc::{decode_edit_body, encode_results, GenerateParams};
use pf_ai::{
    build_provider_from_env, capabilities_for, AuthMethod, Capabilities, JobEvent, JobId, JobKind,
    JobSpec, JobStatus, KeyStore, ProviderId,
};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::broadcast::error::RecvError;

use crate::commands::settings::{key_store, load_key};
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
    /// Stable id (`open_ai`, `x_ai`, `gemini`).
    pub id: ProviderId,
    /// Short label used in layer names (`ChatGPT`, `Grok`, `Gemini`).
    pub name: String,
    /// Vendor name for settings (`OpenAI`, `xAI`, `Google`).
    pub vendor: String,
    /// What the provider can do.
    pub capabilities: Capabilities,
    /// Whether an API key is present in the key store.
    pub has_key: bool,
    /// Which backend answered (`keyring` / `file`).
    pub key_backend: String,
    /// Model used when the request does not name one (generate).
    pub default_model: String,
    /// Model used for edits when the request does not name one.
    pub edit_model: String,
    /// Every model the UI may offer.
    pub models: Vec<String>,
}

/// Pure builder for [`ai_list_providers`] (unit-testable without Tauri).
pub fn provider_rows(has_key: impl Fn(ProviderId) -> bool, backend: &str) -> Vec<ProviderInfo> {
    ProviderId::ALL
        .into_iter()
        .map(|id| {
            let capabilities = capabilities_for(id);
            let default_model = capabilities.default_model().unwrap_or_default().to_owned();
            let edit_model = match id {
                ProviderId::OpenAi => pf_ai::capabilities::OPENAI_EDIT_MODEL.to_owned(),
                _ => default_model.clone(),
            };
            ProviderInfo {
                id,
                name: id.label().to_owned(),
                vendor: id.vendor().to_owned(),
                has_key: has_key(id),
                key_backend: backend.to_owned(),
                default_model,
                edit_model,
                models: capabilities.models.clone(),
                capabilities,
            }
        })
        .collect()
}

/// List every provider with its capability matrix and whether a key is stored.
#[tauri::command]
pub async fn ai_list_providers(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Vec<ProviderInfo>> {
    let store = key_store(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let has = |id: ProviderId| store.has(id).unwrap_or(false);
        provider_rows(has, store.backend())
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

/// Resolve the key, build the provider and enqueue.
async fn submit(
    app: &AppHandle,
    state: &AppState,
    provider: ProviderId,
    kind: JobKind,
    timeout: Option<Duration>,
) -> CommandResult<JobId> {
    let store = key_store(app, state)?;
    let key = load_key(store, provider).await?;
    // `PF_AI_BASE_URL_*` (dev: scripts/fake-ai-server.mjs) redirects the provider.
    let provider = build_provider_from_env(provider, AuthMethod::ApiKey(key))?;
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
    let provider = params.provider;
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
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => {
            return Err(CommandError::new(
                "ai_invalid_request",
                "ai_submit_edit expects a raw binary body (see docs/ipc.md), not JSON",
            ))
        }
    };
    let envelope = decode_edit_body(body)?;
    let provider = envelope.params.provider;
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

/// Verify the stored key with the cheapest authenticated call (list models).
#[tauri::command]
pub async fn ai_test_key(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
) -> CommandResult<()> {
    let store = key_store(&app, &state)?;
    let key = load_key(store, provider).await?;
    let p = build_provider_from_env(provider, AuthMethod::ApiKey(key))?;
    p.test_key().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_list_all_three_providers_with_capabilities() {
        let rows = provider_rows(|id| id == ProviderId::XAi, "file");
        assert_eq!(rows.len(), 3);
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
        assert_eq!(json["capabilities"]["maxRefs"], 14);
    }

    #[test]
    fn timeout_override_is_clamped() {
        assert_eq!(timeout_override(None), None);
        assert_eq!(timeout_override(Some(1)), Some(MIN_TIMEOUT));
        assert_eq!(timeout_override(Some(300)), Some(Duration::from_secs(300)));
        assert_eq!(timeout_override(Some(99_999)), Some(MAX_TIMEOUT));
    }
}
