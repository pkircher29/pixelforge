# AI verification report

The harness checks the built-in providers through their real adapters and writes a
`report.json` plus decoded PNG results to a new directory. It does not test OAuth
sign-in, editor UI behavior, masked edits, or account subscription entitlements.

Supply `PF_OPENAI_KEY`, `PF_XAI_KEY`, and `PF_GEMINI_KEY` in the process environment.
The harness does not read the editor's saved keys. In Git Bash, an interactive prompt
keeps a key out of shell history (repeat with the corresponding variable for each
provider):

```bash
read -rsp 'OpenAI API key: ' PF_OPENAI_KEY
export PF_OPENAI_KEY
```

For free authentication and model-metadata checks:

```bash
cargo run -p pf-ai --example live -- --all --check-only
```

To test real image generation, the following makes one image request per provider
and can incur API charges:

```bash
cargo run -p pf-ai --example live -- --all
```

To test a single provider, use `--provider open_ai`, `--provider x_ai`, or
`--provider gemini` instead of `--all`. Repeat `--provider` to select a subset.
Without either option, providers with absent keys are explicitly skipped. With
`--all`, any absent key fails the run rather than silently satisfying the gate.

Use `--edit input.png` for an instruction-edit test; this also can incur charges.
The input must be a readable PNG. `--size 1024x1024` and `--prompt 'your prompt'`
set the request. Unknown or malformed options stop before any provider calls.
Requests time out after 30 seconds for metadata or 180 seconds for images, with no
automatic retry. A timed-out image request may still have incurred a vendor charge.

Each run defaults to a unique `live-results/<id>` directory. `--out <directory>`
chooses another new directory; existing directories are rejected to preserve prior
evidence. Keep reports and images out of version control. Clear the key variables
after use with `unset PF_OPENAI_KEY PF_XAI_KEY PF_GEMINI_KEY`.

On Windows, use the MSVC toolchain; this workspace's build example is:

```bash
CARGO_TARGET_DIR=D:/cargo-target/pixelforge-msvc \
cargo +stable-x86_64-pc-windows-msvc run -p pf-ai --example live -- --all --check-only
```

## Reading the report

- Exit `0`: at least one selected provider passed and none failed. Inspect skipped
  providers before treating a run without `--all` as complete.
- Exit `1`: a provider failed or no provider ran. The report records the failed stage
  and provider error, with the supplied credential redacted from error messages.
- Exit `2`: invocation, input or output setup failed, or the report could not be
  written. A report may be unavailable.
- `mode: metadata_only` never proves successful image generation.
- `endpoint: override` identifies a configured `PF_AI_BASE_URL_*` endpoint. It is
  never counted toward `all_three_vendor_images_verified`, even if all calls pass.
- Image success requires a nonempty result, decodable image bytes with matching
  dimensions, and successful PNG writes. Authentication alone cannot satisfy it.
- The three-provider flag applies only to the recorded operation (generate or
  instruction edit). It does not establish both workflows, OAuth, or editor behavior.

The report omits the prompt, input path, keys and full endpoint URLs. It contains
model names, dimensions, timings, error details and estimated costs when returned
by the adapter; these are not a billing statement.

For local development use `scripts/fake-ai-server.mjs` and dummy keys with
`PF_AI_BASE_URL_OPENAI`, `PF_AI_BASE_URL_XAI`, and `PF_AI_BASE_URL_GEMINI` set to that
server. Local results verify the harness, not customer access to the providers.

The repeatable local regression check starts its own loopback server, replaces all
three process keys with dummy values, and retains evidence under `live-results`:

```bash
cargo build -p pf-ai --example live
python scripts/verify-live-harness.py --binary target/debug/examples/live
```

On Windows use the actual `.exe` path, including `CARGO_TARGET_DIR` if configured.
The check covers metadata-only requests, three-provider generation and editing,
quota rejection, missing and rejected keys, invalid options, failed artifact writes,
and preservation of existing output directories. It was verified on Windows on
2026-10-07; no live vendor image request was part of that run.
