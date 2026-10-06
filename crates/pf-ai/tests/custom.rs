//! wiremock tests for every custom provider kind: request shape, response decoding and
//! the probe. Shapes come from docs/ai-research.md section 4.
mod common;

use std::time::Duration;

use common::*;
use pf_ai::custom::{CustomKind, CustomProvider};
use pf_ai::providers::custom::comfy::ComfyProvider;
use pf_ai::providers::custom::replicate::ReplicateProvider;
use pf_ai::providers::custom::Ctx;
use pf_ai::{
    build_custom_provider, probe_custom, prompt_assist, EditRequest, GenerateRequest, ImageBytes,
    ImageProvider, ImageSize, ProviderId, SecretString,
};
use serde_json::json;
use wiremock::matchers::{body_partial_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn cfg(kind: CustomKind, server: &MockServer) -> CustomProvider {
    let mut c = CustomProvider::new("t", "Test", kind);
    c.base_url = server.uri();
    c
}

fn tiny_png_bytes() -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(TINY_PNG_B64)
        .expect("fixture")
}

// ---------------------------------------------------------------- OpenAI-compatible

#[tokio::test]
async fn openai_compat_generate_and_probe() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/generations"))
        .and(header("authorization", "Bearer local-key"))
        .and(body_partial_json(json!({
            "model": "sd-turbo", "prompt": "a neon anvil", "n": 2, "size": "512x512",
            "response_format": "b64_json", "negative_prompt": "blur", "num_inference_steps": 4, "step": 4
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "created": 1, "data": [ { "b64_json": TINY_PNG_B64 }, { "url": format!("{}/out.png", server.uri()) } ]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/out.png"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(png(2, 3, [1, 2, 3, 255])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "object": "list", "data": [ { "id": "sd-turbo" }, { "id": "flux" } ] }),
        ))
        .mount(&server)
        .await;

    let mut c = cfg(CustomKind::OpenAiCompat, &server);
    c.model = "sd-turbo".into();
    c.extra = json!({ "steps": 4 });
    let p = build_custom_provider(&c, Some(SecretString::new("local-key"))).expect("build");
    assert_eq!(p.id(), ProviderId::custom("t"));
    let out = p
        .generate(GenerateRequest {
            prompt: "a neon anvil".into(),
            negative_prompt: Some("blur".into()),
            n: 2,
            size: Some(ImageSize::square(512)),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(out.len(), 2);
    assert_eq!((out[1].width, out[1].height), (2, 3));
    assert_eq!(out[0].cost_usd, Some(0.0), "loopback server is free");

    let r = probe_custom(&c, None).await.expect("probe");
    assert!(r.reachable);
    assert_eq!(r.models, vec!["sd-turbo", "flux"]);
    assert!(r.detected_caps.expect("caps").generate);

    // Edits are refused unless the user enabled them for this entry.
    let err = p
        .edit(EditRequest::instruct(
            "x",
            ImageBytes::png(tiny_png_bytes()),
        ))
        .await
        .expect_err("instruct off by default");
    assert_eq!(err.code(), "ai_unsupported");
}

#[tokio::test]
async fn openai_compat_mask_edit_is_multipart_with_alpha_mask() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/images/edits"))
        .and(BodyCount::contains("name=\"mask\""))
        .and(BodyCount::contains("name=\"image\""))
        .and(BodyCount::contains("name=\"prompt\""))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "data": [ { "b64_json": TINY_PNG_B64 } ] })),
        )
        .expect(1)
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::OpenAiCompat, &server);
    c.capabilities.instruct_edit = true;
    c.capabilities.mask_edit = true;
    let p = build_custom_provider(&c, None).expect("build");
    let out = p
        .edit(EditRequest::masked(
            "fill",
            ImageBytes::png(png(8, 8, [0, 0, 0, 255])),
            ImageBytes::png(mask_png(8, 8, (2, 2, 4, 4), 255)),
        ))
        .await
        .expect("ok");
    assert_eq!(out.len(), 1);
}

#[tokio::test]
async fn openai_compat_probe_reports_unreachable_and_auth() {
    let mut c = CustomProvider::new("t", "T", CustomKind::OpenAiCompat);
    c.base_url = "http://127.0.0.1:9".into(); // nothing listens on the discard port
    let r = probe_custom(&c, None)
        .await
        .expect("probe never errors for server problems");
    assert!(!r.reachable);
    assert!(!r.auth_failed);

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({ "error": { "message": "bad key" } })),
        )
        .mount(&server)
        .await;
    let c = cfg(CustomKind::OpenAiCompat, &server);
    let r = probe_custom(&c, Some(SecretString::new("bad")))
        .await
        .expect("probe");
    assert!(r.reachable && r.auth_failed);
    let p = build_custom_provider(&c, Some(SecretString::new("bad"))).expect("build");
    assert_eq!(p.test_key().await.expect_err("auth").code(), "ai_auth");
}

// ---------------------------------------------------------------- Hugging Face

#[tokio::test]
async fn hf_text_to_image_posts_inputs_and_reads_bytes() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/models/stabilityai/sdxl"))
        .and(header("authorization", "Bearer hf_token"))
        .and(header("x-use-cache", "false"))
        .and(header("x-wait-for-model", "true"))
        .and(body_partial_json(json!({
            "inputs": "a fox", "parameters": { "negative_prompt": "dogs", "width": 768, "height": 512, "seed": 7 }
        })))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "image/jpeg")
                .set_body_bytes(jpeg(5, 4)),
        )
        .expect(2)
        .mount(&server)
        .await;
    let mut c = CustomProvider::new("hf", "HF", CustomKind::HuggingFace);
    // Must contain "huggingface.co" to be treated as the router; wiremock is on 127.0.0.1,
    // so point the "router" at a dedicated-endpoint URL instead and verify both paths.
    c.base_url = format!("{}/models/stabilityai/sdxl", server.uri());
    c.model = "stabilityai/sdxl".into();
    c.extra = json!({ "seed": 7 });
    let p = build_custom_provider(&c, Some(SecretString::new("hf_token"))).expect("build");
    let out = p
        .generate(GenerateRequest {
            prompt: "a fox".into(),
            negative_prompt: Some("dogs".into()),
            n: 2,
            size: Some(ImageSize::new(768, 512)),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(out.len(), 2, "one request per variant");
    assert_eq!((out[0].width, out[0].height), (5, 4));
    assert_eq!(out[0].image.mime, "image/png", "JPEG normalised to PNG");
    // wiremock listens on 127.0.0.1, which the locality heuristic treats as free; a real
    // router URL is "cloud" and yields `None` (covered in custom.rs unit tests).
    assert_eq!(out[0].cost_usd, Some(0.0));
}

#[tokio::test]
async fn hf_accepts_json_image_shapes_and_image_to_image_sends_base64() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/ep"))
        .and(body_partial_json(
            json!({ "parameters": { "prompt": "make it night" } }),
        ))
        .and(BodyCount::contains("\"inputs\":\"iVBOR"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "data": [ { "b64_json": TINY_PNG_B64 } ] })),
        )
        .expect(1)
        .mount(&server)
        .await;
    let mut c = CustomProvider::new("hf", "HF", CustomKind::HuggingFace);
    c.base_url = format!("{}/ep", server.uri());
    c.capabilities.instruct_edit = true;
    let p = build_custom_provider(&c, Some(SecretString::new("hf_token"))).expect("build");
    let out = p
        .edit(EditRequest::instruct(
            "make it night",
            ImageBytes::png(tiny_png_bytes()),
        ))
        .await
        .expect("ok");
    assert_eq!(out.len(), 1);
    let err = p
        .edit(EditRequest::masked(
            "x",
            ImageBytes::png(tiny_png_bytes()),
            ImageBytes::png(tiny_png_bytes()),
        ))
        .await
        .expect_err("no native mask");
    assert_eq!(err.code(), "ai_unsupported");
}

#[tokio::test]
async fn hf_probe_uses_hub_model_info_and_search_parses_hits() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/models/black-forest-labs/FLUX.1-dev"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "black-forest-labs/FLUX.1-dev", "pipeline_tag": "text-to-image", "gated": "auto", "downloads": 10
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/models"))
        .and(query_param("pipeline_tag", "text-to-image"))
        .and(query_param("search", "flux"))
        .and(query_param("limit", "5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "id": "black-forest-labs/FLUX.1-dev", "pipeline_tag": "text-to-image", "downloads": 698301, "likes": 15399 },
            { "modelId": "x/y", "pipeline_tag": "text-to-image" }
        ])))
        .mount(&server)
        .await;
    let mut c = CustomProvider::new("hf", "HF", CustomKind::HuggingFace);
    c.base_url = "https://router.huggingface.co/hf-inference".into();
    c.model = "black-forest-labs/FLUX.1-dev".into();
    c.extra = json!({ "hubUrl": server.uri() });
    let r = probe_custom(&c, Some(SecretString::new("hf_token")))
        .await
        .expect("probe");
    assert!(r.reachable);
    assert_eq!(r.models, vec!["black-forest-labs/FLUX.1-dev"]);
    let caps = r.detected_caps.expect("caps");
    assert!(caps.generate && !caps.instruct_edit && !caps.mask_edit);
    assert!(r.message.contains("gated"));

    let hits = pf_ai::providers::custom::hf::hub_search(
        &reqwest::Client::new(),
        &server.uri(),
        "flux",
        "text-to-image",
        5,
    )
    .await
    .expect("search");
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].downloads, 698301);
    assert_eq!(hits[1].id, "x/y");
}

// ---------------------------------------------------------------- Ollama

#[tokio::test]
async fn ollama_is_assist_only() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "models": [
            { "name": "llama3.2:3b", "details": { "families": ["llama"] } },
            { "name": "llava:13b", "details": { "families": ["llama", "clip"] } }
        ] })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/version"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "version": "0.12.1" })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .and(body_partial_json(json!({ "model": "llava:13b", "stream": false })))
        .and(BodyCount::contains("\"images\":[\"iVBOR"))
        .and(BodyCount::contains("Request: a fox"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "llava:13b", "message": { "role": "assistant", "content": "  \"A red fox in golden hour light, 85mm, shallow depth of field.\"  " }, "done": true
        })))
        .expect(1)
        .mount(&server)
        .await;

    let mut c = cfg(CustomKind::Ollama, &server);
    c.model = "llava:13b".into();
    let r = probe_custom(&c, None).await.expect("probe");
    assert!(r.reachable);
    assert_eq!(r.version.as_deref(), Some("0.12.1"));
    assert_eq!(r.models[0], "llava:13b", "vision models sort first");
    assert!(r.message.contains("1 vision-capable"));
    assert!(r.message.contains("no image generation"));
    let caps = r.detected_caps.expect("caps");
    assert!(!caps.generate && !caps.instruct_edit && !caps.mask_edit);

    let p = build_custom_provider(&c, None).expect("build");
    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("never generates");
    assert_eq!(err.code(), "ai_unsupported");
    assert!(err.to_string().contains("prompt assist"));

    let improved = prompt_assist(&c, None, Some(ImageBytes::png(tiny_png_bytes())), "a fox")
        .await
        .expect("assist");
    assert_eq!(
        improved,
        "A red fox in golden hour light, 85mm, shallow depth of field."
    );
    let err = prompt_assist(&c, None, None, "  ")
        .await
        .expect_err("nothing to improve");
    assert_eq!(err.code(), "ai_invalid_request");
    let other = cfg(CustomKind::A1111, &server);
    assert_eq!(
        prompt_assist(&other, None, None, "x")
            .await
            .expect_err("only ollama")
            .code(),
        "ai_unsupported"
    );
}

// ---------------------------------------------------------------- ComfyUI

async fn mount_comfy(server: &MockServer, expected_uploads: u64) {
    Mock::given(method("POST"))
        .and(path("/upload/image"))
        .and(BodyCount::contains("name=\"image\""))
        .and(BodyCount::contains("name=\"overwrite\""))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "name": "up.png", "subfolder": "", "type": "input" })),
        )
        .expect(expected_uploads)
        .mount(server)
        .await;
    // `/prompt` is mounted by each test with its own body matcher.
    // First poll: still running (empty object); second: done with two images.
    Mock::given(method("GET"))
        .and(path("/history/pid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .up_to_n_times(1)
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/history/pid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "pid-1": {
            "prompt": [], "outputs": { "9": { "images": [
                { "filename": "pixelforge_00001_.png", "subfolder": "", "type": "output" },
                { "filename": "pixelforge_00002_.png", "subfolder": "", "type": "output" },
                { "filename": "preview.png", "subfolder": "", "type": "temp" }
            ] } },
            "status": { "status_str": "success", "completed": true, "messages": [] }
        } })))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/view"))
        .and(query_param("type", "output"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(png(3, 3, [9, 9, 9, 255])))
        .expect(2)
        .mount(server)
        .await;
}

#[tokio::test]
async fn comfy_txt2img_renders_template_queues_polls_and_fetches() {
    let server = MockServer::start().await;
    mount_comfy(&server, 0).await;
    // Checkpoint + numbers must arrive typed inside the API-format workflow.
    Mock::given(method("POST"))
        .and(path("/prompt"))
        .and(body_partial_json(json!({ "prompt": {
            "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sd_xl.safetensors" } },
            "5": { "inputs": { "width": 640, "height": 512, "batch_size": 2 } },
            "6": { "inputs": { "text": "a fox" } },
            "7": { "inputs": { "text": "dogs" } },
            "3": { "inputs": { "steps": 12, "cfg": 5.5, "seed": 99, "sampler_name": "dpmpp_2m", "denoise": 1 } }
        } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "prompt_id": "pid-1", "number": 3, "node_errors": {} })))
        .expect(1)
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::ComfyUi, &server);
    c.model = "sd_xl.safetensors".into();
    c.extra = json!({ "steps": 12, "cfg": 5.5, "seed": 99, "sampler": "dpmpp_2m" });
    let p = ComfyProvider::new(Ctx::new(c, None).expect("ctx"))
        .with_poll_interval(Duration::from_millis(5));
    let out = p
        .generate(GenerateRequest {
            prompt: "a fox".into(),
            negative_prompt: Some("dogs".into()),
            n: 2,
            size: Some(ImageSize::new(640, 512)),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(out.len(), 2, "temp previews are skipped");
    assert_eq!(out[0].model, "sd_xl.safetensors");
    assert_eq!(out[0].cost_usd, Some(0.0));
}

#[tokio::test]
async fn comfy_inpaint_uploads_image_and_mask_and_uses_inpaint_nodes() {
    let server = MockServer::start().await;
    mount_comfy(&server, 2).await;
    Mock::given(method("POST"))
        .and(path("/prompt"))
        .and(body_partial_json(json!({ "prompt": {
            "10": { "class_type": "LoadImage", "inputs": { "image": "up.png" } },
            "12": { "class_type": "LoadImage", "inputs": { "image": "up.png" } },
            "11": { "class_type": "VAEEncodeForInpaint" },
            "13": { "class_type": "ImageToMask", "inputs": { "channel": "red" } },
            "3": { "inputs": { "denoise": 1.0 } }
        } })))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "prompt_id": "pid-1", "number": 1, "node_errors": {} })),
        )
        .expect(1)
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::ComfyUi, &server);
    c.extra = json!({ "checkpoint": "v1-5.ckpt" });
    let p = ComfyProvider::new(Ctx::new(c, None).expect("ctx"))
        .with_poll_interval(Duration::from_millis(5));
    let out = p
        .edit(EditRequest::masked(
            "add a hat",
            ImageBytes::png(png(16, 16, [0, 0, 0, 255])),
            ImageBytes::png(mask_png(16, 16, (4, 4, 8, 8), 255)),
        ))
        .await
        .expect("ok");
    assert_eq!(out.len(), 2);
}

#[tokio::test]
async fn comfy_reports_node_errors_execution_errors_and_probe() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/prompt"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": { "type": "prompt_outputs_failed_validation", "message": "Prompt outputs failed validation" },
            "node_errors": { "4": { "errors": [ { "type": "value_not_in_list", "message": "Value not in list: ckpt_name: 'nope.safetensors'" } ] } }
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/system_stats"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "system": { "os": "nt", "comfyui_version": "0.3.40" },
            "devices": [ { "name": "cuda:0 NVIDIA GeForce GTX 1650 SUPER", "vram_total": 4294967296u64 } ]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/object_info/CheckpointLoaderSimple"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "CheckpointLoaderSimple": { "input": { "required": {
            "ckpt_name": [ ["sd_xl.safetensors", "v1-5.ckpt"], { "tooltip": "x" } ]
        } } } }),
        ))
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::ComfyUi, &server);
    c.model = "nope.safetensors".into();
    let r = probe_custom(&c, None).await.expect("probe");
    assert!(r.reachable);
    assert_eq!(r.version.as_deref(), Some("0.3.40"));
    assert_eq!(r.models, vec!["sd_xl.safetensors", "v1-5.ckpt"]);
    assert!(r.message.contains("4.3 GB VRAM"));
    assert!(r.detected_caps.expect("caps").mask_edit);

    let p = ComfyProvider::new(Ctx::new(c, None).expect("ctx"))
        .with_poll_interval(Duration::from_millis(5));
    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("bad checkpoint");
    assert_eq!(err.code(), "ai_bad_request");
    assert!(err.to_string().contains("node 4"), "{err}");

    // Execution error reported through /history.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/prompt"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "prompt_id": "p2", "number": 1, "node_errors": {} })),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/history/p2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "p2": {
            "outputs": {}, "status": { "status_str": "error", "completed": false,
            "messages": [ ["execution_start", {}], ["execution_error", { "exception_message": "CUDA out of memory" }] ] }
        } })))
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::ComfyUi, &server);
    c.model = "sd_xl.safetensors".into();
    let p = ComfyProvider::new(Ctx::new(c, None).expect("ctx"))
        .with_poll_interval(Duration::from_millis(5));
    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("oom");
    assert!(err.to_string().contains("CUDA out of memory"), "{err}");
}

#[tokio::test]
async fn comfy_honours_user_workflow_from_extra() {
    let server = MockServer::start().await;
    mount_comfy(&server, 0).await;
    Mock::given(method("POST"))
        .and(path("/prompt"))
        .and(body_partial_json(json!({ "prompt": { "1": { "class_type": "MyNode", "inputs": { "text": "custom: a fox", "n": 3 } } } })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "prompt_id": "pid-1", "number": 1, "node_errors": {} })))
        .expect(1)
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::ComfyUi, &server);
    c.model = "any".into();
    c.extra = json!({ "workflow": "{ \"1\": { \"class_type\": \"MyNode\", \"inputs\": { \"text\": \"custom: {{prompt}}\", \"n\": \"{{batch}}\" } } }" });
    let p = ComfyProvider::new(Ctx::new(c, None).expect("ctx"))
        .with_poll_interval(Duration::from_millis(5));
    let out = p
        .generate(GenerateRequest {
            prompt: "a fox".into(),
            n: 3,
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(out.len(), 2);
}

// ---------------------------------------------------------------- A1111 / Forge

#[tokio::test]
async fn a1111_txt2img_img2img_inpaint_and_probe() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/sdapi/v1/txt2img"))
        .and(header("authorization", "Basic dXNlcjpwYXNz"))
        .and(body_partial_json(json!({
            "prompt": "a fox", "negative_prompt": "dogs", "steps": 20, "cfg_scale": 7.0, "width": 768, "height": 512,
            "sampler_name": "Euler a", "seed": -1, "batch_size": 2, "n_iter": 1, "send_images": true, "save_images": false,
            "override_settings": { "sd_model_checkpoint": "v1-5-pruned.safetensors [6ce0161689]" }
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "images": [TINY_PNG_B64, format!("data:image/png;base64,{TINY_PNG_B64}")], "parameters": {}, "info": "{}" })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/sdapi/v1/img2img"))
        .and(body_partial_json(json!({ "init_images": [TINY_PNG_B64], "denoising_strength": 0.6, "width": 1, "height": 1 })))
        .and(BodyLacks("\"mask\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "images": [TINY_PNG_B64], "parameters": {}, "info": "" })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/sdapi/v1/sd-models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "title": "v1-5-pruned.safetensors [6ce0161689]", "model_name": "v1-5-pruned", "hash": "6ce0161689", "filename": "C:/models/v1-5-pruned.safetensors" }
        ])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/sdapi/v1/options"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "sd_model_checkpoint": "v1-5-pruned.safetensors [6ce0161689]" }),
        ))
        .mount(&server)
        .await;

    let mut c = cfg(CustomKind::A1111, &server);
    c.model = "v1-5-pruned.safetensors [6ce0161689]".into();
    c.extra = json!({ "denoise": 0.6 });
    let auth = Some(SecretString::new("user:pass"));
    let r = probe_custom(&c, auth.clone()).await.expect("probe");
    assert!(r.reachable);
    assert_eq!(r.models.len(), 1);
    assert!(r.message.contains("current: v1-5"));

    let p = build_custom_provider(&c, auth).expect("build");
    let out = p
        .generate(GenerateRequest {
            prompt: "a fox".into(),
            negative_prompt: Some("dogs".into()),
            n: 2,
            size: Some(ImageSize::new(768, 512)),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(out.len(), 2, "data-URL prefixed entries decode too");
    let out = p
        .edit(EditRequest::instruct(
            "night",
            ImageBytes::png(tiny_png_bytes()),
        ))
        .await
        .expect("img2img");
    assert_eq!(out.len(), 1);
}

#[tokio::test]
async fn a1111_mask_edit_sends_white_is_repaint_mask() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/sdapi/v1/img2img"))
        .and(body_partial_json(json!({
            "inpainting_fill": 1, "inpaint_full_res": true, "inpainting_mask_invert": 0, "mask_blur": 8, "denoising_strength": 1.0
        })))
        .and(BodyCount::contains("\"mask\":\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "images": [TINY_PNG_B64], "parameters": {}, "info": "" })))
        .expect(1)
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::A1111, &server);
    c.extra = json!({ "maskBlur": 8, "inpaintFullRes": true });
    let p = build_custom_provider(&c, None).expect("build");
    let out = p
        .edit(EditRequest::masked(
            "hat",
            ImageBytes::png(png(8, 8, [0, 0, 0, 255])),
            ImageBytes::png(mask_png(8, 8, (2, 2, 4, 4), 255)),
        ))
        .await
        .expect("inpaint");
    assert_eq!(out.len(), 1);
    // Received mask: decode it back from the request body and check polarity.
    let reqs = server.received_requests().await.expect("recorded");
    let body: serde_json::Value = serde_json::from_slice(&reqs[0].body).expect("json");
    let m = pf_ai::mask::to_a1111_mask(
        &{
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(body["mask"].as_str().expect("mask"))
                .expect("b64")
        },
        8,
        8,
    )
    .expect("round trip");
    let g = image::load_from_memory(&m).expect("png").to_luma8();
    assert_eq!(
        g.get_pixel(3, 3).0[0],
        255,
        "selected pixel is white = repaint"
    );
    assert_eq!(
        g.get_pixel(0, 0).0[0],
        0,
        "unselected pixel is black = keep"
    );
}

// ---------------------------------------------------------------- Replicate

#[tokio::test]
async fn replicate_creates_prediction_polls_and_downloads_output() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/models/black-forest-labs/flux-schnell/predictions"))
        .and(header("authorization", "Bearer r8_token"))
        .and(header("prefer", "wait"))
        .and(body_partial_json(json!({ "input": { "prompt": "a fox", "num_outputs": 1, "width": 1024, "height": 768, "aspect_ratio": "4:3" } })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "id": "pred1", "status": "processing", "output": null, "urls": { "get": format!("{}/v1/predictions/pred1", server.uri()) }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/predictions/pred1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "pred1", "status": "succeeded", "output": [format!("{}/out.webp", server.uri())]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/out.webp"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(webp(6, 2)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/models/black-forest-labs/flux-schnell"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "latest_version": { "id": "abcdef0123456789" } })),
        )
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::Replicate, &server);
    c.model = "black-forest-labs/flux-schnell".into();
    c.extra = json!({ "input": { "aspect_ratio": "4:3" } });
    let r = probe_custom(&c, Some(SecretString::new("r8_token")))
        .await
        .expect("probe");
    assert!(r.reachable);
    assert!(r.message.contains("abcdef012345"));
    let p = ReplicateProvider::new(Ctx::new(c, Some(SecretString::new("r8_token"))).expect("ctx"))
        .with_poll_interval(Duration::from_millis(5));
    let out = p
        .generate(GenerateRequest {
            prompt: "a fox".into(),
            size: Some(ImageSize::new(1024, 768)),
            ..GenerateRequest::default()
        })
        .await
        .expect("ok");
    assert_eq!(out.len(), 1);
    assert_eq!((out[0].width, out[0].height), (6, 2));
    assert_eq!(out[0].image.mime, "image/png");
}

#[tokio::test]
async fn replicate_failed_prediction_and_bad_model_name() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/predictions"))
        .and(body_partial_json(json!({ "version": "deadbeef", "input": { "prompt": "x", "image": format!("data:image/png;base64,{TINY_PNG_B64}") } })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "id": "p", "status": "failed", "error": "NSFW content detected" })))
        .mount(&server)
        .await;
    let mut c = cfg(CustomKind::Replicate, &server);
    c.model = "owner/name".into();
    c.extra = json!({ "version": "deadbeef" });
    c.capabilities.instruct_edit = true;
    let p = build_custom_provider(&c, Some(SecretString::new("r8"))).expect("build");
    let err = p
        .edit(EditRequest::instruct(
            "x",
            ImageBytes::png(tiny_png_bytes()),
        ))
        .await
        .expect_err("failed");
    assert_eq!(err.code(), "ai_bad_request");
    assert!(err.to_string().contains("NSFW"));
    c.model = "not-a-repo".into();
    let p = build_custom_provider(&c, Some(SecretString::new("r8"))).expect("build");
    let err = p
        .generate(GenerateRequest {
            prompt: "x".into(),
            ..GenerateRequest::default()
        })
        .await
        .expect_err("model name");
    assert_eq!(err.code(), "ai_invalid_request");
}
