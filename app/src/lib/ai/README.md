# `app/src/lib/ai` — Webview AI Pipeline, Shootout & Provider Client

Frontend client and UI orchestration for Pixelforge's AI image generation, mask/instruct editing, multi-model shootout, prompt assistance, subscription OAuth, and per-document AI history.

## Key Files

| File / Subdirectory | Role |
|---|---|
| `register.ts` | Registers the `AI` and `AI History` dock panels and `AI` / `Edit > AI Providers…` menu commands with `$lib/ui/registry.svelte`. |
| `types.ts` | TypeScript contracts matching [`docs/ipc.md`](../../../../docs/ipc.md) (`ProviderId`, `Capabilities`, `ProviderInfo`, `JobStatus`, `JobEvent`, `GenerateParams`, `EditParams`, `CustomKind`, `CustomProvider`, `ProbeResult`, `HubModel`, `AuthMode`, `OAuthStatus`, `OAuthEvent`). |
| `client.ts` | Typed `invoke` wrappers around `ai_*`, `ai_custom_*`, `ai_oauth_*`, and `settings_*` Tauri commands (`comfyTemplates`, `promptAssist`, etc.) plus binary frame packing (`buildEditFrame`, `parseResultFrame`). |
| `run.ts` | End-to-end execution pipeline (`prepareRun`, `runAi`, `applyResult`): composites the document (excluding diff overlays), handles native vs. emulated soft-mask cropping/compositing, submits the job, awaits completion, and inserts new layers via undoable commands. |
| `shootout.ts` | Multi-model shootout coordinator (`startShootout`, `rerollShootout`, `keepAsLayers`, `keepAsDocuments`): fans out one prompt across multiple enabled providers concurrently and records a unified shootout entry in `doc.meta.aiHistory`. |
| `modes.ts` | Resolves effective edit mode (`generate`, `mask`, `instruct`), capability checks, and mask-emulation crop/composite math in the webview. |
| `assist.ts` | Vision prompt-rewriting helper (`assistProviders`, `improvePrompt`) backed by Ollama custom providers or ChatGPT subscription sign-in. |
| `providers.svelte.ts` | Reactive store tracking available built-in and custom providers, capability matrices, and key status. |
| `jobs.svelte.ts` | Reactive store listening to `ai://jobs` events and tracking active/completed job states with bounded retention. |
| `oauth.svelte.ts` | Reactive store and helpers for `ai_oauth_*` commands and `ai://oauth` events. |
| `auth-ui.ts` | Pure view-model helpers (`authItems`, `authModeOf`, `subscriptionView`) for the AI Providers dialog. |
| `ui.svelte.ts` | Shared reactive form state for the `AI` panel (selected provider, mode, prompt, size, quality, variants, reference images). |
| `picker.ts`, `ProviderPicker.svelte`, `ProviderGlyph.svelte` | Provider selection dropdown model and components with cloud/local/hub/assist glyphs. |
| `history.ts` | Per-document `doc.meta.aiHistory` (`AiHistoryEntry`) CRUD, validation (`isAiHistoryEntry`), and thumbnail generation. |
| `diff.ts`, `overlay.ts` | Computes magenta pixel-difference overlays between before/after composites and manages transient `aidiff_*` layers (`withoutDiffOverlays`, `toggleDiffOverlay`). |
| `png.ts` | Browser/Canvas RGBA8 <-> PNG encoding/decoding helpers for AI payloads and thumbnails. |
| `pricing.ts`, `errors.ts` | Per-job USD cost estimation and human-readable error message mapping for `ai_*` error codes. |
| `dialogs.ts` | Openers for `AiProvidersDialog` and `AiShootoutDialog`. |
| `demo/AiDemo.svelte` | Unmounted standalone development component for isolated AI panel testing. |
