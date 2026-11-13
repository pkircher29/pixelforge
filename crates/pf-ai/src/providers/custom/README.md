# `crates/pf-ai/src/providers/custom` — Custom & Local AI Provider Adapters

Adapters implementing `ImageProvider`, connection/capability probing (`probe`), and vision prompt rewriting (`prompt_assist`) for user-configured local and hosted endpoints.

## Key Files

| File | Kind (`CustomKind`) | Role |
|---|---|---|
| `mod.rs` | — | Dispatcher (`build_custom_provider`, `probe`, `prompt_assist`) routing across the 6 custom provider kinds. |
| `openai_compat.rs` | `openai_compat` | OpenAI-compatible servers (vLLM, LocalAI, etc.) using `/v1/models`, `/v1/images/generations`, and `/v1/images/edits`. |
| `hf.rs` | `hugging_face` | Hugging Face Inference Router and dedicated Inference Endpoints, plus public Hub model search (`hub_search_default` against `/api/models`). |
| `ollama.rs` | `ollama` | Local Ollama server adapter (`/api/tags`, `/api/version`, and vision `/api/chat` for prompt rewriting; reports image generation capabilities as `false`). |
| `comfy.rs` | `comfy_ui` | ComfyUI workflow runner (`/system_stats`, `/object_info/CheckpointLoaderSimple`, `/upload/image`, `/prompt`, `/history/{id}`, `/view`) with bundled `txt2img`, `img2img`, and `inpaint` templates (`crates/pf-ai/workflows/`). |
| `a1111.rs` | `a1111` | Stable Diffusion WebUI (AUTOMATIC1111 / Forge) adapter (`/sdapi/v1/sd-models`, `/sdapi/v1/options`, `/sdapi/v1/txt2img`, `/sdapi/v1/img2img` with native mask support). |
| `replicate.rs` | `replicate` | Replicate predictions adapter (`/v1/models/{owner}/{name}`, `/v1/predictions`, polling, and output image download). |
