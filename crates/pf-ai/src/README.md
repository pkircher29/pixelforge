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
| `custom` | `custom.rs` | `CustomKind` enum, `CustomProvider` configuration struct, `ProbeResult`, and `CustomRegistry` (`ai-providers.json` atomic persistence). |
| `oauth` | `oauth/` | Subscription OAuth session management, loopback listener, token refresh/revocation, OpenAI SIWC, and xAI device-code flow. |
| `jobs` | `jobs.rs` | `JobManager` Tokio queue, `JobId`, `JobSpec`, `JobKind`, `JobStatus`, automatic settled-job pruning, and broadcast `JobEvent` stream. |
| `keystore` | `keystore.rs` | `KeyStore` trait, `KeyringStore` (OS credential store), `FileStore` (`ai-keys.json` atomic XOR obfuscation), and `AutoKeyStore`. |
| `secret` | `secret.rs` | Redacting `SecretString` wrapper that never prints secret contents in `Debug` or `Display`. |
| `mask` | `mask.rs` | `to_openai_mask` (8-bit white=editable mask to RGBA alpha=0) and `to_a1111_mask` (grayscale PNG normalization for A1111/Forge). |
| `ipc` | `ipc.rs` | Binary frame helpers (`encode_edit_body`, `decode_edit_body`, `encode_results`) delegating raw frame packing (`encode_frame`, `decode_frame`) to `pf_io::frame`. |
| `http` | `http.rs` | Shared `reqwest::Client` builder with rustls TLS and status/error mapping helpers. |
| `error` | `error.rs` | `AiError` (`Error`) enum and `.code()` mapping to stable snake_case IPC error strings (`ai_*`). |
