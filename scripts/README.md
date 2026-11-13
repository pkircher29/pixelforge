# `scripts` — Offline Fake AI & OAuth Servers

Zero-dependency Node.js (>= 20) HTTP servers for developing and QA-testing Pixelforge's AI generation, editing, custom/local provider probing, and subscription OAuth flows offline without live API costs.

## Key Files

| File | Default Port | CLI Command & Flags | Role |
|---|---|---|---|
| `fake-ai-draw.mjs` | — | *(library module)* | Shared dependency-free RGBA8 PNG encoder (`encodePng`), PNG header dimension reader (`pngSize`), 5x7 bitmap-font prompt renderer (`drawImage`), and HTTP/multipart helpers (`readBody`, `parseMultipart`, `json`, `sleep`). |
| `fake-ai-server.mjs` | `8787` | `node scripts/fake-ai-server.mjs [--port 8787] [--delay 1200] [--size 512]` | Emulates built-in OpenAI (`/v1/models`, `/v1/images/generations`, `/v1/images/edits`), xAI, and Google Gemini (`/v1beta/models`, `:generateContent`) endpoints. Controlled via `PF_AI_BASE_URL_{OPENAI,XAI,GEMINI}`. |
| `fake-local-ai.mjs` | `8790` | `node scripts/fake-local-ai.mjs [--port 8790] [--delay 1200] [--size 512]` | Emulates all 6 custom/local provider kinds on a single port: OpenAI-compatible, Hugging Face router/endpoint, Ollama (`/api/tags`, `/api/version`, `/api/chat`), ComfyUI (`/system_stats`, `/object_info/CheckpointLoaderSimple`, `/upload/image`, `/prompt`, `/history`, `/view`), A1111/Forge (`/sdapi/v1/*`), and Replicate (`/v1/models/*`, `/v1/predictions/*`). |
| `fake-openai-auth.mjs` | `8791` | `node scripts/fake-openai-auth.mjs [--port 8791] [--auto 2500]` | Emulates OpenAI "Sign in with ChatGPT" (PKCE S256 authorize/token/revoke + `/v1/models` + streaming `/v1/responses`) and xAI RFC 8628 device-code OAuth (`/oauth2/device/code`, `/device`, `/oauth2/token`, `/oauth2/userinfo`, `/oauth2/revoke` + Grok Imagine). Controlled via `PF_OPENAI_AUTH_BASE` and `PF_XAI_AUTH_BASE`. |

## Custom Provider Configuration (`fake-local-ai.mjs`)

When `node scripts/fake-local-ai.mjs --port 8790` is running, add any of the 6 custom provider kinds in **Edit > AI Providers…** using these settings:

| Kind | Base URL | Model / Checkpoint | Auth Token / Extra |
|---|---|---|---|
| OpenAI-compatible (`openai_compat`) | `http://127.0.0.1:8790` | `fake-sd-turbo` *(Fetch models)* | *(optional; `bad-*` fails with `401`)* |
| Hugging Face (`hugging_face`, Endpoint) | `http://127.0.0.1:8790/models/fake-sdxl` | *(any)* | Any non-empty token (`bad-*` fails with `401`) |
| Hugging Face (`hugging_face`, Router probe) | `http://127.0.0.1:8790/models/fake/sdxl` | `fake/sdxl` | Any non-empty token; set `"hubUrl": "http://127.0.0.1:8790"` in Advanced extra |
| Ollama (`ollama`) | `http://127.0.0.1:8790` | `llava:fake` *(Fetch models)* | *(none)* |
| ComfyUI (`comfy_ui`) | `http://127.0.0.1:8790` | `fake_xl.safetensors` *(Fetch)* | *(none)* |
| Stable Diffusion WebUI / Forge (`a1111`) | `http://127.0.0.1:8790` | `fake-v1-5.safetensors [abc123]` | *(none)* |
| Replicate (`replicate`) | `http://127.0.0.1:8790` | `fake/flux-schnell` | Any non-empty token (`bad-*` fails with `401`) |

## Prompt Error Tokens & Simulation Environment Variables

Include any of these tokens in a prompt against the fake servers to trigger deterministic error paths:
- `!429` — HTTP `429` with `Retry-After: 7` (`ai_rate_limited`)
- `!401` — HTTP `401` (`ai_auth`)
- `!500` — HTTP `500` (`ai_http`)
- `!slow` — 20-second delay before responding (exercises job cancellation and timeouts)
- `!block` — Safety moderation rejection (`ai_moderation_blocked`)
- `!limit` (`fake-openai-auth.mjs` only) — Plan usage-limit error (`ai_plan_limit`)

Environment variables supported by `fake-openai-auth.mjs`:
- `FAKE_SIWC_IMAGES=allow` — Allow image generation on the simulated ChatGPT subscription plan (defaults to rejecting with OpenAI's documented `subscription_sharing_unsupported_capability` error).
- `FAKE_SIWC_DENY=1` — Make the browser consent screen decline authorization (`access_denied`).
- `FAKE_EXPIRES_IN=<seconds>` — Override issued access-token lifetime (e.g. `30` to test automatic token refresh).
- `FAKE_XAI_IMAGES=deny` — Make simulated Grok Imagine reject subscription bearer tokens with HTTP `403`.
