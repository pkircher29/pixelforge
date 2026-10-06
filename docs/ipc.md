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
type ProviderId = 'open_ai' | 'x_ai' | 'gemini';
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
| `ai_test_key` | `{ provider: ProviderId }` | `null`; `ai_auth` on a bad key, `ai_not_configured` if none |

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
| `settings_get_key_status` | – | `{ open_ai: boolean; x_ai: boolean; gemini: boolean }` |
| `settings_set_key` | `{ provider, key: string }` | `null`; `settings_key_empty` / `settings_key_invalid` |
| `settings_delete_key` | `{ provider }` | `null` |

Keys live in the OS keychain (service `com.pixelforge.app`, user = provider id). When
the keychain is unavailable (headless Linux) they fall back to `<config>/ai-keys.json`,
obfuscated with a per-install random secret in `<config>/ai-keys.secret` — **that is
obfuscation, not encryption**. `PF_KEYSTORE=file` forces the file backend. Key values
never come back over IPC; only booleans do.

`<config>` is `app_config_dir()`: `%APPDATA%\com.pixelforge.app` on Windows,
`~/Library/Application Support/com.pixelforge.app` on macOS,
`~/.config/com.pixelforge.app` on Linux.
