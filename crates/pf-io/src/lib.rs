//! # pf-io
//!
//! File I/O for Pixelforge: image codecs (via the `image` crate), read-only PSD import,
//! the `.pfproj` project container (a ZIP holding `manifest.json`, one PNG per layer and
//! a thumbnail) and thumbnail generation.
//!
//! The live document never lives in Rust (see `docs/architecture.md`); this crate only
//! turns bytes on disk into layer PNGs for the webview and back. Images cross IPC as raw
//! bytes, so every public function here speaks `Vec<u8>` / `&[u8]`, never base64.
//!
//! Decoders, the PSD importer and the `.pfproj` reader/writer are added by the `io-rust`
//! wave (PLAN.md section 4). This scaffold only fixes the public [`Error`] type and the
//! [`ImageFormat`] enum so the Tauri commands can be written against a stable surface.

#![forbid(unsafe_code)]

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Errors produced by `pf-io`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The file extension / magic bytes are not something we can open.
    #[error("unsupported format: {0}")]
    UnsupportedFormat(String),

    /// The image data could not be decoded.
    #[error("decode error: {0}")]
    Decode(String),

    /// The image could not be encoded in the requested format.
    #[error("encode error: {0}")]
    Encode(String),

    /// The PSD file is malformed or uses an unsupported feature.
    #[error("PSD import error: {0}")]
    Psd(String),

    /// The `.pfproj` container is malformed (missing manifest, bad layer entry, ...).
    #[error("project file error: {0}")]
    Project(String),

    /// The canvas is larger than the v1 limit (8192 x 8192).
    #[error("image is {width}x{height}; the maximum is {max}x{max}")]
    TooLarge {
        /// Image width.
        width: u32,
        /// Image height.
        height: u32,
        /// Maximum edge length.
        max: u32,
    },

    /// Underlying `image` crate failure.
    #[error("image error: {0}")]
    Image(#[from] image::ImageError),

    /// Local I/O failure.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON (de)serialization failure (manifest).
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    /// Stable machine-readable code for IPC (`{ code, message }`).
    pub fn code(&self) -> &'static str {
        match self {
            Error::UnsupportedFormat(_) => "io_unsupported_format",
            Error::Decode(_) => "io_decode",
            Error::Encode(_) => "io_encode",
            Error::Psd(_) => "io_psd",
            Error::Project(_) => "io_project",
            Error::TooLarge { .. } => "io_too_large",
            Error::Image(_) => "io_image",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
        }
    }
}

/// Convenience alias.
pub type Result<T> = std::result::Result<T, Error>;

/// Maximum canvas edge in v1 (PLAN.md section 0).
pub const MAX_EDGE_PX: u32 = 8192;

/// Formats Pixelforge can open and/or save.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageFormat {
    /// Portable Network Graphics.
    Png,
    /// JPEG (quality selectable on export).
    Jpeg,
    /// WebP.
    WebP,
    /// GIF (first frame only on import).
    Gif,
    /// Windows bitmap.
    Bmp,
    /// TIFF.
    Tiff,
    /// Adobe Photoshop document (import only).
    Psd,
    /// Pixelforge project container.
    PfProj,
}

impl ImageFormat {
    /// Every format, in the order the open dialog lists them.
    pub const ALL: [ImageFormat; 8] = [
        ImageFormat::PfProj,
        ImageFormat::Png,
        ImageFormat::Jpeg,
        ImageFormat::WebP,
        ImageFormat::Gif,
        ImageFormat::Bmp,
        ImageFormat::Tiff,
        ImageFormat::Psd,
    ];

    /// Detect from a file extension (case-insensitive, with or without the dot).
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
            "png" => Some(ImageFormat::Png),
            "jpg" | "jpeg" | "jpe" | "jfif" => Some(ImageFormat::Jpeg),
            "webp" => Some(ImageFormat::WebP),
            "gif" => Some(ImageFormat::Gif),
            "bmp" | "dib" => Some(ImageFormat::Bmp),
            "tif" | "tiff" => Some(ImageFormat::Tiff),
            "psd" => Some(ImageFormat::Psd),
            "pfproj" => Some(ImageFormat::PfProj),
            _ => None,
        }
    }

    /// Detect from a path's extension.
    pub fn from_path(path: &Path) -> Option<Self> {
        path.extension()
            .and_then(|e| e.to_str())
            .and_then(Self::from_extension)
    }

    /// Canonical extension (no dot).
    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::WebP => "webp",
            ImageFormat::Gif => "gif",
            ImageFormat::Bmp => "bmp",
            ImageFormat::Tiff => "tiff",
            ImageFormat::Psd => "psd",
            ImageFormat::PfProj => "pfproj",
        }
    }

    /// All extensions this format is recognised by (for dialog filters).
    pub fn extensions(self) -> &'static [&'static str] {
        match self {
            ImageFormat::Png => &["png"],
            ImageFormat::Jpeg => &["jpg", "jpeg", "jpe", "jfif"],
            ImageFormat::WebP => &["webp"],
            ImageFormat::Gif => &["gif"],
            ImageFormat::Bmp => &["bmp", "dib"],
            ImageFormat::Tiff => &["tif", "tiff"],
            ImageFormat::Psd => &["psd"],
            ImageFormat::PfProj => &["pfproj"],
        }
    }

    /// Human-readable name for dialogs.
    pub fn label(self) -> &'static str {
        match self {
            ImageFormat::Png => "PNG",
            ImageFormat::Jpeg => "JPEG",
            ImageFormat::WebP => "WebP",
            ImageFormat::Gif => "GIF",
            ImageFormat::Bmp => "BMP",
            ImageFormat::Tiff => "TIFF",
            ImageFormat::Psd => "Photoshop (PSD)",
            ImageFormat::PfProj => "Pixelforge project",
        }
    }

    /// Can be opened.
    pub fn can_import(self) -> bool {
        true
    }

    /// Can be saved / exported (PSD export is v2).
    pub fn can_export(self) -> bool {
        !matches!(
            self,
            ImageFormat::Psd | ImageFormat::Gif | ImageFormat::Bmp | ImageFormat::Tiff
        )
    }
}

/// Reject canvases above the v1 limit.
pub fn check_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(Error::Decode("image has a zero dimension".to_owned()));
    }
    if width > MAX_EDGE_PX || height > MAX_EDGE_PX {
        return Err(Error::TooLarge {
            width,
            height,
            max: MAX_EDGE_PX,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_detection_from_extension_and_path() {
        assert_eq!(ImageFormat::from_extension("PNG"), Some(ImageFormat::Png));
        assert_eq!(
            ImageFormat::from_extension(".JpEg"),
            Some(ImageFormat::Jpeg)
        );
        assert_eq!(
            ImageFormat::from_path(Path::new("C:/art/final.pfproj")),
            Some(ImageFormat::PfProj)
        );
        assert_eq!(ImageFormat::from_extension("exe"), None);
        for f in ImageFormat::ALL {
            assert_eq!(ImageFormat::from_extension(f.extension()), Some(f));
            assert!(f.extensions().contains(&f.extension()));
        }
        assert!(!ImageFormat::Psd.can_export());
        assert!(ImageFormat::Png.can_export());
    }

    #[test]
    fn dimension_guard() {
        assert!(check_dimensions(1, 1).is_ok());
        assert!(check_dimensions(MAX_EDGE_PX, MAX_EDGE_PX).is_ok());
        let err = check_dimensions(MAX_EDGE_PX + 1, 10).expect_err("too large");
        assert_eq!(err.code(), "io_too_large");
        assert!(check_dimensions(0, 10).is_err());
    }
}
