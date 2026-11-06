# `scripts` — Offline Fake AI & OAuth Servers

Zero-dependency Node.js (>= 18) HTTP servers for developing and QA-testing Pixelforge's AI generation, editing, custom/local provider probing, and subscription OAuth flows offline without live API costs.

## Key Files

| File | Default Port | Role |
|---|---|---|
| `fake-ai-draw.mjs` | — | Shared dependency-free RGBA8 PNG encoder (`encodePng`), PNG header dimension reader (`pngSize`), 5x7 bitmap-font prompt renderer (`drawImage`), and HTTP/multipart helpers (`readBody`, `parseMultipart`, `json`, `sleep`). |
| `fake-ai-server.mjs` | `8787` | Emulates built-in OpenAI (`/v1/models`, `/v1/images/generations`, `/v1/images/edits`), xAI, and Google Gemini (`/v1beta/models`, `:generateContent`) endpoints. Controlled via `PF_AI_BASE_URL_{OPENAI,XAI,GEMINI}`. |
| `fake-local-ai.mjs` | `8790` | Emulates all 6 custom/local provider kinds on a single port: OpenAI-compatible, Hugging Face router/endpoint, Ollama (`/api/tags`, `/api/version`, `/api/chat`), ComfyUI (`/system_stats`, `/object_info/CheckpointLoaderSimple`, `/upload/image`, `/prompt`, `/history`, `/view`), A1111/Forge (`/sdapi/v1/*`), and Replicate (`/v1/models/*`, `/v1/predictions/*`). |
| `fake-openai-auth.mjs` | `8791` | Emulates OpenAI "Sign in with ChatGPT" (PKCE S256 authorize/token/revoke + `/v1/models` + streaming `/v1/responses`) and xAI RFC 8628 device-code OAuth (`/oauth2/device/code`, `/device`, `/oauth2/token`, `/oauth2/userinfo`, `/oauth2/revoke` + Grok Imagine). Controlled via `PF_OPENAI_AUTH_BASE` and `PF_XAI_AUTH_BASE`. |

## Prompt Error Tokens

Include any of these tokens in a prompt against the fake servers to trigger deterministic error paths:
- `!429` — HTTP `429` with `Retry-After: 7` (`ai_rate_limited`)
- `!401` — HTTP `401` (`ai_auth`)
- `!500` — HTTP `500` (`ai_http`)
- `!slow` — 20-second delay before responding (exercises job cancellation and timeouts)
- `!block` — Safety moderation rejection (`ai_moderation_blocked`)
- `!limit` (`fake-openai-auth.mjs` only) — Plan usage-limit error (`ai_plan_limit`)
