mod common;

use pf_ai::oauth::{
    google::{self, GoogleConfig},
    load_tokens, parse_callback, OAuthSession, OAuthTokens,
};
use pf_ai::{FileStore, GenerateRequest, SecretString};
use serde_json::json;
use std::sync::Arc;
use wiremock::matchers::{body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn config(server: &MockServer) -> GoogleConfig {
    let mut cfg = GoogleConfig::new(
        "desktop-client".into(),
        SecretString::new("desktop-secret"),
        "billing-project".into(),
    );
    cfg.token_url = format!("{}/token", server.uri());
    cfg.revoke_url = format!("{}/revoke", server.uri());
    cfg.api_base = Some(server.uri());
    cfg
}

#[tokio::test]
async fn pkce_exchange_refresh_and_image_use_oauth_and_quota_project() {
    let server = MockServer::start().await;
    let cfg = config(&server);
    let auth = google::authorize(&cfg, "http://127.0.0.1:12345/callback").expect("authorize");
    let url = reqwest::Url::parse(&auth.url).expect("url");
    let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
    assert_eq!(params["code_challenge_method"], "S256");
    assert_eq!(params["code_challenge"], auth.pkce.challenge);
    assert_eq!(params["access_type"], "offline");
    assert!(!auth.url.contains("desktop-secret"));
    assert!(!format!("{cfg:?}").contains("desktop-secret"));
    let cb = parse_callback(
        &format!("/callback?code=code1&state={}", auth.state),
        &auth.state,
    )
    .expect("valid state")
    .expect("callback");
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_string_contains("code_verifier="))
        .and(body_string_contains("client_secret=desktop-secret"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token":"expired", "refresh_token":"refresh1", "expires_in":1,
            "scope":google::SCOPE
        })))
        .expect(1)
        .mount(&server)
        .await;
    let tokens = google::exchange(&cfg, &reqwest::Client::new(), &auth, &cb)
        .await
        .expect("exchange");
    assert!(!tokens.plan_usage);
    assert!(!format!("{tokens:?}").contains("desktop-secret"));
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_string_contains("grant_type=refresh_token"))
        .and(body_string_contains("client_secret=desktop-secret"))
        .and(body_string_contains("refresh_token=refresh1"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"access_token":"fresh", "expires_in":3600})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(
            "/v1beta/models/gemini-3.1-flash-image:generateContent",
        ))
        .and(header("authorization", "Bearer fresh"))
        .and(header("x-goog-user-project", "billing-project"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(common::fixture_json("gemini_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("temp");
    let store = Arc::new(FileStore::new(dir.path()));
    let session = OAuthSession::new(
        pf_ai::ProviderId::Gemini,
        store.clone(),
        reqwest::Client::new(),
        cfg.refresh_config(),
        tokens,
    );
    let provider = google::build_provider(session, cfg.clone());
    assert_eq!(
        provider
            .generate(GenerateRequest {
                prompt: "test".into(),
                ..Default::default()
            })
            .await
            .expect("image")
            .len(),
        1
    );
    let saved = load_tokens(store.as_ref(), &pf_ai::ProviderId::Gemini)
        .expect("load")
        .expect("saved");
    assert_eq!(saved.refresh_token.as_deref(), Some("refresh1"));
    assert_eq!(saved.client_secret.as_deref(), Some("desktop-secret"));
    let requests = server.received_requests().await.expect("requests");
    assert!(requests
        .iter()
        .all(|r| !r.headers.contains_key("x-goog-api-key")));
    Mock::given(method("POST"))
        .and(path("/revoke"))
        .and(body_string_contains("token=refresh1"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    google::revoke(&cfg, &reqwest::Client::new(), &saved)
        .await
        .expect("revoke");
}

#[tokio::test]
async fn api_quota_error_is_not_a_subscription_limit() {
    let server = MockServer::start().await;
    let cfg = config(&server);
    Mock::given(method("POST"))
        .and(path(
            "/v1beta/models/gemini-3.1-flash-image:generateContent",
        ))
        .respond_with(
            ResponseTemplate::new(429).set_body_json(json!({"error":{"message":"quota"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("temp");
    let tokens = OAuthTokens {
        access_token: "access".into(),
        expires_at: u64::MAX,
        ..Default::default()
    };
    let session = OAuthSession::new(
        pf_ai::ProviderId::Gemini,
        Arc::new(FileStore::new(dir.path())),
        reqwest::Client::new(),
        cfg.refresh_config(),
        tokens,
    );
    let result = google::build_provider(session, cfg)
        .generate(GenerateRequest {
            prompt: "test".into(),
            ..Default::default()
        })
        .await;
    assert!(matches!(result, Err(pf_ai::Error::RateLimited { .. })));
}

#[test]
fn incomplete_configuration_and_wrong_state_fail_closed() {
    let cfg = GoogleConfig::new(String::new(), SecretString::new(""), String::new());
    assert!(google::authorize(&cfg, "http://127.0.0.1:1234/callback").is_err());
    assert!(parse_callback("/callback?code=stolen&state=wrong", "expected").is_err());
}
