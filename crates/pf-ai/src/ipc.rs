//! Wire format for the raw-bytes Tauri IPC (`docs/ipc.md` is the human version).
//!
//! Images never cross IPC as base64 JSON. Both directions use the **same binary frame
//! as the IO commands** (`crates/pf-io/src/frame.rs`), re-implemented here so the two
//! crates stay independent:
//!
//! ```text
//! +----------------+------------------+--------+--------+-----+
//! | u32 LE hdr_len | JSON header      | blob 0 | blob 1 | ... |
//! +----------------+------------------+--------+--------+-----+
//! ```
//!
//! The header is a JSON object carrying `"blobs": [len0, len1, ...]` (byte length of
//! each blob, in order) plus command-specific fields. Blobs follow the header back to
//! back with no padding, and the total length must match exactly.
//!
//! **Edit request** (`ai_submit_edit`, webview -> Rust): header = [`EditParams`] (+
//! `blobs`). Blob order is fixed: the composite image, then the mask iff
//! `EditParams::mask`, then `EditParams::refs` reference images. All blobs are encoded
//! images (PNG from `canvas.toBlob`; JPEG/WebP where the provider allows).
//!
//! **Result** (`ai_take_result`, Rust -> webview): header = [`ResultsHeader`]
//! (`{ results: ImageResultMeta[], blobs }`), one PNG blob per result, in order.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::Error;
use crate::types::{
    EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult, ImageResultMeta, ImageSize,
    ProviderId,
};

/// Header key that lists blob lengths (same as `pf_io::frame::BLOBS_KEY`).
pub const BLOBS_KEY: &str = "blobs";

/// Hard cap on a single request body (defensive; providers cap far lower).
pub const MAX_REQUEST_BYTES: usize = 512 * 1024 * 1024;

/// JSON arguments of `ai_submit_generate` (no binary part).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateParams {
    /// Target provider.
    pub provider: ProviderId,
    /// Prompt.
    pub prompt: String,
    /// Things to avoid (folded into the prompt).
    #[serde(default)]
    pub negative_prompt: Option<String>,
    /// Requested size; `None` = provider default.
    #[serde(default)]
    pub size: Option<ImageSize>,
    /// Variants, default 1.
    #[serde(default = "one")]
    pub n: u8,
    /// Model override.
    #[serde(default)]
    pub model: Option<String>,
    /// Quality tier (provider-specific string).
    #[serde(default)]
    pub quality: Option<String>,
    /// Transparent background (OpenAI only).
    #[serde(default)]
    pub transparent: bool,
    /// Seed (currently ignored by all three providers).
    #[serde(default)]
    pub seed: Option<u64>,
    /// Per-job timeout override in seconds.
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

/// JSON header of an `ai_submit_edit` frame (the frame's `blobs` key is added/consumed
/// by the frame codec and is not part of this struct).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditParams {
    /// Target provider.
    pub provider: ProviderId,
    /// `mask` (selection becomes a mask; OpenAI only) or `instruct`.
    pub mode: EditMode,
    /// Instruction.
    pub prompt: String,
    /// Things to avoid.
    #[serde(default)]
    pub negative_prompt: Option<String>,
    /// Requested output size; `None` = same as input / provider default.
    #[serde(default)]
    pub size: Option<ImageSize>,
    /// Variants, default 1.
    #[serde(default = "one")]
    pub n: u8,
    /// Model override.
    #[serde(default)]
    pub model: Option<String>,
    /// Quality tier.
    #[serde(default)]
    pub quality: Option<String>,
    /// Transparent background (OpenAI only).
    #[serde(default)]
    pub transparent: bool,
    /// Seed (ignored).
    #[serde(default)]
    pub seed: Option<u64>,
    /// Whether a mask blob follows the image blob.
    #[serde(default)]
    pub mask: bool,
    /// How many reference-image blobs follow.
    #[serde(default)]
    pub refs: u32,
    /// Per-job timeout override in seconds.
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

/// JSON header of an `ai_take_result` frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultsHeader {
    /// One entry per result; blob `i` holds the PNG bytes of `results[i]`.
    pub results: Vec<ImageResultMeta>,
}

fn one() -> u8 {
    1
}

impl From<GenerateParams> for GenerateRequest {
    fn from(p: GenerateParams) -> Self {
        GenerateRequest {
            prompt: p.prompt,
            negative_prompt: p.negative_prompt,
            size: p.size,
            n: p.n,
            model: p.model,
            seed: p.seed,
            reference_images: Vec::new(),
            quality: p.quality,
            transparent: p.transparent,
        }
    }
}

/// A decoded edit frame.
#[derive(Debug, Clone, PartialEq)]
pub struct EditEnvelope {
    /// The JSON header.
    pub params: EditParams,
    /// Composite image.
    pub image: Vec<u8>,
    /// Mask (present iff `params.mask`).
    pub mask: Option<Vec<u8>>,
    /// Reference images (`params.refs` of them).
    pub refs: Vec<Vec<u8>>,
}

impl EditEnvelope {
    /// Build the provider request.
    pub fn into_request(self) -> EditRequest {
        let p = self.params;
        EditRequest {
            mode: p.mode,
            prompt: p.prompt,
            negative_prompt: p.negative_prompt,
            image: ImageBytes::png(self.image),
            mask: self.mask.map(ImageBytes::png),
            reference_images: self.refs.into_iter().map(ImageBytes::png).collect(),
            size: p.size,
            n: p.n,
            model: p.model,
            seed: p.seed,
            quality: p.quality,
            transparent: p.transparent,
        }
    }
}

// ---------------------------------------------------------------------------------
// Generic frame codec (layout-compatible with pf_io::frame)
// ---------------------------------------------------------------------------------

fn frame_err(msg: impl Into<String>) -> Error {
    Error::InvalidRequest(format!("IPC frame: {}", msg.into()))
}

/// Serialize `header` (a JSON object) plus `blobs` into one buffer, adding `blobs`.
pub fn encode_frame<T: Serialize>(header: &T, blobs: &[&[u8]]) -> Result<Vec<u8>, Error> {
    let mut obj = match serde_json::to_value(header)? {
        Value::Object(m) => m,
        _ => return Err(frame_err("header must be a JSON object")),
    };
    obj.insert(
        BLOBS_KEY.to_owned(),
        Value::Array(blobs.iter().map(|b| Value::from(b.len() as u64)).collect()),
    );
    let header_bytes = serde_json::to_vec(&Value::Object(obj))?;
    let header_len =
        u32::try_from(header_bytes.len()).map_err(|_| frame_err("header exceeds 4 GiB"))?;
    let total = 4 + header_bytes.len() + blobs.iter().map(|b| b.len()).sum::<usize>();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&header_len.to_le_bytes());
    out.extend_from_slice(&header_bytes);
    for b in blobs {
        out.extend_from_slice(b);
    }
    Ok(out)
}

/// A decoded frame: the header object (with `blobs` still present) and the blob slices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame<'a> {
    /// Header object.
    pub header: Map<String, Value>,
    /// Blob slices, in header order.
    pub blobs: Vec<&'a [u8]>,
}

/// Parse a frame into its header object (with `blobs` still present) and blob slices.
pub fn decode_frame(bytes: &[u8]) -> Result<Frame<'_>, Error> {
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err(frame_err(format!(
            "{} bytes exceeds the {MAX_REQUEST_BYTES}-byte limit",
            bytes.len()
        )));
    }
    if bytes.len() < 4 {
        return Err(frame_err("shorter than 4 bytes"));
    }
    let header_len = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let header_end = 4usize
        .checked_add(header_len)
        .filter(|&end| end <= bytes.len())
        .ok_or_else(|| {
            frame_err(format!(
                "header length {header_len} exceeds frame of {} bytes",
                bytes.len()
            ))
        })?;
    let header: Value = serde_json::from_slice(&bytes[4..header_end])
        .map_err(|e| frame_err(format!("header is not valid JSON: {e}")))?;
    let Value::Object(header) = header else {
        return Err(frame_err("header must be a JSON object"));
    };
    let lengths: Vec<usize> = match header.get(BLOBS_KEY) {
        None => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .ok_or_else(|| frame_err(format!("blob length {v} is not a valid integer")))
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return Err(frame_err("`blobs` must be an array")),
    };
    let mut blobs = Vec::with_capacity(lengths.len());
    let mut pos = header_end;
    for (i, len) in lengths.iter().enumerate() {
        let end = pos
            .checked_add(*len)
            .filter(|&end| end <= bytes.len())
            .ok_or_else(|| frame_err(format!("blob {i} ({len} bytes) runs past the end")))?;
        blobs.push(&bytes[pos..end]);
        pos = end;
    }
    if pos != bytes.len() {
        return Err(frame_err(format!(
            "{} trailing bytes after the last blob",
            bytes.len() - pos
        )));
    }
    Ok(Frame { header, blobs })
}

// ---------------------------------------------------------------------------------
// AI-specific envelopes
// ---------------------------------------------------------------------------------

/// Encode an edit frame (tests and the reference for the TypeScript side).
pub fn encode_edit_body(
    params: &EditParams,
    image: &[u8],
    mask: Option<&[u8]>,
    refs: &[&[u8]],
) -> Result<Vec<u8>, Error> {
    if params.mask != mask.is_some() {
        return Err(Error::InvalidRequest(
            "params.mask does not match the presence of a mask blob".to_owned(),
        ));
    }
    if usize::try_from(params.refs).ok() != Some(refs.len()) {
        return Err(Error::InvalidRequest(
            "params.refs does not match the number of reference blobs".to_owned(),
        ));
    }
    let blobs: Vec<&[u8]> = std::iter::once(image)
        .chain(mask)
        .chain(refs.iter().copied())
        .collect();
    encode_frame(params, &blobs)
}

/// Decode an edit frame.
pub fn decode_edit_body(body: &[u8]) -> Result<EditEnvelope, Error> {
    let Frame { header, blobs } = decode_frame(body)?;
    let params: EditParams = serde_json::from_value(Value::Object(header))?;
    let expected = 1 + usize::from(params.mask) + params.refs as usize;
    if blobs.len() != expected {
        return Err(Error::InvalidRequest(format!(
            "edit frame has {} blobs but the header implies {expected} (image{}{})",
            blobs.len(),
            if params.mask { " + mask" } else { "" },
            if params.refs > 0 {
                format!(" + {} refs", params.refs)
            } else {
                String::new()
            }
        )));
    }
    let mut it = blobs.into_iter().map(<[u8]>::to_vec);
    let image = it
        .next()
        .ok_or_else(|| Error::InvalidRequest("missing image blob".to_owned()))?;
    if image.is_empty() {
        return Err(Error::InvalidRequest("image blob is empty".to_owned()));
    }
    let mask = if params.mask { it.next() } else { None };
    let refs: Vec<Vec<u8>> = it.collect();
    Ok(EditEnvelope {
        params,
        image,
        mask,
        refs,
    })
}

/// Encode results for `ai_take_result`.
pub fn encode_results(results: &[ImageResult]) -> Result<Vec<u8>, Error> {
    let header = ResultsHeader {
        results: results.iter().map(ImageResult::meta).collect(),
    };
    let blobs: Vec<&[u8]> = results.iter().map(|r| r.image.data.as_slice()).collect();
    encode_frame(&header, &blobs)
}

/// Decode a result frame (reference implementation / tests).
pub fn decode_results(body: &[u8]) -> Result<Vec<(ImageResultMeta, Vec<u8>)>, Error> {
    let Frame { header, blobs } = decode_frame(body)?;
    let header: ResultsHeader = serde_json::from_value(Value::Object(header))?;
    if header.results.len() != blobs.len() {
        return Err(Error::InvalidResponse(format!(
            "result frame lists {} results but carries {} blobs",
            header.results.len(),
            blobs.len()
        )));
    }
    Ok(header
        .results
        .into_iter()
        .zip(blobs)
        .map(|(meta, b)| (meta, b.to_vec()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(mask: bool, refs: u32) -> EditParams {
        EditParams {
            provider: ProviderId::OpenAi,
            mode: if mask {
                EditMode::Mask
            } else {
                EditMode::Instruct
            },
            prompt: "fix it".into(),
            negative_prompt: None,
            size: Some(ImageSize::new(1024, 1024)),
            n: 1,
            model: None,
            quality: Some("high".into()),
            transparent: false,
            seed: None,
            mask,
            refs,
            timeout_secs: None,
        }
    }

    #[test]
    fn frame_layout_matches_pf_io() {
        let bytes = encode_frame(&serde_json::json!({"a": 1}), &[b"xy", b""]).expect("encode");
        let hdr_len = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        let hdr: Value = serde_json::from_slice(&bytes[4..4 + hdr_len]).expect("json");
        assert_eq!(hdr["a"], 1);
        assert_eq!(hdr["blobs"], serde_json::json!([2, 0]));
        assert_eq!(&bytes[4 + hdr_len..], b"xy");
        let Frame {
            header: h,
            blobs: b,
        } = decode_frame(&bytes).expect("decode");
        assert_eq!(h["blobs"], serde_json::json!([2, 0]));
        assert_eq!(b, vec![&b"xy"[..], &b""[..]]);
        // Non-object headers are refused both ways.
        assert!(encode_frame(&[1, 2], &[]).is_err());
        assert!(decode_frame(b"\x02\x00\x00\x00[]").is_err());
        assert!(decode_frame(&[1, 2]).is_err());
    }

    #[test]
    fn edit_body_round_trips() {
        let body = encode_edit_body(&params(true, 2), b"IMG", Some(b"MASK"), &[b"R0", b"R1"])
            .expect("encode");
        let env = decode_edit_body(&body).expect("decode");
        assert_eq!(env.image, b"IMG");
        assert_eq!(env.mask.as_deref(), Some(&b"MASK"[..]));
        assert_eq!(env.refs, vec![b"R0".to_vec(), b"R1".to_vec()]);
        assert_eq!(env.params.quality.as_deref(), Some("high"));
        let req = env.into_request();
        assert_eq!(req.mode, EditMode::Mask);
        assert_eq!(req.reference_images.len(), 2);
        assert_eq!(req.mask.map(|m| m.data), Some(b"MASK".to_vec()));
    }

    #[test]
    fn edit_body_rejects_bad_framing() {
        assert!(encode_edit_body(&params(true, 0), b"I", None, &[]).is_err());
        assert!(encode_edit_body(&params(false, 1), b"I", None, &[]).is_err());
        let good = encode_edit_body(&params(false, 0), b"IMG", None, &[]).expect("encode");
        assert!(decode_edit_body(&good[..good.len() - 1]).is_err());
        let mut trailing = good.clone();
        trailing.push(0);
        assert!(decode_edit_body(&trailing).is_err());
        let empty_image = encode_edit_body(&params(false, 0), b"", None, &[]).expect("encode");
        assert!(decode_edit_body(&empty_image).is_err());
        // Header says mask but only one blob was sent.
        let lying = encode_frame(&params(true, 0), &[b"IMG"]).expect("encode");
        let err = decode_edit_body(&lying).expect_err("blob count");
        assert!(err.to_string().contains("image + mask"), "{err}");
    }

    #[test]
    fn results_round_trip() {
        let results = vec![
            ImageResult {
                image: ImageBytes::png(vec![1, 2, 3]),
                width: 2,
                height: 3,
                provider: ProviderId::Gemini,
                model: "m".into(),
                revised_prompt: Some("rp".into()),
                cost_usd: Some(0.5),
            },
            ImageResult {
                image: ImageBytes::png(vec![]),
                width: 0,
                height: 0,
                provider: ProviderId::XAi,
                model: "n".into(),
                revised_prompt: None,
                cost_usd: None,
            },
        ];
        let body = encode_results(&results).expect("encode");
        let Frame { header, .. } = decode_frame(&body).expect("frame");
        assert_eq!(header["blobs"], serde_json::json!([3, 0]));
        assert_eq!(header["results"][0]["revisedPrompt"], "rp");
        assert_eq!(header["results"][0]["provider"], "gemini");
        assert!(header["results"][1].get("revisedPrompt").is_none());
        let decoded = decode_results(&body).expect("decode");
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].0, results[0].meta());
        assert_eq!(decoded[0].1, vec![1, 2, 3]);
        assert_eq!(decoded[1].0.model, "n");
        assert!(decoded[1].1.is_empty());
        let mismatch = encode_frame(&ResultsHeader { results: vec![] }, &[b"x"]).expect("encode");
        assert!(decode_results(&mismatch).is_err());
    }

    #[test]
    fn generate_params_defaults() {
        let p: GenerateParams =
            serde_json::from_str(r#"{"provider":"x_ai","prompt":"hi"}"#).expect("de");
        assert_eq!(p.n, 1);
        assert!(!p.transparent);
        let req: GenerateRequest = p.into();
        assert_eq!(req.prompt, "hi");
    }
}
