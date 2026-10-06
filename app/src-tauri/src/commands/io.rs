//! File I/O commands (`io_*`). Owned by the `io-rust` wave.
//!
//! Pixel data crosses IPC as raw bytes using the framing in `pf_io::frame`
//! (`u32 LE header length | JSON header | blobs...`, see `docs/ipc.md`):
//!
//! - commands that *return* pixels give back a `tauri::ipc::Response` holding a frame;
//! - commands that *take* pixels are invoked with a raw `ArrayBuffer` body
//!   (`invoke('io_x', body)`) holding a frame, and read it through `tauri::ipc::Request`.
//!
//! Every heavy command is `#[tauri::command(async)]` so it runs off the main thread.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

use pf_io::frame::{decode_frame, encode_frame};
use pf_io::pfproj::{self, Image, Manifest, Pixels, ProjectDoc};
use pf_io::{codec, recent, thumb, EncodeOptions, ImageFormat, ImportedDocument};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{CommandError, CommandResult};

/// Reply of [`io_ping`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IoPing {
    /// Always `"pong"`.
    pub reply: String,
    /// Extensions the open dialog should accept.
    pub import_extensions: Vec<String>,
    /// Extensions the export dialog should offer.
    pub export_extensions: Vec<String>,
}

/// Liveness probe for the IO layer; also hands the UI the supported extension lists.
#[tauri::command]
pub fn io_ping() -> CommandResult<IoPing> {
    let import_extensions = ImageFormat::ALL
        .iter()
        .filter(|f| f.can_import())
        .flat_map(|f| f.extensions().iter().map(|e| (*e).to_owned()))
        .collect();
    let export_extensions = ImageFormat::ALL
        .iter()
        .filter(|f| f.can_export())
        .map(|f| f.extension().to_owned())
        .collect();
    Ok(IoPing {
        reply: "pong".to_owned(),
        import_extensions,
        export_extensions,
    })
}

// ---------------------------------------------------------------------------------------
// Frame headers (camelCase JSON). `blobs: number[]` is added / consumed by pf_io::frame.
// ---------------------------------------------------------------------------------------

/// One layer in an [`OpenHeader`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenLayer {
    /// Layer name.
    pub name: String,
    /// Left edge on the canvas.
    pub x: i32,
    /// Top edge on the canvas.
    pub y: i32,
    /// Width of the blob.
    pub w: u32,
    /// Height of the blob.
    pub h: u32,
    /// 0.0 - 1.0.
    pub opacity: f32,
    /// Visibility.
    pub visible: bool,
    /// One of the 16 blend mode names.
    pub blend_mode: String,
    /// Group (folder) entry: no blob.
    pub is_group: bool,
    /// 0 = top level, 1 = inside a group.
    pub group_depth: u8,
    /// Index of the containing group entry in `layers`.
    pub group: Option<usize>,
    /// Index into `blobs` of this layer's straight-alpha RGBA8 pixels (`w*h*4` bytes).
    pub blob: Option<usize>,
}

/// Header of the frame returned by [`io_open`] / [`io_decode`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenHeader {
    /// Canvas width.
    pub width: u32,
    /// Canvas height.
    pub height: u32,
    /// Container the bytes came from (`png`, `jpeg`, `psd`, ...).
    pub source_format: ImageFormat,
    /// Bottom-most first.
    pub layers: Vec<OpenLayer>,
}

/// A pixel blob reference in a project frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobRef {
    /// Blob width.
    pub width: u32,
    /// Blob height.
    pub height: u32,
    /// Index into `blobs`.
    pub blob: usize,
    /// `"rgba"` (default; `w*h*4` straight alpha), `"gray"` (`w*h`, masks only) or
    /// `"png"` (an encoded PNG, stored verbatim; uploads only).
    #[serde(default)]
    pub encoding: BlobEncoding,
}

/// How a blob's bytes are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlobEncoding {
    /// Straight-alpha RGBA8.
    #[default]
    Rgba,
    /// 8-bit single channel.
    Gray,
    /// PNG file bytes.
    Png,
}

/// A layer's pixels in a project frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerBlob {
    /// Manifest layer id.
    pub id: String,
    /// Pixels.
    #[serde(flatten)]
    pub data: BlobRef,
}

/// Frame header for [`io_save_pfproj`] (upload) and [`io_open_pfproj`] (download).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHeader {
    /// Destination path (upload only; ignored on download).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The manifest (snake_case, see `docs/pfproj-format.md`). On upload, `format`,
    /// `modified`, `app_version` and the archive paths are filled in by Rust; `created`
    /// is set if empty.
    pub manifest: Manifest,
    /// One per raster layer.
    #[serde(default)]
    pub layers: Vec<LayerBlob>,
    /// Optional 8-bit masks, keyed by layer id.
    #[serde(default)]
    pub masks: Vec<LayerBlob>,
    /// Optional 8-bit canvas-sized selection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<BlobRef>,
    /// Upload: an RGBA composite at any size (Rust downsizes to 256 px) or a PNG.
    /// Download: the stored `thumb.png` (`encoding: "png"`, width/height from its IHDR).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<BlobRef>,
}

/// Result of [`io_save_pfproj`] / [`io_export`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    /// Path written.
    pub path: String,
    /// Bytes on disk.
    pub bytes: u64,
    /// RFC 3339 timestamp stored as `modified` (save only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
}

/// Frame header for [`io_export`] / [`io_encode`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeHeader {
    /// Destination path ([`io_export`] only).
    #[serde(default)]
    pub path: Option<String>,
    /// `png` | `jpeg` | `webp`.
    pub format: ImageFormat,
    /// Encoder options (all optional).
    #[serde(default)]
    pub opts: EncodeOptions,
    /// Blob width.
    pub width: u32,
    /// Blob height.
    pub height: u32,
    /// Index of the RGBA8 blob (default 0).
    #[serde(default)]
    pub blob: usize,
}

/// Frame header for [`io_thumbnail`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailHeader {
    /// Blob width.
    pub width: u32,
    /// Blob height.
    pub height: u32,
    /// Longest edge of the result.
    #[serde(default = "default_thumb_px")]
    pub max_px: u32,
    /// Index of the RGBA8 blob (default 0).
    #[serde(default)]
    pub blob: usize,
}

fn default_thumb_px() -> u32 {
    pfproj::THUMB_MAX_PX
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

fn raw_body<'a>(request: &'a Request<'a>) -> CommandResult<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        InvokeBody::Json(_) => Err(CommandError::new(
            "io_frame",
            "this command expects a raw ArrayBuffer body (see docs/ipc.md)",
        )),
    }
}

/// Encode an [`ImportedDocument`] as an open-frame response.
fn document_response(doc: ImportedDocument) -> CommandResult<Response> {
    let mut layers = Vec::with_capacity(doc.layers.len());
    let mut blobs: Vec<&[u8]> = Vec::with_capacity(doc.layers.len());
    for l in &doc.layers {
        let blob = if l.is_group {
            None
        } else {
            blobs.push(&l.rgba);
            Some(blobs.len() - 1)
        };
        layers.push(OpenLayer {
            name: l.name.clone(),
            x: l.x,
            y: l.y,
            w: l.w,
            h: l.h,
            opacity: l.opacity,
            visible: l.visible,
            blend_mode: l.blend_mode.clone(),
            is_group: l.is_group,
            group_depth: l.group_depth,
            group: l.group,
            blob,
        });
    }
    let header = OpenHeader {
        width: doc.width,
        height: doc.height,
        source_format: doc.source_format,
        layers,
    };
    Ok(Response::new(encode_frame(&header, &blobs)?))
}

fn blob_image(frame: &pf_io::frame::Frame<'_>, r: &BlobRef, channels: u8) -> CommandResult<Image> {
    let bytes = frame.blob(r.blob)?;
    Ok(match r.encoding {
        BlobEncoding::Png => Image::Png(bytes.to_vec()),
        BlobEncoding::Rgba | BlobEncoding::Gray => {
            let ch = if r.encoding == BlobEncoding::Gray {
                1
            } else {
                4
            };
            if ch != channels {
                return Err(CommandError::new(
                    "io_invalid_buffer",
                    format!("expected a {channels}-channel blob, got {ch}-channel"),
                ));
            }
            pf_io::check_buffer(bytes, r.width, r.height, ch)?;
            Image::Raw(Pixels {
                width: r.width,
                height: r.height,
                channels: ch,
                data: bytes.to_vec(),
            })
        }
    })
}

/// Append an image's bytes to the blob list and describe it for the header.
fn push_blob<'a>(img: &'a Image, blobs: &mut Vec<&'a [u8]>) -> BlobRef {
    match img {
        Image::Raw(p) => {
            blobs.push(&p.data);
            BlobRef {
                width: p.width,
                height: p.height,
                blob: blobs.len() - 1,
                encoding: if p.channels == 1 {
                    BlobEncoding::Gray
                } else {
                    BlobEncoding::Rgba
                },
            }
        }
        Image::Png(bytes) => {
            blobs.push(bytes);
            let (width, height) = codec::png_dimensions(bytes).unwrap_or((0, 0));
            BlobRef {
                width,
                height,
                blob: blobs.len() - 1,
                encoding: BlobEncoding::Png,
            }
        }
    }
}

/// Write `bytes` to `path` through a temp file in the same directory, then rename.
fn write_atomic(path: &Path, bytes: &[u8]) -> CommandResult<u64> {
    let tmp = temp_path(path);
    let mut f = BufWriter::new(File::create(&tmp)?);
    f.write_all(bytes)?;
    f.into_inner()
        .map_err(|e| CommandError::new("io", e.to_string()))?
        .sync_all()?;
    std::fs::rename(&tmp, path)?;
    Ok(bytes.len() as u64)
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("pixelforge");
    path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()))
}

fn recent_path<R: Runtime>(app: &AppHandle<R>) -> CommandResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| CommandError::new("io", format!("no app config dir: {e}")))?;
    Ok(dir.join("recent.json"))
}

// ---------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------

/// Open an image (PNG / JPEG / WebP / GIF / BMP / TIFF) or a PSD.
///
/// Returns a frame with an [`OpenHeader`] and one RGBA8 blob per (non-group) layer.
#[tauri::command(async)]
pub fn io_open(path: String) -> CommandResult<Response> {
    let p = Path::new(&path);
    if ImageFormat::from_path(p) == Some(ImageFormat::PfProj) {
        return Err(CommandError::new(
            "io_unsupported_format",
            "this is a Pixelforge project; use io_open_pfproj",
        ));
    }
    let bytes = std::fs::read(p)?;
    let ext = p.extension().and_then(|e| e.to_str());
    let doc = pf_io::open_bytes(&bytes, ext)?;
    document_response(doc)
}

/// Decode in-memory image bytes (clipboard paste, drag-drop). Body: the raw file bytes
/// (no frame). Returns the same frame as [`io_open`].
#[tauri::command(async)]
pub fn io_decode(request: Request<'_>) -> CommandResult<Response> {
    let bytes = raw_body(&request)?;
    let doc = pf_io::open_bytes(bytes, None)?;
    document_response(doc)
}

/// Open a `.pfproj`. Returns a frame with a [`ProjectHeader`]: every layer / mask /
/// selection blob is raw pixels; `thumbnail` (if present) is the stored PNG.
#[tauri::command(async)]
pub fn io_open_pfproj(path: String) -> CommandResult<Response> {
    let file = File::open(&path)?;
    let doc = pfproj::read_pfproj(BufReader::new(file))?;

    let mut blobs: Vec<&[u8]> = Vec::new();

    // Keep manifest order for layers so the UI can zip them with manifest.layers.
    let mut layers = Vec::new();
    let mut masks = Vec::new();
    for entry in &doc.manifest.layers {
        if let Some(img) = doc.layers.get(&entry.id) {
            layers.push(LayerBlob {
                id: entry.id.clone(),
                data: push_blob(img, &mut blobs),
            });
        }
        if let Some(img) = doc.masks.get(&entry.id) {
            masks.push(LayerBlob {
                id: entry.id.clone(),
                data: push_blob(img, &mut blobs),
            });
        }
    }
    let selection = doc.selection.as_ref().map(|s| push_blob(s, &mut blobs));
    let thumbnail = doc.thumbnail.as_ref().map(|t| push_blob(t, &mut blobs));

    let header = ProjectHeader {
        path: Some(path),
        manifest: doc.manifest.clone(),
        layers,
        masks,
        selection,
        thumbnail,
    };
    Ok(Response::new(encode_frame(&header, &blobs)?))
}

/// Save a `.pfproj`. Body: a frame with a [`ProjectHeader`] (`path` required) and the
/// pixel blobs it references. Written atomically (temp file + rename).
#[tauri::command(async)]
pub fn io_save_pfproj(request: Request<'_>) -> CommandResult<WriteResult> {
    let body = raw_body(&request)?;
    let frame = decode_frame(body)?;
    let header: ProjectHeader = frame.header_as()?;
    let path = header
        .path
        .clone()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| CommandError::new("io_project", "header.path is required"))?;

    let mut manifest = header.manifest;
    manifest.format = pfproj::FORMAT_VERSION;
    manifest.app_version = env!("CARGO_PKG_VERSION").to_owned();
    let now = pfproj::now_rfc3339();
    if manifest.created.is_empty() {
        manifest.created = now.clone();
    }
    manifest.modified = now.clone();

    let mut doc = ProjectDoc {
        manifest,
        layers: BTreeMap::new(),
        masks: BTreeMap::new(),
        selection: None,
        thumbnail: None,
    };
    for l in &header.layers {
        doc.layers
            .insert(l.id.clone(), blob_image(&frame, &l.data, 4)?);
    }
    for m in &header.masks {
        doc.masks
            .insert(m.id.clone(), blob_image(&frame, &m.data, 1)?);
    }
    if let Some(s) = &header.selection {
        doc.selection = Some(blob_image(&frame, s, 1)?);
    }
    if let Some(t) = &header.thumbnail {
        doc.thumbnail = Some(blob_image(&frame, t, 4)?);
    }

    let target = Path::new(&path);
    let tmp = temp_path(target);
    let result = (|| -> CommandResult<u64> {
        let file = File::create(&tmp)?;
        let file = pfproj::write_pfproj(&doc, BufWriter::new(file))?
            .into_inner()
            .map_err(|e| CommandError::new("io", e.to_string()))?;
        file.sync_all()?;
        let bytes = file.metadata()?.len();
        drop(file);
        std::fs::rename(&tmp, target)?;
        Ok(bytes)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(WriteResult {
        path,
        bytes: result?,
        modified: Some(now),
    })
}

/// Export a flattened RGBA8 image to PNG / JPEG / WebP on disk. Body: a frame with an
/// [`EncodeHeader`] (`path` required) and the RGBA blob.
#[tauri::command(async)]
pub fn io_export(request: Request<'_>) -> CommandResult<WriteResult> {
    let body = raw_body(&request)?;
    let frame = decode_frame(body)?;
    let header: EncodeHeader = frame.header_as()?;
    let path = header
        .path
        .clone()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| CommandError::new("io_encode", "header.path is required"))?;
    let rgba = frame.blob(header.blob)?;
    let encoded = codec::encode(
        rgba,
        header.width,
        header.height,
        header.format,
        &header.opts,
    )?;
    let bytes = write_atomic(Path::new(&path), &encoded)?;
    Ok(WriteResult {
        path,
        bytes,
        modified: None,
    })
}

/// Encode RGBA8 to PNG / JPEG / WebP bytes (clipboard, AI uploads). Body: a frame with an
/// [`EncodeHeader`] (`path` ignored) and the RGBA blob. Returns the file bytes directly
/// (no frame).
#[tauri::command(async)]
pub fn io_encode(request: Request<'_>) -> CommandResult<Response> {
    let body = raw_body(&request)?;
    let frame = decode_frame(body)?;
    let header: EncodeHeader = frame.header_as()?;
    let rgba = frame.blob(header.blob)?;
    let encoded = codec::encode(
        rgba,
        header.width,
        header.height,
        header.format,
        &header.opts,
    )?;
    Ok(Response::new(encoded))
}

/// Make a PNG thumbnail. Body: a frame with a [`ThumbnailHeader`] and the RGBA blob.
/// Returns the PNG bytes directly (no frame).
#[tauri::command(async)]
pub fn io_thumbnail(request: Request<'_>) -> CommandResult<Response> {
    let body = raw_body(&request)?;
    let frame = decode_frame(body)?;
    let header: ThumbnailHeader = frame.header_as()?;
    let rgba = frame.blob(header.blob)?;
    let png = thumb::make_thumbnail(rgba, header.width, header.height, header.max_px)?;
    Ok(Response::new(png))
}

/// Recently opened / saved files, most recent first. Entries whose file no longer
/// exists are dropped.
#[tauri::command]
pub fn io_recent_list<R: Runtime>(app: AppHandle<R>) -> CommandResult<Vec<String>> {
    let path = recent_path(&app)?;
    let mut list = recent::load(&path);
    let before = list.len();
    recent::prune_missing(&mut list);
    if list.len() != before {
        recent::save(&path, &list)?;
    }
    Ok(list)
}

/// Push `path` to the front of the recent list (max 20). Returns the updated list.
#[tauri::command]
pub fn io_recent_add<R: Runtime>(app: AppHandle<R>, path: String) -> CommandResult<Vec<String>> {
    let file = recent_path(&app)?;
    let mut list = recent::load(&file);
    recent::add(&mut list, &path);
    recent::save(&file, &list)?;
    Ok(list)
}

/// Remove one entry (or everything when `path` is omitted). Returns the updated list.
#[tauri::command]
pub fn io_recent_remove<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
) -> CommandResult<Vec<String>> {
    let file = recent_path(&app)?;
    let mut list = recent::load(&file);
    match path {
        Some(p) => recent::remove(&mut list, &p),
        None => list.clear(),
    }
    recent::save(&file, &list)?;
    Ok(list)
}

/// Keep `serde_json::Value` referenced so the manifest's opaque `ai_history` type is
/// obviously part of this module's contract.
#[allow(dead_code)]
type OpaqueJson = Value;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_reports_formats() {
        let p = io_ping().expect("ok");
        assert_eq!(p.reply, "pong");
        assert!(p.import_extensions.iter().any(|e| e == "psd"));
        assert!(!p.export_extensions.iter().any(|e| e == "psd"));
        assert!(p.export_extensions.iter().any(|e| e == "pfproj"));
    }

    #[test]
    fn open_frame_header_shape() {
        let doc = ImportedDocument {
            width: 2,
            height: 1,
            layers: vec![pf_io::ImportedLayer::background(
                "Background",
                vec![9; 8],
                2,
                1,
            )],
            source_format: ImageFormat::Png,
        };
        // Build the frame the same way the command does and check the JSON.
        let mut blobs: Vec<&[u8]> = Vec::new();
        let l = &doc.layers[0];
        blobs.push(&l.rgba);
        let header = OpenHeader {
            width: doc.width,
            height: doc.height,
            source_format: doc.source_format,
            layers: vec![OpenLayer {
                name: l.name.clone(),
                x: 0,
                y: 0,
                w: 2,
                h: 1,
                opacity: 1.0,
                visible: true,
                blend_mode: "normal".into(),
                is_group: false,
                group_depth: 0,
                group: None,
                blob: Some(0),
            }],
        };
        let bytes = encode_frame(&header, &blobs).expect("frame");
        let frame = decode_frame(&bytes).expect("decode");
        assert_eq!(frame.header["sourceFormat"], "png");
        assert_eq!(frame.header["layers"][0]["blendMode"], "normal");
        assert_eq!(frame.header["layers"][0]["blob"], 0);
        assert_eq!(frame.header["blobs"], serde_json::json!([8]));
        assert_eq!(frame.blobs[0], &[9u8; 8][..]);
    }

    #[test]
    fn project_header_round_trips_with_defaults() {
        let json = serde_json::json!({
            "path": "C:/x.pfproj",
            "manifest": {"format": 1, "doc": {"id": "d", "name": "n", "width": 4, "height": 4},
                         "layers": [{"id": "a", "name": "A", "width": 4, "height": 4}]},
            "layers": [{"id": "a", "width": 4, "height": 4, "blob": 0}],
            "thumbnail": {"width": 1, "height": 1, "blob": 1, "encoding": "png"}
        });
        let h: ProjectHeader = serde_json::from_value(json).expect("parse");
        assert_eq!(h.layers[0].data.encoding, BlobEncoding::Rgba);
        assert_eq!(
            h.thumbnail.as_ref().map(|t| t.encoding),
            Some(BlobEncoding::Png)
        );
        assert!(h.masks.is_empty() && h.selection.is_none());
        let back = serde_json::to_value(&h).expect("ser");
        assert_eq!(back["layers"][0]["encoding"], "rgba");
        assert_eq!(back["manifest"]["ai_history"], serde_json::json!([]));
    }

    #[test]
    fn temp_path_is_sibling() {
        let t = temp_path(Path::new("C:/art/final.pfproj"));
        assert_eq!(t.parent(), Some(Path::new("C:/art")));
        assert!(t
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(".final.pfproj.")));
    }
}
