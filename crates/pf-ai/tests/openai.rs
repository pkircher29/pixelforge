mod common;

use common::*;
use pf_ai::providers::openai::OpenAiProvider;
use pf_ai::{
    EditRequest, Error, GenerateRequest, ImageBytes, ImageProvider, ImageSize, ProviderId,
};
use wiremock::matchers::{body_partial_json, header, header_regex, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn provider(server: &MockServer) -> OpenAiProvider {
    OpenAiProvider::new(auth())
        .expect("client")
        .with_base_url(&server.uri())
}

#[tokio::test]
async fn generate_sends_json_with_bearer_and_decodes_fixture() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .and(header(
            "authorization",
            format!("Bearer {TEST_KEY}").as_str(),
        ))
        .and(header("content-type", "application/json"))
        .and(body_partial_json(serde_json::json!({
            "model": "gpt-image-2.5-flare",
            "prompt": "a tiny red cube\n\nDo not include: blue",
            "n": 2,
            "size": "1536x1024",
            "output_format": "png",
            "quality": "high",
            "background": "transparent"
        })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("openai_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;

    let results = provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "a tiny red cube".into(),
            negative_prompt: Some("blue".into()),
            size: Some(ImageSize::new(1536, 1024)),
            n: 2,
            quality: Some("high".into()),
            transparent: true,
            ..GenerateRequest::default()
        })
        .await
        .expect("generate ok");

    assert_eq!(results.len(), 2);
    let r = &results[0];
    assert_eq!(r.provider, ProviderId::OpenAi);
    assert_eq!(r.model, "gpt-image-2.5-flare");
    assert_eq!((r.width, r.height), (1, 1));
    assert_eq!(r.image.mime, "image/png");
    assert_eq!(decode_dims(&r.image.data), (1, 1));
    assert_eq!(
        r.revised_prompt.as_deref(),
        Some("A tiny glossy red cube on a white table")
    );
    // usage: 12 text in * $5/M + 2000 out * $30/M = $0.06006, split over n=2.
    let cost = r.cost_usd.expect("cost from usage");
    assert!((cost - 0.03003).abs() < 1e-9, "cost {cost}");
    assert!(results[1].revised_prompt.is_none());
}

#[tokio::test]
async fn mask_edit_is_multipart_with_image_array_and_mask() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/edits"))
        .and(header(
            "authorization",
            format!("Bearer {TEST_KEY}").as_str(),
        ))
        .and(header_regex(
            "content-type",
            "^multipart/form-data; boundary=",
        ))
        .and(BodyCount::exactly("name=\"image[]\"", 1))
        .and(BodyCount::exactly(
            "name=\"mask\"; filename=\"mask.png\"",
            1,
        ))
        .and(BodyCount::contains("name=\"prompt\"\r\n\r\nmake it blue"))
        .and(BodyCount::contains(
            "name=\"model\"\r\n\r\ngpt-image-2.5-sunburst",
        ))
        .and(BodyCount::contains("name=\"size\"\r\n\r\n1024x1024"))
        .and(BodyCount::contains("name=\"quality\"\r\n\r\nmedium"))
        .and(BodyCount::contains("name=\"output_format\"\r\n\r\npng"))
        .and(BodyCount::contains("name=\"n\"\r\n\r\n1"))
        .and(BodyCount::contains("Content-Type: image/png"))
        .and(BodyLacks("name=\"background\""))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("openai_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;

    let image = ImageBytes::png(png(64, 64, [255, 0, 0, 255]));
    let mask = ImageBytes::png(mask_png(64, 64, (8, 8, 16, 16), 255));
    let req = EditRequest {
        size: Some(ImageSize::new(1024, 1024)),
        quality: Some("medium".into()),
        ..EditRequest::masked("make it blue", image, mask)
    };
    let results = provider(&server).await.edit(req).await.expect("edit ok");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].model, "gpt-image-2.5-sunburst");
}

#[tokio::test]
async fn instruct_edit_with_references_sends_multiple_image_parts_and_no_mask() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/edits"))
        .and(BodyCount::exactly("name=\"image[]\"", 3))
        .and(BodyCount::contains("filename=\"image0.png\""))
        .and(BodyCount::contains("filename=\"image1.jpg\""))
        .and(BodyCount::contains("filename=\"image2.webp\""))
        .and(BodyCount::contains("Content-Type: image/jpeg"))
        .and(BodyLacks("name=\"mask\""))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("openai_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;

    let mut req = EditRequest::instruct("blend them", ImageBytes::png(png(8, 8, [0, 0, 0, 255])));
    req.reference_images = vec![
        ImageBytes {
            data: jpeg(8, 8),
            mime: "image/jpeg".into(),
        },
        ImageBytes {
            data: webp(8, 8),
            mime: "image/webp".into(),
        },
    ];
    req.model = Some("gpt-image-2".into());
    let results = provider(&server).await.edit(req).await.expect("edit ok");
    assert_eq!(results[0].model, "gpt-image-2");
}

#[tokio::test]
async fn generate_with_references_routes_through_edits() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/edits"))
        .and(BodyCount::exactly("name=\"image[]\"", 1))
        .and(BodyCount::contains(
            "name=\"model\"\r\n\r\ngpt-image-2.5-sunburst",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("openai_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "in this style".into(),
            reference_images: vec![ImageBytes::png(png(8, 8, [1, 2, 3, 255]))],
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
}

#[tokio::test]
async fn error_mapping_401_429_400() {
    let server = MockServer::start().await;
    let p = provider(&server).await;
    let gen = || GenerateRequest {
        prompt: "x".into(),
        ..GenerateRequest::default()
    };

    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(fixture_json("openai_error_401.json")),
        )
        .expect(1)
        .mount(&server)
        .await;
    let err = p.generate(gen()).await.expect_err("401");
    assert_eq!(err.code(), "ai_auth");
    let msg = err.to_string();
    assert!(msg.contains("Incorrect API key"), "{msg}");
    assert!(!msg.contains("sk-abcdef"), "key leaked into error: {msg}");
    assert!(msg.contains("[REDACTED]"));
    server.reset().await;

    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "12")
                .set_body_string("rate limited"),
        )
        .mount(&server)
        .await;
    let err = p.generate(gen()).await.expect_err("429");
    assert!(matches!(
        err,
        Error::RateLimited {
            retry_after_secs: Some(12)
        }
    ));
    assert!(err.is_retryable());
    server.reset().await;

    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(fixture_json("openai_error_moderation.json")),
        )
        .mount(&server)
        .await;
    match p.generate(gen()).await.expect_err("moderation") {
        Error::Moderation {
            provider,
            categories,
            message,
        } => {
            assert_eq!(provider, ProviderId::OpenAi);
            assert_eq!(categories, vec!["violence", "self-harm"]);
            assert!(message.contains("safety system"));
        }
        other => panic!("expected moderation, got {other:?}"),
    }
    server.reset().await;

    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(fixture_json("openai_error_400.json")),
        )
        .mount(&server)
        .await;
    let err = p.generate(gen()).await.expect_err("400");
    assert_eq!(err.code(), "ai_bad_request");
    assert!(err.to_string().contains("999x999"));
    server.reset().await;

    Mock::given(path("/v1/images/generations"))
        .respond_with(ResponseTemplate::new(503).set_body_string("upstream"))
        .mount(&server)
        .await;
    let err = p.generate(gen()).await.expect_err("503");
    assert!(matches!(err, Error::Http { status: 503, .. }));
}

#[tokio::test]
async fn rejects_before_sending_when_limits_are_exceeded() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    let p = provider(&server).await;

    let err = p
        .generate(GenerateRequest {
            prompt: "x".repeat(32_001),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("prompt too long");
    assert_eq!(err.code(), "ai_invalid_request");

    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            size: Some(ImageSize::new(1000, 1000)),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("not a multiple of 16");
    assert!(err.to_string().contains("multiples of 16"));

    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            size: Some(ImageSize::new(4096, 4096)),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("over max_px");
    assert!(err.to_string().contains("3840"));

    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            n: 11,
            ..GenerateRequest::default()
        })
        .await
        .expect_err("n too large");
    assert!(err.to_string().contains("between 1 and 10"));

    let mut too_big = vec![0u8; 50 * 1024 * 1024];
    too_big[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let err = p
        .edit(EditRequest::instruct("x", ImageBytes::png(too_big)))
        .await
        .expect_err("50 MB image");
    assert!(err.to_string().contains("50 MB"));

    let image = ImageBytes::png(png(16, 16, [0, 0, 0, 255]));
    let wrong_mask = ImageBytes::png(mask_png(8, 8, (0, 0, 8, 8), 255));
    let err = p
        .edit(EditRequest::masked("x", image.clone(), wrong_mask))
        .await
        .expect_err("mask dims");
    assert!(err.to_string().contains("identical dimensions"));

    let mut refs = EditRequest::instruct("x", image);
    refs.reference_images = vec![ImageBytes::png(png(2, 2, [0; 4])); 16];
    let err = p.edit(refs).await.expect_err("17 images");
    assert!(err.to_string().contains("exceed the 16"));

    let err = p
        .edit(EditRequest::instruct(
            "x",
            ImageBytes::png(b"GIF89a....".to_vec()),
        ))
        .await
        .expect_err("gif input");
    assert!(err.to_string().contains("PNG, JPEG or WebP"));
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
    provider(&server).await.test_key().await.expect("key ok");
    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(fixture_json("openai_error_401.json")),
        )
        .mount(&server)
        .await;
    let err = provider(&server)
        .await
        .test_key()
        .await
        .expect_err("bad key");
    assert_eq!(err.code(), "ai_auth");
}

#[tokio::test]
async fn empty_data_is_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/images/generations"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"created": 1, "data": []})),
        )
        .mount(&server)
        .await;
    let err = provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("no images");
    assert_eq!(err.code(), "ai_invalid_response");
}
