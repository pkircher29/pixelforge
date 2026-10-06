mod common;

use base64::Engine as _;
use common::*;
use pf_ai::providers::xai::XaiProvider;
use pf_ai::{
    EditRequest, Error, GenerateRequest, ImageBytes, ImageProvider, ImageSize, ProviderId,
};
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn provider(server: &MockServer) -> XaiProvider {
    XaiProvider::new(auth())
        .expect("client")
        .with_base_url(&server.uri())
}

#[tokio::test]
async fn generate_sends_json_with_aspect_resolution_and_b64() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .and(header(
            "authorization",
            format!("Bearer {TEST_KEY}").as_str(),
        ))
        .and(header("content-type", "application/json"))
        .and(body_partial_json(serde_json::json!({
            "model": "grok-imagine-image-2.0",
            "prompt": "a neon anvil",
            "n": 1,
            "response_format": "b64_json",
            "aspect_ratio": "16:9",
            "resolution": "1.5k",
            "quality": "low"
        })))
        .and(BodyLacks("\"image\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture_json("xai_generate.json")))
        .expect(1)
        .mount(&server)
        .await;

    let results = provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "a neon anvil".into(),
            size: Some(ImageSize::new(1536, 864)),
            quality: Some("low".into()),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].provider, ProviderId::XAi);
    assert_eq!(results[0].model, "grok-imagine-image-2.0");
    assert_eq!((results[0].width, results[0].height), (1, 1));
    assert_eq!(results[0].cost_usd, Some(0.04));
}

#[tokio::test]
async fn instruct_edit_sends_single_image_object_as_data_url() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/edits"))
        .and(header(
            "authorization",
            format!("Bearer {TEST_KEY}").as_str(),
        ))
        .and(body_partial_json(serde_json::json!({
            "model": "grok-imagine-image-2.0",
            "prompt": "pencil sketch",
            "response_format": "b64_json",
            "image": { "type": "image_url" }
        })))
        .and(JsonPredicate(|v| {
            v["image"]["url"]
                .as_str()
                .is_some_and(|u| u.starts_with("data:image/png;base64,"))
                && v.get("images").is_none()
                && v.get("aspect_ratio").is_none()
        }))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture_json("xai_edit.json")))
        .expect(1)
        .mount(&server)
        .await;

    let req = EditRequest::instruct(
        "pencil sketch",
        ImageBytes::png(png(16, 16, [9, 9, 9, 255])),
    );
    let results = provider(&server).await.edit(req).await.expect("ok");
    assert_eq!(results.len(), 1);
}

#[tokio::test]
async fn multi_reference_edit_uses_images_array() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/edits"))
        .and(JsonPredicate(|v| {
            let imgs = v["images"].as_array();
            imgs.is_some_and(|a| {
                a.len() == 3
                    && a.iter().all(|i| i["type"] == "image_url")
                    && a[1]["url"]
                        .as_str()
                        .is_some_and(|u| u.starts_with("data:image/jpeg;base64,"))
            }) && v.get("image").is_none()
                && v["prompt"] == "put <IMAGE_1> on <IMAGE_0>"
                && v["resolution"] == "2k"
        }))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture_json("xai_edit.json")))
        .expect(1)
        .mount(&server)
        .await;

    let mut req = EditRequest::instruct(
        "put <IMAGE_1> on <IMAGE_0>",
        ImageBytes::png(png(16, 16, [9, 9, 9, 255])),
    );
    req.reference_images = vec![
        ImageBytes {
            data: jpeg(8, 8),
            mime: "image/jpeg".into(),
        },
        ImageBytes::png(png(4, 4, [0; 4])),
    ];
    req.size = Some(ImageSize::new(2048, 2048));
    provider(&server).await.edit(req).await.expect("ok");
}

#[tokio::test]
async fn mask_edit_webp_and_too_many_refs_are_rejected_locally() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    let p = provider(&server).await;

    let img = ImageBytes::png(png(4, 4, [0; 4]));
    let err = p
        .edit(EditRequest::masked("x", img.clone(), img.clone()))
        .await
        .expect_err("no mask support");
    assert!(matches!(
        err,
        Error::Unsupported {
            capability: "mask edit",
            ..
        }
    ));

    let err = p
        .edit(EditRequest::instruct(
            "x",
            ImageBytes {
                data: webp(4, 4),
                mime: "image/webp".into(),
            },
        ))
        .await
        .expect_err("webp");
    assert!(err.to_string().contains("PNG or JPEG"));

    let mut req = EditRequest::instruct("x", img.clone());
    req.reference_images = vec![img; 5];
    let err = p.edit(req).await.expect_err("6 images");
    assert!(err.to_string().contains("exceed the 5"));

    let mut big = vec![0u8; 20 * 1024 * 1024 + 1];
    big[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let err = p
        .edit(EditRequest::instruct("x", ImageBytes::png(big)))
        .await
        .expect_err("over 20 MiB");
    assert!(err.to_string().contains("20 MiB"));
}

#[tokio::test]
async fn error_mapping() {
    let server = MockServer::start().await;
    let p = provider(&server).await;
    let gen = || GenerateRequest {
        prompt: "x".into(),
        ..GenerateRequest::default()
    };

    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "3")
                .set_body_json(fixture_json("xai_error_429.json")),
        )
        .mount(&server)
        .await;
    assert!(matches!(
        p.generate(gen()).await.expect_err("429"),
        Error::RateLimited {
            retry_after_secs: Some(3)
        }
    ));
    server.reset().await;

    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(fixture_json("xai_error_moderation.json")),
        )
        .mount(&server)
        .await;
    match p.generate(gen()).await.expect_err("moderation") {
        Error::Moderation {
            provider, message, ..
        } => {
            assert_eq!(provider, ProviderId::XAi);
            assert!(message.contains("Content moderation"));
        }
        other => panic!("expected moderation, got {other:?}"),
    }
    server.reset().await;

    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(serde_json::json!({"error": "Invalid API key"})),
        )
        .mount(&server)
        .await;
    let err = p.generate(gen()).await.expect_err("403");
    assert_eq!(err.code(), "ai_auth");
    assert!(err.to_string().contains("Invalid API key"));
}

#[tokio::test]
async fn jpeg_results_are_normalised_to_png() {
    let server = MockServer::start().await;
    let jpg = jpeg(5, 7);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpg);
    Mock::given(path("/v1/images/generations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "b64_json": b64, "mime_type": "image/jpeg" }],
            "model": "grok-imagine-image"
        })))
        .mount(&server)
        .await;
    let results = provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "x".into(),
            model: Some("grok-imagine-image".into()),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    let r = &results[0];
    assert_eq!(r.image.mime, "image/png");
    assert!(r.image.data.starts_with(b"\x89PNG"));
    assert_eq!((r.width, r.height), (5, 7));
    assert_eq!(r.cost_usd, Some(0.02));
    assert_eq!(r.model, "grok-imagine-image");
}

#[tokio::test]
async fn url_only_response_is_rejected() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/images/generations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "url": "https://example.com/tmp.png" }]
        })))
        .mount(&server)
        .await;
    let err = provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("url only");
    assert_eq!(err.code(), "ai_invalid_response");
}

#[tokio::test]
async fn test_key_lists_models() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .and(header(
            "authorization",
            format!("Bearer {TEST_KEY}").as_str(),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": []})))
        .expect(1)
        .mount(&server)
        .await;
    provider(&server).await.test_key().await.expect("ok");
}
