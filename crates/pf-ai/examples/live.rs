//! Live smoke test against the real providers. **Not run in CI** - it spends money.
//!
//! ```text
//! $env:PF_OPENAI_KEY='sk-...'; $env:PF_XAI_KEY='xai-...'; $env:PF_GEMINI_KEY='AIza...'
//! cargo run -p pf-ai --example live -- [--size 1024x1024] [--edit input.png] [prompt]
//! ```
//!
//! For each key that is set it runs `test_key`, then one tiny generate (or one
//! instruct-edit of `--edit <file>`), writing `live_<provider>.png` to the current
//! directory and printing size, cost and timing. Providers without a key are skipped.

use std::time::Instant;

use pf_ai::{
    build_provider, AuthMethod, EditRequest, GenerateRequest, ImageBytes, ImageSize, ProviderId,
    SecretString,
};

fn env_key(name: &str) -> Option<SecretString> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
        .map(SecretString::new)
}

fn parse_size(s: &str) -> Option<ImageSize> {
    let (w, h) = s.split_once('x')?;
    Some(ImageSize::new(w.parse().ok()?, h.parse().ok()?))
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let mut size = Some(ImageSize::new(1024, 1024));
    let mut edit_path: Option<String> = None;
    let mut prompt = "A tiny glossy red cube on a white table, studio light".to_owned();
    while let Some(a) = args.next() {
        match a.as_str() {
            "--size" => size = args.next().as_deref().and_then(parse_size),
            "--edit" => edit_path = args.next(),
            other => prompt = other.to_owned(),
        }
    }

    let keys = [
        (ProviderId::OpenAi, env_key("PF_OPENAI_KEY")),
        (ProviderId::XAi, env_key("PF_XAI_KEY")),
        (ProviderId::Gemini, env_key("PF_GEMINI_KEY")),
    ];
    if keys.iter().all(|(_, k)| k.is_none()) {
        eprintln!("set PF_OPENAI_KEY / PF_XAI_KEY / PF_GEMINI_KEY to run this example");
        std::process::exit(2);
    }

    let edit_input = edit_path.as_ref().map(|p| {
        let bytes = std::fs::read(p).unwrap_or_else(|e| panic!("cannot read {p}: {e}"));
        ImageBytes::png(bytes)
    });

    let mut failures = 0;
    for (id, key) in keys {
        let Some(key) = key else {
            println!("[{id}] no key, skipped");
            continue;
        };
        let provider = match build_provider(&id, AuthMethod::ApiKey(key)) {
            Ok(p) => p,
            Err(e) => {
                println!("[{id}] cannot build provider: {e}");
                failures += 1;
                continue;
            }
        };

        print!("[{id}] test_key ... ");
        match provider.test_key().await {
            Ok(()) => println!("ok"),
            Err(e) => {
                println!("FAILED: [{}] {e}", e.code());
                failures += 1;
                continue;
            }
        }

        let started = Instant::now();
        let result = match &edit_input {
            Some(img) => {
                let req = EditRequest {
                    size,
                    ..EditRequest::instruct(prompt.clone(), img.clone())
                };
                provider.edit(req).await
            }
            None => {
                provider
                    .generate(GenerateRequest {
                        prompt: prompt.clone(),
                        size,
                        ..GenerateRequest::default()
                    })
                    .await
            }
        };
        match result {
            Ok(results) => {
                for (i, r) in results.iter().enumerate() {
                    let name = if i == 0 {
                        format!("live_{}.png", id.as_str())
                    } else {
                        format!("live_{}_{i}.png", id.as_str())
                    };
                    if let Err(e) = std::fs::write(&name, &r.image.data) {
                        println!("[{id}] cannot write {name}: {e}");
                    }
                    println!(
                        "[{id}] {name}: {}x{} {} bytes model={} cost={} revised={:?} in {:.1}s",
                        r.width,
                        r.height,
                        r.image.len(),
                        r.model,
                        r.cost_usd.map_or("?".to_owned(), |c| format!("${c:.4}")),
                        r.revised_prompt.as_deref().map(|s| &s[..s.len().min(60)]),
                        started.elapsed().as_secs_f32()
                    );
                }
            }
            Err(e) => {
                println!(
                    "[{id}] FAILED after {:.1}s: [{}] {e}",
                    started.elapsed().as_secs_f32(),
                    e.code()
                );
                failures += 1;
            }
        }
    }
    if failures > 0 {
        std::process::exit(1);
    }
}
