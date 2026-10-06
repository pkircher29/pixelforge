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
