mod common;

use common::*;
use pf_ai::{composite_back, crop_to_mask_bbox, to_openai_mask, Rect};

fn pixel(png: &[u8], x: u32, y: u32) -> [u8; 4] {
    let img = image::load_from_memory(png).expect("decode").to_rgba8();
    img.get_pixel(x, y).0
}

#[test]
fn crop_to_mask_bbox_pads_and_clamps() {
    let base = png(64, 64, [255, 0, 0, 255]);
    let mask = mask_png(64, 64, (10, 10, 20, 20), 255);
    let (crop, rect) = crop_to_mask_bbox(&base, &mask, 4).expect("crop");
    assert_eq!(rect, Rect::new(6, 6, 28, 28));
    assert_eq!(decode_dims(&crop), (28, 28));
    assert_eq!(pixel(&crop, 0, 0), [255, 0, 0, 255]);

    // Mask touching the edge: padding is clamped to the image.
    let mask = mask_png(64, 64, (0, 0, 8, 8), 128);
    let (crop, rect) = crop_to_mask_bbox(&base, &mask, 10).expect("crop");
    assert_eq!(rect, Rect::new(0, 0, 18, 18));
    assert_eq!(decode_dims(&crop), (18, 18));

    // Zero padding = exact bbox.
    let mask = mask_png(64, 64, (30, 40, 3, 2), 255);
    let (_, rect) = crop_to_mask_bbox(&base, &mask, 0).expect("crop");
    assert_eq!(rect, Rect::new(30, 40, 3, 2));
}

#[test]
fn crop_rejects_empty_or_mismatched_mask() {
    let base = png(16, 16, [0, 0, 0, 255]);
    let empty = mask_png(16, 16, (0, 0, 0, 0), 255);
    let err = crop_to_mask_bbox(&base, &empty, 2).expect_err("empty mask");
    assert!(err.to_string().contains("no pixels"));
    let wrong = mask_png(8, 8, (0, 0, 4, 4), 255);
    let err = crop_to_mask_bbox(&base, &wrong, 2).expect_err("dims");
    assert!(err.to_string().contains("8x8"));
    assert!(crop_to_mask_bbox(b"not a png", &wrong, 0).is_err());
}

#[test]
fn composite_back_blends_only_inside_soft_mask() {
    let base = png(64, 64, [255, 0, 0, 255]);
    let rect = Rect::new(6, 6, 28, 28);
    let patch = png(28, 28, [0, 0, 255, 255]);
    // Hard mask over (10,10,20,20) plus a half-strength column at x = 8.
    let mut mask = image::GrayImage::new(64, 64);
    for y in 10..30 {
        for x in 10..30 {
            mask.put_pixel(x, y, image::Luma([255]));
        }
        mask.put_pixel(8, y, image::Luma([128]));
    }
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(mask)
        .write_to(&mut buf, image::ImageFormat::Png)
        .expect("encode");
    let mask = buf.into_inner();

    let out = composite_back(&base, &patch, rect, &mask).expect("composite");
    assert_eq!(decode_dims(&out), (64, 64));
    assert_eq!(pixel(&out, 15, 15), [0, 0, 255, 255], "inside: patch wins");
    assert_eq!(pixel(&out, 2, 2), [255, 0, 0, 255], "outside rect: base");
    assert_eq!(
        pixel(&out, 7, 7),
        [255, 0, 0, 255],
        "inside rect, mask 0: base"
    );
    let half = pixel(&out, 8, 15);
    assert!(
        (half[0] as i32 - 127).abs() <= 2 && (half[2] as i32 - 128).abs() <= 2,
        "{half:?}"
    );
    assert_eq!(half[3], 255);
}

#[test]
fn composite_back_accepts_patch_local_mask_and_resizes_patch() {
    let base = png(32, 32, [0, 255, 0, 255]);
    let rect = Rect::new(4, 4, 10, 10);
    // Provider returned the patch at a different size: it gets resampled to the rect.
    let patch = png(40, 40, [0, 0, 0, 255]);
    let local_mask = mask_png(10, 10, (0, 0, 5, 10), 255); // left half only
    let out = composite_back(&base, &patch, rect, &local_mask).expect("composite");
    assert_eq!(pixel(&out, 5, 8), [0, 0, 0, 255]);
    assert_eq!(pixel(&out, 12, 8), [0, 255, 0, 255]);

    let bad_mask = mask_png(7, 7, (0, 0, 1, 1), 255);
    assert!(composite_back(&base, &patch, rect, &bad_mask).is_err());
    let bad_rect = Rect::new(30, 30, 10, 10);
    assert!(composite_back(&base, &patch, bad_rect, &local_mask).is_err());
}

#[test]
fn openai_mask_inverts_luma_into_alpha() {
    let mask = mask_png(16, 16, (4, 4, 8, 8), 255);
    let out = to_openai_mask(&mask, 16, 16).expect("mask");
    assert_eq!(decode_dims(&out), (16, 16));
    let img = image::load_from_memory(&out).expect("decode");
    assert!(img.color().has_alpha(), "OpenAI requires an alpha channel");
    let rgba = img.to_rgba8();
    assert_eq!(rgba.get_pixel(8, 8).0[3], 0, "selected = transparent");
    assert_eq!(rgba.get_pixel(0, 0).0[3], 255, "unselected = opaque");

    let soft = mask_png(16, 16, (0, 0, 16, 16), 100);
    let out = to_openai_mask(&soft, 16, 16).expect("mask");
    assert_eq!(
        image::load_from_memory(&out)
            .expect("d")
            .to_rgba8()
            .get_pixel(1, 1)
            .0[3],
        155
    );

    assert!(to_openai_mask(&mask, 32, 32).is_err());
}
