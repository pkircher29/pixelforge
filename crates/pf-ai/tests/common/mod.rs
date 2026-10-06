//! Shared helpers for the integration tests (no live network anywhere).
#![allow(dead_code)]

use std::io::Cursor;

use image::{DynamicImage, GrayImage, RgbaImage};
use pf_ai::{AuthMethod, SecretString};
use wiremock::{Match, Request};

/// The key every test sends; providers must put it in the right header.
pub const TEST_KEY: &str = "sk-test-key-0123456789abcdef";

/// Base64 of a valid 1x1 PNG (the one embedded in the fixtures).
pub const TINY_PNG_B64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

pub fn auth() -> AuthMethod {
    AuthMethod::ApiKey(SecretString::new(TEST_KEY))
}

pub fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("fixture {path}: {e}"))
}

pub fn fixture_json(name: &str) -> serde_json::Value {
    serde_json::from_str(&fixture(name)).expect("fixture is valid JSON")
}

/// Solid RGBA PNG.
pub fn png(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
    let img = RgbaImage::from_pixel(w, h, image::Rgba(rgba));
    encode(DynamicImage::ImageRgba8(img), image::ImageFormat::Png)
}

/// Luma mask PNG: `value` inside `rect` (x, y, w, h), 0 elsewhere.
pub fn mask_png(w: u32, h: u32, rect: (u32, u32, u32, u32), value: u8) -> Vec<u8> {
    let mut img = GrayImage::new(w, h);
    for y in rect.1..rect.1 + rect.3 {
        for x in rect.0..rect.0 + rect.2 {
            img.put_pixel(x, y, image::Luma([value]));
        }
    }
    encode(DynamicImage::ImageLuma8(img), image::ImageFormat::Png)
}

/// Solid JPEG.
pub fn jpeg(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbImage::from_pixel(w, h, image::Rgb([200, 30, 30]));
    encode(DynamicImage::ImageRgb8(img), image::ImageFormat::Jpeg)
}

/// Solid WebP (lossless).
pub fn webp(w: u32, h: u32) -> Vec<u8> {
    let img = RgbaImage::from_pixel(w, h, image::Rgba([1, 2, 3, 255]));
    encode(DynamicImage::ImageRgba8(img), image::ImageFormat::WebP)
}

fn encode(img: DynamicImage, fmt: image::ImageFormat) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, fmt).expect("encode");
    out.into_inner()
}

pub fn decode_dims(bytes: &[u8]) -> (u32, u32) {
    let img = image::load_from_memory(bytes).expect("decodes");
    (img.width(), img.height())
}

/// Matches when the (lossily decoded) body contains `needle` exactly `count` times
/// (`None` = at least once). Works on multipart bodies with binary parts.
pub struct BodyCount {
    pub needle: &'static str,
    pub count: Option<usize>,
}

impl BodyCount {
    pub fn contains(needle: &'static str) -> Self {
        Self {
            needle,
            count: None,
        }
    }

    pub fn exactly(needle: &'static str, count: usize) -> Self {
        Self {
            needle,
            count: Some(count),
        }
    }
}

impl Match for BodyCount {
    fn matches(&self, request: &Request) -> bool {
        let body = String::from_utf8_lossy(&request.body);
        let n = body.matches(self.needle).count();
        match self.count {
            Some(c) => n == c,
            None => n > 0,
        }
    }
}

/// Matches when `f` returns true for the parsed JSON body.
pub struct JsonPredicate(pub fn(&serde_json::Value) -> bool);

impl Match for JsonPredicate {
    fn matches(&self, request: &Request) -> bool {
        match serde_json::from_slice::<serde_json::Value>(&request.body) {
            Ok(v) => (self.0)(&v),
            Err(_) => false,
        }
    }
}

/// Matches when the body does NOT contain `needle`.
pub struct BodyLacks(pub &'static str);

impl Match for BodyLacks {
    fn matches(&self, request: &Request) -> bool {
        !String::from_utf8_lossy(&request.body).contains(self.0)
    }
}
