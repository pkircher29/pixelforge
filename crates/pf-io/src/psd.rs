//! Read-only PSD import via the `psd` crate.
//!
//! Output is an [`ImportedDocument`]: a flat, bottom-to-top list of layers where every
//! group is one entry (`is_group`) placed directly above its children. PSD groups nested
//! deeper than one level are flattened into their top-level ancestor (PLAN.md v1 rule:
//! "no nested groups beyond 1 level"). A PSD with no layer section (flattened file)
//! yields its composite as one `Background` layer.
//!
//! Known limits of the underlying parser (all surfaced as [`Error::Psd`], never panics):
//! 8-bit RGB / grayscale only, no ZIP-compressed channels, no PSB.

use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};

use ::psd::{Psd, PsdGroup, PsdLayer};

use crate::open::{ImportedDocument, ImportedLayer};
use crate::{check_dimensions, Error, ImageFormat, Result};

/// Pixelforge's 16 blend modes, by the names used in `.pfproj` manifests and IPC.
pub const BLEND_MODES: [&str; 16] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color_dodge",
    "color_burn",
    "hard_light",
    "soft_light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
];

/// Map a PSD blend mode (by the `psd` crate's enum variant name, e.g. `"ColorDodge"`;
/// the crate does not export the enum itself) onto one of [`BLEND_MODES`]. Modes
/// Pixelforge does not have (linear burn, vivid light, hard mix, ...) become `normal`,
/// except the per-colour darken / lighten variants which map to their per-channel cousins.
pub fn map_blend_mode(psd_variant: &str) -> &'static str {
    match psd_variant {
        "Multiply" => "multiply",
        "Screen" => "screen",
        "Overlay" => "overlay",
        "Darken" | "DarkerColor" => "darken",
        "Lighten" | "LighterColor" => "lighten",
        "ColorDodge" => "color_dodge",
        "ColorBurn" => "color_burn",
        "HardLight" => "hard_light",
        "SoftLight" => "soft_light",
        "Difference" => "difference",
        "Exclusion" => "exclusion",
        "Hue" => "hue",
        "Saturation" => "saturation",
        "Color" => "color",
        "Luminosity" => "luminosity",
        // PassThrough, Normal, Dissolve, LinearBurn, LinearDodge, VividLight, LinearLight,
        // PinLight, HardMix, Subtract, Divide and anything unknown.
        _ => "normal",
    }
}

fn blend_name<T: std::fmt::Debug>(mode: T) -> String {
    format!("{mode:?}")
}

/// Import a PSD. See the module docs for the output shape.
pub fn import_psd(bytes: &[u8]) -> Result<ImportedDocument> {
    // The `psd` crate panics on some inputs (ZIP-compressed channels, raw layers that
    // extend past the canvas). Never let that take the command thread down.
    let parsed = catch_unwind(AssertUnwindSafe(|| Psd::from_bytes(bytes))).map_err(|_| {
        Error::Psd("the PSD parser could not handle this file (unsupported feature)".to_owned())
    })?;
    let psd = parsed.map_err(|e| Error::Psd(e.to_string()))?;
    check_dimensions(psd.width(), psd.height())?;
    catch_unwind(AssertUnwindSafe(|| build(&psd))).map_err(|_| {
        Error::Psd(
            "the PSD parser could not decode this file's layers (unsupported feature)".to_owned(),
        )
    })?
}

fn build(psd: &Psd) -> Result<ImportedDocument> {
    let (pw, ph) = (psd.width(), psd.height());
    let expected = (pw as usize) * (ph as usize) * 4;

    if psd.layers().is_empty() {
        let rgba = psd.rgba();
        if rgba.len() != expected {
            return Err(Error::Psd(format!(
                "composite is {} bytes, expected {expected}",
                rgba.len()
            )));
        }
        return Ok(ImportedDocument {
            width: pw,
            height: ph,
            layers: vec![ImportedLayer::background("Background", rgba, pw, ph)],
            source_format: ImageFormat::Psd,
        });
    }

    let groups = psd.groups();
    // `psd.layers()` is top-to-bottom. Walk it, emitting a group entry right before
    // the first layer of each top-level group, then reverse to bottom-to-top.
    let mut top_down: Vec<(ImportedLayer, Option<u32>)> = Vec::with_capacity(psd.layers().len());
    let mut emitted: HashSet<u32> = HashSet::new();
    for layer in psd.layers() {
        let root = layer.parent_id().and_then(|g| root_group(groups, g));
        if let Some(gid) = root {
            if emitted.insert(gid) {
                if let Some(group) = groups.get(&gid) {
                    top_down.push((group_entry(group), Some(gid)));
                }
            }
        }
        let mut entry = layer_entry(layer, pw, ph)?;
        entry.group_depth = u8::from(root.is_some());
        top_down.push((entry, root));
    }

    top_down.reverse();
    let group_index: HashMap<u32, usize> = top_down
        .iter()
        .enumerate()
        .filter(|(_, (l, _))| l.is_group)
        .filter_map(|(i, (_, gid))| gid.map(|g| (g, i)))
        .collect();
    let layers = top_down
        .into_iter()
        .map(|(mut l, gid)| {
            if !l.is_group {
                l.group = gid.and_then(|g| group_index.get(&g).copied());
                if l.group.is_none() {
                    l.group_depth = 0;
                }
            }
            l
        })
        .collect();

    Ok(ImportedDocument {
        width: pw,
        height: ph,
        layers,
        source_format: ImageFormat::Psd,
    })
}

/// Follow `parent_id` links up to the top-level group (depth 1). Returns `None` if the
/// chain is broken (unknown id) so the layer is treated as top-level.
fn root_group(groups: &HashMap<u32, PsdGroup>, mut id: u32) -> Option<u32> {
    for _ in 0..64 {
        let g = groups.get(&id)?;
        match g.parent_id() {
            Some(parent) => id = parent,
            None => return Some(id),
        }
    }
    None
}

/// Photoshop writes layer-record flag bit 1 for *hidden* layers; the `psd` crate (0.3.5)
/// reads that bit straight into `visible()`, so it is inverted here. Pinned in Cargo.toml.
fn psd_visible(flag_from_crate: bool) -> bool {
    !flag_from_crate
}

fn group_entry(group: &PsdGroup) -> ImportedLayer {
    ImportedLayer {
        name: group.name().to_owned(),
        rgba: Vec::new(),
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        opacity: f32::from(group.opacity()) / 255.0,
        visible: psd_visible(group.visible()),
        blend_mode: map_blend_mode(&blend_name(group.blend_mode())).to_owned(),
        is_group: true,
        group_depth: 0,
        group: None,
    }
}

fn layer_entry(layer: &PsdLayer, pw: u32, ph: u32) -> Result<ImportedLayer> {
    let (rgba, x, y, w, h) = crop_layer(layer, pw, ph)?;
    Ok(ImportedLayer {
        name: layer.name().to_owned(),
        rgba,
        x,
        y,
        w,
        h,
        opacity: f32::from(layer.opacity()) / 255.0,
        visible: psd_visible(layer.visible()),
        blend_mode: map_blend_mode(&blend_name(layer.blend_mode())).to_owned(),
        is_group: false,
        group_depth: 0,
        group: None,
    })
}

/// The `psd` crate hands back every layer as a full-canvas RGBA buffer; cut out the
/// layer's own rectangle (clipped to the canvas). Empty layers become 1x1 transparent.
fn crop_layer(layer: &PsdLayer, pw: u32, ph: u32) -> Result<(Vec<u8>, i32, i32, u32, u32)> {
    let full = layer.rgba();
    let expected = (pw as usize) * (ph as usize) * 4;
    if full.len() != expected {
        return Err(Error::Psd(format!(
            "layer '{}' decoded to {} bytes, expected {expected}",
            layer.name(),
            full.len()
        )));
    }
    // The crate stores bottom/right inclusive (it subtracts one when non-zero).
    let x0 = layer.layer_left().max(0);
    let y0 = layer.layer_top().max(0);
    let x1 = layer.layer_right().saturating_add(1).min(pw as i32);
    let y1 = layer.layer_bottom().saturating_add(1).min(ph as i32);
    if x1 <= x0 || y1 <= y0 {
        return Ok((vec![0, 0, 0, 0], 0, 0, 1, 1));
    }
    let (w, h) = ((x1 - x0) as u32, (y1 - y0) as u32);
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    let stride = pw as usize * 4;
    for y in y0..y1 {
        let row = y as usize * stride;
        out.extend_from_slice(&full[row + x0 as usize * 4..row + x1 as usize * 4]);
    }
    Ok((out, x0, y0, w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blend_mode_mapping_covers_all_16() {
        let mapped: HashSet<&str> = [
            "Normal",
            "Multiply",
            "Screen",
            "Overlay",
            "Darken",
            "Lighten",
            "ColorDodge",
            "ColorBurn",
            "HardLight",
            "SoftLight",
            "Difference",
            "Exclusion",
            "Hue",
            "Saturation",
            "Color",
            "Luminosity",
        ]
        .into_iter()
        .map(map_blend_mode)
        .collect();
        assert_eq!(mapped.len(), 16);
        for m in BLEND_MODES {
            assert!(mapped.contains(m), "{m}");
        }
        assert_eq!(map_blend_mode("VividLight"), "normal");
        assert_eq!(map_blend_mode("PassThrough"), "normal");
        assert_eq!(map_blend_mode("DarkerColor"), "darken");
        assert_eq!(map_blend_mode("Garbage"), "normal");
    }

    #[test]
    fn not_a_psd() {
        assert_eq!(import_psd(b"8BPS").expect_err("short").code(), "io_psd");
        assert_eq!(import_psd(b"nope").expect_err("sig").code(), "io_psd");
    }
}
