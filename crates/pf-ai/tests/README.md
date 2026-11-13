# `crates/pf-ai/tests` — `pf-ai` Integration Tests

Offline integration test suite for `pf-ai`, exercising provider wire protocols against `wiremock` mock servers and recorded JSON fixtures without live network calls.

## Key Files

| File / Directory | Coverage |
|---|---|
| `common/mod.rs` | Shared test utilities (1x1 RGBA/mask PNG builders, fixture loader). |
| `fixtures/` | Recorded JSON response payloads for OpenAI, xAI, and Gemini success and error cases (`400`, `401`, `403`, `429`, moderation blocked). |
| `openai.rs` | OpenAI generate, multipart mask/instruct edit, custom size validation, and error mapping tests. |
| `xai.rs` | xAI generate, JSON edit, aspect-ratio mapping, rate-limit (`Retry-After`), and moderation error tests. |
| `gemini.rs` | Gemini `generateContent` request/response shapes, inline image parts, safety blocks, and error mapping tests. |
| `custom.rs` | Custom provider registry (`ai-providers.json`) and wire-protocol tests across all 6 `CustomKind` adapters (`openai_compat`, `hugging_face`, `ollama`, `comfy_ui`, `a1111`, `replicate`). |
| `oauth.rs` | OpenAI SIWC PKCE loopback flow, ID-token verification, token refresh, streaming `/v1/responses`, xAI RFC 8628 device flow, and `PlanFallbackProvider` tests. |
| `jobs.rs` | `JobManager` concurrency limits, queueing, cancellation, timeouts, and `take_result` lifecycle tests. |
| `keystore.rs` | `FileStore` obfuscation, `AutoKeyStore` fallback, and account key round-trip tests. |
| `mask.rs` | `to_openai_mask` and `to_a1111_mask` pixel accuracy and validation tests. |
