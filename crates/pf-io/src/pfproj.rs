//! The `.pfproj` project container. Normative description: `docs/pfproj-format.md`.
//!
//! A `.pfproj` is a ZIP archive:
//!
//! ```text
//! manifest.json          document, layer tree, selection ref, AI history (see Manifest)
//! layers/<layerId>.png   RGBA8 straight alpha, one per raster / shape / text layer
//! masks/<layerId>.png    optional 8-bit grayscale layer mask (any layer kind)
//! channels/<id>.png      optional 8-bit grayscale alpha channels (canvas-sized)
//! selection.png          optional 8-bit grayscale selection mask (canvas-sized)
//! thumb.png              composite preview, longest edge <= 256 px
//! ```
//!
//! Layer PNGs are streamed straight into the archive on write; on read each entry's
//! compressed bytes are pulled out individually and decoded, so the only full-size
//! buffers alive are the pixel buffers themselves (never the whole archive twice).
//! Unknown manifest fields are preserved on a read / write round trip (forward
//! compatibility), and `ai_history` is carried as opaque JSON.

use std::collections::BTreeMap;
use std::io::{BufReader, Read, Seek, Write};

use image::codecs::png::PngDecoder;
use image::{DynamicImage, ExtendedColorType, Limits};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::codec::{png_dimensions, write_png, PngCompression};
use crate::{check_buffer, check_dimensions, thumb, Error, Result, MAX_EDGE_PX};

/// Current manifest format version. Readers refuse anything newer. Format 2 (v0.2)
/// adds adjustment / fill / shape / text layer kinds, per-layer effects / locks / clipping
/// fields, alpha channels and paths; format-1 files read unchanged.
pub const FORMAT_VERSION: u32 = 2;
/// Archive entry names.
pub const MANIFEST_NAME: &str = "manifest.json";
/// Composite preview entry.
pub const THUMB_NAME: &str = "thumb.png";
/// Selection mask entry.
pub const SELECTION_NAME: &str = "selection.png";
/// Longest edge of `thumb.png`.
pub const THUMB_MAX_PX: u32 = 256;

/// What a layer entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerKind {
    /// Pixel layer: has a `layers/<id>.png`.
    #[default]
    Raster,
    /// Folder: no pixels; children point at it via `parent`.
    Group,
    /// Non-destructive adjustment (format 2): no pixels, spec in `adjustment`.
    Adjustment,
    /// Solid / gradient / pattern fill (format 2): no pixels, spec in `fill`.
    Fill,
    /// Vector shape (format 2): spec in `shape` plus a cached `layers/<id>.png`.
    Shape,
    /// Type layer (format 2): spec in `text` plus a cached `layers/<id>.png`.
    Text,
}

impl LayerKind {
    /// True for kinds that carry a `layers/<id>.png` (raster, and the cached
    /// rasterizations of shape / text layers).
    pub fn has_pixels(self) -> bool {
        matches!(self, LayerKind::Raster | LayerKind::Shape | LayerKind::Text)
    }
}

fn one() -> f32 {
    1.0
}
fn yes() -> bool {
    true
}
fn normal() -> String {
    "normal".to_owned()
}

/// One row of `manifest.layers` (bottom-most layer first).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayerEntry {
    /// Unique within the document; used as the PNG file stem, so `[A-Za-z0-9._-]` only.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Raster or group.
    #[serde(default)]
    pub kind: LayerKind,
    /// `id` of the containing group, if any (one level deep in v1).
    #[serde(default)]
    pub parent: Option<String>,
    /// Left edge of the layer's pixel rectangle on the canvas.
    #[serde(default)]
    pub x: i32,
    /// Top edge of the layer's pixel rectangle on the canvas.
    #[serde(default)]
    pub y: i32,
    /// Width of the layer PNG (0 for groups).
    #[serde(default)]
    pub width: u32,
    /// Height of the layer PNG (0 for groups).
    #[serde(default)]
    pub height: u32,
    /// 0.0 - 1.0.
    #[serde(default = "one")]
    pub opacity: f32,
    /// One of the 16 names in [`crate::psd::BLEND_MODES`].
    #[serde(default = "normal")]
    pub blend_mode: String,
    /// Shown in the composite.
    #[serde(default = "yes")]
    pub visible: bool,
    /// Pixel / position lock.
    #[serde(default)]
    pub locked: bool,
    /// Archive path of the layer PNG. Filled in by the writer; readers fall back to
    /// `layers/<id>.png` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Archive path of the optional 8-bit mask PNG.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<String>,
    /// Fields this version does not know about, preserved verbatim.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl LayerEntry {
    /// A visible, unlocked, normal raster layer.
    pub fn raster(id: &str, name: &str, x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            id: id.to_owned(),
            name: name.to_owned(),
            kind: LayerKind::Raster,
            parent: None,
            x,
            y,
            width,
            height,
            opacity: 1.0,
            blend_mode: normal(),
            visible: true,
            locked: false,
            file: None,
            mask: None,
            extra: Map::new(),
        }
    }

    /// A group entry.
    pub fn group(id: &str, name: &str) -> Self {
        Self {
            kind: LayerKind::Group,
            ..Self::raster(id, name, 0, 0, 0, 0)
        }
    }
}

/// `manifest.doc`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocInfo {
    /// Stable document id (UUID).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Canvas width.
    pub width: u32,
    /// Canvas height.
    pub height: u32,
    /// Preserved unknown fields.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One row of `manifest.channels` (format 2): a saved selection stored as
/// `channels/<id>.png` (8-bit, canvas-sized). `name`, `color`, `opacity` ride in `extra`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelEntry {
    /// Unique id, used as the PNG file stem.
    pub id: String,
    /// Archive path; filled in by the writer, default `channels/<id>.png`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Everything else (name, color, opacity, ...), preserved verbatim.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Default archive path of an alpha channel's PNG.
pub fn channel_file(id: &str) -> String {
    format!("channels/{id}.png")
}

/// `manifest.selection`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectionEntry {
    /// Archive path of the 8-bit selection mask (canvas-sized).
    pub file: String,
    /// Preserved unknown fields.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// `manifest.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    /// [`FORMAT_VERSION`].
    pub format: u32,
    /// Pixelforge version that wrote the file.
    #[serde(default)]
    pub app_version: String,
    /// RFC 3339 UTC.
    #[serde(default)]
    pub created: String,
    /// RFC 3339 UTC.
    #[serde(default)]
    pub modified: String,
    /// Document.
    pub doc: DocInfo,
    /// Bottom-most first.
    #[serde(default)]
    pub layers: Vec<LayerEntry>,
    /// `id` of the active layer.
    #[serde(default)]
    pub active_layer: Option<String>,
    /// Selection mask reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<SelectionEntry>,
    /// Alpha channels (format 2). Empty for format-1 files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<ChannelEntry>,
    /// Opaque: owned by the AI panel. Passed through untouched.
    #[serde(default)]
    pub ai_history: Vec<Value>,
    /// Archive path of the preview.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    /// Preserved unknown fields.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Manifest {
    /// A new manifest for an empty document.
    pub fn new(doc_id: &str, name: &str, width: u32, height: u32) -> Self {
        Self {
            format: FORMAT_VERSION,
            app_version: String::new(),
            created: String::new(),
            modified: String::new(),
            doc: DocInfo {
                id: doc_id.to_owned(),
                name: name.to_owned(),
                width,
                height,
                extra: Map::new(),
            },
            layers: Vec::new(),
            active_layer: None,
            selection: None,
            channels: Vec::new(),
            ai_history: Vec::new(),
            thumbnail: None,
            extra: Map::new(),
        }
    }
}

/// A raw pixel buffer: `channels` is 4 (RGBA8 straight alpha) or 1 (8-bit mask).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pixels {
    /// Width.
    pub width: u32,
    /// Height.
    pub height: u32,
    /// 1 or 4.
    pub channels: u8,
    /// `width * height * channels` bytes.
    pub data: Vec<u8>,
}

impl Pixels {
    /// RGBA8 buffer.
    pub fn rgba(width: u32, height: u32, data: Vec<u8>) -> Self {
        Self {
            width,
            height,
            channels: 4,
            data,
        }
    }

    /// 8-bit mask buffer.
    pub fn gray(width: u32, height: u32, data: Vec<u8>) -> Self {
        Self {
            width,
            height,
            channels: 1,
            data,
        }
    }
}

/// Image payload for a layer / mask / thumbnail: either raw pixels (encoded to PNG by
/// the writer) or an already-encoded PNG stored verbatim. Readers always return `Raw`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Image {
    /// Raw pixels.
    Raw(Pixels),
    /// PNG bytes.
    Png(Vec<u8>),
}

impl Image {
    fn dimensions(&self) -> Result<(u32, u32)> {
        match self {
            Image::Raw(p) => Ok((p.width, p.height)),
            Image::Png(bytes) => {
                png_dimensions(bytes).ok_or_else(|| Error::Project("blob is not a PNG".to_owned()))
            }
        }
    }
}

/// Everything in a `.pfproj`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProjectDoc {
    /// The manifest.
    pub manifest: Manifest,
    /// Pixels per raster layer id.
    pub layers: BTreeMap<String, Image>,
    /// Optional 8-bit mask per layer id.
    pub masks: BTreeMap<String, Image>,
    /// Optional 8-bit alpha channels per channel id (canvas-sized, format 2).
    pub channels: BTreeMap<String, Image>,
    /// Optional 8-bit selection (canvas-sized).
    pub selection: Option<Image>,
    /// Composite preview. `Raw` is downscaled to [`THUMB_MAX_PX`] by the writer.
    pub thumbnail: Option<Image>,
}

impl Default for Manifest {
    fn default() -> Self {
        Self::new("", "Untitled", 1, 1)
    }
}

/// Only `[A-Za-z0-9._-]` so an id is always a safe file stem.
fn check_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || id == "."
        || id == ".."
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
    {
        return Err(Error::Project(format!(
            "layer id {id:?} is not a safe file name"
        )));
    }
    Ok(())
}

/// Default archive path of a layer's PNG.
pub fn layer_file(id: &str) -> String {
    format!("layers/{id}.png")
}

/// Default archive path of a layer's mask PNG.
pub fn mask_file(id: &str) -> String {
    format!("masks/{id}.png")
}

/// Write `doc` as a `.pfproj` into `out`. Returns the writer once the central directory
/// has been written (callers holding a `File` typically `sync_all` it).
///
/// The manifest written is `doc.manifest` with `format` forced to [`FORMAT_VERSION`] and
/// `file` / `mask` / `selection.file` / `thumbnail` paths filled in from what is present
/// in `doc`. Timestamps and `app_version` are the caller's responsibility (see
/// [`now_rfc3339`]).
pub fn write_pfproj<W: Write + Seek>(doc: &ProjectDoc, out: W) -> Result<W> {
    let mut manifest = doc.manifest.clone();
    manifest.format = FORMAT_VERSION;
    check_dimensions(manifest.doc.width, manifest.doc.height)?;

    // Validate before writing anything.
    for entry in &manifest.layers {
        check_id(&entry.id)?;
        // Expected mask size: the layer's pixels, or the canvas for pixel-less kinds.
        let mut mask_size = (manifest.doc.width, manifest.doc.height);
        if entry.kind.has_pixels() {
            let img = doc.layers.get(&entry.id).ok_or_else(|| {
                Error::Project(format!(
                    "{:?} layer {:?} has no pixel data",
                    entry.kind, entry.id
                ))
            })?;
            let (w, h) = img.dimensions()?;
            if (w, h) != (entry.width, entry.height) {
                return Err(Error::Project(format!(
                    "layer {:?} is {}x{} in the manifest but its pixels are {w}x{h}",
                    entry.id, entry.width, entry.height
                )));
            }
            if let Image::Raw(p) = img {
                check_pixels(p, 4)?;
            }
            mask_size = (w, h);
        } else if doc.layers.contains_key(&entry.id) {
            return Err(Error::Project(format!(
                "{:?} layer {:?} must not have pixel data",
                entry.kind, entry.id
            )));
        }
        if let Some(mask) = doc.masks.get(&entry.id) {
            let (mw, mh) = mask.dimensions()?;
            if (mw, mh) != mask_size {
                return Err(Error::Project(format!(
                    "mask for layer {:?} is {mw}x{mh}, expected {}x{}",
                    entry.id, mask_size.0, mask_size.1
                )));
            }
            if let Image::Raw(p) = mask {
                check_pixels(p, 1)?;
            }
        }
    }
    for id in doc.layers.keys().chain(doc.masks.keys()) {
        if !manifest.layers.iter().any(|e| &e.id == id) {
            return Err(Error::Project(format!(
                "pixel data for unknown layer id {id:?}"
            )));
        }
    }
    for (id, img) in &doc.channels {
        check_id(id)?;
        let (w, h) = img.dimensions()?;
        if (w, h) != (manifest.doc.width, manifest.doc.height) {
            return Err(Error::Project(format!(
                "alpha channel {id:?} is {w}x{h}, canvas is {}x{}",
                manifest.doc.width, manifest.doc.height
            )));
        }
        if let Image::Raw(p) = img {
            check_pixels(p, 1)?;
        }
    }
    if let Some(sel) = &doc.selection {
        let (w, h) = sel.dimensions()?;
        if (w, h) != (manifest.doc.width, manifest.doc.height) {
            return Err(Error::Project(format!(
                "selection is {w}x{h}, canvas is {}x{}",
                manifest.doc.width, manifest.doc.height
            )));
        }
        if let Image::Raw(p) = sel {
            check_pixels(p, 1)?;
        }
    }

    // Fill in archive paths.
    for entry in &mut manifest.layers {
        entry.file = entry.kind.has_pixels().then(|| layer_file(&entry.id));
        entry.mask = doc
            .masks
            .contains_key(&entry.id)
            .then(|| mask_file(&entry.id));
    }
    // Channel rows: keep the manifest's metadata, add rows for new ids, drop rows
    // without pixels, keep the manifest's ordering where possible.
    let order: Vec<String> = manifest.channels.iter().map(|c| c.id.clone()).collect();
    let mut channels: Vec<ChannelEntry> = doc
        .channels
        .keys()
        .map(|id| {
            let mut row = manifest
                .channels
                .iter()
                .find(|c| &c.id == id)
                .cloned()
                .unwrap_or_else(|| ChannelEntry {
                    id: id.clone(),
                    file: None,
                    extra: Map::new(),
                });
            row.file = Some(channel_file(id));
            row
        })
        .collect();
    channels.sort_by_key(|c| order.iter().position(|o| o == &c.id).unwrap_or(usize::MAX));
    manifest.channels = channels;
    manifest.selection = doc.selection.as_ref().map(|_| SelectionEntry {
        file: SELECTION_NAME.to_owned(),
        extra: doc
            .manifest
            .selection
            .as_ref()
            .map(|s| s.extra.clone())
            .unwrap_or_default(),
    });
    manifest.thumbnail = doc.thumbnail.as_ref().map(|_| THUMB_NAME.to_owned());

    let mut zip = ZipWriter::new(out);
    let deflate = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6));
    // PNG payloads are already deflated; storing them avoids a pointless second pass.
    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true);

    zip.start_file(MANIFEST_NAME, deflate).map_err(zip_err)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;

    for entry in &manifest.layers {
        if entry.kind.has_pixels() {
            if let Some(img) = doc.layers.get(&entry.id) {
                zip.start_file(layer_file(&entry.id), stored)
                    .map_err(zip_err)?;
                write_image(&mut zip, img, ExtendedColorType::Rgba8)?;
            }
        }
        if let Some(mask) = doc.masks.get(&entry.id) {
            zip.start_file(mask_file(&entry.id), stored)
                .map_err(zip_err)?;
            write_image(&mut zip, mask, ExtendedColorType::L8)?;
        }
    }
    for (id, img) in &doc.channels {
        zip.start_file(channel_file(id), stored).map_err(zip_err)?;
        write_image(&mut zip, img, ExtendedColorType::L8)?;
    }
    if let Some(sel) = &doc.selection {
        zip.start_file(SELECTION_NAME, stored).map_err(zip_err)?;
        write_image(&mut zip, sel, ExtendedColorType::L8)?;
    }
    if let Some(thumbnail) = &doc.thumbnail {
        zip.start_file(THUMB_NAME, stored).map_err(zip_err)?;
        match thumbnail {
            Image::Png(bytes) => zip.write_all(bytes)?,
            Image::Raw(p) => {
                check_pixels(p, 4)?;
                let png = thumb::make_thumbnail(&p.data, p.width, p.height, THUMB_MAX_PX)?;
                zip.write_all(&png)?;
            }
        }
    }
    zip.finish().map_err(zip_err)
}

fn check_pixels(p: &Pixels, channels: u8) -> Result<()> {
    if p.channels != channels {
        return Err(Error::InvalidBuffer(format!(
            "expected {channels}-channel pixels, got {}",
            p.channels
        )));
    }
    check_buffer(&p.data, p.width, p.height, channels)
}

fn write_image<W: Write>(out: W, img: &Image, color: ExtendedColorType) -> Result<()> {
    match img {
        Image::Png(bytes) => {
            let mut out = out;
            out.write_all(bytes)?;
            Ok(())
        }
        Image::Raw(p) => write_png(out, &p.data, p.width, p.height, color, PngCompression::Fast),
    }
}

fn zip_err(e: zip::result::ZipError) -> Error {
    match e {
        zip::result::ZipError::Io(io) => Error::Io(io),
        other => Error::Project(other.to_string()),
    }
}

/// Read a `.pfproj` from an in-memory buffer.
pub fn read_pfproj_bytes(bytes: &[u8]) -> Result<ProjectDoc> {
    read_pfproj(std::io::Cursor::new(bytes))
}

/// Read a `.pfproj`. Layer PNGs are decoded straight out of the archive; the result
/// holds only `Image::Raw` payloads except `thumbnail`, which stays `Image::Png`.
pub fn read_pfproj<R: Read + Seek>(reader: R) -> Result<ProjectDoc> {
    let mut zip = ZipArchive::new(reader).map_err(|e| match e {
        zip::result::ZipError::Io(io) => Error::Io(io),
        other => Error::Project(format!("not a .pfproj archive: {other}")),
    })?;

    let manifest: Manifest = {
        let entry = zip
            .by_name(MANIFEST_NAME)
            .map_err(|_| Error::Project(format!("{MANIFEST_NAME} missing")))?;
        serde_json::from_reader(BufReader::new(entry))
            .map_err(|e| Error::Project(format!("{MANIFEST_NAME}: {e}")))?
    };
    if manifest.format > FORMAT_VERSION {
        return Err(Error::Project(format!(
            "project format {} is newer than this version supports ({FORMAT_VERSION}); please update Pixelforge",
            manifest.format
        )));
    }
    check_dimensions(manifest.doc.width, manifest.doc.height)?;

    let mut doc = ProjectDoc {
        manifest,
        ..Default::default()
    };
    for entry in &doc.manifest.layers {
        let mut mask_size = (doc.manifest.doc.width, doc.manifest.doc.height);
        if entry.kind.has_pixels() {
            let file = entry.file.clone().unwrap_or_else(|| layer_file(&entry.id));
            let px = read_png_entry(&mut zip, &file, 4)?;
            if (px.width, px.height) != (entry.width, entry.height) {
                return Err(Error::Project(format!(
                    "{file} is {}x{} but the manifest says {}x{}",
                    px.width, px.height, entry.width, entry.height
                )));
            }
            mask_size = (px.width, px.height);
            doc.layers.insert(entry.id.clone(), Image::Raw(px));
        }
        if let Some(mask) = &entry.mask {
            let m = read_png_entry(&mut zip, mask, 1)?;
            if (m.width, m.height) != mask_size {
                return Err(Error::Project(format!(
                    "{mask} is {}x{} but layer {:?} expects {}x{}",
                    m.width, m.height, entry.id, mask_size.0, mask_size.1
                )));
            }
            doc.masks.insert(entry.id.clone(), Image::Raw(m));
        }
    }
    for ch in &doc.manifest.channels {
        let file = ch.file.clone().unwrap_or_else(|| channel_file(&ch.id));
        let m = read_png_entry(&mut zip, &file, 1)?;
        if (m.width, m.height) != (doc.manifest.doc.width, doc.manifest.doc.height) {
            return Err(Error::Project(format!(
                "{file} is {}x{} but the canvas is {}x{}",
                m.width, m.height, doc.manifest.doc.width, doc.manifest.doc.height
            )));
        }
        doc.channels.insert(ch.id.clone(), Image::Raw(m));
    }
    if let Some(sel) = &doc.manifest.selection {
        let m = read_png_entry(&mut zip, &sel.file, 1)?;
        if (m.width, m.height) != (doc.manifest.doc.width, doc.manifest.doc.height) {
            return Err(Error::Project(format!(
                "{} is {}x{} but the canvas is {}x{}",
                sel.file, m.width, m.height, doc.manifest.doc.width, doc.manifest.doc.height
            )));
        }
        doc.selection = Some(Image::Raw(m));
    }
    let thumb_name = doc
        .manifest
        .thumbnail
        .clone()
        .unwrap_or_else(|| THUMB_NAME.to_owned());
    if let Ok(mut entry) = zip.by_name(&thumb_name) {
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        if png_dimensions(&bytes).is_some() {
            doc.thumbnail = Some(Image::Png(bytes));
        }
    }
    Ok(doc)
}

fn read_png_entry<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    name: &str,
    channels: u8,
) -> Result<Pixels> {
    // The png decoder needs `Seek`, which a zip entry stream cannot offer, so the
    // (compressed) PNG bytes are pulled into one buffer first; pixels are decoded from it.
    let mut png = Vec::new();
    zip.by_name(name)
        .map_err(|_| Error::Project(format!("{name} missing from archive")))?
        .read_to_end(&mut png)?;
    let mut limits = Limits::no_limits();
    limits.max_image_width = Some(MAX_EDGE_PX);
    limits.max_image_height = Some(MAX_EDGE_PX);
    limits.max_alloc = Some(1024 * 1024 * 1024);
    let decoder = PngDecoder::with_limits(std::io::Cursor::new(&png), limits)
        .map_err(|e| Error::Project(format!("{name}: {e}")))?;
    let img =
        DynamicImage::from_decoder(decoder).map_err(|e| Error::Project(format!("{name}: {e}")))?;
    Ok(match channels {
        1 => {
            let g = img.into_luma8();
            let (w, h) = g.dimensions();
            Pixels::gray(w, h, g.into_raw())
        }
        _ => {
            let rgba = img.into_rgba8();
            let (w, h) = rgba.dimensions();
            Pixels::rgba(w, h, rgba.into_raw())
        }
    })
}

/// Current UTC time as RFC 3339 (`2026-10-06T14:03:11Z`), without pulling in `chrono`.
pub fn now_rfc3339() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    unix_to_rfc3339(secs)
}

/// Format Unix seconds as RFC 3339 UTC.
pub fn unix_to_rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn checker(w: u32, h: u32, seed: u8) -> Vec<u8> {
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                let on = (x + y) % 2 == 0;
                v.extend_from_slice(&[
                    if on { seed } else { 255 - seed },
                    (x * 7) as u8,
                    (y * 11) as u8,
                    if x == 0 { 0 } else { 200 + (seed % 55) },
                ]);
            }
        }
        v
    }

    fn sample_doc() -> ProjectDoc {
        let mut m = Manifest::new("doc-1", "Sample", 40, 30);
        m.app_version = "0.1.0-test".into();
        m.created = "2026-10-06T00:00:00Z".into();
        m.modified = "2026-10-06T00:00:01Z".into();
        m.active_layer = Some("l2".into());
        m.ai_history = vec![serde_json::json!({
            "id": "job-1", "provider": "x_ai", "prompt": "a cat", "thumb": "data:...",
            "nested": {"anything": [1, 2, {"goes": null}]}
        })];
        m.extra
            .insert("future_field".into(), serde_json::json!({"keep": "me"}));

        let mut bg = LayerEntry::raster("l1", "Background", 0, 0, 40, 30);
        bg.locked = true;
        let mut l2 = LayerEntry::raster("l2", "Paint", -5, 7, 20, 10);
        l2.blend_mode = "multiply".into();
        l2.opacity = 0.5;
        l2.extra
            .insert("layer_future".into(), serde_json::json!(42));
        let g = LayerEntry::group("g1", "Folder");
        let mut l3 = LayerEntry::raster("l3", "In group", 10, 12, 8, 8);
        l3.parent = Some("g1".into());
        l3.visible = false;
        l3.blend_mode = "screen".into();
        m.layers = vec![bg, l2, l3, g];

        let mut doc = ProjectDoc {
            manifest: m,
            ..Default::default()
        };
        doc.layers.insert(
            "l1".into(),
            Image::Raw(Pixels::rgba(40, 30, checker(40, 30, 10))),
        );
        doc.layers.insert(
            "l2".into(),
            Image::Raw(Pixels::rgba(20, 10, checker(20, 10, 90))),
        );
        doc.layers.insert(
            "l3".into(),
            Image::Raw(Pixels::rgba(8, 8, checker(8, 8, 200))),
        );
        doc.masks.insert(
            "l3".into(),
            Image::Raw(Pixels::gray(8, 8, (0..64).map(|i| (i * 4) as u8).collect())),
        );
        doc.selection = Some(Image::Raw(Pixels::gray(
            40,
            30,
            (0..1200).map(|i| (i % 256) as u8).collect(),
        )));
        doc.thumbnail = Some(Image::Raw(Pixels::rgba(40, 30, checker(40, 30, 10))));
        doc
    }

    #[test]
    fn round_trip_is_identical() {
        let doc = sample_doc();
        let out = write_pfproj(&doc, Cursor::new(Vec::new())).expect("write");
        let bytes = out.into_inner();
        assert!(bytes.starts_with(b"PK\x03\x04"));

        let back = read_pfproj_bytes(&bytes).expect("read");
        assert_eq!(back.layers, doc.layers);
        assert_eq!(back.masks, doc.masks);
        assert_eq!(back.selection, doc.selection);

        let m = &back.manifest;
        assert_eq!(m.format, FORMAT_VERSION);
        assert_eq!(m.doc, doc.manifest.doc);
        assert_eq!(m.ai_history, doc.manifest.ai_history);
        assert_eq!(m.extra["future_field"], serde_json::json!({"keep": "me"}));
        assert_eq!(m.active_layer.as_deref(), Some("l2"));
        assert_eq!(m.app_version, "0.1.0-test");
        assert_eq!(m.layers.len(), 4);
        for (a, b) in m.layers.iter().zip(&doc.manifest.layers) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.name, b.name);
            assert_eq!(a.kind, b.kind);
            assert_eq!(a.parent, b.parent);
            assert_eq!((a.x, a.y, a.width, a.height), (b.x, b.y, b.width, b.height));
            assert_eq!(a.opacity, b.opacity);
            assert_eq!(a.blend_mode, b.blend_mode);
            assert_eq!(a.visible, b.visible);
            assert_eq!(a.locked, b.locked);
            assert_eq!(a.extra, b.extra);
        }
        assert_eq!(m.layers[1].file.as_deref(), Some("layers/l2.png"));
        assert_eq!(m.layers[2].mask.as_deref(), Some("masks/l3.png"));
        assert_eq!(m.layers[3].file, None);
        assert_eq!(
            m.selection.as_ref().map(|s| s.file.as_str()),
            Some("selection.png")
        );
        assert_eq!(m.thumbnail.as_deref(), Some("thumb.png"));

        // Thumbnail is a PNG no larger than 256 px (here the source is small: 40x30).
        let Some(Image::Png(png)) = &back.thumbnail else {
            panic!("thumbnail missing");
        };
        assert_eq!(png_dimensions(png), Some((40, 30)));

        // Writing the read-back doc again gives the same archive contents.
        let again = write_pfproj(&back, Cursor::new(Vec::new())).expect("write 2");
        let back2 = read_pfproj_bytes(&again.into_inner()).expect("read 2");
        assert_eq!(back2.manifest, back.manifest);
        assert_eq!(back2.layers, back.layers);
    }

    #[test]
    fn forward_compat_unknown_fields_and_defaults() {
        // A manifest written by a hypothetical newer minor revision (same format) with
        // fields we do not know, and a layer entry missing optional fields.
        let manifest = serde_json::json!({
            "format": 1,
            "doc": {"id": "d", "name": "n", "width": 2, "height": 2, "color_profile": "sRGB"},
            "layers": [
                {"id": "a", "name": "A", "width": 2, "height": 2, "effects": [{"glow": 1}]}
            ],
            "guides": [{"x": 10}],
            "ai_history": [{"v": 2}]
        });
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(MANIFEST_NAME, SimpleFileOptions::default())
            .expect("start");
        zip.write_all(manifest.to_string().as_bytes())
            .expect("write");
        zip.start_file("layers/a.png", SimpleFileOptions::default())
            .expect("start");
        write_png(
            &mut zip,
            &[1, 2, 3, 4].repeat(4),
            2,
            2,
            ExtendedColorType::Rgba8,
            PngCompression::Fast,
        )
        .expect("png");
        let bytes = zip.finish().expect("finish").into_inner();

        let doc = read_pfproj_bytes(&bytes).expect("read");
        assert_eq!(doc.manifest.extra["guides"], serde_json::json!([{"x": 10}]));
        assert_eq!(doc.manifest.doc.extra["color_profile"], "sRGB");
        assert_eq!(
            doc.manifest.layers[0].extra["effects"],
            serde_json::json!([{"glow": 1}])
        );
        assert_eq!(doc.manifest.layers[0].opacity, 1.0);
        assert!(doc.manifest.layers[0].visible);
        assert_eq!(doc.manifest.layers[0].blend_mode, "normal");
        assert!(doc.thumbnail.is_none());
        assert!(doc.selection.is_none());

        // Re-write preserves them.
        let out = write_pfproj(&doc, Cursor::new(Vec::new())).expect("write");
        let back = read_pfproj_bytes(&out.into_inner()).expect("read");
        assert_eq!(
            back.manifest.extra["guides"],
            serde_json::json!([{"x": 10}])
        );
        assert_eq!(
            back.manifest.layers[0].extra["effects"],
            serde_json::json!([{"glow": 1}])
        );
        assert_eq!(back.manifest.ai_history, vec![serde_json::json!({"v": 2})]);
    }

    #[test]
    fn newer_format_is_refused() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(MANIFEST_NAME, SimpleFileOptions::default())
            .expect("start");
        zip.write_all(br#"{"format": 99, "doc": {"id":"d","name":"n","width":1,"height":1}}"#)
            .expect("write");
        let bytes = zip.finish().expect("finish").into_inner();
        let err = read_pfproj_bytes(&bytes).expect_err("refuse");
        assert_eq!(err.code(), "io_project");
        assert!(err.to_string().contains("newer"));
    }

    #[test]
    fn validation_errors() {
        let mut doc = sample_doc();
        doc.layers.remove("l2");
        assert_eq!(
            write_pfproj(&doc, Cursor::new(Vec::new()))
                .expect_err("missing pixels")
                .code(),
            "io_project"
        );

        let mut doc = sample_doc();
        doc.manifest.layers[1].width = 21;
        assert!(write_pfproj(&doc, Cursor::new(Vec::new())).is_err());

        let mut doc = sample_doc();
        doc.manifest.layers[0].id = "../evil".into();
        assert!(write_pfproj(&doc, Cursor::new(Vec::new())).is_err());

        assert_eq!(
            read_pfproj_bytes(b"nope").expect_err("x").code(),
            "io_project"
        );
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("other.txt", SimpleFileOptions::default())
            .expect("start");
        let bytes = zip.finish().expect("finish").into_inner();
        assert!(read_pfproj_bytes(&bytes)
            .expect_err("no manifest")
            .to_string()
            .contains("manifest.json"));
    }

    #[test]
    fn pre_encoded_png_layers_are_stored_verbatim() {
        let mut doc = ProjectDoc {
            manifest: Manifest::new("d", "n", 3, 2),
            ..Default::default()
        };
        doc.manifest
            .layers
            .push(LayerEntry::raster("a", "A", 0, 0, 3, 2));
        let rgba = checker(3, 2, 33);
        let mut png = Vec::new();
        write_png(
            &mut png,
            &rgba,
            3,
            2,
            ExtendedColorType::Rgba8,
            PngCompression::Best,
        )
        .expect("png");
        doc.layers.insert("a".into(), Image::Png(png.clone()));
        let bytes = write_pfproj(&doc, Cursor::new(Vec::new()))
            .expect("write")
            .into_inner();

        let mut zip = ZipArchive::new(Cursor::new(&bytes)).expect("zip");
        let mut stored = Vec::new();
        zip.by_name("layers/a.png")
            .expect("entry")
            .read_to_end(&mut stored)
            .expect("read");
        assert_eq!(stored, png);

        let back = read_pfproj_bytes(&bytes).expect("read");
        assert_eq!(back.layers["a"], Image::Raw(Pixels::rgba(3, 2, rgba)));
    }

    #[test]
    fn rfc3339_formatting() {
        assert_eq!(unix_to_rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(unix_to_rfc3339(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(unix_to_rfc3339(1_790_000_000), "2026-09-21T14:13:20Z");
        assert_eq!(unix_to_rfc3339(1_767_225_599), "2025-12-31T23:59:59Z");
        assert!(now_rfc3339().ends_with('Z'));
    }
}
