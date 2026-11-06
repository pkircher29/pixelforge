# `app/src-tauri/src/commands` — Tauri IPC Command Handlers

Thin adapters exposing `pf-ai` and `pf-io` over Tauri's IPC layer. All commands return `CommandResult<T>` (`Result<T, { code, message }>`) and move pixel/image buffers via raw binary frames (`tauri::ipc::Request` / `tauri::ipc::Response`), never base64 JSON. See [`docs/ipc.md`](../../../../docs/ipc.md) for the wire specification.

## Modules

| File | Commands | Responsibility |
|---|---|---|
| `mod.rs` | — | Re-exports `ai`, `io`, `oauth`, and `settings` command modules. |
| `ai.rs` | `ai_list_providers`, `ai_submit_generate`, `ai_submit_edit`, `ai_job_status`, `ai_cancel`, `ai_take_result`, `ai_test_key`, `ai_custom_kinds`, `ai_custom_list`, `ai_custom_add`, `ai_custom_update`, `ai_custom_remove`, `ai_custom_probe`, `ai_prompt_assist`, `ai_comfy_templates`, `ai_hub_search` | Built-in and custom AI provider listing/CRUD/probing, job submission and result retrieval, prompt assistance, Hugging Face Hub search, and `ai://jobs` / `ai://job/<id>` event forwarding. |
| `oauth.rs` | `ai_oauth_start`, `ai_oauth_cancel`, `ai_oauth_status`, `ai_oauth_sign_out`, `ai_oauth_check_images`, `ai_auth_configure` | OpenAI SIWC loopback PKCE and xAI device-code subscription sign-in flows, token lifecycle, image eligibility checks, and `ai://oauth` progress events. |
| `io.rs` | `io_ping`, `io_open`, `io_decode`, `io_open_pfproj`, `io_save_pfproj`, `io_export`, `io_encode`, `io_thumbnail`, `io_recent_list`, `io_recent_add`, `io_recent_remove` | Image and PSD import, atomic `.pfproj` v2 load/save, PNG/JPEG/WebP export and in-memory encoding, thumbnail generation, and recent-files management. |
| `settings.rs` | `settings_get`, `settings_set`, `settings_get_key_status`, `settings_set_key`, `settings_delete_key` | Atomic `settings.json` persistence in `<app_config_dir>` and OS keychain / obfuscated-file API key management. |
