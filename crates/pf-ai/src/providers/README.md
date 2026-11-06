# `crates/pf-ai/src/providers` — Built-in & Custom AI Provider Implementations

Concrete implementations of the `ImageProvider` trait (`crates/pf-ai/src/provider.rs`) and provider construction factories.

## Key Files

| File / Subdirectory | Role |
|---|---|
| `mod.rs` | Provider factory functions (`build_provider`, `build_provider_from_env`, `build_provider_with_base_url`), `SharedProvider` (`Arc<dyn ImageProvider>`), and environment base-URL overrides (`PF_AI_BASE_URL_OPENAI`, `PF_AI_BASE_URL_XAI`, `PF_AI_BASE_URL_GEMINI`). |
| `openai.rs` | Built-in OpenAI (`ChatGPT`) image provider (`/v1/images/generations` JSON, `/v1/images/edits` multipart with RGBA alpha=0 mask conversion, `/v1/models` key probe). |
| `xai.rs` | Built-in xAI (`Grok`) image provider (`/v1/images/generations`, `/v1/images/edits` JSON with data-URL images, aspect-ratio/resolution mapping, `/v1/models` key probe). |
| `gemini.rs` | Built-in Google (`Gemini`) image provider (`/v1beta/models/{model}:generateContent` with inline base64 image parts, aspect-ratio/imageSize tier mapping, `/v1beta/models` key probe). |
| `custom/` | Adapters, capability probes, and prompt-assist helpers for the 6 custom/local provider kinds. |
