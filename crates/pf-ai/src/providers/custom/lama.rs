//! Local CPU LaMa inference. Model installation is explicit; inference never uses HTTP.
use crate::{
    custom::{CustomProvider, ProbeResult},
    error::Error,
    provider::{validate_edit, ImageProvider},
    types::{
        Capabilities, EditMode, EditRequest, GenerateRequest, ImageBytes, ImageResult, ProviderId,
    },
};
use async_trait::async_trait;
use image::{
    imageops::{crop_imm, resize, FilterType},
    DynamicImage, GrayImage, RgbImage, RgbaImage,
};
use ort::{
    session::{RunOptions, Session},
    value::Tensor,
};
use std::{
    io::Cursor,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};

pub const MODEL_URL: &str = "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx";
pub const MODEL_SHA256: &str = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6";
pub const MODEL_BYTES: u64 = 208_044_816;
const EDGE: usize = 512;
/// Install the pinned model only following an explicit user download action.
pub async fn install_model(directory: PathBuf) -> Result<PathBuf, Error> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    std::fs::create_dir_all(&directory)?;
    let target = directory.join("lama-c3c0c9e4-fp32.onnx");
    if target.exists() {
        let mut input = std::fs::File::open(&target)?;
        let mut hash = Sha256::new();
        let mut buf = [0u8; 65536];
        loop {
            let n = input.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hash.update(&buf[..n]);
        }
        if format!("{:x}", hash.finalize()) == MODEL_SHA256 {
            return Ok(target);
        }
        return Err(Error::InvalidRequest(
            "The installed LaMa model failed its checksum. Move it aside before downloading again."
                .into(),
        ));
    }
    let partial = directory.join(format!("lama-{}.part", uuid::Uuid::new_v4()));
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _cleanup = Cleanup(partial.clone());
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()?;
    let mut response = client.get(MODEL_URL).send().await?.error_for_status()?;
    let mut count = 0u64;
    let mut hash = Sha256::new();
    while let Some(chunk) = response.chunk().await? {
        count += chunk.len() as u64;
        if count > MODEL_BYTES {
            return Err(Error::InvalidResponse(
                "LaMa download exceeded expected size".into(),
            ));
        }
        hash.update(&chunk);
        file.write_all(&chunk)?;
    }
    if count != MODEL_BYTES || format!("{:x}", hash.finalize()) != MODEL_SHA256 {
        return Err(Error::InvalidResponse(
            "LaMa download failed checksum verification; please retry".into(),
        ));
    }
    file.sync_all()?;
    drop(file);
    std::fs::rename(&partial, &target)?;
    Ok(target)
}
type Cached = Option<(PathBuf, Session)>;
static SESSION: OnceLock<Mutex<Cached>> = OnceLock::new();

fn ort_error(e: ort::Error) -> Error {
    Error::Image(format!("LaMa inference: {e}"))
}

fn session(path: &str) -> Result<Session, Error> {
    let file = std::fs::metadata(path).map_err(|_| {
        Error::InvalidRequest(
            "LaMa model is missing. Choose or download it in AI Providers.".into(),
        )
    })?;
    if !file.is_file() || file.len() > 1_073_741_824 {
        return Err(Error::InvalidRequest(
            "Choose a LaMa ONNX model file smaller than 1 GB".into(),
        ));
    }
    let session = Session::builder()
        .map_err(ort_error)?
        .with_intra_threads(4)
        .map_err(ort_error)?
        .commit_from_file(path)
        .map_err(ort_error)?;
    if session.inputs.len() != 2
        || !session.inputs.iter().any(|i| i.name == "image")
        || !session.inputs.iter().any(|i| i.name == "mask")
    {
        return Err(Error::InvalidRequest(
            "This model is not a compatible LaMa model (expected image and mask inputs)".into(),
        ));
    }
    Ok(session)
}

#[derive(Debug, Clone)]
pub struct LamaProvider {
    cfg: CustomProvider,
}
impl LamaProvider {
    pub fn new(cfg: CustomProvider) -> Self {
        Self { cfg }
    }
    pub async fn probe(&self) -> Result<ProbeResult, Error> {
        let model = self.cfg.model.clone();
        tokio::task::spawn_blocking(move || session(&model))
            .await
            .map_err(|e| Error::Image(e.to_string()))??;
        Ok(ProbeResult { reachable: true, auth_failed: false, detected_caps: None, models: vec![self.cfg.model.clone()], version: None,
            message: "LaMa model loaded locally. Select an area, then run offline inpainting. No image was sent over the network.".into() })
    }
}

/// Terminate the CPU run when the job manager drops the inference future.
struct CancelRun(Arc<RunOptions>);
impl Drop for CancelRun {
    fn drop(&mut self) {
        let _ = self.0.terminate();
    }
}

#[async_trait]
impl ImageProvider for LamaProvider {
    fn id(&self) -> ProviderId {
        self.cfg.provider_id()
    }
    fn capabilities(&self) -> Capabilities {
        self.cfg.kind.default_capabilities()
    }
    async fn generate(&self, _req: GenerateRequest) -> Result<Vec<ImageResult>, Error> {
        Err(Error::InvalidRequest(
            "LaMa removes selected content; it cannot generate from a prompt".into(),
        ))
    }
    async fn edit(&self, req: EditRequest) -> Result<Vec<ImageResult>, Error> {
        validate_edit(&self.id(), &self.capabilities(), &req)?;
        if req.mode != EditMode::Mask {
            return Err(Error::InvalidRequest(
                "LaMa needs a partial selection or a painted Remove area".into(),
            ));
        }
        let options = Arc::new(RunOptions::new().map_err(ort_error)?);
        let _cancel = CancelRun(options.clone());
        let cfg = self.cfg.clone();
        let result = tokio::task::spawn_blocking(move || infer(&cfg, &req, &options))
            .await
            .map_err(|e| Error::Image(format!("LaMa worker: {e}")))??;
        Ok(vec![result])
    }
    async fn test_key(&self) -> Result<(), Error> {
        self.probe().await.map(|_| ())
    }
}

struct Prepared {
    base: RgbaImage,
    mask: GrayImage,
    rect: Rect,
    scaled_w: u32,
    scaled_h: u32,
    image_tensor: Vec<f32>,
    mask_tensor: Vec<f32>,
}

#[derive(Debug, PartialEq)]
struct Rect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl Rect {
    fn padded(&self, padding: u32, width: u32, height: u32) -> Self {
        let x = self.x.saturating_sub(padding);
        let y = self.y.saturating_sub(padding);
        let right = self
            .x
            .saturating_add(self.width)
            .saturating_add(padding)
            .min(width);
        let bottom = self
            .y
            .saturating_add(self.height)
            .saturating_add(padding)
            .min(height);
        Self {
            x,
            y,
            width: right - x,
            height: bottom - y,
        }
    }
}

fn mask_bbox(mask: &GrayImage) -> Option<Rect> {
    let (mut left, mut top) = mask.dimensions();
    let (mut right, mut bottom) = (0, 0);
    for (x, y, pixel) in mask.enumerate_pixels() {
        if pixel[0] != 0 {
            left = left.min(x);
            top = top.min(y);
            right = right.max(x + 1);
            bottom = bottom.max(y + 1);
        }
    }
    (right > left && bottom > top).then_some(Rect {
        x: left,
        y: top,
        width: right.saturating_sub(left),
        height: bottom.saturating_sub(top),
    })
}

fn prepare(image: &[u8], mask: &[u8]) -> Result<Prepared, Error> {
    let base = image::load_from_memory(image)?.to_rgba8();
    let mask = image::load_from_memory(mask)?.to_luma8();
    if base.dimensions() != mask.dimensions() {
        return Err(Error::InvalidRequest(
            "LaMa mask dimensions must match the image".into(),
        ));
    }
    let bbox = mask_bbox(&mask)
        .ok_or_else(|| Error::InvalidRequest("Select the area to remove first".into()))?;
    if mask.pixels().all(|p| p[0] > 0) {
        return Err(Error::InvalidRequest(
            "Leave some surrounding image unselected for LaMa".into(),
        ));
    }
    let rect = bbox.padded(
        64.max(bbox.width.max(bbox.height) / 4),
        base.width(),
        base.height(),
    );
    let longest = rect.width.max(rect.height) as f32;
    let scaled_w = ((rect.width as f32 / longest) * EDGE as f32)
        .round()
        .max(1.0) as u32;
    let scaled_h = ((rect.height as f32 / longest) * EDGE as f32)
        .round()
        .max(1.0) as u32;
    let rgb = DynamicImage::ImageRgba8(
        crop_imm(&base, rect.x, rect.y, rect.width, rect.height).to_image(),
    )
    .to_rgb8();
    let rgb = resize(&rgb, scaled_w, scaled_h, FilterType::Triangle);
    let small_mask = resize(
        &crop_imm(&mask, rect.x, rect.y, rect.width, rect.height).to_image(),
        scaled_w,
        scaled_h,
        FilterType::Nearest,
    );
    let mut image_tensor = vec![0.0; 3 * EDGE * EDGE];
    let mut mask_tensor = vec![0.0; EDGE * EDGE];
    for y in 0..EDGE {
        for x in 0..EDGE {
            let px = (x as u32).min(scaled_w - 1);
            let py = (y as u32).min(scaled_h - 1);
            let p = rgb.get_pixel(px, py);
            for c in 0..3 {
                image_tensor[c * EDGE * EDGE + y * EDGE + x] = p[c] as f32 / 255.0;
            }
            mask_tensor[y * EDGE + x] = if small_mask.get_pixel(px, py)[0] > 0 {
                1.0
            } else {
                0.0
            };
        }
    }
    Ok(Prepared {
        base,
        mask,
        rect,
        scaled_w,
        scaled_h,
        image_tensor,
        mask_tensor,
    })
}

fn restore(mut prepared: Prepared, pixels: &[f32]) -> Result<RgbaImage, Error> {
    if pixels.len() != 3 * EDGE * EDGE || pixels.iter().any(|v| !v.is_finite()) {
        return Err(Error::InvalidResponse(
            "LaMa returned invalid image values".into(),
        ));
    }
    let patch = RgbImage::from_fn(prepared.scaled_w, prepared.scaled_h, |x, y| {
        image::Rgb(std::array::from_fn(|c| {
            pixels[c * EDGE * EDGE + y as usize * EDGE + x as usize]
                .round()
                .clamp(0.0, 255.0) as u8
        }))
    });
    let patch = resize(
        &patch,
        prepared.rect.width,
        prepared.rect.height,
        FilterType::Lanczos3,
    );
    for (x, y, p) in patch.enumerate_pixels() {
        let dx = prepared.rect.x + x;
        let dy = prepared.rect.y + y;
        if prepared.mask.get_pixel(dx, dy)[0] == 0 {
            continue;
        }
        let out = prepared.base.get_pixel_mut(dx, dy);
        out.0[..3].copy_from_slice(&p.0); // keep original alpha; frontend applies soft selection once
    }
    Ok(prepared.base)
}

fn infer(
    cfg: &CustomProvider,
    req: &EditRequest,
    options: &RunOptions,
) -> Result<ImageResult, Error> {
    let mask = req
        .mask
        .as_ref()
        .ok_or_else(|| Error::InvalidRequest("LaMa requires a mask".into()))?;
    let mut prepared = prepare(&req.image.data, &mask.data)?;
    let image = Tensor::from_array((
        [1usize, 3, EDGE, EDGE],
        std::mem::take(&mut prepared.image_tensor),
    ))
    .map_err(ort_error)?;
    let mask = Tensor::from_array((
        [1usize, 1, EDGE, EDGE],
        std::mem::take(&mut prepared.mask_tensor),
    ))
    .map_err(ort_error)?;
    let mut cache = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| Error::Image("LaMa session unavailable".into()))?;
    let path = PathBuf::from(&cfg.model);
    if cache.as_ref().is_none_or(|(p, _)| p != &path) {
        *cache = Some((path, session(&cfg.model)?));
    }
    let session = &mut cache.as_mut().expect("loaded").1;
    let output = session
        .run_with_options(ort::inputs!["image" => image, "mask" => mask], options)
        .map_err(ort_error)?;
    let (shape, data) = output[0].try_extract_tensor::<f32>().map_err(ort_error)?;
    if shape[..] != [1, 3, EDGE as i64, EDGE as i64] {
        return Err(Error::InvalidResponse(
            "LaMa output must be a 512 by 512 RGB image".into(),
        ));
    }
    let result = restore(prepared, data)?;
    let (width, height) = result.dimensions();
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(result).write_to(&mut bytes, image::ImageFormat::Png)?;
    Ok(ImageResult {
        image: ImageBytes::png(bytes.into_inner()),
        width,
        height,
        provider: cfg.provider_id(),
        model: "LaMa (offline)".into(),
        revised_prompt: None,
        cost_usd: Some(0.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_includes_soft_edge_pixels_and_clips_padding_to_image() {
        let mut mask = GrayImage::new(20, 10);
        assert_eq!(mask_bbox(&mask), None);
        mask.put_pixel(0, 0, image::Luma([1]));
        mask.put_pixel(19, 9, image::Luma([255]));
        let bounds = mask_bbox(&mask).unwrap();
        assert_eq!(
            bounds,
            Rect {
                x: 0,
                y: 0,
                width: 20,
                height: 10
            }
        );
        assert_eq!(bounds.padded(64, 20, 10), bounds);
        mask.put_pixel(19, 9, image::Luma([0]));
        assert_eq!(
            mask_bbox(&mask).unwrap().padded(2, 20, 10),
            Rect {
                x: 0,
                y: 0,
                width: 3,
                height: 3
            }
        );
    }
    fn png(image: DynamicImage) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }
    fn fixture() -> (RgbaImage, GrayImage) {
        let base = RgbaImage::from_fn(256, 160, |x, y| {
            if (110..140).contains(&x) && (60..95).contains(&y) {
                image::Rgba([0, 0, 0, 255])
            } else {
                image::Rgba([160 + (x / 8) as u8, 180 + (y / 8) as u8, 210, 255])
            }
        });
        let mask = GrayImage::from_fn(256, 160, |x, y| {
            image::Luma([if (106..144).contains(&x) && (56..99).contains(&y) {
                255
            } else {
                0
            }])
        });
        (base, mask)
    }
    #[test]
    fn preserves_unselected_pixels_and_alpha() {
        let (mut base, mask) = fixture();
        base.get_pixel_mut(120, 70)[3] = 123;
        let prepared = prepare(
            &png(DynamicImage::ImageRgba8(base.clone())),
            &png(DynamicImage::ImageLuma8(mask.clone())),
        )
        .unwrap();
        let result = restore(prepared, &vec![77.0; 3 * EDGE * EDGE]).unwrap();
        for (x, y, pixel) in base.enumerate_pixels() {
            if mask.get_pixel(x, y)[0] == 0 {
                assert_eq!(result.get_pixel(x, y), pixel);
            }
        }
        assert_eq!(result.get_pixel(120, 70).0, [77, 77, 77, 123]);
    }
    #[test]
    fn rejects_empty_and_full_masks() {
        let (base, _) = fixture();
        let bytes = png(DynamicImage::ImageRgba8(base));
        for value in [0, 255] {
            let mask = GrayImage::from_pixel(256, 160, image::Luma([value]));
            assert!(prepare(&bytes, &png(DynamicImage::ImageLuma8(mask))).is_err());
        }
    }
    /// Explicit local-model gate: no network, account, or paid request.
    #[tokio::test]
    #[ignore = "requires PIXELFORGE_LAMA_MODEL and a local ONNX model"]
    async fn real_model_removes_fixture() {
        let mut cfg =
            CustomProvider::new("lama-test", "LaMa test", crate::custom::CustomKind::Lama);
        cfg.model = std::env::var("PIXELFORGE_LAMA_MODEL").expect("local model path");
        let (base, mask) = fixture();
        let req = EditRequest::masked(
            "Remove selected content",
            ImageBytes::png(png(DynamicImage::ImageRgba8(base.clone()))),
            ImageBytes::png(png(DynamicImage::ImageLuma8(mask.clone()))),
        );
        let start = std::time::Instant::now();
        let results = LamaProvider::new(cfg).edit(req).await.unwrap();
        let output = image::load_from_memory(&results[0].image.data)
            .unwrap()
            .to_rgba8();
        assert_eq!(output.dimensions(), base.dimensions());
        for (x, y, pixel) in base.enumerate_pixels() {
            if mask.get_pixel(x, y)[0] == 0 {
                assert_eq!(output.get_pixel(x, y), pixel);
            }
        }
        assert!(
            output.get_pixel(120, 70)[0] > 100,
            "black rectangle should be replaced with surrounding background"
        );
        if let Ok(dir) = std::env::var("PIXELFORGE_LAMA_ARTIFACTS") {
            let dir = PathBuf::from(dir);
            std::fs::create_dir_all(&dir).unwrap();
            base.save(dir.join("before.png")).unwrap();
            mask.save(dir.join("mask.png")).unwrap();
            output.save(dir.join("after.png")).unwrap();
        }
        eprintln!(
            "Real local LaMa inference completed in {:?}; outside mask unchanged",
            start.elapsed()
        );
    }
}
