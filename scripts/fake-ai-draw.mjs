/**
 * Shared helpers for the fake AI servers: a dependency-free PNG encoder and a "draw the
 * prompt in big pixels" image generator so every fake answer is recognisable on a layer.
 * Node >= 18.
 */

import { deflateSync } from "node:zlib";

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

/** Read width/height from a PNG header (for img2img answers that match the input). */
export function pngSize(bytes) {
  if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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

export function hashColor(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hue = h % 360;
  // HSL -> RGB (s = 0.65, l = 0.5)
  const c = 0.65, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = 0.5 - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Draw: coloured background, white frame, provider label + prompt in big pixels. */
export function drawImage({ width, height, provider, prompt, mode }) {
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

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
/** Minimal multipart/form-data parser: returns { fields: {name: string}, files: {name: [bytes...]} }. */
export function parseMultipart(body, contentType) {
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
export function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
