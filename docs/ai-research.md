# Image-generation provider research (verified 2026-10-06)

Compiled from official docs via WebFetch/WebSearch. `platform.openai.com` now 301s to `developers.openai.com`.
This is the ground truth for `crates/pf-ai`. Re-verify before any major release — these APIs move fast.

---

## 1. OpenAI

**Current models** (all on `/v1/images/*`): `gpt-image-2.5-sunburst` (snapshot `-2026-09-08`, "editing precision"), `gpt-image-2.5-flare` (`-2026-09-08`, fast everyday), `gpt-image-2` (`-2026-04-21`), `gpt-image-1.5` (`-2025-12-16`), `gpt-image-1`, `gpt-image-1-mini`, alias `chatgpt-image-latest`.
Sources: https://developers.openai.com/api/docs/guides/image-generation , https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst , https://developers.openai.com/api/docs/models/gpt-image-2

**Generate**: `POST https://api.openai.com/v1/images/generations`, JSON. Fields: `model`, `prompt` (≤32k chars), `n` (1–10), `size` (`1024x1024|1536x1024|1024x1536|auto` or custom `WIDTHxHEIGHT`), `quality` (`low|medium|high|xhigh|max|auto`; `xhigh`/`max` are 2.5-only; gpt-image-2 is low/med/high), `output_format` (`png|jpeg|webp`), `output_compression` 0–100, `background` (`transparent|opaque|auto`; transparent requires png/webp; 2.5 supports it, community reports gpt-image-2 does not), `moderation` (`auto|low`), `stream`, `partial_images` 0–3, `user`. `response_format` is deprecated for GPT-image models; they always return `b64_json`.
Custom sizes (gpt-image-2/2.5): multiples of 16, aspect ≤3:1, max edge 3840 px, 655,360–8,294,400 total pixels (i.e. up to 4K; >2560×1440 marked experimental).

Response (API reference, verbatim shape):
```json
{ "created": 0, "background": "transparent",
  "data": [ { "b64_json": "string", "revised_prompt": "string", "url": "https://example.com" } ],
  "output_format": "png", "quality": "low", "size": "1024x1024",
  "usage": { "input_tokens": 0, "input_tokens_details": { "image_tokens": 0, "text_tokens": 0 },
             "output_tokens": 0, "total_tokens": 0 } }
```

**Mask edit (inpainting)**: `POST /v1/images/edits`, **multipart/form-data**. Reference (https://developers.openai.com/api/reference/python/resources/images/methods/edit):
- `image` — one or **up to 16** files, `png|webp|jpg`, each **<50 MB**.
- `mask` — "An additional image whose **fully transparent areas (e.g. where alpha is zero)** indicate where `image` should be edited"; **must be PNG, <4 MB, same dimensions as the (first) image**; "If multiple images are provided, the mask applies to the first image." Guide adds: mask must actually contain an alpha channel (RGB-only PNG is rejected), and masking is "entirely prompt-based … may not follow its exact shape with complete precision."
- `input_fidelity` (`high|low`) only on gpt-image-1/1.5 (mini = low only).
- Same `size/quality/background/output_format/n/stream` as generate.

Guide's verbatim curl:
```bash
curl -X POST "https://api.openai.com/v1/images/edits" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "model=gpt-image-2.5-sunburst" \
  -F "mask=@mask.png" \
  -F "image[]=@sunlit_lounge.png" \
  -F 'prompt=A sunlit indoor lounge area with a pool containing a flamingo'
```
Mask convention summary: **alpha=0 → regenerate; opaque → keep.** (Opposite of the white/black convention some blogs describe.)

**Instruction edit (no mask)**: same `/v1/images/edits` without `mask`. Alternatively the Responses API `image_generation` tool (`action: "generate"|"edit"`, `input_image_mask: {file_id|image_url}`, input images as `input_image` parts with data-URL or `file_id`; output item `{"type":"image_generation_call","result":"<base64>","revised_prompt":…}`). Source: https://developers.openai.com/api/docs/guides/tools-image-generation

**Multi-ref**: yes, `image[]` up to 16 files on `/edits`.

**Auth**: `Authorization: Bearer $OPENAI_API_KEY`.

**Sign in with ChatGPT (SIWC)** — official docs https://developers.openai.com/siwc , /siwc/quickstart , /siwc/request-client-id , /siwc/token-sharing-open-source , cookbook https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt :
- Status: "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial. ChatGPT plan usage is available to all open-source partners and selected private clients." Commercial/closed-source → interest-form waitlist. Open-source and "personal projects that run locally" → self-serve via dynamic client registration (`client_id=dynamic_agent_client`, no secret), loopback listener on `127.0.0.1` is explicitly supported (desktop OK).
- Flow: Authorization Code + PKCE + OIDC. `https://auth.openai.com/api/accounts/authorize`, token `https://auth.openai.com/api/accounts/oauth/token`. Identity scopes `openid profile email`; plan-usage scopes `offline_access resource.invoke chatgpt.tokens.use.direct` with `resource=https://api.openai.com/v1`. Access token 1 h, refresh 30 d. App must persist a stable `ext_agent_host_id`.
- **What the plan token can call: the Responses API only**, with `store:false` and `stream:true` required; no temperature/max_output_tokens/file search/code interpreter. The docs do **not** list `/v1/images/*` or the `image_generation` tool as eligible. Models: call list-models with the plan token and only offer what comes back. Usage counts against the user's weekly per-app cap (Plus/Pro share a 5-hour window across apps); no automatic fallback to your API key.

**Pricing** (https://developers.openai.com/api/docs/pricing + guide): token-based for all GPT-image models — 2.5/2: $5/M text in, $8/M image in, $30/M image out ($32 for 1.5; $40 for 1; mini $8). Per-image guide table for gpt-image-2: low $0.006 / medium $0.053 / high $0.211 (1024²), ~$0.005/0.041/0.165 for 1536×1024. gpt-image-1.5 model card: low $0.009–0.013, medium $0.034–0.05, high $0.133–0.2. 2.5 has no per-image table (use the guide's calculator; `xhigh/max` cost more). Batch = 50%.

**Rate limits / gotchas**: Tier 1 = 5 images/min, 100k TPM; Tier 5 = 250 IPM. Complex prompts up to 2 min. Moderation errors: `error.code = "moderation_blocked"` with `moderation_details.{moderation_stage, categories}`. Mask: PNG + alpha + exact dimensions + <4 MB. Response always base64 (plan for 10–30 MB JSON bodies at 4K).

**SDKs**: official = JS/TS, Python, .NET, Java, Go, Ruby. No Rust; docs name community `async-openai` with "OpenAI does not verify… Use at your own risk" (https://developers.openai.com/api/docs/libraries).

---

## 2. xAI (Grok Imagine)

**Current models** (https://docs.x.ai/developers/models , https://docs.x.ai/developers/model-capabilities/imagine): `grok-imagine-image-2.0` (recommended), `grok-imagine-image` ($0.02), `grok-imagine-image-quality` ($0.05, **retired 2026-11-02**, auto-redirects to 2.0 at `quality:low` — https://docs.x.ai/developers/migration/imagine-image-quality-nov-2). `grok-2-image` is no longer listed.

**Generate**: `POST https://api.x.ai/v1/images/generations`, JSON (OpenAI-compatible). Fields (https://docs.x.ai/developers/rest-api-reference/inference/images): `model`, `prompt` (required), `n` 1–10, `aspect_ratio` (`1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, 21:9, 5:2, auto`), `resolution` (`1k` default, `1.5k`, `2k` — 2K is the max), `quality` (`low|medium|auto`, 2.0 only), `response_format` (`url` default — temporary URL — or `b64_json`), `deferred`, `user`, optional `output.upload_urls` / `storage_options` for pushing output to your own signed URLs.
Response: `data[].{url | b64_json, mime_type, file_output{file_id,filename,public_url,expires_at}}`, plus `model`, `respect_moderation`, `usage{cost_in_usd_ticks,input_tokens,output_tokens,total_tokens}`.

**Mask edit**: **not supported.** The edits endpoint has no `mask` field; the docs describe editing as prompt-driven only (https://docs.x.ai/developers/model-capabilities/images/editing). xAI explicitly notes the OpenAI SDK `images.edit()` won't work because it sends multipart while xAI expects JSON.

**Instruction edit**: `POST https://api.x.ai/v1/images/edits`, JSON. Verbatim:
```bash
curl -X POST https://api.x.ai/v1/images/edits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-imagine-image-2.0",
    "prompt": "Render this as a pencil sketch with detailed shading",
    "image": { "url": "https://docs.x.ai/assets/api-examples/images/style-realistic.png", "type": "image_url" }
  }'
```
`image.url` accepts a public URL or `data:image/jpeg;base64,...`; or `image.file_id` from the xAI Files API. Output aspect follows the first input unless `aspect_ratio` is set; `resolution`, `n`, `response_format` also accepted.

**Multi-ref**: `images: [...]` (same object shape), **max 5**, referenced in the prompt as `<IMAGE_0>`, `<IMAGE_1>` … (https://docs.x.ai/developers/model-capabilities/images/multi-image-editing).

**Limits**: input image ≤ **20 MiB**, `jpg/jpeg` or `png` only. Rate limits by spend tier (T0 = 6 RPS, T1 $50 = 12, T2 $250 = 25, T3 $1k = 50, T4 $5k = 100) (https://docs.x.ai/developers/rate-limits).

**Pricing** (https://docs.x.ai/developers/pricing): flat per image — 2.0 $0.04, image $0.02, quality $0.05; "Image edits are billed for both the input image and the generated output image." No per-resolution table published.

**Auth**: `Authorization: Bearer <key>` from console.x.ai (prepaid credits).

**OAuth with SuperGrok / X Premium**: xAI officially *announced* subscription OAuth for named open-source agents (Hermes 05-16, OpenClaw 05-19, OpenCode — https://x.ai/news/grok-opencode). Mechanism (per those projects' docs) is an RFC 8628 device-code flow against `auth.x.ai`/`accounts.x.ai` using **xAI's shared public client**. BUT: there is **no page on docs.x.ai** documenting the endpoints, client ID, scopes, or a third-party enrollment process; the quickstart only covers API keys; OpenClaw's own docs say "xAI decides which accounts can receive OAuth API tokens" and Hermes documents unexplained `HTTP 403`s for paying subscribers. Verdict: partner-blessed, not publicly documented — reusing that shared client in Pixelforge is borrowing another product's credentials, which fails the "no reverse-engineered auth" bar.

**SDKs**: official Python + Vercel AI SDK integration. No Rust.

---

## 3. Google Gemini

**Current models** (https://ai.google.dev/gemini-api/docs/image-generation): `gemini-3.1-flash-image` (workhorse, 0.5K–4K), `gemini-3.1-flash-lite-image` (1K only, cheapest), `gemini-3-pro-image` (premium, 1K/2K/4K), `gemini-2.5-flash-image` (legacy; shut down **2026-10-02** — treat as dead). **Imagen is shut down in the Gemini API** (https://ai.google.dev/gemini-api/docs/imagen).

**Two API surfaces**:
(a) **Interactions API** (recommended for new work): `POST https://generativelanguage.googleapis.com/v1beta/interactions`, `x-goog-api-key`. Verbatim multi-image example:
```json
{ "model": "gemini-3.1-flash-image",
  "input": [
    {"type": "text", "text": "An office group photo..."},
    {"type": "image", "mime_type": "image/png", "data": "<BASE64_DATA_IMG_1>"},
    {"type": "image", "mime_type": "image/png", "data": "<BASE64_DATA_IMG_2>"} ],
  "response_format": { "type": "image", "mime_type": "image/jpeg", "aspect_ratio": "5:4", "image_size": "2K" } }
```
Image parts can also carry `uri` or `file_id`. Multi-turn via `previous_interaction_id`. Response: `interaction.status`, `steps[]`, and the generated image base64 under `output_image.data` (per guide). `image_size` must be uppercase `K`.

(b) **generateContent** (now titled "Legacy", but "remains fully supported" — https://ai.google.dev/gemini-api/docs/generate-content/image-generation , https://ai.google.dev/gemini-api/docs/migrate-to-interactions). Verbatim edit example:
```bash
curl -s -X POST "https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H 'Content-Type: application/json' \
  -d '{ "contents": [{ "parts": [
          {"text": "Create a picture of my cat eating a nano-banana..."},
          {"inline_data": {"mime_type": "image/jpeg", "data": "<BASE64_IMAGE_DATA>"}} ] }],
        "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] } }'
```
REST accepts both `inline_data/mime_type` (snake) and `inlineData/mimeType` (camel); responses use camelCase: `candidates[0].content.parts[i].inlineData.{mimeType,data}` (https://ai.google.dev/api/generate-content). Size/aspect: the legacy guide shows `generationConfig.responseFormat.image{aspectRatio,imageSize}` for 3.1/3-pro while the API reference documents `generationConfig.imageConfig{aspectRatio,imageSize}` — the two pages disagree; test live (forum threads report `imageSize` being ignored when `responseModalities` includes `TEXT`, so send `["IMAGE"]` only when you need a specific size). Aspect ratios: `1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9` (legacy page also lists 1:4, 4:1, 1:8, 8:1). Sizes `512|1K|2K|4K`.

**Mask edit**: **no mask parameter.** Docs describe "semantic masking": "Conversationally define a 'mask' to edit a specific part of an image while leaving the rest untouched" — i.e. prompt-only. (Pixel masks exist only in Vertex AI Imagen editing, outside the Gemini API.)

**Multi-ref**: 3.1 Flash Image up to 14 refs (10 objects + 4 characters); 3 Pro Image 6 objects + 5 characters; 3.1 Flash Lite 14 objects.

**Limits**: inline request total ≤ **20 MB** (use the Files API above that; 2 GB/file, 20 GB/project, 48 h). Input MIME: PNG, JPEG, WEBP, HEIC, HEIF. Image input tokens: 258 per 768×768 tile. All outputs carry a SynthID watermark. No audio input; image models are paid-tier only (no free tier).

**Pricing** (https://ai.google.dev/gemini-api/docs/pricing): 3.1 Flash Image $0.045 (0.5K) / $0.067 (1K) / $0.101 (2K) / $0.151 (4K); 3.1 Flash Lite $0.0336 (1K); 3 Pro Image $0.134 (1K/2K) / $0.24 (4K); batch = 50%. Image input ~$0.25–2.00/M tokens (≈$0.001/image).

**Auth**: `x-goog-api-key: <key>` header (https://ai.google.dev/gemini-api/docs/api-key). OAuth exists (https://ai.google.dev/gemini-api/docs/oauth) but requires a **Google Cloud project** with the Generative Language API enabled and scopes `cloud-platform` / `generative-language.retriever` — it is billed to that project, never to a consumer subscription.

**Consumer subscription**: Google's own page is unambiguous (https://ai.google.dev/gemini-api/docs/google-ai-plans): "Google AI plan benefits for developer usage apply only within the Google AI Studio web interface… Direct use of the Gemini API (such as using API keys or external applications) is billed and managed separately." Since 2026-06-18 "Login with Google" for Gemini Code Assist individuals / AI Pro / AI Ultra is gone (https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals), and Google has stated that third-party tools hitting the Gemini CLI/Antigravity backends violate terms and have banned paying subscribers for it (https://github.com/google-gemini/gemini-cli/discussions/20632 , /22970).

**SDKs**: official Python, JS/TS, Go, Java, C#. No Rust.

---

## Recommendations for the Rust provider trait

Use `reqwest` (+ `multipart` feature for OpenAI edits). None of the three ships a Rust SDK.

| Capability | OpenAI (`gpt-image-2.5-*`) | xAI (`grok-imagine-image-2.0`) | Gemini (`gemini-3.1-flash-image` / `3-pro-image`) |
|---|---|---|---|
| generate | yes — JSON `/v1/images/generations` | yes — JSON `/v1/images/generations` | yes — `/v1beta/interactions` or `:generateContent` |
| mask-edit (pixel mask) | **yes** — multipart `/v1/images/edits`, PNG mask, alpha=0 = edit, same dims, <4 MB; model treats mask as guidance | **no** | **no** (prompt-described region only) |
| instruct-edit | yes — `/edits` without mask | yes — JSON `/edits` with `image{url|file_id}` | yes — image part + text |
| multi-ref | up to 16 (`image[]`) | up to 5 (`images[]`, `<IMAGE_n>`) | up to 14 (3.1 Flash) / 11 (3 Pro) |
| output | b64 only | `url` (temporary) or `b64_json` | b64 (`inlineData.data` / `output_image.data`) |
| max res | 4K (≤3840 edge, ≤8.29 MP) | 2K | 4K (3.1 Flash, 3 Pro); 1K (Lite) |
| transparent bg | yes (2.5; png/webp) | no param | no param |
| input limits | ≤16 files, <50 MB each, png/jpg/webp | ≤20 MiB, jpg/png | 20 MB total inline, else Files API |
| ~cost/image | $0.006–0.21 (gpt-image-2 table); 2.5 token-based ($30/M out) | $0.04 flat (+input for edits) | $0.067–0.151 (3.1 Flash), $0.134–0.24 (3 Pro) |

Trait sketch: `capabilities() -> {generate, mask_edit, instruct_edit, multi_ref, max_refs, max_px, transparent}`; `generate(prompt, size)`, `edit(images: Vec<Bytes>, prompt, mask: Option<Bytes>)`. For xAI/Gemini when the UI supplies a mask, degrade via Pixelforge's **mask emulation** (crop to mask bbox + padding, instruct-edit the crop, composite back under the soft mask) and show the user it's emulated — do not pretend pixel precision. Normalize OpenAI's mask: write an RGBA PNG at the exact source dimensions with alpha=0 where the user selected. Always request base64 (xAI `response_format:"b64_json"`) to avoid expiring URLs.

**OAuth-with-subscription verdict (frank)**:
- **OpenAI**: the only one with real, public, third-party docs. A local open-source desktop app qualifies for self-serve "ChatGPT plan usage" with a loopback PKCE flow. But the plan token is scoped to the **Responses API with `stream:true`/`store:false`**; `/v1/images/*` is not listed as eligible and the `image_generation` tool isn't documented as allowed. Officially feasible for *sign-in*; *maybe* for images only if the Responses `image_generation` tool turns out to be permitted — verify empirically with a plan token before building on it.
- **xAI**: blessed for a handful of named open-source agents via xAI's shared public OAuth client; no docs.x.ai documentation, no enrollment process, allowlist 403s. Not shippable. Use API keys.
- **Google**: explicitly **not supported** — AI Pro/Ultra never covered the API, consumer OAuth to the CLI/Code Assist backend was removed 2026-06-18, and doing it anyway is a ToS violation that has gotten subscribers banned. API key (Cloud-billed project) is the only option.

**Decision for Pixelforge v1**: API-key auth for all three now. `AuthMethod::OAuth` stays in the trait; OpenAI SIWC (loopback PKCE) is a v1.1 task gated on an empirical check that a plan token can run the Responses `image_generation` tool.

---

## 4. Custom providers (verified 2026-10-06, Wave 5 `ai-custom`)

Ground truth for `crates/pf-ai/src/providers/custom/*`. Every shape below was read from the
vendor's current docs or source on the date above; "live" means it was also exercised with
`curl` from this machine. Local servers were **not** installed here — `scripts/fake-local-ai.mjs`
emulates each of them from these shapes, so the fakes are only as right as this section.

### 4.1 OpenAI-compatible servers (`CustomKind::OpenAiCompat`)

| Server | `/v1/images/generations` | `/v1/images/edits` | Notes |
|---|---|---|---|
| **LocalAI** (https://localai.io/docs/features/image-generation/) | yes: JSON `prompt`, `size` (`"WxH"`), `model`, `step`, `negative_prompt` (or `prompt\|negative` syntax), `mode` | **not documented**; img2img goes through the generations body with `"file": "<base64>"` (`StableDiffusionImg2ImgPipeline`), reference images via `"ref_images"` (Flux Kontext). No mask field. | Also `POST /v1/images/upscale`. Response follows OpenAI (`data[].url` or `b64_json`); docs defer to OpenAI's reference. |
| **vLLM-Omni** (https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/image_generation_api/) | yes: `prompt`, `model`, `n` 1-10, `size` `"WxH"`, `response_format` `b64_json` (default) or `file`, extensions `negative_prompt`, `num_inference_steps`, `guidance_scale`, `true_cfg_scale`, `seed`, `lora`. Response `{ "data": [ { "b64_json": "<png>" } ] }`. | **does not exist** (only benchmark PR #3727 mentions it) | Models: Qwen-Image, Z-Image-Turbo (`vllm serve Qwen/Qwen-Image --omni`). |
| **LM Studio** (https://lmstudio.ai/docs/developer/openai-compat) | **no**: documented endpoints are `/v1/models`, `/v1/responses`, `/v1/chat/completions`, `/v1/embeddings`, `/v1/completions`. "Chat Completions (text and images)" means image *input*. | no | Adding LM Studio as an OpenAI-compatible provider probes fine (`/v1/models`) and then 404s on generate; the dialog says so. |

Implementation: `POST {base}/v1/images/generations` JSON `{model, prompt, n, size, response_format:"b64_json"}` plus `negative_prompt`, `num_inference_steps` and `step`, `guidance_scale`, `seed` when the user set them (unknown fields are ignored by every server above). `POST {base}/v1/images/edits` is sent **multipart** like OpenAI (`image[]`, optional `mask`, `prompt`, `model`, `n`, `size`) and is only offered when the user ticks `instruct_edit` / `mask_edit` in the capability editor (default off for this kind). Response: `data[].b64_json`, or `data[].url` which is fetched. Probe: `GET /v1/models` -> `data[].id`. Any hosted vendor that mimics OpenAI (Together, Fireworks, ...) fits the same arm with a key.

### 4.2 Hugging Face (`CustomKind::HuggingFace`)

- **Serverless (hf-inference)**: https://huggingface.co/docs/inference-providers/tasks/text-to-image and `huggingface.js/packages/inference/src/providers/hf-inference.ts`: base `https://router.huggingface.co/hf-inference`, route `models/{model}`. Request `POST`, `Authorization: Bearer hf_...` (fine-grained token with the "Inference Providers" permission), JSON `{ "inputs": "<prompt>", "parameters": { "negative_prompt", "width", "height", "num_inference_steps", "guidance_scale", "seed", "scheduler" } }`. Response: **raw image bytes** (`image/png` / `image/jpeg`); huggingface.js also accepts `{ "data": [ { "b64_json" } ] }` and `{ "output": [url] }` from other providers behind the router, so the Rust side sniffs: image magic -> bytes, else JSON. Live: unauthenticated POST to `.../hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0` -> `401 text/html`, so a token is mandatory.
- **image-to-image** (https://huggingface.co/docs/inference-providers/tasks/image-to-image): same URL; `inputs` is the **base64 input image** when `parameters` are present (raw bytes body only when there are none); `parameters.prompt`, `negative_prompt`, `num_inference_steps`, `guidance_scale`, `target_size{width,height}`; response raw bytes. Only models tagged `image-to-image` accept it (FLUX.1-Kontext-dev etc.); a text-to-image model answers 4xx. **No pixel mask** anywhere -> `mask_edit=false`, emulated.
- `x-use-cache` / `x-wait-for-model`: documented for the legacy `api-inference.huggingface.co` API ("x-use-cache ... boolean, defaults to true ... set to false for nondeterministic models"; `x-wait-for-model` waits instead of answering 503 while the model loads). The current huggingface.js hf-inference provider no longer sets them; the router ignores unknown headers. We send `x-use-cache: false` (never a cached image for a new prompt) and `x-wait-for-model: true`, and treat a 503 with `estimated_time` as retryable.
- **Inference Endpoints** (dedicated): the user pastes the endpoint URL as `base_url`; the same body is POSTed to it directly (no `/models/{model}` suffix), selected automatically when `base_url` is not the router.
- **Hub search** (live, 2026-10-06): `GET https://huggingface.co/api/models?pipeline_tag=text-to-image&search=flux&sort=downloads&direction=-1&limit=2` -> `[{ "id": "black-forest-labs/FLUX.1-dev", "modelId", "pipeline_tag": "text-to-image", "downloads": 698301, "likes": 15399, "tags": [...], "library_name": "diffusers" }, ...]`; `GET /api/models/{repo}` -> the same plus `author`, `gated`, `disabled`, `config.diffusers._class_name`. No auth needed for public repos (the Hub API reference moved to the OpenAPI playground: https://huggingface.co/docs/hub/api). Probe = `GET /api/models/{model}`; the pipeline tag decides `generate` vs `instruct_edit`.
- Pricing: hf-inference bills the token's monthly credits / PAYG per provider; no per-image table, shown as "-".

### 4.3 Ollama (`CustomKind::Ollama`): **prompt assist only**

- API reference (https://github.com/ollama/ollama/blob/main/docs/api.md): endpoints `POST /api/generate`, `POST /api/chat`, `GET /api/tags`, `POST /api/show`, `/api/create|copy|delete|pull|push|embed`, `GET /api/ps`, `GET /api/version`, `/api/blobs/:digest`. `generate` and `chat` take `images: ["<base64>"]` (per message for chat) for vision models (llava, qwen-vl, gemma3, ...). **The documented API has no image output of any kind**: there are no endpoints that produce images, only endpoints that accept them.
- Image *generation* (https://ollama.com/blog/image-generation, 2026-01): "experimental", **macOS only** ("Windows and Linux coming soon"), models `x/z-image-turbo`, `x/flux2-klein`; usage is `ollama run x/z-image-turbo "prompt"` which **saves a file to the current directory**; `/set width|height`, steps, seed, negative prompt via the CLI. The blog documents **no REST request/response** for it and `api.md` is unchanged; third-party write-ups claiming "/api/generate auto-detects image models" cite no field that carries the image. Feature request https://github.com/ollama/ollama/issues/16061 is closed without a maintainer answer.
- **Verdict: Ollama cannot generate images through a documented API today.** Pixelforge adds it as an honest **"Improve prompt"** helper: `POST /api/chat` `{ "model", "stream": false, "messages": [{ "role": "user", "content": "<instruction>", "images": ["<base64 composite>"] }] }` -> `message.content`. Probe: `GET /api/tags` -> `models[].name`, and `details.families` containing `clip`/`mllama`/`qwen2vl`/... marks vision-capable ones. Re-check when `api.md` gains an image field.

### 4.4 ComfyUI (`CustomKind::ComfyUi`)

Routes (https://docs.comfy.org/development/comfyui-server/comms_routes + `ComfyUI/server.py`):

| Route | Request | Response |
|---|---|---|
| `POST /prompt` | `{ "prompt": <API-format workflow>, "client_id": "<uuid>" }` (+ optional `extra_data`, `front`, `prompt_id`) | 200 `{ "prompt_id", "number", "node_errors" }`; 400 `{ "error": {type,message,details,extra_info}, "node_errors": {...} }` |
| `GET /history/{prompt_id}` | - | `{ "<prompt_id>": { "prompt": [...], "outputs": { "<node_id>": { "images": [ { "filename", "subfolder", "type": "output" } ] } }, "status": { "status_str": "success" or "error", "completed": bool, "messages": [...] } } }`; `{}` while still queued/running |
| `GET /view?filename=&subfolder=&type=output` | - | the image bytes (`image/png` ...) |
| `POST /upload/image` | multipart `image` (file), `overwrite` (`"true"`), `type` (`input`), `subfolder` | `{ "name", "subfolder", "type" }` (newer builds add `asset`) |
| `GET /object_info/CheckpointLoaderSimple` | - | `{ "CheckpointLoaderSimple": { "input": { "required": { "ckpt_name": [ ["a.safetensors", ...], {...} ] } } } }` |
| `GET /system_stats` | - | `{ "system": { "os", "ram_total", "ram_free", "comfyui_version", "python_version", "pytorch_version" }, "devices": [ { "name", "type", "vram_total", "vram_free" } ] }` |
| `GET /queue`, `POST /interrupt`, `GET /models/{folder}`, `/ws` (`status`, `execution_start`, `executing`, `progress {value,max}`, `executed`) | | polling `/history` every 500 ms is simpler than the websocket and is what we do; `/interrupt` on cancel |

Workflow JSON is the **API format** ("Save (API format)" in the UI): `{ "<node_id>": { "class_type": "KSampler", "inputs": { "seed": 1, "steps": 20, "cfg": 7, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } } }`. Core node classes used by the bundled templates: `CheckpointLoaderSimple{ckpt_name}` -> `(MODEL, CLIP, VAE)`, `CLIPTextEncode{text, clip}`, `EmptyLatentImage{width,height,batch_size}`, `KSampler{...}`, `VAEDecode{samples, vae}`, `SaveImage{filename_prefix, images}`, `LoadImage{image}` -> `(IMAGE, MASK)`, `VAEEncode{pixels, vae}`, `VAEEncodeForInpaint{pixels, vae, mask, grow_mask_by}`, `SetLatentNoiseMask{samples, mask}`, `ImageToMask{image, channel}`. Templates live in `crates/pf-ai/workflows/{txt2img,img2img,inpaint}.json` with `{{prompt}} {{negative}} {{image}} {{mask}} {{width}} {{height}} {{seed}} {{steps}} {{cfg}} {{checkpoint}} {{denoise}} {{sampler}} {{scheduler}} {{batch}}` placeholders; a string that is exactly a numeric placeholder becomes a JSON number. `LoadImage.image` receives the `name` returned by `/upload/image`. ComfyUI's `MASK` convention is **white/1.0 = inpaint**, same as Pixelforge's; the inpaint template loads the mask PNG with `LoadImage` and converts it with `ImageToMask(channel=red)`.

### 4.5 Stable Diffusion WebUI / Forge (`CustomKind::A1111`)

Launch with `--api` (`--listen` for LAN, `--api-auth user:pass` for basic auth); the live schema is at `http://127.0.0.1:7860/docs` (the wiki page https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API says it is unmaintained). Fields from `modules/api/models.py` + `modules/processing.py` (master, 2026-10-06):

- `POST /sdapi/v1/txt2img`: `prompt`, `negative_prompt`, `steps`, `cfg_scale`, `width`, `height`, `sampler_name` (`sampler_index` legacy, default `Euler`), `scheduler`, `seed` (-1 = random), `batch_size`, `n_iter`, `override_settings: { "sd_model_checkpoint": "<title>" }`, `override_settings_restore_afterwards`, `send_images` (true), `save_images` (false). Response `{ "images": ["<base64 png>", ...], "parameters": {...}, "info": "<json string>" }`.
- `POST /sdapi/v1/img2img`: all of the above plus `init_images: ["<base64>"]`, `denoising_strength` (0.75), `resize_mode`, `mask: "<base64 png>"`, `mask_blur` (4), `inpainting_fill` (0 fill, 1 original, 2 latent noise, 3 latent nothing; `processing.py` "Masked content"), `inpaint_full_res` (true = "Only masked"), `inpaint_full_res_padding`, `inpainting_mask_invert` (0 = "Inpaint masked", 1 = "Inpaint not masked", implemented as `ImageOps.invert(image_mask)`), `initial_noise_multiplier`, `image_cfg_scale`. The mask is `convert('L')`-ed; with `inpainting_mask_invert = 0` **white = repainted**, which is Pixelforge's convention, so the conversion is only a normalisation to an 8-bit grey PNG at the init image's size (`mask::to_a1111_mask`).
- `GET /sdapi/v1/sd-models` -> `[ { "title": "v1-5-pruned.safetensors [6ce0161689]", "model_name", "hash", "sha256", "filename", "config" } ]` (pass `title` to `sd_model_checkpoint`); `GET/POST /sdapi/v1/options` (`sd_model_checkpoint`); `GET /sdapi/v1/samplers` -> `[ { "name", "aliases", "options" } ]`; `GET /sdapi/v1/progress` -> `{ "progress": 0-1, "eta_relative", "state", "current_image", "textinfo" }`; `POST /sdapi/v1/interrupt`.

### 4.6 Replicate and fal.ai (`CustomKind::Replicate`: bonus; fal documented only)

- **Replicate** (https://replicate.com/docs/reference/http): `POST https://api.replicate.com/v1/models/{owner}/{name}/predictions` with `{ "input": { "prompt": "...", ... } }` for official models, or `POST /v1/predictions` with `{ "version": "<64 hex>", "input": {...} }`; header `Authorization: Bearer $REPLICATE_API_TOKEN`; `Prefer: wait` (or `wait=n`, 1-60 s) blocks up to 60 s. Response `{ "id", "status": "starting|processing|succeeded|failed|canceled", "output": <url or [url, ...]>, "error", "urls": { "get", "cancel" } }`; poll `GET /v1/predictions/{id}` until terminal, then download the output URL(s). `GET /v1/models/{owner}/{name}` -> `{ "latest_version": { "id" }, "default_example", ... }` is the probe. Input images go in `input.image` as a data URL (model-specific name; `image` is the convention for FLUX/SDXL img2img). Masks exist only on inpainting models (`mask`, white = inpaint), off by default.
- **fal.ai** (https://fal.ai/docs/documentation/model-apis/inference/queue): `POST https://queue.fal.run/{model_id}` `{ "prompt": ... }` with `Authorization: Key $FAL_KEY` -> `{ "request_id", "status_url", "response_url", "queue_position" }`; `GET .../requests/{id}/status` -> `IN_QUEUE | IN_PROGRESS | COMPLETED`; `GET .../requests/{id}` -> model output, typically `{ "images": [ { "url", "width", "height", "content_type" } ], "seed" }`. The synchronous `https://fal.run/{model_id}` form is in the SDK docs (`fal_client.run`) but the HTTP page only documents the queue. **Not implemented in Wave 5**: the Replicate arm covers "hosted less-mainstream models"; fal is a short follow-up using the same fetch-output-URL path.

### 4.7 Capability defaults per kind (editable in the dialog)

| kind | generate | instruct | mask | multi_ref | custom sizes | local | probe |
|---|---|---|---|---|---|---|---|
| `openai_compat` | yes | off (on for LocalAI-like servers that implement `/edits`) | off | off | yes | base URL is loopback/LAN | `GET /v1/models` |
| `hugging_face` | yes | per pipeline tag (`image-to-image`) | **no** (emulated) | no | yes (multiples of 8) | no | `GET /api/models/{model}` |
| `ollama` | **no** | no | no | - | - | yes | `GET /api/tags` |
| `comfy_ui` | yes | yes | **native** | no | yes (multiples of 8) | yes | `GET /system_stats` + `/object_info/CheckpointLoaderSimple` |
| `a1111` | yes | yes | **native** | no | yes (multiples of 8) | yes | `GET /sdapi/v1/sd-models` |
| `replicate` | yes | per model (`image` input) | off | no | yes | no | `GET /v1/models/{owner}/{name}` |
