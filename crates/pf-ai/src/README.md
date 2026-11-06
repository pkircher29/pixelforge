# `crates/pf-ai/src` — Core `pf-ai` Implementation

Source modules for the `pf-ai` crate.

## Module Inventory

| Module | File / Subdirectory | Purpose |
|---|---|---|
| `lib` | `lib.rs` | Public crate root, re-exports, and `VERSION` constant. |
| `types` | `types.rs` | Core domain types: `ProviderId` (`OpenAi`, `XAi`, `Gemini`, `Custom(String)`), `AuthMethod`, `Capabilities`, `EditMode`, `GenerateRequest`, `EditRequest`, `ImageBytes`, `ImageSize`, `ImageResult`, `ImageResultMeta`. |
| `capabilities` | `capabilities.rs` | Built-in capability definitions (`all_capabilities`, `capabilities_for`, `OPENAI_EDIT_MODEL`). |
| `provider` | `provider.rs` | `ImageProvider` async trait, `BoxedProvider`, and pre-flight request validators (`validate_generate`, `validate_edit`). |
| `providers` | `providers/` | Built-in OpenAI, xAI, and Gemini implementations plus `providers/custom/` adapters. |
| `custom` | `custom.rs` | `CustomKind` enum, `CustomProvider` configuration struct, `ProbeResult`, and `CustomRegistry` (`ai-providers.json` persistence). |
| `oauth` | `oauth/` | Subscription OAuth session management, loopback listener, token refresh/revocation, OpenAI SIWC, and xAI device-code flow. |
| `jobs` | `jobs.rs` | `JobManager` Tokio queue, `JobId`, `JobSpec`, `JobKind`, `JobStatus`, and broadcast `JobEvent` stream. |
| `keystore` | `keystore.rs` | `KeyStore` trait, `KeyringStore` (OS credential store), `FileStore` (`ai-keys.json` XOR obfuscation), and `AutoKeyStore`. |
| `secret` | `secret.rs` | Redacting `SecretString` wrapper that never prints secret contents in `Debug` or `Display`. |
| `mask` | `mask.rs` | `crop_to_mask_bbox`, `composite_back`, and `to_openai_mask` (8-bit white=editable mask to RGBA alpha=0). |
| `ipc` | `ipc.rs` | Binary frame encoder/decoder (`encode_frame`, `decode_frame`, `encode_edit_body`, `decode_edit_body`, `encode_results`). |
| `http` | `http.rs` | Shared `reqwest::Client` builder with rustls TLS and status/error mapping helpers. |
| `error` | `error.rs` | `AiError` (`Error`) enum and `.code()` mapping to stable snake_case IPC error strings (`ai_*`). |
