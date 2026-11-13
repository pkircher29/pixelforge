mod common;

use common::*;
use pf_ai::custom::{CustomKind, CustomProvider, SamplingOptions};
use pf_ai::providers::custom::{fal::FalProvider, Ctx};
use pf_ai::{EditRequest, GenerateRequest, ImageBytes, ImageProvider, ImageSize, SecretString};
use serde_json::json;
use std::time::Duration;
use wiremock::matchers::{body_partial_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn provider(server: &MockServer) -> FalProvider {
    let mut cfg = CustomProvider::new("fal-test", "fal test", CustomKind::Fal);
    cfg.base_url = server.uri();
    cfg = cfg
        .with_sampling(SamplingOptions {
            seed: Some(0),
            steps: Some(27),
        })
        .unwrap();
    FalProvider::new(Ctx::new(cfg, Some(SecretString::new(TEST_KEY))).unwrap())
        .unwrap()
        .with_poll_interval(Duration::from_millis(1))
}

fn accepted(server: &MockServer) -> serde_json::Value {
    json!({ "request_id": "R", "status_url": format!("{}/requests/R/status", server.uri()),
        "response_url": format!("{}/requests/R", server.uri()), "cancel_url": format!("{}/requests/R/cancel", server.uri()) })
}

async fn submitted(server: &MockServer) {
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(accepted(server)))
        .expect(1)
        .mount(server)
        .await;
}

async fn wait_for_cancel(server: &MockServer) {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .any(|r| r.method.as_str() == "PUT")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("remote cancellation");
}

#[tokio::test]
async fn generates_polls_and_downloads_without_forwarding_key() {
    let server = MockServer::start().await;
    let cdn = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/fal-ai/flux/dev"))
        .and(header("authorization", format!("Key {TEST_KEY}")))
        .and(body_partial_json(
            json!({ "prompt": "a fox", "num_images": 2, "seed": 0,
            "num_inference_steps": 27, "image_size": { "width": 512, "height": 512 } }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(accepted(&server)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/requests/R/status"))
        .and(header("authorization", format!("Key {TEST_KEY}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "status": "IN_QUEUE" })))
        .up_to_n_times(1)
        .with_priority(1)
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/requests/R/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "status": "COMPLETED" })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/requests/R")).and(header("authorization", format!("Key {TEST_KEY}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "images": [
            { "url": format!("{}/image.png", cdn.uri()) }, { "url": format!("data:image/png;base64,{TINY_PNG_B64}") }
        ] }))).expect(1).mount(&server).await;
    Mock::given(path("/image.png"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(png(3, 2, [12, 30, 90, 255])))
        .expect(1)
        .mount(&cdn)
        .await;
    let results = provider(&server)
        .generate(GenerateRequest {
            prompt: "a fox".into(),
            n: 2,
            size: Some(ImageSize::square(512)),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!((results[0].width, results[0].height), (3, 2));
    assert_eq!((results[1].width, results[1].height), (1, 1));
    assert!(!cdn.received_requests().await.unwrap()[0]
        .headers
        .contains_key("authorization"));
    assert!(!server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .any(|r| r.method.as_str() == "PUT"));
}

#[tokio::test]
async fn edits_use_the_separate_endpoint_and_data_uri() {
    let server = MockServer::start().await;
    Mock::given(method("POST")).and(path("/fal-ai/flux/dev/image-to-image"))
        .and(body_partial_json(json!({ "image_url": format!("data:image/png;base64,{TINY_PNG_B64}"), "prompt": "night", "num_images": 1 })))
        .respond_with(ResponseTemplate::new(200).set_body_json(accepted(&server))).expect(1).mount(&server).await;
    Mock::given(path("/requests/R/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "status": "COMPLETED" })))
        .mount(&server)
        .await;
    Mock::given(path("/requests/R"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "images": [{"url":format!("data:image/png;base64,{TINY_PNG_B64}")}]}),
        ))
        .mount(&server)
        .await;
    use base64::Engine as _;
    let image = base64::engine::general_purpose::STANDARD
        .decode(TINY_PNG_B64)
        .unwrap();
    let result = provider(&server)
        .edit(EditRequest::instruct("night", ImageBytes::png(image)))
        .await
        .unwrap();
    assert_eq!(result[0].model, "fal-ai/flux/dev/image-to-image");
}

#[tokio::test]
async fn completed_queue_errors_and_submission_errors_are_not_retried() {
    for (status, body, code) in [
        (401, json!({"detail":"Invalid key"}), "ai_auth"),
        (
            402,
            json!({"error":{"message":"Insufficient credits", "code":"insufficient_quota"}}),
            "ai_quota",
        ),
        (
            422,
            json!({"detail":"Invalid image size"}),
            "ai_bad_request",
        ),
        (
            429,
            json!({"detail":"Too many requests"}),
            "ai_rate_limited",
        ),
    ] {
        let server = MockServer::start().await;
        submitted(&server).await;
        Mock::given(path("/requests/R/status"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"status":"COMPLETED","error":"failed"})),
            )
            .mount(&server)
            .await;
        Mock::given(path("/requests/R"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .expect(1)
            .mount(&server)
            .await;
        let error = provider(&server)
            .generate(GenerateRequest {
                prompt: "fox".into(),
                ..Default::default()
            })
            .await
            .unwrap_err();
        assert_eq!(error.code(), code);
    }
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({"detail":"Invalid key"})))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        provider(&server)
            .generate(GenerateRequest {
                prompt: "fox".into(),
                ..Default::default()
            })
            .await
            .unwrap_err()
            .code(),
        "ai_auth"
    );
}

#[tokio::test]
async fn dropped_and_timed_out_jobs_request_remote_cancel() {
    for abort in [true, false] {
        let server = MockServer::start().await;
        submitted(&server).await;
        Mock::given(path("/requests/R/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status":"IN_PROGRESS"})))
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path("/requests/R/cancel"))
            .and(header("authorization", format!("Key {TEST_KEY}")))
            .respond_with(
                ResponseTemplate::new(202)
                    .set_body_json(json!({"status":"CANCELLATION_REQUESTED"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let p = provider(&server);
        if abort {
            let task = tokio::spawn(async move {
                p.generate(GenerateRequest {
                    prompt: "fox".into(),
                    ..Default::default()
                })
                .await
            });
            tokio::time::timeout(Duration::from_secs(3), async {
                while !server
                    .received_requests()
                    .await
                    .unwrap()
                    .iter()
                    .any(|r| r.url.path().ends_with("/status"))
                {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            task.abort();
            let _ = task.await;
        } else {
            assert!(tokio::time::timeout(
                Duration::from_millis(100),
                p.generate(GenerateRequest {
                    prompt: "fox".into(),
                    ..Default::default()
                })
            )
            .await
            .is_err());
        }
        wait_for_cancel(&server).await;
    }
}

#[tokio::test]
async fn refuses_untrusted_queue_urls_and_invalid_model_paths() {
    let server = MockServer::start().await;
    let untrusted = MockServer::start().await;
    let mut body = accepted(&server);
    body["status_url"] = format!("{}/steal", untrusted.uri()).into();
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(202))
        .mount(&server)
        .await;
    assert!(provider(&server)
        .generate(GenerateRequest {
            prompt: "fox".into(),
            ..Default::default()
        })
        .await
        .unwrap_err()
        .to_string()
        .contains("outside"));
    wait_for_cancel(&server).await;
    assert!(untrusted.received_requests().await.unwrap().is_empty());
    for model in [
        "../escape",
        "https://evil.test/model",
        "fal-ai/flux?query=1",
        "fal-ai//flux",
    ] {
        assert_eq!(
            provider(&server)
                .generate(GenerateRequest {
                    prompt: "fox".into(),
                    model: Some(model.into()),
                    ..Default::default()
                })
                .await
                .unwrap_err()
                .code(),
            "ai_invalid_request"
        );
    }
}

#[tokio::test]
async fn probe_reads_authenticated_pricing_without_starting_jobs() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/v1/models/pricing")).and(query_param("endpoint_id", "fal-ai/flux/dev"))
        .and(header("authorization", format!("Key {TEST_KEY}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"prices":[{"endpoint_id":"fal-ai/flux/dev","unit_price":0.025,"unit":"image","currency":"USD"}]})))
        .expect(1).mount(&server).await;
    let result = provider(&server).probe().await.unwrap();
    assert!(result.reachable);
    assert!(!result.auth_failed);
    assert!(result.message.contains("have not been tested"));
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}
