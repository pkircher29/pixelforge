//! Raster codecs: decode anything the `image` crate handles into straight-alpha RGBA8,
//! encode RGBA8 to PNG / JPEG / WebP.
//!
//! Decoding applies the EXIF orientation tag (JPEG, WebP, TIFF) so the pixels the webview
//! receives are already upright. Dimensions are checked against [`crate::MAX_EDGE_PX`]
//! *before* the pixel buffer is allocated.

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::codecs::webp::WebPEncoder;
use image::metadata::Orientation;
use image::{DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, ImageReader, Limits};
use serde::{Deserialize, Serialize};

use crate::{check_buffer, check_dimensions, Error, ImageFormat, Result};

/// Upper bound on the decoder's scratch allocations (1 GiB). RGBA8 at 8192x8192 is
/// 256 MiB; 16-bit TIFF at the same size needs twice that before conversion.
const MAX_DECODE_ALLOC: u64 = 1024 * 1024 * 1024;

/// A decoded raster image: straight (non-premultiplied) RGBA8, row-major, no padding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedImage {
    /// Width in pixels (after orientation is applied).
    pub width: u32,
    /// Height in pixels (after orientation is applied).
    pub height: u32,
    /// `width * height * 4` bytes.
    pub rgba: Vec<u8>,
    /// Container format the bytes were in.
    pub source_format: ImageFormat,
}

/// PNG compression preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PngCompression {
    /// Fastest (zlib level 1, adaptive filtering). Used for `.pfproj` layers.
    #[default]
    Fast,
    /// Smallest output. Several times slower.
    Best,
}

/// Encoder options. Every field has a default so the UI can send `{}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EncodeOptions {
    /// JPEG / lossy WebP quality, 1-100.
    pub quality: u8,
    /// WebP only: lossless instead of lossy (ignores `quality`).
    pub lossless: bool,
    /// PNG only.
    pub png_compression: PngCompression,
    /// JPEG only: the alpha channel is flattened onto this RGB colour.
    pub background: [u8; 3],
}

impl Default for EncodeOptions {
    fn default() -> Self {
        Self {
            quality: 90,
            lossless: false,
            png_compression: PngCompression::Fast,
            background: [255, 255, 255],
        }
    }
}

/// Identify a byte buffer by its magic bytes. Returns `None` for unknown data.
pub fn sniff(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(b"8BPS") {
        return Some(ImageFormat::Psd);
    }
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(ImageFormat::PfProj);
    }
    image::guess_format(bytes).ok().and_then(from_image_format)
}

/// Map an `image` crate format onto ours.
fn from_image_format(f: image::ImageFormat) -> Option<ImageFormat> {
    match f {
        image::ImageFormat::Png => Some(ImageFormat::Png),
        image::ImageFormat::Jpeg => Some(ImageFormat::Jpeg),
        image::ImageFormat::WebP => Some(ImageFormat::WebP),
        image::ImageFormat::Gif => Some(ImageFormat::Gif),
        image::ImageFormat::Bmp => Some(ImageFormat::Bmp),
        image::ImageFormat::Tiff => Some(ImageFormat::Tiff),
        _ => None,
    }
}

/// Map our format onto the `image` crate's (raster formats only).
fn to_image_format(f: ImageFormat) -> Option<image::ImageFormat> {
    match f {
        ImageFormat::Png => Some(image::ImageFormat::Png),
        ImageFormat::Jpeg => Some(image::ImageFormat::Jpeg),
        ImageFormat::WebP => Some(image::ImageFormat::WebP),
        ImageFormat::Gif => Some(image::ImageFormat::Gif),
        ImageFormat::Bmp => Some(image::ImageFormat::Bmp),
        ImageFormat::Tiff => Some(image::ImageFormat::Tiff),
        ImageFormat::Psd | ImageFormat::PfProj => None,
    }
}

/// Decode PNG / JPEG / WebP / GIF (first frame) / BMP / TIFF into straight-alpha RGBA8.
///
/// The format is sniffed from the magic bytes; the file extension is not consulted.
/// JPEG / WebP / TIFF EXIF orientation is applied. Images with an edge above
/// [`crate::MAX_EDGE_PX`] are rejected with [`Error::TooLarge`] before decoding.
pub fn decode(bytes: &[u8]) -> Result<DecodedImage> {
    let source_format = match sniff(bytes) {
        Some(f) => f,
        None => {
            return Err(Error::UnsupportedFormat(
                "unrecognised image data".to_owned(),
            ))
        }
    };
    let img_fmt = to_image_format(source_format).ok_or_else(|| {
        Error::UnsupportedFormat(format!(
            "{} is not a raster image (use the PSD importer / project reader)",
            source_format.label()
        ))
    })?;

    let mut reader = ImageReader::with_format(Cursor::new(bytes), img_fmt);
    let mut limits = Limits::no_limits();
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    limits.max_image_width = Some(crate::MAX_EDGE_PX);
    limits.max_image_height = Some(crate::MAX_EDGE_PX);
    reader.limits(limits);

    let mut decoder = reader.into_decoder().map_err(map_decode_error)?;
    let (w, h) = decoder.dimensions();
    check_dimensions(w, h)?;
    // A missing / unparsable EXIF block is not an error: just leave the image as is.
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);

    let mut img = DynamicImage::from_decoder(decoder).map_err(map_decode_error)?;
    img.apply_orientation(orientation);
    let rgba = img.into_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(DecodedImage {
        width,
        height,
        rgba: rgba.into_raw(),
        source_format,
    })
}

/// Turn the `image` crate's dimension-limit error into our typed [`Error::TooLarge`].
fn map_decode_error(err: image::ImageError) -> Error {
    use image::error::{ImageError, LimitError, LimitErrorKind};
    match &err {
        ImageError::Limits(l) if matches!(l.kind(), LimitErrorKind::DimensionError) => {
            Error::TooLarge {
                width: 0,
                height: 0,
                max: crate::MAX_EDGE_PX,
            }
        }
        ImageError::Limits(l) => {
            let _: &LimitError = l;
            Error::Decode(err.to_string())
        }
        _ => Error::Image(err),
    }
}

/// Encode a straight-alpha RGBA8 buffer.
///
/// - PNG: alpha preserved; `opts.png_compression` selects speed vs size.
/// - JPEG: alpha is flattened onto `opts.background`; `opts.quality` 1-100.
/// - WebP: `opts.lossless` or lossy at `opts.quality`; alpha preserved either way.
///
/// GIF / BMP / TIFF / PSD / `.pfproj` are rejected with [`Error::UnsupportedFormat`].
pub fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    format: ImageFormat,
    opts: &EncodeOptions,
) -> Result<Vec<u8>> {
    check_buffer(rgba, width, height, 4)?;
    match format {
        ImageFormat::Png => encode_png(rgba, width, height, opts.png_compression),
        ImageFormat::Jpeg => encode_jpeg(rgba, width, height, opts.quality, opts.background),
        ImageFormat::WebP => encode_webp(rgba, width, height, opts),
        other => Err(Error::UnsupportedFormat(format!(
            "{} export is not supported",
            other.label()
        ))),
    }
}

/// Encode RGBA8 as PNG straight into `out` (used by the `.pfproj` writer to stream).
pub fn write_png<W: std::io::Write>(
    out: W,
    data: &[u8],
    width: u32,
    height: u32,
    color: ExtendedColorType,
    compression: PngCompression,
) -> Result<()> {
    let ctype = match compression {
        PngCompression::Fast => CompressionType::Fast,
        PngCompression::Best => CompressionType::Best,
    };
    PngEncoder::new_with_quality(out, ctype, FilterType::Adaptive)
        .write_image(data, width, height, color)
        .map_err(|e| Error::Encode(e.to_string()))
}

fn encode_png(
    rgba: &[u8],
    width: u32,
    height: u32,
    compression: PngCompression,
) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(rgba.len() / 4);
    write_png(
        &mut out,
        rgba,
        width,
        height,
        ExtendedColorType::Rgba8,
        compression,
    )?;
    Ok(out)
}

/// Flatten straight-alpha RGBA onto an opaque background colour, producing RGB8.
pub fn flatten_onto(rgba: &[u8], background: [u8; 3]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        let a = u32::from(px[3]);
        if a == 255 {
            rgb.extend_from_slice(&px[..3]);
        } else {
            for c in 0..3 {
                let bg = u32::from(background[c]);
                let fg = u32::from(px[c]);
                // bg + (fg - bg) * a / 255, rounded.
                let v = (fg * a + bg * (255 - a) + 127) / 255;
                rgb.push(v as u8);
            }
        }
    }
    rgb
}

fn encode_jpeg(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    background: [u8; 3],
) -> Result<Vec<u8>> {
    let quality = quality.clamp(1, 100);
    let rgb = flatten_onto(rgba, background);
    let mut out = Vec::with_capacity(rgb.len() / 8);
    JpegEncoder::new_with_quality(&mut out, quality)
        .write_image(&rgb, width, height, ExtendedColorType::Rgb8)
        .map_err(|e| Error::Encode(e.to_string()))?;
    Ok(out)
}

fn encode_webp(rgba: &[u8], width: u32, height: u32, opts: &EncodeOptions) -> Result<Vec<u8>> {
    if opts.lossless {
        let mut out = Vec::with_capacity(rgba.len() / 4);
        WebPEncoder::new_lossless(&mut out)
            .write_image(rgba, width, height, ExtendedColorType::Rgba8)
            .map_err(|e| Error::Encode(e.to_string()))?;
        return Ok(out);
    }
    let quality = f32::from(opts.quality.clamp(1, 100));
    let mem = webp::Encoder::from_rgba(rgba, width, height)
        .encode_simple(false, quality)
        .map_err(|e| Error::Encode(format!("libwebp: {e:?}")))?;
    Ok(mem.to_vec())
}

/// Read `(width, height)` from a PNG's IHDR without decoding it.
pub fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIG: &[u8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || !bytes.starts_with(SIG) || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 7x5 test image with a gradient and a transparent hole.
    fn synthetic(w: u32, h: u32) -> Vec<u8> {
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                let a = if x == 2 && y == 1 {
                    0
                } else if x == 3 {
                    128
                } else {
                    255
                };
                v.extend_from_slice(&[(x * 36) as u8, (y * 50) as u8, 200, a]);
            }
        }
        v
    }

    #[test]
    fn png_round_trip_is_lossless_with_alpha() {
        let (w, h) = (7, 5);
        let src = synthetic(w, h);
        for comp in [PngCompression::Fast, PngCompression::Best] {
            let opts = EncodeOptions {
                png_compression: comp,
                ..Default::default()
            };
            let bytes = encode(&src, w, h, ImageFormat::Png, &opts).expect("encode");
            assert_eq!(png_dimensions(&bytes), Some((w, h)));
            let dec = decode(&bytes).expect("decode");
            assert_eq!(dec.source_format, ImageFormat::Png);
            assert_eq!((dec.width, dec.height), (w, h));
            assert_eq!(dec.rgba, src);
        }
    }

    #[test]
    fn webp_lossless_round_trip_with_alpha() {
        let (w, h) = (7, 5);
        let src = synthetic(w, h);
        let opts = EncodeOptions {
            lossless: true,
            ..Default::default()
        };
        let bytes = encode(&src, w, h, ImageFormat::WebP, &opts).expect("encode");
        let dec = decode(&bytes).expect("decode");
        assert_eq!(dec.source_format, ImageFormat::WebP);
        assert_eq!(dec.rgba, src);
    }

    #[test]
    fn webp_lossy_round_trip_is_close() {
        // Smooth gradient (lossy codecs hate hard edges) with a transparent square.
        let (w, h) = (64u32, 64u32);
        let mut src = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                let a = if (8..16).contains(&x) && (8..16).contains(&y) {
                    0
                } else {
                    255
                };
                src.extend_from_slice(&[(x * 4) as u8, (y * 4) as u8, 128, a]);
            }
        }
        let opts = EncodeOptions {
            quality: 95,
            ..Default::default()
        };
        let bytes = encode(&src, w, h, ImageFormat::WebP, &opts).expect("encode");
        assert!(bytes.len() < src.len() / 4, "lossy webp should be small");
        let dec = decode(&bytes).expect("decode");
        assert_eq!((dec.width, dec.height), (w, h));
        // Alpha is coded losslessly; opaque colour far from the hole is close.
        let mut max_diff = 0;
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                assert_eq!(dec.rgba[i + 3], src[i + 3], "alpha at {x},{y}");
                if x >= 24 && y >= 24 {
                    for c in 0..3 {
                        max_diff = max_diff
                            .max((i32::from(src[i + c]) - i32::from(dec.rgba[i + c])).abs());
                    }
                }
            }
        }
        assert!(max_diff < 24, "lossy webp diverged by {max_diff}");
    }

    #[test]
    fn jpeg_flattens_alpha_onto_background() {
        let (w, h) = (16, 16);
        // Fully transparent image: JPEG should come out as the background colour.
        let src = vec![0u8; (w * h * 4) as usize];
        let opts = EncodeOptions {
            quality: 100,
            background: [10, 200, 30],
            ..Default::default()
        };
        let bytes = encode(&src, w, h, ImageFormat::Jpeg, &opts).expect("encode");
        let dec = decode(&bytes).expect("decode");
        assert_eq!(dec.source_format, ImageFormat::Jpeg);
        let px = &dec.rgba[..4];
        assert!((i32::from(px[0]) - 10).abs() < 8);
        assert!((i32::from(px[1]) - 200).abs() < 8);
        assert!((i32::from(px[2]) - 30).abs() < 8);
        assert_eq!(px[3], 255);
    }

    #[test]
    fn jpeg_exif_orientation_is_applied() {
        // Build a 4x2 image: left half red, right half blue. Encode as JPEG, then splice in
        // an APP1 EXIF block with orientation 6 (rotate 90 CW). After decode the image must
        // be 2x4 with red on top.
        let (w, h) = (4u32, 2u32);
        let mut src = Vec::new();
        for _y in 0..h {
            for x in 0..w {
                if x < 2 {
                    src.extend_from_slice(&[255, 0, 0, 255]);
                } else {
                    src.extend_from_slice(&[0, 0, 255, 255]);
                }
            }
        }
        let opts = EncodeOptions {
            quality: 100,
            ..Default::default()
        };
        let jpeg = encode(&src, w, h, ImageFormat::Jpeg, &opts).expect("encode");
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);

        // Minimal EXIF: "Exif\0\0" + TIFF header (II, 42, offset 8) + IFD with one entry.
        let mut exif = Vec::new();
        exif.extend_from_slice(b"Exif\0\0");
        exif.extend_from_slice(&[0x49, 0x49, 42, 0, 8, 0, 0, 0]); // II*\0, IFD0 at 8
        exif.extend_from_slice(&1u16.to_le_bytes()); // 1 entry
        exif.extend_from_slice(&0x0112u16.to_le_bytes()); // Orientation
        exif.extend_from_slice(&3u16.to_le_bytes()); // SHORT
        exif.extend_from_slice(&1u32.to_le_bytes()); // count
        exif.extend_from_slice(&6u16.to_le_bytes()); // value 6
        exif.extend_from_slice(&[0, 0]); // padding of the 4-byte value slot
        exif.extend_from_slice(&0u32.to_le_bytes()); // next IFD
        let seg_len = (exif.len() + 2) as u16;
        let mut with_exif = Vec::with_capacity(jpeg.len() + exif.len() + 4);
        with_exif.extend_from_slice(&jpeg[..2]);
        with_exif.extend_from_slice(&[0xFF, 0xE1]);
        with_exif.extend_from_slice(&seg_len.to_be_bytes());
        with_exif.extend_from_slice(&exif);
        with_exif.extend_from_slice(&jpeg[2..]);

        let dec = decode(&with_exif).expect("decode");
        assert_eq!((dec.width, dec.height), (2, 4), "rotated 90 degrees");
        let top = &dec.rgba[..4];
        let bottom = &dec.rgba[(3 * 2 * 4)..(3 * 2 * 4 + 4)];
        assert!(
            top[0] > 200 && top[2] < 60,
            "top row should be red: {top:?}"
        );
        assert!(
            bottom[2] > 200 && bottom[0] < 60,
            "bottom row should be blue: {bottom:?}"
        );
    }

    #[test]
    fn gif_bmp_tiff_decode() {
        let (w, h) = (5, 3);
        let src = synthetic(w, h);
        let img = image::RgbaImage::from_raw(w, h, src.clone()).expect("img");
        for (fmt, ours) in [
            (image::ImageFormat::Bmp, ImageFormat::Bmp),
            (image::ImageFormat::Tiff, ImageFormat::Tiff),
            (image::ImageFormat::Gif, ImageFormat::Gif),
        ] {
            let mut buf = Cursor::new(Vec::new());
            img.write_to(&mut buf, fmt).expect("write");
            let dec = decode(buf.get_ref()).expect("decode");
            assert_eq!(dec.source_format, ours, "{fmt:?}");
            assert_eq!((dec.width, dec.height), (w, h));
            if fmt != image::ImageFormat::Gif {
                assert_eq!(dec.rgba, src, "{fmt:?} must be lossless");
            } else {
                // GIF is palettised with 1-bit alpha; opaque pixels survive, the hole stays a hole.
                assert_eq!(dec.rgba[(w as usize + 2) * 4 + 3], 0);
                assert_eq!(dec.rgba[3], 255);
            }
        }
    }

    #[test]
    fn oversize_is_rejected_before_decoding() {
        // Hand-build a PNG header claiming 9000x9000 so no real pixel data is needed.
        let big = image::RgbaImage::new(1, 1);
        let mut buf = Cursor::new(Vec::new());
        big.write_to(&mut buf, image::ImageFormat::Png)
            .expect("write");
        let mut bytes = buf.into_inner();
        bytes[16..20].copy_from_slice(&9000u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&9000u32.to_be_bytes());
        // Fix up the IHDR CRC (covers the chunk type + 13 data bytes).
        let crc = crc32(&bytes[12..29]);
        bytes[29..33].copy_from_slice(&crc.to_be_bytes());
        assert_eq!(png_dimensions(&bytes), Some((9000, 9000)));
        let err = decode(&bytes).expect_err("must reject");
        assert_eq!(err.code(), "io_too_large", "{err}");
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc ^= u32::from(b);
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    #[test]
    fn garbage_and_unsupported_formats() {
        assert_eq!(
            decode(b"not an image").expect_err("x").code(),
            "io_unsupported_format"
        );
        assert_eq!(
            decode(b"8BPS\0\x01").expect_err("x").code(),
            "io_unsupported_format"
        );
        let opts = EncodeOptions::default();
        assert_eq!(
            encode(&[0; 4], 1, 1, ImageFormat::Gif, &opts)
                .expect_err("x")
                .code(),
            "io_unsupported_format"
        );
        assert_eq!(
            encode(&[0; 3], 1, 1, ImageFormat::Png, &opts)
                .expect_err("x")
                .code(),
            "io_invalid_buffer"
        );
    }

    #[test]
    fn encode_options_json_defaults() {
        let o: EncodeOptions = serde_json::from_str("{}").expect("defaults");
        assert_eq!(o, EncodeOptions::default());
        let o: EncodeOptions =
            serde_json::from_str(r#"{"quality":50,"pngCompression":"best","lossless":true}"#)
                .expect("parse");
        assert_eq!(o.quality, 50);
        assert_eq!(o.png_compression, PngCompression::Best);
        assert!(o.lossless);
    }

    /// PLAN.md budget: open a 12 MP JPEG in < 500 ms. Run with
    /// `cargo test -p pf-io --release -- --ignored --nocapture bench_decode_12mp_jpeg`.
    #[test]
    #[ignore]
    fn bench_decode_12mp_jpeg() {
        let (w, h) = (4000u32, 3000u32);
        let img = image::RgbaImage::from_fn(w, h, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, ((x ^ y) % 256) as u8, 255])
        });
        let opts = EncodeOptions {
            quality: 90,
            ..Default::default()
        };
        let jpeg = encode(img.as_raw(), w, h, ImageFormat::Jpeg, &opts).expect("encode");
        eprintln!("12 MP JPEG is {} bytes", jpeg.len());
        let mut best = std::time::Duration::MAX;
        for _ in 0..5 {
            let t = std::time::Instant::now();
            let dec = decode(&jpeg).expect("decode");
            let dt = t.elapsed();
            assert_eq!((dec.width, dec.height), (w, h));
            best = best.min(dt);
            eprintln!("decode 4000x3000 JPEG: {dt:?}");
        }
        eprintln!("best of 5: {best:?} (budget 500 ms)");
    }
}
