//! Binary framing for raw-bytes IPC (see `docs/ipc.md`).
//!
//! ```text
//! +----------------+------------------+--------+--------+-----+
//! | u32 LE hdr_len | JSON header      | blob 0 | blob 1 | ... |
//! +----------------+------------------+--------+--------+-----+
//! ```
//!
//! The JSON header is an object; its `blobs` field is an array of blob byte lengths in
//! order. Everything else in the header is command-specific. The same layout is used for
//! uploads (`tauri::ipc::Request` raw body) and downloads (`tauri::ipc::Response`).

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::{Error, Result};

/// Key in the header that lists blob lengths.
pub const BLOBS_KEY: &str = "blobs";

/// A decoded frame: the header object (with `blobs` still present) and the blob slices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame<'a> {
    /// Header object.
    pub header: Map<String, Value>,
    /// Blob slices, in header order.
    pub blobs: Vec<&'a [u8]>,
}

impl Frame<'_> {
    /// Deserialize the header into a typed struct (unknown fields such as `blobs` are
    /// ignored unless the struct denies them).
    pub fn header_as<T: DeserializeOwned>(&self) -> Result<T> {
        Ok(serde_json::from_value(Value::Object(self.header.clone()))?)
    }

    /// Fetch blob `index`, with a frame error instead of a panic when out of range.
    pub fn blob(&self, index: usize) -> Result<&[u8]> {
        self.blobs.get(index).copied().ok_or_else(|| {
            Error::Frame(format!(
                "blob index {index} out of range ({} blobs)",
                self.blobs.len()
            ))
        })
    }
}

/// Serialize `header` (must be a JSON object) plus `blobs` into one buffer.
pub fn encode_frame<T: Serialize>(header: &T, blobs: &[&[u8]]) -> Result<Vec<u8>> {
    let mut obj = match serde_json::to_value(header)? {
        Value::Object(m) => m,
        other => {
            return Err(Error::Frame(format!(
                "frame header must be a JSON object, got {}",
                json_kind(&other)
            )))
        }
    };
    obj.insert(
        BLOBS_KEY.to_owned(),
        Value::Array(blobs.iter().map(|b| Value::from(b.len() as u64)).collect()),
    );
    let header_bytes = serde_json::to_vec(&Value::Object(obj))?;
    let header_len = u32::try_from(header_bytes.len())
        .map_err(|_| Error::Frame("frame header exceeds 4 GiB".to_owned()))?;

    let total = 4 + header_bytes.len() + blobs.iter().map(|b| b.len()).sum::<usize>();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&header_len.to_le_bytes());
    out.extend_from_slice(&header_bytes);
    for b in blobs {
        out.extend_from_slice(b);
    }
    Ok(out)
}

/// Parse a frame. Blob slices borrow from `bytes`; the total length must match exactly.
pub fn decode_frame(bytes: &[u8]) -> Result<Frame<'_>> {
    if bytes.len() < 4 {
        return Err(Error::Frame("frame shorter than 4 bytes".to_owned()));
    }
    let header_len = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let header_end = 4usize
        .checked_add(header_len)
        .filter(|&end| end <= bytes.len())
        .ok_or_else(|| {
            Error::Frame(format!(
                "header length {header_len} exceeds frame of {} bytes",
                bytes.len()
            ))
        })?;
    let header: Value = serde_json::from_slice(&bytes[4..header_end])
        .map_err(|e| Error::Frame(format!("header is not valid JSON: {e}")))?;
    let header = match header {
        Value::Object(m) => m,
        other => {
            return Err(Error::Frame(format!(
                "frame header must be a JSON object, got {}",
                json_kind(&other)
            )))
        }
    };
    let lengths: Vec<usize> = match header.get(BLOBS_KEY) {
        None => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .ok_or_else(|| {
                        Error::Frame(format!("blob length {v} is not a non-negative integer"))
                    })
            })
            .collect::<Result<_>>()?,
        Some(other) => {
            return Err(Error::Frame(format!(
                "`blobs` must be an array, got {}",
                json_kind(other)
            )))
        }
    };

    let mut blobs = Vec::with_capacity(lengths.len());
    let mut pos = header_end;
    for (i, len) in lengths.iter().enumerate() {
        let end = pos
            .checked_add(*len)
            .filter(|&end| end <= bytes.len())
            .ok_or_else(|| {
                Error::Frame(format!(
                    "blob {i} ({len} bytes) runs past the end of the frame"
                ))
            })?;
        blobs.push(&bytes[pos..end]);
        pos = end;
    }
    if pos != bytes.len() {
        return Err(Error::Frame(format!(
            "{} trailing bytes after the last blob",
            bytes.len() - pos
        )));
    }
    Ok(Frame { header, blobs })
}

fn json_kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct Hdr {
        width: u32,
        name: String,
    }

    #[test]
    fn round_trip_with_blobs() {
        let h = Hdr {
            width: 7,
            name: "x".into(),
        };
        let a = [1u8, 2, 3];
        let b: [u8; 0] = [];
        let c = [9u8; 1000];
        let bytes = encode_frame(&h, &[&a, &b, &c]).expect("encode");
        let f = decode_frame(&bytes).expect("decode");
        assert_eq!(f.blobs, vec![&a[..], &b[..], &c[..]]);
        assert_eq!(f.header_as::<Hdr>().expect("hdr"), h);
        assert_eq!(f.header[BLOBS_KEY], serde_json::json!([3, 0, 1000]));
        assert_eq!(f.blob(2).expect("blob"), &c[..]);
        assert_eq!(f.blob(3).expect_err("oob").code(), "io_frame");
    }

    #[test]
    fn no_blobs_and_layout() {
        let bytes = encode_frame(&serde_json::json!({"a": 1}), &[]).expect("encode");
        assert_eq!(
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize,
            bytes.len() - 4
        );
        let f = decode_frame(&bytes).expect("decode");
        assert!(f.blobs.is_empty());
        assert_eq!(f.header["a"], 1);
    }

    #[test]
    fn malformed_frames_are_typed_errors() {
        assert_eq!(decode_frame(&[1, 2]).expect_err("short").code(), "io_frame");
        assert_eq!(
            decode_frame(&[200, 0, 0, 0, b'{', b'}'])
                .expect_err("len")
                .code(),
            "io_frame"
        );
        let bytes = encode_frame(&serde_json::json!({}), &[&[1, 2, 3]]).expect("encode");
        assert_eq!(
            decode_frame(&bytes[..bytes.len() - 1])
                .expect_err("trunc")
                .code(),
            "io_frame"
        );
        let mut extra = bytes.clone();
        extra.push(0);
        assert_eq!(
            decode_frame(&extra).expect_err("trailing").code(),
            "io_frame"
        );
        assert_eq!(
            encode_frame(&[1, 2], &[]).expect_err("array hdr").code(),
            "io_frame"
        );
        let arr = b"\x02\x00\x00\x00[]";
        assert_eq!(decode_frame(arr).expect_err("array hdr").code(), "io_frame");
    }
}
