mod common;

use common::*;
use pf_ai::{to_a1111_mask, to_openai_mask};

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

#[test]
fn a1111_mask_normalizes_and_resamples() {
    let mask = mask_png(16, 16, (4, 4, 8, 8), 255);
    let out = to_a1111_mask(&mask, 32, 32).expect("mask");
    assert_eq!(decode_dims(&out), (32, 32));
    assert!(to_a1111_mask(&mask, 0, 16).is_err());
}
