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
