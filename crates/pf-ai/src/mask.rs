//! Mask normalisation helpers for OpenAI (`to_openai_mask`), Stable Diffusion WebUI /
//! ComfyUI / Replicate (`to_a1111_mask`).
//!
//! Pixelforge masks are 8-bit luma PNGs (any PNG is accepted and converted to luma):
//! **white (255) = editable, black (0) = keep**, soft values blend. Providers without a
//! native mask endpoint (xAI, Gemini) use webview-side crop-and-instruct emulation in
//! `app/src/lib/ai/modes.ts`.

use std::io::Cursor;

use image::{imageops, DynamicImage, RgbaImage};

use crate::error::Error;

fn decode(bytes: &[u8], what: &str) -> Result<DynamicImage, Error> {
    image::load_from_memory(bytes).map_err(|e| Error::Image(format!("cannot decode {what}: {e}")))
}

fn encode_png(img: &DynamicImage) -> Result<Vec<u8>, Error> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png)?;
    Ok(out.into_inner())
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
    use image::GenericImageView;

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
}
