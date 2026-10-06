//! Static capability matrix per provider (docs/ai-research.md, verified 2026-10-06).
//!
//! Everything here is data: no network, no auth. The UI calls [`all_capabilities`] to
//! build the provider picker and to decide when to emulate a mask.

use crate::types::{Capabilities, ImageSize, ProviderId};

/// OpenAI default for text -> image ("fast everyday").
pub const OPENAI_GENERATE_MODEL: &str = "gpt-image-2.5-flare";
/// OpenAI default for edits ("editing precision").
pub const OPENAI_EDIT_MODEL: &str = "gpt-image-2.5-sunburst";
/// xAI default.
pub const XAI_MODEL: &str = "grok-imagine-image-2.0";
/// Gemini default (workhorse, 0.5K-4K).
pub const GEMINI_MODEL: &str = "gemini-3.1-flash-image";
/// Gemini premium alternative.
pub const GEMINI_PRO_MODEL: &str = "gemini-3-pro-image";

/// Models offered per built-in provider; the first entry is the default for `generate`.
/// Custom providers carry their own list (`crate::custom`), so this is empty for them.
pub fn models(id: &ProviderId) -> &'static [&'static str] {
    match id {
        ProviderId::Custom(_) => &[],
        ProviderId::OpenAi => &[
            OPENAI_GENERATE_MODEL,
            OPENAI_EDIT_MODEL,
            "gpt-image-2",
            "gpt-image-1.5",
            "gpt-image-1",
            "gpt-image-1-mini",
        ],
        ProviderId::XAi => &[XAI_MODEL, "grok-imagine-image"],
        ProviderId::Gemini => &[
            GEMINI_MODEL,
            GEMINI_PRO_MODEL,
            "gemini-3.1-flash-lite-image",
        ],
    }
}

/// Aspect ratios xAI accepts for `aspect_ratio`.
pub const XAI_ASPECT_RATIOS: &[&str] = &[
    "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9",
    "9:20", "21:9", "5:2",
];

/// Resolution tiers xAI accepts for `resolution`.
pub const XAI_RESOLUTIONS: &[&str] = &["1k", "1.5k", "2k"];

/// Aspect ratios Gemini accepts for `imageConfig.aspectRatio`.
pub const GEMINI_ASPECT_RATIOS: &[&str] = &[
    "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
];

/// Size tiers Gemini accepts for `imageConfig.imageSize` (uppercase `K` is mandatory).
///
/// TODO(live-verify): docs list `512|1K|2K|4K`; the pricing page calls the smallest
/// tier "0.5K". If the API rejects `"512"`, switch the first entry.
pub const GEMINI_RESOLUTIONS: &[&str] = &["512", "1K", "2K", "4K"];

/// OpenAI's three preset sizes (custom `WIDTHxHEIGHT` is also accepted, see
/// [`crate::providers::openai::validate_openai_size`]).
pub const OPENAI_PRESET_SIZES: [ImageSize; 3] = [
    ImageSize::new(1024, 1024),
    ImageSize::new(1536, 1024),
    ImageSize::new(1024, 1536),
];

/// Capability matrix for one built-in provider. A custom id yields the conservative
/// [`Capabilities::default`]; its real matrix lives in its `crate::custom::CustomProvider`.
pub fn capabilities_for(id: &ProviderId) -> Capabilities {
    let model_list = models(id).iter().map(|m| (*m).to_owned()).collect();
    match id {
        ProviderId::Custom(_) => Capabilities::default(),
        ProviderId::OpenAi => Capabilities {
            generate: true,
            mask_edit: true,
            instruct_edit: true,
            multi_ref: true,
            max_refs: 16,
            sizes: OPENAI_PRESET_SIZES.to_vec(),
            custom_sizes: true,
            aspect_ratios: Vec::new(),
            resolutions: Vec::new(),
            max_px: 3840,
            max_variants: 10,
            transparent_bg: true,
            models: model_list,
        },
        ProviderId::XAi => Capabilities {
            generate: true,
            mask_edit: false,
            instruct_edit: true,
            multi_ref: true,
            max_refs: 5,
            sizes: Vec::new(),
            custom_sizes: true,
            aspect_ratios: to_strings(XAI_ASPECT_RATIOS),
            resolutions: to_strings(XAI_RESOLUTIONS),
            max_px: 2048,
            max_variants: 10,
            transparent_bg: false,
            models: model_list,
        },
        ProviderId::Gemini => Capabilities {
            generate: true,
            mask_edit: false,
            instruct_edit: true,
            multi_ref: true,
            max_refs: 14,
            sizes: Vec::new(),
            custom_sizes: true,
            aspect_ratios: to_strings(GEMINI_ASPECT_RATIOS),
            resolutions: to_strings(GEMINI_RESOLUTIONS),
            max_px: 4096,
            max_variants: 4,
            transparent_bg: false,
            models: model_list,
        },
    }
}

/// Every built-in provider with its matrix, in UI order.
pub fn all_capabilities() -> Vec<(ProviderId, Capabilities)> {
    ProviderId::BUILTIN
        .into_iter()
        .map(|id| {
            let caps = capabilities_for(&id);
            (id, caps)
        })
        .collect()
}

/// Pick the ratio string (`"W:H"`) closest to `size`'s aspect from `ratios`.
///
/// Returns `None` only when `ratios` is empty or every entry is unparsable.
pub fn nearest_aspect_ratio(size: ImageSize, ratios: &[&str]) -> Option<String> {
    let target = size.aspect();
    if target <= 0.0 {
        return None;
    }
    let mut best: Option<(f64, &str)> = None;
    for r in ratios {
        let Some(value) = parse_ratio(r) else {
            continue;
        };
        // Compare in log space so 2:1 and 1:2 are equally far from 1:1.
        let dist = (value.ln() - target.ln()).abs();
        if best.is_none_or(|(d, _)| dist < d) {
            best = Some((dist, r));
        }
    }
    best.map(|(_, r)| r.to_owned())
}

/// Parse `"19.5:9"` into `19.5 / 9`.
pub fn parse_ratio(s: &str) -> Option<f64> {
    let (w, h) = s.split_once(':')?;
    let w: f64 = w.trim().parse().ok()?;
    let h: f64 = h.trim().parse().ok()?;
    if w > 0.0 && h > 0.0 {
        Some(w / h)
    } else {
        None
    }
}

fn to_strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix_matches_research_doc() {
        let all = all_capabilities();
        assert_eq!(all.len(), 3);
        let (_, openai) = &all[0];
        assert!(openai.mask_edit && openai.transparent_bg && openai.custom_sizes);
        assert_eq!(openai.max_refs, 16);
        assert_eq!(openai.default_model(), Some(OPENAI_GENERATE_MODEL));
        let (_, xai) = &all[1];
        assert!(!xai.mask_edit && xai.instruct_edit);
        assert_eq!(xai.max_refs, 5);
        assert_eq!(xai.max_px, 2048);
        let (_, gemini) = &all[2];
        assert!(!gemini.mask_edit && gemini.multi_ref);
        assert_eq!(gemini.max_px, 4096);
        assert_eq!(gemini.default_model(), Some(GEMINI_MODEL));
    }

    #[test]
    fn nearest_ratio_picks_sensibly() {
        assert_eq!(
            nearest_aspect_ratio(ImageSize::new(1920, 1080), XAI_ASPECT_RATIOS).as_deref(),
            Some("16:9")
        );
        assert_eq!(
            nearest_aspect_ratio(ImageSize::new(1000, 1000), GEMINI_ASPECT_RATIOS).as_deref(),
            Some("1:1")
        );
        assert_eq!(
            nearest_aspect_ratio(ImageSize::new(500, 1000), GEMINI_ASPECT_RATIOS).as_deref(),
            Some("9:16")
        );
        assert_eq!(
            nearest_aspect_ratio(ImageSize::new(2520, 1080), XAI_ASPECT_RATIOS).as_deref(),
            Some("21:9")
        );
        assert_eq!(
            nearest_aspect_ratio(ImageSize::new(10, 0), XAI_ASPECT_RATIOS),
            None
        );
        assert_eq!(nearest_aspect_ratio(ImageSize::new(10, 10), &[]), None);
        assert_eq!(parse_ratio("x"), None);
    }
}
