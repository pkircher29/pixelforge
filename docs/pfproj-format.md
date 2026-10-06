# `.pfproj` — Pixelforge project file format

Format version **2** (v0.2). Implemented in `crates/pf-io/src/pfproj.rs`
(`write_pfproj` / `read_pfproj`), exposed to the UI through `io_save_pfproj` /
`io_open_pfproj` (see [ipc.md](ipc.md)); the engine ↔ manifest mapping lives in
`app/src/lib/io/convert.ts`. **Readers accept format 1** (every format-2 field is optional
and defaults to the v0.1 behaviour); writers always emit format 2.

## Container

A `.pfproj` is a plain ZIP archive. Any zip tool can open it.

| Entry | Required | Content |
|---|---|---|
| `manifest.json` | yes | UTF-8 JSON, schema below. Deflate-compressed. |
| `layers/<layerId>.png` | one per `raster`, `shape` and `text` layer | RGBA8 PNG, **straight (non-premultiplied) alpha**, sized to the layer's own rectangle (`width` x `height` in the manifest), positioned on the canvas by `x`/`y`. For shape / text layers this is the **cached rasterization** of the spec (document-sized) so older viewers still see pixels; Pixelforge re-rasterizes from the spec on load. Stored uncompressed in the zip (PNG is already deflated). |
| `masks/<layerId>.png` | optional, any layer kind | 8-bit grayscale PNG. For raster / shape / text layers the same size as the layer PNG; for group / adjustment / fill layers canvas-sized. 255 = fully revealed. |
| `channels/<channelId>.png` | optional, one per alpha channel (format 2) | 8-bit grayscale PNG, canvas-sized. 255 = selected. |
| `selection.png` | optional | 8-bit grayscale PNG, canvas-sized. 255 = selected. Absent = no selection. |
| `thumb.png` | optional (always written by Pixelforge) | RGBA8 PNG composite preview, longest edge <= 256 px. |

The writer puts `manifest.json` first so readers can locate it without scanning.
Readers must accept any compression method for any entry and must locate PNGs via the
manifest's `file` / `mask` / `channels[].file` / `selection.file` / `thumbnail` paths
(falling back to the default names above when a path is absent), not by listing the archive.

## `manifest.json`

```jsonc
{
  "format": 2,                         // integer; readers refuse values they don't know
  "app_version": "0.2.0",              // Pixelforge version that wrote the file
  "created":  "2026-10-06T14:03:11Z",  // RFC 3339 UTC, set on first save
  "modified": "2026-10-06T15:20:00Z",  // RFC 3339 UTC, set on every save

  "doc": {
    "id": "7c0b8e5a-…",                // UUID, stable for the document's life
    "name": "Poster",                  // display name (not the file name)
    "width": 1920,                     // canvas size in pixels, max 8192 x 8192
    "height": 1080
  },

  // Bottom-most layer first. A group's children reference it by `parent`; the group
  // entry itself sits directly above its last child (one nesting level). A layer with
  // `clip_to_below: true` is clipped by the nearest non-clipped layer below it.
  "layers": [
    {
      "id": "l-1",                     // unique in the doc; [A-Za-z0-9._-], used as file stem
      "name": "Background",
      "kind": "raster",                // "raster" | "group" | "adjustment" | "fill" | "shape" | "text"
      "parent": null,                  // id of the containing group, or null
      "x": 0, "y": 0,                  // layer rectangle offset on the canvas (may be negative)
      "width": 1920, "height": 1080,   // layer PNG size (0 x 0 for kinds without pixels)
      "opacity": 1.0,                  // 0.0 – 1.0 (master opacity: pixels and effects)
      "blend_mode": "normal",          // see list below
      "visible": true,
      "locked": false,                 // legacy flag = lock.all
      "file": "layers/l-1.png",        // written by Pixelforge; default layers/<id>.png
      "mask": "masks/l-1.png",         // only present when a mask PNG exists

      // ---- format 2 (all optional; defaults in parentheses)
      "fill_opacity": 1.0,             // PS "Fill": pixels only, not effects (1.0)
      "mask_enabled": true,            // false = mask kept but disabled (true)
      "mask_linked": true,             // move tool moves layer and mask together (true)
      "clip_to_below": false,          // clipping mask (false)
      "lock": { "transparent": false, "pixels": false, "position": false, "all": false },
      "linked_to": [],                 // ids of linked layers (symmetric)
      "color": null,                   // row tint: red|orange|yellow|green|blue|violet|gray|null
      "effects": null                  // LayerEffects (see below) or null
    },
    { "id": "g-1", "name": "Group 1", "kind": "group", "parent": null,
      "x": 0, "y": 0, "width": 0, "height": 0,
      "opacity": 1.0, "blend_mode": "normal", "visible": true, "locked": false,
      "pass_through": true },          // PS "Pass Through" (true); false = isolated group
    { "id": "a-1", "name": "Levels 1", "kind": "adjustment", "parent": null,
      "x": 0, "y": 0, "width": 0, "height": 0, "opacity": 1.0, "blend_mode": "normal",
      "visible": true, "locked": false, "mask": "masks/a-1.png",
      "adjustment": { "op": "levels", "params": { "inBlack": 10, "gamma": 1.2 } } },  // op id from the engine registry + its ParamValues
    { "id": "f-1", "name": "Color Fill 1", "kind": "fill", "parent": null, "…": "…",
      "fill": { "type": "solid", "color": { "r": 255, "g": 0, "b": 0, "a": 255 } } },
    { "id": "s-1", "name": "Shape 1", "kind": "shape", "parent": null,
      "x": 0, "y": 0, "width": 1920, "height": 1080,            // cached raster is document-sized
      "file": "layers/s-1.png",
      "shape": { "path": { "id": "p1", "name": "Shape 1", "subpaths": [ { "closed": true, "anchors": [ { "x": 10, "y": 10, "inX": 10, "inY": 10, "outX": 10, "outY": 10, "type": "corner" } ] } ] },
                 "fill": { "type": "solid", "color": { "r": 0, "g": 0, "b": 255, "a": 255 } },   // SolidFill | GradientFill | null
                 "stroke": { "width": 4, "fill": { "type": "solid", "color": { "r": 0, "g": 0, "b": 0, "a": 255 } }, "position": "outside", "cap": "butt", "join": "miter", "dash": null },  // or null
                 "fill_rule": "nonzero" } },                      // "nonzero" | "evenodd"
    { "id": "t-1", "name": "Hello", "kind": "text", "parent": null,
      "x": 0, "y": 0, "width": 1920, "height": 1080, "file": "layers/t-1.png",
      "text": { "text": "Hello", "x": 100, "y": 200, "font": "Segoe UI", "size": 48,
                "color": { "r": 0, "g": 0, "b": 0, "a": 255 }, "align": "left", "leading": null,
                "tracking": 0, "bold": false, "italic": false, "vertical": false, "antialias": true } }
  ],

  "active_layer": "l-1",               // id or null
  "selection": { "file": "selection.png" },   // omitted when there is no selection
  "thumbnail": "thumb.png",            // omitted when no preview was written

  // ---- format 2
  "channels": [                        // alpha channels (Select ▸ Save Selection); omitted when empty
    { "id": "ch-1", "name": "Alpha 1", "color": [255, 0, 0], "opacity": 0.5, "file": "channels/ch-1.png" }
  ],
  "paths": [ /* Path objects as in `shape.path` */ ],   // Paths panel; omitted when empty
  "work_path": "p1",                   // id of the Work Path in `paths`, or null

  // Opaque to pf-io: owned by the AI panel (`app/src/lib/ai`). Any JSON array; every
  // element is passed through byte-for-byte (thumbnails are small data: URLs, not full
  // inputs — PLAN.md §2.2). In memory this is `doc.meta.aiHistory` (camelCase);
  // `app/src/lib/io/convert.ts` maps it to/from this key on save/open. Schema:
  // docs/ai-history.md.
  "ai_history": []
}
```

### Fill specs

`fill` (fill layers), `shape.fill`, `shape.stroke.fill` and gradient overlays share one shape:

| `type` | Fields |
|---|---|
| `solid` | `color: {r,g,b,a}` (0..255) |
| `gradient` | `gradient: { stops: [{ pos: 0..1, color }] }`, `style: linear|radial|angle|reflected|diamond`, `angle` (deg, PS: 0 = left→right, 90 = bottom→top), `scale`, `reverse`, `offset: {x,y}` (fraction of bounds) |
| `pattern` | `scale`, `offset: {x,y}` (px), `pattern: { width, height, rgba }` — the tile as base64 straight-alpha RGBA8 (tiles are small; fill layers only) |

### Layer effects (`effects`)

A `LayerEffects` object (TypeScript contract in `app/src/lib/engine/types.ts`), stored
as-is in camelCase. Keys: `dropShadow`, `innerShadow`, `outerGlow`, `innerGlow`,
`bevelEmboss`, `colorOverlay`, `gradientOverlay`, `stroke`, plus `globalLightAngle` /
`globalLightAltitude`. Every effect carries `enabled`, `blendMode` (engine ids, e.g.
`"color-dodge"`), `opacity` 0..1 and Photoshop's parameter names (`angle`, `distance`,
`spread`, `choke`, `size`, `useGlobalLight`, `position`, `depth`, `altitude`, …). Render
order (PS): drop shadow → outer glow → fill at `fill_opacity` → inner shadow → inner glow
→ bevel & emboss → colour overlay → gradient overlay → stroke.

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

Format-2 fields: `fill_opacity` → 1, `mask_enabled` / `mask_linked` → true,
`clip_to_below` → false, `lock` → all false (`locked: true` sets `lock.all`), `linked_to`
→ `[]`, `color` / `effects` → null, `pass_through` → true, `channels` / `paths` → `[]`,
`work_path` → null. A `shape` / `text` / `fill` / `adjustment` entry whose spec is
missing or invalid loads as a plain raster layer from its cached PNG (or empty).

### Forward compatibility

- Unknown fields at the top level, inside `doc`, inside any layer entry, inside any
  `channels[]` row and inside `selection` are **preserved** across a read → write round
  trip (serde `flatten`).
- `format` greater than the reader's version → error `io_project` ("newer than this
  version supports"). Additive changes (new optional fields) do **not** bump `format`;
  only incompatible changes do. Format 2 bumped because the writer now emits layer kinds
  a format-1 reader rejects.
- Archive entries the reader does not know about are ignored (and dropped on re-save).

### What the UI leaves out

The AI "diff overlay" layer (`id` prefixed `aidiff_`, see docs/ai-history.md) is a
screen-only helper: `projectFrameParts` drops it before building the frame, and export /
copy / merge / flatten / AI inputs composite without it. It never appears in a `.pfproj`.
Quick Mask mode is transient and never saved (exiting converts it back to the selection).

## Validation performed by the writer

- Canvas and every layer within 8192 x 8192.
- Every `raster` / `shape` / `text` layer has pixel data whose size equals its `width` x
  `height`; `group` / `adjustment` / `fill` layers have none. Masks match their layer's
  size (the canvas for kinds without pixels); alpha channels and the selection match the
  canvas.
- Layer and channel ids are safe file stems (`[A-Za-z0-9._-]`, not `.`/`..`, <= 128 chars).
- `format` is forced to 2 and the `file` / `mask` / `channels[].file` / `selection.file` /
  `thumbnail` paths are rewritten to the canonical names.

The Tauri command additionally sets `app_version`, `modified` (and `created` when
empty) and writes atomically (temp file in the same directory, then rename).
