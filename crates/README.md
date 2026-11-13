# `crates` — Rust Workspace Libraries

Pure-Rust libraries shared by the Tauri desktop shell (`app/src-tauri`). Neither crate depends on Tauri or holds the live document; both enforce `#![forbid(unsafe_code)]`.

## Crates

| Crate | Path | Responsibility |
|---|---|---|
| `pf-ai` | `crates/pf-ai/` | Object-safe `ImageProvider` trait, built-in providers (OpenAI, xAI, Gemini), 6 custom/local provider kinds (`openai_compat`, `hugging_face`, `ollama`, `comfy_ui`, `a1111`, `replicate`), subscription OAuth (`openai_siwc`, `xai_device`), Tokio `JobManager`, OS keyring + obfuscated file `KeyStore`, mask bbox cropping/compositing, and binary IPC framing (`pf_ai::ipc`). |
| `pf-io` | `crates/pf-io/` | Image decoding/encoding (`png`, `jpeg`, `webp`, `gif`, `bmp`, `tiff`), read-only PSD layer/group import, `.pfproj` v2 ZIP archive reader/writer (`manifest.json` + layer/mask/channel/selection PNGs + thumbnail), box-filter thumbnail generation, recent-file list management, and raw-bytes IPC framing (`pf_io::frame`). |
