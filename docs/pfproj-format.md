# `.pfproj` — Pixelforge project file format

Format version **1**. Implemented in `crates/pf-io/src/pfproj.rs`
(`write_pfproj` / `read_pfproj`), exposed to the UI through `io_save_pfproj` /
`io_open_pfproj` (see [ipc.md](ipc.md)).

## Container

A `.pfproj` is a plain ZIP archive. Any zip tool can open it.

| Entry | Required | Content |
|---|---|---|
| `manifest.json` | yes | UTF-8 JSON, schema below. Deflate-compressed. |
| `layers/<layerId>.png` | one per raster layer | RGBA8 PNG, **straight (non-premultiplied) alpha**, sized to the layer's own rectangle (`width` x `height` in the manifest), positioned on the canvas by `x`/`y`. Stored uncompressed in the zip (PNG is already deflated). |
| `masks/<layerId>.png` | optional, per raster layer | 8-bit grayscale PNG, same size as the layer PNG. 255 = fully revealed. Layer masks are a v1.1 UI feature; the slot exists now. |
| `selection.png` | optional | 8-bit grayscale PNG, canvas-sized. 255 = selected. Absent = no selection. |
| `thumb.png` | optional (always written by Pixelforge) | RGBA8 PNG composite preview, longest edge <= 256 px. |

The writer puts `manifest.json` first so readers can locate it without scanning.
Readers must accept any compression method for any entry and must locate layer PNGs via
the manifest's `file` / `mask` / `selection.file` / `thumbnail` paths (falling back to the
default names above when a path is absent), not by listing the archive.

## `manifest.json`

```jsonc
{
  "format": 1,                         // integer; readers refuse values they don't know
  "app_version": "0.1.0",              // Pixelforge version that wrote the file
  "created":  "2026-10-06T14:03:11Z",  // RFC 3339 UTC, set on first save
  "modified": "2026-10-06T15:20:00Z",  // RFC 3339 UTC, set on every save

  "doc": {
    "id": "7c0b8e5a-…",                // UUID, stable for the document's life
    "name": "Poster",                  // display name (not the file name)
    "width": 1920,                     // canvas size in pixels, max 8192 x 8192
    "height": 1080
  },

  // Bottom-most layer first. A group's children reference it by `parent`; the group
  // entry itself sits directly above its last child (v1: one nesting level).
  "layers": [
    {
      "id": "l-1",                     // unique in the doc; [A-Za-z0-9._-], used as file stem
      "name": "Background",
      "kind": "raster",                // "raster" | "group"
      "parent": null,                  // id of the containing group, or null
      "x": 0, "y": 0,                  // layer rectangle offset on the canvas (may be negative)
      "width": 1920, "height": 1080,   // layer PNG size (0 x 0 for groups)
      "opacity": 1.0,                  // 0.0 – 1.0
      "blend_mode": "normal",          // see list below
      "visible": true,
      "locked": false,
      "file": "layers/l-1.png",        // written by Pixelforge; default layers/<id>.png
      "mask": "masks/l-1.png"          // only present when a mask PNG exists
    },
    { "id": "g-1", "name": "Group 1", "kind": "group", "parent": null,
      "x": 0, "y": 0, "width": 0, "height": 0,
      "opacity": 1.0, "blend_mode": "normal", "visible": true, "locked": false }
  ],

  "active_layer": "l-1",               // id or null
  "selection": { "file": "selection.png" },   // omitted when there is no selection
  "thumbnail": "thumb.png",            // omitted when no preview was written

  // Opaque to pf-io: owned by the AI panel (`app/src/lib/ai`). Any JSON array; every
  // element is passed through byte-for-byte (thumbnails are small data: URLs, not full
  // inputs — PLAN.md §2.2). In memory this is `doc.meta.aiHistory` (camelCase);
  // `app/src/lib/io/convert.ts` maps it to/from this key on save/open. Schema:
  // docs/ai-history.md.
  "ai_history": []
}
```

### Blend modes

Exactly these 16 strings (Photoshop 7 set, PLAN.md §2.1):

`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color_dodge`,
`color_burn`, `hard_light`, `soft_light`, `difference`, `exclusion`, `hue`,
`saturation`, `color`, `luminosity`.

PSD import maps Photoshop's modes onto these; modes Pixelforge lacks (linear burn, vivid
light, hard mix, ...) become `normal`, and `darker color` / `lighter color` become
`darken` / `lighten`.

### Defaults when a field is missing

`kind` → `raster`, `parent` → null, `x`/`y` → 0, `opacity` → 1.0, `blend_mode` →
`normal`, `visible` → true, `locked` → false, `layers` → `[]`, `ai_history` → `[]`,
`app_version` / `created` / `modified` → `""`.

### Forward compatibility

- Unknown fields at the top level, inside `doc`, inside any layer entry and inside
  `selection` are **preserved** across a read → write round trip (serde `flatten`).
- `format` greater than the reader's version → error `io_project` ("newer than this
  version supports"). Additive changes (new optional fields) do **not** bump `format`;
  only incompatible changes do.
- Archive entries the reader does not know about are ignored (and dropped on re-save).

### What the UI leaves out

The AI "diff overlay" layer (`id` prefixed `aidiff_`, see docs/ai-history.md) is a
screen-only helper: `projectFrameParts` drops it before building the frame, and export /
copy / merge / flatten / AI inputs composite without it. It never appears in a `.pfproj`.

## Validation performed by the writer

- Canvas and every layer within 8192 x 8192.
- Every `raster` layer has pixel data whose size equals its `width` x `height`; groups
  have none. Masks match their layer's size; the selection matches the canvas.
- Layer ids are safe file stems (`[A-Za-z0-9._-]`, not `.`/`..`, <= 128 chars).
- `format` is forced to 1 and the `file` / `mask` / `selection.file` / `thumbnail`
  paths are rewritten to the canonical names.

The Tauri command additionally sets `app_version`, `modified` (and `created` when
empty) and writes atomically (temp file in the same directory, then rename).
