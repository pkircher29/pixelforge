//! Mask helpers for providers without a native mask endpoint (xAI, Gemini) and for
//! normalising Pixelforge's mask to OpenAI's convention.
//!
//! Pixelforge masks are 8-bit luma PNGs (any PNG is accepted and converted to luma):
//! **white (255) = editable, black (0) = keep**, soft values blend. The emulation
//! pipeline is: [`crop_to_mask_bbox`] -> provider instruct-edit on the crop ->
//! [`composite_back`] under the soft mask. The webview normally does this itself with
//! typed arrays; these helpers exist so either side can.

use std::io::Cursor;

use image::{imageops, DynamicImage, GenericImageView, GrayImage, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::error::Error;

/// Axis-aligned rectangle in image pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Rect {
    /// Left edge.
    pub x: u32,
    /// Top edge.
    pub y: u32,
    /// Width in pixels (> 0).
    pub width: u32,
    /// Height in pixels (> 0).
    pub height: u32,
}

impl Rect {
    /// Construct a rect.
    pub const fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// Exclusive right edge.
    pub fn right(&self) -> u32 {
        self.x + self.width
    }

    /// Exclusive bottom edge.
    pub fn bottom(&self) -> u32 {
        self.y + self.height
    }

    /// Grow by `padding` on every side, clamped to `0..bounds`.
    pub fn padded(&self, padding: u32, bounds_w: u32, bounds_h: u32) -> Rect {
        let x0 = self.x.saturating_sub(padding);
        let y0 = self.y.saturating_sub(padding);
        let x1 = self.right().saturating_add(padding).min(bounds_w);
        let y1 = self.bottom().saturating_add(padding).min(bounds_h);
        Rect::new(x0, y0, x1.saturating_sub(x0), y1.saturating_sub(y0))
    }
}

fn decode(bytes: &[u8], what: &str) -> Result<DynamicImage, Error> {
    image::load_from_memory(bytes).map_err(|e| Error::Image(format!("cannot decode {what}: {e}")))
}

fn encode_png(img: &DynamicImage) -> Result<Vec<u8>, Error> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png)?;
    Ok(out.into_inner())
}

/// Bounding box of all mask pixels with luma > 0, or `None` for an empty mask.
pub fn mask_bbox(mask: &GrayImage) -> Option<Rect> {
    let (w, h) = mask.dimensions();
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    let mut any = false;
    for (x, y, p) in mask.enumerate_pixels() {
        if p.0[0] > 0 {
            any = true;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    any.then(|| Rect::new(x0, y0, x1 - x0 + 1, y1 - y0 + 1))
}

/// Crop `image_png` to the mask's bounding box grown by `padding` (clamped to the image).
///
/// Returns the crop as PNG plus the rect it came from (in image coordinates), which is
/// what [`composite_back`] needs. The mask must have the same dimensions as the image.
pub fn crop_to_mask_bbox(
    image_png: &[u8],
    mask_png: &[u8],
    padding: u32,
) -> Result<(Vec<u8>, Rect), Error> {
    let img = decode(image_png, "image")?;
    let mask = decode(mask_png, "mask")?.to_luma8();
    if mask.dimensions() != img.dimensions() {
        return Err(Error::InvalidRequest(format!(
            "mask is {}x{} but image is {}x{}",
            mask.width(),
            mask.height(),
            img.width(),
            img.height()
        )));
    }
    let bbox = mask_bbox(&mask)
        .ok_or_else(|| Error::InvalidRequest("mask selects no pixels".to_owned()))?;
    let rect = bbox.padded(padding, img.width(), img.height());
    let crop = img.view(rect.x, rect.y, rect.width, rect.height).to_image();
    let png = encode_png(&DynamicImage::ImageRgba8(crop))?;
    Ok((png, rect))
}

/// Paste `patch_png` over `base_png` at `rect`, blending only where `soft_mask_png` is
/// non-zero (`out = base * (1 - m) + patch * m`, straight alpha, per channel).
///
/// `soft_mask_png` may be either full-size (same dimensions as the base, the mask that
/// was passed to [`crop_to_mask_bbox`]) or patch-local (same dimensions as `rect`). If
/// the provider returned the patch at a different size it is resampled to `rect`.
pub fn composite_back(
    base_png: &[u8],
    patch_png: &[u8],
    rect: Rect,
    soft_mask_png: &[u8],
) -> Result<Vec<u8>, Error> {
    let mut base = decode(base_png, "base image")?.to_rgba8();
    let (bw, bh) = base.dimensions();
    if rect.width == 0 || rect.height == 0 || rect.right() > bw || rect.bottom() > bh {
        return Err(Error::InvalidRequest(format!(
            "rect {rect:?} does not fit inside the {bw}x{bh} base image"
        )));
    }
    let patch = decode(patch_png, "patch")?.to_rgba8();
    let patch: RgbaImage = if patch.dimensions() == (rect.width, rect.height) {
        patch
    } else {
        imageops::resize(
            &patch,
            rect.width,
            rect.height,
            imageops::FilterType::Lanczos3,
        )
    };
    let mask = decode(soft_mask_png, "soft mask")?.to_luma8();
    let mask_is_local = if mask.dimensions() == (bw, bh) {
        false
    } else if mask.dimensions() == (rect.width, rect.height) {
        true
    } else {
        return Err(Error::InvalidRequest(format!(
            "soft mask is {}x{}; expected {bw}x{bh} (full) or {}x{} (patch-local)",
            mask.width(),
            mask.height(),
            rect.width,
            rect.height
        )));
    };

    for py in 0..rect.height {
        for px in 0..rect.width {
            let (bx, by) = (rect.x + px, rect.y + py);
            let m = if mask_is_local {
                mask.get_pixel(px, py).0[0]
            } else {
                mask.get_pixel(bx, by).0[0]
            };
            if m == 0 {
                continue;
            }
            let p = patch.get_pixel(px, py).0;
            let b = base.get_pixel_mut(bx, by);
            if m == 255 {
                b.0 = p;
                continue;
            }
            let t = f32::from(m) / 255.0;
            for (dst, src) in b.0.iter_mut().zip(p.iter()) {
                let v = f32::from(*dst) * (1.0 - t) + f32::from(*src) * t;
                *dst = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    encode_png(&DynamicImage::ImageRgba8(base))
}

/// Convert a Pixelforge mask (white = editable) into OpenAI's RGBA mask PNG at exactly
/// `width`x`height`, where **alpha = 0 marks the editable area** and opaque pixels are
/// kept. Fails if the mask dimensions differ from the image's.
pub fn to_openai_mask(mask_png: &[u8], width: u32, height: u32) -> Result<Vec<u8>, Error> {
    let mask = decode(mask_png, "mask")?.to_luma8();
    if mask.dimensions() != (width, height) {
        return Err(Error::InvalidRequest(format!(
            "mask is {}x{} but the image is {width}x{height}; OpenAI requires identical dimensions",
            mask.width(),
            mask.height()
        )));
    }
    let mut out = RgbaImage::new(width, height);
    for (x, y, p) in mask.enumerate_pixels() {
        let alpha = 255 - p.0[0];
        out.put_pixel(x, y, image::Rgba([0, 0, 0, alpha]));
    }
    encode_png(&DynamicImage::ImageRgba8(out))
}

/// Normalise a Pixelforge mask (any PNG, white = editable) into the 8-bit grey PNG that
/// Stable Diffusion WebUI's `img2img.mask` (with `inpainting_mask_invert = 0`), ComfyUI's
/// `LoadImage` -> `ImageToMask(red)` and Replicate inpainting models expect: **white =
/// repaint**, same polarity, exactly `width`x`height`. A mask of another size is
/// resampled (nearest) rather than rejected, since those servers resize internally
/// anyway and a 1 px rounding difference from the webview should not fail the job.
pub fn to_a1111_mask(mask_png: &[u8], width: u32, height: u32) -> Result<Vec<u8>, Error> {
    if width == 0 || height == 0 {
        return Err(Error::InvalidRequest(
            "mask target size has a zero edge".to_owned(),
        ));
    }
    let mut mask = decode(mask_png, "mask")?.to_luma8();
    if mask.dimensions() != (width, height) {
        mask = imageops::resize(&mask, width, height, imageops::FilterType::Nearest);
    }
    encode_png(&DynamicImage::ImageLuma8(mask))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a1111_mask_keeps_polarity_and_size() {
        let mut src = RgbaImage::new(4, 2);
        src.put_pixel(1, 0, image::Rgba([255, 255, 255, 255]));
        src.put_pixel(2, 1, image::Rgba([128, 128, 128, 255]));
        let png = encode_png(&DynamicImage::ImageRgba8(src)).expect("png");
        let out = to_a1111_mask(&png, 4, 2).expect("mask");
        let back = image::load_from_memory(&out).expect("decode");
        assert_eq!(back.color(), image::ColorType::L8);
        let g = back.to_luma8();
        assert_eq!(g.get_pixel(1, 0).0[0], 255);
        assert_eq!(g.get_pixel(0, 0).0[0], 0);
        assert!(g.get_pixel(2, 1).0[0] > 100);
        // Resampled to the target size instead of rejected.
        let out = to_a1111_mask(&png, 8, 4).expect("mask");
        assert_eq!(
            image::load_from_memory(&out).expect("decode").dimensions(),
            (8, 4)
        );
        assert!(to_a1111_mask(&png, 0, 4).is_err());
    }

    #[test]
    fn rect_padding_clamps() {
        let r = Rect::new(10, 10, 5, 5);
        assert_eq!(r.padded(4, 100, 100), Rect::new(6, 6, 13, 13));
        assert_eq!(r.padded(20, 20, 12), Rect::new(0, 0, 20, 12));
        assert_eq!(r.right(), 15);
        assert_eq!(r.bottom(), 15);
    }

    #[test]
    fn bbox_of_empty_mask_is_none() {
        let mask = GrayImage::new(4, 4);
        assert_eq!(mask_bbox(&mask), None);
        let mut mask = GrayImage::new(4, 4);
        mask.put_pixel(2, 1, image::Luma([1]));
        assert_eq!(mask_bbox(&mask), Some(Rect::new(2, 1, 1, 1)));
    }
}
