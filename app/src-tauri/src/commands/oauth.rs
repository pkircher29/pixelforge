//! Subscription sign-in commands (`ai_oauth_*`, `ai_auth_configure`). See `docs/ipc.md`
//! "Subscription sign-in" and `docs/ai-research.md` section 5.
//!
//! | command | args | returns |
//! |---|---|---|
//! | `ai_oauth_start` | `{ provider }` | `OAuthStart` (browser opened; result arrives on `ai://oauth`) |
//! | `ai_oauth_cancel` | `{ provider }` | `bool` |
//! | `ai_oauth_status` | `{ provider }` | `OAuthStatus` |
//! | `ai_oauth_sign_out` | `{ provider }` | `OAuthStatus` |
//! | `ai_oauth_check_images` | `{ provider, live? }` | `ImageAccess` |
//! | `ai_auth_configure` | `{ provider, mode?, fallbackToKey?, xaiClientId? }` | `OAuthStatus` |
//!
//! Only OpenAI ("Sign in with ChatGPT", loopback PKCE) and xAI (device flow, **only with
//! a client ID issued to Pixelforge**) exist; Gemini answers `ai_oauth_unavailable`.

use std::sync::Arc;

use pf_ai::oauth::openai_siwc::{self, SiwcConfig, SiwcProvider};
use pf_ai::oauth::xai_device::{self, XaiOAuthConfig};
use pf_ai::oauth::{
    delete_tokens, load_tokens, save_tokens, ImageAccess, Loopback, OAuthSession, OAuthTokens,
    PlanFallbackProvider, PlanModel, LOOPBACK_TIMEOUT,
};
use pf_ai::{
    build_provider_from_env, AuthMethod, GenerateRequest, ImageSize, KeyStore, ProviderId,
    SharedProvider,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Notify;

use crate::commands::settings::{key_store, load_key_opt, settings_snapshot, update_settings};
use crate::error::{CommandError, CommandResult};
use crate::state::{AppState, Settings};

/// Event topic for sign-in progress.
pub const OAUTH_EVENT: &str = "ai://oauth";
/// Settings key: per-provider auth preferences.
const AUTH_KEY: &str = "aiAuth";
/// Settings key: xAI client ID issued to Pixelforge.
const XAI_CLIENT_KEY: &str = "xaiOAuthClientId";
/// Settings key: stable SIWC `ext_agent_host_id`.
const HOST_ID_KEY: &str = "siwcHostId";

/// Gemini note (docs/ai-research.md section 3 / 5.3).
const GEMINI_NOTE: &str = "Google AI Pro / Ultra benefits apply only inside Google AI Studio; the Gemini API (API keys or external apps) is billed separately, so there is no subscription sign-in for Gemini.";
/// Gemini source.
const GEMINI_DOCS: &str = "https://ai.google.dev/gemini-api/docs/google-ai-plans";

/// API key or subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    /// BYOK API key (default).
    #[default]
    ApiKey,
    /// Signed-in subscription.
    Subscription,
}

impl AuthMode {
    /// Wire name.
    pub fn as_str(self) -> &'static str {
        match self {
            AuthMode::ApiKey => "api_key",
            AuthMode::Subscription => "subscription",
        }
    }
}

/// Per-provider preference kept in `settings.json` under `aiAuth.<provider>`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthPref {
    /// Which credential requests use.
    pub mode: AuthMode,
    /// Re-send with the API key when the plan's limit is hit (off by default).
    pub fallback_to_key: bool,
}

/// Read `provider`'s preference.
pub fn auth_pref(settings: &Settings, provider: &ProviderId) -> AuthPref {
    settings
        .extra
        .get(AUTH_KEY)
        .and_then(|v| v.get(provider.as_str().as_ref()))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn set_auth_pref(settings: &mut Settings, provider: &ProviderId, pref: AuthPref) {
    let entry = settings
        .extra
        .entry(AUTH_KEY.to_owned())
        .or_insert_with(|| serde_json::json!({}));
    if !entry.is_object() {
        *entry = serde_json::json!({});
    }
    if let Some(map) = entry.as_object_mut() {
        map.insert(
            provider.as_str().into_owned(),
            serde_json::to_value(pref).unwrap_or_default(),
        );
    }
}

/// xAI client ID from Settings (the env var wins, see `XaiOAuthConfig::from_env`).
pub fn settings_xai_client_id(settings: &Settings) -> Option<String> {
    settings
        .extra
        .get(XAI_CLIENT_KEY)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Does `provider` offer subscription sign-in in this build (regardless of config)?
pub fn supports_subscription(provider: &ProviderId) -> bool {
    matches!(provider, ProviderId::OpenAi | ProviderId::XAi)
}

/// Progress event on `ai://oauth`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthEvent {
    /// Provider.
    pub provider: ProviderId,
    /// `waiting` | `signed_in` | `signed_out` | `error`.
    pub state: &'static str,
    /// Account e-mail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Plan name (only where documented).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Error message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Error code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// What `ai_oauth_start` hands back.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStart {
    /// `loopback` (OpenAI) or `device` (xAI).
    pub flow: &'static str,
    /// URL opened in the browser (show it as a fallback link).
    pub auth_url: String,
    /// Device flow: the code to type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_code: Option<String>,
    /// Device flow: where to type it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_uri: Option<String>,
    /// Device flow: lifetime of the code in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
    /// The browser could not be opened automatically.
    pub browser_failed: bool,
}

/// Sign-in state for the dialog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    /// Provider.
    pub provider: ProviderId,
    /// Sign-in can be started in this configuration.
    pub available: bool,
    /// Why not (frank, user-facing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    /// Documentation the reason is based on.
    pub docs_url: String,
    /// `loopback` | `device` | `none`.
    pub flow: &'static str,
    /// Tokens are stored.
    pub signed_in: bool,
    /// A sign-in is in progress.
    pub pending: bool,
    /// Account e-mail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Plan name, only when the vendor documents how to read it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// The plan-usage permission was granted.
    pub plan_usage: bool,
    /// Last image-eligibility verdict.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<ImageAccess>,
    /// Models the plan token may call.
    pub models: Vec<PlanModel>,
    /// Current auth mode.
    pub auth_mode: AuthMode,
    /// API-key fallback on plan limit.
    pub fallback_to_key: bool,
    /// xAI: `env` | `settings` | `none`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id_source: Option<&'static str>,
    /// Usage management page (OpenAI).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manage_url: Option<String>,
}

fn unavailable(provider: &ProviderId) -> CommandError {
    match provider {
        ProviderId::Gemini => CommandError::new("ai_oauth_unavailable", GEMINI_NOTE),
        _ => CommandError::new(
            "ai_oauth_unavailable",
            format!("{provider} has no subscription sign-in"),
        ),
    }
}

fn emit(app: &AppHandle, ev: OAuthEvent) {
    if let Err(e) = app.emit(OAUTH_EVENT, &ev) {
        tracing::warn!("emit {OAUTH_EVENT}: {e}");
    }
}

fn http_client() -> CommandResult<pf_ai::oauth::HttpClient> {
    Ok(pf_ai::oauth::http_client()?)
}

/// Stable `ext_agent_host_id` (`urn:uuid:...`), created and persisted on first use.
fn ensure_host_id(app: &AppHandle, state: &AppState) -> CommandResult<String> {
    let s = settings_snapshot(app, state)?;
    if let Some(id) = s.extra.get(HOST_ID_KEY).and_then(|v| v.as_str()) {
        if id.starts_with("urn:uuid:") {
            return Ok(id.to_owned());
        }
    }
    let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    update_settings(app, state, |s| {
        s.extra.insert(
            HOST_ID_KEY.to_owned(),
            serde_json::Value::String(id.clone()),
        );
    })?;
    Ok(id)
}

async fn read_tokens(
    store: Arc<pf_ai::AutoKeyStore>,
    provider: ProviderId,
) -> CommandResult<Option<OAuthTokens>> {
    Ok(
        tauri::async_runtime::spawn_blocking(move || load_tokens(store.as_ref(), &provider))
            .await??,
    )
}

async fn write_tokens(
    store: Arc<pf_ai::AutoKeyStore>,
    provider: ProviderId,
    tokens: OAuthTokens,
) -> CommandResult<()> {
    Ok(tauri::async_runtime::spawn_blocking(move || {
        save_tokens(store.as_ref(), &provider, &tokens)
    })
    .await??)
}

fn xai_config(app: &AppHandle, state: &AppState) -> CommandResult<XaiOAuthConfig> {
    let s = settings_snapshot(app, state)?;
    Ok(XaiOAuthConfig::from_env(
        settings_xai_client_id(&s).as_deref(),
    ))
}

fn refresh_config(
    app: &AppHandle,
    state: &AppState,
    provider: &ProviderId,
) -> CommandResult<pf_ai::oauth::RefreshConfig> {
    match provider {
        ProviderId::OpenAi => Ok(SiwcConfig::from_env().refresh_config()),
        ProviderId::XAi => Ok(xai_config(app, state)?.refresh_config()),
        other => Err(unavailable(other)),
    }
}

/// The signed-in session for `provider` (cached), or `ai_oauth_signed_out`.
pub(crate) async fn session_for(
    app: &AppHandle,
    state: &AppState,
    provider: &ProviderId,
) -> CommandResult<Arc<OAuthSession>> {
    if let Some(s) = state
        .oauth_sessions
        .lock()
        .map_err(|_| CommandError::poisoned("oauth sessions"))?
        .get(provider)
    {
        return Ok(Arc::clone(s));
    }
    let store = key_store(app, state)?;
    let Some(tokens) = read_tokens(Arc::clone(&store), provider.clone()).await? else {
        return Err(CommandError::new(
            "ai_oauth_signed_out",
            format!(
                "Not signed in to {}: open AI Providers and sign in, or switch {} back to an API key.",
                provider.vendor(),
                provider
            ),
        ));
    };
    let session = OAuthSession::new(
        provider.clone(),
        store as Arc<dyn KeyStore>,
        http_client()?,
        refresh_config(app, state, provider)?,
        tokens,
    );
    state
        .oauth_sessions
        .lock()
        .map_err(|_| CommandError::poisoned("oauth sessions"))?
        .insert(provider.clone(), Arc::clone(&session));
    Ok(session)
}

fn forget_session(state: &AppState, provider: &ProviderId) {
    if let Ok(mut m) = state.oauth_sessions.lock() {
        m.remove(provider);
    }
}

/// Build the subscription provider (wrapped in the API-key fallback when opted in).
/// `None` when `provider` is in API-key mode.
pub(crate) async fn subscription_provider(
    app: &AppHandle,
    state: &AppState,
    provider: &ProviderId,
) -> CommandResult<Option<SharedProvider>> {
    if !supports_subscription(provider) {
        return Ok(None);
    }
    let settings = settings_snapshot(app, state)?;
    let pref = auth_pref(&settings, provider);
    if pref.mode != AuthMode::Subscription {
        return Ok(None);
    }
    let session = session_for(app, state, provider).await?;
    let plan: SharedProvider = match provider {
        ProviderId::OpenAi => {
            let t = session.snapshot().await;
            let images = t.images.as_ref().is_some_and(|i| i.eligible);
            Arc::new(SiwcProvider::new(
                session,
                SiwcConfig::from_env(),
                t.models,
                images,
            ))
        }
        ProviderId::XAi => {
            let cfg = xai_config(app, state)?;
            cfg.require_client_id()?;
            xai_device::build_provider(session, &cfg)
        }
        other => return Err(unavailable(other)),
    };
    if pref.fallback_to_key {
        if let Some(key) = load_key_opt(key_store(app, state)?, provider.clone()).await? {
            let fallback = build_provider_from_env(provider, AuthMethod::ApiKey(key))?;
            return Ok(Some(Arc::new(PlanFallbackProvider::new(plan, fallback))));
        }
    }
    Ok(Some(plan))
}

/// Summary of `provider`'s auth for `ai_list_providers`.
#[derive(Debug, Clone, Default)]
pub struct AuthRow {
    /// Offered modes.
    pub modes: Vec<&'static str>,
    /// Active mode.
    pub active: AuthMode,
    /// Signed-in account.
    pub account: Option<(Option<String>, Option<String>)>,
}

/// Blocking: compute the auth rows for the built-ins (used inside `spawn_blocking`).
pub fn auth_rows(
    store: &dyn KeyStore,
    settings: &Settings,
) -> std::collections::HashMap<ProviderId, AuthRow> {
    ProviderId::BUILTIN
        .into_iter()
        .map(|id| {
            let row = if supports_subscription(&id) {
                let account = load_tokens(store, &id)
                    .ok()
                    .flatten()
                    .map(|t| (t.email, t.plan));
                AuthRow {
                    modes: vec!["api_key", "subscription"],
                    active: auth_pref(settings, &id).mode,
                    account,
                }
            } else {
                AuthRow {
                    modes: vec!["api_key"],
                    ..AuthRow::default()
                }
            };
            (id, row)
        })
        .collect()
}

async fn status(
    app: &AppHandle,
    state: &AppState,
    provider: &ProviderId,
) -> CommandResult<OAuthStatus> {
    let settings = settings_snapshot(app, state)?;
    let pref = auth_pref(&settings, provider);
    let pending = state
        .oauth_pending
        .lock()
        .map_err(|_| CommandError::poisoned("oauth pending"))?
        .contains_key(provider);
    let tokens = if supports_subscription(provider) {
        read_tokens(key_store(app, state)?, provider.clone()).await?
    } else {
        None
    };
    let (available, reason, docs, flow, source, manage) = match provider {
        ProviderId::OpenAi => (
            true,
            None,
            openai_siwc::DOCS_URL.to_owned(),
            "loopback",
            None,
            Some(openai_siwc::MANAGE_USAGE_URL.to_owned()),
        ),
        ProviderId::XAi => {
            let cfg = xai_config(app, state)?;
            let src =
                XaiOAuthConfig::client_id_source(settings_xai_client_id(&settings).as_deref());
            let reason = cfg.require_client_id().err().map(|e| e.to_string());
            (
                reason.is_none(),
                reason,
                xai_device::DISCOVERY_URL.to_owned(),
                "device",
                Some(src),
                None,
            )
        }
        _ => (
            false,
            Some(GEMINI_NOTE.to_owned()),
            GEMINI_DOCS.to_owned(),
            "none",
            None,
            None,
        ),
    };
    Ok(OAuthStatus {
        provider: provider.clone(),
        available,
        unavailable_reason: reason,
        docs_url: docs,
        flow,
        signed_in: tokens.is_some(),
        pending,
        email: tokens.as_ref().and_then(|t| t.email.clone()),
        plan: tokens.as_ref().and_then(|t| t.plan.clone()),
        plan_usage: tokens.as_ref().is_some_and(|t| t.plan_usage),
        images: tokens.as_ref().and_then(|t| t.images.clone()),
        models: tokens.map(|t| t.models).unwrap_or_default(),
        auth_mode: pref.mode,
        fallback_to_key: pref.fallback_to_key,
        client_id_source: source,
        manage_url: manage,
    })
}

fn open_browser(app: &AppHandle, url: &str) -> bool {
    match app.opener().open_url(url, None::<&str>) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!("could not open the browser for sign-in: {e}");
            false
        }
    }
}

fn register_pending(state: &AppState, provider: &ProviderId) -> CommandResult<Arc<Notify>> {
    let mut map = state
        .oauth_pending
        .lock()
        .map_err(|_| CommandError::poisoned("oauth pending"))?;
    if let Some(old) = map.remove(provider) {
        old.notify_one();
    }
    let cancel = Arc::new(Notify::new());
    map.insert(provider.clone(), Arc::clone(&cancel));
    Ok(cancel)
}

fn clear_pending(app: &AppHandle, provider: &ProviderId, cancel: &Arc<Notify>) {
    use tauri::Manager;
    let state = app.state::<AppState>();
    if let Ok(mut map) = state.oauth_pending.lock() {
        if map.get(provider).is_some_and(|c| Arc::ptr_eq(c, cancel)) {
            map.remove(provider);
        }
    };
}

/// Finish a sign-in in the background: store tokens, switch to subscription mode, emit.
async fn complete(
    app: AppHandle,
    provider: ProviderId,
    cancel: Arc<Notify>,
    result: Result<OAuthTokens, pf_ai::Error>,
) {
    use tauri::Manager;
    let state = app.state::<AppState>();
    clear_pending(&app, &provider, &cancel);
    let outcome: CommandResult<OAuthTokens> = async {
        let tokens = result?;
        write_tokens(key_store(&app, &state)?, provider.clone(), tokens.clone()).await?;
        forget_session(&state, &provider);
        update_settings(&app, &state, |s| {
            let mut pref = auth_pref(s, &provider);
            pref.mode = AuthMode::Subscription;
            set_auth_pref(s, &provider, pref);
        })?;
        Ok(tokens)
    }
    .await;
    match outcome {
        Ok(t) => {
            tracing::info!(provider = %provider, "subscription sign-in complete");
            emit(
                &app,
                OAuthEvent {
                    provider,
                    state: "signed_in",
                    email: t.email,
                    plan: t.plan,
                    error: None,
                    code: None,
                },
            );
        }
        Err(e) => {
            if e.code != "ai_oauth_cancelled" {
                tracing::warn!(provider = %provider, "sign-in failed: {e}");
            }
            emit(
                &app,
                OAuthEvent {
                    provider,
                    state: "error",
                    email: None,
                    plan: None,
                    error: Some(e.message),
                    code: Some(e.code),
                },
            );
        }
    }
}

/// Start a sign-in. Opens the browser; the outcome arrives as an `ai://oauth` event.
#[tauri::command]
pub async fn ai_oauth_start(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
) -> CommandResult<OAuthStart> {
    match &provider {
        ProviderId::OpenAi => {
            let cfg = SiwcConfig::from_env();
            let host_id = ensure_host_id(&app, &state)?;
            let saved = read_tokens(key_store(&app, &state)?, provider.clone()).await?;
            let lb = Loopback::bind().await?;
            let req = openai_siwc::build_authorize(
                &cfg,
                &lb.redirect_uri(),
                &host_id,
                saved.as_ref().map(|t| t.client_id.as_str()),
                saved.as_ref().and_then(|t| t.email.as_deref()),
            )?;
            let cancel = register_pending(&state, &provider)?;
            emit(
                &app,
                OAuthEvent {
                    provider: provider.clone(),
                    state: "waiting",
                    email: None,
                    plan: None,
                    error: None,
                    code: None,
                },
            );
            let browser_failed = !open_browser(&app, &req.url);
            let url = req.url.clone();
            let app2 = app.clone();
            let p = provider.clone();
            tauri::async_runtime::spawn(async move {
                let result = async {
                    let client = http_client()
                        .map_err(|e| pf_ai::Error::oauth("ai_oauth_exchange", e.message))?;
                    let cb = lb
                        .wait(&req.state, LOOPBACK_TIMEOUT, Arc::clone(&cancel))
                        .await?;
                    let mut tokens = openai_siwc::exchange_code(&cfg, &client, &req, &cb).await?;
                    if tokens.plan_usage {
                        let token = pf_ai::SecretString::new(tokens.access_token.clone());
                        match openai_siwc::list_models(&cfg, &client, &token).await {
                            Ok(m) => tokens.models = m,
                            Err(e) => tracing::warn!("plan list-models failed: {e}"),
                        }
                    }
                    tokens.images = Some(openai_siwc::documented_image_access());
                    Ok(tokens)
                }
                .await;
                complete(app2, p, cancel, result).await;
            });
            Ok(OAuthStart {
                flow: "loopback",
                auth_url: url,
                browser_failed,
                ..OAuthStart::default()
            })
        }
        ProviderId::XAi => {
            let cfg = xai_config(&app, &state)?;
            cfg.require_client_id()?;
            let client = http_client()?;
            let dc = xai_device::start(&cfg, &client).await?;
            let cancel = register_pending(&state, &provider)?;
            emit(
                &app,
                OAuthEvent {
                    provider: provider.clone(),
                    state: "waiting",
                    email: None,
                    plan: None,
                    error: None,
                    code: None,
                },
            );
            let url = dc
                .verification_uri_complete
                .clone()
                .unwrap_or_else(|| dc.verification_uri.clone());
            let browser_failed = !open_browser(&app, &url);
            let app2 = app.clone();
            let p = provider.clone();
            let dc2 = dc.clone();
            tauri::async_runtime::spawn(async move {
                let result = xai_device::finish(&cfg, &client, &dc2, Arc::clone(&cancel)).await;
                complete(app2, p, cancel, result).await;
            });
            Ok(OAuthStart {
                flow: "device",
                auth_url: url,
                user_code: Some(dc.user_code),
                verification_uri: Some(dc.verification_uri),
                expires_in: dc.expires_in,
                browser_failed,
            })
        }
        other => Err(unavailable(other)),
    }
}

/// Cancel a sign-in in progress. `false` when none was running.
#[tauri::command]
pub fn ai_oauth_cancel(state: State<'_, AppState>, provider: ProviderId) -> CommandResult<bool> {
    let cancel = state
        .oauth_pending
        .lock()
        .map_err(|_| CommandError::poisoned("oauth pending"))?
        .remove(&provider);
    Ok(match cancel {
        Some(c) => {
            c.notify_one();
            true
        }
        None => false,
    })
}

/// Current sign-in state (no network).
#[tauri::command]
pub async fn ai_oauth_status(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
) -> CommandResult<OAuthStatus> {
    status(&app, &state, &provider).await
}

/// Sign out: revoke (best effort, as documented) and delete the stored tokens.
#[tauri::command]
pub async fn ai_oauth_sign_out(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
) -> CommandResult<OAuthStatus> {
    if !supports_subscription(&provider) {
        return Err(unavailable(&provider));
    }
    forget_session(&state, &provider);
    let store = key_store(&app, &state)?;
    if let Some(t) = read_tokens(Arc::clone(&store), provider.clone()).await? {
        let client = http_client()?;
        let revoked = match provider {
            ProviderId::OpenAi => openai_siwc::revoke(&SiwcConfig::from_env(), &client, &t).await,
            _ => xai_device::revoke(&xai_config(&app, &state)?, &client, &t).await,
        };
        if let Err(e) = revoked {
            tracing::warn!(provider = %provider, "token revocation failed (deleting locally anyway): {e}");
        }
    }
    let p = provider.clone();
    tauri::async_runtime::spawn_blocking(move || delete_tokens(store.as_ref(), &p)).await??;
    emit(
        &app,
        OAuthEvent {
            provider: provider.clone(),
            state: "signed_out",
            email: None,
            plan: None,
            error: None,
            code: None,
        },
    );
    status(&app, &state, &provider).await
}

/// Image eligibility. Without `live` this is the documented verdict (no request). With
/// `live: true` one small image request is made with the plan token; if the plan allows
/// it, that **generates one image billed to the plan** (the UI says so first).
#[tauri::command]
pub async fn ai_oauth_check_images(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
    live: Option<bool>,
) -> CommandResult<ImageAccess> {
    let session = session_for(&app, &state, &provider).await?;
    let live = live.unwrap_or(false);
    let access = match (&provider, live) {
        (ProviderId::OpenAi, false) => openai_siwc::documented_image_access(),
        (ProviderId::OpenAi, true) => {
            let t = session.snapshot().await;
            openai_siwc::check_images_live(&session, &SiwcConfig::from_env(), &t.models).await?
        }
        (ProviderId::XAi, false) => ImageAccess {
            eligible: false,
            detail: "docs.x.ai does not document whether subscription tokens may call Grok Imagine (partner apps such as Hermes Agent use them for images). Run the live check to find out; it uses one image from your plan.".to_owned(),
            source: "unknown".to_owned(),
            checked_at: pf_ai::oauth::now_unix(),
        },
        (ProviderId::XAi, true) => {
            let cfg = xai_config(&app, &state)?;
            let p = xai_device::build_provider(Arc::clone(&session), &cfg);
            let req = GenerateRequest { prompt: "A plain mid-grey square.".to_owned(), size: Some(ImageSize::square(1024)), ..GenerateRequest::default() };
            match p.generate(req).await {
                Ok(_) => ImageAccess { eligible: true, detail: "A live test image was generated with your xAI subscription.".to_owned(), source: "live".to_owned(), checked_at: pf_ai::oauth::now_unix() },
                Err(pf_ai::Error::PlanNotEligible { message, .. }) => ImageAccess { eligible: false, detail: message, source: "live".to_owned(), checked_at: pf_ai::oauth::now_unix() },
                Err(e) => return Err(e.into()),
            }
        }
        (other, _) => return Err(unavailable(other)),
    };
    let a = access.clone();
    session.update(move |t| t.images = Some(a)).await?;
    Ok(access)
}

/// Change the auth mode, the plan-limit fallback, or the xAI client ID.
#[tauri::command]
pub async fn ai_auth_configure(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: ProviderId,
    mode: Option<AuthMode>,
    fallback_to_key: Option<bool>,
    xai_client_id: Option<String>,
) -> CommandResult<OAuthStatus> {
    if !supports_subscription(&provider) && mode == Some(AuthMode::Subscription) {
        return Err(unavailable(&provider));
    }
    update_settings(&app, &state, |s| {
        let mut pref = auth_pref(s, &provider);
        if let Some(m) = mode {
            pref.mode = m;
        }
        if let Some(f) = fallback_to_key {
            pref.fallback_to_key = f;
        }
        set_auth_pref(s, &provider, pref);
        if let Some(id) = &xai_client_id {
            let id = id.trim();
            if id.is_empty() {
                s.extra.remove(XAI_CLIENT_KEY);
            } else {
                s.extra.insert(
                    XAI_CLIENT_KEY.to_owned(),
                    serde_json::Value::String(id.to_owned()),
                );
            }
        }
    })?;
    if xai_client_id.is_some() {
        forget_session(&state, &ProviderId::XAi);
    }
    status(&app, &state, &provider).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_prefs_round_trip_through_settings_extra() {
        let mut s = Settings::default();
        assert_eq!(auth_pref(&s, &ProviderId::OpenAi), AuthPref::default());
        set_auth_pref(
            &mut s,
            &ProviderId::OpenAi,
            AuthPref {
                mode: AuthMode::Subscription,
                fallback_to_key: true,
            },
        );
        let json = serde_json::to_value(&s).expect("ser");
        assert_eq!(json["aiAuth"]["open_ai"]["mode"], "subscription");
        assert_eq!(json["aiAuth"]["open_ai"]["fallbackToKey"], true);
        let back: Settings = serde_json::from_value(json).expect("de");
        assert_eq!(
            auth_pref(&back, &ProviderId::OpenAi).mode,
            AuthMode::Subscription
        );
        assert_eq!(auth_pref(&back, &ProviderId::XAi).mode, AuthMode::ApiKey);
        assert!(supports_subscription(&ProviderId::XAi));
        assert!(!supports_subscription(&ProviderId::Gemini));
        assert_eq!(settings_xai_client_id(&back), None);
    }

    #[test]
    fn auth_rows_report_modes_and_accounts() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = pf_ai::FileStore::new(dir.path());
        let t = OAuthTokens {
            access_token: "a".into(),
            email: Some("me@x.y".into()),
            ..OAuthTokens::default()
        };
        save_tokens(&store, &ProviderId::OpenAi, &t).expect("save");
        let mut s = Settings::default();
        set_auth_pref(
            &mut s,
            &ProviderId::OpenAi,
            AuthPref {
                mode: AuthMode::Subscription,
                fallback_to_key: false,
            },
        );
        let rows = auth_rows(&store, &s);
        assert_eq!(
            rows[&ProviderId::OpenAi].modes,
            vec!["api_key", "subscription"]
        );
        assert_eq!(rows[&ProviderId::OpenAi].active, AuthMode::Subscription);
        assert_eq!(
            rows[&ProviderId::OpenAi]
                .account
                .as_ref()
                .and_then(|a| a.0.clone())
                .as_deref(),
            Some("me@x.y")
        );
        assert!(rows[&ProviderId::XAi].account.is_none());
        assert_eq!(rows[&ProviderId::Gemini].modes, vec!["api_key"]);
    }
}
