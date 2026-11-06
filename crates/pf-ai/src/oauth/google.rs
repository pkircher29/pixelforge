//! Google desktop OAuth for the separately billed Gemini API, not Google AI plan usage.
//! https://ai.google.dev/gemini-api/docs/oauth
use std::sync::Arc;

use super::{
    now_unix, post_token_form, random_urlsafe, with_auth_retry, CallbackParams, OAuthSession,
    OAuthTokens, Pkce, RefreshConfig,
};
use crate::providers::GeminiProvider;
use crate::{
    AuthMethod, Capabilities, EditRequest, Error, GenerateRequest, ImageProvider, ImageResult,
    ProviderId, SecretString, SharedProvider,
};
use async_trait::async_trait;

/// Official setup instructions.
pub const DOCS_URL: &str = "https://ai.google.dev/gemini-api/docs/oauth";
/// Scope accepted by the Generative Language API.
pub const SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";
/// Desktop app configuration. Debug redacts the client secret.
#[derive(Clone, Debug)]
pub struct GoogleConfig {
    /// Registered desktop application ID.
    pub client_id: String,
    /// Desktop client secret supplied by Google.
    pub client_secret: SecretString,
    /// API quota/billing project.
    pub project: String,
    /// Authorization endpoint (override only in tests).
    pub authorize_url: String,
    /// Token endpoint.
    pub token_url: String,
    /// Revocation endpoint.
    pub revoke_url: String,
    /// Optional test API endpoint.
    pub api_base: Option<String>,
}

impl GoogleConfig {
    /// Fixed Google endpoints; credentials are supplied by the desktop app owner.
    pub fn new(client_id: String, client_secret: SecretString, project: String) -> Self {
        Self {
            client_id,
            client_secret,
            project,
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            revoke_url: "https://oauth2.googleapis.com/revoke".into(),
            api_base: None,
        }
    }

    /// Refuse incomplete configuration before opening a browser.
    pub fn validate(&self) -> Result<(), Error> {
        if self.client_id.trim().is_empty()
            || self.client_secret.is_empty()
            || self.project.trim().is_empty()
        {
            return Err(Error::oauth("ai_oauth_unavailable",
                "Configure a Google Desktop app client ID, client secret and Cloud project first. Enable the Generative Language API in that project. Gemini API usage is billed separately from Google AI plans."));
        }
        if !self
            .project
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err(Error::InvalidRequest(
                "Use a Google Cloud project ID or project number.".into(),
            ));
        }
        Ok(())
    }

    /// Session refresh endpoint.
    pub fn refresh_config(&self) -> RefreshConfig {
        RefreshConfig {
            token_url: self.token_url.clone(),
            resource: None,
        }
    }
}

/// One in-memory authorization attempt; never sent across IPC.
pub struct GoogleAuthorize {
    /// Browser URL (contains no secret).
    pub url: String,
    /// CSRF state checked by the loopback listener.
    pub state: String,
    /// Proof key.
    pub pkce: Pkce,
    /// Bound callback URI.
    pub redirect_uri: String,
}

/// Authorization code + S256 PKCE, with offline access and explicit consent.
pub fn authorize(cfg: &GoogleConfig, redirect_uri: &str) -> Result<GoogleAuthorize, Error> {
    cfg.validate()?;
    let pkce = Pkce::generate();
    let state = random_urlsafe(2);
    let mut url = reqwest::Url::parse(&cfg.authorize_url)
        .map_err(|_| Error::InvalidRequest("Invalid Google authorization endpoint".into()))?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", cfg.client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("state", state.as_str()),
        ("code_challenge", pkce.challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]);
    Ok(GoogleAuthorize {
        url: url.into(),
        state,
        pkce,
        redirect_uri: redirect_uri.into(),
    })
}

/// Exchange only a state-validated callback. No identity claims are requested or inferred.
pub async fn exchange(
    cfg: &GoogleConfig,
    client: &reqwest::Client,
    req: &GoogleAuthorize,
    cb: &CallbackParams,
) -> Result<OAuthTokens, Error> {
    let response = post_token_form(
        client,
        &cfg.token_url,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &cfg.client_id),
            ("client_secret", cfg.client_secret.expose()),
            ("code", &cb.code),
            ("redirect_uri", &req.redirect_uri),
            ("code_verifier", &req.pkce.verifier),
        ],
        false,
    )
    .await?;
    if response.access_token.is_empty()
        || response
            .scope
            .as_deref()
            .is_some_and(|s| !s.split_whitespace().any(|s| s == SCOPE))
    {
        return Err(Error::oauth("ai_oauth_denied", "Google did not grant Gemini API access. Sign in again and grant the requested permission."));
    }
    let mut tokens = OAuthTokens {
        client_id: cfg.client_id.clone(),
        client_secret: Some(cfg.client_secret.expose().to_owned()),
        ..OAuthTokens::default()
    };
    tokens.apply_response(&response, now_unix());
    Ok(tokens)
}

/// Revoke the refresh token when present, otherwise the access token.
pub async fn revoke(
    cfg: &GoogleConfig,
    client: &reqwest::Client,
    tokens: &OAuthTokens,
) -> Result<(), Error> {
    let response = client
        .post(&cfg.revoke_url)
        .form(&[(
            "token",
            tokens
                .refresh_token
                .as_deref()
                .unwrap_or(&tokens.access_token),
        )])
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(Error::oauth(
            "ai_oauth_revoke",
            "Google token revocation failed; remove access in your Google account settings.",
        ));
    }
    Ok(())
}

struct GoogleProvider {
    session: Arc<OAuthSession>,
    cfg: GoogleConfig,
}
impl GoogleProvider {
    fn inner(&self, access: SecretString) -> Result<GeminiProvider, Error> {
        let mut provider = GeminiProvider::new(AuthMethod::OAuth {
            access,
            refresh: None,
            expires_at: u64::MAX,
        })?
        .with_quota_project(&self.cfg.project);
        if let Some(base) = &self.cfg.api_base {
            provider = provider.with_base_url(base);
        }
        Ok(provider)
    }
}
#[async_trait]
impl ImageProvider for GoogleProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }
    fn capabilities(&self) -> Capabilities {
        crate::capabilities::capabilities_for(&self.id())
    }
    async fn generate(&self, req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        with_auth_retry(&self.session, |access| {
            let req = req.clone();
            async move { self.inner(access)?.generate(req).await }
        })
        .await
    }
    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        with_auth_retry(&self.session, |access| {
            let req = req.clone();
            async move { self.inner(access)?.edit(req).await }
        })
        .await
    }
    async fn test_key(&self) -> Result<(), Error> {
        with_auth_retry(&self.session, |access| async move {
            self.inner(access)?.test_key().await
        })
        .await
    }
}
/// Gemini API errors stay API errors: OAuth does not turn billing into a subscription.
pub fn build_provider(session: Arc<OAuthSession>, cfg: GoogleConfig) -> SharedProvider {
    Arc::new(GoogleProvider { session, cfg })
}
