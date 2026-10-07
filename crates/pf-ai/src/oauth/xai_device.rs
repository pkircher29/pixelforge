//! xAI subscription sign-in (SuperGrok / X Premium) via the RFC 8628 device flow.
//!
//! Endpoints come from xAI's public discovery document
//! <https://auth.x.ai/.well-known/openid-configuration> (`device_authorization_endpoint`,
//! `token_endpoint`, `revocation_endpoint`, grant
//! `urn:ietf:params:oauth:grant-type:device_code`). docs.x.ai documents **no**
//! third-party client registration; the projects xAI announced (Hermes Agent, OpenClaw,
//! OpenCode) use xAI's shared Grok-CLI client. Pixelforge does not: the client ID must be
//! one **issued to Pixelforge by xAI**, supplied via `PF_XAI_OAUTH_CLIENT_ID` or the
//! Settings field. With none configured every entry point returns
//! `ai_oauth_unavailable` (docs/ai-research.md section 5.2).
//!
//! The bearer is used against the same `api.x.ai` image endpoints as an API key (JSON,
//! no mask field; masks stay emulated). That those endpoints accept subscription tokens
//! is shown by partner source code (Hermes' xAI image plugin), not by docs.x.ai; a
//! rejection after a refresh maps to `ai_plan_not_eligible`.

use std::sync::Arc;

use tokio::sync::Notify;

use super::{
    jwt_claims, now_unix, poll_device_token, request_device_code, BearerOAuthProvider, DeviceCode,
    OAuthSession, OAuthTokens, ProviderFactory, RefreshConfig,
};
use crate::capabilities::capabilities_for;
use crate::error::Error;
use crate::providers::{SharedProvider, XaiProvider};
use crate::types::ProviderId;

/// xAI's authorization server (issuer).
pub const AUTH_BASE: &str = "https://auth.x.ai";
/// `device_authorization_endpoint` path.
pub const DEVICE_PATH: &str = "/oauth2/device/code";
/// `token_endpoint` path.
pub const TOKEN_PATH: &str = "/oauth2/token";
/// `revocation_endpoint` path.
pub const REVOKE_PATH: &str = "/oauth2/revoke";
/// `userinfo_endpoint` path.
pub const USERINFO_PATH: &str = "/oauth2/userinfo";
/// Scopes requested by default (identity + refresh + `api:access`, all listed in the
/// discovery document's `scopes_supported`). Override with [`SCOPES_ENV`] if xAI
/// specifies different scopes when issuing the client.
pub const DEFAULT_SCOPES: &str = "openid profile email offline_access api:access";
/// Client ID issued to Pixelforge by xAI (never shipped in source).
pub const CLIENT_ID_ENV: &str = "PF_XAI_OAUTH_CLIENT_ID";
/// Scope override.
pub const SCOPES_ENV: &str = "PF_XAI_OAUTH_SCOPES";
/// Authorization-server override (dev: `scripts/fake-openai-auth.mjs`).
pub const AUTH_BASE_ENV: &str = "PF_XAI_AUTH_BASE";
/// API override (shared with the API-key provider).
pub const API_BASE_ENV: &str = "PF_AI_BASE_URL_XAI";

/// xAI's documented developer contact (docs.x.ai "Debugging errors").
pub const CONTACT_EMAIL: &str = "support@x.ai";
/// Where Pixelforge explains the application route.
pub const RESEARCH_URL: &str =
    "https://github.com/pkircher29/pixelforge/blob/main/docs/ai-research.md#5-subscription-sign-in-verified-2026-10-06";
/// The public discovery document.
pub const DISCOVERY_URL: &str = "https://auth.x.ai/.well-known/openid-configuration";

/// Shown when the token is rejected for images.
pub const IMAGES_NOT_ELIGIBLE: &str = "xAI did not accept your subscription sign-in for Grok Imagine. xAI decides which accounts can receive OAuth API tokens; use an xAI API key for images.";

/// Resolved configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XaiOAuthConfig {
    /// Authorization server base.
    pub auth_base: String,
    /// API base for image calls.
    pub api_base: Option<String>,
    /// Client ID issued to Pixelforge; `None` = sign-in unavailable.
    pub client_id: Option<String>,
    /// Space-separated scopes.
    pub scopes: String,
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

impl XaiOAuthConfig {
    /// Env first (`PF_XAI_OAUTH_CLIENT_ID`), then the Settings value.
    pub fn from_env(settings_client_id: Option<&str>) -> Self {
        Self {
            auth_base: env_nonempty(AUTH_BASE_ENV)
                .map(|s| s.trim_end_matches('/').to_owned())
                .unwrap_or_else(|| AUTH_BASE.to_owned()),
            api_base: env_nonempty(API_BASE_ENV),
            client_id: env_nonempty(CLIENT_ID_ENV).or_else(|| {
                settings_client_id
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
            }),
            scopes: env_nonempty(SCOPES_ENV).unwrap_or_else(|| DEFAULT_SCOPES.to_owned()),
        }
    }

    /// Everything at one host (tests).
    pub fn local(base: &str, client_id: Option<&str>) -> Self {
        Self {
            auth_base: base.trim_end_matches('/').to_owned(),
            api_base: Some(base.trim_end_matches('/').to_owned()),
            client_id: client_id.map(str::to_owned),
            scopes: DEFAULT_SCOPES.to_owned(),
        }
    }

    /// Where the client ID came from, for the UI.
    pub fn client_id_source(settings_client_id: Option<&str>) -> &'static str {
        if env_nonempty(CLIENT_ID_ENV).is_some() {
            "env"
        } else if settings_client_id.is_some_and(|s| !s.trim().is_empty()) {
            "settings"
        } else {
            "none"
        }
    }

    /// The configured client ID or `ai_oauth_unavailable`.
    pub fn require_client_id(&self) -> Result<&str, Error> {
        self.client_id.as_deref().ok_or_else(|| {
            Error::oauth(
                "ai_oauth_unavailable",
                "Sign in with SuperGrok is awaiting xAI approval for Pixelforge: xAI has not issued Pixelforge an OAuth client ID, and Pixelforge will not borrow another app's. Use an xAI API key for now.",
            )
        })
    }

    /// Refresh descriptor.
    pub fn refresh_config(&self) -> RefreshConfig {
        RefreshConfig {
            token_url: format!("{}{TOKEN_PATH}", self.auth_base),
            resource: None,
        }
    }
}

/// Step 1: get a user code.
pub async fn start(cfg: &XaiOAuthConfig, client: &reqwest::Client) -> Result<DeviceCode, Error> {
    let client_id = cfg.require_client_id()?;
    request_device_code(
        client,
        &format!("{}{DEVICE_PATH}", cfg.auth_base),
        client_id,
        &cfg.scopes,
    )
    .await
}

/// Step 2: wait for approval and build the token record.
pub async fn finish(
    cfg: &XaiOAuthConfig,
    client: &reqwest::Client,
    dc: &DeviceCode,
    cancel: Arc<Notify>,
) -> Result<OAuthTokens, Error> {
    let client_id = cfg.require_client_id()?.to_owned();
    let resp = poll_device_token(
        client,
        &format!("{}{TOKEN_PATH}", cfg.auth_base),
        &client_id,
        dc,
        cancel,
    )
    .await?;
    let mut tokens = OAuthTokens {
        client_id,
        ..OAuthTokens::default()
    };
    tokens.apply_response(&resp, now_unix());
    // Device flow has no nonce; the ID token came straight from the token endpoint
    // over TLS. Only the issuer is checked before reading identity claims.
    if let Some(claims) = resp.id_token.as_deref().and_then(jwt_claims) {
        if claims["iss"].as_str() == Some(cfg.auth_base.as_str()) {
            tokens.apply_identity(&claims);
        }
    }
    if tokens.email.is_none() {
        tokens.email = userinfo_email(cfg, client, &tokens.access_token).await;
    }
    tokens.plan_usage = true;
    Ok(tokens)
}

async fn userinfo_email(
    cfg: &XaiOAuthConfig,
    client: &reqwest::Client,
    token: &str,
) -> Option<String> {
    let r = client
        .get(format!("{}{USERINFO_PATH}", cfg.auth_base))
        .bearer_auth(token)
        .send()
        .await
        .ok()?;
    if !r.status().is_success() {
        return None;
    }
    let v: serde_json::Value = r.json().await.ok()?;
    v["email"].as_str().map(str::to_owned)
}

/// Revoke the refresh (or access) token.
pub async fn revoke(
    cfg: &XaiOAuthConfig,
    client: &reqwest::Client,
    tokens: &OAuthTokens,
) -> Result<(), Error> {
    let (token, hint) = match tokens.refresh_token.as_deref() {
        Some(r) => (r, "refresh_token"),
        None => (tokens.access_token.as_str(), "access_token"),
    };
    let r = client
        .post(format!("{}{REVOKE_PATH}", cfg.auth_base))
        .form(&[
            ("token", token),
            ("token_type_hint", hint),
            ("client_id", tokens.client_id.as_str()),
        ])
        .send()
        .await?;
    if r.status().is_success() {
        Ok(())
    } else {
        Err(Error::Http {
            status: r.status().as_u16(),
            body: crate::http::scrub(&r.text().await.unwrap_or_default()),
        })
    }
}

/// The xAI image provider on the subscription token.
pub fn build_provider(session: Arc<OAuthSession>, cfg: &XaiOAuthConfig) -> SharedProvider {
    let api_base = cfg.api_base.clone();
    let factory: ProviderFactory = Arc::new(move |auth| {
        let p = XaiProvider::new(auth)?;
        Ok(Arc::new(match &api_base {
            Some(b) => p.with_base_url(b),
            None => p,
        }) as SharedProvider)
    });
    Arc::new(BearerOAuthProvider::new(
        ProviderId::XAi,
        session,
        factory,
        capabilities_for(&ProviderId::XAi),
        IMAGES_NOT_ELIGIBLE,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_id_is_config_only() {
        let cfg = XaiOAuthConfig::local("http://x", None);
        assert_eq!(
            cfg.require_client_id().expect_err("none").code(),
            "ai_oauth_unavailable"
        );
        let cfg = XaiOAuthConfig::local("http://x", Some("pf-client"));
        assert_eq!(cfg.require_client_id().expect("set"), "pf-client");
        assert!(cfg.refresh_config().token_url.ends_with("/oauth2/token"));
        assert!(cfg.refresh_config().resource.is_none());
        assert!(DEFAULT_SCOPES.contains("offline_access"));
        // No client id literal ships in this module.
        assert!(!include_str!("xai_device.rs").contains(concat!("b1a0", "0492")));
    }
}
