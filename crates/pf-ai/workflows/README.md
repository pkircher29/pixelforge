# `crates/pf-ai/workflows` — Bundled ComfyUI API Workflows

Default ComfyUI API-format workflow templates embedded at compile time (`include_str!`) by `crates/pf-ai/src/providers/custom/comfy.rs` and exposed to the UI via `ai_comfy_templates`.

## Template Placeholders

ComfyUI workflows substitute these 14 lowercase placeholders (`comfy.rs::PLACEHOLDERS`) before submission to `POST /prompt`:
- `{{prompt}}`, `{{negative}}`
- `{{checkpoint}}`
- `{{width}}`, `{{height}}`
- `{{seed}}`, `{{steps}}`, `{{cfg}}`, `{{sampler}}`, `{{scheduler}}`, `{{denoise}}`, `{{batch}}`
- `{{image}}` (`img2img.json`, `inpaint.json`) and `{{mask}}` (`inpaint.json`)

When a placeholder appears as a standalone JSON string value (e.g. `"{{seed}}"`), numeric placeholders (`width`, `height`, `seed`, `steps`, `cfg`, `denoise`, `batch`) are replaced with unquoted JSON numbers; string placeholders (`prompt`, `negative`, `image`, `mask`, `checkpoint`, `sampler`, `scheduler`) are JSON-escaped inside quotes.

## Files

| File | Workflow Kind | Description |
|---|---|---|
| `txt2img.json` | `WorkflowKind::Txt2Img` | `CheckpointLoaderSimple` + `EmptyLatentImage` + `CLIPTextEncode` + `KSampler` + `VAEDecode` + `SaveImage`. |
| `img2img.json` | `WorkflowKind::Img2Img` | `CheckpointLoaderSimple` + `LoadImage` + `VAEEncode` + `RepeatLatentBatch` + `CLIPTextEncode` + `KSampler` (denoise) + `VAEDecode` + `SaveImage`. |
| `inpaint.json` | `WorkflowKind::Inpaint` | `CheckpointLoaderSimple` + `LoadImage` (composite + mask) + `ImageToMask` + `VAEEncodeForInpaint` + `RepeatLatentBatch` + `CLIPTextEncode` + `KSampler` + `VAEDecode` + `SaveImage`. |
