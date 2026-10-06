#!/usr/bin/env node
/**
 * Fake AI provider server for developing / QA-ing the AI pipeline without spending money.
 *
 * Answers the generate / edit endpoints of all three providers with a valid-shape
 * response whose image is a small PNG drawn here (a coloured box with the prompt text
 * rendered in a 5x7 bitmap font), so you can see at a glance which prompt / provider
 * produced a layer. Node >= 18, no dependencies.
 *
 *   node scripts/fake-ai-server.mjs [--port 8787] [--size 512] [--delay 1500]
 *
 * Then start the app with the providers pointed here and any non-empty key stored:
 *
 *   $env:PF_AI_BASE_URL_OPENAI = "http://127.0.0.1:8787"
 *   $env:PF_AI_BASE_URL_XAI    = "http://127.0.0.1:8787"
 *   $env:PF_AI_BASE_URL_GEMINI = "http://127.0.0.1:8787"
 *   npm run tauri dev
 *
 * Endpoints (all accept any key):
 *   GET  /v1/models                                 OpenAI / xAI key test
 *   POST /v1/images/generations                     OpenAI (JSON) + xAI (JSON)
 *   POST /v1/images/edits                           OpenAI (multipart) + xAI (JSON)
 *   GET  /v1beta/models                             Gemini key test
 *   POST /v1beta/models/<model>:generateContent     Gemini
 *   GET  /healthz
 *
 * Error simulation: include one of these tokens in the prompt:
 *   `!429`   -> 429 with Retry-After: 7            (ai_rate_limited)
 *   `!401`   -> 401                                 (ai_auth)
 *   `!500`   -> 500                                 (ai_http)
 *   `!slow`  -> waits 20 s before answering (test cancel / timeouts)
 *   `!block` -> provider moderation response        (ai_moderation_blocked)
 * The key test endpoints return 401 when the Authorization/x-goog-api-key is `bad` or
 * starts with `bad-`, so the "Test" button in the API keys dialog can show an auth error.
 */

import http from "node:http";
import { drawImage, encodePng, json, parseMultipart, readBody, sleep } from "./fake-ai-draw.mjs";

// The PNG encoder / prompt renderer / request helpers are shared with
// scripts/fake-local-ai.mjs (custom & local provider kinds).
export { encodePng };

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const PORT = Number(argOf("--port", process.env.PORT ?? "8787"));
const SIZE = Number(argOf("--size", "512"));
const DELAY = Number(argOf("--delay", "1200"));

/** Simulated failures keyed off tokens in the prompt. Returns true when it answered. */
async function simulate(prompt, provider, res) {
  if (/!slow/.test(prompt)) await sleep(20_000);
  if (/!429/.test(prompt)) {
    json(res, 429, { error: { message: "Rate limit reached for images (fake). Try again in 7 seconds.", type: "rate_limit_error", code: "rate_limit_exceeded" } }, { "retry-after": "7" });
    return true;
  }
  if (/!401/.test(prompt)) {
    json(res, 401, { error: { message: "Incorrect API key provided (fake).", type: "invalid_request_error", code: "invalid_api_key" } });
    return true;
  }
  if (/!500/.test(prompt)) {
    json(res, 500, { error: { message: "The server had an error while processing your request (fake)." } });
    return true;
  }
  if (/!block/.test(prompt)) {
    if (provider === "gemini") json(res, 200, { candidates: [], promptFeedback: { blockReason: "SAFETY", safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", blocked: true }] } });
    else json(res, 400, { error: { message: "Your request was rejected as a result of our safety system (fake).", type: "image_generation_user_error", code: "moderation_blocked" } });
    return true;
  }
  return false;
}

function badKey(req) {
  const auth = req.headers.authorization ?? "";
  const goog = req.headers["x-goog-api-key"] ?? "";
  const tok = auth.replace(/^Bearer\s+/i, "") || goog;
  return !tok || tok === "bad" || tok.startsWith("bad-");
}

let served = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const ts = new Date().toISOString().slice(11, 19);
  try {
    if (path === "/healthz") return json(res, 200, { ok: true, served });

    // ---- key tests
    if (req.method === "GET" && (path === "/v1/models" || path === "/v1beta/models")) {
      if (badKey(req)) {
        console.log(`${ts} ${path} -> 401 (bad key)`);
        return json(res, 401, path.startsWith("/v1beta") ? { error: { code: 401, message: "API key not valid. Please pass a valid API key. (fake)", status: "UNAUTHENTICATED" } } : { error: { message: "Incorrect API key provided: bad (fake).", type: "invalid_request_error", code: "invalid_api_key" } });
      }
      console.log(`${ts} ${path} -> 200`);
      return json(res, 200, path.startsWith("/v1beta") ? { models: [{ name: "models/gemini-3.1-flash-image" }] } : { object: "list", data: [{ id: "gpt-image-2.5-flare" }, { id: "grok-imagine-image-2.0" }] });
    }

    if (req.method !== "POST") return json(res, 404, { error: { message: `no route for ${req.method} ${path}` } });
    const body = await readBody(req);
    const ct = req.headers["content-type"] ?? "";

    // ---- OpenAI / xAI images
    if (path === "/v1/images/generations" || path === "/v1/images/edits") {
      let prompt = "", model = "", n = 1, size = null, inputs = 0, hasMask = false, provider;
      if (ct.startsWith("multipart/form-data")) {
        const { fields, files } = parseMultipart(body, ct);
        provider = "chatgpt";
        prompt = fields.prompt ?? "";
        model = fields.model ?? "gpt-image";
        n = Number(fields.n ?? 1);
        size = fields.size ?? null;
        inputs = (files["image[]"] ?? files.image ?? []).length;
        hasMask = Boolean(files.mask);
      } else {
        const j = JSON.parse(body.toString("utf8") || "{}");
        provider = j.response_format === "b64_json" || j.aspect_ratio || j.resolution ? "grok" : "chatgpt";
        prompt = j.prompt ?? "";
        model = j.model ?? "";
        n = Number(j.n ?? 1);
        size = j.size ?? (j.aspect_ratio ? `${j.aspect_ratio}@${j.resolution ?? "1k"}` : null);
        inputs = j.image ? 1 : Array.isArray(j.images) ? j.images.length : 0;
      }
      const mode = path.endsWith("edits") ? (hasMask ? "mask" : "edit") : "gen";
      console.log(`${ts} ${provider} ${path} model=${model} n=${n} size=${size} inputs=${inputs} mask=${hasMask} prompt="${prompt.slice(0, 60)}"`);
      if (await simulate(prompt, provider, res)) return;
      await sleep(DELAY);
      let [w, h] = [SIZE, SIZE];
      const m = /^(\d+)x(\d+)$/.exec(size ?? "");
      if (m) [w, h] = [Math.min(2048, Number(m[1])), Math.min(2048, Number(m[2]))];
      const data = [];
      for (let i = 0; i < Math.max(1, Math.min(4, n)); i++) data.push({ b64_json: drawImage({ width: w, height: h, provider, prompt: n > 1 ? `${prompt} ${i + 1}/${n}` : prompt, mode }).toString("base64"), revised_prompt: `(fake) ${prompt}` });
      served += data.length;
      return json(res, 200, { created: Math.floor(Date.now() / 1000), model, data, usage: { input_tokens: 50, output_tokens: 1000, input_tokens_details: { image_tokens: inputs * 300, text_tokens: 50 } } });
    }

    // ---- Gemini
    const gm = /^\/v1beta\/models\/([^:]+):generateContent$/.exec(path);
    if (gm) {
      const j = JSON.parse(body.toString("utf8") || "{}");
      const parts = j.contents?.[0]?.parts ?? [];
      const prompt = parts.find((p) => typeof p.text === "string")?.text ?? "";
      const inputs = parts.filter((p) => p.inline_data || p.inlineData).length;
      const cfg = j.generationConfig?.imageConfig ?? j.generationConfig?.responseFormat?.image ?? {};
      console.log(`${ts} gemini ${gm[1]} inputs=${inputs} size=${cfg.imageSize ?? "-"} ratio=${cfg.aspectRatio ?? "-"} prompt="${prompt.slice(0, 60)}"`);
      if (await simulate(prompt, "gemini", res)) return;
      await sleep(DELAY);
      let [w, h] = [SIZE, SIZE];
      const ar = /^(\d+):(\d+)$/.exec(cfg.aspectRatio ?? "");
      if (ar) {
        const a = Number(ar[1]) / Number(ar[2]);
        if (a >= 1) h = Math.round(SIZE / a);
        else w = Math.round(SIZE * a);
      }
      const png = drawImage({ width: w, height: h, provider: "gemini", prompt, mode: inputs ? "edit" : "gen" });
      served++;
      return json(res, 200, { candidates: [{ content: { parts: [{ text: "(fake) here is your image" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }], role: "model" }, finishReason: "STOP", safetyRatings: [] }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 1290, totalTokenCount: 1330 } });
    }

    json(res, 404, { error: { message: `no route for ${req.method} ${path}` } });
  } catch (e) {
    console.error(`${ts} ${path} failed:`, e);
    json(res, 500, { error: { message: String(e) } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake-ai-server listening on http://127.0.0.1:${PORT} (image ${SIZE}px, delay ${DELAY} ms)`);
  console.log(`set PF_AI_BASE_URL_OPENAI / PF_AI_BASE_URL_XAI / PF_AI_BASE_URL_GEMINI to http://127.0.0.1:${PORT}`);
});
