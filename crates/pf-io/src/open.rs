//! "Open anything": sniff the bytes and produce an [`ImportedDocument`] from either the
//! raster codecs (one `Background` layer) or the PSD importer (many layers).
//!
//! `.pfproj` is deliberately not handled here: it carries a full manifest and goes
//! through [`crate::pfproj::read_pfproj`].

use crate::{codec, psd, Error, ImageFormat, Result};

/// One imported layer. Pixels are straight-alpha RGBA8 covering only the layer's own
/// rectangle (`w` x `h`), positioned at (`x`, `y`) on the canvas. Group entries carry no
/// pixels (`w == h == 0`, `rgba` empty).
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedLayer {
    /// Layer name as stored in the file.
    pub name: String,
    /// `w * h * 4` bytes, straight alpha.
    pub rgba: Vec<u8>,
    /// Offset of the layer's left edge on the canvas (may be negative for PSD layers
    /// that hang off the canvas; the pixels are then already clipped to the canvas).
    pub x: i32,
    /// Offset of the layer's top edge on the canvas.
    pub y: i32,
    /// Width of `rgba`.
    pub w: u32,
    /// Height of `rgba`.
    pub h: u32,
    /// 0.0 - 1.0.
    pub opacity: f32,
    /// Visible in the source file.
    pub visible: bool,
    /// One of Pixelforge's 16 blend mode names (`normal`, `multiply`, ...), see
    /// [`crate::psd::BLEND_MODES`].
    pub blend_mode: String,
    /// True for a group (folder) entry.
    pub is_group: bool,
    /// 0 for top-level layers and group entries, 1 for layers inside a group (v1 allows
    /// one level of nesting; deeper PSD nesting is flattened to depth 1).
    pub group_depth: u8,
    /// For layers inside a group: index (into [`ImportedDocument::layers`]) of the group
    /// entry that contains them. The group entry sits directly above its children.
    pub group: Option<usize>,
}

impl ImportedLayer {
    /// A full-canvas, opaque, visible, normal layer.
    pub fn background(name: &str, rgba: Vec<u8>, w: u32, h: u32) -> Self {
        Self {
            name: name.to_owned(),
            rgba,
            x: 0,
            y: 0,
            w,
            h,
            opacity: 1.0,
            visible: true,
            blend_mode: "normal".to_owned(),
            is_group: false,
            group_depth: 0,
            group: None,
        }
    }
}

/// An opened image / PSD: canvas size plus layers ordered **bottom to top**.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedDocument {
    /// Canvas width.
    pub width: u32,
    /// Canvas height.
    pub height: u32,
    /// Bottom-most layer first.
    pub layers: Vec<ImportedLayer>,
    /// Container the bytes came from.
    pub source_format: ImageFormat,
}

/// Open a raster image or PSD. `ext_hint` (a file extension, with or without the dot)
/// is only used to produce a better error message; the format is sniffed.
pub fn open_bytes(bytes: &[u8], ext_hint: Option<&str>) -> Result<ImportedDocument> {
    match codec::sniff(bytes) {
        Some(ImageFormat::Psd) => psd::import_psd(bytes),
        Some(ImageFormat::PfProj) => Err(Error::UnsupportedFormat(
            "this is a Pixelforge project; open it with the project reader (io_open_pfproj)"
                .to_owned(),
        )),
        Some(_) => {
            let img = codec::decode(bytes)?;
            Ok(ImportedDocument {
                width: img.width,
                height: img.height,
                layers: vec![ImportedLayer::background(
                    "Background",
                    img.rgba,
                    img.width,
                    img.height,
                )],
                source_format: img.source_format,
            })
        }
        None => Err(Error::UnsupportedFormat(match ext_hint {
            Some(ext) if !ext.is_empty() => {
                format!(
                    "unrecognised image data in .{} file",
                    ext.trim_start_matches('.')
                )
            }
            _ => "unrecognised image data".to_owned(),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raster_becomes_single_background_layer() {
        let img = image::RgbaImage::from_pixel(3, 2, image::Rgba([1, 2, 3, 4]));
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png)
            .expect("png");
        let doc = open_bytes(buf.get_ref(), Some("png")).expect("open");
        assert_eq!((doc.width, doc.height), (3, 2));
        assert_eq!(doc.source_format, ImageFormat::Png);
        assert_eq!(doc.layers.len(), 1);
        let l = &doc.layers[0];
        assert_eq!(l.name, "Background");
        assert_eq!((l.x, l.y, l.w, l.h), (0, 0, 3, 2));
        assert_eq!(l.rgba, img.into_raw());
        assert!(l.visible && !l.is_group && l.group.is_none());
    }

    #[test]
    fn pfproj_and_garbage_are_rejected() {
        let e = open_bytes(b"PK\x03\x04\0\0", None).expect_err("zip");
        assert_eq!(e.code(), "io_unsupported_format");
        assert!(e.to_string().contains("io_open_pfproj"));
        let e = open_bytes(b"\0\0\0", Some(".xyz")).expect_err("garbage");
        assert!(e.to_string().contains(".xyz"));
    }
}
