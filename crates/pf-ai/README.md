# `pf-ai` — AI Provider Abstraction, Job Queue, OAuth & Key Store

Rust crate (`pf_ai`) implementing Pixelforge's AI image generation, mask/instruct editing, prompt assistance, custom/local provider probing, subscription OAuth flows, bounded job queue, and credential storage. Enforces `#![forbid(unsafe_code)]`.

## Responsibilities

- Define the object-safe `ImageProvider` trait (`provider.rs`) and per-provider `Capabilities` matrix (`capabilities.rs`).
- Implement built-in cloud providers (`providers/openai.rs`, `providers/xai.rs`, `providers/gemini.rs`) and 6 custom/local provider adapters (`providers/custom/`).
- Manage concurrent AI jobs (`jobs.rs`) with bounded concurrency (default 2), per-job timeouts (10–3600 s, default 180 s), cancellation, and broadcast events (`JobEvent`).
- Store API keys and OAuth token records in the OS keychain (`KeyringStore`, service `com.pixelforge.app`) with an obfuscated file fallback (`FileStore`, `ai-keys.json` + `ai-keys.secret`) via `AutoKeyStore` (`keystore.rs`).
- Implement OpenAI "Sign in with ChatGPT" loopback PKCE OAuth (`oauth/openai_siwc.rs`) and xAI RFC 8628 device-code OAuth (`oauth/xai_device.rs`).
- Provide mask bounding-box cropping, soft-mask compositing, and OpenAI alpha-mask conversion (`mask.rs`), plus layout-identical binary IPC framing (`ipc.rs`).

## Directory Structure

| Path | Description |
|---|---|
| `src/` | Crate library modules (`lib.rs`, `capabilities.rs`, `custom.rs`, `error.rs`, `http.rs`, `ipc.rs`, `jobs.rs`, `keystore.rs`, `mask.rs`, `provider.rs`, `secret.rs`, `types.rs`, `oauth/`, `providers/`). |
| `workflows/` | Embedded ComfyUI API-format workflow JSON templates (`txt2img.json`, `img2img.json`, `inpaint.json`). |
| `examples/live.rs` | CLI smoke-test example exercising a live provider with an API key from the environment. |
| `tests/` | Offline integration tests using `wiremock` and JSON fixtures (`tests/fixtures/`). |
