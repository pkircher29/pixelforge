# `crates/pf-ai/workflows` — Bundled ComfyUI API Workflows

Default ComfyUI API-format workflow templates embedded at compile time (`include_str!`) by `crates/pf-ai/src/providers/custom/comfy.rs` and exposed to the UI via `ai_comfy_templates`.

## Template Placeholders

ComfyUI workflows substitute these placeholders before submission to `POST /prompt`:
- `{{PROMPT}}`, `{{NEGATIVE_PROMPT}}`
- `{{CHECKPOINT}}`
- `{{WIDTH}}`, `{{HEIGHT}}`
- `{{SEED}}`, `{{STEPS}}`, `{{CFG}}`, `{{SAMPLER}}`, `{{SCHEDULER}}`, `{{DENOISE}}`
- `{{IMAGE}}` (`img2img.json`, `inpaint.json`) and `{{MASK}}` (`inpaint.json`)

## Files

| File | Workflow Kind | Description |
|---|---|---|
| `txt2img.json` | `WorkflowKind::Txt2Img` | CheckpointLoaderSimple + EmptyLatentImage + CLIPTextEncode + KSampler + VAEDecode + SaveImage. |
| `img2img.json` | `WorkflowKind::Img2Img` | LoadImage + VAEEncode + KSampler (denoise) + VAEDecode + SaveImage. |
| `inpaint.json` | `WorkflowKind::Inpaint` | LoadImage (composite + mask) + SetLatentNoiseMask + KSampler + VAEDecode + SaveImage. |
