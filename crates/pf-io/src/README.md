# `crates/pf-io/src` — Core `pf-io` Implementation

Source modules for the `pf-io` crate.

## Module Inventory

| Module | File | Purpose |
|---|---|---|
| `lib` | `lib.rs` | Public crate root, `Error` enum (`.code()` -> `io_*`), `ImageFormat` enum, `MAX_EDGE_PX` (`8192`), `check_dimensions`, and `check_buffer`. |
| `codec` | `codec.rs` | `decode` (PNG/JPEG/WebP/GIF/BMP/TIFF with EXIF orientation support), `encode` (PNG/JPEG/WebP with `EncodeOptions` and `PngCompression`), and `png_dimensions` IHDR reader. |
| `open` | `open.rs` | `open_bytes(bytes, ext_hint)` unified importer dispatching between `psd::import_psd` and `codec::decode` to return an `ImportedDocument`. |
| `psd` | `psd.rs` | Read-only PSD parser extracting canvas bounds, layer records, `lsct` section dividers (groups), blend mode mapping to Pixelforge's 16 modes, and clipped layer RGBA8 buffers. |
| `pfproj` | `pfproj.rs` | `.pfproj` v2 ZIP reader/writer (`read_pfproj`, `write_pfproj`), `Manifest`, `LayerEntry`, `ChannelEntry`, `ProjectDoc`, `FORMAT_VERSION` (`2`), and `THUMB_MAX_PX` (`256`). |
| `thumb` | `thumb.rs` | `make_thumbnail(rgba, width, height, max_px)` premultiplied-alpha box-filter downsampler returning PNG bytes. |
| `frame` | `frame.rs` | Binary IPC framing (`u32 LE header length | UTF-8 JSON header with blobs[] | raw blobs`) used by `io_*` Tauri commands. |
| `recent` | `recent.rs` | `load`, `save`, `add`, `remove`, and `prune_missing` helpers for `<config_dir>/recent.json` (max 20 entries). |
