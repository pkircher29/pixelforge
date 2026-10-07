//! Subscription sign-in ("use my existing plan instead of an API key").
//!
//! Only **officially documented** flows live here (docs/ai-research.md section 5):
//!
//! * [`openai_siwc`]: OpenAI "Sign in with ChatGPT" for open-source local apps:
//!   Authorization Code + PKCE (S256) + OIDC, dynamic client registration
//!   (`client_id=dynamic_agent_client`), loopback redirect `http://127.0.0.1:<port>/callback`.
//! * [`xai_device`]: xAI's RFC 8628 device flow against the endpoints published in
//!   `https://auth.x.ai/.well-known/openid-configuration`, **with a client ID issued to
//!   Pixelforge by xAI and supplied by configuration only**. Pixelforge never ships or
//!   borrows another product's client ID; without one the flow reports
//!   `ai_oauth_unavailable`.
//!
//! Shared pieces: PKCE / state / nonce generation, the one-shot loopback listener, the
//! token record kept in the key store (`oauth:<provider>`), [`OAuthSession`] (serialised
//! refresh before expiry and once after a 401), the device-code poller, and two provider
//! wrappers ([`BearerOAuthProvider`], [`PlanFallbackProvider`]).

pub mod openai_siwc;
pub mod xai_device;

use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

use crate::error::Error;
use crate::keystore::KeyStore;
use crate::provider::ImageProvider;
use crate::providers::SharedProvider;
use crate::secret::SecretString;
use crate::types::{
    AuthMethod, Capabilities, EditRequest, GenerateRequest, ImageResult, ProviderId,
};

/// Key-store account prefix for token records (`oauth:open_ai`, `oauth:x_ai`).
pub const ACCOUNT_PREFIX: &str = "oauth:";
/// Refresh the access token this long before it expires.
pub const REFRESH_SKEW_SECS: u64 = 120;
/// How long the loopback listener waits for the browser (5 minutes).
pub const LOOPBACK_TIMEOUT: Duration = Duration::from_secs(300);
/// Longest HTTP request head the loopback listener reads.
const MAX_REQUEST_HEAD: usize = 16 * 1024;

/// Re-export so the Tauri layer needs no direct `reqwest` dependency.
pub type HttpClient = reqwest::Client;

/// The shared HTTP client (same user agent / timeouts as the providers).
pub fn http_client() -> Result<reqwest::Client, Error> {
    crate::http::client()
}

/// Key-store account holding `provider`'s token record.
pub fn account_name(provider: &ProviderId) -> String {
    format!("{ACCOUNT_PREFIX}{}", provider.as_str())
}

/// Seconds since the Unix epoch.
pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `n * 16` random bytes (v4 UUIDs come from the OS CSPRNG via `getrandom`), base64url
/// without padding.
pub fn random_urlsafe(n_uuid: usize) -> String {
    let mut bytes = Vec::with_capacity(n_uuid * 16);
    for _ in 0..n_uuid.max(1) {
        bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    b64url(&bytes)
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// RFC 7636 PKCE pair (S256).
#[derive(Clone)]
pub struct Pkce {
    /// High-entropy verifier (43-128 chars of the unreserved set).
    pub verifier: String,
    /// `BASE64URL(SHA256(verifier))`, no padding.
    pub challenge: String,
}

impl fmt::Debug for Pkce {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Pkce")
            .field("verifier", &"[REDACTED]")
            .field("challenge", &self.challenge)
            .finish()
    }
}

impl Pkce {
    /// Fresh pair: 64 random bytes -> 86-char verifier.
    pub fn generate() -> Self {
        let verifier = random_urlsafe(4);
        let challenge = Self::challenge_for(&verifier);
        Self {
            verifier,
            challenge,
        }
    }

    /// S256 challenge of `verifier`.
    pub fn challenge_for(verifier: &str) -> String {
        b64url(&Sha256::digest(verifier.as_bytes()))
    }
}

/// A model the plan token may call (OpenAI's list-models with a plan token).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanModel {
    /// Value for the `model` request field.
    pub slug: String,
    /// Label for the UI.
    pub display_name: String,
}

/// Result of an image-eligibility check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAccess {
    /// The plan token may generate images through Pixelforge.
    pub eligible: bool,
    /// Human-readable explanation (with the documentation it is based on).
    pub detail: String,
    /// `docs` (from the vendor's documentation, no request sent) or `live` (an actual
    /// request was made with the plan token).
    pub source: String,
    /// When the check ran (Unix seconds).
    pub checked_at: u64,
}

/// What Pixelforge keeps per signed-in provider (JSON in the key store, never on IPC).
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokens {
    /// Bearer token for API calls.
    pub access_token: String,
    /// Refresh token (rotates on every refresh where the vendor rotates it).
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// OIDC ID token from the last code exchange / refresh.
    #[serde(default)]
    pub id_token: Option<String>,
    /// Unix seconds when `access_token` expires.
    pub expires_at: u64,
    /// The client ID the tokens were issued to (OpenAI: the dynamically issued
    /// `oaiapp_...`; xAI: the configured Pixelforge client ID).
    pub client_id: String,
    /// Granted scopes.
    #[serde(default)]
    pub scopes: Vec<String>,
    /// Account e-mail from the ID token / userinfo, when present.
    #[serde(default)]
    pub email: Option<String>,
    /// Subscription plan name, only when the vendor documents a way to read it.
    #[serde(default)]
    pub plan: Option<String>,
    /// OIDC subject.
    #[serde(default)]
    pub subject: Option<String>,
    /// The plan-usage scope was granted (OpenAI `chatgpt.tokens.use.direct`).
    #[serde(default)]
    pub plan_usage: bool,
    /// Last image-eligibility verdict.
    #[serde(default)]
    pub images: Option<ImageAccess>,
    /// Models the plan token may call (cached at sign-in / status).
    #[serde(default)]
    pub models: Vec<PlanModel>,
    /// When the record was written (Unix seconds).
    #[serde(default)]
    pub saved_at: u64,
}

impl fmt::Debug for OAuthTokens {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OAuthTokens")
            .field("access_token", &"[REDACTED]")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field("id_token", &self.id_token.as_ref().map(|_| "[REDACTED]"))
            .field("expires_at", &self.expires_at)
            .field("client_id", &self.client_id)
            .field("scopes", &self.scopes)
            .field("email", &self.email)
            .field("plan", &self.plan)
            .field("plan_usage", &self.plan_usage)
            .field("images", &self.images)
            .finish()
    }
}

impl OAuthTokens {
    /// `true` when the access token expires within [`REFRESH_SKEW_SECS`] of `now`.
    pub fn expires_soon(&self, now: u64) -> bool {
        self.expires_at <= now.saturating_add(REFRESH_SKEW_SECS)
    }

    /// As a provider credential.
    pub fn auth_method(&self) -> AuthMethod {
        AuthMethod::OAuth {
            access: SecretString::new(self.access_token.clone()),
            refresh: self.refresh_token.clone().map(SecretString::new),
            expires_at: self.expires_at,
        }
    }

    /// Fill identity fields from ID-token claims.
    pub fn apply_identity(&mut self, claims: &serde_json::Value) {
        if let Some(email) = claims["email"].as_str().filter(|e| !e.is_empty()) {
            self.email = Some(email.to_owned());
        }
        if let Some(sub) = claims["sub"].as_str() {
            self.subject = Some(sub.to_owned());
        }
    }

    /// Merge a token-endpoint response (code exchange or refresh).
    pub fn apply_response(&mut self, resp: &TokenResponse, now: u64) {
        self.access_token = resp.access_token.clone();
        if let Some(r) = resp.refresh_token.as_ref().filter(|r| !r.is_empty()) {
            self.refresh_token = Some(r.clone());
        }
        if let Some(id) = resp.id_token.as_ref().filter(|r| !r.is_empty()) {
            self.id_token = Some(id.clone());
        }
        self.expires_at = now.saturating_add(resp.expires_in.unwrap_or(3600));
        if let Some(scope) = resp.scope.as_deref().filter(|s| !s.trim().is_empty()) {
            self.scopes = split_scopes(scope);
        }
        self.saved_at = now;
    }
}

/// `"a b+c"` -> `["a", "b", "c"]` (query strings encode spaces as `+`).
pub fn split_scopes(scope: &str) -> Vec<String> {
    let mut v: Vec<String> = scope
        .split(|c: char| c.is_whitespace() || c == '+')
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    v.sort();
    v.dedup();
    v
}

/// Read `provider`'s token record (`None` when signed out).
pub fn load_tokens(
    store: &dyn KeyStore,
    provider: &ProviderId,
) -> Result<Option<OAuthTokens>, Error> {
    let Some(raw) = store.get_account(&account_name(provider))? else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }
    match serde_json::from_str::<OAuthTokens>(raw.expose()) {
        Ok(t) if !t.access_token.is_empty() => Ok(Some(t)),
        Ok(_) => Ok(None),
        Err(e) => {
            tracing::warn!("ignoring unreadable token record for {provider}: {e}");
            Ok(None)
        }
    }
}

/// Write `provider`'s token record.
pub fn save_tokens(
    store: &dyn KeyStore,
    provider: &ProviderId,
    tokens: &OAuthTokens,
) -> Result<(), Error> {
    let json = serde_json::to_string(tokens)?;
    store.set_account(&account_name(provider), &SecretString::new(json))
}

/// Remove `provider`'s token record.
pub fn delete_tokens(store: &dyn KeyStore, provider: &ProviderId) -> Result<(), Error> {
    store.delete_account(&account_name(provider))
}

// ---------------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------------

/// RFC 6749 section 5.1 token response.
#[derive(Clone, Deserialize)]
pub struct TokenResponse {
    /// Access token.
    pub access_token: String,
    /// Refresh token, when issued / rotated.
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// OIDC ID token.
    #[serde(default)]
    pub id_token: Option<String>,
    /// Lifetime in seconds.
    #[serde(default)]
    pub expires_in: Option<u64>,
    /// Granted scopes (space separated).
    #[serde(default)]
    pub scope: Option<String>,
}

impl fmt::Debug for TokenResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TokenResponse")
            .field("expires_in", &self.expires_in)
            .field("scope", &self.scope)
            .finish_non_exhaustive()
    }
}

/// RFC 6749 section 5.2 error body.
#[derive(Debug, Default, Deserialize)]
struct OAuthErrorBody {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// Refresh-token errors after which the session is unusable (OpenAI "Errors and
/// recovery"; RFC 6749 `invalid_grant`).
const UNUSABLE_REFRESH: [&str; 6] = [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
];

/// Map a token-endpoint failure to a typed error.
pub(crate) fn map_token_error(status: u16, body: &str, refreshing: bool) -> Error {
    let parsed: OAuthErrorBody = serde_json::from_str(body).unwrap_or_default();
    let code = parsed.error.unwrap_or_default();
    let detail = parsed
        .error_description
        .unwrap_or_else(|| crate::http::scrub(crate::http::truncate(body, 300)));
    if refreshing && UNUSABLE_REFRESH.contains(&code.as_str()) {
        return Error::oauth(
            "ai_oauth_reauth",
            format!("Your sign-in expired or was revoked ({code}). Sign in again."),
        );
    }
    match code.as_str() {
        "invalid_client" | "unauthorized_client" => Error::oauth(
            "ai_oauth_client",
            format!("The OAuth client was rejected ({code}): {detail}"),
        ),
        "access_denied" => Error::oauth("ai_oauth_denied", "Sign-in was declined."),
        "expired_token" => Error::oauth(
            "ai_oauth_timeout",
            "The sign-in code expired before it was approved. Start again.",
        ),
        _ => Error::oauth(
            "ai_oauth_exchange",
            format!(
                "Token request failed (HTTP {status}{}): {detail}",
                if code.is_empty() {
                    String::new()
                } else {
                    format!(", {code}")
                }
            ),
        ),
    }
}

/// POST an `application/x-www-form-urlencoded` body to a token endpoint.
pub(crate) async fn post_token_form(
    client: &reqwest::Client,
    url: &str,
    form: &[(&str, &str)],
    refreshing: bool,
) -> Result<TokenResponse, Error> {
    let resp = client
        .post(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(form)
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_token_error(status.as_u16(), &text, refreshing));
    }
    serde_json::from_str(&text).map_err(|e| {
        Error::oauth(
            "ai_oauth_exchange",
            format!("unreadable token response: {e}"),
        )
    })
}

/// Decode a JWT's claims **without** verifying the signature.
///
/// Only used on ID tokens received directly from the token endpoint over TLS, which
/// OIDC Core 1.0 section 3.1.3.7 (6) allows to stand in for signature validation; the
/// issuer, audience, nonce and expiry are still checked by the callers.
pub fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

// ---------------------------------------------------------------------------------
// Session: serialised refresh + persistence
// ---------------------------------------------------------------------------------

/// Where and how to refresh.
#[derive(Debug, Clone)]
pub struct RefreshConfig {
    /// Token endpoint.
    pub token_url: String,
    /// `resource` parameter to send (OpenAI: `https://api.openai.com/v1`).
    pub resource: Option<String>,
}

/// A signed-in provider: hands out fresh access tokens, refreshing (serialised) before
/// expiry and once after a rejection, and persists every change to the key store.
pub struct OAuthSession {
    provider: ProviderId,
    store: Arc<dyn KeyStore>,
    client: reqwest::Client,
    refresh: RefreshConfig,
    tokens: tokio::sync::Mutex<OAuthTokens>,
}

impl fmt::Debug for OAuthSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OAuthSession")
            .field("provider", &self.provider)
            .field("refresh", &self.refresh)
            .finish_non_exhaustive()
    }
}

impl OAuthSession {
    /// Wrap an existing token record.
    pub fn new(
        provider: ProviderId,
        store: Arc<dyn KeyStore>,
        client: reqwest::Client,
        refresh: RefreshConfig,
        tokens: OAuthTokens,
    ) -> Arc<Self> {
        Arc::new(Self {
            provider,
            store,
            client,
            refresh,
            tokens: tokio::sync::Mutex::new(tokens),
        })
    }

    /// Provider this session signs in to.
    pub fn provider(&self) -> &ProviderId {
        &self.provider
    }

    /// The HTTP client used for refreshes (shared with the API calls).
    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// Copy of the current record.
    pub async fn snapshot(&self) -> OAuthTokens {
        self.tokens.lock().await.clone()
    }

    /// A usable access token, refreshing first when it expires within the skew.
    pub async fn access_token(&self) -> Result<SecretString, Error> {
        let mut guard = self.tokens.lock().await;
        if guard.expires_soon(now_unix()) {
            self.do_refresh(&mut guard).await?;
        }
        Ok(SecretString::new(guard.access_token.clone()))
    }

    /// The server rejected `rejected`: refresh unless another caller already did.
    pub async fn refresh_after_rejection(
        &self,
        rejected: &SecretString,
    ) -> Result<SecretString, Error> {
        let mut guard = self.tokens.lock().await;
        if guard.access_token == rejected.expose() {
            self.do_refresh(&mut guard).await?;
        }
        Ok(SecretString::new(guard.access_token.clone()))
    }

    /// Mutate and persist the record (image verdicts, cached models).
    pub async fn update(&self, f: impl FnOnce(&mut OAuthTokens)) -> Result<(), Error> {
        let mut guard = self.tokens.lock().await;
        f(&mut guard);
        self.persist(guard.clone()).await
    }

    async fn persist(&self, tokens: OAuthTokens) -> Result<(), Error> {
        let store = Arc::clone(&self.store);
        let provider = self.provider.clone();
        tokio::task::spawn_blocking(move || save_tokens(store.as_ref(), &provider, &tokens))
            .await
            .map_err(|e| Error::KeyStore(format!("token store task failed: {e}")))?
    }

    async fn do_refresh(&self, tokens: &mut OAuthTokens) -> Result<(), Error> {
        let Some(refresh) = tokens.refresh_token.clone() else {
            return Err(Error::oauth(
                "ai_oauth_reauth",
                format!(
                    "Your {} sign-in expired and has no refresh token. Sign in again.",
                    self.provider
                ),
            ));
        };
        let mut form: Vec<(&str, &str)> = vec![
            ("grant_type", "refresh_token"),
            ("client_id", tokens.client_id.as_str()),
            ("refresh_token", refresh.as_str()),
        ];
        if let Some(r) = self.refresh.resource.as_deref() {
            form.push(("resource", r));
        }
        match post_token_form(&self.client, &self.refresh.token_url, &form, true).await {
            Ok(resp) => {
                tokens.apply_response(&resp, now_unix());
                if let Some(claims) = resp.id_token.as_deref().and_then(jwt_claims) {
                    tokens.apply_identity(&claims);
                }
                tracing::info!(provider = %self.provider, "refreshed subscription token");
                self.persist(tokens.clone()).await
            }
            Err(e) => {
                if e.code() == "ai_oauth_reauth" {
                    // The refresh token is dead: forget it so the UI shows "signed out".
                    let store = Arc::clone(&self.store);
                    let provider = self.provider.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        delete_tokens(store.as_ref(), &provider)
                    })
                    .await;
                }
                Err(e)
            }
        }
    }
}

/// Run `call` with a fresh token; on [`Error::Auth`] refresh once and retry.
pub async fn with_auth_retry<T, F, Fut>(session: &OAuthSession, call: F) -> Result<T, Error>
where
    F: Fn(SecretString) -> Fut,
    Fut: Future<Output = Result<T, Error>>,
{
    let token = session.access_token().await?;
    match call(token.clone()).await {
        Err(Error::Auth(_)) => {
            let fresh = session.refresh_after_rejection(&token).await?;
            call(fresh).await
        }
        other => other,
    }
}

// ---------------------------------------------------------------------------------
// Loopback redirect listener
// ---------------------------------------------------------------------------------

/// What the browser brought back to `/callback`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackParams {
    /// Authorization code.
    pub code: String,
    /// Client ID issued by dynamic registration (OpenAI), when present.
    pub client_id: Option<String>,
    /// Granted scopes, when present.
    pub scope: Option<String>,
}

/// Parse the request target of a redirect (`/callback?code=..&state=..`).
///
/// `Ok(None)` for any other path (favicon probes, ...), so the listener keeps waiting.
/// `error=` and a state mismatch are errors: a mismatched state is never exchanged.
pub fn parse_callback(target: &str, expected_state: &str) -> Result<Option<CallbackParams>, Error> {
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|e| Error::oauth("ai_oauth_callback", format!("malformed callback: {e}")))?;
    if url.path() != "/callback" {
        return Ok(None);
    }
    let mut code = None;
    let mut state = None;
    let mut client_id = None;
    let mut scope = None;
    let mut error = None;
    let mut error_description = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            "client_id" => client_id = Some(v.into_owned()),
            "scope" => scope = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            "error_description" => error_description = Some(v.into_owned()),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Err(Error::oauth(
            "ai_oauth_state_mismatch",
            "The sign-in response did not match this request (state mismatch); nothing was exchanged. Start again.",
        ));
    }
    if let Some(err) = error {
        let detail = error_description.unwrap_or_default();
        return Err(if err == "access_denied" {
            Error::oauth(
                "ai_oauth_denied",
                "Sign-in was cancelled or consent was declined.",
            )
        } else {
            Error::oauth(
                "ai_oauth_callback",
                format!(
                    "Sign-in failed: {err}{}",
                    if detail.is_empty() {
                        String::new()
                    } else {
                        format!(" ({detail})")
                    }
                ),
            )
        });
    }
    let code = code.filter(|c| !c.is_empty()).ok_or_else(|| {
        Error::oauth("ai_oauth_callback", "The sign-in response carried no code.")
    })?;
    Ok(Some(CallbackParams {
        code,
        client_id: client_id.filter(|c| !c.is_empty()),
        scope,
    }))
}

/// One-shot `127.0.0.1:<random port>` listener for the redirect.
#[derive(Debug)]
pub struct Loopback {
    listener: TcpListener,
    port: u16,
}

impl Loopback {
    /// Bind a random free port on IPv4 loopback.
    pub async fn bind() -> Result<Self, Error> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        Ok(Self { listener, port })
    }

    /// Bound port.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// `http://127.0.0.1:<port>/callback` (OpenAI requires `127.0.0.1`, not `localhost`,
    /// and exactly `/callback`).
    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}/callback", self.port)
    }

    /// Serve until a `/callback` request arrives (then answer with a small "you can
    /// close this window" page and shut down), `timeout` passes, or `cancel` fires.
    pub async fn wait(
        self,
        expected_state: &str,
        timeout: Duration,
        cancel: Arc<Notify>,
    ) -> Result<CallbackParams, Error> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let accepted = tokio::select! {
                r = self.listener.accept() => r,
                () = tokio::time::sleep_until(deadline) => {
                    return Err(Error::oauth("ai_oauth_timeout", "Sign-in timed out after 5 minutes. Start again."));
                }
                () = cancel.notified() => {
                    return Err(Error::oauth("ai_oauth_cancelled", "Sign-in cancelled."));
                }
            };
            let Ok((mut stream, _)) = accepted else {
                continue;
            };
            let head = match read_request_head(&mut stream).await {
                Ok(h) => h,
                Err(_) => continue,
            };
            let target = head
                .lines()
                .next()
                .and_then(|l| {
                    let mut parts = l.split_whitespace();
                    match (parts.next(), parts.next()) {
                        (Some("GET"), Some(t)) => Some(t.to_owned()),
                        _ => None,
                    }
                })
                .unwrap_or_default();
            match parse_callback(&target, expected_state) {
                Ok(None) => {
                    let _ = respond(&mut stream, 404, "Not found", "").await;
                }
                Ok(Some(params)) => {
                    let _ = respond(
                        &mut stream,
                        200,
                        "OK",
                        &callback_page(
                            true,
                            "You're signed in. You can close this window and return to Pixelforge.",
                        ),
                    )
                    .await;
                    return Ok(params);
                }
                Err(e) => {
                    let _ = respond(
                        &mut stream,
                        400,
                        "Bad Request",
                        &callback_page(false, &e.to_string()),
                    )
                    .await;
                    return Err(e);
                }
            }
        }
    }
}

async fn read_request_head(stream: &mut tokio::net::TcpStream) -> std::io::Result<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut chunk))
            .await
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "slow client"))??;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > MAX_REQUEST_HEAD {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

async fn respond(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    reason: &str,
    html: &str,
) -> std::io::Result<()> {
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    stream.write_all(resp.as_bytes()).await?;
    stream.shutdown().await
}

/// Minimal escape for text placed in the callback page.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The page shown in the browser after the redirect.
pub fn callback_page(ok: bool, message: &str) -> String {
    let (title, color) = if ok {
        ("Signed in", "#43d17a")
    } else {
        ("Sign-in failed", "#ff5c7a")
    };
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Pixelforge: {title}</title>\
<style>body{{margin:0;height:100vh;display:grid;place-items:center;background:#1e1e1e;color:#ddd;font:14px system-ui,sans-serif}}\
.c{{text-align:center;max-width:420px;padding:24px}}h1{{font-size:18px;color:{color};margin:0 0 8px}}p{{margin:0;color:#aaa;line-height:1.5}}</style>\
</head><body><div class=\"c\"><h1>{title}</h1><p>{}</p></div></body></html>",
        html_escape(message)
    )
}

// ---------------------------------------------------------------------------------
// RFC 8628 device authorization grant
// ---------------------------------------------------------------------------------

/// Device authorization response (RFC 8628 section 3.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceCode {
    /// Secret code the app polls with (never shown).
    pub device_code: String,
    /// Code the user types.
    pub user_code: String,
    /// Where the user goes.
    pub verification_uri: String,
    /// Same with the code pre-filled.
    #[serde(default)]
    pub verification_uri_complete: Option<String>,
    /// Lifetime in seconds.
    #[serde(default)]
    pub expires_in: Option<u64>,
    /// Minimum poll interval in seconds.
    #[serde(default)]
    pub interval: Option<u64>,
}

/// Start a device flow.
pub async fn request_device_code(
    client: &reqwest::Client,
    url: &str,
    client_id: &str,
    scope: &str,
) -> Result<DeviceCode, Error> {
    let resp = client
        .post(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[("client_id", client_id), ("scope", scope)])
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_token_error(status.as_u16(), &text, false));
    }
    let dc: DeviceCode = serde_json::from_str(&text).map_err(|e| {
        Error::oauth(
            "ai_oauth_exchange",
            format!("unreadable device-code response: {e}"),
        )
    })?;
    if dc.device_code.is_empty() || dc.user_code.is_empty() || dc.verification_uri.is_empty() {
        return Err(Error::oauth(
            "ai_oauth_exchange",
            "device-code response is missing device_code / user_code / verification_uri",
        ));
    }
    Ok(dc)
}

/// Poll the token endpoint until the user approves, declines, the code expires, or
/// `cancel` fires (RFC 8628 section 3.4/3.5: `authorization_pending`, `slow_down` +5 s).
pub async fn poll_device_token(
    client: &reqwest::Client,
    token_url: &str,
    client_id: &str,
    dc: &DeviceCode,
    cancel: Arc<Notify>,
) -> Result<TokenResponse, Error> {
    let mut interval = Duration::from_secs(dc.interval.unwrap_or(5).clamp(1, 60));
    let deadline =
        tokio::time::Instant::now() + Duration::from_secs(dc.expires_in.unwrap_or(600).max(1));
    loop {
        tokio::select! {
            () = tokio::time::sleep(interval) => {}
            () = cancel.notified() => return Err(Error::oauth("ai_oauth_cancelled", "Sign-in cancelled.")),
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(Error::oauth(
                "ai_oauth_timeout",
                "The sign-in code expired before it was approved. Start again.",
            ));
        }
        let resp = client
            .post(token_url)
            .header(reqwest::header::ACCEPT, "application/json")
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", dc.device_code.as_str()),
                ("client_id", client_id),
            ])
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status.is_success() {
            return serde_json::from_str(&text).map_err(|e| {
                Error::oauth(
                    "ai_oauth_exchange",
                    format!("unreadable token response: {e}"),
                )
            });
        }
        let err: OAuthErrorBody = serde_json::from_str(&text).unwrap_or_default();
        match err.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += Duration::from_secs(5),
            _ => return Err(map_token_error(status.as_u16(), &text, false)),
        }
    }
}

// ---------------------------------------------------------------------------------
// Provider wrappers
// ---------------------------------------------------------------------------------

/// Builds the inner provider for a given credential.
pub type ProviderFactory = Arc<dyn Fn(AuthMethod) -> Result<SharedProvider, Error> + Send + Sync>;

/// Any bearer-token image provider driven by an [`OAuthSession`]: fresh token per call,
/// one refresh-and-retry on 401/403. A second rejection with a fresh token becomes
/// [`Error::PlanNotEligible`] with `not_eligible` as the message.
pub struct BearerOAuthProvider {
    id: ProviderId,
    session: Arc<OAuthSession>,
    factory: ProviderFactory,
    capabilities: Capabilities,
    not_eligible: String,
}

impl BearerOAuthProvider {
    /// Wrap `factory` (e.g. `XaiProvider::new(auth).with_base_url(..)`).
    pub fn new(
        id: ProviderId,
        session: Arc<OAuthSession>,
        factory: ProviderFactory,
        capabilities: Capabilities,
        not_eligible: impl Into<String>,
    ) -> Self {
        Self {
            id,
            session,
            factory,
            capabilities,
            not_eligible: not_eligible.into(),
        }
    }

    fn auth_for(token: SecretString) -> AuthMethod {
        AuthMethod::OAuth {
            access: token,
            refresh: None,
            expires_at: u64::MAX,
        }
    }

    fn eligibility(&self, r: Result<Vec<ImageResult>, Error>) -> Result<Vec<ImageResult>, Error> {
        match r {
            Err(Error::Auth(detail)) => Err(Error::PlanNotEligible {
                provider: self.id.clone(),
                message: format!("{} ({detail})", self.not_eligible),
            }),
            // Under a subscription a 429 is the plan's quota, not an API-key rate limit.
            Err(Error::RateLimited { retry_after_secs }) => {
                let resets_at = retry_after_secs.map(|s| now_unix() + s);
                Err(Error::PlanLimit {
                    provider: self.id.clone(),
                    resets_at,
                    message: format!(
                        "Your {} subscription hit its usage limit (subscription plans have daily image limits){}. Try again later or switch to an API key.",
                        self.id.vendor(),
                        resets_at
                            .map(|t| format!("; it resets {}", format_utc(t)))
                            .unwrap_or_default()
                    ),
                })
            }
            other => other,
        }
    }
}

#[async_trait]
impl ImageProvider for BearerOAuthProvider {
    fn id(&self) -> ProviderId {
        self.id.clone()
    }

    fn capabilities(&self) -> Capabilities {
        self.capabilities.clone()
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        let r = with_auth_retry(&self.session, |tok| {
            let req = req.clone();
            let factory = Arc::clone(&self.factory);
            async move { factory(Self::auth_for(tok))?.generate(req).await }
        })
        .await;
        self.eligibility(r)
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        let r = with_auth_retry(&self.session, |tok| {
            let req = req.clone();
            let factory = Arc::clone(&self.factory);
            async move { factory(Self::auth_for(tok))?.edit(req).await }
        })
        .await;
        self.eligibility(r)
    }

    async fn test_key(&self) -> Result<(), Error> {
        with_auth_retry(&self.session, |tok| {
            let factory = Arc::clone(&self.factory);
            async move { factory(Self::auth_for(tok))?.test_key().await }
        })
        .await
    }
}

/// Subscription first; when (and only when) the plan's usage cap is hit, the request is
/// re-sent with the user's API key. Constructed only when the user ticked "Fall back to
/// API key when the plan limit is hit" (off by default) and a key is stored.
pub struct PlanFallbackProvider {
    primary: SharedProvider,
    fallback: SharedProvider,
}

impl PlanFallbackProvider {
    /// `primary` = subscription provider, `fallback` = API-key provider.
    pub fn new(primary: SharedProvider, fallback: SharedProvider) -> Self {
        Self { primary, fallback }
    }
}

#[async_trait]
impl ImageProvider for PlanFallbackProvider {
    fn id(&self) -> ProviderId {
        self.primary.id()
    }

    fn capabilities(&self) -> Capabilities {
        self.primary.capabilities()
    }

    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        match self.primary.generate(req.clone()).await {
            Err(Error::PlanLimit { .. }) => {
                tracing::info!("plan limit hit; user opted into API-key fallback");
                self.fallback.generate(req).await
            }
            other => other,
        }
    }

    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        match self.primary.edit(req.clone()).await {
            Err(Error::PlanLimit { .. }) => {
                tracing::info!("plan limit hit; user opted into API-key fallback");
                self.fallback.edit(req).await
            }
            other => other,
        }
    }

    async fn test_key(&self) -> Result<(), Error> {
        self.primary.test_key().await
    }
}

/// `2026-10-07 14:00 UTC` for a Unix timestamp (no date crate needed).
pub fn format_utc(ts: u64) -> String {
    let days = (ts / 86_400) as i64;
    let secs = ts % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02} UTC",
        secs / 3600,
        (secs % 3600) / 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keystore::FileStore;

    #[test]
    fn pkce_matches_rfc7636_appendix_b() {
        // RFC 7636 Appendix B test vector.
        assert_eq!(
            Pkce::challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let p = Pkce::generate();
        assert!((43..=128).contains(&p.verifier.len()));
        assert!(p
            .verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(p.challenge, Pkce::challenge_for(&p.verifier));
        assert_ne!(Pkce::generate().verifier, p.verifier);
        assert!(!format!("{p:?}").contains(&p.verifier));
        let s = random_urlsafe(2);
        assert_eq!(s.len(), 43);
        assert_ne!(s, random_urlsafe(2));
    }

    #[test]
    fn callback_parsing() {
        let ok = parse_callback(
            "/callback?code=abc&scope=chatgpt.tokens.use.direct+email+openid&state=S1&client_id=oaiapp_1",
            "S1",
        )
        .expect("ok")
        .expect("callback");
        assert_eq!(ok.code, "abc");
        assert_eq!(ok.client_id.as_deref(), Some("oaiapp_1"));
        assert_eq!(
            split_scopes(ok.scope.as_deref().unwrap_or_default()),
            vec!["chatgpt.tokens.use.direct", "email", "openid"]
        );
        assert_eq!(parse_callback("/favicon.ico", "S1").expect("ignored"), None);
        let e = parse_callback("/callback?code=abc&state=EVIL", "S1").expect_err("mismatch");
        assert_eq!(e.code(), "ai_oauth_state_mismatch");
        let e = parse_callback("/callback?code=abc", "S1").expect_err("missing state");
        assert_eq!(e.code(), "ai_oauth_state_mismatch");
        let e = parse_callback("/callback?error=access_denied&state=S1", "S1").expect_err("denied");
        assert_eq!(e.code(), "ai_oauth_denied");
        let e = parse_callback(
            "/callback?error=server_error&error_description=boom&state=S1",
            "S1",
        )
        .expect_err("err");
        assert_eq!(e.code(), "ai_oauth_callback");
        assert!(e.to_string().contains("boom"));
        let e = parse_callback("/callback?state=S1", "S1").expect_err("no code");
        assert_eq!(e.code(), "ai_oauth_callback");
    }

    #[test]
    fn token_errors_map_to_codes() {
        assert_eq!(
            map_token_error(400, r#"{"error":"invalid_grant"}"#, true).code(),
            "ai_oauth_reauth"
        );
        assert_eq!(
            map_token_error(400, r#"{"error":"refresh_token_reused"}"#, true).code(),
            "ai_oauth_reauth"
        );
        // invalid_grant during a code exchange is a plain exchange failure.
        assert_eq!(
            map_token_error(400, r#"{"error":"invalid_grant"}"#, false).code(),
            "ai_oauth_exchange"
        );
        assert_eq!(
            map_token_error(401, r#"{"error":"invalid_client"}"#, false).code(),
            "ai_oauth_client"
        );
        assert_eq!(
            map_token_error(400, r#"{"error":"access_denied"}"#, false).code(),
            "ai_oauth_denied"
        );
        assert_eq!(
            map_token_error(500, "oops", false).code(),
            "ai_oauth_exchange"
        );
    }

    #[test]
    fn jwt_claims_decode_and_identity() {
        let payload = b64url(br#"{"sub":"u1","email":"a@b.c","nonce":"n"}"#);
        let claims = jwt_claims(&format!("x.{payload}.sig")).expect("claims");
        let mut t = OAuthTokens::default();
        t.apply_identity(&claims);
        assert_eq!(t.email.as_deref(), Some("a@b.c"));
        assert_eq!(t.subject.as_deref(), Some("u1"));
        assert!(jwt_claims("not-a-jwt").is_none());
    }

    #[test]
    fn keychain_round_trip_via_file_store_and_redaction() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = FileStore::new(dir.path());
        let p = ProviderId::OpenAi;
        assert!(load_tokens(&store, &p).expect("load").is_none());
        let t = OAuthTokens {
            access_token: "ACCESS-SECRET".into(),
            refresh_token: Some("REFRESH-SECRET".into()),
            expires_at: 42,
            client_id: "oaiapp_x".into(),
            email: Some("me@example.com".into()),
            plan_usage: true,
            models: vec![PlanModel {
                slug: "gpt-5.5".into(),
                display_name: "GPT-5.5".into(),
            }],
            ..OAuthTokens::default()
        };
        save_tokens(&store, &p, &t).expect("save");
        // Stored under its own account, not the API-key slot.
        assert!(store.get(&p).expect("api key slot").is_none());
        assert_eq!(account_name(&p), "oauth:open_ai");
        let back = load_tokens(&store, &p).expect("load").expect("some");
        assert_eq!(back, t);
        let raw = std::fs::read_to_string(store.path()).expect("file");
        assert!(!raw.contains("ACCESS-SECRET"));
        let dbg = format!("{back:?}");
        assert!(!dbg.contains("ACCESS-SECRET") && !dbg.contains("REFRESH-SECRET"));
        delete_tokens(&store, &p).expect("delete");
        assert!(load_tokens(&store, &p).expect("load").is_none());
    }

    #[test]
    fn expiry_skew_and_scopes() {
        let t = OAuthTokens {
            expires_at: 1000,
            ..OAuthTokens::default()
        };
        assert!(t.expires_soon(1000 - REFRESH_SKEW_SECS));
        assert!(!t.expires_soon(1000 - REFRESH_SKEW_SECS - 1));
        assert_eq!(split_scopes("b a  a+c"), vec!["a", "b", "c"]);
    }

    #[test]
    fn utc_formatting() {
        assert_eq!(format_utc(0), "1970-01-01 00:00 UTC");
        assert_eq!(format_utc(1_791_380_000), "2026-10-07 13:33 UTC");
        assert_eq!(format_utc(951_782_400), "2000-02-29 00:00 UTC");
    }

    #[test]
    fn callback_page_escapes() {
        let p = callback_page(false, "<script>x</script>");
        assert!(!p.contains("<script>x"));
        assert!(p.contains("&lt;script&gt;"));
    }

    #[tokio::test]
    async fn loopback_serves_callback_and_rejects_bad_state() {
        let lb = Loopback::bind().await.expect("bind");
        let port = lb.port();
        assert!(lb.redirect_uri().starts_with("http://127.0.0.1:"));
        assert!(lb.redirect_uri().ends_with("/callback"));
        let cancel = Arc::new(Notify::new());
        let waiter = tokio::spawn(lb.wait("ST", Duration::from_secs(10), cancel));
        let client = reqwest::Client::new();
        let r = client
            .get(format!("http://127.0.0.1:{port}/favicon.ico"))
            .send()
            .await
            .expect("favicon");
        assert_eq!(r.status(), 404);
        let r = client
            .get(format!(
                "http://127.0.0.1:{port}/callback?code=C&state=ST&client_id=oaiapp_9"
            ))
            .send()
            .await
            .expect("callback");
        assert_eq!(r.status(), 200);
        assert!(r.text().await.expect("body").contains("close this window"));
        let got = waiter.await.expect("join").expect("params");
        assert_eq!(got.code, "C");
        assert_eq!(got.client_id.as_deref(), Some("oaiapp_9"));

        let lb = Loopback::bind().await.expect("bind");
        let port = lb.port();
        let waiter = tokio::spawn(lb.wait("ST", Duration::from_secs(10), Arc::new(Notify::new())));
        let r = client
            .get(format!(
                "http://127.0.0.1:{port}/callback?code=C&state=OTHER"
            ))
            .send()
            .await
            .expect("callback");
        assert_eq!(r.status(), 400);
        let e = waiter.await.expect("join").expect_err("mismatch");
        assert_eq!(e.code(), "ai_oauth_state_mismatch");
    }

    #[tokio::test]
    async fn loopback_cancel_and_timeout() {
        let lb = Loopback::bind().await.expect("bind");
        let cancel = Arc::new(Notify::new());
        cancel.notify_one();
        let e = lb
            .wait("S", Duration::from_secs(10), cancel)
            .await
            .expect_err("cancelled");
        assert_eq!(e.code(), "ai_oauth_cancelled");
        let lb = Loopback::bind().await.expect("bind");
        let e = lb
            .wait("S", Duration::from_millis(50), Arc::new(Notify::new()))
            .await
            .expect_err("timeout");
        assert_eq!(e.code(), "ai_oauth_timeout");
    }
}
