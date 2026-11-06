# `docs` — Architecture & Protocol Specifications

Authoritative design, wire-protocol, and file-format documentation for Pixelforge.

## Responsibilities

- Define the architectural boundary between the Svelte 5 / TypeScript WebGL2 webview engine and the Rust Tauri backend (`architecture.md`).
- Specify the binary framing (`u32 LE header len | JSON header | blobs`) and JSON contracts for all `io_*`, `ai_*`, `ai_custom_*`, `ai_oauth_*`, and `settings_*` Tauri IPC commands (`ipc.md`).
- Specify the `.pfproj` v2 ZIP archive layout and `manifest.json` schema (`pfproj-format.md`).
- Define the `doc.meta.aiHistory` (`manifest.ai_history`) schema and UI actions (`ai-history.md`).
- Record verified provider API capabilities, pricing, custom provider wire protocols, and OAuth/SIWC specifications (`ai-research.md`).

## Key Files

| File / Directory | Role |
|---|---|
| `architecture.md` | High-level system architecture, WebGL2 compositor design, undo history budget, and AI pipeline overview. |
| `ipc.md` | Complete Tauri command, binary frame, event (`ai://jobs`, `ai://job/<id>`, `ai://oauth`), and `CommandError` reference. |
| `pfproj-format.md` | `.pfproj` format v2 container specification, layer/mask/channel/selection PNG rules, and forward-compatibility guarantees. |
| `ai-history.md` | Schema v2 for per-document AI history entries, shootout sub-results, and diff overlay behavior. |
| `ai-research.md` | Provider capability research across OpenAI, xAI, Google Gemini, custom/local endpoints, and subscription OAuth flows. |
| `screenshots/` | README product screenshots (`layers-sample.png`, `layer-style.png`, `tools-session.png`, `ai-shootout.png`). |
