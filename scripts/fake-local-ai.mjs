#!/usr/bin/env node
/**
 * Fake *local / custom* AI servers for QA of the custom provider kinds without installing
 * anything (shapes from docs/ai-research.md section 4). One process answers every kind on
 * one port; add each kind in Edit > AI Providers with the base URL below.
 *
 *   node scripts/fake-local-ai.mjs [--port 8790] [--size 512] [--delay 1500]
 *
 * | kind in the dialog              | base URL                            | model / checkpoint              |
 * |---------------------------------|-------------------------------------|---------------------------------|
 * | OpenAI-compatible server        | http://127.0.0.1:8790               | fake-sd-turbo (Fetch models)    |
 * | Hugging Face (Endpoint)         | http://127.0.0.1:8790/models/fake-sdxl | any                          |
 * | Hugging Face (router, probing)  | add `"hubUrl": "http://127.0.0.1:8790"` in Advanced extra; model fake/sdxl |
 * | Ollama                          | http://127.0.0.1:8790               | llava:fake (Fetch models)       |
 * | ComfyUI                         | http://127.0.0.1:8790               | fake_xl.safetensors (Fetch)     |
 * | Stable Diffusion WebUI / Forge  | http://127.0.0.1:8790               | fake-v1-5.safetensors [abc123]  |
 * | Replicate                       | http://127.0.0.1:8790               | fake/flux-schnell               |
 *
 * Endpoints:
 *   OpenAI-compat  GET /v1/models · POST /v1/images/generations (JSON) · POST /v1/images/edits (multipart)
 *   Hugging Face   POST /models/<model> (JSON {inputs, parameters}) -> image/png bytes ·
 *                  GET /api/models?search= · GET /api/models/<owner>/<name>
 *   Ollama         GET /api/tags · GET /api/version · POST /api/chat ({messages[].images}) ·
 *                  POST /api/generate (text only, no image output: mirrors the real API)
 *   ComfyUI        GET /system_stats · GET /object_info/CheckpointLoaderSimple · POST /upload/image ·
 *                  POST /prompt · GET /history/<id> · GET /view?filename=
 *   A1111 / Forge  GET /sdapi/v1/sd-models · GET /sdapi/v1/options · GET /sdapi/v1/samplers ·
 *                  POST /sdapi/v1/txt2img · POST /sdapi/v1/img2img (mask -> MASK label)
 *   Replicate      GET /v1/models/<owner>/<name> · POST /v1/models/<owner>/<name>/predictions ·
 *                  POST /v1/predictions · GET /v1/predictions/<id> · GET /outputs/<id>.png
 *
 * Error simulation (prompt tokens): `!429` rate limit, `!401` auth, `!500` server error,
 * `!slow` 20 s delay, `!block` moderation. Send `Authorization: Bearer bad` to get 401 from
 * the probe endpoints that take auth.
 */

import http from "node:http";
import { drawImage, json, parseMultipart, pngSize, readBody, sleep } from "./fake-ai-draw.mjs";

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const PORT = Number(argOf("--port", process.env.PORT ?? "8790"));
const SIZE = Number(argOf("--size", "512"));
const DELAY = Number(argOf("--delay", "1200"));

const ts = () => new Date().toISOString().slice(11, 19);
const b64png = (buf) => buf.toString("base64");
const fromB64 = (s) => (typeof s === "string" ? Buffer.from(s.replace(/^data:[^,]*,/, ""), "base64") : null);
const clampSize = (w, h) => [Math.max(64, Math.min(2048, w || SIZE)), Math.max(64, Math.min(2048, h || SIZE))];

async function simulate(prompt, res) {
  if (/!slow/.test(prompt)) await sleep(20_000);
  if (/!429/.test(prompt)) return json(res, 429, { error: { message: "Rate limit reached (fake). Try again in 7 seconds." } }, { "retry-after": "7" }), true;
  if (/!401/.test(prompt)) return json(res, 401, { error: { message: "Invalid token (fake)." } }), true;
  if (/!500/.test(prompt)) return json(res, 500, { error: { message: "Server error (fake)." } }), true;
  if (/!block/.test(prompt)) return json(res, 400, { error: { message: "Prompt rejected by the safety checker (fake).", code: "moderation_blocked" } }), true;
  return false;
}
function badAuth(req) {
  const auth = req.headers.authorization ?? "";
  const tok = auth.replace(/^(Bearer|Basic|Key)\s+/i, "");
  return tok === "bad" || tok.startsWith("bad-");
}

// Shared state for async kinds.
const comfyUploads = new Map(); // name -> bytes
const comfyJobs = new Map(); // prompt_id -> { done: bool, images: [{filename}], error? }
const comfyFiles = new Map(); // filename -> bytes
const replicateJobs = new Map(); // id -> { status, output }
const outputs = new Map(); // id -> bytes
let seq = 0;
const nextId = (p) => `${p}-${++seq}-${Date.now().toString(36)}`;

function render({ provider, prompt, mode, n, width, height }) {
  const [w, h] = clampSize(width, height);
  const list = [];
  for (let i = 0; i < Math.max(1, Math.min(4, n)); i++) list.push(drawImage({ width: w, height: h, provider, prompt: n > 1 ? `${prompt} ${i + 1}/${n}` : prompt, mode }));
  return list;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";
  try {
    if (path === "/healthz") return json(res, 200, { ok: true });

    // ---------------------------------------------------------- OpenAI-compatible
    if (method === "GET" && path === "/v1/models") {
      if (badAuth(req)) return json(res, 401, { error: { message: "Incorrect API key (fake)." } });
      return json(res, 200, { object: "list", data: [{ id: "fake-sd-turbo" }, { id: "fake-flux" }] });
    }
    if (method === "POST" && (path === "/v1/images/generations" || path === "/v1/images/edits")) {
      const body = await readBody(req);
      const ct = req.headers["content-type"] ?? "";
      let prompt = "", n = 1, size = null, mode = "gen", model = "";
      if (ct.startsWith("multipart/form-data")) {
        const { fields, files } = parseMultipart(body, ct);
        prompt = fields.prompt ?? "";
        n = Number(fields.n ?? 1);
        size = fields.size ?? null;
        model = fields.model ?? "";
        mode = files.mask ? "mask" : "edit";
        const s = pngSize(files.image?.[0] ?? files["image[]"]?.[0]);
        if (s && !size) size = `${s.width}x${s.height}`;
      } else {
        const j = JSON.parse(body.toString("utf8") || "{}");
        prompt = j.prompt ?? "";
        n = Number(j.n ?? 1);
        size = j.size ?? null;
        model = j.model ?? "";
      }
      console.log(`${ts()} openai-compat ${path} model=${model} n=${n} size=${size} prompt="${prompt.slice(0, 50)}"`);
      if (await simulate(prompt, res)) return;
      await sleep(DELAY);
      const m = /^(\d+)x(\d+)$/.exec(size ?? "");
      const imgs = render({ provider: "localai", prompt, mode, n, width: m ? Number(m[1]) : SIZE, height: m ? Number(m[2]) : SIZE });
      return json(res, 200, { created: Math.floor(Date.now() / 1000), data: imgs.map((b) => ({ b64_json: b64png(b) })) });
    }

    // ---------------------------------------------------------- Hugging Face
    if (method === "POST" && path.startsWith("/models/")) {
      if (badAuth(req) || !req.headers.authorization) return json(res, 401, { error: "Invalid credentials in Authorization header (fake)" });
      const model = path.slice("/models/".length);
      const j = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const p = j.parameters ?? {};
      const input = typeof j.inputs === "string" && j.inputs.startsWith("iVBOR") ? fromB64(j.inputs) : null;
      const prompt = input ? (p.prompt ?? "") : (j.inputs ?? "");
      const s = input ? pngSize(input) : null;
      console.log(`${ts()} hf ${model} mode=${input ? "img2img" : "txt2img"} cache=${req.headers["x-use-cache"]} wait=${req.headers["x-wait-for-model"]} prompt="${String(prompt).slice(0, 50)}"`);
      if (await simulate(String(prompt), res)) return;
      await sleep(DELAY);
      const png = drawImage({ width: clampSize(p.width ?? s?.width, p.height ?? s?.height)[0], height: clampSize(p.width ?? s?.width, p.height ?? s?.height)[1], provider: "hf", prompt: String(prompt), mode: input ? "edit" : "gen" });
      res.writeHead(200, { "content-type": "image/png", "content-length": png.length });
      return res.end(png);
    }
    if (method === "GET" && path === "/models/fake-sdxl") return json(res, 200, { ok: true, model: "fake-sdxl" }); // dedicated-endpoint probe
    if (method === "GET" && path === "/api/models") {
      const q = (url.searchParams.get("search") ?? "").toLowerCase();
      const tag = url.searchParams.get("pipeline_tag") ?? "text-to-image";
      const all = [
        { id: "fake/sdxl", modelId: "fake/sdxl", pipeline_tag: "text-to-image", downloads: 123456, likes: 789, gated: false },
        { id: "fake/flux-schnell", modelId: "fake/flux-schnell", pipeline_tag: "text-to-image", downloads: 99999, likes: 500, gated: "auto" },
        { id: "fake/kontext", modelId: "fake/kontext", pipeline_tag: "image-to-image", downloads: 4242, likes: 42, gated: false },
      ];
      return json(res, 200, all.filter((m) => m.pipeline_tag === tag && m.id.includes(q)).slice(0, Number(url.searchParams.get("limit") ?? 20)));
    }
    const hm = /^\/api\/models\/([^/]+\/[^/]+)$/.exec(path);
    if (method === "GET" && hm) return json(res, 200, { id: hm[1], modelId: hm[1], pipeline_tag: hm[1].includes("kontext") ? "image-to-image" : "text-to-image", downloads: 123456, likes: 789, gated: false, author: hm[1].split("/")[0] });

    // ---------------------------------------------------------- Ollama
    if (method === "GET" && path === "/api/tags") {
      return json(res, 200, { models: [
        { name: "llama3.2:3b", model: "llama3.2:3b", size: 2019393189, details: { family: "llama", families: ["llama"], parameter_size: "3.2B" } },
        { name: "llava:fake", model: "llava:fake", size: 4733363377, details: { family: "llama", families: ["llama", "clip"], parameter_size: "7B" } },
      ] });
    }
    if (method === "GET" && path === "/api/version") return json(res, 200, { version: "0.12.1-fake" });
    if (method === "POST" && path === "/api/chat") {
      const j = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const msg = j.messages?.[j.messages.length - 1] ?? {};
      const hasImage = Array.isArray(msg.images) && msg.images.length > 0;
      const req_ = /Prompt: (.*)$/s.exec(msg.content ?? "")?.[1] ?? /Request: (.*)$/s.exec(msg.content ?? "")?.[1] ?? "";
      console.log(`${ts()} ollama chat model=${j.model} image=${hasImage} text="${req_.slice(0, 50)}"`);
      await sleep(Math.min(DELAY, 800));
      const improved = hasImage
        ? `${req_.trim() || "The attached picture"}, rendered as a detailed illustration that matches the attached image's warm lighting, centred composition and muted palette, 85 mm lens, soft shadows (fake ${j.model})`
        : `${req_.trim() || "An image"}, highly detailed, cinematic lighting, rich colour, sharp focus, 4k (fake ${j.model})`;
      return json(res, 200, { model: j.model, created_at: new Date().toISOString(), message: { role: "assistant", content: improved }, done: true });
    }
    if (method === "POST" && path === "/api/generate") {
      const j = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      return json(res, 200, { model: j.model, response: "Ollama's HTTP API returns text only (fake); image generation is CLI-only on macOS.", done: true });
    }

    // ---------------------------------------------------------- ComfyUI
    if (method === "GET" && path === "/system_stats") {
      return json(res, 200, { system: { os: "nt", ram_total: 34359738368, ram_free: 20000000000, comfyui_version: "0.3.40-fake", python_version: "3.12.4", pytorch_version: "2.5.1+cu124" }, devices: [{ name: "cuda:0 Fake GPU", type: "cuda", index: 0, vram_total: 4294967296, vram_free: 3500000000 }] });
    }
    if (method === "GET" && path === "/object_info/CheckpointLoaderSimple") {
      return json(res, 200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["fake_xl.safetensors", "fake_v1-5.ckpt"], { tooltip: "fake" }] } }, output: ["MODEL", "CLIP", "VAE"], output_name: ["MODEL", "CLIP", "VAE"], name: "CheckpointLoaderSimple", category: "loaders" } });
    }
    if (method === "POST" && path === "/upload/image") {
      const { fields, files } = parseMultipart(await readBody(req), req.headers["content-type"] ?? "");
      const bytes = files.image?.[0] ?? Buffer.alloc(0);
      const name = `${nextId("up")}.png`;
      comfyUploads.set(name, bytes);
      console.log(`${ts()} comfy upload ${name} (${bytes.length} bytes, type=${fields.type ?? "input"})`);
      return json(res, 200, { name, subfolder: fields.subfolder ?? "", type: fields.type ?? "input" });
    }
    if (method === "POST" && path === "/prompt") {
      const j = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const wf = j.prompt ?? {};
      const text = JSON.stringify(wf);
      const left = text.match(/\{\{[a-z]+\}\}/gi);
      if (left) return json(res, 400, { error: { type: "invalid_prompt", message: "Cannot execute because a node has unfilled placeholders", details: left.join(", "), extra_info: {} }, node_errors: {} });
      const nodes = Object.values(wf);
      const ckpt = nodes.find((n) => n.class_type === "CheckpointLoaderSimple")?.inputs?.ckpt_name;
      if (ckpt && !["fake_xl.safetensors", "fake_v1-5.ckpt"].includes(ckpt)) {
        const id = Object.keys(wf).find((k) => wf[k].class_type === "CheckpointLoaderSimple");
        return json(res, 400, { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "", extra_info: {} }, node_errors: { [id]: { errors: [{ type: "value_not_in_list", message: `Value not in list: ckpt_name: '${ckpt}' not in ['fake_xl.safetensors', 'fake_v1-5.ckpt']`, details: "" }], dependent_outputs: [], class_type: "CheckpointLoaderSimple" } } });
      }
      const ks = nodes.find((n) => n.class_type === "KSampler")?.inputs ?? {};
      const positiveId = Array.isArray(ks.positive) ? ks.positive[0] : null;
      const prompt = wf[positiveId]?.inputs?.text ?? nodes.find((n) => n.class_type === "CLIPTextEncode")?.inputs?.text ?? "";
      const latent = nodes.find((n) => n.class_type === "EmptyLatentImage")?.inputs;
      const loads = nodes.filter((n) => n.class_type === "LoadImage");
      const batch = Number(latent?.batch_size ?? nodes.find((n) => n.class_type === "RepeatLatentBatch")?.inputs?.amount ?? 1);
      const mode = nodes.some((n) => n.class_type === "VAEEncodeForInpaint" || n.class_type === "SetLatentNoiseMask") ? "mask" : loads.length ? "edit" : "gen";
      const input = loads.length ? comfyUploads.get(loads[0].inputs?.image) : null;
      const s = input ? pngSize(input) : null;
      const promptId = nextId("pid");
      console.log(`${ts()} comfy prompt ${promptId} mode=${mode} batch=${batch} ckpt=${ckpt} seed=${ks.seed} steps=${ks.steps} prompt="${String(prompt).slice(0, 50)}"`);
      comfyJobs.set(promptId, { done: false, images: [] });
      const fail = /!500|!block|!401|!429/.test(String(prompt));
      setTimeout(() => {
        const job = comfyJobs.get(promptId);
        if (!job) return;
        if (fail) {
          job.done = true;
          job.error = "fake execution error: prompt contained a failure token";
          return;
        }
        const imgs = render({ provider: "comfyui", prompt: String(prompt), mode, n: batch, width: Number(latent?.width ?? s?.width ?? SIZE), height: Number(latent?.height ?? s?.height ?? SIZE) });
        for (const b of imgs) {
          const filename = `pixelforge_${String(++seq).padStart(5, "0")}_.png`;
          comfyFiles.set(filename, b);
          job.images.push({ filename, subfolder: "", type: "output" });
        }
        job.done = true;
      }, /!slow/.test(String(prompt)) ? 20_000 : DELAY);
      return json(res, 200, { prompt_id: promptId, number: comfyJobs.size, node_errors: {} });
    }
    const hist = /^\/history\/(.+)$/.exec(path);
    if (method === "GET" && hist) {
      const job = comfyJobs.get(hist[1]);
      if (!job || !job.done) return json(res, 200, {});
      if (job.error) return json(res, 200, { [hist[1]]: { prompt: [], outputs: {}, status: { status_str: "error", completed: false, messages: [["execution_start", {}], ["execution_error", { exception_message: job.error }]] } } });
      return json(res, 200, { [hist[1]]: { prompt: [], outputs: { 9: { images: job.images } }, status: { status_str: "success", completed: true, messages: [] } } });
    }
    if (method === "GET" && path === "/view") {
      const bytes = comfyFiles.get(url.searchParams.get("filename") ?? "");
      if (!bytes) return json(res, 404, { error: "no such file" });
      res.writeHead(200, { "content-type": "image/png", "content-length": bytes.length });
      return res.end(bytes);
    }
    if (method === "POST" && path === "/interrupt") return json(res, 200, {});

    // ---------------------------------------------------------- A1111 / Forge
    if (method === "GET" && path === "/sdapi/v1/sd-models") {
      if (badAuth(req)) return json(res, 401, { detail: "Not authenticated (fake)" });
      return json(res, 200, [
        { title: "fake-v1-5.safetensors [abc123]", model_name: "fake-v1-5", hash: "abc123", sha256: "abc123", filename: "C:/fake/models/fake-v1-5.safetensors", config: null },
        { title: "fake-xl.safetensors [def456]", model_name: "fake-xl", hash: "def456", sha256: "def456", filename: "C:/fake/models/fake-xl.safetensors", config: null },
      ]);
    }
    if (method === "GET" && path === "/sdapi/v1/options") return json(res, 200, { sd_model_checkpoint: "fake-v1-5.safetensors [abc123]" });
    if (method === "GET" && path === "/sdapi/v1/samplers") return json(res, 200, [{ name: "Euler a", aliases: ["k_euler_a"], options: {} }, { name: "DPM++ 2M", aliases: [], options: {} }]);
    if (method === "POST" && (path === "/sdapi/v1/txt2img" || path === "/sdapi/v1/img2img")) {
      const j = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const prompt = j.prompt ?? "";
      const init = Array.isArray(j.init_images) ? fromB64(j.init_images[0]) : null;
      const s = init ? pngSize(init) : null;
      const mode = j.mask ? "mask" : init ? "edit" : "gen";
      console.log(`${ts()} a1111 ${path} mode=${mode} ckpt=${j.override_settings?.sd_model_checkpoint} steps=${j.steps} cfg=${j.cfg_scale} sampler=${j.sampler_name} batch=${j.batch_size} fill=${j.inpainting_fill} prompt="${prompt.slice(0, 50)}"`);
      if (await simulate(prompt, res)) return;
      await sleep(DELAY);
      const imgs = render({ provider: "webui", prompt, mode, n: Number(j.batch_size ?? 1), width: Number(j.width ?? s?.width ?? SIZE), height: Number(j.height ?? s?.height ?? SIZE) });
      return json(res, 200, { images: imgs.map(b64png), parameters: j, info: JSON.stringify({ prompt, seed: j.seed === -1 ? 123456 : j.seed, sampler_name: j.sampler_name }) });
    }
    if (method === "GET" && path === "/sdapi/v1/progress") return json(res, 200, { progress: 0, eta_relative: 0, state: {}, current_image: null, textinfo: null });

    // ---------------------------------------------------------- Replicate
    const rm = /^\/v1\/models\/([^/]+\/[^/]+)$/.exec(path);
    if (method === "GET" && rm) {
      if (badAuth(req)) return json(res, 401, { detail: "Invalid token (fake)" });
      return json(res, 200, { url: `https://replicate.com/${rm[1]}`, owner: rm[1].split("/")[0], name: rm[1].split("/")[1], latest_version: { id: "fakeversion0123456789abcdef" } });
    }
    const rp = /^\/v1\/models\/([^/]+\/[^/]+)\/predictions$/.exec(path);
    if (method === "POST" && (rp || path === "/v1/predictions")) {
      if (badAuth(req)) return json(res, 401, { detail: "Invalid token (fake)" });
      const j = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const input = j.input ?? {};
      const prompt = input.prompt ?? "";
      const img = fromB64(input.image);
      const s = img ? pngSize(img) : null;
      const mode = input.mask ? "mask" : img ? "edit" : "gen";
      const id = nextId("pred");
      console.log(`${ts()} replicate ${rp ? rp[1] : j.version} mode=${mode} n=${input.num_outputs} prefer=${req.headers.prefer} prompt="${prompt.slice(0, 50)}"`);
      if (await simulate(prompt, res)) return;
      replicateJobs.set(id, { status: "processing", output: null, error: null });
      setTimeout(() => {
        const imgs = render({ provider: "replicate", prompt, mode, n: Number(input.num_outputs ?? 1), width: Number(input.width ?? s?.width ?? SIZE), height: Number(input.height ?? s?.height ?? SIZE) });
        const urls = imgs.map((b, i) => {
          outputs.set(`${id}-${i}`, b);
          return `http://127.0.0.1:${PORT}/outputs/${id}-${i}.png`;
        });
        replicateJobs.set(id, { status: "succeeded", output: urls, error: null });
      }, DELAY);
      const pred = { id, status: "processing", output: null, error: null, urls: { get: `http://127.0.0.1:${PORT}/v1/predictions/${id}`, cancel: `http://127.0.0.1:${PORT}/v1/predictions/${id}/cancel` } };
      return json(res, 201, pred);
    }
    const rg = /^\/v1\/predictions\/([^/]+)$/.exec(path);
    if (method === "GET" && rg) {
      const job = replicateJobs.get(rg[1]);
      if (!job) return json(res, 404, { detail: "Not found" });
      return json(res, 200, { id: rg[1], status: job.status, output: job.output, error: job.error, urls: { get: `http://127.0.0.1:${PORT}/v1/predictions/${rg[1]}` } });
    }
    const ro = /^\/outputs\/(.+)\.png$/.exec(path);
    if (method === "GET" && ro) {
      const bytes = outputs.get(ro[1]);
      if (!bytes) return json(res, 404, { detail: "Not found" });
      res.writeHead(200, { "content-type": "image/png", "content-length": bytes.length });
      return res.end(bytes);
    }

    json(res, 404, { error: { message: `no route for ${method} ${path}` } });
  } catch (e) {
    console.error(`${ts()} ${path} failed:`, e);
    json(res, 500, { error: { message: String(e) } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake-local-ai listening on http://127.0.0.1:${PORT} (image ${SIZE}px, delay ${DELAY} ms)`);
  console.log("kinds: openai_compat · hugging_face (base http://127.0.0.1:%d/models/fake-sdxl) · ollama · comfy_ui · a1111 · replicate", PORT);
});
