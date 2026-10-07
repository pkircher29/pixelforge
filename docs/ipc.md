# IPC reference

Every Tauri command returns `Result<T, { code, message }>` (`CommandError`,
`app/src-tauri/src/error.rs`). Pixel data never crosses IPC as base64 JSON: commands
that move pixels use raw bytes (`tauri::ipc::Request` body / `tauri::ipc::Response`)
with the framing below.

## Binary frame (shared by all raw-bytes commands)

```text
+-------------------+----------------------+--------+--------+-----+
| u32 little-endian | JSON header (UTF-8)  | blob 0 | blob 1 | ... |
| header byte length|                      |        |        |     |
+-------------------+----------------------+--------+--------+-----+
```

- The header is a JSON **object**. It always carries `"blobs": [len0, len1, ...]`, the
  byte length of each blob in order; the blobs are concatenated directly after the
  header with no padding. Other header fields are command-specific (camelCase).
- Blobs are referenced from the header by index (`"blob": 0`).
- Pixel blobs are **straight-alpha RGBA8**, row-major, `width * height * 4` bytes,
  unless the header says `"encoding": "gray"` (`width * height` bytes, masks) or
  `"encoding": "png"` (an encoded PNG file).
- The total length must equal `4 + header + sum(blobs)` exactly; anything else is
  rejected with `io_frame`.
- Reference implementation: `crates/pf-io/src/frame.rs` (`encode_frame` /
  `decode_frame`). A TypeScript mirror belongs in `app/src/lib/io/frame.ts`.

Sending a frame (or any raw body) from the webview:

```ts
import { invoke } from '@tauri-apps/api/core';
const body: Uint8Array = encodeFrame(header, [rgba]);
const out = await invoke<ArrayBuffer>('io_save_pfproj', body);   // raw body, no JSON args
```

Receiving: `const buf = await invoke<ArrayBuffer>('io_open', { path });` then
`decodeFrame(new Uint8Array(buf))`.

Raw-body commands take **no** JSON arguments: everything (paths, options) lives in the
frame header. Commands that only need a path take ordinary JSON args.

## IO commands (`commands/io.rs`, owner: io-rust)

Error codes: `io_unsupported_format`, `io_decode`, `io_encode`, `io_psd`,
`io_project`, `io_too_large` (edge > 8192), `io_frame`, `io_invalid_buffer`,
`io_image`, `io` (filesystem), `json`.

### `io_ping() -> { reply, importExtensions: string[], exportExtensions: string[] }`

Liveness + the extension lists for the dialogs.

### `io_open({ path }) -> frame`  (JSON arg, raw response)

Opens PNG / JPEG (EXIF orientation applied) / WebP / GIF (first frame) / BMP / TIFF /
PSD. `.pfproj` paths are rejected (`io_unsupported_format`, use `io_open_pfproj`).

Header (`OpenHeader`):

```jsonc
{
  "width": 1920, "height": 1080,
  "sourceFormat": "png",            // png | jpeg | webp | gif | bmp | tiff | psd
  "layers": [                       // bottom-most first; one entry for a plain image
    {
      "name": "Background",
      "x": 0, "y": 0, "w": 1920, "h": 1080,   // blob rectangle on the canvas
      "opacity": 1.0, "visible": true,
      "blendMode": "normal",        // one of the 16 names (docs/pfproj-format.md)
      "isGroup": false,
      "groupDepth": 0,              // 1 = inside a group
      "group": null,                // index of the containing group entry in `layers`
      "blob": 0                     // index into blobs; null for groups
    }
  ],
  "blobs": [8294400]
}
```

PSD specifics: groups become `isGroup: true` entries placed directly **above** (after)
their children; nesting deeper than one level is flattened to the top-level group.
Layers hanging off the canvas are clipped to it (so `x`/`y` are >= 0). Hidden layers
come through with `visible: false`. A flattened PSD yields one `Background` layer.

### `io_decode(body: file bytes) -> frame`  (raw body, raw response)

Same as `io_open` for in-memory bytes (clipboard paste, drag-drop). The body is the
raw file bytes — **not** a frame.

### `io_open_pfproj({ path }) -> frame`  (JSON arg, raw response)

Header (`ProjectHeader`):

```jsonc
{
  "path": "C:/art/poster.pfproj",
  "manifest": { /* manifest.json verbatim, snake_case — see docs/pfproj-format.md */ },
  "layers":    [ { "id": "l-1", "width": 1920, "height": 1080, "blob": 0, "encoding": "rgba" } ],
  "masks":     [ { "id": "l-1", "width": 1920, "height": 1080, "blob": 1, "encoding": "gray" } ],
  "selection":   { "width": 1920, "height": 1080, "blob": 2, "encoding": "gray" },   // or absent
  "thumbnail":   { "width": 256,  "height": 144,  "blob": 3, "encoding": "png" },    // or absent
  "blobs": [ ... ]
}
```

`layers` follows `manifest.layers` order (groups have no entry here). Layer / mask /
selection blobs are always decoded pixels; `thumbnail` is the stored PNG.

### `io_save_pfproj(body: frame) -> { path, bytes, modified }`  (raw body, JSON result)

Header: the same `ProjectHeader` shape, with:

- `path` **required**;
- `manifest`: the UI's manifest. Rust overwrites `format`, `app_version`, `modified`,
  sets `created` if empty, and fills the `file` / `mask` / `selection.file` /
  `thumbnail` paths. `ai_history` is passed through untouched.
- `layers[]` one per **raster** layer (`encoding` `"rgba"` default, or `"png"` to store
  a PNG you already encoded — its IHDR size must match the manifest entry);
- `masks[]` optional (`"gray"` or `"png"`); `selection` optional (`"gray"`/`"png"`,
  canvas-sized);
- `thumbnail` optional: an RGBA composite at **any** size — Rust box-filters it down to
  256 px — or a ready `"png"`.

The file is written atomically (temp file + rename). Returns the RFC 3339 `modified`
that was stored, so the UI can mirror it.

### `io_export(body: frame) -> { path, bytes }`  (raw body, JSON result)

Header (`EncodeHeader`):

```jsonc
{
  "path": "C:/out/poster.jpg",      // required
  "format": "png" | "jpeg" | "webp",
  "opts": {                         // every field optional
    "quality": 90,                  // jpeg / lossy webp, 1-100
    "lossless": false,              // webp only
    "pngCompression": "fast" | "best",
    "background": [255, 255, 255]   // jpeg: alpha is flattened onto this colour
  },
  "width": 1920, "height": 1080,
  "blob": 0                         // RGBA8
}
```

Atomic write. GIF / BMP / TIFF / PSD export return `io_unsupported_format`.

### `io_encode(body: frame) -> ArrayBuffer`  (raw body, raw response)

Same header as `io_export` (`path` ignored). Returns the encoded file bytes directly,
**not** a frame. For clipboard image writes and AI uploads.

### `io_thumbnail(body: frame) -> ArrayBuffer`  (raw body, raw response)

Header `{ "width", "height", "maxPx": 256, "blob": 0 }` + RGBA8 blob. Returns PNG bytes
(longest edge <= `maxPx`, premultiplied box filter), not a frame.

### `io_recent_list() -> string[]`

Most recent first, max 20. Entries whose file no longer exists are pruned. Stored in
`<app config dir>/recent.json`.

### `io_recent_add({ path }) -> string[]`

Moves `path` to the front (LRU, case-insensitive on Windows). Returns the list.

### `io_recent_remove({ path? }) -> string[]`

Removes one entry, or clears the list when `path` is omitted/null. Returns the list.

### Native dialogs

Not wrapped: call `@tauri-apps/plugin-dialog` (`open` / `save`) from the webview and
hand the chosen path to the commands above. The commands use `std::fs` directly, so no
`fs` plugin scope is involved.

## AI commands (`commands/ai.rs` + `crates/pf-ai`, owner: ai-rust)

The AI commands use the **same binary frame** as above (`pf_ai::ipc::{encode_frame,
decode_frame}` is a layout-identical re-implementation so the crates stay independent).
Blobs here are always **encoded images** (PNG from `canvas.toBlob`, or JPEG/WebP where
the provider allows), never raw RGBA — use `io_encode` or the canvas to produce them.
Frame errors surface as `ai_invalid_request`.

### Types

```ts
type ProviderId = 'open_ai' | 'x_ai' | 'gemini' | `custom:${string}`;   // custom = registry id, see "Custom providers"
type EditMode = 'mask' | 'instruct';
type ImageSize = { width: number; height: number };

type Capabilities = {
  generate: boolean; maskEdit: boolean; instructEdit: boolean; multiRef: boolean;
  maxRefs: number;             // input images per request incl. the composite
  sizes: ImageSize[];          // presets (OpenAI); empty for aspect-driven providers
  customSizes: boolean;        // any size accepted (mapped to nearest aspect/tier if needed)
  aspectRatios: string[];      // '16:9' ... (xAI, Gemini)
  resolutions: string[];       // '1k' | '1.5k' | '2k' (xAI); '512' | '1K' | '2K' | '4K' (Gemini)
  maxPx: number;               // longest edge
  maxVariants: number;         // max n
  transparentBg: boolean;      // OpenAI only
  models: string[];            // models[0] is the default
};

type ProviderInfo = {
  id: ProviderId; name: string; vendor: string; capabilities: Capabilities;
  hasKey: boolean; keyBackend: 'keyring' | 'file';
  defaultModel: string; editModel: string; models: string[];
  kind: 'builtin' | CustomKind;  // which wire protocol
  local: boolean;                // base URL is loopback / LAN: no cost, 🖥 glyph
  icon: 'cloud' | 'local' | 'hub' | 'assist';
  promptAssist: boolean;         // can rewrite prompts (Ollama) but never makes images
  keyOptional: boolean;          // a secret is optional (local servers)
};

type JobId = string;           // 32 hex chars

type ImageResultMeta = {
  width: number; height: number; provider: ProviderId; model: string;
  revisedPrompt?: string; costUsd?: number; mime: 'image/png'; bytes: number;
};

type JobStatus =
  | { state: 'queued' } | { state: 'running' }
  | { state: 'completed'; results: ImageResultMeta[]; available: boolean }
  | { state: 'failed'; code: string; message: string }
  | { state: 'cancelled' };

type JobEvent = { job: JobId; provider: ProviderId } & (
  | { type: 'queued' } | { type: 'started' } | { type: 'progress'; pct: number | null }
  | { type: 'completed'; results: ImageResultMeta[]; durationMs: number }
  | { type: 'failed'; code: string; message: string }
  | { type: 'cancelled' });

type GenerateParams = {
  provider: ProviderId; prompt: string; negativePrompt?: string; size?: ImageSize;
  n?: number /* default 1 */; model?: string; quality?: string; transparent?: boolean;
  seed?: number /* ignored by all three providers today */; timeoutSecs?: number /* 10..3600 */;
};

type EditParams = GenerateParams & {
  mode: EditMode;
  mask: boolean;   // a mask blob follows the image blob
  refs: number;    // how many reference-image blobs follow
};
```

`quality` is provider-specific and passed through verbatim: OpenAI
`low|medium|high|xhigh|max|auto`, xAI `low|medium|auto`, Gemini ignores it.
`negativePrompt` is folded into the prompt as `"\n\nDo not include: …"` (none of the
APIs has a negative-prompt field). `size` maps to OpenAI `size` (presets or a custom
`WxH`: multiples of 16, aspect <= 3:1, edge <= 3840, 0.65–8.3 MP), to xAI
`aspect_ratio` + `resolution` (nearest), and to Gemini `aspectRatio` + `imageSize`
(nearest tier).

### Commands

| command | args | returns |
|---|---|---|
| `ai_list_providers` | – | `ProviderInfo[]` |
| `ai_submit_generate` | `{ params: GenerateParams }` | `JobId` |
| `ai_submit_edit` | frame (below) | `JobId` |
| `ai_job_status` | `{ job: JobId }` | `JobStatus` (`ai_unknown_job` otherwise) |
| `ai_cancel` | `{ job: JobId }` | `boolean` — `true` if it was still queued/running |
| `ai_take_result` | `{ job: JobId }` | frame (below); `ai_no_result` if not finished / already taken |
| `ai_test_key` | `{ provider: ProviderId }` | `null`; `ai_auth` on a bad key, `ai_not_configured` if none. For `custom:<id>` this runs the kind's probe. |

`ai_list_providers` returns the three built-ins followed by every registered custom
provider (registry order). `ai_submit_*` accept any `ProviderId`; a custom id resolves its
registry entry and its optional secret (`ai_not_configured` when the kind needs one and
none is stored, or when the entry was removed).

Generate-with-reference-images is expressed as an **instruct edit** whose image blob is
the first reference and `refs` carries the rest (OpenAI and xAI route references through
their `/edits` endpoints anyway; Gemini treats every image part the same).

Mask edits (`mode: 'mask'`) are only accepted by providers whose `capabilities.maskEdit`
is `true` (OpenAI). For xAI / Gemini the webview must emulate: crop the composite to the
mask bbox (+ padding), send an *instruct* edit of the crop, composite the result back
inside the soft mask. `pf_ai::mask::{crop_to_mask_bbox, composite_back}` are the Rust
reference implementations. Pixelforge masks are 8-bit PNGs, **white = editable**; the
OpenAI provider converts them to OpenAI's RGBA alpha=0 convention itself.

### `ai_submit_edit(body: frame) -> JobId`  (raw body, JSON result)

Header: `EditParams` + `blobs`. Blob order is fixed:

1. the composite image (required, non-empty),
2. the mask — present iff `mask: true`, same dimensions as the composite,
3. `refs` reference images.

`blobs.length` must equal `1 + (mask ? 1 : 0) + refs`. Per-provider input limits are
checked **before** anything is sent (`ai_invalid_request`): OpenAI <= 16 images,
< 50 MB each, mask < 4 MB, PNG/JPEG/WebP; xAI <= 5 images, <= 20 MiB each, PNG/JPEG
only; Gemini <= 14 images, <= 20 MB total inline (base64-inflated).

```ts
const body = encodeFrame({ provider: 'open_ai', mode: 'mask', prompt, mask: true, refs: 0 }, [compositePng, maskPng]);
const job = await invoke<string>('ai_submit_edit', body);
```

### `ai_take_result({ job }) -> frame`  (JSON arg, raw response)

Header `{ "results": ImageResultMeta[], "blobs": [...] }`; blob `i` is the **PNG** bytes
of `results[i]` (always PNG, whatever the provider returned). Bytes are moved out of
Rust on the first call; the job's status then shows `available: false` and a second
call fails with `ai_no_result`.

```ts
const buf = await invoke<ArrayBuffer>('ai_take_result', { job });
const { header, blobs } = decodeFrame(new Uint8Array(buf));
header.results.forEach((meta, i) => addLayer(meta, blobs[i] /* PNG */));
```

### Events

Every `JobEvent` is emitted on two topics: `ai://job/<JobId>` and the catch-all
`ai://jobs`. Because `ai_submit_*` returns the id *after* the `queued` event (and a
locally rejected request can fail within milliseconds), **register the `ai://jobs`
listener before submitting** and filter by `job`; use `ai://job/<id>` for long-lived
per-job UI. `progress.pct` is `null` for all three providers today (no streaming yet).

Queue defaults: 2 concurrent jobs, 180 s per-job timeout (override with `timeoutSecs`,
clamped to 10–3600), queued jobs wait without consuming a slot and can be cancelled
before they start. Cancelling a running job aborts the HTTP request.

### Error codes

| code | meaning | retry? |
|---|---|---|
| `ai_not_configured` | no key stored for that provider | after adding a key |
| `ai_auth` | provider rejected the key (401/403) | no |
| `ai_rate_limited` | 429; message may carry `Retry-After` | yes, later |
| `ai_moderation_blocked` | safety filter blocked prompt or image | change the prompt |
| `ai_bad_request` | provider rejected the request (400/422) | fix the request |
| `ai_invalid_request` | rejected locally before sending (size, limits, framing) | fix the request |
| `ai_unsupported` | capability not available for that provider | pick another provider |
| `ai_timeout` | per-job deadline hit | yes |
| `ai_cancelled` | cancelled by the user | – |
| `ai_transport` | network failure | yes |
| `ai_http` | other non-2xx | 5xx: yes |
| `ai_invalid_response` | 2xx but unparsable / no image | maybe |
| `ai_image` | local image decode/encode failure | fix the input |
| `ai_unknown_job`, `ai_no_result` | bad job id / nothing to take | – |

## Custom providers (`commands/ai.rs` + `pf_ai::custom`, owner: ai-custom)

User-defined providers live in `<config>/ai-providers.json` (`{ version: 1, providers: [] }`);
their secrets go to the key store under the user name `custom:<id>` and never cross IPC
back. Research and wire shapes per kind: `docs/ai-research.md` §4.

```ts
type CustomKind = 'openai_compat' | 'hugging_face' | 'ollama' | 'comfy_ui' | 'a1111' | 'replicate';

type CustomProvider = {
  id: string;                  // [a-z0-9][a-z0-9-]{0,63}, unique
  name: string;                // display name (layer names use it)
  kind: CustomKind;
  baseUrl: string;             // http(s) root; trailing slashes ignored
  model: string;               // model / repo id / checkpoint title / owner/name per kind
  capabilities: Capabilities;  // kind defaults, user-editable (mask_edit only where native)
  extra: Record<string, unknown>;  // steps, cfg, sampler, scheduler, denoise, seed, checkpoint,
                               // workflow | workflowImg2img | workflowInpaint (ComfyUI, object or JSON string),
                               // maskBlur, inpaintingFill, inpaintFullRes (A1111), version, imageField, input (Replicate),
                               // hubUrl (HF, tests), models (cached probe list)
  hasAuth: boolean;            // a secret is stored for it
};

type ProbeResult = { reachable: boolean; models: string[]; detectedCaps?: Capabilities; message: string; version?: string; authFailed: boolean };
type HubModel = { id: string; pipelineTag?: string; downloads: number; likes: number; gated: boolean };
type CustomKindInfo = { kind: CustomKind; label: string; description: string; defaultBaseUrl: string; helpUrl: string; requiresAuth: boolean; promptAssist: boolean; defaultCapabilities: Capabilities };
```

| command | args | returns |
|---|---|---|
| `ai_custom_kinds` | – | `CustomKindInfo[]` (static) |
| `ai_custom_list` | – | `CustomProvider[]` |
| `ai_custom_add` | `{ provider: CustomProvider, auth?: string \| null }` | `CustomProvider[]`; `ai_invalid_request` on a bad id / URL / duplicate |
| `ai_custom_update` | `{ provider, auth?: string \| null, clearAuth?: boolean }` | `CustomProvider[]`; a non-empty `auth` replaces the secret, `clearAuth` deletes it, otherwise it is kept |
| `ai_custom_remove` | `{ id: string }` | `CustomProvider[]` (secret deleted too) |
| `ai_custom_probe` | `{ provider: CustomProvider, auth?: string \| null }` | `ProbeResult` — probes the entry **as given** (unsaved form values are fine); `auth` overrides the stored secret for this call only. Server-side problems never reject: they come back as `reachable: false` / `authFailed: true`. |
| `ai_prompt_assist` | frame: header `{ provider: ProviderId, text: string }` + at most one image blob (PNG/JPEG) | `string` — the rewritten prompt. `custom:<id>` entries of kind `ollama`, or `open_ai` in ChatGPT-subscription mode (see "Subscription sign-in"); `ai_unsupported` otherwise, `ai_invalid_request` when neither text nor image is given. |
| `ai_hub_search` | `{ query: string, pipelineTag?: 'text-to-image' \| 'image-to-image', limit?: number }` | `HubModel[]` (public Hub, no token) |
| `ai_comfy_templates` | – | `{ txt2img, img2img, inpaint }` — the bundled API-format workflows as JSON text |

Probe endpoints per kind: OpenAI-compat `GET /v1/models`; Hugging Face `GET
https://huggingface.co/api/models/{model}` (router) or `GET base` (dedicated endpoint);
Ollama `GET /api/tags` (+ `/api/version`); ComfyUI `GET /system_stats` + `GET
/object_info/CheckpointLoaderSimple`; A1111 `GET /sdapi/v1/sd-models` (+ `/sdapi/v1/options`);
Replicate `GET /v1/models/{owner}/{name}`.

Ollama entries report `capabilities` all `false` and `promptAssist: true`: Ollama's HTTP API
has no image output, so Pixelforge only uses it to rewrite prompts (`ai_prompt_assist`).
Masks: ComfyUI and A1111 take Pixelforge's white-is-editable mask natively; Hugging Face
never does (emulated in the webview); OpenAI-compatible servers get OpenAI's alpha mask and
only when the user ticked `maskEdit`.

Dev fake for every kind: `node scripts/fake-local-ai.mjs` (port 8790), see its header.

## Subscription sign-in (`commands/oauth.rs` + `pf_ai::oauth`, owner: oauth)

Officially documented flows only (`docs/ai-research.md` section 5): **ChatGPT** = OpenAI "Sign in with
ChatGPT" (Authorization Code + PKCE S256 + OIDC, dynamic client registration, loopback redirect
`http://127.0.0.1:<random port>/callback`, 5-minute timeout); **Grok** = xAI RFC 8628 device flow,
available **only** when a client ID issued to Pixelforge by xAI is configured (`PF_XAI_OAUTH_CLIENT_ID`
or the Settings field); **Gemini** has none. Token records (`{ accessToken, refreshToken, idToken,
expiresAt, clientId, scopes, email, plan, planUsage, images, models }`) live in the key store under the
user name `oauth:<provider>` (`oauth:open_ai`, `oauth:x_ai`) and never cross IPC. Access tokens are
refreshed (serialised) 120 s before expiry and once after a 401.

```ts
type AuthMode = 'api_key' | 'subscription';
// ProviderInfo gains:
//   authModes: AuthMode[]        // ['api_key'] or ['api_key','subscription'] (open_ai, x_ai)
//   authActive: AuthMode         // what requests use; settings.json aiAuth.<provider>.mode
//   account?: { email?: string; plan?: string }   // signed-in account (plan only where documented)
//   promptAssist: true for open_ai when authActive = 'subscription' and signed in
type ImageAccess = { eligible: boolean; detail: string; source: 'docs' | 'live' | 'unknown'; checkedAt: number };
type PlanModel = { slug: string; displayName: string };
type OAuthStart = { flow: 'loopback' | 'device'; authUrl: string; userCode?: string; verificationUri?: string; expiresIn?: number; browserFailed: boolean };
type OAuthStatus = {
  provider: ProviderId; available: boolean; unavailableReason?: string; docsUrl: string;
  flow: 'loopback' | 'device' | 'none'; signedIn: boolean; pending: boolean;
  email?: string; plan?: string; planUsage: boolean; images?: ImageAccess; models: PlanModel[];
  authMode: AuthMode; fallbackToKey: boolean;
  clientIdSource?: 'env' | 'settings' | 'none';   // x_ai
  manageUrl?: string;                              // open_ai: https://chatgpt.com/settings/usage
};
type OAuthEvent = { provider: ProviderId; state: 'waiting' | 'signed_in' | 'signed_out' | 'error'; email?: string; plan?: string; error?: string; code?: string };
```

| command | args | returns |
|---|---|---|
| `ai_oauth_start` | `{ provider }` | `OAuthStart`. Opens the system browser (`tauri-plugin-opener`), emits `waiting`, finishes in the background and emits `signed_in` (switching `aiAuth.<provider>.mode` to `subscription`) or `error`. Listen to `ai://oauth` **before** calling. `ai_oauth_unavailable` for Gemini and for Grok without a client ID. |
| `ai_oauth_cancel` | `{ provider }` | `boolean` (a sign-in was pending) |
| `ai_oauth_status` | `{ provider }` | `OAuthStatus` (no network) |
| `ai_oauth_sign_out` | `{ provider }` | `OAuthStatus`; revokes the refresh token at the documented `revocation_endpoint` (best effort) and deletes the record; emits `signed_out` |
| `ai_oauth_check_images` | `{ provider, live?: boolean }` | `ImageAccess`. Without `live`: the documented verdict, no request (OpenAI: not eligible, per "Preview limitations"; xAI: `unknown`). `live: true` sends one small image request with the plan token, which **uses one image of the plan if allowed**; the verdict is stored and gates subscription image requests (OpenAI). |
| `ai_auth_configure` | `{ provider, mode?: AuthMode, fallbackToKey?: boolean, xaiClientId?: string }` | `OAuthStatus`. `fallbackToKey` (default off) re-sends with the stored API key **only** on `ai_plan_limit`. `xaiClientId: ""` clears it. |

Event `ai://oauth`: `OAuthEvent`. A user cancel arrives as `state: 'error', code: 'ai_oauth_cancelled'`.

In subscription mode `ai_submit_*` use the plan token: ChatGPT images go through the Responses API
`image_generation` tool (`store: false`, `stream: true`; native mask via `input_image_mask`) **only** after
a successful live check, otherwise they fail with `ai_plan_not_eligible`; Grok uses the normal
`/v1/images/*` JSON endpoints with the bearer. `ai_prompt_assist` accepts `provider: 'open_ai'` in
subscription mode (text Responses with `instructions`, plan models from `GET /v1/models`).
There is never a silent switch to the API key.

Additional error codes:

| code | meaning |
|---|---|
| `ai_plan_not_eligible` | the subscription can't be used for this request through Pixelforge (ChatGPT images; xAI 401/403 after a refresh; OpenAI `subscription_sharing_user_not_eligible` / `_unsupported_capability` / `_route_not_supported`) |
| `ai_plan_limit` | the plan's usage cap (OpenAI `subscription_sharing_usage_limit_exceeded`, xAI 429); the message carries the reset time when the vendor sent one |
| `ai_oauth_signed_out` | subscription mode but no stored sign-in |
| `ai_oauth_reauth` | refresh token dead (`invalid_grant`, `refresh_token_reused`, ...); record deleted |
| `ai_oauth_unavailable` | no sign-in for this provider / no xAI client ID configured |
| `ai_oauth_denied`, `ai_oauth_cancelled`, `ai_oauth_timeout` | user declined / cancelled / 5 min (loopback) or code expiry (device) |
| `ai_oauth_state_mismatch` | callback `state` did not match; nothing exchanged |
| `ai_oauth_callback`, `ai_oauth_exchange`, `ai_oauth_id_token`, `ai_oauth_client` | malformed callback / token endpoint failure / ID token failed issuer-audience-nonce-expiry checks / client rejected |

Dev: `node scripts/fake-openai-auth.mjs` (port 8791) emulates both authorization servers, the plan
`/v1/models` + streaming `/v1/responses`, and Grok Imagine with a bearer; see its header and README.

## Settings commands (`commands/settings.rs`, owner: ai-rust)

```ts
type Settings = {
  theme: string; defaultProvider: ProviderId | null; historyBudgetMb: number;
  recentFiles: string[]; [extra: string]: unknown;   // unknown keys round-trip
};
```

| command | args | returns |
|---|---|---|
| `settings_get` | – | `Settings` (read from `<config>/settings.json` on first call) |
| `settings_set` | `{ settings: Settings }` | `Settings` as stored (atomic write) |
| `settings_get_key_status` | – | `{ open_ai: boolean; x_ai: boolean; gemini: boolean; [`custom:${id}`]: boolean }` (every registered custom provider too) |
| `settings_set_key` | `{ provider: ProviderId, key: string }` | `null`; `settings_key_empty` / `settings_key_invalid`. Works for `custom:<id>`. |
| `settings_delete_key` | `{ provider }` | `null` |

Keys live in the OS keychain (service `com.pixelforge.app`, user = provider id, i.e.
`open_ai` / `x_ai` / `gemini` / `custom:<id>`). When
the keychain is unavailable (headless Linux) they fall back to `<config>/ai-keys.json`,
obfuscated with a per-install random secret in `<config>/ai-keys.secret` — **that is
obfuscation, not encryption**. `PF_KEYSTORE=file` forces the file backend. Key values
never come back over IPC; only booleans do.

`<config>` is `app_config_dir()`: `%APPDATA%\com.pixelforge.app` on Windows,
`~/Library/Application Support/com.pixelforge.app` on macOS,
`~/.config/com.pixelforge.app` on Linux.
