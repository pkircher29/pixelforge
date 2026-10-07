//! Subscription sign-in against wiremock: SIWC code exchange, refresh (proactive, after a
//! 401, and dead refresh tokens), Responses streaming for text and images, the
//! not-eligible / plan-limit mapping, the xAI device flow and the API-key fallback.
//! No live network.
mod common;

use std::sync::Arc;

use common::*;
use pf_ai::oauth::openai_siwc::{
    self, check_images_live, exchange_code, list_models, prompt_assist, AuthorizeRequest,
    SiwcConfig, SiwcProvider,
};
use pf_ai::oauth::{
    load_tokens, save_tokens, xai_device, CallbackParams, OAuthSession, OAuthTokens, Pkce,
    PlanFallbackProvider, PlanModel,
};
use pf_ai::{
    build_provider_with_base_url, EditRequest, FileStore, GenerateRequest, ImageBytes,
    ImageProvider, KeyStore, ProviderId, SecretString,
};
use serde_json::json;
use tokio::sync::Notify;
use wiremock::matchers::{body_partial_json, body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn jwt(claims: serde_json::Value) -> String {
    use base64::Engine as _;
    let e = |v: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v);
    format!(
        "{}.{}.sig",
        e(br#"{"alg":"RS256","typ":"JWT"}"#),
        e(claims.to_string().as_bytes())
    )
}

fn models() -> Vec<PlanModel> {
    vec![PlanModel {
        slug: "gpt-5.5".into(),
        display_name: "GPT-5.5".into(),
    }]
}

fn tokens(access: &str, expires_at: u64) -> OAuthTokens {
    OAuthTokens {
        access_token: access.into(),
        refresh_token: Some("refresh-1".into()),
        expires_at,
        client_id: "oaiapp_1".into(),
        plan_usage: true,
        models: models(),
        ..OAuthTokens::default()
    }
}

fn far() -> u64 {
    pf_ai::oauth::now_unix() + 3600
}

fn session(server: &MockServer, store: Arc<FileStore>, t: OAuthTokens) -> Arc<OAuthSession> {
    let cfg = SiwcConfig::local(&server.uri());
    OAuthSession::new(
        ProviderId::OpenAi,
        store,
        reqwest::Client::new(),
        cfg.refresh_config(),
        t,
    )
}

fn sse(events: &[serde_json::Value]) -> String {
    events
        .iter()
        .map(|e| {
            format!(
                "event: {}\ndata: {e}\n\n",
                e["type"].as_str().unwrap_or("message")
            )
        })
        .collect()
}

fn sse_response(events: &[serde_json::Value]) -> ResponseTemplate {
    ResponseTemplate::new(200)
        .insert_header("content-type", "text/event-stream")
        .set_body_string(sse(events))
}

fn text_stream(text: &str) -> ResponseTemplate {
    sse_response(&[
        json!({"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}),
        json!({"type":"response.output_text.delta","delta": text}),
        json!({"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[]}}),
    ])
}

#[tokio::test]
async fn code_exchange_validates_id_token_and_records_plan_scope() {
    let server = MockServer::start().await;
    let cfg = SiwcConfig::local(&server.uri());
    let pkce = Pkce::generate();
    let id_token = jwt(
        json!({ "iss": server.uri(), "aud": "oaiapp_1", "nonce": "NONCE", "sub": "user-1", "email": "paul@example.com", "exp": far() }),
    );
    Mock::given(method("POST"))
        .and(path("/api/accounts/oauth/token"))
        .and(body_string_contains("grant_type=authorization_code"))
        .and(body_string_contains("client_id=oaiapp_1"))
        .and(body_string_contains(format!("code_verifier={}", pkce.verifier)))
        .and(body_string_contains("code=CODE"))
        .and(body_string_contains("resource=https%3A%2F%2Fapi.openai.com%2Fv1"))
        .and(body_string_contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A4444%2Fcallback"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "AT1", "refresh_token": "RT1", "id_token": id_token, "token_type": "Bearer",
            "expires_in": 3600, "scope": "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let req = AuthorizeRequest {
        url: String::new(),
        state: "S".into(),
        nonce: "NONCE".into(),
        pkce,
        redirect_uri: "http://127.0.0.1:4444/callback".into(),
        client_id: openai_siwc::DYNAMIC_CLIENT_ID.into(),
    };
    let cb = CallbackParams {
        code: "CODE".into(),
        client_id: Some("oaiapp_1".into()),
        scope: None,
    };
    let t = exchange_code(&cfg, &reqwest::Client::new(), &req, &cb)
        .await
        .expect("exchange");
    assert_eq!(t.access_token, "AT1");
    assert_eq!(t.client_id, "oaiapp_1");
    assert_eq!(t.email.as_deref(), Some("paul@example.com"));
    assert!(t.plan_usage);
    assert!(t.expires_at > pf_ai::oauth::now_unix() + 3000);

    // Without the issued client_id in the callback a dynamic registration cannot finish.
    let cb = CallbackParams {
        client_id: None,
        ..cb
    };
    let e = exchange_code(&cfg, &reqwest::Client::new(), &req, &cb)
        .await
        .expect_err("no client id");
    assert_eq!(e.code(), "ai_oauth_callback");
}

#[tokio::test]
async fn id_token_with_wrong_nonce_is_rejected() {
    let server = MockServer::start().await;
    let cfg = SiwcConfig::local(&server.uri());
    let id_token = jwt(json!({ "iss": server.uri(), "aud": "oaiapp_1", "nonce": "OTHER" }));
    Mock::given(method("POST"))
        .and(path("/api/accounts/oauth/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "AT", "id_token": id_token, "expires_in": 3600, "scope": "openid email" })))
        .mount(&server)
        .await;
    let req = AuthorizeRequest {
        url: String::new(),
        state: "S".into(),
        nonce: "NONCE".into(),
        pkce: Pkce::generate(),
        redirect_uri: "http://127.0.0.1:1/callback".into(),
        client_id: "oaiapp_1".into(),
    };
    let cb = CallbackParams {
        code: "C".into(),
        client_id: None,
        scope: None,
    };
    let e = exchange_code(&cfg, &reqwest::Client::new(), &req, &cb)
        .await
        .expect_err("nonce");
    assert_eq!(e.code(), "ai_oauth_id_token");
}

#[tokio::test]
async fn proactive_refresh_rotates_and_persists() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(FileStore::new(dir.path()));
    Mock::given(method("POST"))
        .and(path("/api/accounts/oauth/token"))
        .and(body_string_contains("grant_type=refresh_token"))
        .and(body_string_contains("client_id=oaiapp_1"))
        .and(body_string_contains("refresh_token=refresh-1"))
        .and(body_string_contains("resource="))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "access_token": "AT-NEW", "refresh_token": "refresh-2", "expires_in": 3600 }),
        ))
        .expect(1)
        .mount(&server)
        .await;
    // Expires in 30 s: inside the 120 s skew, so the first use refreshes.
    let s = session(
        &server,
        Arc::clone(&store),
        tokens("AT-OLD", pf_ai::oauth::now_unix() + 30),
    );
    assert_eq!(s.access_token().await.expect("token").expose(), "AT-NEW");
    // Second call reuses it (expect(1) above).
    assert_eq!(s.access_token().await.expect("token").expose(), "AT-NEW");
    let saved = load_tokens(store.as_ref(), &ProviderId::OpenAi)
        .expect("load")
        .expect("saved");
    assert_eq!(saved.access_token, "AT-NEW");
    assert_eq!(saved.refresh_token.as_deref(), Some("refresh-2"));
}

#[tokio::test]
async fn dead_refresh_token_signs_out() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(FileStore::new(dir.path()));
    let t = tokens("AT-OLD", 1);
    save_tokens(store.as_ref(), &ProviderId::OpenAi, &t).expect("seed");
    Mock::given(method("POST"))
        .and(path("/api/accounts/oauth/token"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(json!({ "error": "refresh_token_reused" })),
        )
        .mount(&server)
        .await;
    let s = session(&server, Arc::clone(&store), t);
    let e = s.access_token().await.expect_err("reauth");
    assert_eq!(e.code(), "ai_oauth_reauth");
    assert!(load_tokens(store.as_ref(), &ProviderId::OpenAi)
        .expect("load")
        .is_none());
}

#[tokio::test]
async fn prompt_assist_401_refreshes_once_and_retries() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let store = Arc::new(FileStore::new(dir.path()));
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .and(header("authorization", "Bearer AT-OLD"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({ "error": { "message": "token expired" } })),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/accounts/oauth/token"))
        .and(body_string_contains("grant_type=refresh_token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "access_token": "AT-NEW", "expires_in": 3600 })),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .and(header("authorization", "Bearer AT-NEW"))
        .and(body_partial_json(
            json!({ "model": "gpt-5.5", "store": false, "stream": true }),
        ))
        .respond_with(text_stream(
            "A neon anvil on a rain-soaked street, cinematic lighting",
        ))
        .expect(1)
        .mount(&server)
        .await;
    let s = session(&server, store, tokens("AT-OLD", far()));
    let cfg = SiwcConfig::local(&server.uri());
    let out = prompt_assist(
        &s,
        &cfg,
        "gpt-5.5",
        "anvil",
        Some(&ImageBytes::png(tiny_png())),
    )
    .await
    .expect("assist");
    assert!(out.starts_with("A neon anvil"));
    let reqs = server.received_requests().await.expect("recorded");
    let last: serde_json::Value =
        serde_json::from_slice(&reqs.last().expect("req").body).expect("json");
    assert!(last.get("temperature").is_none() && last.get("max_output_tokens").is_none());
    assert!(last["instructions"].is_string());
    assert_eq!(last["input"][0]["content"][1]["type"], "input_image");
}

fn tiny_png() -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(TINY_PNG_B64)
        .expect("fixture")
}

#[tokio::test]
async fn images_are_refused_locally_when_not_eligible() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("tempdir");
    let s = session(
        &server,
        Arc::new(FileStore::new(dir.path())),
        tokens("AT", far()),
    );
    let p = SiwcProvider::new(s, SiwcConfig::local(&server.uri()), models(), false);
    let e = p
        .generate(GenerateRequest {
            prompt: "a cat".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("not eligible");
    assert_eq!(e.code(), "ai_plan_not_eligible");
    assert!(e.to_string().contains("use an API key for images"));
    let e = p
        .edit(EditRequest::instruct(
            "make it blue",
            ImageBytes::png(tiny_png()),
        ))
        .await
        .expect_err("not eligible");
    assert_eq!(e.code(), "ai_plan_not_eligible");
}

#[tokio::test]
async fn live_check_maps_unsupported_capability_to_not_eligible() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .and(body_partial_json(json!({ "tools": [{ "type": "image_generation" }] })))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({ "error": { "code": "subscription_sharing_unsupported_capability", "message": "image_generation is not available with ChatGPT plan usage" } })))
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("tempdir");
    let s = session(
        &server,
        Arc::new(FileStore::new(dir.path())),
        tokens("AT", far()),
    );
    let access = check_images_live(&s, &SiwcConfig::local(&server.uri()), &models())
        .await
        .expect("checked");
    assert!(!access.eligible);
    assert_eq!(access.source, "live");
    assert!(access.detail.contains("use an API key for images"));
}

#[tokio::test]
async fn eligible_account_gets_images_from_the_stream_including_native_mask() {
    let server = MockServer::start().await;
    let b64 = TINY_PNG_B64;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(sse_response(&[
            json!({"type":"response.created","response":{"id":"r"}}),
            json!({"type":"response.image_generation_call.in_progress","item_id":"ig_1"}),
            json!({"type":"response.image_generation_call.partial_image","item_id":"ig_1","partial_image_index":0,"partial_image_b64": b64}),
            json!({"type":"response.output_item.done","output_index":0,"item":{"id":"ig_1","type":"image_generation_call","status":"completed","revised_prompt":"a cat, studio light","result": b64}}),
            json!({"type":"response.completed","response":{"id":"r","status":"completed","output":[{"id":"ig_1","type":"image_generation_call","result": b64}]}}),
        ]))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("tempdir");
    let s = session(
        &server,
        Arc::new(FileStore::new(dir.path())),
        tokens("AT", far()),
    );
    let p = SiwcProvider::new(s, SiwcConfig::local(&server.uri()), models(), true);
    let out = p
        .generate(GenerateRequest {
            prompt: "a cat".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect("image");
    assert_eq!(out.len(), 1);
    assert_eq!((out[0].width, out[0].height), (1, 1));
    assert_eq!(
        out[0].revised_prompt.as_deref(),
        Some("a cat, studio light")
    );
    assert_eq!(out[0].model, "gpt-5.5");

    let img = png(16, 16, [10, 20, 30, 255]);
    let mask = mask_png(16, 16, (0, 0, 8, 8), 255);
    p.edit(EditRequest::masked(
        "fill",
        ImageBytes::png(img),
        ImageBytes::png(mask),
    ))
    .await
    .expect("masked edit");
    let reqs = server.received_requests().await.expect("recorded");
    let body: serde_json::Value =
        serde_json::from_slice(&reqs.last().expect("req").body).expect("json");
    let tool = &body["tools"][0];
    assert_eq!(tool["type"], "image_generation");
    assert_eq!(tool["action"], "edit");
    assert!(tool["input_image_mask"]["image_url"]
        .as_str()
        .expect("mask")
        .starts_with("data:image/png;base64,"));
    assert_eq!(body["input"][0]["content"][1]["type"], "input_image");
    assert_eq!(body["store"], false);
    assert_eq!(body["stream"], true);
}

#[tokio::test]
async fn usage_limit_mid_stream_and_upfront_map_to_plan_limit() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(sse_response(&[
            json!({"type":"response.created","response":{"id":"r"}}),
            json!({"type":"response.failed","response":{"id":"r","status":"failed","error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Weekly limit reached","resets_at":1791380000u64}}}),
        ]))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("tempdir");
    let s = session(
        &server,
        Arc::new(FileStore::new(dir.path())),
        tokens("AT", far()),
    );
    let e = prompt_assist(&s, &SiwcConfig::local(&server.uri()), "gpt-5.5", "x", None)
        .await
        .expect_err("limit");
    assert_eq!(e.code(), "ai_plan_limit");
    assert!(e.to_string().contains("2026-10-07 13:33 UTC"));
}

#[tokio::test]
async fn stream_without_completed_is_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(sse_response(&[
            json!({"type":"response.output_text.delta","delta":"half"}),
        ]))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("tempdir");
    let s = session(
        &server,
        Arc::new(FileStore::new(dir.path())),
        tokens("AT", far()),
    );
    let e = prompt_assist(&s, &SiwcConfig::local(&server.uri()), "gpt-5.5", "x", None)
        .await
        .expect_err("incomplete");
    assert_eq!(e.code(), "ai_invalid_response");
}

#[tokio::test]
async fn list_models_keeps_listed_entries_only() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .and(header("authorization", "Bearer AT"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "models": [
            { "slug": "gpt-5.5", "display_name": "GPT-5.5", "visibility": "list" },
            { "slug": "internal", "display_name": "Internal", "visibility": "hide" },
            { "slug": "gpt-5.5-mini", "visibility": "list" }
        ] })))
        .mount(&server)
        .await;
    let m = list_models(
        &SiwcConfig::local(&server.uri()),
        &reqwest::Client::new(),
        &SecretString::new("AT"),
    )
    .await
    .expect("models");
    assert_eq!(
        m.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(),
        vec!["gpt-5.5", "gpt-5.5-mini"]
    );
    assert_eq!(m[1].display_name, "gpt-5.5-mini");
}

#[tokio::test]
async fn revoke_posts_the_refresh_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/accounts/oauth/revoke"))
        .and(body_string_contains("token=refresh-1"))
        .and(body_string_contains("token_type_hint=refresh_token"))
        .and(body_string_contains("client_id=oaiapp_1"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    openai_siwc::revoke(
        &SiwcConfig::local(&server.uri()),
        &reqwest::Client::new(),
        &tokens("AT", far()),
    )
    .await
    .expect("revoked");
}

// ------------------------------------------------------------------------ xAI

#[tokio::test]
async fn xai_device_flow_polls_until_approved() {
    let server = MockServer::start().await;
    let cfg = xai_device::XaiOAuthConfig::local(&server.uri(), Some("pf-issued-client"));
    Mock::given(method("POST"))
        .and(path("/oauth2/device/code"))
        .and(body_string_contains("client_id=pf-issued-client"))
        .and(body_string_contains("offline_access"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "device_code": "DEV", "user_code": "WDJB-MJHT", "verification_uri": format!("{}/device", server.uri()),
            "verification_uri_complete": format!("{}/device?user_code=WDJB-MJHT", server.uri()), "expires_in": 60, "interval": 1
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .and(body_string_contains("device_code=DEV"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(json!({ "error": "authorization_pending" })),
        )
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    let id_token = jwt(
        json!({ "iss": server.uri(), "aud": "pf-issued-client", "email": "grok@example.com", "sub": "x1" }),
    );
    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .and(body_string_contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "XAT", "refresh_token": "XRT", "id_token": id_token, "expires_in": 3600 })))
        .with_priority(2)
        .mount(&server)
        .await;
    let client = reqwest::Client::new();
    let dc = xai_device::start(&cfg, &client).await.expect("device code");
    assert_eq!(dc.user_code, "WDJB-MJHT");
    let t = xai_device::finish(&cfg, &client, &dc, Arc::new(Notify::new()))
        .await
        .expect("tokens");
    assert_eq!(t.access_token, "XAT");
    assert_eq!(t.client_id, "pf-issued-client");
    assert_eq!(t.email.as_deref(), Some("grok@example.com"));
}

#[tokio::test]
async fn xai_device_flow_denied_and_unconfigured() {
    let server = MockServer::start().await;
    let none = xai_device::XaiOAuthConfig::local(&server.uri(), None);
    let e = xai_device::start(&none, &reqwest::Client::new())
        .await
        .expect_err("no client");
    assert_eq!(e.code(), "ai_oauth_unavailable");
    assert!(
        server.received_requests().await.expect("rec").is_empty(),
        "nothing sent without a client id"
    );

    let cfg = xai_device::XaiOAuthConfig::local(&server.uri(), Some("pf"));
    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({ "error": "access_denied" })))
        .mount(&server)
        .await;
    let dc = pf_ai::oauth::DeviceCode {
        device_code: "D".into(),
        user_code: "U".into(),
        verification_uri: "v".into(),
        verification_uri_complete: None,
        expires_in: Some(30),
        interval: Some(1),
    };
    let e = xai_device::finish(&cfg, &reqwest::Client::new(), &dc, Arc::new(Notify::new()))
        .await
        .expect_err("denied");
    assert_eq!(e.code(), "ai_oauth_denied");
    let cancel = Arc::new(Notify::new());
    cancel.notify_one();
    let e = xai_device::finish(&cfg, &reqwest::Client::new(), &dc, cancel)
        .await
        .expect_err("cancel");
    assert_eq!(e.code(), "ai_oauth_cancelled");
}

fn xai_session(server: &MockServer, dir: &std::path::Path) -> Arc<OAuthSession> {
    let cfg = xai_device::XaiOAuthConfig::local(&server.uri(), Some("pf"));
    OAuthSession::new(
        ProviderId::XAi,
        Arc::new(FileStore::new(dir)),
        reqwest::Client::new(),
        cfg.refresh_config(),
        OAuthTokens {
            client_id: "pf".into(),
            ..tokens("XAT", far())
        },
    )
}

#[tokio::test]
async fn xai_subscription_bearer_generates_and_maps_rejections() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let cfg = xai_device::XaiOAuthConfig::local(&server.uri(), Some("pf"));
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .and(header("authorization", "Bearer XAT"))
        .and(body_partial_json(json!({ "prompt": "ok" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture_json("xai_generate.json")))
        .mount(&server)
        .await;
    let p = xai_device::build_provider(xai_session(&server, dir.path()), &cfg);
    let out = p
        .generate(GenerateRequest {
            prompt: "ok".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect("image");
    assert_eq!(out[0].provider, ProviderId::XAi);

    // 403 even after a refresh -> not eligible.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(json!({ "error": "not allowed for this account" })),
        )
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "access_token": "XAT2", "expires_in": 3600 })),
        )
        .expect(1)
        .mount(&server)
        .await;
    let cfg = xai_device::XaiOAuthConfig::local(&server.uri(), Some("pf"));
    let p = xai_device::build_provider(xai_session(&server, dir.path()), &cfg);
    let e = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("403");
    assert_eq!(e.code(), "ai_plan_not_eligible");
    assert!(e.to_string().contains("xAI decides which accounts"));

    // 429 -> the plan's limit, with the reset time.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "3600")
                .set_body_json(json!({ "error": "daily limit" })),
        )
        .mount(&server)
        .await;
    let cfg = xai_device::XaiOAuthConfig::local(&server.uri(), Some("pf"));
    let p = xai_device::build_provider(xai_session(&server, dir.path()), &cfg);
    let e = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("429");
    assert_eq!(e.code(), "ai_plan_limit");
    assert!(e.to_string().contains("daily image limits"));
    assert!(e.to_string().contains("resets"));
}

#[tokio::test]
async fn api_key_fallback_only_on_plan_limit() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(ResponseTemplate::new(429).set_body_json(json!({ "error": { "code": "subscription_sharing_usage_limit_exceeded", "message": "cap" } })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .and(header("authorization", format!("Bearer {TEST_KEY}")))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("openai_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("tempdir");
    let s = session(
        &server,
        Arc::new(FileStore::new(dir.path())),
        tokens("AT", far()),
    );
    let plan = Arc::new(SiwcProvider::new(
        s.clone(),
        SiwcConfig::local(&server.uri()),
        models(),
        true,
    ));
    let key = build_provider_with_base_url(&ProviderId::OpenAi, auth(), &server.uri())
        .expect("key provider");
    let p = PlanFallbackProvider::new(plan.clone(), key.clone());
    let out = p
        .generate(GenerateRequest {
            prompt: "a cat".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect("fell back");
    assert!(!out.is_empty());
    // Not-eligible is never re-routed.
    let p = PlanFallbackProvider::new(
        Arc::new(SiwcProvider::new(
            s,
            SiwcConfig::local(&server.uri()),
            models(),
            false,
        )),
        key,
    );
    let e = p
        .generate(GenerateRequest {
            prompt: "a cat".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("no fallback");
    assert_eq!(e.code(), "ai_plan_not_eligible");
}

#[test]
fn file_store_account_api_is_separate_from_provider_keys() {
    let dir = tempfile::tempdir().expect("tempdir");
    let s = FileStore::new(dir.path());
    s.set(&ProviderId::OpenAi, &SecretString::new("sk-key"))
        .expect("key");
    s.set_account("oauth:open_ai", &SecretString::new("{}"))
        .expect("oauth");
    assert_eq!(
        s.get(&ProviderId::OpenAi)
            .expect("get")
            .expect("some")
            .expose(),
        "sk-key"
    );
    s.delete_account("oauth:open_ai").expect("del");
    assert!(s.has(&ProviderId::OpenAi).expect("has"));
}
