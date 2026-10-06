//! Thumbnails: box-filter downscale of straight-alpha RGBA8, encoded as PNG.

use crate::{check_buffer, codec, Error, Result};

/// Downscale so that the longer edge is at most `max_px`, averaging source pixels in
/// premultiplied space (so transparent pixels do not bleed their colour into the result).
///
/// Returns `(rgba, width, height)`. Images already within the limit are returned as-is.
pub fn downscale_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    max_px: u32,
) -> Result<(Vec<u8>, u32, u32)> {
    check_buffer(rgba, width, height, 4)?;
    if max_px == 0 {
        return Err(Error::InvalidBuffer("max_px must be > 0".to_owned()));
    }
    if width <= max_px && height <= max_px {
        return Ok((rgba.to_vec(), width, height));
    }
    let scale = f64::from(max_px) / f64::from(width.max(height));
    let dw = ((f64::from(width) * scale).round() as u32).max(1);
    let dh = ((f64::from(height) * scale).round() as u32).max(1);

    let sw = width as usize;
    let mut out = Vec::with_capacity((dw * dh * 4) as usize);
    for dy in 0..dh as usize {
        let y0 = dy * height as usize / dh as usize;
        let y1 = ((dy + 1) * height as usize / dh as usize).max(y0 + 1);
        for dx in 0..dw as usize {
            let x0 = dx * sw / dw as usize;
            let x1 = ((dx + 1) * sw / dw as usize).max(x0 + 1);
            let (mut r, mut g, mut b, mut a) = (0u64, 0u64, 0u64, 0u64);
            for y in y0..y1 {
                let row = &rgba[y * sw * 4..(y + 1) * sw * 4];
                for px in row[x0 * 4..x1 * 4].chunks_exact(4) {
                    let pa = u64::from(px[3]);
                    r += u64::from(px[0]) * pa;
                    g += u64::from(px[1]) * pa;
                    b += u64::from(px[2]) * pa;
                    a += pa;
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u64;
            // Un-premultiply: channel sum / alpha sum; alpha = alpha sum / count.
            // A fully transparent box has no colour to recover.
            let unpremul = |c: u64| (c + a / 2).checked_div(a).unwrap_or(0) as u8;
            out.push(unpremul(r));
            out.push(unpremul(g));
            out.push(unpremul(b));
            out.push(((a + n / 2) / n) as u8);
        }
    }
    Ok((out, dw, dh))
}

/// Make a PNG thumbnail whose longer edge is at most `max_px`.
pub fn make_thumbnail(rgba: &[u8], width: u32, height: u32, max_px: u32) -> Result<Vec<u8>> {
    let (small, w, h) = downscale_rgba(rgba, width, height, max_px)?;
    let mut out = Vec::new();
    codec::write_png(
        &mut out,
        &small,
        w,
        h,
        image::ExtendedColorType::Rgba8,
        codec::PngCompression::Fast,
    )?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnail_fits_max_edge_and_keeps_aspect() {
        let (w, h) = (1000u32, 400u32);
        let rgba = vec![200u8; (w * h * 4) as usize];
        let png = make_thumbnail(&rgba, w, h, 256).expect("thumb");
        assert_eq!(codec::png_dimensions(&png), Some((256, 102)));
        let dec = codec::decode(&png).expect("decode");
        assert_eq!(dec.rgba[..4], [200, 200, 200, 200]);

        // Portrait.
        let (w, h) = (30u32, 90u32);
        let rgba = vec![0u8; (w * h * 4) as usize];
        let png = make_thumbnail(&rgba, w, h, 45).expect("thumb");
        assert_eq!(codec::png_dimensions(&png), Some((15, 45)));
    }

    #[test]
    fn small_images_pass_through() {
        let rgba = vec![1u8; 2 * 3 * 4];
        let (out, w, h) = downscale_rgba(&rgba, 2, 3, 256).expect("ok");
        assert_eq!((w, h), (2, 3));
        assert_eq!(out, rgba);
    }

    #[test]
    fn box_filter_averages_in_premultiplied_space() {
        // 2x2 -> 1x1: one opaque red pixel + three fully transparent green pixels.
        // Premultiplied averaging must give red (not a muddy red/green mix) at alpha 64.
        let rgba = [
            255, 0, 0, 255, //
            0, 255, 0, 0, //
            0, 255, 0, 0, //
            0, 255, 0, 0,
        ];
        let (out, w, h) = downscale_rgba(&rgba, 2, 2, 1).expect("ok");
        assert_eq!((w, h), (1, 1));
        assert_eq!(out, vec![255, 0, 0, 64]);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(make_thumbnail(&[0; 3], 1, 1, 10).is_err());
        assert!(make_thumbnail(&[0; 4], 1, 1, 0).is_err());
    }
}
