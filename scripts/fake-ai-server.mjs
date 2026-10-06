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
import { deflateSync } from "node:zlib";

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const PORT = Number(argOf("--port", process.env.PORT ?? "8787"));
const SIZE = Number(argOf("--size", "512"));
const DELAY = Number(argOf("--delay", "1200"));

// ------------------------------------------------------------------ tiny PNG encoder

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Encode straight-alpha RGBA8 pixels as a PNG file. */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride) : raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ 5x7 bitmap font

// Glyph rows are 5-bit masks, 7 rows each. Covers A-Z, 0-9 and a few symbols; others draw as a box.
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e], C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e], E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c], K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11], O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10], Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04], W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], 1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e], 2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e], 4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], 5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], 7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], 8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c], " ": [0, 0, 0, 0, 0, 0, 0], "-": [0, 0, 0, 0x1f, 0, 0, 0], ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04], ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0], "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
};
const BOX = [0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f];

function hashColor(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hue = h % 360;
  // HSL -> RGB (s = 0.65, l = 0.5)
  const c = 0.65, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = 0.5 - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Draw: coloured background, white frame, provider label + prompt in big pixels. */
function drawImage({ width, height, provider, prompt, mode }) {
  const px = Buffer.alloc(width * height * 4);
  const [r, g, b] = hashColor(prompt + provider);
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = 255;
  }
  const frame = Math.max(4, Math.round(width / 48));
  const set = (x, y, v) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    px[i] = v[0];
    px[i + 1] = v[1];
    px[i + 2] = v[2];
    px[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x < frame || y < frame || x >= width - frame || y >= height - frame) set(x, y, [255, 255, 255]);
  // Diagonal stripe so edits are visibly different from the input.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (((x + y) >> 4) % 6 === 0) set(x, y, [Math.min(255, r + 40), Math.min(255, g + 40), Math.min(255, b + 40)]);

  const lines = [`${provider.toUpperCase()} ${mode.toUpperCase()}`, ...wrap(prompt.toUpperCase().replace(/\s+/g, " "), 14)].slice(0, 6);
  const scale = Math.max(2, Math.floor(width / (6 * 16)));
  const lineH = 9 * scale;
  let y0 = Math.round((height - lines.length * lineH) / 2);
  for (const line of lines) {
    const w = line.length * 6 * scale;
    let x0 = Math.round((width - w) / 2);
    for (const ch of line) {
      const glyph = FONT[ch] ?? BOX;
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (glyph[gy] & (0x10 >> gx)) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) set(x0 + gx * scale + sx, y0 + gy * scale + sy, [255, 255, 255]);
      x0 += 6 * scale;
    }
    y0 += lineH;
  }
  return encodePng(width, height, px);
}
function wrap(s, n) {
  const out = [];
  let cur = "";
  for (const w of s.split(" ")) {
    if ((cur + " " + w).trim().length > n && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

// ------------------------------------------------------------------ request helpers

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
/** Minimal multipart/form-data parser: returns { fields: {name: string}, files: {name: [bytes...]} }. */
function parseMultipart(body, contentType) {
  const m = /boundary=("?)([^";]+)\1/.exec(contentType);
  if (!m) return { fields: {}, files: {} };
  const boundary = Buffer.from("--" + m[2]);
  const fields = {};
  const files = {};
  let pos = body.indexOf(boundary);
  while (pos >= 0) {
    pos += boundary.length;
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // closing --
    pos += 2; // CRLF
    const headEnd = body.indexOf("\r\n\r\n", pos);
    if (headEnd < 0) break;
    const head = body.subarray(pos, headEnd).toString("latin1");
    const next = body.indexOf(boundary, headEnd);
    const data = body.subarray(headEnd + 4, next - 2);
    const name = /name="([^"]*)"/.exec(head)?.[1] ?? "";
    if (/filename="/.test(head)) (files[name] ??= []).push(data);
    else fields[name] = data.toString("utf8");
    pos = next;
  }
  return { fields, files };
}
function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
