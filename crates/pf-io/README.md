# `crates/pf-io` — Image Codecs, PSD Import, `.pfproj` Container & IPC Framing

Rust crate (`pf_io`) handling all file I/O for Pixelforge. Converts on-disk image and project files to and from straight-alpha RGBA8 / 8-bit grayscale byte buffers for the webview. Enforces `#![forbid(unsafe_code)]` and `MAX_EDGE_PX = 8192`.

## Responsibilities

- Decode PNG, JPEG (applying EXIF orientation), WebP, GIF (first frame), BMP, and TIFF into straight-alpha RGBA8 buffers, and encode PNG, JPEG, and WebP (`src/codec.rs`).
- Import Adobe Photoshop (`.psd`) files read-only, extracting layers, blend modes, visibility, opacity, and 1-level layer groups (`src/psd.rs`).
- Read and write `.pfproj` format v2 ZIP archives (with backward compatibility for format v1) with bounded entry reads, validating dimensions, channel counts, and safe layer/channel file stems (`src/pfproj.rs`).
- Generate premultiplied box-filtered PNG thumbnails (`src/thumb.rs`).
- Maintain the recent-files LRU list (`recent.json`, max 20 entries, atomic write, case-insensitive deduplication on Windows) (`src/recent.rs`).
- Provide the reference binary frame encoder/decoder (`encode_frame`, `decode_frame`) for raw-bytes Tauri IPC (`src/frame.rs`).

## Directory Structure

| Path | Description |
|---|---|
| `src/` | Library modules (`lib.rs`, `codec.rs`, `frame.rs`, `open.rs`, `pfproj.rs`, `psd.rs`, `recent.rs`, `thumb.rs`), each with inline `#[cfg(test)]` unit tests. |
| `tests/` | PSD import integration tests (`psd_import.rs`) and deterministic binary fixtures (`tests/fixtures/`). |

## Testing

```sh
cargo test -p pf-io
```
