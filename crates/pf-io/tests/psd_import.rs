//! PSD import against a programmatically generated fixture.
//!
//! `psd_writer` below emits a minimal, spec-conformant 8-bit RGB PSD (raw channel data,
//! layer records with `lsct` group dividers). `tests/fixtures/layers.psd` is the bytes it
//! produces, checked in so the binary can be inspected with other tools; the
//! `fixture_file_matches_generator` test keeps the two in sync.

use pf_io::{open_bytes, psd, ImageFormat};

mod psd_writer {
    //! Tiny PSD writer, big-endian throughout. Only what the importer tests need.

    pub struct Layer {
        pub name: &'static str,
        pub top: i32,
        pub left: i32,
        pub w: u32,
        pub h: u32,
        /// `w*h*4` straight RGBA.
        pub rgba: Vec<u8>,
        pub blend: &'static [u8; 4],
        pub opacity: u8,
        pub hidden: bool,
        /// `lsct` section divider: 0 none, 1 open folder, 2 closed folder, 3 bounding.
        pub divider: i32,
    }

    impl Layer {
        pub fn divider(name: &'static str, divider: i32) -> Self {
            Layer {
                name,
                top: 0,
                left: 0,
                w: 0,
                h: 0,
                rgba: Vec::new(),
                blend: b"pass",
                opacity: 255,
                hidden: false,
                divider,
            }
        }
    }

    fn pascal_padded4(name: &str) -> Vec<u8> {
        let mut v = vec![name.len() as u8];
        v.extend_from_slice(name.as_bytes());
        while v.len() % 4 != 0 {
            v.push(0);
        }
        v
    }

    /// `layers` is bottom-to-top (file order).
    pub fn build(width: u32, height: u32, layers: &[Layer], composite_rgb: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"8BPS");
        out.extend_from_slice(&1u16.to_be_bytes());
        out.extend_from_slice(&[0; 6]);
        out.extend_from_slice(&3u16.to_be_bytes()); // channels
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&8u16.to_be_bytes()); // depth
        out.extend_from_slice(&3u16.to_be_bytes()); // RGB
        out.extend_from_slice(&0u32.to_be_bytes()); // colour mode data
        out.extend_from_slice(&0u32.to_be_bytes()); // image resources

        // Layer info.
        let mut info = Vec::new();
        info.extend_from_slice(&(layers.len() as i16).to_be_bytes());
        let mut channel_data = Vec::new();
        for l in layers {
            info.extend_from_slice(&l.top.to_be_bytes());
            info.extend_from_slice(&l.left.to_be_bytes());
            info.extend_from_slice(&(l.top + l.h as i32).to_be_bytes());
            info.extend_from_slice(&(l.left + l.w as i32).to_be_bytes());
            info.extend_from_slice(&4u16.to_be_bytes());
            let plane = (l.w * l.h) as usize;
            for id in [-1i16, 0, 1, 2] {
                info.extend_from_slice(&id.to_be_bytes());
                info.extend_from_slice(&((plane + 2) as u32).to_be_bytes());
                channel_data.extend_from_slice(&0u16.to_be_bytes()); // raw
                let offset = match id {
                    -1 => 3,
                    c => c as usize,
                };
                channel_data.extend(l.rgba.chunks_exact(4).map(|px| px[offset]));
            }
            info.extend_from_slice(b"8BIM");
            info.extend_from_slice(l.blend);
            info.push(l.opacity);
            info.push(0); // clipping
            info.push(if l.hidden { 2 } else { 0 } | 8);
            info.push(0); // filler
            let name = pascal_padded4(l.name);
            let mut extra = Vec::new();
            extra.extend_from_slice(&0u32.to_be_bytes()); // mask data
            extra.extend_from_slice(&0u32.to_be_bytes()); // blending ranges
            extra.extend_from_slice(&name);
            if l.divider != 0 {
                extra.extend_from_slice(b"8BIM");
                extra.extend_from_slice(b"lsct");
                extra.extend_from_slice(&4u32.to_be_bytes());
                extra.extend_from_slice(&l.divider.to_be_bytes());
            }
            info.extend_from_slice(&(extra.len() as u32).to_be_bytes());
            info.extend_from_slice(&extra);
        }
        info.extend_from_slice(&channel_data);

        let mut lm = Vec::new();
        lm.extend_from_slice(&(info.len() as u32).to_be_bytes());
        lm.extend_from_slice(&info);
        lm.extend_from_slice(&0u32.to_be_bytes()); // global layer mask info
        out.extend_from_slice(&(lm.len() as u32).to_be_bytes());
        out.extend_from_slice(&lm);

        // Composite image data: raw, planar R G B.
        out.extend_from_slice(&0u16.to_be_bytes());
        for c in 0..3 {
            out.extend(composite_rgb.chunks_exact(3).map(|px| px[c]));
        }
        out
    }
}

fn solid(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
    rgba.repeat((w * h) as usize)
}

/// 8x6 canvas: Background, a group with two layers (one hidden), and a top layer that
/// hangs off the top-left corner.
fn fixture_bytes() -> Vec<u8> {
    use psd_writer::Layer;
    let (w, h) = (8u32, 6u32);
    let mut bg = Vec::new();
    for y in 0..h {
        for x in 0..w {
            bg.extend_from_slice(&[(x * 30) as u8, (y * 40) as u8, 128, 255]);
        }
    }
    let layers = vec![
        Layer {
            name: "Background",
            top: 0,
            left: 0,
            w,
            h,
            rgba: bg,
            blend: b"norm",
            opacity: 255,
            hidden: false,
            divider: 0,
        },
        Layer::divider("</Layer group>", 3),
        Layer {
            name: "Blue box",
            top: 1,
            left: 2,
            w: 3,
            h: 2,
            rgba: solid(3, 2, [0, 0, 255, 255]),
            blend: b"mul ",
            opacity: 128,
            hidden: false,
            divider: 0,
        },
        Layer {
            name: "Hidden",
            top: 3,
            left: 5,
            w: 2,
            h: 2,
            rgba: solid(2, 2, [0, 255, 0, 200]),
            blend: b"scrn",
            opacity: 255,
            hidden: true,
            divider: 0,
        },
        Layer {
            name: "Group 1",
            top: 0,
            left: 0,
            w: 0,
            h: 0,
            rgba: Vec::new(),
            blend: b"pass",
            opacity: 255,
            hidden: false,
            divider: 1,
        },
        Layer {
            name: "Top",
            top: -1,
            left: -1,
            w: 4,
            h: 4,
            rgba: solid(4, 4, [255, 255, 0, 255]),
            blend: b"diff",
            opacity: 255,
            hidden: false,
            divider: 0,
        },
    ];
    let composite: Vec<u8> = (0..w * h).flat_map(|_| [10u8, 20, 30]).collect();
    psd_writer::build(w, h, &layers, &composite)
}

fn flat_fixture_bytes() -> Vec<u8> {
    // No layer section at all: a flattened file.
    let composite: Vec<u8> = (0..4u32 * 3).flat_map(|i| [i as u8 * 20, 7, 9]).collect();
    psd_writer::build(4, 3, &[], &composite)
}

#[test]
fn fixture_file_matches_generator() {
    let on_disk = include_bytes!("fixtures/layers.psd");
    assert_eq!(
        on_disk.as_slice(),
        fixture_bytes().as_slice(),
        "regenerate with `cargo test -p pf-io -- --ignored write_fixture`"
    );
    assert!(on_disk.len() < 200 * 1024);
}

#[test]
#[ignore]
fn write_fixture() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/layers.psd");
    std::fs::write(path, fixture_bytes()).expect("write fixture");
    let flat = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/flat.psd");
    std::fs::write(flat, flat_fixture_bytes()).expect("write flat fixture");
}

#[test]
fn imports_layers_groups_offsets_and_blend_modes() {
    let doc = psd::import_psd(include_bytes!("fixtures/layers.psd")).expect("import");
    assert_eq!((doc.width, doc.height), (8, 6));
    assert_eq!(doc.source_format, ImageFormat::Psd);

    let names: Vec<&str> = doc.layers.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(
        names,
        ["Background", "Blue box", "Hidden", "Group 1", "Top"]
    );

    let bg = &doc.layers[0];
    assert_eq!((bg.x, bg.y, bg.w, bg.h), (0, 0, 8, 6));
    assert_eq!(bg.blend_mode, "normal");
    assert!(bg.visible && !bg.is_group && bg.group.is_none());
    assert_eq!(bg.group_depth, 0);
    assert_eq!(bg.rgba.len(), 8 * 6 * 4);
    assert_eq!(&bg.rgba[(8 + 2) * 4..(8 + 2) * 4 + 4], &[60, 40, 128, 255]);

    let blue = &doc.layers[1];
    assert_eq!((blue.x, blue.y, blue.w, blue.h), (2, 1, 3, 2));
    assert_eq!(blue.blend_mode, "multiply");
    assert!((blue.opacity - 128.0 / 255.0).abs() < 1e-6);
    assert!(blue.visible);
    assert_eq!(blue.group, Some(3));
    assert_eq!(blue.group_depth, 1);
    assert_eq!(blue.rgba, solid(3, 2, [0, 0, 255, 255]));

    let hidden = &doc.layers[2];
    assert!(!hidden.visible, "flag bit 1 means hidden");
    assert_eq!(hidden.blend_mode, "screen");
    assert_eq!((hidden.x, hidden.y, hidden.w, hidden.h), (5, 3, 2, 2));
    assert_eq!(hidden.rgba[3], 200);
    assert_eq!(hidden.group, Some(3));

    let group = &doc.layers[3];
    assert!(group.is_group);
    assert_eq!(group.name, "Group 1");
    assert_eq!(group.group_depth, 0);
    assert!(group.rgba.is_empty() && group.w == 0);

    let top = &doc.layers[4];
    assert_eq!(top.blend_mode, "difference");
    assert_eq!(top.group, None);
    assert_eq!(top.group_depth, 0);
    // Hangs off the canvas at (-1,-1): clipped to the visible 3x3.
    assert_eq!((top.x, top.y, top.w, top.h), (0, 0, 3, 3));
    assert_eq!(top.rgba, solid(3, 3, [255, 255, 0, 255]));
}

#[test]
fn flattened_psd_imports_composite_as_background() {
    let bytes = flat_fixture_bytes();
    assert_eq!(
        bytes.as_slice(),
        include_bytes!("fixtures/flat.psd").as_slice()
    );
    let doc = open_bytes(&bytes, Some("psd")).expect("import");
    assert_eq!((doc.width, doc.height), (4, 3));
    assert_eq!(doc.layers.len(), 1);
    let l = &doc.layers[0];
    assert_eq!(l.name, "Background");
    assert_eq!((l.x, l.y, l.w, l.h), (0, 0, 4, 3));
    assert_eq!(&l.rgba[..8], &[0, 7, 9, 255, 20, 7, 9, 255]);
}

#[test]
fn open_bytes_dispatches_psd() {
    let doc = open_bytes(include_bytes!("fixtures/layers.psd"), None).expect("open");
    assert_eq!(doc.layers.len(), 5);
}

#[test]
fn truncated_psd_is_an_error_not_a_panic() {
    let bytes = fixture_bytes();
    for cut in [10, 40, 100, bytes.len() / 2] {
        let err = psd::import_psd(&bytes[..cut]).expect_err("truncated");
        assert_eq!(err.code(), "io_psd");
    }
}
