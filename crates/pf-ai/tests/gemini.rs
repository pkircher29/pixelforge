mod common;

use common::*;
use pf_ai::providers::gemini::{GeminiProvider, GeminiSizeField};
use pf_ai::{
    EditRequest, Error, GenerateRequest, ImageBytes, ImageProvider, ImageSize, ProviderId,
};
use wiremock::matchers::{body_partial_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn provider(server: &MockServer) -> GeminiProvider {
    GeminiProvider::new(auth())
        .expect("client")
        .with_base_url(&server.uri())
        .with_size_field(GeminiSizeField::ImageConfig)
}

#[tokio::test]
async fn generate_posts_generate_content_with_api_key_header() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/v1beta/models/gemini-3.1-flash-image:generateContent",
        ))
        .and(header("x-goog-api-key", TEST_KEY))
        .and(header("content-type", "application/json"))
        .and(body_partial_json(serde_json::json!({
            "contents": [{ "parts": [{ "text": "a neon anvil" }] }],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": { "aspectRatio": "16:9", "imageSize": "2K" }
            }
        })))
        .and(BodyLacks("inline_data"))
        .and(BodyLacks("responseFormat"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("gemini_generate.json")),
        )
        .expect(2)
        .mount(&server)
        .await;

    let results = provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "a neon anvil".into(),
            size: Some(ImageSize::new(2048, 1152)),
            n: 2,
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(results.len(), 2, "n variants = n calls");
    assert_eq!(results[0].provider, ProviderId::Gemini);
    assert_eq!(results[0].model, "gemini-3.1-flash-image");
    assert_eq!((results[0].width, results[0].height), (1, 1));
    assert_eq!(results[0].cost_usd, Some(0.101));
}

#[tokio::test]
async fn edit_sends_inline_data_parts_and_uses_model_override() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1beta/models/gemini-3-pro-image:generateContent"))
        .and(JsonPredicate(|v| {
            let parts = v["contents"][0]["parts"].as_array();
            parts.is_some_and(|p| {
                p.len() == 3
                    && p[0]["text"] == "make the sky purple"
                    && p[1]["inline_data"]["mime_type"] == "image/png"
                    && p[1]["inline_data"]["data"]
                        .as_str()
                        .is_some_and(|d| !d.is_empty())
                    && p[2]["inline_data"]["mime_type"] == "image/jpeg"
            }) && v["generationConfig"].get("imageConfig").is_none()
        }))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("gemini_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;

    let mut req = EditRequest::instruct(
        "make the sky purple",
        ImageBytes::png(png(16, 16, [0, 0, 255, 255])),
    );
    req.reference_images = vec![ImageBytes {
        data: jpeg(8, 8),
        mime: "image/jpeg".into(),
    }];
    req.model = Some("gemini-3-pro-image".into());
    let results = provider(&server).await.edit(req).await.expect("ok");
    assert_eq!(results[0].model, "gemini-3-pro-image");
    assert_eq!(results[0].cost_usd, Some(0.134));
}

#[tokio::test]
async fn alternate_size_field_is_selectable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_partial_json(serde_json::json!({
            "generationConfig": {
                "responseFormat": { "image": { "aspectRatio": "1:1", "imageSize": "1K" } }
            }
        })))
        .and(BodyLacks("imageConfig"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(fixture_json("gemini_generate.json")),
        )
        .expect(1)
        .mount(&server)
        .await;
    provider(&server)
        .await
        .with_size_field(GeminiSizeField::ResponseFormat)
        .generate(GenerateRequest {
            prompt: "x".into(),
            size: Some(ImageSize::square(1024)),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
}

#[tokio::test]
async fn blocked_prompt_in_200_body_maps_to_moderation() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture_json("gemini_blocked.json")))
        .mount(&server)
        .await;
    match provider(&server)
        .await
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("blocked")
    {
        Error::Moderation {
            provider,
            categories,
            message,
        } => {
            assert_eq!(provider, ProviderId::Gemini);
            assert_eq!(categories, vec!["HARM_CATEGORY_DANGEROUS_CONTENT"]);
            assert!(message.contains("PROHIBITED_CONTENT"));
        }
        other => panic!("expected moderation, got {other:?}"),
    }
}

#[tokio::test]
async fn http_error_mapping() {
    let server = MockServer::start().await;
    let p = provider(&server).await;
    let gen = || GenerateRequest {
        prompt: "x".into(),
        ..GenerateRequest::default()
    };

    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(fixture_json("gemini_error_400.json")),
        )
        .mount(&server)
        .await;
    let err = p.generate(gen()).await.expect_err("400");
    assert_eq!(err.code(), "ai_bad_request");
    assert!(err.to_string().contains("image_size"));
    server.reset().await;

    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(fixture_json("gemini_error_403.json")),
        )
        .mount(&server)
        .await;
    let err = p.generate(gen()).await.expect_err("403");
    assert_eq!(err.code(), "ai_auth");
    server.reset().await;

    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "30"))
        .mount(&server)
        .await;
    assert!(matches!(
        p.generate(gen()).await.expect_err("429"),
        Error::RateLimited {
            retry_after_secs: Some(30)
        }
    ));
}

#[tokio::test]
async fn local_rejections() {
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
        .expect_err("no mask");
    assert_eq!(err.code(), "ai_unsupported");

    let mut big = vec![0u8; 16 * 1000 * 1000];
    big[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let err = p
        .edit(EditRequest::instruct("x", ImageBytes::png(big)))
        .await
        .expect_err("inline budget (16 MB raw > 20 MB base64)");
    assert!(err.to_string().contains("20 MB"));

    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            n: 5,
            ..GenerateRequest::default()
        })
        .await
        .expect_err("n > 4");
    assert!(err.to_string().contains("between 1 and 4"));

    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            size: Some(ImageSize::new(8192, 8192)),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("over 4096");
    assert!(err.to_string().contains("4096"));
}

#[tokio::test]
async fn test_key_lists_one_model() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1beta/models"))
        .and(query_param("pageSize", "1"))
        .and(header("x-goog-api-key", TEST_KEY))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"models": []})))
        .expect(1)
        .mount(&server)
        .await;
    provider(&server).await.test_key().await.expect("ok");
}
