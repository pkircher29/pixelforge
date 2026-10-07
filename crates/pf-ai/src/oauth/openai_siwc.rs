//! OpenAI "Sign in with ChatGPT" (SIWC) for open-source local apps.
//!
//! Every constant here is from OpenAI's docs (docs/ai-research.md section 5, verified
//! 2026-10-06): <https://developers.openai.com/siwc/token-sharing-open-source/sign-in>,
//! `/profiles-and-sessions`, `/models-and-inference`, `/token-reference`,
//! `/errors-and-recovery`, `/preview-limitations`, and the live discovery document
//! <https://auth.openai.com/.well-known/openid-configuration>.
//!
//! * Authorization Code + PKCE (S256) + OIDC; first sign-in uses dynamic registration
//!   (`client_id=dynamic_agent_client`, `agent_name_hint=Pixelforge`) and the callback
//!   carries the issued `client_id` (`oaiapp_...`), which is used for exchange, refresh
//!   and revocation. A stable `ext_agent_host_id` (`urn:uuid:...`) is sent every time.
//! * Plan tokens may only call `POST /v1/responses` with `store:false` + `stream:true`
//!   (no `temperature`, `max_output_tokens`, system messages ...). **Image generation is
//!   listed as an unsupported tool** on the preview-limitations page, so image requests
//!   are refused locally with `ai_plan_not_eligible` unless an explicit live check has
//!   shown the account is allowed (and the server's
//!   `subscription_sharing_unsupported_capability` also maps to `ai_plan_not_eligible`).
//! * Text Responses (used for "Improve prompt") are explicitly allowed.

use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;

use super::{
    format_utc, jwt_claims, now_unix, post_token_form, split_scopes, with_auth_retry,
    CallbackParams, ImageAccess, OAuthSession, OAuthTokens, Pkce, PlanModel, RefreshConfig,
};
use crate::capabilities::capabilities_for;
use crate::error::Error;
use crate::http;
use crate::mask;
use crate::provider::{validate_edit, validate_generate, ImageProvider};
use crate::secret::SecretString;
use crate::types::{
    Capabilities, EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult, ImageSize,
    ProviderId,
};

/// OpenAI's authorization server.
pub const AUTH_BASE: &str = "https://auth.openai.com";
/// ID-token issuer.
pub const ISSUER: &str = "https://auth.openai.com";
/// `authorization_endpoint` path.
pub const AUTHORIZE_PATH: &str = "/api/accounts/authorize";
/// `token_endpoint` path.
pub const TOKEN_PATH: &str = "/api/accounts/oauth/token";
/// `revocation_endpoint` path.
pub const REVOKE_PATH: &str = "/api/accounts/oauth/revoke";
/// `resource` indicator for plan usage.
pub const RESOURCE: &str = "https://api.openai.com/v1";
/// Identity + plan-usage scopes.
pub const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The scope that means "may spend the user's ChatGPT plan".
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
/// Dynamic registration client id for the first sign-in.
pub const DYNAMIC_CLIENT_ID: &str = "dynamic_agent_client";
/// `agent_name_hint` (the app's actual name).
pub const AGENT_NAME: &str = "Pixelforge";
/// Production API.
pub const API_BASE: &str = "https://api.openai.com";
/// Env override for the authorization server (dev: `scripts/fake-openai-auth.mjs`).
pub const AUTH_BASE_ENV: &str = "PF_OPENAI_AUTH_BASE";
/// Env override for the API (shared with the API-key provider).
pub const API_BASE_ENV: &str = "PF_AI_BASE_URL_OPENAI";

/// OpenAI's overview of plan usage for open-source apps.
pub const DOCS_URL: &str = "https://developers.openai.com/siwc/token-sharing-open-source";
/// The page that lists image generation as unsupported.
pub const LIMITATIONS_URL: &str =
    "https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations";
/// Where users manage per-app usage ("Manage usage" per the UI guidelines).
pub const MANAGE_USAGE_URL: &str = "https://chatgpt.com/settings/usage";

/// The message for image requests made with a plan token.
pub const IMAGES_NOT_ELIGIBLE: &str = "Your ChatGPT plan can't generate images through third-party apps — use an API key for images. (OpenAI lists image generation as unavailable for ChatGPT plan usage.)";

/// Instruction for "Improve prompt" (sent as `instructions`: explicit system messages are
/// rejected for plan usage).
const ASSIST_INSTRUCTIONS: &str = "You write prompts for image generation models. Rewrite the user's request into one vivid, specific prompt (max 80 words): subject, style, lighting, composition, colours. When an image is attached it is the current picture: keep its style, lighting and composition. Reply with the prompt only.";

/// Where to talk to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiwcConfig {
    /// Authorization server base.
    pub auth_base: String,
    /// API base (`/v1/models`, `/v1/responses`).
    pub api_base: String,
    /// Expected `iss` of ID tokens.
    pub issuer: String,
}

impl Default for SiwcConfig {
    fn default() -> Self {
        Self {
            auth_base: AUTH_BASE.to_owned(),
            api_base: API_BASE.to_owned(),
            issuer: ISSUER.to_owned(),
        }
    }
}

fn env_url(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_owned())
        .filter(|s| !s.is_empty())
}

impl SiwcConfig {
    /// Production, with `PF_OPENAI_AUTH_BASE` / `PF_AI_BASE_URL_OPENAI` overrides. When
    /// the auth base is overridden the issuer follows it (the fake server signs its own).
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Some(a) = env_url(AUTH_BASE_ENV) {
            cfg.issuer = a.clone();
            cfg.auth_base = a;
        }
        if let Some(b) = env_url(API_BASE_ENV) {
            cfg.api_base = b;
        }
        cfg
    }

    /// Point both at one host (tests).
    pub fn local(base: &str) -> Self {
        let b = base.trim_end_matches('/').to_owned();
        Self {
            auth_base: b.clone(),
            api_base: b.clone(),
            issuer: b,
        }
    }

    /// Token endpoint.
    pub fn token_url(&self) -> String {
        format!("{}{TOKEN_PATH}", self.auth_base)
    }

    /// Refresh descriptor for [`OAuthSession`].
    pub fn refresh_config(&self) -> RefreshConfig {
        RefreshConfig {
            token_url: self.token_url(),
            resource: Some(RESOURCE.to_owned()),
        }
    }
}

/// One authorization attempt (kept in memory until the callback arrives).
#[derive(Debug, Clone)]
pub struct AuthorizeRequest {
    /// URL to open in the browser.
    pub url: String,
    /// CSRF state.
    pub state: String,
    /// OIDC nonce.
    pub nonce: String,
    /// PKCE pair.
    pub pkce: Pkce,
    /// Exact redirect URI (reused for the exchange).
    pub redirect_uri: String,
    /// Client id sent (`dynamic_agent_client` or a saved `oaiapp_...`).
    pub client_id: String,
}

/// Build the authorize URL. `saved_client_id` re-uses an earlier registration (then no
/// `agent_name_hint`, per the docs).
pub fn build_authorize(
    cfg: &SiwcConfig,
    redirect_uri: &str,
    ext_agent_host_id: &str,
    saved_client_id: Option<&str>,
    login_hint: Option<&str>,
) -> Result<AuthorizeRequest, Error> {
    let pkce = Pkce::generate();
    let state = super::random_urlsafe(2);
    let nonce = super::random_urlsafe(2);
    let client_id = saved_client_id
        .filter(|c| !c.is_empty())
        .unwrap_or(DYNAMIC_CLIENT_ID)
        .to_owned();
    let mut url = reqwest::Url::parse(&format!("{}{AUTHORIZE_PATH}", cfg.auth_base))
        .map_err(|e| Error::oauth("ai_oauth_config", format!("bad auth base URL: {e}")))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("client_id", &client_id);
        if client_id == DYNAMIC_CLIENT_ID {
            q.append_pair("agent_name_hint", AGENT_NAME);
        }
        q.append_pair("ext_agent_host_id", ext_agent_host_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("scope", SCOPES)
            .append_pair("resource", RESOURCE)
            .append_pair("state", &state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &pkce.challenge);
        if let Some(hint) = login_hint.filter(|h| !h.is_empty()) {
            q.append_pair("login_hint", hint);
        }
    }
    Ok(AuthorizeRequest {
        url: url.into(),
        state,
        nonce,
        pkce,
        redirect_uri: redirect_uri.to_owned(),
        client_id,
    })
}

/// Validate an ID token received from the token endpoint (issuer, audience, nonce,
/// expiry; see [`super::jwt_claims`] for why the signature is not re-checked).
pub fn validate_id_token(
    cfg: &SiwcConfig,
    id_token: &str,
    client_id: &str,
    nonce: Option<&str>,
    now: u64,
) -> Result<serde_json::Value, Error> {
    let bad = |why: &str| Error::oauth("ai_oauth_id_token", format!("ID token rejected: {why}"));
    let claims = jwt_claims(id_token).ok_or_else(|| bad("not a JWT"))?;
    if claims["iss"].as_str() != Some(cfg.issuer.as_str()) {
        return Err(bad("wrong issuer"));
    }
    let aud_ok = match &claims["aud"] {
        serde_json::Value::String(a) => a == client_id,
        serde_json::Value::Array(list) => list.iter().any(|a| a.as_str() == Some(client_id)),
        _ => false,
    };
    if !aud_ok {
        return Err(bad("audience is not this client"));
    }
    if let Some(n) = nonce {
        if claims["nonce"].as_str() != Some(n) {
            return Err(bad("nonce mismatch"));
        }
    }
    if claims["exp"].as_u64().is_some_and(|exp| exp + 60 < now) {
        return Err(bad("expired"));
    }
    Ok(claims)
}

/// Exchange the authorization code. The returned record has `plan_usage` set from the
/// granted scopes ("keep the sign-in but mark plan usage disabled" when the scope is
/// missing).
pub async fn exchange_code(
    cfg: &SiwcConfig,
    client: &reqwest::Client,
    req: &AuthorizeRequest,
    cb: &CallbackParams,
) -> Result<OAuthTokens, Error> {
    let client_id = match (&cb.client_id, req.client_id.as_str()) {
        (Some(issued), _) => issued.clone(),
        (None, DYNAMIC_CLIENT_ID) => {
            return Err(Error::oauth(
                "ai_oauth_callback",
                "The sign-in response carried no issued client_id.",
            ))
        }
        (None, saved) => saved.to_owned(),
    };
    let token_url = cfg.token_url();
    let resp = post_token_form(
        client,
        &token_url,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id.as_str()),
            ("code", cb.code.as_str()),
            ("code_verifier", req.pkce.verifier.as_str()),
            ("redirect_uri", req.redirect_uri.as_str()),
            ("resource", RESOURCE),
        ],
        false,
    )
    .await?;
    let now = now_unix();
    let mut tokens = OAuthTokens {
        client_id: client_id.clone(),
        ..OAuthTokens::default()
    };
    tokens.apply_response(&resp, now);
    if tokens.scopes.is_empty() {
        if let Some(s) = cb.scope.as_deref() {
            tokens.scopes = split_scopes(s);
        }
    }
    if let Some(id) = resp.id_token.as_deref() {
        let claims = validate_id_token(cfg, id, &client_id, Some(&req.nonce), now)?;
        tokens.apply_identity(&claims);
    }
    tokens.plan_usage = tokens.scopes.iter().any(|s| s == PLAN_SCOPE);
    Ok(tokens)
}

/// Revoke the refresh token (`revocation_endpoint`), retrying with backoff.
pub async fn revoke(
    cfg: &SiwcConfig,
    client: &reqwest::Client,
    tokens: &OAuthTokens,
) -> Result<(), Error> {
    let Some(refresh) = tokens.refresh_token.as_deref() else {
        return Ok(());
    };
    let url = format!("{}{REVOKE_PATH}", cfg.auth_base);
    let mut last = None;
    for attempt in 0..3u32 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(250 << attempt)).await;
        }
        match client
            .post(&url)
            .form(&[
                ("token", refresh),
                ("token_type_hint", "refresh_token"),
                ("client_id", tokens.client_id.as_str()),
            ])
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => return Ok(()),
            Ok(r) => {
                last = Some(Error::Http {
                    status: r.status().as_u16(),
                    body: http::scrub(&r.text().await.unwrap_or_default()),
                })
            }
            Err(e) => last = Some(e.into()),
        }
    }
    Err(last.unwrap_or_else(|| Error::oauth("ai_oauth_revoke", "revocation failed")))
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    models: Vec<ModelEntry>,
    /// API-style fallback (`{ data: [{ id }] }`).
    #[serde(default)]
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    visibility: Option<String>,
}

/// `GET /v1/models` with the plan token: entries with `visibility: "list"`.
pub async fn list_models(
    cfg: &SiwcConfig,
    client: &reqwest::Client,
    token: &SecretString,
) -> Result<Vec<PlanModel>, Error> {
    let resp = client
        .get(format!("{}/v1/models", cfg.api_base))
        .bearer_auth(token.expose())
        .send()
        .await?;
    let status = resp.status();
    let retry = http::parse_retry_after(resp.headers());
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_siwc_error(status.as_u16(), retry, &text));
    }
    let parsed: ModelsResponse = serde_json::from_str(&text)?;
    let list = if parsed.models.is_empty() {
        parsed.data
    } else {
        parsed.models
    };
    Ok(list
        .into_iter()
        .filter(|m| m.visibility.as_deref().is_none_or(|v| v == "list"))
        .filter_map(|m| {
            let slug = m.slug.or(m.id)?;
            Some(PlanModel {
                display_name: m.display_name.unwrap_or_else(|| slug.clone()),
                slug,
            })
        })
        .collect())
}

// ---------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------

fn resets_at_from(v: &serde_json::Value, retry_after: Option<u64>, now: u64) -> Option<u64> {
    let e = &v["error"];
    for key in ["resets_at", "reset_at", "resets_at_unix"] {
        if let Some(t) = e[key].as_u64().or_else(|| v[key].as_u64()) {
            return Some(t);
        }
    }
    for key in ["resets_in_seconds", "retry_after"] {
        if let Some(s) = e[key].as_u64() {
            return Some(now + s);
        }
    }
    retry_after.map(|s| now + s)
}

/// Map a plan-usage error code (documented in "Errors and recovery") to a typed error.
fn map_plan_code(code: &str, message: &str, status: u16, resets_at: Option<u64>) -> Option<Error> {
    let p = ProviderId::OpenAi;
    Some(match code {
        "subscription_sharing_usage_limit_exceeded" => Error::PlanLimit {
            provider: p,
            resets_at,
            message: format!(
                "Your ChatGPT plan's usage limit for Pixelforge is reached{}. Manage it at {MANAGE_USAGE_URL}.",
                resets_at.map(|t| format!("; it resets {}", format_utc(t))).unwrap_or_default()
            ),
        },
        "subscription_sharing_unsupported_capability" => Error::PlanNotEligible {
            provider: p,
            message: IMAGES_NOT_ELIGIBLE.to_owned(),
        },
        "subscription_sharing_user_not_eligible" => Error::PlanNotEligible {
            provider: p,
            message: format!("This ChatGPT account can't use its plan in third-party apps ({message}). Use an API key instead."),
        },
        "subscription_sharing_route_not_supported" | "chatpass_v2_scope_not_authorized" => {
            Error::PlanNotEligible {
                provider: p,
                message: format!("ChatGPT plan usage doesn't cover this request ({code}). Use an API key instead."),
            }
        }
        "subscription_sharing_invalid_user" => Error::Auth(format!("ChatGPT rejected the sign-in: {message}")),
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => {
            Error::Http {
                status: if status >= 500 { status } else { 503 },
                body: format!("ChatGPT plan usage is temporarily unavailable ({code}); try again shortly."),
            }
        }
        _ => return None,
    })
}

/// Map a non-2xx answer from `/v1/models` or `/v1/responses` under a plan token.
pub fn map_siwc_error(status: u16, retry_after: Option<u64>, body: &str) -> Error {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let code = v["error"]["code"]
        .as_str()
        .or_else(|| v["code"].as_str())
        .unwrap_or_default();
    let message = v["error"]["message"].as_str().unwrap_or_default();
    if let Some(e) = map_plan_code(
        code,
        message,
        status,
        resets_at_from(&v, retry_after, now_unix()),
    ) {
        return e;
    }
    match status {
        401 => Error::Auth(format!(
            "ChatGPT rejected the sign-in{}",
            if message.is_empty() {
                String::new()
            } else {
                format!(": {message}")
            }
        )),
        403 => Error::PlanNotEligible {
            provider: ProviderId::OpenAi,
            message: format!(
                "ChatGPT plan usage was refused{}. Use an API key instead.",
                if message.is_empty() {
                    String::new()
                } else {
                    format!(" ({message})")
                }
            ),
        },
        429 => Error::PlanLimit {
            provider: ProviderId::OpenAi,
            resets_at: retry_after.map(|s| now_unix() + s),
            message: format!(
                "ChatGPT is rate-limiting this plan. Manage usage at {MANAGE_USAGE_URL}."
            ),
        },
        _ => http::map_error(&ProviderId::OpenAi, status, retry_after, body),
    }
}

// ---------------------------------------------------------------------------------
// Responses API streaming
// ---------------------------------------------------------------------------------

/// One `image_generation_call` result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamImage {
    /// Base64 image.
    pub b64: String,
    /// Revised prompt, when sent.
    pub revised_prompt: Option<String>,
}

/// What a finished stream produced.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct StreamOutcome {
    /// Concatenated `output_text`.
    pub text: String,
    /// Image results.
    pub images: Vec<StreamImage>,
    /// `response.completed` arrived.
    pub completed: bool,
}

/// Incremental `text/event-stream` parser (`event:` / `data:` lines, blank line ends an
/// event). Returns `(event name, data)` pairs.
#[derive(Debug, Default)]
pub struct SseParser {
    buf: String,
    event: Option<String>,
    data: String,
}

impl SseParser {
    /// Feed bytes; get completed events.
    pub fn push(&mut self, chunk: &str) -> Vec<(Option<String>, String)> {
        self.buf.push_str(chunk);
        let mut out = Vec::new();
        while let Some(nl) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=nl).collect();
            let line = line.trim_end_matches(['\n', '\r']);
            if line.is_empty() {
                if !self.data.is_empty() || self.event.is_some() {
                    out.push((self.event.take(), std::mem::take(&mut self.data)));
                }
            } else if let Some(v) = line.strip_prefix("data:") {
                if !self.data.is_empty() {
                    self.data.push('\n');
                }
                self.data.push_str(v.strip_prefix(' ').unwrap_or(v));
            } else if let Some(v) = line.strip_prefix("event:") {
                self.event = Some(v.trim().to_owned());
            }
        }
        out
    }

    /// Flush a trailing event without a blank line.
    pub fn finish(&mut self) -> Option<(Option<String>, String)> {
        let mut rest = std::mem::take(&mut self.buf);
        if !rest.is_empty() {
            rest.push('\n');
        }
        let _ = self.push(&rest);
        if self.data.is_empty() {
            None
        } else {
            Some((self.event.take(), std::mem::take(&mut self.data)))
        }
    }
}

fn push_image_item(out: &mut StreamOutcome, item: &serde_json::Value) {
    if item["type"].as_str() != Some("image_generation_call") {
        return;
    }
    if let Some(b64) = item["result"].as_str().filter(|s| !s.is_empty()) {
        if out.images.iter().any(|i| i.b64 == b64) {
            return;
        }
        out.images.push(StreamImage {
            b64: b64.to_owned(),
            revised_prompt: item["revised_prompt"].as_str().map(str::to_owned),
        });
    }
}

/// Apply one streamed event (documented Responses streaming shapes).
pub fn apply_event(out: &mut StreamOutcome, event: Option<&str>, data: &str) -> Result<(), Error> {
    if data.trim() == "[DONE]" {
        return Ok(());
    }
    let v: serde_json::Value = serde_json::from_str(data)
        .map_err(|e| Error::InvalidResponse(format!("bad stream event: {e}")))?;
    let kind = v["type"].as_str().or(event).unwrap_or_default();
    match kind {
        "response.output_text.delta" => {
            if let Some(d) = v["delta"].as_str() {
                out.text.push_str(d);
            }
        }
        "response.output_item.done" => push_image_item(out, &v["item"]),
        "response.completed" => {
            if let Some(items) = v["response"]["output"].as_array() {
                for item in items {
                    push_image_item(out, item);
                    if out.text.is_empty() && item["type"].as_str() == Some("message") {
                        if let Some(parts) = item["content"].as_array() {
                            for p in parts {
                                if p["type"].as_str() == Some("output_text") {
                                    out.text.push_str(p["text"].as_str().unwrap_or_default());
                                }
                            }
                        }
                    }
                }
            }
            out.completed = true;
        }
        "response.failed" | "response.incomplete" | "error" => {
            let err = if v["response"]["error"].is_object() {
                &v["response"]["error"]
            } else if v["error"].is_object() {
                &v["error"]
            } else {
                &v
            };
            let code = err["code"].as_str().unwrap_or_default();
            let message = err["message"].as_str().unwrap_or("the response failed");
            let resets = resets_at_from(&serde_json::json!({ "error": err }), None, now_unix());
            return Err(
                map_plan_code(code, message, 400, resets).unwrap_or_else(|| {
                    if code.contains("moderation")
                        || message.to_ascii_lowercase().contains("safety")
                    {
                        Error::Moderation {
                            provider: ProviderId::OpenAi,
                            categories: Vec::new(),
                            message: message.to_owned(),
                        }
                    } else {
                        Error::BadRequest {
                            provider: ProviderId::OpenAi,
                            message: if code.is_empty() {
                                message.to_owned()
                            } else {
                                format!("{message} ({code})")
                            },
                        }
                    }
                }),
            );
        }
        _ => {}
    }
    Ok(())
}

/// `POST /v1/responses` (stream) and fold the events. Successful only after
/// `response.completed`.
pub async fn stream_response(
    cfg: &SiwcConfig,
    client: &reqwest::Client,
    token: &SecretString,
    body: &serde_json::Value,
) -> Result<StreamOutcome, Error> {
    let mut resp = client
        .post(format!("{}/v1/responses", cfg.api_base))
        .bearer_auth(token.expose())
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(body)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let retry = http::parse_retry_after(resp.headers());
        let text = resp.text().await.unwrap_or_default();
        return Err(map_siwc_error(status.as_u16(), retry, &text));
    }
    let mut parser = SseParser::default();
    let mut out = StreamOutcome::default();
    let mut pending = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        pending.extend_from_slice(&chunk);
        // Only hand complete UTF-8 to the parser.
        let valid = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(e) => e.valid_up_to(),
        };
        let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
        pending.drain(..valid);
        for (ev, data) in parser.push(&text) {
            apply_event(&mut out, ev.as_deref(), &data)?;
        }
    }
    if let Some((ev, data)) = parser.finish() {
        apply_event(&mut out, ev.as_deref(), &data)?;
    }
    if !out.completed {
        return Err(Error::InvalidResponse(
            "the stream ended before response.completed".to_owned(),
        ));
    }
    Ok(out)
}

/// Body for a plan-usage request: always `store:false`, `stream:true`, never sampling
/// fields.
pub fn responses_body(
    model: &str,
    content: Vec<serde_json::Value>,
    instructions: Option<&str>,
    tools: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "store": false,
        "stream": true,
        "input": [ { "role": "user", "content": content } ],
    });
    if let Some(i) = instructions {
        body["instructions"] = serde_json::Value::String(i.to_owned());
    }
    if let Some(t) = tools {
        body["tools"] = t;
        body["tool_choice"] = serde_json::json!({ "type": "image_generation" });
    }
    body
}

fn input_image(img: &ImageBytes) -> serde_json::Value {
    serde_json::json!({
        "type": "input_image",
        "image_url": http::data_url(&http::input_mime(img), &img.data),
    })
}

/// The documented verdict, no request sent.
pub fn documented_image_access() -> ImageAccess {
    ImageAccess {
        eligible: false,
        detail: format!("OpenAI's \"Preview limitations\" page lists image generation among the tools that are unavailable with ChatGPT plan usage ({LIMITATIONS_URL}). Use an API key for images; the plan still powers \"Improve prompt\"."),
        source: "docs".to_owned(),
        checked_at: now_unix(),
    }
}

/// "Improve prompt" with the plan (text Responses).
pub async fn prompt_assist(
    session: &OAuthSession,
    cfg: &SiwcConfig,
    model: &str,
    text: &str,
    image: Option<&ImageBytes>,
) -> Result<String, Error> {
    let text = text.trim();
    if text.is_empty() && image.is_none() {
        return Err(Error::InvalidRequest(
            "nothing to improve: type a prompt or open an image".to_owned(),
        ));
    }
    let mut content = vec![serde_json::json!({
        "type": "input_text",
        "text": if text.is_empty() { "Describe this image as a single prompt for an image generation model." } else { text },
    })];
    if let Some(img) = image {
        content.push(input_image(img));
    }
    let body = responses_body(model, content, Some(ASSIST_INSTRUCTIONS), None);
    let out = with_auth_retry(session, |tok| {
        let body = body.clone();
        async move { stream_response(cfg, session.client(), &tok, &body).await }
    })
    .await?;
    let t = out.text.trim().trim_matches('"').trim().to_owned();
    if t.is_empty() {
        return Err(Error::InvalidResponse(
            "ChatGPT returned no text".to_owned(),
        ));
    }
    Ok(t)
}

/// The model to use: the user's pick if the plan lists it, else the first listed.
pub fn pick_model(models: &[PlanModel], wanted: Option<&str>) -> Option<String> {
    if let Some(w) = wanted.filter(|w| !w.is_empty()) {
        if models.iter().any(|m| m.slug == w) {
            return Some(w.to_owned());
        }
    }
    models.first().map(|m| m.slug.clone())
}

/// OpenAI image provider running on the ChatGPT plan through the Responses API
/// `image_generation` tool. Refuses locally with [`Error::PlanNotEligible`] unless
/// `images_allowed` (a live check succeeded for this account).
pub struct SiwcProvider {
    session: Arc<OAuthSession>,
    cfg: SiwcConfig,
    models: Vec<PlanModel>,
    images_allowed: bool,
}

impl SiwcProvider {
    /// Build from a session and its cached model list.
    pub fn new(
        session: Arc<OAuthSession>,
        cfg: SiwcConfig,
        models: Vec<PlanModel>,
        images_allowed: bool,
    ) -> Self {
        Self {
            session,
            cfg,
            models,
            images_allowed,
        }
    }

    fn not_eligible() -> Error {
        Error::PlanNotEligible {
            provider: ProviderId::OpenAi,
            message: IMAGES_NOT_ELIGIBLE.to_owned(),
        }
    }

    fn model(&self, wanted: Option<&str>) -> Result<String, Error> {
        pick_model(&self.models, wanted).ok_or_else(|| Error::PlanNotEligible {
            provider: ProviderId::OpenAi,
            message: "Your ChatGPT plan lists no models Pixelforge may call. Sign in again or use an API key.".to_owned(),
        })
    }

    fn tool(
        size: Option<ImageSize>,
        quality: Option<&str>,
        transparent: bool,
    ) -> serde_json::Value {
        let mut t = serde_json::json!({ "type": "image_generation", "output_format": "png" });
        t["size"] =
            serde_json::Value::String(size.map_or_else(|| "auto".to_owned(), |s| s.to_string()));
        if let Some(q) = quality {
            t["quality"] = serde_json::Value::String(q.to_owned());
        }
        if transparent {
            t["background"] = serde_json::Value::String("transparent".to_owned());
        }
        t
    }

    async fn run(
        &self,
        model: &str,
        body: serde_json::Value,
        n: u8,
    ) -> Result<Vec<ImageResult>, Error> {
        let mut results = Vec::new();
        for _ in 0..n.max(1) {
            let out = with_auth_retry(&self.session, |tok| {
                let body = body.clone();
                async move { stream_response(&self.cfg, self.session.client(), &tok, &body).await }
            })
            .await?;
            if out.images.is_empty() {
                return Err(Error::InvalidResponse(
                    "the response contained no image_generation_call result".to_owned(),
                ));
            }
            for img in out.images {
                let (image, width, height) = http::normalize_to_png(http::b64_decode(&img.b64)?)?;
                results.push(ImageResult {
                    image,
                    width,
                    height,
                    provider: ProviderId::OpenAi,
                    model: model.to_owned(),
                    revised_prompt: img.revised_prompt,
                    cost_usd: Some(0.0),
                });
            }
        }
        Ok(results)
    }
}

#[async_trait]
impl ImageProvider for SiwcProvider {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAi
    }

    fn capabilities(&self) -> Capabilities {
        let mut caps = capabilities_for(&ProviderId::OpenAi);
        caps.models = self.models.iter().map(|m| m.slug.clone()).collect();
        caps.max_variants = caps.max_variants.min(4);
        caps
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        validate_generate(&self.id(), &self.capabilities(), &req)?;
        if !self.images_allowed {
            return Err(Self::not_eligible());
        }
        let model = self.model(req.model.as_deref())?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        let mut content = vec![serde_json::json!({ "type": "input_text", "text": prompt })];
        content.extend(req.reference_images.iter().map(input_image));
        let tools = serde_json::json!([Self::tool(
            req.size,
            req.quality.as_deref(),
            req.transparent
        )]);
        let body = responses_body(&model, content, None, Some(tools));
        self.run(&model, body, req.n).await
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        if !self.images_allowed {
            return Err(Self::not_eligible());
        }
        let model = self.model(req.model.as_deref())?;
        let prompt = http::effective_prompt(&req.prompt, req.negative_prompt.as_deref());
        let mut content = vec![
            serde_json::json!({ "type": "input_text", "text": prompt }),
            input_image(&req.image),
        ];
        content.extend(req.reference_images.iter().map(input_image));
        let mut tool = Self::tool(req.size, req.quality.as_deref(), req.transparent);
        tool["action"] = serde_json::Value::String("edit".to_owned());
        if req.mode == EditMode::Mask {
            let m = req
                .mask
                .as_ref()
                .ok_or_else(|| Error::InvalidRequest("mask edit without a mask".to_owned()))?;
            let (w, h) = http::dimensions(&req.image.data)?;
            // Same alpha=0-is-editable convention as /v1/images/edits.
            let png = mask::to_openai_mask(&m.data, w, h)?;
            tool["input_image_mask"] =
                serde_json::json!({ "image_url": http::data_url("image/png", &png) });
        }
        let body = responses_body(&model, content, None, Some(serde_json::json!([tool])));
        self.run(&model, body, req.n).await
    }

    async fn test_key(&self) -> Result<(), Error> {
        with_auth_retry(&self.session, |tok| async move {
            list_models(&self.cfg, self.session.client(), &tok)
                .await
                .map(|_| ())
        })
        .await
    }
}

/// Opt-in live check: one small `image_generation` request with the plan token. If the
/// account is allowed this **does generate (and bill to the plan) one image**; the UI
/// says so before calling it.
pub async fn check_images_live(
    session: &Arc<OAuthSession>,
    cfg: &SiwcConfig,
    models: &[PlanModel],
) -> Result<ImageAccess, Error> {
    let provider = SiwcProvider::new(Arc::clone(session), cfg.clone(), models.to_vec(), true);
    let req = GenerateRequest {
        prompt: "A plain mid-grey square.".to_owned(),
        size: Some(ImageSize::square(1024)),
        quality: Some("low".to_owned()),
        ..GenerateRequest::default()
    };
    match provider.generate(req).await {
        Ok(_) => Ok(ImageAccess {
            eligible: true,
            detail: "A live test image was generated with your ChatGPT plan, so image requests will use it.".to_owned(),
            source: "live".to_owned(),
            checked_at: now_unix(),
        }),
        Err(Error::PlanNotEligible { message, .. }) => Ok(ImageAccess {
            eligible: false,
            detail: message,
            source: "live".to_owned(),
            checked_at: now_unix(),
        }),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_has_every_documented_parameter() {
        let cfg = SiwcConfig::default();
        let r = build_authorize(
            &cfg,
            "http://127.0.0.1:5555/callback",
            "urn:uuid:host",
            None,
            Some("a@b.c"),
        )
        .expect("url");
        let url = reqwest::Url::parse(&r.url).expect("parse");
        assert_eq!(url.host_str(), Some("auth.openai.com"));
        assert_eq!(url.path(), AUTHORIZE_PATH);
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], DYNAMIC_CLIENT_ID);
        assert_eq!(q["agent_name_hint"], "Pixelforge");
        assert_eq!(q["ext_agent_host_id"], "urn:uuid:host");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555/callback");
        assert_eq!(q["scope"], SCOPES);
        assert_eq!(q["resource"], RESOURCE);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], Pkce::challenge_for(&r.pkce.verifier));
        assert_eq!(q["state"], r.state);
        assert_eq!(q["nonce"], r.nonce);
        assert_eq!(q["login_hint"], "a@b.c");
        // Re-auth with a saved client: no agent_name_hint.
        let r2 = build_authorize(
            &cfg,
            "http://127.0.0.1:1/callback",
            "urn:uuid:host",
            Some("oaiapp_1"),
            None,
        )
        .expect("url");
        assert!(r2.url.contains("client_id=oaiapp_1"));
        assert!(!r2.url.contains("agent_name_hint"));
        assert_ne!(r.state, r2.state);
    }

    fn jwt(claims: serde_json::Value) -> String {
        use base64::Engine as _;
        let e = |v: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v);
        format!(
            "{}.{}.sig",
            e(br#"{"alg":"RS256"}"#),
            e(claims.to_string().as_bytes())
        )
    }

    #[test]
    fn id_token_validation() {
        let cfg = SiwcConfig::default();
        let good = jwt(
            serde_json::json!({ "iss": ISSUER, "aud": "oaiapp_1", "nonce": "N", "exp": 2_000_000_000u64, "email": "a@b.c" }),
        );
        let c = validate_id_token(&cfg, &good, "oaiapp_1", Some("N"), 1_000).expect("valid");
        assert_eq!(c["email"], "a@b.c");
        assert!(validate_id_token(&cfg, &good, "oaiapp_2", Some("N"), 1_000).is_err());
        assert!(validate_id_token(&cfg, &good, "oaiapp_1", Some("X"), 1_000).is_err());
        assert!(validate_id_token(&cfg, &good, "oaiapp_1", Some("N"), 3_000_000_000).is_err());
        let wrong_iss =
            jwt(serde_json::json!({ "iss": "https://evil", "aud": ["oaiapp_1"], "nonce": "N" }));
        assert!(validate_id_token(&cfg, &wrong_iss, "oaiapp_1", Some("N"), 1).is_err());
        assert_eq!(
            validate_id_token(&cfg, "nope", "x", None, 1)
                .expect_err("jwt")
                .code(),
            "ai_oauth_id_token"
        );
    }

    #[test]
    fn plan_error_codes_map_to_typed_errors() {
        let e = map_siwc_error(
            400,
            None,
            r#"{"error":{"code":"subscription_sharing_unsupported_capability","message":"image_generation is not supported"}}"#,
        );
        assert_eq!(e.code(), "ai_plan_not_eligible");
        assert!(e.to_string().contains("use an API key for images"));
        let e = map_siwc_error(
            429,
            None,
            r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"limit","resets_at":1791380000}}"#,
        );
        match &e {
            Error::PlanLimit {
                resets_at, message, ..
            } => {
                assert_eq!(*resets_at, Some(1_791_380_000));
                assert!(message.contains("2026-10-07 13:33 UTC"));
                assert!(message.contains(MANAGE_USAGE_URL));
            }
            other => panic!("expected plan limit, got {other:?}"),
        }
        assert_eq!(e.code(), "ai_plan_limit");
        let e = map_siwc_error(429, Some(30), "{}");
        assert!(matches!(
            e,
            Error::PlanLimit {
                resets_at: Some(_),
                ..
            }
        ));
        assert_eq!(
            map_siwc_error(
                403,
                None,
                r#"{"error":{"code":"subscription_sharing_user_not_eligible"}}"#
            )
            .code(),
            "ai_plan_not_eligible"
        );
        assert_eq!(map_siwc_error(401, None, "{}").code(), "ai_auth");
        assert_eq!(
            map_siwc_error(
                401,
                None,
                r#"{"error":{"code":"subscription_sharing_invalid_user"}}"#
            )
            .code(),
            "ai_auth"
        );
        let e = map_siwc_error(
            503,
            None,
            r#"{"error":{"code":"subscription_sharing_usage_unavailable"}}"#,
        );
        assert!(e.is_retryable());
        assert_eq!(map_siwc_error(500, None, "boom").code(), "ai_http");
    }

    #[test]
    fn sse_parser_handles_split_chunks_and_events() {
        let mut p = SseParser::default();
        assert!(p.push("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",").is_empty());
        let evs = p.push("\"delta\":\"Hi\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n");
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].0.as_deref(), Some("response.output_text.delta"));
        let mut out = StreamOutcome::default();
        for (e, d) in &evs {
            apply_event(&mut out, e.as_deref(), d).expect("ok");
        }
        assert_eq!(out.text, "Hi");
        assert!(out.completed);
        assert!(p.push("data: {\"type\":\"x\"}").is_empty());
        assert!(p.finish().is_some());
    }

    #[test]
    fn stream_image_results_from_documented_shapes() {
        let mut out = StreamOutcome::default();
        apply_event(&mut out, None, r#"{"type":"response.image_generation_call.partial_image","partial_image_b64":"cGFydA=="}"#).expect("partial ignored");
        apply_event(&mut out, None, r#"{"type":"response.output_item.done","item":{"type":"image_generation_call","id":"ig_1","status":"completed","result":"QUJD","revised_prompt":"a cat"}}"#).expect("item");
        apply_event(&mut out, None, r#"{"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"QUJD"},{"type":"image_generation_call","result":"REVG"}]}}"#).expect("completed");
        assert_eq!(out.images.len(), 2, "dedupes the repeated result");
        assert_eq!(out.images[0].revised_prompt.as_deref(), Some("a cat"));
        assert!(out.completed);
        let e = apply_event(&mut out, None, r#"{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"cap"}}}"#).expect_err("failed");
        assert_eq!(e.code(), "ai_plan_limit");
        let e = apply_event(&mut out, None, r#"{"type":"error","code":"subscription_sharing_unsupported_capability","message":"no"}"#).expect_err("err");
        assert_eq!(e.code(), "ai_plan_not_eligible");
        let mut t = StreamOutcome::default();
        apply_event(&mut t, None, r#"{"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"final"}]}]}}"#).expect("ok");
        assert_eq!(t.text, "final");
    }

    #[test]
    fn body_is_plan_compliant() {
        let b = responses_body(
            "gpt-5.5",
            vec![serde_json::json!({"type":"input_text","text":"x"})],
            Some("inst"),
            None,
        );
        assert_eq!(b["store"], false);
        assert_eq!(b["stream"], true);
        assert!(b.get("temperature").is_none() && b.get("max_output_tokens").is_none());
        assert_eq!(b["instructions"], "inst");
        assert_eq!(b["input"][0]["role"], "user");
        let models = vec![
            PlanModel {
                slug: "a".into(),
                display_name: "A".into(),
            },
            PlanModel {
                slug: "b".into(),
                display_name: "B".into(),
            },
        ];
        assert_eq!(pick_model(&models, Some("b")).as_deref(), Some("b"));
        assert_eq!(pick_model(&models, Some("zzz")).as_deref(), Some("a"));
        assert_eq!(pick_model(&[], None), None);
        assert!(!documented_image_access().eligible);
        assert!(documented_image_access().detail.contains(LIMITATIONS_URL));
    }
}
