# Offline removal with LaMa

In **Edit → AI Providers → + Add → LaMa (offline)**, choose a compatible local ONNX model or click **Download model (208 MB)**. Test the model, then add the provider. Select LaMa in the AI provider picker, select part of an existing image (or paint with Remove), and click **Remove locally** on the selection task bar. No prompt or API key is required. The result is added as a separate layer and can be undone.

The optional download is pinned to [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX), revision `c3c0c9e468934d62e79c329e35d82dd09ff8c444`, `lama_fp32.onnx`. The file is 208,044,816 bytes with SHA-256 `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`. Installation verifies size and checksum before moving the temporary file into the app configuration's `models` directory. Failed downloads leave no partial installed model. The model repository declares Apache-2.0 licensing; consult its model card before redistributing model weights.

Inference runs on the CPU through ONNX Runtime 1.22 (`ort` 2.0.0-rc.10). Windows build output confirms static ONNX Runtime linkage. The model is downloaded separately, not bundled into the application. Inference makes no HTTP requests. First use loads the model; subsequent requests reuse one cached session. Cancel requests terminate an active ONNX run; loading the model itself may finish before cancellation is observed.

LaMa reconstructs selected content from its surroundings; it does not generate new images from descriptions. It requires a partial selection with unselected context. A padded crop is rescaled proportionally to fit 512×512, edge-padded, processed, then resized back. Pixels outside the original mask and original alpha are preserved. Large selections can lose detail. Soft selection coverage is applied once by the editor when adding the result layer.

## Verification

The opt-in real-model test uses a local file and makes no network or paid requests:

```sh
PIXELFORGE_LAMA_MODEL=/path/to/lama_fp32.onnx cargo test -p pf-ai --lib lama::tests::real_model_removes_fixture -- --ignored --nocapture
```

On the development Windows host, the test removed a black rectangle from a controlled background in approximately six seconds, checked that every unselected pixel was unchanged, and wrote before/mask/after artifacts. Unit coverage also checks empty/full mask rejection and alpha preservation. Frontend coverage includes mode resolution for mask-only providers (751 frontend tests passed).

The native Windows app was separately built and exercised through its interface: add a provider with a local model, Test connection, select an area, Remove locally, undo, redo, save, close, reopen, and save again. Decoded layer and selection pixels compared exactly across undo/original, redo/result, and reopened/result projects. No browser page errors occurred. See [native screenshot](screenshots/lama-native.png). The built-in download button, installer packaging, other operating systems, and cloud-provider image generation remain separate verification gates.
