//! Real-provider verification. Image requests incur charges; --check-only does not.
//! See docs/ai-live-verification.md. Never run against real providers in CI.

use pf_ai::{
    base_url_override, build_provider_from_env, AuthMethod, EditRequest, GenerateRequest,
    ImageBytes, ImageSize, ProviderId, SecretString,
};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const HELP: &str = "PixelForge AI verification (image requests can incur charges)
  cargo run -p pf-ai --example live -- --all [options]
  --all                  Require all three provider keys; missing keys fail
  --provider ID          Select open_ai, x_ai or gemini (repeatable)
  --check-only           Check keys and model metadata; no image requests
  --edit INPUT.png       Test instruction editing instead of generation
  --size WIDTHxHEIGHT    Default: 1024x1024
  --prompt TEXT          Image prompt (or positional prompt words)
  --out DIRECTORY       New output directory (must not already exist)
  --help                Show help
Keys: PF_OPENAI_KEY, PF_XAI_KEY, PF_GEMINI_KEY. Without --all/--provider,
only configured providers run. Each run writes report.json and result PNGs.
PF_AI_BASE_URL_* overrides are supported and marked in the report.";

struct Options {
    all: bool,
    providers: Vec<ProviderId>,
    check_only: bool,
    size: ImageSize,
    edit: Option<PathBuf>,
    prompt: String,
    out: PathBuf,
}

fn option_value(args: &mut impl Iterator<Item = String>, name: &str) -> Result<String, String> {
    args.next()
        .filter(|s| !s.starts_with("--") && !s.trim().is_empty())
        .ok_or_else(|| format!("{name} requires a value"))
}

fn parse(args: impl IntoIterator<Item = String>) -> Result<Options, String> {
    let mut o = Options {
        all: false,
        providers: vec![],
        check_only: false,
        size: ImageSize::new(1024, 1024),
        edit: None,
        prompt: "A tiny glossy red cube on a white table, studio light".into(),
        out: PathBuf::from("live-results").join(uuid::Uuid::new_v4().to_string()),
    };
    let mut args = args.into_iter();
    let mut words = vec![];
    let mut explicit_prompt = false;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--all" => o.all = true,
            "--check-only" => o.check_only = true,
            "--provider" => {
                let id = match args.next().as_deref() {
                    Some("open_ai" | "openai") => ProviderId::OpenAi,
                    Some("x_ai" | "xai" | "grok") => ProviderId::XAi,
                    Some("gemini") => ProviderId::Gemini,
                    _ => return Err("--provider requires open_ai, x_ai or gemini".into()),
                };
                if !o.providers.contains(&id) {
                    o.providers.push(id);
                }
            }
            "--size" => {
                let s = args.next().ok_or("--size requires WIDTHxHEIGHT")?;
                let (w, h) = s.split_once('x').ok_or("--size requires WIDTHxHEIGHT")?;
                let w: u32 = w.parse().map_err(|_| "Invalid width")?;
                let h: u32 = h.parse().map_err(|_| "Invalid height")?;
                if w == 0 || h == 0 {
                    return Err("Size must be positive".into());
                }
                o.size = ImageSize::new(w, h);
            }
            "--edit" => o.edit = Some(option_value(&mut args, "--edit")?.into()),
            "--out" => o.out = option_value(&mut args, "--out")?.into(),
            "--prompt" => {
                o.prompt = option_value(&mut args, "--prompt")?;
                explicit_prompt = true;
            }
            _ if a.starts_with('-') => return Err(format!("Unknown option: {a}")),
            _ => words.push(a),
        }
    }
    if o.all && !o.providers.is_empty() {
        return Err("Use --all or --provider, not both".into());
    }
    if explicit_prompt && !words.is_empty() {
        return Err("Use --prompt or positional words, not both".into());
    }
    if !words.is_empty() {
        o.prompt = words.join(" ");
    }
    if o.prompt.trim().is_empty() {
        return Err("Prompt must not be empty".into());
    }
    Ok(o)
}

fn env_key(id: &ProviderId) -> Option<SecretString> {
    let name = match id {
        ProviderId::OpenAi => "PF_OPENAI_KEY",
        ProviderId::XAi => "PF_XAI_KEY",
        _ => "PF_GEMINI_KEY",
    };
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .map(SecretString::new)
}

fn model(id: &ProviderId, edit: bool) -> &'static str {
    use pf_ai::capabilities::*;
    match id {
        ProviderId::OpenAi if edit => OPENAI_EDIT_MODEL,
        ProviderId::OpenAi => OPENAI_GENERATE_MODEL,
        ProviderId::XAi => XAI_MODEL,
        _ => GEMINI_MODEL,
    }
}

fn failure(row: &mut Value, stage: &str, code: &str, message: String, key: &SecretString) {
    row["status"] = json!("failed");
    row[stage] = json!("failed");
    row["failed_stage"] = json!(stage);
    row["error_code"] = json!(code);
    row["message"] = json!(if key.is_empty() {
        message
    } else {
        message.replace(key.expose(), "[REDACTED]")
    });
}

async fn verify(id: &ProviderId, o: &Options, input: Option<&ImageBytes>) -> Value {
    let model = model(id, o.edit.is_some());
    let overridden = base_url_override(id).is_some();
    let mut row = json!({"provider": id.as_str(), "model": model,
        "endpoint": if overridden { "override" } else { "vendor" },
        "status": "pending", "authentication": "not_run", "model_metadata": "not_run",
        "image_request": "not_run", "artifacts": []});
    let Some(key) = env_key(id) else {
        row["status"] = json!(if o.all || !o.providers.is_empty() {
            "failed"
        } else {
            "skipped"
        });
        row["failed_stage"] = json!("configuration");
        row["error_code"] = json!("missing_key");
        return row;
    };
    let provider = match build_provider_from_env(id, AuthMethod::ApiKey(key.clone())) {
        Ok(p) => p,
        Err(e) => {
            failure(&mut row, "configuration", e.code(), e.to_string(), &key);
            return row;
        }
    };
    for stage in ["authentication", "model_metadata"] {
        let result = tokio::time::timeout(Duration::from_secs(30), async {
            if stage == "authentication" {
                provider.test_key().await
            } else {
                provider.test_model(model).await
            }
        })
        .await;
        match result {
            Ok(Ok(())) => row[stage] = json!("passed"),
            Ok(Err(e)) => {
                failure(&mut row, stage, e.code(), e.to_string(), &key);
                return row;
            }
            Err(_) => {
                failure(
                    &mut row,
                    stage,
                    "timeout",
                    "Metadata request exceeded 30 seconds".into(),
                    &key,
                );
                return row;
            }
        }
    }
    if o.check_only {
        row["status"] = json!("passed");
        return row;
    }
    let started = Instant::now();
    row["image_request"] = json!("submitted");
    let result = tokio::time::timeout(Duration::from_secs(180), async {
        if let Some(image) = input {
            provider
                .edit(EditRequest {
                    model: Some(model.into()),
                    size: Some(o.size),
                    ..EditRequest::instruct(o.prompt.clone(), image.clone())
                })
                .await
        } else {
            provider
                .generate(GenerateRequest {
                    model: Some(model.into()),
                    prompt: o.prompt.clone(),
                    size: Some(o.size),
                    ..GenerateRequest::default()
                })
                .await
        }
    })
    .await;
    row["elapsed_ms"] = json!(started.elapsed().as_millis() as u64);
    let results = match result {
        Ok(Ok(results)) => results,
        Ok(Err(e)) => {
            failure(&mut row, "image_request", e.code(), e.to_string(), &key);
            return row;
        }
        Err(_) => {
            failure(
                &mut row,
                "image_request",
                "timeout",
                "Image request exceeded 180 seconds; no automatic retry".into(),
                &key,
            );
            return row;
        }
    };
    if results.is_empty() {
        failure(
            &mut row,
            "image_request",
            "empty_results",
            "No images returned".into(),
            &key,
        );
        return row;
    }
    row["image_request"] = json!("passed");
    for (i, r) in results.iter().enumerate() {
        let decoded = match image::load_from_memory(&r.image.data) {
            Ok(img) if img.width() == r.width && img.height() == r.height => img,
            _ => {
                failure(
                    &mut row,
                    "decode",
                    "invalid_image",
                    "Image bytes or dimensions are invalid".into(),
                    &key,
                );
                return row;
            }
        };
        let filename = format!("{}_{}.png", id.as_str(), i + 1);
        if let Err(e) = decoded.save_with_format(o.out.join(&filename), image::ImageFormat::Png) {
            failure(&mut row, "save", "write_failed", e.to_string(), &key);
            return row;
        }
        row["artifacts"].as_array_mut().unwrap().push(json!({"file": filename,
            "width": r.width, "height": r.height, "model": r.model, "estimated_cost_usd": r.cost_usd}));
    }
    row["status"] = json!("passed");
    row
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|s| s == "--help" || s == "-h") {
        println!("{HELP}");
        return;
    }
    let code = match run(args).await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("{e}");
            2
        }
    };
    std::process::exit(code);
}

async fn run(args: Vec<String>) -> Result<i32, String> {
    let o = parse(args)?;
    let input = if let Some(path) = &o.edit {
        let bytes = std::fs::read(path).map_err(|e| format!("Cannot read edit input: {e}"))?;
        if image::guess_format(&bytes).ok() != Some(image::ImageFormat::Png) {
            return Err("Edit input must be a PNG".into());
        }
        image::load_from_memory(&bytes).map_err(|e| format!("Invalid edit image: {e}"))?;
        Some(ImageBytes::png(bytes))
    } else {
        None
    };
    if let Some(parent) = o.out.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create output parent: {e}"))?;
    }
    std::fs::create_dir(&o.out)
        .map_err(|e| format!("Output directory must be new and writable: {e}"))?;
    let ids = if o.providers.is_empty() {
        ProviderId::BUILTIN.to_vec()
    } else {
        o.providers.clone()
    };
    let mut rows = vec![];
    for id in ids {
        let row = verify(&id, &o, input.as_ref()).await;
        println!(
            "[{id}] {}{}",
            row["status"].as_str().unwrap_or("unknown"),
            row["failed_stage"]
                .as_str()
                .map(|s| format!(" at {s}"))
                .unwrap_or_default()
        );
        rows.push(row);
    }
    let passed = rows.iter().filter(|r| r["status"] == "passed").count();
    let failed = rows.iter().filter(|r| r["status"] == "failed").count();
    let ok = passed > 0 && failed == 0;
    let report = json!({"schema_version": 1, "timestamp_unix": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        "mode": if o.check_only { "metadata_only" } else if input.is_some() { "instruct_edit" } else { "generate" },
        "success": ok, "oauth_tested": false, "editor_ui_tested": false,
        "all_three_vendor_images_verified": !o.check_only && rows.len() == 3 && rows.iter().all(|r| r["status"] == "passed" && r["endpoint"] == "vendor"),
        "providers": rows});
    let path = o.out.join("report.json");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Cannot write report: {e}"))?;
    println!("Report: {}", path.display());
    Ok(if ok { 0 } else { 1 })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options(args: &[&str]) -> Result<Options, String> {
        parse(args.iter().map(|s| (*s).into()))
    }
    #[test]
    fn all_is_an_option_and_words_form_one_prompt() {
        let o = options(&["--all", "a", "red", "cube"]).unwrap();
        assert!(o.all);
        assert_eq!(o.prompt, "a red cube");
        assert!(options(&["--all", "--provider", "gemini"]).is_err());
    }
    #[test]
    fn malformed_options_never_fall_through_to_paid_defaults() {
        for args in [
            &["--size"][..],
            &["--edit"],
            &["--provider", "unknown"],
            &["--size", "0x16"],
            &["--wat"],
            &["--prompt", ""],
            &["--out", "--check-only"],
            &["--prompt", "--check-only"],
        ] {
            assert!(options(args).is_err(), "{args:?}");
        }
    }
    #[test]
    fn provider_selection_and_read_only_mode() {
        let o = options(&[
            "--provider",
            "openai",
            "--provider",
            "gemini",
            "--check-only",
        ])
        .unwrap();
        assert_eq!(o.providers, vec![ProviderId::OpenAi, ProviderId::Gemini]);
        assert!(o.check_only);
    }
    #[test]
    fn error_details_redact_even_unusual_credentials() {
        let mut row = json!({});
        failure(
            &mut row,
            "authentication",
            "auth",
            "bad credential unusual-secret".into(),
            &SecretString::new("unusual-secret"),
        );
        assert_eq!(row["message"], "bad credential [REDACTED]");
    }
}
